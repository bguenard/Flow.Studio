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
  assert.match(html, />team · Conseil clients<\/option>/);
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
  assert.match(closed, /Contrôle exécuté avant cette suite<\/dt>/);
  assert.match(closed, /<strong>qualifier<\/strong>/);
  assert.match(closed, /propre à votre organisation/);
  const pending = { CLOSED_TARGET: 'status|pdata:contexte_modifie' };
  assert.match(
    businessBranchView(model(n, pending), 'CLOSED_TARGET_TYPE', render, pending),
    /contexte_modifie/,
  );
  assert.match(businessBranchView(m, 'OPEN_TARGET_TYPE', render), /agence_ouverte/);
  assert.deepEqual(n.row, original);
});

test('each control of a situation is listed with what the Studio knows about it', () => {
  const n = fixture('decision', {
    TRUE_TARGET_TYPE: 'decision|sub:INFO_ROUTAGE;RECORDING;bot_qualification',
    TRUE_TARGET: 'suite',
    TRUE_TARGET_AUDIO: '',
  });
  const context = {
    snapshot: {
      tables: [
        {
          name: 'W_RECORDING_V5',
          rows: [{ key: 'Home', ENABLE_RECORDING: false, AUDIO_RECORDING: '', CONSENT_MENU: '' }],
        },
      ],
    },
    flow: { nodes: [{ type: 'inboundcall', row: { DIVISION: 'Atlantique' } }, n] },
  };
  const render = (f) => `<input data-field="${f.key}">`;
  const html = businessBranchView(
    model(n),
    'TRUE_TARGET_TYPE',
    render,
    {},
    { admin: true, context },
  );
  assert.match(html, /Contrôles exécutés avant cette suite<\/dt>/);
  assert.doesNotMatch(html, /INFO_ROUTAGE;RECORDING/);
  assert.equal(html.match(/<li class="route-control/g).length, 3);
  assert.match(html, /<strong>Données de contexte<\/strong> <code>INFO_ROUTAGE<\/code>/);
  assert.match(html, /<strong>Enregistrement de l’appel<\/strong> <code>RECORDING<\/code>/);
  assert.match(html, /class="route-control-warning"[^>]*>[^<]*désactivé/);
  assert.match(html, /<strong>bot_qualification<\/strong>/);
  // La vue Métier garde l'explication, sans le nom technique des contrôles connus.
  const business = businessBranchView(
    model(n),
    'TRUE_TARGET_TYPE',
    render,
    {},
    { routing: false, context },
  );
  assert.match(business, /<strong>Enregistrement de l’appel<\/strong>/);
  assert.doesNotMatch(business, /<code>RECORDING<\/code>/);
});

test('menu selector orders digits, star, hash and fallback, but renders only the selected choice', () => {
  const node = fixture('menu', {
    DEFAULT_TARGET_TYPE: 'disconnect',
    DEFAULT_TARGET: '',
    OPTIONDIEZ_TARGET_TYPE: 'disconnect',
    OPTIONDIEZ_TARGET: '',
    OPTION3_TARGET_TYPE: 'service',
    OPTION3_TARGET: 'CONSEIL',
    OPTIONSTAR_TARGET_TYPE: 'disconnect',
    OPTIONSTAR_TARGET: '',
    OPTION1_TARGET_TYPE: 'service',
    OPTION1_TARGET: 'SINISTRES',
    OPTION0_TARGET_TYPE: '',
    OPTION0_TARGET: '',
  });
  const before = structuredClone(node.row),
    branches = model(node, {}, false);
  assert.deepEqual(
    branches.all.map((b) => b.id),
    [
      'OPTION0_TARGET_TYPE',
      'OPTION1_TARGET_TYPE',
      'OPTION3_TARGET_TYPE',
      'OPTIONSTAR_TARGET_TYPE',
      'OPTIONDIEZ_TARGET_TYPE',
      'DEFAULT_TARGET_TYPE',
    ],
  );
  const render = (field) => `<input data-field="${field.key}" value="${field.value}">`;
  const selected = businessBranchView(branches, 'OPTION3_TARGET_TYPE', render);
  assert.match(selected, /value="CONSEIL"/);
  assert.doesNotMatch(selected, /value="SINISTRES"|data-field="OPTIONDIEZ_TARGET/);
  const blank = businessBranchView(branches, 'OPTION0_TARGET_TYPE', render);
  assert.match(blank, /Non configuré : aucune action/);
  assert.doesNotMatch(blank, /Fin d’appel/);
  const terminal = businessBranchView(branches, 'OPTIONDIEZ_TARGET_TYPE', render);
  assert.match(terminal, /Fin d’appel/);
  assert.doesNotMatch(terminal, /Non configuré : aucune action/);
  assert.deepEqual(node.row, before);
});

test('the controls list emitted by the situation panel is styled', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/business-workspace.css', import.meta.url), 'utf8');
  // Les classes produites par la vue doivent exister dans la feuille : sinon la liste perd sa mise en forme.
  for (const selector of [
    '.route-controls {',
    '.route-control span {',
    '.route-control .route-control-warning {',
  ])
    assert.ok(css.includes(selector), selector);
  assert.match(css, /\.route-control \.route-control-warning \{\s*color: #8a4b00;/);
});
