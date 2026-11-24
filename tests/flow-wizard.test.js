import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import { prepareFlowWizard, wizardOptions } from '../src/flow-wizard.js';
import { applyDesignerDraft } from '../src/designer-draft.js';
import { publicationRows } from '../src/publication.js';

function fixture() {
  const inventory = JSON.parse(
    fs.readFileSync(new URL('../INVENTAIRE_DATATABLES_VOIX.json', import.meta.url)),
  );
  return normalizeSnapshot({
    tables: inventory.tables
      .filter((t) => /_v5$/i.test(t.name))
      .map((t) => ({
        id: t.name,
        name: t.name,
        rows: [],
        schema: {
          required: t.required,
          properties: Object.fromEntries(t.columns.map((c) => [c.name, c.schema])),
        },
      })),
  });
}
const base = () => ({
  name: 'Accueil agence',
  phone: '+33123456789',
  division: 'CR',
  welcomeValues: { WELCOME_AUDIO: 'tts:Bonjour', LANGUAGE: 'fr-fr' },
  routing: 'direct',
  queue: 'Q Clients',
  priority: '3',
});
test('wizard refuses to create a flow without a division', () => {
  for (const division of [undefined, '', '   ']) {
    const plan = prepareFlowWizard({ snapshot: fixture(), form: { ...base(), division } });
    assert.equal(plan.ok, false);
    assert.ok(plan.errors.some((e) => /division Genesys/.test(e.message)));
  }
});
const menu = () => ({
  ...base(),
  routing: 'menu',
  menuTimeout: 5,
  menuAudio: 'tts:Pour un sinistre, tapez 1. Pour votre contrat, tapez 2.',
  choices: [
    { digit: '1', label: 'Sinistres', queue: 'Q Sinistres', priority: '5' },
    { digit: '2', label: 'Contrats', queue: 'Q Contrats', priority: '' },
  ],
});
test('wizard builds a complete direct route with schema defaults and atomic creation mappings', () => {
  const snapshot = fixture(),
    before = JSON.stringify(snapshot),
    form = base(),
    plan = prepareFlowWizard({ snapshot, form });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.createdRows.length, 2);
  assert.deepEqual(plan.updatedRows, []);
  const entry = plan.createdRows.find((row) => row.tableName === 'W_INBOUND_CALL_v5').row,
    service = plan.createdRows.find((row) => row.tableName === 'W_SERVICES_v5').row;
  assert.equal(entry.NEXT_TARGET_TYPE, 'service');
  assert.equal(entry.NEXT_TARGET, service.key);
  assert.equal(entry.WELCOME_AUDIO, 'tts:Bonjour');
  assert.equal(service.QUEUE, 'Q Clients');
  assert.equal(service.PRIORITY, '3');
  assert.equal(service.INQUEUE_TARGET_TYPE, 'disconnect');
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(form, base());
  const applied = applyDesignerDraft({ snapshot, plan });
  assert.equal(applied.flow.nodes.length, 2);
  assert.equal(applied.drafts.size, 0);
  const rows = publicationRows(
    applied.snapshot,
    applied.drafts,
    new Map([[plan.flowId, { mappings: plan.mappings }]]),
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.kind === 'create' && row.before === null));
});
test('menu and calendar routes resolve every created step and keep independent branches', () => {
  const snapshot = fixture(),
    plan = prepareFlowWizard({
      snapshot,
      form: { ...menu(), scheduleEnabled: true, scheduleGroup: 'Horaires France' },
    });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.createdRows.length, 5);
  const flow = buildVoiceInventory(plan.snapshot).flows.find((flow) => flow.id === plan.flowId);
  assert.equal(flow.nodes.length, 5);
  assert.ok(flow.edges.every((edge) => edge.resolved || edge.dynamic));
  const row = (type) => flow.nodes.find((node) => node.type === type).row;
  assert.equal(row('inboundcall').NEXT_TARGET_TYPE, 'schedulegroup');
  assert.equal(row('schedulegroup').OPEN_TARGET_TYPE, 'menu');
  assert.equal(row('schedulegroup').CLOSED_TARGET_TYPE, 'disconnect');
  assert.equal(row('menu').DEFAULT_TARGET_TYPE, 'disconnect');
  assert.equal(row('menu').MENU_TIMEOUT, 5);
  assert.notEqual(row('menu').OPTION1_TARGET, row('menu').OPTION2_TARGET);
  assert.equal(
    flow.nodes.find((node) => node.key === row('menu').OPTION1_TARGET).row.QUEUE,
    'Q Sinistres',
  );
  assert.equal(
    flow.nodes.find((node) => node.key === row('menu').OPTION2_TARGET).row.QUEUE,
    'Q Contrats',
  );
  assert.equal(plan.mappings.length, 5);
  assert.ok(plan.summary.notices.some((message) => message.includes('congés')));
});
test('invalid choices and partial input fail atomically without a draft snapshot', () => {
  const snapshot = fixture(),
    before = JSON.stringify(snapshot);
  for (const form of [
    { ...base(), queue: '' },
    { ...base(), queue: 'variable' },
    { ...base(), routing: 'bot' },
    { ...menu(), menuTimeout: 0 },
    { ...menu(), menuTimeout: undefined },
    { ...menu(), menuAudio: '' },
    { ...menu(), choices: [menu().choices[0]] },
    { ...menu(), choices: menu().choices.map((choice) => ({ ...choice, digit: '1' })) },
    { ...menu(), choices: [{ ...menu().choices[0], digit: 'X' }, menu().choices[1]] },
    { ...menu(), choices: [{ ...menu().choices[0], queue: '' }, menu().choices[1]] },
    { ...menu(), choices: [{ ...menu().choices[0], label: '' }, menu().choices[1]] },
    { ...base(), scheduleEnabled: true, scheduleGroup: '' },
    { ...base(), welcomeValues: { INVENTED: 'x' } },
  ]) {
    const plan = prepareFlowWizard({ snapshot, form });
    assert.equal(plan.ok, false, JSON.stringify(form));
    assert.equal(plan.snapshot, null);
    assert.equal(plan.createdRows.length, 0);
  }
  assert.equal(JSON.stringify(snapshot), before);
});
test('availability follows loaded schemas and missing required values are not fabricated', () => {
  const snapshot = structuredClone(fixture()),
    entry = snapshot.tables.find((table) => table.name === 'W_INBOUND_CALL_v5');
  assert.equal(wizardOptions(snapshot).available, true);
  assert.equal(wizardOptions(snapshot).menuAvailable, true);
  const calendar = snapshot.tables.find((table) => table.name === 'W_SCHEDULE_GROUP_v5');
  delete calendar.schema.properties.OPEN_TARGET_TYPE;
  assert.equal(wizardOptions(snapshot).scheduleAvailable, false);
  assert.equal(
    prepareFlowWizard({
      snapshot,
      form: { ...base(), scheduleEnabled: true, scheduleGroup: 'Horaires' },
    }).ok,
    false,
  );
  entry.schema.required.push('CUSTOM_REQUIRED');
  entry.schema.properties.CUSTOM_REQUIRED = { type: 'string' };
  const plan = prepareFlowWizard({ snapshot, form: base() });
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0].message, /obligatoire/);
  assert.equal(
    prepareFlowWizard({
      snapshot,
      form: { ...base(), welcomeValues: { CUSTOM_REQUIRED: 'confirmed' } },
    }).ok,
    true,
  );
});
test('wizard never modifies an existing row and generated keys are deterministic and unique', () => {
  const source = structuredClone(fixture()),
    services = source.tables.find((table) => table.name === 'W_SERVICES_v5');
  services.rows.push({
    key: 'WZ_33123456789_EQUIPE',
    DESCRIPTION: 'Existing',
    QUEUE: 'Q Other',
    INQUEUE_TARGET_TYPE: 'disconnect',
    INQUEUE_TARGET: '',
  });
  const snapshot = normalizeSnapshot(source),
    plan = prepareFlowWizard({ snapshot, form: base() }),
    again = prepareFlowWizard({ snapshot, form: base() });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan, again);
  assert.equal(
    plan.createdRows.find((row) => row.tableName === 'W_SERVICES_v5').row.key,
    'WZ_33123456789_EQUIPE_2',
  );
  assert.deepEqual(
    plan.snapshot.tables.find((table) => table.id === services.id).rows[0],
    snapshot.tables.find((table) => table.id === services.id).rows[0],
  );
  const duplicate = prepareFlowWizard({ snapshot: plan.snapshot, form: base() });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0].message, /existe déjà/);
});
test('unfilled welcome controls retain actual schema defaults and explicit false is preserved', () => {
  const snapshot = structuredClone(fixture()),
    table = snapshot.tables.find((table) => table.name === 'W_INBOUND_CALL_v5');
  table.schema.properties.LANGUAGE.default = 'fr-fr';
  table.schema.properties.RECORDING_ENABLE = { type: 'boolean', default: true };
  const plan = prepareFlowWizard({
    snapshot,
    form: {
      ...base(),
      welcomeValues: { WELCOME_AUDIO: '', LANGUAGE: ' ', RECORDING_ENABLE: false },
    },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  const row = plan.createdRows.find((row) => row.tableId === table.id).row;
  assert.equal(row.LANGUAGE, 'fr-fr');
  assert.equal(row.RECORDING_ENABLE, false);
});
test('initial waiting duration is explicit, typed, applied to every team and separate from cycle duration', () => {
  const snapshot = fixture();
  for (const duration of [0, 75, '120']) {
    const plan = prepareFlowWizard({ snapshot, form: { ...menu(), waitSeconds: duration } });
    assert.equal(plan.ok, true, JSON.stringify(plan.errors));
    const rows = plan.createdRows.filter((row) => row.tableName === 'W_SERVICES_v5');
    assert.ok(rows.every(({ row }) => row.INQUEUE_HOLD_TIMEOUT_INIT === Number(duration)));
    assert.equal(plan.summary.wizard.waitSeconds, Number(duration));
    assert.ok(plan.summary.notices.some((text) => text.includes(`${duration} seconde(s)`)));
    assert.ok(plan.summary.notices.some((text) => text.includes('fin du cycle')));
  }
  const defaults = prepareFlowWizard({ snapshot, form: { ...base(), waitSeconds: '' } });
  assert.equal(
    defaults.createdRows.find((row) => row.tableName === 'W_SERVICES_v5').row
      .INQUEUE_HOLD_TIMEOUT_INIT,
    10,
  );
  for (const duration of [-1, 0.5, 'invalid', Infinity])
    assert.equal(
      prepareFlowWizard({ snapshot, form: { ...base(), waitSeconds: duration } }).ok,
      false,
    );
  const missing = structuredClone(snapshot);
  delete missing.tables.find((table) => table.name === 'W_SERVICES_v5').schema.properties
    .INQUEUE_HOLD_TIMEOUT_INIT;
  const plan = prepareFlowWizard({ snapshot: missing, form: { ...base(), waitSeconds: 80 } });
  assert.equal(plan.ok, true);
  assert.ok(
    !Object.hasOwn(
      plan.createdRows.find((row) => row.tableName === 'W_SERVICES_v5').row,
      'INQUEUE_HOLD_TIMEOUT_INIT',
    ),
  );
});
