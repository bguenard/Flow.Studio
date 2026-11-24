import { comparisonChoice, advanceCallComparison, comparisonComplete } from './call-comparison.js';
import { simulationLanguage } from './simulation-audio.js';
import { comparisonPlaylist } from './call-comparison-audio.js';
/** One voice at a time. A transition waits for audio completion, never a guessed speech duration. */
export function createComparisonPlayback({
  getState,
  update,
  audio,
  onState = () => {},
  schedule = setTimeout,
  unschedule = clearTimeout,
  dwell = 1000,
}) {
  let generation = 0,
    visit = null,
    timer = null;
  const key = (c) => c.id + ':' + c.turn + ':' + c.cursor;
  function cancel() {
    generation++;
    unschedule(timer);
    timer = null;
    if (visit) audio.cancel();
    visit = null;
  }
  function sync() {
    const c = getState();
    if (!c?.playing || comparisonComplete(c)) {
      cancel();
      return;
    }
    const currentKey = key(c);
    if (visit?.key === currentKey) return;
    cancel();
    const run = generation;
    visit = { key: currentKey };
    const session = c.lanes[c.cursor];
    onState(c.audioEnabled ? 'loading' : 'muted', c.cursor);
    const stillCurrent = () => {
      const state = getState();
      return run === generation && state?.playing && key(state) === currentKey;
    };
    Promise.resolve()
      .then(() =>
        !stillCurrent()
          ? { cancelled: true }
          : c.audioEnabled
            ? audio.play(comparisonPlaylist(c), simulationLanguage(session))
            : { cancelled: false },
      )
      .then((result) => {
        if (result.cancelled || !stillCurrent()) return;
        onState('done', c.cursor);
        if (session.status === 'active' && !comparisonChoice(c).route) {
          onState('choice', c.cursor);
          return;
        }
        timer = schedule(() => {
          if (stillCurrent()) update(advanceCallComparison(getState()));
        }, dwell);
      })
      .catch((error) => {
        if (!stillCurrent()) return;
        update({ ...getState(), playing: false, audioError: error.message });
      });
  }
  return { sync, cancel };
}
