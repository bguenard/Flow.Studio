import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceInventory } from '../src/data-source.js';
import { nodeTitle, flowRoutes } from '../src/business.js';
import { audienceNodeTitle, businessInspectorModel } from '../src/journey-audience.js';
import { journeySteps } from '../src/journey-navigation.js';
import { journeyModel } from '../src/journey-canvas.js';
import { diagramModel, prepareDiagram, journeyDiagram } from '../src/journey-diagram.js';
import { stepList, stepRelations } from '../src/journey-view.js';
import { businessBranches, businessBranchView } from '../src/business-branches.js';
import { startSimulation, simulationStep, journeyHealth } from '../src/call-simulator.js';
import { designerOptions } from '../src/flow-designer.js';
import { businessSteps } from '../src/business-workspace.js';
import { journeyContextData, contextSummary } from '../src/control-blocks.js';

const text = { type: 'string' };
const schema = (...keys) => ({
  properties: Object.fromEntries(['key', ...keys].map((key) => [key, text])),
});
const tables = ({ recording = true, home = true } = {}) => ({
  tables: [
    {
      id: 'inbound',
      name: 'W_INBOUND_CALL_v5',
      schema: schema(
        'DESCRIPTION',
        'DIVISION',
        'SUBROUTINES_LIST',
        'NEXT_TARGET_TYPE',
        'NEXT_TARGET',
        'DEFAULT_TARGET_TYPE',
        'DEFAULT_TARGET',
      ),
      rows: [
        {
          key: '+33999999000',
          DESCRIPTION: 'Scénario 1',
          DIVISION: 'G2S',
          SUBROUTINES_LIST: '',
          NEXT_TARGET_TYPE: 'decision|sub:INFO_ROUTAGE;RECORDING;bot_qualification',
          NEXT_TARGET: 'REGLE',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: '',
        },
        {
          key: '+33999999001',
          DESCRIPTION: 'Scénario Nord',
          DIVISION: 'NORD',
          SUBROUTINES_LIST: 'RECORDING_50',
          NEXT_TARGET_TYPE: 'decision',
          NEXT_TARGET: 'REGLE',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: '',
        },
        {
          key: '+33999999002',
          DESCRIPTION: 'Sans enregistrement',
          DIVISION: 'G2S',
          SUBROUTINES_LIST: '',
          NEXT_TARGET_TYPE: 'decision|sub:INFO_ROUTAGE',
          NEXT_TARGET: 'REGLE',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: '',
        },
        {
          key: '+33999999003',
          DESCRIPTION: 'Deux appels',
          DIVISION: 'G2S',
          SUBROUTINES_LIST: '',
          NEXT_TARGET_TYPE: 'decision',
          NEXT_TARGET: 'DOUBLE',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: '',
        },
      ],
    },
    {
      id: 'decision',
      name: 'W_DECISION_v5',
      schema: schema(
        'DESCRIPTION',
        'PARTICIPANT_DATA_TO_CHECK',
        'DECISION_OPERATOR',
        'DECISION_VALUE',
        'TRUE_TARGET_TYPE',
        'TRUE_TARGET',
        'FALSE_TARGET_TYPE',
        'FALSE_TARGET',
      ),
      rows: [
        {
          key: 'REGLE',
          DESCRIPTION: 'Client connu',
          PARTICIPANT_DATA_TO_CHECK: 'client',
          DECISION_OPERATOR: 'exist',
          DECISION_VALUE: '',
          TRUE_TARGET_TYPE: 'disconnect',
          TRUE_TARGET: '',
          FALSE_TARGET_TYPE: 'disconnect',
          FALSE_TARGET: '',
        },
        {
          key: 'DOUBLE',
          DESCRIPTION: 'Client prioritaire',
          PARTICIPANT_DATA_TO_CHECK: 'vip',
          DECISION_OPERATOR: 'exist',
          DECISION_VALUE: '',
          TRUE_TARGET_TYPE: 'disconnect|sub:RECORDING',
          TRUE_TARGET: '',
          FALSE_TARGET_TYPE: 'decision|sub:RECORDING',
          FALSE_TARGET: 'REGLE',
        },
      ],
    },
    {
      id: 'menu',
      name: 'W_MENU_v5',
      schema: schema(
        'DESCRIPTION',
        'MENU_AUDIO',
        'OPTION1_TARGET_TYPE',
        'OPTION1_TARGET',
        'OPTION2_TARGET_TYPE',
        'OPTION2_TARGET',
        'DEFAULT_TARGET_TYPE',
        'DEFAULT_TARGET',
      ),
      rows: [
        {
          key: 'G2S_MENU_RECORDING',
          DESCRIPTION: 'Consentement à l’enregistrement',
          MENU_AUDIO: 'tts:Pour accepter l’enregistrement, tapez 1. Sinon, tapez 2.',
          OPTION1_TARGET_TYPE: 'enable',
          OPTION1_TARGET: '',
          OPTION2_TARGET_TYPE: 'disable',
          OPTION2_TARGET: '',
          DEFAULT_TARGET_TYPE: 'enable',
          DEFAULT_TARGET: '',
        },
      ],
    },
    ...(recording
      ? [
          {
            id: 'recording',
            name: 'W_RECORDING_V5',
            schema: {
              properties: {
                key: text,
                ENABLE_RECORDING: { type: 'boolean' },
                AUDIO_RECORDING: text,
                CONSENT_MENU: text,
              },
            },
            rows: [
              {
                key: 'G2S',
                ENABLE_RECORDING: true,
                AUDIO_RECORDING: '',
                CONSENT_MENU: 'G2S_MENU_RECORDING',
              },
              ...(home
                ? [{ key: 'Home', ENABLE_RECORDING: true, AUDIO_RECORDING: '', CONSENT_MENU: '' }]
                : []),
            ],
          },
        ]
      : []),
  ],
});
const flows = (options) => buildVoiceInventory(tables(options)).flows;
const byType = (flow, type) => flow.nodes.filter((node) => node.type === type);

test('a journey that calls RECORDING gets the recording setting of its division as an attached block', () => {
  const [g2s, nord, without] = flows();
  const [block] = byType(g2s, 'recording');
  assert.equal(block.id, 'recording:G2S');
  assert.equal(block.tableName, 'W_RECORDING_V5');
  const link = g2s.edges.find((edge) => edge.to === block.id);
  assert.deepEqual(
    [link.from, link.relationship, link.type, link.field, link.resolved],
    [g2s.id, 'context', 'recording', 'NEXT_TARGET_TYPE', true],
  );
  // Le menu de consentement du réglage fait partie du parcours.
  const consent = g2s.edges.find((edge) => edge.from === block.id);
  assert.deepEqual(
    [consent.to, consent.field, consent.label, consent.relationship],
    ['menu:G2S_MENU_RECORDING', 'CONSENT_MENU', 'Menu de consentement', 'route'],
  );
  assert.deepEqual(g2s.issues, []);
  // Sans réglage pour la division, le repli « Home » ; l'appel peut venir de la liste de démarrage.
  const [fallback] = byType(nord, 'recording');
  assert.equal(fallback.id, 'recording:Home');
  assert.equal(nord.edges.find((edge) => edge.to === fallback.id).field, 'SUBROUTINES_LIST');
  assert.equal(byType(nord, 'menu').length, 0);
  assert.deepEqual(byType(without, 'recording'), []);
});

test('no block is invented when the setting cannot be read', () => {
  for (const flow of flows({ recording: false })) {
    assert.deepEqual(byType(flow, 'recording'), []);
    assert.ok(flow.edges.every((edge) => edge.type !== 'recording'));
  }
  const [, nord] = flows({ home: false });
  assert.deepEqual(byType(nord, 'recording'), []);
});

test('the recording block reads as a business title, and keeps its key in Administration', () => {
  const [g2s, nord] = flows();
  const [own] = byType(g2s, 'recording'),
    [home] = byType(nord, 'recording');
  assert.equal(nodeTitle(own), 'Enregistrement des appels · G2S');
  assert.equal(nodeTitle(home), 'Enregistrement des appels · réglage par défaut');
  assert.equal(audienceNodeTitle(own, 'business'), 'Enregistrement des appels · G2S');
  assert.equal(audienceNodeTitle(own, 'admin'), 'G2S');
  const route = flowRoutes(g2s).find((r) => r.toId === own.id);
  assert.equal(route.label, 'Enregistrement de l’appel');
  assert.equal(route.toTitle, 'Enregistrement des appels · G2S');
});

test('the block is listed for both audiences and its three settings are editable', () => {
  const [g2s] = flows();
  const [block] = byType(g2s, 'recording');
  const step = journeySteps(g2s).find((s) => s.id === block.id);
  assert.equal(step.contextOnly, false);
  assert.equal(step.icon, 'mic');
  for (const audience of ['business', 'admin'])
    assert.match(stepList(g2s, { audience }), /Enregistrement des appels · G2S|>G2S</);
  const fields = businessInspectorModel(block).fields;
  const field = (key) => fields.find((f) => f.key === key);
  assert.equal(field('ENABLE_RECORDING').editable, true);
  assert.equal(field('CONSENT_MENU').editable, true);
  // Comme toute annonce, celle de l'enregistrement se modifie par l'éditeur de message.
  assert.equal(field('AUDIO_RECORDING').resource.audio, true);
  // Depuis l'étape qui l'appelle, et depuis le bloc vers ceux qui l'appellent.
  assert.match(
    stepRelations(g2s, g2s.id, 'contexts', { audience: 'admin' }),
    /Enregistrement de l’appel/,
  );
  const usedBy = stepRelations(g2s, block.id, 'usedBy', { audience: 'business' });
  assert.match(usedBy, /Enregistrement demandé par/);
  assert.match(usedBy, /Scénario 1/);
});

const exitsOf = (diagram, id) =>
  diagram.nodes.find((node) => node.id === id).exits.map((exit) => [exit.label, exit.to]);

test('the administration diagram reads context data and recording in sequence, not as extra exits', () => {
  const [g2s, nord, without] = flows();
  const [block] = byType(g2s, 'recording');
  const context = 'context:' + g2s.id,
    custom = `control:${g2s.id}:NEXT_TARGET_TYPE:bot_qualification`;
  const diagram = diagramModel(g2s);
  // Le menu de consentement n'a pas de carte : il fait partie du bloc d'enregistrement.
  assert.deepEqual(
    diagram.nodes.map((n) => n.id).sort(),
    [g2s.id, context, custom, 'decision:REGLE', block.id].sort(),
  );
  // Accueil → données de contexte → enregistrement → suite d'origine, dans l'ordre des contrôles.
  assert.deepEqual(exitsOf(diagram, g2s.id), [
    ['Puis', context],
    ['Sinon', ''],
  ]);
  assert.deepEqual(exitsOf(diagram, context), [['Puis', block.id]]);
  const card = diagram.nodes.find((node) => node.id === block.id);
  assert.equal(card.title, 'Enregistrement des appels · G2S');
  // La carte porte l'annonce du menu et ses réponses, qui poursuivent toutes l'appel.
  assert.equal(card.preview, 'Pour accepter l’enregistrement, tapez 1. Sinon, tapez 2.');
  assert.match(card.facts, /Menu de consentement/);
  assert.deepEqual(
    card.exits.map((exit) => [exit.label, exit.destination, exit.to]),
    [
      ['Choix 1 · Sinon', 'Consentement accepté', custom],
      ['Choix 2', 'Consentement refusé', custom],
    ],
  );
  // Un traitement propre à l'organisation a son bloc, à sa place, sans réglage.
  const task = diagram.nodes.find((node) => node.id === custom);
  assert.deepEqual(
    [task.title, task.typeLabel, task.action, task.index, task.reference],
    ['bot_qualification', 'Traitement spécifique', 'control-block-open', -1, ''],
  );
  assert.match(task.preview, /flow Architect/);
  assert.deepEqual(exitsOf(diagram, custom), [['Puis', 'decision:REGLE']]);
  // Appelé par la liste de démarrage, sans menu de consentement : une simple suite.
  const fallback = diagramModel(nord);
  assert.deepEqual(exitsOf(fallback, nord.id)[0], ['Puis', 'recording:Home']);
  assert.deepEqual(exitsOf(fallback, 'recording:Home'), [['Puis', 'decision:REGLE']]);
  // Sans enregistrement, le bloc de données mène directement à la suite.
  assert.deepEqual(exitsOf(diagramModel(without), 'context:' + without.id), [
    ['Puis', 'decision:REGLE'],
  ]);
});

test('opening the consent menu highlights the recording card that carries it', async () => {
  const [g2s] = flows();
  const menu = g2s.nodes.findIndex((node) => node.id === 'menu:G2S_MENU_RECORDING');
  const html = journeyDiagram(g2s, { layout: await prepareDiagram(g2s), selectedIndex: menu });
  assert.match(html, /class="diagram-card selected" data-kind="recording"/);
});

test('the context data block shows the data of the journey and opens their editor', () => {
  const [g2s] = flows();
  const source = tables();
  source.tables.push(
    {
      id: 'init',
      name: 'STUDIO_PARCOURS_INIT_V5',
      rows: [
        {
          key: '+33999999000',
          ATTRIBUTE_01_NAME: 'SC5_ACTIVE',
          ATTRIBUTE_01_TYPE: 'bool',
          ATTRIBUTE_01_VALUE: 'true',
          ATTRIBUTE_02_NAME: 'SC5_ENTITY',
          ATTRIBUTE_02_TYPE: 'string',
          ATTRIBUTE_02_VALUE: 'gan',
        },
      ],
    },
    {
      id: 'catalogue',
      name: 'STUDIO_PARTICIPANT_DATA_V5',
      rows: [{ key: 'SC5_ENTITY', LABEL: 'Entité' }],
    },
  );
  const data = journeyContextData(source, g2s);
  assert.deepEqual(data.items, [
    { name: 'SC5_ACTIVE', value: 'true', label: '' },
    { name: 'SC5_ENTITY', value: 'gan', label: 'Entité' },
  ]);
  assert.equal(contextSummary(data), '2 données : SC5_ACTIVE, Entité');
  assert.equal(contextSummary(journeyContextData(tables(), g2s)), 'Aucune donnée initialisée');
  const card = diagramModel(g2s, { contextData: data }).nodes.find(
    (node) => node.id === 'context:' + g2s.id,
  );
  assert.deepEqual(
    [card.title, card.reference, card.preview, card.action, card.index],
    [
      'Données de contexte',
      'INFO_ROUTAGE',
      '2 données : SC5_ACTIVE, Entité',
      'context-data-open',
      -1,
    ],
  );
});

test('two branches that record each get their own card, with their own continuation', () => {
  const double = flows()[3];
  const diagram = diagramModel(double);
  const cards = diagram.nodes.filter((node) => node.kind === 'recording');
  assert.equal(cards.length, 2);
  assert.equal(new Set(cards.map((card) => card.id)).size, 2);
  // Les deux cartes ouvrent le même réglage, et aucune carte de menu ne s'ajoute.
  assert.equal(new Set(cards.map((card) => card.index)).size, 1);
  assert.equal(diagram.nodes.filter((node) => node.kind === 'menu').length, 0);
  const rule = exitsOf(diagram, 'decision:DOUBLE');
  assert.deepEqual(
    rule.map(([label]) => label),
    ['Si la condition est remplie', 'Sinon'],
  );
  assert.deepEqual(rule.map(([, to]) => to).sort(), cards.map((card) => card.id).sort());
  const [whenTrue, whenFalse] = rule.map(([, to]) => cards.find((card) => card.id === to));
  assert.deepEqual(
    whenTrue.exits.map((exit) => [exit.destination, exit.to]),
    [
      ['Consentement accepté · Fin d’appel', ''],
      ['Consentement refusé · Fin d’appel', ''],
    ],
  );
  assert.deepEqual(
    whenFalse.exits.map((exit) => [exit.destination, exit.to]),
    [
      ['Consentement accepté', 'decision:REGLE'],
      ['Consentement refusé', 'decision:REGLE'],
    ],
  );
});

test('the simulation and activity maps fold the block', () => {
  const [g2s] = flows();
  const [block] = byType(g2s, 'recording');
  const ids = (model) =>
    model.nodes
      .filter((n) => !n.terminal)
      .map((n) => n.id)
      .sort();
  const folded = journeyModel(g2s);
  assert.deepEqual(ids(folded), [g2s.id, 'decision:REGLE'].sort());
  assert.equal(folded.attachments[g2s.id].recordings.length, 1);
  assert.equal(folded.nodes[0].contexts, 0);
  assert.deepEqual(
    ids(journeyModel(g2s, { allLinks: true })),
    [g2s.id, 'decision:REGLE', 'menu:G2S_MENU_RECORDING', block.id].sort(),
  );
});

test('the open context data block is the highlighted card of the diagram', async () => {
  const [g2s] = flows();
  const layout = await prepareDiagram(g2s);
  const html = journeyDiagram(g2s, { layout, selectedKind: 'context' });
  const pressed = [...html.matchAll(/data-kind="(\w+)"[^>]*aria-pressed="true"/g)].map((m) => m[1]);
  assert.deepEqual(pressed, ['context']);
  assert.match(html, /class="diagram-card selected" data-kind="context"/);
});

test('the business storyline reads context data, then recording, between the entry and its continuation', () => {
  const [g2s] = flows();
  const data = { items: [{ name: 'SC5_ENTITY', value: 'gan', label: 'Entité' }] };
  const html = businessSteps(g2s, { contextData: data });
  const steps = html
    .split('<li class="story-step')
    .slice(1)
    .map((part) => part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  assert.match(steps[0], /Scénario 1.*Puis Données de contexte Étape 2/);
  assert.doesNotMatch(steps[0], /Client connu|Enregistrement/);
  assert.match(steps[1], /Étape 2 Initialisation Données de contexte .*Entité gan/);
  assert.match(steps[1], /Puis Enregistrement des appels · G2S Étape 3/);
  // Un seul bloc pour l'enregistrement et son menu de consentement.
  assert.equal(steps.length, 5);
  assert.match(steps[2], /Étape 3 .*Enregistrement des appels · G2S/);
  assert.match(
    steps[2],
    /Annonce du menu de consentement .*Pour accepter l’enregistrement, tapez 1\. Sinon, tapez 2\./,
  );
  assert.match(steps[2], /Choix 1 · Consentement accepté bot_qualification Étape 4/);
  assert.match(steps[2], /Choix 2 · Consentement refusé bot_qualification Étape 4/);
  // Le traitement propre à l'organisation a son étape, consultable mais sans réglage.
  assert.match(steps[3], /Étape 4 Traitement spécifique bot_qualification Consulter/);
  assert.match(steps[3], /flow Architect.*Puis Client connu Étape 5/);
  assert.match(steps[4], /Étape 5 .*Client connu/);
  // « Consulter » sur le bloc, et un lien par réponse du menu de consentement (touches 1, 2 et repli).
  assert.equal(html.match(/data-action="control-block-open"/g).length, 4);
  // Les données se modifient dans le volet du parcours, depuis le bloc comme depuis la branche qui y mène.
  assert.equal(html.match(/data-action="context-data-open"/g).length, 2);
  assert.doesNotMatch(html, /data-action="flow-data-open"/);
  // Une rubrique ne montre que ses réglages : pas de bloc de données dans « Horaires ».
  assert.doesNotMatch(businessSteps(g2s, { task: 'calendars' }), /Données de contexte/);
});

test('the call path, the simulation and the designer ignore the attached block', () => {
  const [g2s] = flows();
  const [block] = byType(g2s, 'recording');
  const step = simulationStep(startSimulation(g2s));
  assert.ok(step.routes.every((route) => route.toId !== block.id));
  assert.equal(journeyHealth(g2s).unresolved.length, 0);
  const options = designerOptions({ snapshot: tables(), flow: g2s });
  assert.ok(options.destinations.every((d) => d.nodeId !== block.id));
  assert.ok(options.removals.every((r) => r.nodeId !== block.id));
  const consent = options.removals.find((r) => r.nodeId === 'menu:G2S_MENU_RECORDING');
  assert.match(consent.blocked, /Menu de consentement/);
});

test('the controls of a situation link to the recording block', () => {
  const [g2s] = flows();
  const entry = g2s.nodes[0],
    index = g2s.nodes.findIndex((node) => node.type === 'recording');
  const model = businessBranches(entry, businessInspectorModel(entry).fields, {}, true);
  const html = businessBranchView(
    model,
    'NEXT_TARGET_TYPE',
    () => '',
    {},
    { admin: true, context: { snapshot: tables(), flow: g2s, nodeId: entry.id } },
  );
  assert.match(
    html,
    new RegExp(
      `data-action="select-node" data-node="${index}"[^>]*>Ouvrir le bloc d’enregistrement`,
    ),
  );
});
