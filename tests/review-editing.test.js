import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';
import { prepareRouteEdit } from '../src/flow-designer.js';
import { prepareStepDraft } from '../src/step-draft.js';
import { audioModeEdit } from '../src/resource-editor.js';
import { stepFieldView } from '../src/step-field-view.js';
import { businessFields } from '../src/business.js';

function menuWithExternalOutlets() {
  const raw = structuredClone(demoSnapshot),
    row = raw.tables
      .find((table) => table.name === 'W_MENU_v5')
      .rows.find((item) => item.key === 'DEMO_MENU_ATLANTIQUE');
  row.OPTION2_TARGET_TYPE = 'callback';
  row.OPTION2_TARGET = 'cb1';
  row.DEFAULT_TARGET_TYPE = 'menu';
  row.DEFAULT_TARGET = 'MENU_ABSENT';
  const snapshot = normalizeSnapshot(raw),
    flow = buildVoiceInventory(snapshot).flows.find(
      (item) => item.key === 'DEMO_ENTREE_ATLANTIQUE',
    );
  return {
    snapshot,
    flow,
    nodeId: flow.nodes.find((node) => node.key === 'DEMO_MENU_ATLANTIQUE').id,
  };
}

test('a step keeps its callback outlet and its older broken outlet while another outlet is edited', () => {
  const { snapshot, flow, nodeId } = menuWithExternalOutlets();
  const plan = prepareRouteEdit({
    snapshot,
    flow,
    nodeId,
    field: 'OPTION1_TARGET_TYPE',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows[0].row.OPTION2_TARGET_TYPE, 'callback');
  assert.equal(plan.updatedRows[0].row.DEFAULT_TARGET, 'MENU_ABSENT');
});

test('a broken outlet can be repaired even when the same step has another one', () => {
  const { snapshot, flow, nodeId } = menuWithExternalOutlets();
  const plan = prepareRouteEdit({
    snapshot,
    flow,
    nodeId,
    field: 'DEFAULT_TARGET_TYPE',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows[0].row.DEFAULT_TARGET_TYPE, 'disconnect');
});

const entryNode = (row) => ({
  id: 'in:+331',
  tableId: 'in',
  tableName: 'W_INBOUND_CALL_v5',
  key: '+331',
  type: 'inboundcall',
  row: { key: '+331', DESCRIPTION: 'Accueil', LANGUAGE: 'fr-fr', ...row },
});
const shown = (node, key) => String(node.row[key] ?? '').replace(/^tts:/i, '');

test('saving another setting never rewrites a message the user did not touch', () => {
  for (const audio of ['TTS:Bonjour', 'tts:', 'Tts:Bonjour à tous']) {
    const node = entryNode({ WELCOME_AUDIO: audio });
    const row = prepareStepDraft({
      node,
      visibleValues: { DESCRIPTION: 'Accueil Paris', WELCOME_AUDIO: shown(node, 'WELCOME_AUDIO') },
    });
    assert.equal(row.WELCOME_AUDIO, audio);
    assert.equal(row.DESCRIPTION, 'Accueil Paris');
  }
  const node = entryNode({ WELCOME_AUDIO: 'TTS:Bonjour' });
  assert.equal(
    prepareStepDraft({ node, pending: { WELCOME_AUDIO: 'Bonsoir' } }).WELCOME_AUDIO,
    'tts:Bonsoir',
  );
});

test('a dynamic value in a numeric control does not block saving the rest of the step', () => {
  const schema = {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string' },
      DESCRIPTION: { type: 'string' },
      QUEUE: { type: 'string' },
      PRIORITY: { type: 'string' },
    },
  };
  const node = {
    id: 'svc:S',
    tableId: 'svc',
    tableName: 'W_SERVICES_v5',
    key: 'S',
    type: 'service',
    schema,
    row: { key: 'S', DESCRIPTION: 'Équipe', QUEUE: 'Q1', PRIORITY: '$var:PRIO$' },
  };
  const priority = businessFields(node).find((field) => field.key === 'PRIORITY');
  assert.equal(priority.kind, 'number');
  // A number input cannot display "$var:PRIO$": the browser reports an empty value for it.
  const row = prepareStepDraft({
    node,
    schema,
    snapshot: { tables: [] },
    visibleValues: { DESCRIPTION: 'Équipe sinistres', PRIORITY: '' },
  });
  assert.equal(row.PRIORITY, '$var:PRIO$');
  assert.equal(row.DESCRIPTION, 'Équipe sinistres');
  assert.throws(
    () =>
      prepareStepDraft({ node, schema, snapshot: { tables: [] }, pending: { PRIORITY: 'abc' } }),
    /nombre valide/,
  );
});

test('re-selecting "Message enregistré" on a compound or dynamic message changes nothing', () => {
  for (const value of ['pr:Bienvenue|tts:Bonjour $var:NOM$', 'var:MESSAGE', '$var:P$']) {
    assert.equal(audioModeEdit(value, undefined, 'recorded'), undefined, value);
    // After typing a replacement text, the same button opens an empty prompt choice.
    assert.deepEqual(audioModeEdit(value, 'texte saisi', 'recorded'), { resource: '' }, value);
  }
  assert.deepEqual(audioModeEdit('pr:Accueil', undefined, 'recorded'), { resource: 'pr:Accueil' });
  assert.deepEqual(audioModeEdit('tts:Bonjour', 'Bonjour', 'recorded'), { resource: '' });
  assert.deepEqual(audioModeEdit('', undefined, 'recorded'), { resource: '' });
});

test('the label of a read-only setting points to an element that exists', () => {
  const html = stepFieldView(
    {
      key: 'MENU_AUDIO',
      label: 'Annonce du menu',
      editable: false,
      display: 'Message enregistré · Choix',
      value: 'pr:Choix',
    },
    3,
    { node: { row: {} } },
  );
  const target = html.match(/<label for="([^"]+)"/)[1];
  assert.match(html, new RegExp(`<output[^>]* id="${target}"`));
});
