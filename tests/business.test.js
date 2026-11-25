import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flowTitle,
  humanText,
  nodeTitle,
  sectionForNode,
  describeValue,
  businessFields,
  flowRoutes,
  branchLabel,
  compareFlows,
  nodeConfigurationNotes,
} from '../src/business.js';
import { buildVoiceInventory } from '../src/data-source.js';

function node(id, type, row = {}, tableName = `table-${type}`) {
  return {
    id,
    type,
    tableName,
    tableId: tableName,
    key: id,
    name: row.DESCRIPTION || id,
    row: { key: id, ...row },
  };
}
function flow(id, nodes, edges = []) {
  return { id, nodes, edges, description: nodes[0]?.row.DESCRIPTION || '' };
}
const edge = (from, to, branch, type = 'service') => ({
  from,
  to,
  branch,
  type,
  resolved: true,
  relationship: 'route',
});

test('human titles keep actual descriptions and humanize only safe identifier tokens', () => {
  assert.equal(flowTitle({ description: 'Accueil des adhérents' }), 'Accueil des adhérents');
  assert.equal(
    flowTitle({ description: '[DRAFT_FROM_TEST] Accueil des adhérents' }),
    'Accueil des adhérents',
  );
  assert.equal(humanText('EXEMPLE_SINISTRES_ENTRYPOINT_V1'), 'Exemple Sinistres');
  assert.equal(humanText('+33100000000'), '+33100000000');
  assert.equal(humanText('[ENTITE]_[SERVICE]_[template]'), 'Entité Service Modèle');
  assert.equal(humanText('[DIVISION]'), 'Entité à définir');
  assert.equal(humanText('RÉFÉRENCE_GÉNÉRALE'), 'Référence Générale');
  assert.equal(
    flowTitle({
      description: '[ENTITE]_[SERVICE]_[template]',
      key: '[ENTITE]_[SERVICE]_ENTYPOINT_V1',
    }),
    'Parcours générique · version 1',
  );
  assert.equal(
    flowTitle({
      description: '[ENTITE]_[SERVICE]_[template]',
      key: '[ENTITE]_[SERVICE]_ENTYPOINT_V2',
    }),
    'Parcours générique · version 2',
  );
  assert.equal(
    nodeTitle(node('a', 'service', { DESCRIPTION: 'Équipe habitation' })),
    'Équipe habitation',
  );
  assert.equal(sectionForNode({ type: 'service' }), 'equipes');
});

test('audio text, resources and booleans are readable without exposing source syntax', () => {
  assert.equal(describeValue('WELCOME_AUDIO', 'tts:Bonjour à vous'), 'Bonjour à vous');
  assert.equal(
    describeValue('WELCOME_AUDIO', 'pr:ACCUEIL_EXEMPLE'),
    'Enregistrement « Accueil Exemple »',
  );
  assert.equal(describeValue('RECORDING_ENABLE', 'false'), 'Non');
  assert.equal(describeValue('MENU_TIMEOUT', '7'), '7 s');
  assert.equal(
    describeValue('PDATA_LIST_1', 'motif==Contrat||segment==Particulier'),
    'motif : Contrat · segment : Particulier',
  );
});

test('changed destination types read as business roles with their controls and language', () => {
  assert.equal(
    describeValue('NEXT_TARGET_TYPE', 'DECISION|sub:INFO_ROUTAGE;RECORDING'),
    'Règle d’orientation · Contrôles : Données de contexte · Enregistrement de l’appel',
  );
  assert.equal(
    describeValue('TARGET_TYPE_2', 'SERVICE|LANG:en-gb|SUB:CHECK_AGENT|status:IDLE'),
    'Équipe de traitement · Langue : Anglais (Royaume-Uni) · Contrôles : Disponibilité des conseillers · Statut : IDLE',
  );
  assert.equal(describeValue({ key: 'open_target_type_1' }, 'MENU'), 'Choix proposés au client');
  assert.equal(describeValue('TARGET_TYPE', 'DISCONNECT'), 'Fin d’appel');
  assert.equal(describeValue('NEXT_TARGET_TYPE', ''), 'Non renseigné');
});

test('destination aliases are case insensitive while unknown types and parameters stay explicit', () => {
  assert.equal(describeValue('NEXT_TARGET_TYPE', 'StandardCallFlow'), 'Accueil téléphonique');
  assert.equal(
    describeValue('NEXT_TARGET_TYPE', 'CUSTOMCALLFLOW|lang:fr-fr'),
    'Transfert vers un autre parcours · Langue : Français',
  );
  assert.equal(nodeTitle({ type: 'STANDARDCALLFLOW' }), 'Accueil téléphonique');
  assert.equal(sectionForNode({ type: 'STANDARDCALLFLOW' }), 'accueil');
  assert.equal(
    describeValue('OPEN_TARGET_TYPE', 'EXTERNAL_PLUGIN|satus:IDLE|opaque'),
    'Type non reconnu « EXTERNAL_PLUGIN » · Paramètre non reconnu « satus » : IDLE · Paramètre non reconnu « opaque »',
  );
  assert.equal(
    describeValue('DESCRIPTION', 'DECISION|sub:RECORDING'),
    'DECISION|sub:RECORDING',
    'only destination type fields receive routing interpretation',
  );
});

test('business fields hide plumbing and keep resource references readonly', () => {
  const n = node('a', 'inboundcall', {
    DESCRIPTION: 'Accueil',
    DIVISION: 'EXAMPLE',
    WELCOME_AUDIO: 'tts:Bonjour',
    SCHEDULE_GROUP: 'CAL_EXEMPLE',
    NEXT_TARGET_TYPE: 'service',
    NEXT_TARGET: 'TEAM',
    RECORDING_ENABLE: true,
    UNKNOWN_FIELD: 'opaque',
  });
  const fields = businessFields(n);
  assert.deepEqual(
    fields.map((field) => field.key),
    ['DESCRIPTION', 'WELCOME_AUDIO', 'SCHEDULE_GROUP', 'RECORDING_ENABLE'],
  );
  assert.equal(fields.find((field) => field.key === 'SCHEDULE_GROUP').editable, false);
  assert.equal(fields.find((field) => field.key === 'WELCOME_AUDIO').editable, true);
  assert.equal(fields.find((field) => field.key === 'DESCRIPTION').copyable, false);
  assert.equal(
    businessFields(node('b', 'inboundcall', { WELCOME_AUDIO: 'pr:Message' }))[0].editable,
    false,
  );
  assert.equal(businessFields(node('b', 'inboundcall', { WELCOME_AUDIO: '' }))[0].editable, true);
  assert.equal(
    businessFields(node('m', 'menu', { MENU_AUDIO: 'tts:Choisissez le service souhaité' }))[0]
      .copyable,
    false,
  );
});

test('graph paths distinguish repeated teams despite different node order', () => {
  const a = node('a', 'inboundcall'),
    a1 = node('a1', 'service', { PRIORITY: 5 }),
    a2 = node('a2', 'service', { PRIORITY: 10 });
  const b = node('b', 'inboundcall'),
    b1 = node('b1', 'service', { PRIORITY: 6 }),
    b2 = node('b2', 'service', { PRIORITY: 10 });
  const result = compareFlows(
    flow('a', [a, a1, a2], [edge('a', 'a1', 'OPEN'), edge('a', 'a2', 'CLOSED')]),
    flow('b', [b, b2, b1], [edge('b', 'b2', 'CLOSED'), edge('b', 'b1', 'OPEN')]),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].leftNode.id, 'a1');
  assert.equal(result.items[0].rightNode.id, 'b1');
  assert.equal(result.items[0].copyable, true);
  assert.equal(result.ambiguous.length, 0);
});

test('multiple unbound nodes never pair by array position; unmatched nodes stay explicit', () => {
  const result = compareFlows(
    flow('a', [
      node('a', 'inboundcall'),
      node('a1', 'service'),
      node('a2', 'service'),
      node('s', 'schedulegroup'),
    ]),
    flow('b', [node('b', 'inboundcall'), node('b1', 'service'), node('b2', 'service')]),
  );
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].leftNodes.length, 2);
  assert.equal(result.unmatched[0].node.id, 's');
  assert.equal(result.matches.length, 1);
});

test('copy excludes names, missing fields, resources and cross-version tables', () => {
  const a = node(
    'a',
    'inboundcall',
    { DESCRIPTION: 'Nom A', WELCOME_AUDIO: 'tts:Bonjour A', LANGUAGE: 'fr-fr' },
    'W_INBOUND_CALL_v4',
  );
  const b = node(
    'b',
    'inboundcall',
    { DESCRIPTION: 'Nom B', WELCOME_AUDIO: 'tts:Bonjour B', LANGUAGE: 'en-gb' },
    'W_INBOUND_CALL_v5',
  );
  const result = compareFlows(flow('a', [a]), flow('b', [b]));
  assert.equal(
    result.items.some((item) => item.field === 'DESCRIPTION'),
    false,
  );
  assert.ok(result.items.every((item) => !item.copyable));
  b.tableName = a.tableName;
  assert.equal(
    compareFlows(flow('a', [a]), flow('b', [b])).items.find(
      (item) => item.field === 'WELCOME_AUDIO',
    ).copyable,
    true,
  );
  delete b.row.WELCOME_AUDIO;
  assert.equal(
    compareFlows(flow('a', [a]), flow('b', [b])).items.find(
      (item) => item.field === 'WELCOME_AUDIO',
    ).copyable,
    false,
  );
});

test('real inventory shape yields readable branches, resolved teams and terminal labels', () => {
  const inventory = buildVoiceInventory({
    tables: [
      {
        id: 'in',
        name: 'W_INBOUND_CALL_v5',
        rows: [
          {
            key: 'EXAMPLE_ENTRY',
            DESCRIPTION: 'Accueil exemple',
            NEXT_TARGET_TYPE: 'service',
            NEXT_TARGET: 'EXAMPLE_TEAM',
            DEFAULT_TARGET_TYPE: 'disconnect',
            DEFAULT_TARGET: '',
          },
        ],
      },
      {
        id: 'svc',
        name: 'W_SERVICES_v5',
        rows: [{ key: 'EXAMPLE_TEAM', DESCRIPTION: 'Équipe exemple', PRIORITY: '5' }],
      },
    ],
  });
  const routes = flowRoutes(inventory.flows[0]);
  assert.equal(routes[0].toTitle, 'Équipe exemple');
  assert.equal(routes[0].label, 'Puis');
  assert.equal(routes[1].toTitle, 'Fin d’appel');
  assert.equal(branchLabel({ branch: 'OPTIONDIEZ' }), 'Choix dièse (#)');
  assert.equal(
    flowRoutes(flow('a', [node('a', 'inboundcall')], [{ from: 'a', dynamic: true }]))[0].toTitle,
    'Destination déterminée pendant l’appel',
  );
});

test('complete journey comparison exposes added branches and changed destination types', () => {
  const a = node('a', 'inboundcall', { DESCRIPTION: 'Accueil A' }),
    a1 = node('a1', 'service', { DESCRIPTION: 'Conseillers' });
  const b = node('b', 'inboundcall', { DESCRIPTION: 'Accueil B' }),
    m = node('m', 'menu', { DESCRIPTION: 'Choix client' });
  const result = compareFlows(
    flow('a', [a, a1], [edge('a', 'a1', 'NEXT')]),
    flow(
      'b',
      [b, m],
      [
        edge('b', 'm', 'NEXT', 'menu'),
        { from: 'b', branch: 'DEFAULT', terminal: true, type: 'disconnect' },
      ],
    ),
  );
  const structural = result.items.filter((item) => item.structural);
  assert.equal(structural.length, 2);
  assert.ok(structural.every((item) => item.field === null && item.copyable === false));
  assert.ok(
    structural.some(
      (item) =>
        item.before.includes('Équipe de traitement') &&
        item.after.includes('Choix proposés au client'),
    ),
  );
  assert.ok(
    structural.some((item) => item.before === 'Branche absente' && item.after === 'Fin d’appel'),
  );
  assert.equal(result.unmatched.length, 2);
});

test('automatic controls are visible readonly business fields and participate in comparisons', () => {
  const a = node('a', 'inboundcall', { SUBROUTINES_LIST: 'CHECK_AGENT' });
  const b = node('b', 'inboundcall', { SUBROUTINES_LIST: 'CHECK_EWT' });
  const projected = businessFields(a)[0];
  assert.equal(projected.label, 'Contrôles automatiques au démarrage');
  assert.equal(projected.display, 'Disponibilité des conseillers');
  assert.equal(projected.editable, false);
  assert.equal(projected.copyable, false);
  const diff = compareFlows(flow('a', [a]), flow('b', [b]));
  assert.equal(diff.items.length, 1);
  assert.equal(diff.items[0].afterDisplay, 'Temps d’attente estimé');
});

test('waiting exit fallback catches changes when older inventory has no service edges', () => {
  const a = node('a', 'service', { INQUEUE_TARGET_TYPE: 'number', INQUEUE_TARGET: '+33100000000' });
  const b = node('b', 'service', { INQUEUE_TARGET_TYPE: 'number', INQUEUE_TARGET: '+33200000000' });
  const diff = compareFlows(flow('a', [a]), flow('b', [b]));
  assert.equal(diff.items.length, 1);
  assert.equal(diff.items[0].section, 'attente');
  assert.equal(diff.items[0].structural, true);
  assert.equal(diff.items[0].copyable, false);
  assert.match(diff.items[0].afterDisplay, /33200000000/);
});

test('target language and control modifiers differ even when the destination is identical', () => {
  const a = node('a', 'inboundcall', {
    NEXT_TARGET_TYPE: 'service|lang:fr-fr|sub:CHECK_AGENT',
    NEXT_TARGET: 'team-a',
  });
  const b = node('b', 'inboundcall', {
    NEXT_TARGET_TYPE: 'service|lang:en-gb|sub:CHECK_EWT',
    NEXT_TARGET: 'team-b',
  });
  const ta = node('team-a', 'service'),
    tb = node('team-b', 'service');
  const ea = {
    ...edge('a', 'team-a', 'NEXT'),
    field: 'NEXT_TARGET_TYPE',
    parameters: ['lang:fr-fr', 'sub:CHECK_AGENT'],
  };
  const eb = {
    ...edge('b', 'team-b', 'NEXT'),
    field: 'NEXT_TARGET_TYPE',
    parameters: ['lang:en-gb', 'sub:CHECK_EWT'],
  };
  const diff = compareFlows(flow('a', [a, ta], [ea]), flow('b', [b, tb], [eb]));
  assert.equal(diff.items.length, 2);
  assert.ok(diff.items.every((item) => item.modifier && !item.copyable));
  assert.ok(
    diff.items.some(
      (item) => item.beforeDisplay === 'Français' && item.afterDisplay === 'Anglais (Royaume-Uni)',
    ),
  );
  assert.ok(
    diff.items.some(
      (item) =>
        item.beforeDisplay === 'Disponibilité des conseillers' &&
        item.afterDisplay === 'Temps d’attente estimé',
    ),
  );
});

test('inventory service edges are not duplicated by comparison fallback', () => {
  const a = node('a', 'service', { INQUEUE_TARGET_TYPE: 'number', INQUEUE_TARGET: '+33100000000' });
  const b = node('b', 'service', { INQUEUE_TARGET_TYPE: 'number', INQUEUE_TARGET: '+33200000000' });
  const route = (from, target) => ({
    from,
    to: null,
    branch: 'INQUEUE',
    field: 'INQUEUE_TARGET_TYPE',
    type: 'number',
    target,
    terminal: true,
  });
  const diff = compareFlows(
    flow('a', [a], [route('a', a.row.INQUEUE_TARGET)]),
    flow('b', [b], [route('b', b.row.INQUEUE_TARGET)]),
  );
  assert.equal(diff.items.length, 1);
});

test('external queue destinations remain readable and are not counted twice', () => {
  const a = node('a', 'service', { QUEUE: 'EQUIPE_EXEMPLE_A' }),
    b = node('b', 'service', { QUEUE: 'EQUIPE_EXEMPLE_B' });
  const route = (from, target) => ({
    from,
    type: 'queue',
    target,
    field: 'QUEUE',
    branch: 'QUEUE',
    phase: 'distribution',
    terminal: true,
    externalReference: true,
  });
  const left = flow('a', [a], [route('a', a.row.QUEUE)]),
    right = flow('b', [b], [route('b', b.row.QUEUE)]);
  assert.match(flowRoutes(left)[0].toTitle, /^Équipe ·/);
  assert.equal(compareFlows(left, right).items.length, 1);
  assert.equal(compareFlows(left, right).items[0].copyable, false);
});

test('dynamic queue destinations remain dynamic even when a saved edge also has a terminal flag', () => {
  const service = node('service', 'service', { QUEUE: 'variable' });
  const route = {
    from: service.id,
    type: 'queue',
    target: 'variable',
    field: 'QUEUE',
    branch: 'QUEUE',
    dynamic: true,
    terminal: true,
  };
  const original = structuredClone({ service, route });
  assert.equal(
    flowRoutes(flow('entry', [service], [route]))[0].toTitle,
    'File choisie pendant l’appel',
  );
  assert.equal(
    businessFields(service).find((field) => field.key === 'QUEUE').display,
    'File choisie pendant l’appel',
  );
  assert.deepEqual({ service, route }, original);

  const expression = { ...route, target: '$var:Eic_AttDynamicQueue$' };
  assert.equal(
    flowRoutes(flow('entry', [service], [expression]))[0].toTitle,
    'Destination déterminée pendant l’appel',
  );
  const number = { ...expression, type: 'number' };
  assert.equal(
    flowRoutes(flow('entry', [service], [number]))[0].toTitle,
    'Destination déterminée pendant l’appel',
  );
});

test('only the exact reserved queue value receives the dynamic queue description', () => {
  assert.equal(describeValue('QUEUE', 'variable'), 'File choisie pendant l’appel');
  assert.equal(describeValue('QUEUE', 'VARIABLE'), 'File choisie pendant l’appel');
  assert.notEqual(describeValue('QUEUE', 'variable '), 'File choisie pendant l’appel');
  assert.notEqual(describeValue('QUEUE', ' variable'), 'File choisie pendant l’appel');
  assert.equal(describeValue('QUEUE', 'EQUIPE_SINISTRES'), 'Equipe Sinistres');
  assert.equal(describeValue('DESCRIPTION', 'variable'), 'variable');
  const service = node('service', 'service', { QUEUE: 'variable ' });
  assert.equal(businessFields(service).find((field) => field.key === 'QUEUE').value, 'variable ');
});

test('padded reserved queue values are flagged without normalizing their source or resolution', () => {
  for (const raw of ['variable ', ' variable', '\tVARIABLE\n']) {
    const service = node('service', 'service', { QUEUE: raw });
    const route = {
      from: service.id,
      type: 'queue',
      target: raw,
      field: 'QUEUE',
      terminal: true,
      resolved: true,
      dynamic: false,
    };
    const original = structuredClone({ service, route });
    assert.equal(describeValue('QUEUE', raw), 'File à vérifier · espaces dans la valeur');
    const presented = flowRoutes(flow('entry', [service], [route]))[0];
    assert.equal(presented.toTitle, 'File à vérifier');
    assert.equal(presented.dynamic, false);
    assert.equal(presented.resolved, true);
    assert.equal(presented.edge.target, raw);
    assert.deepEqual(nodeConfigurationNotes(service), [
      {
        message:
          'La destination contient des espaces autour du mot « variable ». Son interprétation est à vérifier.',
        detail: JSON.stringify(raw),
      },
    ]);
    assert.deepEqual({ service, route }, original);
  }
  assert.deepEqual(nodeConfigurationNotes(node('team', 'service', { QUEUE: 'variable' })), []);
  assert.deepEqual(
    nodeConfigurationNotes(node('team', 'service', { QUEUE: ' Équipe sinistres ' })),
    [],
  );
});

test('transition spelling notes stay specific and preserve the unknown parameter verbatim', () => {
  const service = node('service', 'service', {
    INQUEUE_TARGET_TYPE: 'service|satus:IDLE',
    NEXT_TARGET_TYPE: 'service|status:IDLE',
    DESCRIPTION: '|satus:IDLE',
  });
  const original = structuredClone(service);
  assert.deepEqual(nodeConfigurationNotes(service), [
    {
      message: 'Un paramètre de la transition semble mal orthographié.',
      detail: 'INQUEUE_TARGET_TYPE : "service|satus:IDLE" · « satus » non reconnu par le Studio.',
    },
  ]);
  assert.deepEqual(service, original);
  assert.deepEqual(nodeConfigurationNotes(null), []);
});

test('context nodes on distinct menu branches pair by originating choice, not row identity', () => {
  const a = node('a', 'inboundcall'),
    b = node('b', 'inboundcall');
  const ca1 = node('context-a1', 'pdata', { PDATA_LIST_1: 'motif==Contrat' });
  const ca2 = node('context-a2', 'pdata', { PDATA_LIST_1: 'motif==Sinistre' });
  const cb1 = node('context-b1', 'pdata', { PDATA_LIST_1: 'motif==Contrat' });
  const cb2 = node('context-b2', 'pdata', { PDATA_LIST_1: 'motif==Sinistre' });
  const context = (from, to, field) => ({
    from,
    to,
    type: 'pdata',
    field,
    destinationField: field,
    relationship: 'context',
    label: 'Attributs métier',
    resolved: true,
  });
  const left = flow(
    'a',
    [a, ca1, ca2],
    [context('a', ca1.id, 'OPTION1_TARGET'), context('a', ca2.id, 'DEFAULT_TARGET')],
  );
  const right = flow(
    'b',
    [b, cb2, cb1],
    [context('b', cb2.id, 'DEFAULT_TARGET'), context('b', cb1.id, 'OPTION1_TARGET')],
  );
  const result = compareFlows(left, right);
  assert.equal(result.ambiguous.length, 0);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.matches.find((match) => match.leftNode.id === ca1.id).rightNode.id, cb1.id);
  cb1.row.PDATA_LIST_1 = 'motif==Conseil';
  const changed = compareFlows(left, right);
  assert.equal(changed.items.length, 1);
  assert.equal(changed.items[0].leftNode.id, ca1.id);
  assert.equal(changed.items[0].rightNode.id, cb1.id);
});
