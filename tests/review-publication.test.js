import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicationClient,
  restorationRows,
  orderPublicationEntries,
} from '../src/publication.js';
import { publicationPreflight } from '../src/publication-preflight.js';
import { validateV5Edits } from '../src/v5-fields.js';

const schema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string' },
    DESCRIPTION: { type: 'string' },
    PRIORITY: { type: 'integer', minimum: 0 },
    QUEUE: { type: 'string' },
    WELCOME_AUDIO: { type: 'string' },
  },
};
// The source row has no PRIORITY column: Genesys omits unset values.
const original = { key: 'Team', DESCRIPTION: 'Équipe', QUEUE: 'Q Auto' };
const entry = (overrides = {}) => ({
  id: 'table:Team',
  tableId: 'table',
  table: 'W_SERVICES_v5',
  key: 'Team',
  label: 'Équipe',
  kind: 'update',
  before: structuredClone(original),
  after: { ...original, PRIORITY: 4 },
  ...overrides,
});
function harness() {
  const rows = new Map([[original.key, structuredClone(original)]]),
    calls = [],
    journal = [];
  let hook = null;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, body: options.body });
    if (hook) {
      const result = await hook(path, options);
      if (result) return result;
    }
    const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
    if (path.endsWith('/routing/queues'))
      return ok({ entities: [{ id: 'q', name: 'Q Auto' }], pageNumber: 1, pageCount: 1 });
    if (path.endsWith('/architect/prompts'))
      return ok({ entities: [{ id: 'p', name: 'Accueil' }], pageNumber: 1, pageCount: 1 });
    if (path.endsWith('/users/me')) return ok({ id: 'user', name: 'Utilisateur' });
    if (path.endsWith('/organizations/me')) return ok({ id: 'org', name: 'Organisation' });
    if (path.endsWith('/datatables/table'))
      return ok({ id: 'table', name: 'W_SERVICES_v5', schema });
    if (options.method === 'POST') {
      const row = JSON.parse(options.body);
      rows.set(row.key, row);
      return ok(row);
    }
    const key = decodeURIComponent(path.split('/rows/')[1]);
    if (options.method === 'PUT') {
      const row = JSON.parse(options.body);
      rows.set(key, row);
      return ok(row);
    }
    if (rows.has(key)) return ok(rows.get(key));
    return { ok: false, status: 404 };
  };
  return {
    rows,
    calls,
    journal,
    client: createPublicationClient('secret-token', { fetchImpl }),
    setHook: (value) => (hook = value),
    save: async (run) => journal.push(structuredClone(run)),
  };
}
const publish = async (h, entries, options = {}) =>
  h.client.publish(await h.client.prepare(entries, { organizationId: 'org', ...options }), {
    journal: h.save,
  });

test('restoration removes a setting the publication added, alone or with other changes', async () => {
  for (const after of [
    { ...original, PRIORITY: 4 },
    { ...original, PRIORITY: 4, DESCRIPTION: 'Équipe renommée' },
  ]) {
    const h = harness(),
      run = await publish(h, [entry({ after })]);
    assert.equal(run.status, 'verified');
    assert.equal(h.rows.get('Team').PRIORITY, 4);
    const restored = await publish(h, restorationRows(run), { source: 'restore:' + run.id });
    assert.equal(restored.status, 'verified');
    assert.deepEqual(h.rows.get('Team'), original);
  }
});

test('a restoration that Genesys does not fully apply is never reported as verified', async () => {
  const h = harness(),
    run = await publish(h, [
      entry({ after: { ...original, PRIORITY: 4, DESCRIPTION: 'Équipe renommée' } }),
    ]);
  const plan = await h.client.prepare(restorationRows(run), {
    organizationId: 'org',
    source: 'restore:' + run.id,
  });
  h.setHook((path, options) => {
    if (options.method === 'PUT') {
      h.rows.set('Team', { ...JSON.parse(options.body), PRIORITY: 4 });
      return { ok: true, status: 200, json: async () => ({}) };
    }
  });
  const restored = await h.client.publish(plan, { journal: h.save });
  assert.equal(restored.status, 'uncertain');
  assert.equal(restored.entries[0].status, 'uncertain');
});

test('an ordinary publication never drops a column that its draft does not carry', async () => {
  const h = harness();
  h.rows.set('Team', { ...original, PRIORITY: 2 });
  const run = await publish(h, [
    entry({
      before: { ...original, PRIORITY: 2 },
      after: { ...original, DESCRIPTION: 'Équipe renommée' },
    }),
  ]);
  assert.equal(run.status, 'verified');
  assert.deepEqual(h.rows.get('Team'), {
    ...original,
    PRIORITY: 2,
    DESCRIPTION: 'Équipe renommée',
  });
});

test('a new entry is written after every block it routes to, even when a block routes back to it', () => {
  const inbound = {
    id: 'in:+331',
    table: 'W_INBOUND_CALL_v5',
    kind: 'create',
    requiresCreatedRows: ['menu:M'],
  };
  const menu = {
    id: 'menu:M',
    table: 'W_MENU_v5',
    kind: 'create',
    requiresCreatedRows: ['svc:S', 'in:+331'],
  };
  const service = { id: 'svc:S', table: 'W_SERVICES_v5', kind: 'create', requiresCreatedRows: [] };
  const reroute = {
    id: 'menu:OLD',
    table: 'W_MENU_v5',
    kind: 'update',
    requiresCreatedRows: ['in:+331'],
  };
  for (const entries of [
    [inbound, menu, service, reroute],
    [reroute, service, menu, inbound],
    [menu, inbound, reroute, service],
  ]) {
    const ids = orderPublicationEntries(entries).map((item) => item.id);
    assert.deepEqual(ids.slice(2), ['in:+331', 'menu:OLD'], ids.join(' '));
    assert.ok(ids.indexOf('svc:S') < ids.indexOf('menu:M'), ids.join(' '));
  }
});

test('checking the state of a lost creation accepts columns Genesys adds on read-back', async () => {
  const h = harness(),
    created = entry({
      id: 'table:New',
      key: 'New',
      kind: 'create',
      before: null,
      after: { ...original, key: 'New' },
    });
  const plan = await h.client.prepare([created], { organizationId: 'org' });
  h.setHook((path, options) => {
    if (options.method === 'POST') {
      h.rows.set('New', { ...JSON.parse(options.body), PRIORITY: 0 });
      throw Error('Network lost');
    }
  });
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'uncertain');
  h.setHook(null);
  const checked = await h.client.reconcile(run);
  assert.equal(checked.entries[0].status, 'verified');
  assert.equal(checked.status, 'verified');
  h.rows.get('New').QUEUE = 'Q Other';
  assert.equal((await h.client.reconcile(run)).entries[0].status, 'conflict');
});

test('a missing prompt is detected even when the same message also contains a dynamic part', async () => {
  const h = harness();
  const audio = (value) => entry({ after: { ...original, WELCOME_AUDIO: value } });
  await assert.rejects(h.client.prepare([audio('pr:Missing')], { organizationId: 'org' }));
  await assert.rejects(
    h.client.prepare([audio('pr:Missing|tts:Bonjour $var:NOM$')], { organizationId: 'org' }),
  );
  await h.client.prepare([audio('pr:Accueil|tts:Bonjour $var:NOM$')], { organizationId: 'org' });
  await h.client.prepare([audio('tts:Bonjour $var:NOM$')], { organizationId: 'org' });
  assert.equal(
    h.calls.some((call) => call.method === 'PUT'),
    false,
  );
});

const tableSchema = (fields) => ({
  type: 'object',
  required: ['key'],
  properties: Object.fromEntries(['key', ...fields].map((k) => [k, { type: 'string' }])),
});
const menuTable = (rows) => ({
  id: 'menu',
  name: 'W_MENU_v5',
  rows,
  schema: tableSchema(['DESCRIPTION', 'MENU_TIMEOUT', 'DEFAULT_TARGET_TYPE', 'DEFAULT_TARGET']),
});

test('a restoration is not blocked by a Studio rule the restored value already broke in service', () => {
  const live = {
    key: 'M',
    DESCRIPTION: 'Menu',
    MENU_TIMEOUT: '7',
    DEFAULT_TARGET_TYPE: 'disconnect',
    DEFAULT_TARGET: '',
  };
  const snapshot = { tables: [menuTable([live])] };
  const row = {
    id: 'menu:M',
    tableId: 'menu',
    table: 'W_MENU_v5',
    key: 'M',
    label: 'Menu',
    kind: 'update',
    before: structuredClone(live),
    after: { ...live, MENU_TIMEOUT: '4' },
    fields: ['MENU_TIMEOUT'],
  };
  const edit = publicationPreflight({ snapshot, rows: [row] });
  assert.ok(
    edit.findings.some((f) => f.code === 'v5' && f.level === 'error'),
    'the rule still blocks an ordinary edit',
  );
  const restore = publicationPreflight({
    snapshot,
    rows: [row],
    plan: { source: 'restore:run-1', createdAt: Date.now(), entries: [row] },
  });
  assert.equal(restore.errors, 0);
  assert.ok(restore.findings.some((f) => f.code === 'v5' && f.level === 'warning'));
});

test('route types are validated regardless of case and surrounding spaces', () => {
  const snapshot = { tables: [menuTable([{ key: 'M' }, { key: 'N' }])] };
  const node = { tableName: 'W_MENU_v5', schema: menuTable([]).schema, row: { key: 'M' } };
  const check = (row) =>
    validateV5Edits(
      node,
      { key: 'M', ...row },
      { snapshot, fields: ['DEFAULT_TARGET_TYPE', 'DEFAULT_TARGET'] },
    );
  check({ DEFAULT_TARGET_TYPE: 'menu ', DEFAULT_TARGET: 'N' });
  check({ DEFAULT_TARGET_TYPE: 'Number', DEFAULT_TARGET: '+33123456789' });
  assert.throws(
    () => check({ DEFAULT_TARGET_TYPE: 'NUMBER', DEFAULT_TARGET: 'abc' }),
    /numéro de transfert/,
  );
});
