import test from 'node:test';
import assert from 'node:assert/strict';
import { blockComparisonWorkspace } from '../src/block-comparison-view.js';

const source = {
  id: 'source-condition',
  type: 'decision',
  label: 'Règle d’orientation',
  row: { DESCRIPTION: 'Qualifier la demande' },
};
const entry = { id: 'entry', type: 'inboundcall', row: { DESCRIPTION: 'Accueil cible' } };
const queue = { id: 'queue', type: 'service', row: { DESCRIPTION: 'Équipe cible' } };
const options = {
  sourceNode: source,
  kind: 'route',
  canInsert: true,
  placements: [
    { id: 'place', fromId: 'entry', field: 'OPEN_TARGET_TYPE', label: 'Accueil cible · Puis' },
  ],
  outlets: [
    {
      id: 'outlet',
      nodeId: source.id,
      field: 'TRUE_TARGET_TYPE',
      label: 'Qualifier la demande · Si vrai',
      requiresConnection: true,
    },
  ],
  destinations: [{ value: queue.id, nodeId: queue.id, label: 'Équipe cible', type: 'service' }],
  notices: [],
};
const candidate = (extra) => ({
  id: source.id,
  sourceNode: source,
  status: 'absent',
  options,
  ...extra,
});
const params = (extra) => ({
  left: { nodes: [source], edges: [] },
  right: {
    nodes: [entry, queue],
    edges: [{ from: entry.id, field: 'OPEN_TARGET_TYPE', to: queue.id, relationship: 'route' }],
  },
  diff: { unmatched: [] },
  candidates: [candidate()],
  decisions: {},
  plans: {},
  ...extra,
});
const selected = (extra) => ({
  [source.id]: {
    mode: 'insert',
    placementId: 'place',
    connections: { outlet: { mode: 'resume' } },
    ...extra,
  },
});
const validated = (extra) => ({
  [source.id]: {
    snapshot: { tables: [] },
    createdRows: [{ sourceNodeId: source.id, row: source.row }],
    errors: [],
    ...extra,
  },
});
const button = (html, action) =>
  html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] || '';

test('source blocks are ignored by default and target-only blocks are visibly kept without a removal action', () => {
  const html = blockComparisonWorkspace(
    params({ diff: { unmatched: [{ side: 'right', node: queue }] } }),
  );
  assert.match(button(html, 'block-ignore'), /aria-pressed="true"/);
  assert.match(button(html, 'block-insert'), /aria-pressed="false"/);
  assert.doesNotMatch(html, /name="block-placement"|name="block-exit-mode"/);
  assert.match(html, /Équipe cible/);
  assert.match(html, /Conservés dans le parcours/);
  assert.doesNotMatch(html, /data-action=".*(?:delete|remove)/);
});

test('ambiguous source blocks offer association first and require an explicit new-block choice', () => {
  const html = blockComparisonWorkspace(
    params({ candidates: [candidate({ status: 'ambiguous' })] }),
  );
  assert.match(html, /Correspondance à choisir/);
  assert.ok(button(html, 'block-associate'));
  assert.match(html, /Ajouter comme nouveau bloc/);
  assert.doesNotMatch(html, /Présent seulement dans la source/);
  assert.ok(
    html.indexOf('data-action="block-associate"') < html.indexOf('data-action="block-insert"'),
  );
});

test('required outlets and placement receive no preselected destructive connection', () => {
  const html = blockComparisonWorkspace(
    params({ decisions: selected({ placementId: '', connections: {} }) }),
  );
  assert.match(html, /name="block-placement"[^>]*><option value="" selected/);
  assert.match(html, /name="block-exit-mode"[^>]*><option value="" selected/);
  assert.doesNotMatch(html, /<option value="(?:resume|target)" selected/);
  assert.doesNotMatch(html, /block-route-preview/);
});

test('a validated route preview shows the current target continuation and errors suppress that preview', () => {
  const input = params({ decisions: selected(), plans: validated() });
  const html = blockComparisonWorkspace(input);
  assert.match(html, /Résultat dans le parcours cible/);
  assert.match(html, /class="new-block">Qualifier la demande/);
  assert.match(html, /Qualifier la demande · Si vrai[\s\S]*<span>Équipe cible<\/span>/);
  const invalid = blockComparisonWorkspace({
    ...input,
    plans: validated({ errors: [{ message: 'Le raccordement est à préciser.' }] }),
  });
  assert.match(invalid, /Le raccordement est à préciser/);
  assert.doesNotMatch(invalid, /block-route-preview/);
});

test('context insertion is presented as information attached to a branch and never as a routing step', () => {
  const context = { ...source, type: 'pdata', row: { DESCRIPTION: 'Contexte <client>' } };
  const input = params({
    candidates: [
      candidate({
        sourceNode: context,
        options: { ...options, sourceNode: context, kind: 'context', outlets: [] },
      }),
    ],
    decisions: selected(),
    plans: validated(),
  });
  const html = blockComparisonWorkspace(input);
  assert.match(html, /Branche à enrichir/);
  assert.match(html, /Ajouter <strong>Contexte &lt;client&gt;<\/strong> sur/);
  assert.match(html, /La destination de l’appel reste Équipe cible/);
  assert.doesNotMatch(html, /name="block-exit-mode"|class="new-block"/);
  const review = blockComparisonWorkspace({ ...input, review: true });
  assert.match(review, /Informations associées à l’appel/);
  assert.doesNotMatch(review, /name="block-placement"/);
});

test('missing insertion options disable insertion and keep the reason visible', () => {
  const html = blockComparisonWorkspace(
    params({ candidates: [candidate({ options: undefined })] }),
  );
  assert.match(button(html, 'block-insert'), /disabled/);
  assert.match(html, /Les emplacements disponibles doivent être calculés avant l’insertion/);
});

test('sequential insertions use the actual continuation reported by the validated plan', () => {
  const html = blockComparisonWorkspace(
    params({
      decisions: selected(),
      plans: validated({
        summary: { resumeLabel: 'Premier bloc inséré', placementLabel: 'Accueil cible · Puis' },
      }),
    }),
  );
  const preview = html.match(/<div class="block-route-preview">([\s\S]*?)<\/article>/)?.[1] || '';
  assert.match(preview, /Premier bloc inséré/);
  assert.doesNotMatch(preview, /Équipe cible/);
});
