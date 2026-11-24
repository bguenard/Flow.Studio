import { layoutAttributes } from './view-layout.js';
import { layoutJourney } from './journey-canvas.js';
import { esc, icon } from './ui-kit.js';
export function simulationMap(
  session,
  { namespace = 'simulation', title = 'Le parcours en direct' } = {},
) {
  const prefix = namespace.replace(/[^a-zA-Z0-9_-]/g, '');
  const layout = layoutJourney(session.flow, { allLinks: true }),
    visited = new Set(session.trail.map((t) => t.nodeId)),
    taken = new Set(session.trail.filter((t) => !t.override).map((t) => t.routeId));
  for (const edge of layout.edges)
    if (edge.routes.some((r) => taken.has(r.id))) visited.add(edge.to);
  const last = session.trail.at(-1),
    destination =
      session.status !== 'active' && !last?.override
        ? layout.edges.find((edge) => edge.routes.some((r) => r.id === last?.routeId))?.to
        : null;
  const active = destination || session.nodeId;
  visited.add(active);
  return `<section class="simulation-map-panel"><header><div><strong>${esc(title)}</strong><p><span class="map-dot current"></span>Étape courante <span class="map-dot visited"></span>Déjà parcourue</p></div><span>${esc(session.flow.name || session.flow.key)}</span></header><div class="simulation-map-viewport" role="region" aria-label="Parcours de la simulation" tabindex="0"><div class="simulation-map-space" ${layoutAttributes({ width: layout.width * 0.72, height: layout.height * 0.72 })}><div class="simulation-map-surface" ${layoutAttributes({ width: layout.width, height: layout.height, scale: 0.72 })}><svg width="${layout.width}" height="${layout.height}" aria-hidden="true"><defs><marker id="${prefix}-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#a5b0b9"/></marker><marker id="${prefix}-arrow-travelled" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#f58220"/></marker></defs>${layout.edges
    .map((edge) => {
      const travelled = edge.routes.some((r) => taken.has(r.id));
      return `<g><path class="simulation-map-edge ${travelled ? 'travelled' : ''}" d="${edge.path}" marker-end="url(#${prefix}-arrow${travelled ? '-travelled' : ''})"/><text x="${edge.labelX}" y="${edge.labelY - 8}" text-anchor="middle">${esc(edge.label)}</text></g>`;
    })
    .join(
      '',
    )}</svg>${layout.nodes.map((node) => `<div class="simulation-map-node ${node.id === active ? 'current' : visited.has(node.id) ? 'visited' : ''}" data-map-node="${esc(node.id)}" ${node.id === active ? 'aria-current="step"' : ''} ${layoutAttributes({ left: node.x, top: node.y, width: node.width, height: node.height })}><span>${icon(node.icon)} ${esc(node.typeLabel)}</span><strong>${esc(node.title)}</strong><small>${node.id === active ? (session.status === 'complete' ? 'Dernière étape' : 'Étape courante') : visited.has(node.id) ? 'Déjà parcourue' : node.terminal ? 'Destination' : 'À explorer'}</small></div>`).join('')}</div></div></div></section>`;
}
