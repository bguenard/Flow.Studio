/**
 * Référentiel de gouvernance — rôles déclarés et analyse d'impact.
 *
 * Rien ici n'est déduit d'un nom de clé, d'un suffixe V1/V2 ou de l'existence
 * d'une ligne : un Core Model, ses versions, le rattachement d'une déclinaison
 * et son périmètre sont des déclarations explicites de l'utilisateur (ou du jeu
 * fictif, ou d'une création faite dans le Studio). Le référentiel ne contient
 * que des identifiants de parcours et des libellés ; aucune ligne de
 * configuration WOLF n'y est copiée.
 *
 * Module pur : pas de DOM, pas de stockage, pas de réseau.
 */
import { compareFlows, flowTitle, nodeTitle } from './business.js';

const text = value => value === undefined || value === null ? '' : String(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

export const REGISTRY_VERSION = 1;

/** Périmètre d'une déclinaison : toujours déclaré, jamais lu dans Genesys. */
export const SCOPES = Object.freeze([
  { id: 'unknown', label: 'Non renseigné', short: 'Non renseigné' },
  { id: 'active', label: 'Activé', short: 'Activé' },
  { id: 'partial', label: 'Activé sur certains motifs', short: 'Certains motifs' },
  { id: 'inactive', label: 'Non activé', short: 'Non activé' },
]);
const SCOPE_IDS = new Set(SCOPES.map(scope => scope.id));
export const scopeLabel = id => SCOPES.find(scope => scope.id === id)?.label || SCOPES[0].label;

export function emptyRegistry() {
  return { schemaVersion: REGISTRY_VERSION, coreModels: [], declinations: [] };
}

/**
 * Lecture défensive d'un référentiel stocké ou exporté. Les entrées mal formées
 * ou contradictoires sont écartées plutôt que réparées par supposition :
 * un parcours ne peut porter qu'un seul rôle.
 */
export function normalizeRegistry(input) {
  const registry = emptyRegistry();
  if (!object(input)) return registry;
  const used = new Set(), modelIds = new Set();
  for (const model of Array.isArray(input.coreModels) ? input.coreModels : []) {
    if (!object(model) || !text(model.id).trim() || !text(model.name).trim() || modelIds.has(text(model.id))) continue;
    const versions = [];
    for (const version of Array.isArray(model.versions) ? model.versions : []) {
      if (!object(version) || !text(version.flowId) || !text(version.label).trim() || used.has(text(version.flowId))) continue;
      used.add(text(version.flowId));
      versions.push({ flowId: text(version.flowId), label: text(version.label).trim(), ...(text(version.declaredAt) ? { declaredAt: text(version.declaredAt) } : {}) });
    }
    if (!versions.length) continue;
    modelIds.add(text(model.id));
    registry.coreModels.push({ id: text(model.id), name: text(model.name).trim(), versions, ...(model.fictitious === true ? { fictitious: true } : {}) });
  }
  for (const item of Array.isArray(input.declinations) ? input.declinations : []) {
    if (!object(item) || !text(item.flowId) || used.has(text(item.flowId))) continue;
    const model = registry.coreModels.find(candidate => candidate.id === text(item.coreModelId));
    if (!model || !model.versions.some(version => version.flowId === text(item.baseFlowId))) continue;
    used.add(text(item.flowId));
    const nodeMappings = (Array.isArray(item.nodeMappings) ? item.nodeMappings : [])
      .filter(mapping => object(mapping) && text(mapping.referenceNodeId) && text(mapping.localNodeId))
      .map(mapping => ({ referenceNodeId: text(mapping.referenceNodeId), localNodeId: text(mapping.localNodeId) }));
    registry.declinations.push({
      flowId: text(item.flowId), coreModelId: model.id, baseFlowId: text(item.baseFlowId),
      scope: SCOPE_IDS.has(item.scope) ? item.scope : 'unknown', scopeNote: text(item.scopeNote).slice(0, 240),
      origin: ['declared', 'created', 'demo'].includes(item.origin) ? item.origin : 'declared',
      ...(text(item.declaredAt) ? { declaredAt: text(item.declaredAt) } : {}),
      ...(nodeMappings.length ? { nodeMappings } : {}),
    });
  }
  return registry;
}

/** Référentiel explicite fourni par une source fictive. Une source réelle n'en porte pas. */
export function seedFromSource(source) {
  if (!object(source) || source.demo !== true) return emptyRegistry();
  const coreModels = (Array.isArray(source.coreModels) ? source.coreModels : []).filter(model => object(model) && model.demoOnly === true)
    .map(model => ({ id: model.id, name: model.name, versions: model.versions, fictitious: true }));
  const declinations = (Array.isArray(source.relationships) ? source.relationships : []).filter(item => object(item) && item.demoOnly === true && item.type === 'declination')
    .map(item => ({ flowId: item.flowId, coreModelId: item.coreModelId, baseFlowId: item.referenceFlowId, scope: item.scope, scopeNote: item.scopeNote, origin: 'demo', nodeMappings: item.nodeMappings }));
  return normalizeRegistry({ coreModels, declinations });
}

function slug(name) {
  return text(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'core-model';
}

/**
 * Rôle déclaré d'un parcours.
 * @returns {{role:'reference',model,version,index,isLatest}|{role:'declination',model,declination,base,latest,isCurrent}|{role:'none'}}
 */
export function roleOf(registry, flowId) {
  for (const model of registry?.coreModels || []) {
    const index = model.versions.findIndex(version => version.flowId === flowId);
    if (index >= 0) return { role: 'reference', model, version: model.versions[index], index, isLatest: index === model.versions.length - 1 };
  }
  const declination = (registry?.declinations || []).find(item => item.flowId === flowId);
  if (declination) {
    const model = registry.coreModels.find(candidate => candidate.id === declination.coreModelId);
    const base = model?.versions.find(version => version.flowId === declination.baseFlowId);
    if (model && base) { const latest = model.versions.at(-1); return { role: 'declination', model, declination, base, latest, isCurrent: latest.flowId === base.flowId }; }
  }
  return { role: 'none' };
}

/**
 * Déclare un parcours comme version d'un Core Model : nouvelle famille (name)
 * ou nouvelle version, ajoutée en dernier, d'une famille existante (coreModelId).
 */
export function declareReference(registry, { flowId, coreModelId = '', name = '', versionLabel = '', declaredAt = '' }) {
  const next = normalizeRegistry(registry);
  if (!text(flowId)) throw new Error('Parcours à déclarer introuvable.');
  if (roleOf(next, flowId).role !== 'none') throw new Error('Ce parcours a déjà un rôle dans le référentiel. Retirez-le d’abord.');
  const label = text(versionLabel).trim();
  if (!label) throw new Error('Indiquez le libellé de version de ce parcours de référence.');
  if (label.length > 24) throw new Error('Limitez le libellé de version à 24 caractères.');
  const version = { flowId: text(flowId), label, ...(declaredAt ? { declaredAt } : {}) };
  if (coreModelId) {
    const model = next.coreModels.find(candidate => candidate.id === coreModelId);
    if (!model) throw new Error('Le Core Model choisi n’existe plus.');
    if (model.versions.some(item => item.label.toLowerCase() === label.toLowerCase())) throw new Error(`« ${model.name} » a déjà une version ${label}.`);
    model.versions.push(version);
    return next;
  }
  const modelName = text(name).trim();
  if (!modelName) throw new Error('Donnez un nom au Core Model.');
  if (modelName.length > 80) throw new Error('Limitez le nom du Core Model à 80 caractères.');
  if (next.coreModels.some(model => model.name.toLowerCase() === modelName.toLowerCase())) throw new Error(`Un Core Model nommé « ${modelName} » existe déjà.`);
  let id = `cm-${slug(modelName)}`;
  for (let suffix = 2; next.coreModels.some(model => model.id === id); suffix++) id = `cm-${slug(modelName)}-${suffix}`;
  next.coreModels.push({ id, name: modelName, versions: [version] });
  return next;
}

/** Rattache un parcours d'entité à la version de référence dont il est décliné. */
export function attachDeclination(registry, { flowId, baseFlowId, origin = 'declared', nodeMappings = [], scope = 'unknown', scopeNote = '', declaredAt = '' }) {
  const next = normalizeRegistry(registry);
  if (!text(flowId)) throw new Error('Parcours à rattacher introuvable.');
  if (flowId === baseFlowId) throw new Error('Un parcours ne peut pas être sa propre référence.');
  if (roleOf(next, flowId).role !== 'none') throw new Error('Ce parcours a déjà un rôle dans le référentiel. Retirez-le d’abord.');
  const base = roleOf(next, baseFlowId);
  if (base.role !== 'reference') throw new Error('Choisissez une version de Core Model comme référence.');
  next.declinations.push({ flowId: text(flowId), coreModelId: base.model.id, baseFlowId: text(baseFlowId), scope, scopeNote, origin, nodeMappings, ...(declaredAt ? { declaredAt } : {}) });
  return normalizeRegistry(next);
}

/**
 * Retire le rôle d'un parcours. Une version encore utilisée comme référence par
 * une déclinaison n'est pas retirée : la provenance ne doit pas disparaître en silence.
 */
export function removeFromRegistry(registry, flowId) {
  const next = normalizeRegistry(registry);
  const role = roleOf(next, flowId);
  if (role.role === 'declination') next.declinations = next.declinations.filter(item => item.flowId !== flowId);
  else if (role.role === 'reference') {
    const dependants = next.declinations.filter(item => item.baseFlowId === flowId).length;
    if (dependants) throw new Error(`${dependants} déclinaison(s) ont cette version pour référence. Retirez-les ou rattachez-les ailleurs avant de retirer cette version.`);
    const model = next.coreModels.find(candidate => candidate.id === role.model.id);
    model.versions = model.versions.filter(version => version.flowId !== flowId);
    if (!model.versions.length) next.coreModels = next.coreModels.filter(candidate => candidate.id !== model.id);
  }
  return next;
}

export function setScope(registry, flowId, scope, scopeNote) {
  const next = normalizeRegistry(registry);
  const declination = next.declinations.find(item => item.flowId === flowId);
  if (!declination) throw new Error('Ce parcours n’est pas une déclinaison rattachée.');
  if (!SCOPE_IDS.has(scope)) throw new Error('Périmètre inconnu.');
  declination.scope = scope;
  if (scopeNote !== undefined) declination.scopeNote = text(scopeNote).slice(0, 240);
  return next;
}

/**
 * Confronte le référentiel aux parcours réellement présents dans la source.
 * Une entrée dont le parcours est absent est conservée (missing) : elle n'est
 * ni supprimée ni réaffectée à un autre parcours.
 */
export function resolveRegistry(registry, flows = []) {
  const byId = new Map(flows.map(flow => [flow.id, flow]));
  const declared = new Set();
  let missing = 0;
  const models = (registry?.coreModels || []).map(model => {
    const versions = model.versions.map((version, index) => { declared.add(version.flowId); const flow = byId.get(version.flowId) || null; if (!flow) missing++; return { ...version, index, flow }; });
    const declinations = (registry.declinations || []).filter(item => item.coreModelId === model.id).map(item => {
      declared.add(item.flowId);
      const flow = byId.get(item.flowId) || null;
      if (!flow) missing++;
      const base = versions.find(version => version.flowId === item.baseFlowId);
      return { ...item, flow, base, latest: versions.at(-1), isCurrent: versions.at(-1).flowId === item.baseFlowId };
    });
    return { ...model, versions, declinations, latest: versions.at(-1), present: versions.some(version => version.flow) };
  });
  return {
    models: models.filter(model => model.present),
    absentModels: models.filter(model => !model.present),
    // Marqueur de modèle repéré dans la source, mais rôle non déclaré : à classer par l'utilisateur.
    candidates: flows.filter(flow => !declared.has(flow.id) && flow.category === 'template'),
    entities: flows.filter(flow => !declared.has(flow.id) && flow.category !== 'template'),
    missing,
  };
}

// La référence signale elle-même un emplacement à renseigner par l'entité,
// par exemple ACCUEIL_[ENTITE] : la valeur locale n'est alors pas une dérogation.
const PLACEHOLDER = /\[[A-Z][A-Z0-9_ ]*\]/;
const hasPlaceholder = value => typeof value === 'string' && PLACEHOLDER.test(value);
const seeds = mappings => (mappings || []).map(mapping => [mapping.referenceNodeId, mapping.localNodeId]);
const slotKey = (nodeId, slot) => `${nodeId}\u0000${slot}`;

function stepNotes(diff, leftText, rightText, leftKind, rightKind) {
  const steps = diff.unmatched.map(entry => ({ kind: entry.side === 'left' ? leftKind : rightKind, section: entry.section, label: entry.label, description: entry.side === 'left' ? leftText : rightText }));
  const review = diff.ambiguous.map(entry => ({ label: entry.label, count: entry.leftNodes.length + entry.rightNodes.length, section: entry.section }));
  return { steps, review };
}

/**
 * Écarts d'une déclinaison par rapport à la version de référence dont elle est
 * déclinée. « binding » : valeur propre à l'entité à un emplacement prévu par la
 * référence ; « local » : adaptation locale d'une valeur fixée par la référence.
 */
export function localGaps(base, local, options = {}) {
  const diff = compareFlows(base, local, { seedMatches: seeds(options.mappings) });
  const items = diff.items.map(item => ({
    id: item.id, slot: item.slot, kind: !item.structural && hasPlaceholder(item.before) ? 'binding' : 'local',
    section: item.section, label: item.label, structural: Boolean(item.structural), field: item.field,
    step: nodeTitle(item.leftNode), baseNode: item.leftNode, localNode: item.rightNode,
    baseDisplay: item.beforeDisplay, localDisplay: item.afterDisplay,
  }));
  const notes = stepNotes(diff, 'Étape de la référence absente du parcours de l’entité', 'Étape propre au parcours de l’entité', 'local-missing', 'local-added');
  return { items, ...notes, matches: diff.matches, counts: count(items, notes) };
}

function count(items, notes) {
  const counts = { group: 0, conflict: 0, local: 0, binding: 0, converged: 0, unpaired: 0, steps: notes.steps.length, groupSteps: notes.steps.filter(step => step.kind.startsWith('group-')).length, review: notes.review.length };
  for (const item of items) counts[item.kind]++;
  return counts;
}

/**
 * Analyse à trois états : référence adoptée (base), nouvelle référence (next),
 * parcours de l'entité (local).
 *
 *   group     — la référence évolue, l'entité est restée sur la valeur adoptée ;
 *   local     — l'entité a adapté, la référence n'a pas bougé ;
 *   binding   — valeur propre à l'entité prévue par la référence ;
 *   converged — les deux ont évolué vers la même valeur ;
 *   conflict  — les deux ont évolué différemment : arbitrage nécessaire ;
 *   unpaired  — l'étape n'a pas de correspondance sûre de l'autre côté : aucun
 *               verdict n'est rendu, le rapprochement est à faire.
 *
 * C'est une lecture de trois parcours présents dans la source. Elle ne prouve
 * ni l'adoption effective d'une version, ni une mise en service.
 */
export function threeWay(base, next, local, options = {}) {
  const groupDiff = compareFlows(base, next);
  const localDiff = compareFlows(base, local, { seedMatches: seeds(options.mappings) });
  const nextOf = new Map(groupDiff.matches.map(match => [match.leftNode.id, match.rightNode]));
  const localOf = new Map(localDiff.matches.map(match => [match.leftNode.id, match.rightNode]));
  const composed = [...nextOf].filter(([baseId]) => localOf.has(baseId)).map(([baseId, nextNode]) => [nextNode.id, localOf.get(baseId).id]);
  const crossDiff = compareFlows(next, local, { seedMatches: composed, exact: true });
  const cross = new Set(crossDiff.items.map(item => slotKey(item.leftNode.id, item.slot)));
  const groupItems = new Map(groupDiff.items.map(item => [slotKey(item.leftNode.id, item.slot), item]));
  const localItems = new Map(localDiff.items.map(item => [slotKey(item.leftNode.id, item.slot), item]));
  const items = [];
  for (const key of new Set([...groupItems.keys(), ...localItems.keys()])) {
    const group = groupItems.get(key), own = localItems.get(key), sample = group || own;
    const baseNode = sample.leftNode, nextNode = nextOf.get(baseNode.id) || null, localNode = localOf.get(baseNode.id) || null;
    let kind;
    if (group && own) kind = cross.has(slotKey(nextNode.id, sample.slot)) ? 'conflict' : 'converged';
    else if (group) kind = localNode ? 'group' : 'unpaired';
    else if (!nextNode) kind = 'unpaired';
    else kind = !own.structural && hasPlaceholder(own.before) ? 'binding' : 'local';
    const unchanged = 'Identique à la référence adoptée';
    items.push({
      id: key, slot: sample.slot, kind, section: sample.section, label: sample.label, structural: Boolean(sample.structural), field: sample.field,
      step: nodeTitle(baseNode), baseNode, nextNode, localNode,
      baseDisplay: sample.beforeDisplay,
      groupDisplay: group ? group.afterDisplay : unchanged, groupChanged: Boolean(group),
      localDisplay: own ? own.afterDisplay : localNode ? unchanged : 'Étape sans correspondance dans le parcours de l’entité', localChanged: Boolean(own),
    });
  }
  const groupNotes = stepNotes(groupDiff, 'Étape retirée de la nouvelle référence', 'Étape ajoutée dans la nouvelle référence', 'group-removed', 'group-added');
  const localNotes = stepNotes(localDiff, 'Étape de la référence absente du parcours de l’entité', 'Étape propre au parcours de l’entité', 'local-missing', 'local-added');
  const notes = { steps: [...groupNotes.steps, ...localNotes.steps], review: [...groupNotes.review.map(entry => ({ ...entry, between: 'versions' })), ...localNotes.review.map(entry => ({ ...entry, between: 'local' }))] };
  return { items, ...notes, counts: count(items, notes) };
}

/**
 * Synthèse pour le pilotage d'une déclinaison : écarts avec sa référence et,
 * si une version plus récente est déclarée, impact de cette version.
 */
export function declinationSummary(base, local, latest = null, mappings = []) {
  if (!base || !local) return null;
  const gaps = localGaps(base, local, { mappings });
  const impact = latest && latest.id !== base.id ? threeWay(base, latest, local, { mappings }) : null;
  return { gaps: gaps.counts, impact: impact?.counts || null };
}

/** Nombre d'évolutions entre deux versions de référence consécutives. */
export function versionDelta(previous, next) {
  if (!previous || !next) return null;
  const diff = compareFlows(previous, next);
  return { settings: diff.items.filter(item => !item.structural).length, structure: diff.items.filter(item => item.structural).length, steps: diff.unmatched.length, review: diff.ambiguous.length };
}

/** Libellé de version proposé à la saisie ; l'utilisateur le confirme ou le remplace. */
export function suggestVersionLabel(flow, model = null) {
  const fromKey = text(flow?.key).match(/_V(\d+(?:\.\d+)?)$/i)?.[1];
  const taken = new Set((model?.versions || []).map(version => version.label.toLowerCase()));
  if (fromKey && !taken.has(fromKey.toLowerCase())) return fromKey;
  let number = (model?.versions.length || 0) + 1;
  while (taken.has(String(number))) number++;
  return String(number);
}

/** Nom de famille proposé : le titre du parcours sans sa mention de version. */
export function suggestModelName(flow) {
  return flowTitle(flow).replace(/\s*·\s*version\s+\S+$/i, '').trim() || 'Core Model';
}

export const registryForExport = registry => clone(normalizeRegistry(registry));
