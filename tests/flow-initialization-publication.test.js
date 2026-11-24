import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationClient } from '../src/publication.js';
import {
  flowInitializationDefinition,
  createFlowInitializationRow,
  FLOW_INITIALIZATION,
} from '../src/flow-initialization.js';
import {
  participantCatalogueDefinition,
  participantDefinition,
} from '../src/participant-catalogue.js';
function harness() {
  const catalogue = {
    id: 'c',
    ...participantCatalogueDefinition('g'),
    rows: [participantDefinition('ACTIVE', 'true', { id: 'g', name: 'G2S' })],
  };
  const table = { id: 'init', ...flowInitializationDefinition('g') },
    before = createFlowInitializationRow(
      { key: '+33123456789', division: 'G2S', attributes: [{ name: 'ACTIVE', value: 'true' }] },
      { tables: [catalogue] },
    );
  const rows = new Map([[before.key, structuredClone(before)]]),
    calls = [];
  const entry = {
    id: 'init:' + before.key,
    tableId: 'init',
    table: FLOW_INITIALIZATION,
    key: before.key,
    kind: 'update',
    before,
    after: { ...before, ATTRIBUTE_01_VALUE: 'false' },
    fields: ['ATTRIBUTE_01_VALUE'],
  };
  const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
  const fetchImpl = async (url, opt) => {
    const path = new URL(url).pathname.replace('/api/v2', '');
    calls.push({ path, method: opt.method });
    if (path === '/users/me') return ok({ id: 'user', organization: { id: 'org' } });
    if (path === '/flows/datatables') return ok({ entities: [table, catalogue], pageCount: 1 });
    if (path === '/flows/datatables/init') return ok(table);
    if (path === '/flows/datatables/c') return ok(catalogue);
    if (path === '/flows/datatables/c/rows') return ok({ entities: catalogue.rows, pageCount: 1 });
    if (path.startsWith('/flows/datatables/init/rows/')) {
      const key = decodeURIComponent(path.split('/').at(-1));
      if (opt.method === 'PUT') rows.set(key, JSON.parse(opt.body));
      return rows.has(key) ? ok(rows.get(key)) : { ok: false, status: 404 };
    }
    throw Error('Unexpected ' + opt.method + ' ' + path);
  };
  return {
    entry,
    rows,
    calls,
    catalogue,
    table,
    client: createPublicationClient('test', { fetchImpl }),
  };
}
test('dedicated value publication validates catalogue even without optional flag, journals and rereads one row', async () => {
  const h = harness(),
    plan = await h.client.prepare([h.entry], { organizationId: 'org' }),
    journal = [];
  const result = await h.client.publish(plan, { journal: async (r) => journal.push(r) });
  assert.equal(result.status, 'verified');
  assert.equal(h.rows.get(h.entry.key).ATTRIBUTE_01_VALUE, 'false');
  assert.equal(h.rows.get(h.entry.key).ATTRIBUTE_01_TYPE, 'bool');
  assert.deepEqual(
    h.calls.filter((c) => c.method !== 'GET'),
    [{ path: '/flows/datatables/init/rows/%2B33123456789', method: 'PUT' }],
  );
  assert.ok(journal.length);
});
test('changed catalogue, concurrent values and foreign ownership stop publication', async () => {
  const h = harness(),
    plan = await h.client.prepare([h.entry], { organizationId: 'org' });
  h.catalogue.rows[0].VALUE_TYPE = 'integer';
  h.catalogue.rows[0].DEFAULT_VALUE = '';
  const run = await h.client.publish(plan, { journal: async () => {} });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /type/i);
  assert.ok(!h.calls.some((c) => c.method !== 'GET'));
  const h2 = harness();
  h2.table.description = 'Other';
  await assert.rejects(h2.client.prepare([h2.entry], { organizationId: 'org' }), /incompatible/);
  const h3 = harness();
  h3.rows.get(h3.entry.key).ATTRIBUTE_01_VALUE = 'FALSE';
  await assert.rejects(h3.client.prepare([h3.entry], { organizationId: 'org' }), /Conflit/);
});
test('invalid booleans and unknown attributes are refused before a review is accepted', async () => {
  const h = harness();
  h.entry.after.ATTRIBUTE_01_VALUE = 'yes';
  await assert.rejects(h.client.prepare([h.entry], { organizationId: 'org' }), /Oui ou Non/);
  const h2 = harness();
  h2.entry.after.ATTRIBUTE_01_NAME = 'UNKNOWN';
  await assert.rejects(
    h2.client.prepare([h2.entry], { organizationId: 'org' }),
    /absent du catalogue/,
  );
});
