/**
 * Vues du référentiel : Core Models, détail d'un Core Model, impact d'une
 * évolution et déclaration du rôle d'un parcours. Fonctions pures : elles
 * reçoivent un modèle de vue et rendent du HTML ; l'état et les événements
 * restent dans app.js.
 */
import { icon, btn, tag, esc, head, notice, empty, plural } from './ui-kit.js';
import { flowTitle, unresolvedReferences } from './business.js';
import { SCOPES, scopeLabel } from './governance.js';

const versionName = (version) => `version ${version.label}`;
const openFlow = (flow, label = 'Ouvrir le parcours', style = 'secondary small') =>
  flow
    ? btn(`${esc(label)} ${icon('chevron')}`, 'open-flow-id', style, `data-id="${esc(flow.id)}"`)
    : '';

/** Écarts d'une déclinaison avec la version dont elle est déclinée. */
function gapsLine(gaps) {
  if (!gaps) return 'Non calculés : parcours ou référence absent de la source courante';
  const parts = [];
  if (gaps.local) parts.push(plural(gaps.local, 'adaptation locale', 'adaptations locales'));
  if (gaps.binding)
    parts.push(plural(gaps.binding, 'valeur propre à l’entité', 'valeurs propres à l’entité'));
  if (gaps.steps) parts.push(plural(gaps.steps, 'étape différente', 'étapes différentes'));
  if (gaps.review)
    parts.push(plural(gaps.review, 'rapprochement à faire', 'rapprochements à faire'));
  return parts.join(' · ') || 'Aucun écart avec sa référence';
}

function impactTags(impact) {
  if (!impact) return '';
  const tags = [];
  if (impact.conflict) tags.push(tag(plural(impact.conflict, 'conflit'), 'amber', 'alert'));
  if (impact.group)
    tags.push(tag(plural(impact.group, 'évolution à examiner', 'évolutions à examiner'), 'orange'));
  if (impact.groupSteps)
    tags.push(
      tag(
        plural(impact.groupSteps, 'étape ajoutée ou retirée', 'étapes ajoutées ou retirées'),
        'orange',
      ),
    );
  if (impact.converged)
    tags.push(tag(plural(impact.converged, 'déjà aligné', 'déjà alignés'), 'green'));
  if (impact.unpaired + impact.review)
    tags.push(
      tag(
        plural(impact.unpaired + impact.review, 'point à rapprocher', 'points à rapprocher'),
        'neutral',
      ),
    );
  return tags.join('') || tag('Aucun changement à reprendre', 'green');
}

/** Liste des Core Models déclarés et des parcours dont le rôle reste à déclarer. */
export function coreModelsView({
  resolved,
  summaries,
  meta,
  isDemo,
  shared = false,
  readOnly = false,
  banner = '',
}) {
  const models = resolved.models
    .map((model) => {
      const behind = model.declinations.filter((item) => item.flow && !item.isCurrent).length;
      const conflicts = model.declinations.reduce(
        (total, item) => total + (summaries.get(item.flowId)?.impact?.conflict || 0),
        0,
      );
      return `<article class="flow-card model-card"><div class="flow-card-main"><span class="flow-symbol">${icon('layers')}</span><div>${tag('Core Model', 'orange')}${model.fictitious ? tag('Exemple fictif', 'neutral') : ''}<h2><button data-action="open-model" data-model="${esc(model.id)}">${esc(model.name)}</button></h2><p>Référence en cours : ${esc(versionName(model.latest))}${model.versions.length > 1 ? ` · ${model.versions.length} versions déclarées` : ''}</p></div></div><div class="flow-card-meta"><span>${icon('building')} ${plural(model.declinations.length, 'déclinaison')}</span>${behind ? `<span>${icon('clock')} ${behind} sur une version antérieure</span>` : ''}${conflicts ? tag(plural(conflicts, 'conflit') + ' à arbitrer', 'amber', 'alert') : ''}</div><div class="flow-card-actions">${btn('Ouvrir le Core Model ' + icon('chevron'), 'open-model', 'secondary small', `data-model="${esc(model.id)}"`)}${!readOnly && !model.declinations.length ? btn('Supprimer', 'core-model-delete', 'quiet small', `data-model="${esc(model.id)}" aria-label="Supprimer le Core Model ${esc(model.name)}"`) : ''}</div></article>`;
    })
    .join('');
  const candidates = resolved.candidates
    .map(
      (flow) =>
        `<article class="flow-card"><div class="flow-card-main"><span class="flow-symbol muted">${icon('layers')}</span><div>${tag('Rôle à déclarer', 'amber')}<h2><button data-action="open-flow-id" data-id="${esc(flow.id)}">${esc(flowTitle(flow))}</button></h2><p>${esc(meta(flow))}</p></div></div><div class="flow-card-meta"><span>${icon('menu')} ${plural(flow.menus.length, 'menu')}</span><span>${icon('people')} ${plural(flow.services.length, 'équipe')}</span>${flow.issues.some((issue) => issue.code === 'missing-row' || issue.code === 'missing-table') ? tag('Parcours incomplet', 'amber', 'alert') : ''}</div><div class="flow-card-actions">${readOnly ? openFlow(flow) : btn('Déclarer son rôle', 'declare-start', 'primary small', `data-id="${esc(flow.id)}"`) + openFlow(flow, 'Ouvrir', 'quiet small')}</div></article>`,
    )
    .join('');
  return (
    head(
      'RÉFÉRENTIEL',
      'Core Models',
      'Un Core Model est un parcours complet, suivi version après version, avec les déclinaisons des entités qui s’y rattachent.',
      btn(icon('diff') + ' Comparer des parcours', 'nav', 'secondary', 'data-view="compare"') +
        (readOnly ? '' : btn('+ Créer un Core Model', 'core-model-open', 'primary')),
    ) +
    banner +
    (models
      ? `<div class="section-heading"><h2>Core Models déclarés <span class="journey-count">${resolved.models.length}</span></h2></div><div class="flow-list">${models}</div>`
      : empty(
          'Aucun Core Model déclaré',
          readOnly
            ? resolved.candidates.length
              ? 'Les parcours ci-dessous portent un marqueur de modèle. Ils restent consultables ; leur rôle se déclare une fois le référentiel partagé disponible.'
              : 'Les Core Models se déclarent une fois le référentiel partagé disponible.'
            : resolved.candidates.length
              ? 'Le rôle d’un parcours n’est jamais déduit de son nom. Déclarez ci-dessous le parcours qui sert de référence au Groupe.'
              : 'Ouvrez un parcours et déclarez-le comme parcours de référence pour suivre ses versions et ses déclinaisons.',
          resolved.candidates.length
            ? ''
            : btn('Voir les parcours', 'nav', 'primary', 'data-view="catalogue"'),
        )) +
    (candidates
      ? `<div class="section-heading"><div><h2>Parcours à classer <span class="journey-count">${resolved.candidates.length}</span></h2><p>Leur nom ou leur description porte un marqueur de modèle. ${readOnly ? 'Référence ou déclinaison : la déclaration nécessite le référentiel partagé Genesys.' : 'Référence ou déclinaison : c’est à vous de le déclarer.'}</p></div></div><div class="flow-list">${candidates}</div>`
      : '') +
    (resolved.missing
      ? notice(
          `${plural(resolved.missing, 'entrée')} du référentiel ${resolved.missing > 1 ? 'désignent des parcours absents' : 'désigne un parcours absent'} de la source courante. Elles sont conservées sans être réaffectées.`,
          'warning',
        )
      : '') +
    `<p class="registry-note">${icon('shield')} ${shared ? 'Référentiel partagé enregistré dans Genesys · STUDIO_CORE_MODEL_RECORDS_V5.' : isDemo ? 'Référentiel fictif de démonstration.' : 'Référentiel non synchronisé avec Genesys.'}</p>`
  );
}

const incompleteTag = (flow) =>
  unresolvedReferences(flow).length
    ? tag('Parcours incomplet dans la source', 'amber', 'alert')
    : '';

function scopeControl(item) {
  return `<div class="segmented scope-choice" role="group" aria-label="Périmètre déclaré">${SCOPES.map((scope) => `<button type="button" data-action="set-scope" data-id="${esc(item.flowId)}" data-scope="${scope.id}" aria-pressed="${item.scope === scope.id}">${esc(scope.short)}</button>`).join('')}</div>`;
}

/** Détail d'un Core Model : versions de référence, puis pilotage des déclinaisons. */
export function familyView({
  model,
  summaries,
  deltas,
  meta,
  title,
  shared = false,
  pendingFlowIds = [],
}) {
  const latest = model.latest;
  const reusable = [...model.versions]
    .reverse()
    .find((v) => v.flow && !pendingFlowIds.includes(v.flowId));
  const versions = model.versions
    .map((version, index) => {
      const delta = deltas[index];
      const based = model.declinations.filter((item) => item.baseFlowId === version.flowId).length;
      const evolution = !index
        ? 'Première version déclarée'
        : !delta
          ? 'Version précédente absente de la source courante'
          : delta.settings + delta.structure + delta.steps
            ? [
                delta.settings && plural(delta.settings, 'réglage modifié', 'réglages modifiés'),
                delta.structure &&
                  plural(delta.structure, 'embranchement modifié', 'embranchements modifiés'),
                delta.steps &&
                  plural(delta.steps, 'étape ajoutée ou retirée', 'étapes ajoutées ou retirées'),
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Aucune différence relevée avec la version précédente';
      return `<li class="version-item ${version.flowId === latest.flowId ? 'current' : ''}"><span class="version-badge">${esc(version.label)}</span><div><strong>Version ${esc(version.label)}${pendingFlowIds.includes(version.flowId) ? tag('À publier', 'amber') : version.flowId === latest.flowId ? tag('Référence en cours', 'orange') : ''}</strong><span>${version.flow ? esc(evolution) : 'Parcours absent de la source courante'}${delta?.review ? ` · ${plural(delta.review, 'rapprochement à faire', 'rapprochements à faire')}` : ''}</span><span>${based ? `Référence de ${plural(based, 'déclinaison')}` : 'Aucune déclinaison sur cette version'}</span></div><div class="page-actions">${index && version.flow && model.versions[index - 1].flow ? btn(icon('diff') + ' Voir les évolutions', 'compare-versions', 'quiet small', `data-left="${esc(model.versions[index - 1].flowId)}" data-right="${esc(version.flowId)}"`) : ''}${openFlow(version.flow)}</div></li>`;
    })
    .join('');
  const rows = model.declinations
    .map((item) => {
      const summary = summaries.get(item.flowId);
      const name = item.flow ? title(item.flow) : 'Parcours absent de la source courante';
      return `<article class="declination-card"><header><div><h3>${item.flow ? `<button data-action="open-flow-id" data-id="${esc(item.flowId)}">${esc(name)}</button>` : esc(name)}</h3><p>${item.flow ? esc(meta(item.flow)) : 'Rattachement conservé dans le référentiel'}</p>${incompleteTag(item.flow)}</div><div class="page-actions">${item.flow && item.base.flow ? btn(item.isCurrent ? 'Voir les écarts' : `Analyser l’impact de la ${esc(versionName(latest))}`, 'impact-open', item.isCurrent ? 'secondary small' : 'primary small', `data-id="${esc(item.flowId)}"`) : ''}</div></header><dl class="declination-facts"><div><dt>Référence déclarée</dt><dd>Version ${esc(item.base.label)}${item.isCurrent ? '' : tag(`${versionName(latest)} disponible`, 'amber')}${item.origin === 'created' ? tag('Créée dans le Studio', 'neutral') : ''}</dd></div><div><dt>Écarts avec sa référence</dt><dd>${esc(gapsLine(summary?.gaps))}</dd></div>${item.isCurrent ? '' : `<div><dt>Impact de la ${esc(versionName(latest))}</dt><dd class="tag-row">${summary?.impact ? impactTags(summary.impact) : 'Analyse indisponible'}</dd></div>`}<div><dt>Périmètre déclaré</dt><dd>${scopeControl(item)}${item.scopeNote ? `<span class="helper">${esc(item.scopeNote)}</span>` : ''}</dd></div></dl></article>`;
    })
    .join('');
  return (
    `<button class="back-link" data-action="nav" data-view="references">← Tous les Core Models</button>` +
    head(
      'CORE MODEL · PARCOURS DE RÉFÉRENCE',
      model.name,
      `${plural(model.versions.length, 'version déclarée', 'versions déclarées')} · ${plural(model.declinations.length, 'déclinaison rattachée', 'déclinaisons rattachées')}`,
      btn('Renommer', 'model-rename', 'secondary', `data-model="${esc(model.id)}"`) +
        btn('+ Nouvelle version', 'model-version', 'secondary', `data-model="${esc(model.id)}"`) +
        (reusable
          ? btn(
              icon('copy') + ' Créer un parcours',
              'clone-from',
              'primary',
              `data-id="${esc(reusable.flowId)}"`,
            )
          : '') +
        (!model.declinations.length
          ? btn(
              'Supprimer le Core Model',
              'core-model-delete',
              'secondary',
              `data-model="${esc(model.id)}"`,
            )
          : ''),
    ) +
    `<section class="family-section"><div class="section-heading"><div><h2>Versions de référence</h2><p>Chaque version est un parcours complet. Une nouvelle version s’ajoute ; les précédentes restent consultables.</p></div></div><ol class="version-list">${versions}</ol></section>` +
    `<section class="family-section"><div class="section-heading"><div><h2>Déclinaisons des entités <span class="journey-count">${model.declinations.length}</span></h2><p>Pour chaque entité : la version dont elle est déclinée, ses écarts et ce que change la référence en cours.</p></div></div>${rows || empty('Aucune déclinaison rattachée', 'Créez une déclinaison depuis ce Core Model, ou ouvrez un parcours d’entité existant et déclarez son rattachement.')}</section>` +
    (rows
      ? notice(
          shared
            ? '<strong>Versions et rattachements enregistrés dans Genesys.</strong> Le périmètre déclaré ne modifie pas les règles d’activation du parcours.'
            : '<strong>Référentiel non synchronisé avec Genesys.</strong>',
        )
      : '')
  );
}

const KINDS = [
  [
    'conflict',
    'Conflits à arbitrer',
    'La référence et l’entité ont évolué différemment depuis la version adoptée.',
    'alert',
  ],
  [
    'group',
    'Évolutions de la référence à examiner',
    'L’entité est restée sur la valeur de la version adoptée.',
    'layers',
  ],
  [
    'local',
    'Adaptations locales',
    'L’entité s’écarte de sa référence sur des points que la référence fixe.',
    'building',
  ],
  [
    'converged',
    'Déjà alignés',
    'La référence et l’entité ont évolué vers la même valeur.',
    'circlecheck',
  ],
  [
    'binding',
    'Valeurs propres à l’entité',
    'La référence prévoit ici un emplacement à renseigner par chaque entité.',
    'link',
  ],
  [
    'unpaired',
    'Étapes à rapprocher',
    'Ces réglages portent sur une étape sans correspondance sûre : aucun verdict n’est rendu.',
    'search',
  ],
];

/**
 * Impact d'une nouvelle version sur une déclinaison (trois états), ou simples
 * écarts avec sa référence quand elle est déjà sur la version en cours.
 */
export function impactView({ model, item, analysis, sections, title }) {
  const threeWay = !item.isCurrent;
  const latest = model.latest;
  const name = title(item.flow);
  const tiles = (
    threeWay
      ? [
          ['conflict', 'Conflits à arbitrer'],
          ['group', 'Évolutions à examiner'],
          ['local', 'Adaptations locales'],
          ['converged', 'Déjà alignés'],
        ]
      : [
          ['local', 'Adaptations locales'],
          ['binding', 'Valeurs propres à l’entité'],
          ['steps', 'Étapes différentes'],
          ['review', 'Rapprochements à faire'],
        ]
  )
    .map(
      ([key, label]) =>
        `<div class="metric impact-tile ${key}${analysis.counts[key] ? '' : ' zero'}"><span class="label">${label}</span><strong>${analysis.counts[key]}</strong></div>`,
    )
    .join('');
  const cell = (value, changed, column) =>
    `<div class="impact-cell ${column}${changed ? ' changed' : ''}">${esc(value)}</div>`;
  const groups = KINDS.filter(([kind]) => analysis.items.some((entry) => entry.kind === kind))
    .map(([kind, heading, description, symbol]) => {
      const rows = analysis.items
        .filter((entry) => entry.kind === kind)
        .map(
          (entry) =>
            `<div class="impact-row${threeWay ? '' : ' two'}"><div class="diff-label"><strong>${esc(entry.label)}</strong><small>${esc(sections[entry.section]?.[0] || '')}${entry.structural ? '' : ` · ${esc(entry.step)}`}</small>${entry.structural ? tag('Embranchement', 'orange') : ''}</div>${cell(entry.baseDisplay, false, 'base')}${threeWay ? cell(entry.groupDisplay, entry.groupChanged, 'group') : ''}${cell(entry.localDisplay, threeWay ? entry.localChanged : true, 'local')}</div>`,
        )
        .join('');
      return `<section class="diff-group impact-group ${kind}"><header>${icon(symbol)}<div><h2>${heading} <span class="journey-count">${analysis.items.filter((entry) => entry.kind === kind).length}</span></h2><p>${description}</p></div></header>${rows}</section>`;
    })
    .join('');
  const steps = analysis.steps.length
    ? `<section class="diff-group"><header>${icon('layers')}<div><h2>Étapes présentes d’un seul côté <span class="journey-count">${analysis.steps.length}</span></h2><p>Leurs réglages ne sont pas comparés. Les reprendre ou les retirer relève d’une adaptation de la structure du parcours.</p></div></header>${analysis.steps.map((step) => `<div class="impact-step"><strong>${esc(step.label)}</strong><span>${esc(step.description)}</span></div>`).join('')}</section>`
    : '';
  const review = analysis.review.length
    ? notice(
        `<strong>${plural(analysis.review.length, 'groupe d’étapes reste', 'groupes d’étapes restent')} à rapprocher.</strong> Plusieurs étapes de même nature se répètent sans chemin distinctif ; elles ne sont pas appariées d’office et leurs réglages ne sont pas comparés : ${analysis.review.map((entry) => `${esc(entry.label)} (${entry.count})`).join(' · ')}.`,
        'warning',
      )
    : '';
  return (
    `<button class="back-link" data-action="open-model" data-model="${esc(model.id)}">← ${esc(model.name)}</button>` +
    head(
      threeWay ? 'IMPACT D’UNE ÉVOLUTION DU CORE MODEL' : 'ÉCARTS AVEC LA RÉFÉRENCE',
      threeWay ? `${name} face à la ${versionName(latest)}` : `${name} et sa référence`,
      `${model.name} · référence déclarée : ${versionName(item.base)}${threeWay ? ` · référence en cours : ${versionName(latest)}` : ' (référence en cours)'} · périmètre déclaré : ${scopeLabel(item.scope).toLowerCase()}`,
      openFlow(item.flow, 'Ouvrir le parcours de l’entité', 'secondary'),
    ) +
    notice(
      threeWay
        ? 'Lecture croisée de trois parcours présents dans la source : la version déclarée comme adoptée, la référence en cours et le parcours de l’entité. <strong>Aucune adoption n’est appliquée</strong> et rien n’est modifié dans Genesys.'
        : 'Cette entité est déclarée sur la référence en cours. Les écarts ci-dessous sont ses spécificités locales.',
    ) +
    incompleteNotice([
      [item.flow, 'le parcours de l’entité'],
      [item.base.flow, 'la référence adoptée'],
      [threeWay ? latest.flow : null, 'la référence en cours'],
    ]) +
    `<div class="metrics impact-tiles">${tiles}</div>` +
    (groups || steps
      ? `<div class="impact-heading${threeWay ? '' : ' two'}"><span>Ce qui diffère</span><span>Référence adoptée · ${esc(versionName(item.base))}</span>${threeWay ? `<span>Référence en cours · ${esc(versionName(latest))}</span>` : ''}<span>${esc(name)}</span></div>${groups}${steps}`
      : notice(
          threeWay
            ? 'La référence en cours ne change rien pour ce parcours et l’entité n’a pas d’écart avec sa référence.'
            : 'Aucun écart relevé entre ce parcours et sa référence.',
          'success',
        )) +
    review
  );
}

function incompleteNotice(entries) {
  const broken = entries.filter(([flow]) => unresolvedReferences(flow).length);
  if (!broken.length) return '';
  return notice(
    `<strong>Analyse partielle.</strong> ${broken.map(([flow, label]) => `${plural(unresolvedReferences(flow).length, 'destination introuvable', 'destinations introuvables')} dans ${label}`).join(' ; ')}. Le parcours s’arrête à ces points dans la source : les étapes situées au-delà apparaissent comme absentes, sans que rien soit supposé à leur place.`,
    'warning',
  );
}

/** Page de déclaration : le rôle d'un parcours est toujours un choix explicite. */
export function declareView({ flow, role, resolved, suggestions, meta, title }) {
  const versions = resolved.models.flatMap((model) =>
    model.versions.map((version) => ({ model, version })),
  );
  const current =
    role.role === 'reference'
      ? `Version ${role.version.label} du Core Model « ${role.model.name} »`
      : role.role === 'declination'
        ? `Déclinaison de « ${role.model.name} », référence déclarée : version ${role.base.label}`
        : '';
  const referencePanel = `<section class="settings-panel"><div class="eyebrow">RÉFÉRENCE GROUPE</div><h2>Ce parcours est un parcours de référence</h2><p>Il devient une version d’un Core Model : un parcours complet que les entités déclinent.</p><fieldset class="choice-list"><legend>À quel Core Model appartient-il ?</legend><label class="check-row"><input type="radio" name="declare-model" value="" checked><span><strong>Un nouveau Core Model</strong><small>Ce parcours en devient la première version déclarée.</small></span></label>${resolved.models.map((model) => `<label class="check-row"><input type="radio" name="declare-model" value="${esc(model.id)}"><span><strong>Une nouvelle version de « ${esc(model.name)} »</strong><small>Elle s’ajoute après la ${esc(versionName(model.latest))} et devient la référence en cours.</small></span></label>`).join('')}</fieldset><div class="field-grid"><div class="field"><label for="declare-name">Nom du Core Model</label><input id="declare-name" value="${esc(suggestions.name)}" maxlength="80"><span class="helper">Utilisé pour un nouveau Core Model.</span></div><div class="field"><label for="declare-version">Libellé de version</label><input id="declare-version" value="${esc(suggestions.version)}" maxlength="24"><span class="helper">Proposé à partir du nom du parcours. Vérifiez-le : il n’est pas lu dans Genesys.</span></div></div>${btn('Déclarer comme parcours de référence', 'declare-reference', 'primary')}</section>`;
  const declinationPanel = `<section class="settings-panel"><div class="eyebrow">PARCOURS D’ENTITÉ</div><h2>Ce parcours est la déclinaison d’un Core Model</h2><p>Indiquez la version de référence dont il est décliné. Les écarts et l’impact des versions suivantes seront calculés par rapport à elle.</p>${versions.length ? `<fieldset class="choice-list"><legend>De quelle version est-il décliné ?</legend>${versions.map(({ model, version }, index) => `<label class="check-row"><input type="radio" name="declare-base" value="${esc(version.flowId)}" ${index === 0 ? 'checked' : ''}><span><strong>${esc(model.name)} · ${esc(versionName(version))}</strong><small>${version.flowId === model.latest.flowId ? 'Référence en cours' : 'Version antérieure'}${version.flow ? '' : ' · parcours absent de la source courante'}</small></span></label>`).join('')}</fieldset>${btn('Rattacher à cette référence', 'declare-declination', 'primary')}` : notice('Déclarez d’abord un parcours de référence : une déclinaison se rattache à une version de Core Model.')}</section>`;
  const removePanel = `<section class="settings-panel"><div class="eyebrow">RÔLE ACTUEL</div><h2>${esc(current)}</h2><p>Pour changer ce rôle, retirez d’abord le parcours du référentiel. Le parcours lui-même n’est pas modifié.</p>${btn('Retirer du référentiel', 'declare-remove', 'secondary')}</section>`;
  return (
    `<button class="back-link" data-action="declare-cancel">← Retour au parcours</button>` +
    head(
      'RÉFÉRENTIEL DES PARCOURS',
      'Quel est le rôle de ce parcours ?',
      `${title(flow)} · ${meta(flow)}`,
    ) +
    notice(
      'Le rôle d’un parcours n’est pas déduit de son nom, d’un suffixe de version ou de sa présence dans les tables. Votre déclaration est conservée dans le référentiel partagé Genesys ; elle ne modifie pas les règles WOLF.',
    ) +
    (role.role === 'none' ? referencePanel + declinationPanel : removePanel)
  );
}

/** Bandeau de rôle affiché en tête d'un parcours. */
export function roleBanner({ flow, role, summary, declinations }) {
  if (role.role === 'reference') {
    return `<div class="reference-banner">${icon('layers')}<div><strong>${esc(role.model.name)} · version ${esc(role.version.label)}${role.isLatest ? '' : ' (version antérieure)'}</strong><span>${role.isLatest ? 'Référence en cours' : `La référence en cours est la version ${esc(role.model.versions.at(-1).label)}`} · ${plural(declinations, 'déclinaison rattachée', 'déclinaisons rattachées')} au Core Model</span></div>${btn('Voir le Core Model', 'open-model', 'secondary small', `data-model="${esc(role.model.id)}"`)}${btn('Rôle', 'declare-start', 'quiet small', `data-id="${esc(flow.id)}" aria-label="Modifier le rôle de ce parcours"`)}</div>`;
  }
  if (role.role === 'declination') {
    const line = role.isCurrent
      ? gapsLine(summary?.gaps)
      : summary?.impact
        ? `La version ${esc(role.latest.label)} est disponible : ${[summary.impact.conflict && plural(summary.impact.conflict, 'conflit'), summary.impact.group && plural(summary.impact.group, 'évolution à examiner', 'évolutions à examiner')].filter(Boolean).join(' · ') || 'aucun impact relevé'}`
        : `La version ${esc(role.latest.label)} est disponible`;
    return `<div class="reference-banner">${icon('layers')}<div><strong>Déclinaison de « ${esc(role.model.name)} » · référence déclarée : version ${esc(role.base.label)}</strong><span>${role.isCurrent ? esc(line) : line} · périmètre déclaré : ${esc(scopeLabel(role.declination.scope).toLowerCase())}</span></div>${btn(role.isCurrent ? 'Voir les écarts' : 'Analyser l’impact', 'impact-open', 'secondary small', `data-id="${esc(flow.id)}"`)}${btn('Rôle', 'declare-start', 'quiet small', `data-id="${esc(flow.id)}" aria-label="Modifier le rôle de ce parcours"`)}</div>`;
  }
  return `<div class="reference-banner undeclared">${icon('layers')}<div><strong>Le rôle de ce parcours n’est pas déclaré</strong><span>Parcours de référence ou déclinaison d’une entité : déclarez-le pour suivre ses écarts et l’impact des évolutions.</span></div>${btn('Déclarer son rôle', 'declare-start', 'secondary small', `data-id="${esc(flow.id)}"`)}</div>`;
}
