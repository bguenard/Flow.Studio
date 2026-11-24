import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFlows } from '../src/business.js';
import { buildVoiceInventory } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';
import { cloneFlow } from '../src/flow-clone.js';
import {
  emptyRegistry,
  normalizeRegistry,
  seedFromSource,
  roleOf,
  declareReference,
  attachDeclination,
  removeFromRegistry,
  setScope,
  resolveRegistry,
  localGaps,
  threeWay,
  declinationSummary,
  versionDelta,
  suggestVersionLabel,
  suggestModelName,
} from '../src/governance.js';

const node = (id, type, row = {}, tableName = `table-${type}`) => ({
  id,
  type,
  tableName,
  tableId: tableName,
  key: id,
  name: row.DESCRIPTION || id,
  row: { key: id, ...row },
});
const flow = (id, nodes, edges = [], extra = {}) => ({
  id,
  key: id,
  nodes,
  edges,
  description: nodes[0]?.row.DESCRIPTION || '',
  category: 'configured',
  ...extra,
});
const edge = (from, to, branch, type = 'service') => ({
  from,
  to,
  branch,
  type,
  resolved: true,
  relationship: 'route',
});
const demoFlows = () => buildVoiceInventory(demoSnapshot).flows;
const V1 = 'demo-voice-inbound-v5:DEMO_CORE_MODEL_ACCUEIL',
  V2 = 'demo-voice-inbound-v5:DEMO_CORE_MODEL_V2_ACCUEIL';
const ATLANTIQUE = 'demo-voice-inbound-v5:DEMO_ENTREE_ATLANTIQUE',
  RHONE = 'demo-voice-inbound-v5:DEMO_ENTREE_RHONE';
const kinds = (analysis, kind) =>
  analysis.items
    .filter((item) => item.kind === kind)
    .map((item) => `${item.step} · ${item.label}`)
    .sort();

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('a role is always declared: markers in a real source never create a Core Model', () => {
  const template = flow('t', [node('t', 'inboundcall')], [], {
    category: 'template',
    key: '[ENTITE]_ENTRYPOINT_V1',
  });
  const entity = flow('e', [node('e', 'inboundcall')]);
  assert.deepEqual(seedFromSource({ kind: 'genesys', region: 'eu-west-1' }), emptyRegistry());
  assert.deepEqual(
    seedFromSource({
      kind: 'import',
      coreModels: [{ id: 'x', name: 'X', demoOnly: true, versions: [{ flowId: 't', label: '1' }] }],
    }),
    emptyRegistry(),
  );
  const resolved = resolveRegistry(emptyRegistry(), [template, entity]);
  assert.equal(resolved.models.length, 0);
  assert.deepEqual(
    resolved.candidates.map((item) => item.id),
    ['t'],
  );
  assert.deepEqual(
    resolved.entities.map((item) => item.id),
    ['e'],
  );
  assert.equal(roleOf(emptyRegistry(), 't').role, 'none');
});

test('declaring versions and declinations builds an explicit, ordered family', () => {
  let registry = declareReference(emptyRegistry(), {
    flowId: 'a',
    name: 'Accueil Groupe',
    versionLabel: '1',
  });
  const modelId = registry.coreModels[0].id;
  registry = declareReference(registry, { flowId: 'b', coreModelId: modelId, versionLabel: '2' });
  registry = attachDeclination(registry, { flowId: 'local', baseFlowId: 'a' });
  assert.deepEqual(
    registry.coreModels[0].versions.map((version) => version.label),
    ['1', '2'],
  );
  const reference = roleOf(registry, 'a'),
    latest = roleOf(registry, 'b'),
    local = roleOf(registry, 'local');
  assert.equal(reference.role, 'reference');
  assert.equal(reference.isLatest, false);
  assert.equal(latest.isLatest, true);
  assert.equal(local.role, 'declination');
  assert.equal(local.base.flowId, 'a');
  assert.equal(local.latest.flowId, 'b');
  assert.equal(local.isCurrent, false);
  assert.equal(local.declination.scope, 'unknown');
  assert.equal(
    setScope(registry, 'local', 'inactive', 'Entité pas encore prête').declinations[0].scope,
    'inactive',
  );
  // The input registry is never mutated by an operation.
  assert.equal(registry.declinations[0].scope, 'unknown');
});

test('contradictory or unsafe declarations are refused with a business message', () => {
  let registry = declareReference(emptyRegistry(), {
    flowId: 'a',
    name: 'Accueil',
    versionLabel: '1',
  });
  const modelId = registry.coreModels[0].id;
  assert.throws(
    () => declareReference(registry, { flowId: 'a', name: 'Autre', versionLabel: '1' }),
    /déjà un rôle/,
  );
  assert.throws(
    () => declareReference(registry, { flowId: 'b', name: 'accueil', versionLabel: '1' }),
    /existe déjà/,
  );
  assert.throws(
    () => declareReference(registry, { flowId: 'b', coreModelId: modelId, versionLabel: '1' }),
    /déjà une version 1/,
  );
  assert.throws(
    () => declareReference(registry, { flowId: 'b', coreModelId: modelId, versionLabel: ' ' }),
    /libellé de version/,
  );
  assert.throws(
    () => declareReference(registry, { flowId: 'b', coreModelId: 'missing', versionLabel: '2' }),
    /n’existe plus/,
  );
  assert.throws(
    () => declareReference(registry, { flowId: 'b', name: '', versionLabel: '2' }),
    /nom au Core Model/,
  );
  assert.throws(
    () => attachDeclination(registry, { flowId: 'a', baseFlowId: 'a' }),
    /propre référence/,
  );
  assert.throws(
    () => attachDeclination(registry, { flowId: 'local', baseFlowId: 'unknown' }),
    /version de Core Model/,
  );
  registry = attachDeclination(registry, { flowId: 'local', baseFlowId: 'a' });
  assert.throws(
    () => attachDeclination(registry, { flowId: 'local', baseFlowId: 'a' }),
    /déjà un rôle/,
  );
  assert.throws(() => setScope(registry, 'a', 'active'), /pas une déclinaison/);
  assert.throws(() => setScope(registry, 'local', 'production'), /Périmètre inconnu/);
  // A version still used as a base keeps its provenance.
  assert.throws(() => removeFromRegistry(registry, 'a'), /1 déclinaison/);
  registry = removeFromRegistry(registry, 'local');
  assert.equal(removeFromRegistry(registry, 'a').coreModels.length, 0);
});

test('a stored registry is read defensively: one role per flow, bases must exist', () => {
  const registry = normalizeRegistry({
    schemaVersion: 1,
    coreModels: [
      {
        id: 'm',
        name: 'Accueil',
        versions: [
          { flowId: 'a', label: '1' },
          { flowId: 'a', label: '1 bis' },
          { flowId: '', label: '2' },
          { flowId: 'b' },
        ],
      },
      { id: 'm', name: 'Doublon', versions: [{ flowId: 'c', label: '1' }] },
      { id: 'empty', name: 'Sans version', versions: [] },
      'not-an-object',
    ],
    declinations: [
      {
        flowId: 'local',
        coreModelId: 'm',
        baseFlowId: 'a',
        scope: 'production',
        scopeNote: 12,
        nodeMappings: [{ referenceNodeId: 'x', localNodeId: 'y' }, { referenceNodeId: 'x' }],
      },
      { flowId: 'a', coreModelId: 'm', baseFlowId: 'a' },
      { flowId: 'orphan', coreModelId: 'm', baseFlowId: 'gone' },
      { flowId: 'other', coreModelId: 'missing', baseFlowId: 'a' },
    ],
  });
  assert.deepEqual(
    registry.coreModels.map((model) => [model.id, model.versions.map((version) => version.flowId)]),
    [['m', ['a']]],
  );
  assert.deepEqual(
    registry.declinations.map((item) => item.flowId),
    ['local'],
  );
  assert.equal(registry.declinations[0].scope, 'unknown');
  assert.deepEqual(registry.declinations[0].nodeMappings, [
    { referenceNodeId: 'x', localNodeId: 'y' },
  ]);
  assert.deepEqual(normalizeRegistry('garbage'), emptyRegistry());
});

test('entries whose flow is absent from the current source are kept, never reassigned', () => {
  let registry = declareReference(emptyRegistry(), {
    flowId: 'a',
    name: 'Accueil',
    versionLabel: '1',
  });
  registry = attachDeclination(registry, { flowId: 'gone', baseFlowId: 'a' });
  const present = resolveRegistry(registry, [flow('a', [node('a', 'inboundcall')])]);
  assert.equal(present.models.length, 1);
  assert.equal(present.models[0].declinations[0].flow, null);
  assert.equal(present.missing, 1);
  const elsewhere = resolveRegistry(registry, [flow('z', [node('z', 'inboundcall')])]);
  assert.equal(elsewhere.models.length, 0);
  assert.equal(elsewhere.absentModels.length, 1);
  assert.equal(registry.declinations.length, 1);
});

test('the fictitious demo ships an explicit two-version family with two declinations', () => {
  const registry = seedFromSource(demoSnapshot.source);
  const resolved = resolveRegistry(registry, demoFlows());
  assert.equal(resolved.models.length, 1);
  assert.equal(resolved.models[0].fictitious, true);
  assert.deepEqual(
    resolved.models[0].versions.map((version) => [version.flowId, version.label]),
    [
      [V1, '1'],
      [V2, '2'],
    ],
  );
  assert.deepEqual(
    resolved.models[0].declinations.map((item) => [
      item.flowId,
      item.baseFlowId,
      item.scope,
      item.isCurrent,
    ]),
    [
      [ATLANTIQUE, V1, 'active', false],
      [RHONE, V1, 'inactive', false],
    ],
  );
  assert.equal(resolved.candidates.length, 0);
  assert.equal(resolved.missing, 0);
  assert.deepEqual(
    versionDelta(resolved.models[0].versions[0].flow, resolved.models[0].versions[1].flow),
    { settings: 6, structure: 1, steps: 0, review: 0 },
  );
});

test('three-way analysis separates Group evolutions, local adaptations, convergence and conflicts', () => {
  const flows = new Map(demoFlows().map((item) => [item.id, item]));
  const registry = seedFromSource(demoSnapshot.source);
  const mappings = registry.declinations.find((item) => item.flowId === RHONE).nodeMappings;
  const analysis = threeWay(flows.get(V1), flows.get(V2), flows.get(RHONE), { mappings });
  assert.deepEqual(kinds(analysis, 'conflict'), [
    'Accueil et conseil · Core Model · Message d’accueil',
    'Déclarer ou suivre un sinistre · Priorité de distribution',
  ]);
  assert.deepEqual(kinds(analysis, 'converged'), [
    'Choix proposés dans le parcours de référence · Délai de saisie du menu',
  ]);
  assert.equal(kinds(analysis, 'group').length, 4);
  assert.ok(
    analysis.items.some(
      (item) => item.kind === 'group' && item.structural && /Sinon$/.test(item.label),
    ),
  );
  assert.equal(kinds(analysis, 'local').length, 4);
  assert.deepEqual(analysis.counts, {
    group: 4,
    conflict: 2,
    local: 4,
    binding: 0,
    converged: 1,
    unpaired: 0,
    steps: 0,
    groupSteps: 0,
    review: 0,
  });
  const conflict = analysis.items.find((item) => item.field === 'PRIORITY');
  assert.deepEqual(
    [conflict.baseDisplay, conflict.groupDisplay, conflict.localDisplay],
    ['3', '4', '2'],
  );
  const inherited = analysis.items.find((item) => item.field === 'MENU_REPEAT');
  assert.equal(inherited.localChanged, false);
  assert.equal(inherited.localDisplay, 'Identique à la référence adoptée');
  // The same entity against its own base only shows its local gaps.
  assert.equal(localGaps(flows.get(V1), flows.get(RHONE), { mappings }).counts.local, 7);
  const summary = declinationSummary(flows.get(V1), flows.get(RHONE), flows.get(V2), mappings);
  assert.equal(summary.gaps.local, 7);
  assert.equal(summary.impact.conflict, 2);
  assert.equal(
    declinationSummary(flows.get(V1), flows.get(RHONE), flows.get(V1), mappings).impact,
    null,
  );
});

test('a draft on the new reference changes the impact of every declination without touching the base', () => {
  const flows = new Map(demoFlows().map((item) => [item.id, item]));
  const before = threeWay(flows.get(V1), flows.get(V2), flows.get(ATLANTIQUE)).counts;
  const edited = {
    ...flows.get(V2),
    nodes: flows
      .get(V2)
      .nodes.map((item) =>
        item.type === 'menu' ? { ...item, row: { ...item.row, MENU_REPEAT: 2 } } : item,
      ),
  };
  const after = threeWay(flows.get(V1), edited, flows.get(ATLANTIQUE)).counts;
  assert.equal(after.group, before.group - 1);
  assert.equal(after.conflict, before.conflict);
});

test('a value filling a placeholder announced by the reference is a local binding, not a deviation', () => {
  const base = flow('b', [
    node('b', 'inboundcall', { WELCOME_AUDIO: 'pr:ACCUEIL_[ENTITE]', RECORDING_ENABLE: false }),
  ]);
  const next = flow('n', [
    node('n', 'inboundcall', { WELCOME_AUDIO: 'pr:ACCUEIL_[ENTITE]', RECORDING_ENABLE: true }),
  ]);
  const local = flow('l', [
    node('l', 'inboundcall', { WELCOME_AUDIO: 'pr:ACCUEIL_AGENCE', RECORDING_ENABLE: false }),
  ]);
  const analysis = threeWay(base, next, local);
  assert.deepEqual(analysis.items.map((item) => [item.field, item.kind]).sort(), [
    ['RECORDING_ENABLE', 'group'],
    ['WELCOME_AUDIO', 'binding'],
  ]);
  assert.equal(localGaps(base, local).counts.binding, 1);
  // When the reference rewrites the placeholder itself, both sides moved: it is arbitrated.
  const renamed = flow('n2', [
    node('n2', 'inboundcall', { WELCOME_AUDIO: 'pr:BIENVENUE_[ENTITE]', RECORDING_ENABLE: false }),
  ]);
  assert.equal(threeWay(base, renamed, local).items[0].kind, 'conflict');
});

test('no verdict is given on a step that has no safe counterpart', () => {
  const base = flow(
    'b',
    [node('b', 'inboundcall'), node('bs', 'service', { PRIORITY: 3 })],
    [edge('b', 'bs', 'OPEN')],
  );
  const next = flow(
    'n',
    [node('n', 'inboundcall'), node('ns', 'service', { PRIORITY: 5 })],
    [edge('n', 'ns', 'OPEN')],
  );
  const truncated = flow('l', [node('l', 'inboundcall')]);
  const analysis = threeWay(base, next, truncated);
  const priority = analysis.items.find((item) => item.field === 'PRIORITY');
  assert.equal(priority.kind, 'unpaired');
  assert.equal(priority.localDisplay, 'Étape sans correspondance dans le parcours de l’entité');
  // The missing branch itself is a structural difference of the entity, stated as such.
  const branch = analysis.items.find((item) => item.structural);
  assert.deepEqual([branch.kind, branch.localDisplay], ['local', 'Branche absente']);
  assert.equal(analysis.counts.conflict + analysis.counts.group, 0);
  assert.ok(analysis.steps.some((step) => step.kind === 'local-missing'));
  const added = threeWay(
    base,
    flow(
      'n3',
      [node('n3', 'inboundcall'), node('n3s', 'service', { PRIORITY: 3 }), node('n3m', 'menu')],
      [edge('n3', 'n3s', 'OPEN')],
    ),
    truncated,
  );
  assert.equal(added.counts.groupSteps, 1);
  assert.ok(
    added.steps.some(
      (step) =>
        step.kind === 'group-added' &&
        step.description === 'Étape ajoutée dans la nouvelle référence',
    ),
  );
});

test('declared mappings win over heuristics and invalid pairs are ignored', () => {
  const left = flow('a', [
    node('a', 'inboundcall'),
    node('a1', 'service', { PRIORITY: 1 }),
    node('a2', 'service', { PRIORITY: 2 }),
  ]);
  const right = flow('b', [
    node('b', 'inboundcall'),
    node('b1', 'service', { PRIORITY: 2 }),
    node('b2', 'service', { PRIORITY: 1 }),
  ]);
  assert.equal(compareFlows(left, right).ambiguous.length, 1);
  const declared = compareFlows(left, right, {
    seedMatches: [
      ['a1', 'b2'],
      ['a2', 'b1'],
      ['a', 'b1'],
      ['ghost', 'b'],
      ['a1', 'b1'],
    ],
  });
  assert.equal(declared.ambiguous.length, 0);
  assert.equal(declared.items.length, 0);
  assert.deepEqual(
    declared.matches.map((match) => [match.leftNode.id, match.rightNode.id, match.reason]),
    [
      ['a1', 'b2', 'declared'],
      ['a2', 'b1', 'declared'],
      ['a', 'b', 'entry'],
    ],
  );
  const exact = compareFlows(left, right, { seedMatches: [['a1', 'b1']], exact: true });
  assert.deepEqual(
    exact.matches.map((match) => match.reason),
    ['declared'],
  );
  assert.deepEqual(
    exact.items.map((item) => item.slot),
    ['field:PRIORITY'],
  );
});

test('a re-pointed branch keeps its steps paired; a merge of two steps stays unpaired', () => {
  const menu = (id) => node(id, 'menu');
  const before = flow(
    'a',
    [
      node('a', 'inboundcall'),
      menu('am'),
      node('a1', 'service', { PRIORITY: 3 }),
      node('a2', 'service', { PRIORITY: 1 }),
    ],
    [
      edge('a', 'am', 'OPEN', 'menu'),
      edge('am', 'a1', 'OPTION1'),
      edge('am', 'a2', 'OPTION2'),
      edge('am', 'a2', 'DEFAULT'),
    ],
  );
  const repointed = flow(
    'b',
    [
      node('b', 'inboundcall'),
      menu('bm'),
      node('b1', 'service', { PRIORITY: 4 }),
      node('b2', 'service', { PRIORITY: 1 }),
    ],
    [
      edge('b', 'bm', 'OPEN', 'menu'),
      edge('bm', 'b1', 'OPTION1'),
      edge('bm', 'b2', 'OPTION2'),
      edge('bm', 'b1', 'DEFAULT'),
    ],
  );
  const moved = compareFlows(before, repointed);
  assert.equal(moved.ambiguous.length, 0);
  assert.deepEqual(
    moved.matches
      .filter((match) => match.reason === 'shared-path')
      .map((match) => [match.leftNode.id, match.rightNode.id])
      .sort(),
    [
      ['a1', 'b1'],
      ['a2', 'b2'],
    ],
  );
  assert.deepEqual(moved.items.map((item) => item.slot).sort(), [
    'field:PRIORITY',
    'route:route:DEFAULT',
  ]);
  const merged = flow(
    'c',
    [node('c', 'inboundcall'), menu('cm'), node('c1', 'service', { PRIORITY: 3 })],
    [
      edge('c', 'cm', 'OPEN', 'menu'),
      edge('cm', 'c1', 'OPTION1'),
      edge('cm', 'c1', 'OPTION2'),
      edge('cm', 'c1', 'DEFAULT'),
    ],
  );
  const merge = compareFlows(before, merged);
  assert.equal(
    merge.matches.some((match) => match.reason === 'shared-path'),
    false,
  );
  assert.equal(merge.ambiguous.length, 1);
});

test('a declination created in the Studio carries its step mappings and starts without gaps', () => {
  const flows = demoFlows();
  const reference = flows.find((item) => item.id === V2);
  const result = cloneFlow(demoSnapshot, reference, {
    name: 'Agence des Alpes',
    division: 'DEMO_DIV_ALPES',
  });
  const created = buildVoiceInventory(result.snapshot).flows.find(
    (item) => item.id === result.flowId,
  );
  const mappings = result.summary.mappings.map((mapping) => ({
    referenceNodeId: mapping.sourceNodeId,
    localNodeId: mapping.nodeId,
  }));
  const registry = attachDeclination(seedFromSource(demoSnapshot.source), {
    flowId: result.flowId,
    baseFlowId: V2,
    origin: 'created',
    nodeMappings: mappings,
  });
  const role = roleOf(registry, result.flowId);
  assert.equal(role.isCurrent, true);
  assert.equal(role.declination.origin, 'created');
  const gaps = localGaps(reference, created, { mappings });
  assert.deepEqual([gaps.items.length, gaps.steps.length, gaps.review.length], [0, 0, 0]);
  assert.ok(gaps.matches.filter((match) => match.reason === 'declared').length >= 4);
});

test('suggested labels are editable proposals that avoid versions already declared', () => {
  const model = { versions: [{ flowId: 'a', label: '1' }] };
  assert.equal(suggestVersionLabel({ key: 'GROUPE_ENTRYPOINT_V2' }), '2');
  assert.equal(suggestVersionLabel({ key: 'GROUPE_ENTRYPOINT_V1' }, model), '2');
  assert.equal(suggestVersionLabel({ key: '+33100000000' }), '1');
  assert.equal(
    suggestModelName({
      description: '[ENTITE]_[SERVICE]_[template]',
      key: '[ENTITE]_[SERVICE]_ENTYPOINT_V1',
    }),
    'Parcours générique',
  );
  assert.equal(suggestModelName({ description: 'Accueil des adhérents' }), 'Accueil des adhérents');
});
