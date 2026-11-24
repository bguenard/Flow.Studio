/** Demand-driven, cancellable Genesys reads. No configuration writes or synthetic metrics. */
import { loadJourneyAnalytics } from './analytics.js';

export function createLiveActivityController({
  getToken,
  load = loadJourneyAnalytics,
  onChange = () => {},
  now = () => Date.now(),
  schedule = setTimeout,
  unschedule = clearTimeout,
  intervalMs = 30000,
} = {}) {
  let state = {
      enabled: false,
      visible: true,
      loading: false,
      flow: null,
      data: null,
      error: '',
      nextRefreshAt: null,
    },
    generation = 0,
    timer = null,
    request = null;
  const emit = () => onChange({ ...state });
  function cancel() {
    generation++;
    if (timer !== null) unschedule(timer);
    timer = null;
    request?.abort();
    request = null;
    state = { ...state, loading: false, nextRefreshAt: null };
  }
  function stop() {
    cancel();
    state = { ...state, enabled: false };
    emit();
  }
  function planNext(data) {
    const sections = [data?.history, data?.live];
    if (
      sections.some((s) => s?.status === 'error' && s.httpStatus !== 429 && !(s.httpStatus >= 500))
    )
      return;
    const retry = Math.max(intervalMs, ...sections.map((s) => Number(s?.retryAfterMs) || 0));
    state = { ...state, nextRefreshAt: now() + retry };
    timer = schedule(() => {
      timer = null;
      void refresh();
    }, retry);
  }
  async function refresh() {
    if (!state.enabled || !state.visible || !state.flow) return;
    cancel();
    const run = generation,
      controller = new AbortController();
    request = controller;
    state = { ...state, loading: true, error: '' };
    emit();
    try {
      const token = getToken?.();
      if (!token) throw Error('Connectez-vous à Genesys pour afficher l’activité du parcours.');
      const data = await load(token, state.flow, { period: 'today', signal: controller.signal });
      if (run !== generation || !state.enabled || !state.visible) return;
      state = { ...state, data, error: '', loading: false };
      planNext(data);
    } catch (error) {
      if (run !== generation || controller.signal.aborted) return;
      state = {
        ...state,
        loading: false,
        error: error?.message || 'Lecture de l’activité indisponible.',
      };
      // Recoverable errors can be retried by the user; never hammer a denied API.
    } finally {
      if (run === generation) {
        request = null;
        emit();
      }
    }
  }
  function start(flow) {
    cancel();
    state = {
      ...state,
      enabled: true,
      flow: flow ? structuredClone(flow) : null,
      data: null,
      error: '',
      nextRefreshAt: null,
    };
    if (!flow) {
      state.error = 'Ce parcours n’est pas présent dans la version chargée de Genesys.';
      emit();
      return Promise.resolve();
    }
    emit();
    return refresh();
  }
  function setVisible(visible) {
    if (Boolean(visible) === state.visible) return;
    cancel();
    state = { ...state, visible: Boolean(visible) };
    emit();
    if (state.visible && state.enabled) void refresh();
  }
  return { start, refresh, stop, setVisible, getState: () => ({ ...state }) };
}

const dynamic = (value) =>
  !value || value !== value.trim() || /^variable$/i.test(value) || /[|]|\$?var:/i.test(value);
/** Queue observations describe the whole queue, never a single step or DNIS. */
export function queueForActivityNode(node, data) {
  if (!['service', 'distribution'].includes(String(node?.type || '').toLowerCase())) return null;
  const reference = String(node.row?.QUEUE ?? '');
  if (dynamic(reference)) return null;
  const matches = (data?.live?.status === 'ready' ? data.live.queues : []).filter(
    (q) => q.id === reference || q.name === reference,
  );
  return matches.length === 1 ? matches[0] : null;
}
