import test from 'node:test';
import assert from 'node:assert/strict';
import { controlLabel, routeControls } from '../src/route-controls.js';
import { describeValue } from '../src/business.js';

const recording = (rows) => ({ tables: [{ name: 'W_RECORDING_V5', rows }] });
const flow = (division) => ({
  nodes: [
    { type: 'inboundcall', row: { DIVISION: division } },
    { type: 'decision', row: {} },
  ],
});
const snapshot = recording([
  {
    key: 'Atlantique',
    ENABLE_RECORDING: true,
    AUDIO_RECORDING: 'tts:Cet appel peut être enregistré.',
    CONSENT_MENU: 'MENU_CONSENTEMENT',
  },
  { key: 'Home', ENABLE_RECORDING: false, AUDIO_RECORDING: '', CONSENT_MENU: '' },
]);
const text = (control) => [...control.notes, control.warning].filter(Boolean).join(' ');

test('each control of a route is explained separately, in its execution order', () => {
  const controls = routeControls('INFO_ROUTAGE;RECORDING;bot_qualification', {
    snapshot,
    flow: flow('Atlantique'),
  });
  assert.deepEqual(
    controls.map((c) => [c.name, c.kind]),
    [
      ['INFO_ROUTAGE', 'context'],
      ['RECORDING', 'recording'],
      ['bot_qualification', 'custom'],
    ],
  );
  assert.equal(controls[0].title, 'Données de contexte');
  assert.match(text(controls[0]), /bloc « Données de contexte »/);
  assert.equal(controls[1].title, 'Enregistrement de l’appel');
  assert.match(text(controls[2]), /propre à votre organisation/);
  assert.match(text(controls[2]), /flow Architect/);
  assert.deepEqual(routeControls('', { snapshot }), []);
  assert.deepEqual(routeControls(' ; ', { snapshot }), []);
});

test('recording shows the setting of the journey division', () => {
  const [control] = routeControls('RECORDING', { snapshot, flow: flow('Atlantique') });
  assert.match(text(control), /division « Atlantique »/);
  assert.match(text(control), /Enregistrement autorisé/);
  assert.match(text(control), /Cet appel peut être enregistré\./);
  assert.match(text(control), /MENU_CONSENTEMENT/);
  assert.equal(control.warning, '');
});

test('recording falls back to Home and says when the setting disables it', () => {
  const [control] = routeControls('RECORDING', { snapshot, flow: flow('Nord') });
  assert.match(text(control), /Aucun réglage pour la division « Nord »/);
  assert.match(text(control), /« Home »/);
  assert.match(control.warning, /désactivé/);
});

test('recording share, missing table, missing row and waiting phase are stated', () => {
  const [half] = routeControls('recording_50', { snapshot, flow: flow('Atlantique') });
  assert.equal(half.kind, 'recording');
  assert.match(text(half), /50 % des appels/);
  const [unloaded] = routeControls('RECORDING', { snapshot: { tables: [] }, flow: flow('Nord') });
  assert.match(unloaded.warning, /W_RECORDING_V5 n’est pas chargée/);
  const [absent] = routeControls('RECORDING', {
    snapshot: recording([{ key: 'Sud', ENABLE_RECORDING: true }]),
    flow: flow('Nord'),
  });
  assert.match(absent.warning, /ni pour « Home »/);
  const [waiting] = routeControls('RECORDING', {
    snapshot,
    flow: flow('Atlantique'),
    waiting: true,
  });
  assert.match(waiting.warning, /pendant l’attente/);
  // Les exports CSV gardent des chaînes.
  const [csv] = routeControls('RECORDING', {
    snapshot: recording([{ key: 'Home', ENABLE_RECORDING: 'false' }]),
    flow: flow(''),
  });
  assert.match(csv.warning, /désactivé/);
});

test('standard WOLF controls name what they check and where it is set', () => {
  const controls = routeControls('CHECK_AGENT;check_ewt;CHECK_PIQ;CHECK_INTERACTION', {
    snapshot,
  });
  assert.deepEqual(
    controls.map((c) => c.kind),
    ['standard', 'standard', 'standard', 'standard'],
  );
  assert.match(text(controls[0]), /W_CHECK_AGENT_LOGGED_V5/);
  assert.match(text(controls[1]), /W_THRESHOLD_EWT_PIQ_v5/);
  assert.match(text(controls[3]), /W_CHECK_INTERACTION_NB_v5/);
});

test('control labels cover the recording share and keep custom names readable', () => {
  assert.equal(controlLabel('RECORDING_20'), 'Enregistrement de l’appel (20 % des appels)');
  assert.equal(controlLabel('check_agent'), 'Disponibilité des conseillers');
  assert.equal(controlLabel('INFO_ROUTAGE'), 'Données de contexte');
  assert.equal(controlLabel('bot_qualification'), '');
  assert.equal(
    describeValue('NEXT_TARGET_TYPE', 'decision|sub:bot_qualification;RECORDING_50'),
    'Règle d’orientation · Contrôles : bot qualification · Enregistrement de l’appel (50 % des appels)',
  );
});
