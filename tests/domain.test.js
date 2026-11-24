import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeedState, getEntity, compareEntity, getEntitySummary, updateEntity,
  applyCoreVersion, copyFields, rollbackEntity, createCoreVersion,
  createChannel, validateEntity, exportDeploymentPlan, rejectCoreVersion,
} from '../src/domain.js';

test('three-way merge detects incoming, local, true conflict and convergence', () => {
  let state = createSeedState();
  const rows = compareEntity(state, 'mutuaide');
  assert.equal(rows.find(row => row.key === 'routingRule').status, 'conflict');
  assert.equal(rows.find(row => row.key === 'welcomeMessage').status, 'incoming');
  assert.equal(rows.find(row => row.key === 'channelEnabled').status, 'local');
  state = updateEntity(state, 'gan-vie', { welcomeMessage: state.coreVersions[1].fields.welcomeMessage });
  assert.equal(compareEntity(state, 'gan-vie').find(row => row.key === 'welcomeMessage').status, 'converged');
});

test('unresolved conflict rejects atomically and explicit local resolution survives adoption', () => {
  const state = createSeedState();
  const before = structuredClone(state);
  assert.throws(() => applyCoreVersion(state, 'mutuaide'), /Résoudre/);
  assert.deepEqual(state, before);
  const result = applyCoreVersion(state, 'mutuaide', { routingRule: 'local' });
  const entity = getEntity(result, 'mutuaide');
  assert.equal(entity.baseVersionId, 'core-2.1');
  assert.equal(entity.fields.routingRule, 'Assistance prioritaire 24/7');
  assert.equal(entity.fields.channelEnabled, false);
  assert.equal(entity.fields.welcomeMessage, result.coreVersions[1].fields.welcomeMessage);
  assert.equal(compareEntity(result, 'mutuaide').find(row => row.key === 'routingRule').status, 'local');
  assert.equal(getEntitySummary(result, 'mutuaide').conflicts, 0);
});

test('core resolution changes only conflicted field and preserves independent overrides', () => {
  const state = applyCoreVersion(createSeedState(), 'mutuaide', { routingRule: 'core' });
  assert.equal(getEntity(state, 'mutuaide').fields.routingRule, state.coreVersions[1].fields.routingRule);
  assert.equal(getEntity(state, 'mutuaide').fields.hours, 'Tous les jours · 24 h/24');
  assert.equal(getEntity(state, 'mutuaide').fields.channelEnabled, false);
});

test('selective copy preserves identities, binding IDs, base version and activation', () => {
  const before = createSeedState();
  const source = getEntity(before, 'gan-vie');
  const target = getEntity(before, 'mutuaide');
  const after = copyFields(before, 'gan-vie', ['mutuaide'], ['priority', 'team', 'hours']);
  const result = getEntity(after, 'mutuaide');
  assert.equal(result.fields.priority, source.fields.priority);
  assert.equal(result.fields.team, source.fields.team);
  assert.deepEqual(result.bindings, target.bindings);
  assert.equal(result.baseVersionId, target.baseVersionId);
  assert.equal(result.fields.channelEnabled, false);
  assert.notEqual(result.bindings.queueIds[result.fields.team], source.bindings.queueIds[source.fields.team]);
  assert.throws(() => copyFields(before, 'gan-vie', ['mutuaide'], ['channelEnabled']), /périmètre pilote/);
  assert.throws(() => copyFields(before, 'gan-vie', ['mutuaide'], ['divisionId']), /identifiants/);
});

test('invalid multi-target copy is atomic', () => {
  const state = createSeedState();
  delete getEntity(state, 'cr12').bindings.queueIds['Équipe dédiée'];
  const before = structuredClone(state);
  assert.throws(() => copyFields(state, 'gan-vie', ['gan-assurance', 'cr12'], ['team']), /alias métier/);
  assert.deepEqual(state, before);
});

test('invalid local configuration is rejected and pilot scope needs at least one IVR choice', () => {
  const state = createSeedState();
  assert.throws(() => updateEntity(state, 'cr12', { intentions: [] }), /choix SVI/);
  assert.throws(() => updateEntity(state, 'gan-vie', { priority: -1 }), /entre/);
  assert.throws(() => updateEntity(state, 'gan-vie', { bindings: {} }), /non autorisé/);
  assert.throws(() => updateEntity(state, 'gan-vie', { channelEnabled: 'false' }), /vrai ou faux/);
  assert.equal(getEntity(updateEntity(state, 'gan-vie', { channelEnabled: false, intentions: [] }), 'gan-vie').fields.channelEnabled, false);
  assert.equal(validateEntity(state, 'gan-vie').valid, true);
});

test('voice seed and local governance flag cannot be changed by group propagation', () => {
  const initial = createSeedState();
  assert.equal(initial.media, 'voice');
  assert.equal(initial.channels[0].name, 'Voix');
  assert.ok(initial.coreVersions.every(version => version.channel === 'Voix'));
  assert.throws(() => createCoreVersion(initial, { channelEnabled: false }), /localement/);
  // Even an imported version with a changed boolean must not switch the local scope.
  initial.coreVersions[1].fields.channelEnabled = false;
  const after = applyCoreVersion(initial, 'gan-vie');
  assert.equal(getEntity(after, 'gan-vie').fields.channelEnabled, true);
  assert.equal(compareEntity(initial, 'gan-vie').find(row => row.key === 'channelEnabled').groupChanged, false);
});

test('rollback restores configuration and baseline while retaining audit and bindings', () => {
  const initial = createSeedState();
  let state = applyCoreVersion(initial, 'gan-vie');
  assert.equal(getEntity(state, 'gan-vie').baseVersionId, 'core-2.1');
  state = rollbackEntity(state, 'gan-vie');
  assert.deepEqual(getEntity(state, 'gan-vie').fields, getEntity(initial, 'gan-vie').fields);
  assert.equal(getEntity(state, 'gan-vie').baseVersionId, 'core-2.0');
  assert.deepEqual(getEntity(state, 'gan-vie').bindings, getEntity(initial, 'gan-vie').bindings);
  assert.equal(state.audit[0].type, 'rollback');
  assert.ok(state.audit.some(event => event.type === 'propagation'));
});

test('new version preserves old immutable baseline and computes next version', () => {
  const initial = createSeedState();
  const before = structuredClone(initial);
  const state = createCoreVersion(initial, { welcomeMessage: 'Bonjour et bienvenue.' });
  assert.equal(state.currentCoreId, 'core-2.2');
  assert.deepEqual(initial, before);
  assert.equal(state.coreVersions[0].fields.welcomeMessage, before.coreVersions[0].fields.welcomeMessage);
  assert.equal(getEntity(state, 'gan-vie').baseVersionId, 'core-2.0');
  assert.throws(() => createCoreVersion(state, {}), /au moins/);
});

test('catalogue channel creation is explicit draft, does not claim Genesys provisioning', () => {
  const initial = createSeedState();
  const state = createChannel(initial, { name: 'RCS Business Messaging', skills: ['Relation client', 'RCS'] });
  assert.equal(state.channels[1].status, 'draft');
  assert.equal(state.currentCoreId, initial.currentCoreId);
  assert.deepEqual(state.entities, initial.entities);
  assert.throws(() => createChannel(state, { name: 'voix' }), /existe déjà/);
});

test('defer records rationale without altering entity config; plan is marked non executable', () => {
  const initial = createSeedState();
  const state = rejectCoreVersion(initial, 'mutuaide', 'Canal non prêt');
  assert.equal(getEntity(state, 'mutuaide').deferredVersionId, 'core-2.1');
  assert.deepEqual(getEntity(state, 'mutuaide').fields, getEntity(initial, 'mutuaide').fields);
  const plan = exportDeploymentPlan(state, ['mutuaide']);
  assert.equal(plan.mode, 'simulation');
  assert.equal(plan.demo, true);
  assert.equal(plan.media, 'voice');
  assert.equal(plan.entities[0].channelEnabled, false);
  assert.ok(plan.entities[0].unresolvedMappings.length > 0);
});
