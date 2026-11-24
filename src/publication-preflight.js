import { FLOW_INITIALIZATION, validateFlowInitializationCatalogue } from './flow-initialization.js';
import {
  PARTICIPANT_CATALOGUE,
  isParticipantCatalogue,
  validateParticipantDefinition,
} from './participant-catalogue.js';
/** Local preflight over the exact selected publication. Does not call or write Genesys. */
import { buildVoiceInventory, normalizeSnapshot } from './data-source.js';
import { inspectJourney } from './journey-quality.js';
import { validatePublicationRow, stable } from './publication.js';
import {
  validateV5Edits,
  immutableV5Field,
  isRouteType,
  routeTargetKey,
  targetTables,
  localReferenceTable,
} from './v5-fields.js';
import { resourceForField } from './genesys-resources.js';
import { fieldLabel } from './draft-fields.js';
const copy = (value) => structuredClone(value),
  str = (value) => String(value ?? '');
const dynamic = (value) =>
  /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
const rowId = (table, row) => `${table.id}:${row.key}`;
const findingsKey = (f) => [f.rowId, f.code, f.field || '', f.detail].join('|');

function project(snapshot, rows, selected, baselineSnapshot, prepared = false) {
  const base = copy(baselineSnapshot || snapshot);
  // A working snapshot can already contain created rows: remove them, and undo
  // every draft, before projecting the selected subset.
  if (!baselineSnapshot)
    for (const entry of rows) {
      const table = base.tables.find((t) => t.id === entry.tableId);
      if (!table) continue;
      table.rows = table.rows.filter((r) => str(r.key) !== entry.key);
      if (entry.before !== null && entry.before !== undefined) table.rows.push(copy(entry.before));
    }
  // Prepared entries contain the rows reread from Genesys. Preserve that fresher
  // baseline when comparing impact and existing anomalies with the merged result.
  if (prepared && baselineSnapshot)
    for (const entry of selected) {
      const table = base.tables.find((t) => t.id === entry.tableId);
      if (!table) continue;
      table.rows = table.rows.filter((r) => str(r.key) !== entry.key);
      if (entry.before !== null && entry.before !== undefined) table.rows.push(copy(entry.before));
    }
  const next = copy(base);
  for (const entry of selected) {
    const table = next.tables.find((t) => t.id === entry.tableId);
    if (!table) continue;
    table.rows = table.rows.filter((r) => str(r.key) !== entry.key);
    table.rows.push(copy(entry.after));
  }
  return { base: normalizeSnapshot(base), next: normalizeSnapshot(next) };
}

/** All explicit V5 references, including configurations outside the visual graph. */
function dependencyIndex(snapshot) {
  const nodes = new Map(),
    links = new Map(),
    tables = new Map();
  for (const table of snapshot.tables) {
    const key = table.name.toUpperCase();
    tables.set(key, [...(tables.get(key) || []), table]);
    for (const row of table.rows) nodes.set(rowId(table, row), { table, row });
  }
  for (const [id, { table, row }] of nodes) {
    const dependencies = new Set(),
      add = (name, key) => {
        if (!name || !key || dynamic(key)) return;
        const candidates = tables.get(name.toUpperCase());
        if (candidates?.length !== 1) return;
        const target = `${candidates[0].id}:${key}`;
        if (nodes.has(target)) dependencies.add(target);
      };
    for (const [field, value] of Object.entries(row)) {
      if (isRouteType(field)) {
        const type = str(value).split('|')[0].trim().toLowerCase(),
          [key, ...extras] = str(row[routeTargetKey(field, row)]).split('|');
        add(targetTables[type], key);
        for (const extra of extras)
          if (/^pdata:/i.test(extra))
            for (const key of extra.slice(6).split(';')) add('W_PARTICIPANT_DATA_v5', key);
      } else add(localReferenceTable(field, { tableName: table.name, row }), str(value));
    }
    if (/^W_PARTICIPANT_DATA_v5$/i.test(table.name)) add(PARTICIPANT_CATALOGUE, str(row.key));
    if (/^W_INBOUND_CALL_v5$/i.test(table.name)) add(FLOW_INITIALIZATION, str(row.key));
    links.set(id, dependencies);
  }
  const roots = [...nodes].filter(([, n]) => /^W_INBOUND_CALL_v5$/i.test(n.table.name));
  return roots.map(([id, { row }]) => {
    const reachable = new Set(),
      walk = [id];
    while (walk.length) {
      const current = walk.pop();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of links.get(current) || []) walk.push(next);
    }
    return {
      id,
      name: str(row.DESCRIPTION || row.key),
      number: str(row.key),
      division: str(row.DIVISION),
      reachable,
    };
  });
}

export function publicationPreflight({
  snapshot,
  rows = [],
  selected = new Set(rows.map((r) => r.id)),
  baselineSnapshot = null,
  plan = null,
  revision = null,
  planRevision = null,
  now = () => Date.now(),
} = {}) {
  const entries = rows.filter((r) => selected.has(r.id)),
    findings = [],
    seen = new Set();
  const add = (f) => {
    const key = findingsKey(f);
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  const entryFinding = (entry, level, code, title, detail, field) =>
    add({
      rowId: entry.id,
      tableId: entry.tableId,
      key: entry.key,
      label: entry.label || entry.key,
      level,
      code,
      title,
      detail,
      ...(field ? { field } : {}),
      fixable: true,
    });
  let projected;
  try {
    projected = project(snapshot, rows, entries, baselineSnapshot, Boolean(plan));
  } catch (error) {
    add({
      level: 'error',
      code: 'invalid-source',
      title: 'Source de publication invalide',
      detail: error.message,
    });
  }
  if (
    plan &&
    (now() - plan.createdAt >= 300000 ||
      (revision !== null && planRevision !== null && revision !== planRevision))
  )
    add({
      level: 'error',
      code: 'stale-plan',
      title: 'Le contrôle Genesys doit être renouvelé',
      detail:
        'Le contrôle a expiré ou les modifications ont changé. Relancez la vérification avant de publier.',
    });
  const ids = new Set(entries.map((e) => e.id));
  for (const entry of entries) {
    for (const dependency of entry.requiresCreatedRows || [])
      if (!ids.has(dependency))
        entryFinding(
          entry,
          'error',
          'unselected-dependency',
          'Une dépendance n’est pas sélectionnée',
          'Sélectionnez également la nouvelle configuration ' +
            (rows.find((r) => r.id === dependency)?.label || dependency) +
            '.',
        );
    const table = projected?.next.tables.find((t) => t.id === entry.tableId);
    if (!table || table.name !== entry.table) {
      entryFinding(
        entry,
        'error',
        'missing-table',
        'Table introuvable',
        'Rechargez les tables de cette organisation avant de publier.',
      );
      continue;
    }
    if (
      entry.after?.key !== entry.key ||
      (entry.kind === 'update' && entry.before?.key !== entry.key)
    ) {
      entryFinding(
        entry,
        'error',
        'identity',
        'Identité de ligne modifiée',
        'La clé de la configuration doit être conservée.',
      );
      continue;
    }
    const fields =
      entry.kind === 'create'
        ? Object.keys(entry.after)
        : Object.keys(entry.after).filter(
            (k) => stable(entry.before?.[k]) !== stable(entry.after[k]),
          );
    for (const field of table.schema?.required || [])
      if (!Object.hasOwn(entry.after, field) || entry.after[field] === undefined)
        entryFinding(
          entry,
          'error',
          'required',
          'Réglage obligatoire absent',
          `Renseignez « ${fieldLabel(field)} ».`,
          field,
        );
    for (const field of fields) {
      try {
        validatePublicationRow(
          entry.after,
          table.schema ? { ...table.schema, required: [] } : table.schema,
          [field],
        );
      } catch (error) {
        entryFinding(
          entry,
          'error',
          'schema',
          'Valeur incompatible avec la table',
          error.message,
          field,
        );
      }
    }
    if (table.name === FLOW_INITIALIZATION) {
      try {
        validateFlowInitializationCatalogue(entry.after, projected.next);
      } catch (error) {
        entryFinding(entry, 'error', 'initialization', 'Initialisation invalide', error.message);
      }
    }
    if (isParticipantCatalogue(table.name)) {
      try {
        validateParticipantDefinition(entry.after);
      } catch (error) {
        entryFinding(entry, 'error', 'catalogue', 'Définition de donnée invalide', error.message);
      }
    }
    const node = { tableName: table.name, schema: table.schema, row: entry.before || {} };
    // Creation assigns identities once. Updates cannot rename logical keys.
    const editable = fields.filter((k) => entry.kind !== 'create' || !immutableV5Field(node, k));
    const restoring = String(plan?.source || '').startsWith('restore:');
    for (const field of editable) {
      try {
        validateV5Edits(node, entry.after, { snapshot: projected.next, fields: [field] });
      } catch (error) {
        entryFinding(
          entry,
          restoring ? 'warning' : 'error',
          'v5',
          restoring ? 'Valeur restaurée hors règle V5' : 'Configuration V5 à corriger',
          error.message,
          field,
        );
      }
    }
    if (
      entry.kind === 'create' &&
      table.schema?.properties?.DIVISION &&
      !str(entry.after.DIVISION).trim()
    )
      entryFinding(
        entry,
        'error',
        'division',
        'Division obligatoire',
        'Choisissez une division Genesys.',
        'DIVISION',
      );
    for (const field of fields) {
      const value = str(entry.after[field]);
      if (dynamic(value))
        entryFinding(
          entry,
          'warning',
          'dynamic',
          'Valeur calculée pendant l’appel',
          `« ${fieldLabel(field)} » dépend du contexte de l’appel. La simulation et le contrôle statique ne vérifient pas sa valeur réelle.`,
          field,
        );
    }
  }
  let impacted = [],
    unknownScope = [];
  if (projected) {
    const before = dependencyIndex(projected.base),
      after = dependencyIndex(projected.next),
      roots = new Map();
    for (const flow of [...before, ...after]) {
      const existing = roots.get(flow.id);
      if (existing) for (const id of flow.reachable) existing.reachable.add(id);
      else roots.set(flow.id, { ...flow, reachable: new Set(flow.reachable) });
    }
    impacted = [...roots.values()]
      .map((flow) => ({
        ...flow,
        changedRows: entries.filter((e) => flow.reachable.has(e.id)).map((e) => e.id),
      }))
      .filter((f) => f.changedRows.length)
      .map(({ reachable, ...flow }) => flow)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    const covered = new Set(impacted.flatMap((f) => f.changedRows));
    const unlinkedRuntime = entries.filter(
      (e) => e.table !== PARTICIPANT_CATALOGUE && !covered.has(e.id),
    );
    unknownScope = unlinkedRuntime.map((e) => ({
      id: e.id,
      label: e.label || e.key,
      table: e.table,
    }));
    for (const entry of unlinkedRuntime)
      entryFinding(
        entry,
        'warning',
        'unknown-impact',
        'Portée à confirmer',
        'Aucun parcours numéroté n’est relié par les références statiques chargées. Cette configuration peut être utilisée par une subroutine, un bot ou une destination dynamique.',
      );
    try {
      const baselineInventory = buildVoiceInventory(projected.base),
        nextInventory = buildVoiceInventory(projected.next),
        affected = new Set(impacted.map((f) => f.id));
      for (const flow of nextInventory.flows.filter((f) => affected.has(f.id))) {
        const old = baselineInventory.flows.find((f) => f.id === flow.id),
          previous = new Set(
            old
              ? inspectJourney(old, projected.base).findings.map((f) =>
                  [f.nodeId, f.title, f.field, f.detail].join('|'),
                )
              : [],
          );
        for (const finding of inspectJourney(flow, projected.next).findings.filter(
          (f) => f.level === 'error' || f.level === 'warning',
        )) {
          const signature = [finding.nodeId, finding.title, finding.field, finding.detail].join(
              '|',
            ),
            existing = previous.has(signature),
            node = flow.nodes.find((n) => n.id === finding.nodeId);
          const external = flow.issues?.find(
              (issue) =>
                issue.code === 'external-flow' &&
                issue.nodeId === finding.nodeId &&
                issue.field === finding.field,
            ),
            incomplete = finding.level === 'warning';
          add({
            rowId: finding.nodeId,
            tableId: node?.tableId,
            key: node?.key,
            label: node?.row?.DESCRIPTION || node?.key,
            flowId: flow.id,
            level: existing || external || incomplete ? 'warning' : 'error',
            code: external
              ? 'external-flow'
              : incomplete
                ? 'incomplete-check'
                : existing
                  ? 'existing-anomaly'
                  : 'introduced-anomaly',
            title: external
              ? 'Flow de rappel à vérifier dans Genesys'
              : incomplete
                ? finding.title
                : existing
                  ? 'Anomalie déjà présente dans le parcours'
                  : finding.title,
            detail: external?.message || finding.detail,
            field: finding.field,
            fixable: Boolean(node?.tableId),
          });
        }
        for (const issue of flow.issues?.filter((issue) => issue.code === 'traversal-limit') || [])
          add({
            rowId: issue.nodeId,
            flowId: flow.id,
            level: 'warning',
            code: 'traversal-limit',
            title: 'Parcours trop étendu pour un contrôle complet',
            detail: issue.message,
          });
      }
    } catch (error) {
      add({
        level: 'error',
        code: 'graph-check',
        title: 'Le parcours ne peut pas être contrôlé',
        detail: error.message,
      });
    }
  }
  const resourceChecks = entries.reduce(
    (count, e) =>
      count +
      e.fields.filter(
        (key) =>
          resourceForField(key, { tableName: e.table, row: e.after }) &&
          e.after[key] != null &&
          e.after[key] !== '',
      ).length,
    0,
  );
  findings.sort(
    (a, b) =>
      Number(b.level === 'error') - Number(a.level === 'error') ||
      str(a.label).localeCompare(str(b.label), 'fr'),
  );
  const errors = findings.filter((f) => f.level === 'error').length,
    warnings = findings.filter((f) => f.level === 'warning').length;
  return {
    format: 'wolf-publication-preflight/v1',
    checkedAt: now(),
    executedInGenesys: false,
    selected: entries.length,
    changedFields: entries.reduce((n, e) => n + e.fields.length, 0),
    creates: entries.filter((e) => e.kind === 'create').length,
    errors,
    warnings,
    canPrepare: entries.length > 0 && errors === 0,
    impacted,
    unknownScope,
    resourceChecks,
    findings,
  };
}
