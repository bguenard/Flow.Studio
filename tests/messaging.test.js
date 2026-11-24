import test from 'node:test';
import assert from 'node:assert/strict';
import { messagingFixture } from './fixtures/messaging.js';
import {
  buildJourneyInventory,
  buildVoiceInventory,
  normalizeSnapshot,
} from '../src/data-source.js';
import {
  channelProfile,
  messageEntryCandidates,
  validateChannelBindings,
  MESSAGE_TABLES,
} from '../src/media-profiles.js';
import { selectStudioScope } from '../src/wolf-scope.js';
import { designerOptions, prepareNewFlow, prepareNewBlock } from '../src/flow-designer.js';
import { prepareStepDraft } from '../src/step-draft.js';
import { businessFields, flowRoutes } from '../src/business.js';
import { adminInspectorFields } from '../src/journey-audience.js';
import { stepFieldView } from '../src/step-field-view.js';
import { journeyModel } from '../src/journey-canvas.js';
import { cloneFlow } from '../src/flow-clone.js';
import { publicationRows, createPublicationClient } from '../src/publication.js';
import { publicationPreflight } from '../src/publication-preflight.js';
import { validateV5Edits } from '../src/v5-fields.js';
import { loadFromGenesys } from '../src/genesys-direct.js';
import { designerView } from '../src/flow-designer-view.js';
const fixture = () => {
  const raw = messagingFixture();
  raw.tables
    .find((t) => t.id === 'menu')
    .rows.push({
      key: 'WAIT',
      DESCRIPTION: 'Attente',
      DIVISION: 'Demo',
      MENU_MESSAGE: 'ttm:Attente',
      OPTION0_LABEL: 'ttm:Continuer',
      OPTION0_TARGET_TYPE: 'next',
      OPTION0_TARGET: '',
    });
  return normalizeSnapshot(raw);
};
const flowOf = (s) => buildJourneyInventory(s).flows.find((f) => f.media === 'messaging');
test('mixed inventory preserves voice, resolves messaging cycles, cards, pdata and waiting menus', () => {
  const s = fixture(),
    before = JSON.stringify(s),
    inv = buildJourneyInventory(s),
    f = flowOf(s);
  assert.equal(inv.flows.length, 2);
  assert.equal(buildVoiceInventory(s).flows.length, 1);
  assert.equal(f.engine, 'wolf-message-v1');
  assert.equal(f.dnis, '');
  assert.equal(f.nodes.length, 7);
  assert.ok(f.nodes.some((n) => n.type === 'card'));
  assert.ok(f.nodes.some((n) => n.type === 'pdata'));
  assert.equal(f.edges.filter((e) => !e.resolved).length, 0);
  assert.equal(JSON.stringify(s), before);
  assert.ok(!f.edges.some((e) => e.branch === 'OPTION2'));
  assert.ok(flowRoutes(f).some((r) => r.toTitle === 'Fin de conversation'));
  assert.doesNotThrow(() => journeyModel(f));
  assert.equal(selectStudioScope(s).tables.length, s.tables.length);
});
test('channel and entry selection remain distinct from media and accept multiple explicit bindings', () => {
  const f = flowOf(fixture());
  assert.equal(channelProfile('webmessaging').media, 'messaging');
  assert.throws(() => channelProfile('whatsapp'), /pas encore/);
  assert.deepEqual(
    messageEntryCandidates({
      channel: 'webmessaging',
      initialSegment: 'WEB_HOME',
      isNewConversation: false,
    }),
    ['WEB_HOME_THREADING', 'WEB_HOME'],
  );
  assert.deepEqual(
    messageEntryCandidates({
      channel: 'webmessaging',
      deploymentName: 'Website',
      isNewConversation: true,
    }),
    ['Website'],
  );
  const bindings = ['a', 'b'].map((id) => ({
    id,
    flowId: f.id,
    channel: 'webmessaging',
    endpoint: id,
  }));
  assert.equal(validateChannelBindings(bindings, [f]).length, 2);
  assert.throws(() => validateChannelBindings([...bindings, bindings[0]], [f]), /déjà/);
  assert.throws(
    () => validateChannelBindings([{ ...bindings[0], segment: 'WRONG' }], [f]),
    /segment/,
  );
});
test('designer creates a messaging segment and inserts only messaging blocks', () => {
  const s = fixture(),
    options = designerOptions({ snapshot: s, media: 'messaging' });
  assert.ok(options.catalogue.some((x) => x.type === 'quickreplies' && x.available));
  assert.ok(!options.catalogue.some((x) => x.type === 'menu'));
  const plan = prepareNewFlow({
    snapshot: s,
    media: 'messaging',
    name: 'Support Web',
    phone: 'SUPPORT_WEB',
    division: 'Demo',
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(flowOf(plan.snapshot).media, 'messaging');
  assert.equal(plan.createdRows[0].tableName, MESSAGE_TABLES.segment);
  const f = buildJourneyInventory(plan.snapshot).flows.find((f) => f.id === plan.flowId);
  const placement = designerOptions({ snapshot: plan.snapshot, flow: f }).placements.find(
    (p) => p.field === 'NEXT_TARGET_TYPE',
  );
  const block = prepareNewBlock({
    snapshot: plan.snapshot,
    flow: f,
    type: 'quickreplies',
    name: 'Choix',
    key: 'NEW_MENU',
    placementId: placement.id,
    continuationField: 'OPTION0_TARGET_TYPE',
    values: { MENU_MESSAGE: 'ttm:Bonjour', OPTION0_LABEL: 'ttm:Fin' },
  });
  assert.equal(block.ok, true, JSON.stringify(block.errors));
  assert.equal(block.createdRows[0].tableName, MESSAGE_TABLES.quickreplies);
  assert.equal(
    prepareNewBlock({
      snapshot: plan.snapshot,
      flow: f,
      type: 'menu',
      name: 'Voix',
      key: 'BAD',
      placementId: placement.id,
    }).ok,
    false,
  );
  const html = designerView({
    mode: 'create',
    options,
    form: { media: 'messaging', phone: 'WEB', values: {} },
  });
  assert.match(html, /Segment d’entrée/);
  assert.doesNotMatch(html, /type="tel"/);
});
test('message editors round-trip exact values, encode plain text and hide division', () => {
  const s = fixture(),
    f = flowOf(s),
    node = f.nodes.find((n) => n.type === 'quickreplies');
  const field = businessFields(node).find((f) => f.key === 'MENU_MESSAGE');
  assert.equal(field.kind, 'message');
  const html = stepFieldView(field, 0, { node, snapshot: s });
  assert.match(html, /Comment vous aider/);
  assert.doesNotMatch(html, />ttm:/);
  assert.deepEqual(
    prepareStepDraft({
      node,
      snapshot: s,
      visibleValues: { MENU_MESSAGE: 'Comment vous aider ?' },
    }),
    node.row,
  );
  const next = prepareStepDraft({ node, snapshot: s, pending: { MENU_MESSAGE: 'Bienvenue' } });
  assert.equal(next.MENU_MESSAGE, 'ttm:Bienvenue');
  const dynamic = { ...node, row: { ...node.row, MENU_MESSAGE: 'var:WELCOME' } };
  assert.deepEqual(
    prepareStepDraft({
      node: dynamic,
      snapshot: s,
      visibleValues: { MENU_MESSAGE: 'var:WELCOME' },
    }),
    dynamic.row,
  );
  assert.ok(!adminInspectorFields(node).some((f) => f.key === 'DIVISION'));
  const route = businessFields(node).find((f) => f.key === 'OPTION0_TARGET_TYPE');
  const routes = stepFieldView(route, 0, { node, snapshot: s });
  assert.match(routes, /quickreplies/);
  assert.doesNotMatch(routes, /value="menu"/);
  assert.throws(
    () => validateV5Edits(node, { ...node.row, OPTION0_TARGET_TYPE: 'menu' }, { snapshot: s }),
    /incompatible/,
  );
});
test('core model copy rewrites cards, cycles and context within the messaging engine', () => {
  const s = fixture(),
    f = flowOf(s),
    copy = cloneFlow(s, f, { name: 'Autre site', phone: 'OTHER_WEB', division: 'Other' });
  const c = buildJourneyInventory(copy.snapshot).flows.find((f) => f.id === copy.flowId);
  assert.equal(c.key, 'OTHER_WEB');
  assert.equal(c.media, 'messaging');
  assert.equal(c.nodes.length, f.nodes.length);
  assert.ok(c.nodes.every((n) => n.row.DIVISION === 'Other'));
  assert.ok(!c.nodes.some((n) => f.nodes.some((old) => old.id === n.id)));
  assert.equal(c.edges.filter((e) => !e.resolved).length, 0);
  const rows = publicationRows(copy.snapshot, new Map(), new Map([['copy', copy.summary]]));
  const entry = rows.find((r) => r.id === c.id),
    card = rows.find((r) => r.table === MESSAGE_TABLES.card);
  assert.ok(entry.requiresCreatedRows.length);
  assert.ok(card.requiresCreatedRows.length);
  assert.equal(rows.at(-1).id, c.id);
  const preflight = publicationPreflight({ snapshot: copy.snapshot, rows, baselineSnapshot: s });
  assert.equal(
    preflight.findings.filter((f) => f.level === 'error').length,
    0,
    JSON.stringify(preflight.findings),
  );
});
test('messaging reader refuses ambiguous tables and preserves significant key whitespace', () => {
  const raw = messagingFixture();
  raw.tables.find((t) => t.id === 'entry').rows[0].NEXT_TARGET = ' MENU';
  const f = flowOf(normalizeSnapshot(raw));
  assert.ok(f.issues.some((i) => i.code === 'missing-row'));
  raw.tables.push({ ...raw.tables.find((t) => t.id === 'menu'), id: 'duplicate' });
  assert.ok(flowOf(normalizeSnapshot(raw)).issues.some((i) => i.code === 'ambiguous-table'));
});
test('all-media loader reads allowlisted messaging schemas and rows with GET only', async () => {
  const s = fixture(),
    calls = [];
  const ok = (x) => ({ ok: true, status: 200, json: async () => x });
  const result = await loadFromGenesys('test-token', {
    media: 'all',
    fetchImpl: async (url, options) => {
      calls.push(options.method);
      const u = new URL(url),
        base = '/api/v2/flows/datatables';
      if (u.pathname === base)
        return ok({
          entities: s.tables.map(({ id, name, schema }) => ({ id, name, schema })),
          pageNumber: 1,
          pageCount: 1,
        });
      const id = u.pathname.slice(base.length + 1).split('/')[0];
      return ok({ entities: s.tables.find((t) => t.id === id).rows, pageNumber: 1, pageCount: 1 });
    },
  });
  assert.equal(result.tables.length, s.tables.length);
  assert.ok(calls.every((m) => m === 'GET'));
  assert.equal(buildJourneyInventory(result).flows.length, 2);
  assert.equal(result.source.selectedMessageTables, s.tables.length - 1);
});
test('messaging publication uses the same conflict check and verified journal as voice', async () => {
  const s = fixture(),
    f = flowOf(s),
    table = s.tables.find((t) => t.id === 'entry'),
    original = f.sourceRow;
  let remote = structuredClone(original);
  const methods = [],
    journal = [];
  const client = createPublicationClient('mock-token', {
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      const path = new URL(url).pathname;
      const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
      if (path.endsWith('/users/me')) return ok({ id: 'user' });
      if (path.endsWith('/organizations/me')) return ok({ id: 'org' });
      if (path.endsWith('/datatables/entry')) return ok(table);
      assert.ok(path.endsWith('/rows/WEB_HOME'));
      if (options.method === 'PUT') remote = JSON.parse(options.body);
      return ok(remote);
    },
  });
  const entry = {
    id: f.id,
    tableId: table.id,
    table: table.name,
    key: original.key,
    kind: 'update',
    before: original,
    after: { ...original, WELCOM_MESSAGE: 'ttm:Nouveau message' },
    fields: ['WELCOM_MESSAGE'],
  };
  const plan = await client.prepare([entry], { organizationId: 'org' });
  assert.ok(methods.every((m) => m === 'GET'));
  const run = await client.publish(plan, {
    journal: async (r) => journal.push(structuredClone(r)),
  });
  assert.equal(run.status, 'verified');
  assert.equal(remote.WELCOM_MESSAGE, 'ttm:Nouveau message');
  assert.equal(remote.NEXT_TARGET, original.NEXT_TARGET);
  assert.equal(methods.filter((m) => m === 'PUT').length, 1);
  await assert.rejects(() => client.prepare([entry], { organizationId: 'org' }), /Conflit/);
});

test('messaging configuration lists all tables and hides unlabelled button branches', async () => {
  const { configurationFlow, configurationView } = await import('../src/configuration-view.js');
  const { businessBranches } = await import('../src/business-branches.js');
  const { availableBusinessTasks } = await import('../src/business-workspace.js');
  const s = fixture(),
    f = flowOf(s),
    node = f.nodes.find((n) => n.key === 'MENU');
  const branches = businessBranches(node, businessFields(node));
  assert.ok(!branches.branches.some((b) => b.id === 'OPTION2_TARGET_TYPE'));
  assert.ok(
    businessBranches(node, businessFields(node), { OPTION2_LABEL: 'Nouveau' }).branches.some(
      (b) => b.id === 'OPTION2_TARGET_TYPE',
    ),
  );
  const config = configurationFlow(s, 'card');
  assert.equal(config.media, 'messaging');
  assert.equal(config.nodes[0].type, 'card');
  assert.match(configurationView(s, config, 0, ''), /W_CARD_MESSAGE_v1/);
  assert.equal(availableBusinessTasks(f)[0].label, 'Fil de la conversation');
  const card = f.nodes.find((n) => n.type === 'card'),
    content = '[Client] Une offre (template)';
  const edited = prepareStepDraft({ node: card, snapshot: s, pending: { DESCRIPTION: content } });
  assert.equal(edited.DESCRIPTION, content);
  assert.throws(() =>
    validateV5Edits(card, { ...card.row, CARD_IMAGE_URL: 'javascript:alert(1)' }, { snapshot: s }),
  );
  assert.throws(() =>
    validateV5Edits(
      node,
      { ...node.row, OPTION2_LABEL: 'Choisir', OPTION2_TARGET_TYPE: '' },
      { snapshot: s },
    ),
  );
  const table = s.tables.find((t) => t.id === 'ratio'),
    ratio = {
      tableName: table.name,
      schema: table.schema,
      row: table.rows[0],
      type: 'ratiodistrib',
    };
  assert.throws(() => validateV5Edits(ratio, { ...ratio.row, RATIO_9: -1 }, { snapshot: s }));
});
test('context insertion between messaging journeys targets the messaging pdata table', async () => {
  const { blockInsertionOptions, prepareBlockInsertion } = await import(
    '../src/block-insertion.js'
  );
  const s = fixture(),
    left = flowOf(s),
    fresh = prepareNewFlow({
      snapshot: s,
      media: 'messaging',
      name: 'Second site',
      phone: 'SECOND',
      division: 'Other',
    });
  assert.equal(fresh.ok, true);
  const right = buildJourneyInventory(fresh.snapshot).flows.find((f) => f.id === fresh.flowId);
  const args = {
    snapshot: fresh.snapshot,
    left,
    right,
    sourceNodeId: left.nodes.find((n) => n.type === 'pdata').id,
  };
  const options = blockInsertionOptions(args);
  assert.equal(options.canInsert, true, JSON.stringify(options));
  const placement = options.placements.find(
    (p) => p.fromId === right.id && p.field === 'NEXT_TARGET_TYPE',
  );
  assert.ok(placement);
  const result = prepareBlockInsertion({
    ...args,
    placementId: placement.id,
    keyPrefix: 'WEB_CONTEXT',
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.createdRows.length, 1);
  assert.equal(result.createdRows[0].tableName, MESSAGE_TABLES.pdata);
  assert.equal(result.createdRows[0].row.DIVISION, 'Other');
  assert.equal(result.createdRows[0].row.PDATA_LIST_1, 'CLIENT==web');
});
