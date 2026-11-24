import { simulationMap } from './simulation-map.js';
import { simulationStep, journeyHealth, automaticSimulationRoute } from './call-simulator.js';
import { esc, icon, btn, tag, head } from './ui-kit.js';
export function simulatorView(session, { origin = 'genesys' } = {}) {
  const { node, routes, messages, title, contexts, waiting } = simulationStep(session),
    health = journeyHealth(session.flow),
    active = session.status === 'active';
  const automatic = automaticSimulationRoute(session);
  const menu = routes.filter((r) => /^OPTION(?:[0-9]|STAR|DIEZ)/.test(r.edge.branch || ''));
  const visited = new Set(session.trail.map((t) => t.nodeId));
  visited.add(session.nodeId);
  return (
    head(
      'SIMULATION GUIDÉE',
      'Studio d’appel',
      session.flow.name || session.flow.dnis,
      btn(icon('undo') + ' Retour au parcours', 'simulation-back', 'secondary') +
        btn(icon('play') + ' Présenter', 'simulation-present', 'secondary'),
    ) +
    `
 <section class="simulator-hero"><div><span class="live-dot"></span> Simulation guidée <span class="simulator-number">${esc(session.flow.dnis || session.flow.key)}</span><p>Explorez les branches du parcours. Les conditions choisies sont des hypothèses ; aucun appel réel n’est émis.</p></div><div class="segmented" role="group" aria-label="Version simulée">${btn(origin === 'genesys' ? 'Version Genesys' : 'Version de l’export', 'simulation-source', session.source === 'live' ? 'active' : '', `data-source="live" aria-pressed="${session.source === 'live'}"`)}${btn('Mes modifications', 'simulation-source', session.source === 'draft' ? 'active' : '', `data-source="draft" aria-pressed="${session.source === 'draft'}"`)}</div></section>
 <section class="simulation-layout ${session.presentation ? 'is-presenting' : ''}" id="simulation-stage">${session.presentation ? '<header class="simulation-presentation-bar"><strong>Studio d’appel · Simulation guidée</strong>' + btn('Quitter la présentation', 'simulation-present', 'secondary') + '</header>' : ''}
 ${simulationMap(session)}<aside class="simulation-phone"><div class="phone-speaker"></div><div class="phone-status">${icon('phone')} APPEL SIMULÉ</div><h2>${esc(title)}</h2><p>${esc(node?.label || 'Étape du parcours')}</p><div class="voice-bars" aria-hidden="true">${Array.from({ length: 17 }, () => '<i></i>').join('')}</div><div class="phone-message">${messages.length ? messages.map((m) => `<p><small>${esc(m.label)}</small>${esc(m.display)}</p>`).join('') : `<p>${esc(active ? 'Suivez le parcours en choisissant une branche.' : session.outcome || 'Fin du scénario')}</p>`}</div>${btn(icon('play') + ' Relire les messages', 'simulation-speak', 'phone-listen')}<div class="simulation-audio-controls">${btn(session.audioEnabled === false ? 'Activer le son' : 'Couper le son', 'simulation-audio', 'phone-listen', `aria-pressed="${session.audioEnabled !== false}"`)}<p id="simulation-audio-status" role="status" ${session.audioError ? 'class="audio-error"' : ''}>${esc(session.audioError || 'Messages lus automatiquement pendant le déroulement')}</p><small>TTS : voix du navigateur · enregistrements : Genesys</small></div><div class="phone-keypad">${[
   '1',
   '2',
   '3',
   '4',
   '5',
   '6',
   '7',
   '8',
   '9',
   '*',
   '0',
   '#',
 ]
   .map((key) => {
     const branch = 'OPTION' + (key === '*' ? 'STAR' : key === '#' ? 'DIEZ' : key),
       route = menu.find((r) => r.edge.branch === branch);
     return btn(
       key,
       'simulation-route',
       '',
       `aria-label="Touche ${key}" ${active && route ? `data-route="${esc(route.id)}"` : 'disabled'}`,
     );
   })
   .join(
     '',
   )}</div><div class="phone-bottom">${session.trail.length} transition${session.trail.length > 1 ? 's' : ''} · ${esc(session.source === 'live' ? 'Version lue dans Genesys' : 'Modifications enregistrées')}</div></aside>
 <div class="simulation-workbench"><section class="simulation-playback">${btn(icon(session.playing && active ? 'pause' : 'play') + (session.playing && active ? ' Mettre en pause' : ' Dérouler le parcours'), 'simulation-play', 'primary', active ? '' : 'disabled')}<div><strong>${!active ? (session.status === 'complete' ? 'Simulation terminée' : 'Suite à préciser') : session.playing ? (automatic ? 'Transition suivante…' : 'En attente de votre choix') : waiting ? 'Appel en file d’attente' : 'Lecture du parcours'}</strong><p>Les transitions simples s’enchaînent. Choisissez les touches, conditions et événements d’attente.</p></div></section><div class="simulation-metrics"><article><strong>${visited.size}<small> / ${health.steps}</small></strong><span>Étapes explorées</span></article><article><strong>${health.unresolved.length}</strong><span>Destinations à vérifier</span></article><article><strong>${health.dynamic.length}</strong><span>Liens dynamiques</span></article></div>
 <section class="simulation-decision"><div class="eyebrow">${active ? 'ÉTAPE EN COURS' : 'RÉSULTAT DU PARCOURS'}</div><h2>${esc(active ? (waiting ? 'Événement pendant l’attente' : 'Suite de l’appel') : session.outcome || 'Fin du scénario')}</h2>${active ? `<p>Choisissez l’événement à tester. Les règles, calendriers, agents et bots ne sont pas évalués en temps réel.</p><div class="simulation-choices">${routes.map((r) => `<button class="simulation-choice" data-action="simulation-route" data-route="${esc(r.id)}"><span>${icon(r.dynamic ? 'code' : r.terminal ? 'phone' : 'chevron')}</span><div><strong>${esc(r.label)}</strong><small>${esc(r.toTitle)}</small></div>${r.dynamic ? tag('Dynamique', 'amber') : !r.resolved ? tag('À vérifier', 'amber') : ''}</button>`).join('') || '<div class="notice">Aucune sortie simulable : consultez la configuration de cette étape.</div>'}</div>` : `<p>${session.status === 'complete' ? 'Cette branche a été parcourue jusqu’à sa destination.' : session.trail.length >= 80 ? 'La limite de 80 transitions est atteinte. Revenez à l’étape précédente ou recommencez la simulation.' : 'Le résultat réel n’est pas disponible. Vous pouvez choisir explicitement une étape pour continuer le scénario.'}</p>`}${
   ['boundary', 'blocked'].includes(session.status) && session.trail.length < 80
     ? `<div class="simulation-resume"><label for="simulation-destination">Suite supposée pour cet essai</label><select id="simulation-destination"><option value="">Choisir une étape…</option>${session.flow.nodes
         .filter((n) => n.type !== 'pdata')
         .map(
           (n) =>
             `<option value="${esc(n.id)}">${esc(n.row?.DESCRIPTION || n.key || n.id)}</option>`,
         )
         .join(
           '',
         )}</select>${btn('Continuer avec cette hypothèse', 'simulation-resume', 'secondary')}<p>Ce choix sera signalé dans le compte rendu. Il ne modifie pas le routage.</p></div>`
     : ''
 }${contexts.length ? `<details><summary>${contexts.length} contexte(s) associé(s)</summary>${contexts.map((c) => `<p>${esc(c.toTitle)}</p>`).join('')}<small>Ces actions ne sont pas exécutées dans la simulation.</small></details>` : ''}<div class="simulation-controls">${btn(icon('undo') + ' Étape précédente', 'simulation-rewind', 'secondary', session.trail.length ? '' : 'disabled')}${btn('Recommencer', 'simulation-reset', 'quiet')}${btn(icon('download') + ' Exporter le scénario', 'simulation-export', 'quiet')}</div></section>
 <section class="simulation-trace"><div class="eyebrow">FIL DE L’APPEL</div><ol>${session.trail.map((t, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(t.title)}</strong><p>${t.override ? '<b>Hypothèse · </b>' : ''}${esc(t.choice)} → ${esc(t.destination)}</p>${t.audio ? `<small>Annonce de transition : ${esc(t.audio)}</small>` : ''}</div></li>`).join('') || '<li><span>01</span><div><strong>Aucune transition</strong><p>Les choix effectués s’affichent ici, étape par étape.</p></div></li>'}</ol></section></div></section>`
  );
}
export function simulationSpeech(session) {
  return simulationStep(session)
    .messages.filter((m) => /^tts:/i.test(String(m.value)) && !/[|]|\$?var:/i.test(m.value))
    .map((m) => String(m.value).slice(4))
    .join('. ');
}
