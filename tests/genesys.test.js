import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenesysClient, configFromEnv } from '../server/genesys.mjs';
import { createHandler } from '../server/handler.mjs';

const config = {
  region: 'eu-west-1', clientId: 'backend-client', clientSecret: 'test-secret-never-display',
  allowedTableIds: ['table-a', 'table-b'], maxPages: 5, timeoutMs: 1000
};
const table = id => ({ id, name: id === 'table-a' ? 'W_INBOUND_CALL_v5' : 'W_SERVICES_v5', schema: { type: 'object', properties: { key: { type: 'string' } } } });
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const oauth = () => response({ access_token: 'bearer-secret', token_type: 'bearer', expires_in: 3600 });
function transport(resolve) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url: new URL(url), init }); return resolve(new URL(url), init, calls); } };
}
const event = (path = '/api/datatables', options = {}) => ({
  rawPath: path, headers: {},
  requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { sub: 'operator-1', 'cognito:groups': ['wolf-reader'] } } } },
  ...options
});

test('region and explicit table allowlist fail closed before network calls', async () => {
  let called = false;
  assert.throws(() => createGenesysClient({ ...config, region: 'https://attacker.example' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => createGenesysClient({ ...config, allowedTableIds: [] }), { code: 'INVALID_CONFIG' });
  const client = createGenesysClient(config, { fetch: () => { called = true; } });
  await assert.rejects(client.getDatatable('outside-table'), { code: 'TABLE_FORBIDDEN' });
  await assert.rejects(client.getDatatable('table-a/../../users'), { code: 'TABLE_FORBIDDEN' });
  assert.equal(called, false);
  assert.deepEqual(configFromEnv({ GENESYS_ALLOWED_TABLE_IDS: ' one , two ' }).allowedTableIds, ['one', 'two']);
});

test('OAuth stays on the fixed login host, cache is shared by concurrent reads, schema is requested', async () => {
  const io = transport(url => url.pathname === '/oauth/token' ? oauth() : response(table('table-a')));
  const client = createGenesysClient(config, io);
  const [first, second] = await Promise.all([client.getDatatable('table-a'), client.getDatatable('table-a')]);
  assert.deepEqual(first.schema, second.schema);
  assert.equal(io.calls.filter(call => call.url.pathname === '/oauth/token').length, 1);
  const auth = io.calls[0];
  assert.equal(auth.url.origin, 'https://login.mypurecloud.ie');
  assert.equal(auth.init.method, 'POST');
  assert.equal(auth.init.body, 'grant_type=client_credentials');
  assert.equal(auth.init.redirect, 'error');
  for (const call of io.calls.slice(1)) {
    assert.equal(call.url.origin, 'https://api.mypurecloud.ie');
    assert.equal(call.url.searchParams.get('expand'), 'schema');
    assert.equal(call.init.method, 'GET');
  }
  assert.equal(JSON.stringify(first).includes('bearer-secret'), false);
});

test('expired OAuth cache refreshes using a safety margin', async () => {
  let time = 0;
  const io = transport(url => url.pathname === '/oauth/token' ? response({ access_token: 'token', expires_in: 100 }) : response(table('table-a')));
  const client = createGenesysClient(config, { ...io, now: () => time });
  await client.getDatatable('table-a');
  time = 89_000;
  await client.getDatatable('table-a');
  time = 91_000;
  await client.getDatatable('table-a');
  assert.equal(io.calls.filter(call => call.url.pathname === '/oauth/token').length, 2);
});

test('table pagination collects pages but returns only configured WOLF tables', async () => {
  const io = transport(url => {
    if (url.pathname === '/oauth/token') return oauth();
    const pageNumber = Number(url.searchParams.get('pageNumber'));
    return response({ entities: pageNumber === 1 ? [table('table-a'), { id: 'outside', name: 'W_PRIVATE' }] : [table('table-b'), { id: 'table-a', name: 'PRIVATE' }], pageCount: 2, pageNumber });
  });
  const result = await createGenesysClient(config, io).listDatatables();
  assert.deepEqual(result.entities.map(item => item.id), ['table-a', 'table-b']);
  assert.equal(result.total, 2);
  assert.equal(result.sourcePages, 2);
  assert.equal(result.pageCount, 1);
  assert.ok(io.calls.slice(1).every(call => call.url.searchParams.get('name') === 'W_*'));
});

test('row reads preserve full content, pagination, and request showbrief=false', async () => {
  const io = transport(url => {
    if (url.pathname === '/oauth/token') return oauth();
    if (!url.pathname.endsWith('/rows')) return response(table('table-a'));
    return response({ entities: [{ key: 'entry', WELCOME_AUDIO: 'tts:Bonjour' }], pageCount: 3, pageNumber: 2, total: 5 });
  });
  const result = await createGenesysClient(config, io).getDatatableRows('table-a', { pageNumber: 2, pageSize: 2 });
  assert.equal(result.entities[0].WELCOME_AUDIO, 'tts:Bonjour');
  assert.equal(result.pageNumber, 2);
  assert.equal(result.hasMore, true);
  const rowCall = io.calls.find(call => call.url.pathname.endsWith('/rows'));
  assert.equal(rowCall.url.searchParams.get('showbrief'), 'false');
  assert.equal(rowCall.url.searchParams.get('pageSize'), '2');
});

test('missing schema and a renamed non-WOLF table cannot be read as valid configuration', async () => {
  for (const [data, code] of [[{ id: 'table-a', name: 'W_INBOUND_CALL_v5' }, 'SCHEMA_MISSING'], [{ ...table('table-a'), name: 'CustomerData' }, 'TABLE_FORBIDDEN']]) {
    const io = transport(url => url.pathname === '/oauth/token' ? oauth() : response(data));
    await assert.rejects(createGenesysClient(config, io).getDatatableRows('table-a'), { code });
    assert.equal(io.calls.some(call => call.url.pathname.endsWith('/rows')), false);
  }
});

test('pagination limits do not silently return an incomplete snapshot', async () => {
  const io = transport(url => url.pathname === '/oauth/token' ? oauth() : response({ entities: [], pageNumber: Number(url.searchParams.get('pageNumber')), pageCount: 3 }));
  await assert.rejects(createGenesysClient({ ...config, maxPages: 2 }, io).listDatatables(), { code: 'PAGE_LIMIT' });
  assert.equal(io.calls.length, 3);
});

test('rate limit retry is bounded and Retry-After cannot trigger an unbounded sleep', async () => {
  const sleeps = [];
  const io = transport(url => url.pathname === '/oauth/token' ? oauth() : response({ detail: config.clientSecret }, 429, { 'retry-after': '99999' }));
  await assert.rejects(createGenesysClient(config, { ...io, sleep: async ms => sleeps.push(ms) }).getDatatable('table-a'), error => {
    assert.equal(error.code, 'GENESYS_RATE_LIMIT');
    assert.equal(error.message.includes(config.clientSecret), false);
    return true;
  });
  assert.deepEqual(sleeps, [2000, 2000]);
  assert.equal(io.calls.length, 4);
});

test('one 401 refresh succeeds and repeated 401 cannot loop forever', async () => {
  let attempts = 0;
  const io = transport(url => url.pathname === '/oauth/token' ? oauth() : ++attempts === 1 ? response({}, 401) : response(table('table-a')));
  await createGenesysClient(config, io).getDatatable('table-a');
  assert.equal(io.calls.filter(call => call.url.pathname === '/oauth/token').length, 2);
  const denied = transport(url => url.pathname === '/oauth/token' ? oauth() : response({ token: 'do-not-echo' }, 401));
  await assert.rejects(createGenesysClient(config, denied).getDatatable('table-a'), { code: 'GENESYS_READ_FAILED' });
  assert.equal(denied.calls.length, 4);
});

test('HTTP auth and upstream malformed responses are sanitized', async () => {
  const authDenied = transport(() => response({ message: config.clientSecret }, 401));
  await assert.rejects(createGenesysClient(config, authDenied).getDatatable('table-a'), error => error.code === 'GENESYS_AUTH_FAILED' && !error.message.includes(config.clientSecret));
  const malformed = transport(url => url.pathname === '/oauth/token' ? oauth() : new Response('<html>private</html>'));
  await assert.rejects(createGenesysClient(config, malformed).getDatatable('table-a'), { code: 'GENESYS_INVALID_RESPONSE' });
});

test('Lambda rejects absent JWT context, wrong role and wrong tenant before connector access', async () => {
  let called = false;
  const handler = createHandler({ AUTH_TENANT_ID: 'groupe' }, { client: { listDatatables: () => { called = true; } } });
  const absent = event(); delete absent.requestContext.authorizer;
  assert.equal((await handler(absent)).statusCode, 401);
  const wrongRole = event(); wrongRole.requestContext.authorizer.jwt.claims['cognito:groups'] = ['other'];
  assert.equal((await handler(wrongRole)).statusCode, 403);
  assert.equal((await handler(event())).statusCode, 403);
  assert.equal(called, false);
});

test('Lambda supports exact read routes and pagination; remote writes and extra queries are refused', async () => {
  const calls = [];
  const handler = createHandler({ ALLOWED_ORIGIN: 'https://studio.example' }, { client: {
    listDatatables: async () => ({ entities: [] }),
    getDatatable: async id => table(id),
    getDatatableRows: async (id, options) => { calls.push({ id, options }); return { entities: [] }; }
  } });
  const request = event('/api/datatables/table-a/rows', { queryStringParameters: { pageNumber: '2', pageSize: '50' }, headers: { origin: 'https://studio.example' } });
  request.requestContext.authorizer.jwt.claims['cognito:groups'] = '["wolf-reader"]';
  const result = await handler(request);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['access-control-allow-origin'], 'https://studio.example');
  assert.deepEqual(calls, [{ id: 'table-a', options: { pageNumber: 2, pageSize: 50 } }]);
  const write = event(); write.requestContext.http.method = 'PUT';
  assert.equal((await handler(write)).statusCode, 405);
  assert.equal((await handler(event('/api/datatables/table-a/rows', { queryStringParameters: { url: 'https://example.com' } }))).statusCode, 400);
  assert.equal((await handler(event('/api/users'))).statusCode, 404);
  assert.equal((await handler(event('/api/datatables/table-a%2Frows'))).statusCode, 404);
});
