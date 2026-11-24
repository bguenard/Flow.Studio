import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { flowDataModel, prepareFlowData, participantOptions } from '../src/flow-data.js';
import { flowDataView } from '../src/flow-data-view.js';
import { applyDesignerDraft } from '../src/designer-draft.js';
import { publicationRows, validatePublicationSelection } from '../src/publication.js';
import {
  participantCatalogueDefinition,
  participantDefinition,
} from '../src/participant-catalogue.js';
const str = (extra = {}) => ({ type: 'string', ...extra });
const schema = (extra) => ({
  type: 'object',
  required: ['key'],
  properties: { key: str(), DESCRIPTION: str(), DIVISION: str(), ...extra },
});
function setup(shared = false) {
  return normalizeSnapshot({
    tables: [
      {
        id: 'entry',
        name: 'W_INBOUND_CALL_v5',
        schema: schema({
          NEXT_TARGET_TYPE: str(),
          NEXT_TARGET: str(),
          DEFAULT_TARGET_TYPE: str(),
          DEFAULT_TARGET: str(),
          WELCOME_AUDIO: str(),
        }),
        rows: [
          {
            key: '1000',
            DESCRIPTION: 'Mon parcours',
            DIVISION: 'France',
            NEXT_TARGET_TYPE: 'decision|sub:check',
            NEXT_TARGET: 'decision|pdata:activation',
            DEFAULT_TARGET_TYPE: 'disconnect',
            DEFAULT_TARGET: '',
            WELCOME_AUDIO: 'tts:Bonjour',
          },
          ...(shared
            ? [
                {
                  key: '2000',
                  DESCRIPTION: 'Autre parcours',
                  DIVISION: 'France',
                  NEXT_TARGET_TYPE: 'decision',
                  NEXT_TARGET: 'decision|pdata:activation',
                },
              ]
            : []),
        ],
      },
      {
        id: 'pdata',
        name: 'W_PARTICIPANT_DATA_v5',
        schema: schema({
          PDATA_NAME: str(),
          PDATA_LIST_1: str({ default: '', maxLength: 100 }),
          PDATA_LIST_2: str({ default: '', maxLength: 100 }),
          EXTRA: str(),
        }),
        rows: [
          {
            key: 'activation',
            PDATA_NAME: 'activation',
            DESCRIPTION: 'Actif',
            DIVISION: 'France',
            PDATA_LIST_1: 'ACTIF==True||AGENCE==ouverte',
            PDATA_LIST_2: 'DYNAMIQUE==$var:client$',
            EXTRA: 'préserver',
          },
        ],
      },
      {
        id: 'decision',
        name: 'W_DECISION_v5',
        schema: schema({
          PARTICIPANT_DATA_TO_CHECK: str(),
          DECISION_OPERATOR: str(),
          DECISION_VALUE: str(),
          TRUE_TARGET_TYPE: str(),
          TRUE_TARGET: str(),
          FALSE_TARGET_TYPE: str(),
          FALSE_TARGET: str(),
        }),
        rows: [
          {
            key: 'decision',
            PARTICIPANT_DATA_TO_CHECK: 'ACTIF',
            DECISION_OPERATOR: '==',
            DECISION_VALUE: 'True',
            TRUE_TARGET_TYPE: 'disconnect',
            TRUE_TARGET: '',
            FALSE_TARGET_TYPE: 'disconnect',
            FALSE_TARGET: '',
          },
        ],
      },
    ],
  });
}
function typedSetup(shared = false) {
  const snapshot = structuredClone(setup(shared));
  snapshot.source.participantCatalogueRequired = true;
  const division = { id: 'g2s', name: 'G2S' },
    active = {
      ...participantDefinition('ACTIF', '', division),
      LABEL: 'Parcours actif',
      VALUE_TYPE: 'boolean',
    },
    agency = {
      ...participantDefinition('AGENCE', 'ouverte', division),
      LABEL: 'Statut de l’agence',
      VALUE_TYPE: 'list',
      ALLOWED_VALUES: JSON.stringify([
        { value: 'ouverte', label: 'Agence ouverte' },
        { value: 'fermee', label: 'Agence fermée' },
      ]),
    };
  snapshot.tables.push({
    id: 'catalogue',
    ...participantCatalogueDefinition('g2s'),
    rows: [
      active,
      agency,
      participantDefinition('DYNAMIQUE', '', division),
      { ...participantDefinition('SEUIL', '', division), VALUE_TYPE: 'integer' },
      participantDefinition('COMMENTAIRE', '', division),
    ],
  });
  return snapshot;
}
const open = (snapshot) => flowDataModel(snapshot, 'entry:1000');
const plan = (snapshot, values = {}, additions = []) =>
  prepareFlowData({
    snapshot,
    flowId: 'entry:1000',
    signature: open(snapshot).signature,
    values,
    additions,
  });
test('catalogue lists attribute names rather than PDATA group keys and marks only entry initializations', () => {
  const snapshot = setup(),
    m = open(snapshot);
  assert.equal(m.items.length, 3);
  assert.deepEqual(m.runtime, []);
  assert.deepEqual(
    participantOptions(snapshot).map((i) => i.name),
    ['ACTIF', 'AGENCE', 'DYNAMIQUE'],
  );
  assert.equal(m.items[2].dynamic, true);
  const changed = structuredClone(snapshot);
  changed.tables[0].rows[0].NEXT_TARGET = 'decision';
  assert.deepEqual(open(changed).runtime, ['ACTIF']);
  assert.equal(open(changed).items.length, 0);
});
test('exclusive initialization edits only the requested value and preserves every unrelated row and column', () => {
  const snapshot = setup(),
    before = structuredClone(snapshot),
    m = open(snapshot),
    p = plan(snapshot, { [m.items[0].id]: 'False' });
  assert.equal(p.createdRows.length, 0);
  assert.equal(p.updatedRows.length, 1);
  assert.deepEqual(p.updatedRows[0].row, {
    ...before.tables[1].rows[0],
    PDATA_LIST_1: 'ACTIF==False||AGENCE==ouverte',
  });
  const applied = applyDesignerDraft({ snapshot, plan: p });
  const entries = publicationRows(applied.snapshot, applied.drafts);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].fields, ['PDATA_LIST_1']);
  assert.deepEqual(snapshot, before);
});
test('shared initialization is copied, entry keeps type options and other flows keep their original group', () => {
  const snapshot = setup(true),
    before = structuredClone(snapshot),
    m = open(snapshot),
    p = plan(snapshot, { [m.items[0].id]: 'False' });
  assert.equal(p.createdRows.length, 1);
  assert.equal(p.updatedRows.length, 1);
  assert.equal(p.createdRows[0].row.EXTRA, 'préserver');
  assert.equal(p.createdRows[0].row.PDATA_NAME, p.createdRows[0].row.key);
  assert.equal(p.updatedRows[0].row.NEXT_TARGET_TYPE, 'decision|sub:check');
  const applied = applyDesignerDraft({ snapshot, plan: p }),
    other = applied.flow.id;
  assert.equal(other, 'entry:1000');
  assert.deepEqual(applied.snapshot.tables[1].rows[0], before.tables[1].rows[0]);
  assert.deepEqual(applied.snapshot.tables[0].rows[1], before.tables[0].rows[1]);
  const entries = publicationRows(
    applied.snapshot,
    applied.drafts,
    new Map(),
    new Map([['init', p.summary]]),
  );
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['create', 'update'],
  );
  assert.ok(entries[1].requiresCreatedRows.includes(entries[0].id));
  assert.deepEqual(entries[0].participantSource, {
    tableId: 'pdata',
    key: 'activation',
    row: before.tables[1].rows[0],
  });
  assert.notEqual(entries[0].participantSource, p.mappings[0].participantSource);
  assert.throws(() => validatePublicationSelection([entries[1]]), /non sélectionnée/);
  assert.deepEqual(snapshot, before);
});
test('new values append to the existing PDATA list and are reachable and ordered before the entry update', () => {
  const snapshot = setup(),
    p = plan(snapshot, {}, [
      { name: 'CRISE', value: 'false' },
      { name: 'SEUIL', value: '15' },
    ]);
  assert.ok(p.createdRows.every((r) => r.row.DIVISION === 'France'));
  assert.deepEqual(
    p.createdRows.map((r) => [r.row.key, r.row.PDATA_NAME, r.row.PDATA_LIST_1]),
    [
      ['CRISE', 'CRISE', 'CRISE==false'],
      ['SEUIL', 'SEUIL', 'SEUIL==15'],
    ],
  );
  const target = p.updatedRows[0].row.NEXT_TARGET;
  assert.equal(target.split('|pdata:').length, 2);
  assert.equal(target, 'decision|pdata:activation;CRISE;SEUIL');
  const applied = applyDesignerDraft({ snapshot, plan: p });
  assert.ok(applied.flow.nodes.some((n) => n.id === p.createdRows[0].nodeId));
  assert.equal(
    open({
      ...applied.snapshot,
      tables: applied.snapshot.tables.map((t) => ({
        ...t,
        rows: t.rows.map((r) => applied.drafts.get(`${t.id}:${r.key}`)?.row || r),
      })),
    }).items.length,
    5,
  );
});
test('blank values remain distinct from false; defaults are not added by merely opening and reviewing', () => {
  const snapshot = setup(),
    m = open(snapshot);
  assert.equal(plan(snapshot).updatedRows.length, 0);
  assert.equal(plan(snapshot).createdRows.length, 0);
  assert.match(
    plan(snapshot, { [m.items[0].id]: '' }).updatedRows[0].row.PDATA_LIST_1,
    /^ACTIF==\|\|/,
  );
});
test('rejects stale plans, duplicate names, delimiters, unknown mandatory columns and calculated edits', () => {
  const snapshot = setup(),
    m = open(snapshot);
  assert.throws(
    () => prepareFlowData({ snapshot, flowId: m.flowId, signature: 'old' }),
    /ont changé/,
  );
  for (const additions of [
    [{ name: 'ACTIF', value: 'false' }],
    [
      { name: 'A', value: 'x' },
      { name: 'A', value: 'y' },
    ],
    [{ name: 'A', value: 'x||B==y' }],
    [{ name: 'A', value: '$var:client$' }],
  ])
    assert.throws(() => plan(snapshot, {}, additions));
  assert.throws(() => plan(snapshot, { [m.items[2].id]: 'x' }), /calculée/);
  const changed = structuredClone(snapshot);
  changed.tables[1].schema.required.push('EXTRA');
  assert.throws(() => plan(changed, {}, [{ name: 'A', value: 'x' }]), /obligatoire/);
});
test('uses schema field capacities and refuses oversize values without mutating the snapshot', () => {
  const snapshot = setup(),
    before = structuredClone(snapshot);
  const p = plan(snapshot, {}, [
    { name: 'A', value: 'a'.repeat(80) },
    { name: 'B', value: 'b'.repeat(80) },
  ]);
  assert.equal(p.createdRows.length, 2);
  assert.match(p.createdRows[1].row.PDATA_LIST_1, /^B==/);
  assert.throws(() => plan(snapshot, {}, [{ name: 'A', value: 'a'.repeat(101) }]), /capacité/);
  assert.deepEqual(snapshot, before);
});
test('page shows boolean switches, calculated values and review rather than publishing directly', () => {
  const model = open(typedSetup()),
    state = { model, values: {}, additions: [], textFields: [] };
  const html = flowDataView(state, 'Mon parcours');
  assert.match(html, /role="switch"/);
  assert.match(html, /Valeur calculée/);
  assert.match(html, /Vérifier les modifications/);
  assert.match(html, /data-action="initialization-open"/);
  const technical = /Architect|bascule du flow|Quand est-ce appliqué|ne prouve pas|lecteur/;
  assert.doesNotMatch(html, technical);
  assert.doesNotMatch(
    flowDataView({ ...state, review: plan(typedSetup()) }, 'Mon parcours'),
    technical,
  );
  assert.doesNotMatch(html, /data-action="publication-publish"/);
});

test('new attribute names are globally unique across definitions, conditions, aliases and drafts', () => {
  const snapshot = structuredClone(setup());
  snapshot.tables[1].rows.push({
    key: 'OTHER_GROUP',
    PDATA_NAME: 'RESERVED_ALIAS',
    PDATA_LIST_1: 'OTHER_ATTRIBUTE==yes',
  });
  snapshot.tables[2].rows.push({ key: 'unreachable', PARTICIPANT_DATA_TO_CHECK: 'RUNTIME_ONLY' });
  const before = structuredClone(snapshot);
  for (const name of [
    'OTHER_ATTRIBUTE',
    'other_attribute',
    'OTHER_GROUP',
    'reserved_alias',
    'RUNTIME_ONLY',
  ])
    assert.throws(() => plan(snapshot, {}, [{ name, value: 'x' }]), /existe déjà/);
  assert.throws(
    () =>
      plan(snapshot, {}, [
        { name: 'NEW', value: 'x' },
        { name: 'new', value: 'y' },
      ]),
    /déjà initialisé/,
  );
  for (const name of ['A;B', 'var:NAME', 'variable', '$var:NAME$'])
    assert.throws(() => plan(snapshot, {}, [{ name, value: 'x' }]), /séparateur/);
  const p = plan(snapshot, {}, [{ name: 'NEW', value: 'x' }]);
  const applied = applyDesignerDraft({ snapshot, plan: p });
  assert.throws(() => plan(applied.snapshot, {}, [{ name: 'NEW', value: 'y' }]), /existe déjà/);
  const entries = publicationRows(
    applied.snapshot,
    applied.drafts,
    new Map(),
    new Map([['new', p.summary]]),
  );
  assert.equal(entries.find((e) => e.key === 'NEW').participantName, 'NEW');
  assert.deepEqual(snapshot, before);
});
test('existing single-attribute definitions are reused without cloning or changing values', () => {
  const snapshot = structuredClone(setup());
  snapshot.tables[1].rows.push({
    key: 'SHARED',
    PDATA_NAME: 'SHARED',
    PDATA_LIST_1: 'SHARED==true',
  });
  const before = structuredClone(snapshot),
    p = plan(snapshot, {}, [{ selection: 'SHARED', name: 'SHARED', value: 'true' }]);
  assert.equal(p.createdRows.length, 0);
  assert.equal(p.updatedRows.length, 1);
  assert.equal(p.updatedRows[0].row.NEXT_TARGET, 'decision|pdata:activation;SHARED');
  const local = plan(snapshot, {}, [{ selection: 'SHARED', name: 'SHARED', value: 'false' }]);
  assert.equal(local.createdRows.length, 1);
  assert.notEqual(local.createdRows[0].row.key, 'SHARED');
  assert.equal(local.createdRows[0].row.PDATA_LIST_1, 'SHARED==false');
  assert.equal(local.createdRows[0].participantName, undefined);
  assert.deepEqual(snapshot, before);
});
test('shared canonical runtime groups fork per flow while keeping the catalogue attribute name stable', () => {
  const snapshot = structuredClone(setup(true));
  snapshot.tables[1].rows.push({ key: 'SHARED', PDATA_LIST_1: 'SHARED==true' });
  for (const row of snapshot.tables[0].rows) row.NEXT_TARGET = 'decision|pdata:SHARED';
  const before = structuredClone(snapshot),
    m = open(snapshot),
    p = plan(snapshot, { [m.items[0].id]: 'false' });
  assert.equal(p.createdRows.length, 1);
  assert.equal(p.createdRows[0].row.PDATA_LIST_1, 'SHARED==false');
  assert.notEqual(p.createdRows[0].row.key, 'SHARED');
  assert.match(p.updatedRows[0].row.NEXT_TARGET, /pdata:STUDIO_INIT_1000/);
  assert.deepEqual(snapshot, before);
  assert.equal(snapshot.tables[0].rows[1].NEXT_TARGET, 'decision|pdata:SHARED');
});
test('a condition-only attribute can be explicitly initialized but cannot be declared as new', () => {
  const snapshot = structuredClone(setup());
  snapshot.tables[2].rows.push({ key: 'later', PARTICIPANT_DATA_TO_CHECK: 'IDENTIFIED' });
  assert.throws(() => plan(snapshot, {}, [{ name: 'IDENTIFIED', value: 'false' }]), /existe déjà/);
  assert.equal(
    plan(snapshot, {}, [{ selection: 'IDENTIFIED', name: 'IDENTIFIED', value: 'false' }])
      .createdRows[0].row.key,
    'IDENTIFIED',
  );
});

test('flow-data errors remain next to the action and are focusable on edit and review screens', () => {
  const model = open(setup()),
    state = { model, values: {}, additions: [], error: 'Nom déjà utilisé' };
  let html = flowDataView(state, 'Mon parcours');
  assert.match(
    html,
    /class="error-box flow-data-error" role="alert" tabindex="-1">Nom déjà utilisé/,
  );
  assert.ok(html.indexOf('Nom déjà utilisé') < html.indexOf('data-action="flow-data-review"'));
  state.review = plan(setup());
  html = flowDataView(state, 'Mon parcours');
  assert.ok(html.indexOf('Nom déjà utilisé') < html.indexOf('data-action="flow-data-save"'));
});

test('business additions require an admin definition and respect its type without creating catalogue rows', () => {
  const snapshot = typedSetup();
  for (const value of ['1.5', '1e2', 'abc', '9007199254740992'])
    assert.throws(
      () => plan(snapshot, {}, [{ selection: 'SEUIL', name: 'SEUIL', value }]),
      /entier/,
    );
  assert.throws(
    () => plan(snapshot, {}, [{ selection: 'INCONNU', name: 'INCONNU', value: 'x' }]),
    /catalogue administrateur/,
  );
  const p = plan(snapshot, {}, [{ selection: 'SEUIL', name: 'SEUIL', value: '15' }]);
  assert.equal(p.createdRows.length, 1);
  assert.equal(p.createdRows[0].tableId, 'pdata');
  assert.equal(p.createdRows[0].row.PDATA_LIST_1, 'SEUIL==15');
  assert.equal(p.createdRows[0].row.DIVISION, 'France');
  assert.equal(p.createdRows[0].participantName, undefined);
  assert.equal(p.mappings[0].participantName, undefined);
});
test('strict catalogue values reject invalid list and boolean edits but preserve unchanged legacy values', () => {
  const snapshot = typedSetup(),
    m = open(snapshot);
  assert.throws(() => plan(snapshot, { [m.items[0].id]: '' }), /Oui ou Non/);
  assert.throws(() => plan(snapshot, { [m.items[1].id]: 'OUVERTE' }), /autorisée/);
  const correct = plan(snapshot, { [m.items[1].id]: 'fermee' });
  assert.match(correct.updatedRows[0].row.PDATA_LIST_1, /AGENCE==fermee/);
  snapshot.tables[1].rows[0].PDATA_LIST_1 = 'ACTIF==legacy||AGENCE==ancienne';
  assert.equal(plan(snapshot).updatedRows.length, 0);
  const old = open(snapshot),
    unrelated = plan(snapshot, { [old.items[1].id]: 'ouverte' });
  assert.match(unrelated.updatedRows[0].row.PDATA_LIST_1, /ACTIF==legacy/);
});
test('changing administrator constraints invalidates a previously opened flow data form', () => {
  const snapshot = typedSetup(),
    model = open(snapshot);
  snapshot.tables.at(-1).rows.find((r) => r.key === 'AGENCE').ALLOWED_VALUES = JSON.stringify([
    { value: 'ouverte', label: 'Ouverte' },
  ]);
  assert.throws(
    () =>
      prepareFlowData({
        snapshot,
        flowId: model.flowId,
        signature: model.signature,
        values: { [model.items[1].id]: 'fermee' },
      }),
    /ont changé/,
  );
});
test('business screen uses only catalogue selectors and typed controls with no definition creation or import', () => {
  const snapshot = typedSetup(),
    model = open(snapshot),
    state = {
      model,
      values: {},
      additions: [
        { selection: 'SEUIL', name: 'SEUIL', value: '2' },
        { selection: 'AGENCE', name: 'AGENCE', value: 'ouverte' },
      ],
    };
  const html = flowDataView(state, 'Mon parcours');
  assert.match(html, /role="switch"/);
  assert.match(html, /inputmode="numeric"/);
  assert.match(html, /value="fermee"[^>]*>Agence fermée/);
  assert.match(html, /data-init-part="selection"/);
  assert.doesNotMatch(
    html,
    /flow-data-create|flow-data-name-mode|flow-data-boolean|flow-data-text|participant-catalogue-import|participant-catalogue-create/,
  );
  assert.match(html, /participant-admin-open/);
  const legacy = flowDataView(
    { model: open(setup()), values: {}, additions: [] },
    'Parcours existant',
  );
  assert.match(legacy, /Donnée existante non référencée/);
  assert.doesNotMatch(legacy, /data-init-id=/);
});
test('missing catalogue prevents typed modifications while leaving unrelated legacy values untouched', () => {
  const snapshot = structuredClone(setup());
  snapshot.source.participantCatalogueRequired = true;
  assert.equal(plan(snapshot).updatedRows.length, 0);
  assert.throws(
    () => plan(snapshot, { [open(snapshot).items[0].id]: 'false' }),
    /catalogue administrateur/,
  );
  assert.throws(
    () => plan(snapshot, {}, [{ selection: 'SEUIL', name: 'SEUIL', value: '2' }]),
    /catalogue partagé/,
  );
});
