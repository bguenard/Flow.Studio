/** Whole-journey local drafts. No remote API or publishing capability. */
import { normalizeSnapshot, buildVoiceInventory } from './data-source.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = value => value == null ? '' : String(value);
const nodeId = (table, row) => `${table.id}:${text(row.key)}`;
const dynamic = value => /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
const TERMINAL = new Set(['disconnect', 'next', 'enable', 'disable', 'repeat', 'validation', 'novalidation']);
const EXTERNAL_TYPES = new Set(['number', 'user', 'voicemailqueue', 'voicemailgroup', 'voicemailuser']);
const TYPE_TABLES = {
  '4': { inboundcall: 'W_INBOUND_CALL_v4', standardcallflow: 'W_INBOUND_CALL_v4', service: 'W_DISTRIBUTION_v4', schedulegroup: 'W_SCHEDULE_GROUP_v4', menu: 'W_MENU_v4', decision: 'W_DECISION_v4', ratiodistrib: 'W_RATIO_DISTRIB_v4', customcallflow: 'W_TRF_FLOW_v4', transfercallflow: 'W_TRF_FLOW_v4' },
  '5': { inboundcall: 'W_INBOUND_CALL_v5', service: 'W_SERVICES_v5', schedulegroup: 'W_SCHEDULE_GROUP_v5', menu: 'W_MENU_v5', decision: 'W_DECISION_v5', ratiodistrib: 'W_RATIO_DISTRIB_v5', bot: 'W_BOT_v5', transfercallflow: 'W_TRANSFER_CALLFLOW_v5' },
};
const EXTERNAL_FIELDS = new Map([
  ['QUEUE', 'queue'], ['CALLBACK_QUEUE', 'queue'], ['SCHEDULE_GROUP', 'schedule'], ['EMERGENCY_GROUP', 'emergency'],
  ['DIRECT_USER', 'user'], ['DIRECT_ROUTING_AGENT', 'user'], ['FLOW_NAME', 'flow'], ['ID_BOT', 'bot'], ['BOT_NAME', 'bot'],
  ['SKILLS', 'skills'], ['LANGUAGE_SKILL', 'language-skill'], ['SCRIPT', 'script'],
]);

function namePrefix(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42).toUpperCase() || 'DECLINAISON';
}
function property(table, field) { return object(table.schema?.properties?.[field]) ? table.schema.properties[field] : {}; }
function validLength(value, rule, label) {
  if (Number.isInteger(rule.maxLength) && value.length > rule.maxLength) throw new Error(`${label} dépasse la longueur maximale autorisée (${rule.maxLength}).`);
  if (Number.isInteger(rule.minLength) && value.length < rule.minLength) throw new Error(`${label} est trop court.`);
  if (typeof rule.pattern === 'string') {
    let pattern;
    try { pattern = new RegExp(rule.pattern); } catch { throw new Error(`Schéma de ${label} invalide.`); }
    if (!pattern.test(value)) throw new Error(`${label} ne respecte pas le format autorisé.`);
  }
}

/**
 * Creates a local whole-flow declination, preserving the source snapshot.
 * Known static WOLF dependencies are cloned once, including shared/cyclic
 * routes, PDATA, waiting menus and consent menus. Runtime-derived dependencies
 * are retained and listed for review instead of guessed.
 * @returns {{snapshot:object,flowId:string,summary:object}}
 */
export function cloneFlow(input, flow, options = {}) {
  const original = normalizeSnapshot(input);
  const sourceFlow = buildVoiceInventory(original).flows.find(item => item.id === flow?.id);
  if (!sourceFlow) throw new Error('Le parcours source n’appartient pas à cet instantané.');
  const name = text(options.name).trim();
  const division = text(options.division).trim();
  if (!name) throw new Error('Donnez un nom métier à la déclinaison.');
  if (!division) throw new Error('Choisissez l’entité de la déclinaison.');
  const phone = options.phone == null || options.phone === '' ? '' : text(options.phone);
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Le numéro doit être au format international, par exemple +33123456789, sans espaces.');
  const byName = new Map();
  const byId = new Map(original.tables.map(table => [table.id, table]));
  for (const table of original.tables) {
    const key = table.name.toUpperCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(table);
  }
  const entryTable = byId.get(sourceFlow.sourceTableId);
  if (phone && entryTable.rows.some(row => text(row.key) === phone)) throw new Error('Ce numéro est déjà utilisé dans la table d’entrée.');
  const typeTables = TYPE_TABLES[sourceFlow.version];
  const known = new Map();
  const refs = [];
  const referencesRetained = [], needsReview = [];
  const reviewIds = new Set(), retainedIds = new Set();
  const addReview = entry => { const id = JSON.stringify(entry); if (!reviewIds.has(id)) { reviewIds.add(id); needsReview.push(entry); } };
  const retain = entry => { const id = JSON.stringify(entry); if (!retainedIds.has(id)) { retainedIds.add(id); referencesRetained.push(entry); } };
  const resolve = (tableName, key, from, field, kind) => {
    const candidates = byName.get(tableName.toUpperCase()) || [];
    if (dynamic(key)) { addReview({ code: 'dynamic-reference', nodeId: from, field, value: key, message: 'Référence déterminée pendant l’interaction, conservée sans modification.' }); return null; }
    if (candidates.length !== 1) { addReview({ code: candidates.length ? 'ambiguous-table' : 'missing-table', nodeId: from, field, tableName, value: key }); return null; }
    const table = candidates[0];
    const row = table.rows.find(item => text(item.key) === key);
    if (!row) {
      const suggestions = table.rows.filter(item => text(item.key).trim() === key.trim()).map(item => text(item.key));
      addReview({ code: suggestions.length ? 'whitespace-key-mismatch' : 'missing-row', nodeId: from, field, tableName, value: key, ...(suggestions.length ? { suggestions } : {}) });
      return null;
    }
    const id = visit(table, row);
    refs.push({ from, field, kind, targetNodeId: id, oldKey: key });
    return id;
  };
  const visit = (table, row) => {
    const id = nodeId(table, row);
    if (known.has(id)) return id;
    if (known.size >= 500) throw new Error('Le parcours dépasse la limite de 500 configurations locales à dupliquer.');
    known.set(id, { table, row });
    for (const [field, raw] of Object.entries(row)) {
      const value = text(raw);
      if (!value) continue;
      const match = field.match(/^(.*?)(?:_)?TARGET_TYPE(?:_(\d+))?$/);
      if (match) {
        const targetField = field.replace('TARGET_TYPE', 'TARGET');
        const rawTarget = text(row[targetField]);
        const [main, ...extras] = rawTarget.split('|');
        const type = value.split('|')[0].trim().toLowerCase();
        for (const extra of extras) if (/^pdata:/i.test(extra)) for (const key of extra.slice(6).split(';').filter(Boolean)) resolve(`W_PARTICIPANT_DATA_v${sourceFlow.version}`, key, id, targetField, 'pdata');
        if (dynamic(main)) { addReview({ code: 'dynamic-reference', nodeId: id, field: targetField, value: main, message: 'Destination calculée pendant l’interaction, conservée sans modification.' }); continue; }
        if (TERMINAL.has(type)) continue;
        if (EXTERNAL_TYPES.has(type)) { retain({ kind: type, nodeId: id, field: targetField, value: rawTarget }); continue; }
        if (!own(typeTables, type)) { addReview({ code: 'unknown-target-type', nodeId: id, field, value, target: rawTarget }); continue; }
        if (!main.trim()) { addReview({ code: 'missing-target', nodeId: id, field: targetField, value: rawTarget }); continue; }
        resolve(typeTables[type], main, id, targetField, 'target');
        continue;
      }
      if (/^(?:INQUEUE_MENU_[1-4]|INQUEUE_REPEAT_MENU|RECORDING_CONSENT_MENU|CONSENT_MENU|CONFIRMATION_ANI_MENU|CONFIRMATION_DIAL_MENU)$/.test(field)) {
        resolve(`W_MENU_v${sourceFlow.version}`, value, id, field, 'direct');
      } else if (field === 'EXCEPTIONAL_DAYS_NAME' && sourceFlow.version === '4') {
        resolve('W_EXCEPTIONAL_DAYS_v4', value, id, field, 'direct');
      } else if (EXTERNAL_FIELDS.has(field)) {
        retain({ kind: EXTERNAL_FIELDS.get(field), nodeId: id, field, value: raw });
        if (dynamic(value)) addReview({ code: 'dynamic-reference', nodeId: id, field, value });
      } else if (/SUBROUTINES?_LIST/.test(field)) {
        addReview({ code: 'runtime-subroutine', nodeId: id, field, value, message: 'Les dépendances internes de ces contrôles ne sont pas déductibles des références statiques.' });
      } else if (field.includes('AUDIO') || /HOLD_MUSIC/.test(field)) {
        if (/HOLD_MUSIC/.test(field)) retain({ kind: 'music', nodeId: id, field, value });
        else for (const part of value.split('|')) {
          if (/^(?:pr|prompt|edge):/i.test(part)) retain({ kind: 'prompt', nodeId: id, field, value: part });
          else if (/^var:/i.test(part) || /\$var:/i.test(part)) addReview({ code: 'dynamic-audio', nodeId: id, field, value: part });
          else if (!/^(?:tts|barg):/i.test(part) && part.trim()) { retain({ kind: 'audio-reference', nodeId: id, field, value: part }); addReview({ code: 'unresolved-audio-format', nodeId: id, field, value: part }); }
        }
      }
    }
    // Subroutines can also be attached to target types, not only list columns.
    for (const [field, value] of Object.entries(row)) if (/TARGET_TYPE/.test(field) && /\|sub:/i.test(text(value))) addReview({ code: 'runtime-subroutine', nodeId: id, field, value, message: 'Contrôles attachés au routage conservés ; leurs dépendances doivent être vérifiées.' });
    return id;
  };
  visit(entryTable, sourceFlow.sourceRow);
  const prefix = namePrefix(name);
  const occupied = new Map(original.tables.map(table => [table.id, new Set(table.rows.map(row => text(row.key)))]));
  const keyMap = new Map();
  let sequence = 1;
  for (const [id, { table, row }] of known) {
    let key;
    if (id === sourceFlow.id && phone) key = phone;
    else {
      const limit = Number.isInteger(property(table, 'key').maxLength) ? property(table, 'key').maxLength : 256;
      if (limit < 10) throw new Error('La taille des clés du schéma ne permet pas de créer un espace de noms fiable.');
      do {
        const suffix = `__${sequence++}`;
        key = `DRAFT_${prefix}`.slice(0, limit - suffix.length) + suffix;
      } while (occupied.get(table.id).has(key));
    }
    validLength(key, property(table, 'key'), 'La nouvelle clé');
    occupied.get(table.id).add(key);
    keyMap.set(id, key);
  }
  const draft = structuredClone(original);
  const draftTables = new Map(draft.tables.map(table => [table.id, table]));
  const mappings = [];
  for (const [id, { table, row }] of known) {
    const copy = structuredClone(row);
    copy.key = keyMap.get(id);
    const keyTitle = property(table, 'key').title;
    if (typeof keyTitle === 'string' && own(copy, keyTitle) && text(copy[keyTitle]) === text(row.key)) copy[keyTitle] = copy.key;
    if (id === sourceFlow.id && own(copy, 'DNIS_SEGMENT')) copy.DNIS_SEGMENT = copy.key;
    if (own(copy, 'DIVISION')) { validLength(division, property(table, 'DIVISION'), 'L’entité'); copy.DIVISION = division; }
    if (id === sourceFlow.id) {
      copy.DESCRIPTION = `[DRAFT_FROM_${text(row.key)}] ${name}`;
      validLength(copy.DESCRIPTION, property(table, 'DESCRIPTION'), 'Le nom de la déclinaison');
    }
    const rowRefs = refs.filter(ref => ref.from === id);
    for (const field of new Set(rowRefs.map(ref => ref.field))) {
      const fieldRefs = rowRefs.filter(ref => ref.field === field);
      const direct = fieldRefs.find(ref => ref.kind === 'direct');
      if (direct) { copy[field] = keyMap.get(direct.targetNodeId); continue; }
      const parts = text(row[field]).split('|');
      const target = fieldRefs.find(ref => ref.kind === 'target');
      if (target) parts[0] = keyMap.get(target.targetNodeId);
      for (let index = 1; index < parts.length; index++) if (/^pdata:/i.test(parts[index])) {
        const marker = parts[index].slice(0, 6);
        parts[index] = marker + parts[index].slice(6).split(';').map(key => {
          const pdata = fieldRefs.find(ref => ref.kind === 'pdata' && ref.oldKey === key);
          return pdata ? keyMap.get(pdata.targetNodeId) : key;
        }).join(';');
      }
      copy[field] = parts.join('|');
    }
    for (const [field, value] of Object.entries(copy)) if (typeof value === 'string') validLength(value, property(table, field), `Le paramètre ${field}`);
    draftTables.get(table.id).rows.push(copy);
    mappings.push({ tableId: table.id, tableName: table.name, sourceNodeId: id, nodeId: `${table.id}:${copy.key}`, oldKey: text(row.key), key: copy.key });
  }
  const flowId = `${entryTable.id}:${keyMap.get(sourceFlow.id)}`;
  const createdAt = new Date().toISOString();
  draft.source.hasLocalDrafts = true;
  draft.source.localDrafts = [...(Array.isArray(draft.source.localDrafts) ? draft.source.localDrafts : []), { flowId, name, division, sourceFlowId: sourceFlow.id, createdAt, kind: 'whole-flow-clone', localOnly: true }];
  draft.source.relationships = [...(Array.isArray(draft.source.relationships) ? draft.source.relationships : []), { type: 'declination', referenceFlowId: sourceFlow.id, flowId, name, createdLocally: true, nodeMappings: mappings.map(mapping => ({ referenceNodeId: mapping.sourceNodeId, localNodeId: mapping.nodeId })) }];
  return {
    snapshot: normalizeSnapshot(draft), flowId,
    summary: { name, division, sourceFlowId: sourceFlow.id, nodeCount: known.size, tableCount: new Set(mappings.map(mapping => mapping.tableId)).size, mappings, referencesRetained, needsReview, localOnly: true },
  };
}
