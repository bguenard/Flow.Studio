import test from 'node:test';
import assert from 'node:assert/strict';
import { businessInspectorModel } from '../src/journey-audience.js';
import { businessBranches, businessBranchView } from '../src/business-branches.js';
import { stepFieldView } from '../src/step-field-view.js';
import { prepareStepDraft } from '../src/step-draft.js';
function fixture(type, row) {
  return {
    id: 'table:one',
    type,
    tableName:
      'W_' +
      {
        menu: 'MENU',
        decision: 'DECISION',
        schedulegroup: 'SCHEDULE_GROUP',
        ratiodistrib: 'RATIO_DISTRIB',
      }[type] +
      '_v5',
    key: 'one',
    row: { key: 'one', DESCRIPTION: 'Étape', ...row },
    schema: {
      properties: Object.fromEntries(
        Object.keys({ key: 'one', DESCRIPTION: 'Étape', ...row }).map((k) => [
          k,
          { type: 'string' },
        ]),
      ),
    },
  };
}
const menu = () =>
  fixture('menu', {
    MENU_AUDIO: 'tts:Bienvenue',
    OPTION2_TARGET_TYPE: 'number',
    OPTION2_TARGET: '+33123456782',
    OPTION2_AUDIO: 'tts:Deux',
    OPTION1_AUDIO: '',
    OPTION1_TARGET_TYPE: 'number',
    OPTION1_TARGET: '+33123456781',
    OPTION0_TARGET_TYPE: '',
    OPTION0_TARGET: '',
    OPTION0_AUDIO: '',
    DEFAULT_TARGET_TYPE: 'disconnect',
    DEFAULT_TARGET: '',
    DEFAULT_TARGET_AUDIO: '',
  });
const model = (node, pending = {}, only = true) =>
  businessBranches(node, businessInspectorModel(node).fields, pending, only);
test('menu groups each choice and repli; configured choices sorted naturally and blank choices available on demand', () => {
  const n = menu(),
    m = model(n);
  assert.deepEqual(
    m.branches.map((b) => b.id),
    ['OPTION1_TARGET_TYPE', 'OPTION2_TARGET_TYPE', 'DEFAULT_TARGET_TYPE'],
  );
  assert.deepEqual(
    m.branches[0].fields.map((f) => f.key),
    ['OPTION1_TARGET_TYPE', 'OPTION1_TARGET', 'OPTION1_AUDIO'],
  );
  assert.equal(m.claimed.has('MENU_AUDIO'), false);
  assert.equal(model(n, {}, false).branches[0].id, 'OPTION0_TARGET_TYPE');
  assert.ok(
    model(n, { OPTION0_TARGET_TYPE: 'disconnect' }).branches.some(
      (b) => b.id === 'OPTION0_TARGET_TYPE',
    ),
  );
});
test('only selected choice editors render; terminal destinations hidden when empty, populated ones remain repairable', () => {
  const m = model(menu()),
    render = (f) => `<input data-field="${f.key}">`;
  const html = businessBranchView(m, 'OPTION2_TARGET_TYPE', render);
  assert.match(html, /data-field="OPTION2_TARGET"/);
  assert.doesNotMatch(html, /data-field="OPTION1_TARGET"/);
  assert.match(html, /Afficher aussi les choix non renseignés/);
  const terminal = businessBranchView(m, 'DEFAULT_TARGET_TYPE', render);
  assert.doesNotMatch(terminal, /data-field="DEFAULT_TARGET"/);
  const pending = { DEFAULT_TARGET: 'ancienne destination' };
  assert.match(
    businessBranchView(model(menu(), pending), 'DEFAULT_TARGET_TYPE', render, pending),
    /data-field="DEFAULT_TARGET"/,
  );
});
test('conditions, calendars and distributions group the fields of each outcome', () => {
  for (const [type, prefixes] of [
    ['decision', ['TRUE', 'FALSE']],
    ['schedulegroup', ['OPEN', 'CLOSED', 'HOLIDAY', 'EMERGENCY']],
    ['ratiodistrib', ['RATIO1', 'RATIO2']],
  ]) {
    const row = Object.fromEntries(
      prefixes.flatMap((p) => [
        [p + '_TARGET_TYPE', 'number'],
        [p + '_TARGET', '+33123456789'],
        [p + '_TARGET_AUDIO', 'tts:Bonjour'],
        ...(/^RATIO/.test(p) ? [[p, '50']] : []),
      ]),
    );
    const m = model(fixture(type, row));
    assert.equal(m.branches.length, prefixes.length);
    for (const b of m.branches) {
      const prefix = b.id.replace('_TARGET_TYPE', '');
      assert.ok(b.fields.every((f) => f.key === prefix || f.key.startsWith(prefix + '_')));
    }
  }
});
test('switching a choice retains pending edits and preserves all unrelated DT values', () => {
  const n = menu(),
    original = structuredClone(n.row),
    pending = { OPTION1_AUDIO: 'Annonce modifiée' };
  const m = model(n, pending);
  businessBranchView(m, 'OPTION2_TARGET_TYPE', () => '', pending);
  const row = prepareStepDraft({
    node: n,
    pending,
    visibleValues: { OPTION2_TARGET: '+33123456783' },
  });
  assert.equal(row.OPTION1_AUDIO, 'tts:Annonce modifiée');
  assert.equal(row.OPTION2_TARGET, '+33123456783');
  for (const key of Object.keys(original).filter(
    (k) => !['OPTION1_AUDIO', 'OPTION2_TARGET'].includes(k),
  ))
    assert.deepEqual(row[key], original[key]);
  assert.deepEqual(n.row, original);
});
test('business destination editor keeps technical suffixes without exposing raw-format controls', () => {
  const n = fixture('menu', {
      OPTION1_TARGET_TYPE: 'service|lang:fr-fr',
      OPTION1_TARGET: 'team|pdata:context',
    }),
    field = businessInspectorModel(n).fields.find((f) => f.key === 'OPTION1_TARGET');
  const snapshot = {
    tables: [{ name: 'W_SERVICES_v5', rows: [{ key: 'team', DESCRIPTION: 'Conseil clients' }] }],
  };
  const html = stepFieldView(field, 1, { node: n, snapshot });
  assert.match(html, /value="team\|pdata:context"/);
  assert.match(html, />Conseil clients<\/option>/);
  assert.doesNotMatch(html, /Modifier les paramètres WOLF|field-source-key/);
  assert.match(
    stepFieldView(field, 1, { node: n, snapshot, admin: true }),
    /Modifier les paramètres WOLF/,
  );
});

test('calendar inspector scopes destination, context and controls to the selected outcome', () => {
  const n = fixture('schedulegroup', {
    OPEN_TARGET_TYPE: 'decision|sub:qualifier',
    OPEN_TARGET: 'status|pdata:agence_ouverte',
    OPEN_TARGET_AUDIO: '',
    CLOSED_TARGET_TYPE: 'decision|sub:qualifier',
    CLOSED_TARGET: 'status|pdata:agence_ferme',
    CLOSED_TARGET_AUDIO: '',
  });
  const original = structuredClone(n.row),
    m = model(n),
    render = (f) => `<input data-field="${f.key}">`;
  const closed = businessBranchView(m, 'CLOSED_TARGET_TYPE', render, {}, { admin: true });
  assert.match(closed, /data-field="CLOSED_TARGET"/);
  assert.doesNotMatch(closed, /data-field="OPEN_TARGET"|agence_ouverte/);
  assert.match(closed, /Contexte transmis<\/dt><dd>agence_ferme/);
  assert.match(closed, /Contrôle exécuté<\/dt><dd>qualifier/);
  const pending = { CLOSED_TARGET: 'status|pdata:contexte_modifie' };
  assert.match(
    businessBranchView(model(n, pending), 'CLOSED_TARGET_TYPE', render, pending),
    /contexte_modifie/,
  );
  assert.match(businessBranchView(m, 'OPEN_TARGET_TYPE', render), /agence_ouverte/);
  assert.deepEqual(n.row, original);
});
