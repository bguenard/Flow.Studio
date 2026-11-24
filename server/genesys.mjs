import { isWolfV5VoiceTable } from '../src/wolf-scope.js';
/** Read-only Genesys Cloud adapter. No generic request or write operation is exported. */
export const REGION_HOSTS = Object.freeze({
  'us-east-1': 'mypurecloud.com', 'eu-west-1': 'mypurecloud.ie',
  'ap-southeast-2': 'mypurecloud.com.au', 'ap-northeast-1': 'mypurecloud.jp',
  'eu-central-1': 'mypurecloud.de', 'us-west-2': 'usw2.pure.cloud',
  'ca-central-1': 'cac1.pure.cloud', 'ap-northeast-2': 'apne2.pure.cloud',
  'eu-west-2': 'euw2.pure.cloud', 'ap-south-1': 'aps1.pure.cloud',
  'sa-east-1': 'sae1.pure.cloud', 'me-central-1': 'mec1.pure.cloud',
  'ap-northeast-3': 'apne3.pure.cloud', 'eu-central-2': 'euc2.pure.cloud',
  'mx-central-1': 'mxc1.pure.cloud', 'ap-southeast-1': 'apse1.pure.cloud'
});

export class GenesysError extends Error {
  constructor(code, message, status = 502) {
    super(message); this.name = 'GenesysError'; this.code = code; this.status = status;
  }
}
const csv = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const fail = (code, message, status) => { throw new GenesysError(code, message, status); };

export function configFromEnv(env = process.env) {
  return {
    region: env.GENESYS_REGION,
    clientId: env.GENESYS_CLIENT_ID,
    clientSecret: env.GENESYS_CLIENT_SECRET,
    allowedTableIds: csv(env.GENESYS_ALLOWED_TABLE_IDS),
    allowedTableNames: csv(env.GENESYS_ALLOWED_TABLE_NAMES),
    maxPages: Number(env.GENESYS_MAX_PAGES || 100),
    timeoutMs: Number(env.GENESYS_TIMEOUT_MS || 10000)
  };
}

export function createGenesysClient(config, dependencies = {}) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const host = REGION_HOSTS[config.region];
  if (!host) fail('INVALID_CONFIG', 'Région Genesys absente ou non autorisée.', 503);
  if (!config.clientId || !config.clientSecret) fail('INVALID_CONFIG', 'Identifiants backend Genesys non configurés.', 503);
  const allowedIds = new Set(config.allowedTableIds || []);
  const allowedNames = new Set(config.allowedTableNames || []);
  if (!allowedIds.size || [...allowedIds].some(id => !safeId(id))) {
    fail('INVALID_CONFIG', 'La liste des identifiants de tables autorisés est obligatoire.', 503);
  }
  const maxPages = config.maxPages ?? 100;
  const timeoutMs = config.timeoutMs ?? 10000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    fail('INVALID_CONFIG', 'Limites de lecture backend invalides.', 503);
  }
  let cachedToken = null;
  let tokenPromise = null;

  function assertAllowed(id) {
    if (!safeId(id) || !allowedIds.has(id)) fail('TABLE_FORBIDDEN', 'Table hors du périmètre autorisé.', 403);
  }
  function validTableName(name) {
    return isWolfV5VoiceTable(name) && (!allowedNames.size || allowedNames.has(name));
  }
  async function request(url, init) {
    try {
      return await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      fail(timedOut ? 'GENESYS_TIMEOUT' : 'GENESYS_UNAVAILABLE',
        timedOut ? 'Délai de réponse Genesys dépassé.' : 'Connexion à Genesys indisponible.', timedOut ? 504 : 502);
    }
  }
  async function json(response) {
    try {
      const length = Number(response.headers.get('content-length'));
      if (length > 5_000_000) fail('RESPONSE_TOO_LARGE', 'Réponse Genesys trop volumineuse.', 502);
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > 5_000_000) fail('RESPONSE_TOO_LARGE', 'Réponse Genesys trop volumineuse.', 502);
      return JSON.parse(body);
    } catch (error) {
      if (error instanceof GenesysError) throw error;
      fail('GENESYS_INVALID_RESPONSE', 'Réponse Genesys non valide.', 502);
    }
  }
  const retryable = status => [429, 502, 503, 504].includes(status);
  async function backoff(response, attempt) {
    const header = response.headers.get('retry-after');
    const numeric = Number(header);
    const ms = header && Number.isFinite(numeric) ? numeric * 1000
      : header && Number.isFinite(Date.parse(header)) ? Date.parse(header) - now() : 250 * 2 ** attempt;
    await sleep(Math.max(0, Math.min(2000, ms)));
  }
  async function token() {
    if (cachedToken && now() < cachedToken.validUntil) return cachedToken.value;
    if (!tokenPromise) {
      tokenPromise = (async () => {
        for (let attempt = 0; attempt <= 2; attempt++) {
          const response = await request(`https://login.${host}/oauth/token`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'
            },
            body: 'grant_type=client_credentials'
          });
          if (!response.ok) {
            if (retryable(response.status) && attempt < 2) { await backoff(response, attempt); continue; }
            fail('GENESYS_AUTH_FAILED', 'Authentification du connecteur Genesys refusée ou indisponible.', 502);
          }
          const data = await json(response);
          if (typeof data.access_token !== 'string' || !data.access_token ||
              !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 ||
              (data.token_type && String(data.token_type).toLowerCase() !== 'bearer')) {
            fail('GENESYS_AUTH_FAILED', 'Réponse OAuth Genesys non valide.', 502);
          }
          const lifetime = Number(data.expires_in) * 1000;
          cachedToken = { value: data.access_token, validUntil: now() + lifetime - Math.min(30000, lifetime / 10) };
          return cachedToken.value;
        }
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }
  async function get(path, query = {}) {
    const url = new URL(path, `https://api.${host}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    let refreshed = false;
    let retries = 0;
    while (true) {
      const bearer = await token();
      const response = await request(url.toString(), {
        method: 'GET', headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }
      });
      if (response.status === 401 && !refreshed) {
        if (cachedToken?.value === bearer) cachedToken = null;
        refreshed = true;
        continue;
      }
      if (!response.ok) {
        if (retryable(response.status) && retries < 2) { await backoff(response, retries++); continue; }
        const code = response.status === 429 ? 'GENESYS_RATE_LIMIT' : response.status === 403 ? 'GENESYS_PERMISSION_DENIED'
          : response.status === 404 ? 'TABLE_NOT_FOUND' : 'GENESYS_READ_FAILED';
        fail(code, response.status === 404 ? 'Table introuvable dans Genesys.' : 'Lecture Genesys refusée ou indisponible.', response.status === 404 ? 404 : response.status === 429 ? 503 : 502);
      }
      return json(response);
    }
  }
  function normalizePage(data, pageNumber, pageSize) {
    if (!data || !Array.isArray(data.entities)) fail('GENESYS_INVALID_RESPONSE', 'Liste Genesys non valide.', 502);
    const count = data.pageCount === undefined ? undefined : Number(data.pageCount);
    const total = data.total === undefined ? undefined : Number(data.total);
    if ((count !== undefined && (!Number.isInteger(count) || count < 0)) ||
        (total !== undefined && (!Number.isInteger(total) || total < 0)) ||
        (data.pageNumber !== undefined && Number(data.pageNumber) !== pageNumber)) {
      fail('GENESYS_INVALID_RESPONSE', 'Pagination Genesys non valide.', 502);
    }
    return {
      entities: data.entities, pageNumber, pageSize,
      ...(count !== undefined ? { pageCount: count } : {}),
      ...(total !== undefined ? { total } : {}),
      hasMore: count !== undefined ? pageNumber < count : total !== undefined ? pageNumber * pageSize < total : data.entities.length === pageSize
    };
  }
  async function allPages(readPage) {
    const entities = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await readPage(page);
      entities.push(...result.entities);
      if (!result.hasMore) return { entities, pageNumber: 1, pageCount: 1, pageSize: entities.length, total: entities.length, sourcePages: page, hasMore: false };
    }
    fail('PAGE_LIMIT', 'Lecture interrompue : limite de pagination atteinte. Aucun résultat partiel retourné.', 502);
  }
  async function getDatatable(id) {
    assertAllowed(id);
    const table = await get(`/api/v2/flows/datatables/${encodeURIComponent(id)}`, { expand: 'schema' });
    if (table?.id !== id || !validTableName(table.name)) fail('TABLE_FORBIDDEN', 'Table hors du périmètre WOLF autorisé.', 403);
    if (!table.schema || typeof table.schema !== 'object' || Array.isArray(table.schema)) {
      fail('SCHEMA_MISSING', 'Le schéma de la table est absent de la réponse Genesys.', 502);
    }
    return table;
  }
  async function getDatatableRows(id, options = {}) {
    assertAllowed(id);
    const pageNumber = options.pageNumber ?? 1;
    const pageSize = options.pageSize ?? 100;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maxPages ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      fail('INVALID_PAGINATION', 'pageNumber ou pageSize invalide.', 400);
    }
    // Validate the actual table name as well as its configured ID before reading contents.
    await getDatatable(id);
    return normalizePage(await get(`/api/v2/flows/datatables/${encodeURIComponent(id)}/rows`, {
      pageNumber, pageSize, showbrief: false
    }), pageNumber, pageSize);
  }
  return Object.freeze({
    async listDatatables() {
      const result = await allPages(async pageNumber => normalizePage(await get('/api/v2/flows/datatables', {
        pageNumber, pageSize: 100, name: 'W_*'
      }), pageNumber, 100));
      const entities = result.entities.filter(table => allowedIds.has(table.id) && validTableName(table.name));
      return { ...result, entities, total: entities.length, pageSize: entities.length };
    },
    getDatatable,
    getDatatableRows,
    listAllRows(id) { return allPages(pageNumber => getDatatableRows(id, { pageNumber, pageSize: 100 })); }
  });
}
