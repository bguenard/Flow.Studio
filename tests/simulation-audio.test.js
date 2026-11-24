import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioSegments,
  simulationPlaylist,
  simulationLanguage,
  createPromptResolver,
  createSimulationAudio,
} from '../src/simulation-audio.js';
import {
  startSimulation,
  advanceSimulation,
  simulationStep,
  rewindSimulation,
} from '../src/call-simulator.js';
import { simulationMap } from '../src/simulation-map.js';
const flow = () => ({
  id: 'entry',
  nodes: [
    {
      id: 'entry',
      type: 'inboundcall',
      key: 'entry',
      row: { DESCRIPTION: 'Accueil <client>', WELCOME_AUDIO: 'tts:Bonjour', LANGUAGE: 'fr-fr' },
    },
    { id: 'menu', type: 'menu', key: 'menu', row: { MENU_AUDIO: 'pr:Choix' } },
  ],
  edges: [
    { from: 'entry', to: 'menu', branch: 'NEXT', resolved: true, audio: 'tts:Veuillez patienter' },
    { from: 'menu', branch: 'OPTION1', type: 'disconnect', terminal: true, resolved: true },
    { from: 'menu', to: 'entry', branch: 'OPTION2', resolved: true },
  ],
});
test('playlist preserves compound audio and transition-before-step order, and avoids replaying source at termination', () => {
  assert.deepEqual(audioSegments('tts:Bonjour|pr:Accueil|prompt:Autre'), [
    { kind: 'tts', text: 'Bonjour' },
    { kind: 'prompt', name: 'Accueil' },
    { kind: 'prompt', name: 'Autre' },
  ]);
  assert.equal(audioSegments('tts:$var:client')[0].kind, 'unavailable');
  let s = startSimulation(flow());
  assert.equal(simulationLanguage(s), 'fr-fr');
  s = advanceSimulation(s, simulationStep(s).routes[0].id);
  assert.deepEqual(simulationPlaylist(s), [
    { kind: 'tts', text: 'Veuillez patienter' },
    { kind: 'prompt', name: 'Choix' },
  ]);
  s = advanceSimulation(s, simulationStep(s).routes[0].id);
  assert.deepEqual(simulationPlaylist(s), []);
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const spoken = [],
    states = [];
  let cancelled = 0;
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const speech = {
    speak: (u) => {
      spoken.push(u);
      u.onstart();
    },
    cancel: () => cancelled++,
  };
  const player = createSimulationAudio({
    speech,
    Utterance,
    resolvePrompt: async () => ({ kind: 'tts', text: 'Message Genesys' }),
    onState: (s) => states.push(s),
  });
  return {
    player,
    spoken,
    states,
    get cancelled() {
      return cancelled;
    },
  };
}
test('completion callbacks sequence audio: a long message cannot advance early', async () => {
  const h = harness();
  let finished = false;
  const run = h.player
    .play(
      [
        { kind: 'tts', text: 'Premier' },
        { kind: 'prompt', name: 'Accueil' },
      ],
      'fr-fr',
    )
    .then((r) => {
      finished = true;
      return r;
    });
  await tick();
  assert.equal(finished, false);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].lang, 'fr-fr');
  h.spoken[0].onend();
  await tick();
  assert.equal(finished, false);
  assert.equal(h.spoken[1].text, 'Message Genesys');
  h.spoken[1].onend();
  assert.deepEqual(await run, { cancelled: false });
  assert.equal(h.states.at(-1), 'done');
});
test('cancelling on pause or navigation prevents queued speech and clears callbacks', async () => {
  const h = harness(),
    run = h.player.play(
      [
        { kind: 'tts', text: 'Premier' },
        { kind: 'tts', text: 'Ne pas lire' },
      ],
      'fr-fr',
    );
  h.player.cancel();
  assert.deepEqual(await run, { cancelled: true });
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].onend, null);
  assert.ok(h.cancelled >= 2);
});
test('cancelling during prompt resolution cannot start stale audio', async () => {
  let finish,
    spoken = 0;
  const player = createSimulationAudio({
    speech: {
      cancel() {},
      speak() {
        spoken++;
      },
    },
    Utterance: class {},
    resolvePrompt: () => new Promise((resolve) => (finish = resolve)),
  });
  const run = player.play([{ kind: 'prompt', name: 'Lent' }], 'fr-fr');
  player.cancel();
  finish({ kind: 'tts', text: 'Périmé' });
  assert.deepEqual(await run, { cancelled: true });
  assert.equal(spoken, 0);
});
test('recorded media waits for ended and is released when finished', async () => {
  let audio;
  class Audio {
    constructor() {
      audio = this;
    }
    play() {
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute(name) {
      this.removed = name;
    }
    load() {}
  }
  const player = createSimulationAudio({ speech: null, AudioClass: Audio });
  let finished = false;
  const run = player
    .play([{ kind: 'media', url: 'https://media.example/message.wav' }], 'fr-fr')
    .then(() => (finished = true));
  await tick();
  assert.equal(finished, false);
  assert.equal(audio.src, 'https://media.example/message.wav');
  audio.onended();
  await run;
  assert.equal(audio.paused, true);
  assert.equal(audio.removed, 'src');
});
test('blocked media and unresolved dynamic messages produce explicit failure, never success', async () => {
  class Audio {
    play() {
      return Promise.reject(Error('NotAllowedError'));
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  const states = [],
    player = createSimulationAudio({
      speech: null,
      AudioClass: Audio,
      onState: (s) => states.push(s),
    });
  await assert.rejects(
    player.play([{ kind: 'media', url: 'https://media.example/audio' }], 'fr-fr'),
    /bloquée/,
  );
  assert.equal(states.includes('done'), false);
  await assert.rejects(
    player.play([{ kind: 'unavailable', name: 'Dynamique' }], 'fr-fr'),
    /non résolu/,
  );
});
test('prompt lookup uses fixed Genesys API and exact language, returning media without credentials', async () => {
  let request;
  const resolver = createPromptResolver(() => 'secret', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          entities: [
            {
              name: 'Accueil',
              resources: [
                { language: 'en-us', mediaUri: 'https://media.example/en' },
                { language: 'fr-FR', mediaUri: 'https://media.example/fr' },
              ],
            },
          ],
        }),
      };
    },
  });
  const resource = await resolver('Accueil', 'fr-fr', new AbortController().signal);
  assert.equal(request.url.origin, 'https://api.mypurecloud.ie');
  assert.equal(request.url.searchParams.get('includeMediaUris'), 'true');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(resource, { kind: 'media', url: 'https://media.example/fr' });
});
test('missing, ambiguous or forbidden prompts cannot be silently substituted', async () => {
  const make = (entities) =>
    createPromptResolver(() => 'token', {
      fetchImpl: async () => ({ ok: true, json: async () => ({ entities }) }),
    });
  const signal = new AbortController().signal;
  await assert.rejects(
    make([{ name: 'A', resources: [{ language: 'en-us', ttsString: 'English' }] }])(
      'A',
      'fr-fr',
      signal,
    ),
    /indisponible en/,
  );
  await assert.rejects(make([{ name: 'A' }, { name: 'A' }])('A', 'fr-fr', signal), /ambigu/);
  await assert.rejects(
    make([{ name: 'A', resources: [{ language: 'fr-fr', text: 'Transcription seule' }] }])(
      'A',
      'fr-fr',
      signal,
    ),
    /aucun audio/,
  );
  const denied = createPromptResolver(() => 'token', {
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(denied('A', 'fr-fr', signal), /refusée/);
});
test('live map highlights only travelled branches and rewinds its history, including terminal destinations', () => {
  let s = startSimulation(flow());
  let html = simulationMap(s);
  assert.match(html, /Accueil &lt;client&gt;/);
  assert.equal((html.match(/simulation-map-edge travelled/g) || []).length, 0);
  s = advanceSimulation(s, simulationStep(s).routes[0].id);
  html = simulationMap(s);
  assert.match(html, /current" data-map-node="menu"/);
  assert.match(html, /visited" data-map-node="entry"/);
  assert.equal((html.match(/simulation-map-edge travelled/g) || []).length, 1);
  const ended = advanceSimulation(s, simulationStep(s).routes[0].id);
  html = simulationMap(ended);
  assert.match(html, /current" data-map-node="destination:/);
  html = simulationMap(rewindSimulation(s));
  assert.equal((html.match(/simulation-map-edge travelled/g) || []).length, 0);
  assert.match(html, /current" data-map-node="entry"/);
});

test('the caller simulation never reads the adviser whisper or a disabled recording announcement', () => {
  const f = flow();
  Object.assign(f.nodes[0].row, {
    WHISPER_AUDIO: 'tts:Message privé conseiller',
    RECORDING_ENABLE: false,
    RECORDING_ANNOUNCE: 'tts:Enregistrement',
  });
  assert.deepEqual(simulationPlaylist(startSimulation(f)), [{ kind: 'tts', text: 'Bonjour' }]);
});
