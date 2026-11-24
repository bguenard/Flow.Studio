import { nodeTitle, flowRoutes } from './business.js';

const ICONS = { inboundcall: 'phone', standardcallflow: 'phone', schedulegroup: 'clock', service: 'people', menu: 'menu', pdata: 'building', decision: 'diff', ratiodistrib: 'diff', bot: 'message', transfercallflow: 'link', callback: 'phone' };
/** Icône d'un type d'étape, partagée par la liste des étapes et les cartes de réglages. */
export const stepIcon = type => ICONS[String(type || '').toLowerCase()] || 'layers';

/**
 * Navigation over the actual inventory, never a prescribed journey template.
 * Array order is a browsing aid; only incoming/outgoing links express execution.
 * Context attachments remain separate from the routing branches.
 */
export function journeySteps(flow) {
  const nodes = new Map();
  for (const [index, node] of (flow?.nodes || []).entries()) {
    if (node?.id != null && !nodes.has(node.id)) nodes.set(node.id, { node, index });
  }
  const entry = nodes.get(flow?.id)?.node || [...nodes.values()].find(({ node }) => ['inboundcall', 'standardcallflow'].includes(node.type))?.node || null;
  const seenEdges = new Set();
  const routes = flowRoutes({ ...flow, nodes: [...nodes.values()].map(({ node }) => node) }).filter(route => {
    if (!nodes.has(route.fromId)) return false;
    const edge = route.edge;
    const identity = JSON.stringify([route.fromId, route.toId, route.relationship, edge.branch, edge.field, edge.destinationField, edge.type, edge.target, route.label, route.terminal, route.dynamic, route.resolved]);
    if (seenEdges.has(identity)) return false;
    seenEdges.add(identity);
    return true;
  }).map(route => {
    // Traversal limits can leave an edge's target ID without a materialized node.
    if (route.toId && !nodes.has(route.toId)) return { ...route, toId: null, toTitle: 'Destination à vérifier', resolved: false };
    return route;
  });

  const contextOnly = id => {
    const node = nodes.get(id)?.node;
    return node?.type === 'pdata' && node !== entry && routes.some(route => route.toId === id && route.relationship === 'context') && !routes.some(route => route.toId === id && route.relationship !== 'context');
  };

  const ordered = [], visited = new Set();
  const visit = start => {
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      if (!nodes.has(id) || visited.has(id)) continue;
      visited.add(id);
      ordered.push(id);
      for (const route of routes) {
        if (route.fromId === id && route.relationship !== 'context' && route.toId && !visited.has(route.toId)) queue.push(route.toId);
      }
    }
  };
  if (entry) visit(entry.id);
  // Keep every actual row accessible, including disconnected or contextual rows.
  for (const id of nodes.keys()) if (!contextOnly(id)) visit(id);
  for (const id of nodes.keys()) if (!visited.has(id)) ordered.push(id);

  const destination = route => ({ toId: route.toId, title: route.toTitle, label: route.label, relationship: route.relationship, terminal: route.terminal, dynamic: route.dynamic, resolved: route.resolved, field: route.edge.field, derivedFrom: route.edge.derivedFrom, phase: route.edge.phase });
  return ordered.map(id => {
    const { node, index } = nodes.get(id);
    return {
      id, index, title: nodeTitle(node), label: node === entry ? 'Entrée du parcours' : node.label || 'Étape du parcours', icon: ICONS[node.type] || 'layers',
      entry: node === entry, contextOnly: contextOnly(id),
      incoming: routes.filter(route => route.toId === id).map(route => ({ fromId: route.fromId, title: route.fromTitle, label: route.label, relationship: route.relationship })),
      outgoing: routes.filter(route => route.fromId === id && route.relationship !== 'context').map(destination),
      contexts: routes.filter(route => route.fromId === id && route.relationship === 'context').map(destination),
    };
  });
}
