import test from 'node:test';
import assert from 'node:assert/strict';
import { journeySteps } from '../src/journey-navigation.js';
import { buildVoiceInventory } from '../src/data-source.js';

const node = (id, type, description) => ({ id, type, key: id, label: type === 'menu' ? 'Menu vocal' : 'Étape', row: { key: id, ...(description ? { DESCRIPTION: description } : {}) } });
const edge = (from, to, branch, extra = {}) => ({ from, to, branch, type: 'service', resolved: true, relationship: 'route', ...extra });

test('navigation follows actual branches, preserving names and original editor indices', () => {
  const flow = { id: 'entry', nodes: [node('team', 'service', 'Assistance habitation'), node('entry', 'inboundcall', 'Bienvenue chez nous'), node('hours', 'schedulegroup', 'Fermetures exceptionnelles'), node('menu', 'menu', 'Motif de votre appel')], edges: [edge('entry', 'hours', 'NEXT'), edge('hours', 'menu', 'OPEN'), edge('hours', 'team', 'EMERGENCY'), edge('menu', 'team', 'OPTION1')] };
  const steps = journeySteps(flow);
  assert.deepEqual(steps.map(step => step.id), ['entry', 'hours', 'menu', 'team']);
  assert.equal(steps[0].title, 'Bienvenue chez nous');
  assert.equal(steps[0].label, 'Entrée du parcours');
  assert.equal(steps[0].index, 1);
  assert.equal(steps[1].title, 'Fermetures exceptionnelles');
  assert.equal(steps[2].title, 'Motif de votre appel');
  assert.deepEqual(steps[3].incoming.map(route => [route.fromId, route.label]), [['hours', 'En situation d’urgence'], ['menu', 'Choix 1']]);
  assert.deepEqual(steps[1].outgoing.map(route => route.toId), ['menu', 'team']);
});

test('cycle and duplicate edges do not duplicate steps or erase distinct branches', () => {
  const route = edge('entry', 'menu', 'NEXT');
  const steps = journeySteps({ id: 'entry', nodes: [node('entry', 'inboundcall'), node('menu', 'menu'), node('menu', 'menu')], edges: [route, { ...route }, edge('menu', 'entry', 'OPTION1'), edge('menu', 'entry', 'OPTION2')] });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].outgoing.length, 1);
  assert.deepEqual(steps[1].outgoing.map(route => route.label), ['Choix 1', 'Choix 2']);
  assert.equal(steps[0].incoming.length, 2);
});

test('attached participant data stays accessible without becoming a routing step', () => {
  const steps = journeySteps({ id: 'entry', nodes: [node('entry', 'inboundcall'), node('context', 'pdata', 'Motif habitation'), node('team', 'service')], edges: [edge('entry', 'context', '', { relationship: 'context', type: 'pdata' }), edge('entry', 'team', 'NEXT')] });
  assert.deepEqual(steps.map(step => step.id), ['entry', 'team', 'context']);
  assert.deepEqual(steps[0].outgoing.map(route => route.toId), ['team']);
  assert.deepEqual(steps[0].contexts.map(route => route.toId), ['context']);
  assert.equal(steps[2].contextOnly, true);
  assert.equal(steps[2].incoming[0].relationship, 'context');
  assert.equal(steps[2].title, 'Motif habitation');
});

test('participant data used as an explicit destination remains a routing step', () => {
  const steps = journeySteps({ id: 'entry', nodes: [node('entry', 'inboundcall'), node('context', 'pdata')], edges: [edge('entry', 'context', 'NEXT', { type: 'pdata' }), edge('entry', 'context', '', { type: 'pdata', relationship: 'context' })] });
  assert.equal(steps[1].contextOnly, false);
  assert.equal(steps[0].outgoing[0].toId, 'context');
  assert.equal(steps[0].contexts[0].toId, 'context');
});

test('missing, dynamic and terminal destinations do not create invented steps', () => {
  const steps = journeySteps({ id: 'entry', nodes: [node('entry', 'inboundcall')], edges: [edge('entry', 'missing', 'OPEN'), edge('entry', null, 'CLOSED', { resolved: false, dynamic: true }), edge('entry', null, 'DEFAULT', { terminal: true, type: 'disconnect' }), edge('unknown', 'entry', 'NEXT')] });
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].incoming, []);
  assert.equal(steps[0].outgoing[0].toId, null);
  assert.equal(steps[0].outgoing[0].resolved, false);
  assert.equal(steps[0].outgoing[0].title, 'Destination à vérifier');
  assert.equal(steps[0].outgoing[1].title, 'Destination déterminée pendant l’appel');
  assert.equal(steps[0].outgoing[2].title, 'Fin d’appel');
});

test('unconnected rows are accessible but never given an invented incoming branch', () => {
  const input = { id: 'entry', nodes: [node('loose', 'service', 'Équipe de secours'), node('entry', 'inboundcall')], edges: [] };
  const original = structuredClone(input);
  const steps = journeySteps(input);
  assert.deepEqual(steps.map(step => step.id), ['entry', 'loose']);
  assert.deepEqual(steps[1].incoming, []);
  assert.deepEqual(input, original);
  assert.deepEqual(journeySteps(null), []);
});

test('projection reads actual WOLF inventory and does not infer team identity from keys', () => {
  const inventory = buildVoiceInventory({ tables: [
    { id: 'in', name: 'W_INBOUND_CALL_v5', rows: [{ key: 'ENTRY', DESCRIPTION: 'Accueil particuliers', NEXT_TARGET_TYPE: 'service', NEXT_TARGET: 'SINISTRE', DEFAULT_TARGET_TYPE: 'disconnect', DEFAULT_TARGET: '' }] },
    { id: 'svc', name: 'W_SERVICES_v5', rows: [{ key: 'SINISTRE', DESCRIPTION: 'Relation courtiers', PRIORITY: '5' }] },
  ] });
  const steps = journeySteps(inventory.flows[0]);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].title, 'Relation courtiers');
  assert.equal(steps[0].outgoing[0].title, 'Relation courtiers');
  assert.equal(steps[0].outgoing[1].title, 'Fin d’appel');
});
