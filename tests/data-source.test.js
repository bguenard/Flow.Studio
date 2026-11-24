import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSnapshot,
  parseTableFile,
  buildVoiceInventory,
  loadFromApi,
} from '../src/data-source.js';

const voiceTables = () => ({
  tables: [
    {
      id: 'inbound',
      name: 'W_INBOUND_CALL_v5',
      schema: { properties: { key: { type: 'string' }, WELCOME_AUDIO: { type: 'string' } } },
      rows: [
        {
          key: '+33123456789',
          DESCRIPTION: 'Accueil sinistres',
          DIVISION: 'CR12',
          LANGUAGE: 'fr-fr',
          WELCOME_AUDIO: 'tts:Bienvenue',
          NEXT_TARGET_TYPE: 'schedulegroup|lang:fr-fr',
          NEXT_TARGET: 'CR12_HOURS',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: 'Erreur de configuration',
        },
      ],
    },
    {
      id: 'schedule',
      name: 'W_SCHEDULE_GROUP_v5',
      rows: [
        {
          key: 'CR12_HOURS',
          DESCRIPTION: 'Disponibilité sinistres',
          DIVISION: 'CR12',
          SCHEDULE_GROUP: 'Référence calendrier',
          OPEN_TARGET_TYPE: 'menu',
          OPEN_TARGET: 'CR12_MENU',
          CLOSED_TARGET_TYPE: 'disconnect',
          CLOSED_TARGET: 'Fermé',
        },
      ],
    },
    {
      id: 'menu',
      name: 'W_MENU_v5',
      rows: [
        {
          key: 'CR12_MENU',
          DIVISION: 'CR12',
          OPTION1_TARGET_TYPE: 'service',
          OPTION1_TARGET: 'CR12_SINISTRES',
          DEFAULT_TARGET_TYPE: 'inboundcall',
          DEFAULT_TARGET: '+33123456789',
        },
      ],
    },
    {
      id: 'service',
      name: 'W_SERVICES_v5',
      rows: [
        {
          key: 'CR12_SINISTRES',
          DESCRIPTION: 'Équipe sinistres',
          DIVISION: 'CR12',
          QUEUE: 'SINISTRES_CR12',
          PRIORITY: 2,
          SKILLS: 'Sinistre;Habitation',
          LANGUAGE_SKILL: 'Français',
          INQUEUE_TARGET_TYPE: 'inboundcall',
          INQUEUE_TARGET: '+33123456789',
        },
      ],
    },
  ],
});

test('normalization preserves real values and schema, derives documented keys, freezes deeply', () => {
  const input = {
    tables: [
      {
        name: 'W_INBOUND_CALL_v5',
        rows: [{ DNIS_SEGMENT: '00123', DESCRIPTION: 'Test', ENABLED: false, PRIORITY: 0 }],
      },
    ],
  };
  const result = normalizeSnapshot(input);
  assert.equal(result.tables[0].rows[0].key, '00123');
  assert.equal(result.tables[0].rows[0].ENABLED, false);
  assert.equal(result.tables[0].rows[0].PRIORITY, 0);
  assert.equal('key' in input.tables[0].rows[0], false);
  assert.ok(Object.isFrozen(result.tables[0].rows[0]));
  assert.throws(() => {
    result.tables[0].rows[0].DESCRIPTION = 'changed';
  }, TypeError);
  assert.deepEqual(
    normalizeSnapshot(voiceTables()).tables[0].schema,
    voiceTables().tables[0].schema,
  );
});

test('normalization rejects missing and duplicate row identities without discarding data', () => {
  assert.throws(
    () =>
      normalizeSnapshot({ tables: [{ name: 'W_SERVICES_v5', rows: [{ DESCRIPTION: 'No key' }] }] }),
    /clé.*manquante/,
  );
  assert.throws(
    () =>
      normalizeSnapshot({
        tables: [{ name: 'W_SERVICES_v5', rows: [{ key: 'a' }, { key: 'a' }] }],
      }),
    /clé en double/,
  );
  assert.throws(
    () =>
      normalizeSnapshot({
        tables: [
          { id: 'a', name: 'One', rows: [] },
          { id: 'a', name: 'Two', rows: [] },
        ],
      }),
    /Identifiant.*double/,
  );
});

test('CSV handles BOM, semicolons, escaped quotes, multiline audio and leading zeros', () => {
  const csv =
    '\uFEFFkey;DESCRIPTION;WELCOME_AUDIO;PRIORITY\r\n0012;"Accueil; spécial";"tts:Bonjour\nIl dit ""bonjour""";0\r\n';
  const result = parseTableFile(csv, 'W_INBOUND_CALL_v5.csv');
  assert.deepEqual(result.tables[0].rows[0], {
    key: '0012',
    DESCRIPTION: 'Accueil; spécial',
    WELCOME_AUDIO: 'tts:Bonjour\nIl dit "bonjour"',
    PRIORITY: '0',
  });
  const excel = parseTableFile('sep=;\nSERVICE;SKILLS\nSVC;"A;B"', 'download.csv', 'W_SERVICES_v5');
  assert.equal(excel.tables[0].rows[0].key, 'SVC');
  assert.equal(excel.tables[0].rows[0].SKILLS, 'A;B');
});

test('CSV detects comma and tab, rejects malformed quotes, header and row width', () => {
  assert.equal(
    parseTableFile('key,DESCRIPTION\nx,"A,B"', 'W_SERVICES_v5.csv').tables[0].rows[0].DESCRIPTION,
    'A,B',
  );
  assert.equal(
    parseTableFile('key\tDESCRIPTION\nx\tExample', 'W_SERVICES_v5.csv').tables[0].rows[0]
      .DESCRIPTION,
    'Example',
  );
  assert.throws(
    () => parseTableFile('key;DESCRIPTION\nx;"unfinished', 'W_SERVICES_v5.csv'),
    /non terminée/,
  );
  assert.throws(() => parseTableFile('key;key\nx;y', 'W_SERVICES_v5.csv'), /en-tête/);
  assert.throws(() => parseTableFile('key;DESCRIPTION\nx;y;z', 'W_SERVICES_v5.csv'), /colonnes/);
  assert.throws(() => parseTableFile('key\nx', 'export.csv'), /nom exact/);
});

test('JSON accepts complete snapshots, one table and raw Genesys entities with table name', () => {
  assert.equal(parseTableFile(JSON.stringify(voiceTables()), 'snapshot.json').tables.length, 4);
  assert.equal(
    parseTableFile(JSON.stringify(voiceTables().tables[0]), 'any.json').tables[0].name,
    'W_INBOUND_CALL_v5',
  );
  assert.equal(
    parseTableFile('{"entities":[{"key":"SVC","PRIORITY":7}]}', 'W_SERVICES_v5.json').tables[0]
      .rows[0].PRIORITY,
    7,
  );
  assert.throws(() => parseTableFile('{"entities":[{"key":"SVC"}]}', 'export.json'), /nom exact/);
  assert.throws(() => parseTableFile('{oops}', 'export.json'), /JSON invalide/);
});

test('voice graph resolves actual schedule, menu and service, preserves cycle without recursion', () => {
  const result = buildVoiceInventory(voiceTables());
  assert.equal(result.flows.length, 1);
  const flow = result.flows[0];
  assert.equal(flow.name, 'Accueil sinistres');
  assert.equal(flow.media, 'voice');
  assert.equal(flow.dnis, '+33123456789');
  assert.equal(flow.nodes.length, 4);
  assert.equal(flow.edges.length, 8);
  assert.equal(
    flow.edges.find((edge) => edge.field === 'INQUEUE_TARGET_TYPE').to,
    'inbound:+33123456789',
  );
  assert.equal(flow.edges.find((edge) => edge.field === 'QUEUE').target, 'SINISTRES_CR12');
  assert.equal(flow.schedules[0].row.SCHEDULE_GROUP, 'Référence calendrier');
  assert.equal(flow.services[0].row.QUEUE, 'SINISTRES_CR12');
  assert.equal(flow.services[0].row.PRIORITY, 2);
  assert.equal(flow.issues.length, 0);
  assert.equal(flow.status, 'Références résolues');
  assert.ok(flow.edges.every((edge) => edge.resolved));
});

test('missing table, missing row and invalid targets produce explicit, traceable findings', () => {
  const data = voiceTables();
  data.tables[1].rows[0].CLOSED_TARGET_TYPE = 'service';
  data.tables[1].rows[0].CLOSED_TARGET = 'DOES_NOT_EXIST';
  data.tables[2].rows[0].OPTION2_TARGET_TYPE = 'bot';
  data.tables[2].rows[0].OPTION2_TARGET = 'BOT';
  data.tables[2].rows[0].OPTION3_TARGET_TYPE = 'menu';
  data.tables[2].rows[0].OPTION3_TARGET = '';
  data.tables[2].rows[0].OPTION4_TARGET_TYPE = 'not_a_type';
  data.tables[2].rows[0].OPTION4_TARGET = 'XYZ';
  const result = buildVoiceInventory(data);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set(['missing-row', 'missing-table', 'missing-target', 'unsupported-target-type']),
  );
  assert.ok(result.issues.every((issue) => issue.flowId && issue.field));
  assert.equal(result.flows[0].status, 'À vérifier');
});

test('ambiguous table names and cross-division references are not treated as resolved compliance', () => {
  const data = voiceTables();
  data.tables[3].rows[0].DIVISION = 'Mutuaide';
  assert.ok(
    buildVoiceInventory(data).issues.some((issue) => issue.code === 'cross-division-reference'),
  );
  data.tables.push({ ...structuredClone(data.tables[3]), id: 'other-service' });
  assert.ok(buildVoiceInventory(data).issues.some((issue) => issue.code === 'ambiguous-table'));
  assert.equal(buildVoiceInventory({ tables: [] }).issues[0].code, 'missing-inbound-table');
});

test('prototype-named targets and branch labels are treated as data, never dictionary members', () => {
  const data = voiceTables();
  data.tables[0].rows[0].NEXT_TARGET_TYPE = 'constructor';
  data.tables[0].rows[0].constructor_TARGET_TYPE = '__proto__';
  data.tables[0].rows[0].constructor_TARGET = 'anything';
  const result = buildVoiceInventory(data);
  assert.equal(result.issues.filter((issue) => issue.code === 'unsupported-target-type').length, 2);
  assert.equal(
    result.flows[0].edges.find((edge) => edge.branch === 'constructor').label,
    'constructor',
  );
});

function apiMock(routes, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname + new URL(url).search;
    assert.ok(routes[path], `Unexpected request: ${path}`);
    return { ok: true, status: 200, json: async () => structuredClone(routes[path]) };
  };
}
const apiRoutes = () => ({
  '/api/datatables?pageNumber=1&pageSize=100': {
    entities: [{ id: 'table-1', name: 'W_SERVICES_v5' }],
    pageCount: 1,
    pageNumber: 1,
  },
  '/api/datatables/table-1': {
    id: 'table-1',
    name: 'W_SERVICES_v5',
    schema: { properties: { PRIORITY: { type: 'integer' } } },
  },
  '/api/datatables/table-1/rows?pageNumber=1&pageSize=100': {
    entities: [{ key: 'a', PRIORITY: 3 }],
    pageCount: 2,
    pageNumber: 1,
  },
  '/api/datatables/table-1/rows?pageNumber=2&pageSize=100': {
    entities: [{ key: 'b', PRIORITY: 7 }],
    pageCount: 2,
    pageNumber: 2,
  },
});

test('BFF loader reads schema and all pages with GET only and keeps session token out of snapshot', async () => {
  const calls = [];
  const result = await loadFromApi('https://bff.example/api/', 'session-jwt', {
    fetchImpl: apiMock(apiRoutes(), calls),
  });
  assert.equal(result.tables[0].rows.length, 2);
  assert.equal(result.tables[0].rows[1].PRIORITY, 7);
  assert.equal(result.source.readOnly, true);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every((call) => call.options.method === 'GET' && call.options.redirect === 'error'),
  );
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer session-jwt'));
  assert.equal(JSON.stringify(result).includes('session-jwt'), false);
  assert.ok(Object.isFrozen(result.tables[0].schema));
});

test('BFF rejects insecure remote endpoint and identity mismatch; external nextUri is not followed', async () => {
  await assert.rejects(loadFromApi('http://bff.example', '', { fetchImpl: apiMock({}) }), /HTTPS/);
  await assert.rejects(
    loadFromApi('https://secret@bff.example', '', { fetchImpl: apiMock({}) }),
    /identifiants/,
  );
  const routes = apiRoutes();
  routes['/api/datatables?pageNumber=1&pageSize=100'].nextUri = 'https://attacker.example/collect';
  const calls = [];
  await loadFromApi('https://bff.example', 'secret', { fetchImpl: apiMock(routes, calls) });
  assert.ok(calls.every((call) => new URL(call.url).origin === 'https://bff.example'));
  routes['/api/datatables/table-1'].id = 'wrong-id';
  await assert.rejects(
    loadFromApi('https://bff.example', '', { fetchImpl: apiMock(routes) }),
    /Identité/,
  );
});

test('BFF honors explicit hasMore even when a partial page has fewer than 100 rows', async () => {
  const routes = apiRoutes();
  delete routes['/api/datatables/table-1/rows?pageNumber=1&pageSize=100'].pageCount;
  delete routes['/api/datatables/table-1/rows?pageNumber=2&pageSize=100'].pageCount;
  routes['/api/datatables/table-1/rows?pageNumber=1&pageSize=100'].hasMore = true;
  routes['/api/datatables/table-1/rows?pageNumber=2&pageSize=100'].hasMore = false;
  const result = await loadFromApi('https://bff.example', '', { fetchImpl: apiMock(routes) });
  assert.equal(result.tables[0].rows.length, 2);
});

test('BFF fails closed on refused access or unknown pagination rather than returning partial data', async () => {
  await assert.rejects(
    loadFromApi('https://bff.example', '', { fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /refusé/,
  );
  await assert.rejects(
    loadFromApi('https://bff.example', '', {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          entities: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
        }),
      }),
    }),
    /pagination absentes/,
  );
});

const mixedVoiceTables = () => ({
  tables: [
    {
      id: 'in4',
      name: 'W_INBOUND_CALL_v4',
      rows: [
        {
          key: 'VOICE_ENTRY',
          DESCRIPTION: 'Agence Alpha',
          SCHEDULE_GROUP: 'AGENDA_ALPHA',
          EMERGENCY_GROUP: '',
          OPEN_TARGET_TYPE: 'ScheduleGroup',
          OPEN_TARGET: 'HOURS',
          CLOSED_TARGET_TYPE: 'Disconnect',
          CLOSED_TARGET: 'Fermeture',
        },
      ],
    },
    {
      id: 'in5',
      name: 'W_INBOUND_CALL_v5',
      rows: [
        {
          key: 'VOICE_ENTRY',
          DESCRIPTION: 'Agence Bêta',
          NEXT_TARGET_TYPE: 'service',
          NEXT_TARGET: 'TEAM',
        },
      ],
    },
    {
      id: 'hours4',
      name: 'W_SCHEDULE_GROUP_v4',
      rows: [
        {
          key: 'HOURS',
          OPEN_TARGET_TYPE: 'Menu',
          OPEN_TARGET: 'MENU',
          CLOSED_TARGET_TYPE: 'disconnect',
          CLOSED_TARGET: 'Fermeture',
        },
      ],
    },
    {
      id: 'menu4',
      name: 'W_MENU_v4',
      rows: [
        {
          key: 'MENU',
          OPTION1_AUDIO: 'tts:Service alpha',
          OPTION1_TARGET_TYPE: 'Service',
          OPTION1_TARGET: 'TEAM|pdata:CONTEXT_A;CONTEXT_B',
          DEFAULT_TARGET_TYPE: 'standardcallflow',
          DEFAULT_TARGET: 'VOICE_ENTRY',
        },
      ],
    },
    {
      id: 'dist4',
      name: 'W_DISTRIBUTION_v4',
      rows: [{ key: 'TEAM', QUEUE: 'QUEUE_ALPHA', PRIORITY: 1 }],
    },
    {
      id: 'svc5',
      name: 'W_SERVICES_v5',
      rows: [{ key: 'TEAM', QUEUE: 'QUEUE_BETA', PRIORITY: 7 }],
    },
    {
      id: 'pd4',
      name: 'W_PARTICIPANT_DATA_v4',
      rows: [
        { key: 'CONTEXT_A', PDATA_LIST_1: 'topic==alpha' },
        { key: 'CONTEXT_B', PDATA_LIST_1: 'route==standard' },
      ],
    },
    {
      id: 'pd5',
      name: 'W_PARTICIPANT_DATA_v5',
      rows: [{ key: 'CONTEXT_A', PDATA_LIST_1: 'topic==beta' }],
    },
  ],
});

test('v4 and v5 inventories keep same-named entry keys and destinations version-isolated', () => {
  const inventory = buildVoiceInventory(mixedVoiceTables());
  assert.equal(inventory.flows.length, 2);
  assert.deepEqual(inventory.counts.versions, { 4: 1, 5: 1 });
  const oldFlow = inventory.flows.find((flow) => flow.version === '4');
  const newFlow = inventory.flows.find((flow) => flow.version === '5');
  assert.notEqual(oldFlow.id, newFlow.id);
  assert.equal(oldFlow.services[0].tableName, 'W_DISTRIBUTION_v4');
  assert.equal(oldFlow.services[0].row.QUEUE, 'QUEUE_ALPHA');
  assert.equal(newFlow.services[0].tableName, 'W_SERVICES_v5');
  assert.equal(newFlow.services[0].row.QUEUE, 'QUEUE_BETA');
  assert.ok(oldFlow.nodes.every((node) => node.version === '4' && /_v4$/i.test(node.tableName)));
  assert.equal(oldFlow.entrySchedule.scheduleGroup, 'AGENDA_ALPHA');
  assert.ok(
    oldFlow.schedules.some((node) => node.tableId === 'in4' && node.embeddedSchedule.embedded),
  );
  assert.equal(
    oldFlow.edges.find((edge) => edge.field === 'OPTION1_TARGET_TYPE').audio,
    'tts:Service alpha',
  );
  assert.equal(oldFlow.issues.length, 0);
});

test('a missing v4 service is never silently resolved through a v5 service', () => {
  const data = mixedVoiceTables();
  data.tables = data.tables.filter((table) => table.name !== 'W_DISTRIBUTION_v4');
  const flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.equal(flow.services.length, 0);
  assert.ok(
    flow.issues.some(
      (issue) => issue.code === 'missing-table' && issue.tableName === 'W_DISTRIBUTION_v4',
    ),
  );
});

test('PDATA suffix resolves context nodes in the same version and preserves exact field provenance', () => {
  const flow = buildVoiceInventory(mixedVoiceTables()).flows.find((item) => item.version === '4');
  assert.equal(flow.participantData.length, 2);
  assert.equal(flow.participantData[0].row.PDATA_LIST_1, 'topic==alpha');
  const contextEdges = flow.edges.filter((edge) => edge.relationship === 'context');
  assert.equal(contextEdges.length, 2);
  assert.ok(contextEdges.every((edge) => edge.field === 'OPTION1_TARGET' && edge.resolved));
  assert.equal(
    flow.edges.find((edge) => edge.field === 'OPTION1_TARGET_TYPE').rawTarget,
    'TEAM|pdata:CONTEXT_A;CONTEXT_B',
  );
});

test('v4 numbered ratio columns and legacy custom flow table resolve without v5 fallback', () => {
  const data = mixedVoiceTables();
  data.tables[0].rows[0].OPEN_TARGET_TYPE = 'RatioDistrib';
  data.tables[0].rows[0].OPEN_TARGET = 'LOAD_BALANCE';
  data.tables.push({
    id: 'ratio4',
    name: 'W_RATIO_DISTRIB_v4',
    rows: [
      {
        key: 'LOAD_BALANCE',
        RATIO_1: 50,
        TARGET_TYPE_1: 'service',
        TARGET_1: 'TEAM',
        TARGET_AUDIO_1: 'tts:Équipe',
        RATIO_2: 50,
        TARGET_TYPE_2: 'customcallflow',
        TARGET_2: 'FOLLOWUP',
        TARGET_AUDIO_2: '',
      },
    ],
  });
  data.tables.push({
    id: 'trf4',
    name: 'W_TRF_FLOW_v4',
    rows: [{ key: 'FOLLOWUP', FLOW_NAME: 'Followup flow' }],
  });
  const flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.ok(
    flow.nodes.some(
      (node) => node.type === 'transfercallflow' && node.tableName === 'W_TRF_FLOW_v4',
    ),
  );
  assert.equal(
    flow.edges.find((edge) => edge.field === 'TARGET_TYPE_1').destinationField,
    'TARGET_1',
  );
  assert.equal(flow.edges.find((edge) => edge.field === 'TARGET_TYPE_1').audio, 'tts:Équipe');
  assert.equal(flow.issues.length, 0);
});

test('exact whitespace keys are resolved as-is and near matches produce suggestions only', () => {
  const data = mixedVoiceTables();
  data.tables[0].rows[0].OPEN_TARGET_TYPE = 'service';
  data.tables[0].rows[0].OPEN_TARGET = ' TEAM ';
  data.tables
    .find((table) => table.id === 'dist4')
    .rows.push({ key: ' TEAM ', QUEUE: 'EXACT_WHITESPACE_QUEUE' });
  let flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.equal(flow.services[0].key, ' TEAM ');
  assert.equal(flow.services[0].row.QUEUE, 'EXACT_WHITESPACE_QUEUE');
  data.tables.find((table) => table.id === 'dist4').rows.pop();
  flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.equal(flow.services.length, 0);
  const issue = flow.issues.find((item) => item.code === 'whitespace-key-mismatch');
  assert.equal(issue.target, ' TEAM ');
  assert.deepEqual(issue.suggestions, ['TEAM']);
  assert.equal(flow.edges.find((edge) => edge.field === 'OPEN_TARGET_TYPE').target, ' TEAM ');
  assert.equal(flow.edges.find((edge) => edge.field === 'OPEN_TARGET_TYPE').resolved, false);
});

test('flow categories rely on explicit template or draft evidence, never phone-number or suffix heuristics', () => {
  const result = buildVoiceInventory({
    tables: [
      {
        id: 'entries',
        name: 'W_INBOUND_CALL_v4',
        rows: [
          { key: '[ENTITY]_ENTRY', DESCRIPTION: 'Generic' },
          { key: 'BUSINESS_ENTRY_V1', DESCRIPTION: 'Agency (template)' },
          { key: '+33000000000', DESCRIPTION: '[DRAFT_FROM_+33000000001] Draft' },
          { key: '+33000000001', DESCRIPTION: 'Customer service' },
          { key: 'ANOTHER_ENTRYPOINT_V1', DESCRIPTION: 'Configured branch' },
        ],
      },
    ],
  });
  assert.deepEqual(
    result.flows.map((flow) => flow.category),
    ['template', 'template', 'draft', 'configured', 'configured'],
  );
  assert.equal(result.counts.templates, 2);
  assert.equal(result.counts.drafts, 1);
  assert.equal(result.counts.configured, 2);
  assert.equal(
    result.flows.some((flow) => flow.category === 'production'),
    false,
  );
});

test('runtime variable targets remain visibly unresolved without a false missing-row error', () => {
  const data = mixedVoiceTables();
  data.tables[0].rows[0].OPEN_TARGET_TYPE = 'Service';
  data.tables[0].rows[0].OPEN_TARGET = 'variable';
  const flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.ok(
    flow.issues.some((issue) => issue.code === 'dynamic-target' && issue.severity === 'info'),
  );
  assert.equal(
    flow.issues.some((issue) => issue.code === 'missing-row'),
    false,
  );
  assert.equal(flow.edges.find((edge) => edge.field === 'OPEN_TARGET_TYPE').dynamic, true);
  assert.equal(flow.edges.find((edge) => edge.field === 'OPEN_TARGET_TYPE').resolved, false);
});

test('service exits include queue delivery, waiting route, saturation and no-agent alternatives', () => {
  const data = mixedVoiceTables();
  const service = data.tables.find((table) => table.id === 'dist4').rows[0];
  service.INQUEUE_TARGET_TYPE = 'standardcallflow';
  service.INQUEUE_TARGET = 'SECOND_ENTRY';
  service.INQUEUE_TARGET_AUDIO = 'tts:Nous vous proposons une autre prise en charge.';
  service.BUSY_QUEUE_TARGET_TYPE = 'disconnect';
  service.BUSY_QUEUE_TARGET = 'Saturation';
  service.NOTLOGGEDIN_TARGET_TYPE = 'voicemailqueue';
  service.NOTLOGGEDIN_TARGET = 'MESSAGERIE';
  data.tables[0].rows.push({
    key: 'SECOND_ENTRY',
    OPEN_TARGET_TYPE: 'Service',
    OPEN_TARGET: 'TEAM',
  });
  const flow = buildVoiceInventory(data).flows.find((item) => item.id === 'in4:VOICE_ENTRY');
  assert.ok(flow.nodes.some((node) => node.id === 'in4:SECOND_ENTRY'));
  const edges = flow.edges.filter((edge) => edge.from === 'dist4:TEAM');
  assert.equal(edges.length, 4);
  const delivery = edges.find((edge) => edge.field === 'QUEUE');
  assert.equal(delivery.type, 'queue');
  assert.equal(delivery.terminal, true);
  assert.equal(delivery.referenceVerified, false);
  assert.equal(delivery.phase, 'distribution');
  const waiting = edges.find((edge) => edge.field === 'INQUEUE_TARGET_TYPE');
  assert.equal(waiting.phase, 'waiting');
  assert.equal(waiting.conditional, true);
  assert.equal(waiting.to, 'in4:SECOND_ENTRY');
  assert.equal(waiting.audio, service.INQUEUE_TARGET_AUDIO);
  assert.equal(
    edges.find((edge) => edge.field === 'BUSY_QUEUE_TARGET_TYPE').label,
    'Si la file est saturée',
  );
  assert.equal(
    edges.find((edge) => edge.field === 'NOTLOGGEDIN_TARGET_TYPE').externalReference,
    true,
  );
  assert.equal(flow.nodes.filter((node) => node.id === 'dist4:TEAM').length, 1);
  assert.equal(flow.issues.length, 0);
});

test('waiting menus are conditionally reachable; next and consent control results need no destination', () => {
  const data = mixedVoiceTables();
  const service = data.tables.find((table) => table.id === 'dist4').rows[0];
  service.INQUEUE_MENU_1 = 'WAITING|EXACT_KEY';
  service.INQUEUE_REPEAT_MENU = 'WAITING|EXACT_KEY';
  service.INQUEUE_TARGET_TYPE = 'next';
  service.INQUEUE_TARGET = 'variable'; // next ignores its destination value.
  data.tables
    .find((table) => table.id === 'menu4')
    .rows.push({
      key: 'WAITING|EXACT_KEY',
      OPTION1_TARGET_TYPE: 'next',
      OPTION1_TARGET: '',
      OPTION2_TARGET_TYPE: 'enable',
      OPTION2_TARGET: '',
      OPTION3_TARGET_TYPE: 'disable',
      OPTION3_TARGET: '',
    });
  const flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.equal(flow.menus.length, 2);
  for (const field of ['INQUEUE_MENU_1', 'INQUEUE_REPEAT_MENU']) {
    const edge = flow.edges.find((item) => item.field === field);
    assert.equal(edge.target, 'WAITING|EXACT_KEY');
    assert.equal(edge.phase, 'waiting');
    assert.equal(edge.conditional, true);
    assert.equal(edge.resolved, true);
    assert.equal(edge.to, 'menu4:WAITING|EXACT_KEY');
  }
  assert.equal(flow.edges.find((edge) => edge.field === 'INQUEUE_TARGET_TYPE').terminal, true);
  assert.equal(flow.issues.length, 0);
});

test('dynamic service queues remain unresolved and literal queue names preserve all characters', () => {
  const data = mixedVoiceTables();
  const service = data.tables.find((table) => table.id === 'dist4').rows[0];
  service.QUEUE = 'variable';
  let flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  const dynamicQueue = flow.edges.find((edge) => edge.field === 'QUEUE');
  assert.equal(dynamicQueue.dynamic, true);
  assert.equal(dynamicQueue.resolved, false);
  assert.ok(
    flow.issues.some((issue) => issue.code === 'dynamic-target' && issue.field === 'QUEUE'),
  );
  service.QUEUE = ' Queue | East ';
  flow = buildVoiceInventory(data).flows.find((item) => item.version === '4');
  assert.equal(flow.edges.find((edge) => edge.field === 'QUEUE').target, ' Queue | East ');
  assert.equal(flow.issues.length, 0);
});
