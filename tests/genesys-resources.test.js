import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadResourceCatalogue,
  resourceForField,
  resourceOptions,
  resourceCatalogues,
} from '../src/genesys-resources.js';
import { prepareStepDraft } from '../src/step-draft.js';
import { businessFields } from '../src/business.js';
import { businessInspectorModel } from '../src/journey-audience.js';
import { resourceEditor, audioModeEdit } from '../src/resource-editor.js';

const node = (row) => ({
  id: 'service:x',
  key: 'Distribution Auto',
  name: 'Distribution Auto',
  type: 'service',
  tableName: 'W_SERVICES_v5',
  row: { key: 'Distribution Auto', ...row },
});
const entity = (name, id = name) => ({ name, id });
const response = (payload) => ({ ok: true, json: async () => payload });

test('all catalogues stay on their fixed GET endpoint and retrieve every page', async () => {
  for (const [kind, spec] of Object.entries(resourceCatalogues)) {
    const calls = [];
    const result = await loadResourceCatalogue(kind, 'secret', {
      fetchImpl: async (url, opts) => {
        calls.push({ url, opts });
        const page = Number(new URL(url).searchParams.get('pageNumber'));
        return response({
          entities: [entity('Item ' + page)],
          pageNumber: page,
          pageCount: 2,
          nextUri: 'https://invalid.example/steal',
        });
      },
    });
    assert.equal(result.length, 2);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.opts.method, 'GET');
      assert.equal(new URL(call.url).origin, 'https://api.mypurecloud.ie');
      assert.equal(new URL(call.url).pathname, '/api/v2' + spec.path);
      assert.equal(call.opts.redirect, 'error');
      assert.ok(!call.url.includes('secret'));
    }
  }
});

test('bad pages, denied access and rate limits never become empty success or leak a token', async () => {
  for (const status of [401, 403, 429])
    await assert.rejects(
      loadResourceCatalogue('queues', 'hidden', { fetchImpl: async () => ({ ok: false, status }) }),
      (error) => !error.message.includes('hidden'),
    );
  await assert.rejects(
    loadResourceCatalogue('queues', 'hidden', {
      fetchImpl: async () => response({ entities: [], pageCount: 2 }),
    }),
    /incomplet/,
  );
  await assert.rejects(
    loadResourceCatalogue('queues', 'hidden', {
      fetchImpl: async () => response({ entities: [entity('x')], pageNumber: 9 }),
    }),
    /incohérente/,
  );
  await assert.rejects(loadResourceCatalogue('../users', 'hidden'), /inconnu/);
});

test('V5 resources are distinguished from internal WOLF identities and V4', () => {
  for (const key of [
    'DIVISION',
    'QUEUE',
    'CALLBACK_QUEUE',
    'SKILLS',
    'LANGUAGE_SKILL',
    'DIRECT_USER',
    'SCHEDULE_GROUP',
    'EMERGENCY_GROUP',
    'SCHEDULEGROUP_FOR_CALLBACK',
    'SCRIPT',
    'FLOW_NAME',
    'ID_BOT',
    'WELCOME_AUDIO',
    'INQUEUE_HOLD_MUSIC_1',
  ])
    assert.ok(resourceForField(key, node({})));
  for (const key of ['key', 'SERVICE', 'SCHEDULE_GROUP_KEY', 'INQUEUE_MENU_1'])
    assert.equal(resourceForField(key, node({})), null);
  assert.equal(resourceForField('QUEUE', { tableName: 'W_DISTRIBUTION_v4' }), null);
});

test('resource selections save exact WOLF names, skills and prompt encoding without touching source', () => {
  const step = node({
    DESCRIPTION: '',
    QUEUE: 'variable',
    SKILLS: '',
    LANGUAGE_SKILL: '',
    SCHEDULE_GROUP: '',
    EMERGENCY_GROUP: '',
    WELCOME_AUDIO: 'tts:Bonjour',
    INQUEUE_HOLD_MUSIC_INIT: 'OLD',
    SCRIPT: '',
    FLOW_NAME: '',
  });
  const original = structuredClone(step);
  const catalogues = {
    queues: [entity('Q Auto')],
    skills: [entity('Auto'), entity('Sinistre')],
    schedules: [entity('Ouverture')],
    emergencies: [entity('Crise')],
    prompts: [entity('Accueil')],
    flows: [{ ...entity('Transfert'), published: true }],
    scripts: [entity('Conseiller')],
  };
  const pending = Object.fromEntries(
    Object.entries({
      QUEUE: 'Q Auto',
      SKILLS: 'Auto;Sinistre',
      SCHEDULE_GROUP: 'Ouverture',
      EMERGENCY_GROUP: 'Crise',
      WELCOME_AUDIO: 'pr:Accueil',
      INQUEUE_HOLD_MUSIC_INIT: 'Accueil',
      SCRIPT: 'Conseiller',
      FLOW_NAME: 'Transfert',
    }).map(([key, resource]) => [key, { resource }]),
  );
  const row = prepareStepDraft({
    node: step,
    catalogues,
    pending,
    visibleValues: { DESCRIPTION: 'Distribution Auto' },
  });
  for (const [key, input] of Object.entries(pending)) assert.equal(row[key], input.resource);
  assert.equal(row.DESCRIPTION, '');
  assert.equal(row.key, 'Distribution Auto');
  assert.deepEqual(step, original);
  assert.throws(
    () => prepareStepDraft({ node: step, catalogues, pending: { QUEUE: { resource: 'unknown' } } }),
    /disponible/,
  );
  assert.throws(
    () =>
      prepareStepDraft({ node: step, catalogues, pending: { SKILLS: { resource: 'Auto;Auto' } } }),
    /distinctes/,
  );
  assert.throws(
    () => prepareStepDraft({ node: step, catalogues, pending: { key: { resource: 'Q Auto' } } }),
    /ne peut pas/,
  );
});

test('recorded and compound messages are preserved until an explicit prompt or TTS edit', () => {
  const step = node({ WELCOME_AUDIO: 'tts:Bonjour|var:CLIENT|pr:Old' });
  const field = businessFields(step).find((f) => f.key === 'WELCOME_AUDIO');
  const html = resourceEditor(field, 0, { node: step, connected: false });
  assert.doesNotMatch(
    html,
    /<textarea/,
    'compound content must not become a plain TTS input during no-op save',
  );
  assert.match(html, /Texte à lire \(TTS\)/);
  assert.equal(prepareStepDraft({ node: step }).WELCOME_AUDIO, step.row.WELCOME_AUDIO);
  assert.equal(
    prepareStepDraft({ node: step, pending: { WELCOME_AUDIO: 'Texte neuf' } }).WELCOME_AUDIO,
    'tts:Texte neuf',
  );
  assert.equal(
    prepareStepDraft({
      node: step,
      pending: { WELCOME_AUDIO: { resource: 'pr:New' } },
      catalogues: { prompts: [entity('New')] },
    }).WELCOME_AUDIO,
    'pr:New',
  );
  assert.throws(
    () => prepareStepDraft({ node: step, pending: { WELCOME_AUDIO: { resource: 'pr:New' } } }),
    /disponible/,
  );
});

test('ambiguous names and unpublished flows cannot be selected', () => {
  const step = node({ QUEUE: 'old', FLOW_NAME: '' });
  const queue = businessFields(step).find((f) => f.key === 'QUEUE');
  assert.ok(
    resourceOptions(queue, step, [entity('Same', '1'), entity('Same', '2')]).every(
      (o) => o.disabled,
    ),
  );
  const flow = businessFields(step).find((f) => f.key === 'FLOW_NAME');
  assert.deepEqual(resourceOptions(flow, step, [entity('draft')]), []);
});

test('waiting phases follow numeric chronology regardless of source property order', () => {
  const step = node({
    INQUEUE_HOLD_TIMEOUT_2: 2,
    INQUEUE_HOLD_TIMEOUT_1: 1,
    INQUEUE_HOLD_TIMEOUT_4: 4,
    INQUEUE_HOLD_TIMEOUT_3: 3,
    INQUEUE_REPEAT: 0,
    INQUEUE_HOLD_TIMEOUT_INIT: 0,
    DESCRIPTION: '',
  });
  const model = businessInspectorModel(step);
  assert.equal(model.groups[0].id, 'name');
  assert.deepEqual(
    model.groups.find((g) => g.id === 'waiting').fields.map((f) => f.key),
    [
      'INQUEUE_HOLD_TIMEOUT_INIT',
      'INQUEUE_HOLD_TIMEOUT_1',
      'INQUEUE_HOLD_TIMEOUT_2',
      'INQUEUE_HOLD_TIMEOUT_3',
      'INQUEUE_HOLD_TIMEOUT_4',
      'INQUEUE_REPEAT',
    ],
  );
  const name = model.fields.find((f) => f.key === 'DESCRIPTION');
  assert.equal(name.editorValue, 'Distribution Auto');
  assert.equal(
    prepareStepDraft({ node: step, visibleValues: { DESCRIPTION: 'Nouveau nom' } }).DESCRIPTION,
    'Nouveau nom',
  );
});

test('resource editor exposes escaped choices, connection and denial states', () => {
  const step = node({ QUEUE: 'Old' }),
    field = businessFields(step)[0];
  const html = resourceEditor(field, 0, {
    node: step,
    state: { status: 'ready', entities: [entity('<Queue>')] },
    connected: true,
  });
  assert.match(html, /&lt;Queue&gt;/);
  assert.match(html, /data-resource-field="QUEUE"/);
  assert.match(html, /Actualiser la liste/);
  assert.match(resourceEditor(field, 0, { node: step, connected: false }), /Connectez-vous/);
  assert.match(
    resourceEditor(field, 0, {
      node: step,
      connected: true,
      state: { status: 'error', error: 'Accès refusé' },
    }),
    /Accès refusé/,
  );
});

test('bots accept a published Genesys flow ID or an explicit external ID without guessing the provider', () => {
  const step = { ...node({ ID_BOT: 'external-existing' }), tableName: 'W_BOT_v5' };
  const catalogues = {
    bots: [
      { id: 'genesys-id', name: 'Assistance', published: true },
      { id: 'draft-id', name: 'Draft', published: false },
    ],
  };
  assert.equal(prepareStepDraft({ node: step }).ID_BOT, 'external-existing');
  assert.equal(
    prepareStepDraft({ node: step, catalogues, pending: { ID_BOT: { resource: 'genesys-id' } } })
      .ID_BOT,
    'genesys-id',
  );
  assert.equal(
    prepareStepDraft({ node: step, pending: { ID_BOT: { external: 'provider:bot-42' } } }).ID_BOT,
    'provider:bot-42',
  );
  assert.throws(
    () =>
      prepareStepDraft({ node: step, catalogues, pending: { ID_BOT: { resource: 'draft-id' } } }),
    /disponible/,
  );
  assert.throws(
    () => prepareStepDraft({ node: step, pending: { ID_BOT: { external: '' } } }),
    /identifiant/,
  );
  assert.throws(
    () =>
      prepareStepDraft({
        node: node({ QUEUE: 'Old' }),
        pending: { QUEUE: { external: 'unvalidated' } },
      }),
    /ne peut pas/,
  );
});

test('recorded audio can switch back to editable TTS and save without a catalogue', () => {
  for (const saved of ['pr:Old', '', null, 'tts:Bonjour|var:CLIENT']) {
    const step = node({ WELCOME_AUDIO: saved }),
      field = businessFields(step).find((f) => f.key === 'WELCOME_AUDIO');
    let pending = { WELCOME_AUDIO: { resource: 'pr:New' } };
    let html = resourceEditor(field, 0, { node: step, pending });
    assert.doesNotMatch(html, /<textarea/);
    pending.WELCOME_AUDIO = audioModeEdit(saved, pending.WELCOME_AUDIO, 'tts');
    html = resourceEditor(field, 0, { node: step, pending });
    assert.match(html, /<textarea[^>]+data-field="WELCOME_AUDIO"/);
    assert.doesNotMatch(html, /<select/, 'the hidden prompt cannot override the TTS');
    pending.WELCOME_AUDIO = 'Votre conseiller arrive';
    assert.equal(
      prepareStepDraft({
        node: step,
        schema: { properties: { WELCOME_AUDIO: { type: ['string', 'null'] } } },
        pending,
      }).WELCOME_AUDIO,
      'tts:Votre conseiller arrive',
    );
    const recorded = audioModeEdit(saved, pending.WELCOME_AUDIO, 'recorded');
    assert.equal(typeof recorded.resource, 'string');
    assert.equal(
      prepareStepDraft({
        node: step,
        schema: { properties: { WELCOME_AUDIO: { type: ['string', 'null'] } } },
        pending: { WELCOME_AUDIO: { resource: 'pr:New' } },
        catalogues: { prompts: [entity('New')] },
      }).WELCOME_AUDIO,
      'pr:New',
    );
    assert.equal(step.row.WELCOME_AUDIO, saved);
  }
  assert.equal(audioModeEdit('tts:Initial', 'Texte en cours', 'tts'), 'Texte en cours');
});

test('opening an empty nullable audio field does not replace null on an unchanged save', () => {
  const step = node({ WELCOME_AUDIO: null });
  const schema = { properties: { WELCOME_AUDIO: { type: ['string', 'null'] } } };
  assert.equal(
    prepareStepDraft({ node: step, schema, visibleValues: { WELCOME_AUDIO: '' } }).WELCOME_AUDIO,
    null,
  );
  assert.equal(
    prepareStepDraft({ node: step, schema, pending: { WELCOME_AUDIO: 'Bienvenue' } }).WELCOME_AUDIO,
    'tts:Bienvenue',
  );
});

test('divisions retrieve all pages, sort naturally and use exact names for WOLF', async () => {
  const pages = [
    ['Équipe 10', 'Assistance'],
    ['équipe 2', 'France'],
  ];
  const divisions = await loadResourceCatalogue('divisions', 'test-token', {
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/api/v2/authorization/divisions');
      const page = Number(parsed.searchParams.get('pageNumber'));
      return response({
        entities: pages[page - 1].map((name) => entity(name)),
        pageNumber: page,
        pageCount: 2,
      });
    },
  });
  assert.deepEqual(
    divisions.map((item) => item.name),
    ['Assistance', 'équipe 2', 'Équipe 10', 'France'],
  );
  assert.deepEqual(
    resourceOptions({ key: 'DIVISION' }, { tableName: 'W_INBOUND_CALL_v5' }, divisions).map(
      (item) => item.value,
    ),
    divisions.map((item) => item.name),
  );
  await assert.rejects(
    loadResourceCatalogue('divisions', 'test-token', {
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }),
    /authorization:division:view/,
  );
});
