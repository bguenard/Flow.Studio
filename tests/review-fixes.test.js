import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { durableRegistry, restorePendingRegistry } from '../src/governance-projection.js';
import { emptyRegistry, declareReference, attachDeclination } from '../src/governance.js';
import { governanceSettingsView } from '../src/governance-settings-view.js';
import { createHandler } from '../server/handler.mjs';
import { createAuthClient, AUTH_TRANSACTION_KEY, AUTH_SESSION_KEY } from '../src/auth.js';
import { loadFromGenesys } from '../src/genesys-direct.js';
import { loadResourceCatalogue } from '../src/genesys-resources.js';

const settle = (promise, ms = 60) => Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise(resolve => setTimeout(() => resolve('pending'), ms))]);

test('a declination attached to an unpublished version survives a registry re-read', () => {
  const remote = declareReference(emptyRegistry(), { flowId: 't:v1', name: 'Groupe', versionLabel: 'V1' });
  const withVersion = declareReference(remote, { flowId: 't:v2', coreModelId: remote.coreModels[0].id, versionLabel: 'V2' });
  const draft = attachDeclination(withVersion, { flowId: 't:entity', baseFlowId: 't:v2', scope: 'active' });
  // Nothing about the pending version may reach Genesys yet…
  assert.deepEqual(durableRegistry(draft, ['t:v2']), remote);
  // …but re-reading the shared registry must not drop the declared attachment.
  const recovered = restorePendingRegistry(remote, draft, ['t:v2']);
  assert.deepEqual(recovered.declinations.map(item => [item.flowId, item.baseFlowId]), [['t:entity', 't:v2']]);
  assert.deepEqual(durableRegistry(recovered, ['t:v2']), remote);
});

test('a recovered attachment never replaces a role already stored in Genesys', () => {
  const base = declareReference(emptyRegistry(), { flowId: 't:v1', name: 'Groupe', versionLabel: 'V1' });
  const remote = attachDeclination(base, { flowId: 't:entity', baseFlowId: 't:v1', scope: 'active' });
  const withVersion = declareReference(base, { flowId: 't:v2', coreModelId: base.coreModels[0].id, versionLabel: 'V2' });
  const draft = attachDeclination(withVersion, { flowId: 't:entity', baseFlowId: 't:v2', scope: 'active' });
  const recovered = restorePendingRegistry(remote, draft, ['t:v2']);
  assert.deepEqual(recovered.declinations.map(item => [item.flowId, item.baseFlowId]), [['t:entity', 't:v1']]);
});

test('a browser registry that cannot be migrated no longer blocks the shared registry', () => {
  const html = governanceSettingsView({ status: 'missing', migration: { coreModels: [{}], declinations: [] } });
  assert.match(html, /data-action="governance-initialize"[^>]*data-skip-migration="true"/);
  assert.doesNotMatch(governanceSettingsView({ status: 'missing', migration: emptyRegistry() }), /data-skip-migration/);
});

test('Lambda accepts group claims serialised by API Gateway as a bracketed list', async () => {
  const handler = createHandler({}, { client: { listDatatables: async () => ({ entities: [] }) } });
  const request = groups => ({ rawPath: '/api/datatables', headers: {}, requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { sub: 'operator-1', 'cognito:groups': groups } } } } });
  for (const groups of ['[wolf-reader]', '[admins wolf-reader]', '[wolf-reader admins]', '[admins, wolf-reader]']) assert.equal((await handler(request(groups))).statusCode, 200, groups);
  for (const groups of ['[admins]', '[wolf-readers]', '']) assert.equal((await handler(request(groups))).statusCode, 403, groups);
});

function authHarness(extra = {}) {
  const store = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }; };
  const localStorage = store(), sessionStorage = store(), location = { href: 'https://studio.example/' };
  const history = { replaceState: (_, __, path) => { location.href = new URL(path, location.href).href; } };
  const dependencies = { localStorage, sessionStorage, location, history, crypto: webcrypto, now: () => 1000, navigate: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ access_token: 'session-token', expires_in: 3600, token_type: 'bearer' })), ...extra };
  return { auth: createAuthClient(dependencies), localStorage, sessionStorage, location,
    callback() { const pending = JSON.parse(sessionStorage.getItem(AUTH_TRANSACTION_KEY)); location.href = `${pending.redirectUri}?code=one-time&state=${pending.state}`; return pending; } };
}

test('a callback this browser never started cannot log the user out', async () => {
  const h = authHarness();
  await h.auth.beginLogin(); h.callback(); await h.auth.completeLogin();
  assert.equal(h.auth.getAccessToken(), 'session-token');
  for (const forged of ['https://studio.example/?code=forged&state=unknown', 'https://studio.example/?error=access_denied&state=unknown']) {
    h.location.href = forged;
    await assert.rejects(h.auth.completeLogin(), /état OAuth incorrect/);
    assert.equal(h.location.href, 'https://studio.example/');
    assert.equal(h.auth.getAccessToken(), 'session-token');
    assert.ok(h.localStorage.getItem(AUTH_SESSION_KEY));
  }
});

test('a denial of the login this browser started still clears the previous session', async () => {
  const h = authHarness();
  await h.auth.beginLogin(); h.callback(); await h.auth.completeLogin();
  await h.auth.beginLogin();
  const pending = JSON.parse(h.sessionStorage.getItem(AUTH_TRANSACTION_KEY));
  h.location.href = `https://studio.example/?error=access_denied&state=${pending.state}`;
  await assert.rejects(h.auth.completeLogin(), /annulée/);
  assert.equal(h.auth.getAccessToken(), null);
});

test('blocked site storage degrades to a disconnected state instead of throwing', async () => {
  const saved = ['localStorage', 'sessionStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name] of saved) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const location = { href: 'https://studio.example/' };
    const auth = createAuthClient({ location, history: { replaceState() {} }, crypto: webcrypto, navigate: () => {} });
    assert.equal(auth.getAccessToken(), null);
    assert.equal(auth.getAuthConfig().redirectUri, 'https://studio.example/');
    await assert.rejects(auth.beginLogin(), /stockage de session est requis/);
  } finally {
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('a response body that never arrives stays cancellable', async () => {
  const caller = new AbortController();
  const fetchImpl = async (url, init) => ({ ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
  const loading = loadFromGenesys('token', { fetchImpl, signal: caller.signal });
  assert.equal(await settle(loading, 20), 'pending');
  caller.abort();
  assert.equal(await settle(loading), 'rejected');
});

test('resource catalogue failures carry their HTTP status and a readable message', async () => {
  await assert.rejects(loadResourceCatalogue('queues', 'token', { fetchImpl: async () => ({ ok: false, status: 401 }) }), error => error.status === 401 && /expirée/.test(error.message));
  await assert.rejects(loadResourceCatalogue('queues', 'token', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    error => !/Failed to fetch/.test(error.message) && /Genesys/.test(error.message));
});
