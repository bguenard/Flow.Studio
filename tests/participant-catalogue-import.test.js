import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareParticipantCatalogueImport } from '../src/participant-catalogue-import.js';
import {
  participantCatalogueDefinition,
  participantDefinition,
} from '../src/participant-catalogue.js';
import { normalizeSnapshot } from '../src/data-source.js';
import { applyDesignerDraft } from '../src/designer-draft.js';
import { publicationRows } from '../src/publication.js';
import { publicationPreflight } from '../src/publication-preflight.js';
const divisions = [
  { id: 'g', name: 'G2S' },
  { id: 'a', name: 'Gan' },
  { id: 'b', name: 'Mutuaide' },
];
function snapshot(rows = [], decisions = []) {
  return {
    tables: [
      { id: 'c', ...participantCatalogueDefinition('g'), rows: [] },
      { id: 'p', name: 'W_PARTICIPANT_DATA_v5', rows },
      { id: 'd', name: 'W_DECISION_v5', rows: decisions },
    ],
  };
}
test('import keeps unique exact names, derives metadata and never mutates runtime rows', () => {
  const s = snapshot([
    { key: 'old', DIVISION: 'Gan', PDATA_LIST_1: 'ACTIVE==true||SERVICE==contrats' },
  ]);
  const before = structuredClone(s);
  const p = prepareParticipantCatalogueImport(s, divisions, 'g');
  assert.equal(p.rows.length, 2);
  assert.deepEqual(
    p.rows.find((r) => r.key === 'ACTIVE'),
    {
      key: 'ACTIVE',
      LABEL: 'ACTIVE',
      DIVISION: 'Gan',
      DIVISION_ID: 'a',
      VALUE_TYPE: 'boolean',
      DEFAULT_VALUE: 'true',
    },
  );
  assert.deepEqual(s, before);
});
test('shared divisions or different values use common owner and empty default while preserving boolean type', () => {
  const s = snapshot([
    { key: 'a', DIVISION: 'Gan', PDATA_LIST_1: 'ACTIVE==true||ENTITY==gan' },
    { key: 'b', DIVISION: 'Mutuaide', PDATA_LIST_1: 'ACTIVE==false||ENTITY==mutuaide' },
  ]);
  const p = prepareParticipantCatalogueImport(s, divisions, 'g');
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows.every((r) => r.DIVISION_ID === 'g' && r.DEFAULT_VALUE === ''));
  assert.equal(p.rows.find((r) => r.key === 'ACTIVE').VALUE_TYPE, 'boolean');
});
test('conditions and dynamic runtime data do not invent initialization defaults', () => {
  const s = snapshot(
    [{ key: 'a', DIVISION: 'Gan', PDATA_LIST_1: 'CLIENT==$var:client$' }],
    [
      {
        key: 'decision',
        DIVISION: 'Gan',
        PARTICIPANT_DATA_TO_CHECK: 'IDENTIFIE',
        DECISION_VALUE: 'true',
      },
    ],
  );
  const p = prepareParticipantCatalogueImport(s, divisions, 'g');
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows.every((r) => r.DEFAULT_VALUE === ''));
  assert.equal(p.rows.find((r) => r.key === 'IDENTIFIE').VALUE_TYPE, 'text');
});
test('existing definitions are skipped and case collisions, malformed rows and unknown divisions are reported', () => {
  const s = snapshot([
    { key: 'a', DIVISION: 'Gan', PDATA_LIST_1: 'Active==true||ACTIVE==false||KNOWN==true' },
    { key: 'bad', DIVISION: 'Gan', PDATA_LIST_1: 'broken' },
    { key: 'unknown', DIVISION: 'missing', PDATA_LIST_1: 'UNKNOWN==x' },
  ]);
  s.tables[0].rows.push(participantDefinition('KNOWN', 'false', divisions[0]));
  const p = prepareParticipantCatalogueImport(s, divisions, 'g');
  assert.equal(p.skipped, 1);
  assert.equal(p.rows.length, 0);
  assert.equal(p.warnings.length, 3);
  assert.equal(s.tables[0].rows[0].DEFAULT_VALUE, 'false');
});
test('only V5 attributes are imported and shared division must be verified', () => {
  const s = snapshot();
  s.tables.push({
    name: 'W_PARTICIPANT_DATA_v4',
    rows: [{ key: 'old', PDATA_LIST_1: 'OLD==true' }],
  });
  assert.equal(prepareParticipantCatalogueImport(s, divisions, 'g').rows.length, 0);
  assert.throws(() => prepareParticipantCatalogueImport(s, divisions, 'missing'), /division/);
});
test('import stages only catalogue creations from normalized live rows and fresh catalogue schema', () => {
  const raw = snapshot([{ key: 'runtime', DIVISION: 'Gan', PDATA_LIST_1: 'ACTIVE==true' }]);
  raw.tables.push({
    id: 'in',
    name: 'W_INBOUND_CALL_v5',
    rows: [{ key: '100', DIVISION: 'Gan', NEXT_TARGET_TYPE: 'disconnect', NEXT_TARGET: '' }],
  });
  const live = normalizeSnapshot(raw),
    freshCatalogue = raw.tables[0];
  const source = { ...live, tables: [...live.tables.filter((t) => t.id !== 'c'), freshCatalogue] };
  const plan = prepareParticipantCatalogueImport(source, divisions, 'g');
  const applied = applyDesignerDraft({
    snapshot: live,
    plan: {
      ok: true,
      flowId: 'in:100',
      nodeId: 'in:100',
      createdRows: plan.rows.map((row) => ({ tableId: 'c', row })),
      updatedRows: [],
    },
  });
  const entries = publicationRows(
    applied.snapshot,
    applied.drafts,
    new Map(),
    new Map([['catalogue', { mappings: plan.rows.map((r) => ({ nodeId: `c:${r.key}` })) }]]),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].table, 'STUDIO_PARTICIPANT_DATA_V5');
  assert.equal(entries[0].kind, 'create');
  assert.deepEqual(
    applied.snapshot.tables.filter((t) => t.id !== 'c'),
    live.tables.filter((t) => t.id !== 'c'),
  );
  const check = publicationPreflight({ snapshot: applied.snapshot, rows: entries });
  assert.deepEqual(check.unknownScope, []);
  assert.equal(
    check.findings.some((f) => f.code === 'unknown-impact'),
    false,
  );
});
