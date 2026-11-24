import test from 'node:test';
import assert from 'node:assert/strict';
import { flowWizardView } from '../src/flow-wizard-view.js';

const field = (key, schema = { type: 'string' }) => ({ key, schema });
const options = {
  available: true,
  directAvailable: true,
  menuAvailable: true,
  scheduleAvailable: true,
  menuDigits: ['0', '1', '2'],
  catalogue: [
    {
      type: 'inboundcall',
      available: true,
      tableName: 'W_INBOUND_CALL_v5',
      divisionSchema: { type: 'string' },
      fields: [
        field('WELCOME_AUDIO'),
        field('LANGUAGE', { type: 'string', enum: ['fr-fr', 'en-us'], default: 'fr-fr' }),
      ],
    },
    {
      type: 'menu',
      available: true,
      tableName: 'W_MENU_v5',
      fields: [field('MENU_AUDIO'), field('MENU_TIMEOUT')],
    },
    {
      type: 'service',
      available: true,
      tableName: 'W_SERVICES_v5',
      fields: [field('QUEUE'), field('PRIORITY')],
    },
    {
      type: 'schedulegroup',
      available: true,
      tableName: 'W_SCHEDULE_GROUP_v5',
      fields: [field('SCHEDULE_GROUP')],
    },
  ],
};
const form = {
  name: 'Accueil <France>',
  phone: '+33123456789',
  welcomeValues: { WELCOME_AUDIO: 'tts:Bonjour <client>' },
  routing: 'menu',
  menuAudio: 'tts:Pour une aide, tapez 1',
  menuTimeout: 5,
  choices: [
    { digit: '1', label: 'Sinistres', queue: 'Q Sinistres', priority: 0 },
    { digit: '2', label: 'Assistance', queue: 'Q Assistance', priority: 2 },
  ],
};
const button = (html, action) =>
  html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] || '';
test('identity puts name first and keeps provisioning distinct from WOLF creation', () => {
  const html = flowWizardView({ options, form });
  assert.ok(html.indexOf('data-field="name"') < html.indexOf('data-field="phone"'));
  assert.match(html, /data-field="division"/);
  assert.match(html, /raccordement téléphonique se configure dans Genesys/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Accueil &lt;France&gt;/);
  assert.doesNotMatch(html, /Accueil <France>/);
});
test('welcome supports both TTS and actual named prompts without a fake catalogue', () => {
  let html = flowWizardView({ step: 1, options, form });
  assert.match(
    html,
    /name="wizard-welcome" data-field="WELCOME_AUDIO" data-value-type="audio-tts"/,
  );
  assert.match(html, /Bonjour &lt;client&gt;/);
  assert.match(html, /data-mode="recorded"/);
  assert.match(html, /<option value="fr-fr" selected/);
  html = flowWizardView({
    step: 1,
    options,
    form: {
      ...form,
      welcomeValues: { WELCOME_AUDIO: 'pr:Accueil' },
      audioModes: { WELCOME_AUDIO: 'recorded' },
    },
    connected: true,
    resourceStates: { prompts: { status: 'ready', entities: [{ id: 'uuid-a', name: 'Accueil' }] } },
  });
  assert.match(html, /<option value="pr:Accueil" selected/);
  assert.doesNotMatch(html, /uuid-a/);
  assert.match(html, /data-mode="tts"/);
});
test('routing exposes per-choice identifiers, schema timeout and all fallback behavior', () => {
  const html = flowWizardView({
    step: 2,
    options,
    form: { ...form, scheduleEnabled: true, scheduleGroup: 'France' },
    connected: true,
  });
  assert.match(
    html,
    /name="wizard-choice" data-field="digit" data-value-type="string" data-index="0"/,
  );
  assert.match(html, /data-action="wizard-remove-choice"[^>]*disabled/);
  assert.match(html, /data-field="menuTimeout"/);
  assert.match(html, /<option value="5" selected\s*>5 secondes/);
  assert.match(
    html,
    /name="wizard-field" data-field="menuAudio" data-value-type="audio-tts"[^>]*required/,
  );
  assert.match(html, /Sans choix valide, l’appel se termine/);
  assert.match(html, /en urgence : terminer l’appel/);
  const noTimeout = {
    ...options,
    catalogue: options.catalogue.map((e) =>
      e.type === 'menu' ? { ...e, fields: e.fields.filter((f) => f.key !== 'MENU_TIMEOUT') } : e,
    ),
  };
  assert.doesNotMatch(
    flowWizardView({ step: 2, options: noTimeout, form }),
    /data-field="menuTimeout"/,
  );
});
test('team selectors preserve distinct choices, reject ambiguous resource names and show failures', () => {
  const html = flowWizardView({
    step: 3,
    options,
    form,
    connected: true,
    resourceStates: {
      queues: {
        status: 'ready',
        entities: [
          { id: '1', name: 'Q Sinistres' },
          { id: '2', name: 'Ambiguë' },
          { id: '3', name: 'Ambiguë' },
        ],
      },
    },
  });
  assert.match(html, /data-field="queue" data-value-type="string" data-index="0"/);
  assert.match(html, /data-field="queue" data-value-type="string" data-index="1"/);
  assert.match(html, /<option value="Ambiguë"[^>]*disabled/);
  assert.match(html, /value="0"/);
  const failed = flowWizardView({
    step: 3,
    options,
    form,
    connected: true,
    resourceStates: { queues: { status: 'error', error: 'Accès refusé' } },
  });
  assert.match(failed, /Accès refusé/);
  assert.match(failed, /<select[^>]*data-field="queue"[^>]*disabled/);
  assert.match(failed, /data-action="wizard-resource-load"/);
  assert.doesNotMatch(failed, /<input[^>]*data-field="queue"/);
});
test('review never offers apply for invalid plan and states separate publication', () => {
  let html = flowWizardView({
    step: 4,
    options,
    form,
    plan: { ok: false, errors: [{ message: 'File manquante' }] },
  });
  assert.match(html, /File manquante/);
  assert.equal(button(html, 'wizard-apply'), '');
  assert.ok(button(html, 'wizard-review'));
  html = flowWizardView({
    step: 4,
    options,
    form,
    plan: {
      ok: true,
      createdRows: [
        { tableName: 'W_INBOUND_CALL_v5', row: { key: form.phone, DESCRIPTION: form.name } },
      ],
      summary: { notices: [] },
    },
  });
  assert.ok(button(html, 'wizard-apply'));
  assert.match(html, /Mes changements/);
  assert.match(html, /W_INBOUND_CALL_v5/);
  assert.match(html, /Accueil &lt;France&gt;/);
});
test('unavailable tables disable progression and explain why', () => {
  const html = flowWizardView({
    options: { available: false, reason: 'Schéma V5 inaccessible' },
    form,
  });
  assert.match(html, /Schéma V5 inaccessible/);
  assert.match(button(html, 'wizard-next'), /disabled/);
});
test('waiting duration is shown only when supplied by the V5 schema and retains zero', () => {
  const withWait = {
    ...options,
    catalogue: options.catalogue.map((e) =>
      e.type === 'service'
        ? {
            ...e,
            fields: [
              ...e.fields,
              { key: 'INQUEUE_HOLD_TIMEOUT_INIT', schema: { type: 'integer', default: 10 } },
            ],
          }
        : e,
    ),
  };
  const html = flowWizardView({ step: 3, options: withWait, form: { ...form, waitSeconds: 0 } });
  assert.match(html, /data-field="waitSeconds"[^>]*type="number"[^>]*value="0"[^>]*min="0"/);
  assert.match(html, /suite dépend du cycle d’attente/);
  assert.doesNotMatch(flowWizardView({ step: 3, options, form }), /data-field="waitSeconds"/);
});
test('review shows actual messages, language, queue priorities and schema-derived timing', () => {
  const plan = {
    ok: true,
    createdRows: [
      {
        tableName: 'W_INBOUND_CALL_v5',
        row: { WELCOME_AUDIO: 'pr:Bienvenue <France>', LANGUAGE: 'fr-fr' },
      },
      { tableName: 'W_MENU_v5', row: { MENU_AUDIO: 'tts:Pour <aide>, tapez 1.', MENU_TIMEOUT: 7 } },
      {
        tableName: 'W_SERVICES_v5',
        row: { QUEUE: 'Q Sinistres', PRIORITY: 0, INQUEUE_HOLD_TIMEOUT_INIT: 10 },
      },
      {
        tableName: 'W_SERVICES_v5',
        row: { QUEUE: 'Q Assistance', PRIORITY: 2, INQUEUE_HOLD_TIMEOUT_INIT: 10 },
      },
    ],
    summary: { notices: [] },
  };
  const html = flowWizardView({ step: 4, options, form, plan });
  assert.match(html, /Message enregistré : Bienvenue &lt;France&gt;/);
  assert.match(html, /Texte à lire : Pour &lt;aide&gt;, tapez 1\./);
  assert.match(html, /<dd>fr-fr<\/dd>/);
  assert.match(html, /<dd>7 secondes<\/dd>/);
  assert.match(html, /Q Sinistres · priorité 0/);
  assert.match(html, /Q Assistance · priorité 2/);
  assert.match(html, /<dd>10 secondes<\/dd>/);
});

test('wizard identity uses the Genesys divisions catalogue and never a free text field', () => {
  const html = flowWizardView({
    options,
    form: { ...form, division: 'France' },
    connected: true,
    resourceStates: {
      divisions: { status: 'ready', entities: [{ id: 'division-id', name: 'France' }] },
    },
  });
  assert.match(html, /<select[^>]*data-field="division"/);
  assert.match(html, /<option value="France" selected/);
  assert.doesNotMatch(html, /division-id|<input[^>]*data-field="division"/);
  const loading = flowWizardView({
    options,
    form,
    connected: true,
    resourceStates: { divisions: { status: 'loading' } },
  });
  assert.match(loading, /Chargement de la liste Genesys/);
  assert.match(loading, /<select[^>]*data-field="division"[^>]*disabled/);
});
