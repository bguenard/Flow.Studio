/**
 * Legacy browser registry compatibility for one-time Genesys migration.
 * The connected Studio uses genesys-governance.js as its authoritative store.
 * This reader preserves old data until the dedicated remote table is verified.
 */
import { normalizeRegistry } from './governance.js';

const PREFIX = 'wolf-studio.governance.v1:';

/**
 * Le jeu fictif a son propre espace. Les lectures Genesys et les exports
 * partagent le même : un export et une lecture de la même organisation
 * désignent les mêmes parcours ; les entrées sans parcours présent restent
 * simplement en attente (voir resolveRegistry).
 */
export function registryScope(source) {
  return source?.demo === true || source?.kind === 'demo' ? (source?.wolfVersion==='5'?'demo-wolf-v5':'demo') : 'local';
}

export function loadRegistry(storage, scope) {
  try {
    const raw = storage?.getItem(PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.schemaVersion === 1 ? normalizeRegistry(parsed) : null;
  } catch { return null; }
}

/**
 * @param {Iterable<string>} transientFlowIds parcours créés dans la page et non
 * persistés : leurs entrées ne sont pas enregistrées, elles deviendraient
 * orphelines au rechargement.
 * @returns {boolean} false si le navigateur a refusé l'écriture.
 */
export function saveRegistry(storage, scope, registry, transientFlowIds = []) {
  const transient = new Set(transientFlowIds);
  const durable = normalizeRegistry({ ...registry, declinations: (registry?.declinations || []).filter(item => !transient.has(item.flowId)) });
  try { storage?.setItem(PREFIX + scope, JSON.stringify(durable)); return Boolean(storage); }
  catch { return false; }
}

export function clearRegistry(storage, scope) {
  try { storage?.removeItem(PREFIX + scope); return true; } catch { return false; }
}
