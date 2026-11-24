import { esc, icon, btn, empty } from './ui-kit.js';
import { nodeTitle, humanText } from './business.js';

const list = (value) => (Array.isArray(value) ? value : []);
const decisionFor = (decisions, id) =>
  decisions instanceof Map ? decisions.get(id) : decisions?.[id];
const activeDecisions = (decisions) =>
  (decisions instanceof Map ? [...decisions] : Object.entries(decisions || {})).filter(
    ([, decision]) => decision?.mode === 'copy' || decision?.mode === 'edit',
  );
const valueText = (value) =>
  value == null || value === ''
    ? 'Non renseigné'
    : typeof value === 'boolean'
      ? value
        ? 'Oui'
        : 'Non'
      : typeof value === 'object'
        ? 'Valeur structurée'
        : String(value);
const modeLabel = (mode) =>
  mode === 'copy'
    ? 'Copié depuis la source'
    : mode === 'edit'
      ? 'Valeur personnalisée'
      : 'Valeur gardée';
const plural = (count, singular, pluralForm = singular + 's') =>
  `${count} ${count > 1 ? pluralForm : singular}`;
const optionValue = (option) => option.value ?? option.id ?? '';
const optionTitle = (option) => option.label ?? option.title ?? humanText(optionValue(option));

function displayChoiceLabel(item) {
  const label = String(item.label || ''),
    sourcePrefix = `${nodeTitle(item.leftNode)} · `;
  return item.structural && label.startsWith(sourcePrefix)
    ? `Destination · ${label.slice(sourcePrefix.length)}`
    : label;
}

function editControl(item, decision, index) {
  const value = Object.hasOwn(decision || {}, 'value') ? decision.value : item.value;
  const id = `comparison-value-${Array.from(String(item.id))
    .map((char) => char.codePointAt(0).toString(16))
    .join('-')}`;
  const attrs = `id="${id}" name="comparison-value" data-id="${esc(item.id)}"`;
  let control;
  if (item.kind === 'boolean')
    control = `<select ${attrs}><option value="true" ${String(value) === 'true' ? 'selected' : ''}>Oui</option><option value="false" ${String(value) === 'false' ? 'selected' : ''}>Non</option></select>`;
  else if (item.kind === 'destination') {
    const options = list(item.destinationOptions);
    control = `<select ${attrs}><option value="">Choisir une destination du parcours cible</option>${options.map((option) => `<option value="${esc(optionValue(option))}" ${String(value ?? '') === String(optionValue(option)) ? 'selected' : ''}>${esc(optionTitle(option))}</option>`).join('')}</select>`;
  } else if (item.kind === 'audio')
    control = `<textarea ${attrs} rows="3" placeholder="Texte entendu par le client">${esc(value ?? '')}</textarea>`;
  else
    control = `<input ${attrs} type="${item.kind === 'number' ? 'number' : 'text'}" ${item.kind === 'number' ? 'step="any"' : ''} value="${esc(value ?? '')}">`;
  return `<div class="comparison-inline-edit"><label for="${id}">${item.kind === 'destination' ? 'Nouvelle destination' : 'Nouvelle valeur'}</label>${control}</div>`;
}

function choiceRow(item, decisions, errors, index, plannedChange) {
  const decision = decisionFor(decisions, item.id),
    mode = decision?.mode || 'keep';
  const error = errors.filter((entry) => entry.id === item.id);
  const copyPreview = plannedChange
    ? (plannedChange.afterDisplay ?? valueText(plannedChange.after))
    : errors.length
      ? 'Choix à corriger'
      : item.kind === 'destination'
        ? 'Aucun changement effectif'
        : (item.beforeDisplay ?? valueText(item.before));
  const reasons = [
    !item.canCopy && item.copyReason ? `Copie indisponible : ${item.copyReason}` : '',
    !item.canEdit && item.editReason ? `Modification indisponible : ${item.editReason}` : '',
    item.notice,
  ].filter(Boolean);
  const action = (label, actionName, selected, enabled, reason) =>
    `<button class="comparison-choice ${selected ? 'selected' : ''}" data-action="${actionName}" data-id="${esc(item.id)}" aria-pressed="${selected}" ${enabled ? '' : 'disabled'} ${reason ? `title="${esc(reason)}"` : ''}>${label}</button>`;
  return `<article class="comparison-row ${mode !== 'keep' ? 'decided' : ''}" data-comparison-id="${esc(item.id)}">
    <div class="comparison-field"><strong>${esc(displayChoiceLabel(item))}</strong>${item.structural ? '<span class="comparison-field-note">Embranchement</span>' : ''}</div>
    <div class="comparison-value source"><span class="comparison-mobile-label">Source</span>${esc(item.beforeDisplay ?? valueText(item.before))}</div>
    <div class="comparison-target"><span class="comparison-mobile-label">Cible</span><div class="comparison-current ${mode !== 'keep' ? 'changing' : ''}">${mode !== 'keep' ? '<small>Valeur actuelle</small>' : ''}<span>${esc(item.afterDisplay ?? valueText(item.after))}</span></div>
      ${mode === 'copy' ? `<div class="comparison-planned"><small>${errors.length && !plannedChange ? 'Copie à vérifier' : 'Après copie'}</small><strong>${esc(copyPreview)}</strong></div>` : ''}
      ${mode === 'edit' ? editControl(item, decision, index) : ''}
      <div class="comparison-choices" role="group" aria-label="Décision pour ${esc(displayChoiceLabel(item))}">${action('Garder', 'decision-keep', mode === 'keep', true)}${action('Copier', 'decision-copy', mode === 'copy', Boolean(item.canCopy), item.copyReason)}${action('Modifier', 'decision-edit', mode === 'edit', Boolean(item.canEdit), item.canEdit ? '' : item.editReason)}</div>
      ${reasons.length ? `<details class="comparison-reasons"><summary>${!item.canCopy || !item.canEdit ? 'Pourquoi certaines actions sont indisponibles' : 'À vérifier'}</summary>${reasons.map((reason) => `<p>${esc(reason)}</p>`).join('')}${!item.canCopy && !item.canEdit && item.rightNode?.id ? btn('Ouvrir les réglages', 'comparison-open-step', 'quiet small', `data-node-id="${esc(item.rightNode.id)}"`) : ''}</details>` : ''}
      ${error.map((entry) => `<p class="comparison-field-error" role="alert">${icon('alert')}${esc(entry.message)}</p>`).join('')}
    </div>
  </article>`;
}

const mappingReason = (value) =>
  ({
    entry: 'Entrées des parcours',
    'shared-row': 'Même étape utilisée dans les deux parcours',
    'branch-path': 'Même chemin dans le parcours',
    'shared-path': 'Chemin commun entre les parcours',
    'unique-type': 'Une seule étape de ce type de chaque côté',
    declared: 'Correspondance choisie manuellement',
  })[value] ||
  value ||
  '';

function mappingPanel(rows, open) {
  if (!open) return '';
  return `<section class="comparison-mapping"><header><div><h2>Associer les étapes</h2><p>Choisissez l’étape cible à comparer à chaque étape source.</p></div>${btn('Fermer', 'comparison-mapping-toggle', 'quiet small')}</header>
    <div class="comparison-mapping-labels"><span>Étape source</span><span>Étape du parcours cible</span></div>
    ${
      rows.length
        ? rows
            .map((row, index) => {
              const options = list(row.options),
                selectedId = row.explicitId || '',
                currentIncluded = options.some(
                  (option) => String(option.id) === String(selectedId),
                );
              return `<div class="comparison-mapping-row"><div><strong>${esc(row.leftTitle)}</strong><small>${esc(row.typeLabel || '')}</small>${row.reason ? `<p>${esc(mappingReason(row.reason))}</p>` : ''}</div><div><label class="comparison-mobile-label" for="mapping-${index}">Étape cible pour ${esc(row.leftTitle)}</label><select id="mapping-${index}" name="comparison-mapping" data-left="${esc(row.leftId)}" aria-label="Étape cible pour ${esc(row.leftTitle)}"><option value="">Automatique</option>${selectedId && !currentIncluded ? `<option value="${esc(selectedId)}" selected>${esc(row.rightTitle || 'Correspondance actuelle')}</option>` : ''}${options.map((option) => `<option value="${esc(option.id)}" ${String(option.id) === String(selectedId) ? 'selected' : ''}>${esc(option.title)}</option>`).join('')}</select>${row.rightTitle ? `<p>Rapproché avec : ${esc(row.rightTitle)}</p>` : '<p>Aucune étape cible rapprochée actuellement.</p>'}${row.manual ? '<span class="comparison-mapping-manual">Correspondance choisie manuellement</span>' : ''}</div></div>`;
            })
            .join('')
        : '<p class="comparison-empty-inline">Aucune correspondance à définir pour ces parcours.</p>'
    }
  </section>`;
}

function unpairedCounts(diff) {
  const left = new Set(),
    right = new Set();
  for (const [index, entry] of list(diff?.unmatched).entries())
    (entry.side === 'left' ? left : right).add(entry.node?.id ?? `unmatched-${index}`);
  for (const [index, entry] of list(diff?.ambiguous).entries()) {
    for (const [offset, node] of list(entry.leftNodes).entries())
      left.add(node.id ?? `ambiguous-${index}-${offset}`);
    for (const [offset, node] of list(entry.rightNodes).entries())
      right.add(node.id ?? `ambiguous-${index}-${offset}`);
  }
  return { left: left.size, right: right.size, total: left.size + right.size };
}

function unpairedPanel(diff, mappingOpen) {
  const unmatched = list(diff?.unmatched),
    ambiguous = list(diff?.ambiguous),
    count = unpairedCounts(diff);
  if (!count.total) return '';
  return `<details class="comparison-unpaired"><summary>${icon('link')}<strong>${plural(count.total, 'étape non comparée', 'étapes non comparées')}</strong><span>${count.left} côté source · ${count.right} côté cible</span></summary>
    <div class="comparison-unpaired-body"><p>Une correspondance doit être choisie pour comparer ces étapes.</p>${btn(mappingOpen ? 'Masquer les associations' : 'Associer ces étapes', 'comparison-mapping-toggle', 'secondary small')}
    <div class="comparison-unpaired-list">${unmatched.map((entry) => `<div><span>${entry.side === 'left' ? 'Dans la source' : 'Dans la cible'}</span><strong>${esc(entry.node ? nodeTitle(entry.node) : entry.label)}</strong></div>`).join('')}${ambiguous
      .map(
        (entry) =>
          `<div class="comparison-ambiguous"><span>Association à choisir${entry.label ? ' · ' + esc(entry.label) : ''}</span><div><strong>Source</strong><p>${
            list(entry.leftNodes)
              .map((node) => esc(nodeTitle(node)))
              .join(' · ') || '—'
          }</p></div><div><strong>Cible</strong><p>${
            list(entry.rightNodes)
              .map((node) => esc(nodeTitle(node)))
              .join(' · ') || '—'
          }</p></div></div>`,
      )
      .join('')}</div></div>
  </details>`;
}

function orphanChoicesPanel(errors, choices, decisions) {
  const ids = new Set(choices.map((item) => item.id));
  const orphanErrors = errors.filter((error) => !ids.has(error.id));
  if (!orphanErrors.length) return '';
  return `<section class="comparison-orphan-choices" role="alert"><header>${icon('alert')}<div><h2>Choix à actualiser</h2><p>Ces choix ne correspondent plus aux écarts actuels. Retirez-les pour préparer un nouveau brouillon.</p></div></header><ul>${orphanErrors.map((error) => `<li><p>${esc(error.message)}</p>${decisionFor(decisions, error.id) ? btn('Retirer ce choix', 'decision-keep', 'secondary small', `data-id="${esc(error.id)}"`) : ''}</li>`).join('')}</ul></section>`;
}

function reviewPanel({ plan, rightTitle, decisions, choices }) {
  const changes = list(plan?.changes),
    errors = list(plan?.errors);
  const selectedCount = activeDecisions(decisions).length;
  const ids = new Set(choices.map((item) => item.id));
  const rowErrors = errors.filter((error) => ids.has(error.id));
  return `<section class="comparison-review"><header><span class="comparison-review-symbol">${icon('check')}</span><div><h2>Résultat pour ${esc(rightTitle)}</h2><p>${plural(changes.length, 'changement')} dans le brouillon.</p></div></header>
    ${selectedCount > changes.length ? `<p class="comparison-review-note">${plural(selectedCount, 'choix préparé', 'choix préparés')} ; seuls les changements effectifs figurent ci-dessous.</p>` : ''}
    ${rowErrors.length ? `<div class="comparison-plan-errors" role="alert"><strong>Des choix restent à corriger</strong>${rowErrors.map((error) => `<p>${esc(error.message)}</p>`).join('')}</div>` : ''}
    <div class="comparison-review-labels"><span>Réglage</span><span>Cible actuelle</span><span>Après modification</span></div>
    ${
      changes
        .map((change) => {
          const choice = choices.find((item) => item.id === change.id);
          return `<article class="comparison-review-row"><div><strong>${esc(choice ? displayChoiceLabel(choice) : change.label)}</strong>${choice?.rightNode ? `<small class="comparison-review-step">${esc(nodeTitle(choice.rightNode))}</small>` : ''}<small>${modeLabel(change.mode)}</small></div><div class="comparison-review-before"><span class="comparison-mobile-label">Cible actuelle</span>${esc(change.beforeDisplay ?? valueText(change.before))}</div><div class="comparison-review-after"><span class="comparison-mobile-label">Après modification</span>${esc(change.afterDisplay ?? valueText(change.after))}${list(change.sharedNames).length ? `<p class="comparison-shared-note">${icon('alert')} Étape partagée avec ${change.sharedNames.map((name) => esc(name)).join(', ')}.</p>` : ''}</div></article>`;
        })
        .join('') ||
      '<p class="comparison-empty-inline">Aucun changement effectif à enregistrer.</p>'
    }
    <footer><p>${icon('shield')} Modifications non publiées</p><div>${btn('Modifier les choix', 'comparison-edit', 'secondary')}${btn('Créer le brouillon', 'comparison-apply', 'primary', !changes.length || errors.length ? 'disabled' : '')}</div></footer>
  </section>`;
}

/** Render decisions over actual matched steps; this module does not mutate data. */
export function comparisonWorkspace({
  left,
  right,
  leftTitle,
  rightTitle,
  diff,
  choices = [],
  decisions = {},
  plan = {},
  review = false,
  mappingOpen = false,
  mappingRows = [],
  query = '',
} = {}) {
  if (!left || !right || !diff)
    return empty(
      'Choisissez deux parcours',
      'Le parcours source fournit les valeurs à reprendre. Vos choix prépareront un brouillon du parcours cible.',
    );
  const allChoices = list(choices),
    errors = list(plan.errors),
    changes = list(plan.changes);
  const selected = activeDecisions(decisions);
  const needle = query.trim().toLocaleLowerCase('fr');
  const visible = allChoices.filter((item) =>
    [
      item.label,
      item.beforeDisplay,
      item.afterDisplay,
      nodeTitle(item.leftNode),
      nodeTitle(item.rightNode),
    ]
      .join(' ')
      .toLocaleLowerCase('fr')
      .includes(needle),
  );
  const grouped = new Map();
  for (const item of visible) {
    const key = `${item.leftNode?.id || ''}\u0000${item.rightNode?.id || ''}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const nodeOrder = new Map(list(right.nodes).map((node, index) => [node.id, index]));
  const orderedGroups = [...grouped.values()].sort(
    (a, b) =>
      (nodeOrder.get(a[0].rightNode?.id) ?? Infinity) -
      (nodeOrder.get(b[0].rightNode?.id) ?? Infinity),
  );
  const recovery = orphanChoicesPanel(errors, allChoices, decisions);
  const unpaired = unpairedCounts(diff);
  if (review)
    return `<div class="comparison-workspace">${recovery}${reviewPanel({ plan, rightTitle, decisions, choices: allChoices })}</div>`;
  return `<div class="comparison-workspace">${recovery}
    <div class="comparison-toolbar"><strong>${plural(allChoices.length, 'écart')}</strong><div class="comparison-toolbar-actions">${btn(mappingOpen ? 'Fermer les associations' : `Associer les étapes${unpaired.total ? ` (${unpaired.total} à vérifier)` : ''}`, 'comparison-mapping-toggle', 'quiet small')}<label class="comparison-search" for="comparison-search">${icon('search')}<input id="comparison-search" placeholder="Rechercher un réglage…" aria-label="Rechercher un écart" value="${esc(query)}"></label></div></div>
    ${mappingPanel(list(mappingRows), mappingOpen)}
    <div class="comparison-column-labels"><span>Réglage</span><span>Source</span><span>Cible · vos choix</span></div>
    <div class="comparison-groups">${
      orderedGroups
        .map((items) => {
          const first = items[0];
          return `<section class="comparison-step"><header><span class="comparison-step-icon">${icon('layers')}</span><div><h2>${esc(nodeTitle(first.rightNode))}</h2>${nodeTitle(first.leftNode) !== nodeTitle(first.rightNode) ? `<p>Comparé à ${esc(nodeTitle(first.leftNode))}</p>` : ''}</div><span>${plural(items.length, 'écart')}</span></header>${items
            .map((item) =>
              choiceRow(
                item,
                decisions,
                errors,
                allChoices.indexOf(item),
                changes.find((change) => change.id === item.id),
              ),
            )
            .join('')}</section>`;
        })
        .join('') ||
      `<div class="comparison-empty-inline">${allChoices.length ? 'Aucun écart ne correspond à votre recherche.' : 'Aucun écart parmi les étapes comparées.'}</div>`
    }</div>
    ${unpairedPanel(diff, mappingOpen)}
    <div class="comparison-bottom-bar"><div><strong>${plural(selected.length, 'changement choisi', 'changements choisis')}</strong>${errors.length ? `<span>${plural(errors.length, 'point à corriger', 'points à corriger')}</span>` : ''}</div><div>${btn('Tout garder', 'comparison-reset', 'quiet', !selected.length ? 'disabled' : '')}${btn('Voir le résultat', 'comparison-review', 'primary', !selected.length ? 'disabled' : '')}</div></div>
  </div>`;
}
