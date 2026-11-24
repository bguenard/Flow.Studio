/**
 * Genesys Cloud Dublin, authenticated with the current user's OAuth session.
 * Read-only: only the datatable collection, schemas and rows are fetched.
 * API contracts: official MyPureCloud/platform-client-sdk-javascript,
 * ArchitectApi.getFlowsDatatables / getFlowsDatatable / getFlowsDatatableRows.
 * Browser use and PKCE are documented in the SDK README. A token never appears
 * in a URL, callback, error, exported snapshot or persistent storage here.
 */
import { isWolfV5VoiceTable } from './wolf-scope.js';
import { normalizeSnapshot } from './data-source.js';

export const GENESYS_API_ORIGIN = 'https://api.mypurecloud.ie';
const API_ROOT = GENESYS_API_ORIGIN + '/api/v2/flows/datatables';
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 30_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const abortError = () => Object.assign(new Error('Lecture Genesys annulée.'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };

/** Current WOLF voice registry: messaging families are deliberately out of scope. */
export const isVoiceTableName = isWolfV5VoiceTable;

function wait(milliseconds, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function retryDelay(response, attempt) {
  const header = response.headers?.get?.('Retry-After');
  if (header != null && String(header).trim() !== '') {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  return 500 * 2 ** attempt;
}
function apiError(status) {
  const error = new Error(status === 401 ? 'Votre session Genesys a expiré. Reconnectez-vous.'
    : status === 403 ? 'Votre compte Genesys ou les scopes OAuth ne permettent pas de lire ces data tables.'
      : status === 404 ? 'Une data table n’est plus disponible. Actualisez la source.'
        : status === 429 ? 'Limite de lecture Genesys atteinte. Réessayez dans quelques instants.'
          : `Lecture Genesys impossible (HTTP ${status}).`);
  error.status = status;
  return error;
}

/**
 * @param {string} token Current user access token, managed by auth.js until its OAuth expiration.
 * @param {{media?:'voice',fetchImpl?:Function,onProgress?:Function,signal?:AbortSignal,sleepImpl?:Function,onCatalogue?:Function,concurrency?:number}} options
 * onProgress receives phase, tableName?, tablesLoaded?, totalTables?, pageNumber?, rowsLoaded?.
 * sleepImpl is a deterministic test seam; callers normally leave it unset.
 * @returns {Promise<object>} Immutable normalized snapshot.
 */
export async function loadFromGenesys(token, options = {}) {
  const media = options.media ?? 'voice';
  if (media !== 'voice') throw new Error('Seul le média voix est pris en charge. Les autres médias nécessitent un adaptateur dédié.');
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Connectez-vous à votre compte Genesys avant de charger les tables.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Lecture HTTP indisponible.');
  const pause = options.sleepImpl || wait;
  const progress = event => { if (typeof options.onProgress === 'function') options.onProgress(Object.freeze(event)); };
  const request = async (path, query) => {
    const url = API_ROOT + path + '?' + new URLSearchParams(query).toString();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      checkAbort(options.signal);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 20_000);
      let response, payload, invalidJson = false;
      try {
        response = await fetchImpl(url, {
          method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        // A stalled body must still end with the timer or the caller's abort.
        if (response.ok) {
          try { payload = await response.json(); }
          catch (error) { if (controller.signal.aborted) throw error; invalidJson = true; }
        }
      } catch {
        if (options.signal?.aborted) throw abortError();
        // Network/CORS/redirect errors are not automatically retried: repeated
        // browser denial is not a transient service status.
        throw new Error('Connexion à Genesys Dublin impossible. Vérifiez le réseau et l’accès du navigateur à api.mypurecloud.ie.');
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
      checkAbort(options.signal);
      if (response.ok) {
        if (invalidJson) throw new Error('Genesys a retourné une réponse JSON invalide.');
        return payload;
      }
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
        const delay = retryDelay(response, attempt);
        if (delay > MAX_WAIT_MS) throw apiError(response.status);
        progress({ phase: 'retry', attempt: attempt + 1, delayMs: delay, status: response.status });
        await pause(delay, options.signal);
        continue;
      }
      throw apiError(response.status);
    }
  };

  const collect = async (path, extra, context) => {
    const entities = [];
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const payload = await request(path, { ...extra, pageSize: PAGE_SIZE, pageNumber });
      if (!object(payload) || !Array.isArray(payload.entities)) throw new Error('Réponse Genesys invalide : liste « entities » manquante.');
      if (payload.pageNumber != null && Number(payload.pageNumber) !== pageNumber) throw new Error('Pagination Genesys incohérente. Rechargez la source.');
      entities.push(...payload.entities);
      progress({ ...context, pageNumber, rowsLoaded: entities.length });
      if (payload.pageCount != null) {
        const count = Number(payload.pageCount);
        if (!Number.isInteger(count) || count < 0 || count > MAX_PAGES) throw new Error('Nombre de pages Genesys invalide ou trop important.');
        if (pageNumber >= count) return entities;
      } else if (payload.total != null) {
        const total = Number(payload.total);
        if (!Number.isInteger(total) || total < 0) throw new Error('Total de résultats Genesys invalide.');
        if (entities.length >= total) return entities;
      } else if (typeof payload.hasMore === 'boolean') {
        if (!payload.hasMore) return entities;
      } else if (!payload.nextUri && payload.entities.length < PAGE_SIZE) return entities;
      else if (!payload.nextUri) throw new Error('Pagination Genesys incomplète : impossible de garantir la lecture de toutes les lignes.');
      // nextUri is never followed. Its only supported meaning without numeric
      // metadata is that a subsequent page must be requested on the same path.
      if (!payload.entities.length) throw new Error('Pagination Genesys interrompue avant la fin des résultats.');
    }
    throw new Error('Lecture Genesys arrêtée : limite de 1 000 pages atteinte.');
  };

  progress({ phase: 'tables', tablesLoaded: 0 });
  // Inventory metadata first, then request schemas only for the selected voice
  // families. In particular no MESSAGE schema/row request is sent by default.
  const listed = await collect('', { sortBy: 'id', sortOrder: 'ascending' }, { phase: 'tables' });
  if (listed.some(item => !object(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string')) throw new Error('Genesys a retourné une table sans identité exploitable.');
  const wolfTables = listed.filter(table => isVoiceTableName(table.name));
  const excludedLegacyTableIds = listed.filter(table => /^W_.*_v4$/i.test(table.name)).map(table=>table.id);
  const excludedScopeTables = listed.filter(table => /^W_/i.test(table.name) && !isVoiceTableName(table.name)).length;
  const excludedMessageTables = listed.filter(table => /^W_/i.test(table.name) && /MESSAGE/i.test(table.name)).length;
  progress({ phase: 'selection', media, listedTables: listed.length, totalTables: wolfTables.length, excludedMessageTables });
  const seen = new Set();
  for (const item of wolfTables) {
    if (!/^[A-Za-z0-9_-]+$/.test(item.id) || seen.has(item.id)) throw new Error('Identifiant de data table invalide ou dupliqué. Rechargez la source.');
    seen.add(item.id);
  }
  const tables = new Map();
  const snapshotFor = partial => normalizeSnapshot({source:{kind:'genesys',media,region:'eu-west-1',regionLabel:'Dublin',url:API_ROOT,readOnly:true,listedTables:listed.length,selectedVoiceTables:wolfTables.length,wolfVersion:'5',excludedScopeTables,excludedLegacyTableIds,excludedMessageTables,partial,loadedAt:new Date().toISOString()},tables:wolfTables.filter(item=>tables.has(item.id)).map(item=>tables.get(item.id))});
  const readTable = async item => {
    checkAbort(options.signal);
    const id = encodeURIComponent(item.id);
    let detail = item;
    if (!object(detail.schema)) detail = await request(`/${id}`, { expand: 'schema' });
    if (!object(detail) || detail.id !== item.id || detail.name !== item.name || !isVoiceTableName(detail.name)) throw new Error('L’identité de la table Genesys a changé pendant la lecture. Rechargez la source.');
    if (!object(detail.schema)) throw new Error(`Le schéma de ${detail.name} n’a pas été retourné par Genesys. Réessayez la lecture.`);
    const rows = await collect(`/${id}/rows`, { showbrief: false, sortOrder: 'ascending' }, { phase: 'rows', tableName: detail.name, tablesLoaded: tables.size, totalTables: wolfTables.length });
    checkAbort(options.signal);
    tables.set(detail.id, { id: detail.id, name: detail.name, schema: detail.schema, rows });
    progress({ phase: 'table-complete', tableName: detail.name, tablesLoaded: tables.size, totalTables: wolfTables.length, rowsLoaded: rows.length });
  };
  // Only entry rows are needed to display the catalogue. The caller loads the
  // shared Core Model registry before releasing the remaining requests.
  const entries = options.onCatalogue ? wolfTables.filter(item=>/^W_INBOUND_CALL_v5$/i.test(item.name)) : [];
  for (const item of entries) await readTable(item);
  if (entries.length) { checkAbort(options.signal); await options.onCatalogue(snapshotFor(true)); checkAbort(options.signal); }
  const remaining = wolfTables.filter(item=>!tables.has(item.id));
  const concurrency = Math.max(1, Math.min(4, Math.floor(Number(options.concurrency)||1)));
  let cursor=0, failure=null;
  await Promise.all(Array.from({length:Math.min(concurrency,remaining.length)}, async()=>{
    while (!failure && cursor<remaining.length) {
      const item=remaining[cursor++];
      try { await readTable(item); } catch(error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  checkAbort(options.signal);
  const snapshot = snapshotFor(false);
  progress({ phase: 'complete', media, listedTables: listed.length, excludedMessageTables, tablesLoaded: tables.size, totalTables: tables.size, rowsLoaded: snapshot.tables.reduce((count, table) => count + table.rows.length, 0) });
  return snapshot;
}

export const loadGenesysSnapshot = loadFromGenesys;
