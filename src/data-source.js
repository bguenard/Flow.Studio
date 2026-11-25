import { buildMessagingFlows } from './messaging-inventory.js';
import { recordingCallFields, recordingSetting } from './route-controls.js';
/**
 * Read-only WOLF sources. No Genesys secret or write request belongs in this module.
 * Imported values remain unchanged: in particular CSV cells stay strings.
 * The normalized `key` aliases a documented logical key when an export omits
 * Genesys' physical `key` column; all original columns are retained.
 */
const KEY_COLUMNS = {
  W_INBOUND_CALL_V4: 'DNIS_SEGMENT',
  W_DISTRIBUTION_V4: 'SERVICE',
  W_PARTICIPANT_DATA_V4: 'PDATA_NAME',
  W_MENU_V4: 'MENU_NAME',
  W_SCHEDULE_GROUP_V4: 'SCHEDULE_GROUP_KEY',
  W_RATIO_DISTRIB_V4: 'RATIO_NAME',
  W_DECISION_V4: 'DECISION_NAME',
  W_INBOUND_CALL_V5: 'DNIS_SEGMENT',
  W_SERVICES_V5: 'SERVICE',
  W_PARTICIPANT_DATA_V5: 'PDATA_NAME',
  W_MENU_V5: 'MENU_NAME',
  W_SCHEDULE_GROUP_V5: 'SCHEDULE_GROUP_KEY',
  W_RECORDING_V5: 'DIVISION_NAME',
  W_RATIO_DISTRIB_V5: 'RATIO_NAME',
  W_DECISION_V5: 'DECISION_NAME',
  W_CHECK_INTERACTION_NB_V5: 'QUEUE',
  W_CHECK_AGENT_LOGGED_V5: 'QUEUE',
};
const TYPE_TABLES = {
  4: {
    inboundcall: 'W_INBOUND_CALL_v4',
    standardcallflow: 'W_INBOUND_CALL_v4',
    service: 'W_DISTRIBUTION_v4',
    schedulegroup: 'W_SCHEDULE_GROUP_v4',
    menu: 'W_MENU_v4',
    decision: 'W_DECISION_v4',
    ratiodistrib: 'W_RATIO_DISTRIB_v4',
    customcallflow: 'W_TRF_FLOW_v4',
    transfercallflow: 'W_TRF_FLOW_v4',
  },
  5: {
    inboundcall: 'W_INBOUND_CALL_v5',
    service: 'W_SERVICES_v5',
    schedulegroup: 'W_SCHEDULE_GROUP_v5',
    menu: 'W_MENU_v5',
    decision: 'W_DECISION_v5',
    ratiodistrib: 'W_RATIO_DISTRIB_v5',
    bot: 'W_BOT_v5',
    callback: 'W_CALLBACK_v5',
    transfercallflow: 'W_TRANSFER_CALLFLOW_v5',
  },
};
const TERMINAL_TYPES = new Set([
  'disconnect',
  'number',
  'user',
  'voicemailqueue',
  'voicemailgroup',
  'voicemailuser',
  'next',
  'queue',
  'enable',
  'disable',
]);
const NO_DESTINATION_TYPES = new Set(['disconnect', 'next', 'enable', 'disable']);
const TYPE_LABELS = {
  inboundcall: 'Accueil',
  service: 'Équipe de traitement',
  schedulegroup: 'Horaires',
  menu: 'Menu vocal',
  decision: 'Règle métier',
  ratiodistrib: 'Répartition',
  bot: 'Bot vocal',
  transfercallflow: 'Transfert de parcours',
  pdata: 'Attributs métier',
  recording: 'Enregistrement',
  callback: 'Rappel',
  disconnect: 'Fin d’appel',
  number: 'Transfert vers un numéro',
  user: 'Conseiller',
  voicemailqueue: 'Messagerie d’équipe',
  voicemailgroup: 'Messagerie de groupe',
  voicemailuser: 'Messagerie du conseiller',
  next: 'Poursuite de l’attente',
};
const BRANCH_LABELS = {
  NEXT: 'Suite du parcours',
  DEFAULT: 'Repli',
  OPEN: 'Ouvert',
  CLOSED: 'Fermé',
  HOLIDAY: 'Vacances',
  EMERGENCY: 'Urgence',
  TRUE: 'Condition vraie',
  FALSE: 'Condition fausse',
  INQUEUE: 'À la fin de l’attente',
  NOTLOGGEDIN: 'Sans conseiller connecté',
  LOGGEDIN: 'Avec des conseillers connectés',
  BUSY_QUEUE: 'Si la file est saturée',
  BUSY: 'Si la charge est élevée',
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (value === undefined || value === null ? '' : String(value));
const clone = (value) => structuredClone(value);
const nonempty = (value) => text(value).trim() !== '';
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** @returns {{schemaVersion:number,source:object,tables:Array}} deeply frozen snapshot */
export function normalizeSnapshot(input) {
  if (!object(input) || !Array.isArray(input.tables))
    throw new Error('Le fichier doit contenir une liste « tables ».');
  const ids = new Set();
  const tables = input.tables.map((table, index) => {
    if (!object(table) || !nonempty(table.name))
      throw new Error(`Table ${index + 1} : nom de table manquant.`);
    const name = text(table.name).trim();
    const id = nonempty(table.id) ? text(table.id) : name;
    if (ids.has(id)) throw new Error(`Identifiant de table en double : ${id}.`);
    ids.add(id);
    const sourceRows = Array.isArray(table.rows) ? table.rows : table.rows?.entities;
    if (!Array.isArray(sourceRows))
      throw new Error(`${name} : liste de lignes « rows » manquante.`);
    const keys = new Set();
    const keyColumn = own(KEY_COLUMNS, name.toUpperCase())
      ? KEY_COLUMNS[name.toUpperCase()]
      : undefined;
    const rows = sourceRows.map((raw, rowIndex) => {
      if (!object(raw)) throw new Error(`${name}, ligne ${rowIndex + 1} : objet attendu.`);
      const row = clone(raw);
      if (!own(row, 'key') && keyColumn && own(row, keyColumn)) row.key = row[keyColumn];
      if (!nonempty(row.key))
        throw new Error(
          `${name}, ligne ${rowIndex + 1} : clé « key »${keyColumn ? ` ou « ${keyColumn} »` : ''} manquante.`,
        );
      const key = text(row.key);
      if (keys.has(key)) throw new Error(`${name} : clé en double « ${key} ».`);
      keys.add(key);
      return row;
    });
    return {
      id,
      name,
      ...(typeof table.description === 'string' ? { description: table.description } : {}),
      ...(table.division ? { division: clone(table.division) } : {}),
      ...(table.schema ? { schema: clone(table.schema) } : {}),
      rows,
    };
  });
  return deepFreeze({
    schemaVersion: 1,
    source: object(input.source) ? clone(input.source) : { kind: 'import' },
    tables,
  });
}

function inferTableName(filename) {
  const basename = text(filename)
    .split(/[\\/]/)
    .pop()
    .replace(/\.(csv|json)$/i, '');
  return /^W_[A-Za-z0-9_]+$/i.test(basename) ? basename : '';
}

function detectDelimiter(input) {
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && own(counts, char)) counts[char]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(input) {
  let content = input.replace(/^\uFEFF/, '');
  const sep = content.match(/^sep=([;,\t])\r?\n/i);
  const delimiter = sep ? sep[1] : detectDelimiter(content);
  if (sep) content = content.slice(sep[0].length);
  const records = [];
  let record = [],
    cell = '',
    quoted = false,
    closed = false;
  const finishCell = () => {
    record.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (record.some((value) => value !== '')) records.push(record);
    record = [];
  };
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && content[index + 1] === '\n') index++;
      finishRow();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (closed && /[ \t]/.test(char)) continue;
    else if (closed || char === '"')
      throw new Error(
        'CSV invalide : guillemet inattendu. Entourez de guillemets les cellules contenant le séparateur.',
      );
    else cell += char;
  }
  if (quoted) throw new Error('CSV invalide : cellule entre guillemets non terminée.');
  if (cell !== '' || record.length || closed) finishRow();
  if (!records.length) throw new Error('Le fichier CSV est vide.');
  const headers = records.shift().map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new Error('CSV invalide : en-tête vide ou présent plusieurs fois.');
  return records.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(
        `CSV ligne ${index + 2} : ${values.length} colonnes trouvées, ${headers.length} attendues.`,
      );
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

/** Accepts a multi-table snapshot, a single table, raw row entities or CSV. */
export function parseTableFile(content, filename = 'export.json', tableName = '') {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Le fichier est vide.');
  const name = text(tableName).trim() || inferTableName(filename);
  const source = { kind: 'import', filename: text(filename) };
  if (/\.csv$/i.test(filename)) {
    if (!name)
      throw new Error(
        'Indiquez le nom exact de la data table pour importer ce CSV (ex. W_SERVICES_v5).',
      );
    return normalizeSnapshot({ source, tables: [{ name, rows: parseCsv(content) }] });
  }
  let input;
  try {
    input = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('JSON invalide. Choisissez un export JSON ou un fichier .csv.');
  }
  if (object(input) && Array.isArray(input.tables)) return normalizeSnapshot({ ...input, source });
  if (
    object(input) &&
    input.name &&
    (Array.isArray(input.rows) || Array.isArray(input.rows?.entities))
  )
    return normalizeSnapshot({ source, tables: [input] });
  if (
    Array.isArray(input) &&
    input.length &&
    input.every((table) => object(table) && table.name && Array.isArray(table.rows))
  )
    return normalizeSnapshot({ source, tables: input });
  const rows = Array.isArray(input) ? input : (input?.entities ?? input?.rows);
  if (Array.isArray(rows)) {
    if (!name) throw new Error('Indiquez le nom exact de la data table pour cet export de lignes.');
    return normalizeSnapshot({
      source,
      tables: [{ name, ...(input?.schema ? { schema: input.schema } : {}), rows }],
    });
  }
  throw new Error(
    'Format JSON non reconnu : utilisez {tables:[{id,name,schema,rows}]} ou un export de lignes avec le nom de table.',
  );
}

function targetParts(rawType, rawTarget) {
  const parts = text(rawType).split('|');
  const targetParts = text(rawTarget).split('|');
  // A key's whitespace is significant. Normalizing it would hide a broken
  // reference or accidentally select another row in the live configuration.
  const target = targetParts[0];
  const pdataKeys = targetParts
    .slice(1)
    .filter((part) => /^pdata:/i.test(part))
    .flatMap((part) => part.slice(6).split(';'))
    .filter(Boolean);
  return {
    type: parts[0].trim().toLowerCase(),
    target,
    parameters: parts.slice(1),
    pdataKeys,
    rawType: text(rawType),
    rawTarget: text(rawTarget),
  };
}
function rowReferences(row, type) {
  if (type === 'pdata') return [];
  // Le réglage d'enregistrement n'a pas de suite : seulement son menu de consentement.
  if (type === 'recording')
    return nonempty(row.CONSENT_MENU)
      ? [
          {
            ...targetParts('menu', ''),
            target: text(row.CONSENT_MENU),
            rawTarget: text(row.CONSENT_MENU),
            field: 'CONSENT_MENU',
            destinationField: 'CONSENT_MENU',
            audio: '',
            branch: 'CONSENT_MENU',
            label: 'Menu de consentement',
            phase: 'recording',
            conditional: true,
            condition: 'Consentement demandé avant l’enregistrement',
          },
        ]
      : [];
  const references = Object.keys(row)
    .filter((field) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(field) && nonempty(row[field]))
    .map((field) => {
      const numbered = field.match(/^TARGET_TYPE_(\d+)$/);
      const stem = numbered
        ? `RATIO${numbered[1]}`
        : field === 'TARGET_TYPE'
          ? ''
          : field.slice(0, -12);
      const destinationField = numbered
        ? `TARGET_${numbered[1]}`
        : stem
          ? `${stem}_TARGET`
          : 'TARGET';
      let audioField = numbered
        ? `TARGET_AUDIO_${numbered[1]}`
        : stem
          ? `${stem}_TARGET_AUDIO`
          : 'TARGET_AUDIO';
      // Menus use OPTION1_AUDIO, not OPTION1_TARGET_AUDIO (both v4 and v5).
      if (!own(row, audioField) && own(row, `${stem}_AUDIO`)) audioField = `${stem}_AUDIO`;
      const phase = /^INQUEUE/.test(stem)
        ? 'waiting'
        : type === 'service'
          ? 'distribution-condition'
          : 'routing';
      return {
        ...targetParts(row[field], row[destinationField]),
        field,
        destinationField,
        audio: row[audioField] ?? '',
        audioField,
        branch: stem,
        phase,
        conditional: type === 'service',
        label: own(BRANCH_LABELS, stem) ? BRANCH_LABELS[stem] : stem || 'Destination',
      };
    });
  if (type === 'service') {
    // Queue is a Genesys resource referenced by the service, not a fabricated
    // WOLF table node. Static configuration is known; resource existence is not.
    if (nonempty(row.QUEUE))
      references.unshift({
        ...targetParts('queue', ''),
        target: text(row.QUEUE),
        rawTarget: text(row.QUEUE),
        field: 'QUEUE',
        destinationField: 'QUEUE',
        audio: '',
        branch: 'QUEUE',
        label: 'Mise en relation avec l’équipe',
        phase: 'distribution',
        conditional: true,
        derivedFrom: 'QUEUE',
        externalReference: true,
        referenceVerified: false,
      });
    for (const field of Object.keys(row).filter(
      (key) => /^INQUEUE_MENU_[1-4]$|^INQUEUE_REPEAT_MENU$/.test(key) && nonempty(row[key]),
    )) {
      const sequence = field.match(/_([1-4])$/)?.[1];
      references.push({
        ...targetParts('menu', ''),
        target: text(row[field]),
        rawTarget: text(row[field]),
        field,
        destinationField: field,
        audio: '',
        branch: field,
        label: sequence
          ? `Menu pendant l’attente · séquence ${sequence}`
          : 'Menu de répétition de l’attente',
        phase: 'waiting',
        conditional: true,
        condition: sequence ? `Séquence ${sequence} exécutée` : 'Répétition du cycle d’attente',
      });
    }
  }
  return references;
}
function flowCategory(entry) {
  if (/\[DRAFT_FROM_/i.test(text(entry.DESCRIPTION))) return 'draft';
  if (/\[[^\]]+\]/.test(text(entry.key)) || /\(template\)/i.test(text(entry.DESCRIPTION)))
    return 'template';
  return 'configured';
}
function embeddedSchedule(row, version, type) {
  if (
    version !== '4' ||
    type !== 'inboundcall' ||
    !['SCHEDULE_GROUP', 'EMERGENCY_GROUP', 'EXCEPTIONAL_DAYS_NAME'].some((field) => own(row, field))
  )
    return null;
  return {
    embedded: true,
    scheduleGroup: text(row.SCHEDULE_GROUP),
    emergencyGroup: text(row.EMERGENCY_GROUP),
    exceptionalDaysName: text(row.EXCEPTIONAL_DAYS_NAME),
    referenceVerified: false,
  };
}

/**
 * Builds only relationships visible in WOLF voice v4/v5 rows. References stay
 * in their entry's version; no v4→v5 fallback or implicit key cleanup occurs.
 * It does not resolve actual queues, schedules, audio assets or permissions.
 */
export function buildVoiceInventory(input) {
  const snapshot = normalizeSnapshot(input);
  const issues = [];
  const named = new Map();
  for (const table of snapshot.tables) {
    const name = table.name.toUpperCase();
    if (!named.has(name)) named.set(name, []);
    named.get(name).push(table);
  }
  const inboundTables = snapshot.tables.filter((table) =>
    /^W_INBOUND_CALL_v[45]$/i.test(table.name),
  );
  const flows = inboundTables.flatMap((table) =>
    table.rows.map((entry) => {
      const version = table.name.match(/_v([45])$/i)[1];
      const typeTables = TYPE_TABLES[version];
      const flowIssues = [],
        nodes = [],
        edges = [],
        visited = new Set();
      const services = [],
        schedules = [],
        menus = [],
        participantData = [];
      const entryNodeId = `${table.id}:${text(entry.key)}`;
      const issue = (code, message, detail = {}) => {
        const result = {
          code,
          severity: 'warning',
          flowId: entryNodeId,
          version,
          message,
          ...detail,
        };
        flowIssues.push(result);
        issues.push(result);
      };
      const lookup = (tableName, target, detail) => {
        const candidates = named.get(tableName.toUpperCase()) || [];
        if (candidates.length !== 1) {
          issue(
            candidates.length ? 'ambiguous-table' : 'missing-table',
            candidates.length
              ? `Plusieurs tables portent le nom ${tableName}.`
              : `Table ${tableName} absente de la source.`,
            { ...detail, tableName },
          );
          return null;
        }
        const targetTable = candidates[0];
        const targetRow = targetTable.rows.find((item) => text(item.key) === target);
        if (!targetRow) {
          const suggestions = targetTable.rows
            .filter((item) => text(item.key).trim() === target.trim())
            .map((item) => text(item.key));
          if (suggestions.length)
            issue(
              'whitespace-key-mismatch',
              `La référence ${JSON.stringify(target)} diffère d’une clé de ${targetTable.name} par ses espaces. Aucune correction automatique.`,
              { ...detail, target, tableName: targetTable.name, suggestions },
            );
          else
            issue('missing-row', `Référence « ${target} » introuvable dans ${targetTable.name}.`, {
              ...detail,
              target,
              tableName: targetTable.name,
            });
          return null;
        }
        return { targetTable, targetRow };
      };
      const visit = (sourceTable, row, type, depth = 0) => {
        const id = `${sourceTable.id}:${text(row.key)}`;
        if (visited.has(id)) return id;
        if (nodes.length >= 250 || depth > 80) {
          issue(
            'traversal-limit',
            'Parcours trop étendu : aperçu limité à 250 étapes et 80 niveaux.',
            { nodeId: id },
          );
          return id;
        }
        visited.add(id);
        const schedule = embeddedSchedule(row, version, type);
        const node = {
          id,
          type,
          version,
          label: own(TYPE_LABELS, type) ? TYPE_LABELS[type] : type,
          name: nonempty(row.DESCRIPTION) ? text(row.DESCRIPTION) : text(row.key),
          key: text(row.key),
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          row,
          ...(sourceTable.schema ? { schema: sourceTable.schema } : {}),
          ...(schedule ? { embeddedSchedule: schedule } : {}),
        };
        nodes.push(node);
        if (type === 'service') services.push(node);
        if (
          type === 'schedulegroup' ||
          (schedule &&
            (schedule.scheduleGroup || schedule.emergencyGroup || schedule.exceptionalDaysName))
        )
          schedules.push(node);
        if (type === 'menu') menus.push(node);
        if (type === 'pdata') participantData.push(node);
        // L'enregistrement est un réglage rattaché à l'étape qui l'appelle, pas une suite de l'appel.
        if (version === '5' && !['pdata', 'recording'].includes(type)) {
          const fields = recordingCallFields(row),
            setting = fields.length ? recordingSetting(snapshot, text(entry.DIVISION)) : null;
          const to = setting?.row
            ? visit(setting.table, setting.row, 'recording', depth + 1)
            : null;
          if (to && visited.has(to))
            for (const field of fields)
              edges.push({
                from: id,
                to,
                type: 'recording',
                target: text(setting.row.key),
                relationship: 'context',
                label: 'Enregistrement de l’appel',
                field,
                destinationField: field,
                rawTarget: text(row[field]),
                resolved: true,
              });
        }
        for (const ref of rowReferences(row, type)) {
          const edge = { from: id, to: null, ...ref, relationship: 'route', resolved: false };
          edges.push(edge);
          // PDATA is context attached to a transition, not the next routing step.
          for (const key of ref.pdataKeys) {
            const contextEdge = {
              from: id,
              to: null,
              type: 'pdata',
              target: key,
              relationship: 'context',
              label: 'Attributs métier',
              field: ref.destinationField,
              destinationField: ref.destinationField,
              rawTarget: ref.rawTarget,
              resolved: false,
            };
            edges.push(contextEdge);
            const found = lookup(`W_PARTICIPANT_DATA_v${version}`, key, {
              nodeId: id,
              field: ref.destinationField,
              relationship: 'context',
            });
            if (found) {
              contextEdge.to = visit(found.targetTable, found.targetRow, 'pdata', depth + 1);
              contextEdge.resolved = visited.has(contextEdge.to);
            }
          }
          if (
            !NO_DESTINATION_TYPES.has(ref.type) &&
            (/^variable$/i.test(ref.target) ||
              /^var:/i.test(ref.target) ||
              /\$var:[^$]+\$/i.test(ref.target))
          ) {
            edge.dynamic = true;
            issue(
              'dynamic-target',
              `La destination « ${ref.target} » est déterminée à l’exécution ; sa résolution nécessite le contexte de l’interaction.`,
              { nodeId: id, field: ref.destinationField, target: ref.target, severity: 'info' },
            );
            continue;
          }
          if (TERMINAL_TYPES.has(ref.type)) {
            if (!nonempty(ref.target) && !NO_DESTINATION_TYPES.has(ref.type))
              issue('missing-target', `Destination absente pour « ${ref.label} » (${ref.type}).`, {
                nodeId: id,
                field: ref.destinationField,
              });
            else {
              edge.resolved = true;
              edge.terminal = true;
              if (!NO_DESTINATION_TYPES.has(ref.type)) {
                edge.externalReference = true;
                edge.referenceVerified = false;
              }
            }
            continue;
          }
          if (!nonempty(ref.target)) {
            issue('missing-target', `Destination absente pour « ${ref.label} ».`, {
              nodeId: id,
              field: ref.destinationField,
            });
            continue;
          }
          const reportCallbackDependency = () =>
            issue(
              'external-flow',
              `Le rappel dépend du flow de rappel WOLF v${version} ; sa disponibilité n’est pas vérifiable dans cet export.`,
              { nodeId: id, field: ref.field },
            );
          if (ref.type === 'callback' && version === '4') {
            reportCallbackDependency();
            continue;
          }
          const targetTableName = own(typeTables, ref.type) ? typeTables[ref.type] : undefined;
          if (!targetTableName) {
            issue(
              'unsupported-target-type',
              `Type « ${ref.type} » non interprété par l’aperçu WOLF v${version}.`,
              { nodeId: id, field: ref.field },
            );
            continue;
          }
          const found = lookup(targetTableName, ref.target, {
            nodeId: id,
            field: ref.destinationField,
            ...(ref.type === 'transfercallflow' && version === '5'
              ? {
                  runtimeKeyNote:
                    'La clé du transfert est suffixée par la version WOLF à l’exécution.',
                }
              : {}),
          });
          if (!found) continue;
          if (ref.type === 'callback') reportCallbackDependency();
          const nodeType =
            ref.type === 'standardcallflow'
              ? 'inboundcall'
              : ref.type === 'customcallflow'
                ? 'transfercallflow'
                : ref.type;
          edge.to = visit(found.targetTable, found.targetRow, nodeType, depth + 1);
          edge.resolved = visited.has(edge.to);
        }
        return id;
      };
      visit(table, entry, 'inboundcall');
      const divisions = [...new Set(nodes.map((node) => text(node.row.DIVISION)).filter(Boolean))];
      if (divisions.length > 1)
        issue(
          'cross-division-reference',
          `Ce parcours référence plusieurs divisions : ${divisions.join(', ')}.`,
          { divisions },
        );
      const category = flowCategory(entry);
      return {
        id: entryNodeId,
        key: text(entry.key),
        dnis: text(entry.DNIS_SEGMENT ?? entry.key),
        name: nonempty(entry.DESCRIPTION) ? text(entry.DESCRIPTION) : text(entry.key),
        description: text(entry.DESCRIPTION),
        division: text(entry.DIVISION),
        language: text(entry.LANGUAGE),
        welcomeAudio: text(entry.WELCOME_AUDIO),
        media: 'voice',
        version,
        category,
        categoryLabel:
          category === 'template' ? 'Modèle' : category === 'draft' ? 'Brouillon' : 'Configuré',
        sourceTableId: table.id,
        sourceTableName: table.name,
        sourceRow: entry,
        entrySchedule: embeddedSchedule(entry, version, 'inboundcall'),
        nodes,
        edges,
        services,
        schedules,
        menus,
        participantData,
        issues: flowIssues,
        status: flowIssues.length ? 'À vérifier' : 'Références résolues',
      };
    }),
  );
  if (!inboundTables.length)
    issues.push({
      code: 'missing-inbound-table',
      severity: 'info',
      message:
        snapshot.source?.wolfVersion === '5'
          ? 'Importez W_INBOUND_CALL_v5 pour découvrir les parcours voix V5.'
          : 'Importez W_INBOUND_CALL_v4 ou W_INBOUND_CALL_v5 pour découvrir les parcours voix.',
    });
  return deepFreeze({
    flows,
    issues,
    counts: {
      tables: snapshot.tables.length,
      rows: snapshot.tables.reduce((sum, table) => sum + table.rows.length, 0),
      flows: flows.length,
      issues: issues.length,
      templates: flows.filter((flow) => flow.category === 'template').length,
      drafts: flows.filter((flow) => flow.category === 'draft').length,
      configured: flows.filter((flow) => flow.category === 'configured').length,
      versions: {
        4: flows.filter((flow) => flow.version === '4').length,
        5: flows.filter((flow) => flow.version === '5').length,
      },
    },
  });
}

/**
 * GET-only BFF contract (not the Genesys API):
 * /api/datatables → {entities:[{id,name}],pageCount,pageNumber}
 * /api/datatables/:id → {id,name,schema}
 * /api/datatables/:id/rows → {entities:[{key,...}],pageCount,pageNumber}
 * token is an optional short-lived BFF session JWT, never an OAuth client secret.
 */
export async function loadFromApi(baseUrl, token = '', options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Lecture HTTP indisponible.');
  const browserOrigin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
  let base;
  try {
    base = new URL(text(baseUrl).trim() || browserOrigin, browserOrigin);
  } catch {
    throw new Error('Adresse BFF invalide.');
  }
  if (base.username || base.password || base.search || base.hash)
    throw new Error('L’adresse BFF ne doit contenir ni identifiants, ni paramètres, ni fragment.');
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    throw new Error('Utilisez HTTPS pour le BFF (HTTP accepté seulement en local).');
  const apiRoot = base.href.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = async (path) => {
    const response = await fetchImpl(apiRoot + path, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      signal: options.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Accès au BFF refusé. Vérifiez votre session et vos droits de lecture.'
          : `Lecture du BFF impossible (HTTP ${response.status}).`,
      );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Le BFF a retourné une réponse JSON invalide.');
    }
    return payload;
  };
  const pages = async (path) => {
    const result = [];
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      const page = await request(`${path}?pageNumber=${pageNumber}&pageSize=100`);
      if (!object(page) || !Array.isArray(page.entities))
        throw new Error('Format BFF invalide : « entities » est attendu.');
      if (page.pageNumber != null && Number(page.pageNumber) !== pageNumber)
        throw new Error('Pagination BFF incohérente : numéro de page inattendu.');
      result.push(...page.entities);
      const pageCount = Number(page.pageCount);
      if (page.pageCount != null) {
        if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 1000)
          throw new Error('Pagination BFF invalide ou trop volumineuse.');
        if (pageNumber >= pageCount) return result;
      } else if (
        page.total != null &&
        Number.isInteger(Number(page.total)) &&
        Number(page.total) >= 0
      ) {
        if (result.length >= Number(page.total)) return result;
        if (!page.entities.length)
          throw new Error('Pagination BFF interrompue avant la fin des résultats.');
      } else if (typeof page.hasMore === 'boolean') {
        if (!page.hasMore) return result;
        if (!page.entities.length)
          throw new Error('Pagination BFF interrompue avant la fin des résultats.');
      } else if (!page.entities.length || page.entities.length < 100) return result;
      else
        throw new Error(
          'Métadonnées de pagination absentes : impossible de garantir un import complet.',
        );
    }
    throw new Error('Lecture arrêtée : plus de 1 000 pages.');
  };
  const list = await pages('/datatables');
  const tables = [];
  for (const item of list) {
    if (!object(item) || !nonempty(item.id))
      throw new Error('Le BFF a retourné une table sans identifiant.');
    const id = encodeURIComponent(text(item.id));
    const detail = await request(`/datatables/${id}`);
    if (!object(detail) || text(detail.id) !== text(item.id))
      throw new Error('Identité de table incohérente dans le BFF.');
    const rows = await pages(`/datatables/${id}/rows`);
    tables.push({ ...detail, rows });
  }
  return normalizeSnapshot({
    source: { kind: 'bff', url: apiRoot, readOnly: true, loadedAt: new Date().toISOString() },
    tables,
  });
}

/** Unified inventory: engine identity is independent of the channel bindings. */
export function buildJourneyInventory(input) {
  const snapshot = normalizeSnapshot(input);
  const voice = buildVoiceInventory(snapshot);
  const messaging = buildMessagingFlows(snapshot, targetParts);
  if (!messaging.length) return voice;
  const flows = [...voice.flows, ...messaging];
  const issues = [
    ...voice.issues.filter((i) => i.code !== 'missing-inbound-table'),
    ...messaging.flatMap((f) => f.issues),
  ];
  return deepFreeze({
    flows,
    issues,
    counts: {
      ...voice.counts,
      flows: flows.length,
      issues: issues.length,
      configured: voice.counts.configured + messaging.length,
      media: { voice: voice.flows.length, messaging: messaging.length },
    },
  });
}
