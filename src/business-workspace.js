/**
 * Vue Métier d'un parcours : le fil de l'appel. Une étape par ligne, dans l'ordre où
 * l'appelant les rencontre, avec ce qu'il entend et où mène chaque branche.
 * Fonctions pures : l'état et les événements restent dans app.js.
 */
import { businessInspectorModel, audienceNodeTitle, isContextNode } from './journey-audience.js';
import { describeValue, flowRoutes, branchRank } from './business.js';
import { esc, icon, btn, tag } from './ui-kit.js';
import { normalizeSelectSearch } from './searchable-select.js';
import { stepIcon } from './journey-navigation.js';

export const businessTasks = [
  { id: 'all', label: 'Fil de l’appel', icon: 'layers' },
  { id: 'messages', label: 'Messages', icon: 'message', groups: ['messages'] },
  { id: 'team', label: 'Équipes', icon: 'people', groups: ['team'] },
  { id: 'calendars', label: 'Horaires', icon: 'clock', groups: ['calendars'] },
  { id: 'input', label: 'Menus et saisie', icon: 'menu', groups: ['input'] },
  { id: 'waiting', label: 'Attente', icon: 'clock', groups: ['waiting', 'music'] },
  { id: 'limits', label: 'Capacité des équipes', icon: 'people', groups: ['limits'] },
  { id: 'weights', label: 'Répartition des appels', icon: 'diff', groups: ['weights'] },
  { id: 'recording', label: 'Enregistrement', icon: 'shield', groups: ['recording'] },
  { id: 'identity', label: 'Identification', icon: 'phone', groups: ['identity'] },
  { id: 'checks', label: 'Contrôle des appels', icon: 'shield', groups: ['checks'] },
  { id: 'language', label: 'Langue', icon: 'globe', groups: ['language'] },
  { id: 'context', label: 'Contexte client', icon: 'people', groups: ['context', 'condition'] },
  {
    id: 'references',
    label: 'Configurations associées',
    icon: 'link',
    groups: ['references', 'division', 'routing'],
  },
  { id: 'other', label: 'Autres réglages', icon: 'layers', groups: ['other'] },
];
/** Ce que le métier modifie le plus souvent ; les autres rubriques restent accessibles dans une liste. */
export const primaryBusinessTasks = ['all', 'messages', 'calendars', 'team'];

export function taskFields(node, task = 'all') {
  const model = businessInspectorModel(node),
    definition = businessTasks.find((item) => item.id === task);
  return task === 'all'
    ? model.fields
    : model.groups
        .filter((group) => definition?.groups.includes(group.id))
        .flatMap((group) => group.fields);
}
export function availableBusinessTasks(flow) {
  return businessTasks
    .map((task) => ({
      ...task,
      label:
        flow.media === 'messaging'
          ? {
              all: 'Fil de la conversation',
              weights: 'Répartition des conversations',
              checks: 'Contrôles des conversations',
            }[task.id] || task.label
          : task.label,
      count: flow.nodes.reduce((sum, node) => sum + taskFields(node, task.id).length, 0),
    }))
    .filter((task) => task.id === 'all' || task.count > 0);
}

const present = (value) => value != null && String(value).trim() !== '';

/** Valeur affichée d'un réglage : la saisie en cours si elle existe, présentée comme une valeur enregistrée. */
function shownValue(field, pending) {
  if (!Object.hasOwn(pending, field.key))
    return {
      text: String(field.display ?? '').replace(/^tts:/i, ''),
      set: present(field.value),
      speech: /^tts:/i.test(String(field.value ?? '')) && !String(field.value).includes('|'),
    };
  const value = pending[field.key];
  if (value && typeof value === 'object')
    return {
      text: String(value.external ?? value.resource ?? ''),
      set: present(value.external ?? value.resource),
      speech: false,
    };
  const literal =
    field.kind === 'audio' || field.resource || field.key === 'DESCRIPTION' || value === '';
  return {
    text: String(literal ? value : describeValue(field.key, value)),
    set: present(value),
    speech:
      (field.kind === 'audio' || field.resource?.audio) &&
      typeof value === 'string' &&
      present(value),
  };
}
/** Ce que le client entend (ou lit, dans une conversation écrite) : une bulle, pas une ligne de réglage. */
const quote = (value, glyph) =>
  `<span class="story-quote">${icon(glyph)}<span>«\u00a0${esc(value)}\u00a0»</span></span>`;
/** Situation d'une branche : elle colore sa pastille, le libellé reste écrit en toutes lettres. */
const BRANCH_TONES = {
  OPEN: 'yes',
  TRUE: 'yes',
  LOGGEDIN: 'yes',
  NOT_BUSY: 'yes',
  CLOSED: 'off',
  HOLIDAY: 'off',
  NOTLOGGEDIN: 'off',
  EMERGENCY: 'alert',
  INQUEUE: 'wait',
  BUSY: 'wait',
  BUSY_QUEUE: 'wait',
};
/** Touche du clavier téléphonique d'un choix de menu. */
const branchKey = (branch = '') => {
  const option = /^OPTION(\d|STAR|DIEZ)$/.exec(branch);
  return option ? { STAR: '*', DIEZ: '#' }[option[1]] || option[1] : '';
};
/** Une branche qui ne mène pas à une étape : fin, transfert, équipe ou destination choisie pendant l'appel. */
const exitIcon = (route, messaging) => {
  const type = String(route.edge.type || '').toLowerCase();
  if (type === 'queue') return 'people';
  if (type === 'number') return 'phone';
  if (route.dynamic || !route.terminal) return 'spark';
  return messaging ? 'circlecheck' : 'hangup';
};
/** Un message ou une valeur longue prend toute la ligne ; les réglages courts se rangent côte à côte. */
const line = (field, value, glyph) =>
  `<div${value.speech || field.kind === 'audio' || value.text.length > 44 ? ' class="wide"' : ''}><dt>${esc(field.label)}</dt><dd>${value.speech ? quote(value.text, glyph) : esc(value.text || 'Non renseigné')}${!field.editable && !field.resource && field.kind === 'audio' ? '<small>Message enregistré · texte non modifiable ici</small>' : ''}</dd></div>`;

export function businessSteps(
  flow,
  { task = 'all', query = '', selected = -1, pending = new Map(), drafts = new Map() } = {},
) {
  const needle = normalizeSelectSearch(query),
    story = task === 'all',
    messaging = flow.media === 'messaging',
    voice = messaging ? 'message' : 'speaker';
  // Le numéro d'une étape ne dépend ni de la rubrique ni de la recherche : une branche peut le citer.
  const numbers = new Map();
  for (const node of flow.nodes) if (!isContextNode(node)) numbers.set(node.id, numbers.size + 1);
  const routes = flowRoutes(flow).filter((route) => route.relationship !== 'context');
  const items = flow.nodes.flatMap((node, index) => {
    const context = isContextNode(node),
      step = context ? 0 : numbers.get(node.id);
    // Les informations rattachées à une étape ne sont pas une étape de l'appel : elles ont leur rubrique.
    if (story && context) return [];
    const fields = taskFields(node, task);
    if (!fields.length) return [];
    const model = businessInspectorModel(node),
      edits = pending.get(node.id) || {},
      title = audienceNodeTitle(node);
    // La file d'une équipe est l'un de ses réglages, pas une branche de plus à lire.
    const branches = story
      ? routes
          .filter((route) => route.fromId === node.id && route.edge.branch !== 'QUEUE')
          .sort((a, b) => branchRank(a.edge.branch) - branchRank(b.edge.branch))
      : [];
    const spokenOnBranch = new Set(branches.map((route) => route.edge.audioField).filter(Boolean));
    const group = (id) => model.groups.find((item) => item.id === id)?.fields || [];
    const candidates = story
      ? [
          ...group('calendars'),
          ...group('team'),
          ...group('messages').filter((field) => !spokenOnBranch.has(field.key)),
        ]
      : fields;
    const values = candidates.map((field) => ({ field, value: shownValue(field, edits) }));
    const filled = values.filter(({ value }) => value.set),
      empty = values.length - filled.length;
    const lines = story ? filled : filled.length ? filled : values;
    const branchItems = branches.map((route) => {
      const target = route.toId
        ? flow.nodes.findIndex((candidate) => candidate.id === route.toId)
        : -1;
      const audioField = model.fields.find((field) => field.key === route.edge.audioField),
        audio = audioField ? shownValue(audioField, edits) : null;
      return {
        label: route.label,
        tone: BRANCH_TONES[route.edge.branch] || 'plain',
        key: branchKey(route.edge.branch),
        glyph: exitIcon(route, messaging),
        kind: target >= 0 ? flow.nodes[target].type : '',
        step: target >= 0 ? numbers.get(flow.nodes[target].id) : 0,
        target,
        title: target >= 0 ? audienceNodeTitle(flow.nodes[target]) : route.toTitle,
        unresolved: target < 0 && !route.resolved && !route.dynamic && !route.terminal,
        audio: audio?.set ? audio : null,
      };
    });
    if (
      needle &&
      !normalizeSelectSearch(
        [
          title,
          node.label,
          model.summary,
          ...lines.flatMap(({ field, value }) => [field.label, value.text]),
          ...branchItems.flatMap((item) => [item.label, item.title, item.audio?.text]),
        ].join(' '),
      ).includes(needle)
    )
      return [];
    const branchLine = (item) => {
      const mark = item.key
        ? `<span class="story-key" aria-hidden="true">${esc(item.key)}</span>`
        : '<span class="story-dot" aria-hidden="true"></span>';
      const destination =
        item.target >= 0
          ? `<button type="button" class="story-link" data-kind="${esc(item.kind)}" data-action="business-edit" data-node="${item.target}"><span class="story-link-icon">${icon(stepIcon(item.kind))}</span><span class="story-link-title">${esc(item.title)}</span>${item.step ? `<span class="story-link-step">Étape ${item.step}</span>` : ''}</button>`
          : item.unresolved
            ? `<span class="story-unresolved">${icon('alert')}${esc(item.title)}</span>`
            : `<span class="story-end">${icon(item.glyph)}${esc(item.title)}</span>`;
      const heard = !item.audio
        ? ''
        : item.audio.speech
          ? quote(item.audio.text, voice)
          : `<span class="story-recorded">${icon('play')}<span>${esc(item.audio.text)}</span></span>`;
      return `<li data-tone="${item.tone}"><span class="story-branch-label">${mark}<span>${esc(item.label)}</span></span><span class="story-branch-target">${destination}${heard}</span></li>`;
    };
    const editable = fields.some((field) => field.editable || field.resource);
    const status = pending.has(node.id)
      ? tag('À enregistrer', 'amber')
      : drafts.has(node.id)
        ? tag('Brouillon', 'amber')
        : '';
    // Trois zones alignées d'une étape à l'autre : l'étape, ce qui s'y passe, où va l'appel ensuite.
    const condition = model.summary
      ? `<div class="wide"><dt>Condition</dt><dd>${esc(model.summary)}</dd></div>`
      : '';
    const here =
      condition || lines.length
        ? `<div class="story-here"><dl class="story-lines">${condition}${lines.map(({ field, value }) => line(field, value, voice)).join('')}</dl>${!story && filled.length && empty ? `<p class="story-more-settings">${empty} ${empty > 1 ? 'autres réglages non renseignés' : 'autre réglage non renseigné'}</p>` : ''}</div>`
        : '';
    const next = branchItems.length
      ? `<ul class="story-branches" aria-label="Suites de cette étape">${branchItems.map(branchLine).join('')}</ul>`
      : '';
    return [
      `<li class="story-step${selected === index ? ' selected' : ''}" data-step="${index}" data-kind="${esc(node.type)}"><span class="story-icon">${icon(stepIcon(node.type))}</span><article class="story-card${here ? ' has-here' : ''}${next ? ' has-next' : ''}"><header class="story-id"><div><p class="story-kicker">${context ? '' : `<span class="story-number">Étape ${step}</span>`}<span class="story-kind">${esc(node.label || 'Étape')}</span></p><h3>${esc(title)}</h3></div><div class="story-id-actions">${btn(editable ? icon('pencil') + 'Modifier' : 'Consulter', 'business-edit', 'secondary small', `data-node="${index}" aria-label="${esc((editable ? 'Modifier ' : 'Consulter ') + title + (context ? '' : ' · étape ' + step))}"`)}${status}</div></header>${here}${next}</article></li>`,
    ];
  });
  return (
    items.join('') ||
    `<li class="story-empty"><h3>Aucune étape ne correspond</h3><p>${needle ? 'Essayez un autre terme ou une autre rubrique.' : 'Aucun réglage de cette rubrique dans ce parcours.'}</p></li>`
  );
}

export function businessWorkspace(flow, options, editor = '') {
  const tasks = availableBusinessTasks(flow),
    primary = tasks
      .filter((task) => primaryBusinessTasks.includes(task.id))
      .sort((a, b) => primaryBusinessTasks.indexOf(a.id) - primaryBusinessTasks.indexOf(b.id)),
    others = tasks.filter((task) => !primaryBusinessTasks.includes(task.id));
  const tabs = primary
    .map(({ id, label, icon: glyph }) =>
      btn(
        icon(glyph) + esc(label),
        'business-task',
        options.task === id ? 'active' : '',
        `data-task="${id}" aria-pressed="${options.task === id}"`,
      ),
    )
    .join('');
  const more = others.length
    ? `<div class="story-more${others.some((task) => task.id === options.task) ? ' active' : ''}"><select id="business-task-more" aria-label="Autres réglages"><option value="">Autres réglages…</option>${others.map((task) => `<option value="${task.id}"${task.id === options.task ? ' selected' : ''}>${esc(task.label)}</option>`).join('')}</select></div>`
    : '';
  return `<section class="business-workspace ${editor ? 'editing' : ''}"><div class="business-settings-list"><div class="story-toolbar"><div class="business-task-tabs" role="group" aria-label="Réglages à afficher">${tabs}${more}</div><div class="search business-settings-search">${icon('search')}<input id="business-settings-search" aria-label="Rechercher une étape ou un réglage" placeholder="Rechercher dans le parcours…" value="${esc(options.query)}"></div></div><ol id="business-steps" class="story-steps">${businessSteps(flow, options)}</ol></div>${editor}</section>`;
}
