import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectJourney, qualityView } from '../src/journey-quality.js';
test('quality checks classify real reference failures and invalid data without rejecting dynamic context', () => {
  const node = {
    id: 't:x',
    key: 'x',
    tableId: 't',
    tableName: 'W_SERVICES_v5',
    type: 'service',
    row: { key: 'x', DESCRIPTION: '<Équipe>', PRIORITY: -1 },
  };
  const flow = {
    id: 't:x',
    name: '<Test>',
    nodes: [node],
    edges: [
      { from: node.id, resolved: false, field: 'NEXT_TARGET_TYPE', target: 'missing' },
      {
        from: node.id,
        resolved: false,
        dynamic: true,
        field: 'QUEUE',
        target: 'variable',
        type: 'queue',
      },
    ],
  };
  const snapshot = {
    tables: [
      {
        id: 't',
        schema: {
          properties: { key: { type: 'string' }, PRIORITY: { type: 'integer', minimum: 0 } },
        },
      },
    ],
  };
  const result = inspectJourney(flow, snapshot);
  assert.equal(result.errors, 2);
  assert.equal(result.findings.filter((f) => f.level === 'info').length, 1);
  assert.match(qualityView(flow, result), /&lt;Test&gt;/);
});
