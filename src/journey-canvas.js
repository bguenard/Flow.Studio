import { MESSAGE_LABELS } from './media-profiles.js';
import { nodeTitle, flowRoutes, businessFields } from './business.js';
import { journeySteps } from './journey-navigation.js';
import { audienceNodeTitle } from './journey-audience.js';

const CARD_WIDTH = 280,
  COLUMN_GAP = 168,
  ROW_GAP = 40;
const KIND_LABELS = {
  inboundcall: 'Accueil téléphonique',
  menu: 'Menu vocal',
  schedulegroup: 'Horaires',
  service: 'Équipe de traitement',
  decision: 'Règle métier',
  pdata: 'Attributs métier',
  ratiodistrib: 'Répartition',
  bot: 'Bot vocal',
  transfercallflow: 'Transfert de parcours',
  callback: 'Rappel',
  queue: 'File d’attente',
  disconnect: 'Fin d’appel',
  number: 'Transfert vers un numéro',
};
const KIND_ICONS = {
  inboundcall: 'phone',
  menu: 'menu',
  schedulegroup: 'clock',
  service: 'people',
  decision: 'diff',
  pdata: 'building',
  bot: 'message',
  queue: 'people',
  disconnect: 'phone',
  number: 'phone',
};
const dynamicValue = (value) =>
  /^variable$/i.test(String(value || '')) ||
  /^var:/i.test(String(value || '')) ||
  /\$var:[^$]+\$/i.test(String(value || ''));
const NO_DESTINATION_TYPES = new Set(['disconnect', 'next', 'enable', 'disable']);
// INQUEUE_TARGET is the real continuation after waiting (e.g. N1 → N2).
// Only attached waiting menus and the service's queue property are folded.
const attachedQueue = (route) => route.edge.derivedFrom === 'QUEUE';
const attachedMenu = (route) =>
  /^INQUEUE_(?:MENU_[1-4]|REPEAT_MENU|MENU_REPEAT)$/.test(route.edge.field || '');
const attachedRoute = (route) => attachedQueue(route) || attachedMenu(route);

function previewOf(node) {
  const fields = businessFields(node).filter(
    (field) =>
      field.value !== '' &&
      field.value !== null &&
      field.value !== undefined &&
      field.key !== 'DESCRIPTION',
  );
  const priorities = ['inboundcall', 'segment'].includes(node.type)
    ? ['WELCOM_MESSAGE', 'WELCOME_AUDIO', 'LANGUAGE']
    : ['menu', 'quickreplies', 'carousel', 'waitforinput'].includes(node.type)
      ? ['MENU_MESSAGE', 'CAROUSEL_QUESTION', 'QUESTION', 'MENU_AUDIO']
      : node.type === 'service'
        ? ['QUEUE', 'SKILLS', 'PRIORITY']
        : node.type === 'schedulegroup'
          ? ['SCHEDULE_GROUP', 'EMERGENCY_GROUP']
          : ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_VALUE', 'PDATA_LIST_1'];
  const field =
    priorities.map((key) => fields.find((item) => item.key === key)).find(Boolean) ||
    fields.find((item) => item.kind === 'audio') ||
    fields[0];
  return field
    ? {
        text:
          field.key === 'QUEUE' && dynamicValue(field.value)
            ? 'File choisie pendant l’appel'
            : field.display,
        label: field.label,
      }
    : { text: '', label: '' };
}

// Collapse strongly connected components before ranking. A loop is an actual
// return edge, never an invented repeated copy of the underlying WOLF step.
function ranksOf(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
  let next = 0;
  const indices = new Map(),
    low = new Map(),
    stack = [],
    onStack = new Set(),
    components = [],
    componentOf = new Map();
  function visit(id) {
    indices.set(id, next);
    low.set(id, next++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) || []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id), low.get(target)));
      } else if (onStack.has(target)) low.set(id, Math.min(low.get(id), indices.get(target)));
    }
    if (low.get(id) !== indices.get(id)) return;
    const component = [];
    let item;
    do {
      item = stack.pop();
      onStack.delete(item);
      componentOf.set(item, components.length);
      component.push(item);
    } while (item !== id);
    components.push(component);
  }
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
  const outgoing = components.map(() => new Set()),
    indegree = components.map(() => 0),
    ranks = components.map(() => 0);
  for (const edge of edges) {
    const from = componentOf.get(edge.from),
      to = componentOf.get(edge.to);
    if (from !== to && !outgoing[from].has(to)) {
      outgoing[from].add(to);
      indegree[to]++;
    }
  }
  const queue = components.map((_, index) => index).filter((index) => indegree[index] === 0);
  while (queue.length) {
    const from = queue.shift();
    for (const to of outgoing[from]) {
      ranks[to] = Math.max(ranks[to], ranks[from] + 1);
      if (--indegree[to] === 0) queue.push(to);
    }
  }
  return new Map(nodes.map((node) => [node.id, ranks[componentOf.get(node.id)]]));
}

function wrapLabel(value, max = 24) {
  const words = String(value)
      .split(/\s+/)
      .flatMap((word) => word.match(new RegExp(`.{1,${max}}`, 'gu')) || []),
    lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > max) {
      lines.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}

// Keep every condition in the model; condense only groups of menu keys on screen.
export function edgeCaption(labels) {
  const choices = labels
    .filter((label) => /^Choix [0-9]$/.test(label))
    .map((label) => Number(label.slice(6)))
    .sort((a, b) => a - b);
  const rest = labels.filter((label) => !/^Choix [0-9]$/.test(label));
  if (choices.length < 2) return labels;
  const consecutive = choices.every((value, index) => !index || value === choices[index - 1] + 1);
  return [
    `Choix ${consecutive && choices.length > 2 ? `${choices[0]} à ${choices.at(-1)}` : choices.join(', ')}`,
    ...rest,
  ];
}

// Conservative glyph widths for the 14px bold title, including long identifiers.
export function titleLineCount(text, available = 200) {
  const width = (word) =>
    [...word].reduce(
      (sum, char) =>
        sum +
        (/[WM@%\p{Script=Han}]/u.test(char)
          ? 14
          : /[mw]/.test(char)
            ? 12
            : /[\p{Lu}]/u.test(char)
              ? 11
              : /[il.,:;!'’|]/.test(char)
                ? 5
                : 9),
      0,
    );
  let lines = 1,
    used = 0;
  for (const word of String(text).split(/\s+/)) {
    const size = width(word),
      space = used ? 5 : 0;
    if (used && used + space + size > available) {
      lines++;
      used = 0;
    }
    if (size > available) {
      lines += Math.ceil(size / available) - 1;
      used = size % available || available;
    } else used += (used ? 5 : 0) + size;
  }
  return lines;
}

// Reserve room for both audience modes so changing tabs never moves the graph.
function cardHeight(node) {
  const titleLines = titleLineCount(audienceNodeTitle(node, 'business'));
  const reference = audienceNodeTitle(node, 'admin');
  const referenceLines =
    reference === audienceNodeTitle(node, 'business') ? 0 : wrapLabel(reference, 32).length;
  return Math.max(164, 130 + titleLines * 20 + referenceLines * 14);
}

// Orthogonal segments with short rounded corners: no backwards Bézier bulges.
export function roundedRoute(points, radius = 10) {
  const clean = points.filter(
    (point, index) =>
      !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1],
  );
  let path = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const previous = clean[i - 1],
      corner = clean[i],
      next = clean[i + 1];
    const before = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const after = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const r = Math.min(radius, before / 2, after / 2);
    const enter = corner.map((value, axis) => value + ((previous[axis] - value) * r) / before);
    const leave = corner.map((value, axis) => value + ((next[axis] - value) * r) / after);
    path += ` L ${enter[0]} ${enter[1]} Q ${corner[0]} ${corner[1]} ${leave[0]} ${leave[1]}`;
  }
  const end = clean.at(-1);
  return `${path} L ${end[0]} ${end[1]}`;
}

/** Inventaire du parcours avant toute géométrie : ses étapes visibles, leurs destinations et les liens regroupés. Ne modifie jamais son entrée. */
export function journeyModel(flow, { allLinks = false } = {}) {
  const steps = journeySteps(flow),
    realNodes = new Map((flow?.nodes || []).map((node) => [node.id, node]));
  const routes = flowRoutes(flow)
    .filter((route) => route.relationship !== 'context')
    .map((route) =>
      !NO_DESTINATION_TYPES.has(String(route.edge.type || '').toLowerCase()) &&
      dynamicValue(route.edge.target)
        ? { ...route, dynamic: true, toTitle: 'Destination déterminée pendant l’appel' }
        : route,
    );
  const primaryRoutes = routes.filter((route) => !attachedRoute(route));
  const reachable = (starts, links) => {
    const seen = new Set(),
      queue = [...starts];
    while (queue.length) {
      const id = queue.shift();
      if (!realNodes.has(id) || seen.has(id)) continue;
      seen.add(id);
      for (const route of links) if (route.fromId === id && route.toId) queue.push(route.toId);
    }
    return seen;
  };
  const entry = steps.find((step) => step.entry)?.id;
  const mainReachable = reachable(entry ? [entry] : [], primaryRoutes);
  const waitingReachable = reachable(
    routes
      .filter(attachedMenu)
      .map((route) => route.toId)
      .filter(Boolean),
    routes,
  );
  const visibleSteps = steps.filter(
    (step) =>
      !step.contextOnly &&
      (allLinks || !waitingReachable.has(step.id) || mainReachable.has(step.id)),
  );
  const attachments = Object.fromEntries(
    steps.map((step) => [
      step.id,
      {
        queues: routes.filter((route) => route.fromId === step.id && attachedQueue(route)),
        waitingMenus: routes.filter((route) => route.fromId === step.id && attachedMenu(route)),
      },
    ]),
  );
  const nodes = visibleSteps.map((step) => {
    const node = realNodes.get(step.id),
      preview = previewOf(node);
    return {
      id: step.id,
      index: step.index,
      title: nodeTitle(node),
      kind: node.type,
      typeLabel: step.entry
        ? 'Entrée du parcours'
        : (node.media === 'messaging' ? MESSAGE_LABELS[node.type] : KIND_LABELS[node.type]) ||
          node.label ||
          'Étape',
      icon: KIND_ICONS[node.type] || 'layers',
      preview: preview.text,
      previewLabel: preview.label,
      contexts: step.contexts.length,
      attachments: attachments[step.id],
      entry: step.entry,
      terminal: false,
      unresolved: false,
      width: CARD_WIDTH,
      height: cardHeight(node),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node])),
    groups = new Map();
  const visibleRoutes = (allLinks ? routes : primaryRoutes).filter((route) =>
    byId.has(route.fromId),
  );
  const hiddenLinksCount = routes.length - visibleRoutes.length;
  for (const route of visibleRoutes) {
    let to = route.toId;
    if (!byId.has(to)) {
      const target = route.edge.target || '';
      // A terminal destination is an outcome of this source, not a shared WOLF
      // step. Sharing it across unrelated services creates false reconvergence.
      const key = JSON.stringify([
        route.fromId,
        route.edge.phase || '',
        route.edge.type || '',
        target,
        route.terminal,
        route.dynamic,
        !target && !route.terminal ? [route.edge.branch, route.edge.field] : null,
      ]);
      to = `destination:${key}`;
      if (!byId.has(to)) {
        const kind = route.edge.type || 'destination';
        const unresolved =
          Boolean(route.toId && !realNodes.has(route.toId)) || (!route.resolved && !route.dynamic);
        const terminal = {
          id: to,
          index: -1,
          title:
            route.toId && !realNodes.has(route.toId) ? 'Destination à vérifier' : route.toTitle,
          kind,
          typeLabel: route.dynamic
            ? 'Destination dynamique'
            : unresolved
              ? 'À vérifier'
              : (flow.media === 'messaging' ? MESSAGE_LABELS[kind] : KIND_LABELS[kind]) ||
                'Destination',
          icon: unresolved ? 'alert' : KIND_ICONS[kind] || 'phone',
          preview: '',
          previewLabel: '',
          contexts: 0,
          attachments: { queues: [], waitingMenus: [] },
          entry: false,
          terminal: true,
          unresolved,
          width: CARD_WIDTH,
          height: Math.max(78, 40 + titleLineCount(route.toTitle) * 20),
        };
        nodes.push(terminal);
        byId.set(to, terminal);
      }
    }
    // A shared destination does not imply a shared context or announcement.
    // Calendar outcomes stay visually distinct, even when they reconverge.
    const e = route.edge;
    const key = JSON.stringify([
      route.fromId,
      to,
      realNodes.get(route.fromId)?.type === 'schedulegroup' ? e.branch || e.field : null,
      e.rawType || [e.type, ...(e.parameters || [])].join('|'),
      e.rawTarget || e.target || '',
      e.audio || '',
    ]);
    if (!groups.has(key)) groups.set(key, { from: route.fromId, to, labels: [], routes: [] });
    const group = groups.get(key);
    if (!group.labels.includes(route.label)) group.labels.push(route.label);
    group.routes.push(route);
  }
  return {
    nodes,
    byId,
    edges: [...groups.values()],
    hiddenLinksCount,
    hiddenNodeCount: steps.filter((step) => !step.contextOnly).length - visibleSteps.length,
    attachments,
  };
}

/**
 * Placement fait main, conservé pour la carte de simulation et la carte d'activité.
 * Le diagramme de la vue Administration est placé par ELK : voir journey-diagram.js.
 */
export function layoutJourney(flow, { allLinks = false } = {}) {
  const { nodes, byId, edges, hiddenLinksCount, hiddenNodeCount, attachments } = journeyModel(
    flow,
    { allLinks },
  );
  const ranks = ranksOf(nodes, edges);
  const layers = [];
  for (const node of nodes) {
    node.layer = ranks.get(node.id);
    (layers[node.layer] ||= []).push(node);
  }
  // Keep entry first, then place destinations near the mean position of their
  // predecessors. Stable original order breaks ties without business guesses.
  for (let layer = 1; layer < layers.length; layer++) {
    const score = (node) => {
      const parents = edges
        .filter((edge) => edge.to === node.id && byId.get(edge.from).layer < layer)
        .map((edge) => byId.get(edge.from));
      return parents.length
        ? parents.reduce((sum, parent) => sum + layers[parent.layer].indexOf(parent), 0) /
            parents.length
        : 0;
    };
    layers[layer]?.sort((a, b) => score(a) - score(b));
  }
  for (const edge of edges) {
    if (edge.labels.every((label) => /^Choix [0-9]$/.test(label)))
      edge.labels.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    edge.labelLines = edgeCaption(edge.labels).flatMap((label) => wrapLabel(label, 21));
  }
  const outsideEdges = edges.filter((edge) => ranks.get(edge.to) !== ranks.get(edge.from) + 1);
  // Longer bypasses use the outer lanes; disjoint spans can reuse one lane.
  // This keeps nested branches orderly and limits unused space above the flow.
  const lanes = [];
  for (const edge of [...outsideEdges].sort(
    (a, b) =>
      Math.abs(ranks.get(b.to) - ranks.get(b.from)) - Math.abs(ranks.get(a.to) - ranks.get(a.from)),
  )) {
    const span = [
      Math.min(ranks.get(edge.from), ranks.get(edge.to)),
      Math.max(ranks.get(edge.from), ranks.get(edge.to)) + 1,
    ];
    let lane = lanes.find((lane) =>
      lane.spans.every((other) => span[1] < other[0] || other[1] < span[0]),
    );
    if (!lane) {
      lane = { edges: [], spans: [], height: 0 };
      lanes.push(lane);
    }
    lane.spans.push(span);
    lane.edges.push(edge);
    lane.height = Math.max(lane.height, edge.labelLines.length * 15 + 12);
  }
  let laneBottom = 20;
  for (const lane of lanes) {
    for (const edge of lane.edges) edge.laneY = laneBottom + lane.height / 2;
    laneBottom += lane.height + 20;
  }
  const gutterLoads = new Map(),
    exitsByGutter = new Map(),
    entriesByGutter = new Map();
  for (const edge of [...outsideEdges].sort((a, b) => a.laneY - b.laneY)) {
    const sourceGutter = ranks.get(edge.from),
      targetGutter = ranks.get(edge.to) - 1;
    if (!exitsByGutter.has(sourceGutter)) exitsByGutter.set(sourceGutter, []);
    if (!entriesByGutter.has(targetGutter)) entriesByGutter.set(targetGutter, []);
    exitsByGutter.get(sourceGutter).push(edge);
    entriesByGutter.get(targetGutter).push(edge);
    for (const gutter of [ranks.get(edge.from), ranks.get(edge.to) - 1])
      gutterLoads.set(gutter, (gutterLoads.get(gutter) || 0) + 1);
  }
  const directByLayer = new Map();
  for (const edge of edges.filter((edge) => ranks.get(edge.to) === ranks.get(edge.from) + 1)) {
    const layer = ranks.get(edge.from);
    if (!directByLayer.has(layer)) directByLayer.set(layer, []);
    directByLayer.get(layer).push(edge);
  }
  const directLoad = Math.max(1, ...[...directByLayer.values()].map((group) => group.length));
  const columnGap = Math.max(
    COLUMN_GAP + (directLoad - 1) * 12,
    176 + Math.max(0, ...gutterLoads.values()) * 14 + directLoad * 12,
  );
  const sidePadding = Math.max(40, 30 + outsideEdges.length * 14);
  const top = Math.max(64, laneBottom + 32);
  const layerHeights = layers.map(
    (layer) =>
      layer.reduce((sum, node) => sum + node.height, 0) + Math.max(0, layer.length - 1) * ROW_GAP,
  );
  const bodyHeight = Math.max(0, ...layerHeights);
  for (const [index, layer] of layers.entries()) {
    let y = top + (bodyHeight - layerHeights[index]) / 2;
    for (const node of layer) {
      node.x = sidePadding + node.layer * (CARD_WIDTH + columnGap);
      node.y = y;
      y += node.height + ROW_GAP;
    }
  }
  // Ports follow the destinations' visual order, not datatable field order.
  // Otherwise DEFAULT preceding NEXT can create a crossing at the source even
  // when the two destinations are vertically aligned and have no shared path.
  const outgoing = new Map(
    nodes.map((node) => [
      node.id,
      edges
        .filter((edge) => edge.from === node.id)
        .sort(
          (a, b) =>
            (a.laneY ?? byId.get(a.to).y + byId.get(a.to).height / 2) -
            (b.laneY ?? byId.get(b.to).y + byId.get(b.to).height / 2),
        ),
    ]),
  );
  const incoming = new Map(
    nodes.map((node) => [
      node.id,
      edges
        .filter((edge) => edge.to === node.id)
        .sort(
          (a, b) =>
            (a.laneY ?? byId.get(a.from).y + byId.get(a.from).height / 2) -
            (b.laneY ?? byId.get(b.from).y + byId.get(b.from).height / 2),
        ),
    ]),
  );
  for (const edge of edges) {
    const from = byId.get(edge.from),
      to = byId.get(edge.to);
    const outs = outgoing.get(from.id),
      ins = incoming.get(to.id);
    const y1 = from.y + 28 + ((outs.indexOf(edge) + 1) * (from.height - 56)) / (outs.length + 1);
    const y2 = to.y + 28 + ((ins.indexOf(edge) + 1) * (to.height - 56)) / (ins.length + 1);
    const x1 = from.x + CARD_WIDTH,
      x2 = to.x;
    edge.backedge = to.layer <= from.layer;
    if (to.layer !== from.layer + 1) {
      const lane = edge.laneY;
      const sourceBypasses = exitsByGutter.get(from.layer);
      const targetBypasses = entriesByGutter.get(to.layer - 1);
      // Outer lanes turn closest to the card; each bypass has its own track.
      const exitX = x1 + 22 + sourceBypasses.indexOf(edge) * 14;
      const entryX = x2 - 22 - targetBypasses.indexOf(edge) * 14;
      edge.points = [
        [x1, y1],
        [exitX, y1],
        [exitX, lane],
        [entryX, lane],
        [entryX, y2],
        [x2 - 5, y2],
      ];
      edge.labelX = (exitX + entryX) / 2;
      edge.labelY = lane;
    } else {
      const peers = directByLayer.get(from.layer);
      const leftSpace = 22 + (exitsByGutter.get(from.layer)?.length || 0) * 14;
      const rightSpace = 22 + (entriesByGutter.get(from.layer)?.length || 0) * 14;
      const mid =
        (x1 + leftSpace + x2 - rightSpace) / 2 +
        (peers.indexOf(edge) - (peers.length - 1) / 2) * 12;
      edge.points = [
        [x1, y1],
        [mid, y1],
        [mid, y2],
        [x2 - 5, y2],
      ];
      edge.labelX = mid;
      edge.labelY = (y1 + y2) / 2;
    }
    edge.path = roundedRoute(edge.points);
    edge.label = edge.labels.join(' · ');
  }
  // Labels are boxes, not points: reserve their space independently of tracks.
  const placedLabels = outsideEdges.map((edge) => ({
    x: edge.labelX,
    y: edge.labelY,
    height: edge.labelLines.length * 15 + 12,
  }));
  let captionBottom = top + bodyHeight;
  const directEdges = edges
    .filter((edge) => edge.laneY === undefined)
    .sort(
      (a, b) =>
        Math.abs(a.points.at(-1)[1] - a.points[0][1]) -
        Math.abs(b.points.at(-1)[1] - b.points[0][1]),
    );
  for (const edge of directEdges) {
    const height = edge.labelLines.length * 15 + 12;
    const low = Math.min(edge.points[0][1], edge.points.at(-1)[1]),
      high = Math.max(edge.points[0][1], edge.points.at(-1)[1]);
    const clear = (y) =>
      placedLabels.every(
        (box) =>
          Math.abs(edge.labelX - box.x) >= 152 ||
          Math.abs(y - box.y) >= (height + box.height) / 2 + 8,
      );
    const candidates = [edge.labelY];
    for (let y = low; y <= high; y += 8) candidates.push(y);
    candidates.sort((a, b) => Math.abs(a - edge.labelY) - Math.abs(b - edge.labelY));
    let y = candidates.find(clear);
    if (y === undefined) {
      y = captionBottom + 24 + height / 2;
      captionBottom = y + height / 2;
      edge.labelLeader = `M ${edge.labelX} ${high} L ${edge.labelX} ${y - height / 2}`;
    }
    edge.labelY = y;
    placedLabels.push({ x: edge.labelX, y, height });
  }
  return {
    width: Math.max(
      640,
      (layers.length - 1) * (CARD_WIDTH + columnGap) + CARD_WIDTH + sidePadding * 2,
    ),
    height: Math.max(top + bodyHeight, captionBottom) + 64,
    nodes,
    edges,
    hiddenLinksCount,
    hiddenNodeCount,
    attachments,
    allLinks,
  };
}
