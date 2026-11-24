import { btn, icon, esc } from './ui-kit.js';
import { CHANNELS } from './media-profiles.js';
export function journeyMediaTabs(media = 'voice') {
  return `<div class="segmented" role="group" aria-label="Média des parcours">${[
    ['voice', 'Voix', 'phone'],
    ['messaging', 'Messaging', 'message'],
  ]
    .map(([id, label, symbol]) =>
      btn(
        icon(symbol) + ' ' + label,
        'catalogue-media',
        media === id ? 'active' : '',
        `data-media="${id}" aria-pressed="${media === id}"`,
      ),
    )
    .join('')}</div>`;
}
export function messagingScopeNote() {
  return `<p class="helper">Canal disponible : ${esc(CHANNELS.webmessaging.label)}. Les parcours Messaging sont indépendants de leurs points d’entrée. WhatsApp sera activé après validation de ses capacités.</p>`;
}
export function messagingEntryDetails(flow) {
  return `<details class="designer-optional"><summary>Raccorder ce parcours à Web Messaging</summary><p>Segment d’entrée : <strong>${esc(flow.key)}</strong>. Configurez INITIAL_SEGMENT avec cette clé dans l’intégration Web Messenger. À défaut, le flow fourni recherche le nom du déploiement.</p><p>Une reprise de conversation recherche d’abord <strong>${esc(flow.key)}_THREADING</strong>, puis ce segment. Plusieurs déploiements peuvent transmettre le même segment.</p><p>Le Studio prépare les tables WOLF. Le déploiement Messenger et son raccordement au flow Architect se configurent dans Genesys.</p></details>`;
}
