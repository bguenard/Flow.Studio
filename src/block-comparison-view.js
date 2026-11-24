import { esc, icon, btn } from './ui-kit.js';
import { nodeTitle, branchLabel, humanText } from './business.js';

const list = value => Array.isArray(value) ? value : [];
const get = (values, key) => values instanceof Map ? values.get(key) : values?.[key];
const countLabel = (count, singular, plural = singular + 's') => `${count} ${count > 1 ? plural : singular}`;
const domId = (prefix, value) => `${prefix}-${Array.from(String(value)).map(char => char.codePointAt(0).toString(16)).join('-')}`;
const canonical = value => String(value || '').toLowerCase();
const iconFor = node => ({ schedulegroup: 'clock', menu: 'menu', service: 'people', pdata: 'building', bot: 'message', decision: 'diff', ratiodistrib: 'people' })[canonical(node?.type)] || 'layers';
const isContext = candidate => candidate.options?.kind === 'context' || canonical(candidate.sourceNode?.type) === 'pdata';
const isAmbiguous = candidate => candidate.ambiguous || candidate.status === 'ambiguous';
const optionLabel = option => option.label || option.title || 'Destination du parcours';

function destinationLabel(flow, edge) {
  const node = list(flow?.nodes).find(candidate => candidate.id === edge?.to);
  if (node) return nodeTitle(node);
  if (edge?.dynamic) return 'Destination choisie pendant l’appel';
  const type = canonical(edge?.type);
  if (type === 'disconnect') return 'Fin de l’appel';
  if (type === 'next') return 'Poursuite de l’attente';
  if (edge?.terminal) return humanText(edge.target || edge.rawTarget) || 'Fin de cette branche';
  return 'Destination à vérifier';
}

function currentDestination(right, placement) {
  const edges = list(right?.edges).filter(edge => edge.from === placement?.fromId && edge.field === placement?.field && edge.relationship !== 'context');
  return edges.length === 1 ? destinationLabel(right, edges[0]) : 'la suite actuelle de cette branche';
}

function sourceRoutes(candidate, left) {
  if (isContext(candidate)) return '<p class="block-card-description">Informations associées à l’appel, sans modifier sa destination.</p>';
  const routes = list(left?.edges).filter(edge => edge.from === candidate.sourceNode?.id && edge.relationship !== 'context');
  if (!routes.length) return '';
  return `<ul class="block-routes" aria-label="Sorties du bloc source">${routes.map(edge => `<li><span>${esc(branchLabel(edge))}</span>${icon('chevron')}<span>${esc(destinationLabel(left, edge))}</span></li>`).join('')}</ul>`;
}

function connectionFields(candidate, decision) {
  const options = candidate.options || {}, outlets = list(options.outlets);
  if (isContext(candidate) || !outlets.length) return '';
  return `<div class="block-exits"><h4>Après ce bloc, où continue l’appel ?</h4>${outlets.map(outlet => {
    const selected = get(decision.connections, outlet.id), mode = selected?.mode || (outlet.requiresConnection ? '' : 'preserve');
    const inputId = domId('block-exit', `${candidate.id}|${outlet.id}`);
    const destinationId = domId('block-destination', `${candidate.id}|${outlet.id}`);
    const destinationOptions = list(options.destinations);
    const missingTarget = mode === 'target' && selected?.nodeId && !destinationOptions.some(option => String(option.nodeId ?? option.value) === String(selected.nodeId));
    return `<div class="block-exit-row"><div><strong>${esc(outlet.label)}</strong>${outlet.requiresConnection ? '<small>Raccordement à choisir</small>' : '<small>Comportement source conservé par défaut</small>'}</div><div class="block-field"><label class="block-control-label" for="${inputId}">Suite de « ${esc(outlet.label)} »</label><select id="${inputId}" name="block-exit-mode" data-id="${esc(candidate.id)}" data-outlet="${esc(outlet.id)}"><option value="" ${!mode ? 'selected' : ''} ${outlet.requiresConnection ? '' : 'disabled'}>Choisir la suite de l’appel</option>${!outlet.requiresConnection ? `<option value="preserve" ${mode === 'preserve' ? 'selected' : ''}>Conserver le comportement source</option>` : ''}<option value="resume" ${mode === 'resume' ? 'selected' : ''}>Reprendre la suite actuelle de la branche cible</option><option value="target" ${mode === 'target' ? 'selected' : ''}>Choisir une étape du parcours cible</option></select>${mode === 'target' ? `<div class="block-destination-field"><label for="${destinationId}">Étape à rejoindre</label><select id="${destinationId}" name="block-exit-target" data-id="${esc(candidate.id)}" data-outlet="${esc(outlet.id)}"><option value="" ${!selected?.nodeId ? 'selected' : ''}>Choisir une étape cible</option>${missingTarget ? '<option value="" selected>Destination indisponible · choisissez une étape</option>' : ''}${destinationOptions.map(option => `<option value="${esc(option.nodeId ?? option.value)}" ${String(option.nodeId ?? option.value) === String(selected?.nodeId || '') ? 'selected' : ''}>${esc(optionLabel(option))}</option>`).join('')}</select></div>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function preview(candidate, decision, plan, right) {
  if (!plan || list(plan.errors).length || !plan.snapshot && !plan.createdRows?.length) return '';
  const options = candidate.options || {}, placement = list(options.placements).find(item => item.id === decision.placementId);
  if (!placement) return '';
  const resumeLabel = plan.summary?.resumeLabel || currentDestination(right, placement);
  const placementLabel = plan.summary?.placementLabel || placement.label;
  if (isContext(candidate)) return `<div class="block-route-preview"><strong>Résultat dans le parcours cible</strong><div class="block-information-preview">${icon('building')}<p>Ajouter <strong>${esc(nodeTitle(candidate.sourceNode))}</strong> sur « ${esc(placementLabel)} ».<br>La destination de l’appel reste ${esc(resumeLabel)}.</p></div></div>`;
  const outgoing = list(options.outlets).map(outlet => {
    const connection = get(decision.connections, outlet.id), mode = connection?.mode || (outlet.requiresConnection ? '' : 'preserve');
    const destination = mode === 'resume' ? resumeLabel : mode === 'target' ? optionLabel(list(options.destinations).find(option => String(option.nodeId ?? option.value) === String(connection?.nodeId)) || {}) : 'Comportement source conservé';
    return `<div class="block-route-line"><small>${esc(outlet.label)}</small>${icon('chevron')}<span>${esc(destination)}</span></div>`;
  }).join('');
  return `<div class="block-route-preview"><strong>Résultat dans le parcours cible</strong><div class="block-route-line"><span>${esc(placementLabel)}</span>${icon('chevron')}<span class="new-block">${esc(nodeTitle(candidate.sourceNode))}</span></div>${outgoing}</div>`;
}

function planNotes(candidate, plan) {
  const notices = [...new Set([...list(candidate.options?.notices), ...list(plan?.summary?.notices)].map(notice => typeof notice === 'string' ? notice : notice.message).filter(Boolean))];
  const created = list(plan?.createdRows), extra = created.filter(row => row.sourceNodeId !== candidate.sourceNode?.id);
  if (!notices.length && !extra.length) return '';
  return `<details class="block-details"><summary>${extra.length ? countLabel(extra.length, 'étape associée reprise', 'étapes associées reprises') : 'Points à vérifier'}</summary>${extra.length ? `<p>Les étapes utilisées par ce bloc sont ajoutées avec lui.</p><ul>${extra.map(entry => `<li>${esc(humanText(entry.row?.DESCRIPTION) || 'Étape associée')}</li>`).join('')}</ul>` : ''}${notices.map(notice => `<p>${esc(notice)}</p>`).join('')}</details>`;
}

function insertionForm(candidate, decision, plan, right) {
  const options = candidate.options || {}, placements = list(options.placements), inputId = domId('block-placement', candidate.id);
  const missingPlacement = decision.placementId && !placements.some(placement => placement.id === decision.placementId);
  return `<div class="block-insertion"><p class="block-insertion-heading">${icon('link')}${isContext(candidate) ? 'Ajouter ces informations sur une branche' : 'Raccorder ce bloc au parcours cible'}</p><div class="block-placement-grid"><div class="block-field wide"><label for="${inputId}">${isContext(candidate) ? 'Branche à enrichir' : 'Insérer après · étape et branche cible'}</label><select id="${inputId}" name="block-placement" data-id="${esc(candidate.id)}"><option value="" ${!decision.placementId ? 'selected' : ''}>Choisir l’emplacement dans le parcours cible</option>${missingPlacement ? '<option value="" selected>Emplacement indisponible · choisissez une branche</option>' : ''}${placements.map(placement => `<option value="${esc(placement.id)}" ${placement.id === decision.placementId ? 'selected' : ''}>${esc(placement.label)}</option>`).join('')}</select></div></div>${connectionFields(candidate, decision)}${list(plan?.errors).map(error => `<p class="block-error" role="alert">${icon('alert')}${esc(error.message)}</p>`).join('')}${preview(candidate, decision, plan, right)}${planNotes(candidate, plan)}</div>`;
}

function blockCard(candidate, { left, right, decisions, plans }) {
  const decision = get(decisions, candidate.id), inserting = decision?.mode === 'insert', options = candidate.options || {}, canInsert = Boolean(options.canInsert);
  const source = candidate.sourceNode || options.sourceNode, ambiguous = isAmbiguous(candidate), reason = options.reason || (!candidate.options ? 'Les emplacements disponibles doivent être calculés avant l’insertion.' : 'Ce bloc ne peut pas encore être inséré.');
  return `<article class="block-card ${inserting ? 'is-inserting' : ''}" data-block-id="${esc(candidate.id)}"><div class="block-card-main"><span class="block-card-icon">${icon(iconFor(source))}</span><div class="block-card-copy"><div class="block-card-eyebrow"><span>${esc(source?.label || (isContext(candidate) ? 'Contexte de l’appel' : 'Bloc du parcours'))}</span><span class="${ambiguous ? 'ambiguous' : ''}">${ambiguous ? 'Correspondance à choisir' : 'Présent seulement dans la source'}</span></div><h3>${esc(nodeTitle(source))}</h3>${ambiguous ? '<p class="block-card-description">Associez-le à un bloc cible existant, ou ajoutez-le explicitement comme nouveau bloc.</p>' : ''}${sourceRoutes(candidate, left)}</div><div class="block-card-actions">${ambiguous ? btn(icon('link') + ' Associer', 'block-associate', 'secondary small', `data-id="${esc(candidate.id)}"`) : ''}${btn('Ignorer', 'block-ignore', `small ${inserting ? 'quiet' : 'selected'}`, `data-id="${esc(candidate.id)}" aria-pressed="${!inserting}"`)}${btn(icon('plus') + (ambiguous ? ' Ajouter comme nouveau bloc' : ' Insérer'), 'block-insert', `small ${inserting ? 'selected' : 'secondary'}`, `data-id="${esc(candidate.id)}" aria-pressed="${inserting}" ${canInsert ? '' : `disabled title="${esc(reason)}"`}`)}</div></div>${!canInsert ? `<p class="block-error">${icon('alert')}${esc(reason)}</p>` : ''}${inserting ? insertionForm(candidate, decision, get(plans, candidate.id), right) : ''}</article>`;
}

function targetOnly(diff) {
  const nodes = new Map(list(diff?.unmatched).filter(entry => entry.side === 'right' && entry.node).map(entry => [entry.node.id, entry.node]));
  if (!nodes.size) return '';
  return `<details class="block-target-only"><summary>${icon('shield')}<strong>${countLabel(nodes.size, 'bloc propre à la cible', 'blocs propres à la cible')}</strong><span>Conservés dans le parcours</span></summary><ul class="block-target-list">${[...nodes.values()].map(node => `<li><div><strong>${esc(nodeTitle(node))}</strong>${node.label ? `<small>${esc(node.label)}</small>` : ''}</div><span class="block-kept">${icon('check')} Garder</span></li>`).join('')}</ul></details>`;
}

function reviewBlocks({ candidates, decisions, plans, right }) {
  const selected = candidates.filter(candidate => get(decisions, candidate.id)?.mode === 'insert');
  if (!selected.length) return '';
  return `<section class="block-comparison"><div class="block-comparison-heading"><div><h2>Blocs à ajouter au parcours cible</h2><p>${countLabel(selected.length, 'insertion choisie', 'insertions choisies')}.</p></div></div><div class="block-review">${selected.map(candidate => {
    const decision = get(decisions, candidate.id), plan = get(plans, candidate.id), created = list(plan?.createdRows);
    return `<article class="block-review-card"><header>${icon(isContext(candidate) ? 'building' : 'plus')}<div><h3>${esc(nodeTitle(candidate.sourceNode))}</h3><p>${isContext(candidate) ? 'Informations associées à l’appel' : 'Nouveau bloc dans le parcours cible'}${created.length > 1 ? ` · ${countLabel(created.length, 'étape reprise', 'étapes reprises')}` : ''}</p></div></header>${list(plan?.errors).map(error => `<p class="block-error" role="alert">${icon('alert')}${esc(error.message)}</p>`).join('')}${!plan ? '<p class="block-error">Le raccordement de ce bloc reste à vérifier.</p>' : ''}${preview(candidate, decision, plan, right)}${planNotes(candidate, plan)}</article>`;
  }).join('')}</div></section>`;
}

/** Pure business rendering. Insertion choices and graph mutation belong to the caller. */
export function blockComparisonWorkspace({ left, right, diff, candidates = [], decisions = {}, plans = {}, review = false } = {}) {
  if (!left || !right) return '';
  const available = list(candidates);
  if (review) return reviewBlocks({ candidates: available, decisions, plans, right });
  const selected = available.filter(candidate => get(decisions, candidate.id)?.mode === 'insert');
  return `<section class="block-comparison"><div class="block-comparison-heading"><div><h2>Les blocs différents</h2><p>Choisissez les blocs de la source à ajouter, puis leur place dans le parcours cible.</p></div><span>${countLabel(selected.length, 'insertion choisie', 'insertions choisies')}</span></div>${available.length ? `<div class="block-cards">${available.map(candidate => blockCard(candidate, { left, right, decisions, plans })).join('')}</div>` : '<div class="block-empty">Tous les blocs de la source ont une correspondance dans le parcours cible.</div>'}${targetOnly(diff)}</section>`;
}
