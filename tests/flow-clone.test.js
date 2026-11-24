import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneFlow } from '../src/flow-clone.js';
import { buildVoiceInventory, normalizeSnapshot } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';

const reference = () => buildVoiceInventory(demoSnapshot).flows.find(flow => flow.category === 'template');
const rowFor = (snapshot, id) => {
  const split = id.indexOf(':');
  const table = snapshot.tables.find(item => item.id === id.slice(0, split));
  return table.rows.find(row => row.key === id.slice(split + 1));
};

test('whole Core Model clone adds five coherent rows while leaving all originals unchanged', () => {
  const before = JSON.stringify(demoSnapshot);
  const result = cloneFlow(demoSnapshot, reference(), { name: 'Agence des Alpes', division: 'DEMO_DIV_ALPES' });
  assert.equal(JSON.stringify(demoSnapshot), before);
  assert.equal(result.summary.nodeCount, 5);
  assert.equal(result.summary.tableCount, 4);
  assert.equal(result.summary.localOnly, true);
  assert.equal(result.summary.needsReview.length, 0);
  const flow = buildVoiceInventory(result.snapshot).flows.find(item => item.id === result.flowId);
  assert.equal(flow.nodes.length, 5);
  assert.equal(flow.issues.length, 0);
  assert.equal(flow.category, 'draft');
  assert.ok(flow.nodes.every(node => node.row.DIVISION === 'DEMO_DIV_ALPES'));
  assert.ok(flow.nodes.every(node => node.key.startsWith('DRAFT_AGENCE_DES_ALPES')));
  for (const table of demoSnapshot.tables) assert.deepEqual(result.snapshot.tables.find(item => item.id === table.id).rows.slice(0, table.rows.length), table.rows);
  assert.equal(result.snapshot.source.localDrafts.at(-1).name, 'Agence des Alpes');
  assert.equal(result.snapshot.source.relationships.at(-1).referenceFlowId, reference().id);
  assert.ok(Object.isFrozen(result.snapshot.tables[0].rows.at(-1)));
});

test('external resources remain inherited and are explicitly identified in the summary', () => {
  const result = cloneFlow(demoSnapshot, reference(), { name: 'Nouvelle agence', division: 'DEMO_DIV_NEW' });
  assert.deepEqual(new Set(result.summary.referencesRetained.map(ref => ref.kind)), new Set(['schedule', 'queue', 'skills']));
  for (const ref of result.summary.referencesRetained) {
    const mapping = result.summary.mappings.find(item => item.sourceNodeId === ref.nodeId);
    assert.deepEqual(rowFor(result.snapshot, mapping.nodeId)[ref.field], ref.value);
  }
});

test('explicit phone is validated and collision refusal leaves source unchanged', () => {
  const first = cloneFlow(demoSnapshot, reference(), { name: 'Agence Delta', division: 'DEMO_DIV_DELTA', phone: '+33100000123' });
  assert.equal(rowFor(first.snapshot, first.flowId).key, '+33100000123');
  const before = JSON.stringify(first.snapshot);
  assert.throws(() => cloneFlow(first.snapshot, reference(), { name: 'Duplicate', division: 'DEMO_DIV_OTHER', phone: '+33100000123' }), /déjà utilisé/);
  assert.equal(JSON.stringify(first.snapshot), before);
  for (const phone of ['33123456789', '+33 123456789', 'https://host.example', '+0123456789']) assert.throws(() => cloneFlow(demoSnapshot, reference(), { name: 'Invalid', division: 'A', phone }), /format international/);
});

test('repeated same-name clones generate distinct keys without overwriting prior drafts', () => {
  const first = cloneFlow(demoSnapshot, reference(), { name: 'Agence locale', division: 'A' });
  const second = cloneFlow(first.snapshot, reference(), { name: 'Agence locale', division: 'B' });
  assert.notEqual(first.flowId, second.flowId);
  assert.equal(buildVoiceInventory(second.snapshot).flows.length, buildVoiceInventory(demoSnapshot).flows.length + 2);
  for (const table of second.snapshot.tables) assert.equal(new Set(table.rows.map(row => row.key)).size, table.rows.length);
});

function linkedSnapshot() {
  return normalizeSnapshot({ tables: [
    { id: 'in4', name: 'W_INBOUND_CALL_v4', rows: [{ key: 'ENTRY', DESCRIPTION: 'Reference (template)', DIVISION: 'GROUP', OPEN_TARGET_TYPE: 'menu', OPEN_TARGET: ' MENU |pdata:DATA;DATA_TWO|keep:literal', WELCOME_AUDIO: 'pr:WELCOME', RECORDING_CONSENT_MENU: 'CONSENT' }] },
    { id: 'menus4', name: 'W_MENU_v4', rows: [
      { key: ' MENU ', DESCRIPTION: 'Menu', DIVISION: 'GROUP', DEFAULT_TARGET_TYPE: 'standardcallflow', DEFAULT_TARGET: 'ENTRY', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'TEAM', OPTION2_TARGET_TYPE: 'service', OPTION2_TARGET: 'TEAM' },
      { key: 'WAITING', DIVISION: 'GROUP', DEFAULT_TARGET_TYPE: 'next', DEFAULT_TARGET: '' },
      { key: 'CONSENT', DIVISION: 'GROUP', OPTION1_TARGET_TYPE: 'enable', OPTION1_TARGET: '', OPTION2_TARGET_TYPE: 'disable', OPTION2_TARGET: '' },
    ] },
    { id: 'services4', name: 'W_DISTRIBUTION_v4', rows: [{ key: 'TEAM', DIVISION: 'GROUP', QUEUE: 'EXTERNAL_QUEUE', INQUEUE_MENU_1: 'WAITING', INQUEUE_TARGET_TYPE: 'standardcallflow', INQUEUE_TARGET: 'ENTRY', INQUEUE_HOLD_MUSIC_INIT: 'EXTERNAL_MUSIC', INQUEUE_HOLD_TIMEOUT_INIT: 20 }] },
    { id: 'pd4', name: 'W_PARTICIPANT_DATA_v4', rows: [{ key: 'DATA', DIVISION: 'GROUP', PDATA_LIST_1: 'topic==original' }, { key: 'DATA_TWO', DIVISION: 'GROUP', PDATA_LIST_1: 'other==value' }] },
    { id: 'services5', name: 'W_SERVICES_v5', rows: [{ key: 'TEAM', QUEUE: 'NEVER_CLONE_ME' }] },
  ] });
}

test('cycles, shared destinations, PDATA suffixes and waiting/consent dependencies are cloned exactly once', () => {
  const snapshot = linkedSnapshot();
  const source = buildVoiceInventory(snapshot).flows[0];
  const result = cloneFlow(snapshot, source, { name: 'Local', division: 'LOCAL' });
  assert.equal(result.summary.nodeCount, 7);
  assert.equal(result.summary.needsReview.length, 0);
  assert.equal(result.summary.mappings.filter(item => item.oldKey === 'TEAM').length, 1);
  assert.equal(result.summary.mappings.some(item => item.tableId === 'services5'), false);
  const entry = rowFor(result.snapshot, result.flowId);
  const menu = result.summary.mappings.find(item => item.oldKey === ' MENU ');
  const data = result.summary.mappings.find(item => item.oldKey === 'DATA');
  const dataTwo = result.summary.mappings.find(item => item.oldKey === 'DATA_TWO');
  assert.equal(entry.OPEN_TARGET, `${menu.key}|pdata:${data.key};${dataTwo.key}|keep:literal`);
  assert.equal(entry.WELCOME_AUDIO, 'pr:WELCOME');
  assert.equal(rowFor(result.snapshot, menu.nodeId).DEFAULT_TARGET, entry.key);
  const team = result.summary.mappings.find(item => item.oldKey === 'TEAM');
  const waiting = result.summary.mappings.find(item => item.oldKey === 'WAITING');
  assert.equal(rowFor(result.snapshot, team.nodeId).INQUEUE_MENU_1, waiting.key);
  assert.equal(rowFor(result.snapshot, team.nodeId).INQUEUE_TARGET, entry.key);
  assert.equal(rowFor(result.snapshot, team.nodeId).QUEUE, 'EXTERNAL_QUEUE');
  assert.ok(result.summary.referencesRetained.some(item => item.kind === 'prompt' && item.value === 'pr:WELCOME'));
});

test('unknown, dynamic and whitespace-mismatched references survive unchanged and require review', () => {
  const raw = structuredClone(linkedSnapshot());
  raw.tables[0].rows[0].OPEN_TARGET = 'MENU';
  raw.tables[0].rows[0].CLOSED_TARGET_TYPE = 'service';
  raw.tables[0].rows[0].CLOSED_TARGET = 'variable';
  raw.tables[0].rows[0].HOLIDAY_TARGET_TYPE = 'custom_extension';
  raw.tables[0].rows[0].HOLIDAY_TARGET = 'OPAQUE_REFERENCE';
  raw.tables[0].rows[0].SUBROUTINES_LIST = 'CUSTOM_CHECK';
  const source = buildVoiceInventory(raw).flows[0];
  const result = cloneFlow(raw, source, { name: 'Local', division: 'LOCAL' });
  const entry = rowFor(result.snapshot, result.flowId);
  assert.equal(entry.OPEN_TARGET, 'MENU');
  assert.equal(entry.CLOSED_TARGET, 'variable');
  assert.equal(entry.HOLIDAY_TARGET, 'OPAQUE_REFERENCE');
  assert.equal(entry.SUBROUTINES_LIST, 'CUSTOM_CHECK');
  assert.deepEqual(new Set(result.summary.needsReview.map(item => item.code)), new Set(['whitespace-key-mismatch', 'dynamic-reference', 'unknown-target-type', 'runtime-subroutine']));
  assert.equal(result.summary.mappings.some(item => item.oldKey === ' MENU '), false);
});

test('v5 clone resolves v5 services and never reuses the v4 table', () => {
  const snapshot = normalizeSnapshot({ tables: [
    { id: 'in5', name: 'W_INBOUND_CALL_v5', rows: [{ key: 'ENTRY5', DESCRIPTION: 'Template (template)', NEXT_TARGET_TYPE: 'service', NEXT_TARGET: 'TEAM' }] },
    { id: 'sv5', name: 'W_SERVICES_v5', rows: [{ key: 'TEAM', QUEUE: 'V5_QUEUE' }] },
    { id: 'sv4', name: 'W_DISTRIBUTION_v4', rows: [{ key: 'TEAM', QUEUE: 'V4_QUEUE' }] },
  ] });
  const result = cloneFlow(snapshot, buildVoiceInventory(snapshot).flows[0], { name: 'Local', division: 'D' });
  assert.equal(result.summary.nodeCount, 2);
  assert.equal(result.summary.mappings.some(item => item.tableId === 'sv4'), false);
  assert.equal(result.snapshot.tables.find(table => table.id === 'sv4').rows.length, 1);
});

test('missing selection, name, entity and too-small schema refuse before yielding any result', () => {
  assert.throws(() => cloneFlow(demoSnapshot, { id: 'missing' }, { name: 'X', division: 'Y' }), /n’appartient/);
  assert.throws(() => cloneFlow(demoSnapshot, reference(), { name: '', division: 'Y' }), /nom métier/);
  assert.throws(() => cloneFlow(demoSnapshot, reference(), { name: 'X', division: '' }), /entité/);
  const raw = structuredClone(demoSnapshot);
  raw.tables[0].schema.properties.key.maxLength = 8;
  const before = JSON.stringify(raw);
  assert.throws(() => cloneFlow(raw, reference(), { name: 'X', division: 'Y' }), /taille des clés/);
  assert.equal(JSON.stringify(raw), before);
});
