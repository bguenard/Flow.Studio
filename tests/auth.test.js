import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import {
  createAuthClient,
  AUTH_CONFIG_KEY,
  AUTH_TRANSACTION_KEY,
  AUTH_SESSION_KEY,
  DEFAULT_CLIENT_ID,
} from '../src/auth.js';

const memoryStore = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
};
function harness(extra = {}) {
  const localStorage = memoryStore();
  const sessionStorage = memoryStore();
  const location = { href: 'https://studio.example/' };
  const navigations = [],
    requests = [];
  const history = {
    replaceState: (_, __, path) => {
      location.href = new URL(path, location.href).href;
    },
  };
  let time = 1000;
  const dependencies = {
    localStorage,
    sessionStorage,
    location,
    history,
    crypto: webcrypto,
    now: () => time,
    navigate: (url) => navigations.push(url),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          access_token: 'memory-only-token',
          expires_in: 100,
          token_type: 'bearer',
          refresh_token: 'never-store',
        }),
      );
    },
    ...extra,
  };
  const auth = createAuthClient(dependencies);
  return {
    auth,
    dependencies,
    localStorage,
    sessionStorage,
    location,
    navigations,
    requests,
    setTime: (value) => {
      time = value;
    },
    callback(code = 'one-time-code') {
      const transaction = JSON.parse(sessionStorage.getItem(AUTH_TRANSACTION_KEY));
      location.href = `${transaction.redirectUri}?code=${code}&state=${transaction.state}`;
      return transaction;
    },
  };
}

test('public Client ID is prefilled, config cannot persist secrets or redirect off-origin', () => {
  const h = harness();
  assert.equal(h.auth.getAuthConfig().clientId, DEFAULT_CLIENT_ID);
  assert.equal(h.auth.getAuthConfig().redirectUri, 'https://studio.example/');
  h.auth.saveAuthConfig({
    clientId: DEFAULT_CLIENT_ID,
    redirectUri: 'https://studio.example/',
    clientSecret: 'discard-me',
    accessToken: 'discard-token',
  });
  const stored = JSON.parse(h.localStorage.getItem(AUTH_CONFIG_KEY));
  assert.deepEqual(Object.keys(stored).sort(), ['clientId', 'redirectUri', 'region']);
  assert.throws(
    () =>
      h.auth.saveAuthConfig({ clientId: DEFAULT_CLIENT_ID, redirectUri: 'https://other.example/' }),
    /cette application/,
  );
  assert.throws(
    () =>
      h.auth.saveAuthConfig({
        clientId: DEFAULT_CLIENT_ID,
        redirectUri: 'https://studio.example/?x=1',
      }),
    /sans paramètres/,
  );
});

test('PKCE creates cryptographic S256 challenge and state, stores verifier only in session', async () => {
  const h = harness();
  await h.auth.beginLogin();
  const url = new URL(h.navigations[0]);
  const pending = JSON.parse(h.sessionStorage.getItem(AUTH_TRANSACTION_KEY));
  assert.equal(url.origin, 'https://login.mypurecloud.ie');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('code_challenge'),
    createHash('sha256').update(pending.verifier).digest('base64url'),
  );
  assert.equal(url.searchParams.get('state'), pending.state);
  assert.ok(pending.verifier.length >= 43 && pending.verifier.length <= 128);
  assert.equal(h.localStorage.values.size, 0);
  assert.equal(url.searchParams.has('client_secret'), false);
});

test('callback exchanges code once and persists only its bounded access session', async () => {
  const h = harness();
  await h.auth.beginLogin();
  const pending = h.callback();
  const result = await h.auth.completeLogin();
  assert.equal(result.authenticated, true);
  assert.equal(h.location.href, 'https://studio.example/');
  assert.equal(h.auth.getAccessToken(), 'memory-only-token');
  assert.equal(h.sessionStorage.getItem(AUTH_TRANSACTION_KEY), null);
  assert.equal(
    JSON.parse(h.localStorage.getItem(AUTH_SESSION_KEY)).accessToken,
    'memory-only-token',
  );
  assert.equal(JSON.stringify([...h.localStorage.values]).includes('never-store'), false);
  assert.equal(JSON.stringify([...h.localStorage.values]).includes(pending.verifier), false);
  assert.equal(JSON.stringify([...h.sessionStorage.values]).includes('never-store'), false);
  assert.equal(h.requests[0].url, 'https://login.mypurecloud.ie/oauth/token');
  const body = new URLSearchParams(h.requests[0].init.body);
  assert.equal(body.get('code_verifier'), pending.verifier);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_id'), DEFAULT_CLIENT_ID);
  assert.equal(body.has('client_secret'), false);
  assert.equal(h.requests[0].init.redirect, 'error');
  h.setTime(92_000);
  assert.equal(h.auth.getAccessToken(), null);
  assert.equal(createAuthClient(h.dependencies).getAccessToken(), null);
});

test('unknown, expired and replayed state fail before token exchange and clear callback', async () => {
  for (const variant of ['mismatch', 'expired', 'missing']) {
    const h = harness();
    await h.auth.beginLogin();
    h.callback();
    if (variant === 'mismatch') h.location.href = 'https://studio.example/?code=code&state=other';
    if (variant === 'expired') h.setTime(602_000);
    if (variant === 'missing') h.sessionStorage.removeItem(AUTH_TRANSACTION_KEY);
    await assert.rejects(h.auth.completeLogin(), /état OAuth incorrect/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.location.href, 'https://studio.example/');
    assert.equal(h.sessionStorage.getItem(AUTH_TRANSACTION_KEY), null);
  }
  const h = harness();
  await h.auth.beginLogin();
  h.callback();
  const callbackUrl = h.location.href;
  await h.auth.completeLogin();
  h.location.href = callbackUrl;
  await assert.rejects(h.auth.completeLogin(), /état OAuth incorrect/);
  assert.equal(h.requests.length, 1);
});

test('denial does not echo untrusted upstream error details or retain authentication', async () => {
  const h = harness();
  await h.auth.beginLogin();
  const pending = JSON.parse(h.sessionStorage.getItem(AUTH_TRANSACTION_KEY));
  h.location.href = `https://studio.example/?error=access_denied&error_description=private&state=${pending.state}`;
  await assert.rejects(
    h.auth.completeLogin(),
    (error) => /annulée/.test(error.message) && !error.message.includes('private'),
  );
  assert.equal(h.requests.length, 0);
  assert.equal(h.auth.getAccessToken(), null);
});

test('OAuth endpoint errors never expose response bodies', async () => {
  const h = harness({
    fetchImpl: async () => new Response('sensitive-upstream-error', { status: 400 }),
  });
  await h.auth.beginLogin();
  h.callback();
  await assert.rejects(
    h.auth.completeLogin(),
    (error) => /Échange OAuth/.test(error.message) && !error.message.includes('sensitive'),
  );
  assert.equal(h.auth.getAccessToken(), null);
});

test('logout during code exchange prevents a late response from restoring a token', async () => {
  let resolve;
  const h = harness({
    fetchImpl: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await h.auth.beginLogin();
  h.callback();
  const pending = h.auth.completeLogin();
  h.auth.logout();
  resolve(new Response(JSON.stringify({ access_token: 'late', expires_in: 100 })));
  await assert.rejects(pending, /Connexion annulée/);
  assert.equal(h.auth.getAccessToken(), null);
});

test('without an OAuth callback the app stays disconnected and makes no request', async () => {
  const h = harness();
  assert.deepEqual(await h.auth.completeLogin(), { handled: false, authenticated: false });
  assert.equal(h.requests.length, 0);
});

test('reloading and opening another tab reuse the valid OAuth session without login or token exchange', async () => {
  const h = harness();
  await h.auth.beginLogin();
  h.callback();
  await h.auth.completeLogin();
  const restored = createAuthClient({ ...h.dependencies, sessionStorage: memoryStore() });
  assert.deepEqual(await restored.completeLogin(), { handled: false, authenticated: true });
  assert.equal(restored.getAccessToken(), 'memory-only-token');
  assert.equal(h.requests.length, 1);
  assert.equal(h.navigations.length, 1);
  h.setTime(92000);
  assert.equal(restored.getAccessToken(), null);
  assert.equal(h.localStorage.getItem(AUTH_SESSION_KEY), null);
});

test('logout removes the persisted session and is respected by other tabs', async () => {
  const h = harness();
  await h.auth.beginLogin();
  h.callback();
  await h.auth.completeLogin();
  const other = createAuthClient(h.dependencies);
  assert.ok(other.getAccessToken());
  h.auth.logout();
  assert.equal(h.localStorage.getItem(AUTH_SESSION_KEY), null);
  assert.equal(other.getAccessToken(), null);
  assert.equal(createAuthClient(h.dependencies).getAccessToken(), null);
});

test('OAuth config changes invalidate the session, saving the same config preserves it', async () => {
  const h = harness();
  await h.auth.beginLogin();
  h.callback();
  await h.auth.completeLogin();
  h.auth.saveAuthConfig(h.auth.getAuthConfig());
  assert.ok(h.auth.getAccessToken());
  h.auth.saveAuthConfig({ ...h.auth.getAuthConfig(), clientId: 'another-public-client' });
  assert.equal(h.auth.getAccessToken(), null);
  assert.equal(h.localStorage.getItem(AUTH_SESSION_KEY), null);
});

test('malformed or differently bound sessions are rejected and removed', async () => {
  const h = harness();
  await h.auth.beginLogin();
  h.callback();
  await h.auth.completeLogin();
  const saved = JSON.parse(h.localStorage.getItem(AUTH_SESSION_KEY));
  for (const variant of [
    '{invalid',
    JSON.stringify({ ...saved, loginOrigin: 'https://other.invalid' }),
    JSON.stringify({ ...saved, clientId: 'other-client' }),
    JSON.stringify({ ...saved, redirectUri: 'https://studio.example/other' }),
    JSON.stringify({ ...saved, expiresAt: '99999' }),
    JSON.stringify({ ...saved, accessToken: 'bad\r\nvalue' }),
  ]) {
    h.localStorage.setItem(AUTH_SESSION_KEY, variant);
    assert.equal(createAuthClient(h.dependencies).getAccessToken(), null);
    assert.equal(h.localStorage.getItem(AUTH_SESSION_KEY), null);
  }
});

test('blocked persistent storage keeps current login usable without pretending to survive reload', async () => {
  const h = harness();
  h.localStorage.setItem = () => {
    throw Error('blocked');
  };
  await h.auth.beginLogin();
  h.callback();
  await h.auth.completeLogin();
  assert.equal(h.auth.getAccessToken(), 'memory-only-token');
  assert.equal(createAuthClient(h.dependencies).getAccessToken(), null);
  h.auth.logout();
  assert.equal(h.auth.getAccessToken(), null);
});
