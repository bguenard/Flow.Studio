import {
  PARTICIPANT_CATALOGUE,
  validateParticipantCatalogueTable,
  validateParticipantDefinitions,
} from './participant-catalogue.js';
import { participantAssignments, participantIdentity } from './participant-names.js';
import { humanText } from './business.js';
import { validatePublicationRow } from './publication.js';

/** Metadata only. Runtime values and routing are never changed by this import. */
export function prepareParticipantCatalogueImport(snapshot, divisions, sharedDivisionId) {
  const table = validateParticipantCatalogueTable(
    snapshot.tables.find((t) => t.name === PARTICIPANT_CATALOGUE),
  );
  const shared = divisions.find((d) => d.id === sharedDivisionId);
  if (!shared) throw Error('Choisissez la division du catalogue commun.');
  validateParticipantDefinitions(table.rows);
  const existing = new Set(table.rows.map((r) => participantIdentity(r.key))),
    items = new Map(),
    warnings = [];
  function add(name, value, division, source) {
    if (!name) return;
    const id = participantIdentity(name);
    if (!items.has(id))
      items.set(id, {
        names: new Set(),
        values: new Set(),
        divisions: new Set(),
        sources: new Set(),
      });
    const item = items.get(id);
    item.names.add(name);
    if (value !== undefined) item.values.add(value);
    if (division) item.divisions.add(String(division));
    item.sources.add(source);
  }
  for (const source of snapshot.tables) {
    if (/^W_PARTICIPANT_DATA_v5$/i.test(source.name))
      for (const row of source.rows) {
        try {
          for (const a of participantAssignments(row))
            add(a.name, a.value, row.DIVISION, `${source.name} · ${row.key}`);
        } catch {
          warnings.push(
            `Configuration non importée : ${source.name} · ${row.key} (affectation invalide).`,
          );
        }
      }
    if (/^W_DECISION_v5$/i.test(source.name))
      for (const row of source.rows)
        add(row.PARTICIPANT_DATA_TO_CHECK, undefined, row.DIVISION, `${source.name} · ${row.key}`);
  }
  const rows = [],
    details = [];
  let skipped = 0;
  for (const [id, item] of items) {
    if (existing.has(id)) {
      skipped++;
      continue;
    }
    if (item.names.size !== 1) {
      warnings.push(`Casse ambiguë : ${[...item.names].join(' / ')}. Aucune clé renommée.`);
      continue;
    }
    const key = [...item.names][0],
      values = [...item.values];
    const resolved = [...item.divisions].map((name) =>
      divisions.find((d) => d.id === name || d.name === name),
    );
    const sharedAttribute =
      new Set(resolved.filter(Boolean).map((d) => d.id)).size > 1 ||
      item.divisions.size > 1 ||
      values.length > 1;
    if (resolved.some((d) => !d) && !sharedAttribute) {
      warnings.push(`Division inconnue pour ${key} : ${[...item.divisions].join(', ')}.`);
      continue;
    }
    const division = sharedAttribute || !resolved.length ? shared : resolved[0];
    const dynamic = values.some((v) => /\$var:|^var:/i.test(v));
    const defaultValue = !sharedAttribute && !dynamic && values.length === 1 ? values[0] : '';
    const type =
      values.length && values.every((v) => /^(true|false)$/i.test(v)) ? 'boolean' : 'text';
    const row = {
      key,
      LABEL: humanText(key) || key,
      DIVISION: division.name,
      DIVISION_ID: division.id,
      VALUE_TYPE: type,
      DEFAULT_VALUE: defaultValue,
    };
    try {
      validateParticipantDefinitions([row]);
      validatePublicationRow(row, table.schema);
    } catch (error) {
      warnings.push(`${key} : ${error.message}`);
      continue;
    }
    rows.push(row);
    details.push({
      key,
      shared: sharedAttribute,
      values,
      divisions: [...item.divisions],
      sources: [...item.sources],
      noDefault: defaultValue === '',
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }));
  return {
    tableId: table.id,
    rows,
    details,
    warnings,
    skipped,
    total: items.size,
    sharedDivision: shared,
  };
}
