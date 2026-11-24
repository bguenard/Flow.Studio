import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { emptyRegistry, declareReference, attachDeclination } from '../src/governance.js';
import {
  renameCoreModel,
  nextVersionLabel,
  prepareCoreModelCopy,
  coreModelCopyView,
} from '../src/core-model-actions.js';
import { durableRegistry } from '../src/governance-projection.js';
function fixture() {
  const schema = {
    type: 'object',
    properties: {
      key: { type: 'string' },
      DESCRIPTION: { type: 'string' },
      DIVISION: { type: 'string' },
    },
  };
  const snapshot = normalizeSnapshot({
    tables: [
      {
        id: 'entry',
        name: 'W_INBOUND_CALL_v5',
        schema,
        rows: [
          {
            key: '+33123456789',
            DESCRIPTION: 'Groupe',
            DIVISION: 'France',
            WELCOME_AUDIO: 'tts:Bonjour',
            NEXT_TARGET_TYPE: 'service',
            NEXT_TARGET: 'TEAM',
          },
          {
            key: '+33123456788',
            DESCRIPTION: 'Agence',
            DIVISION: 'France',
            NEXT_TARGET_TYPE: 'service',
            NEXT_TARGET: 'TEAM',
          },
        ],
      },
      {
        id: 'svc',
        name: 'W_SERVICES_v5',
        schema,
        rows: [
          {
            key: 'TEAM',
            DESCRIPTION: 'Conseil',
            DIVISION: 'France',
            QUEUE: 'RealQueue',
            PRIORITY: '3',
            INQUEUE_TARGET_TYPE: 'disconnect',
            INQUEUE_TARGET: '',
          },
        ],
      },
    ],
  });
  const sourceFlowId = 'entry:+33123456789';
  const base = declareReference(emptyRegistry(), {
    flowId: sourceFlowId,
    name: 'Accueil Groupe',
    versionLabel: 'V1',
  });
  const registry = attachDeclination(base, {
    flowId: 'entry:+33123456788',
    baseFlowId: sourceFlowId,
    scope: 'active',
  });
  const form = {
    kind: 'version',
    sourceFlowId,
    modelId: registry.coreModels[0].id,
    versionLabel: 'V2',
    phone: '+33123456787',
    division: 'France',
  };
  return { snapshot, registry, form };
}
test('rename changes only the model name, preserving IDs, versions and children', () => {
  const { registry } = fixture(),
    before = structuredClone(registry),
    id = registry.coreModels[0].id,
    next = renameCoreModel(registry, id, 'Nouveau nom');
  assert.equal(next.coreModels[0].id, id);
  assert.deepEqual(next.coreModels[0].versions, before.coreModels[0].versions);
  assert.deepEqual(next.declinations, before.declinations);
  assert.deepEqual(registry, before);
  for (const name of ['', ' '.repeat(2), 'a'.repeat(81)])
    assert.throws(() => renameCoreModel(registry, id, name));
  assert.throws(() => renameCoreModel(registry, 'missing', 'Nom'));
  const other = declareReference(registry, { flowId: 'other', name: 'Autre', versionLabel: 'V1' });
  assert.throws(() => renameCoreModel(other, id, ' autre '), /déjà/);
});
test('new version copies independent rows and preserves original version and child provenance', () => {
  const input = fixture(),
    before = structuredClone(input),
    result = prepareCoreModelCopy(input);
  assert.deepEqual(input, before);
  assert.equal(result.registry.coreModels.length, 1);
  assert.equal(result.registry.coreModels[0].versions.length, 2);
  assert.deepEqual(result.registry.declinations, input.registry.declinations);
  for (const table of input.snapshot.tables)
    for (const row of table.rows)
      assert.deepEqual(
        result.snapshot.tables.find((t) => t.id === table.id).rows.find((r) => r.key === row.key),
        row,
      );
  const newFlow = buildVoiceInventory(result.snapshot).flows.find((f) => f.id === result.flowId);
  assert.ok(newFlow.nodes.some((n) => n.key !== 'TEAM' && n.row?.QUEUE === 'RealQueue'));
  assert.equal(newFlow.sourceRow.DESCRIPTION, 'Accueil Groupe · V2');
  assert.deepEqual(durableRegistry(result.registry, [result.flowId]), input.registry);
  assert.equal(durableRegistry(result.registry, []).coreModels[0].versions.length, 2);
});
test('duplicate version, number, wrong model, pending source and missing division are refused', () => {
  const i = fixture();
  for (const patch of [
    { versionLabel: 'v1' },
    { versionLabel: '' },
    { phone: '+33123456789' },
    { phone: '' },
    { modelId: 'wrong' },
    { division: '' },
  ])
    assert.throws(() => prepareCoreModelCopy({ ...i, form: { ...i.form, ...patch } }));
  assert.throws(
    () => prepareCoreModelCopy({ ...i, transientIds: [i.form.sourceFlowId] }),
    /Publiez/,
  );
});
test('new entity journey gets explicit mappings and stays attached to the selected version', () => {
  const i = fixture();
  const result = prepareCoreModelCopy({
    ...i,
    form: { ...i.form, kind: 'declination', name: 'Agence Centre' },
  });
  assert.equal(result.registry.coreModels[0].versions.length, 1);
  const d = result.registry.declinations.find((d) => d.flowId === result.flowId);
  assert.equal(d.baseFlowId, i.form.sourceFlowId);
  assert.equal(d.nodeMappings.length, 2);
  assert.deepEqual(durableRegistry(result.registry, [result.flowId]), i.registry);
});
test('next version suggestion skips used numeric labels and copy form exposes a review step', () => {
  assert.equal(
    nextVersionLabel({ versions: [{ label: 'V1' }, { label: 'V3' }, { label: 'été' }] }),
    'V4',
  );
  const i = fixture(),
    flow = buildVoiceInventory(i.snapshot).flows[0],
    model = {
      ...i.registry.coreModels[0],
      versions: [{ ...i.registry.coreModels[0].versions[0], flow }],
    };
  const html = coreModelCopyView({ step: 0, form: i.form }, model, [{ name: 'France' }]);
  assert.match(html, /Vérifier la copie/);
  assert.match(html, /Nouvelle version/);
  assert.match(html, /Division Genesys/);
  assert.match(html, /restent rattachées/);
});
