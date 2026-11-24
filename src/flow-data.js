import {
  FLOW_INITIALIZATION,
  validateFlowInitializationTable,
  initializationAttributes,
  createFlowInitializationRow,
} from './flow-initialization.js';
import {
  PARTICIPANT_CATALOGUE,
  catalogueDefinition,
  validateParticipantValue,
} from './participant-catalogue.js';
/** Flow-entry participant data plans. No network writes; source rows remain immutable. */
import { normalizeSnapshot, buildVoiceInventory } from './data-source.js';
import { validatePublicationRow, stable } from './publication.js';
const text = (v) => String(v ?? '');
import {
  parseAssignments,
  participantIdentity as identity,
  participantAssignments as assignments,
} from './participant-names.js';
export { parseAssignments } from './participant-names.js';
const slots = (row) =>
  Object.keys(row || {})
    .filter((k) => /^PDATA_LIST_[1-5]$/.test(k))
    .sort();
const keys = (target) =>
  text(target)
    .split('|')
    .slice(1)
    .filter((p) => /^pdata:/i.test(p))
    .flatMap((p) => p.slice(6).split(';'))
    .filter(Boolean);
const tableOf = (snapshot) => {
  const ts = snapshot.tables.filter((t) => /^W_PARTICIPANT_DATA_v5$/i.test(t.name));
  if (ts.length !== 1) throw Error('Une seule table W_PARTICIPANT_DATA_v5 doit être disponible.');
  return ts[0];
};
export function participantOptions(snapshot) {
  const map = new Map();
  const add = (name, value, source) => {
    if (!name) return;
    if (!map.has(name)) map.set(name, { name, values: [], sources: [] });
    const item = map.get(name);
    if (value !== undefined && !item.values.includes(value)) item.values.push(value);
    if (!item.sources.includes(source)) item.sources.push(source);
  };
  for (const table of snapshot?.tables || []) {
    if (table.name === PARTICIPANT_CATALOGUE)
      for (const row of table.rows) {
        add(row.key, row.DEFAULT_VALUE, 'catalogue');
        Object.assign(map.get(row.key), {
          label: row.LABEL,
          division: row.DIVISION,
          divisionId: row.DIVISION_ID,
          type: row.VALUE_TYPE,
          catalogued: true,
          definition: row,
          defaultValue: row.DEFAULT_VALUE,
        });
      }
    if (/^W_PARTICIPANT_DATA_v5$/i.test(table.name))
      for (const row of table.rows)
        for (const slot of slots(row)) {
          try {
            for (const item of parseAssignments(row[slot]))
              add(item.name, item.value, 'configuration');
          } catch {
            /* Invalid rows remain available in Administration, not guessed here. */
          }
        }
    if (/^W_DECISION_v5$/i.test(table.name))
      for (const row of table.rows)
        add(text(row.PARTICIPANT_DATA_TO_CHECK), undefined, 'condition');
  }
  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }),
  );
}
export function flowDataModel(input, flowId) {
  const snapshot = normalizeSnapshot(input),
    flow = buildVoiceInventory(snapshot).flows.find((f) => f.id === flowId);
  if (!flow || flow.version !== '5') throw Error('Choisissez un parcours voix V5.');
  const entry = flow.nodes.find((n) => n.id === flow.id),
    dedicated = snapshot.tables.find((t) => t.name === FLOW_INITIALIZATION);
  if (dedicated) {
    validateFlowInitializationTable(dedicated);
    const row = dedicated.rows.find((r) => r.key === entry.key) || null;
    const items = initializationAttributes(row).map((item) => ({
      ...item,
      id: 'slot:' + item.slot,
      dynamic: false,
    }));
    const catalogue = snapshot.tables.find((t) => t.name === PARTICIPANT_CATALOGUE),
      used = [
        ...new Set(
          flow.nodes
            .filter((n) => n.type === 'decision')
            .map((n) => text(n.row.PARTICIPANT_DATA_TO_CHECK))
            .filter(Boolean),
        ),
      ];
    return {
      flowId,
      entry,
      table: dedicated,
      row,
      dedicated: true,
      catalogue,
      catalogueRequired: true,
      groups: [],
      items,
      used,
      options: participantOptions(snapshot),
      signature: stable({ entry: entry.row, row, schema: dedicated.schema, catalogue }),
      runtime: used.filter((n) => !items.some((i) => i.name === n)),
    };
  }
  const table = tableOf(snapshot);
  if (!entry?.schema?.properties?.NEXT_TARGET || !entry.schema.properties.NEXT_TARGET_TYPE)
    throw Error('Le schéma de la première transition doit être disponible.');
  if (!text(entry.row.NEXT_TARGET_TYPE))
    throw Error('Configurez la première étape avant les données du parcours.');
  const groups = keys(entry.row.NEXT_TARGET).map((key) => {
    const row = table.rows.find((r) => text(r.key) === key);
    if (!row) throw Error(`La configuration d’entrée « ${key} » est introuvable.`);
    return { key, row };
  });
  const items = groups.flatMap((group, g) =>
    slots(group.row).flatMap((field) =>
      parseAssignments(group.row[field]).map((a, index) => ({
        ...a,
        id: `${g}:${field}:${index}`,
        group: g,
        field,
        index,
        dynamic: /\$var:/i.test(a.value),
      })),
    ),
  );
  const initialized = new Set(items.map((i) => i.name));
  const used = [
    ...new Set(
      flow.nodes
        .filter((n) => n.type === 'decision')
        .map((n) => text(n.row.PARTICIPANT_DATA_TO_CHECK))
        .filter(Boolean),
    ),
  ];
  const catalogue = snapshot.tables.find((t) => t.name === PARTICIPANT_CATALOGUE);
  return {
    flowId,
    entry,
    table,
    catalogue,
    catalogueRequired: Boolean(catalogue || snapshot.source.participantCatalogueRequired),
    groups,
    items,
    used,
    options: participantOptions(snapshot),
    signature: stable({
      entry: entry.row,
      groups: groups.map((g) => g.row),
      schema: table.schema,
      catalogue: catalogue ? { schema: catalogue.schema, rows: catalogue.rows } : null,
    }),
    runtime: used.filter((n) => !initialized.has(n)),
  };
}
function uniqueKey(table, entry) {
  const stem = 'STUDIO_INIT_' + text(entry.key).replace(/[^\w]/g, '_');
  let n = 1,
    key = stem;
  while (table.rows.some((r) => text(r.key) === key)) key = stem + '_' + ++n;
  return key;
}
function mapping(table, row) {
  return {
    nodeId: `${table.id}:${row.key}`,
    tableId: table.id,
    tableName: table.name,
    key: row.key,
    oldKey: row.key,
    title: row.DESCRIPTION || row.key,
  };
}
function validateValue(name, value) {
  if (
    !name ||
    name !== name.trim() ||
    /[|;=\r\n]/.test(name) ||
    /^(?:variable$|var:)|\$var:/i.test(name)
  )
    throw Error('Le nom de l’attribut doit être renseigné, sans séparateur WOLF.');
  if (/\|\||==/.test(value) || /[\r\n]/.test(value))
    throw Error(`${name} : les séparateurs ||, == et les retours à la ligne ne sont pas acceptés.`);
}
/** Existing shared groups are forked; unrelated fields and suffixes are retained exactly. */
export function prepareFlowData({
  snapshot: input,
  flowId,
  signature,
  values = {},
  additions = [],
  divisions = [],
}) {
  const snapshot = normalizeSnapshot(input),
    model = flowDataModel(snapshot, flowId),
    { entry, table, groups } = model;
  if (signature !== model.signature)
    throw Error('Les données ont changé. Rouvrez cet écran avant de les modifier.');
  if (model.dedicated) {
    const attributes = model.items.map((item) => ({
      name: item.name,
      value: Object.hasOwn(values, item.id) ? text(values[item.id]) : item.value,
    }));
    attributes.push(...additions.map((a) => ({ name: text(a.name), value: text(a.value) })));
    const row = createFlowInitializationRow(
      {
        key: entry.key,
        description: entry.row.DESCRIPTION || '',
        division: entry.row.DIVISION || '',
        attributes,
      },
      snapshot,
    );
    const changed = !model.row || Object.keys(row).some((k) => row[k] !== text(model.row[k]));
    const m = { ...mapping(table, row), initialization: true };
    const createdRows = changed && !model.row ? [{ tableId: table.id, nodeId: m.nodeId, row }] : [];
    const updatedRows =
      changed && model.row
        ? [
            {
              node: {
                id: m.nodeId,
                tableId: table.id,
                tableName: table.name,
                key: row.key,
                row: model.row,
              },
              row,
            },
          ]
        : [];
    const mappings = createdRows.length ? [m] : [];
    return {
      ok: true,
      errors: [],
      flowId,
      nodeId: entry.id,
      createdRows,
      updatedRows,
      mappings,
      summary: {
        kind: 'flow-data',
        title: 'Données du parcours',
        targetFlowId: flowId,
        nodeCount: createdRows.length,
        mappings,
        notices: [],
        localOnly: true,
      },
    };
  }
  if (snapshot.source.flowInitializationRequired)
    throw Error('Créez la table dédiée avant de modifier les valeurs d’entrée.');
  const createdRows = [],
    updatedRows = [],
    notices = [],
    replacements = new Map(),
    nextTable = structuredClone(table);
  const uses = (key) =>
    snapshot.tables.flatMap((t) =>
      t.rows.flatMap((row) =>
        Object.entries(row)
          .filter(([field, value]) => /TARGET(?:_\d+)?$/.test(field) && keys(value).includes(key))
          .map(([field]) => `${t.id}:${row.key}:${field}`),
      ),
    );
  const changed = new Map();
  for (const item of model.items) {
    if (!Object.hasOwn(values, item.id) || text(values[item.id]) === item.value) continue;
    if (item.dynamic)
      throw Error('Une valeur calculée doit être modifiée dans les réglages avancés.');
    validateValue(item.name, text(values[item.id]));
    const definition = catalogueDefinition(snapshot, item.name);
    if (definition) validateParticipantValue(definition, text(values[item.id]));
    else if (model.catalogueRequired)
      throw Error(
        `« ${item.name} » doit être référencé dans le catalogue administrateur avant de modifier sa valeur.`,
      );
    if (!changed.has(item.group)) changed.set(item.group, structuredClone(groups[item.group].row));
    const row = changed.get(item.group),
      pairs = parseAssignments(row[item.field]);
    pairs[item.index].value = text(values[item.id]);
    row[item.field] = pairs.map((p) => `${p.name}==${p.value}`).join('||');
  }
  // A repeated group is ambiguous for editing; avoid producing different copies for one key.
  if (new Set(groups.map((g) => g.key)).size !== groups.length && changed.size)
    throw Error(
      'Une configuration est appliquée plusieurs fois à l’entrée. Corrigez ce rattachement avant de la modifier.',
    );
  for (const [g, row] of changed) {
    const group = groups[g];
    if (uses(group.key).some((use) => use !== `${entry.id}:NEXT_TARGET`)) {
      row.key = uniqueKey(nextTable, entry);
      if (Object.hasOwn(row, 'PDATA_NAME')) row.PDATA_NAME = row.key;
      if (Object.hasOwn(row, 'DESCRIPTION'))
        row.DESCRIPTION = `Données d’entrée · ${entry.row.DESCRIPTION || entry.key}`;
      if (Object.hasOwn(row, 'DIVISION')) row.DIVISION = entry.row.DIVISION;
      validatePublicationRow(row, table.schema);
      nextTable.rows.push(row);
      replacements.set(group.key, row.key);
      createdRows.push({
        tableId: table.id,
        nodeId: `${table.id}:${row.key}`,
        row,
        participantSource: { tableId: table.id, key: group.key, row: structuredClone(group.row) },
      });
      notices.push(`La configuration partagée « ${group.key} » sera copiée pour ce parcours.`);
    } else {
      validatePublicationRow(
        row,
        table.schema,
        Object.keys(row).filter((k) => stable(row[k]) !== stable(group.row[k])),
      );
      updatedRows.push({
        node: {
          id: `${table.id}:${group.key}`,
          tableId: table.id,
          tableName: table.name,
          key: group.key,
          row: group.row,
        },
        row,
      });
    }
  }
  const catalogue = model.catalogue;
  if (additions.length && snapshot.source.participantCatalogueRequired && !catalogue)
    throw Error('Créez ou rechargez le catalogue partagé Genesys avant d’ajouter une donnée.');
  const existingNames = new Set(model.items.map((i) => identity(i.name))),
    newNames = new Set(),
    newKeys = [];
  const knownNames = new Set(model.options.map((o) => identity(o.name)));
  if (additions.length)
    for (const row of table.rows)
      for (const item of assignments(row)) knownNames.add(identity(item.name));
  for (const a of additions) {
    const name = text(a.name),
      value = text(a.value),
      normalized = identity(name),
      definition = catalogueDefinition(snapshot, name),
      reuse = a.selection === name || Boolean(definition);
    if (model.catalogueRequired && !definition)
      throw Error(
        `Choisissez « ${name || 'une donnée'} » dans le catalogue administrateur. Les nouvelles données se créent dans Administration.`,
      );
    if (definition) validateParticipantValue(definition, value);
    validateValue(name, value);
    if (/\$var:/i.test(value))
      throw Error('Utilisez les réglages avancés pour une valeur calculée.');
    if (existingNames.has(normalized) || newNames.has(normalized))
      throw Error(`« ${name} » est déjà initialisé. Modifiez sa valeur existante.`);
    newNames.add(normalized);
    if (!reuse && knownNames.has(normalized))
      throw Error(
        `L’attribut « ${name} » existe déjà. Choisissez-le dans « Utiliser une donnée existante » ou saisissez un autre nom.`,
      );
    // Reuse never silently creates a second definition or changes another flow's values.
    if (reuse) {
      if (!model.options.some((o) => o.name === name))
        throw Error(`L’attribut « ${name} » n’est plus disponible. Rouvrez cet écran.`);
      const definitions = nextTable.rows
        .flatMap((row) => {
          try {
            return [{ row, items: assignments(row) }];
          } catch {
            return [];
          }
        })
        .filter((d) => d.items.some((i) => identity(i.name) === normalized));
      if (definitions.length) {
        const matching = definitions.find(
          (d) => d.items.length === 1 && d.items[0].name === name && d.items[0].value === value,
        );
        if (matching) {
          newKeys.push(text(matching.row.key));
          notices.push(
            `La configuration existante « ${matching.row.key} » sera réutilisée sans modification.`,
          );
          continue;
        }
        notices.push(
          `La valeur de « ${name} » sera définie pour ce parcours, sans modifier les configurations existantes.`,
        );
      }
    }
    // Keys, aliases and names share the same namespace for new definitions.
    const occupied = nextTable.rows.some(
      (r) =>
        identity(r.key) === normalized || (r.PDATA_NAME && identity(r.PDATA_NAME) === normalized),
    );
    if (occupied && !reuse) throw Error(`La clé « ${name} » existe déjà. Choisissez un autre nom.`);
    const row = {};
    for (const [field, rule] of Object.entries(table.schema?.properties || {}))
      if (Object.hasOwn(rule, 'default')) row[field] = structuredClone(rule.default);
    row.key = occupied ? uniqueKey(nextTable, entry) : name;
    if (table.schema.properties.PDATA_NAME) row.PDATA_NAME = row.key;
    if (table.schema.properties.DESCRIPTION) row.DESCRIPTION = definition?.LABEL || name;
    if (table.schema.properties.DIVISION) {
      if (!text(entry.row.DIVISION).trim())
        throw Error('Renseignez la division du parcours avant de créer ses données.');
      row.DIVISION = entry.row.DIVISION;
    }
    const fields = slots(table.schema.properties).filter(
      (f) => !table.schema.properties[f].readOnly,
    );
    if (!fields.length) throw Error('Aucun champ PDATA_LIST modifiable dans la table.');
    fields.forEach((f) => {
      row[f] = '';
    });
    const pair = `${name}==${value}`,
      field = fields.find(
        (f) =>
          table.schema.properties[f].maxLength == null ||
          pair.length <= table.schema.properties[f].maxLength,
      );
    if (!field) throw Error('La valeur dépasse la capacité des champs PDATA disponibles.');
    row[field] = pair;
    validatePublicationRow(row, table.schema);
    nextTable.rows.push(row);
    createdRows.push({
      tableId: table.id,
      nodeId: `${table.id}:${row.key}`,
      row,
      ...(!reuse ? { participantName: name } : {}),
    });
    newKeys.push(row.key);
  }
  const parts = text(entry.row.NEXT_TARGET).split('|');
  for (let i = 1; i < parts.length; i++)
    if (/^pdata:/i.test(parts[i]))
      parts[i] =
        parts[i].slice(0, 6) +
        parts[i]
          .slice(6)
          .split(';')
          .map((k) => replacements.get(k) || k)
          .join(';');
  if (newKeys.length) {
    const i = parts.findIndex((p, i) => i > 0 && /^pdata:/i.test(p));
    if (i >= 0) parts[i] += (parts[i].length > 6 ? ';' : '') + newKeys.join(';');
    else parts.push('pdata:' + newKeys.join(';'));
  }
  const target = parts.join('|');
  if (target !== entry.row.NEXT_TARGET) {
    const row = { ...entry.row, NEXT_TARGET: target };
    validatePublicationRow(row, entry.schema, ['NEXT_TARGET']);
    updatedRows.push({ node: entry, row });
  }
  const mappings = createdRows.map((r) => ({
    ...mapping(r.tableId === catalogue?.id ? catalogue : table, r.row),
    ...(r.participantName ? { participantName: r.participantName } : {}),
    ...(r.participantSource ? { participantSource: structuredClone(r.participantSource) } : {}),
  }));
  return {
    ok: true,
    errors: [],
    flowId,
    nodeId: entry.id,
    createdRows,
    updatedRows,
    mappings,
    summary: {
      kind: 'flow-data',
      title: 'Données du parcours',
      targetFlowId: flowId,
      nodeCount: createdRows.length,
      mappings,
      notices,
      localOnly: true,
    },
  };
}
