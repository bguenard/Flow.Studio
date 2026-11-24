/** Genesys Cloud Dublin public OAuth client: Authorization Code + PKCE S256. */
export const GENESYS_LOGIN_ORIGIN = 'https://login.mypurecloud.ie';
export const DEFAULT_CLIENT_ID = 'a5deabe0-f1dd-46bf-8aed-e7dff2de69bb';
export const AUTH_CONFIG_KEY = 'wolf-genesys-public-config-v1';
export const AUTH_SESSION_KEY = 'wolf-genesys-oauth-session-v1';
export const AUTH_TRANSACTION_KEY = 'wolf-genesys-pkce-v1';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Dependency injection is for deterministic tests; browser exports use native APIs. */
export function createAuthClient(dependencies = {}) {
  const location = dependencies.location || globalThis.location;
  const history = dependencies.history || globalThis.history;
  const browserStore = name => { try { return globalThis[name] || null; } catch { return null; } };
  const session = dependencies.sessionStorage || browserStore('sessionStorage');
  const storage = dependencies.localStorage || browserStore('localStorage');
  const crypto = dependencies.crypto || globalThis.crypto;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const now = dependencies.now || Date.now;
  const navigate = dependencies.navigate || (url => location.assign(url));
  let accessToken = null;
  let expiresAt = 0;
  let persisted = false;
  let tokenConfig = null;
  let completing = null;
  let sessionGeneration = 0;

  function pageUrl() {
    if (!location?.href) throw new Error('La connexion Genesys nécessite un navigateur.');
    return new URL(location.href);
  }
  function defaultRedirect() {
    const url = pageUrl();
    return url.origin + url.pathname;
  }
  function validateConfig(input, requireClient = true) {
    const clientId = String(input?.clientId || '').trim();
    if (requireClient && !/^[a-zA-Z0-9_-]{8,128}$/.test(clientId)) throw new Error('Renseignez le Client ID public du client OAuth Genesys.');
    let redirect;
    try { redirect = new URL(input?.redirectUri || defaultRedirect()); } catch { throw new Error('URI de redirection invalide.'); }
    const local = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !local) throw new Error('La redirection doit utiliser HTTPS, sauf en développement local.');
    if (redirect.origin !== pageUrl().origin || redirect.username || redirect.password || redirect.search || redirect.hash) {
      throw new Error('Utilisez une URI de redirection de cette application, sans paramètres ni fragment.');
    }
    return { clientId, redirectUri: redirect.href, region: 'eu-west-1' };
  }
  function getAuthConfig() {
    let saved;
    try { saved = JSON.parse(storage?.getItem(AUTH_CONFIG_KEY) || 'null'); } catch {}
    try { return validateConfig(saved || { clientId: DEFAULT_CLIENT_ID }, false); }
    catch { return { clientId: DEFAULT_CLIENT_ID, redirectUri: defaultRedirect(), region: 'eu-west-1' }; }
  }
  function saveAuthConfig(input) {
    const config = validateConfig(input), previous = getAuthConfig();
    try { storage.setItem(AUTH_CONFIG_KEY, JSON.stringify(config)); }
    catch { throw new Error('Le stockage navigateur est indisponible. Autorisez-le pour conserver la configuration OAuth publique.'); }
    if (config.clientId !== previous.clientId || config.redirectUri !== previous.redirectUri) logout();
    return config;
  }
  function clearToken() {
    accessToken = null; expiresAt = 0; tokenConfig = null; persisted = false;
    try { storage?.removeItem(AUTH_SESSION_KEY); } catch {}
  }
  function sameConfig(record, config) {
    return record.clientId === config.clientId && record.redirectUri === config.redirectUri && record.loginOrigin === GENESYS_LOGIN_ORIGIN;
  }
  function getAccessToken() {
    const config = getAuthConfig();
    let raw, readable = false;
    try { raw = storage?.getItem(AUTH_SESSION_KEY); readable = true; } catch {}
    if (readable && raw) {
      let saved; try { saved = JSON.parse(raw); } catch {}
      if (!saved || saved.version !== 1 || typeof saved.accessToken !== 'string' || !saved.accessToken || /[\r\n]/.test(saved.accessToken) ||
          !Number.isFinite(saved.expiresAt) || now() >= saved.expiresAt || !sameConfig(saved, config)) {
        clearToken(); return null;
      }
      accessToken = saved.accessToken; expiresAt = saved.expiresAt; tokenConfig = saved; persisted = true;
    } else if (readable && persisted) {
      // Removing the persisted session logs out other tabs on their next access.
      clearToken(); return null;
    }
    if (!accessToken || now() >= expiresAt || !tokenConfig || !sameConfig(tokenConfig, config)) { clearToken(); return null; }
    return accessToken;
  }
  function rememberToken(config) {
    tokenConfig = { version: 1, clientId: config.clientId, redirectUri: config.redirectUri, loginOrigin: GENESYS_LOGIN_ORIGIN, accessToken, expiresAt };
    try { storage.setItem(AUTH_SESSION_KEY, JSON.stringify(tokenConfig)); persisted = true; }
    catch { persisted = false; } // Restricted browsers can still use this login in memory.
  }
  function logout() {
    clearToken();
    sessionGeneration++;
    try { session?.removeItem(AUTH_TRANSACTION_KEY); } catch {}
    // This disconnects this application only; the Genesys SSO session is preserved.
  }
  async function beginLogin() {
    const config = validateConfig(getAuthConfig());
    if (!crypto?.getRandomValues || !crypto?.subtle) throw new Error('PKCE nécessite Web Crypto. Ouvrez l’application en HTTPS ou sur localhost.');
    logout();
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const transaction = { state, verifier, clientId: config.clientId, redirectUri: config.redirectUri, createdAt: now() };
    try { session.setItem(AUTH_TRANSACTION_KEY, JSON.stringify(transaction)); }
    catch { throw new Error('Le stockage de session est requis pour sécuriser le retour OAuth.'); }
    const url = new URL('/oauth/authorize', GENESYS_LOGIN_ORIGIN);
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state
    }).toString();
    navigate(url.href);
    return url.href;
  }
  function cleanCallback(url) {
    for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  async function finish() {
    const url = pageUrl();
    const params = url.searchParams;
    if (!params.has('code') && !params.has('error')) return { handled: false, authenticated: !!getAccessToken() };
    let pending;
    try { pending = JSON.parse(session.getItem(AUTH_TRANSACTION_KEY) || 'null'); } catch {}
    // Remove callback credentials from the address bar and consume the transaction once.
    cleanCallback(new URL(url));
    try { session?.removeItem(AUTH_TRANSACTION_KEY); } catch {}
    if (!pending || typeof pending.state !== 'string' || params.getAll('state').length !== 1 || params.get('state') !== pending.state ||
        !Number.isFinite(pending.createdAt) || now() - pending.createdAt > TRANSACTION_TTL_MS || now() < pending.createdAt) {
      throw new Error('Retour de connexion refusé : session expirée ou état OAuth incorrect. Relancez la connexion.');
    }
    logout();
    const completionGeneration = sessionGeneration;
    const config = validateConfig(pending);
    if (url.origin + url.pathname !== config.redirectUri ||
        typeof pending.verifier !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(pending.verifier)) {
      throw new Error('Retour de connexion refusé : URI ou preuve PKCE incorrecte.');
    }
    if (params.has('error')) throw new Error(params.get('error') === 'access_denied' ? 'Connexion Genesys annulée ou accès refusé.' : 'Genesys a refusé la connexion. Vérifiez le client OAuth et sa redirection.');
    if (params.getAll('code').length !== 1 || !params.get('code') || params.get('code').length > 4096) {
      throw new Error('Code de connexion Genesys absent ou invalide.');
    }
    let response;
    try {
      response = await fetchImpl(`${GENESYS_LOGIN_ORIGIN}/oauth/token`, {
        method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId,
          redirect_uri: config.redirectUri, code: params.get('code'), code_verifier: pending.verifier }).toString(),
        signal: AbortSignal.timeout(15000)
      });
    } catch { throw new Error('Échange OAuth Genesys indisponible. Vérifiez la connexion réseau et relancez la connexion.'); }
    if (!response.ok) throw new Error('Échange OAuth Genesys refusé. Vérifiez le type Code Authorization / PKCE et l’URI autorisée.');
    let data;
    try { data = await response.json(); } catch { throw new Error('Réponse OAuth Genesys non valide.'); }
    if (typeof data?.access_token !== 'string' || !data.access_token || /[\r\n]/.test(data.access_token) || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 ||
        (data.token_type && String(data.token_type).toLowerCase() !== 'bearer')) throw new Error('Réponse OAuth Genesys incomplète.');
    const lifetime = Math.min(Number(data.expires_in), 172800) * 1000;
    if (completionGeneration !== sessionGeneration) throw new Error('Connexion annulée dans cette application.');
    accessToken = data.access_token;
    expiresAt = now() + lifetime - Math.min(30000, lifetime / 10);
    // Keep only the bounded access session; never persist refresh tokens or PKCE proofs.
    rememberToken(config);
    return { handled: true, authenticated: true, expiresAt };
  }
  function completeLogin() {
    if (!completing) completing = finish().finally(() => { completing = null; });
    return completing;
  }
  return Object.freeze({ getAuthConfig, saveAuthConfig, beginLogin, completeLogin, getAccessToken, logout });
}

let browserClient;
const browser = () => browserClient ||= createAuthClient();
export const getAuthConfig = () => browser().getAuthConfig();
export const saveAuthConfig = config => browser().saveAuthConfig(config);
export const beginLogin = () => browser().beginLogin();
export const completeLogin = () => browser().completeLogin();
export const getAccessToken = () => browser().getAccessToken();
export const logout = () => browser().logout();
