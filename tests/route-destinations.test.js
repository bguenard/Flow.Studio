import test from 'node:test';
import assert from 'node:assert/strict';
import { businessFields } from '../src/business.js';
import { stepFieldView } from '../src/step-field-view.js';
import { prepareStepDraft } from '../src/step-draft.js';

const row = {
  key: 'WEB',
  NEXT_TARGET_TYPE: 'BOT|lang:fr-fr',
  NEXT_TARGET: 'qualification|pdata:CONTEXT',
  DEFAULT_TARGET_TYPE: 'disconnect',
  DEFAULT_TARGET: '',
};
const node = {
  id: 'entry:WEB',
  type: 'segment',
  tableId: 'entry',
  tableName: 'W_INBOUND_MESSAGE_v1',
  row,
  schema: {
    type: 'object',
    properties: Object.fromEntries(Object.keys(row).map((k) => [k, { type: 'string' }])),
  },
};
const snapshot = {
  tables: [
    { name: 'W_BOT_MESSAGE_v1', rows: [{ key: 'QUALIFICATION', DESCRIPTION: 'Bot GAIA' }] },
    { name: 'W_BOT_v5', rows: [{ key: 'VOICE_ONLY' }] },
    { name: 'W_SERVICE_MESSAGE_v1', rows: [{ key: 'SUPPORT', DESCRIPTION: 'Équipe support' }] },
    { name: 'W_PARTICIPANT_DATA_MESSAGE_v1', rows: [{ key: 'CONTEXT' }] },
  ],
};
const field = (key) => businessFields(node).find((f) => f.key === key);
const html = (key, pending = {}, source = snapshot) =>
  stepFieldView(field(key), 0, { node, pending, snapshot: source, admin: true });
test('uppercase route type is recognized without changing original case or parameters', () => {
  const view = html('NEXT_TARGET_TYPE');
  assert.match(view, /value="BOT\|lang:fr-fr" selected[^>]*>Bot digital<\/option>/);
  assert.doesNotMatch(view, /BOT.*valeur actuelle/);
  const draft = prepareStepDraft({
    node,
    snapshot,
    visibleValues: { NEXT_TARGET_TYPE: row.NEXT_TARGET_TYPE },
  });
  assert.deepEqual(draft, row);
});
test('destinations follow the selected type and show exact keys from its engine table', () => {
  const bot = html('NEXT_TARGET');
  assert.match(bot, /value="QUALIFICATION\|pdata:CONTEXT"[^>]*>QUALIFICATION · Bot GAIA<\/option>/);
  assert.match(bot, /value="qualification\|pdata:CONTEXT" selected disabled/);
  assert.match(bot, /référence à vérifier/);
  assert.doesNotMatch(bot, /VOICE_ONLY|SUPPORT/);
  const service = html('NEXT_TARGET', { NEXT_TARGET_TYPE: ' SERVICE |lang:fr-fr' });
  assert.match(service, /value="SUPPORT\|pdata:CONTEXT"/);
  assert.doesNotMatch(service, /value="QUALIFICATION\|/);
  assert.match(service, /W_SERVICE_MESSAGE_v1/);
  const business = stepFieldView(field('NEXT_TARGET'), 0, { node, snapshot });
  assert.match(business, />QUALIFICATION · Bot GAIA<\/option>/);
});
test('empty, missing and ambiguous tables never offer arbitrary destinations or text input', () => {
  for (const tables of [
    [],
    [{ name: 'W_BOT_MESSAGE_v1', rows: [] }],
    [snapshot.tables[0], snapshot.tables[0]],
  ]) {
    const view = html('NEXT_TARGET', {}, { tables });
    assert.match(view, /<select /);
    assert.doesNotMatch(view, /<input |<textarea |value="QUALIFICATION\|/);
    assert.match(view, /absente|Aucune destination|ambiguë/);
  }
  for (const type of ['', 'disconnect', 'unknown']) {
    const view = html('NEXT_TARGET', { NEXT_TARGET_TYPE: type });
    assert.match(view, /<select /);
    assert.doesNotMatch(view, /value="QUALIFICATION\|/);
  }
});
test('saving a selected destination preserves exact case and context and rejects mismatched references', () => {
  const draft = prepareStepDraft({
    node,
    snapshot,
    pending: { NEXT_TARGET: 'QUALIFICATION|pdata:CONTEXT' },
  });
  assert.equal(draft.NEXT_TARGET, 'QUALIFICATION|pdata:CONTEXT');
  assert.equal(draft.NEXT_TARGET_TYPE, row.NEXT_TARGET_TYPE);
  assert.throws(
    () => prepareStepDraft({ node, snapshot, pending: { NEXT_TARGET_TYPE: 'service' } }),
    /absente/,
  );
  assert.throws(
    () =>
      prepareStepDraft({ node, snapshot, pending: { NEXT_TARGET: 'Qualification|pdata:CONTEXT' } }),
    /absente/,
  );
  assert.equal(
    prepareStepDraft({
      node,
      snapshot,
      pending: { NEXT_TARGET_TYPE: 'service|lang:fr-fr', NEXT_TARGET: 'SUPPORT|pdata:CONTEXT' },
    }).NEXT_TARGET,
    'SUPPORT|pdata:CONTEXT',
  );
});
