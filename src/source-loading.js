/** A partial catalogue must never be used for editing, simulation or publication. */
export function allowedDuringSourceLoad(action, view) {
  if (action === 'nav') return ['catalogue', 'references', 'settings'].includes(view);
  return [
    'catalogue-reset',
    'catalogue-model-clear',
    'source-retry',
    'logout',
    'refresh',
    'refresh-confirm',
    'refresh-cancel',
  ].includes(action);
}
