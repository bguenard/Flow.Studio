import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';
import {
  designerOptions,
  prepareNewBlock,
  prepareRouteEdit,
  prepareBlockRemoval,
} from '../src/flow-designer.js';
import { applyDesignerDraft } from '../src/designer-draft.js';
import { designerView } from '../src/flow-designer-view.js';

const string = (extra = {}) => ({ type: 'string', ...extra });
const schema = (extra = {}) => ({
  type: 'object',
  required: ['key'],
  properties: { key: string(), DESCRIPTION: string(), DIVISION: string(), ...extra },
});
const route = (name) => ({ [`${name}_TARGET_TYPE`]: string(), [`${name}_TARGET`]: string() });
const flowOf = (snapshot, key = '+33100000000') =>
  buildVoiceInventory(snapshot).flows.find((flow) => flow.key === key);
const rowOf = (snapshot, tableId, key) =>
  snapshot.tables.find((table) => table.id === tableId).rows.find((row) => row.key === key);

/** Accueil → Choix (touche 1 → Conseillers, sinon → fin d'appel) ; Conseillers → fin d'appel. */
function journey() {
  let snapshot = normalizeSnapshot({
    tables: [
      {
        id: 'entry',
        name: 'W_INBOUND_CALL_v5',
        schema: schema({
          ...route('NEXT'),
          NEXT_TARGET_AUDIO: string(),
          ...route('DEFAULT'),
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
          MENU_AUDIO: string(),
          ...route('DEFAULT'),
          DEFAULT_TARGET_AUDIO: string(),
          ...route('OPTION1'),
          OPTION1_AUDIO: string(),
        }),
        rows: [],
      },
      {
        id: 'services',
        name: 'W_SERVICES_v5',
        schema: schema({ QUEUE: string(), INQUEUE_MENU_1: string(), ...route('INQUEUE') }),
        rows: [],
      },
    ],
  });
  const add = (block, from, field) => {
    const flow = flowOf(snapshot),
      placement = designerOptions({ snapshot, flow }).placements.find(
        (item) => item.fromId === from && item.field === field,
      );
    const plan = prepareNewBlock({ snapshot, flow, placementId: placement.id, ...block });
    assert.equal(plan.ok, true, JSON.stringify(plan.errors));
    snapshot = plan.snapshot;
  };
  add(
    { type: 'menu', name: 'Choix', key: 'MENU', continuationField: 'DEFAULT_TARGET_TYPE' },
    'entry:+33100000000',
    'NEXT_TARGET_TYPE',
  );
  add(
    {
      type: 'service',
      name: 'Conseillers',
      key: 'TEAM',
      values: { QUEUE: 'Q Clients' },
      continuationField: 'INQUEUE_TARGET_TYPE',
    },
    'menus:MENU',
    'OPTION1_TARGET_TYPE',
  );
  return { snapshot, flow: flowOf(snapshot) };
}
const edited = (input, change) => {
  const next = structuredClone(input.snapshot);
  change(next);
  const snapshot = normalizeSnapshot(next);
  return { snapshot, flow: flowOf(snapshot) };
};

test('removing a block sends the branches that led to it to the continuation chosen, and keeps its row', () => {
  const input = edited(journey(), (next) => {
    const entry = rowOf(next, 'entry', '+33100000000');
    entry.NEXT_TARGET_TYPE = 'menu|lang:fr-fr';
    entry.NEXT_TARGET_AUDIO = 'tts:Un instant';
  });
  const before = structuredClone(input.snapshot);
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { outlet: 'OPTION1_TARGET_TYPE' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.summary.kind, 'block-removal');
  assert.equal(plan.createdRows.length, 0);
  assert.equal(plan.updatedRows.length, 1);
  const entry = plan.updatedRows[0].row;
  // The destination changes; what the incoming branch says and carries is kept.
  assert.equal(entry.NEXT_TARGET_TYPE, 'service|lang:fr-fr');
  assert.equal(entry.NEXT_TARGET, 'TEAM');
  assert.equal(entry.NEXT_TARGET_AUDIO, 'tts:Un instant');
  assert.equal(entry.DEFAULT_TARGET_TYPE, 'disconnect');
  const after = flowOf(plan.snapshot);
  assert.deepEqual(
    after.nodes.map((node) => node.id),
    ['entry:+33100000000', 'services:TEAM'],
  );
  // Nothing is deleted: the row stays in its table, unchanged.
  assert.deepEqual(rowOf(plan.snapshot, 'menus', 'MENU'), rowOf(before, 'menus', 'MENU'));
  assert.deepEqual(input.snapshot, before);
  assert.deepEqual(
    plan.summary.removed.map((step) => step.title),
    ['Choix'],
  );
  assert.ok(plan.summary.notices.some((notice) => /conservée/.test(notice)));
});

test('a removed block can also lead to another step or to the end of the call', () => {
  const input = journey();
  const end = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { type: 'disconnect' },
  });
  assert.equal(end.ok, true, JSON.stringify(end.errors));
  assert.equal(end.updatedRows[0].row.NEXT_TARGET_TYPE, 'disconnect');
  assert.equal(end.updatedRows[0].row.NEXT_TARGET, '');
  // The steps only reachable through the removed block leave the journey with it.
  assert.deepEqual(
    end.summary.removed.map((step) => step.title),
    ['Choix', 'Conseillers'],
  );
  assert.ok(end.summary.notices.some((notice) => /Conseillers/.test(notice)));
  const step = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { nodeId: 'services:TEAM' },
  });
  assert.equal(step.ok, true, JSON.stringify(step.errors));
  assert.equal(step.updatedRows[0].row.NEXT_TARGET_TYPE, 'service');
  assert.equal(step.updatedRows[0].row.NEXT_TARGET, 'TEAM');
});

test('every branch that led to the block is reconnected, in one change per step', () => {
  const start = journey();
  const both = prepareRouteEdit({
    ...start,
    nodeId: 'menus:MENU',
    field: 'DEFAULT_TARGET_TYPE',
    destination: { nodeId: 'services:TEAM' },
  });
  const input = { snapshot: both.snapshot, flow: flowOf(both.snapshot) };
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'services:TEAM',
    destination: { outlet: 'INQUEUE_TARGET_TYPE' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows.length, 1);
  const menu = plan.updatedRows[0].row;
  assert.equal(menu.OPTION1_TARGET_TYPE, 'disconnect');
  assert.equal(menu.OPTION1_TARGET, '');
  assert.equal(menu.DEFAULT_TARGET_TYPE, 'disconnect');
  assert.equal(menu.DEFAULT_TARGET, '');
});

test('what the removed exit said or carried is not taken over, and the plan says so', () => {
  const input = edited(journey(), (next) => {
    const menu = rowOf(next, 'menus', 'MENU');
    menu.OPTION1_TARGET_TYPE = 'service|sub:CHECK_AGENT';
    menu.OPTION1_AUDIO = 'tts:Je vous transfère';
  });
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { outlet: 'OPTION1_TARGET_TYPE' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.updatedRows[0].row.NEXT_TARGET_TYPE, 'service');
  assert.ok(plan.summary.notices.some((notice) => /ne sont pas repris/.test(notice)));
});

test('the entry, an unknown block, a missing or circular destination are refused', () => {
  const input = journey();
  const refused = (change, pattern) => {
    const plan = prepareBlockRemoval({ ...input, ...change });
    assert.equal(plan.ok, false);
    assert.match(plan.errors[0].message, pattern);
    assert.equal(plan.updatedRows.length, 0);
  };
  refused({ nodeId: input.flow.id, destination: { type: 'disconnect' } }, /entrée du parcours/);
  refused({ nodeId: 'menus:AUTRE', destination: { type: 'disconnect' } }, /Choisissez le bloc/);
  refused({ nodeId: 'menus:MENU' }, /Choisissez où envoyer/);
  refused({ nodeId: 'menus:MENU', destination: { nodeId: 'menus:MENU' } }, /lui-même|autre étape/);
  refused(
    { nodeId: 'menus:MENU', destination: { nodeId: 'foreign' } },
    /appartenant à ce parcours/,
  );
  refused(
    { nodeId: 'menus:MENU', destination: { outlet: 'OPTION9_TARGET_TYPE' } },
    /suite renseignée/,
  );
  refused({ nodeId: 'menus:MENU', destination: { type: 'next' } }, /Choisissez où envoyer/);
  const stale = structuredClone(input.flow);
  stale.nodes[1].row.DESCRIPTION = 'Autre';
  assert.equal(
    prepareBlockRemoval({
      snapshot: input.snapshot,
      flow: stale,
      nodeId: 'menus:MENU',
      destination: { type: 'disconnect' },
    }).ok,
    false,
  );
});

test('a block shared with another journey leaves only this one, and the plan names the other', () => {
  const input = edited(journey(), (next) => {
    next.tables[0].rows.push({
      key: '+33100000001',
      DESCRIPTION: 'Autre parcours',
      DIVISION: 'France',
      NEXT_TARGET_TYPE: 'menu',
      NEXT_TARGET: 'MENU',
      DEFAULT_TARGET_TYPE: 'disconnect',
      DEFAULT_TARGET: '',
    });
  });
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepEqual(
    plan.updatedRows.map((update) => update.node.id),
    ['entry:+33100000000'],
  );
  assert.ok(flowOf(plan.snapshot, '+33100000001').nodes.some((node) => node.id === 'menus:MENU'));
  assert.ok(
    plan.summary.notices.some((notice) => /reste utilisé par.*Autre parcours/.test(notice)),
  );
});

test('a block attached by a setting rather than a branch is not removed here', () => {
  const input = edited(journey(), (next) => {
    next.tables[1].rows.push({
      ...rowOf(next, 'menus', 'MENU'),
      key: 'ATTENTE',
      DESCRIPTION: 'Menu d’attente',
    });
    rowOf(next, 'services', 'TEAM').INQUEUE_MENU_1 = 'ATTENTE';
  });
  assert.ok(input.flow.nodes.some((node) => node.id === 'menus:ATTENTE'));
  const removal = designerOptions(input).removals.find((item) => item.nodeId === 'menus:ATTENTE');
  assert.match(removal.blocked, /Conseillers/);
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:ATTENTE',
    destination: { type: 'disconnect' },
  });
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0].message, /Conseillers/);
});

test('the designer lists the blocks that can leave the journey, the branches leading to them and their continuations', () => {
  const input = journey(),
    removals = designerOptions(input).removals;
  assert.deepEqual(
    removals.map((item) => [item.nodeId, item.label]),
    [
      ['menus:MENU', 'Choix'],
      ['services:TEAM', 'Conseillers'],
    ],
  );
  const menu = removals[0];
  assert.equal(menu.blocked, '');
  assert.deepEqual(
    menu.incoming.map((link) => [link.fromId, link.field, link.label]),
    [['entry:+33100000000', 'NEXT_TARGET_TYPE', 'Accueil · Puis']],
  );
  assert.deepEqual(
    menu.outlets.map((outlet) => [outlet.field, outlet.label, outlet.target]),
    [
      ['DEFAULT_TARGET_TYPE', 'Sinon', 'Fin d’appel'],
      ['OPTION1_TARGET_TYPE', 'Choix 1', 'Conseillers'],
    ],
  );
});

test('a reviewed removal becomes a draft of the reconnected steps only', () => {
  const input = journey();
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { outlet: 'OPTION1_TARGET_TYPE' },
  });
  const result = applyDesignerDraft({ snapshot: input.snapshot, plan });
  assert.deepEqual([...result.drafts.keys()], ['entry:+33100000000']);
  assert.equal(result.drafts.get('entry:+33100000000').row.NEXT_TARGET, 'TEAM');
  assert.ok(!result.flow.nodes.some((node) => node.id === 'menus:MENU'));
  assert.ok(rowOf(result.snapshot, 'menus', 'MENU'));
});

test('the removal screen asks which block and where its calls go, and says the row is kept', () => {
  const input = journey(),
    options = designerOptions(input);
  let html = designerView({
    mode: 'remove',
    flow: input.flow,
    options,
    form: { removeNodeId: 'menus:MENU', removeTo: 'outlet:OPTION1_TARGET_TYPE' },
  });
  assert.match(html, /Retirer un bloc/);
  assert.match(
    html,
    /<select id="designer-remove-node"[\s\S]*?<option value="menus:MENU" selected/,
  );
  assert.match(
    html,
    /<select id="designer-remove-destination"[\s\S]*?<option value="outlet:OPTION1_TARGET_TYPE" selected[^>]*>Suite du bloc · Choix 1 → Conseillers<\/option>/,
  );
  assert.match(html, /<option value="services:TEAM"[^>]*>Conseillers<\/option>/);
  assert.match(html, /<option value="terminal:disconnect"[^>]*>Terminer l’appel<\/option>/);
  const destinations = html.match(/<select id="designer-remove-destination"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(destinations, /value="menus:MENU"/);
  assert.match(html, /Accueil · Puis/);
  assert.match(html, /ligne reste dans sa table/);
  // No block chosen yet: nothing to send anywhere.
  html = designerView({ mode: 'remove', flow: input.flow, options, form: {} });
  assert.match(html, /<select id="designer-remove-destination"[^>]*disabled/);
});

test('a block that cannot be removed says why, and the removal review lists what leaves the journey', () => {
  const input = journey(),
    options = designerOptions(input);
  options.removals[1].blocked = 'Rattaché par un réglage <b>.';
  let html = designerView({
    mode: 'remove',
    flow: input.flow,
    options,
    form: { removeNodeId: 'services:TEAM' },
  });
  assert.match(html, /Rattaché par un réglage &lt;b&gt;\./);
  assert.match(html.match(/<button[^>]*data-action="designer-review"[^>]*>/)[0], /disabled/);
  const plan = prepareBlockRemoval({
    ...input,
    nodeId: 'menus:MENU',
    destination: { type: 'disconnect' },
  });
  html = designerView({ mode: 'remove', flow: input.flow, options, review: true, plan });
  assert.match(html, /Retiré du parcours/);
  assert.match(html, /<h3>Choix<\/h3>/);
  assert.match(html, /<h3>Conseillers<\/h3>/);
  assert.match(html, /designer-before">menu/);
  assert.match(
    html,
    /0 étape\(s\) créée\(s\) · 1 étape\(s\) mise\(s\) à jour · 2 étape\(s\) retirée\(s\)/,
  );
});
