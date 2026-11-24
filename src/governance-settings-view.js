import { esc, btn, notice } from './ui-kit.js';
const actions = (buttons) => `<div class="notice-actions">${buttons}</div>`;
export function governanceSettingsView(state = {}, divisions = []) {
  if (state.busy)
    return notice(
      '<strong>Enregistrement du référentiel en cours…</strong><p>Les lignes et leurs divisions sont vérifiées dans Genesys. La fenêtre peut rester ouverte pendant cette opération.</p>',
    );
  if (state.operationId)
    return notice(
      `<strong>Enregistrement à reprendre</strong><p>${esc(state.error || state.pending?.error || 'Le journal permet de terminer les écritures et de vérifier leur résultat.')} Si un autre administrateur travaille encore sur le référentiel, attendez la fin de son enregistrement.</p>${actions(btn('Reprendre l’enregistrement', 'governance-recover', 'secondary small') + btn('Relire le référentiel', 'governance-load', 'quiet small'))}`,
      'warning',
    );
  // Un référentiel qui fonctionne ne s'annonce pas : seul ce qui demande une action est affiché.
  if (state.status === 'ready') {
    if (state.pending)
      return notice(
        `<strong>Modification du référentiel non enregistrée</strong><p>${esc(state.pending.error || 'Reprenez la synchronisation.')}</p>${state.error ? `<p>${esc(state.error)}</p>` : ''}${actions(btn('Relire et réessayer', 'governance-retry', 'secondary small') + btn('Exporter la modification en attente', 'governance-pending-export', 'quiet small') + btn('Abandonner la modification en attente', 'governance-pending-discard', 'quiet small'))}`,
        'warning',
      );
    if (state.error)
      return notice(
        `<strong>Référentiel partagé</strong><p>${esc(state.error)}</p>${actions(btn('Relire le référentiel', 'governance-load', 'secondary small'))}`,
        'warning',
      );
    return '';
  }
  if (state.status === 'missing')
    return `<section class="settings-panel"><h2>Activer le référentiel partagé</h2><p>Les Core Models, leurs versions et les rattachements seront enregistrés dans Genesys et partagés entre administrateurs.</p><div class="field"><label for="governance-division">Division du référentiel *</label><select id="governance-division" required><option value="">Choisir une division…</option>${divisions.map((d) => `<option value="${esc(d.id)}" ${d.name === 'G2S' ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>${state.error ? notice(esc(state.error), 'warning') : ''}<div class="page-actions">${btn('Créer le référentiel dans Genesys', 'governance-initialize', 'primary')}</div></section>`;
  // Un export local ne donne pas accès à la table partagée : relire ne peut pas aboutir.
  if (state.status === 'offline')
    return notice(
      `<strong>Référentiel partagé indisponible avec un export local</strong><p>Les Core Models, leurs versions et les rattachements sont enregistrés dans Genesys. Connectez-vous pour les consulter et les déclarer.</p>${actions(btn('Ouvrir la connexion', 'nav', 'secondary small', 'data-view="settings"'))}`,
    );
  return notice(
    `<strong>Référentiel Genesys ${state.status === 'loading' ? 'en cours de lecture' : 'indisponible'}</strong>${state.error ? `<p>${esc(state.error)}</p>` : ''}${state.status !== 'loading' ? actions(btn('Relire le référentiel', 'governance-load', 'secondary small')) : ''}`,
    'warning',
  );
}
