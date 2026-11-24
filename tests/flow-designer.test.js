import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import {
  designerCatalogue,
  designerOptions,
  prepareNewFlow,
  prepareNewBlock,
  prepareRouteEdit,
} from '../src/flow-designer.js';
import { publicationRows } from '../src/publication.js';
const string = (extra = {}) => ({ type: 'string', ...extra });
const schema = (extra = {}, required = ['key']) => ({
  type: 'object',
  required,
  properties: {
    key: string(),
    DESCRIPTION: string(),
    DIVISION: string({ default: 'France' }),
    ...extra,
  },
});
function fixture() {
  const snapshot = normalizeSnapshot({
    tables: [
      {
        id: 'entry',
        name: 'W_INBOUND_CALL_v5',
        schema: schema({
          NEXT_TARGET_TYPE: string(),
          NEXT_TARGET: string(),
          DEFAULT_TARGET_TYPE: string(),
          DEFAULT_TARGET: string(),
          WELCOME_AUDIO: string({ default: '' }),
        }),
        rows: [
          {
            key: '+33100000000',
            DESCRIPTION: 'Accueil',
            DIVISION: 'France',
            NEXT_TARGET_TYPE: 'disconnect',
            NEXT_TARGET: '',
            DEFAULT_TARGET_TYPE: 'disconnect',
            DEFAULT_TARGET: '',
          },
        ],
      },
      {
        id: 'menus',
        name: 'W_MENU_v5',
        schema: schema({
          MENU_NAME: string(),
          MENU_AUDIO: string({ default: '' }),
          MENU_TIMEOUT: { type: 'integer', default: 5 },
          MENU_REPEAT: { type: 'integer', default: 0 },
          DEFAULT_TARGET_TYPE: string(),
          DEFAULT_TARGET: string(),
          OPTION1_TARGET_TYPE: string(),
          OPTION1_TARGET: string(),
        }),
        rows: [],
      },
      {
        id: 'services',
        name: 'W_SERVICES_v5',
        schema: schema({
          QUEUE: string(),
          PRIORITY: string({ default: '0' }),
          RECORDING_ENABLE: { type: 'boolean', default: false },
          INQUEUE_TARGET_TYPE: string(),
          INQUEUE_TARGET: string(),
        }),
        rows: [],
      },
    ],
  });
  return { snapshot, flow: buildVoiceInventory(snapshot).flows[0] };
}
test('division requires an explicit selection even if the DT schema declares a default', () => {
  const { snapshot } = fixture();
  assert.equal(designerCatalogue(snapshot)[0].divisionRequired, true);
  for (const division of [undefined, null, '', '   ']) {
    const plan = prepareNewFlow({ snapshot, name: 'Test', phone: '+33123456789', division });
    assert.equal(plan.ok, false);
    assert.match(plan.errors[0].message, /Choisissez une division Genesys/);
  }
  assert.equal(
    prepareNewFlow({ snapshot, name: 'Test', phone: '+33123456789', division: 'France' }).ok,
    true,
  );
});
test('catalogue is driven by actual V5 tables and refuses unavailable or ambiguous schemas', () => {
  const { snapshot } = fixture();
  const catalogue = designerCatalogue(snapshot);
  assert.equal(catalogue.find((c) => c.type === 'menu').available, true);
  assert.deepEqual(
    catalogue.find((c) => c.type === 'menu').outlets.map((o) => o.field),
    ['DEFAULT_TARGET_TYPE', 'OPTION1_TARGET_TYPE'],
  );
  assert.equal(catalogue.find((c) => c.type === 'bot').available, false);
  assert.equal(catalogue.find((c) => c.type === 'decision').available, false);
  const copy = structuredClone(snapshot);
  copy.tables.push({ ...copy.tables[1], id: 'menu-duplicate' });
  assert.equal(designerCatalogue(copy).find((c) => c.type === 'menu').available, false);
  delete copy.tables[0].schema;
  assert.equal(designerCatalogue(copy)[0].available, false);
});
test('new numbered flow is isolated, named, schema typed and starts with explicit end-call exits', () => {
  const { snapshot } = fixture(),
    before = JSON.stringify(snapshot),
    plan = prepareNewFlow({
      snapshot,
      name: 'Nouveau parcours',
      phone: '+33123456789',
      division: 'Agence',
    });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.flowId, 'entry:+33123456789');
  assert.equal(plan.createdRows[0].row.DESCRIPTION, 'Nouveau parcours');
  assert.equal(plan.createdRows[0].row.DIVISION, 'Agence');
  assert.equal(plan.createdRows[0].row.NEXT_TARGET_TYPE, 'disconnect');
  assert.equal(buildVoiceInventory(plan.snapshot).flows.length, 2);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(prepareNewFlow({ snapshot, name: 'Copie', phone: '+33100000000' }).ok, false);
  assert.equal(prepareNewFlow({ snapshot, name: 'X', phone: '0123456789' }).ok, false);
  const publication = publicationRows(
    plan.snapshot,
    new Map(),
    new Map([[plan.flowId, { mappings: plan.mappings }]]),
  );
  assert.equal(publication.length, 1);
  assert.equal(publication[0].kind, 'create');
  assert.equal(publication[0].before, null);
});
test('required unknown defaults are never fabricated, unknown fields and malformed schema values are rejected', () => {
  const { snapshot } = fixture(),
    copy = structuredClone(snapshot);
  copy.tables[0].schema.properties.ENABLED = { type: 'boolean' };
  copy.tables[0].schema.required.push('ENABLED');
  assert.match(
    prepareNewFlow({ snapshot: copy, name: 'X', phone: '+33123456789', division: 'France' })
      .errors[0].message,
    /obligatoire/,
  );
  const valid = prepareNewFlow({
    snapshot: copy,
    name: 'X',
    phone: '+33123456789',
    division: 'France',
    values: { ENABLED: false },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.createdRows[0].row.ENABLED, false);
  assert.equal(
    prepareNewFlow({ snapshot, name: 'X', phone: '+33123456789', values: { INVENTED: 'x' } }).ok,
    false,
  );
  copy.tables[0].schema.properties.key.pattern = '^\\+33';
  assert.equal(
    prepareNewFlow({ snapshot: copy, name: 'X', phone: '+44123456789', values: { ENABLED: false } })
      .ok,
    false,
  );
});
test('new block splices one chosen outlet while preserving options and contexts exactly once', () => {
  const input = fixture(),
    copy = structuredClone(input.snapshot);
  copy.tables[0].rows[0].NEXT_TARGET_TYPE = 'disconnect|lang:fr-fr';
  copy.tables[0].rows[0].NEXT_TARGET_AUDIO = 'tts:Patientez';
  copy.tables[0].schema.properties.NEXT_TARGET_AUDIO = string();
  const snapshot = normalizeSnapshot(copy),
    flow = buildVoiceInventory(snapshot).flows[0],
    placement = designerOptions({ snapshot, flow }).placements.find(
      (p) => p.field === 'NEXT_TARGET_TYPE',
    );
  const plan = prepareNewBlock({
    snapshot,
    flow,
    type: 'menu',
    name: 'Choix',
    key: 'MENU_NOUVEAU',
    placementId: placement.id,
    continuationField: 'OPTION1_TARGET_TYPE',
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  const row = plan.createdRows[0].row,
    anchor = plan.updatedRows[0].row;
  assert.equal(row.OPTION1_TARGET_TYPE, 'disconnect');
  assert.equal(row.DEFAULT_TARGET_TYPE, 'disconnect');
  assert.equal(row.MENU_REPEAT, 0);
  assert.equal(row.MENU_NAME, 'MENU_NOUVEAU');
  assert.equal(anchor.NEXT_TARGET_TYPE, 'menu|lang:fr-fr');
  assert.equal(anchor.NEXT_TARGET, 'MENU_NOUVEAU');
  assert.equal(anchor.NEXT_TARGET_AUDIO, 'tts:Patientez');
  assert.ok(
    buildVoiceInventory(plan.snapshot).flows[0].nodes.some((n) => n.id === 'menus:MENU_NOUVEAU'),
  );
  assert.equal(input.flow.nodes.length, 1);
});
test('new services require destination queue and respect STRING priority and boolean defaults', () => {
  const input = fixture(),
    placement = designerOptions(input).placements[0],
    options = {
      ...input,
      type: 'service',
      name: 'Conseillers',
      key: 'TEAM',
      placementId: placement.id,
      continuationField: 'INQUEUE_TARGET_TYPE',
    };
  assert.match(prepareNewBlock(options).errors[0].message, /File de destination/);
  const plan = prepareNewBlock({ ...options, values: { QUEUE: 'Q Clients' } });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.createdRows[0].row.PRIORITY, '0');
  assert.equal(plan.createdRows[0].row.RECORDING_ENABLE, false);
});
test('attached PDATA stays on the incoming transition, not duplicated after the inserted block', () => {
  const source = structuredClone(fixture().snapshot);
  source.tables.push({
    id: 'context',
    name: 'W_PARTICIPANT_DATA_v5',
    rows: [{ key: 'CRISE', PDATA_LIST_1: 'CRISE==ACTIF' }],
  });
  source.tables[0].rows[0].NEXT_TARGET = '|pdata:CRISE';
  const snapshot = normalizeSnapshot(source),
    flow = buildVoiceInventory(snapshot).flows[0],
    placement = designerOptions({ snapshot, flow }).placements[0];
  const plan = prepareNewBlock({
    snapshot,
    flow,
    type: 'menu',
    name: 'Choix',
    key: 'MENU',
    placementId: placement.id,
    continuationField: 'DEFAULT_TARGET_TYPE',
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows[0].row.NEXT_TARGET, 'MENU|pdata:CRISE');
  assert.equal(plan.createdRows[0].row.DEFAULT_TARGET, '');
  const projected = buildVoiceInventory(plan.snapshot).flows[0];
  assert.equal(
    projected.edges.filter((e) => e.relationship === 'context' && e.to === 'context:CRISE').length,
    1,
  );
});
test('return to waiting is offered only along actual waiting-menu paths', () => {
  const source = structuredClone(fixture().snapshot);
  source.tables[0].rows[0].NEXT_TARGET_TYPE = 'service';
  source.tables[0].rows[0].NEXT_TARGET = 'TEAM';
  source.tables[2].schema.properties.INQUEUE_MENU_1 = string();
  source.tables[2].rows.push({
    key: 'TEAM',
    DESCRIPTION: 'Équipe',
    QUEUE: 'Q Clients',
    INQUEUE_MENU_1: 'WAIT',
    INQUEUE_TARGET_TYPE: 'disconnect',
    INQUEUE_TARGET: '',
  });
  source.tables[1].rows.push({
    key: 'WAIT',
    DESCRIPTION: 'Menu attente',
    DEFAULT_TARGET_TYPE: 'disconnect',
    DEFAULT_TARGET: '',
    OPTION1_TARGET_TYPE: 'disconnect',
    OPTION1_TARGET: '',
  });
  const snapshot = normalizeSnapshot(source),
    flow = buildVoiceInventory(snapshot).flows[0],
    options = designerOptions({ snapshot, flow });
  assert.ok(options.returnAllowedNodes.includes('menus:WAIT'));
  assert.ok(!options.returnAllowedNodes.includes(flow.id));
  const plan = prepareRouteEdit({
    snapshot,
    flow,
    nodeId: 'menus:WAIT',
    field: 'OPTION1_TARGET_TYPE',
    destination: { type: 'next' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows[0].row.OPTION1_TARGET_TYPE, 'next');
  const shared = structuredClone(snapshot);
  shared.tables[0].rows[0].DEFAULT_TARGET_TYPE = 'menu';
  shared.tables[0].rows[0].DEFAULT_TARGET = 'WAIT';
  const sharedSnapshot = normalizeSnapshot(shared),
    sharedFlow = buildVoiceInventory(sharedSnapshot).flows[0];
  const sharedPlan = prepareRouteEdit({
    snapshot: sharedSnapshot,
    flow: sharedFlow,
    nodeId: 'menus:WAIT',
    field: 'OPTION1_TARGET_TYPE',
    destination: { type: 'next' },
  });
  assert.equal(sharedPlan.ok, true);
  assert.ok(sharedPlan.summary.notices.some((n) => n.includes('aussi accessible hors')));
  const continued = structuredClone(snapshot);
  continued.tables[1].rows[0].OPTION1_TARGET_TYPE = 'service';
  continued.tables[1].rows[0].OPTION1_TARGET = 'NEW_TEAM';
  continued.tables[2].rows.push({
    key: 'NEW_TEAM',
    QUEUE: 'Q Nouveau',
    INQUEUE_TARGET_TYPE: 'disconnect',
    INQUEUE_TARGET: '',
  });
  const continuedSnapshot = normalizeSnapshot(continued),
    continuedFlow = buildVoiceInventory(continuedSnapshot).flows[0];
  assert.ok(
    !designerOptions({
      snapshot: continuedSnapshot,
      flow: continuedFlow,
    }).returnAllowedNodes.includes('services:NEW_TEAM'),
  );
});
test('insertion rejects stale flow, occupied key, invalid timeout, missing continuation and unsafe block types', () => {
  const input = fixture(),
    placement = designerOptions(input).placements[0],
    options = {
      ...input,
      type: 'menu',
      name: 'Choix',
      key: 'MENU',
      placementId: placement.id,
      continuationField: 'DEFAULT_TARGET_TYPE',
    };
  assert.equal(prepareNewBlock({ ...options, continuationField: '' }).ok, false);
  assert.equal(prepareNewBlock({ ...options, values: { MENU_TIMEOUT: 6 } }).ok, false);
  assert.equal(prepareNewBlock({ ...options, type: 'inboundcall' }).ok, false);
  assert.equal(prepareNewBlock({ ...options, type: 'bot' }).ok, false);
  const stale = structuredClone(input.flow);
  stale.nodes[0].row.DESCRIPTION = 'Different';
  assert.equal(prepareNewBlock({ ...options, flow: stale }).ok, false);
  const plan = prepareNewBlock(options),
    flow = buildVoiceInventory(plan.snapshot).flows[0];
  assert.equal(prepareNewBlock({ ...options, snapshot: plan.snapshot, flow }).ok, false);
});
test('routing is explicit, stays within the selected flow and reports disconnected steps without deleting rows', () => {
  const input = fixture(),
    placement = designerOptions(input).placements[0],
    insert = prepareNewBlock({
      ...input,
      type: 'menu',
      name: 'Choix',
      key: 'MENU',
      placementId: placement.id,
      continuationField: 'DEFAULT_TARGET_TYPE',
    }),
    flow = buildVoiceInventory(insert.snapshot).flows[0];
  const plan = prepareRouteEdit({
    snapshot: insert.snapshot,
    flow,
    nodeId: flow.id,
    field: 'NEXT_TARGET_TYPE',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.createdRows.length, 0);
  assert.equal(plan.updatedRows[0].row.NEXT_TARGET_TYPE, 'disconnect');
  assert.equal(plan.snapshot.tables.find((t) => t.id === 'menus').rows.length, 1);
  assert.match(plan.summary.notices.at(-1), /plus accessibles/);
  assert.equal(
    prepareRouteEdit({
      snapshot: insert.snapshot,
      flow,
      nodeId: flow.id,
      field: 'NEXT_TARGET_TYPE',
      destination: { nodeId: 'foreign' },
    }).ok,
    false,
  );
  assert.equal(
    prepareRouteEdit({
      snapshot: insert.snapshot,
      flow,
      nodeId: flow.id,
      field: 'NEXT_TARGET_TYPE',
      destination: { type: 'next' },
    }).ok,
    false,
  );
  const loop = prepareRouteEdit({
    snapshot: insert.snapshot,
    flow,
    nodeId: 'menus:MENU',
    field: 'OPTION1_TARGET_TYPE',
    destination: { nodeId: 'menus:MENU' },
  });
  assert.equal(loop.ok, true);
});
test('shared anchors are identified in the plan before any changes are applied', () => {
  const input = fixture(),
    placement = designerOptions(input).placements[0],
    insert = prepareNewBlock({
      ...input,
      type: 'menu',
      name: 'Choix',
      key: 'MENU',
      placementId: placement.id,
      continuationField: 'DEFAULT_TARGET_TYPE',
    });
  const next = structuredClone(insert.snapshot);
  next.tables[0].rows.push({
    ...next.tables[0].rows[0],
    key: '+33100000001',
    DESCRIPTION: 'Autre parcours',
  });
  const snapshot = normalizeSnapshot(next),
    flow = buildVoiceInventory(snapshot).flows[0];
  const plan = prepareRouteEdit({
    snapshot,
    flow,
    nodeId: 'menus:MENU',
    field: 'OPTION1_TARGET_TYPE',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.summary.notices.some((n) => n.includes('Autre parcours')));
});
test('observed V5 DT schemas support new entry and the five mature block families without invented columns', () => {
  const inventory = JSON.parse(
      fs.readFileSync(new URL('../INVENTAIRE_DATATABLES_VOIX.json', import.meta.url)),
    ),
    snapshot = normalizeSnapshot({
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
  const created = prepareNewFlow({
    snapshot,
    name: 'Parcours de recette',
    phone: '+33123456789',
    division: 'CR',
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const flow = buildVoiceInventory(created.snapshot).flows.find((f) => f.id === created.flowId),
    placement = designerOptions({ snapshot: created.snapshot, flow }).placements.find(
      (p) => p.field === 'NEXT_TARGET_TYPE',
    );
  const cases = {
    menu: { MENU_TIMEOUT: 5 },
    service: { QUEUE: 'Q Clients' },
    schedulegroup: { SCHEDULE_GROUP: 'Calendrier' },
    decision: {
      PARTICIPANT_DATA_TO_CHECK: 'CRISE',
      DECISION_OPERATOR: '==',
      DECISION_VALUE: 'ACTIF',
    },
    ratiodistrib: { RATIO1: 100 },
  };
  for (const [type, values] of Object.entries(cases)) {
    const cap = designerCatalogue(created.snapshot).find((c) => c.type === type),
      continuation = type === 'ratiodistrib' ? 'RATIO1_TARGET_TYPE' : cap.outlets[0].field;
    const plan = prepareNewBlock({
      snapshot: created.snapshot,
      flow,
      type,
      name: 'Nouveau ' + type,
      key: 'TEST_' + type,
      placementId: placement.id,
      continuationField: continuation,
      values,
    });
    assert.equal(plan.ok, true, type + ': ' + JSON.stringify(plan.errors));
    const fields = new Set(
      Object.keys(created.snapshot.tables.find((t) => t.id === cap.tableId).schema.properties),
    );
    assert.ok(Object.keys(plan.createdRows[0].row).every((k) => fields.has(k)));
  }
});
