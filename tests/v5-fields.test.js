import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { businessFields } from '../src/business.js';
import { prepareStepDraft } from '../src/step-draft.js';
import { immutableV5Field, referenceOptions, routeTargetKey } from '../src/v5-fields.js';
import { stepFieldView } from '../src/step-field-view.js';
import { configurationFlow } from '../src/configuration-view.js';
import {
  publicationRows,
  validatePublicationRow,
  validatePublicationSelection,
} from '../src/publication.js';
import { configuredStepFields } from '../src/journey-audience.js';
const tables = JSON.parse(
  fs.readFileSync(new URL('./fixtures/v5-field-schemas.json', import.meta.url)),
);
const snapshot = {
  tables: tables.map((t, i) => ({
    ...t,
    id: 't' + i,
    rows: [{ key: 'EXAMPLE', DESCRIPTION: 'Configuration de test' }],
  })),
};
const node = (name, row = {}) => {
  const table = snapshot.tables.find((t) => t.name.toUpperCase() === name.toUpperCase());
  return {
    id: table.id + ':EXAMPLE',
    tableId: table.id,
    tableName: table.name,
    schema: table.schema,
    row: { key: 'EXAMPLE', ...row },
  };
};
test('all settings declared by the 18 observed V5 schemas have an editor, including absent columns', () => {
  assert.equal(tables.length, 18);
  for (const table of tables) {
    const n = node(table.name),
      fields = businessFields(n),
      byKey = new Map(fields.map((f) => [f.key, f]));
    for (const [key, schema] of Object.entries(table.schema.properties)) {
      if (immutableV5Field(n, key)) {
        assert.ok(!byKey.has(key), table.name + ':' + key);
        continue;
      }
      const field = byKey.get(key);
      assert.ok(field, table.name + ':' + key);
      assert.ok(field.editable || field.resource || schema.readOnly, table.name + ':' + key);
      const html = stepFieldView(field, 0, { node: n, snapshot, connected: true });
      assert.match(html, /<(?:input|textarea|select)\b|class="read-value"/, table.name + ':' + key);
    }
  }
});
test('configuration library exposes every V5 table without a numbered journey, and excludes V4', () => {
  for (const table of snapshot.tables) {
    const flow = configurationFlow(snapshot, table.id);
    assert.equal(flow.tableId, table.id);
    assert.deepEqual(flow.nodes[0].schema, table.schema);
  }
  assert.equal(
    configurationFlow({ tables: [{ id: 'old', name: 'W_SERVICES_v4', rows: [] }] }),
    null,
  );
});
test('callback switches, numeric controls and context fields keep schema types through draft and publication', () => {
  const cb = node('W_CALLBACK_v5', {
    CHECK_CB_EXISTS: true,
    KEEP_OLD_CALLBACK: true,
    ACTIVE_SCHEDULE_CB: false,
    COLLECT_SIZE: 10,
  });
  const row = prepareStepDraft({
    node: cb,
    pending: {
      CHECK_CB_EXISTS: 'false',
      KEEP_OLD_CALLBACK: 'false',
      ACTIVE_SCHEDULE_CB: 'true',
      COLLECT_SIZE: '12',
    },
  });
  assert.equal(row.CHECK_CB_EXISTS, false);
  assert.equal(row.KEEP_OLD_CALLBACK, false);
  assert.equal(row.ACTIVE_SCHEDULE_CB, true);
  assert.equal(row.COLLECT_SIZE, 12);
  const source = {
      tables: [{ id: cb.tableId, name: cb.tableName, schema: cb.schema, rows: [cb.row] }],
    },
    drafts = new Map([
      [cb.id, { nodeId: cb.id, tableId: cb.tableId, key: 'EXAMPLE', original: cb.row, row }],
    ]);
  const [entry] = publicationRows(source, drafts);
  assert.equal(entry.after.COLLECT_SIZE, 12);
  assert.ok(entry.fields.includes('CHECK_CB_EXISTS'));
  validatePublicationRow(entry.after, cb.schema, entry.fields);
  const pd = node('W_PARTICIPANT_DATA_v5');
  assert.equal(
    prepareStepDraft({ node: pd, pending: { PDATA_LIST_1: 'CRISE==ACTIF||PRIORITE==haute' } })
      .PDATA_LIST_1,
    'CRISE==ACTIF||PRIORITE==haute',
  );
  assert.throws(
    () => prepareStepDraft({ node: pd, pending: { PDATA_LIST_1: 'CRISE:ACTIF' } }),
    /nom==valeur/,
  );
});
test('empty optional controls do not turn null, missing values, zero or false into defaults', () => {
  const n = node('W_CALLBACK_v5', {
    COLLECT_MENU_REPEAT: 0,
    USE_CALLER_ANI: false,
    COLLECT_SIZE: null,
  });
  assert.deepEqual(
    prepareStepDraft({
      node: n,
      visibleValues: {
        COLLECT_MENU_REPEAT: '0',
        USE_CALLER_ANI: 'false',
        COLLECT_SIZE: '',
        KEEP_OLD_CALLBACK: '',
      },
    }),
    n.row,
  );
  assert.throws(() => prepareStepDraft({ node: n, pending: { COLLECT_SIZE: '' } }), /nombre/);
  n.schema = structuredClone(n.schema);
  n.schema.properties.COLLECT_SIZE.type = ['integer', 'null'];
  assert.equal(prepareStepDraft({ node: n, pending: { COLLECT_SIZE: '' } }).COLLECT_SIZE, null);
});
test('cross-field bounds, menu timings and ratio weights reject inconsistent edits', () => {
  const bounds = node('W_CHECK_EWT_PIQ_v5', { LOWER_BOUND: 5, UPPER_BOUND: 10 });
  assert.throws(
    () => prepareStepDraft({ node: bounds, pending: { LOWER_BOUND: '11' } }),
    /borne basse/,
  );
  assert.equal(
    prepareStepDraft({ node: bounds, pending: { LOWER_BOUND: '0', UPPER_BOUND: '0' } }).LOWER_BOUND,
    0,
  );
  assert.throws(
    () => prepareStepDraft({ node: node('W_MENU_v5'), pending: { MENU_TIMEOUT: '4' } }),
    /secondes/,
  );
  const ratios = node('W_RATIO_DISTRIB_v5', { RATIO1: 1, RATIO2: 0 });
  assert.throws(() => prepareStepDraft({ node: ratios, pending: { RATIO1: '0' } }), /poids/);
  assert.equal(prepareStepDraft({ node: ratios, pending: { RATIO1: '0', RATIO2: '3' } }).RATIO2, 3);
});
test('local references use exact row keys and validate missing destinations and WOLF parameters', () => {
  const recording = node('W_RECORDING_v5');
  assert.equal(
    prepareStepDraft({ node: recording, snapshot, pending: { CONSENT_MENU: 'EXAMPLE' } })
      .CONSENT_MENU,
    'EXAMPLE',
  );
  assert.throws(
    () => prepareStepDraft({ node: recording, snapshot, pending: { CONSENT_MENU: 'UNKNOWN' } }),
    /absente/,
  );
  const menu = node('W_MENU_v5', { OPTION1_TARGET_TYPE: 'disconnect', OPTION1_TARGET: '' });
  const row = prepareStepDraft({
    node: menu,
    snapshot,
    pending: { OPTION1_TARGET_TYPE: 'service|lang:fr-fr', OPTION1_TARGET: 'EXAMPLE|pdata:EXAMPLE' },
  });
  assert.equal(row.OPTION1_TARGET, 'EXAMPLE|pdata:EXAMPLE');
  assert.ok(
    configuredStepFields(businessFields(menu), { OPTION1_TARGET_TYPE: 'service' }).some(
      (f) => f.key === 'OPTION1_TARGET',
    ),
  );
  assert.throws(
    () => prepareStepDraft({ node: menu, snapshot, pending: { OPTION1_TARGET_TYPE: 'service' } }),
    /destination/,
  );
  assert.throws(
    () =>
      prepareStepDraft({
        node: menu,
        snapshot,
        pending: { OPTION1_TARGET_TYPE: 'service|satus:ON_QUEUE', OPTION1_TARGET: 'EXAMPLE' },
      }),
    /paramètres/,
  );
  assert.equal(
    routeTargetKey('BUSY_TARGET_TYPE', node('W_CHECK_INTERACTION_NB_v5').schema.properties),
    'TARGET',
  );
  assert.equal(
    routeTargetKey('BETWEEN_BOUNDS_TARGET_TYPE', node('W_CHECK_EWT_PIQ_v5').schema.properties),
    'BETWEEN_BOUND_TARGET',
  );
  assert.equal(referenceOptions('W_MENU_v5', snapshot)[0].value, 'EXAMPLE');
});
test('schema readonly, enum, pattern and stable row identities remain enforced', () => {
  const n = node('W_CALLBACK_v5');
  n.schema = structuredClone(n.schema);
  n.schema.properties.COUNTRY_CODE = { type: 'string', pattern: '^[0-9]+$', enum: ['33', '44'] };
  assert.equal(prepareStepDraft({ node: n, pending: { COUNTRY_CODE: '33' } }).COUNTRY_CODE, '33');
  assert.throws(() => prepareStepDraft({ node: n, pending: { COUNTRY_CODE: 'abc' } }), /format/);
  n.schema.properties.COUNTRY_CODE.readOnly = true;
  assert.equal(businessFields(n).find((f) => f.key === 'COUNTRY_CODE').editable, false);
  assert.throws(
    () => prepareStepDraft({ node: n, pending: { COUNTRY_CODE: '44' } }),
    /ne peut pas/,
  );
  assert.throws(
    () => validatePublicationRow({ ...n.row, COUNTRY_CODE: '44' }, n.schema, ['COUNTRY_CODE']),
    /lecture seule/,
  );
  assert.throws(() => prepareStepDraft({ node: n, pending: { key: 'NEW' } }), /ne peut pas/);
});
test('recording audio supports TTS and Genesys prompt selection, and division cannot be cleared', () => {
  const n = node('W_RECORDING_v5', { AUDIO_RECORDING: 'pr:Message', DIVISION: 'France' });
  assert.equal(
    prepareStepDraft({ node: n, pending: { AUDIO_RECORDING: 'Cet appel sera enregistré.' } })
      .AUDIO_RECORDING,
    'tts:Cet appel sera enregistré.',
  );
  assert.equal(
    prepareStepDraft({
      node: n,
      pending: { AUDIO_RECORDING: { resource: 'pr:Autre' } },
      catalogues: { prompts: [{ id: 'p', name: 'Autre' }] },
    }).AUDIO_RECORDING,
    'pr:Autre',
  );
  assert.throws(
    () =>
      prepareStepDraft({
        node: node('W_CALLBACK_v5', { DIVISION: 'France' }),
        pending: { DIVISION: { resource: '' } },
      }),
    /division Genesys/,
  );
});
test('publication includes new-menu dependencies from recording and exceptional V5 target columns', () => {
  const source = structuredClone(snapshot),
    drafts = new Map();
  for (const name of ['W_RECORDING_V5', 'W_CHECK_INTERACTION_NB_v5', 'W_CHECK_EWT_PIQ_v5']) {
    const n = node(name),
      original = source.tables.find((t) => t.id === n.tableId).rows[0];
    const delta =
      name === 'W_RECORDING_V5'
        ? { CONSENT_MENU: 'EXAMPLE' }
        : name === 'W_CHECK_INTERACTION_NB_v5'
          ? { BUSY_TARGET_TYPE: 'menu', TARGET: 'EXAMPLE' }
          : { BETWEEN_BOUNDS_TARGET_TYPE: 'menu', BETWEEN_BOUND_TARGET: 'EXAMPLE' };
    drafts.set(n.id, { original, row: { ...original, ...delta } });
  }
  const menu = node('W_MENU_v5'),
    created = new Map([['new-menu', { mappings: [{ nodeId: menu.id }] }]]);
  const rows = publicationRows(source, drafts, created);
  for (const row of rows.filter((r) => r.kind === 'update')) {
    assert.ok(row.requiresCreatedRows.includes(menu.id));
    assert.throws(() => validatePublicationSelection([row]), /incomplète/);
  }
  assert.equal(rows[0].id, menu.id);
  validatePublicationSelection(rows);
});
