/** WOLF V5 design plans over the loaded DT schemas. Pure, with no API writes. */
import { normalizeSnapshot, buildVoiceInventory } from './data-source.js';
import { fieldLabel, coerceRowValue } from './draft-fields.js';
import { nodeTitle, branchLabel } from './business.js';
import { sortDestinations } from './destination-order.js';
import { PARTICIPANT_CATALOGUE, catalogueRows } from './participant-catalogue.js';
import { validateDecision } from './decision-fields.js';

const TYPES = {
  inboundcall: ['W_INBOUND_CALL_v5', 'Accueil', 'DNIS_SEGMENT'],
  menu: ['W_MENU_v5', 'Menu vocal', 'MENU_NAME'],
  service: ['W_SERVICES_v5', 'Équipe de traitement', 'SERVICE'],
  schedulegroup: ['W_SCHEDULE_GROUP_v5', 'Horaires', 'SCHEDULE_GROUP_KEY'],
  decision: ['W_DECISION_v5', 'Règle métier', 'DECISION_NAME'],
  ratiodistrib: ['W_RATIO_DISTRIB_v5', 'Répartition', 'RATIO_NAME'],
  bot: ['W_BOT_v5', 'Bot vocal'],
  transfercallflow: ['W_TRANSFER_CALLFLOW_v5', 'Transfert de parcours'],
};
const text = (v) => (v == null ? '' : String(v)),
  own = (o, k) => Object.hasOwn(o || {}, k),
  copy = (v) => structuredClone(v);
const targetField = (field) => field.replace('TARGET_TYPE', 'TARGET');
const isOutlet = (field) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(field);
const branch = (field) =>
  /^TARGET_TYPE_\d+$/.test(field)
    ? 'RATIO' + field.match(/\d+$/)[0]
    : field === 'TARGET_TYPE'
      ? ''
      : field.replace(/_TARGET_TYPE$/, '');
const routeId = (nodeId, field) => JSON.stringify([nodeId, field]);
const base = (value) => text(value).split('|')[0].trim().toLowerCase();
const replaceBase = (value, newBase) => [newBase, ...text(value).split('|').slice(1)].join('|');
const property = (table, key) => table.schema?.properties?.[key];
function check(table, key, value) {
  const rule = property(table, key);
  if (!rule) throw Error(`Le champ ${key} n’existe pas dans le schéma de ${table.name}.`);
  let result;
  try {
    result = coerceRowValue(undefined, value, rule);
  } catch (error) {
    throw Error(`${fieldLabel(key)} : ${error.message}`);
  }
  if (typeof result === 'string' && rule.pattern) {
    let pattern;
    try {
      pattern = new RegExp(rule.pattern);
    } catch {
      throw Error(`Format du schéma invalide pour ${key}.`);
    }
    if (!pattern.test(result))
      throw Error(`${fieldLabel(key)} ne respecte pas le format de la table.`);
  }
  return result;
}
function fieldInfo(type, key, schema, table) {
  const rule = copy(schema);
  if (type === 'decision' && key === 'DECISION_OPERATOR' && !rule.enum)
    rule.enum = ['exist', 'empty', 'contains', '==', '>=', '<=', '>', '<'];
  if (type === 'menu' && key === 'MENU_TIMEOUT' && !rule.enum)
    rule.enum = rule.type === 'string' ? ['3', '5', '7', '10', '12'] : [3, 5, 7, 10, 12];
  const semantic =
    (type === 'service' && key === 'QUEUE') ||
    (type === 'schedulegroup' && key === 'SCHEDULE_GROUP') ||
    (type === 'decision' &&
      ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_OPERATOR', 'DECISION_VALUE'].includes(key)) ||
    (type === 'ratiodistrib' && /^RATIO[1-5]$/.test(key));
  return {
    key,
    label: fieldLabel(key),
    schema: rule,
    required: (table.schema.required || []).includes(key) || Boolean(semantic),
    ...(own(schema, 'default') ? { default: copy(schema.default) } : {}),
  };
}
function outlets(table) {
  return Object.keys(table.schema?.properties || {})
    .filter(isOutlet)
    .filter((field) => property(table, targetField(field)))
    .map((field) => ({
      field,
      targetField: targetField(field),
      label: branchLabel({ field, branch: branch(field) }),
    }));
}
export function designerCatalogue(input) {
  const snapshot = normalizeSnapshot(input);
  return Object.entries(TYPES).map(([type, [tableName, label, keyAlias]]) => {
    const tables = snapshot.tables.filter(
        (table) => table.name.toUpperCase() === tableName.toUpperCase(),
      ),
      table = tables.length === 1 ? tables[0] : null;
    let reason =
      type === 'bot'
        ? 'La création d’un bot nécessite aussi ses intents et ses dépendances externes.'
        : type === 'transfercallflow'
          ? 'Le transfert nécessite une configuration de flow versionnée et ne possède pas de sortie de reprise.'
          : tables.length > 1
            ? 'Plusieurs tables correspondent à ce type.'
            : !table
              ? 'Table absente de cette organisation.'
              : !property(table, 'key')
                ? 'Le schéma de la table doit être chargé.'
                : !property(table, 'DESCRIPTION')
                  ? 'Le schéma ne possède pas de champ DESCRIPTION.'
                  : !outlets(table).length
                    ? 'Aucune sortie WOLF raccordable dans le schéma.'
                    : '';
    const slots = table ? outlets(table) : [],
      excluded = new Set([
        'key',
        'DESCRIPTION',
        'DIVISION',
        keyAlias,
        ...slots.flatMap((slot) => [slot.field, slot.targetField]),
      ]);
    return {
      type,
      label,
      tableId: table?.id || '',
      tableName,
      keyAlias,
      divisionRequired: Boolean(table && property(table, 'DIVISION')),
      divisionSchema:
        table && property(table, 'DIVISION') ? copy(property(table, 'DIVISION')) : null,
      available: !reason,
      reason,
      outlets: slots,
      fields: table
        ? Object.entries(table.schema?.properties || {})
            .filter(([key]) => !excluded.has(key) && !isOutlet(key))
            .map(([key, schema]) => fieldInfo(type, key, schema, table))
        : [],
    };
  });
}
function selectTable(snapshot, type, tableId) {
  const capability = designerCatalogue(snapshot).find((item) => item.type === type);
  if (!capability?.available)
    throw Error(capability?.reason || 'Ce type de bloc WOLF V5 n’est pas pris en charge.');
  if (tableId && tableId !== capability.tableId)
    throw Error('La table choisie ne correspond plus au type de bloc.');
  return { table: snapshot.tables.find((t) => t.id === capability.tableId), capability };
}
function currentFlow(snapshot, flow) {
  const live = buildVoiceInventory(snapshot).flows.find((item) => item.id === flow?.id);
  if (!live || live.version !== '5')
    throw Error('Choisissez un parcours WOLF V5 présent dans les données chargées.');
  // The caller must supply an effective snapshot when there are pending drafts.
  for (const node of flow.nodes || []) {
    const fresh = live.nodes.find((n) => n.id === node.id);
    if (!fresh || JSON.stringify(fresh.row) !== JSON.stringify(node.row))
      throw Error('Le parcours a changé. Actualisez la préparation du designer.');
  }
  return live;
}
export function designerOptions({ snapshot: input, flow }) {
  const snapshot = normalizeSnapshot(input),
    catalogue = designerCatalogue(snapshot),
    placements = [],
    destinations = [],
    notices = [];
  const participantData = {
    required: Boolean(
      snapshot.source?.participantCatalogueRequired ||
        snapshot.tables.some((table) => table.name === PARTICIPANT_CATALOGUE),
    ),
    definitions: catalogueRows(snapshot),
  };
  if (!flow) return { catalogue, placements, destinations, notices, participantData };
  const live = currentFlow(snapshot, flow);
  for (const node of live.nodes) {
    if (!TYPES[node.type]) continue;
    if (node.type !== 'transfercallflow')
      destinations.push({
        nodeId: node.id,
        type: node.type,
        key: node.key,
        label: nodeTitle(node),
      });
    const table = snapshot.tables.find((t) => t.id === node.tableId);
    for (const slot of outlets(table))
      placements.push({
        id: routeId(node.id, slot.field),
        fromId: node.id,
        ...slot,
        label: `${nodeTitle(node)} · ${slot.label}`,
        currentType: text(node.row[slot.field]),
        currentTarget: text(node.row[slot.targetField]),
      });
  }
  return {
    catalogue,
    placements,
    destinations: sortDestinations(destinations),
    notices,
    participantData,
    returnAllowedNodes: live.nodes.filter((n) => canReturnToWaiting(live, n.id)).map((n) => n.id),
  };
}
function newRow(table, capability, { key, name, division, values = {} }) {
  if (!text(name).trim()) throw Error('Donnez un nom à cette étape.');
  if (property(table, 'DIVISION') && !text(division ?? values.DIVISION).trim())
    throw Error('Choisissez une division Genesys.');
  if (!text(key).trim() || text(key) !== text(key).trim() || /[|\r\n]/.test(text(key)))
    throw Error('La clé doit être renseignée, sans espaces aux extrémités ni séparateur WOLF.');
  if (table.rows.some((row) => text(row.key) === text(key)))
    throw Error(`La clé « ${key} » existe déjà dans ${table.name}.`);
  const row = {};
  for (const [field, rule] of Object.entries(table.schema.properties))
    if (own(rule, 'default')) row[field] = check(table, field, rule.default);
  const reserved = new Set([
    'key',
    'DESCRIPTION',
    capability.keyAlias,
    ...capability.outlets.flatMap((slot) => [slot.field, slot.targetField]),
  ]);
  for (const [field, value] of Object.entries(values)) {
    if (reserved.has(field)) throw Error(`Le champ ${field} est géré par le designer.`);
    row[field] = check(table, field, value);
  }
  row.key = check(table, 'key', text(key));
  row.DESCRIPTION = check(table, 'DESCRIPTION', text(name).trim());
  if (capability.keyAlias && property(table, capability.keyAlias))
    row[capability.keyAlias] = check(table, capability.keyAlias, row.key);
  if (property(table, 'DIVISION') && division != null && text(division).trim())
    row.DIVISION = check(table, 'DIVISION', text(division).trim());
  // Explicit safe skeleton: every schema-supported exit initially ends the call.
  // Insertion replaces the user-selected continuation before validation.
  for (const slot of capability.outlets) {
    row[slot.field] = check(table, slot.field, 'disconnect');
    row[slot.targetField] = check(table, slot.targetField, '');
  }
  return row;
}
function validateRow(table, row) {
  for (const field of table.schema.required || [])
    if (!own(row, field) || row[field] === undefined)
      throw Error(`Renseignez le champ obligatoire « ${fieldLabel(field)} » (${field}).`);
  for (const [field, value] of Object.entries(row)) row[field] = check(table, field, value);
}
function validateSemantics(type, table, row, continuationField, snapshot) {
  const required =
    type === 'service'
      ? ['QUEUE']
      : type === 'schedulegroup'
        ? ['SCHEDULE_GROUP']
        : type === 'decision'
          ? ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_OPERATOR']
          : [];
  for (const key of required)
    if (property(table, key) && !text(row[key]).trim())
      throw Error(`Renseignez « ${fieldLabel(key)} » pour ce bloc.`);
  if (type === 'decision' && property(table, 'DECISION_OPERATOR')) {
    validateDecision(row, { snapshot });
  }
  if (
    type === 'menu' &&
    property(table, 'MENU_TIMEOUT') &&
    text(row.MENU_TIMEOUT) &&
    ![3, 5, 7, 10, 12].includes(Number(row.MENU_TIMEOUT))
  )
    throw Error('Le délai du menu WOLF V5 doit être de 3, 5, 7, 10 ou 12 secondes.');
  if (type === 'ratiodistrib') {
    const ratios = Object.keys(table.schema.properties).filter((k) => /^RATIO[1-5]$/.test(k));
    if (!ratios.length) throw Error('Le schéma ne contient aucun poids de répartition WOLF V5.');
    if (
      ratios.some(
        (k) => text(row[k]).trim() && (!Number.isFinite(Number(row[k])) || Number(row[k]) < 0),
      )
    )
      throw Error('Les poids de répartition doivent être des nombres positifs ou nuls.');
    if (!ratios.some((k) => Number(row[k]) > 0))
      throw Error('Renseignez au moins un poids de répartition supérieur à zéro.');
    const selected = continuationField?.match(/^(RATIO[1-5])_TARGET_TYPE$/)?.[1];
    if (selected && !(Number(row[selected]) > 0))
      throw Error('Le poids de la sortie de reprise doit être supérieur à zéro.');
  }
}
function mapping(table, row) {
  return {
    nodeId: `${table.id}:${row.key}`,
    tableId: table.id,
    tableName: table.name,
    key: row.key,
    oldKey: row.key,
    title: row.DESCRIPTION,
  };
}
function projected(snapshot, createdRows, updatedRows, flowId, nodeId, notices, kind) {
  const next = copy(snapshot);
  for (const { tableId, row } of createdRows)
    next.tables.find((t) => t.id === tableId).rows.push(copy(row));
  for (const { node, row } of updatedRows) {
    const table = next.tables.find((t) => t.id === node.tableId),
      index = table.rows.findIndex((r) => text(r.key) === node.key);
    if (index < 0) throw Error('Étape à modifier introuvable.');
    table.rows[index] = copy(row);
  }
  const result = normalizeSnapshot(next),
    inventory = buildVoiceInventory(result),
    flow = inventory.flows.find((f) => f.id === flowId);
  if (!flow || !flow.nodes.some((n) => n.id === nodeId))
    throw Error('Le nouveau bloc n’est pas accessible depuis le parcours.');
  const changedIds = new Set([
    ...createdRows.map((r) => r.nodeId),
    ...updatedRows.map((r) => r.node.id),
  ]);
  const untouched = (edge) => {
    const update = updatedRows.find(({ node }) => node.id === edge.from);
    return (
      !!update &&
      [edge.field, edge.destinationField]
        .filter(Boolean)
        .every(
          (field) => String(update.node.row?.[field] ?? '') === String(update.row?.[field] ?? ''),
        )
    );
  };
  const invalid = flow.edges.find(
    (edge) =>
      changedIds.has(edge.from) &&
      !edge.resolved &&
      !edge.dynamic &&
      edge.type !== 'callback' &&
      !untouched(edge),
  );
  if (invalid)
    throw Error(
      `Une sortie de l’étape modifiée ne peut pas être résolue (${invalid.field || invalid.branch || 'destination'}).`,
    );
  const shared = inventory.flows.filter(
    (f) => f.id !== flowId && updatedRows.some(({ node }) => f.nodes.some((n) => n.id === node.id)),
  );
  if (shared.length)
    notices.push(
      'Ce raccordement modifie une étape également utilisée par : ' +
        shared.map((f) => f.name || f.key).join(', ') +
        '.',
    );
  const mappings = createdRows.map((r) =>
    mapping(
      snapshot.tables.find((t) => t.id === r.tableId),
      r.row,
    ),
  );
  return {
    ok: true,
    errors: [],
    snapshot: result,
    flowId,
    nodeId,
    createdRows,
    updatedRows,
    mappings,
    summary: {
      kind,
      title: flow.name || flow.key,
      targetFlowId: flowId,
      nodeCount: createdRows.length,
      mappings,
      notices,
      localOnly: true,
    },
  };
}
function fail(error) {
  return {
    ok: false,
    errors: [{ message: error.message }],
    snapshot: null,
    createdRows: [],
    updatedRows: [],
    mappings: [],
    summary: null,
  };
}
export function prepareNewFlow({ snapshot: input, name, phone, division, tableId, values = {} }) {
  try {
    const snapshot = normalizeSnapshot(input),
      { table, capability } = selectTable(snapshot, 'inboundcall', tableId);
    if (!/^\+[1-9]\d{7,14}$/.test(text(phone)))
      throw Error('Saisissez un numéro international, par exemple +33123456789, sans espaces.');
    const row = newRow(table, capability, { key: phone, name, division, values });
    validateRow(table, row);
    const nodeId = `${table.id}:${row.key}`;
    return projected(
      snapshot,
      [{ tableId: table.id, tableName: table.name, row, nodeId }],
      [],
      nodeId,
      nodeId,
      [
        'Les sorties de l’accueil terminent l’appel. Ajoutez et raccordez les étapes avant publication.',
        'Créer les lignes WOLF ne configure pas l’affectation téléphonique du numéro dans Genesys.',
      ],
      'new-flow',
    );
  } catch (error) {
    return fail(error);
  }
}
export function prepareNewBlock({
  snapshot: input,
  flow,
  type,
  tableId,
  name,
  key,
  division,
  values = {},
  placementId,
  continuationField,
}) {
  try {
    const snapshot = normalizeSnapshot(input),
      live = currentFlow(snapshot, flow);
    if (type === 'inboundcall')
      throw Error('Une entrée de parcours ne peut pas être insérée comme bloc.');
    const { table, capability } = selectTable(snapshot, type, tableId),
      options = designerOptions({ snapshot, flow: live });
    const placement = options.placements.find((p) => p.id === placementId);
    if (!placement) throw Error('Choisissez la sortie sur laquelle insérer ce bloc.');
    if (!placement.currentType.trim())
      throw Error(
        'Cette sortie est vide. Raccordez-la d’abord à une destination avant d’insérer un bloc.',
      );
    const outlet = capability.outlets.find((o) => o.field === continuationField);
    if (!outlet) throw Error('Choisissez la sortie du nouveau bloc qui reprendra le parcours.');
    const anchor = live.nodes.find((n) => n.id === placement.fromId),
      anchorTable = snapshot.tables.find((t) => t.id === anchor.tableId);
    const row = newRow(table, capability, {
      key,
      name,
      division: division ?? live.division,
      values,
    });
    // Keep language/subroutine options and PDATA on the incoming transition exactly once.
    row[outlet.field] = check(table, outlet.field, base(placement.currentType));
    row[outlet.targetField] = check(
      table,
      outlet.targetField,
      text(placement.currentTarget).split('|')[0],
    );
    validateRow(table, row);
    validateSemantics(type, table, row, continuationField, snapshot);
    const anchorRow = copy(anchor.row);
    anchorRow[placement.field] = check(
      anchorTable,
      placement.field,
      replaceBase(placement.currentType, type),
    );
    anchorRow[placement.targetField] = check(
      anchorTable,
      placement.targetField,
      replaceBase(placement.currentTarget, row.key),
    );
    validateRow(anchorTable, anchorRow);
    const nodeId = `${table.id}:${row.key}`;
    return projected(
      snapshot,
      [{ tableId: table.id, tableName: table.name, row, nodeId }],
      [{ node: anchor, row: anchorRow }],
      live.id,
      nodeId,
      [
        `La sortie « ${outlet.label} » reprend la destination précédente. Les autres sorties terminent l’appel jusqu’à leur raccordement.`,
      ],
      'new-block',
    );
  } catch (error) {
    return fail(error);
  }
}
function canReturnToWaiting(flow, nodeId) {
  const seen = new Set(),
    queue = flow.edges
      .filter((e) => /^INQUEUE_(?:MENU_[1-4]|REPEAT_MENU)$/.test(e.branch || '') && e.to)
      .map((e) => e.to);
  while (queue.length) {
    const id = queue.shift();
    if (
      seen.has(id) ||
      !['menu', 'decision', 'ratiodistrib', 'schedulegroup'].includes(
        flow.nodes.find((n) => n.id === id)?.type,
      )
    )
      continue;
    seen.add(id);
    for (const edge of flow.edges)
      if (edge.from === id && edge.relationship !== 'context' && edge.to) queue.push(edge.to);
  }
  return seen.has(nodeId);
}
function reachableOutsideWaiting(flow, nodeId) {
  const seen = new Set(),
    queue = [flow.id];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of flow.edges)
      if (
        edge.from === id &&
        edge.relationship !== 'context' &&
        !/^INQUEUE_(?:MENU_[1-4]|REPEAT_MENU)$/.test(edge.branch || '') &&
        edge.to
      )
        queue.push(edge.to);
  }
  return seen.has(nodeId);
}
export function prepareRouteEdit({ snapshot: input, flow, nodeId, field, destination }) {
  try {
    const snapshot = normalizeSnapshot(input),
      live = currentFlow(snapshot, flow),
      options = designerOptions({ snapshot, flow: live });
    const placement = options.placements.find((p) => p.fromId === nodeId && p.field === field);
    if (!placement) throw Error('Choisissez une sortie WOLF disponible dans le schéma.');
    const node = live.nodes.find((n) => n.id === nodeId),
      table = snapshot.tables.find((t) => t.id === node.tableId);
    let type, key;
    if (destination?.nodeId) {
      const target = options.destinations.find((d) => d.nodeId === destination.nodeId);
      if (!target) throw Error('Choisissez une étape appartenant à ce parcours.');
      type = target.type;
      key = target.key;
    } else if (['disconnect', 'next'].includes(destination?.type)) {
      type = destination.type;
      key = '';
      if (type === 'next' && !canReturnToWaiting(live, node.id))
        throw Error(
          'Le retour à l’attente est réservé aux étapes appelées depuis un menu d’attente.',
        );
    } else throw Error('Choisissez une étape, une fin d’appel ou un retour à l’attente.');
    const row = copy(node.row);
    row[field] = check(table, field, replaceBase(row[field], type));
    row[placement.targetField] = check(
      table,
      placement.targetField,
      replaceBase(row[placement.targetField], key),
    );
    validateRow(table, row);
    const notices = ['Les options, annonces et contextes de cette sortie sont conservés.'];
    if (type === 'next' && reachableOutsideWaiting(live, node.id))
      notices.push(
        'Cette étape est aussi accessible hors menu d’attente. Le retour next n’a pas de contexte d’attente sur ces chemins : vérifiez chaque usage avant publication.',
      );
    const result = projected(
      snapshot,
      [],
      [{ node, row }],
      live.id,
      live.id,
      notices,
      'route-edit',
    );
    const after = buildVoiceInventory(result.snapshot).flows.find((f) => f.id === live.id),
      removed = live.nodes.filter((n) => !after.nodes.some((a) => a.id === n.id));
    if (removed.length)
      result.summary.notices.push(
        `${removed.length} étape(s) ne seront plus accessibles depuis ce parcours. Leurs lignes sont conservées dans les tables.`,
      );
    return result;
  } catch (error) {
    return fail(error);
  }
}
