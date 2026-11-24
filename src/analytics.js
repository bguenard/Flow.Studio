/** Read-only Genesys Cloud analytics; no OAuth/configuration mutation or persistence.
 * Contracts: official platform-client-sdk-dotnet ConversationAggregationQuery,
 * QueueObservationQuery and platform-client-sdk-javascript AnalyticsApi/RoutingApi.
 */
import { GENESYS_API_ORIGIN } from './genesys-direct.js';

const API = `${GENESYS_API_ORIGIN}/api/v2`;
export const ANALYTICS_TIME_ZONE = 'Europe/Paris';
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const uuid = (value) => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
const text = (value) => (value == null ? '' : String(value));
const abort = () =>
  Object.assign(new Error('Lecture des statistiques annulée.'), { name: 'AbortError' });
const check = (signal) => {
  if (signal?.aborted) throw abort();
};
const predicate = (dimension, value) => ({
  type: 'dimension',
  dimension,
  operator: 'matches',
  value,
});
const emptyMetrics = () => ({
  connected: null,
  offered: null,
  answered: null,
  abandoned: null,
  averageWaitMs: null,
});

function parisParts(time) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ANALYTICS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(time))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}
function midnight(calendarDate) {
  const target = Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day);
  let estimate = target;
  for (let i = 0; i < 3; i++) {
    const part = parisParts(estimate);
    estimate +=
      target - Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  }
  return estimate;
}
function shiftDay(parts, offset) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
export function analyticsPeriod(period = 'today', now = Date.now()) {
  const endTime = new Date(now).getTime();
  if (!Number.isFinite(endTime)) throw new Error('Date des statistiques invalide.');
  if (!['today', 'yesterday', 'week'].includes(period))
    throw new Error('Période des statistiques inconnue.');
  const date = parisParts(endTime);
  const start = midnight(shiftDay(date, period === 'yesterday' ? -1 : period === 'week' ? -6 : 0));
  const end = period === 'yesterday' ? midnight(date) : endTime;
  return {
    period,
    interval: `${new Date(start).toISOString()}/${new Date(Math.max(end, start + 1)).toISOString()}`,
    timeZone: ANALYTICS_TIME_ZONE,
    granularity: period === 'week' ? 'P1D' : 'PT1H',
  };
}

/** Static queues are taken from a baseline flow, never from unpublished changes. */
export function flowQueueReferences(flow) {
  const values = new Set();
  for (const node of flow?.nodes || [])
    if (
      ['service', 'distribution'].includes(text(node.type).toLowerCase()) &&
      node.row?.QUEUE != null &&
      text(node.row.QUEUE) !== ''
    )
      values.add(text(node.row.QUEUE));
  for (const edge of flow?.edges || [])
    if (text(edge.type).toLowerCase() === 'queue' && edge.target) values.add(text(edge.target));
  let dynamicCount = 0;
  const fixed = [],
    warnings = [];
  for (const value of values) {
    if (/^variable$/i.test(value.trim()) || /[|]|\$?var:/i.test(value)) {
      dynamicCount++;
      continue;
    }
    if (value !== value.trim()) {
      warnings.push(
        `La référence de file « ${value.trim()} » contient des espaces : son association doit être vérifiée.`,
      );
      continue;
    }
    fixed.push(value);
  }
  if (dynamicCount)
    warnings.push(
      'Certaines destinations sont choisies pendant l’appel : elles ne peuvent pas être déduites des tables pour afficher leurs agents.',
    );
  return { static: fixed, dynamicCount, warnings };
}

export function conversationAnalyticsQuery(dnis, range) {
  const number = text(dnis).replace(/^tel:/i, '');
  if (!/^\+?\d{3,20}$/.test(number))
    throw new Error(
      'Le parcours ne possède pas de numéro appelé exploitable pour les statistiques.',
    );
  return {
    interval: range.interval,
    granularity: range.granularity,
    timeZone: range.timeZone,
    filter: {
      type: 'and',
      predicates: [predicate('mediaType', 'voice'), predicate('originatingDirection', 'inbound')],
      clauses: [
        { type: 'or', predicates: [predicate('dnis', number), predicate('dnis', `tel:${number}`)] },
      ],
    },
    metrics: ['nConnected', 'nOffered', 'tAnswered', 'tAbandon'],
  };
}

/** Absent measurements stay unknown. Queue entries are not unique calls. */
export function parseConversationAnalytics(payload) {
  if (!payload || (payload.results != null && !Array.isArray(payload.results)))
    throw new Error('Réponse des statistiques historiques invalide.');
  const totals = {
      connected: null,
      offered: null,
      answered: null,
      abandoned: null,
      waitSum: null,
      waitCount: null,
    },
    bucketMap = new Map();
  let waitComplete = true;
  const add = (target, key, value) => {
    if (finite(value)) target[key] = (target[key] ?? 0) + value;
  };
  for (const result of payload.results || []) {
    if (!Array.isArray(result.data))
      throw new Error('Les intervalles des statistiques sont incomplets.');
    for (const data of result.data) {
      if (!data.interval || !Array.isArray(data.metrics))
        throw new Error('Un intervalle des statistiques est invalide.');
      let bucket = bucketMap.get(data.interval);
      if (!bucket) {
        const [start, end] = data.interval.split('/');
        bucket = { start, end, connected: null, offered: null, answered: null, abandoned: null };
        bucketMap.set(data.interval, bucket);
      }
      for (const metric of data.metrics) {
        const stats = metric.stats || {};
        if (metric.metric === 'nConnected') {
          add(totals, 'connected', stats.count);
          add(bucket, 'connected', stats.count);
        }
        if (metric.metric === 'nOffered') {
          add(totals, 'offered', stats.count);
          add(bucket, 'offered', stats.count);
        }
        if (metric.metric === 'tAnswered') {
          add(totals, 'answered', stats.count);
          add(bucket, 'answered', stats.count);
          if (finite(stats.sum) && finite(stats.count)) {
            add(totals, 'waitSum', stats.sum);
            add(totals, 'waitCount', stats.count);
          } else if (stats.count !== 0) waitComplete = false;
        }
        if (metric.metric === 'tAbandon') {
          add(totals, 'abandoned', stats.count);
          add(bucket, 'abandoned', stats.count);
        }
      }
    }
  }
  return {
    status: bucketMap.size ? 'ready' : 'empty',
    metrics: {
      connected: totals.connected,
      offered: totals.offered,
      answered: totals.answered,
      abandoned: totals.abandoned,
      averageWaitMs:
        waitComplete && totals.waitCount > 0 ? totals.waitSum / totals.waitCount : null,
    },
    buckets: [...bucketMap.values()].sort((a, b) => a.start.localeCompare(b.start)),
  };
}

export function queueObservationsQuery(queues) {
  if (!queues.length || queues.some((queue) => !uuid(queue.id)))
    throw new Error('Les files à observer ne sont pas identifiées.');
  // A mediaType filter would discard agent groups, which have no media dimension.
  return {
    filter: { type: 'or', predicates: queues.map((queue) => predicate('queueId', queue.id)) },
    metrics: ['oWaiting', 'oInteracting', 'oOnQueueUsers'],
  };
}

export function parseQueueObservations(payload, queues) {
  if (!payload || (payload.results != null && !Array.isArray(payload.results)))
    throw new Error('Réponse de l’activité des files invalide.');
  const rows = new Map(
    queues.map((queue) => [
      queue.id,
      {
        id: queue.id,
        name: queue.name,
        waiting: null,
        interacting: null,
        onQueue: null,
        available: null,
      },
    ]),
  );
  const members = new Map();
  for (const result of payload.results || []) {
    const row = rows.get(result.group?.queueId);
    if (!row) continue;
    if (!Array.isArray(result.data))
      throw new Error('Les mesures de l’activité des files sont incomplètes.');
    for (const metric of result.data) {
      const count = metric.stats?.count;
      if (!finite(count)) continue;
      if (result.group.mediaType === 'voice') {
        if (metric.metric === 'oWaiting') row.waiting = count;
        if (metric.metric === 'oInteracting') row.interacting = count;
      } else if (!result.group.mediaType && metric.metric === 'oOnQueueUsers') {
        if (!members.has(row.id)) members.set(row.id, new Map());
        members.get(row.id).set(metric.qualifier || '', count);
        if (metric.qualifier === 'IDLE') row.available = count;
      }
    }
  }
  for (const [id, values] of members)
    rows.get(id).onQueue = values.has('')
      ? values.get('')
      : [...values.values()].reduce((sum, count) => sum + count, 0);
  return { status: rows.size ? 'ready' : 'empty', queues: [...rows.values()] };
}

function statusError(status, response, now) {
  const message =
    status === 401
      ? 'La session Genesys a expiré. Reconnectez-vous.'
      : status === 403
        ? 'Votre compte ou le client OAuth ne dispose pas des droits de lecture pour ces statistiques.'
        : status === 429
          ? 'Genesys limite momentanément les lectures. Patientez avant d’actualiser.'
          : `Lecture des statistiques impossible (HTTP ${status}).`;
  const error = Object.assign(new Error(message), { status });
  if (status === 429) {
    const value = response.headers?.get?.('Retry-After'),
      seconds = Number(value);
    error.retryAfterMs =
      value != null && value !== ''
        ? Math.max(
            1000,
            Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now || 60000,
          )
        : 60000;
  }
  return error;
}

export async function loadJourneyAnalytics(token, flow, options = {}) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))
    throw new Error('Connectez-vous à Genesys pour consulter l’activité.');
  const now = typeof options.now === 'function' ? options.now() : (options.now ?? Date.now());
  const range = analyticsPeriod(options.period, now),
    query = conversationAnalyticsQuery(flow?.dnis, range),
    references = flowQueueReferences(flow);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const request = async (path, body) => {
    check(options.signal);
    const controller = new AbortController(),
      listener = () => controller.abort(),
      timer = setTimeout(() => controller.abort(), 20000);
    options.signal?.addEventListener('abort', listener, { once: true });
    try {
      let response;
      try {
        response = await fetchImpl(API + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal,
        });
      } catch {
        check(options.signal);
        throw new Error(
          'Lecture Genesys indisponible. Vérifiez la connexion réseau puis actualisez.',
        );
      }
      check(options.signal);
      if (!response.ok) throw statusError(response.status, response, new Date(now).getTime());
      try {
        return await response.json();
      } catch {
        throw new Error('La réponse de Genesys est illisible.');
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', listener);
    }
  };
  const warnings = [...references.warnings];
  async function resolveQueues() {
    const resolved = new Map();
    for (const name of references.static) {
      if (uuid(name)) {
        const queue = await request(`/routing/queues/${encodeURIComponent(name)}`);
        if (queue?.id !== name || !queue.name)
          throw new Error('L’identité d’une file ne correspond plus au parcours.');
        resolved.set(queue.id, { id: queue.id, name: queue.name });
        continue;
      }
      const matches = new Map();
      let complete = false;
      for (let pageNumber = 1; pageNumber <= 20; pageNumber++) {
        const page = await request(
          '/routing/queues?' + new URLSearchParams({ name, pageNumber, pageSize: 100 }),
        );
        if (!Array.isArray(page?.entities))
          throw new Error('La liste des files Genesys est incomplète.');
        for (const queue of page.entities)
          if (queue.name === name && uuid(queue.id))
            matches.set(queue.id, { id: queue.id, name: queue.name });
        if (
          (Number.isFinite(page.pageCount) && pageNumber >= page.pageCount) ||
          (Number.isFinite(page.total) && pageNumber * 100 >= page.total) ||
          (!page.nextUri && page.entities.length < 100)
        ) {
          complete = true;
          break;
        }
        if (!page.entities.length) break;
      }
      if (!complete) {
        warnings.push(
          `La recherche de la file « ${name} » est incomplète ; elle n’est pas comptabilisée.`,
        );
        continue;
      }
      if (matches.size !== 1) {
        warnings.push(
          matches.size
            ? `Plusieurs files portent le nom « ${name} » : leur correspondance doit être précisée.`
            : `La file « ${name} » n’a pas été retrouvée parmi les files accessibles à votre compte.`,
        );
        continue;
      }
      for (const queue of matches.values()) resolved.set(queue.id, queue);
    }
    return [...resolved.values()];
  }
  const historyPromise = request('/analytics/conversations/aggregates/query', query).then(
    parseConversationAnalytics,
  );
  const livePromise = (async () => {
    if (references.static.length > 100)
      throw new Error('Ce parcours comporte trop de files pour une lecture simultanée.');
    const queues = await resolveQueues();
    if (!queues.length) return { status: 'empty', queues: [] };
    if (queues.length > 100)
      throw new Error('Ce parcours comporte trop de files pour une lecture simultanée.');
    return parseQueueObservations(
      await request('/analytics/queues/observations/query', queueObservationsQuery(queues)),
      queues,
    );
  })();
  const results = await Promise.allSettled([historyPromise, livePromise]);
  check(options.signal);
  const section = (result, base) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          ...base,
          status: 'error',
          error: result.reason.message,
          httpStatus: result.reason.status,
          retryAfterMs: result.reason.retryAfterMs,
        };
  return {
    dnis: flow.dnis,
    ...range,
    updatedAt: new Date().toISOString(),
    history: section(results[0], { metrics: emptyMetrics(), buckets: [] }),
    live: section(results[1], { queues: [] }),
    scopeWarnings: warnings,
  };
}
