/** Normalized Core Model records. Atomic POST of a temporary operation key
 * serializes Studio writers. Explicit before/after rows allow interrupted writes
 * to be resumed. Business deletion is a tombstone; only temporary journal rows
 * are deleted. Direct edits outside the Studio are checked optimistically.
 */
import { GENESYS_API_ORIGIN } from './genesys-direct.js';
import {
  GOVERNANCE_TABLE_NAME,
  GOVERNANCE_TABLE_DESCRIPTION,
  governanceTableDefinition,
  ownedTable,
  validateRow,
  registryDocument,
  registryRows,
  rowsRegistry,
  blank,
  business,
  stable,
  same,
  object,
  validId as id,
  failure as error,
} from './governance-records.js';
export { GOVERNANCE_TABLE_NAME, GOVERNANCE_TABLE_DESCRIPTION, governanceTableDefinition };
const copy = (v) => structuredClone(v);
const LOCK = 'write_lock';
export function createGenesysGovernanceClient(
  token,
  {
    organizationId,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    cryptoImpl = globalThis.crypto,
    getFlowDivisions = () => new Map(),
    requestIntervalMs = fetchImpl === globalThis.fetch ? 400 : 0,
  } = {},
) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))
    throw error('AUTH_REQUIRED', 'Connectez-vous à Genesys.');
  if (!id(organizationId)) throw error('ORGANIZATION_REQUIRED', 'L’organisation est requise.');
  if (typeof fetchImpl !== 'function' || !cryptoImpl?.subtle || !cryptoImpl?.randomUUID)
    throw error('RUNTIME_UNAVAILABLE', 'HTTP et Web Crypto sont requis.');
  let base = null,
    busy = false,
    paced = false,
    lastRequestAt = 0;
  const digest = async (payload) =>
    [
      ...new Uint8Array(
        await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(payload)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const tablePath = (tableId) => '/flows/datatables/' + encodeURIComponent(tableId);
  const rowPath = (tableId, key) => tablePath(tableId) + '/rows/' + encodeURIComponent(key);
  async function request(path, { method = 'GET', body, missing = false, attempt = 0 } = {}) {
    if (paced && requestIntervalMs > 0) {
      const remaining = lastRequestAt + requestIntervalMs - Date.now();
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    lastRequestAt = Date.now();
    // Paths are constructed only inside this module. Mutation targets additionally
    // pass validated table/row identity immediately before every write.
    let response;
    try {
      response = await fetchImpl(`${GENESYS_API_ORIGIN}/api/v2${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw error(
        'NETWORK_ERROR',
        method === 'GET'
          ? 'Lecture du référentiel interrompue.'
          : 'Réponse Genesys non reçue. Rechargez le référentiel pour vérifier le résultat avant toute nouvelle tentative.',
        { uncertain: method !== 'GET', method },
      );
    }
    if (missing && response.status === 404) return null;
    if (response.status === 429 && method === 'GET' && attempt === 0) {
      const retryAfter = response.headers?.get?.('Retry-After');
      const delay =
        retryAfter !== null && retryAfter !== undefined && /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : 60000;
      if (delay <= 60000) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return request(path, { method, body, missing, attempt: 1 });
      }
    }
    if (!response.ok) {
      let detail = '';
      if (response.status === 400) {
        try {
          const problem = await response.json();
          detail = String(problem.message || problem.code || '')
            .replaceAll(token, '[redacted]')
            .slice(0, 600);
        } catch {}
      }
      throw error(
        response.status === 409 ? 'CONFLICT' : 'HTTP_ERROR',
        response.status === 401
          ? 'Session Genesys expirée.'
          : response.status === 403
            ? 'Accès au référentiel refusé : vérifiez les droits Architect Datatable/Datatable Row et les scopes OAuth.'
            : response.status === 409
              ? 'Le référentiel a changé ou une ligne existe déjà. Rechargez avant de reprendre.'
              : `Opération de référentiel refusée (${method}, HTTP ${response.status}).${detail ? ' ' + detail : ''}`,
        { status: response.status, method, uncertain: method !== 'GET' && response.status >= 500 },
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw error(
        'INVALID_RESPONSE',
        'Réponse Genesys illisible. Rechargez pour vérifier le résultat.',
        { uncertain: method !== 'GET', method },
      );
    }
  }
  async function identity() {
    const user = await request('/users/me?expand=organization');
    const org = user?.organization?.id ? user.organization : await request('/organizations/me');
    if (!id(user?.id) || !id(org?.id) || org.id !== organizationId)
      throw error(
        'ORGANIZATION_MISMATCH',
        'L’organisation de la source ne correspond pas à la session Genesys.',
      );
    return { userId: user.id, organizationId: org.id };
  }
  async function findTable() {
    const matches = [],
      ids = new Set();
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      const payload = await request(
        `/flows/datatables?pageSize=100&pageNumber=${pageNumber}&sortBy=id&sortOrder=ascending`,
      );
      if (
        !Array.isArray(payload?.entities) ||
        (payload.pageNumber != null && Number(payload.pageNumber) !== pageNumber)
      )
        throw error('INVALID_PAGINATION', 'Liste des tables Genesys invalide.');
      for (const table of payload.entities) {
        if (!id(table?.id) || typeof table.name !== 'string' || ids.has(table.id))
          throw error(
            'INVALID_PAGINATION',
            'Identité de table invalide ou dupliquée pendant la lecture.',
          );
        ids.add(table.id);
        if (table.name.toUpperCase() === GOVERNANCE_TABLE_NAME) matches.push(table);
      }
      let done;
      if (payload.pageCount != null) {
        const count = Number(payload.pageCount);
        if (!Number.isInteger(count) || count < 0 || count > 1000)
          throw error('INVALID_PAGINATION', 'Nombre de pages de tables invalide.');
        done = pageNumber >= count;
      } else if (payload.total != null) {
        if (!Number.isInteger(payload.total) || payload.total < 0)
          throw error('INVALID_PAGINATION', 'Nombre de tables invalide.');
        done = ids.size >= payload.total;
      } else done = !payload.nextUri && payload.entities.length < 100;
      if (done) {
        if (matches.length > 1)
          throw error(
            'TABLE_AMBIGUOUS',
            'Plusieurs tables portent le nom du registre. Aucune écriture ne sera effectuée.',
          );
        if (!matches.length) return null;
        const table = ownedTable(await request(`${tablePath(matches[0].id)}?expand=schema`));
        if (table.id !== matches[0].id)
          throw error(
            'TABLE_IDENTITY',
            'La table retournée ne correspond pas à l’identifiant du registre demandé.',
          );
        return table;
      }
      if (!payload.entities.length)
        throw error('INVALID_PAGINATION', 'Lecture des tables interrompue avant la dernière page.');
      // A returned nextUri is never followed with the token.
    }
    throw error('INVALID_PAGINATION', 'La lecture des tables dépasse la limite applicative.');
  }
  async function freshTable(table) {
    const actual = ownedTable(await request(`${tablePath(table.id)}?expand=schema`));
    if (
      actual.id !== table.id ||
      !same(actual.schema, table.schema) ||
      actual.division?.id !== table.division?.id
    )
      throw error(
        'TABLE_CHANGED',
        'Le schéma, la division ou l’identité du registre a changé. Rechargez-le.',
      );
    return actual;
  }
  const readRow = (table, key) =>
    request(`${rowPath(table.id, key)}?showbrief=false`, { missing: true });
  const fingerprint = (rows) =>
    digest(stable([...rows].sort((a, b) => a.key.localeCompare(b.key))));
  function stamp(row, userId) {
    return {
      ...row,
      REVISION: cryptoImpl.randomUUID(),
      ORGANIZATION_ID: organizationId,
      UPDATED_AT: new Date(now()).toISOString(),
      UPDATED_BY: userId,
    };
  }
  async function allRows(table) {
    const rows = [],
      seen = new Set();
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      const result = await request(
        `${tablePath(table.id)}/rows?showbrief=false&pageSize=100&pageNumber=${pageNumber}&sortOrder=ascending`,
      );
      if (
        !Array.isArray(result?.entities) ||
        (result.pageNumber != null && Number(result.pageNumber) !== pageNumber)
      )
        throw error('INVALID_PAGINATION', 'Liste des lignes du référentiel invalide.');
      for (const row of result.entities) {
        validateRow(table, row, organizationId);
        if (seen.has(row.key))
          throw error('INVALID_PAGINATION', 'Ligne dupliquée pendant la lecture.');
        seen.add(row.key);
        rows.push(row);
      }
      if (result.pageCount != null) {
        if (!Number.isInteger(result.pageCount) || result.pageCount < 0 || result.pageCount > 1000)
          throw error('INVALID_PAGINATION', 'Nombre de pages invalide.');
        if (pageNumber >= result.pageCount) return rows;
      } else if (result.total != null) {
        if (!Number.isInteger(result.total) || result.total < 0)
          throw error('INVALID_PAGINATION', 'Nombre de lignes invalide.');
        if (rows.length >= result.total) return rows;
      } else if (!result.nextUri && result.entities.length < 100) return rows;
      if (!result.entities.length)
        throw error('INVALID_PAGINATION', 'La lecture des lignes est incomplète.');
    }
    throw error('INVALID_PAGINATION', 'Trop de pages de référentiel.');
  }
  const isJournal = (r) => r.key.startsWith('journal:');
  function interrupted(lock) {
    return error(
      'UPDATE_INTERRUPTED',
      'Un enregistrement du référentiel reste à terminer. Reprenez-le avant toute nouvelle modification.',
      { operationId: lock.OPERATION_ID, operationStatus: lock.STATUS },
    );
  }
  function validateLock(lock) {
    if (
      lock.key !== LOCK ||
      lock.RECORD_TYPE !== 'OPERATION' ||
      !id(lock.OPERATION_ID) ||
      !['preparing', 'applying', 'committed'].includes(lock.STATUS) ||
      !/^[a-f0-9]{64}$/.test(lock.BEFORE_SHA256) ||
      !/^[a-f0-9]{64}$/.test(lock.AFTER_SHA256)
    )
      throw error('INVALID_RECORD', 'Le journal de l’opération est invalide.');
  }
  async function assertLock(table, lock) {
    if (!same(await readRow(table, LOCK), lock))
      throw error('CONFLICT', 'L’opération a changé. Rechargez le référentiel.');
  }
  function result(table, registry, revision) {
    return {
      tableExists: Boolean(table),
      exists: Boolean(table),
      tableId: table?.id || null,
      organizationId,
      registry: copy(registry),
      revision,
      records: copy(base?.rows || []),
    };
  }
  async function loadInternal() {
    await identity();
    const table = await findTable();
    if (!table) {
      base = null;
      return result(null, null, null);
    }
    const lock = await readRow(table, LOCK);
    if (lock) {
      validateRow(table, lock, organizationId);
      validateLock(lock);
      throw interrupted(lock);
    }
    const rows = await allRows(table),
      laterLock = await readRow(table, LOCK);
    if (laterLock) throw interrupted(laterLock);
    if (rows.some((r) => isJournal(r) || r.key === LOCK))
      throw error(
        'INCOMPLETE_REGISTRY',
        'Le journal du référentiel est incomplet. Aucune lecture partielle ne sera utilisée.',
      );
    const registry = await rowsRegistry(rows, digest),
      revision = await fingerprint(rows);
    if (
      !same(
        rows.sort((a, b) => a.key.localeCompare(b.key)),
        (await allRows(table)).sort((a, b) => a.key.localeCompare(b.key)),
      ) ||
      (await readRow(table, LOCK))
    )
      throw error('CONFLICT', 'Le référentiel a changé pendant sa lecture. Rechargez.');
    base = { table: copy(table), rows: copy(rows), registry: copy(registry) };
    return result(table, registry, revision);
  }
  async function divisionsFor(rows) {
    const source = getFlowDivisions(),
      catalogue = [];
    for (let page = 1; page <= 1000; page++) {
      const data = await request(`/authorization/divisions?pageSize=100&pageNumber=${page}`);
      if (!Array.isArray(data?.entities))
        throw error('INVALID_DIVISION', 'Catalogue des divisions illisible.');
      catalogue.push(...data.entities);
      if (data.pageCount != null) {
        if (!Number.isInteger(data.pageCount) || data.pageCount < 0 || data.pageCount > 1000)
          throw error('INVALID_DIVISION', 'Pagination des divisions invalide.');
        if (page >= data.pageCount) break;
      } else if (!data.nextUri && data.entities.length < 100) break;
      if (!data.entities.length || page === 1000)
        throw error('INVALID_DIVISION', 'Catalogue des divisions incomplet.');
    }
    const previous = new Map(
      rows
        .filter((r) => r.STATUS === 'active' && ['VERSION', 'DECLINATION'].includes(r.RECORD_TYPE))
        .map((r) => [r.FLOW_ID, r]),
    );
    return (flowId) => {
      const declared = source instanceof Map ? source.get(flowId) : source?.[flowId],
        saved = previous.get(flowId);
      const candidates = declared
        ? catalogue.filter((d) => d.id === declared || d.name === declared)
        : saved
          ? catalogue.filter((d) => d.id === saved.DIVISION_ID)
          : [];
      if (candidates.length !== 1 || !id(candidates[0].id) || !candidates[0].name)
        throw error(
          'INVALID_DIVISION',
          `Division introuvable ou ambiguë pour le parcours ${flowId}. Rechargez les parcours et leurs divisions.`,
        );
      return candidates[0];
    };
  }
  const journalKey = async (op, side, key) => `journal:${op}:${side}:${await digest(key)}`;
  async function journalsFor(changes, op, userId) {
    const rows = [];
    for (const change of changes)
      for (const side of ['before', 'after']) {
        const original = change[side];
        rows.push(
          stamp(
            {
              ...(original || blank()),
              key: await journalKey(op, side, change.key),
              RECORD_KEY: change.key,
              OPERATION_ID: op,
              STATUS: original ? side : `${side}_absent`,
              // The original metadata must also round trip: use reserved operation columns.
              JOURNAL_REVISION: original?.REVISION || '',
              JOURNAL_UPDATED_AT: original?.UPDATED_AT || '',
              JOURNAL_UPDATED_BY: original?.UPDATED_BY || '',
              JOURNAL_STATUS: original?.STATUS || '',
            },
            userId,
          ),
        );
      }
    return rows;
  }
  function restoreJournal(row) {
    if (row.STATUS.endsWith('_absent')) return null;
    return {
      ...row,
      key: row.RECORD_KEY,
      OPERATION_ID: '',
      REVISION: row.JOURNAL_REVISION,
      UPDATED_AT: row.JOURNAL_UPDATED_AT,
      UPDATED_BY: row.JOURNAL_UPDATED_BY,
      STATUS: row.JOURNAL_STATUS,
      JOURNAL_REVISION: '',
      JOURNAL_UPDATED_AT: '',
      JOURNAL_UPDATED_BY: '',
      JOURNAL_STATUS: '',
    };
  }
  async function clean(table, lock, journals) {
    // Only this operation's temporary rows may be deleted, never business records.
    for (const row of journals) {
      await assertLock(table, lock);
      const current = await readRow(table, row.key);
      if (!current) continue;
      if (!same(current, row) || !row.key.startsWith(`journal:${lock.OPERATION_ID}:`))
        throw error('CONFLICT', 'Le journal a changé pendant sa clôture.');
      await request(rowPath(table.id, row.key), { method: 'DELETE' });
      if (await readRow(table, row.key))
        throw error('READBACK_MISMATCH', 'La clôture du journal n’est pas confirmée.', {
          uncertain: true,
        });
    }
    await assertLock(table, lock);
    await request(rowPath(table.id, LOCK), { method: 'DELETE' });
    if (await readRow(table, LOCK))
      throw error('CONFLICT', 'Une autre opération a commencé. Rechargez.');
  }
  async function apply(table, lock, changes, journals) {
    for (const { key, before, after } of changes) {
      await assertLock(table, lock);
      const current = await readRow(table, key);
      if (same(current, after)) continue;
      if (!same(current, before))
        throw error('CONFLICT', 'Une ligne du référentiel a changé. La reprise ne l’écrasera pas.');
      await request(before ? rowPath(table.id, key) : `${tablePath(table.id)}/rows`, {
        method: before ? 'PUT' : 'POST',
        body: after,
      });
      if (!same(await readRow(table, key), after))
        throw error('READBACK_MISMATCH', 'Une écriture du référentiel n’est pas confirmée.', {
          uncertain: true,
        });
    }
    const rows = (await allRows(table)).filter((r) => r.key !== LOCK && !isJournal(r));
    if ((await fingerprint(rows)) !== lock.AFTER_SHA256)
      throw error('CONFLICT', 'Le contenu relu diffère du référentiel attendu.');
    await rowsRegistry(rows, digest);
    await assertLock(table, lock);
    const committed = { ...lock, STATUS: 'committed' };
    await request(rowPath(table.id, LOCK), { method: 'PUT', body: committed });
    await assertLock(table, committed);
    await clean(table, committed, journals);
  }
  async function commit(registry) {
    paced = true;
    const actor = await identity(),
      table = await freshTable(base.table),
      previous = copy(base.rows);
    const divisionFor = await divisionsFor(previous),
      encoded = await registryRows(registry, divisionFor, digest),
      next = new Map(previous.map((r) => [r.key, r]));
    for (const row of encoded) {
      const old = next.get(row.key);
      next.set(row.key, old && same(business(old), row) ? old : stamp(row, actor.userId));
    }
    const liveKeys = new Set(encoded.map((r) => r.key));
    for (const old of previous)
      if (old.STATUS === 'active' && !liveKeys.has(old.key))
        next.set(old.key, stamp({ ...old, STATUS: 'deleted' }, actor.userId));
    const changes = [...next.values()]
      .filter(
        (r) =>
          !same(
            r,
            previous.find((p) => p.key === r.key),
          ),
      )
      .map((after) => ({
        key: after.key,
        before: previous.find((p) => p.key === after.key) || null,
        after,
      }));
    for (const row of next.values()) validateRow(table, row, organizationId);
    await rowsRegistry([...next.values()], digest);
    const beforeHash = await fingerprint(previous),
      afterHash = await fingerprint([...next.values()]);
    if (await readRow(table, LOCK))
      throw error(
        'CONFLICT',
        'Un autre enregistrement est en cours. Rechargez avant de reprendre.',
      );
    if ((await fingerprint(await allRows(table))) !== beforeHash)
      throw error('CONFLICT', 'Le référentiel a été modifié depuis sa lecture. Rechargez.');
    if (!changes.length) return result(table, registry, beforeHash);
    const operationId = cryptoImpl.randomUUID(),
      journals = await journalsFor(changes, operationId, actor.userId);
    const lock = stamp(
      {
        ...blank(),
        key: LOCK,
        RECORD_TYPE: 'OPERATION',
        OPERATION_ID: operationId,
        STATUS: 'preparing',
        BEFORE_SHA256: beforeHash,
        AFTER_SHA256: afterHash,
        DIVISION_ID: table.division.id,
      },
      actor.userId,
    );
    for (const row of [lock, ...journals]) validateRow(table, row, organizationId);
    // Unique POST is the lock acquisition. A collision must return 409, not PUT.
    await request(`${tablePath(table.id)}/rows`, { method: 'POST', body: lock });
    try {
      await assertLock(table, lock);
      if (
        (await fingerprint((await allRows(table)).filter((r) => r.key !== LOCK))) !== beforeHash
      ) {
        await clean(table, lock, []);
        throw error('CONFLICT', 'Le référentiel a changé avant la prise du verrou.');
      }
      for (const row of journals) {
        await assertLock(table, lock);
        await request(`${tablePath(table.id)}/rows`, { method: 'POST', body: row });
        if (!same(await readRow(table, row.key), row))
          throw error('READBACK_MISMATCH', 'Le journal préparé n’est pas confirmé.');
      }
      const applying = { ...lock, STATUS: 'applying' };
      await assertLock(table, lock);
      await request(rowPath(table.id, LOCK), { method: 'PUT', body: applying });
      await assertLock(table, applying);
      await apply(table, applying, changes, journals);
      return await loadInternal();
    } catch (e) {
      e.uncertain = true;
      e.operationId = operationId;
      throw e;
    }
  }
  async function exclusive(operation) {
    if (busy) throw error('BUSY', 'Une opération du référentiel est déjà en cours.');
    busy = true;
    try {
      return await operation();
    } catch (e) {
      base = null;
      throw e;
    } finally {
      busy = false;
      paced = false;
    }
  }
  const load = () => exclusive(loadInternal);
  const initialize = async (registry, divisionId) => {
    registry = registryDocument(registry);
    const definition = governanceTableDefinition(divisionId);
    return exclusive(async () => {
      const state = await loadInternal();
      if (state.tableExists)
        throw error(
          'ALREADY_INITIALIZED',
          'La table existe déjà. Chargez-la avant de la modifier.',
        );
      const division = await request('/authorization/divisions/' + encodeURIComponent(divisionId));
      if (division?.id !== divisionId)
        throw error('INVALID_DIVISION', 'La division sélectionnée ne peut pas être vérifiée.');
      await identity();
      if (await findTable()) throw error('CONFLICT', 'La table vient d’être créée. Rechargez.');
      const created = await request('/flows/datatables', { method: 'POST', body: definition });
      if (!id(created?.id) || created.name !== GOVERNANCE_TABLE_NAME)
        throw error('TABLE_IDENTITY', 'Création de la table non confirmée.', { uncertain: true });
      const table = ownedTable(await request(`${tablePath(created.id)}?expand=schema`));
      if (table.id !== created.id || table.division?.id !== divisionId)
        throw error('TABLE_IDENTITY', 'Identité de la table créée invalide.', { uncertain: true });
      base = { table, rows: [], registry: { schemaVersion: 1, coreModels: [], declinations: [] } };
      return commit(registry);
    });
  };
  const save = async (registry) => {
    registry = registryDocument(registry);
    return exclusive(() => {
      if (!base?.table)
        throw error('LOAD_REQUIRED', 'Chargez le référentiel avant de l’enregistrer.');
      return commit(registry);
    });
  };
  const recover = (operationId) =>
    exclusive(async () => {
      paced = true;
      await identity();
      const table = await findTable();
      if (!table) throw error('LOAD_REQUIRED', 'Référentiel absent.');
      const lock = await readRow(table, LOCK);
      if (!lock) return loadInternal();
      validateRow(table, lock, organizationId);
      validateLock(lock);
      if (lock.OPERATION_ID !== operationId)
        throw error('CONFLICT', 'Une autre opération a remplacé celle à reprendre.');
      const rows = await allRows(table),
        current = rows.filter((r) => r.key !== LOCK && !isJournal(r)),
        journals = rows.filter(isJournal);
      if (journals.some((r) => r.OPERATION_ID !== operationId))
        throw error('CORRUPT_REGISTRY', 'Le journal contient une autre opération.');
      if (lock.STATUS === 'preparing') {
        await rowsRegistry(current, digest); // Preparing never writes business rows; abandoning it is safe.
        await clean(table, lock, journals);
        return loadInternal();
      }
      if (lock.STATUS === 'committed') {
        if ((await fingerprint(current)) !== lock.AFTER_SHA256)
          throw error('CONFLICT', 'Le référentiel a changé après son enregistrement.');
        await rowsRegistry(current, digest);
        await clean(table, lock, journals);
        return loadInternal();
      }
      const pairs = new Map();
      for (const row of journals) {
        const side = row.STATUS.startsWith('before')
          ? 'before'
          : row.STATUS === 'after'
            ? 'after'
            : null;
        if (!side || row.key !== (await journalKey(operationId, side, row.RECORD_KEY)))
          throw error('CORRUPT_REGISTRY', 'Clé de journal invalide.');
        const pair = pairs.get(row.RECORD_KEY) || { key: row.RECORD_KEY };
        if (side in pair) throw error('CORRUPT_REGISTRY', 'Journal dupliqué.');
        pair[side] = restoreJournal(row);
        pairs.set(row.RECORD_KEY, pair);
      }
      const changes = [...pairs.values()],
        before = new Map(current.map((r) => [r.key, r])),
        after = new Map(before);
      for (const change of changes) {
        if (!('before' in change) || !change.after)
          throw error('INCOMPLETE_REGISTRY', 'Le journal de reprise est incomplet.');
        const actual = before.get(change.key) || null;
        if (!same(actual, change.before) && !same(actual, change.after))
          throw error('CONFLICT', 'Une ligne a été modifiée en dehors de cette opération.');
        if (change.before) before.set(change.key, change.before);
        else before.delete(change.key);
        after.set(change.key, change.after);
        validateRow(table, change.after, organizationId);
      }
      if (
        (await fingerprint([...before.values()])) !== lock.BEFORE_SHA256 ||
        (await fingerprint([...after.values()])) !== lock.AFTER_SHA256
      )
        throw error(
          'CORRUPT_REGISTRY',
          'Le journal ne correspond pas aux empreintes de l’opération.',
        );
      await rowsRegistry([...after.values()], digest);
      await apply(table, lock, changes, journals);
      return loadInternal();
    });
  return Object.freeze({ load, initialize, save, recover });
}
