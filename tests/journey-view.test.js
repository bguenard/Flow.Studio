import test from 'node:test';
import assert from 'node:assert/strict';
import { stepList, journeyNavigation, stepRelations } from '../src/journey-view.js';

function fixture() {
  return { id: 'entry', nodes: [
    { id: 'context', key: 'CTX_CLIENT_V5', type: 'pdata', label: 'Informations client', tableName: 'W_PARTICIPANT_DATA_v5', row: { DESCRIPTION: 'Informations du client' } },
    { id: 'decision', key: 'DECISION_CR350_V5', type: 'decision', label: 'Règle d’orientation', tableName: 'W_DECISION_v5', row: { DESCRIPTION: 'CRISE==|ACTIF', DECISION_TYPE: 'expression', DECISION_TARGET: 'CRISE|==|ACTIF' } },
    { id: 'entry', key: '+33123456789', type: 'inboundcall', label: 'Accueil téléphonique', tableName: 'W_INBOUND_CALL_v5', row: { DESCRIPTION: 'Accueil des sociétaires' } },
  ], edges: [
    { from: 'entry', to: 'decision', type: 'decision', branch: 'NEXT', relationship: 'route', resolved: true },
    { from: 'entry', to: 'context', type: 'pdata', branch: 'NEXT', relationship: 'context', resolved: true },
    { from: 'decision', to: 'entry', type: 'inboundcall', branch: 'FALSE', relationship: 'route', resolved: true },
  ] };
}

test('business navigation counts actual route steps and administration retains context access and original indices', () => {
  const flow = fixture(), original = structuredClone(flow);
  const business = journeyNavigation(flow, { selectedId: 'decision', hasDraft: id => id === 'decision' });
  const admin = journeyNavigation(flow, { audience: 'admin', selectedId: 'decision' });
  assert.ok(business.includes('2 étapes dans ce parcours'));
  assert.ok(admin.includes('2 étapes dans ce parcours'));
  assert.deepEqual([...business.matchAll(/data-node="(\d+)"/g)].map(match => match[1]), ['2', '1']);
  assert.deepEqual([...admin.matchAll(/data-node="(\d+)"/g)].map(match => match[1]), ['2', '1', '0']);
  assert.ok(business.includes('Brouillon'));
  assert.ok(admin.includes('Informations rattachées aux étapes'));
  assert.ok(admin.includes('CTX_CLIENT_V5'));
  assert.ok(!business.includes('CTX_CLIENT_V5'));
  assert.deepEqual(flow, original);
});

test('navigation uses readable decision summaries for business and source identifiers for administration', () => {
  const flow = fixture(), business = stepList(flow), admin = stepList(flow, { audience: 'admin' });
  assert.ok(business.includes('Decision CR350'));
  assert.ok(business.includes('Crise est égal à Actif'));
  for (const raw of ['CRISE==|ACTIF', 'DECISION_CR350_V5', 'W_DECISION_v5']) assert.ok(!business.includes(raw));
  assert.ok(admin.includes('DECISION_CR350_V5'));
  assert.ok(admin.includes('W_DECISION_v5'));
  assert.ok(stepList(flow, { query: 'Crise est égal' }).includes('data-node="1"'));
  assert.ok(!stepList(flow, { query: 'Crise est égal' }).includes('data-node="2"'));
});

test('business relation titles preserve the same routing targets while context links remain available in administration', () => {
  const flow = fixture();
  const business = stepRelations(flow, 'entry', 'outgoing');
  const admin = stepRelations(flow, 'entry', 'outgoing', { audience: 'admin' });
  assert.ok(business.includes('data-node="1"'));
  assert.ok(admin.includes('data-node="1"'));
  assert.ok(business.includes('Decision CR350'));
  assert.ok(!business.includes('CRISE==|ACTIF'));
  assert.ok(admin.includes('DECISION_CR350_V5'));
  assert.equal(stepRelations(flow, 'entry', 'contexts'), '');
  assert.ok(stepRelations(flow, 'entry', 'contexts', { audience: 'admin' }).includes('data-node="0"'));
  assert.ok(stepRelations(flow, 'context', 'usedBy', { audience: 'admin' }).includes('data-node="2"'));
});
