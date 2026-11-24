import { normalizeSnapshot, buildJourneyInventory } from './data-source.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Apply complete draft rows to a fresh local snapshot. Row identity is immutable;
 * creating a journey must first append its rows to the source snapshot.
 * No input, draft row or source row is mutated or frozen as a side effect.
 */
export function applyDraftRows(input, drafts = new Map()) {
  if (!(drafts instanceof Map))
    throw new Error('Les brouillons doivent être indexés par identifiant d’étape.');
  const snapshot = normalizeSnapshot(input);
  const tables = new Map(snapshot.tables.map((table) => [table.id, table]));
  const replacements = new Map();
  for (const [id, draft] of drafts) {
    if (!object(draft) || !object(draft.row) || !own(draft, 'tableId') || !own(draft, 'key'))
      throw new Error('Un brouillon doit contenir sa table, sa clé et sa ligne complète.');
    const table = tables.get(draft.tableId);
    if (!table) throw new Error('La table d’un brouillon est absente de la source courante.');
    const key = String(draft.key);
    const expectedId = `${table.id}:${key}`;
    if (id !== expectedId || (draft.nodeId !== undefined && draft.nodeId !== expectedId))
      throw new Error('L’identifiant d’un brouillon ne correspond pas à sa table et à sa clé.');
    const original = table.rows.find((row) => String(row.key) === key);
    if (!original) throw new Error('La ligne d’un brouillon est absente de la source courante.');
    if (!own(draft.row, 'key') || !Object.is(draft.row.key, original.key))
      throw new Error('Un brouillon ne peut pas changer la clé de sa ligne.');
    replacements.set(expectedId, draft.row);
  }
  if (!replacements.size) return snapshot;
  return normalizeSnapshot({
    ...snapshot,
    tables: snapshot.tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => replacements.get(`${table.id}:${String(row.key)}`) || row),
    })),
  });
}

/** Rebuild all derived nodes, branches, resources and issues from draft values. */
export function workingInventory(snapshot, drafts = new Map()) {
  return buildJourneyInventory(applyDraftRows(snapshot, drafts));
}

/** Local display names never change immutable WOLF rows or the source inventory. */
export function withNodeTitles(inventory, titles = new Map()) {
  if (!titles.size) return inventory;
  const display = structuredClone(inventory);
  for (const flow of display.flows)
    for (const node of flow.nodes) {
      if (titles.has(node.id)) node.name = titles.get(node.id);
    }
  return display;
}
