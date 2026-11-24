/**
 * WOLF Core Studio — moteur de démonstration, sans connexion Genesys.
 * Les identifiants, configurations et historiques sont fictifs.
 */
export const FIELD_DEFS = [
  { key: 'welcomeMessage', label: 'Message d’accueil', group: 'Expérience client', type: 'text', mapping: 'W_INBOUND_CALL_v5.WELCOME_AUDIO', copyable: true },
  { key: 'routingRule', label: 'Règle de routage', group: 'Distribution', type: 'select', options: ['Compétence puis disponibilité', 'Compétence spécialisée puis disponibilité', 'Assistance prioritaire 24/7'], mapping: 'Politique métier à compiler vers TARGET_TYPE / TARGET et W_SERVICES_v5', copyable: true },
  { key: 'businessAttribute', label: 'Attribut métier', group: 'Contexte client', type: 'text', mapping: 'W_PARTICIPANT_DATA_v5.PDATA_LIST_1', copyable: true },
  { key: 'qualification', label: 'Règle de qualification', group: 'Contexte client', type: 'text', mapping: 'Extension de gouvernance · mapping de qualification à définir', copyable: true },
  { key: 'hours', label: 'Horaires d’ouverture', group: 'Organisation', type: 'text', mapping: 'W_SCHEDULE_GROUP_v5.SCHEDULE_GROUP · référence de calendrier Genesys', copyable: true },
  { key: 'priority', label: 'Priorité des interactions', group: 'Distribution', type: 'number', min: 0, max: 100, mapping: 'W_SERVICES_v5.PRIORITY', copyable: true },
  { key: 'team', label: 'Équipe de destination', group: 'Distribution', type: 'select', options: ['Relation client', 'Équipe dédiée', 'Assistance', 'Sinistres'], mapping: 'W_SERVICES_v5.QUEUE · résolution locale de l’alias métier', copyable: true },
  { key: 'skills', label: 'Compétences associées', group: 'Distribution', type: 'list', mapping: 'W_SERVICES_v5.SKILLS · séparateur ;', copyable: true },
  { key: 'channelEnabled', label: 'Parcours inclus dans le pilote', group: 'Périmètre local', type: 'boolean', mapping: 'Gouvernance Studio uniquement · aucun interrupteur natif dans les tables WOLF v5', copyable: false, localOnly: true },
  { key: 'intentions', label: 'Choix SVI couverts', group: 'Parcours vocal', type: 'list', options: ['Contrat', 'Sinistre', 'Paiement', 'Conseil'], mapping: 'W_MENU_v5 · options DTMF et triplets TARGET_AUDIO / TARGET_TYPE / TARGET à associer', copyable: true },
];

const FIELD_MAP = Object.fromEntries(FIELD_DEFS.map(field => [field.key, field]));
const COPYABLE = new Set(FIELD_DEFS.filter(field => field.copyable).map(field => field.key));
const clone = value => structuredClone(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const now = () => new Date().toISOString();

// Stable object-key order avoids phantom differences; arrays retain business order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const valuesEqual = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function nextId(state, prefix) {
  state.sequence = (state.sequence || 0) + 1;
  return `${prefix}-${state.sequence}`;
}

function addAudit(state, type, description, actor = 'Administrateur Groupe', entityId = null, details = {}) {
  state.audit.unshift({ id: nextId(state, 'audit'), at: now(), actor, type, description, entityId, details: clone(details), simulation: true });
  state.audit = state.audit.slice(0, 200);
}

function recordSnapshot(state, entity, reason, actor) {
  entity.history.unshift({ id: nextId(state, 'snapshot'), at: now(), actor, reason, baseVersionId: entity.baseVersionId, fields: clone(entity.fields) });
  entity.history = entity.history.slice(0, 30);
}

export function getCurrentCore(state) {
  const core = state.coreVersions.find(version => version.id === state.currentCoreId);
  if (!core) throw new Error('Version courante du Core Model introuvable.');
  return core;
}

export function getEntity(state, id) {
  const entity = state.entities.find(item => item.id === id);
  if (!entity) throw new Error('Entité introuvable.');
  return entity;
}

function getVersion(state, id) {
  const version = state.coreVersions.find(item => item.id === id);
  if (!version) throw new Error('Version du Core Model introuvable.');
  return version;
}

export function createSeedState() {
  const fields = {
    welcomeMessage: 'Bienvenue chez Groupama. Comment pouvons-nous vous accompagner ?',
    routingRule: 'Compétence puis disponibilité',
    businessAttribute: 'segmentClient',
    qualification: 'Motif obligatoire avant clôture',
    hours: 'Lun–ven · 09:00–18:00',
    priority: 50,
    team: 'Relation client',
    skills: ['Relation client', 'Accueil téléphonique'],
    channelEnabled: true,
    intentions: ['Contrat', 'Sinistre', 'Paiement'],
  };
  const core20 = { id: 'core-2.0', version: '2.0', channel: 'Voix', title: 'Socle de relation client vocal', createdAt: '2026-11-16T08:30:00.000Z', fields: clone(fields) };
  const core21 = { ...clone(core20), id: 'core-2.1', version: '2.1', title: 'Accueil personnalisé et routage spécialisé', createdAt: '2026-11-23T08:45:00.000Z', fields: {
    ...clone(fields),
    welcomeMessage: 'Bienvenue chez Groupama. Un conseiller spécialisé vous accompagne dans votre demande.',
    routingRule: 'Compétence spécialisée puis disponibilité',
    businessAttribute: 'segmentClient;motifContact',
    qualification: 'Motif et résultat obligatoires avant clôture',
  } };
  const entity = (id, name, shortName, color, patch, deploymentMode = 'validation') => ({
    id, name, shortName, color, baseVersionId: core20.id, deploymentMode,
    fields: { ...clone(fields), ...patch },
    bindings: {
      divisionId: `DEMO_DIV_${id.toUpperCase().replaceAll('-', '_')}`,
      dnisSegment: `DEMO_${id.toUpperCase().replaceAll('-', '_')}`,
      scheduleGroupId: `DEMO_SCHEDULE_${id}`,
      queueIds: Object.fromEntries(FIELD_MAP.team.options.map((alias, index) => [alias, `DEMO_QUEUE_${id}_${index + 1}`])),
    },
    history: [],
  });
  const state = {
    schemaVersion: 1, demo: true, media: 'voice', sequence: 3, currentCoreId: core21.id,
    coreVersions: [core20, core21],
    channels: [{ id: 'channel-voice', name: 'Voix', status: 'reference', skills: ['Relation client', 'Accueil téléphonique'], routingRule: fields.routingRule, createdAt: core20.createdAt }],
    entities: [
      entity('gan-vie', 'Groupama Gan Vie', 'Gan Vie', '#5079e8', { hours: 'Lun–ven · 08:30–18:30', priority: 70, team: 'Équipe dédiée' }),
      entity('mutuaide', 'Mutuaide Assistance', 'Mutuaide', '#ad71cf', { channelEnabled: false, routingRule: 'Assistance prioritaire 24/7', hours: 'Tous les jours · 24 h/24', team: 'Assistance' }),
      entity('cr12', 'Caisse Régionale 12', 'CR12', '#2a9d8f', { intentions: ['Sinistre'], team: 'Sinistres' }),
      entity('gan-assurance', 'Gan Assurances', 'Gan Assurances', '#cf8850', {}, 'automatique'),
    ],
    audit: [
      { id: 'audit-3', at: core21.createdAt, actor: 'Administrateur Groupe', type: 'core_version', description: 'Core Model 2.1 préparé · 4 paramètres modifiés', entityId: null, details: { version: '2.1' }, simulation: true },
      { id: 'audit-2', at: '2026-11-20T10:20:00.000Z', actor: 'Administrateur Mutuaide', type: 'local_update', description: 'Règle d’assistance locale adaptée · parcours hors du périmètre pilote', entityId: 'mutuaide', details: {}, simulation: true },
      { id: 'audit-1', at: '2026-11-19T09:15:00.000Z', actor: 'Administrateur CR12', type: 'local_update', description: 'Périmètre du SVI limité au choix Sinistre', entityId: 'cr12', details: {}, simulation: true },
    ],
  };
  return state;
}

/** Genuine three-way merge: baseline, entity configuration, incoming group version. */
export function compareEntity(state, entityId, versionId = state.currentCoreId) {
  const entity = getEntity(state, entityId);
  const base = getVersion(state, entity.baseVersionId);
  const incoming = getVersion(state, versionId);
  return FIELD_DEFS.map(field => {
    const baseValue = base.fields[field.key];
    const localValue = entity.fields[field.key];
    const incomingValue = incoming.fields[field.key];
    const localChanged = !valuesEqual(baseValue, localValue);
    // Governance flags are local metadata, never a group instruction to enable/disable voice.
    const groupChanged = !field.localOnly && !valuesEqual(baseValue, incomingValue);
    let status = 'unchanged';
    if (localChanged && groupChanged) status = valuesEqual(localValue, incomingValue) ? 'converged' : 'conflict';
    else if (localChanged) status = 'local';
    else if (groupChanged) status = 'incoming';
    return { ...field, base: clone(baseValue), local: clone(localValue), incoming: clone(incomingValue), status, localChanged, groupChanged };
  });
}

export function getEntitySummary(state, entityId) {
  const entity = getEntity(state, entityId);
  const rows = compareEntity(state, entityId);
  const conflicts = rows.filter(row => row.status === 'conflict').length;
  const localOverrides = rows.filter(row => row.localChanged).length;
  const changes = rows.filter(row => row.groupChanged).length;
  const pendingChanges = rows.filter(row => row.status === 'incoming' || row.status === 'conflict').length;
  const validation = validateEntity(state, entityId);
  return {
    id: entityId, enabled: entity.fields.channelEnabled, active: entity.fields.channelEnabled,
    partial: entity.fields.channelEnabled && entity.fields.intentions.length < getCurrentCore(state).fields.intentions.length,
    conflicts, localOverrides, overrides: localOverrides, changes, pendingChanges,
    baseVersion: getVersion(state, entity.baseVersionId).version,
    currentVersion: getCurrentCore(state).version,
    upToDate: entity.baseVersionId === state.currentCoreId,
    conformant: entity.baseVersionId === state.currentCoreId && conflicts === 0 && validation.valid,
    status: conflicts ? 'conflict' : entity.baseVersionId !== state.currentCoreId ? 'pending' : localOverrides ? 'adapted' : 'aligned',
    validation,
  };
}

function assertPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Les paramètres doivent être un objet.');
  for (const key of Object.keys(patch)) if (!FIELD_MAP[key]) throw new Error(`Paramètre non autorisé : ${key}.`);
}

function validateFields(fields) {
  const errors = [];
  for (const field of FIELD_DEFS) {
    const value = fields[field.key];
    let message;
    if (field.type === 'number' && (!Number.isFinite(value) || value < field.min || value > field.max)) message = `Saisir un nombre entre ${field.min} et ${field.max}.`;
    if ((field.type === 'text' || field.type === 'select') && (typeof value !== 'string' || !value.trim())) message = 'Ce paramètre est obligatoire.';
    if (field.type === 'select' && !field.options.includes(value)) message = 'Choisir une valeur du référentiel métier.';
    if (field.type === 'boolean' && typeof value !== 'boolean') message = 'Le statut du périmètre pilote doit être vrai ou faux.';
    if (field.type === 'list' && (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()))) message = 'Renseigner une liste de valeurs non vides.';
    if (field.type === 'list' && Array.isArray(value) && new Set(value).size !== value.length) message = 'Retirer les valeurs en double.';
    if (field.type === 'list' && field.options && Array.isArray(value) && value.some(item => !field.options.includes(item))) message = 'Une valeur est absente du référentiel métier.';
    if (field.type === 'text' && typeof value === 'string' && value.length > 2000) message = 'Limiter le texte à 2 000 caractères.';
    if (message) errors.push({ key: field.key, label: field.label, message });
  }
  if (fields.channelEnabled && Array.isArray(fields.intentions) && !fields.intentions.length) errors.push({ key: 'intentions', label: 'Choix SVI couverts', message: 'Sélectionner au moins un choix SVI pour inclure le parcours dans le pilote.' });
  if (Array.isArray(fields.skills) && !fields.skills.length) errors.push({ key: 'skills', label: 'Compétences associées', message: 'Associer au moins une compétence.' });
  return errors;
}

export function validateEntity(state, entityId) {
  const entity = getEntity(state, entityId);
  const errors = validateFields(entity.fields);
  if (!entity.bindings?.queueIds?.[entity.fields.team]) errors.push({ key: 'team', label: 'Équipe de destination', message: 'L’alias métier doit être associé à une file de cette entité.' });
  return { valid: errors.length === 0, errors, warnings: ['Validation de démonstration : les références et contenus réels des data tables Genesys restent à contrôler. Le périmètre pilote ne modifie pas la disponibilité téléphonique.'] };
}

function assertValid(state, entityId) {
  const validation = validateEntity(state, entityId);
  if (!validation.valid) throw new Error(validation.errors.map(error => `${error.label} : ${error.message}`).join(' '));
}

export function updateEntity(state, entityId, patch, actor = 'Administrateur local') {
  assertPatch(patch);
  const original = getEntity(state, entityId);
  const changed = Object.keys(patch).filter(key => !valuesEqual(original.fields[key], patch[key]));
  if (!changed.length) return clone(state);
  const result = clone(state);
  const entity = getEntity(result, entityId);
  recordSnapshot(result, entity, 'Avant adaptation locale', actor);
  Object.assign(entity.fields, clone(patch));
  assertValid(result, entityId);
  addAudit(result, 'local_update', `${entity.shortName} · ${changed.length} paramètre${changed.length > 1 ? 's' : ''} adapté${changed.length > 1 ? 's' : ''}`, actor, entityId, { keys: changed });
  return result;
}

export function createCoreVersion(state, patch, actor = 'Administrateur Groupe') {
  assertPatch(patch);
  if (Object.keys(patch).some(key => FIELD_MAP[key].localOnly)) throw new Error('Le périmètre pilote se décide localement ; il ne fait pas partie des évolutions du Core Model.');
  const current = getCurrentCore(state);
  const changed = Object.keys(patch).filter(key => !valuesEqual(current.fields[key], patch[key]));
  if (!changed.length) throw new Error('Modifier au moins un paramètre avant de créer une version.');
  const fields = { ...clone(current.fields), ...clone(patch) };
  const errors = validateFields(fields);
  if (errors.length) throw new Error(errors.map(error => `${error.label} : ${error.message}`).join(' '));
  const result = clone(state);
  const [major, minor] = current.version.split('.').map(Number);
  const version = `${major}.${minor + 1}`;
  const entry = { id: `core-${version}`, version, title: `Évolution du Core Model ${version}`, channel: current.channel, createdAt: now(), fields };
  result.coreVersions.push(entry);
  result.currentCoreId = entry.id;
  addAudit(result, 'core_version', `Core Model ${version} préparé · ${changed.length} paramètre${changed.length > 1 ? 's' : ''} modifié${changed.length > 1 ? 's' : ''}`, actor, null, { version, keys: changed });
  return result;
}

export function applyCoreVersion(state, entityId, resolutions = {}, actor = 'Administrateur Groupe') {
  const rows = compareEntity(state, entityId);
  const conflicts = rows.filter(row => row.status === 'conflict');
  if (conflicts.some(row => !['local', 'core'].includes(resolutions[row.key]))) throw new Error('Résoudre chaque conflit avant de valider la propagation.');
  for (const [key, choice] of Object.entries(resolutions)) {
    if (!FIELD_MAP[key] || !['local', 'core'].includes(choice)) throw new Error('Résolution de conflit invalide.');
  }
  const result = clone(state);
  const entity = getEntity(result, entityId);
  if (entity.baseVersionId === result.currentCoreId) throw new Error('Cette entité utilise déjà la version courante.');
  recordSnapshot(result, entity, `Avant adoption du Core Model ${getCurrentCore(result).version}`, actor);
  for (const row of rows) {
    if (row.status === 'incoming' || (row.status === 'conflict' && resolutions[row.key] === 'core')) entity.fields[row.key] = clone(row.incoming);
    // local/converged/unchanged keep the entity value; overrides never disappear implicitly.
  }
  entity.baseVersionId = result.currentCoreId;
  delete entity.deferredVersionId;
  assertValid(result, entityId);
  addAudit(result, 'propagation', `${entity.shortName} · version ${getCurrentCore(result).version} adoptée`, actor, entityId, { resolutions, version: entity.baseVersionId, preservedOverrides: rows.filter(row => row.status === 'local' || row.status === 'conflict' && resolutions[row.key] === 'local').map(row => row.key) });
  return result;
}

export function rejectCoreVersion(state, entityId, reason, actor = 'Administrateur local') {
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('Indiquer le motif du report.');
  const result = clone(state);
  const entity = getEntity(result, entityId);
  entity.deferredVersionId = result.currentCoreId;
  addAudit(result, 'deferred', `${entity.shortName} · évolution reportée`, actor, entityId, { reason: reason.trim(), version: result.currentCoreId });
  return result;
}

export function copyFields(state, sourceId, targetIds, keys, actor = 'Administrateur Groupe') {
  const source = getEntity(state, sourceId);
  if (!Array.isArray(keys) || !keys.length) throw new Error('Sélectionner au moins un paramètre à copier.');
  if (keys.some(key => !COPYABLE.has(key))) throw new Error('La copie est limitée aux paramètres métier sélectionnables. Les identifiants et le statut du périmètre pilote ne sont jamais copiés.');
  if (!Array.isArray(targetIds) || !targetIds.length) throw new Error('Sélectionner au moins une entité cible.');
  if (targetIds.includes(sourceId)) throw new Error('L’entité source ne peut pas être sa propre cible.');
  const result = clone(state);
  for (const id of new Set(targetIds)) {
    const entity = getEntity(result, id);
    const changed = [...new Set(keys)].filter(key => !valuesEqual(entity.fields[key], source.fields[key]));
    if (!changed.length) continue;
    recordSnapshot(result, entity, `Avant copie depuis ${source.shortName}`, actor);
    for (const key of changed) entity.fields[key] = clone(source.fields[key]);
    assertValid(result, id);
    addAudit(result, 'copy', `${entity.shortName} · ${changed.length} paramètre${changed.length > 1 ? 's' : ''} copié${changed.length > 1 ? 's' : ''} depuis ${source.shortName}`, actor, id, { sourceId, keys: changed, bindingMode: 'aliases-resolved-in-target-entity' });
  }
  return result;
}

export function rollbackEntity(state, entityId, historyId, actor = 'Administrateur Groupe') {
  const source = getEntity(state, entityId);
  const snapshot = historyId ? source.history.find(item => item.id === historyId) : source.history[0];
  if (!snapshot) throw new Error('Aucune configuration précédente disponible.');
  getVersion(state, snapshot.baseVersionId);
  const result = clone(state);
  const entity = getEntity(result, entityId);
  recordSnapshot(result, entity, 'Avant restauration', actor);
  entity.fields = clone(snapshot.fields);
  entity.baseVersionId = snapshot.baseVersionId;
  delete entity.deferredVersionId;
  assertValid(result, entityId);
  addAudit(result, 'rollback', `${entity.shortName} · configuration précédente restaurée`, actor, entityId, { snapshotId: snapshot.id, baseVersionId: snapshot.baseVersionId });
  return result;
}

export function createChannel(state, { name, skills = ['Relation client'], routingRule = 'Compétence puis disponibilité' }, actor = 'Administrateur Groupe') {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) throw new Error('Le nom du canal doit contenir entre 2 et 60 caractères.');
  if (state.channels.some(item => item.name.toLocaleLowerCase('fr-FR') === name.trim().toLocaleLowerCase('fr-FR'))) throw new Error('Ce canal existe déjà dans le catalogue.');
  if (!Array.isArray(skills) || !skills.length || skills.some(item => typeof item !== 'string' || !item.trim())) throw new Error('Associer au moins une compétence au nouveau canal.');
  if (!FIELD_MAP.routingRule.options.includes(routingRule)) throw new Error('Choisir une règle de routage de référence.');
  const result = clone(state);
  const channel = { id: nextId(result, 'channel'), name: name.trim(), status: 'draft', skills: clone(skills), routingRule, createdAt: now() };
  result.channels.push(channel);
  addAudit(result, 'channel_created', `${channel.name} · canal préparé dans le catalogue Groupe`, actor, null, { channelId: channel.id, requiresIntegration: true });
  return result;
}

export function exportDeploymentPlan(state, entityIds = state.entities.map(entity => entity.id)) {
  return {
    format: 'wolf-core-studio-plan/v1', mode: 'simulation', demo: true, media: 'voice', generatedAt: now(),
    coreVersion: getCurrentCore(state).version,
    note: 'Plan vocal de démonstration non exécutable. Les data tables WOLF réelles, leurs schémas et leurs références doivent être lus et validés avant toute écriture. Le champ channelEnabled représente uniquement le périmètre pilote Studio ; ce n’est pas un interrupteur natif de téléphonie. La qualification reste une extension à préciser.',
    entities: entityIds.map(id => {
      const entity = getEntity(state, id);
      return {
        id, name: entity.name, baseVersion: getVersion(state, entity.baseVersionId).version,
        channel: getCurrentCore(state).channel, channelEnabled: entity.fields.channelEnabled, governanceScope: entity.fields.channelEnabled ? 'included' : 'excluded',
        logicalConfiguration: clone(entity.fields),
        validation: validateEntity(state, id),
        voiceMappingExamples: [
          { table: 'W_INBOUND_CALL_v5', key: entity.bindings.dnisSegment, fields: { WELCOME_AUDIO: `tts:${entity.fields.welcomeMessage}`, DIVISION: entity.bindings.divisionId } },
          { table: 'W_SERVICES_v5', key: `DEMO_SERVICE_${id}`, fields: { PRIORITY: entity.fields.priority, QUEUE: entity.bindings.queueIds[entity.fields.team], SKILLS: entity.fields.skills.join(';') } },
          { table: 'W_SCHEDULE_GROUP_v5', key: `DEMO_SCHEDULE_${id}`, fields: { SCHEDULE_GROUP: entity.bindings.scheduleGroupId } },
        ],
        unresolvedMappings: ['Règle de routage vers les cibles WOLF', 'Attribut métier et valeur', 'Qualification · extension à préciser', 'Horaires détaillés et calendrier Genesys', 'Choix SVI vers les options DTMF de W_MENU_v5'],
      };
    }),
  };
}
