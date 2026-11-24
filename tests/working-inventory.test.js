import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { cloneFlow } from '../src/flow-clone.js';
import { applyDraftRows, workingInventory, withNodeTitles } from '../src/working-inventory.js';

const source = () => normalizeSnapshot({ source: { kind: 'import', label: 'Essai local' }, tables: [
  { id: 'in', name: 'W_INBOUND_CALL_v5', rows: [{ key: 'entry', DESCRIPTION: 'Accueil', NEXT_TARGET_TYPE: 'menu', NEXT_TARGET: 'choice' }] },
  { id: 'menus', name: 'W_MENU_v5', schema: { properties: { key: { type: 'string' } } }, rows: [{ key: 'choice', DESCRIPTION: 'Choix du motif', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'a' }] },
  { id: 'teams', name: 'W_SERVICES_v5', rows: [{ key: 'a', DESCRIPTION: 'Équipe A', QUEUE: 'File A', PRIORITY: '3' }, { key: 'b', DESCRIPTION: 'Équipe B', QUEUE: 'File B', PRIORITY: '7' }] },
] });
const draftFor = (snapshot, tableId, key, changes) => ({ tableId, key, row: { ...snapshot.tables.find(table => table.id === tableId).rows.find(row => row.key === key), ...changes } });

test('inserted block display names can be restored over a frozen inventory without changing source rows', () => {
  const inventory = workingInventory(source());
  const baseline = structuredClone(inventory);
  assert.equal(Object.isFrozen(inventory.flows[0].nodes[0]), true);
  const result = withNodeTitles(inventory, new Map([['teams:a', 'Équipe commerciale']]));
  const node = result.flows[0].nodes.find(node => node.id === 'teams:a');
  assert.equal(node.name, 'Équipe commerciale');
  assert.deepEqual(node.row, baseline.flows[0].nodes.find(node => node.id === 'teams:a').row);
  assert.deepEqual(inventory, baseline);
});

test('redirecting a draft branch rebuilds reachable nodes, edges and team summaries', () => {
  const snapshot = source(), before = structuredClone(snapshot);
  const draft = draftFor(snapshot, 'menus', 'choice', { OPTION1_TARGET: 'b' });
  const drafts = new Map([['menus:choice', draft]]);
  const flow = workingInventory(snapshot, drafts).flows[0];
  assert.equal(flow.edges.find(edge => edge.from === 'menus:choice').to, 'teams:b');
  assert.deepEqual(flow.services.map(node => node.id), ['teams:b']);
  assert.ok(!flow.nodes.some(node => node.id === 'teams:a'));
  assert.equal(flow.nodes.find(node => node.id === 'teams:b').row.PRIORITY, '7');
  assert.deepEqual(snapshot, before);
  assert.equal(buildVoiceInventory(snapshot).flows[0].services[0].id, 'teams:a');
  draft.row.OPTION1_TARGET = 'a';
  assert.equal(flow.edges.find(edge => edge.from === 'menus:choice').to, 'teams:b');
  assert.ok(!Object.isFrozen(draft.row));
});

test('derived flow metadata and queue destinations use the current draft row', () => {
  const snapshot = source();
  const drafts = new Map([
    ['in:entry', draftFor(snapshot, 'in', 'entry', { DESCRIPTION: 'Nouvel accueil', WELCOME_AUDIO: 'tts:Bonjour' })],
    ['teams:a', draftFor(snapshot, 'teams', 'a', { QUEUE: 'Nouvelle file', PRIORITY: '0' })],
  ]);
  const inventory = workingInventory(snapshot, drafts), flow = inventory.flows[0];
  assert.equal(flow.description, 'Nouvel accueil');
  assert.equal(flow.welcomeAudio, 'tts:Bonjour');
  assert.equal(flow.edges.find(edge => edge.derivedFrom === 'QUEUE').target, 'Nouvelle file');
  assert.equal(flow.services[0].row.PRIORITY, '0');
  assert.ok(Object.isFrozen(inventory));
  assert.deepEqual(applyDraftRows(snapshot, drafts).tables[1].schema, snapshot.tables[1].schema);
});

test('missing draft destination is re-evaluated rather than leaving a stale resolved edge', () => {
  const snapshot = source();
  const inventory = workingInventory(snapshot, new Map([['menus:choice', draftFor(snapshot, 'menus', 'choice', { OPTION1_TARGET: 'absent' })]]));
  assert.equal(inventory.flows[0].edges.find(edge => edge.from === 'menus:choice').resolved, false);
  assert.ok(inventory.issues.some(issue => issue.code === 'missing-row' && issue.target === 'absent'));
  assert.equal(inventory.flows[0].services.length, 0);
});

test('one shared draft updates every journey that references its row', () => {
  const original = source();
  const snapshot = normalizeSnapshot({ ...original, tables: original.tables.map(table => table.id === 'in' ? { ...table, rows: [...table.rows, { ...table.rows[0], key: 'entry2', DESCRIPTION: 'Deuxième accueil' }] } : table) });
  const inventory = workingInventory(snapshot, new Map([['menus:choice', draftFor(snapshot, 'menus', 'choice', { OPTION1_TARGET: 'b' })]]));
  assert.equal(inventory.flows.length, 2);
  assert.ok(inventory.flows.every(flow => flow.services.length === 1 && flow.services[0].id === 'teams:b'));
});

test('invalid draft identities fail explicitly without modifying any source row', () => {
  const snapshot = source(), before = structuredClone(snapshot);
  assert.throws(() => applyDraftRows(snapshot, {}), /indexés/);
  assert.throws(() => applyDraftRows(snapshot, new Map([['missing:a', { tableId: 'missing', key: 'a', row: { key: 'a' } }]])), /table.*absente/);
  assert.throws(() => applyDraftRows(snapshot, new Map([['teams:missing', { tableId: 'teams', key: 'missing', row: { key: 'missing' } }]])), /ligne.*absente/);
  assert.throws(() => applyDraftRows(snapshot, new Map([['teams:b', draftFor(snapshot, 'teams', 'a', {})]])), /identifiant.*correspond/);
  assert.throws(() => applyDraftRows(snapshot, new Map([['teams:a', draftFor(snapshot, 'teams', 'a', { key: 'b' })]])), /changer la clé/);
  assert.throws(() => applyDraftRows(snapshot, new Map([['teams:a', { ...draftFor(snapshot, 'teams', 'a', {}), nodeId: 'teams:b' }]])), /identifiant.*correspond/);
  assert.deepEqual(snapshot, before);
});

test('keys containing whitespace remain exact identities', () => {
  const snapshot = normalizeSnapshot({ tables: [{ id: 'in', name: 'W_INBOUND_CALL_v5', rows: [{ key: ' entry ', DESCRIPTION: 'Original' }] }] });
  const draft = draftFor(snapshot, 'in', ' entry ', { DESCRIPTION: 'Adapté' });
  assert.equal(workingInventory(snapshot, new Map([['in: entry ', draft]])).flows[0].description, 'Adapté');
  assert.throws(() => applyDraftRows(snapshot, new Map([['in:entry', { ...draft, key: 'entry' }]])), /ligne.*absente/);
});

test('journeys already created in the snapshot survive further draft overlays', () => {
  const snapshot = source(), originalFlow = buildVoiceInventory(snapshot).flows[0];
  const created = cloneFlow(snapshot, originalFlow, { name: 'Nouvelle entité', division: 'Entité B' });
  const clone = buildVoiceInventory(created.snapshot).flows.find(flow => flow.id === created.flowId);
  const label = clone.description.replace('Nouvelle entité', 'Entité adaptée');
  const draft = draftFor(created.snapshot, clone.sourceTableId, clone.key, { DESCRIPTION: label });
  const inventory = workingInventory(created.snapshot, new Map([[created.flowId, draft]]));
  assert.equal(inventory.flows.length, 2);
  assert.equal(inventory.flows.find(flow => flow.id === created.flowId).description, label);
  assert.equal(inventory.flows.find(flow => flow.id === originalFlow.id).description, 'Accueil');
  assert.deepEqual(inventory.counts, buildVoiceInventory(created.snapshot).counts);
});
