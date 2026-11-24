import { journeySteps } from './journey-navigation.js';
import { esc, icon, tag } from './ui-kit.js';
import { audienceNodeTitle, audienceNodeSubtitle, isContextNode } from './journey-audience.js';

export function stepList(flow, { selectedId, overview, query = '', hasDraft = () => false, audience = 'business' } = {}) {
  const steps = journeySteps(flow).filter(step => audience === 'admin' || !isContextNode(flow.nodes[step.index])).map(step => {
    const node = flow.nodes[step.index];
    return { ...step, title: audienceNodeTitle(node, audience), label: audienceNodeSubtitle(node, audience), contextOnly: step.contextOnly || isContextNode(node) };
  });
  const needle = query.trim().toLocaleLowerCase('fr');
  const visible = steps.filter(step => [step.title, step.label, ...step.incoming.map(link => `${link.title} ${link.label}`)].join(' ').toLocaleLowerCase('fr').includes(needle));
  const links = items => items.map(step => {
    return `<button title="${esc(step.title)}" class="journey-step ${!overview && selectedId === step.id ? 'active' : ''}" data-action="select-node" data-node="${step.index}" ${!overview && selectedId === step.id ? 'aria-current="step"' : ''}>
      <span class="journey-step-icon">${icon(step.icon)}</span><span class="journey-step-copy"><strong>${esc(step.title).replace(/_/g, '_<wbr>')}</strong><small>${esc(step.entry ? 'Entrée du parcours' : step.label)}</small>${hasDraft(step.id) ? tag('Brouillon', 'amber') : ''}</span>
    </button>`;
  }).join('');
  const route = visible.filter(step => !step.contextOnly), context = visible.filter(step => step.contextOnly);
  return `${links(route)}${context.length ? '<div class="journey-list-label">Informations rattachées aux étapes</div>' + links(context) : ''}${!visible.length ? '<p class="journey-no-match">Aucune étape ne correspond à votre recherche.</p>' : ''}`;
}

export function journeyNavigation(flow, options = {}) {
  const steps = journeySteps(flow), contexts = steps.filter(step => isContextNode(flow.nodes[step.index]));
  const count = steps.length - contexts.length;
  return `<nav class="journey-nav" aria-label="Étapes du parcours">
    <button class="journey-overview ${options.overview ? 'active' : ''}" data-action="journey-overview" ${options.overview ? 'aria-current="page"' : ''}>${icon('layers')}<span>Vue d’ensemble<small>Étapes et embranchements</small></span></button>
    <div class="journey-nav-heading"><h2>${count} étape${count > 1 ? 's' : ''} dans ce parcours</h2><button type="button" class="journey-nav-close" data-action="toggle-steps" aria-label="Masquer les étapes" title="Masquer les étapes">${icon('close')}</button></div>
    <label class="journey-search" for="step-search">${icon('search')}<input id="step-search" aria-label="Rechercher une étape" placeholder="Rechercher une étape…" value="${esc(options.query || '')}"></label>
    <div class="journey-step-list" id="journey-step-list">${stepList(flow, options)}</div>
  </nav>`;
}

export function stepRelations(flow, nodeId, side, { audience = 'business' } = {}) {
  if (audience !== 'admin' && ['contexts', 'usedBy'].includes(side)) return '';
  const step = journeySteps(flow).find(item => item.id === nodeId);
  if (!step) return '';
  const incoming = side === 'incoming' || side === 'usedBy';
  const attached = link => link.derivedFrom === 'QUEUE' || /^INQUEUE_(?:MENU_[1-4]|REPEAT_MENU)$/.test(link.field || '');
  const links = side === 'incoming' ? step.incoming.filter(link => link.relationship !== 'context') : side === 'usedBy' ? step.incoming.filter(link => link.relationship === 'context') : side === 'contexts' ? step.contexts : side === 'attachments' ? step.outgoing.filter(attached) : step.outgoing.filter(link => !attached(link));
  if (!links.length) return '';
  const title = side === 'incoming' ? 'On arrive ici depuis' : side === 'usedBy' ? 'Ces informations sont utilisées par' : side === 'contexts' ? 'Informations associées à cette étape' : side === 'attachments' ? 'Distribution et attente' : 'La suite du parcours';
  return `<section class="step-relations" aria-label="${title}"><h3>${title}</h3><div class="step-relation-list">${links.map(link => {
    const id = incoming ? link.fromId : link.toId;
    const index = flow.nodes.findIndex(node => node.id === id);
    const label = side === 'contexts' ? 'Informations transmises' : link.label;
    const title = index >= 0 ? audienceNodeTitle(flow.nodes[index], audience) : link.title;
    return `<${index >= 0 ? 'button' : 'div'} class="step-relation ${index < 0 && !link.resolved && !link.terminal && !link.dynamic ? 'unresolved' : ''}" ${index >= 0 ? `data-action="select-node" data-node="${index}"` : ''}><span>${esc(label)}</span><strong>${esc(title)}</strong>${index >= 0 ? '<small>Ouvrir cette étape</small>' : ''}</${index >= 0 ? 'button' : 'div'}>`;
  }).join('')}</div></section>`;
}
