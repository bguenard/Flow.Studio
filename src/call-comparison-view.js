import { esc, icon, btn, head } from './ui-kit.js';
import {
  callScenarios,
  comparisonChoice,
  comparisonComplete,
  comparisonDiff,
} from './call-comparison.js';
import { simulationStep } from './call-simulator.js';
import { simulationMap } from './simulation-map.js';
import { comparisonPlaylist } from './call-comparison-audio.js';
const sideLabel = { before: 'Avant', after: 'Après' };
const words = (value) =>
  value == null || value === ''
    ? 'Non renseigné'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
function lane(c, side, origin = 'genesys') {
  const s = c.lanes[side];
  if (!s)
    return `<article class="comparison-lane unavailable"><header><span>01 · AVANT</span><h2>Pas encore publié</h2></header><p>Ce parcours n’existe pas dans la version chargée depuis Genesys. L’essai présente uniquement la nouvelle version.</p></article>`;
  const step = simulationStep(s),
    choice = comparisonChoice(c, side),
    active = c.cursor === side && !comparisonComplete(c),
    items = comparisonPlaylist(c, side),
    events = c.events[side];
  return `<article class="comparison-lane ${side} ${active ? 'on-air' : ''}" data-side="${side}"><header><div><span>${side === 'before' ? '01 · VERSION CHARGÉE DEPUIS ' + (origin === 'genesys' ? 'GENESYS' : 'L’EXPORT') : '02 · BROUILLON ENREGISTRÉ'}</span><h2>${sideLabel[side]}</h2></div><b>${c.done[side] ? 'Essai terminé' : active ? 'En cours' : 'En attente'}</b></header>${simulationMap(s, { namespace: 'compare-' + side, title: sideLabel[side] + ' · parcours de l’appel' })}<section class="comparison-listen"><div class="comparison-wave" aria-hidden="true">${Array.from({ length: 18 }, () => '<i></i>').join('')}</div><div><span class="comparison-step-label">${s.status === 'active' ? 'L’APPELANT ENTEND' : 'ISSUE DE CET ESSAI'}</span><h3>${esc(s.status === 'active' ? step.title : s.outcome)}</h3><div class="comparison-messages">${items.length ? items.map((item) => `<p>${item.kind === 'tts' ? '« ' + esc(item.text) + ' »' : item.kind === 'prompt' ? icon('play') + ' Message enregistré · ' + esc(item.name) : esc(item.name)}</p>`).join('') : '<p class="muted">Aucune annonce à cette étape.</p>'}</div></div></section><div class="comparison-reason">${icon('chevron')}<span>${esc(choice.reason)}</span></div><ol class="comparison-trail">${
    events
      .slice(-5)
      .map(
        (e, i) =>
          `<li><span>${events.length - Math.min(events.length, 5) + i + 1}</span><div><strong>${esc(e.choice)}</strong><small>${esc(e.reason)}</small></div></li>`,
      )
      .join('') || '<li>Le fil de cet appel apparaîtra ici.</li>'
  }</ol>${c.done[side] && !events.some((e) => e.effect) ? '<p class="comparison-note">Aucune branche spécifique au scénario n’a été rencontrée dans cet essai.</p>' : ''}</article>`;
}
const counted = (count, one, many) =>
  Number(count) > 1 || !Number.isFinite(Number(count)) ? many : one;
export function callComparisonView(c, { origin = 'genesys' } = {}) {
  const diff = comparisonDiff(c),
    complete = comparisonComplete(c),
    s = c.lanes[c.cursor],
    choice = comparisonChoice(c),
    needsChoice = s?.status === 'active' && !choice.route;
  const keys = [
    ...new Set([
      ...Object.keys(c.context),
      ...Object.values(c.lanes).flatMap(
        (s) =>
          s?.flow.nodes
            .filter((n) => n.type === 'decision')
            .map((n) => n.row.PARTICIPANT_DATA_TO_CHECK)
            .filter(Boolean) || [],
      ),
    ]),
  ];
  return `<div class="call-comparison ${c.presentation ? 'is-presenting' : ''}">${head('COMPARATIF DES APPELS', 'Avant / après l’appel', c.lanes.after.flow.name || c.lanes.after.flow.key, btn('Retour au parcours', 'call-compare-back', 'secondary') + btn(c.presentation ? 'Quitter la présentation' : 'Présenter', 'call-compare-present', 'secondary'))}<section class="comparison-command"><div class="comparison-command-heading"><div><span class="comparison-eyebrow">SCÉNARIO D’ESSAI</span><h2>Même scénario, deux versions</h2><p>Les messages sont lus à tour de rôle. Chaque carte suit sa propre version.</p></div><span class="comparison-simulation-label">${icon('phone')} APPELS SIMULÉS</span></div><div class="comparison-scenarios" role="group" aria-label="Scénario d’appel">${Object.entries(
    callScenarios,
  )
    .map(([key, item]) =>
      btn(
        icon(item.icon) + item.label,
        'call-compare-scenario',
        c.scenario === key ? 'selected' : '',
        `data-scenario="${key}" aria-pressed="${c.scenario === key}"`,
      ),
    )
    .join(
      '',
    )}</div><p class="comparison-assumptions">${esc(callScenarios[c.scenario].description)} Aucun appel réel n’est émis ; les conditions et délais sont simulés. L’attente parcourt un cycle accéléré, sans musique.</p><div class="comparison-transport">${btn(icon(c.playing ? 'pause' : 'play') + (c.playing ? ' Mettre en pause' : complete ? ' Rejouer le comparatif' : c.turn ? ' Reprendre' : ' Lancer le comparatif'), 'call-compare-play', 'primary')}${btn(c.audioEnabled ? 'Son activé' : 'Son coupé', 'call-compare-sound', 'secondary', `aria-pressed="${c.audioEnabled}"`)}${btn('Recommencer', 'call-compare-reset', 'quiet')}<span id="comparison-audio-status" role="status">${esc(c.audioError || (!c.audioEnabled ? 'Lecture visuelle, son désactivé' : complete ? 'Comparatif terminé' : c.playing ? 'Lecture des messages…' : 'Prêt à comparer'))}</span></div>${c.audioError ? '<p class="comparison-error" role="alert">' + esc(c.audioError) + ' Relancez la lecture ou coupez le son pour continuer visuellement.</p>' : ''}<details class="comparison-context"><summary>Personnaliser les hypothèses et le choix de menu</summary><div><label>Touche composée<select id="comparison-digit">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'].map((v) => `<option value="${v}" ${c.digit === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${keys.map((key) => `<label>${esc(key)}<input data-comparison-context="${esc(key)}" value="${esc(c.context[key] ?? '')}" placeholder="Résultat à préciser"><small>${Object.hasOwn(c.context, key) ? 'Valeur simulée' : 'Inconnu : le simulateur demandera un choix'}</small></label>`).join('')}</div><p>Changer une hypothèse recommence les deux essais. Les bots, contrôles externes et résultats inconnus nécessitent un choix explicite.</p></details></section><section class="comparison-score"><div><strong>${diff.available ? diff.changes.length : '—'}</strong><span>${counted(diff.available ? diff.changes.length : NaN, 'réglage modifié', 'réglages modifiés')}</span></div><div><strong>${diff.available ? diff.messages : '—'}</strong><span>${counted(diff.available ? diff.messages : NaN, 'message modifié', 'messages modifiés')}</span></div><div><strong>${diff.added}</strong><span>${counted(diff.added, 'étape ajoutée', 'étapes ajoutées')}</span></div><div><strong>${diff.removed}</strong><span>${counted(diff.removed, 'étape retirée', 'étapes retirées')}</span></div>${!diff.changes.length && !diff.added && !diff.removed ? '<p>Les deux versions sont identiques. Enregistrez une modification du parcours pour obtenir un écart à comparer.</p>' : ''}</section>${
    needsChoice
      ? `<section class="comparison-choice" role="region" aria-label="Choix pour poursuivre"><strong>${sideLabel[c.cursor]} · À vous de choisir</strong><p>${esc(choice.reason)} Ce choix sera réutilisé lorsque la même étape sera rencontrée dans l’autre version.</p><div>${simulationStep(
          s,
        )
          .routes.map((r) =>
            btn(
              esc(r.label) + ' → ' + esc(r.toTitle),
              'call-compare-route',
              'secondary',
              `data-route="${esc(r.id)}"`,
            ),
          )
          .join('')}</div></section>`
      : ''
  }<div class="comparison-duet">${lane(c, 'before', origin)}${lane(c, 'after', origin)}</div>${
    complete
      ? `<section class="comparison-verdict"><span>COMPARATIF TERMINÉ</span><h2>Résultat du comparatif</h2><div>${Object.entries(
          c.lanes,
        )
          .map(
            ([side, s]) =>
              `<article><h3>${sideLabel[side]}</h3><p>${esc(s?.outcome || 'Version absente')}</p><small>${s?.trail.length || 0} ${(s?.trail.length || 0) > 1 ? 'transitions' : 'transition'} · ${s?.status === 'complete' ? 'Branche parcourue' : 'Résultat à préciser'}</small></article>`,
          )
          .join(
            '',
          )}</div><p>Ce résultat décrit cet essai ; il ne certifie pas l’exécution d’un appel dans Genesys.</p>${btn(icon('download') + ' Exporter le comparatif', 'call-compare-export', 'secondary')}</section>`
      : ''
  }${diff.changes.length ? `<details class="comparison-change-list"><summary>${diff.changes.length} ${diff.changes.length > 1 ? 'réglages' : 'réglage'} à l’origine des différences</summary>${diff.changes.map((d) => `<div><strong>${esc(d.label)}</strong><span>${esc(words(d.before))}</span><b>→</b><span>${esc(words(d.after))}</span></div>`).join('')}</details>` : ''}</div>`;
}
