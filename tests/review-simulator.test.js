import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import {
  startSimulation,
  simulationStep,
  advanceSimulation,
  rewindSimulation,
  resumeSimulation,
} from '../src/call-simulator.js';
import { simulatorView } from '../src/simulator-view.js';
import {
  audioSegments,
  simulationLanguage,
  createPromptResolver,
} from '../src/simulation-audio.js';
import { createCallComparison } from '../src/call-comparison.js';
import { inspectJourney } from '../src/journey-quality.js';
import { branchLabel } from '../src/business.js';

const snapshot = () =>
  normalizeSnapshot({
    tables: [
      {
        id: 'in',
        name: 'W_INBOUND_CALL_v5',
        rows: [
          {
            key: '+331',
            DESCRIPTION: 'Accueil',
            LANGUAGE: 'fr-fr',
            NEXT_TARGET_TYPE: 'menu',
            NEXT_TARGET: 'M',
          },
        ],
      },
      {
        id: 'menu',
        name: 'W_MENU_v5',
        rows: [
          {
            key: 'M',
            DESCRIPTION: 'Menu',
            MENU_AUDIO: 'tts:Choisissez',
            OPTION1_TARGET_TYPE: 'service',
            OPTION1_TARGET: 'S',
            OPTION2_TARGET_TYPE: 'transfercallflow',
            OPTION2_TARGET: 'T',
            OPTION3_TARGET_TYPE: 'menu|lang:en-us',
            OPTION3_TARGET: 'M2',
            OPTION4_TARGET_TYPE: 'callback',
            OPTION4_TARGET: 'cb1',
          },
          {
            key: 'M2',
            DESCRIPTION: 'English menu',
            MENU_AUDIO: 'tts:Choose',
            OPTION1_TARGET_TYPE: 'disconnect',
            OPTION1_TARGET: '',
          },
        ],
      },
      {
        id: 'svc',
        name: 'W_SERVICES_v5',
        rows: [
          {
            key: 'S',
            DESCRIPTION: 'Equipe',
            QUEUE: 'Q1',
            INQUEUE_TARGET_TYPE: 'queue',
            INQUEUE_TARGET: 'Q Debordement',
          },
        ],
      },
      {
        id: 'trf',
        name: 'W_TRANSFER_CALLFLOW_v5',
        rows: [{ key: 'T', DESCRIPTION: 'Transfert', FLOW_NAME: 'Autre flow' }],
      },
      { id: 'cb', name: 'W_CALLBACK_v5', rows: [{ key: 'cb1', DESCRIPTION: 'Rappel' }] },
    ],
  });
const flow = () => buildVoiceInventory(snapshot()).flows[0];
const choose = (session, branch) =>
  advanceSimulation(
    session,
    simulationStep(session).routes.find((route) => route.edge.branch === branch).id,
  );
const atMenu = () => choose(startSimulation(flow()), 'NEXT');

test('a step with no outgoing route ends the call instead of waiting for an impossible choice', () => {
  const menu = atMenu(),
    ended = choose(menu, 'OPTION2');
  assert.equal(ended.status, 'complete');
  assert.equal(ended.outcome, 'Transfert');
  assert.doesNotMatch(simulatorView(ended), /Aucune sortie simulable/);
  const back = rewindSimulation(ended);
  assert.equal(back.status, 'active');
  assert.equal(back.nodeId, menu.nodeId);
  // The before/after comparison must reach its verdict on such a journey.
  const comparison = createCallComparison(flow(), flow());
  assert.ok(comparison);
});

test('an overflow to another Genesys queue stays available while the caller waits', () => {
  const service = choose(atMenu(), 'OPTION1');
  const waiting = choose(service, 'QUEUE');
  assert.equal(simulationStep(waiting).waiting, true);
  const branches = simulationStep(waiting).routes.map((route) => route.edge.branch);
  assert.ok(branches.includes('INQUEUE'), branches.join(' '));
  assert.ok(!branches.includes('QUEUE'));
  const overflow = choose(waiting, 'INQUEUE');
  assert.equal(overflow.status, 'complete');
  assert.match(overflow.outcome, /Q Debordement/);
  // Taking the overflow before queueing is an exit, not a second way of entering the queue.
  const direct = choose(service, 'INQUEUE');
  assert.equal(direct.status, 'complete');
  assert.equal(direct.waiting, null);
});

test('a callback destination is an external hand-over, not a missing destination', () => {
  const report = inspectJourney(flow(), snapshot());
  assert.equal(report.errors, 0);
  assert.ok(
    report.findings.some((finding) => finding.level === 'warning' && /rappel/i.test(finding.title)),
  );
  const orphan = snapshot();
  const tables = structuredClone(orphan.tables).filter((table) => table.name !== 'W_CALLBACK_v5');
  assert.ok(
    inspectJourney(flow(), { tables }).errors > 0,
    'a callback without its row is still a missing destination',
  );
  const ended = choose(atMenu(), 'OPTION4');
  assert.equal(ended.status, 'complete');
  assert.match(ended.outcome, /rappel/i);
});

test('a language switch on a transition applies to the following messages and is undone by going back', () => {
  const menu = atMenu();
  assert.equal(simulationLanguage(menu), 'fr-fr');
  const english = choose(menu, 'OPTION3');
  assert.equal(simulationLanguage(english), 'en-us');
  assert.equal(simulationLanguage(rewindSimulation(english)), 'fr-fr');
});

test('playback options do not interrupt the message they qualify', () => {
  assert.deepEqual(audioSegments('tts:Bonjour|barg:false'), [{ kind: 'tts', text: 'Bonjour' }]);
  assert.deepEqual(audioSegments('barg:true|pr:Accueil'), [{ kind: 'prompt', name: 'Accueil' }]);
  assert.equal(audioSegments('tts:Bonjour|inconnu').at(-1).kind, 'unavailable');
});

test('a prompt that cannot be fetched reports a readable reason', async () => {
  const resolve = createPromptResolver(() => 'token', {
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(
    resolve('Accueil', 'fr-fr', new AbortController().signal),
    (error) => !/Failed to fetch/.test(error.message) && /Genesys/.test(error.message),
  );
});

test('at the transition limit the simulator does not offer a choice it cannot render', () => {
  const session = {
    ...atMenu(),
    status: 'boundary',
    outcome: 'Limite de 80 transitions atteinte. Vérifiez la boucle de ce parcours.',
  };
  session.trail = Array.from({ length: 80 }, () => structuredClone(session.trail[0]));
  const html = simulatorView(session);
  assert.doesNotMatch(html, /Vous pouvez choisir explicitement/);
  assert.doesNotMatch(html, /id="simulation-destination"/);
  assert.throws(() => resumeSimulation(session, session.nodeId), /ne peut pas être reprise/);
});

test('bot outcomes are labelled in French like their settings', () => {
  assert.equal(branchLabel({ branch: 'NO_MATCH' }), 'Sans résultat du bot');
  assert.equal(branchLabel({ branch: 'NO_INPUT' }), 'Sans réponse au bot');
});

const macVoices = [
  'Amélie|fr-CA',
  'Eddy (French (Canada))|fr-CA',
  'Eddy (French (France))|fr-FR',
  'Flo (French (France))|fr-FR',
  'Grandma (French (France))|fr-FR',
  'Jacques|fr-FR',
  'Rocko (French (France))|fr-FR',
  'Shelley (French (France))|fr-FR',
  'Thomas|fr-FR',
  'Samantha|en-US',
  'Zarvox|en-US',
].map((entry) => {
  const [name, lang] = entry.split('|');
  return { name, lang, localService: true, default: false };
});

test('speech uses a natural voice of the journey language, never the first novelty voice the browser lists', async () => {
  const { pickVoice } = await import('../src/simulation-audio.js');
  assert.equal(pickVoice(macVoices, 'fr-fr').name, 'Jacques');
  assert.equal(
    pickVoice([...macVoices, { name: 'Thomas (Premium)', lang: 'fr-FR' }], 'fr-FR').name,
    'Thomas (Premium)',
  );
  assert.equal(
    pickVoice([{ name: 'Google français', lang: 'fr-FR' }, ...macVoices], 'fr-fr').name,
    'Google français',
  );
  // Same language from another country beats a robotic voice of the exact locale; no voice at all stays possible.
  assert.equal(
    pickVoice(
      macVoices.filter((voice) => !['Jacques', 'Thomas'].includes(voice.name)),
      'fr-fr',
    ).name,
    'Amélie',
  );
  assert.equal(pickVoice(macVoices, 'en-us').name, 'Samantha');
  assert.equal(pickVoice(macVoices, 'de-de'), null);
  assert.equal(pickVoice([], 'fr-fr'), null);
});

test('the chosen voice is applied to each spoken message', async () => {
  const { createSimulationAudio } = await import('../src/simulation-audio.js');
  const spoken = [];
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const speech = {
    getVoices: () => macVoices,
    cancel() {},
    speak(utterance) {
      spoken.push(utterance);
      utterance.onstart();
      utterance.onend();
    },
  };
  await createSimulationAudio({ speech, Utterance }).play(
    [{ kind: 'tts', text: 'Bonjour' }],
    'fr-fr',
  );
  assert.equal(spoken[0].voice.name, 'Jacques');
  assert.equal(spoken[0].lang, 'fr-FR');
});
