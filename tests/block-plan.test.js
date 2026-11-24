import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { compareFlows } from '../src/business.js';
import { blockCandidates, prepareBlockPlan } from '../src/block-plan.js';

function fixture() {
  const snapshot = normalizeSnapshot({
    tables: [
      {
        id: 'in',
        name: 'W_INBOUND_CALL_v5',
        rows: [
          { key: 'L', NEXT_TARGET_TYPE: 'schedulegroup', NEXT_TARGET: 'LS' },
          { key: 'R', NEXT_TARGET_TYPE: 'schedulegroup', NEXT_TARGET: 'RS' },
        ],
      },
      {
        id: 'hours',
        name: 'W_SCHEDULE_GROUP_v5',
        rows: [
          {
            key: 'LS',
            DESCRIPTION: 'Horaires source',
            OPEN_TARGET_TYPE: 'service',
            OPEN_TARGET: 'LA|pdata:OFF',
            EMERGENCY_TARGET_TYPE: 'service',
            EMERGENCY_TARGET: 'LB|pdata:ON',
          },
          {
            key: 'RS',
            DESCRIPTION: 'Horaires cible',
            OPEN_TARGET_TYPE: 'service',
            OPEN_TARGET: 'RA',
            EMERGENCY_TARGET_TYPE: 'service',
            EMERGENCY_TARGET: 'RB',
          },
        ],
      },
      {
        id: 'teams',
        name: 'W_SERVICES_v5',
        rows: ['LA', 'LB', 'RA', 'RB'].map((key) => ({ key, DESCRIPTION: key, PRIORITY: '3' })),
      },
      {
        id: 'data',
        name: 'W_PARTICIPANT_DATA_v5',
        rows: [
          { key: 'ON', PDATA_LIST_1: 'CRISE==ACTIF' },
          { key: 'OFF', PDATA_LIST_1: 'CRISE==NON_ACTIF' },
        ],
      },
    ],
  });
  const [left, right] = buildVoiceInventory(snapshot).flows;
  const diff = compareFlows(left, right);
  return { snapshot, left, right, diff };
}
function selection(input, id, field) {
  const candidate = blockCandidates(input).find((candidate) => candidate.id === id);
  const placement = candidate.options.placements.find(
    (option) => option.fromId === 'hours:RS' && option.field === field,
  );
  assert.ok(placement);
  return { mode: 'insert', placementId: placement.id, connections: {} };
}

test('candidates distinguish absent and ambiguous nodes and never offer matched source nodes', () => {
  const input = fixture();
  assert.deepEqual(
    new Set(blockCandidates(input).map((candidate) => candidate.id)),
    new Set(['data:OFF', 'data:ON']),
  );
  const candidate = blockCandidates(input)[0];
  assert.equal(candidate.status, 'absent');
  assert.equal(candidate.ambiguous, false);
  assert.equal(candidate.options.kind, 'context');
  const special = {
    ...input,
    diff: {
      matches: [{ leftNode: input.left.nodes[0], rightNode: input.right.nodes[0] }],
      unmatched: [{ side: 'left', node: input.left.nodes[0] }],
      ambiguous: [{ leftNodes: [candidate.sourceNode] }],
    },
  };
  assert.deepEqual(
    blockCandidates(special).map((item) => [item.id, item.status, item.ambiguous]),
    [[candidate.id, 'ambiguous', true]],
  );
});

test('two insertions on distinct fields merge parent updates and preserve its initial baseline', () => {
  const input = fixture(),
    before = structuredClone(input.snapshot);
  const decisions = {
    'data:ON': selection(input, 'data:ON', 'EMERGENCY_TARGET_TYPE'),
    'data:OFF': selection(input, 'data:OFF', 'OPEN_TARGET_TYPE'),
  };
  const plan = prepareBlockPlan({ ...input, decisions, prefix: 'TEST' });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.createdRows.length, 2);
  assert.equal(plan.updatedRows.length, 1);
  assert.equal(plan.updatedRows[0].node.row.OPEN_TARGET, 'RA');
  assert.equal(plan.updatedRows[0].node.row.EMERGENCY_TARGET, 'RB');
  assert.match(plan.updatedRows[0].row.OPEN_TARGET, /^RA\|pdata:DRAFT_TEST_1__/);
  assert.match(plan.updatedRows[0].row.EMERGENCY_TARGET, /^RB\|pdata:DRAFT_TEST_2__/);
  assert.equal(Object.keys(plan.plans).length, 2);
  assert.deepEqual(
    plan.summaries.map((summary) => summary.sourceNodeId),
    ['data:OFF', 'data:ON'],
  );
  assert.deepEqual(input.snapshot, before);
  assert.deepEqual(prepareBlockPlan({ ...input, decisions, prefix: 'TEST' }), plan);
  const target = buildVoiceInventory(plan.snapshot).flows.find(
    (flow) => flow.id === input.right.id,
  );
  assert.equal(target.participantData.length, 2);
});

test('two selected blocks at the same initial placement reject the whole batch', () => {
  const input = fixture();
  const decisions = {
    'data:ON': selection(input, 'data:ON', 'EMERGENCY_TARGET_TYPE'),
    'data:OFF': selection(input, 'data:OFF', 'EMERGENCY_TARGET_TYPE'),
  };
  const result = prepareBlockPlan({ ...input, decisions });
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.createdRows, []);
  assert.deepEqual(result.updatedRows, []);
  assert.deepEqual(result.summaries, []);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => /même point/.test(error.message)));
});

test('a later engine error discards all aggregate additions and patches from earlier successful insertions', () => {
  const input = fixture();
  const decisions = {
    'data:OFF': selection(input, 'data:OFF', 'OPEN_TARGET_TYPE'),
    'data:ON': {
      ...selection(input, 'data:ON', 'EMERGENCY_TARGET_TYPE'),
      connections: { absent: { mode: 'resume' } },
    },
  };
  const result = prepareBlockPlan({ ...input, decisions });
  assert.equal(result.errors[0].id, 'data:ON');
  assert.equal(result.plans['data:OFF'].errors.length, 0);
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.createdRows, []);
  assert.deepEqual(result.updatedRows, []);
  assert.deepEqual(result.summaries, []);
  assert.equal(input.snapshot.tables.find((table) => table.id === 'data').rows.length, 2);
});

test('ignored and undecided candidates cause no insertion while orphan decisions fail explicitly', () => {
  const input = fixture();
  const plan = prepareBlockPlan({ ...input, decisions: { 'data:ON': { mode: 'ignore' } } });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.snapshot, input.snapshot);
  assert.deepEqual(plan.createdRows, []);
  assert.deepEqual(plan.updatedRows, []);
  assert.deepEqual(plan.plans, {});
  const stale = prepareBlockPlan({
    ...input,
    decisions: { 'data:gone': { mode: 'insert', placementId: 'irrelevant' } },
  });
  assert.equal(stale.errors[0].sourceNodeId, 'data:gone');
  assert.match(stale.errors[0].message, /ne fait plus partie/);
  assert.equal(stale.snapshot, null);
});
