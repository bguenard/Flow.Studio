import { normalizeSnapshot, buildVoiceInventory } from './data-source.js';
import { workingInventory } from './working-inventory.js';
import { nodeTitle } from './business.js';

/** Commit a reviewed design to drafts atomically; never replace a live baseline. */
export function applyDesignerDraft({
  snapshot,
  drafts = new Map(),
  pendingFields = new Map(),
  plan,
}) {
  if (!plan?.ok || plan.errors?.length)
    throw Error('Vérifiez les raccordements avant d’appliquer le plan.');
  if (pendingFields.size)
    throw Error('Enregistrez les réglages en cours avant de modifier la structure.');
  const next = structuredClone(normalizeSnapshot(snapshot)),
    nextDrafts = new Map(drafts);
  for (const addition of plan.createdRows) {
    const table = next.tables.find((t) => t.id === addition.tableId);
    if (!table || table.rows.some((row) => String(row.key) === String(addition.row.key)))
      throw Error('Une clé créée existe déjà ou sa table n’est plus disponible.');
    table.rows.push(structuredClone(addition.row));
  }
  for (const { node, row } of plan.updatedRows) {
    const original = next.tables
      .find((t) => t.id === node.tableId)
      ?.rows.find((r) => String(r.key) === String(node.key));
    if (
      !original ||
      row.key !== original.key ||
      JSON.stringify(drafts.get(node.id)?.row || original) !== JSON.stringify(node.row)
    )
      throw Error('Le raccordement d’origine a changé.');
    if (JSON.stringify(original) === JSON.stringify(row)) nextDrafts.delete(node.id);
    else
      nextDrafts.set(node.id, {
        nodeId: node.id,
        tableId: node.tableId,
        table: node.tableName,
        key: node.key,
        original: structuredClone(original),
        row: structuredClone(row),
        label: nodeTitle(node),
      });
  }
  const inventory = buildVoiceInventory(next),
    effective = workingInventory(next, nextDrafts);
  const flow = effective.flows.find((f) => f.id === plan.flowId);
  if (!flow || !flow.nodes.some((n) => n.id === plan.nodeId))
    throw Error('Le résultat n’est plus accessible depuis l’entrée du parcours.');
  return { snapshot: normalizeSnapshot(next), drafts: nextDrafts, inventory, flow };
}
