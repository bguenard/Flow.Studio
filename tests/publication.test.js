import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicationClient,
  publicationRows,
  restorationRows,
  rebaseDraft,
  orderPublicationEntries,
} from '../src/publication.js';
const schema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string' },
    DESCRIPTION: { type: 'string' },
    PRIORITY: { type: 'integer', minimum: 0 },
    QUEUE: { type: 'string' },
  },
};
const original = { key: 'Team / été', DESCRIPTION: 'Équipe', PRIORITY: 1, QUEUE: 'Q Auto' };
const entry = (overrides = {}) => ({
  id: 'table:Team / été',
  tableId: 'table',
  table: 'W_SERVICES_v5',
  key: original.key,
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
const prepare = (h) => h.client.prepare([entry()], { organizationId: 'org' });
test('publication preserves concurrent unrelated values and verifies the actual write with a journal', async () => {
  const h = harness();
  h.rows.get(original.key).QUEUE = 'Q Changed elsewhere';
  const plan = await prepare(h);
  assert.equal(plan.entries[0].after.QUEUE, 'Q Changed elsewhere');
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'verified');
  assert.equal(h.rows.get(original.key).PRIORITY, 4);
  assert.equal(run.entries[0].before.QUEUE, 'Q Changed elsewhere');
  assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 1);
  assert.ok(h.journal.some((r) => r.entries[0].status === 'writing'));
  assert.ok(h.calls.some((c) => c.path.includes('Team%20%2F%20%C3%A9t%C3%A9')));
  assert.doesNotMatch(JSON.stringify(run), /secret-token/);
  await assert.rejects(h.client.publish(plan, { journal: h.save }), /nouveau contrôle/);
});
test('conflicts, wrong organizations, V4 and schema violations do not write', async () => {
  const h = harness();
  h.rows.get(original.key).PRIORITY = 3;
  await assert.rejects(prepare(h), /Conflit/);
  await assert.rejects(h.client.prepare([entry()], { organizationId: 'other' }), /organisation/);
  await assert.rejects(
    h.client.prepare([entry({ table: 'W_SERVICES_v4' })], { organizationId: 'org' }),
    /périmètre/,
  );
  h.rows.get(original.key).PRIORITY = 1;
  await assert.rejects(
    h.client.prepare([entry({ after: { ...original, PRIORITY: -1 } })], { organizationId: 'org' }),
    /moins/,
  );
  assert.equal(
    h.calls.some((c) => c.method !== 'GET'),
    false,
  );
});
test('recent remote edits abort before mutation, and caller tampering cannot alter the reviewed payload', async () => {
  const h = harness(),
    plan = await prepare(h);
  plan.entries[0].after.PRIORITY = 900;
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'verified');
  assert.equal(h.rows.get(original.key).PRIORITY, 4);
  const h2 = harness(),
    plan2 = await prepare(h2);
  h2.rows.get(original.key).QUEUE = 'Recent';
  const result = await h2.client.publish(plan2, { journal: h2.save });
  assert.equal(result.status, 'failed');
  assert.equal(
    h2.calls.some((c) => c.method === 'PUT'),
    false,
  );
});
test('audit failure before writing prevents a mutation', async () => {
  const h = harness(),
    plan = await prepare(h);
  const run = await h.client.publish(plan, {
    journal: async () => {
      throw Error('Storage full');
    },
  });
  assert.equal(run.status, 'failed');
  assert.ok(run.journalError);
  assert.equal(
    h.calls.some((c) => c.method === 'PUT'),
    false,
  );
});
test('lost write response is uncertain, never retried, then reconciled by reading', async () => {
  const h = harness(),
    plan = await prepare(h);
  h.setHook((path, options) => {
    if (options.method === 'PUT') {
      h.rows.set(original.key, JSON.parse(options.body));
      throw Error('Network lost');
    }
  });
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'uncertain');
  assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 1);
  h.setHook(null);
  assert.equal((await h.client.reconcile(run)).status, 'verified');
});
test('failed verification after a successful PUT remains uncertain', async () => {
  const h = harness(),
    plan = await prepare(h);
  let wrote = false;
  h.setHook((path, options) => {
    if (options.method === 'PUT') wrote = true;
    else if (wrote && path.includes('/rows/')) return { ok: false, status: 403 };
  });
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'uncertain');
  assert.equal(run.entries[0].status, 'uncertain');
});
test('creates are POSTed; existing keys are never overwritten by a creation', async () => {
  const h = harness(),
    newEntry = entry({
      id: 'table:New',
      key: 'New',
      kind: 'create',
      before: null,
      after: { ...original, key: 'New' },
    });
  const plan = await h.client.prepare([newEntry], { organizationId: 'org' });
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'verified');
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(restorationRows(run).length, 0);
  await assert.rejects(h.client.prepare([newEntry], { organizationId: 'org' }), /existe déjà/);
});
test('restoration is a separately reviewed write and refuses subsequent remote changes', async () => {
  const h = harness(),
    run = await h.client.publish(await prepare(h), { journal: h.save });
  const restore = restorationRows(run);
  assert.equal(restore[0].after.PRIORITY, 1);
  h.rows.get(original.key).PRIORITY = 7;
  await assert.rejects(h.client.prepare(restore, { organizationId: 'org' }), /Conflit/);
});
test('new rows are ordered before route changes and complete cloned rows are included', () => {
  const snapshot = {
    tables: [{ id: 'table', name: 'W_SERVICES_v5', rows: [original, { ...original, key: 'New' }] }],
  };
  const drafts = new Map([[entry().id, { original, row: { ...original, PRIORITY: 4 } }]]);
  const rows = publicationRows(
    snapshot,
    drafts,
    new Map([['clone', { mappings: [{ nodeId: 'table:New' }] }]]),
  );
  assert.equal(rows[0].kind, 'create');
  assert.equal(rows[1].kind, 'update');
  assert.deepEqual(rows[1].fields, ['PRIORITY']);
});
test('new routing dependencies precede menus and entries, independent of table and key ordering', () => {
  const tables = [
    {
      id: 'in',
      name: 'W_INBOUND_CALL_v5',
      rows: [{ key: '100', NEXT_TARGET_TYPE: 'menu', NEXT_TARGET: 'M' }],
    },
    {
      id: 'menu',
      name: 'W_MENU_v5',
      rows: [{ key: 'M', OPTION1_TARGET_TYPE: 'service|lang:fr-fr', OPTION1_TARGET: 'S|pdata:P' }],
    },
    { id: 'service', name: 'W_SERVICES_v5', rows: [{ key: 'S', INQUEUE_MENU_1: 'WAIT' }] },
    { id: 'context', name: 'W_PARTICIPANT_DATA_v5', rows: [{ key: 'P', PDATA_LIST_1: 'X=Y' }] },
    { id: 'waiting', name: 'W_OTHER_v5', rows: [] },
  ];
  tables[1].rows.push({ key: 'WAIT', OPTION1_TARGET_TYPE: 'next', OPTION1_TARGET: '' });
  const mappings = tables.flatMap((table) =>
    table.rows.map((row) => ({ nodeId: `${table.id}:${row.key}` })),
  );
  const rows = publicationRows({ tables }, new Map(), new Map([['created', { mappings }]]));
  const index = (id) => rows.findIndex((row) => row.id === id);
  assert.ok(index('menu:WAIT') < index('service:S'));
  assert.ok(index('service:S') < index('menu:M'));
  assert.ok(index('context:P') < index('menu:M'));
  assert.ok(index('menu:M') < index('in:100'));
  assert.deepEqual(rows.find((row) => row.id === 'menu:M').requiresCreatedRows, [
    'service:S',
    'context:P',
  ]);
});
test('new cyclic blocks are all staged before the existing entry is rerouted', () => {
  const update = {
    id: 'entry:100',
    table: 'W_INBOUND_CALL_v5',
    kind: 'update',
    requiresCreatedRows: ['menu:A'],
  };
  const a = { id: 'menu:A', table: 'W_MENU_v5', kind: 'create', requiresCreatedRows: ['menu:B'] };
  const b = { id: 'menu:B', table: 'W_MENU_v5', kind: 'create', requiresCreatedRows: ['menu:A'] };
  const ordered = orderPublicationEntries([update, a, b]);
  assert.deepEqual(
    new Set(ordered.slice(0, 2).map((row) => row.id)),
    new Set(['menu:A', 'menu:B']),
  );
  assert.equal(ordered.at(-1), update);
});
test('omitting a required new block is rejected by preparation before any network call', async () => {
  const h = harness();
  await assert.rejects(
    h.client.prepare([entry({ requiresCreatedRows: ['table:New'] })], { organizationId: 'org' }),
    /Publication incomplète/,
  );
  assert.equal(h.calls.length, 0);
});
test('dynamic destinations are not mistaken for references to pending rows', () => {
  const row = { key: '100', NEXT_TARGET_TYPE: 'service', NEXT_TARGET: 'variable' };
  const snapshot = {
    tables: [
      { id: 'entry', name: 'W_INBOUND_CALL_v5', rows: [row] },
      { id: 'service', name: 'W_SERVICES_v5', rows: [{ key: 'variable' }] },
    ],
  };
  const mappings = [{ nodeId: 'entry:100' }, { nodeId: 'service:variable' }];
  const rows = publicationRows(snapshot, new Map(), new Map([['created', { mappings }]]));
  assert.deepEqual(rows.find((row) => row.id === 'entry:100').requiresCreatedRows, []);
});
test('restoring an existing route does not require recreating its already published dependencies', () => {
  const rows = restorationRows({
    entries: [{ ...entry(), status: 'verified', requiresCreatedRows: ['table:New'] }],
  });
  assert.deepEqual(rows[0].requiresCreatedRows, []);
});

test('resource disappearance or missing catalogue permission blocks publication before writing', async () => {
  const h = harness();
  h.setHook((path) => (path.endsWith('/routing/queues') ? { ok: false, status: 403 } : null));
  await assert.rejects(
    h.client.prepare([entry({ after: { ...original, QUEUE: 'Q Other' } })], {
      organizationId: 'org',
    }),
    /permission/,
  );
  assert.equal(
    h.calls.some((c) => c.method === 'PUT'),
    false,
  );
});
test('schema changes after review are checked before any remote mutation', async () => {
  const h = harness(),
    plan = await prepare(h);
  h.setHook((path) =>
    path.endsWith('/datatables/table')
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'table',
            name: 'W_SERVICES_v5',
            schema: {
              ...schema,
              properties: { ...schema.properties, PRIORITY: { type: 'integer', maximum: 2 } },
            },
          }),
        }
      : null,
  );
  const result = await h.client.publish(plan, { journal: h.save });
  assert.equal(result.status, 'failed');
  assert.equal(
    h.calls.some((c) => c.method === 'PUT'),
    false,
  );
});
test('reviewed restoration rows are not presented as already published', async () => {
  const h = harness(),
    run = await h.client.publish(await prepare(h), { journal: h.save });
  const plan = await h.client.prepare(restorationRows(run), { organizationId: 'org' });
  assert.equal(plan.entries[0].status, undefined);
});
test('a failure on the second row keeps the first verified and stops subsequent writes', async () => {
  const h = harness();
  h.rows.set('Other', { ...original, key: 'Other' });
  const second = entry({
    id: 'table:Other',
    key: 'Other',
    before: { ...original, key: 'Other' },
    after: { ...original, key: 'Other', PRIORITY: 5 },
  });
  const plan = await h.client.prepare([entry(), second], { organizationId: 'org' });
  h.setHook((path, options) =>
    options.method === 'PUT' && path.endsWith('/Other') ? { ok: false, status: 403 } : null,
  );
  const run = await h.client.publish(plan, { journal: h.save });
  assert.equal(run.status, 'partial');
  assert.deepEqual(
    run.entries.map((e) => e.status),
    ['verified', 'failed'],
  );
  assert.equal(h.rows.get('Other').PRIORITY, 1);
});

test('rebasing keeps only unpublished edits and preserves unrelated remote fields', () => {
  const draft = { original, row: { ...original, PRIORITY: 4 } };
  assert.equal(rebaseDraft(draft, { ...original, PRIORITY: 4, QUEUE: 'Remote queue' }), null);
  const pending = rebaseDraft(draft, { ...original, QUEUE: 'Remote queue' });
  assert.equal(pending.row.PRIORITY, 4);
  assert.equal(pending.row.QUEUE, 'Remote queue');
  assert.equal(pending.original.PRIORITY, 1);
  assert.equal(original.QUEUE, 'Q Auto');
});

test('identity uses the organization expanded from the user without a second organization request', async () => {
  const calls = [];
  const client = createPublicationClient('token', {
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'u',
          name: 'Utilisateur',
          organization: { id: 'o', name: 'Organisation' },
        }),
      };
    },
  });
  assert.equal((await client.identity()).organizationId, 'o');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get('expand'), 'organization');
});
test('identity 403 identifies its endpoint and never attributes the error to Data Tables', async () => {
  const client = createPublicationClient('token', {
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(client.identity(), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.endpoint, '/users/me');
    assert.match(error.message, /compte utilisateur/);
    assert.doesNotMatch(error.message, /Data Table/);
    return true;
  });
  await assert.rejects(client.prepare([entry()], { organizationId: 'org' }), /compte utilisateur/);
});
test('a rejected table read does not claim that edit permission is required', async () => {
  const h = harness();
  h.setHook((path) => (path.endsWith('/datatables/table') ? { ok: false, status: 403 } : null));
  await assert.rejects(prepare(h), (error) => {
    assert.match(error.message, /lecture de la configuration/);
    assert.doesNotMatch(error.message, /modification/);
    return true;
  });
});

test('participant name checks scan all pages and run again before any write', async () => {
  const h = harness(),
    name = 'FRESH',
    pdataSchema = {
      type: 'object',
      required: ['key'],
      properties: { key: { type: 'string' }, PDATA_LIST_1: { type: 'string' } },
    };
  const candidate = entry({
    id: 'table:FRESH',
    key: name,
    table: 'W_PARTICIPANT_DATA_v5',
    kind: 'create',
    before: null,
    participantName: name,
    after: { key: name, PDATA_LIST_1: 'FRESH==true' },
  });
  let conflict = false,
    pages = 0;
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  h.setHook((path, options) => {
    if (path.endsWith('/datatables/table'))
      return ok({ id: 'table', name: candidate.table, schema: pdataSchema });
    if (path.endsWith('/rows') && options.method === 'GET') {
      pages++;
      return ok({
        entities:
          pages % 2 === 0 && conflict ? [{ key: 'legacy', PDATA_LIST_1: 'fresh==false' }] : [],
        pageCount: 2,
      });
    }
  });
  const p = await h.client.prepare([candidate], { organizationId: 'org' });
  assert.equal(pages, 2);
  conflict = true;
  const run = await h.client.publish(p, { journal: h.save });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /existe déjà/);
  assert.equal(pages, 4);
  assert.equal(
    h.calls.some((c) => c.method !== 'GET'),
    false,
  );
  pages = 0;
  await assert.rejects(h.client.prepare([candidate], { organizationId: 'org' }), /existe déjà/);
  assert.equal(
    h.calls.some((c) => c.method !== 'GET'),
    false,
  );
  conflict = false;
  pages = 0;
  const valid = await h.client.prepare([candidate], { organizationId: 'org' });
  const result = await h.client.publish(valid, { journal: h.save });
  assert.equal(result.status, 'verified');
  assert.deepEqual(h.rows.get('FRESH'), { key: 'FRESH', PDATA_LIST_1: 'FRESH==true' });
});
