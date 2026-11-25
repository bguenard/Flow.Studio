import { layoutAttributes } from './view-layout.js';
/**
 * Diagramme de la vue Administration : une carte par étape, ses branches listées comme des
 * sorties sur son bord, et un placement calculé par ELK (src/vendor/elk.bundled.js).
 *
 * Le modèle et le rendu sont synchrones et purs. Seul le placement est asynchrone : il est
 * demandé au premier affichage d'un parcours, gardé en mémoire, puis annoncé aux abonnés.
 */
import { journeyModel, edgeCaption, titleLineCount, roundedRoute } from './journey-canvas.js';
import { blockPresentation } from './control-blocks.js';
import { branchRank } from './business.js';
import { audienceNodeTitle, audienceNodeSubtitle } from './journey-audience.js';
import { esc, icon, plural } from './ui-kit.js';

export const CARD_WIDTH = 300;
/** Hauteur d'une sortie (sur une ou deux lignes) et ordonnée de l'entrée d'une carte (le centre de son pictogramme). */
const EXIT_HEIGHT = 30,
  TALL_EXIT_HEIGHT = 48,
  ENTRY_Y = 31;
const TITLE_LINE = 20,
  TEXT_LINE = 18,
  MAX_TITLE_LINES = 3;
/** Polices et largeurs utiles du titre et de l'aperçu d'une carte : celles de journey-diagram.css. */
const TITLE_FONT = '700 14.5px Arial, Helvetica, sans-serif',
  TEXT_FONT = '13px Arial, Helvetica, sans-serif',
  EXIT_FONT = '600 13px Arial, Helvetica, sans-serif';
const TITLE_WIDTH = CARD_WIDTH - 32 - 34 - 12,
  TEXT_WIDTH = CARD_WIDTH - 32;

let ruler;
/** Mesure de texte du navigateur, sans passer par la page. Absente hors navigateur : l'appelant garde son estimation. */
function measurer(font) {
  if (ruler === undefined) {
    try {
      ruler =
        (globalThis.OffscreenCanvas
          ? new OffscreenCanvas(1, 1)
          : globalThis.document?.createElement('canvas')
        )?.getContext('2d') || null;
    } catch {
      ruler = null;
    }
  }
  if (!ruler) return null;
  ruler.font = font;
  return (text) => ruler.measureText(text).width;
}
const textWidth = (text, font) => {
  const width = measurer(font);
  return width ? width(String(text)) : String(text).length * 7.2;
};
/** Nombre de lignes d'un texte dans une largeur donnée : retour à la ligne entre les mots, coupure d'un mot trop long. */
function lineCount(text, font, available, estimate) {
  const width = measurer(font);
  if (!width) return estimate();
  const space = width(' ');
  let lines = 1,
    used = 0;
  for (const word of String(text).trim().split(/\s+/)) {
    const size = width(word);
    if (used && used + space + size > available) {
      lines++;
      used = 0;
    }
    if (size > available) {
      lines += Math.ceil(size / available) - 1;
      used = size % available || available;
    } else used += (used ? space : 0) + size;
  }
  return lines;
}

/** Ce qui est rattaché à l'étape sans être une suite de l'appel : file, menus d'attente, informations. */
function attachedFacts(node) {
  const parts = [...(node.notes || [])];
  if (node.attachments.queues.length) parts.push('File associée');
  const menus = new Set(
    node.attachments.waitingMenus.map(
      (route) => route.toId || route.edge.target || route.edge.field,
    ),
  ).size;
  if (menus)
    parts.push(
      node.attachments.waitingMenus.some((route) => !route.resolved && !route.dynamic)
        ? 'Attente à vérifier'
        : `Attente : ${plural(menus, 'menu')}`,
    );
  if (node.contexts)
    parts.push(
      `${node.contexts} information${node.contexts > 1 ? 's' : ''} associée${node.contexts > 1 ? 's' : ''}`,
    );
  return parts.join(' · ');
}

/**
 * Une carte et ses sorties. Les hauteurs sont calculées ici, sans le navigateur : la zone haute
 * a une hauteur fixée, chaque sortie aussi, donc chaque lien part du bon endroit.
 */
function cardOf(node, flow, model) {
  const source = flow.nodes[node.index];
  const title = node.block ? node.title : audienceNodeTitle(source, 'business'),
    key = node.block ? node.block.name : audienceNodeTitle(source, 'admin');
  const exits = model.edges
    .filter((edge) => edge.from === node.id)
    .map((edge, order) => {
      const target = model.byId.get(edge.to);
      return {
        label: edgeCaption(edge.labels).join(' · '),
        labels: edge.labels,
        routes: edge.routes,
        order,
        rank: Math.min(...edge.routes.map((route) => branchRank(route.edge.branch))),
        to: target.terminal ? '' : target.id,
        // Une réponse à un menu de consentement dit ce qu'elle décide, puis où va l'appel.
        destination: [
          edge.routes.map((route) => route.outcome).find(Boolean),
          target.terminal ? target.title : '',
        ]
          .filter(Boolean)
          .join(' · '),
        unresolved: Boolean(target.terminal && target.unresolved),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((exit) => ({
      ...exit,
      height:
        exit.destination &&
        textWidth(exit.label, EXIT_FONT) + textWidth(exit.destination, TEXT_FONT) + 26 > TEXT_WIDTH
          ? TALL_EXIT_HEIGHT
          : EXIT_HEIGHT,
    }));
  const titleLines = Math.min(
    MAX_TITLE_LINES,
    lineCount(title, TITLE_FONT, TITLE_WIDTH - 1, () => titleLineCount(title, 214)),
  );
  const previewLines = node.preview
      ? Math.min(
          2,
          lineCount(node.preview, TEXT_FONT, TEXT_WIDTH - 1, () =>
            String(node.preview).length > 38 ? 2 : 1,
          ),
        )
      : 0,
    facts = attachedFacts(node),
    reference = key === title ? '' : key;
  const top =
    14 +
    16 +
    titleLines * TITLE_LINE +
    (reference ? 20 : 0) +
    (previewLines ? 6 + previewLines * TEXT_LINE : 0) +
    (facts ? 4 + TEXT_LINE : 0) +
    12;
  const height = top + exits.reduce((sum, exit) => sum + exit.height, 0);
  let offset = top;
  return {
    id: node.id,
    index: node.index,
    mergedIndex: node.mergedIndex ?? -1,
    kind: node.kind,
    icon: node.icon,
    entry: node.entry,
    typeLabel: node.typeLabel,
    technicalType: node.block ? 'Contrôle WOLF' : audienceNodeSubtitle(source, 'admin'),
    action: node.block ? blockPresentation(node.block).action : 'select-node',
    title,
    titleLines,
    reference,
    preview: node.preview,
    previewLabel: node.previewLabel,
    previewLines,
    facts,
    top,
    width: CARD_WIDTH,
    height,
    exits: exits.map(({ order, rank, ...exit }, index) => {
      const y = offset + exit.height / 2;
      offset += exit.height;
      return { ...exit, id: `${node.id}→${index}`, y };
    }),
  };
}

/** Cartes, sorties et liens d'un parcours, sans coordonnées. Ne modifie jamais son entrée. */
export function diagramModel(flow, { allLinks = false, contextData = null } = {}) {
  const model = journeyModel(flow, { allLinks, recording: true, contextData });
  const nodes = model.nodes
    .filter((node) => !node.terminal)
    .map((node) => cardOf(node, flow, model));
  const edges = nodes.flatMap((card) =>
    card.exits
      .filter((exit) => exit.to)
      .map((exit) => ({
        id: exit.id,
        from: card.id,
        to: exit.to,
        labels: exit.labels,
        routes: exit.routes,
      })),
  );
  // Le placement ne dépend que des tailles et des liens : renommer une étape sans changer sa hauteur le réutilise.
  const signature = JSON.stringify(
    nodes.map((card) => [card.id, card.height, card.entry, card.exits.map((exit) => exit.to)]),
  );
  return {
    nodes,
    edges,
    signature,
    hiddenLinksCount: model.hiddenLinksCount,
    hiddenNodeCount: model.hiddenNodeCount,
    attachments: model.attachments,
    allLinks,
  };
}

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '84',
  'elk.spacing.nodeNode': '34',
  'elk.spacing.edgeNode': '22',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeNodeBetweenLayers': '26',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Les retours sont les liens qui remontent le parcours depuis son entrée, pas un choix arbitraire.
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.padding': '[top=36,left=36,bottom=36,right=36]',
};
/** Seconde passe : ELK garde les rangs, l'ordre et les positions qu'on lui donne, et ne fait que tracer les liens. */
const ELK_KEEP_PLACEMENT = {
  ...ELK_OPTIONS,
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
};
const port = (id, x, y, side) => ({
  id,
  x,
  y,
  width: 0,
  height: 0,
  layoutOptions: { 'elk.port.side': side },
});

let engine = null;
/** ELK pèse 1,6 Mo : il n'est chargé qu'au premier diagramme affiché. Le fichier se déclare lui-même sur globalThis. */
function loadEngine() {
  engine ||= import('./vendor/elk.bundled.js')
    .then(() => new globalThis.ELK())
    .catch((error) => {
      engine = null;
      throw error;
    });
  return engine;
}

/**
 * Positions des cartes et points de passage des liens, calculés par ELK pour un modèle donné.
 *
 * ELK aligne chaque carte sur le lien qui y arrive. Or une sortie est en bas de sa carte et l'entrée
 * de la suivante en haut : placées avec leurs vraies sorties, des étapes qui se suivent descendent en
 * escalier. Les cartes sont donc placées une première fois avec leurs sorties remontées à hauteur de
 * l'entrée (les suites restent sur une ligne), puis les liens sont tracés depuis les vraies sorties.
 */
async function place(model) {
  if (!model.nodes.length) return { width: 640, height: 240, at: {}, routes: {} };
  const elk = await loadEngine();
  // ELK reçoit des identifiants courts : ceux des étapes sont libres et peuvent contenir n'importe quel caractère.
  const names = new Map(model.nodes.map((card, index) => [card.id, 'n' + index]));
  const exitPort = new Map(
    model.nodes.flatMap((card) =>
      card.exits.map((exit, index) => [exit.id, `${names.get(card.id)}o${index}`]),
    ),
  );
  const graph = (layoutOptions, exitY, positions) => ({
    id: 'root',
    layoutOptions,
    children: model.nodes.map((card) => ({
      id: names.get(card.id),
      width: CARD_WIDTH,
      height: card.height,
      ...(positions ? positions.get(names.get(card.id)) : {}),
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        ...(card.entry && !positions ? { 'elk.layered.layering.layerConstraint': 'FIRST' } : {}),
      },
      ports: [
        port(names.get(card.id) + 'i', 0, ENTRY_Y, 'WEST'),
        ...card.exits
          .filter((exit) => exit.to)
          .map((exit, index) =>
            port(exitPort.get(exit.id), CARD_WIDTH, exitY(exit, index), 'EAST'),
          ),
      ],
    })),
    edges: model.edges.map((link, index) => ({
      id: 'e' + index,
      sources: [exitPort.get(link.id)],
      targets: [names.get(link.to) + 'i'],
    })),
  });
  // Un pixel d'écart suffit à garder l'ordre des sorties sans décaler les cartes.
  const rows = await elk.layout(graph(ELK_OPTIONS, (exit, index) => ENTRY_Y + index));
  const result = await elk.layout(
    graph(
      ELK_KEEP_PLACEMENT,
      (exit) => exit.y,
      new Map(rows.children.map((child) => [child.id, { x: child.x, y: child.y }])),
    ),
  );
  const placed = new Map(result.children.map((child) => [child.id, [child.x, child.y]]));
  const drawn = new Map(
    result.edges.map((edge) => [
      edge.id,
      (edge.sections || [])
        .flatMap((section) => [section.startPoint, ...(section.bendPoints || []), section.endPoint])
        .map((point) => [point.x, point.y]),
    ]),
  );
  return {
    width: result.width,
    height: result.height,
    at: Object.fromEntries(model.nodes.map((card) => [card.id, placed.get(names.get(card.id))])),
    routes: Object.fromEntries(model.edges.map((link, index) => [link.id, drawn.get('e' + index)])),
  };
}

const MEMORY = 40;
const placements = new Map(),
  pending = new Map(),
  failures = new Map(),
  listeners = new Set();

/** Prévenu chaque fois qu'un placement demandé aboutit ou échoue. Retourne la fonction de désabonnement. */
export function onDiagramReady(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function request(model) {
  const { signature } = model;
  if (!pending.has(signature))
    pending.set(
      signature,
      place(model)
        .then(
          (placed) => {
            placements.set(signature, placed);
            for (const oldest of placements.keys()) {
              if (placements.size <= MEMORY) break;
              placements.delete(oldest);
            }
          },
          (error) => {
            failures.set(signature, error?.message || 'Erreur inconnue');
          },
        )
        .finally(() => {
          pending.delete(signature);
          for (const listener of [...listeners]) listener(signature);
        }),
    );
  return pending.get(signature);
}

function withPlacement(model, placed) {
  const nodes = model.nodes.map((card) => ({
      ...card,
      x: placed.at[card.id][0],
      y: placed.at[card.id][1],
    })),
    at = new Map(nodes.map((card) => [card.id, card]));
  const edges = model.edges.map((link) => {
    const points = placed.routes[link.id];
    return {
      ...link,
      points,
      path: roundedRoute(points, 9),
      backedge: at.get(link.to).x <= at.get(link.from).x,
    };
  });
  return {
    ...model,
    nodes,
    edges,
    ready: true,
    error: '',
    width: placed.width,
    height: placed.height,
  };
}

/**
 * Le diagramme d'un parcours, immédiatement. Si son placement n'est pas encore connu, il est
 * demandé et le résultat porte `ready: false` ; les abonnés de onDiagramReady sont prévenus ensuite.
 */
export function diagramLayout(flow, options) {
  const model = diagramModel(flow, options),
    placed = placements.get(model.signature);
  if (placed) return withPlacement(model, placed);
  const error = failures.get(model.signature) || '';
  if (!error) request(model);
  return { ...model, ready: false, error, width: 0, height: 0 };
}

/** Le diagramme d'un parcours une fois placé (nouvel essai après un échec). */
export async function prepareDiagram(flow, options) {
  const model = diagramModel(flow, options);
  if (!placements.has(model.signature)) {
    failures.delete(model.signature);
    await request(model);
  }
  return diagramLayout(flow, options);
}

/** Oublie les échecs : le prochain affichage redemande le placement. */
export function retryDiagram() {
  failures.clear();
}

const viewport = (content) =>
  `<div class="canvas-viewport" id="graph-viewport" tabindex="0" role="region" aria-label="Parcours interactif">${content}</div>`;

function cardHtml(card, selected) {
  const exits = card.exits
    .map(
      (exit) =>
        `<span class="diagram-exit${exit.to ? '' : ' inline'}${exit.height > EXIT_HEIGHT ? ' tall' : ''}${exit.unresolved ? ' unresolved' : ''}"><span class="diagram-exit-label" title="${esc(exit.labels.join(' · '))}">${esc(exit.label)}</span>${exit.destination ? `<span class="diagram-exit-end" title="${esc(exit.destination)}">${esc(exit.destination)}</span>` : ''}${exit.to ? '<i class="diagram-port"></i>' : ''}</span>`,
    )
    .join('');
  return `<button type="button" class="diagram-card${selected ? ' selected' : ''}" data-kind="${esc(card.kind)}" data-card="${esc(card.id)}" ${layoutAttributes({ left: card.x, top: card.y, width: card.width, height: card.height })} data-action="${card.action}"${card.index >= 0 ? ` data-node="${card.index}"` : ''} aria-label="Ouvrir ${esc(card.title)}" aria-pressed="${selected}">
      <span class="diagram-card-top" ${layoutAttributes({ height: card.top })}><span class="diagram-card-head"><span class="diagram-card-icon">${icon(card.icon)}</span><span class="diagram-card-copy"><small title="${esc(card.technicalType || card.typeLabel)}">${esc(card.typeLabel)}</small><strong title="${esc(card.title)}" ${layoutAttributes({ maxHeight: card.titleLines * TITLE_LINE, lineClamp: card.titleLines })}>${esc(card.title)}</strong></span></span>${card.reference ? `<span class="diagram-card-reference" title="${esc(card.technicalType)}">${esc(card.reference)}</span>` : ''}${card.preview ? `<span class="diagram-card-preview" title="${esc(card.previewLabel + ' : ' + card.preview)}" ${layoutAttributes({ maxHeight: card.previewLines * TEXT_LINE, lineClamp: card.previewLines })}>${esc(card.preview)}</span>` : ''}${card.facts ? `<span class="diagram-card-facts">${esc(card.facts)}</span>` : ''}</span>
      ${exits ? `<span class="diagram-exits">${exits}</span>` : ''}
    </button>`;
}

export function journeyDiagram(
  flow,
  {
    selectedIndex = null,
    selectedKind = '',
    selectedCard = '',
    zoom = 1,
    allLinks = false,
    layout = diagramLayout(flow, { allLinks }),
  } = {},
) {
  if (layout.error)
    return viewport(
      `<div class="canvas-status failed" role="alert"><strong>Le diagramme n’a pas pu être tracé.</strong><span>${esc(layout.error)}</span><button type="button" class="btn secondary small" data-action="diagram-retry">Réessayer</button></div>`,
    );
  if (!layout.ready)
    return viewport('<p class="canvas-status" role="status">Mise en page du diagramme…</p>');
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  // Un bloc sans ligne propre (données de contexte) se désigne par sa nature, pas par un indice d'étape.
  const selected = layout.nodes.find((card) =>
    selectedCard
      ? card.id === selectedCard
      : selectedKind
        ? card.kind === selectedKind && card.index < 0
        : card.index === selectedIndex ||
          (selectedIndex != null && selectedIndex >= 0 && card.mergedIndex === selectedIndex),
  )?.id;
  const lit = (link) => Boolean(selected) && (link.from === selected || link.to === selected);
  const marker = (id, colour) =>
    `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 .6 7 4 0 7.4Z" fill="${colour}"/></marker>`;
  // Les liens de l'étape sélectionnée sont tracés en dernier, au-dessus des autres.
  const lines = [...layout.edges]
    .sort((a, b) => lit(a) - lit(b))
    .map(
      (link) =>
        `<g class="canvas-edge${lit(link) ? ' highlighted' : ''}${link.backedge ? ' backedge' : ''}" data-from="${esc(link.from)}" data-to="${esc(link.to)}"><path class="canvas-edge-halo" d="${link.path}"/><path class="canvas-edge-line" d="${link.path}" marker-end="url(#canvas-arrow${lit(link) ? '-selected' : ''})"/></g>`,
    )
    .join('');
  return viewport(`<div class="canvas-stage" ${layoutAttributes({ width: layout.width * scale, height: layout.height * scale })}><div class="canvas-surface" id="journey-canvas" ${layoutAttributes({ width: layout.width, height: layout.height, scale: scale })}>
    <svg class="canvas-lines" width="${layout.width}" height="${layout.height}" aria-hidden="true"><defs>${marker('canvas-arrow', '#93a0ad')}${marker('canvas-arrow-selected', '#e9730c')}</defs>${lines}</svg>
    ${layout.nodes.map((card) => cardHtml(card, card.id === selected)).join('')}
  </div></div>`);
}
