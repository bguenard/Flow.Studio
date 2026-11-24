import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRegistry, declareReference, attachDeclination } from '../src/governance.js';
import {
  coreModelCandidates,
  prepareCoreModel,
  removeCoreModel,
  coreModelWizardView,
  coreModelDeleteView,
  validateCoreModelIdentity,
} from '../src/core-model-wizard.js';
import { durableRegistry, restorePendingRegistry } from '../src/governance-projection.js';
import { coreModelsView } from '../src/governance-views.js';
const base = () =>
  declareReference(emptyRegistry(), { flowId: 'ref', name: 'Groupe', versionLabel: 'V1' });
const flow = (id, name) => ({
  id,
  key: '+33999999510',
  title: name,
  description: name,
  row: { DESCRIPTION: name },
  nodes: [],
  menus: [],
  services: [],
  issues: [],
});
test('wizard refuses to steal an existing role and ignores unpublished journeys', () => {
  const r = attachDeclination(base(), { flowId: 'child', baseFlowId: 'ref' }),
    flows = ['ref', 'child', 'pending', 'free'].map((id) => flow(id, id));
  assert.deepEqual(
    coreModelCandidates(r, flows, ['pending']).map((f) => f.id),
    ['free'],
  );
  for (const flowId of ['ref', 'child', 'pending', 'missing'])
    assert.throws(
      () => prepareCoreModel(r, { name: 'Autre', version: 'V1', flowId }, flows, ['pending']),
      /publié/,
    );
  const copy = structuredClone(flows),
    next = prepareCoreModel(r, { name: 'Autre', version: 'V1', flowId: 'free' }, flows, [
      'pending',
    ]);
  assert.equal(next.coreModels.length, 2);
  assert.deepEqual(flows, copy);
  assert.equal(r.coreModels.length, 1);
});
test('wizard rejects blank identity and duplicate names', () => {
  for (const form of [
    { name: ' ', version: 'V1' },
    { name: 'Test', version: '' },
    { name: 'groupe', version: 'V1' },
  ])
    assert.throws(() => validateCoreModelIdentity(base(), form));
});
test('delete removes every version of childless model, preserves other models and caller input', () => {
  let r = declareReference(base(), {
    flowId: 'ref2',
    coreModelId: base().coreModels[0].id,
    versionLabel: 'V2',
  });
  r = declareReference(r, { flowId: 'other', name: 'Autre', versionLabel: 'V1' });
  const before = structuredClone(r);
  const next = removeCoreModel(r, r.coreModels[0].id);
  assert.equal(next.coreModels.length, 1);
  assert.equal(next.coreModels[0].name, 'Autre');
  assert.deepEqual(r, before);
  assert.throws(() => removeCoreModel(r, 'missing'), /existe plus/);
});
test('delete refuses child on any version, even if its journey is absent from the loaded source', () => {
  let r = declareReference(base(), {
    flowId: 'ref2',
    coreModelId: base().coreModels[0].id,
    versionLabel: 'V2',
  });
  for (const baseFlowId of ['ref', 'ref2']) {
    const used = attachDeclination(r, { flowId: 'not-loaded', baseFlowId });
    assert.throws(() => removeCoreModel(used, r.coreModels[0].id), /déclinaisons/);
  }
});
test('new Core Model remains draft until WOLF rows are published and survives recovery', () => {
  const r = declareReference(base(), { flowId: 'new', name: 'Nouveau', versionLabel: 'V1' });
  assert.deepEqual(durableRegistry(r, ['new']), base());
  assert.deepEqual(restorePendingRegistry(base(), r, ['new']), r);
  assert.deepEqual(durableRegistry(r, []), r);
});
test('wizard escapes names, exposes review and explicit preservation on delete', () => {
  const state = {
    step: 1,
    form: { name: '<script>', version: 'V1', mode: 'existing', flowId: 'free' },
  };
  const html = coreModelWizardView(state, [flow('free', 'Libre')]);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('core-model-create'));
  assert.ok(html.includes('Précédent'));
  const deletion = coreModelDeleteView(base().coreModels[0]);
  assert.ok(deletion.includes('Confirmer la suppression'));
  assert.ok(deletion.includes('toutes les lignes des tables WOLF sont conservés'));
});
test('Core Models page exposes creation and deletion only for childless models', () => {
  const models = [
    {
      id: 'used',
      name: 'Parent',
      latest: { label: 'V1' },
      versions: [],
      declinations: [{ flowId: 'child' }],
    },
    { id: 'empty', name: 'Libre', latest: { label: 'V1' }, versions: [], declinations: [] },
  ];
  const html = coreModelsView({
    resolved: { models, candidates: [], missing: 0 },
    summaries: new Map(),
    meta: () => '',
    shared: true,
  });
  assert.ok(html.includes('core-model-open'));
  assert.match(html, /data-action="core-model-delete"[^>]*data-model="empty"/);
  assert.doesNotMatch(html, /data-action="core-model-delete"[^>]*data-model="used"/);
});
