/** Local, atomic preparation of selected block insertions. No UI or remote state. */
import { normalizeSnapshot, buildJourneyInventory } from './data-source.js';
import { blockInsertionOptions, prepareBlockInsertion } from './block-insertion.js';

const errorFor = (id, message) => ({ id, sourceNodeId: id, message });
const failedInsertion = (message) => ({
  snapshot: null,
  createdRows: [],
  updatedRows: [],
  summary: null,
  errors: [{ message }],
});
const rejected = (plans, errors) => ({
  snapshot: null,
  createdRows: [],
  updatedRows: [],
  summaries: [],
  plans,
  errors,
});
const rowId = (tableId, row) => `${tableId}:${String(row.key)}`;

/** Only actual, unpaired source nodes are candidates; ambiguous is not absent. */
export function blockCandidates({ snapshot, left, right, diff } = {}) {
  const matched = new Set((diff?.matches || []).map((match) => match.leftNode.id));
  const absent = new Set(
    (diff?.unmatched || [])
      .filter((item) => item.side === 'left')
      .map((item) => item.node?.id)
      .filter(Boolean),
  );
  const ambiguous = new Set(
    (diff?.ambiguous || []).flatMap((item) => (item.leftNodes || []).map((node) => node.id)),
  );
  return (left?.nodes || [])
    .filter((node) => !matched.has(node.id) && (absent.has(node.id) || ambiguous.has(node.id)))
    .map((sourceNode) => ({
      id: sourceNode.id,
      sourceNode,
      status: ambiguous.has(sourceNode.id) ? 'ambiguous' : 'absent',
      ambiguous: ambiguous.has(sourceNode.id),
      options: blockInsertionOptions({ snapshot, left, right, sourceNodeId: sourceNode.id }),
    }));
}

/**
 * decisions: { [sourceNodeId]: { mode:'insert'|'ignore', placementId, connections } }
 * The snapshot already contains any value drafts. Insertions are prepared in
 * source-node order with deterministic prefixes; any failure rejects the batch.
 * Individual plans remain available for explaining the preview and its errors.
 */
export function prepareBlockPlan({
  snapshot,
  left,
  right,
  diff,
  decisions = {},
  prefix = 'BLOC_LOCAL',
} = {}) {
  const plans = {},
    errors = [];
  try {
    const initial = normalizeSnapshot(snapshot);
    const candidates = blockCandidates({ snapshot: initial, left, right, diff });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const entries = decisions instanceof Map ? [...decisions] : Object.entries(decisions || {});
    const decisionsById = new Map(entries),
      placements = new Map();
    for (const [id, decision] of entries) {
      const candidate = byId.get(id);
      let message;
      if (!candidate)
        message =
          'Ce bloc ne fait plus partie des blocs source à examiner. Recalculez la comparaison.';
      else if (!decision || !['insert', 'ignore'].includes(decision.mode))
        message = 'Choisissez Insérer ou Ignorer pour ce bloc.';
      else if (decision.mode === 'ignore') continue;
      else if (!candidate.options.canInsert)
        message = candidate.options.reason || 'Ce bloc ne peut pas être inséré.';
      else if (
        !candidate.options.placements.some((placement) => placement.id === decision.placementId)
      )
        message = 'Choisissez une transition cible disponible pour ce bloc.';
      else if (placements.has(decision.placementId)) {
        message =
          'Deux blocs utilisent le même point d’insertion. Choisissez des transitions distinctes pour éviter un ordre indéterminé.';
        const firstId = placements.get(decision.placementId);
        if (!errors.some((error) => error.id === firstId)) {
          errors.push(errorFor(firstId, message));
          plans[firstId] = failedInsertion(message);
        }
      } else placements.set(decision.placementId, id);
      if (message) {
        errors.push(errorFor(id, message));
        plans[id] = failedInsertion(message);
      }
    }
    if (errors.length) return rejected(plans, errors);

    const initialInventory = buildJourneyInventory(initial);
    const baselineNodes = new Map(
      initialInventory.flows.flatMap((flow) => flow.nodes.map((node) => [node.id, node])),
    );
    const created = new Map(),
      updated = new Map(),
      summaries = [];
    let projected = initial,
      index = 0;
    for (const candidate of candidates) {
      const decision = decisionsById.get(candidate.id);
      if (decision?.mode !== 'insert') continue;
      const inventory = buildJourneyInventory(projected);
      const currentLeft = inventory.flows.find((flow) => flow.id === left?.id);
      const currentRight = inventory.flows.find((flow) => flow.id === right?.id);
      if (!currentLeft || !currentRight) {
        const message = 'Un parcours de la comparaison est absent du résultat préparé.';
        plans[candidate.id] = failedInsertion(message);
        return rejected(plans, [errorFor(candidate.id, message)]);
      }
      const plan = prepareBlockInsertion({
        snapshot: projected,
        left: currentLeft,
        right: currentRight,
        sourceNodeId: candidate.id,
        placementId: decision.placementId,
        connections: decision.connections || {},
        keyPrefix: `${prefix}-${++index}`,
      });
      plans[candidate.id] = plan;
      if (plan.errors.length)
        return rejected(
          plans,
          plan.errors.map((error) => ({ ...error, id: candidate.id, sourceNodeId: candidate.id })),
        );
      projected = plan.snapshot;
      for (const addition of plan.createdRows)
        created.set(addition.nodeId || rowId(addition.tableId, addition.row), addition);
      for (const change of plan.updatedRows) {
        const id = change.node.id;
        if (created.has(id)) created.set(id, { ...created.get(id), row: change.row });
        else
          updated.set(id, {
            ...change,
            node: baselineNodes.get(id) || updated.get(id)?.node || change.node,
          });
      }
      summaries.push({
        ...plan.summary,
        id: candidate.id,
        sourceNodeId: candidate.id,
        createdRowCount: plan.createdRows.length,
      });
    }
    return {
      snapshot: projected,
      createdRows: [...created.values()],
      updatedRows: [...updated.values()],
      summaries,
      plans,
      errors: [],
    };
  } catch (error) {
    return rejected(plans, [errorFor('__batch__', error.message)]);
  }
}
