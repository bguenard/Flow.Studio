import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceInventory } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';
import {
  businessSteps,
  businessWorkspace,
  availableBusinessTasks,
  primaryBusinessTasks,
  taskFields,
} from '../src/business-workspace.js';
import { businessBranches, businessBranchView } from '../src/business-branches.js';
import { businessInspectorModel } from '../src/journey-audience.js';
import { stepIcon } from '../src/journey-navigation.js';
import { icon, icons } from '../src/ui-kit.js';

const flow = buildVoiceInventory(demoSnapshot).flows.find(
  (item) => item.key === 'DEMO_ENTREE_ATLANTIQUE',
);
const steps = (html) => html.split('<li class="story-step').slice(1);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the call is told step by step, in order, each with the icon of its type', () => {
  const html = steps(businessSteps(flow));
  assert.equal(html.length, flow.nodes.length);
  flow.nodes.forEach((node, index) => {
    assert.match(html[index], new RegExp(`data-step="${index}" data-kind="${node.type}"`));
    assert.ok(
      html[index].includes(`<span class="story-icon">${icon(stepIcon(node.type))}</span>`),
      node.type,
    );
    assert.ok(
      html[index].includes(
        `<span class="story-number">Étape ${index + 1}</span><span class="story-kind">${node.label}</span>`,
      ),
    );
    assert.doesNotMatch(html[index], /ÉTAPE/);
  });
});

test('each step shows what the caller hears and where each branch leads', () => {
  const [entry, hours, menu, team] = steps(businessSteps(flow)).map(text);
  assert.match(entry, /Message d’accueil « Bienvenue à l’agence Atlantique\./);
  assert.match(hours, /Demo Cal Atlantique/);
  assert.match(hours, /Pendant l’ouverture .*Orienter la demande · Atlantique/);
  assert.match(
    hours,
    /En dehors des horaires .*Fin d’appel .*« Nos conseillers vous accueillent du lundi/,
  );
  assert.match(menu, /Choix 1 .*Déclarer ou suivre un sinistre/);
  assert.match(menu, /Choix 2 .*Gérer un contrat/);
  assert.match(team, /Demo EQ Atl Sinistres/);
  assert.match(
    team,
    /Après l’attente .*Fin d’appel .*« Tous nos conseillers sont actuellement occupés/,
  );
  // The queue is a fact of the team step, not one more branch to read.
  assert.doesNotMatch(team, /Mise en relation avec l’équipe/);
});

test('a transition message is shown once, with its branch', () => {
  const hours = steps(businessSteps(flow))[1];
  assert.equal(hours.split('Nos conseillers vous accueillent du lundi').length - 1, 1);
});

test('a branch leads to the step it names', () => {
  const menu = steps(businessSteps(flow))[2];
  const target = flow.nodes.findIndex((node) => node.key === 'DEMO_ATL_SINISTRES');
  assert.match(
    menu,
    new RegExp(
      `<button[^>]*class="story-link" data-kind="service"[^>]*data-action="business-edit"[^>]*data-node="${target}"[^>]*>.*?<span class="story-link-title">Déclarer ou suivre un sinistre</span><span class="story-link-step">Étape ${target + 1}</span></button>`,
    ),
  );
  // The destination carries the icon of the step it leads to.
  assert.ok(menu.includes(`<span class="story-link-icon">${icon(stepIcon('service'))}</span>`));
});

test('a rubric keeps only the steps and settings it concerns', () => {
  const teams = steps(businessSteps(flow, { task: 'team' }));
  assert.equal(teams.length, flow.nodes.filter((node) => node.type === 'service').length);
  assert.match(text(teams[0]), /File de destination|Équipe/);
  assert.match(text(teams[0]), /Priorité/);
  assert.doesNotMatch(teams.join(''), /story-branches/);
  const messages = steps(businessSteps(flow, { task: 'messages' }));
  assert.ok(messages.length >= 4);
  assert.doesNotMatch(text(messages.join('')), /Non renseigné/);
});

test('search finds a step by its messages and by the branch that leads to it', () => {
  assert.equal(steps(businessSteps(flow, { query: 'bienvenue' })).length, 1);
  const found = steps(businessSteps(flow, { query: 'choix 1' }));
  assert.ok(found.length >= 1 && found.length < flow.nodes.length);
  assert.match(businessSteps(flow, { query: 'introuvable-xyz' }), /Aucune étape ne correspond/);
});

test('attached client data stays out of the call story but remains reachable in its rubric', () => {
  const schema = {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string' },
      DESCRIPTION: { type: 'string' },
      PDATA_LIST_1: { type: 'string' },
    },
  };
  const context = {
    id: 'p',
    key: 'CTX',
    type: 'pdata',
    label: 'Attributs métier',
    tableName: 'W_PARTICIPANT_DATA_v5',
    schema,
    row: { key: 'CTX', DESCRIPTION: 'Motif sinistres', PDATA_LIST_1: 'MOTIF==sinistre' },
  };
  const entry = {
    id: 'e',
    key: '+331',
    type: 'inboundcall',
    label: 'Accueil',
    tableName: 'W_INBOUND_CALL_v5',
    row: { key: '+331', DESCRIPTION: 'Accueil', WELCOME_AUDIO: 'tts:Bonjour' },
  };
  const small = {
    id: 'e',
    nodes: [entry, context],
    edges: [{ from: 'e', to: 'p', relationship: 'context', resolved: true }],
  };
  assert.ok(taskFields(context, 'context').length > 0);
  const story = steps(businessSteps(small));
  assert.equal(story.length, 1);
  assert.doesNotMatch(story.join(''), /Motif sinistres/);
  const rubric = steps(businessSteps(small, { task: 'context' }));
  assert.equal(rubric.length, 1);
  assert.match(rubric[0], /Motif sinistres/);
  assert.doesNotMatch(rubric[0], /Étape \d/);
});

test('unsaved and drafted steps are flagged, and an unsaved choice reads like a saved one', () => {
  const node = flow.nodes[0];
  const pending = new Map([[node.id, { LANGUAGE: 'en-us' }]]);
  const language = steps(businessSteps(flow, { task: 'language', pending }));
  assert.match(text(language[0]), /Anglais/);
  assert.match(language[0], /À enregistrer/);
  assert.match(steps(businessSteps(flow, { drafts: new Map([[node.id, {}]]) }))[0], /Brouillon/);
  assert.match(steps(businessSteps(flow, { selected: 0 }))[0], /^ selected/);
});

test('names and messages from the tables are escaped', () => {
  const hostile = structuredClone(flow);
  hostile.nodes[0].row.DESCRIPTION = 'Accueil <img src=x onerror=alert(1)>';
  hostile.nodes[0].row.WELCOME_AUDIO = 'tts:<script>alert(1)</script>';
  const html = businessSteps(hostile);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;script&gt;/);
});

test('three rubrics lead; every other rubric stays available in one list', () => {
  const html = businessWorkspace(flow, { task: 'all', query: '' });
  const tabs = [...html.matchAll(/data-action="business-task"[^>]*data-task="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    tabs,
    primaryBusinessTasks.filter((id) =>
      availableBusinessTasks(flow).some((task) => task.id === id),
    ),
  );
  const more = html.match(/<select id="business-task-more"[\s\S]*?<\/select>/)[0];
  const listed = [...more.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...tabs, ...listed].sort(),
    availableBusinessTasks(flow)
      .map((task) => task.id)
      .sort(),
  );
  assert.doesNotMatch(html, /Tous les réglages/);
  assert.match(html, /<ol id="business-steps"/);
  const other = businessWorkspace(flow, { task: listed[0], query: '' });
  assert.match(other, new RegExp(`<option value="${listed[0]}" selected`));
});

test('the business editor edits what is said on a branch, not where the branch goes', () => {
  const node = flow.nodes.find((item) => item.type === 'schedulegroup'),
    model = businessInspectorModel(node);
  const branches = businessBranches(node, model.fields, {}, true);
  const render = (field) => `<input data-field="${field.key}">`;
  const business = businessBranchView(
    branches,
    'CLOSED_TARGET_TYPE',
    render,
    {},
    { routing: false },
  );
  assert.match(business, /data-field="CLOSED_TARGET_AUDIO"/);
  assert.doesNotMatch(business, /data-field="CLOSED_TARGET_TYPE"|data-field="CLOSED_TARGET"/);
  assert.match(business, /Fin d’appel/);
  assert.match(business, /data-action="set-audience"[^>]*data-audience="admin"/);
  const admin = businessBranchView(branches, 'CLOSED_TARGET_TYPE', render, {});
  assert.match(admin, /data-field="CLOSED_TARGET_TYPE"/);
});

test('a step is laid out in zones: what it is, what happens there, where the call goes next', () => {
  const hours = steps(businessSteps(flow))[1];
  assert.match(
    hours,
    /<article class="story-card has-here has-next"><header class="story-id">[\s\S]*<\/header><div class="story-here">[\s\S]*<\/div><ul class="story-branches"/,
  );
  const teams = steps(businessSteps(flow, { task: 'team' }));
  assert.match(teams[0], /<article class="story-card has-here"><header class="story-id">/);
});

test('a spoken message takes a full line; short settings can share one', () => {
  const [entry, hours] = steps(businessSteps(flow));
  assert.match(entry, /<div class="wide"><dt>Message d’accueil<\/dt>/);
  assert.match(hours, /<div><dt>[^<]*<\/dt><dd>Demo Cal Atlantique/);
});

test('the end of the call reads differently from a step the call continues to', () => {
  const hours = steps(businessSteps(flow))[1];
  assert.ok(hours.includes(`<span class="story-end">${icon('hangup')}Fin d’appel</span>`));
  assert.doesNotMatch(hours, /class="story-end">Orienter/);
});

test('the condition of a rule is one of its settings, read like the others', () => {
  const rule = {
    id: 'd',
    key: 'RULE',
    type: 'decision',
    label: 'Règle métier',
    tableName: 'W_DECISION_v5',
    row: {
      key: 'RULE',
      PARTICIPANT_DATA_TO_CHECK: 'CRISE',
      DECISION_OPERATOR: '==',
      DECISION_VALUE: 'ACTIF',
    },
  };
  const html = steps(businessSteps({ id: 'd', nodes: [rule], edges: [] }))[0];
  assert.match(
    html,
    /<div class="wide"><dt>Condition<\/dt><dd>Crise est égal à Actif<\/dd><\/div>/,
  );
});

test('what the caller hears reads as a spoken message, in a bubble', () => {
  const [entry, hours] = steps(businessSteps(flow));
  assert.ok(
    entry.includes(`<span class="story-quote">${icon('speaker')}<span>« Bienvenue à l’agence`),
  );
  assert.ok(
    hours.includes(`<span class="story-quote">${icon('speaker')}<span>« Nos conseillers`),
  );
  // A written conversation is not spoken.
  const written = steps(businessSteps({ ...flow, media: 'messaging' }))[0];
  assert.ok(written.includes(`<span class="story-quote">${icon('message')}<span>«`));
  assert.ok(!written.includes(icon('speaker')));
});

test('a menu choice shows the phone key the caller presses', () => {
  const menu = steps(businessSteps(flow))[2];
  assert.match(
    menu,
    /<span class="story-key" aria-hidden="true">1<\/span><span>Choix 1<\/span>/,
  );
  assert.match(
    menu,
    /<span class="story-key" aria-hidden="true">2<\/span><span>Choix 2<\/span>/,
  );
  const keys = structuredClone(flow);
  const edge = keys.edges.find((item) => item.branch === 'OPTION1');
  edge.branch = 'OPTIONSTAR';
  assert.match(
    steps(businessSteps(keys))[2],
    /<span class="story-key" aria-hidden="true">\*<\/span><span>Choix étoile/,
  );
});

test('each branch is marked by its situation: open, closed, urgent, waiting', () => {
  const [, hours, menu, team] = steps(businessSteps(flow));
  const tone = (html, label) =>
    new RegExp(`<li data-tone="(\\w+)"><span class="story-branch-label">.{0,80}${label}`).exec(
      html,
    )?.[1];
  assert.equal(tone(hours, 'Pendant l’ouverture'), 'yes');
  assert.equal(tone(hours, 'En dehors des horaires'), 'off');
  assert.equal(tone(hours, 'Pendant les vacances'), 'off');
  assert.equal(tone(hours, 'En situation d’urgence'), 'alert');
  assert.equal(tone(team, 'Après l’attente'), 'wait');
  assert.equal(tone(menu, 'Sinon'), 'plain');
  // The mark never replaces the wording.
  assert.match(hours, /<span class="story-dot" aria-hidden="true"><\/span><span>Pendant l’ouverture/);
});

test('the edit button names its action with an icon; a read-only step is only consulted', () => {
  const entry = steps(businessSteps(flow))[0];
  assert.ok(entry.includes(`${icon('pencil')}Modifier</button>`));
  for (const name of ['pencil', 'speaker', 'hangup']) assert.ok(icons[name], name);
});
