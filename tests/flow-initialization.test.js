import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_INITIALIZATION,
  FLOW_INITIALIZATION_FIELDS,
  flowInitializationDefinition,
  validateFlowInitializationTable,
  validateFlowInitializationRow,
  validateFlowInitializationCatalogue,
  initializationAttributes,
  createFlowInitializationRow,
} from '../src/flow-initialization.js';
import { participantCatalogueDefinition } from '../src/participant-catalogue.js';
const definition = (key, type = 'text', extra = {}) => ({
  key,
  LABEL: key,
  DIVISION: 'G2S',
  DIVISION_ID: 'g2s',
  VALUE_TYPE: type,
  DEFAULT_VALUE: '',
  ALLOWED_VALUES: '',
  ...extra,
});
function fixture() {
  return {
    source: { partial: false },
    tables: [
      {
        id: 'entries',
        name: 'W_INBOUND_CALL_V5',
        rows: [
          {
            key: '+33999999501',
            DESCRIPTION: 'Gan · Relation client',
            DIVISION: 'Gan',
            NEXT_TARGET: 'MENU|audio:keep|pdata:BASE;LOCAL|extra:untouched',
            NEXT_TARGET_TYPE: 'menu',
            CLOSED_TARGET: 'X|pdata:LATER',
          },
        ],
      },
      {
        id: 'pdata',
        name: 'W_PARTICIPANT_DATA_v5',
        rows: [
          { key: 'BASE', PDATA_LIST_1: 'ACTIVE==TRUE||COUNT==+003', UNRELATED: 'keep' },
          { key: 'LOCAL', PDATA_LIST_1: 'STATUS==OPEN', PDATA_LIST_2: 'NOTE==  exact  ' },
          { key: 'LATER', PDATA_LIST_1: 'NEVER_ENTRY==later' },
          { key: 'BROKEN_UNRELATED', PDATA_LIST_1: 'malformed' },
        ],
      },
      {
        id: 'catalogue',
        ...participantCatalogueDefinition('g2s'),
        rows: [
          definition('ACTIVE', 'boolean'),
          definition('COUNT', 'integer'),
          definition('STATUS', 'list', {
            ALLOWED_VALUES: JSON.stringify([
              { value: 'OPEN', label: 'Ouverte' },
              { value: 'CLOSED', label: 'Fermée' },
            ]),
          }),
          definition('NOTE'),
        ],
      },
    ],
  };
}
const attributes = () => [
  { name: 'ACTIVE', value: 'TRUE' },
  { name: 'COUNT', value: '+003' },
  { name: 'STATUS', value: 'OPEN' },
  { name: 'NOTE', value: '  exact  ' },
];
const create = (snapshot = fixture(), items = attributes()) =>
  createFlowInitializationRow(
    {
      key: '+33999999501',
      description: 'Gan · Relation client',
      division: 'Gan',
      attributes: items,
    },
    snapshot,
  );
const target = (rows) => ({ id: 'init', ...flowInitializationDefinition('g2s'), rows });
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('dedicated schema owns exactly 48 strings and fifteen distinct triplets', () => {
  const table = target([]);
  assert.equal(table.name, FLOW_INITIALIZATION);
  assert.equal(Object.keys(table.schema.properties).length, 48);
  assert.deepEqual(Object.keys(table.schema.properties), FLOW_INITIALIZATION_FIELDS);
  assert.equal(table.schema.properties.ATTRIBUTE_15_VALUE.type, 'string');
  assert.equal(validateFlowInitializationTable(table), table);
  for (const field of FLOW_INITIALIZATION_FIELDS)
    assert.equal(table.schema.properties[field].type, 'string');
  assert.throws(() => flowInitializationDefinition(''), /division/);
});
test('foreign, narrowed and ambiguous schemas cannot receive initialization writes', () => {
  for (const mutation of [
    (t) => (t.description = 'foreign'),
    (t) => delete t.schema.properties.ATTRIBUTE_15_VALUE,
    (t) => (t.schema.properties.SURPRISE = { type: 'string' }),
    (t) => (t.schema.properties.ATTRIBUTE_01_VALUE.type = 'boolean'),
    (t) => (t.schema.properties.ATTRIBUTE_01_VALUE.readOnly = true),
    (t) => t.schema.required.push('DESCRIPTION'),
    (t) => (t.schema.additionalProperties = true),
  ]) {
    const t = target([]);
    mutation(t);
    assert.throws(() => validateFlowInitializationTable(t), /incompatible/);
  }
});
test('capacity accepts exactly fifteen and rejects a sixteenth rather than truncating', () => {
  const s = fixture(),
    attributes = Array.from({ length: 16 }, (_, i) => ({ name: 'ATTR_' + i, value: String(i) }));
  s.tables[2].rows.push(...attributes.map((a) => definition(a.name)));
  const row = createFlowInitializationRow({ key: '100', attributes: attributes.slice(0, 15) }, s);
  assert.equal(initializationAttributes(row).length, 15);
  assert.equal(row.ATTRIBUTE_15_NAME, 'ATTR_14');
  assert.throws(() => createFlowInitializationRow({ key: '100', attributes }, s), /maximum 15/);
});
test('row validation rejects orphan triplets, extra fields, nonstrings, ambiguous names and unsafe numbers', () => {
  const good = create();
  for (const patch of [
    { key: ' ROOT ' },
    { ATTRIBUTE_01_NAME: '' },
    { ATTRIBUTE_01_VALUE: true },
    { ATTRIBUTE_02_VALUE: '9007199254740992' },
    { ATTRIBUTE_01_TYPE: 'boolean' },
    { ATTRIBUTE_15_NAME: 'NEW' },
    { ATTRIBUTE_16_NAME: 'TOO_MANY' },
    { ATTRIBUTE_02_NAME: 'active' },
    { EXTRA: 'x' },
  ])
    assert.throws(() => validateFlowInitializationRow({ ...good, ...patch }));
  const blank = {
    key: '00100',
    ATTRIBUTE_01_NAME: 'NOTE',
    ATTRIBUTE_01_TYPE: 'string',
    ATTRIBUTE_01_VALUE: '',
  };
  assert.equal(validateFlowInitializationRow(blank), blank);
});
test('catalogue matching is exact and verifies declared runtime type', () => {
  const s = fixture(),
    row = create(s);
  assert.equal(validateFlowInitializationCatalogue(row, s), row);
  assert.throws(
    () => validateFlowInitializationCatalogue({ ...row, ATTRIBUTE_01_TYPE: 'string' }, s),
    /type/,
  );
  assert.throws(
    () => validateFlowInitializationCatalogue({ ...row, ATTRIBUTE_01_NAME: 'active' }, s),
    /absent/,
  );
});

test('initialization retains exact values, types, division and immutable catalogue', () => {
  const source = fixture(),
    before = structuredClone(source);
  freeze(source);
  const row = create(source);
  assert.deepEqual(
    initializationAttributes(row).map(({ name, type, value }) => ({ name, type, value })),
    [
      { name: 'ACTIVE', type: 'bool', value: 'TRUE' },
      { name: 'COUNT', type: 'int', value: '+003' },
      { name: 'STATUS', type: 'string', value: 'OPEN' },
      { name: 'NOTE', type: 'string', value: '  exact  ' },
    ],
  );
  assert.equal(row.key, '+33999999501');
  assert.equal(row.DIVISION, 'Gan');
  assert.equal(row.ATTRIBUTE_15_NAME, '');
  assert.deepEqual(source, before);
});
test('unknown names, duplicate attributes and invalid typed values are rejected', () => {
  for (const items of [
    [{ name: 'UNKNOWN', value: 'x' }],
    [{ name: 'STATUS', value: 'open' }],
    [{ name: 'COUNT', value: '1.5' }],
    [{ name: 'ACTIVE', value: 'yes' }],
    [
      { name: 'ACTIVE', value: 'true' },
      { name: 'active', value: 'false' },
    ],
  ])
    assert.throws(() => create(fixture(), items));
});
test('calculated values are not accepted as entry literals', () => {
  for (const value of ['$var:CLIENT$', 'var:CLIENT', 'variable'])
    assert.throws(() => create(fixture(), [{ name: 'NOTE', value }]), /calculée/);
});
test('empty, false and zero remain distinct; rows do not share values', () => {
  const snapshot = fixture(),
    a = create(snapshot, [
      { name: 'ACTIVE', value: 'false' },
      { name: 'COUNT', value: '0' },
      { name: 'NOTE', value: '' },
    ]),
    b = create(snapshot);
  assert.deepEqual(
    initializationAttributes(a).map((a) => a.value),
    ['false', '0', ''],
  );
  a.ATTRIBUTE_01_VALUE = 'true';
  assert.equal(b.ATTRIBUTE_01_VALUE, 'TRUE');
  assert.equal(initializationAttributes(create(snapshot, [])).length, 0);
});
test('missing, ambiguous or invalid catalogue prevents creation', () => {
  const missing = fixture();
  missing.tables.pop();
  assert.throws(() => create(missing), /catalogue|STUDIO_PARTICIPANT/);
  const bad = fixture();
  bad.tables[2].rows[0].VALUE_TYPE = 'unknown';
  assert.throws(() => create(bad), /Type/);
  const duplicate = fixture();
  duplicate.tables.push(structuredClone(duplicate.tables[2]));
  assert.throws(() => create(duplicate), /Une seule table/);
});
