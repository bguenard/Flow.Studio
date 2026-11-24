import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { blockInsertionOptions, prepareBlockInsertion } from '../src/block-insertion.js';

function fixture({ contextBefore = false } = {}) {
  const snapshot = normalizeSnapshot({ tables: [
    { id: 'entries', name: 'W_INBOUND_CALL_v5', rows: [
      { key: 'SOURCE', DESCRIPTION: 'Source', DIVISION: 'A', NEXT_TARGET_TYPE: 'menu', NEXT_TARGET: 'QUESTION|pdata:MODE_CRISE_ACTIF' },
      { key: 'TARGET', DESCRIPTION: 'Cible', DIVISION: 'B', NEXT_TARGET_TYPE: 'service|lang:en-gb|sub:ENTRY_CHECK', NEXT_TARGET: `LOCAL${contextBefore ? '|pdata:TARGET_BEFORE' : ''}`, NEXT_TARGET_AUDIO: 'pr:LOCAL_WELCOME' },
    ] },
    { id: 'menus', name: 'W_MENU_v5', rows: [
      { key: 'QUESTION', MENU_NAME: 'QUESTION', DIVISION: 'A', DESCRIPTION: 'Qualification', MENU_AUDIO: 'pr:QUESTION', DEFAULT_TARGET_TYPE: 'service|sub:SOURCE_CHECK', DEFAULT_TARGET: 'SOURCE_TEAM|pdata:SOURCE_RESULT', OPTION1_TARGET_TYPE: 'disconnect', OPTION1_TARGET: '' },
      { key: 'WAIT', MENU_NAME: 'WAIT', DIVISION: 'A', DESCRIPTION: 'Pendant l’attente', DEFAULT_TARGET_TYPE: 'next', DEFAULT_TARGET: '' },
    ] },
    { id: 'services', name: 'W_SERVICES_v5', rows: [
      { key: 'SOURCE_TEAM', SERVICE: 'SOURCE_TEAM', DIVISION: 'A', DESCRIPTION: 'Équipe source', QUEUE: 'EXTERNAL_QUEUE', INQUEUE_MENU_1: 'WAIT', INQUEUE_TARGET_TYPE: 'disconnect', INQUEUE_TARGET: 'fin attente' },
      { key: 'LOCAL', SERVICE: 'LOCAL', DIVISION: 'B', DESCRIPTION: 'Équipe locale', QUEUE: 'LOCAL_QUEUE', INQUEUE_TARGET_TYPE: 'disconnect', INQUEUE_TARGET: 'fin attente locale' },
    ] },
    { id: 'contexts', name: 'W_PARTICIPANT_DATA_v5', rows: [
      { key: 'MODE_CRISE_ACTIF', PDATA_NAME: 'MODE_CRISE_ACTIF', DIVISION: 'A', PDATA_LIST_1: 'CRISE==ACTIF' },
      { key: 'SOURCE_RESULT', PDATA_NAME: 'SOURCE_RESULT', DIVISION: 'A', PDATA_LIST_1: 'motif==qualification' },
      { key: 'TARGET_BEFORE', PDATA_NAME: 'TARGET_BEFORE', DIVISION: 'B', PDATA_LIST_1: 'origine==locale' },
    ] },
  ] });
  const flows = buildVoiceInventory(snapshot).flows;
  return { snapshot, left: flows.find(flow => flow.key === 'SOURCE'), right: flows.find(flow => flow.key === 'TARGET') };
}
const argsFor = (setup, key) => ({ ...setup, sourceNodeId: setup.left.nodes.find(node => node.key === key).id });
const entryPlacement = options => options.placements.find(item => item.fromId === 'entries:TARGET' && item.field === 'NEXT_TARGET_TYPE');
const resultRow = (result, sourceNodeId) => result.createdRows.find(item => item.sourceNodeId === sourceNodeId)?.row;

test('a PDATA block is attached to the chosen transition and never inserted as a routing step', () => {
  const setup = fixture(), args = argsFor(setup, 'MODE_CRISE_ACTIF'), original = JSON.stringify(setup.snapshot);
  const options = blockInsertionOptions(args);
  assert.equal(options.kind, 'context');
  assert.equal(options.canInsert, true);
  assert.deepEqual(options.outlets, []);
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id, keyPrefix: 'CRISE_1' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.createdRows.length, 1);
  const copy = result.createdRows[0].row, patch = result.updatedRows[0].row;
  assert.equal(copy.PDATA_LIST_1, 'CRISE==ACTIF');
  assert.notEqual(copy.key, 'MODE_CRISE_ACTIF');
  assert.equal(copy.PDATA_NAME, copy.key);
  assert.equal(copy.DIVISION, 'B');
  assert.equal(patch.NEXT_TARGET_TYPE, setup.right.sourceRow.NEXT_TARGET_TYPE);
  assert.equal(patch.NEXT_TARGET, `LOCAL|pdata:${copy.key}`);
  assert.equal(patch.NEXT_TARGET_AUDIO, setup.right.sourceRow.NEXT_TARGET_AUDIO);
  assert.equal(JSON.stringify(setup.snapshot), original);
  const target = buildVoiceInventory(result.snapshot).flows.find(flow => flow.id === setup.right.id);
  assert.ok(target.edges.some(edge => edge.to === result.createdRows[0].nodeId && edge.relationship === 'context'));
  assert.ok(!target.edges.some(edge => edge.type === 'pdata' && edge.relationship === 'route'));
});

test('existing context cannot be overwritten or silently extended', () => {
  const args = argsFor(fixture({ contextBefore: true }), 'MODE_CRISE_ACTIF');
  const options = blockInsertionOptions(args);
  assert.ok(!options.placements.some(item => item.fromId === 'entries:TARGET'));
  const result = prepareBlockInsertion({ ...args, placementId: JSON.stringify(['entries:TARGET', 'NEXT_TARGET_TYPE']) });
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.createdRows, []);
  assert.deepEqual(result.updatedRows, []);
});

test('route insertion clones its attached context, preserves the target and requires an explicit exit', () => {
  const setup = fixture({ contextBefore: true }), args = argsFor(setup, 'QUESTION');
  const options = blockInsertionOptions(args), placement = entryPlacement(options);
  const outlet = options.outlets.find(item => item.field === 'DEFAULT_TARGET_TYPE');
  const input = { ...args, placementId: placement.id, connections: { [outlet.id]: { mode: 'resume' } }, keyPrefix: 'QUESTION_1' };
  const result = prepareBlockInsertion(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.createdRows.length, 2);
  const menu = resultRow(result, 'menus:QUESTION'), context = resultRow(result, 'contexts:SOURCE_RESULT');
  assert.equal(menu.DEFAULT_TARGET_TYPE, 'service|sub:SOURCE_CHECK');
  assert.equal(menu.DEFAULT_TARGET, `LOCAL|pdata:${context.key}`);
  assert.equal(menu.OPTION1_TARGET_TYPE, 'disconnect');
  assert.equal(menu.MENU_NAME, menu.key);
  const patch = result.updatedRows[0].row;
  assert.equal(patch.NEXT_TARGET_TYPE, 'menu|lang:en-gb|sub:ENTRY_CHECK');
  assert.equal(patch.NEXT_TARGET, `${menu.key}|pdata:TARGET_BEFORE`);
  assert.equal(patch.NEXT_TARGET_AUDIO, 'pr:LOCAL_WELCOME');
  assert.equal(result.snapshot.tables.find(table => table.id === 'services').rows.length, setup.snapshot.tables.find(table => table.id === 'services').rows.length);
  assert.deepEqual(result.snapshot.tables.find(table => table.id === 'entries').rows.find(row => row.key === 'SOURCE'), setup.left.sourceRow);
  assert.deepEqual(prepareBlockInsertion(input), result, 'preview and application use deterministic keys');
});

test('a service retains its waiting menu as a cloned dependency and the waiting exit is selectable', () => {
  const args = argsFor(fixture(), 'SOURCE_TEAM'), options = blockInsertionOptions(args);
  const outlet = options.outlets.find(item => item.nodeId === 'services:SOURCE_TEAM' && item.field === 'INQUEUE_TARGET_TYPE');
  assert.ok(outlet);
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id, connections: { [outlet.id]: { mode: 'resume' } } });
  assert.deepEqual(result.errors, []);
  const service = resultRow(result, 'services:SOURCE_TEAM'), wait = resultRow(result, 'menus:WAIT');
  assert.equal(service.INQUEUE_MENU_1, wait.key);
  assert.equal(service.INQUEUE_TARGET_TYPE, 'service');
  assert.equal(service.INQUEUE_TARGET, 'LOCAL');
  assert.equal(wait.DEFAULT_TARGET_TYPE, 'next');
  assert.equal(service.QUEUE, 'EXTERNAL_QUEUE');
  assert.ok(result.summary.notices.some(note => /ressources/.test(note)));
});

test('missing exits and missing dependencies reject the entire insertion', () => {
  const args = argsFor(fixture(), 'QUESTION'), options = blockInsertionOptions(args);
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id });
  assert.match(result.errors[0].message, /sortie/);
  assert.deepEqual(result.createdRows, []);
  assert.deepEqual(result.updatedRows, []);
  const raw = structuredClone(args.snapshot);
  raw.tables.find(table => table.id === 'contexts').rows = [];
  const invalid = blockInsertionOptions({ ...args, snapshot: raw });
  assert.equal(invalid.canInsert, false);
  assert.match(invalid.reason, /étape associée.*introuvable/);
});

test('manual exit selection only accepts an existing target node', () => {
  const args = argsFor(fixture(), 'QUESTION'), options = blockInsertionOptions(args), outlet = options.outlets.find(item => item.requiresConnection);
  const input = { ...args, placementId: entryPlacement(options).id, connections: { [outlet.id]: { mode: 'target', nodeId: 'services:LOCAL' } } };
  const result = prepareBlockInsertion(input);
  assert.deepEqual(result.errors, []);
  assert.match(resultRow(result, 'menus:QUESTION').DEFAULT_TARGET, /^LOCAL\|pdata:/);
  input.connections[outlet.id].nodeId = 'services:SOURCE_TEAM';
  assert.equal(prepareBlockInsertion(input).errors.length, 1);
});

test('same-name insertions avoid collisions and all original source rows remain intact', () => {
  const args = argsFor(fixture(), 'MODE_CRISE_ACTIF'), options = blockInsertionOptions(args);
  const first = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id, keyPrefix: 'SAME' });
  const flows = buildVoiceInventory(first.snapshot).flows;
  const secondArgs = { ...args, snapshot: first.snapshot, left: flows.find(flow => flow.id === args.left.id), right: flows.find(flow => flow.id === args.right.id) };
  const secondOptions = blockInsertionOptions(secondArgs);
  const second = prepareBlockInsertion({ ...secondArgs, placementId: secondOptions.placements[0].id, keyPrefix: 'SAME' });
  assert.deepEqual(second.errors, []);
  assert.notEqual(first.createdRows[0].row.key, second.createdRows[0].row.key);
  for (const source of args.left.nodes) {
    const row = second.snapshot.tables.find(table => table.id === source.tableId).rows.find(row => row.key === source.key);
    assert.deepEqual(row, source.row);
  }
});

test('cross-version, unsupported block and shared anchor insertion are rejected', () => {
  const setup = fixture(), args = argsFor(setup, 'QUESTION');
  assert.equal(blockInsertionOptions({ ...args, right: { ...setup.right, version: '4' } }).canInsert, false);
  assert.equal(blockInsertionOptions({ ...setup, sourceNodeId: setup.left.id }).canInsert, false);
  const raw = structuredClone(setup.snapshot);
  raw.tables.find(table => table.id === 'entries').rows.find(row => row.key === 'TARGET').NEXT_TARGET = 'QUESTION';
  raw.tables.find(table => table.id === 'entries').rows.find(row => row.key === 'TARGET').NEXT_TARGET_TYPE = 'menu';
  const flows = buildVoiceInventory(raw).flows;
  const shared = { snapshot: raw, left: flows.find(flow => flow.id === setup.left.id), right: flows.find(flow => flow.id === setup.right.id), sourceNodeId: 'contexts:MODE_CRISE_ACTIF' };
  assert.ok(!blockInsertionOptions(shared).placements.some(item => item.fromId === 'menus:QUESTION'));
  const result = prepareBlockInsertion({ ...shared, placementId: JSON.stringify(['menus:QUESTION', 'DEFAULT_TARGET_TYPE']) });
  assert.match(result.errors[0].message, /partagée/);
  assert.deepEqual(result.updatedRows, []);
});

test('schema rejection returns no new rows and no anchor patch', () => {
  const setup = fixture(), raw = structuredClone(setup.snapshot);
  raw.tables.find(table => table.id === 'contexts').schema = { properties: { key: { type: 'string', maxLength: 6 } } };
  const args = { ...argsFor(setup, 'MODE_CRISE_ACTIF'), snapshot: raw }, options = blockInsertionOptions(args);
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id });
  assert.deepEqual(result.createdRows, []);
  assert.deepEqual(result.updatedRows, []);
  assert.match(result.errors[0].message, /clés/);
});

test('equivalent uppercase type bases and their modifiers stay byte-for-byte unchanged at entry and exit', () => {
  const raw = structuredClone(fixture().snapshot);
  const target = raw.tables.find(table => table.id === 'entries').rows.find(row => row.key === 'TARGET');
  target.NEXT_TARGET_TYPE = ' SERVICE |lang:en-gb|sub:ENTRY_CHECK';
  const source = raw.tables.find(table => table.id === 'services').rows.find(row => row.key === 'SOURCE_TEAM');
  source.INQUEUE_TARGET_TYPE = 'SERVICE|sub:SOURCE_CHECK;RECORDING';
  source.INQUEUE_TARGET = 'LOCAL';
  const flows = buildVoiceInventory(raw).flows;
  const args = { snapshot: raw, left: flows.find(flow => flow.key === 'SOURCE'), right: flows.find(flow => flow.key === 'TARGET'), sourceNodeId: 'services:SOURCE_TEAM' };
  const options = blockInsertionOptions(args), outlet = options.outlets.find(item => item.field === 'INQUEUE_TARGET_TYPE');
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id, connections: { [outlet.id]: { mode: 'resume' } } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.updatedRows[0].row.NEXT_TARGET_TYPE, target.NEXT_TARGET_TYPE);
  assert.equal(resultRow(result, 'services:SOURCE_TEAM').INQUEUE_TARGET_TYPE, source.INQUEUE_TARGET_TYPE);
});

test('equivalent inbound-call aliases preserve the original exit type token', () => {
  const raw = structuredClone(fixture().snapshot);
  for (const table of raw.tables) table.name = table.name === 'W_SERVICES_v5' ? 'W_DISTRIBUTION_v4' : table.name.replace(/_v5$/, '_v4');
  const source = raw.tables.find(table => table.id === 'menus').rows.find(row => row.key === 'QUESTION');
  source.DEFAULT_TARGET_TYPE = 'INBOUNDCall|lang:fr-fr|sub:CHECK';
  source.DEFAULT_TARGET = 'SOURCE';
  const flows = buildVoiceInventory(raw).flows;
  const args = { snapshot: raw, left: flows.find(flow => flow.key === 'SOURCE'), right: flows.find(flow => flow.key === 'TARGET'), sourceNodeId: 'menus:QUESTION' };
  const options = blockInsertionOptions(args), outlet = options.outlets.find(item => item.field === 'DEFAULT_TARGET_TYPE');
  const result = prepareBlockInsertion({ ...args, placementId: entryPlacement(options).id, connections: { [outlet.id]: { mode: 'target', nodeId: 'entries:TARGET' } } });
  assert.deepEqual(result.errors, []);
  assert.equal(resultRow(result, 'menus:QUESTION').DEFAULT_TARGET_TYPE, source.DEFAULT_TARGET_TYPE);
  assert.equal(resultRow(result, 'menus:QUESTION').DEFAULT_TARGET, 'TARGET');
});
