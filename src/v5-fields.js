/** Editable settings follow the loaded V5 schema; physical and logical row keys stay stable. */
import { decisionFields, isV5Decision, validateDecision } from './decision-fields.js';
export const isV5 = (node) => /^W_.+_v5$/i.test(node?.tableName || '');
const aliases = {
  W_INBOUND_CALL_V5: 'DNIS_SEGMENT',
  W_SERVICES_V5: 'SERVICE',
  W_PARTICIPANT_DATA_V5: 'PDATA_NAME',
  W_MENU_V5: 'MENU_NAME',
  W_MENU_CB_V5: 'MENU_NAME',
  W_SCHEDULE_GROUP_V5: 'SCHEDULE_GROUP_KEY',
  W_RECORDING_V5: 'DIVISION_NAME',
  W_RATIO_DISTRIB_V5: 'RATIO_NAME',
  W_DECISION_V5: 'DECISION_NAME',
  W_CHECK_INTERACTION_NB_V5: 'QUEUE',
  W_CHECK_AGENT_LOGGED_V5: 'QUEUE',
};
export const immutableV5Field = (node, key) =>
  key.toUpperCase() === 'KEY' || aliases[node?.tableName?.toUpperCase()] === key.toUpperCase();
export const targetTables = {
  inboundcall: 'W_INBOUND_CALL_v5',
  service: 'W_SERVICES_v5',
  menu: 'W_MENU_v5',
  schedulegroup: 'W_SCHEDULE_GROUP_v5',
  decision: 'W_DECISION_v5',
  ratiodistrib: 'W_RATIO_DISTRIB_v5',
  bot: 'W_BOT_v5',
  transfercallflow: 'W_TRANSFER_CALLFLOW_v5',
  callback: 'W_CALLBACK_v5',
};
export const routeTypeLabels = {
  inboundcall: 'Accueil',
  service: 'Équipe de traitement',
  menu: 'Menu vocal',
  schedulegroup: 'Horaires',
  decision: 'Règle métier',
  ratiodistrib: 'Répartition',
  bot: 'Bot vocal',
  transfercallflow: 'Autre flow',
  callback: 'Rappel',
  disconnect: 'Fin d’appel',
  next: 'Continuer l’attente',
  number: 'Numéro de téléphone',
  queue: 'File Genesys',
  user: 'Conseiller',
  voicemailqueue: 'Messagerie d’équipe',
  voicemailgroup: 'Messagerie de groupe',
  voicemailuser: 'Messagerie du conseiller',
  enable: 'Accepter le consentement',
  disable: 'Refuser le consentement',
};
const noTarget = new Set(['disconnect', 'next', 'enable', 'disable']);
export const isRouteType = (key) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(key);
export function routeTargetKey(typeKey, columns = {}) {
  const regular = typeKey.replace('TARGET_TYPE', 'TARGET');
  if (Object.hasOwn(columns, regular)) return regular;
  if (typeKey === 'BUSY_TARGET_TYPE' && Object.hasOwn(columns, 'TARGET')) return 'TARGET';
  if (typeKey === 'BETWEEN_BOUNDS_TARGET_TYPE' && Object.hasOwn(columns, 'BETWEEN_BOUND_TARGET'))
    return 'BETWEEN_BOUND_TARGET';
  return regular;
}
export function routeTypeKey(key, columns) {
  return Object.keys(columns).find((k) => isRouteType(k) && routeTargetKey(k, columns) === key);
}
export function localReferenceTable(key, node) {
  if (
    /^INQUEUE_MENU_[1-4]$/.test(key) ||
    [
      'INQUEUE_REPEAT_MENU',
      'CONSENT_MENU',
      'RECORDING_CONSENT_MENU',
      'CONFIRMATION_ANI_MENU',
      'CONFIRMATION_DIAL_MENU',
    ].includes(key)
  )
    return 'W_MENU_v5';
  if (/^(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|HOLIDAY)_MENU$/.test(key))
    return 'W_MENU_CB_v5';
  if (key === 'SCHEDULE_KEY_CB') return 'W_SCHEDULE_FOR_CALLBACK_v5';
  return null;
}
export function v5FieldPolicy(node, key, value) {
  if (!isV5(node)) return null;
  const rule = node.schema?.properties?.[key];
  if (!rule) return null;
  const type =
    (Array.isArray(rule.type) ? rule.type.find((t) => t !== 'null') : rule.type) ||
    (value == null ? 'string' : typeof value);
  const columns = { ...node.schema.properties, ...node.row };
  const localTable = localReferenceTable(key, node),
    targetTypeKey = routeTypeKey(key, columns);
  const kind = isRouteType(key)
    ? 'route-type'
    : targetTypeKey
      ? 'route-target'
      : localTable
        ? 'local-reference'
        : /^PDATA_LIST_[1-5]$/.test(key)
          ? 'pdata'
          : /^(?:INQUEUE_)?SUBROUTINES_LIST(?:_[1-4])?$/.test(key)
            ? 'controls'
            : type === 'boolean'
              ? 'boolean'
              : ['integer', 'number'].includes(type)
                ? 'number'
                : ['array', 'object'].includes(type)
                  ? 'json'
                  : 'text';
  return {
    schema: rule,
    editable: !immutableV5Field(node, key) && !rule.readOnly,
    immutable: immutableV5Field(node, key),
    kind,
    localTable,
    targetTypeKey,
    options: Array.isArray(rule.enum) ? rule.enum : undefined,
  };
}
export function referenceOptions(tableName, snapshot) {
  const tables = (snapshot?.tables || []).filter(
    (t) => t.name.toUpperCase() === tableName?.toUpperCase(),
  );
  if (tables.length !== 1) return [];
  return tables[0].rows
    .map((row) => ({
      value: String(row.key),
      label:
        row.DESCRIPTION && row.DESCRIPTION !== row.key
          ? `${row.DESCRIPTION} · ${row.key}`
          : String(row.key),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' }));
}
const dynamic = (value) =>
  /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
const changed = (before, after, key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]);
export function validateV5Edits(
  node,
  row,
  { snapshot, fields = Object.keys(row).filter((k) => changed(node.row || {}, row, k)) } = {},
) {
  if (!isV5(node)) return;
  const columns = { ...node.schema?.properties, ...row },
    edits = new Set(fields);
  const checkReference = (table, key, label) => {
    if (!key || dynamic(key)) return;
    if (!snapshot) throw Error(`${label} : rechargez les tables V5 pour vérifier la référence.`);
    if (!referenceOptions(table, snapshot).some((o) => o.value === key))
      throw Error(`${label} : la référence « ${key} » est absente de ${table}.`);
  };
  for (const key of edits) {
    if (immutableV5Field(node, key))
      throw Error('La clé de cette configuration doit être conservée.');
    const value = row[key],
      policy = v5FieldPolicy(node, key, value);
    if (key === 'DIVISION' && !String(value ?? '').trim())
      throw Error('Choisissez une division Genesys.');
    if (policy?.schema.readOnly) throw Error(`${key} est en lecture seule dans le schéma Genesys.`);
    if (policy?.localTable) checkReference(policy.localTable, String(value ?? ''), key);
    if (policy?.kind === 'pdata' && value) {
      for (const pair of String(value).split('||')) {
        const at = pair.indexOf('==');
        if (at <= 0 || !pair.slice(0, at).trim())
          throw Error(`${key} : utilisez nom==valeur, avec || entre les attributs.`);
      }
    }
    if (policy?.kind === 'controls' && value) {
      const names = String(value).split(';');
      if (names.some((n) => !n.trim() || !/^\w+$/.test(n)))
        throw Error(`${key} : séparez les noms de contrôles par un point-virgule.`);
      if (/^INQUEUE_/.test(key) && names.some((n) => /^recording$/i.test(n)))
        throw Error('Le contrôle RECORDING n’est pas disponible dans l’attente WOLF V5.');
    }
    if (
      key === 'MENU_TIMEOUT' &&
      value !== '' &&
      value != null &&
      ![3, 5, 7, 10, 12].includes(Number(value))
    )
      throw Error('Le délai du menu V5 doit être de 3, 5, 7, 10 ou 12 secondes.');
    if (
      (/^RATIO[1-5]$/.test(key) ||
        ['LOWER_BOUND', 'UPPER_BOUND', 'NB_PROPOSAL_MAX'].includes(key)) &&
      value !== '' &&
      value != null &&
      (!Number.isFinite(Number(value)) || Number(value) < 0)
    )
      throw Error(`${key} doit être positif ou nul.`);
  }
  if (isV5Decision(node) && decisionFields.some((k) => edits.has(k)))
    validateDecision(row, { snapshot });
  if (
    ['LOWER_BOUND', 'UPPER_BOUND'].some((k) => edits.has(k)) &&
    row.LOWER_BOUND != null &&
    row.UPPER_BOUND != null &&
    Number(row.LOWER_BOUND) > Number(row.UPPER_BOUND)
  )
    throw Error('La borne basse ne peut pas dépasser la borne haute.');
  if (
    [...edits].some((k) => /^RATIO[1-5]$/.test(k)) &&
    !Object.keys(row).some((k) => /^RATIO[1-5]$/.test(k) && Number(row[k]) > 0)
  )
    throw Error('Renseignez au moins un poids de répartition supérieur à zéro.');
  for (const typeKey of Object.keys(columns).filter(isRouteType)) {
    const targetKey = routeTargetKey(typeKey, columns);
    if (!edits.has(typeKey) && !edits.has(targetKey)) continue;
    const [rawType, ...parameters] = String(row[typeKey] ?? '').split('|'),
      [target, ...extras] = String(row[targetKey] ?? '').split('|');
    const type = rawType.trim().toLowerCase();
    if (!type && !target) continue;
    if (!Object.hasOwn(routeTypeLabels, type))
      throw Error(`${typeKey} : type de destination WOLF V5 inconnu.`);
    if (parameters.some((p) => !/^\s*(sub|lang|status):.+$/i.test(p)))
      throw Error(`${typeKey} : paramètres attendus sub:, lang: ou status:.`);
    for (const extra of extras) {
      if (!/^pdata:.+/i.test(extra))
        throw Error(`${targetKey} : utilisez pdata: pour associer des attributs.`);
      for (const key of extra.slice(6).split(';'))
        checkReference('W_PARTICIPANT_DATA_v5', key, targetKey);
    }
    if (noTarget.has(type)) {
      if (target) throw Error(`${targetKey} : cette sortie ne prend pas de destination.`);
      continue;
    }
    if (!target) throw Error(`${targetKey} : renseignez une destination.`);
    if (targetTables[type]) checkReference(targetTables[type], target, targetKey);
    if (type === 'number' && !dynamic(target) && !/^\+?[0-9*#]+$/.test(target))
      throw Error('Renseignez un numéro de transfert valide.');
  }
}
