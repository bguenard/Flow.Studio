import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGenesysGovernanceClient, governanceTableDefinition,
  GOVERNANCE_TABLE_NAME, GOVERNANCE_TABLE_DESCRIPTION,
} from '../src/genesys-governance.js';
import { emptyRegistry, normalizeRegistry } from '../src/governance.js';

function registry(name = 'Relation client', count = 1) {
  return normalizeRegistry({ schemaVersion: 1,
    coreModels: [{ id: 'cm-group', name, versions: [{ flowId: 'inbound:group', label: 'V1' }] }],
    declinations: Array.from({ length: count }, (_, index) => ({
      flowId: `inbound:entity-${index}`, coreModelId: 'cm-group', baseFlowId: 'inbound:group',
      scope: 'active', scopeNote: 'Périmètre défini', origin: 'created',
      nodeMappings: [{ referenceNodeId: 'table:reference', localNodeId: `table:entity-${index}-😀` }],
    })),
  });
}

function harness({ limit = 262144, fallbackOrganization = false, paginated = false } = {}) {
  let table = null, hook = null, currentOrg = 'org-1';
  const rows = new Map(), calls = [];
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
  const fetchImpl = async (url, options = {}) => {
    const address = new URL(url), method = options.method || 'GET', path = address.pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    const call = { url, path, method, body, options }; calls.push(call);
    assert.equal(address.origin, 'https://api.mypurecloud.ie');
    assert.equal(options.headers.Authorization, 'Bearer unit-test-token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    const injected = await hook?.(call, response); if (injected) return injected;
    if (path === '/api/v2/users/me') return response({ id: 'user-1', ...(fallbackOrganization ? {} : { organization: { id: currentOrg } }) });
    if (path === '/api/v2/organizations/me') return response({ id: currentOrg });
    if (path === '/api/v2/authorization/divisions/division-1') return response({ id: 'division-1' });
    if (path === '/api/v2/flows/datatables') {
      if (method === 'GET') {
        const pageNumber = Number(address.searchParams.get('pageNumber'));
        const unrelated = { id: 'runtime-1', name: 'W_INBOUND_CALL_v5' };
        if (paginated && pageNumber === 1) return response({ entities: [unrelated], pageNumber: 1, pageCount: 2, nextUri: 'https://untrusted.invalid/steal-token' });
        return response({ entities: table ? [table] : paginated ? [] : [unrelated], pageNumber, pageCount: paginated ? 2 : 1 });
      }
      assert.equal(method, 'POST'); assert.equal(body.name, GOVERNANCE_TABLE_NAME);
      // The real API rejects a schema which omits additionalProperties:false.
      assert.equal(body.schema.additionalProperties, false);
      assert.equal(body.schema.$schema, 'http://json-schema.org/draft-04/schema#');
      assert.equal(table, null); table = { ...structuredClone(body), id: 'governance-1' };
      table.schema.properties.PAYLOAD.maxLength = limit;
      return response(table, 201);
    }
    if (path === '/api/v2/flows/datatables/governance-1') {
      assert.equal(method, 'GET'); assert.equal(address.searchParams.get('expand'), 'schema');
      return response(table, table ? 200 : 404);
    }
    const match = path.match(/^\/api\/v2\/flows\/datatables\/governance-1\/rows(?:\/(.+))?$/);
    assert.ok(match, `Unexpected ${method} ${path}`);
    const key = match[1] ? decodeURIComponent(match[1]) : null;
    if (method === 'GET') {
      assert.equal(address.searchParams.get('showbrief'), 'false');
      return rows.has(key) ? response(rows.get(key)) : response({}, 404);
    }
    assert.ok(['POST', 'PUT'].includes(method));
    if (method === 'POST') { assert.equal(key, null); if (rows.has(body.key)) return response({}, 409); }
    if (method === 'PUT') { assert.equal(key, 'registry'); assert.ok(rows.has(key)); }
    rows.set(body.key, structuredClone(body)); return response(body, method === 'POST' ? 201 : 200);
  };
  const client = () => createGenesysGovernanceClient('unit-test-token', { organizationId: 'org-1', fetchImpl, now: () => Date.UTC(2026, 10, 23) });
  return { client, calls, rows, get table() { return table; }, setHook: value => { hook = value; },
    setOrganization: value => { currentOrg = value; },
    setTable: value => { table = value; }, mutations: () => calls.filter(call => call.method !== 'GET'),
  };
}

test('missing registry is distinct from an initialized empty registry and load has no writes', async () => {
  const h = harness({ fallbackOrganization: true }), client = h.client();
  const missing = await client.load();
  assert.deepEqual(missing, { tableExists: false, exists: false, tableId: null, organizationId: 'org-1', registry: null, revision: null });
  assert.equal(h.mutations().length, 0);
  const initialized = await client.initialize(emptyRegistry(), 'division-1');
  assert.equal(initialized.exists, true); assert.deepEqual(initialized.registry, emptyRegistry());
  assert.equal(h.mutations().length, 2);
  assert.ok(h.calls.some(call => call.path === '/api/v2/organizations/me'));
});

test('table definition declares only dedicated string columns and a validated division', () => {
  const definition = governanceTableDefinition('division-1');
  assert.equal(definition.name, GOVERNANCE_TABLE_NAME);
  assert.equal(definition.description, GOVERNANCE_TABLE_DESCRIPTION);
  assert.equal(Object.keys(definition.schema.properties).length, 8);
  assert.equal(definition.schema.$schema, 'http://json-schema.org/draft-04/schema#');
  assert.equal(definition.schema.additionalProperties, false);
  assert.deepEqual(definition.schema.required, ['key']);
  assert.equal(definition.schema.properties.key.maxLength, 256);
  assert.throws(() => governanceTableDefinition('../runtime'), { code: 'INVALID_DIVISION' });
});

test('organization mismatch stops all registry discovery and mutation', async () => {
  const h = harness(); h.setOrganization('other-organization');
  await assert.rejects(h.client().initialize(registry(), 'division-1'), { code: 'ORGANIZATION_MISMATCH' });
  assert.equal(h.calls.length, 1); assert.equal(h.mutations().length, 0);
});

test('pagination reconstructs fixed Dublin URLs and ignores an external nextUri', async () => {
  const h = harness({ paginated: true });
  await h.client().initialize(registry(), 'division-1');
  assert.deepEqual((await h.client().load()).registry, registry());
  assert.ok(h.calls.some(call => new URL(call.url).searchParams.get('pageNumber') === '2'));
  assert.ok(h.calls.every(call => !call.url.includes('untrusted.invalid')));
});

test('a successful save only updates registry and a new client must load its base', async () => {
  const h = harness(), client = h.client(); await client.initialize(registry(), 'division-1');
  const before = h.mutations().length;
  await assert.rejects(h.client().save(registry('Future')), { code: 'LOAD_REQUIRED' });
  const result = await client.save(registry('Version validée'));
  assert.equal(h.mutations().length, before + 1);
  assert.equal(h.mutations().at(-1).method, 'PUT');
  assert.match(h.mutations().at(-1).path, /governance-1\/rows\/registry$/);
  assert.deepEqual(result.registry, registry('Version validée'));
  assert.doesNotMatch(JSON.stringify(result), /unit-test-token/);
  const writeCount = h.mutations().length;
  await assert.rejects(client.initialize(registry(), 'division-1'), { code: 'ALREADY_INITIALIZED' });
  assert.equal(h.mutations().length, writeCount);
});

test('actual returned PAYLOAD maximum controls chunks and round trips Unicode intact', async () => {
  const h = harness({ limit: 4096 }), client = h.client(), large = registry('Référence 🌍😀', 60);
  assert.ok(JSON.stringify(large).length > 4096);
  await client.initialize(large, 'division-1');
  const written = h.mutations().filter(call => call.path.endsWith('/rows')).map(call => call.body);
  assert.equal(written.at(-1).key, 'registry'); assert.equal(written.at(-1).RECORD_TYPE, 'manifest');
  assert.ok(written.length > 2);
  for (const row of written) assert.ok(row.PAYLOAD.length <= 4096);
  assert.deepEqual((await h.client().load()).registry, large);
});

test('oversized manifest is rejected before staging any chunks', async () => {
  const h = harness({ limit: 1024 }), client = h.client(); await client.initialize(emptyRegistry(), 'division-1');
  const before = h.mutations().length, committed = structuredClone(h.rows.get('registry'));
  await assert.rejects(client.save(registry('Grand registre', 60)), { code: 'REGISTRY_TOO_LARGE' });
  assert.equal(h.mutations().length, before); assert.deepEqual(h.rows.get('registry'), committed);
});

test('malformed registry is not silently normalized or sent to Genesys', async () => {
  const h = harness(), invalid = registry(); invalid.declinations.push({ flowId: 'orphan', coreModelId: 'missing' });
  await assert.rejects(h.client().initialize(invalid, 'division-1'), { code: 'INVALID_REGISTRY' });
  assert.equal(h.calls.length, 0);
});

test('schema drift blocks saving without a table schema mutation', async () => {
  const h = harness(), client = h.client(); await client.initialize(registry(), 'division-1');
  h.table.schema.properties.PAYLOAD.maxLength = 4096;
  const before = h.mutations().length;
  await assert.rejects(client.save(registry('Changed')), { code: 'TABLE_CHANGED' });
  assert.equal(h.mutations().length, before);
});

test('mismatched final readback is uncertain and forces a fresh load', async () => {
  const h = harness(), client = h.client(); await client.initialize(registry(), 'division-1');
  let written = false;
  h.setHook((call, response) => {
    if (call.method === 'PUT') written = true;
    if (written && call.method === 'GET' && call.path.endsWith('/rows/registry')) return response({ ...h.rows.get('registry'), UPDATED_BY: 'other-writer' });
  });
  await assert.rejects(client.save(registry('Updated')), { code: 'READBACK_MISMATCH', uncertain: true });
  const count = h.mutations().length;
  await assert.rejects(client.save(registry('Again')), { code: 'LOAD_REQUIRED' });
  assert.equal(h.mutations().length, count);
  h.setHook(null); assert.equal((await client.load()).registry.coreModels[0].name, 'Updated');
});

test('table response identity cannot replace the listed dedicated table id', async () => {
  const h = harness(); await h.client().initialize(registry(), 'division-1');
  h.setHook((call, response) => call.path === '/api/v2/flows/datatables/governance-1' ? response({ ...h.table, id: 'runtime-1' }) : undefined);
  const before = h.mutations().length;
  await assert.rejects(h.client().load(), { code: 'TABLE_IDENTITY' });
  assert.equal(h.mutations().length, before);
});

test('a failed GET after acknowledged commit remains an uncertain write outcome', async () => {
  const h = harness(), client = h.client(); await client.initialize(registry(), 'division-1');
  let written = false;
  h.setHook(call => {
    if (call.method === 'PUT') written = true;
    if (written && call.method === 'GET' && call.path.endsWith('/rows/registry')) throw new Error('Connection interrupted');
  });
  await assert.rejects(client.save(registry('Committed')), { code: 'NETWORK_ERROR', uncertain: true });
  h.setHook(null); assert.equal((await client.load()).registry.coreModels[0].name, 'Committed');
});
