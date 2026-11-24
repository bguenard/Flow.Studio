import { GENESYS_API_ORIGIN } from './genesys-direct.js';
import {
  FLOW_INITIALIZATION,
  flowInitializationDefinition,
  validateFlowInitializationTable,
  validateFlowInitializationRow,
} from './flow-initialization.js';
/** Read or create the dedicated table; journey publication owns row writes. */
export function createFlowInitializationClient(
  token,
  { organizationId, fetchImpl = globalThis.fetch, signal } = {},
) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token) || !organizationId)
    throw Error('Une session Genesys vérifiée est nécessaire.');
  let busy = false;
  async function request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(GENESYS_API_ORIGIN + '/api/v2' + path, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
          : AbortSignal.timeout(25000),
      });
    } catch {
      throw Object.assign(
        Error('Lecture ou écriture interrompue. Rechargez pour vérifier avant de recommencer.'),
        { uncertain: method !== 'GET' },
      );
    }
    if (!response.ok)
      throw Object.assign(
        Error(
          `Initialisation Genesys : HTTP ${response.status}. Rechargez pour vérifier le résultat.`,
        ),
        { status: response.status, uncertain: method !== 'GET' && response.status >= 500 },
      );
    try {
      return await response.json();
    } catch {
      throw Object.assign(Error('Réponse Genesys illisible. Rechargez pour vérifier.'), {
        uncertain: method !== 'GET',
      });
    }
  }
  async function identity() {
    const user = await request('/users/me?expand=organization'),
      org = user?.organization?.id ? user.organization : await request('/organizations/me');
    if (!user?.id || org?.id !== organizationId)
      throw Error('La session ne correspond plus à cette organisation.');
  }
  async function collect(path, extra = '') {
    const rows = [],
      seen = new Set();
    for (let page = 1; page <= 1000; page++) {
      const data = await request(`${path}?pageSize=100&pageNumber=${page}${extra}`);
      if (
        !Array.isArray(data.entities) ||
        (data.pageNumber != null && Number(data.pageNumber) !== page)
      )
        throw Error('Pagination Genesys invalide.');
      for (const row of data.entities) {
        const id = row.id ?? row.key;
        if (typeof id !== 'string' || !id || seen.has(id))
          throw Error('Identité de ligne absente ou dupliquée.');
        seen.add(id);
        rows.push(row);
      }
      let done;
      if (data.pageCount != null) {
        const n = Number(data.pageCount);
        if (!Number.isInteger(n) || n < 0 || n > 1000) throw Error('Pagination Genesys invalide.');
        done = page >= n;
      } else if (data.total != null) {
        if (!Number.isInteger(data.total) || data.total < 0) throw Error('Total Genesys invalide.');
        done = rows.length >= data.total;
      } else done = !data.nextUri && data.entities.length < 100;
      if (done) return rows;
      if (!data.entities.length) throw Error('Lecture Genesys incomplète.');
    }
    throw Error('Limite de pagination atteinte.');
  }
  async function tables() {
    return collect('/flows/datatables', '&sortBy=id&sortOrder=ascending');
  }
  async function readTable(list, name, required = false) {
    const matches = list.filter((t) => t.name?.toUpperCase() === name.toUpperCase());
    if (matches.length > 1 || (required && matches.length !== 1))
      throw Error(`Table absente ou ambiguë : ${name}.`);
    if (!matches.length) return null;
    const table = await request(
      `/flows/datatables/${encodeURIComponent(matches[0].id)}?expand=schema`,
    );
    if (table.id !== matches[0].id || table.name.toUpperCase() !== name.toUpperCase())
      throw Error('Identité de table incohérente.');
    if (name === FLOW_INITIALIZATION) validateFlowInitializationTable(table);
    const rows = await collect(
      `/flows/datatables/${encodeURIComponent(table.id)}/rows`,
      '&showbrief=false',
    );
    if (name === FLOW_INITIALIZATION) rows.forEach(validateFlowInitializationRow);
    return { ...table, rows };
  }
  async function load() {
    await identity();
    const table = await readTable(await tables(), FLOW_INITIALIZATION);
    return { status: table ? 'ready' : 'missing', table };
  }
  async function initialize(divisionId) {
    if (busy) throw Error('Une opération est en cours.');
    busy = true;
    try {
      const definition = flowInitializationDefinition(divisionId);
      await identity();
      if ((await tables()).some((t) => t.name?.toUpperCase() === FLOW_INITIALIZATION))
        throw Error('La table existe déjà. Rechargez-la.');
      const division = await request('/authorization/divisions/' + encodeURIComponent(divisionId));
      if (division.id !== divisionId) throw Error('Division non vérifiable.');
      await identity();
      if ((await tables()).some((t) => t.name?.toUpperCase() === FLOW_INITIALIZATION))
        throw Error('La table vient d’être créée. Rechargez-la.');
      const created = await request('/flows/datatables', { method: 'POST', body: definition });
      const result = await load();
      if (
        !created.id ||
        result.table?.id !== created.id ||
        result.table.division?.id !== divisionId
      )
        throw Object.assign(Error('Création non confirmée. Rechargez.'), { uncertain: true });
      return result;
    } finally {
      busy = false;
    }
  }
  return { load, initialize };
}
