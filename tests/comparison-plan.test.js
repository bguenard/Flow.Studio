import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFlows } from '../src/business.js';
import { comparisonChoices, prepareComparisonPlan } from '../src/comparison-plan.js';

const node = (id, type, row = {}, tableName = `W_${type}_v5`) => ({ id, key: id, type, tableName, tableId: tableName, row: { key: id, ...row } });
const flow = (id, nodes, edges = []) => ({ id, version: '5', nodes, edges });
const route = (from, to, row, branch = 'NEXT') => ({ from, to, field: `${branch}_TARGET_TYPE`, destinationField: `${branch}_TARGET`, branch, type: row[`${branch}_TARGET_TYPE`].split('|')[0], target: row[`${branch}_TARGET`].split('|')[0], rawType: row[`${branch}_TARGET_TYPE`], rawTarget: row[`${branch}_TARGET`], parameters: row[`${branch}_TARGET_TYPE`].split('|').slice(1), relationship: 'route', resolved: true });
function pair(leftRow, rightRow, type = 'service') {
  const a = node('a', type, leftRow), b = node('b', type, rightRow);
  const left = flow('a', [a]), right = flow('b', [b]);
  return { left, right, diff: compareFlows(left, right), a, b };
}
const choiceFor = (setup, field) => comparisonChoices(setup.diff, setup.left, setup.right).find(item => item.field === field);
const plan = (setup, decisions, snapshot) => prepareComparisonPlan({ ...setup, decisions, snapshot });

test('copy decisions include resources, recorded prompts and controls while all other fields stay unchanged', () => {
  const setup = pair({ QUEUE: 'SOURCE_QUEUE', WHISPER_AUDIO: 'pr:MESSAGE_SOURCE', SUBROUTINES_LIST: 'CHECK_AGENT', PRIORITY: 8 }, { QUEUE: 'LOCAL_QUEUE', WHISPER_AUDIO: 'pr:MESSAGE_LOCAL', SUBROUTINES_LIST: 'CHECK_EWT', PRIORITY: 3 });
  const original = structuredClone(setup);
  const choices = ['QUEUE', 'WHISPER_AUDIO', 'SUBROUTINES_LIST'].map(field => choiceFor(setup, field));
  assert.ok(choices.every(choice => choice.canCopy && choice.notice));
  assert.ok(choices.every(choice => !choice.canEdit));
  const result = plan(setup, Object.fromEntries(choices.map(choice => [choice.id, { mode: 'copy' }])));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].row, { key: 'b', QUEUE: 'SOURCE_QUEUE', WHISPER_AUDIO: 'pr:MESSAGE_SOURCE', SUBROUTINES_LIST: 'CHECK_AGENT', PRIORITY: 3 });
  assert.equal(result.changes.length, 3);
  assert.deepEqual(setup, original);
});

test('schema validation rejects the whole batch after another valid decision', () => {
  const setup = pair({ PRIORITY: 7, WHISPER_AUDIO: 'tts:Bonjour' }, { PRIORITY: 3, WHISPER_AUDIO: 'tts:Bienvenue' });
  const priority = choiceFor(setup, 'PRIORITY'), audio = choiceFor(setup, 'WHISPER_AUDIO');
  const snapshot = { tables: [{ id: setup.b.tableId, schema: { properties: { PRIORITY: { type: 'integer', minimum: 0, maximum: 5 }, WHISPER_AUDIO: { type: 'string' } } } }] };
  const result = plan(setup, { [audio.id]: { mode: 'edit', value: 'Bonjour « Marie »' }, [priority.id]: { mode: 'copy' } }, snapshot);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.changes, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, priority.id);
  assert.match(result.errors[0].message, /5/);
  assert.equal(setup.b.row.WHISPER_AUDIO, 'tts:Bienvenue');
});

test('editable values support local TTS, numbers and booleans, never freeform resource identifiers', () => {
  const setup = pair({ PRIORITY: 7, RECORDING_ENABLE: false, WHISPER_AUDIO: 'tts:Bonjour', QUEUE: 'SOURCE' }, { PRIORITY: '3', RECORDING_ENABLE: true, WHISPER_AUDIO: 'tts:Bienvenue', QUEUE: 'LOCAL' });
  const priority = choiceFor(setup, 'PRIORITY'), recording = choiceFor(setup, 'RECORDING_ENABLE'), audio = choiceFor(setup, 'WHISPER_AUDIO'), queue = choiceFor(setup, 'QUEUE');
  assert.equal(audio.value, 'Bienvenue');
  const result = plan(setup, { [priority.id]: { mode: 'edit', value: '12' }, [recording.id]: { mode: 'edit', value: 'false' }, [audio.id]: { mode: 'edit', value: 'Votre équipe vous répondra.' } });
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].row.PRIORITY, '12');
  assert.equal(result.rows[0].row.RECORDING_ENABLE, false);
  assert.equal(result.rows[0].row.WHISPER_AUDIO, 'tts:Votre équipe vous répondra.');
  assert.equal(plan(setup, { [queue.id]: { mode: 'edit', value: 'ARBITRARY' } }).errors.length, 1);
  assert.equal(plan(setup, { [audio.id]: { mode: 'edit', value: 'tts:Bonjour|sub:CHECK' } }).errors.length, 1);
  assert.equal(plan(setup, { [priority.id]: { mode: 'edit', value: '' } }).errors.length, 1);
});

test('identity, absent target fields and incompatible table copies are refused', () => {
  const setup = pair({ PRIORITY: 8, FLOW_NAME: 'source-flow' }, { FLOW_NAME: 'local-flow' });
  assert.equal(choiceFor(setup, 'PRIORITY').canCopy, false);
  assert.equal(choiceFor(setup, 'FLOW_NAME').canCopy, false);
  const other = pair({ PRIORITY: 8 }, { PRIORITY: 2 });
  other.b.tableName = 'W_service_v4';
  other.diff = compareFlows(other.left, other.right);
  assert.equal(choiceFor(other, 'PRIORITY').canCopy, false);
  assert.equal(choiceFor(other, 'PRIORITY').canEdit, true);
});

function branches({ context = false, missingMapping = false } = {}) {
  const a = node('a', 'inboundcall', { NEXT_TARGET_TYPE: 'service|lang:fr-fr|sub:CHECK_AGENT', NEXT_TARGET: `a-team${context ? '|pdata:a-context' : ''}`, NEXT_TARGET_AUDIO: 'pr:SOURCE_MESSAGE' });
  const b = node('b', 'inboundcall', { NEXT_TARGET_TYPE: 'service|lang:en-gb|sub:CHECK_EWT|status:IDLE', NEXT_TARGET: `b-other${context ? '|pdata:b-context' : ''}`, NEXT_TARGET_AUDIO: 'pr:LOCAL_MESSAGE' });
  const aTeam = node('a-team', 'service'), bTeam = node('b-team', 'service'), bOther = node('b-other', 'service');
  const aContext = node('a-context', 'pdata', { PDATA_LIST_1: 'motif==contrat' }), bContext = node('b-context', 'pdata', { PDATA_LIST_1: 'motif==contrat' });
  const left = flow(a.id, [a, aTeam, ...(context ? [aContext] : [])], [route(a.id, aTeam.id, a.row)]);
  const right = flow(b.id, [b, bTeam, bOther, ...(context ? [bContext] : [])], [route(b.id, bOther.id, b.row)]);
  const seeds = [[a.id, b.id], ...(!missingMapping ? [[aTeam.id, bTeam.id]] : []), ...(context ? [[aContext.id, bContext.id]] : [])];
  const diff = compareFlows(left, right, { seedMatches: seeds, exact: true });
  return { left, right, diff, a, b, aTeam, bTeam, bOther, aContext, bContext };
}
const destination = setup => comparisonChoices(setup.diff, setup.left, setup.right).find(choice => choice.structural && !choice.modifier);

test('destination copy remaps both the chosen step and context into the target journey', () => {
  const setup = branches({ context: true }), choice = destination(setup), original = structuredClone(setup);
  assert.equal(choice.canCopy, true);
  const result = plan(setup, { [choice.id]: { mode: 'copy' } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].row.NEXT_TARGET, 'b-team|pdata:b-context');
  assert.equal(result.rows[0].row.NEXT_TARGET_TYPE, 'service|lang:en-gb|sub:CHECK_EWT|status:IDLE');
  assert.equal(result.rows[0].row.NEXT_TARGET_AUDIO, 'pr:LOCAL_MESSAGE');
  assert.equal(result.rows[0].row.key, 'b');
  assert.equal(result.changes[0].afterDisplay, 'b-team');
  assert.deepEqual(result.changes[0].after, { type: 'service', target: 'b-team|pdata:b-context' });
  assert.deepEqual(setup, original);
});

test('unmapped source destinations block copying while manual selection uses only an existing target step', () => {
  const setup = branches({ context: true, missingMapping: true }), choice = destination(setup);
  assert.equal(choice.canCopy, false);
  assert.match(choice.copyReason, /correspondance/);
  assert.equal(choice.canEdit, true);
  assert.ok(choice.destinationOptions.some(option => option.value === setup.bTeam.id));
  assert.ok(!choice.destinationOptions.some(option => option.value === setup.aTeam.id));
  const result = plan(setup, { [choice.id]: { mode: 'edit', value: setup.bTeam.id } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].row.NEXT_TARGET, 'b-team|pdata:b-context');
  assert.equal(result.rows[0].row.NEXT_TARGET_TYPE, setup.b.row.NEXT_TARGET_TYPE);
  assert.equal(plan(setup, { [choice.id]: { mode: 'edit', value: 'not-a-target-step' } }).errors.length, 1);
});

test('copying a destination refuses unresolved context rather than retaining source context identifiers', () => {
  const setup = branches({ context: true });
  setup.diff.matches = setup.diff.matches.filter(match => match.leftNode.id !== setup.aContext.id);
  const choice = destination(setup);
  assert.equal(choice.canCopy, false);
  assert.match(choice.copyReason, /contexte client/i);
  assert.equal(plan(setup, { [choice.id]: { mode: 'copy' } }).rows.length, 0);
});

test('individual language and control decisions compose with destination copy in either order', () => {
  const setup = branches(), choices = comparisonChoices(setup.diff, setup.left, setup.right);
  const selected = choices.filter(choice => choice.modifierKey === 'lang' || choice.modifierKey === 'sub' || choice.structural && !choice.modifier);
  assert.ok(selected.every(choice => choice.canCopy));
  assert.ok(selected.find(choice => choice.modifierKey === 'sub').notice);
  const decisions = items => Object.fromEntries(items.map(choice => [choice.id, { mode: 'copy' }]));
  const a = plan(setup, decisions(selected)), b = plan(setup, decisions([...selected].reverse()));
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(a.rows[0].row, b.rows[0].row);
  assert.equal(a.rows[0].row.NEXT_TARGET_TYPE, 'service|lang:fr-fr|sub:CHECK_AGENT|status:IDLE');
  assert.equal(a.rows[0].row.NEXT_TARGET, 'b-team');
  const byId = result => [...result.changes].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(a), byId(b), 'each slot review is independent of decision order');
});

test('duplicate modifiers and unsupported modifiers are never silently replaced', () => {
  const setup = branches();
  setup.a.row.NEXT_TARGET_TYPE = 'service|sub:CHECK_AGENT|sub:CHECK_EWT|unexpected:value';
  setup.left.edges = [route(setup.a.id, setup.aTeam.id, setup.a.row)];
  setup.diff = compareFlows(setup.left, setup.right, { seedMatches: [[setup.a.id, setup.b.id]], exact: true });
  const choices = comparisonChoices(setup.diff, setup.left, setup.right);
  assert.equal(choices.find(choice => choice.modifierKey === 'sub').canCopy, false);
  assert.equal(choices.find(choice => choice.modifierKey === 'unexpected').canCopy, false);
});

test('removed source modifiers can be copied independently without changing the target destination', () => {
  const setup = branches();
  setup.a.row.NEXT_TARGET_TYPE = 'service|lang:fr-fr';
  setup.left.edges = [route(setup.a.id, setup.aTeam.id, setup.a.row)];
  setup.diff = compareFlows(setup.left, setup.right, { seedMatches: [[setup.a.id, setup.b.id]], exact: true });
  const choice = comparisonChoices(setup.diff, setup.left, setup.right).find(choice => choice.modifierKey === 'sub');
  const result = plan(setup, { [choice.id]: { mode: 'copy' } });
  assert.equal(result.rows[0].row.NEXT_TARGET_TYPE, 'service|lang:en-gb|status:IDLE');
  assert.equal(result.rows[0].row.NEXT_TARGET, 'b-other');
});

test('stale decisions and unknown choices produce no partial plan; keeping everything produces no writes', () => {
  const setup = pair({ PRIORITY: 8 }, { PRIORITY: 2 }), choice = choiceFor(setup, 'PRIORITY');
  assert.deepEqual(plan(setup, {}), { rows: [], changes: [], errors: [] });
  assert.deepEqual(plan(setup, { [choice.id]: { mode: 'keep' } }), { rows: [], changes: [], errors: [] });
  assert.equal(plan(setup, { [choice.id]: { mode: 'copy' }, obsolete: { mode: 'copy' } }).rows.length, 0);
  setup.right = structuredClone(setup.right);
  setup.right.nodes[0].row.PRIORITY = 4;
  const result = plan(setup, { [choice.id]: { mode: 'copy' } });
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0].message, /changé/);
});

test('menu announcement copies carry a business notice and never rewrite the menu choices', () => {
  const setup = pair({ MENU_AUDIO: 'tts:Tapez 1 pour les contrats', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'source-team' }, { MENU_AUDIO: 'tts:Tapez 1 pour les sinistres', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'target-team' }, 'menu');
  const choice = choiceFor(setup, 'MENU_AUDIO');
  assert.equal(choice.canCopy, true);
  assert.match(choice.notice, /message annonce bien les choix du menu cible/);
  const result = plan(setup, { [choice.id]: { mode: 'copy' } });
  assert.equal(result.rows[0].row.MENU_AUDIO, setup.a.row.MENU_AUDIO);
  assert.equal(result.rows[0].row.OPTION1_TARGET, 'target-team');
  assert.equal(result.rows[0].row.OPTION1_TARGET_TYPE, 'service');
});

test('an explicitly supplied snapshot must contain the target table before applying a decision', () => {
  const setup = pair({ PRIORITY: 8 }, { PRIORITY: 2 }), choice = choiceFor(setup, 'PRIORITY');
  const result = plan(setup, { [choice.id]: { mode: 'copy' } }, { tables: [] });
  assert.deepEqual(result.rows, []);
  assert.match(result.errors[0].message, /schéma/);
});

test('an uncontested heuristic correspondence can remap a changed branch destination', () => {
  const setup = branches();
  setup.bOther.type = 'menu';
  setup.bOther.tableName = 'W_menu_v5';
  setup.b.row.NEXT_TARGET_TYPE = 'menu|lang:en-gb';
  setup.right.edges = [route(setup.b.id, setup.bOther.id, setup.b.row)];
  setup.diff = compareFlows(setup.left, setup.right);
  const choice = destination(setup);
  assert.equal(choice.canCopy, true);
  const result = plan(setup, { [choice.id]: { mode: 'copy' } });
  assert.equal(result.rows[0].row.NEXT_TARGET, 'b-team');
  assert.equal(result.rows[0].row.NEXT_TARGET_TYPE, 'service|lang:en-gb');
});
