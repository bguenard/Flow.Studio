/**
 * Durable governance metadata in one dedicated Genesys data table.
 * No WOLF row/schema writes; no table updates, deletes, or automatic retries.
 * A single registry row is the commit point. Large documents use immutable
 * chunks written and verified before a new manifest replaces that row.
 *
 * Optimistic conflict checks are NOT an atomic compare-and-swap. Genesys'
 * documented PUT-row contract exposes no conditional revision parameter.
 * Two writers can still race after the final check; use a single writer/BFF
 * if strict exclusion is required. Never silently retry a failed write.
 *
 * API source: MyPureCloud/platform-client-sdk-javascript ArchitectApi.js.
 * Limits: help.genesys.cloud/articles/work-with-data-tables/; PAYLOAD uses
 * the actual returned schema.maxLength, bounded by this client's own limit.
 */
import { GENESYS_API_ORIGIN } from './genesys-direct.js';
import { normalizeRegistry } from './governance.js';

export const GOVERNANCE_TABLE_NAME = 'STUDIO_CORE_MODELS_V5';
export const GOVERNANCE_ROW_KEY = 'registry';
export const GOVERNANCE_TABLE_DESCRIPTION = 'WOLF_STUDIO_GOVERNANCE_V1 — Core Models, versions et déclinaisons';
const FIELDS = ['key', 'RECORD_TYPE', 'PAYLOAD', 'REVISION', 'ORGANIZATION_ID', 'SHA256', 'UPDATED_AT', 'UPDATED_BY'];
const MAX_CELL_CHARACTERS = 262144; // Application ceiling, not an inferred global API entitlement.
const MAX_REGISTRY_CHARACTERS = 2_000_000;
const MAX_CHUNKS = 128;
const MANIFEST_FORMAT = 'wolf-studio-governance-chunks/v1';
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => stable(a) === stable(b);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const error = (code, message, extras = {}) => Object.assign(new Error(message), { code, ...extras });

export function governanceTableDefinition(divisionId) {
  if (!id(divisionId)) throw error('INVALID_DIVISION', 'Choisissez une division Genesys existante.');
  return {
    name: GOVERNANCE_TABLE_NAME, description: GOVERNANCE_TABLE_DESCRIPTION, division: { id: divisionId },
    // These root values are required by the Genesys creation contract, also
    // used by its official Terraform provider buildSdkDatatableSchema().
    schema: { $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', additionalProperties: false, required: ['key'], properties: Object.fromEntries(FIELDS.map((field, index) => [field, {
      type: 'string', title: field === 'key' ? 'Clé du registre' : field,
      $id: `/properties/${field}`, displayOrder: index,
      minLength: field === 'key' ? 1 : 0, maxLength: field === 'key' ? 256 : MAX_CELL_CHARACTERS,
    }])) },
  };
}

function registryDocument(registry) {
  if (!object(registry) || registry.schemaVersion !== 1 || !Array.isArray(registry.coreModels) || !Array.isArray(registry.declinations)) {
    throw error('INVALID_REGISTRY', 'Le référentiel doit respecter le format de gouvernance du Studio.');
  }
  const normalized = normalizeRegistry(registry);
  if (!same(normalized, registry)) throw error('INVALID_REGISTRY', 'Le référentiel contient des déclarations invalides ou contradictoires ; aucune entrée ne sera supprimée silencieusement.');
  const payload = stable(normalized);
  if (payload.length > MAX_REGISTRY_CHARACTERS) throw error('REGISTRY_TOO_LARGE', 'Le référentiel dépasse la limite applicative de deux millions de caractères.');
  return { registry: normalized, payload };
}

function ownedTable(table) {
  if (!object(table) || !id(table.id) || table.name !== GOVERNANCE_TABLE_NAME || table.description !== GOVERNANCE_TABLE_DESCRIPTION) {
    throw error('TABLE_IDENTITY', 'La table trouvée ne correspond pas au registre dédié du Studio. Aucune table existante ne sera adaptée.');
  }
  const schema = table.schema;
  if (!object(schema?.properties) || !same(Object.keys(schema.properties).sort(), [...FIELDS].sort()) ||
    FIELDS.some(field => schema.properties[field]?.type !== 'string') ||
    !Array.isArray(schema.required) || !schema.required.includes('key') || schema.required.some(field => !FIELDS.includes(field))) {
    throw error('TABLE_SCHEMA', 'Le schéma du registre dédié est incompatible. Il ne sera pas modifié automatiquement.');
  }
  const maximum = schema.properties.PAYLOAD.maxLength;
  if (!Number.isInteger(maximum) || maximum < 1024) throw error('TABLE_SCHEMA', 'La longueur PAYLOAD doit être publiée dans le schéma Genesys et permettre au moins 1 024 caractères.');
  return copy(table);
}

/**
 * The client is bound to one authenticated organization. The caller must create
 * a new client after a session/organization change. Tokens remain in this closure.
 * load/initialize/save resolve {tableExists,exists,tableId,organizationId,registry,revision}.
 * A save requires a successful load/initialize from this client instance.
 */
export function createGenesysGovernanceClient(token, {
  organizationId, fetchImpl = globalThis.fetch, now = () => Date.now(), cryptoImpl = globalThis.crypto,
} = {}) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw error('AUTH_REQUIRED', 'Connectez-vous à Genesys avant de lire le référentiel.');
  if (!id(organizationId)) throw error('ORGANIZATION_REQUIRED', 'L’identifiant de l’organisation de la source est requis.');
  if (typeof fetchImpl !== 'function' || !cryptoImpl?.subtle || !cryptoImpl?.randomUUID) throw error('RUNTIME_UNAVAILABLE', 'HTTP et Web Crypto sont requis pour le référentiel Genesys.');
  let base = null, busy = false;
  const digest = async payload => [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(payload)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const tablePath = tableId => `/flows/datatables/${encodeURIComponent(tableId)}`;
  const rowPath = (tableId, key) => `${tablePath(tableId)}/rows/${encodeURIComponent(key)}`;
  async function request(path, { method = 'GET', body, missing = false } = {}) {
    // Paths are constructed only inside this module. Mutation targets additionally
    // pass validated table/row identity immediately before every write.
    let response;
    try {
      response = await fetchImpl(`${GENESYS_API_ORIGIN}/api/v2${path}`, {
        method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw error('NETWORK_ERROR', method === 'GET' ? 'Lecture du référentiel interrompue.' : 'Réponse Genesys non reçue. Rechargez le référentiel pour vérifier le résultat avant toute nouvelle tentative.', { uncertain: method !== 'GET', method });
    }
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      let detail='';if(response.status===400){try{const problem=await response.json();detail=String(problem.message||problem.code||'').replaceAll(token,'[redacted]').slice(0,600);}catch{}}
      throw error(response.status === 409 ? 'CONFLICT' : 'HTTP_ERROR',
      response.status === 401 ? 'Session Genesys expirée.' : response.status === 403 ? 'Accès au référentiel refusé : vérifiez les droits Architect Datatable/Datatable Row et les scopes OAuth.' :
        response.status === 409 ? 'Le référentiel a changé ou une ligne existe déjà. Rechargez avant de reprendre.' : `Opération de référentiel refusée (${method}, HTTP ${response.status}).${detail?' '+detail:''}`,
      { status: response.status, method, uncertain: method !== 'GET' && response.status >= 500 });
    }
    try { return await response.json(); }
    catch { throw error('INVALID_RESPONSE', 'Réponse Genesys illisible. Rechargez pour vérifier le résultat.', { uncertain: method !== 'GET', method }); }
  }
  async function identity() {
    const user = await request('/users/me?expand=organization');
    const org = user?.organization?.id ? user.organization : await request('/organizations/me');
    if (!id(user?.id) || !id(org?.id) || org.id !== organizationId) throw error('ORGANIZATION_MISMATCH', 'L’organisation de la source ne correspond pas à la session Genesys.');
    return { userId: user.id, organizationId: org.id };
  }
  async function findTable() {
    const matches = [], ids = new Set();
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      const payload = await request(`/flows/datatables?pageSize=100&pageNumber=${pageNumber}&sortBy=id&sortOrder=ascending`);
      if (!Array.isArray(payload?.entities) || payload.pageNumber != null && Number(payload.pageNumber) !== pageNumber) throw error('INVALID_PAGINATION', 'Liste des tables Genesys invalide.');
      for (const table of payload.entities) {
        if (!id(table?.id) || typeof table.name !== 'string' || ids.has(table.id)) throw error('INVALID_PAGINATION', 'Identité de table invalide ou dupliquée pendant la lecture.');
        ids.add(table.id);
        if (table.name.toUpperCase() === GOVERNANCE_TABLE_NAME) matches.push(table);
      }
      let done;
      if (payload.pageCount != null) {
        const count = Number(payload.pageCount);
        if (!Number.isInteger(count) || count < 0 || count > 1000) throw error('INVALID_PAGINATION', 'Nombre de pages de tables invalide.');
        done = pageNumber >= count;
      } else if (payload.total != null) {
        if (!Number.isInteger(payload.total) || payload.total < 0) throw error('INVALID_PAGINATION', 'Nombre de tables invalide.');
        done = ids.size >= payload.total;
      } else done = !payload.nextUri && payload.entities.length < 100;
      if (done) {
        if (matches.length > 1) throw error('TABLE_AMBIGUOUS', 'Plusieurs tables portent le nom du registre. Aucune écriture ne sera effectuée.');
        if (!matches.length) return null;
        const table = ownedTable(await request(`${tablePath(matches[0].id)}?expand=schema`));
        if (table.id !== matches[0].id) throw error('TABLE_IDENTITY', 'La table retournée ne correspond pas à l’identifiant du registre demandé.');
        return table;
      }
      if (!payload.entities.length) throw error('INVALID_PAGINATION', 'Lecture des tables interrompue avant la dernière page.');
      // A returned nextUri is never followed with the token.
    }
    throw error('INVALID_PAGINATION', 'La lecture des tables dépasse la limite applicative.');
  }
  async function freshTable(table) {
    const actual = ownedTable(await request(`${tablePath(table.id)}?expand=schema`));
    if (actual.id !== table.id || !same(actual.schema, table.schema) || actual.division?.id !== table.division?.id) throw error('TABLE_CHANGED', 'Le schéma, la division ou l’identité du registre a changé. Rechargez-le.');
    return actual;
  }
  const readRow = (table, key) => request(`${rowPath(table.id, key)}?showbrief=false`, { missing: true });
  function validateRow(table, row, key, type) {
    if (!object(row) || row.key !== key || row.ORGANIZATION_ID !== organizationId || !['registry', 'manifest', 'chunk'].includes(row.RECORD_TYPE) ||
      type && row.RECORD_TYPE !== type || !/^[a-zA-Z0-9_-]{8,128}$/.test(row.REVISION) || !/^[a-f0-9]{64}$/.test(row.SHA256)) {
      throw error('INVALID_RECORD', 'Le registre ne possède pas une identité et une révision valides pour cette organisation.');
    }
    if (!same(Object.keys(row).sort(), [...FIELDS].sort())) throw error('INVALID_RECORD', 'Le registre comporte des colonnes inattendues ou manquantes.');
    for (const field of FIELDS) {
      const rule = table.schema.properties[field], value = row[field];
      if (typeof value !== 'string' || Number.isInteger(rule.minLength) && value.length < rule.minLength || Number.isInteger(rule.maxLength) && value.length > rule.maxLength) {
        throw error('INVALID_RECORD', `La valeur ${field} ne respecte pas le schéma du registre.`);
      }
    }
  }
  async function decode(table, row) {
    validateRow(table, row, GOVERNANCE_ROW_KEY);
    if (row.RECORD_TYPE === 'chunk') throw error('INVALID_RECORD', 'La ligne registry ne peut pas être un fragment.');
    let payload = row.PAYLOAD;
    if (row.RECORD_TYPE === 'manifest') {
      let manifest;
      try { manifest = JSON.parse(payload); } catch { throw error('INVALID_MANIFEST', 'Manifeste du référentiel illisible.'); }
      if (!object(manifest) || manifest.format !== MANIFEST_FORMAT || !Array.isArray(manifest.chunks) || !manifest.chunks.length || manifest.chunks.length > MAX_CHUNKS ||
        !Number.isInteger(manifest.length) || manifest.length > MAX_REGISTRY_CHARACTERS || manifest.length < 1 || manifest.sha256 !== row.SHA256) {
        throw error('INVALID_MANIFEST', 'Manifeste du référentiel invalide.');
      }
      const parts = [], seen = new Set(); let length = 0;
      for (const [index, item] of manifest.chunks.entries()) {
        const key = `chunk_${row.REVISION}_${index}`;
        if (!object(item) || item.key !== key || seen.has(key) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.length) || item.length < 1) throw error('INVALID_MANIFEST', 'Référence de fragment invalide.');
        seen.add(key);
        const part = await readRow(table, key);
        if (!part) throw error('INCOMPLETE_REGISTRY', 'Un fragment du référentiel manque. Le registre ne sera pas chargé partiellement.');
        validateRow(table, part, key, 'chunk');
        if (part.REVISION !== row.REVISION || part.PAYLOAD.length !== item.length || part.SHA256 !== item.sha256 || await digest(part.PAYLOAD) !== item.sha256) throw error('CORRUPT_REGISTRY', 'L’empreinte ou le contenu d’un fragment du référentiel est corrompu.');
        parts.push(part.PAYLOAD); length += part.PAYLOAD.length;
        if (length > MAX_REGISTRY_CHARACTERS) throw error('REGISTRY_TOO_LARGE', 'Le référentiel dépasse la limite applicative.');
      }
      if (length !== manifest.length) throw error('INCOMPLETE_REGISTRY', 'La taille du référentiel ne correspond pas au manifeste.');
      payload = parts.join('');
    }
    if (payload.length > MAX_REGISTRY_CHARACTERS || await digest(payload) !== row.SHA256) throw error('CORRUPT_REGISTRY', 'L’empreinte du référentiel ne correspond pas à son contenu.');
    let registry;
    try { registry = JSON.parse(payload); } catch { throw error('INVALID_REGISTRY', 'Le contenu JSON du référentiel est illisible.'); }
    return registryDocument(registry).registry;
  }
  function result(table, row, registry) {
    return { tableExists: Boolean(table), exists: Boolean(row), tableId: table?.id || null, organizationId, registry: registry ? copy(registry) : null, revision: row?.REVISION || null };
  }
  async function loadInternal() {
    await identity();
    const table = await findTable();
    if (!table) { base = { table: null, row: null, registry: null }; return result(null, null, null); }
    const row = await readRow(table, GOVERNANCE_ROW_KEY), registry = row ? await decode(table, row) : null;
    if (row && !same(row, await readRow(table, GOVERNANCE_ROW_KEY))) throw error('CONFLICT', 'Le référentiel a changé pendant son chargement. Relancez la lecture.');
    base = { table: copy(table), row: copy(row), registry: copy(registry) };
    return result(table, row, registry);
  }
  function rowData(key, type, payload, revision, sha256, updatedAt) {
    return { key, RECORD_TYPE: type, PAYLOAD: payload, REVISION: revision, ORGANIZATION_ID: organizationId, SHA256: sha256, UPDATED_AT: updatedAt, UPDATED_BY: 'wolf-studio' };
  }
  async function encode(table, document) {
    const limit = Math.min(table.schema.properties.PAYLOAD.maxLength, MAX_CELL_CHARACTERS);
    const revision = cryptoImpl.randomUUID(), updatedAt = new Date(now()).toISOString(), sha256 = await digest(document.payload);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(revision)) throw error('INVALID_REVISION', 'Impossible de créer une révision unique.');
    if (document.payload.length <= limit) {
      const row = rowData(GOVERNANCE_ROW_KEY, 'registry', document.payload, revision, sha256, updatedAt); validateRow(table, row, row.key);
      return { row, chunks: [] };
    }
    const chunks = [], manifest = { format: MANIFEST_FORMAT, length: document.payload.length, sha256, chunks: [] };
    for (let offset = 0; offset < document.payload.length;) {
      if (chunks.length >= MAX_CHUNKS) throw error('REGISTRY_TOO_LARGE', 'Le référentiel nécessite trop de fragments pour ce schéma.');
      let end = Math.min(offset + limit, document.payload.length);
      const last = document.payload.charCodeAt(end - 1); if (end < document.payload.length && last >= 0xD800 && last <= 0xDBFF) end--;
      const payload = document.payload.slice(offset, end), key = `chunk_${revision}_${chunks.length}`, hash = await digest(payload);
      const row = rowData(key, 'chunk', payload, revision, hash, updatedAt); validateRow(table, row, key, 'chunk');
      chunks.push(row); manifest.chunks.push({ key, length: payload.length, sha256: hash }); offset = end;
    }
    const row = rowData(GOVERNANCE_ROW_KEY, 'manifest', JSON.stringify(manifest), revision, sha256, updatedAt);
    if (row.PAYLOAD.length > limit) throw error('REGISTRY_TOO_LARGE', 'Le manifeste dépasse la taille autorisée par le schéma. Aucun fragment ne sera écrit.');
    validateRow(table, row, GOVERNANCE_ROW_KEY, 'manifest');
    return { row, chunks };
  }
  async function commit(document) {
    if (!base?.table) throw error('LOAD_REQUIRED', 'Chargez ou initialisez le référentiel avant de l’enregistrer.');
    await identity();
    const table = await freshTable(base.table), expected = copy(base.row), encoded = await encode(table, document);
    if (!same(await readRow(table, GOVERNANCE_ROW_KEY), expected)) throw error('CONFLICT', 'Le référentiel a été modifié depuis sa lecture. Rechargez et rapprochez vos changements.');
    for (const chunk of encoded.chunks) {
      await freshTable(table);
      if (await readRow(table, chunk.key)) throw error('CONFLICT', 'Cette révision possède déjà un fragment. Rechargez avant toute nouvelle tentative.');
      await request(`${tablePath(table.id)}/rows`, { method: 'POST', body: chunk });
      if (!same(await readRow(table, chunk.key), chunk)) throw error('READBACK_MISMATCH', 'La relecture ne confirme pas un fragment. Le registre principal reste inchangé.', { uncertain: true });
    }
    await identity(); await freshTable(table);
    if (!same(await readRow(table, GOVERNANCE_ROW_KEY), expected)) throw error('CONFLICT', 'Le référentiel a changé avant sa validation. Les fragments préparés ne seront pas activés.');
    await request(expected ? rowPath(table.id, GOVERNANCE_ROW_KEY) : `${tablePath(table.id)}/rows`, { method: expected ? 'PUT' : 'POST', body: encoded.row });
    try {
      const actual = await readRow(table, GOVERNANCE_ROW_KEY);
      if (!same(actual, encoded.row)) throw error('READBACK_MISMATCH', 'La relecture ne confirme pas le registre enregistré. Rechargez avant de reprendre.');
      const decoded = await decode(table, actual);
      if (!same(decoded, document.registry) || !same(actual, await readRow(table, GOVERNANCE_ROW_KEY))) throw error('READBACK_MISMATCH', 'Le registre a changé pendant sa vérification finale.');
      base = { table: copy(table), row: copy(actual), registry: copy(decoded) };
      return result(table, actual, decoded);
    } catch (failure) {
      // Even a GET failure here happens after the commit was acknowledged.
      // Do not let the caller interpret it as a definite absence of writes.
      failure.uncertain = true; throw failure;
    }
  }
  async function exclusive(operation) {
    if (busy) throw error('BUSY', 'Une opération de référentiel est déjà en cours.');
    busy = true;
    try { return await operation(); }
    catch (failure) { base = null; throw failure; }
    finally { busy = false; }
  }
  const load = () => exclusive(loadInternal);
  const initialize = async (registry, divisionId) => {
    const document = registryDocument(registry), definition = governanceTableDefinition(divisionId);
    return exclusive(async () => {
      const state = await loadInternal();
      if (state.exists) throw error('ALREADY_INITIALIZED', 'Le registre Genesys existe déjà. Chargez-le avant de préparer une modification.');
      if (!state.tableExists) {
        const division = await request(`/authorization/divisions/${encodeURIComponent(divisionId)}`);
        if (division?.id !== divisionId) throw error('INVALID_DIVISION', 'La division Genesys sélectionnée ne peut pas être vérifiée.');
        await identity();
        if (await findTable()) throw error('CONFLICT', 'La table a été créée pendant la préparation. Rechargez le référentiel.');
        const created = await request('/flows/datatables', { method: 'POST', body: definition });
        if (!id(created?.id) || created.name !== GOVERNANCE_TABLE_NAME) throw error('TABLE_IDENTITY', 'La réponse de création ne confirme pas la table dédiée. Rechargez pour vérifier.', { uncertain: true });
        const table = ownedTable(await request(`${tablePath(created.id)}?expand=schema`));
        if (table.id !== created.id || table.division?.id !== divisionId) throw error('TABLE_IDENTITY', 'La table créée ne correspond pas à la division demandée.', { uncertain: true });
        base = { table, row: null, registry: null };
      } else if (base.table.division?.id !== divisionId) throw error('INVALID_DIVISION', 'Le registre existant appartient à une autre division. Il ne sera pas déplacé.');
      return commit(document);
    });
  };
  const save = async registry => {
    const document = registryDocument(registry);
    return exclusive(() => {
      if (!base?.table || !base.row) throw error('LOAD_REQUIRED', 'Chargez un référentiel existant avant de l’enregistrer. Utilisez Initialiser pour le créer.');
      return commit(document);
    });
  };
  return Object.freeze({ load, initialize, save });
}
