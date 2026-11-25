/**
 * Blocs lus dans l'ordre de l'appel à partir des contrôles d'une suite.
 *
 * Dans les tables, un contrôle est porté par une suite (`type|sub:A;B`) ou par la liste de
 * démarrage : WOLF l'exécute avant d'aller à la destination. Deux contrôles ont un contenu que
 * le Studio sait montrer et modifier : les données de contexte du parcours et l'enregistrement.
 * Ils sont donc lus comme des blocs, à leur place — étape → données → enregistrement →
 * destination d'origine — sans rien changer aux liens du parcours : seules les routes
 * d'affichage sont réécrites.
 */
import { FLOW_INITIALIZATION, initializationAttributes } from './flow-initialization.js';
import { PARTICIPANT_CATALOGUE } from './participant-catalogue.js';
import { participantAssignments } from './participant-names.js';
import {
  controlLabel,
  controlNames,
  isContextControl,
  isRecordingControl,
} from './route-controls.js';

const text = (value) => (value == null ? '' : String(value));
export const CONTEXT_BLOCK_TITLE = 'Données de contexte';
/** Ce que l'on peut dire d'un traitement propre à l'organisation : sa place, pas son contenu. */
export const CUSTOM_BLOCK_KIND = 'Traitement spécifique';
export const CUSTOM_BLOCK_NOTE =
  'Traitement propre à votre organisation, défini dans le flow Architect. Aucun réglage dans les Data Tables WOLF.';
/** Présentation d'un bloc sans ligne propre, commune au diagramme et au fil de l'appel. */
export const blockPresentation = (block) =>
  block.kind === 'context'
    ? { typeLabel: 'Initialisation', icon: 'database', action: 'context-data-open' }
    : { typeLabel: CUSTOM_BLOCK_KIND, icon: 'code', action: 'control-block-open' };
const recordingCall = (route) =>
  route.relationship === 'context' && route.edge?.type === 'recording' && route.toId;
/** La suite qui porte l'appel : celle du champ concerné, ou la première suite pour la liste de démarrage. */
const hostField = (call) =>
  call.edge.field === 'SUBROUTINES_LIST' ? 'NEXT_TARGET_TYPE' : call.edge.field;
const isHost = (route) =>
  route.relationship !== 'context' &&
  /(^|_)TARGET_TYPE(?:_\d+)?$/.test(route.edge?.field || '') &&
  !/^INQUEUE_/.test(route.edge.field);

/** Contrôles d'une suite dans leur ordre d'exécution : la liste de démarrage, puis ceux de la suite. */
function controlsOf(route, node) {
  const sub = text(route.edge.rawType)
    .split('|')
    .slice(1)
    .filter((part) => /^\s*sub:/i.test(part))
    .flatMap((part) => controlNames(part.slice(part.indexOf(':') + 1)));
  return [
    ...(route.edge.field === 'NEXT_TARGET_TYPE' ? controlNames(node?.row?.SUBROUTINES_LIST) : []),
    ...sub,
  ];
}

/** Réponse d'un menu de consentement : elle règle l'enregistrement, puis l'appel continue. */
const consentOutcome = (route) =>
  ['enable', 'disable'].includes(text(route.edge?.type).toLowerCase());

/**
 * @param routes routes de `flowRoutes`, avec les liens d'enregistrement.
 * @param instances vrai : une carte par suite concernée (le diagramme) ; faux : un seul bloc de chaque sorte (le fil de l'appel).
 * @returns `routes` réécrites ; `copies` : carte supplémentaire → bloc réel ; `blocks` : blocs sans
 * ligne propre (données de contexte, traitements propres à l'organisation) ; `merged` : bloc d'enregistrement → son menu de consentement,
 * lu dans le même bloc ; `hidden` : menus qui n'ont alors plus de carte à eux.
 */
export function inlineControlBlocks(flow, routes, { instances = true } = {}) {
  const nodes = new Map((flow?.nodes || []).map((node) => [node.id, node])),
    calls = routes.filter(recordingCall),
    copies = new Map(),
    blocks = new Map(),
    merged = new Map(),
    count = new Map(),
    chains = new Map(),
    replaced = new Set();
  const instance = (base) => {
    const n = count.get(base) || 0;
    count.set(base, n + 1);
    return instances && n ? `${base}#${n + 1}` : base;
  };
  for (const route of routes.filter(isHost)) {
    const chain = [];
    for (const name of controlsOf(route, nodes.get(route.fromId))) {
      // Les données de contexte sont celles du parcours : initialisées à son entrée.
      if (isContextControl(name) && route.fromId === flow.id) {
        if (chain.some((block) => block.kind === 'context')) continue;
        const id = instance(`context:${flow.id}`);
        blocks.set(id, { kind: 'context', name, title: CONTEXT_BLOCK_TITLE });
        chain.push({ kind: 'context', id, title: CONTEXT_BLOCK_TITLE });
      } else if (isRecordingControl(name)) {
        const mine = calls.filter(
          (call) => call.fromId === route.fromId && hostField(call) === route.edge.field,
        );
        if (!mine.length || chain.some((block) => block.kind === 'recording')) continue;
        for (const call of mine) replaced.add(call);
        const real = mine[0].toId,
          id = instance(real);
        if (id !== real) copies.set(id, real);
        // Le menu de consentement du réglage se présente dans le même bloc, avant de poursuivre.
        const consent = routes.find(
          (link) =>
            link.fromId === real &&
            link.relationship !== 'context' &&
            link.edge?.field === 'CONSENT_MENU' &&
            nodes.has(link.toId),
        );
        if (consent) {
          replaced.add(consent);
          merged.set(id, consent.toId);
        }
        chain.push({ kind: 'recording', id, title: mine[0].toTitle, menu: consent?.toId });
      } else if (!controlLabel(name)) {
        // Traitement propre à l'organisation : rien à régler ici, mais il a sa place dans l'appel.
        const id = `control:${route.fromId}:${route.edge.field}:${name}`;
        if (chain.some((block) => block.id === id)) continue;
        blocks.set(id, {
          kind: 'custom',
          name,
          title: name,
          fromId: route.fromId,
          fromTitle: route.fromTitle,
          label: route.label,
        });
        chain.push({ kind: 'custom', id, title: name });
      }
    }
    if (chain.length) chains.set(route, chain);
  }
  const none = { routes, copies, blocks, merged, hidden: new Set() };
  if (!chains.size) return none;
  const linked = { terminal: false, dynamic: false, resolved: true },
    toward = (next, host) =>
      next
        ? { ...linked, toId: next.id, toTitle: next.title }
        : {
            toId: host.toId,
            toTitle: host.toTitle,
            terminal: host.terminal,
            dynamic: host.dynamic,
            resolved: host.resolved,
          };
  const result = [],
    after = [],
    seen = new Set();
  const add = (link) => {
    // Dans le fil de l'appel, un même enchaînement ne se lit qu'une fois.
    const key = JSON.stringify([link.fromId, link.toId, link.label, link.edge.field, link.outcome]);
    if (link.toId && seen.has(key)) return;
    seen.add(key);
    after.push(link);
  };
  for (const route of routes) {
    if (replaced.has(route)) continue;
    const chain = chains.get(route);
    if (!chain) {
      result.push(route);
      continue;
    }
    result.push({ ...route, ...linked, toId: chain[0].id, toTitle: chain[0].title });
    chain.forEach((block, index) => {
      const next = chain[index + 1],
        choices = block.menu
          ? routes.filter(
              (choice) => choice.fromId === block.menu && choice.relationship !== 'context',
            )
          : [];
      for (const choice of choices)
        add(
          consentOutcome(choice)
            ? {
                // Accepter ou refuser ne termine pas l'appel : les deux réponses mènent à la suite.
                ...choice,
                ...toward(next, route),
                id: `${choice.id}@${block.id}:${route.id}`,
                fromId: block.id,
                fromTitle: block.title,
                outcome: choice.toTitle,
                origin: next ? null : route,
                edge: next
                  ? choice.edge
                  : { ...choice.edge, type: route.edge.type, target: route.edge.target },
              }
            : // Un choix du menu qui mène ailleurs reste une sortie du bloc.
              { ...choice, id: `${choice.id}@${block.id}`, fromId: block.id, origin: null },
        );
      if (choices.some(consentOutcome)) return;
      add({
        ...route,
        ...toward(next, route),
        id: `${route.id}:bloc:${index}`,
        fromId: block.id,
        fromTitle: block.title,
        label: 'Puis',
        origin: next ? null : route,
        // Rang neutre : la suite se lit après les liens propres au bloc.
        // L'annonce de la suite reste affichée sur l'étape qui la porte, où elle se modifie.
        edge: { ...route.edge, branch: 'AFTER_CONTROL', audioField: '' },
      });
    });
  }
  // Plusieurs suites qui passent par le même bloc : chacune dit d'où elle vient.
  const shared = (link) =>
    after.filter(
      (other) =>
        other.origin &&
        other.fromId === link.fromId &&
        other.label === link.label &&
        other.edge.field === link.edge.field,
    ).length > 1;
  const labelled = after.map((link) =>
    link.origin && shared(link)
      ? `${link.label}, après « ${link.origin.fromTitle} · ${link.origin.label} »`
      : link.label,
  );
  // Chaque carte supplémentaire porte aussi les autres liens du bloc qu'elle répète.
  for (const [id, real] of copies)
    for (const route of routes)
      if (route.fromId === real && route.relationship !== 'context' && !replaced.has(route))
        result.push({ ...route, id: `${route.id}@${id}`, fromId: id });
  // Un menu lu dans le bloc d'enregistrement n'a plus de carte à lui, sauf s'il sert aussi ailleurs.
  const hidden = new Set(
    [...merged.values()].filter(
      (menu) => !result.some((route) => route.toId === menu && route.relationship !== 'context'),
    ),
  );
  return {
    routes: [
      ...result.filter((route) => !hidden.has(route.fromId)),
      ...after.map(({ origin, ...link }, index) => ({ ...link, label: labelled[index] })),
    ],
    copies,
    blocks,
    merged,
    hidden,
  };
}

/**
 * Données de contexte initialisées à l'entrée d'un parcours, telles que « Données du parcours »
 * les présente : la table dédiée par numéro si elle existe, sinon les groupes de la première suite.
 * Lecture seule ; ne lève jamais.
 */
export function journeyContextData(snapshot, flow) {
  const tables = snapshot?.tables || [],
    entry = (flow?.nodes || []).find((node) => node.id === flow.id);
  if (!entry || flow.version !== '5' || flow.media === 'messaging')
    return { items: [], source: 'none' };
  const labels = new Map(
    (tables.find((table) => table.name === PARTICIPANT_CATALOGUE)?.rows || []).map((row) => [
      text(row.key),
      text(row.LABEL),
    ]),
  );
  const item = ({ name, value }) => ({ name, value: text(value), label: labels.get(name) || '' });
  const dedicated = tables.find((table) => table.name === FLOW_INITIALIZATION);
  if (dedicated) {
    const row = (dedicated.rows || []).find((r) => text(r.key) === text(entry.key));
    return {
      source: 'dedicated',
      items: initializationAttributes(row)
        .filter((slot) => slot.name)
        .map(item),
    };
  }
  const groups = tables.filter((table) => /^W_PARTICIPANT_DATA_v5$/i.test(table.name));
  if (groups.length !== 1) return { items: [], source: 'none' };
  const items = text(entry.row?.NEXT_TARGET)
    .split('|')
    .slice(1)
    .filter((part) => /^pdata:/i.test(part))
    .flatMap((part) => part.slice(6).split(';'))
    .filter(Boolean)
    .flatMap((key) => {
      try {
        return participantAssignments(groups[0].rows.find((row) => text(row.key) === key)).map(
          item,
        );
      } catch {
        return [];
      }
    });
  return { items, source: 'groups' };
}

/** Résumé d'une ligne pour une carte : « 3 données : A, B, C ». */
export function contextSummary(data) {
  const items = data?.items || [];
  if (!items.length) return 'Aucune donnée initialisée';
  const names = items.map((item) => item.label || item.name);
  return `${items.length} donnée${items.length > 1 ? 's' : ''} : ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
}
