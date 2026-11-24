import {
  FLOW_INITIALIZATION,
  validateFlowInitializationTable,
  validateFlowInitializationCatalogue,
  initializationAttributes,
} from './flow-initialization.js';
import {
  PARTICIPANT_CATALOGUE,
  isParticipantCatalogue,
  validateParticipantCatalogueTable,
  validateParticipantDefinition,
  validateParticipantDefinitions,
  catalogueDefinition,
  validateParticipantValue,
} from './participant-catalogue.js';
import { validateDecision, decisionFields } from './decision-fields.js';
import {
  participantIdentity,
  participantAssignments,
  parseAssignments,
} from './participant-names.js';
/** Controlled V5 row writer. No automatic retries for remote mutations. */
import { GENESYS_API_ORIGIN } from './genesys-direct.js';
import { isStudioTable } from './wolf-scope.js';
import {
  loadResourceCatalogue,
  resourceForField,
  validateResourceChoice,
} from './genesys-resources.js';
import { coerceRowValue } from './draft-fields.js';
import {
  targetTablesFor,
  participantTableFor,
  routeTargetKey,
  localReferenceTable,
} from './v5-fields.js';
export const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const equal = (a, b) => stable(a) === stable(b);
const copy = (value) => structuredClone(value);
const own = (object, key) => Object.hasOwn(object || {}, key);
const dynamicTarget = (value) =>
  /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
/** Only explicit static references are followed; runtime subroutines and transfer suffixes are not guessed. */
function createdDependencies(entry, snapshot, created) {
  const dependencies = new Set(),
    row = entry.after;
  const add = (name, key) => {
    if (!name || !key || dynamicTarget(key)) return;
    const tables = snapshot.tables.filter(
      (table) => table.name.toUpperCase() === name.toUpperCase(),
    );
    if (tables.length !== 1) return;
    const id = `${tables[0].id}:${key}`;
    if (created.has(id)) dependencies.add(id);
  };
  for (const [field, value] of Object.entries(row)) {
    if (/(^|_)TARGET_TYPE(?:_\d+)?$/.test(field)) {
      const type = String(value || '')
        .split('|')[0]
        .trim()
        .toLowerCase();
      const [target, ...extras] = String(row[routeTargetKey(field, row)] || '').split('|');
      add(targetTablesFor({ tableName: entry.table })[type], target);
      for (const extra of extras)
        if (/^pdata:/i.test(extra))
          for (const key of extra.slice(6).split(';'))
            add(participantTableFor({ tableName: entry.table }), key);
    } else add(localReferenceTable(field, { tableName: entry.table, row }), String(value || ''));
  }
  if (/^W_INBOUND_CALL_v5$/i.test(entry.table)) add(FLOW_INITIALIZATION, entry.key);
  if (entry.table === FLOW_INITIALIZATION)
    for (const item of initializationAttributes(row)) add(PARTICIPANT_CATALOGUE, item.name);
  if (/^W_PARTICIPANT_DATA_v5$/i.test(entry.table)) add(PARTICIPANT_CATALOGUE, entry.key);
  return [...dependencies];
}
/** Cyclic new blocks are staged as a group; no existing route is changed before all creations. */
export function orderPublicationEntries(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry])),
    visited = new Set(),
    visiting = new Set(),
    ordered = [];
  const visit = (entry) => {
    if (visited.has(entry.id) || visiting.has(entry.id)) return;
    visiting.add(entry.id);
    for (const id of entry.requiresCreatedRows || []) {
      const dependency = byId.get(id);
      if (dependency?.kind === 'create' && !/INBOUND_(CALL|MESSAGE)/i.test(dependency.table))
        visit(dependency);
    }
    visiting.delete(entry.id);
    visited.add(entry.id);
    ordered.push(entry);
  };
  const creations = entries
    .filter((entry) => entry.kind === 'create')
    .sort(
      (a, b) =>
        Number(/INBOUND_(CALL|MESSAGE)/i.test(a.table)) -
        Number(/INBOUND_(CALL|MESSAGE)/i.test(b.table)),
    );
  for (const entry of creations) visit(entry);
  for (const entry of entries) visit(entry);
  return ordered;
}
export function validatePublicationSelection(entries) {
  const selected = new Set(entries.map((entry) => entry.id));
  for (const entry of entries)
    for (const id of entry.requiresCreatedRows || [])
      if (!selected.has(id))
        throw Error(
          `Publication incomplète : « ${entry.label || entry.key} » référence une nouvelle ligne non sélectionnée. Publiez ensemble les blocs et leurs raccordements.`,
        );
}
export function rebaseDraft(draft, publishedRow) {
  if (!draft) return null;
  const row = copy(publishedRow);
  for (const key of Object.keys(draft.row))
    if (key !== 'key' && !equal(draft.row[key], draft.original[key]))
      row[key] = copy(draft.row[key]);
  return equal(row, publishedRow) ? null : { ...draft, original: copy(publishedRow), row };
}
export function publicationRows(snapshot, drafts, creations = new Map(), blocks = new Map()) {
  const mappings = [...creations.values(), ...blocks.values()].flatMap(
    (item) => item.mappings || [],
  );
  const created = new Set(mappings.map((m) => m.nodeId));
  const participantNames = new Map(
    mappings.filter((m) => m.participantName).map((m) => [m.nodeId, m.participantName]),
  );
  const participantSources = new Map(
    mappings.filter((m) => m.participantSource).map((m) => [m.nodeId, m.participantSource]),
  );
  const rows = [];
  for (const table of snapshot.tables)
    for (const original of table.rows) {
      const id = `${table.id}:${original.key}`,
        draft = drafts.get(id),
        isNew = created.has(id);
      if (!isNew && !draft) continue;
      const after = copy(draft?.row || original),
        before = isNew ? null : copy(draft.original);
      const fields = Object.keys(after).filter(
        (key) => key !== 'key' && (isNew || !equal(before[key], after[key])),
      );
      if (!fields.length && !isNew) continue;
      rows.push({
        id,
        tableId: table.id,
        table: table.name,
        key: String(original.key),
        label: after.DESCRIPTION || original.key,
        before,
        after,
        fields,
        kind: isNew ? 'create' : 'update',
      });
    }
  for (const entry of rows) {
    if (entry.kind === 'create' && participantSources.has(entry.id))
      entry.participantSource = copy(participantSources.get(entry.id));
    entry.requiresCreatedRows = createdDependencies(entry, snapshot, created);
    if (entry.kind === 'create' && participantNames.has(entry.id))
      entry.participantName = participantNames.get(entry.id);
    if (
      (snapshot.source?.participantCatalogueRequired ||
        snapshot.tables.some((t) => isParticipantCatalogue(t.name))) &&
      (/^W_(PARTICIPANT_DATA|DECISION)_v5$/i.test(entry.table) ||
        entry.table === FLOW_INITIALIZATION)
    )
      entry.catalogueValidation = true;
  }
  return orderPublicationEntries(rows);
}
export function validatePublicationRow(row, schema, fields = Object.keys(row)) {
  if (!schema?.properties || !own(schema.properties, 'key'))
    throw Error('Schéma Genesys incomplet : publication impossible.');
  if (typeof row.key !== 'string' || !row.key) throw Error('Clé de ligne absente.');
  for (const key of schema.required || [])
    if (!own(row, key) || row[key] === undefined) throw Error(`Champ obligatoire absent : ${key}.`);
  for (const key of fields) {
    if (!own(schema.properties, key))
      throw Error(`Le champ ${key} n’existe plus dans le schéma Genesys.`);
    if (schema.properties[key].readOnly)
      throw Error(`Le champ ${key} est en lecture seule dans le schéma Genesys.`);
    const value = row[key];
    if (value === undefined) throw Error(`Valeur absente : ${key}.`);
    const checked = coerceRowValue(value, value, schema.properties[key]);
    if (!equal(value, checked))
      throw Error(`Le type de ${key} ne correspond pas au schéma Genesys.`);
  }
}
export function createPublicationClient(
  token,
  { fetchImpl = globalThis.fetch, now = () => Date.now() } = {},
) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))
    throw Error('Connectez-vous à Genesys avant de publier.');
  const plans = new WeakMap();
  let busy = false;
  async function request(path, { method = 'GET', body, missing = false } = {}) {
    let response;
    try {
      response = await fetchImpl(GENESYS_API_ORIGIN + '/api/v2' + path, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      const e = Error(
        method === 'GET'
          ? 'Lecture Genesys interrompue.'
          : 'Réponse Genesys non reçue. Vérifiez le résultat avant toute nouvelle tentative.',
      );
      e.uncertain = method !== 'GET';
      throw e;
    }
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      const endpoint = path.split('?')[0];
      const action =
        endpoint === '/users/me'
          ? 'lecture du compte utilisateur'
          : endpoint === '/organizations/me'
            ? 'lecture de l’organisation'
            : method === 'GET'
              ? 'lecture de la configuration Data Tables'
              : method === 'POST'
                ? 'création d’une ligne Data Table'
                : 'modification d’une ligne Data Table';
      const e = Error(
        response.status === 403
          ? `Accès Genesys refusé pour la ${action} (HTTP 403 · ${method} /api/v2${endpoint}). Vérifiez les autorisations de la session et les scopes OAuth de l’application.`
          : response.status === 401
            ? 'Session Genesys expirée.'
            : response.status === 409
              ? 'La ligne existe déjà ou a été modifiée.'
              : response.status === 429
                ? 'Limite Genesys atteinte. Réessayez après vérification.'
                : `Opération Genesys refusée (HTTP ${response.status}).`,
      );
      e.status = response.status;
      e.endpoint = endpoint;
      e.method = method;
      e.uncertain = method !== 'GET' && response.status >= 500;
      throw e;
    }
    try {
      return await response.json();
    } catch {
      const e = Error('Réponse Genesys illisible.');
      e.uncertain = method !== 'GET';
      throw e;
    }
  }
  const path = (entry) =>
    `/flows/datatables/${encodeURIComponent(entry.tableId)}/rows/${encodeURIComponent(entry.key)}?showbrief=false`;
  const read = (entry) => request(path(entry), { missing: true });
  async function identity() {
    const user = await request('/users/me?expand=organization');
    const org = user?.organization?.id ? user.organization : await request('/organizations/me');
    if (!user?.id || !org?.id) throw Error('Identité Genesys non vérifiable.');
    return {
      userId: user.id,
      userName: user.name || user.id,
      organizationId: org.id,
      organizationName: org.name || org.id,
    };
  }
  async function collectTyped(path) {
    const entities = [],
      seen = new Set();
    for (let page = 1; page <= 1000; page++) {
      const data = await request(`${path}?pageSize=100&pageNumber=${page}&showbrief=false`);
      if (
        !Array.isArray(data.entities) ||
        (data.pageNumber != null && Number(data.pageNumber) !== page)
      )
        throw Error('Lecture du catalogue typé incomplète.');
      for (const row of data.entities) {
        const id = row.id ?? row.key;
        if (typeof id !== 'string' || seen.has(id))
          throw Error('Pagination du catalogue typé incohérente.');
        seen.add(id);
        entities.push(row);
      }
      if (data.pageCount != null) {
        const count = Number(data.pageCount);
        if (!Number.isInteger(count) || count < 0 || count > 1000)
          throw Error('Pagination du catalogue typé invalide.');
        if (page >= count) return entities;
      } else if (!data.nextUri && data.entities.length < 100) return entities;
      if (!data.entities.length) throw Error('Lecture du catalogue typé incomplète.');
    }
    throw Error('Limite de lecture du catalogue typé atteinte.');
  }
  async function readParticipantSource(entry) {
    const source = entry.participantSource;
    if (!source) return null;
    if (
      entry.kind !== 'create' ||
      !/^W_PARTICIPANT_DATA_v5$/i.test(entry.table) ||
      source.tableId !== entry.tableId ||
      typeof source.key !== 'string' ||
      !source.key ||
      source.key === entry.key ||
      source.row?.key !== source.key
    )
      throw Error('Origine de la configuration partagée invalide. Recréez la copie.');
    const row = await read({ tableId: source.tableId, key: source.key });
    if (!row || !equal(row, source.row))
      throw Error(
        `La configuration partagée « ${source.key} » a changé. Recréez la copie avant publication.`,
      );
    return row;
  }
  async function verifyTypedParticipants(entries) {
    const guarded = entries.filter(
      (e) =>
        e.table === FLOW_INITIALIZATION ||
        (e.catalogueValidation &&
          (/^W_DECISION_v5$/i.test(e.table)
            ? e.kind === 'create' || e.fields.some((f) => decisionFields.includes(f))
            : e.fields.some((f) => /^PDATA_LIST_[1-5]$/.test(f)))),
    );
    if (!guarded.length) return;
    const tables = (await collectTyped('/flows/datatables')).filter(
      (t) => t.name === PARTICIPANT_CATALOGUE,
    );
    if (tables.length !== 1)
      throw Error('Le catalogue administrateur doit être disponible avant publication.');
    const table = validateParticipantCatalogueTable(
      await request(`/flows/datatables/${encodeURIComponent(tables[0].id)}?expand=schema`),
    );
    const rows = await collectTyped(`/flows/datatables/${encodeURIComponent(table.id)}/rows`);
    rows.push(
      ...entries
        .filter((e) => e.kind === 'create' && isParticipantCatalogue(e.table))
        .map((e) => e.after),
    );
    validateParticipantDefinitions(rows);
    const snapshot = {
      source: { participantCatalogueRequired: true },
      tables: [{ ...table, rows }],
    };
    for (const entry of guarded) {
      if (entry.table === FLOW_INITIALIZATION) {
        validateFlowInitializationCatalogue(entry.after, snapshot);
        continue;
      }
      if (/^W_DECISION_v5$/i.test(entry.table)) {
        validateDecision(entry.after, { snapshot });
        continue;
      }
      const baseline = entry.kind === 'create' ? await readParticipantSource(entry) : entry.before;
      for (const field of Object.keys(entry.after).filter(
        (field) =>
          /^PDATA_LIST_[1-5]$/.test(field) &&
          (entry.kind === 'create' || entry.fields.includes(field)),
      )) {
        const previous = parseAssignments(baseline?.[field]);
        for (const [index, item] of parseAssignments(entry.after[field]).entries()) {
          // Legacy assignments already in service survive an unrelated edit unchanged.
          if (previous[index]?.name === item.name && previous[index]?.value === item.value)
            continue;
          const definition = catalogueDefinition(snapshot, item.name);
          if (!definition)
            throw Error(`« ${item.name} » doit être déclaré dans le catalogue administrateur.`);
          if (/\$var:|^var:/i.test(item.value)) continue;
          validateParticipantValue(definition, item.value);
        }
      }
    }
  }
  async function verifyCatalogueNames(entries) {
    const guarded = entries.filter((e) => isParticipantCatalogue(e.table));
    if (!guarded.length) return;
    const names = guarded.map((e) => participantIdentity(e.key));
    if (new Set(names).size !== names.length)
      throw Error('Nom de donnée dupliqué dans le catalogue à publier.');
    for (const tableId of new Set(guarded.map((e) => e.tableId))) {
      for (let page = 1; page <= 1000; page++) {
        const data = await request(
          `/flows/datatables/${encodeURIComponent(tableId)}/rows?showbrief=false&pageSize=100&pageNumber=${page}`,
        );
        if (
          !Array.isArray(data.entities) ||
          (data.pageNumber != null && Number(data.pageNumber) !== page)
        )
          throw Error('Lecture du catalogue incomplète.');
        for (const row of data.entities)
          if (names.includes(participantIdentity(row.key)))
            throw Error(`La donnée « ${row.key} » existe déjà dans le catalogue Genesys.`);
        if (data.pageCount != null) {
          const count = Number(data.pageCount);
          if (!Number.isInteger(count) || count < 0 || count > 1000)
            throw Error('Pagination du catalogue invalide.');
          if (page >= count) break;
        } else if (!data.nextUri && data.entities.length < 100) break;
        if (!data.entities.length || page === 1000) throw Error('Contrôle du catalogue incomplet.');
      }
    }
    const divisions = await loadResourceCatalogue('divisions', token, { fetchImpl });
    for (const entry of guarded)
      if (
        !divisions.some((d) => d.id === entry.after.DIVISION_ID && d.name === entry.after.DIVISION)
      )
        throw Error('La division de la donnée a changé dans Genesys.');
  }
  async function verifyParticipantNames(entries) {
    const guarded = entries.filter((e) => e.participantName);
    if (!guarded.length) return;
    const seen = new Set();
    for (const entry of guarded) {
      const items = participantAssignments(entry.after),
        name = entry.participantName;
      if (
        entry.kind !== 'create' ||
        !/^W_PARTICIPANT_DATA_v5$/i.test(entry.table) ||
        entry.key !== name ||
        items.length !== 1 ||
        items[0].name !== name
      )
        throw Error('La définition de la donnée ne correspond plus à sa clé.');
      const id = participantIdentity(name);
      if (seen.has(id)) throw Error(`L’attribut « ${name} » est créé plusieurs fois.`);
      seen.add(id);
    }
    for (const tableId of new Set(guarded.map((e) => e.tableId))) {
      const names = guarded.filter((e) => e.tableId === tableId).map((e) => e.participantName);
      for (let page = 1; page <= 10000; page++) {
        const data = await request(
          `/flows/datatables/${encodeURIComponent(tableId)}/rows?showbrief=false&pageSize=100&pageNumber=${page}`,
        );
        if (!Array.isArray(data.entities))
          throw Error('Impossible de contrôler les noms des données dans Genesys.');
        for (const row of data.entities) {
          const occupied = [
            row.key,
            row.PDATA_NAME,
            ...participantAssignments(row).map((i) => i.name),
          ]
            .filter((v) => v != null)
            .map(participantIdentity);
          const collision = names.find((name) => occupied.includes(participantIdentity(name)));
          if (collision)
            throw Error(
              `L’attribut ou la clé « ${collision} » existe déjà dans Genesys. Rechargez les données.`,
            );
        }
        if (data.pageCount != null) {
          const count = Number(data.pageCount);
          if (!Number.isInteger(count) || count < 0)
            throw Error('Pagination des données Genesys invalide.');
          if (page >= count) break;
        } else if (data.entities.length < 100) break;
        if (page === 10000) throw Error('Le contrôle des noms des données est incomplet.');
      }
    }
  }
  async function prepare(entries, { organizationId, source = 'changes' } = {}) {
    if (!entries?.length) throw Error('Aucune ligne à publier.');
    validatePublicationSelection(entries);
    entries = orderPublicationEntries(entries);
    const actor = await identity();
    if (!organizationId || actor.organizationId !== organizationId)
      throw Error(
        'L’organisation de la source ne correspond pas à votre session Genesys. Rechargez les parcours.',
      );
    const prepared = [],
      schemas = new Map(),
      ids = new Set(),
      catalogues = {};
    for (const candidate of entries) {
      const entry = copy(candidate);
      for (const key of ['status', 'verifiedAt', 'error', 'observed']) delete entry[key];
      if (
        (!isStudioTable(entry.table) &&
          !isParticipantCatalogue(entry.table) &&
          entry.table !== FLOW_INITIALIZATION) ||
        !entry.tableId ||
        !entry.key ||
        ids.has(entry.id) ||
        entry.id !== `${entry.tableId}:${entry.key}`
      )
        throw Error('Ligne hors périmètre WOLF ou identité dupliquée.');
      if (
        !['create', 'update'].includes(entry.kind) ||
        entry.after.key !== entry.key ||
        (entry.kind === 'update' && entry.before?.key !== entry.key)
      )
        throw Error('L’identité de la ligne ne peut pas être modifiée.');
      ids.add(entry.id);
      if (!schemas.has(entry.tableId)) {
        const table = await request(
          `/flows/datatables/${encodeURIComponent(entry.tableId)}?expand=schema`,
        );
        if (table.id !== entry.tableId || table.name !== entry.table)
          throw Error('La table Genesys a changé.');
        if (entry.table === FLOW_INITIALIZATION) validateFlowInitializationTable(table);
        if (isParticipantCatalogue(entry.table)) validateParticipantCatalogueTable(table);
        schemas.set(entry.tableId, table.schema);
      }
      if (isParticipantCatalogue(entry.table)) {
        if (entry.kind !== 'create')
          throw Error('Le catalogue ne permet ici que la création de nouvelles définitions.');
        validateParticipantDefinition(entry.after);
      }
      const remote = await read(entry);
      if (entry.kind === 'create' && remote !== null)
        throw Error(`La ligne « ${entry.key} » existe déjà dans Genesys.`);
      if (entry.kind === 'update' && !remote)
        throw Error(`La ligne « ${entry.key} » a été supprimée dans Genesys.`);
      const removed =
        String(source).startsWith('restore:') && entry.kind === 'update'
          ? Object.keys(entry.before).filter((k) => k !== 'key' && !own(entry.after, k))
          : [];
      const changed =
        entry.kind === 'create'
          ? Object.keys(entry.after)
          : Object.keys(entry.after).filter(
              (k) => k !== 'key' && !equal(entry.before[k], entry.after[k]),
            );
      const fields = [...changed, ...removed];
      if (!fields.length) throw Error('Aucun changement sur cette ligne.');
      if (remote && fields.some((k) => !equal(remote[k], entry.before[k])))
        throw Error(`Conflit sur « ${entry.key} » : un réglage à publier a changé dans Genesys.`);
      const after = remote
        ? { ...remote, ...Object.fromEntries(changed.map((k) => [k, entry.after[k]])) }
        : entry.after;
      for (const key of removed) delete after[key];
      validatePublicationRow(
        after,
        schemas.get(entry.tableId),
        entry.kind === 'create' ? Object.keys(after) : changed,
      );
      // Verify newly selected resources against fresh catalogues, not an old UI cache.
      for (const key of changed) {
        const node = { tableName: entry.table, row: after },
          spec = resourceForField(key, node),
          value = after[key];
        if (
          !spec ||
          spec.external ||
          value == null ||
          value === '' ||
          /^variable$/i.test(String(value)) ||
          (!spec.audio && /\$?var:/i.test(String(value)))
        )
          continue;
        const choices = spec.audio
          ? String(value)
              .split('|')
              .filter((v) => /^(?:pr|prompt):/i.test(v) && !/\$?var:/i.test(v))
              .map((v) => v.replace(/^prompt:/i, 'pr:'))
          : [value];
        if (!choices.length) continue;
        if (!catalogues[spec.catalogue])
          catalogues[spec.catalogue] = await loadResourceCatalogue(spec.catalogue, token, {
            fetchImpl,
          });
        for (const choice of choices)
          validateResourceChoice({ key, resource: spec }, node, choice, catalogues);
      }
      if (isParticipantCatalogue(entry.table)) {
        const divisions =
          catalogues.divisions || (await loadResourceCatalogue('divisions', token, { fetchImpl }));
        catalogues.divisions = divisions;
        if (!divisions.some((d) => d.id === after.DIVISION_ID && d.name === after.DIVISION))
          throw Error('La division du catalogue ne correspond pas à son identifiant Genesys.');
      }
      prepared.push({
        ...entry,
        before: remote,
        after,
        fields,
        ...(removed.length ? { removed } : {}),
      });
    }
    await verifyCatalogueNames(prepared);
    await verifyParticipantNames(prepared);
    await verifyTypedParticipants(prepared);
    const plan = Object.freeze({
      id: globalThis.crypto.randomUUID(),
      createdAt: now(),
      actor,
      source,
      entries: prepared.map((e) => Object.freeze(e)),
    });
    // Clone all nested contents out of caller control before execution.
    plans.set(plan, copy(plan));
    return plan;
  }
  async function publish(plan, { journal, onProgress = () => {} } = {}) {
    if (busy || !plans.has(plan)) throw Error('Préparez un nouveau contrôle avant publication.');
    if (now() - plan.createdAt > 300000)
      throw Error('Le contrôle a expiré. Relancez la vérification.');
    if (typeof journal !== 'function') throw Error('Le journal de publication est indisponible.');
    const reviewed = plans.get(plan);
    plans.delete(plan);
    plan = reviewed;
    busy = true;
    const run = {
      id: plan.id,
      createdAt: new Date(plan.createdAt).toISOString(),
      actor: plan.actor,
      source: plan.source,
      status: 'running',
      entries: plan.entries.map((e) => ({ ...copy(e), status: 'pending' })),
    };
    try {
      const actor = await identity();
      if (actor.organizationId !== plan.actor.organizationId || actor.userId !== plan.actor.userId)
        throw Error('La session Genesys a changé.');
      await journal(copy(run));
      for (const tableId of new Set(run.entries.map((e) => e.tableId))) {
        const table = await request(
          `/flows/datatables/${encodeURIComponent(tableId)}?expand=schema`,
        );
        for (const entry of run.entries.filter((e) => e.tableId === tableId)) {
          if (table.id !== entry.tableId || table.name !== entry.table)
            throw Error('La table Genesys a changé.');
          if (entry.table === FLOW_INITIALIZATION) validateFlowInitializationTable(table);
          if (isParticipantCatalogue(entry.table)) {
            validateParticipantCatalogueTable(table);
            validateParticipantDefinition(entry.after);
          }
          validatePublicationRow(
            entry.after,
            table.schema,
            entry.kind === 'create'
              ? Object.keys(entry.after)
              : entry.fields.filter((k) => !(entry.removed || []).includes(k)),
          );
        }
      }
      await verifyCatalogueNames(run.entries);
      await verifyParticipantNames(run.entries);
      await verifyTypedParticipants(run.entries);
      // All rows checked before the first write, then again immediately before each.
      for (const entry of run.entries)
        if (!equal(await read(entry), entry.before))
          throw Error(`Conflit récent sur « ${entry.key} ». Aucune écriture commencée.`);
      for (const entry of run.entries) {
        if (!equal(await read(entry), entry.before))
          throw Error(`Conflit sur « ${entry.key} ». Publication interrompue.`);
        if (entry.participantSource) await readParticipantSource(entry);
        entry.status = 'writing';
        await journal(copy(run));
        onProgress(copy(run));
        let accepted = false;
        try {
          await request(
            entry.kind === 'create'
              ? `/flows/datatables/${encodeURIComponent(entry.tableId)}/rows`
              : path(entry).split('?')[0],
            { method: entry.kind === 'create' ? 'POST' : 'PUT', body: entry.after },
          );
          accepted = true;
          const actual = await read(entry);
          if (
            !actual ||
            Object.keys(entry.after).some((k) => !equal(actual[k], entry.after[k])) ||
            (entry.removed || []).some((k) => actual[k] != null && actual[k] !== '')
          ) {
            const e = Error('La relecture Genesys ne confirme pas la valeur attendue.');
            e.uncertain = true;
            throw e;
          }
          entry.after = actual;
          entry.status = 'verified';
          entry.verifiedAt = new Date(now()).toISOString();
        } catch (error) {
          entry.status = error.uncertain || accepted ? 'uncertain' : 'failed';
          entry.error = error.message;
          throw error;
        }
        await journal(copy(run));
        onProgress(copy(run));
      }
      run.status = 'verified';
    } catch (error) {
      run.status = run.entries.some((e) => e.status === 'writing' || e.status === 'uncertain')
        ? 'uncertain'
        : run.entries.some((e) => e.status === 'verified')
          ? 'partial'
          : 'failed';
      run.error = error.message;
    } finally {
      busy = false;
      run.finishedAt = new Date(now()).toISOString();
      try {
        await journal(copy(run));
      } catch {
        run.journalError = 'Le journal final n’a pas pu être enregistré. Exportez ce compte rendu.';
      }
      onProgress(copy(run));
    }
    return run;
  }
  const applied = (actual, entry) =>
    !!actual &&
    Object.keys(entry.after).every((k) => equal(actual[k], entry.after[k])) &&
    (entry.removed || []).every((k) => actual[k] == null || actual[k] === '');
  async function reconcile(run) {
    const actor = await identity();
    if (actor.organizationId !== run.actor.organizationId) throw Error('Organisation différente.');
    const result = copy(run);
    for (const entry of result.entries) {
      const actual = await read(entry);
      entry.observed = actual;
      entry.status = applied(actual, entry)
        ? 'verified'
        : equal(actual, entry.before)
          ? 'unchanged'
          : 'conflict';
    }
    result.status = result.entries.every((e) => e.status === 'verified')
      ? 'verified'
      : 'reconciled';
    return result;
  }
  return { identity, prepare, publish, reconcile };
}
export function restorationRows(run) {
  return run.entries
    .filter((e) => e.status === 'verified' && e.before !== null)
    .reverse()
    .map((e) => ({
      ...copy(e),
      before: copy(e.after),
      after: copy(e.before),
      kind: 'update',
      requiresCreatedRows: [],
    }));
}
