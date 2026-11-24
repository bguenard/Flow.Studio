import { esc, icon, btn } from './ui-kit.js';
import { flowTitle, humanText } from './business.js';

const periods = [
  ['today', 'Aujourd’hui'],
  ['yesterday', 'Hier'],
  ['week', '7 jours'],
];
const numberFormat = new Intl.NumberFormat('fr-FR');
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value) => (isNumber(value) ? numberFormat.format(value) : '—');
const clock = (value) => {
  if (!isNumber(value)) return '—';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};
const dateLabel = (value, options = {}) => {
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(time)
    : '';
};
const message = (error) =>
  typeof error === 'string'
    ? error
    : error?.message || 'Les données ne sont pas disponibles pour le moment.';
const statusText = (section) =>
  section?.status === 'error'
    ? 'Indisponible'
    : section?.status === 'empty'
      ? 'Aucune donnée'
      : section?.status === 'ready'
        ? 'Données chargées'
        : 'À charger';

function metricCard(label, value, detail, symbol, style = '') {
  return `<article class="activity-kpi ${style}"><div class="activity-kpi-top"><span>${esc(label)}</span>${icon(symbol)}</div><strong>${esc(value)}</strong><p>${esc(detail)}</p></article>`;
}

function sectionError(section) {
  if (section?.status !== 'error') return '';
  return `<div class="activity-error" role="status">${icon('alert')}<div><strong>Lecture indisponible</strong><p>${esc(message(section.error))}</p></div></div>`;
}

function chart(buckets, period, state, metric = 'connected') {
  const points = (buckets || []).filter(
    (bucket) => bucket?.start && Number.isFinite(new Date(bucket.start).getTime()),
  );
  const metricName = metric === 'connected' ? 'Appels connectés' : 'Entrées en file';
  const known = points.filter((bucket) => isNumber(bucket[metric]));
  if (!known.length)
    return `<div class="activity-chart-empty">${icon('clock')}<strong>${state === 'empty' ? 'Aucun volume retourné sur cette période' : 'La courbe apparaîtra avec les données Genesys'}</strong><span>${state === 'empty' ? 'Essayez une autre période pour ce numéro.' : 'Les volumes indisponibles restent indiqués par un tiret.'}</span></div>`;
  const width = 760,
    height = 220,
    left = 42,
    right = 12,
    top = 14,
    bottom = 33;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const max = Math.max(1, ...known.map((bucket) => bucket[metric]));
  const ceiling = max < 5 ? Math.ceil(max) : Math.ceil(max / 5) * 5;
  const step = plotWidth / points.length,
    barWidth = Math.max(0.5, Math.min(38, step * 0.65));
  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = top + plotHeight * (1 - ratio),
        value = ceiling * ratio;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="activity-chart-grid"/><text x="${left - 9}" y="${y + 4}" text-anchor="end">${esc(numberFormat.format(value))}</text>`;
    })
    .join('');
  const bars = points
    .map((bucket, index) => {
      if (!isNumber(bucket[metric])) return '';
      const x = left + step * index + (step - barWidth) / 2;
      const h = (bucket[metric] / ceiling) * plotHeight,
        y = top + plotHeight - h;
      const label = dateLabel(bucket.start, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(h, bucket[metric] === 0 ? 1 : 0)}" rx="2" class="activity-chart-bar"><title>${esc(label)} : ${esc(count(bucket[metric]))} ${esc(metricName.toLocaleLowerCase('fr-FR'))}</title></rect>`;
    })
    .join('');
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const labels = points
    .map((bucket, index) => {
      if (index % labelStep && index !== points.length - 1) return '';
      const x = left + step * index + step / 2;
      const label = dateLabel(
        bucket.start,
        period === 'week'
          ? { day: '2-digit', month: '2-digit' }
          : { hour: '2-digit', minute: '2-digit' },
      );
      return `<text x="${x}" y="${height - 9}" text-anchor="middle">${esc(label)}</text>`;
    })
    .join('');
  return `<div class="activity-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution des ${esc(metricName.toLocaleLowerCase('fr-FR'))} pour le numéro appelé">${grid}${bars}${labels}</svg></div><details class="activity-chart-values"><summary>Consulter les valeurs de la courbe</summary><div class="activity-table-scroll"><table><thead><tr><th scope="col">Début de période</th><th scope="col">${esc(metricName)}</th></tr></thead><tbody>${points.map((bucket) => `<tr><th scope="row">${esc(dateLabel(bucket.start, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</th><td>${esc(count(bucket[metric]))}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function queueTable(live) {
  if (!live?.queues?.length)
    return `<div class="activity-queues-empty">${icon('people')}<div><strong>${live?.status === 'empty' ? 'Aucune file identifiée pour ce parcours' : 'Les équipes apparaîtront ici'}</strong><p>${live?.status === 'empty' ? 'Les destinations choisies pendant l’appel ne permettent pas toujours d’identifier une file à l’avance.' : 'Appels en attente, appels en cours et disponibilité des agents, file par file.'}</p></div></div>`;
  return `<div class="activity-table-scroll"><table class="activity-queue-table"><thead><tr><th scope="col">File de traitement</th><th scope="col">Appels<br>en attente</th><th scope="col">Appels<br>en cours</th><th scope="col">Agents<br>en file</th><th scope="col">Dont sans<br>interaction</th></tr></thead><tbody>${live.queues.map((queue) => `<tr><th scope="row"><div class="activity-queue-name"><span class="activity-queue-symbol">${icon('people')}</span><span>${esc(queue.name || 'File sans libellé')}</span></div></th><td><span class="activity-cell-number ${isNumber(queue.waiting) && queue.waiting > 0 ? 'has-waiting' : ''}">${esc(count(queue.waiting))}</span></td><td>${esc(count(queue.interacting))}</td><td>${esc(count(queue.onQueue))}</td><td>${esc(count(queue.available))}</td></tr>`).join('')}</tbody></table></div>`;
}

function connectionState(connection) {
  if (connection === 'connected') return '';
  if (connection === 'local-draft')
    return `<section class="activity-connect"><span class="activity-connect-symbol">${icon('clock')}</span><div><strong>Ce brouillon n’a pas d’activité propre</strong><p>Ce parcours n’est pas encore en service. Consultez l’activité d’un parcours lu depuis Genesys.</p></div>${btn('Retour au parcours', 'activity-back', 'secondary small')}</section>`;
  const description =
    connection === 'demo'
      ? 'Les parcours de démonstration ne disposent pas de statistiques réelles.'
      : connection === 'import'
        ? 'L’export contient la configuration du parcours. Les statistiques nécessitent une connexion à Genesys.'
        : 'Connectez votre compte Genesys pour consulter l’activité de ce numéro.';
  return `<section class="activity-connect"><span class="activity-connect-symbol">${icon('link')}</span><div><strong>${connection === 'demo' ? 'Ouvrez vos parcours Genesys pour suivre leur activité' : 'Retrouver l’activité de ce numéro'}</strong><p>${esc(description)}</p></div>${btn('Ouvrir la connexion', 'activity-connect', 'primary small')}</section>`;
}

/** Render-only dashboard. Missing metrics are never converted to zero. */
export function analyticsView({
  flow,
  title,
  period = 'today',
  data = null,
  loading = false,
  connection = 'connected',
  audience = 'business',
  error = '',
  sameNumberCount = 1,
  hasDraft = false,
} = {}) {
  const history = data?.history,
    live = data?.live,
    metrics = history?.metrics || {};
  const chartMetric =
    history?.buckets?.some((bucket) => isNumber(bucket.connected)) ||
    !history?.buckets?.some((bucket) => isNumber(bucket.offered))
      ? 'connected'
      : 'offered';
  const chartTitle = chartMetric === 'connected' ? 'Appels connectés' : 'Entrées en file';
  const hasReadings = [history, live].some((section) => section?.status === 'ready');
  const number = data?.dnis || flow?.dnis || flow?.key || 'Numéro non renseigné';
  const updated = data?.updatedAt
    ? dateLabel(data.updatedAt, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '';
  const summary = periods.find(([id]) => id === period)?.[1] || 'Période sélectionnée';
  const warnings = [
    ...new Set(
      [
        ...(data?.scopeWarnings || []),
        sameNumberCount > 1
          ? 'Ce numéro est partagé par plusieurs parcours ou versions : les statistiques portent sur le numéro, pas sur une version WOLF.'
          : '',
        hasDraft
          ? 'L’activité décrit les parcours en service. Les adaptations locales ne changent pas ces chiffres.'
          : '',
      ].filter(Boolean),
    ),
  ];
  return `<div class="activity-dashboard" ${loading ? 'aria-busy="true"' : ''}>
    <header class="activity-heading"><div><button class="activity-back" data-action="activity-back">${icon('undo')} Retour au parcours</button><div class="activity-eyebrow">ACTIVITÉ DU NUMÉRO</div><h1>${esc(title || flowTitle(flow))}</h1></div><span class="activity-number">${icon('phone')} ${esc(number)}</span></header>
    <section class="activity-overview"><div><span class="activity-overview-label">Le parcours en chiffres</span><h2>Appels et situation des équipes</h2><p>${esc(humanText(flow?.division) || 'Parcours voix')}<span>·</span>Voix<span>·</span>Heure de Paris</p></div><div class="activity-overview-status"><span class="activity-status ${connection === 'connected' && hasReadings ? 'is-ready' : ''}"><i></i>${loading ? 'Actualisation…' : updated ? (hasReadings ? 'Dernière lecture Genesys' : 'Dernière tentative de lecture') : 'En attente de données'}</span><span>${loading ? 'Lecture en cours' : updated || 'Actualisation à la demande'}</span></div></section>
    ${connectionState(connection)}
    ${error ? `<div class="activity-error" role="alert">${icon('alert')}<div><strong>Les statistiques n’ont pas pu être chargées</strong><p>${esc(message(error))}</p></div></div>` : ''}
    <div class="activity-toolbar"><div class="activity-periods" role="group" aria-label="Période des statistiques">${periods.map(([id, label]) => btn(label, 'activity-period', period === id ? 'active' : '', `data-period="${id}" aria-pressed="${period === id}" ${loading ? 'disabled' : ''}`)).join('')}</div><div class="activity-refresh">${loading ? '<span role="status">Lecture des statistiques…</span>' : ''}${btn(icon('undo') + ' Actualiser', 'activity-refresh', 'secondary small', loading || connection !== 'connected' ? 'disabled' : '')}</div></div>
    <section class="activity-history" aria-labelledby="activity-history-title"><div class="activity-section-title"><div><span class="activity-scope">CE NUMÉRO · ${esc(summary.toUpperCase())}</span><h2 id="activity-history-title">L’activité des appels</h2></div><span class="activity-section-status">${loading ? 'Actualisation…' : statusText(history)}</span></div>
      ${sectionError(history)}
      <div class="activity-kpis">${metricCard('Appels connectés', count(metrics.connected), 'Connexions entrantes à ce numéro', 'phone', 'is-primary')}${metricCard('Entrées en file', count(metrics.offered), 'Passages en file pour ce numéro', 'menu')}${metricCard('Prises en charge', count(metrics.answered), 'Réponses des équipes', 'people')}${metricCard('Abandons en file', count(metrics.abandoned), 'Appels quittant l’attente', 'undo')}${metricCard('Attente avant réponse', clock(metrics.averageWaitMs), 'Moyenne des prises en charge', 'clock')}</div>
      <article class="activity-chart-panel"><div class="activity-chart-heading"><h3>${esc(chartTitle)} au fil de la période</h3><span><i></i>${esc(chartTitle)}</span></div>${chart(history?.buckets, period, history?.status, chartMetric)}<p class="activity-measure-note">Les appels connectés incluent ceux restés dans l’accueil vocal. Un appel transféré entre plusieurs files peut compter plusieurs entrées et prises en charge : ces compteurs ne représentent pas des appelants uniques.</p></article>
    </section>
    <section class="activity-live" aria-labelledby="activity-live-title"><div class="activity-section-title"><div><span class="activity-scope">FILES ASSOCIÉES · AU DERNIER RAFRAÎCHISSEMENT</span><h2 id="activity-live-title">La situation des équipes</h2></div><span class="activity-live-badge">Tous les numéros de ces files</span></div><p class="activity-live-intro">Une file peut recevoir les appels de plusieurs parcours. Les chiffres ci-dessous concernent toute son activité.${updated ? ` Lecture du ${esc(updated)}.` : ''}</p>${sectionError(live)}${queueTable(live)}<div class="activity-live-notes"><span><strong>Agents en file :</strong> agents ayant activé le statut « En file », tous médias.</span><span><strong>Sans interaction :</strong> parmi ces agents, ceux qui ne traitent aucune interaction. Leur éligibilité dépend aussi du routage.</span><span>Un agent peut appartenir à plusieurs files ; les lignes ne s’additionnent pas.</span></div></section>
    ${warnings.length ? `<aside class="activity-warnings" aria-label="Périmètre des statistiques">${icon('alert')}<div><strong>Périmètre à connaître</strong><ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div></aside>` : ''}
    ${audience === 'admin' ? `<details class="activity-admin"><summary>${icon('code')} Sources et périmètre de lecture</summary><dl><div><dt>Numéro filtré</dt><dd>${esc(number)}</dd></div><div><dt>Historique</dt><dd>Conversations entrantes · voix · DNIS</dd></div><div><dt>Mesures</dt><dd>nConnected.count · nOffered.count · tAnswered.count · tAbandon.count · tAnswered.sum/count</dd></div><div><dt>Situation des files</dt><dd>Observations des files identifiées · tous numéros</dd></div>${data?.interval ? `<div><dt>Intervalle demandé</dt><dd>${esc(data.interval)}</dd></div>` : ''}</dl></details>` : ''}
  </div>`;
}
