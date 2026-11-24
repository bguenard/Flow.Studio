import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startSimulation,
  simulationStep,
  advanceSimulation,
  rewindSimulation,
  simulationReport,
  journeyHealth,
} from '../src/call-simulator.js';
import { simulatorView, simulationSpeech } from '../src/simulator-view.js';
const flow = () => ({
  id: 'entry',
  name: 'Accueil <client>',
  nodes: [
    {
      id: 'entry',
      key: 'entry',
      type: 'inboundcall',
      tableName: 'W_INBOUND_CALL_v5',
      row: { WELCOME_AUDIO: 'tts:Bonjour', DESCRIPTION: 'Accueil' },
    },
    {
      id: 'menu',
      key: 'menu',
      type: 'menu',
      tableName: 'W_MENU_v5',
      row: { MENU_AUDIO: 'pr:Choix', DESCRIPTION: 'Menu' },
    },
  ],
  edges: [
    { from: 'entry', to: 'menu', branch: 'NEXT', field: 'NEXT_TARGET_TYPE', resolved: true },
    {
      from: 'menu',
      branch: 'OPTION1',
      field: 'OPTION1_TARGET_TYPE',
      terminal: true,
      resolved: true,
      type: 'disconnect',
    },
    {
      from: 'menu',
      branch: 'OPTION2',
      field: 'OPTION2_TARGET_TYPE',
      dynamic: true,
      type: 'queue',
      target: 'variable',
    },
    { from: 'menu', branch: 'OPTION3', resolved: false, target: 'missing' },
    { from: 'menu', to: 'entry', branch: 'DEFAULT', resolved: true },
    { from: 'menu', to: 'entry', relationship: 'context', resolved: true },
  ],
});
test('simulation follows actual branches, carries audio and supports backtracking without changing the flow', () => {
  const source = flow(),
    before = structuredClone(source),
    session = startSimulation(source);
  assert.equal(simulationSpeech(session), 'Bonjour');
  let next = advanceSimulation(session, simulationStep(session).routes[0].id);
  assert.equal(next.nodeId, 'menu');
  assert.equal(simulationStep(next).routes.length, 4);
  assert.equal(simulationSpeech(next), '');
  const ended = advanceSimulation(next, simulationStep(next).routes[0].id);
  assert.equal(ended.status, 'complete');
  assert.equal(rewindSimulation(ended).nodeId, 'menu');
  assert.equal(simulationReport(ended).executedInGenesys, false);
  assert.deepEqual(source, before);
});
test('dynamic and unresolved destinations never produce invented call outcomes', () => {
  const session = startSimulation(flow()),
    menu = advanceSimulation(session, simulationStep(session).routes[0].id),
    routes = simulationStep(menu).routes;
  assert.equal(advanceSimulation(menu, routes[1].id).status, 'boundary');
  assert.equal(advanceSimulation(menu, routes[2].id).status, 'blocked');
  assert.throws(() => advanceSimulation(menu, 'foreign-route'), /n’appartient/);
  assert.equal(journeyHealth(flow()).dynamic.length, 1);
});
test('UI escapes names, labels its assumptions and distinguishes source versions', () => {
  const html = simulatorView(startSimulation(flow()));
  assert.match(html, /Accueil &lt;client&gt;/);
  assert.match(html, /aucun appel réel/);
  assert.match(html, /Version Genesys/);
  assert.match(html, /Mes modifications/);
});

import { automaticSimulationRoute, resumeSimulation } from '../src/call-simulator.js';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
function waitingFlow(queue = 'Q Sinistres') {
  return buildVoiceInventory(
    normalizeSnapshot({
      tables: [
        {
          id: 'entry',
          name: 'W_INBOUND_CALL_v5',
          rows: [
            {
              key: '100',
              NEXT_TARGET_TYPE: 'service',
              NEXT_TARGET: 'team',
              DEFAULT_TARGET_TYPE: 'disconnect',
            },
          ],
        },
        {
          id: 'services',
          name: 'W_SERVICES_v5',
          rows: [
            {
              key: 'team',
              DESCRIPTION: 'Équipe',
              QUEUE: queue,
              INQUEUE_AUDIO_1: 'tts:Merci de patienter',
              INQUEUE_MENU_1: 'waiting-menu',
              INQUEUE_TARGET_TYPE: 'service',
              INQUEUE_TARGET: 'backup',
            },
            { key: 'backup', QUEUE: 'Q Assistance', INQUEUE_TARGET_TYPE: 'disconnect' },
          ],
        },
        {
          id: 'menus',
          name: 'W_MENU_v5',
          rows: [
            {
              key: 'waiting-menu',
              MENU_AUDIO: 'tts:Pour rester en ligne, tapez 1',
              OPTION1_TARGET_TYPE: 'next',
              OPTION2_TARGET_TYPE: 'disconnect',
            },
          ],
        },
      ],
    }),
  ).flows[0];
}
const choose = (session, branch) =>
  advanceSimulation(
    session,
    simulationStep(session).routes.find((r) => r.edge.branch === branch).id,
  );
test('a full V5 call goes through queue, waiting menu, return and overflow instead of ending at the first queue', () => {
  const f = waitingFlow();
  let s = startSimulation(f);
  s = advanceSimulation(s, automaticSimulationRoute(s).id);
  assert.equal(simulationStep(s).node.type, 'service');
  s = choose(s, 'QUEUE');
  assert.equal(s.status, 'active');
  assert.equal(simulationStep(s).waiting, true);
  assert.equal(simulationSpeech(s), 'Merci de patienter');
  s = choose(s, 'INQUEUE_MENU_1');
  assert.equal(simulationStep(s).node.type, 'menu');
  s = choose(s, 'OPTION1');
  assert.equal(s.status, 'active');
  assert.equal(simulationStep(s).waiting, true);
  assert.equal(s.returns.length, 0);
  assert.equal(rewindSimulation(s).returns.length, 1);
  assert.equal(simulationStep(rewindSimulation(s)).node.type, 'menu');
  s = choose(s, 'INQUEUE');
  assert.equal(simulationStep(s).node.key, 'backup');
  s = choose(s, 'QUEUE');
  assert.equal(s.status, 'active');
  s = advanceSimulation(s, 'sim:answered');
  assert.equal(s.status, 'complete');
  assert.match(s.outcome, /conseiller/);
  assert.equal(simulationStep(rewindSimulation(s)).waiting, true);
  assert.equal(
    simulationReport(s).transitions.some((t) => 'previous' in t),
    false,
  );
});
test('a dynamic service queue allows explicitly simulated waiting events without inventing a queue identity', () => {
  let s = choose(startSimulation(waitingFlow('variable')), 'NEXT');
  s = choose(s, 'QUEUE');
  assert.equal(s.status, 'active');
  assert.match(s.waiting.queue, /choisie pendant/);
  s = choose(s, 'INQUEUE');
  assert.equal(simulationStep(s).node.key, 'backup');
});
test('automatic playback uses the normal entry transition and waits for interactive decisions', () => {
  let s = startSimulation(flow());
  assert.equal(automaticSimulationRoute(s).edge.branch, 'NEXT');
  s = advanceSimulation(s, automaticSimulationRoute(s).id);
  assert.equal(automaticSimulationRoute(s), null);
  const decision = {
    ...flow(),
    nodes: flow().nodes.map((n) => ({ ...n, type: n.id === 'entry' ? 'decision' : n.type })),
  };
  assert.equal(automaticSimulationRoute(startSimulation(decision)), null);
});
test('an explicit dynamic continuation is reversible and exported as a simulation hypothesis', () => {
  let s = choose(startSimulation(flow()), 'NEXT');
  s = choose(s, 'OPTION2');
  const resumed = resumeSimulation(s, 'entry');
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.nodeId, 'entry');
  assert.equal(simulationReport(resumed).transitions.at(-1).override, true);
  assert.equal(rewindSimulation(resumed).status, 'boundary');
  assert.throws(() => resumeSimulation(s, 'missing'), /Choisissez/);
  assert.match(simulatorView(s), /Continuer avec cette hypothèse/);
});
test('loop protection prevents automatic replay beyond the transition budget', () => {
  let s = startSimulation(flow());
  for (let i = 0; i < 40; i++) {
    s = choose(s, 'NEXT');
    s = choose(s, 'DEFAULT');
  }
  assert.equal(s.status, 'boundary');
  assert.equal(automaticSimulationRoute(s), null);
  assert.throws(() => resumeSimulation(s, 'entry'), /reprise/);
});
