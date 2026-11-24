import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsPeriod,
  flowQueueReferences,
  conversationAnalyticsQuery,
  parseConversationAnalytics,
  queueObservationsQuery,
  parseQueueObservations,
  loadJourneyAnalytics,
} from '../src/analytics.js';

const id = '12345678-1234-1234-1234-123456789012';
const otherId = '22345678-1234-1234-1234-123456789012';
const flow = {
  dnis: '+33123456789',
  nodes: [{ type: 'service', row: { QUEUE: 'Conseil' } }],
  edges: [],
};
const ok = (value) => ({ ok: true, status: 200, json: async () => value });
const metric = (name, stats, qualifier) => ({
  metric: name,
  stats,
  ...(qualifier ? { qualifier } : {}),
});
const bucket = (interval, metrics) => ({ interval, metrics });

test('Paris day boundaries and yesterday cover DST transitions rather than fixed 24h windows', () => {
  const spring = analyticsPeriod('yesterday', Date.parse('2026-03-30T10:00:00Z'));
  assert.equal(spring.interval, '2026-03-28T23:00:00.000Z/2026-03-29T22:00:00.000Z');
  const autumn = analyticsPeriod('yesterday', Date.parse('2026-10-26T10:00:00Z'));
  assert.equal(autumn.interval, '2026-10-24T22:00:00.000Z/2026-10-25T23:00:00.000Z');
  const today = analyticsPeriod('today', Date.parse('2026-11-23T10:30:00Z'));
  assert.equal(today.interval, '2026-11-22T23:00:00.000Z/2026-11-23T10:30:00.000Z');
  assert.equal(
    analyticsPeriod('week', Date.parse('2026-11-23T10:30:00Z')).interval,
    '2026-11-16T23:00:00.000Z/2026-11-23T10:30:00.000Z',
  );
  assert.throws(() => analyticsPeriod('month'), /inconnue/);
});

test('queue associations retain exact static references and report dynamic or padded values without guessing', () => {
  const data = {
    nodes: [
      { type: 'service', row: { QUEUE: 'Conseil' } },
      { type: 'service', row: { QUEUE: 'variable' } },
      { type: 'service', row: { QUEUE: ' Assistance ' } },
      { type: 'pdata', row: { QUEUE: 'Not a target' } },
    ],
    edges: [
      { type: 'queue', target: 'Conseil' },
      { type: 'queue', target: id },
    ],
  };
  const before = structuredClone(data),
    refs = flowQueueReferences(data);
  assert.deepEqual(refs.static, ['Conseil', id]);
  assert.equal(refs.dynamicCount, 1);
  assert.equal(refs.warnings.length, 2);
  assert.deepEqual(data, before);
});

test('history query scopes inbound voice to the exact called number, never queue total or wildcard', () => {
  const range = analyticsPeriod('today', 1795428000000),
    query = conversationAnalyticsQuery(flow.dnis, range);
  assert.deepEqual(
    query.filter.predicates.map((p) => [p.dimension, p.value]),
    [
      ['mediaType', 'voice'],
      ['originatingDirection', 'inbound'],
    ],
  );
  assert.deepEqual(
    query.filter.clauses[0].predicates.map((p) => p.value),
    ['+33123456789', 'tel:+33123456789'],
  );
  assert.deepEqual(query.metrics, ['nConnected', 'nOffered', 'tAnswered', 'tAbandon']);
  assert.ok(!JSON.stringify(query).includes('queueId'));
  assert.throws(() => conversationAnalyticsQuery('DEMO_SEGMENT', range), /numéro appelé/);
});

test('historical counts use stats.count and wait uses a weighted mean, preserving null versus genuine zero', () => {
  const response = {
    results: [
      {
        data: [
          bucket('2026-11-23T00:00:00Z/2026-11-23T01:00:00Z', [
            metric('nOffered', { sum: 999, count: 10 }),
            metric('tAnswered', { count: 2, sum: 60000 }),
            metric('tAbandon', { count: 0 }),
            metric('nConnected', { count: 7, sum: 999 }),
          ]),
          bucket('2026-11-23T01:00:00Z/2026-11-23T02:00:00Z', [
            metric('nOffered', { count: 4 }),
            metric('tAnswered', { count: 1, sum: 60000 }),
            metric('nConnected', { count: 2, sum: 999 }),
          ]),
        ],
      },
    ],
  };
  const result = parseConversationAnalytics(response);
  assert.deepEqual(result.metrics, {
    connected: 9,
    offered: 14,
    answered: 3,
    abandoned: 0,
    averageWaitMs: 40000,
  });
  assert.equal(result.buckets[0].connected, 7);
  assert.equal(result.buckets[1].abandoned, null);
  response.results[0].data[1].metrics[1].stats.sum = undefined;
  assert.equal(
    parseConversationAnalytics(response).metrics.averageWaitMs,
    null,
    'missing wait sum must not silently produce a partial average',
  );
  assert.equal(parseConversationAnalytics({}).status, 'empty');
  assert.deepEqual(parseConversationAnalytics({ results: [] }).metrics, {
    connected: null,
    offered: null,
    answered: null,
    abandoned: null,
    averageWaitMs: null,
  });
  assert.throws(() => parseConversationAnalytics({ results: [{ data: {} }] }), /incomplets/);
});

test('queue observations separate voice calls from media-free agent states and never sum agents across queues', () => {
  const queues = [
    { id, name: 'Conseil' },
    { id: otherId, name: 'Assistance' },
  ];
  const query = queueObservationsQuery(queues);
  assert.ok(!JSON.stringify(query.filter).includes('mediaType'));
  const result = parseQueueObservations(
    {
      results: [
        {
          group: { queueId: id, mediaType: 'voice' },
          data: [metric('oWaiting', { count: 0 }), metric('oInteracting', { count: 4 })],
        },
        { group: { queueId: id, mediaType: 'email' }, data: [metric('oWaiting', { count: 900 })] },
        {
          group: { queueId: id },
          data: [
            metric('oOnQueueUsers', { count: 3 }, 'IDLE'),
            metric('oOnQueueUsers', { count: 4 }, 'INTERACTING'),
            metric('oOnQueueUsers', { count: 1 }, 'COMMUNICATING'),
          ],
        },
      ],
    },
    queues,
  );
  assert.deepEqual(result.queues[0], {
    id,
    name: 'Conseil',
    waiting: 0,
    interacting: 4,
    onQueue: 8,
    available: 3,
  });
  assert.deepEqual(result.queues[1], {
    id: otherId,
    name: 'Assistance',
    waiting: null,
    interacting: null,
    onQueue: null,
    available: null,
  });
  assert.equal(result.total, undefined);
  const unqualified = parseQueueObservations(
    {
      results: [
        {
          group: { queueId: id },
          data: [
            metric('oOnQueueUsers', { count: 5 }),
            metric('oOnQueueUsers', { count: 3 }, 'IDLE'),
          ],
        },
      ],
    },
    queues,
  );
  assert.equal(
    unqualified.queues[0].onQueue,
    5,
    'unqualified total is not added a second time to its qualifiers',
  );
});

test('client sends only readonly query POSTs and queue GETs to Dublin with bearer outside URL', async () => {
  const calls = [];
  const result = await loadJourneyAnalytics('test-token', flow, {
    now: 1795428000000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('routing/queues?'))
        return ok({ entities: [{ id, name: 'Conseil' }], pageCount: 1 });
      if (url.endsWith('/queues/observations/query'))
        return ok({
          results: [
            {
              group: { queueId: id, mediaType: 'voice' },
              data: [metric('oWaiting', { count: 2 })],
            },
          ],
        });
      return ok({ results: [] });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(result.live.queues[0].waiting, 2);
  assert.equal(result.history.status, 'empty');
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('https://api.mypurecloud.ie/api/v2/'));
    assert.ok(!url.includes('test-token'));
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, url.includes('/routing/') ? 'GET' : 'POST');
  }
  assert.ok(!JSON.stringify(result).includes('test-token'));
});

test('history permission refusal does not replace readable queue activity with zeros or failure', async () => {
  const result = await loadJourneyAnalytics('token', flow, {
    fetchImpl: async (url) => {
      if (url.includes('/conversations/aggregates/')) return { ok: false, status: 403 };
      if (url.includes('/routing/queues?'))
        return ok({ entities: [{ id, name: 'Conseil' }], pageCount: 1 });
      return ok({
        results: [
          { group: { queueId: id, mediaType: 'voice' }, data: [metric('oWaiting', { count: 2 })] },
        ],
      });
    },
  });
  assert.equal(result.history.status, 'error');
  assert.equal(result.history.httpStatus, 403);
  assert.equal(result.history.metrics.offered, null);
  assert.equal(result.live.status, 'ready');
  assert.equal(result.live.queues[0].waiting, 2);
});

test('429 respects retry-after and performs no immediate retry or fabricated values', async () => {
  let calls = 0;
  const result = await loadJourneyAnalytics(
    'token',
    { ...flow, nodes: [] },
    {
      fetchImpl: async () => {
        calls++;
        return { ok: false, status: 429, headers: { get: () => '120' } };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.history.retryAfterMs, 120000);
  assert.equal(result.history.metrics.offered, null);
  assert.equal(result.live.status, 'empty');
});

test('ambiguous exact queue names are excluded rather than selecting an arbitrary queue', async () => {
  let observations = 0;
  const result = await loadJourneyAnalytics('token', flow, {
    fetchImpl: async (url) => {
      if (url.includes('/routing/queues?'))
        return ok({
          entities: [
            { id, name: 'Conseil' },
            { id: otherId, name: 'Conseil' },
          ],
          pageCount: 1,
        });
      if (url.includes('/queues/observations/')) observations++;
      return ok({ results: [] });
    },
  });
  assert.equal(observations, 0);
  assert.equal(result.live.status, 'empty');
  assert.match(result.scopeWarnings[0], /Plusieurs files/);
});

test('cancel and token errors do not become successful empty analytics', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadJourneyAnalytics('token', flow, {
      signal: controller.signal,
      fetchImpl: async () => {
        assert.fail('no request');
      },
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(loadJourneyAnalytics('', flow), /Connectez-vous/);
  const result = await loadJourneyAnalytics(
    'secret-token',
    { ...flow, nodes: [] },
    {
      fetchImpl: async () => {
        throw new Error('secret-token');
      },
    },
  );
  assert.equal(result.history.status, 'error');
  assert.ok(!JSON.stringify(result).includes('secret-token'));
});
