import { MESSAGE_LABELS, isMessageNode, messageEditorValue } from './media-profiles.js';
import { v5FieldPolicy, isEditableWolf as isV5 } from './v5-fields.js';
import {
  decisionFields,
  decisionOperators,
  decisionOperatorLabels,
  isWolfDecision as isV5Decision,
} from './decision-fields.js';
import { resourceForField } from './genesys-resources.js';
import { fieldLabel, isCopyableField, isIdentityField } from './draft-fields.js';
import { controlLabel } from './route-controls.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const text = (value) => (value === undefined || value === null ? '' : String(value));
const clone = (value) => structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const TYPE_TITLES = new Map(
  Object.entries({
    inboundcall: 'Accueil téléphonique',
    segment: 'Accueil de la conversation',
    quickreplies: 'Choix par boutons',
    carousel: 'Carrousel',
    card: 'Carte',
    waitforinput: 'Question ouverte',
    service: 'Équipe de traitement',
    schedulegroup: 'Horaires de disponibilité',
    menu: 'Choix proposés au client',
    decision: 'Règle d’orientation',
    ratiodistrib: 'Répartition des appels',
    pdata: 'Contexte client',
    recording: 'Enregistrement des appels',
    bot: 'Assistant vocal',
    transfercallflow: 'Transfert vers un autre parcours',
    callback: 'Rappel',
    inqueue: 'Pendant l’attente',
    next: 'Poursuite de l’attente',
    disconnect: 'Fin d’appel',
    number: 'Transfert téléphonique',
    user: 'Conseiller',
    queue: 'Mise en relation avec l’équipe',
    enable: 'Consentement accepté',
    disable: 'Consentement refusé',
    voicemailqueue: 'Messagerie de l’équipe',
    voicemailgroup: 'Messagerie du groupe',
    voicemailuser: 'Messagerie du conseiller',
  }),
);
const SECTIONS = new Map(
  Object.entries({
    inboundcall: 'accueil',
    segment: 'accueil',
    schedulegroup: 'horaires',
    menu: 'orientation',
    decision: 'orientation',
    ratiodistrib: 'orientation',
    bot: 'orientation',
    transfercallflow: 'orientation',
    service: 'equipes',
    pdata: 'contexte',
    recording: 'accueil',
    inqueue: 'attente',
    next: 'attente',
  }),
);
const BOOL_FIELDS = new Set([
  'ENABLE_RECORDING',
  'RECORDING_ENABLE',
  'BLOCK_ANI_CHECK',
  'INQUEUE_NOTLOGGEDIN_AGENT_CHECK',
  'INQUEUE_PIQ_EWT_PLAY_POSITION',
  'USE_CALLER_ANI',
  'ASK_FOR_ANI_WITH_COUNTRY_CODE',
]);
const NUMBER_FIELDS = new Set([
  'PRIORITY',
  'MENU_TIMEOUT',
  'MENU_REPEAT',
  'INQUEUE_REPEAT',
  'INQUEUE_HOLD_TIMEOUT_INIT',
  'BUSY_QUEUE_NUM',
  'MINIMUM_AGENT_REQUIRED',
  'INTERACTIONS_MAXIMUM',
  'RATIO_AGENT_VS_INTERACTION',
  'INQUEUE_PIQ_EWT_THRESHOLD',
  'COLLECT_MENU_TIMEOUT',
  'COLLECT_MENU_REPEAT',
  'COLLECT_SIZE',
]);
const REFERENCE_FIELDS = new Set([
  'QUEUE',
  'SKILLS',
  'LANGUAGE_SKILL',
  'DIRECT_USER',
  'SCHEDULE_GROUP',
  'EMERGENCY_GROUP',
  'EXCEPTIONAL_DAYS_NAME',
  'CONSENT_MENU',
  'RECORDING_CONSENT_MENU',
  'LANGUAGE',
  'INQUEUE_HOLD_MUSIC_INIT',
  'INQUEUE_REPEAT_MENU',
  'PARTICIPANT_DATA_TO_CHECK',
  'CALLBACK_QUEUE',
  'CONFIRMATION_ANI_MENU',
  'CONFIRMATION_DIAL_MENU',
  'FLOW_NAME',
  'BOT_NAME',
]);
const TEXT_FIELDS = new Set([
  'DESCRIPTION',
  'DECISION_OPERATOR',
  'DECISION_VALUE',
  'DECISION_TYPE',
  'DECISION_TARGET',
  'COUNTRY_CODE',
  'PRESENTATION_CALLER_NAME',
  'PRESENTATION_CALLER_ID',
]);
const AUDIO_FIELDS = new Set([
  'WELCOME_AUDIO',
  'MENU_AUDIO',
  'MENU_ERROR_AUDIO',
  'WHISPER_AUDIO',
  'AUDIO_RECORDING',
  'RECORDING_ANNOUNCE_AUDIO',
  'RECORDING_ANNOUNCE',
  'BUSY_QUEUE_AUDIO',
  'LOGGEDIN_AUDIO',
  'NOTLOGGEDIN_AUDIO',
  'INQUEUE_PIQ_EWT_AUDIO',
  'INQUEUE_REPEAT_AUDIO',
  'CALLBACK_VALIDATION_AUDIO',
  'COLLECT_MENU_AUDIO',
  'COLLECT_MENU_REPEAT_AUDIO',
]);
const isAudio = (key) =>
  AUDIO_FIELDS.has(key) ||
  /^INQUEUE_AUDIO_[1-4]$/.test(key) ||
  /^OPTION(?:[0-9]|STAR|DIEZ)_AUDIO$/.test(key) ||
  /^(?:OPEN|CLOSED|HOLIDAY|EMERGENCY|DEFAULT|NEXT|TRUE|FALSE|BYPASS|NOTLOGGEDIN|LOGGEDIN)_TARGET_AUDIO$/.test(
    key,
  );
const isLiteralTts = (value) =>
  typeof value === 'string' &&
  /^tts:\s*\S/i.test(value) &&
  !value.includes('|') &&
  !/\$?var:/i.test(value);
const nonempty = (value) => text(value).trim() !== '';
const paddedDynamicQueue = (value) =>
  text(value) !== text(value).trim() && /^variable$/i.test(text(value).trim());
const canonicalType = (type) => {
  const name = text(type).trim().toLowerCase();
  return name === 'standardcallflow'
    ? 'inboundcall'
    : name === 'customcallflow'
      ? 'transfercallflow'
      : name;
};
const isControlsField = (key) =>
  key === 'SUBROUTINES_LIST' || /^INQUEUE_SUBROUTINES_LIST_[1-4]$/.test(key);
function describeControls(value) {
  return (
    text(value)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((name) => controlLabel(name) || humanText(name))
      .join(' · ') || 'Aucun contrôle'
  );
}

function describeTargetType(value) {
  const [rawType, ...parameters] = text(value).split('|');
  const title =
    TYPE_TITLES.get(canonicalType(rawType)) ||
    (rawType.trim()
      ? `Type non reconnu « ${rawType.trim()} »`
      : 'Type de destination non renseigné');
  const details = parameters
    .filter((part) => part.trim())
    .map((part) => {
      const offset = part.indexOf(':');
      if (offset < 1) return `Paramètre non reconnu « ${part.trim()} »`;
      const name = part.slice(0, offset).trim(),
        content = part.slice(offset + 1).trim();
      if (name.toLowerCase() === 'sub') return `Contrôles : ${describeControls(content)}`;
      if (name.toLowerCase() === 'lang') return `Langue : ${describeValue('LANGUAGE', content)}`;
      if (name.toLowerCase() === 'status')
        return `Statut : ${humanText(content) || 'Non renseigné'}`;
      return `Paramètre non reconnu « ${name} » : ${humanText(content) || 'Non renseigné'}`;
    });
  return [title, ...details].join(' · ');
}

/** Readable presentation only. Original identifiers and values are never modified. */
export function humanText(value) {
  if (Array.isArray(value)) return value.map(humanText).filter(Boolean).join(' · ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return 'Valeur structurée';
  let result = String(value)
    .trim()
    .replace(/^\[DRAFT_FROM_[^\]]+\]\s*/i, '')
    .replace(/\s*\(template\)\s*$/i, '');
  const identifier =
    /^[\wÀ-ÿ\[\] .-]+$/.test(result) && /_|\[(?:ENTITE|SERVICE|template)\]/i.test(result);
  result = result
    .replace(/\[ENTITE\]/gi, 'Entité')
    .replace(/\[DIVISION\]/gi, 'Entité à définir')
    .replace(/\[SERVICE\]/gi, 'Service')
    .replace(/\[template\]/gi, 'Modèle');
  if (identifier) {
    result = result
      .replace(/(?:^|_)(?:ENTRYPOINT|ENTYPOINT|INBOUND_CALL|TEMPLATE|TPL)(?=_|$)/gi, '_')
      .replace(/_V\d+(?:\.\d+)?$/i, '')
      .replace(/^W_/, '')
      .replace(/_+/g, ' ')
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
    result = result
      .split(/\s+/)
      .filter(Boolean)
      .map((word) =>
        /^\p{Lu}{3,}$/u.test(word) ? word[0] + word.slice(1).toLocaleLowerCase('fr-FR') : word,
      )
      .join(' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

// Références statiques que la source ne permet pas de suivre : le parcours
// s'arrête à ces points. Les destinations dynamiques n'en font pas partie.
const BROKEN_REFERENCES = new Set([
  'missing-row',
  'missing-table',
  'ambiguous-table',
  'whitespace-key-mismatch',
  'missing-target',
]);
export function unresolvedReferences(flow) {
  return (flow?.issues || []).filter((issue) => BROKEN_REFERENCES.has(issue.code));
}

export function flowTitle(flow) {
  const description = flow?.description || flow?.sourceRow?.DESCRIPTION;
  if (
    /\[ENTITE\].*\[SERVICE\]/i.test(text(description)) &&
    /\[template\]|\(template\)/i.test(text(description))
  ) {
    const version = text(flow?.key || flow?.sourceRow?.key).match(/_V(\d+(?:\.\d+)?)$/i)?.[1];
    return `Parcours générique${version ? ` · version ${version}` : ''}`;
  }
  return (
    humanText(nonempty(description) ? description : flow?.name || flow?.key || flow?.dnis) ||
    'Parcours'
  );
}

export function nodeTitle(node) {
  if (!node) return 'Étape du parcours';
  const type = canonicalType(node.type);
  const description = node.row?.DESCRIPTION;
  // La clé d'un réglage d'enregistrement est une division : seule, elle ne dit pas ce qu'est le bloc.
  if (type === 'recording')
    return `${TYPE_TITLES.get(type)} · ${text(node.key) === 'Home' ? 'réglage par défaut' : humanText(node.key)}`;
  return (
    humanText(nonempty(description) ? description : node.name || node.key) ||
    TYPE_TITLES.get(type) ||
    'Étape du parcours'
  );
}

export function sectionForNode(node) {
  return SECTIONS.get(canonicalType(node?.type)) || 'orientation';
}

function sectionForField(key, node) {
  if (key === 'DESCRIPTION') return sectionForNode(node);
  if (
    key === 'WELCOME_AUDIO' ||
    key === 'LANGUAGE' ||
    key.includes('RECORDING') ||
    key === 'CONSENT_MENU' ||
    key === 'BLOCK_ANI_CHECK'
  )
    return 'accueil';
  if (
    ['SCHEDULE_GROUP', 'EMERGENCY_GROUP', 'EXCEPTIONAL_DAYS_NAME'].includes(key) ||
    /^(OPEN|CLOSED|HOLIDAY|EMERGENCY)_/.test(key)
  )
    return 'horaires';
  if (key.startsWith('INQUEUE_')) return 'attente';
  if (key.startsWith('MENU_') || key.startsWith('OPTION') || key.startsWith('COLLECT_'))
    return 'orientation';
  if (
    key.startsWith('PDATA_') ||
    key.startsWith('DECISION_') ||
    key === 'PARTICIPANT_DATA_TO_CHECK'
  )
    return 'contexte';
  if (
    [
      'QUEUE',
      'SKILLS',
      'LANGUAGE_SKILL',
      'DIRECT_USER',
      'PRIORITY',
      'WHISPER_AUDIO',
      'CALLBACK_QUEUE',
    ].includes(key) ||
    /^(BUSY|LOGGEDIN|NOTLOGGEDIN|MINIMUM_AGENT|INTERACTIONS|RATIO_AGENT)/.test(key)
  )
    return 'equipes';
  return sectionForNode(node);
}

export function describeValue(field, value) {
  const key = typeof field === 'string' ? field.toUpperCase() : text(field?.key).toUpperCase();
  if (value === undefined || value === null || value === '') return 'Non renseigné';
  if (typeof value === 'boolean' || (BOOL_FIELDS.has(key) && /^(true|false)$/i.test(text(value))))
    return value === true || /^true$/i.test(text(value)) ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.map(humanText).join(' · ') || 'Aucun';
  if (typeof value === 'object') return 'Valeur structurée';
  if (/(?:^|_)TARGET_TYPE(?:_[0-9]+)?$/.test(key)) return describeTargetType(value);
  if (key === 'QUEUE' && paddedDynamicQueue(value))
    return 'File à vérifier · espaces dans la valeur';
  if (key === 'QUEUE' && /^variable$/i.test(text(value))) return 'File choisie pendant l’appel';
  if (isControlsField(key)) return describeControls(value);
  if (isAudio(key)) {
    return text(value)
      .split('|')
      .filter(Boolean)
      .map((part) => {
        if (/^tts:/i.test(part)) return part.slice(4).trim() || 'Texte à renseigner';
        if (/^(pr|prompt):/i.test(part))
          return `Enregistrement « ${humanText(part.replace(/^(pr|prompt):/i, '')) || 'sans libellé'} »`;
        if (/^var:/i.test(part)) return `Information client « ${humanText(part.slice(4))} »`;
        if (/^(barg|edge):/i.test(part)) return 'Option de lecture';
        return humanText(part);
      })
      .join(' · ');
  }
  if (/^PDATA_LIST_[1-5]$/.test(key))
    return text(value)
      .split('||')
      .filter(Boolean)
      .map((pair) => {
        const offset = pair.indexOf('==');
        return offset < 0
          ? humanText(pair)
          : `${humanText(pair.slice(0, offset))} : ${humanText(pair.slice(offset + 2))}`;
      })
      .join(' · ');
  if (key === 'LANGUAGE')
    return (
      new Map([
        ['fr-fr', 'Français'],
        ['en-us', 'Anglais (États-Unis)'],
        ['en-gb', 'Anglais (Royaume-Uni)'],
      ]).get(text(value).toLowerCase()) || humanText(value)
    );
  if (key === 'SKILLS') return text(value).split(';').filter(Boolean).map(humanText).join(' · ');
  if (key.includes('TIMEOUT') && /^\d+(?:\.\d+)?$/.test(text(value))) return `${value} s`;
  return humanText(value) || 'Non renseigné';
}

/** Source anomalies are shown without repairing or interpreting runtime data. */
export function nodeConfigurationNotes(node) {
  const notes = [];
  for (const [field, raw] of Object.entries(node?.row || {})) {
    if (field.toUpperCase() === 'QUEUE' && paddedDynamicQueue(raw))
      notes.push({
        message:
          'La destination contient des espaces autour du mot « variable ». Son interprétation est à vérifier.',
        detail: JSON.stringify(raw),
      });
    if (/(?:^|_)TARGET_TYPE(?:_[0-9]+)?$/i.test(field) && /\|satus:/i.test(text(raw)))
      notes.push({
        message: 'Un paramètre de la transition semble mal orthographié.',
        detail: `${field} : ${JSON.stringify(raw)} · « satus » non reconnu par le Studio.`,
      });
  }
  return notes;
}

/** V5 settings follow the loaded schema; older sources retain conservative editors. */
export function businessFields(node) {
  const row = node?.row || {};
  return [
    ...new Set([
      ...Object.keys(row),
      ...(isV5(node) ? Object.keys(node.schema?.properties || {}) : []),
    ]),
  ].flatMap((key) => {
    const value = row[key],
      policy = v5FieldPolicy(node, key, value);
    const name = key.toUpperCase();
    const resource =
      policy && (policy.immutable || policy.schema.readOnly) ? null : resourceForField(key, node);
    const decision = isV5Decision(node) && decisionFields.includes(name);
    const audio = isAudio(name) || Boolean(resource?.audio);
    const number =
      NUMBER_FIELDS.has(name) ||
      /^INQUEUE_HOLD_TIMEOUT_[1-4]$/.test(name) ||
      /^RATIO_?[1-9][0-9]?$/.test(name);
    const controls = isControlsField(name);
    const reference =
      Boolean(resource) ||
      (!decision && REFERENCE_FIELDS.has(name)) ||
      /^INQUEUE_(?:HOLD_MUSIC|MENU)_[1-4]$/.test(name) ||
      controls;
    const context = /^PDATA_LIST_[1-5]$/.test(name);
    if (
      !(
        policy ||
        decision ||
        audio ||
        number ||
        reference ||
        context ||
        BOOL_FIELDS.has(name) ||
        TEXT_FIELDS.has(name)
      )
    )
      return [];
    // Stable row identities remain hidden; schema-backed settings can be edited.
    if (
      policy?.immutable ||
      (!policy &&
        (name === 'DIVISION' ||
          (isIdentityField(name) && !['FLOW_NAME', 'BOT_NAME'].includes(name))))
    )
      return [];
    const editable = policy
      ? policy.editable && !resource
      : decision ||
        name === 'DESCRIPTION' ||
        (audio && (!nonempty(value) || isLiteralTts(value))) ||
        (number &&
          (typeof value === 'number' || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text(value)))) ||
        (BOOL_FIELDS.has(name) &&
          (typeof value === 'boolean' || /^(true|false)$/i.test(text(value))));
    const kind = audio
      ? 'audio'
      : policy && policy.kind !== 'text'
        ? policy.kind
        : BOOL_FIELDS.has(name)
          ? 'boolean'
          : number
            ? 'number'
            : context || name === 'SKILLS' || controls
              ? 'list'
              : reference
                ? 'reference'
                : 'text';
    return [
      {
        key,
        resource,
        ...(policy
          ? {
              schema: policy.schema,
              localTable: policy.localTable,
              targetTypeKey: policy.targetTypeKey,
              options: policy.options,
              required: (node.schema?.required || []).includes(key) || key === 'DIVISION',
            }
          : {}),
        ...(decision && name === 'DECISION_OPERATOR'
          ? { options: decisionOperators, optionLabels: decisionOperatorLabels }
          : {}),
        editorValue:
          name === 'DESCRIPTION'
            ? isMessageNode(node) && node.type === 'card'
              ? value
              : nodeTitle(node)
            : undefined,
        label:
          name === 'DESCRIPTION'
            ? isMessageNode(node) && node.type === 'card'
              ? 'Texte de la carte affiché au client'
              : 'Nom du parcours ou de l’étape'
            : name === 'SUBROUTINES_LIST'
              ? 'Contrôles automatiques au démarrage'
              : fieldLabel(name),
        section: sectionForField(name, node),
        value: clone(value),
        display:
          kind === 'message'
            ? messageEditorValue(value)
            : isMessageNode(node) && kind === 'route-type'
              ? MESSAGE_LABELS[String(value || '').split('|')[0]] || describeValue(name, value)
              : decision && name === 'DECISION_OPERATOR'
                ? decisionOperatorLabels[value] || describeValue(name, value)
                : describeValue(name, value),
        editable: Boolean(editable),
        copyable: name !== 'DESCRIPTION' && name !== 'MENU_AUDIO' && isCopyableField(name, value),
        kind,
      },
    ];
  });
}

export function branchLabel(edge) {
  if (edge?.relationship === 'context')
    return edge.type === 'recording' ? 'Enregistrement de l’appel' : 'Contexte transmis';
  let branch = text(edge?.branch).toUpperCase();
  if (!branch && edge?.field)
    branch = text(edge.field)
      .replace(/_TARGET_TYPE$/i, '')
      .toUpperCase();
  const option = branch.match(/^OPTION([0-9]|STAR|DIEZ)$/);
  if (option)
    return `Choix ${option[1] === 'STAR' ? 'étoile (*)' : option[1] === 'DIEZ' ? 'dièse (#)' : option[1]}`;
  const labels = new Map([
    ['NEXT', 'Puis'],
    ['DEFAULT', 'Sinon'],
    ['OPEN', 'Pendant l’ouverture'],
    ['CLOSED', 'En dehors des horaires'],
    ['HOLIDAY', 'Pendant les vacances'],
    ['EMERGENCY', 'En situation d’urgence'],
    ['TRUE', 'Si la condition est remplie'],
    ['FALSE', 'Sinon'],
    ['BYPASS', 'Si cette étape est contournée'],
    ['INQUEUE', 'Après l’attente'],
    ['NO_MATCH', 'Sans résultat du bot'],
    ['NOMATCH', 'Réponse non reconnue'],
    ['NOINPUT', 'Sans réponse du client'],
    ['NO_INPUT', 'Sans réponse au bot'],
    ['LOWER_BOUND', 'Sous la borne basse'],
    ['BETWEEN_BOUND', 'Entre les bornes'],
    ['BETWEEN_BOUNDS', 'Entre les bornes'],
    ['UPPER_BOUND', 'Au-dessus de la borne haute'],
  ]);
  if (labels.has(branch)) return labels.get(branch);
  if (/^(?:RATIO_?|TARGET_TYPE_)[0-9]+$/.test(branch))
    return `Répartition ${branch.match(/[0-9]+$/)[0]}`;
  return humanText(edge?.label || branch) || 'Suite du parcours';
}

const BRANCH_FIRST = [
  'NEXT',
  'OPEN',
  'CLOSED',
  'HOLIDAY',
  'EMERGENCY',
  'TRUE',
  'FALSE',
  'LOGGEDIN',
  'NOTLOGGEDIN',
  'NOT_BUSY',
  'BUSY',
  'BUSY_QUEUE',
];
const BRANCH_LAST = ['INQUEUE', 'DEFAULT', 'BYPASS'];
/** Ordre de lecture d'un appel : la suite normale, les choix du menu, puis l'attente et les replis. */
export function branchRank(branch = '') {
  const option = /^OPTION(\d|STAR|DIEZ)$/.exec(branch);
  if (option)
    return 20 + (option[1] === 'STAR' ? 10 : option[1] === 'DIEZ' ? 11 : Number(option[1]));
  if (BRANCH_FIRST.includes(branch)) return BRANCH_FIRST.indexOf(branch);
  return BRANCH_LAST.includes(branch) ? 70 + BRANCH_LAST.indexOf(branch) : 60;
}

export function flowRoutes(flow) {
  const nodes = new Map((flow?.nodes || []).map((node) => [node.id, node]));
  return (flow?.edges || []).map((edge, index) => {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    const type = canonicalType(edge.type);
    const dynamicTitle =
      type === 'queue' && /^variable$/i.test(text(edge.target))
        ? 'File choisie pendant l’appel'
        : 'Destination déterminée pendant l’appel';
    let toTitle = to
      ? nodeTitle(to)
      : edge.dynamic
        ? dynamicTitle
        : edge.terminal
          ? (flow.media === 'messaging' ? MESSAGE_LABELS[type] : TYPE_TITLES.get(type)) ||
            'Fin de cette branche'
          : 'Destination à vérifier';
    if (!edge.dynamic && edge.terminal && type === 'number' && nonempty(edge.target))
      toTitle = `Transfert vers ${humanText(edge.target)}`;
    if (!edge.dynamic && edge.terminal && type === 'queue' && nonempty(edge.target))
      toTitle = `Équipe · ${humanText(edge.target)}`;
    if (type === 'queue' && paddedDynamicQueue(edge.target)) toTitle = 'File à vérifier';
    return {
      id: `${text(flow?.id)}:route:${index}`,
      fromId: edge.from,
      toId: edge.to || null,
      fromTitle: nodeTitle(from),
      toTitle,
      label: branchLabel(edge),
      section: sectionForNode(from),
      resolved: Boolean(edge.resolved),
      terminal: Boolean(edge.terminal),
      dynamic: Boolean(edge.dynamic),
      relationship: edge.relationship || 'route',
      edge,
    };
  });
}

function entryNode(flow) {
  return (
    (flow?.nodes || []).find((node) => node.id === flow.id) ||
    (flow?.nodes || []).find((node) => canonicalType(node.type) === 'inboundcall') ||
    null
  );
}

function graphPaths(flow) {
  const entry = entryNode(flow),
    paths = new Map();
  if (!entry) return paths;
  const nodes = new Map((flow.nodes || []).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of flow.edges || [])
    if (edge.to && nodes.has(edge.to)) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push(edge);
    }
  const queue = [{ id: entry.id, path: 'accueil', visited: new Set() }];
  let processed = 0;
  while (queue.length && processed++ < 3000) {
    const current = queue.shift();
    if (current.visited.has(current.id) || current.visited.size > 30) continue;
    if (!paths.has(current.id)) paths.set(current.id, new Set());
    paths.get(current.id).add(current.path);
    const visited = new Set(current.visited).add(current.id);
    for (const edge of outgoing.get(current.id) || []) {
      const branch =
        edge.relationship === 'context'
          ? `contexte:${text(edge.field || edge.destinationField || edge.label).toUpperCase()}`
          : text(edge.branch || edge.field || edge.label).toUpperCase();
      queue.push({
        id: edge.to,
        path: `${current.path}/${branch}:${canonicalType(nodes.get(edge.to).type)}`,
        visited,
      });
    }
  }
  return paths;
}

// Comparison fallback for older inventories that omit service exit edges.
// Existing inventory relationships win; this never creates unconditional UI paths.
function comparisonEdges(flow) {
  const existing = [...(flow?.edges || [])];
  const nodes = flow?.nodes || [];
  for (const node of nodes) {
    const row = node.row || {};
    const fields = Object.keys(row).filter((key) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(key));
    if (
      canonicalType(node.type) === 'service' &&
      own(row, 'INQUEUE_TARGET') &&
      !own(row, 'INQUEUE_TARGET_TYPE')
    )
      fields.push('INQUEUE_TARGET_TYPE');
    for (const field of fields) {
      if (existing.some((edge) => edge.from === node.id && edge.field === field)) continue;
      const rawType = text(row[field]);
      const destinationField = field.replace('TARGET_TYPE', 'TARGET');
      const rawTarget = text(row[destinationField]);
      if (!nonempty(rawType) && !nonempty(rawTarget)) continue;
      const [typeName, ...parameters] = rawType.split('|');
      const type = canonicalType(typeName.trim());
      const target = rawTarget.split('|')[0];
      const dynamic =
        /^variable$/i.test(target) || /^var:/i.test(target) || /\$var:[^$]+\$/i.test(target);
      const terminal = new Set([
        'disconnect',
        'number',
        'user',
        'voicemailqueue',
        'voicemailgroup',
        'voicemailuser',
        'next',
      ]).has(type);
      const possible = nodes.filter(
        (candidate) => canonicalType(candidate.type) === type && text(candidate.key) === target,
      );
      const numbered = field.match(/^TARGET_TYPE_(\d+)$/);
      const branch = numbered
        ? `RATIO${numbered[1]}`
        : field === 'TARGET_TYPE'
          ? ''
          : field.slice(0, -12);
      existing.push({
        from: node.id,
        to: possible.length === 1 ? possible[0].id : null,
        field,
        destinationField,
        rawType,
        rawTarget,
        type,
        target,
        parameters,
        branch,
        relationship: 'route',
        terminal,
        dynamic,
        resolved: terminal || possible.length === 1,
        comparisonOnly: true,
      });
    }
  }
  return existing;
}

function routeModifiers(edge) {
  const result = new Map();
  const values = Array.isArray(edge.parameters)
    ? edge.parameters
    : text(edge.rawType).split('|').slice(1);
  for (const value of values) {
    const index = text(value).indexOf(':');
    const key = index < 0 ? 'custom' : text(value).slice(0, index).toLowerCase();
    const content = index < 0 ? text(value) : text(value).slice(index + 1);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(content);
  }
  return result;
}

function modifierDisplay(key, values) {
  if (!values.length)
    return key === 'lang'
      ? 'Langue du parcours conservée'
      : key === 'sub'
        ? 'Aucun contrôle supplémentaire'
        : 'Aucune option supplémentaire';
  return values
    .map((value) =>
      key === 'lang'
        ? describeValue('LANGUAGE', value)
        : key === 'sub'
          ? describeControls(value)
          : humanText(value),
    )
    .join(' · ');
}

/**
 * Differences are paired using declared mappings, entry identity, shared rows,
 * identical sets of graph paths, an uncontested shared path, then unique node types. Ambiguous repetitions are never matched by array order.
 * Copy permission additionally requires an identical table family/version and
 * a field present in both rows. Labels and identifiers are never copyable.
 *
 * options.seedMatches: explicit [leftNodeId, rightNodeId] pairs (a declared
 * reference↔declination mapping). They win over every heuristic; a pair naming
 * an unknown node, two different step types or an already paired node is ignored.
 * options.exact: pair only the seeds (used to compare two flows through a
 * correspondence already established elsewhere).
 * Every item carries `slot`, a pairing-independent name of what differs on its
 * step (field:…, route:…, modifier:…), so analyses can be joined across diffs.
 */
export function compareFlows(left, right, options = {}) {
  const leftNodes = left?.nodes || [],
    rightNodes = right?.nodes || [];
  const remainingLeft = new Map(leftNodes.map((node) => [node.id, node]));
  const remainingRight = new Map(rightNodes.map((node) => [node.id, node]));
  const matches = [],
    items = [],
    unmatched = [],
    ambiguous = [];
  const pair = (leftNode, rightNode, reason) => {
    matches.push({ leftNode, rightNode, reason });
    remainingLeft.delete(leftNode.id);
    remainingRight.delete(rightNode.id);
  };
  for (const seed of options.seedMatches || []) {
    const leftNode = remainingLeft.get(seed?.[0]),
      rightNode = remainingRight.get(seed?.[1]);
    if (leftNode && rightNode && canonicalType(leftNode.type) === canonicalType(rightNode.type))
      pair(leftNode, rightNode, 'declared');
  }
  const heuristics = !options.exact;
  const leftEntry = entryNode(left),
    rightEntry = entryNode(right);
  if (
    heuristics &&
    leftEntry &&
    rightEntry &&
    remainingLeft.has(leftEntry.id) &&
    remainingRight.has(rightEntry.id)
  )
    pair(leftEntry, rightEntry, 'entry');
  if (heuristics)
    for (const node of [...remainingLeft.values()]) {
      const other = remainingRight.get(node.id);
      if (other && canonicalType(node.type) === canonicalType(other.type))
        pair(node, other, 'shared-row');
    }
  const leftPaths = heuristics ? graphPaths(left) : new Map(),
    rightPaths = heuristics ? graphPaths(right) : new Map();
  const signature = (node, paths) => {
    const list = [...(paths.get(node.id) || [])].sort();
    return list.length ? `${canonicalType(node.type)}:${list.join('||')}` : null;
  };
  const groups = (nodes, fn) => {
    const result = new Map();
    for (const node of nodes) {
      const key = fn(node);
      if (!key) continue;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(node);
    }
    return result;
  };
  const leftByPath = groups(remainingLeft.values(), (node) => signature(node, leftPaths));
  const rightByPath = groups(remainingRight.values(), (node) => signature(node, rightPaths));
  for (const [path, nodes] of leftByPath)
    if (nodes.length === 1 && rightByPath.get(path)?.length === 1)
      pair(nodes[0], rightByPath.get(path)[0], 'branch-path');
  // A re-pointed branch changes a step's set of paths without changing the step
  // (a menu default now reaching the other team). A step whose only same-type
  // candidate sharing a branch path is X is paired with X, provided no other
  // step claims X the same way; a new pair may lift the next ambiguity. Two
  // steps claiming one counterpart (a merge) stay unpaired: never by order.
  if (heuristics)
    for (let paired = true; paired; ) {
      paired = false;
      const sharing = (node, paths, others, otherPaths) =>
        [...others.values()].filter(
          (other) =>
            canonicalType(other.type) === canonicalType(node.type) &&
            [...(paths.get(node.id) || [])].some((path) => otherPaths.get(other.id)?.has(path)),
        );
      const claims = (nodes, paths, others, otherPaths) => {
        const result = new Map();
        for (const node of nodes.values()) {
          const candidates = sharing(node, paths, others, otherPaths);
          if (candidates.length === 1) {
            if (!result.has(candidates[0].id)) result.set(candidates[0].id, []);
            result.get(candidates[0].id).push(node);
          }
        }
        return result;
      };
      for (const [rightId, claimants] of claims(
        remainingLeft,
        leftPaths,
        remainingRight,
        rightPaths,
      ))
        if (
          claimants.length === 1 &&
          remainingLeft.has(claimants[0].id) &&
          remainingRight.has(rightId)
        ) {
          pair(claimants[0], remainingRight.get(rightId), 'shared-path');
          paired = true;
        }
      for (const [leftId, claimants] of claims(
        remainingRight,
        rightPaths,
        remainingLeft,
        leftPaths,
      ))
        if (
          claimants.length === 1 &&
          remainingRight.has(claimants[0].id) &&
          remainingLeft.has(leftId)
        ) {
          pair(remainingLeft.get(leftId), claimants[0], 'shared-path');
          paired = true;
        }
    }
  const leftByType = groups(remainingLeft.values(), (node) => canonicalType(node.type));
  const rightByType = groups(remainingRight.values(), (node) => canonicalType(node.type));
  if (heuristics)
    for (const [type, nodes] of leftByType)
      if (nodes.length === 1 && rightByType.get(type)?.length === 1)
        pair(nodes[0], rightByType.get(type)[0], 'unique-type');

  for (const { leftNode, rightNode } of matches) {
    const fieldsLeft = new Map(
      businessFields(leftNode)
        .filter((f) => !['route-type', 'route-target'].includes(f.kind) && f.key !== 'DIVISION')
        .map((field) => [field.key, field]),
    );
    const fieldsRight = new Map(
      businessFields(rightNode)
        .filter((f) => !['route-type', 'route-target'].includes(f.kind) && f.key !== 'DIVISION')
        .map((field) => [field.key, field]),
    );
    for (const key of new Set([...fieldsLeft.keys(), ...fieldsRight.keys()])) {
      if (key.toUpperCase() === 'DESCRIPTION') continue;
      const a = fieldsLeft.get(key),
        b = fieldsRight.get(key);
      const before = a?.value,
        after = b?.value;
      if (equal(before, after)) continue;
      const field = a || b;
      const compatibleRows =
        text(leftNode.tableName).toUpperCase() === text(rightNode.tableName).toUpperCase();
      items.push({
        id: `${leftNode.id}|${rightNode.id}|${key}`,
        slot: `field:${key}`,
        section: field.section,
        label: field.label,
        before: clone(before),
        after: clone(after),
        beforeDisplay: a?.display || 'Absent de ce parcours',
        afterDisplay: b?.display || 'Absent de ce parcours',
        leftNode,
        rightNode,
        field: key,
        copyable: Boolean(
          a &&
            b &&
            compatibleRows &&
            a.copyable &&
            b.editable &&
            own(leftNode.row, key) &&
            own(rightNode.row, key),
        ),
      });
    }
  }
  // The core is the whole journey. Compare branch relationships as well as
  // parameters, using paired destination nodes rather than entity-specific IDs.
  const matchedDestinations = new Map(
    matches.map((match) => [match.leftNode.id, match.rightNode.id]),
  );
  const leftNodeMap = new Map(leftNodes.map((node) => [node.id, node]));
  const rightNodeMap = new Map(rightNodes.map((node) => [node.id, node]));
  const routeSlot = (edge) =>
    `${edge.relationship || 'route'}:${text(edge.branch || edge.field || edge.label).toUpperCase()}`;
  const leftEdges = comparisonEdges(left),
    rightEdges = comparisonEdges(right);
  const routeGroups = (edges, nodeId) => {
    const result = new Map();
    for (const edge of edges) {
      if (edge.from !== nodeId) continue;
      const slot = routeSlot(edge);
      if (!result.has(slot)) result.set(slot, []);
      result.get(slot).push(edge);
    }
    return result;
  };
  const routeSignature = (edge, side) => {
    const relationship = edge.relationship || 'route';
    if (edge.to)
      return `${relationship}:${side === 'left' ? (matchedDestinations.has(edge.to) ? `paired:${matchedDestinations.get(edge.to)}` : `unmatched-left:${edge.to}`) : `paired:${edge.to}`}`;
    return `${relationship}:${edge.dynamic ? 'dynamic' : edge.terminal ? 'terminal' : 'unresolved'}:${canonicalType(edge.type)}:${text(edge.rawTarget || edge.target)}`;
  };
  const routeDescription = (edge, nodeMap) => {
    if (edge.dynamic) return 'Destination déterminée pendant l’appel';
    const target = nodeMap.get(edge.to);
    if (target)
      return `${TYPE_TITLES.get(canonicalType(target.type)) || 'Étape du parcours'} · ${nodeTitle(target)}`;
    if (edge.terminal && canonicalType(edge.type) === 'queue' && nonempty(edge.target))
      return `Équipe · ${humanText(edge.target)}`;
    if (edge.terminal)
      return canonicalType(edge.type) === 'number' && nonempty(edge.target)
        ? `Transfert vers ${humanText(edge.target)}`
        : TYPE_TITLES.get(canonicalType(edge.type)) || 'Fin de cette branche';
    return `Destination à vérifier${nonempty(edge.target) ? ` · ${humanText(edge.target)}` : ''}`;
  };
  for (const { leftNode, rightNode } of matches) {
    const a = routeGroups(leftEdges, leftNode.id),
      b = routeGroups(rightEdges, rightNode.id);
    for (const slot of new Set([...a.keys(), ...b.keys()])) {
      const beforeEdges = a.get(slot) || [],
        afterEdges = b.get(slot) || [];
      const beforeSignature = beforeEdges.map((edge) => routeSignature(edge, 'left')).sort();
      const afterSignature = afterEdges.map((edge) => routeSignature(edge, 'right')).sort();
      const sample = beforeEdges[0] || afterEdges[0];
      const section =
        sample.relationship === 'context'
          ? 'contexte'
          : sample.phase === 'waiting' || sample.branch === 'INQUEUE'
            ? 'attente'
            : sample.phase === 'distribution'
              ? 'equipes'
              : 'orientation';
      const resourceAlreadyCompared =
        sample.field === 'QUEUE' &&
        items.some(
          (item) =>
            item.leftNode.id === leftNode.id &&
            item.rightNode.id === rightNode.id &&
            item.field === 'QUEUE',
        );
      if (!equal(beforeSignature, afterSignature) && !resourceAlreadyCompared) {
        const before =
          beforeEdges.map((edge) => routeDescription(edge, leftNodeMap)).join(' · ') ||
          'Branche absente';
        const after =
          afterEdges.map((edge) => routeDescription(edge, rightNodeMap)).join(' · ') ||
          'Branche absente';
        items.push({
          id: `${leftNode.id}|${rightNode.id}|route:${slot}`,
          slot: `route:${slot}`,
          section,
          label: `${nodeTitle(leftNode)} · ${branchLabel(sample)}`,
          before,
          after,
          beforeDisplay: before,
          afterDisplay: after,
          leftNode,
          rightNode,
          field: null,
          copyable: false,
          structural: true,
          beforeEdges: clone(beforeEdges),
          afterEdges: clone(afterEdges),
        });
      }
      const mergeModifiers = (edges) => {
        const result = new Map();
        for (const edge of edges)
          for (const [key, values] of routeModifiers(edge)) {
            if (!result.has(key)) result.set(key, []);
            result.get(key).push(...values);
          }
        return result;
      };
      const modifiersBefore = mergeModifiers(beforeEdges),
        modifiersAfter = mergeModifiers(afterEdges);
      for (const key of new Set([...modifiersBefore.keys(), ...modifiersAfter.keys()])) {
        const before = modifiersBefore.get(key) || [],
          after = modifiersAfter.get(key) || [];
        if (equal(before, after)) continue;
        const label =
          key === 'lang'
            ? 'Langue appliquée'
            : key === 'sub'
              ? 'Contrôles automatiques'
              : 'Option complémentaire';
        items.push({
          id: `${leftNode.id}|${rightNode.id}|modifier:${slot}:${key}`,
          slot: `modifier:${slot}:${key}`,
          section,
          label: `${branchLabel(sample)} · ${label}`,
          before: clone(before),
          after: clone(after),
          beforeDisplay: modifierDisplay(key, before),
          afterDisplay: modifierDisplay(key, after),
          leftNode,
          rightNode,
          field: null,
          copyable: false,
          structural: true,
          modifier: true,
          modifierKey: key,
          beforeEdges: clone(beforeEdges),
          afterEdges: clone(afterEdges),
        });
      }
    }
  }
  const leftoverLeft = groups(remainingLeft.values(), (node) => canonicalType(node.type));
  const leftoverRight = groups(remainingRight.values(), (node) => canonicalType(node.type));
  for (const type of new Set([...leftoverLeft.keys(), ...leftoverRight.keys()])) {
    const a = leftoverLeft.get(type) || [],
      b = leftoverRight.get(type) || [];
    if (a.length && b.length)
      ambiguous.push({
        type,
        section: sectionForNode(a[0]),
        label: TYPE_TITLES.get(type) || 'Étapes à rapprocher',
        leftNodes: a,
        rightNodes: b,
      });
    else
      for (const [side, nodes] of [
        ['left', a],
        ['right', b],
      ])
        for (const node of nodes)
          unmatched.push({ side, node, section: sectionForNode(node), label: nodeTitle(node) });
  }
  return { items, unmatched, ambiguous, matches };
}
