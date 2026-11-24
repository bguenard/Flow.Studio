import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStepDraft } from '../src/step-draft.js';

const node = row => ({ id: 'service:one', type: 'service', row: { key: 'one', ...row } });

test('saving after a view switch includes hidden pending fields and the latest visible input', () => {
  const step = node({ DESCRIPTION: 'Équipe', WHISPER_AUDIO: 'tts:Ancien message', PRIORITY: 2, QUEUE: 'ACTUAL_QUEUE' });
  const pending = { WHISPER_AUDIO: 'Nouveau message', PRIORITY: '3' }, visibleValues = { PRIORITY: '4' };
  const before = structuredClone({ step, pending, visibleValues });
  const row = prepareStepDraft({ node: step, pending, visibleValues });
  assert.equal(row.WHISPER_AUDIO, 'tts:Nouveau message');
  assert.equal(row.PRIORITY, 4);
  assert.equal(row.QUEUE, 'ACTUAL_QUEUE');
  assert.equal(row.key, 'one');
  assert.deepEqual({ step, pending, visibleValues }, before);
});

test('descriptions retain source markers and unchanged human-readable labels retain original values', () => {
  const step = node({ DESCRIPTION: '[DRAFT_FROM_REFERENCE] ACCUEIL_CLIENT (template)' });
  assert.equal(prepareStepDraft({ node: step, visibleValues: { DESCRIPTION: 'Accueil Client' } }).DESCRIPTION, step.row.DESCRIPTION);
  assert.equal(prepareStepDraft({ node: step, pending: { DESCRIPTION: 'Accueil local' } }).DESCRIPTION, '[DRAFT_FROM_REFERENCE] Accueil local (template)');
});

test('schema types, bounds and enum validation apply to hidden edits as well as visible inputs', () => {
  const step = node({ PRIORITY: '2', INQUEUE_REPEAT: 1 });
  const schema = { properties: { PRIORITY: { type: 'integer', minimum: 0, maximum: 5 }, INQUEUE_REPEAT: { type: 'integer', enum: [1, 2] } } };
  const row = prepareStepDraft({ node: step, schema, pending: { PRIORITY: '4' }, visibleValues: { INQUEUE_REPEAT: '2' } });
  assert.equal(row.PRIORITY, 4);
  assert.equal(row.INQUEUE_REPEAT, 2);
  assert.throws(() => prepareStepDraft({ node: step, schema, pending: { PRIORITY: '9' }, visibleValues: { INQUEUE_REPEAT: '2' } }), /Priorité.*5/);
  assert.equal(step.row.PRIORITY, '2');
  assert.throws(() => prepareStepDraft({ node: step, schema, visibleValues: { INQUEUE_REPEAT: '3' } }), /autorisée/);
});

test('numeric CSV strings remain strings and invalid numbers never become blank or zero', () => {
  const step = node({ PRIORITY: '2' });
  assert.equal(prepareStepDraft({ node: step, pending: { PRIORITY: '04' } }).PRIORITY, '04');
  for (const value of ['', ' ', 'NaN', 'Infinity', '0x10', '1e999']) assert.throws(() => prepareStepDraft({ node: step, pending: { PRIORITY: value } }), /nombre/);
});

test('plain TTS and booleans are supported without accepting encoded prompt chains or expressions', () => {
  const step = node({ WHISPER_AUDIO: 'tts:Bonjour', RECORDING_ENABLE: true });
  const row = prepareStepDraft({ node: step, pending: { WHISPER_AUDIO: 'Bonjour « Marie »', RECORDING_ENABLE: 'false' } });
  assert.equal(row.WHISPER_AUDIO, 'tts:Bonjour « Marie »');
  assert.equal(row.RECORDING_ENABLE, false);
  assert.equal(prepareStepDraft({ node: step, pending: { WHISPER_AUDIO: '' } }).WHISPER_AUDIO, '');
  for (const value of ['Bonjour|pr:MESSAGE', 'Bonjour $var:client$']) assert.throws(() => prepareStepDraft({ node: step, pending: { WHISPER_AUDIO: value } }), /texte du message/);
  assert.throws(() => prepareStepDraft({ node: step, pending: { RECORDING_ENABLE: 'yes' } }), /Oui ou Non/);
});

test('admin-style raw identity, resource, route, context and recorded-prompt changes stay forbidden', () => {
  const step = node({ QUEUE: 'MY_QUEUE', DIVISION: 'MY_DIV', INQUEUE_TARGET_TYPE: 'disconnect', INQUEUE_TARGET: '', PDATA_LIST_1: 'motif==contrat', WHISPER_AUDIO: 'pr:MESSAGE', UNKNOWN_FIELD: 'opaque' });
  for (const key of ['key', 'QUEUE', 'DIVISION', 'INQUEUE_TARGET_TYPE', 'INQUEUE_TARGET', 'PDATA_LIST_1', 'WHISPER_AUDIO', 'UNKNOWN_FIELD']) {
    assert.throws(() => prepareStepDraft({ node: step, pending: { [key]: 'arbitrary' } }), /ne peut pas être modifié/);
  }
});

test('empty saves return a distinct copy without changing source rows', () => {
  const step = node({ DESCRIPTION: 'Équipe locale', PRIORITY: 3 });
  const row = prepareStepDraft({ node: step });
  assert.deepEqual(row, step.row);
  assert.notEqual(row, step.row);
  assert.throws(() => prepareStepDraft({}), /introuvable/);
});
