import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participantCatalogueDefinition,
  participantDefinition,
  participantChoices,
  validateParticipantValue,
  validateParticipantDefinition,
  validateParticipantDefinitionChange,
} from '../src/participant-catalogue.js';
import { createParticipantCatalogueClient } from '../src/genesys-participant-catalogue.js';
import {
  participantAdminView,
  participantEditor,
  participantEditorRow,
} from '../src/participant-admin-view.js';
const division = { id: 'g', name: 'G2S' };
const def = (key, type = 'text', value = '', choices = []) => ({
  ...participantDefinition(key, value, division),
  VALUE_TYPE: type,
  ALLOWED_VALUES: choices.length ? JSON.stringify(choices) : '',
});
function harness({ legacy = false } = {}) {
  let table = { id: 'c', ...participantCatalogueDefinition('g') };
  if (legacy) delete table.schema.properties.ALLOWED_VALUES;
  const rows = [],
    runtime = [],
    conditions = [],
    calls = [];
  let failWrite = false;
  const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
  const fetchImpl = async (url, opt) => {
    const u = new URL(url),
      path = u.pathname.replace('/api/v2', ''),
      body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ path, method: opt.method, body });
    if (path === '/users/me') return ok({ id: 'u', organization: { id: 'org' } });
    if (path === '/authorization/divisions/g') return ok(division);
    if (path === '/flows/datatables')
      return ok({
        pageNumber: 1,
        pageCount: 1,
        entities: [
          table,
          { id: 'p', name: 'W_PARTICIPANT_DATA_v5' },
          { id: 'd', name: 'W_DECISION_v5' },
        ],
      });
    if (path === '/flows/datatables/c' && opt.method === 'PUT') {
      table = { ...table, ...body };
      return ok(table);
    }
    if (path === '/flows/datatables/c') return ok(table);
    if (path === '/flows/datatables/p/rows') return ok({ pageCount: 1, entities: runtime });
    if (path === '/flows/datatables/d/rows') return ok({ pageCount: 1, entities: conditions });
    if (path === '/flows/datatables/c/rows' && opt.method === 'GET')
      return ok({
        pageCount: 1,
        entities: rows.map((r) => ({
          ...r,
          ...(table.schema.properties.ALLOWED_VALUES
            ? { ALLOWED_VALUES: r.ALLOWED_VALUES || '' }
            : {}),
        })),
      });
    if (path === '/flows/datatables/c/rows' && opt.method === 'POST') {
      if (failWrite) throw Error('lost response');
      assert.equal(
        rows.some((r) => r.key === body.key),
        false,
      );
      rows.push(body);
      return ok(body);
    }
    if (path.startsWith('/flows/datatables/c/rows/')) {
      const key = decodeURIComponent(path.split('/').at(-1)),
        i = rows.findIndex((r) => r.key === key);
      if (opt.method === 'PUT') {
        if (failWrite) throw Error('lost response');
        rows[i] = body;
        return ok(body);
      }
      return i < 0 ? { ok: false, status: 404 } : ok(rows[i]);
    }
    throw Error('Unexpected ' + opt.method + ' ' + path);
  };
  return {
    rows,
    runtime,
    conditions,
    calls,
    get table() {
      return table;
    },
    get client() {
      return createParticipantCatalogueClient('token', { organizationId: 'org', fetchImpl });
    },
    set failWrite(v) {
      failWrite = v;
    },
  };
}
test('typed catalogue upgrade is additive, preserves every original column and existing row', async () => {
  const h = harness({ legacy: true }),
    before = structuredClone(h.table.schema);
  h.rows.push(participantDefinition('ACTIVE', 'true', division));
  const original = structuredClone(h.rows);
  const state = await h.client.upgrade();
  assert.ok(state.table.schema.properties.ALLOWED_VALUES);
  for (const key of Object.keys(before.properties))
    assert.deepEqual(state.table.schema.properties[key], before.properties[key]);
  assert.deepEqual(h.rows, original);
  assert.deepEqual(
    h.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path]),
    [['PUT', '/flows/datatables/c']],
  );
  await h.client.upgrade();
  assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 1);
});
test('admin creates all four types with read-back; labels and choice labels can change without changing runtime values', async () => {
  const h = harness(),
    client = h.client;
  for (const row of [
    def('TEXT'),
    def('COUNT', 'integer', '3'),
    def('ACTIVE', 'boolean', 'false'),
    def('STATUS', 'list', 'OPEN', [
      { value: 'OPEN', label: 'Ouverte' },
      { value: 'CLOSED', label: 'Fermée' },
    ]),
  ])
    await client.saveDefinition(await client.prepareDefinition(row));
  h.runtime.push({ key: 'runtime', PDATA_LIST_1: 'STATUS==OPEN' });
  const before = structuredClone(h.rows.find((r) => r.key === 'STATUS')),
    after = {
      ...before,
      LABEL: 'Statut agence',
      ALLOWED_VALUES: JSON.stringify([
        { value: 'OPEN', label: 'Agence ouverte' },
        { value: 'CLOSED', label: 'Agence fermée' },
      ]),
    };
  const result = await client.saveDefinition(await client.prepareDefinition(after, before));
  assert.equal(result.table.rows.find((r) => r.key === 'STATUS').LABEL, 'Statut agence');
  assert.equal(h.runtime[0].PDATA_LIST_1, 'STATUS==OPEN');
  assert.ok(
    h.calls
      .filter((c) => c.method !== 'GET')
      .every((c) => c.path.startsWith('/flows/datatables/c/rows')),
  );
});
test('duplicate names, case variants and incompatible used types are rejected before mutation', async () => {
  const h = harness(),
    client = h.client;
  h.rows.push(def('ACTIVE', 'text', 'unknown'));
  h.runtime.push({ key: 'r', PDATA_LIST_1: 'ACTIVE==unknown' });
  await assert.rejects(client.prepareDefinition(def('active')), /existe déjà/);
  await assert.rejects(
    client.prepareDefinition({ ...h.rows[0], VALUE_TYPE: 'boolean', DEFAULT_VALUE: '' }, h.rows[0]),
    /choisissez Oui ou Non/,
  );
  const old = def('STATUS', 'list', '', [
    { value: 'OPEN', label: 'Ouverte' },
    { value: 'CLOSED', label: 'Fermée' },
  ]);
  h.rows.push(old);
  h.conditions.push({
    key: 'd',
    PARTICIPANT_DATA_TO_CHECK: 'STATUS',
    DECISION_OPERATOR: '==',
    DECISION_VALUE: 'CLOSED',
  });
  await assert.rejects(
    client.prepareDefinition(
      { ...old, ALLOWED_VALUES: JSON.stringify([{ value: 'OPEN', label: 'Ouverte' }]) },
      old,
    ),
    /valeur autorisée/,
  );
  assert.equal(
    h.calls.some((c) => c.method !== 'GET'),
    false,
  );
});
test('fresh usage and concurrent definition changes invalidate reviewed changes', async () => {
  const h = harness(),
    client = h.client;
  const old = def('COUNT');
  h.rows.push(old);
  const plan = await client.prepareDefinition({ ...old, VALUE_TYPE: 'integer' }, old);
  h.runtime.push({ key: 'r', PDATA_LIST_1: 'COUNT==two' });
  await assert.rejects(client.saveDefinition(plan), /entier/);
  h.runtime.length = 0;
  const second = await client.prepareDefinition({ ...old, LABEL: 'Compteur' }, old);
  h.rows[0] = { ...old, LABEL: 'Concurrent' };
  await assert.rejects(client.saveDefinition(second), /changé/);
  assert.equal(
    h.calls.some((c) => c.method !== 'GET'),
    false,
  );
});
test('opaque review cannot be altered and an uncertain write is not retried', async () => {
  const h = harness(),
    client = h.client,
    row = def('ACTIVE', 'boolean', 'true');
  const plan = await client.prepareDefinition(row);
  plan.after.key = 'MUTATED';
  await client.saveDefinition(plan);
  assert.equal(h.rows[0].key, 'ACTIVE');
  await assert.rejects(client.saveDefinition(plan), /Relancez/);
  const next = await client.prepareDefinition(def('OTHER'));
  h.failWrite = true;
  await assert.rejects(client.saveDefinition(next), /Réponse/);
  await assert.rejects(client.saveDefinition(next), /Relancez/);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 2);
});
test('typed values and option definitions reject dangerous separators, duplicates, decimals, unsafe integers and unknown literals', () => {
  for (const value of ['1.2', '1e3', '9007199254740992', ''])
    assert.throws(() => validateParticipantValue(def('N', 'integer'), value), /entier/);
  assert.equal(validateParticipantValue(def('N', 'integer'), '-12'), '-12');
  assert.throws(() => validateParticipantValue(def('BOOL', 'boolean'), 'yes'), /Oui ou Non/);
  assert.throws(
    () =>
      validateParticipantDefinition(
        def('L', 'list', '', [
          { value: 'A', label: 'A' },
          { value: 'a', label: 'a' },
        ]),
      ),
    /plusieurs/,
  );
  assert.throws(() => validateParticipantValue(def('S'), 'a||b'), /séparateur/);
  assert.throws(
    () => validateParticipantDefinitionChange(def('S'), def('T'), { tables: [] }),
    /immuable/,
  );
});
test('admin editor builds string-backed schema and keeps technical keys stable in UI', () => {
  const row = def('STATUS', 'list', 'OPEN', [{ value: 'OPEN', label: 'Ouverte' }]),
    editor = participantEditor(row);
  editor.label = 'Statut agence';
  assert.equal(participantEditorRow(editor, [division]).key, 'STATUS');
  const html = participantAdminView(
    { editor },
    {
      catalogue: {
        status: 'ready',
        table: { id: 'c', ...participantCatalogueDefinition('g'), rows: [row] },
      },
      divisions: [division],
      snapshot: { tables: [] },
    },
  );
  assert.match(html, /participant-admin-key[^>]*readonly/);
  assert.match(html, /choice-value-0[^>]*readonly/);
  assert.match(html, /Vérifier la définition/);
  assert.doesNotMatch(html, /Supprimer la donnée/);
});
