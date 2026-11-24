/** Business labels and conservative helpers for local WOLF draft editing. */
const LABELS = new Map(
  Object.entries({
    key: 'Clé de la ligne',
    DNIS_SEGMENT: 'Numéro ou point d’entrée',
    DESCRIPTION: 'Description métier',
    DIVISION: 'Division Genesys',
    LANGUAGE: 'Langue du parcours',
    SUBROUTINES_LIST: 'Contrôles au démarrage',
    WELCOME_AUDIO: 'Message d’accueil',
    SERVICE: 'Clé du service',
    QUEUE: 'File de destination',
    SKILLS: 'Compétences métier',
    LANGUAGE_SKILL: 'Compétence linguistique',
    PRIORITY: 'Priorité de distribution',
    WHISPER_AUDIO: 'Message au conseiller',
    DIRECT_USER: 'Conseiller direct',
    PDATA_NAME: 'Clé du contexte client',
    MENU_NAME: 'Clé du menu vocal',
    MENU_AUDIO: 'Annonce du menu vocal',
    MENU_TIMEOUT: 'Délai de saisie du menu',
    MENU_REPEAT: 'Nombre de répétitions du menu',
    MENU_ERROR_AUDIO: 'Message de saisie incorrecte',
    SCHEDULE_GROUP_KEY: 'Clé de la règle horaire',
    SCHEDULEGROUP_FOR_CALLBACK: 'Calendrier des rappels',
    SCHEDULE_GROUP: 'Calendrier Genesys',
    EMERGENCY_GROUP: 'Calendrier d’urgence',
    DIVISION_NAME: 'Clé de la division',
    ENABLE_RECORDING: 'Enregistrement autorisé',
    AUDIO_RECORDING: 'Annonce d’enregistrement',
    CONSENT_MENU: 'Menu de consentement',
    RATIO_NAME: 'Clé de répartition',
    DECISION_NAME: 'Clé de décision',
    RECORDING_ENABLE: 'Enregistrement autorisé',
    RECORDING_ANNOUNCE_AUDIO: 'Annonce d’enregistrement',
    RECORDING_ANNOUNCE: 'Annonce d’enregistrement',
    RECORDING_CONSENT_MENU: 'Menu de consentement à l’enregistrement',
    RECORDING_CONSENT: 'Consentement à l’enregistrement',
    BLOCK_ANI_CHECK: 'Vérifier le numéro appelant dans la liste de blocage',
    EXCEPTIONAL_DAYS_NAME: 'Calendrier des jours exceptionnels',
    BUSY_QUEUE_NUM: 'Seuil de charge de la file',
    BUSY_QUEUE_AUDIO: 'Message en cas de saturation',
    NOTLOGGEDIN_AUDIO: 'Message sans conseiller connecté',
    LOGGEDIN_AUDIO: 'Message avec conseiller connecté',
    INQUEUE_NOTLOGGEDIN_AGENT_CHECK: 'Vérifier les conseillers connectés pendant l’attente',
    INQUEUE_PIQ_EWT_AUDIO: 'Annonce de position ou de temps d’attente',
    INQUEUE_PIQ_EWT_PLAY_POSITION: 'Annoncer la position dans la file',
    INQUEUE_PIQ_EWT_POSITION: 'Paramètre de position dans la file',
    INQUEUE_PIQ_EWT_THRESHOLD: 'Seuil d’annonce de l’attente',
    INQUEUE_REPEAT_AUDIO: 'Message du cycle d’attente',
    INQUEUE_REPEAT_MENU: 'Menu du cycle d’attente',
    PARTICIPANT_DATA_TO_CHECK: 'Attribut client à évaluer',
    DECISION_OPERATOR: 'Opérateur de comparaison',
    DECISION_VALUE: 'Valeur de comparaison',
    DECISION_TYPE: 'Type de condition',
    DECISION_TARGET: 'Paramètre de condition',
    INTERACTIONS_MAXIMUM: 'Nombre maximal d’interactions',
    RATIO_AGENT_VS_INTERACTION: 'Ratio conseillers et interactions',
    MINIMUM_AGENT_REQUIRED: 'Nombre minimal de conseillers',
    STATUS: 'Statut des conseillers à contrôler',
    FLOW_NAME: 'Flow de transfert',
    BOT_NAME: 'Bot vocal',
    ID_BOT: 'Bot utilisé',
    TARGET_MESSAGE_AUDIO: 'Message avant la destination',
    CALLBACK_QUEUE: 'File de rappel',
    CALLBACK_VALIDATION_AUDIO: 'Confirmation du rappel',
    ASK_FOR_ANI_WITH_COUNTRY_CODE: 'Demander le numéro avec indicatif pays',
    COUNTRY_CODE: 'Indicatif pays',
    USE_CALLER_ANI: 'Réutiliser le numéro appelant',
    COLLECT_MENU_AUDIO: 'Annonce de collecte du numéro',
    COLLECT_MENU_REPEAT: 'Répétitions de la collecte',
    COLLECT_MENU_REPEAT_AUDIO: 'Annonce de nouvelle saisie',
    COLLECT_MENU_TIMEOUT: 'Délai de saisie du numéro',
    COLLECT_SIZE: 'Nombre de chiffres attendus',
    CONFIRMATION_ANI_MENU: 'Menu de confirmation du numéro appelant',
    CONFIRMATION_DIAL_MENU: 'Menu de confirmation du numéro saisi',
    PRESENTATION_CALLER_ID: 'Numéro présenté lors du rappel',
    PRESENTATION_CALLER_NAME: 'Nom présenté lors du rappel',
    SCRIPT: 'Script du conseiller',
    INQUEUE_REPEAT: 'Répétitions du cycle d’attente',
    INQUEUE_HOLD_MUSIC_INIT: 'Musique initiale d’attente',
    INQUEUE_HOLD_TIMEOUT_INIT: 'Durée initiale de musique d’attente',
    TARGET_TYPE: 'Type de destination',
    TARGET: 'Destination',
    TARGET_AUDIO: 'Annonce avant destination',
    ACTIVATE: 'Intention activée',
    DESACTIVATE_INTENT_AUDIO: 'Message lorsque l’intention est désactivée',
    NB_PROPOSAL_MAX: 'Nombre maximal de propositions',
    LOWER_BOUND: 'Borne basse',
    UPPER_BOUND: 'Borne haute',
    LOWER_BOUND_AUDIO: 'Message sous la borne basse',
    BETWEEN_BOUNDS_AUDIO: 'Message entre les bornes',
    UPPER_BOUND_AUDIO: 'Message au-dessus de la borne haute',
    TIMEZONE: 'Fuseau horaire',
    TAKE_ONLY_MORNING_FOR_TODAY_CHECKING: 'Vérifier uniquement la matinée pour aujourd’hui',
    IF_SCHEDULE_FAILED_CREATE_SIMPLE_CALLBACK:
      'Proposer un rappel simple si la planification échoue',
    SCHEDULE_CALLBACK_FAILURE_AUDIO: 'Message si la planification échoue',
    SCHEDULE_KEY_CB: 'Configuration des créneaux de rappel',
    ACTIVE_SCHEDULE_CB: 'Activer le rappel planifié',
    CHECK_CB_EXISTS: 'Vérifier si un rappel existe déjà',
    KEEP_OLD_CALLBACK: 'Conserver le rappel existant',
    CB_ALREADY_EXISTS_AUDIO: 'Message lorsqu’un rappel existe déjà',
  }),
);
const BRANCHES = new Map(
  Object.entries({
    NEXT: 'Suite du parcours',
    DEFAULT: 'Parcours de repli',
    OPEN: 'En ouverture',
    CLOSED: 'En fermeture',
    HOLIDAY: 'Pendant les vacances',
    EMERGENCY: 'En urgence',
    TRUE: 'Si la condition est vraie',
    FALSE: 'Si la condition est fausse',
    INQUEUE: 'À la sortie de l’attente',
    BYPASS: 'En cas de contournement',
    ERROR: 'En cas d’erreur',
    BUSY_QUEUE: 'Si la file est saturée',
    BUSY: 'Si la charge est élevée',
    NOT_BUSY: 'Si la charge est disponible',
    LOGGEDIN: 'Avec des conseillers connectés',
    NOTLOGGEDIN: 'Sans conseiller connecté',
  }),
);
const IDENTITIES = new Set([
  'KEY',
  'DNIS_SEGMENT',
  'SERVICE',
  'PDATA_NAME',
  'MENU_NAME',
  'SCHEDULE_GROUP_KEY',
  'DIVISION_NAME',
  'RATIO_NAME',
  'DECISION_NAME',
  'BOT_NAME',
  'FLOW_NAME',
  'FLOW_KEY',
  'INBOUND_CALL_KEY',
]);
const COPY_FIELDS = new Set([
  'DESCRIPTION',
  'PRIORITY',
  'MENU_TIMEOUT',
  'MENU_REPEAT',
  'INQUEUE_REPEAT',
  'INQUEUE_HOLD_TIMEOUT_INIT',
]);
const AUDIO_FIELDS = new Set([
  'WELCOME_AUDIO',
  'MENU_AUDIO',
  'MENU_ERROR_AUDIO',
  'WHISPER_AUDIO',
  'AUDIO_RECORDING',
]);
const normalized = (key) => String(key ?? '').toUpperCase();

export function fieldLabel(key) {
  const original = String(key ?? '');
  const name = normalized(key);
  if (name === 'KEY') return LABELS.get('key');
  if (LABELS.has(name)) return LABELS.get(name);
  const day = name.match(
    /^(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|HOLIDAYS?)(?:_(WITH_TODAY|WITHOUT_TODAY))?_MENU(?:_AUDIO)?$/,
  );
  if (day) {
    const days = {
      SUNDAY: 'Dimanche',
      MONDAY: 'Lundi',
      TUESDAY: 'Mardi',
      WEDNESDAY: 'Mercredi',
      THURSDAY: 'Jeudi',
      FRIDAY: 'Vendredi',
      SATURDAY: 'Samedi',
      HOLIDAY: 'Jours fériés',
      HOLIDAYS: 'Jours fériés',
    };
    return `${days[day[1]]} · ${day[2] === 'WITH_TODAY' ? 'annonce incluant aujourd’hui' : day[2] === 'WITHOUT_TODAY' ? 'annonce excluant aujourd’hui' : 'menu des créneaux'}`;
  }
  const option = name.match(
    /^OPTION([0-9]|STAR|DIEZ)(?:_(AUDIO|TARGET|TARGET_TYPE|TARGET_AUDIO))?$/,
  );
  if (option) {
    const choice =
      option[1] === 'STAR' ? 'étoile (*)' : option[1] === 'DIEZ' ? 'dièse (#)' : option[1];
    const suffix =
      option[2] === 'TARGET_TYPE'
        ? 'type de destination'
        : option[2] === 'TARGET'
          ? 'destination'
          : option[2]
            ? 'annonce'
            : 'choix';
    return `Choix ${choice} · ${suffix}`;
  }
  const ratioTarget = name.match(/^TARGET(?:_(TYPE|AUDIO))?_(10|[1-9])$/);
  if (ratioTarget)
    return `Répartition ${ratioTarget[2]} · ${ratioTarget[1] === 'TYPE' ? 'type de destination' : ratioTarget[1] === 'AUDIO' ? 'annonce' : 'destination'}`;
  const target = name.match(/^(.*)_TARGET(?:_(TYPE|AUDIO))?$/);
  if (target) {
    const branch =
      BRANCHES.get(target[1]) ||
      {
        LOWER_BOUND: 'Sous la borne basse',
        BETWEEN_BOUND: 'Entre les bornes',
        BETWEEN_BOUNDS: 'Entre les bornes',
        UPPER_BOUND: 'Au-dessus de la borne haute',
        NO_MATCH: 'Sans résultat du bot',
        NO_INPUT: 'Sans réponse au bot',
        INTENT: 'Intention du bot',
      }[target[1]] ||
      (/^RATIO[1-5]$/.test(target[1])
        ? `Répartition ${target[1].at(-1)}`
        : /^OPTION[0-9*#]+$/.test(target[1])
          ? `Choix ${target[1].slice(6)}`
          : target[1]);
    return `${branch} · ${target[2] === 'TYPE' ? 'type de destination' : target[2] === 'AUDIO' ? 'annonce' : 'destination'}`;
  }
  const sequence = name.match(
    /^INQUEUE_(AUDIO|HOLD_MUSIC|HOLD_TIMEOUT|SUBROUTINES_LIST|MENU)_([1-4])$/,
  );
  if (sequence) {
    const labels = new Map([
      ['AUDIO', 'Message'],
      ['HOLD_MUSIC', 'Musique'],
      ['HOLD_TIMEOUT', 'Durée de musique'],
      ['SUBROUTINES_LIST', 'Contrôles'],
      ['MENU', 'Menu'],
    ]);
    return `Attente ${sequence[2]} · ${labels.get(sequence[1])}`;
  }
  const initialization = name.match(/^ATTRIBUTE_(0[1-9]|1[0-5])_(NAME|TYPE|VALUE)$/);
  if (initialization)
    return `Attribut ${Number(initialization[1])} · ${{ NAME: 'nom', TYPE: 'type', VALUE: 'valeur initiale' }[initialization[2]]}`;
  if (/^PDATA_LIST_[1-5]$/.test(name)) return `Contexte client · valeurs ${name.at(-1)}`;
  const ratio = name.match(/^RATIO_?(10|[1-9])$/);
  if (ratio) return `Poids de répartition ${ratio[1]}`;
  return original;
}

/** Stable business sections for WOLF voice v4/v5; unknown fields stay visible. */
export function fieldSection(key) {
  const name = normalized(key);
  if (
    name === 'KEY' ||
    name === 'DESCRIPTION' ||
    name === 'DIVISION' ||
    (isIdentityField(name) && !['FLOW_NAME', 'BOT_NAME'].includes(name))
  )
    return 'identite';
  if (
    [
      'WELCOME_AUDIO',
      'LANGUAGE',
      'ENABLE_RECORDING',
      'AUDIO_RECORDING',
      'CONSENT_MENU',
      'BLOCK_ANI_CHECK',
    ].includes(name) ||
    /^RECORDING_/.test(name)
  )
    return 'accueil';
  if (
    ['SCHEDULE_GROUP', 'EMERGENCY_GROUP', 'EXCEPTIONAL_DAYS_NAME'].includes(name) ||
    /^(OPEN|CLOSED|HOLIDAY|EMERGENCY)_TARGET(?:_(TYPE|AUDIO))?$/.test(name)
  )
    return 'horaires';
  if (/^INQUEUE_/.test(name)) return 'attente';
  if (
    /^MENU_/.test(name) ||
    /^OPTION(?:[0-9]|STAR|DIEZ)(?:_|$)/.test(name) ||
    /^COLLECT_/.test(name) ||
    /^CONFIRMATION_(ANI|DIAL)_MENU$/.test(name)
  )
    return 'menu';
  if (
    [
      'QUEUE',
      'PRIORITY',
      'SKILLS',
      'LANGUAGE_SKILL',
      'DIRECT_USER',
      'WHISPER_AUDIO',
      'MINIMUM_AGENT_REQUIRED',
      'STATUS',
      'INTERACTIONS_MAXIMUM',
      'RATIO_AGENT_VS_INTERACTION',
      'CALLBACK_QUEUE',
      'SCRIPT',
    ].includes(name) ||
    /^(BUSY_QUEUE|BUSY|NOT_BUSY|LOGGEDIN|NOTLOGGEDIN)_/.test(name)
  )
    return 'distribution';
  if (/^PDATA_LIST_/.test(name) || /^DECISION_/.test(name) || name === 'PARTICIPANT_DATA_TO_CHECK')
    return 'contexte';
  if (
    [
      'TARGET',
      'TARGET_TYPE',
      'TARGET_AUDIO',
      'TARGET_MESSAGE_AUDIO',
      'FLOW_NAME',
      'BOT_NAME',
    ].includes(name) ||
    /^(NEXT|DEFAULT|TRUE|FALSE|BYPASS|ERROR)_TARGET(?:_(TYPE|AUDIO))?$/.test(name) ||
    /^TARGET(?:_(TYPE|AUDIO))?_\d+$/.test(name) ||
    /^RATIO_?\d+$/.test(name)
  )
    return 'routage';
  return 'avance';
}

export function isIdentityField(key) {
  const name = normalized(key);
  return IDENTITIES.has(name) || /_KEY$/.test(name);
}

/** References, unknown columns and target triplets are excluded by default. */
export function isCopyableField(key, value) {
  const name = normalized(key);
  if (isIdentityField(key)) return false;
  if (COPY_FIELDS.has(name) || /^INQUEUE_HOLD_TIMEOUT_[1-4]$/.test(name)) return true;
  if (AUDIO_FIELDS.has(name) || /^INQUEUE_AUDIO_[1-4]$/.test(name)) {
    // A complete literal TTS has no prompt, participant-data or chained asset dependency.
    return (
      typeof value === 'string' &&
      /^tts:\s*\S/i.test(value) &&
      !value.includes('|') &&
      !/\$?var:/i.test(value)
    );
  }
  return false;
}

function matchingType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

/**
 * Schema controls the type when supplied. Without it, preserve the original
 * type: notably a numeric-looking CSV string remains a string.
 */
export function coerceRowValue(original, input, schemaProperty = {}) {
  const schema = schemaProperty && typeof schemaProperty === 'object' ? schemaProperty : {};
  const declared = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const inferred = original === null ? 'null' : Array.isArray(original) ? 'array' : typeof original;
  const type =
    inferred !== 'null' && declared.includes(inferred)
      ? inferred
      : declared.find((value) => value !== 'null') || declared[0] || inferred;
  let value;
  const text = typeof input === 'string' ? input : String(input ?? '');
  if (declared.includes('null') && (input === null || text.trim() === 'null')) value = null;
  else if (type === 'number' || type === 'integer') {
    if (text.trim() === '' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
      throw new Error('Saisir un nombre valide ; une valeur vide n’est pas zéro.');
    value = Number(text);
    if (!Number.isFinite(value)) throw new Error('Le nombre doit être fini.');
    if (type === 'integer' && !Number.isInteger(value)) throw new Error('Saisir un nombre entier.');
  } else if (type === 'boolean') {
    if (input === true || input === 'true') value = true;
    else if (input === false || input === 'false') value = false;
    else throw new Error('Saisir true ou false pour ce paramètre.');
  } else if (type === 'object' || type === 'array' || type === 'null') {
    try {
      value = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
    } catch {
      throw new Error('Saisir une valeur JSON valide.');
    }
    if (!matchingType(value, type)) throw new Error(`La valeur doit être de type ${type}.`);
  } else value = text;

  if (declared.length && !declared.some((expected) => matchingType(value, expected)))
    throw new Error('La valeur ne respecte pas le type défini par le schéma.');
  if (typeof value === 'number') {
    if (
      Number.isFinite(schema.minimum) &&
      (value < schema.minimum || (schema.exclusiveMinimum === true && value === schema.minimum))
    )
      throw new Error(
        `La valeur doit être ${schema.exclusiveMinimum === true ? 'supérieure à' : 'au moins égale à'} ${schema.minimum}.`,
      );
    if (
      Number.isFinite(schema.maximum) &&
      (value > schema.maximum || (schema.exclusiveMaximum === true && value === schema.maximum))
    )
      throw new Error(
        `La valeur doit être ${schema.exclusiveMaximum === true ? 'inférieure à' : 'au plus égale à'} ${schema.maximum}.`,
      );
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
      throw new Error(`La valeur doit être supérieure à ${schema.exclusiveMinimum}.`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
      throw new Error(`La valeur doit être inférieure à ${schema.exclusiveMaximum}.`);
    if (
      Number.isFinite(schema.multipleOf) &&
      schema.multipleOf > 0 &&
      Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9
    )
      throw new Error(`La valeur doit être un multiple de ${schema.multipleOf}.`);
  }
  if (typeof value === 'string') {
    if (schema.pattern) {
      let pattern;
      try {
        pattern = new RegExp(schema.pattern);
      } catch {
        throw Error('Le format déclaré par le schéma est invalide.');
      }
      if (!pattern.test(value)) throw Error('La valeur ne respecte pas le format attendu.');
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength)
      throw new Error(`Saisir au moins ${schema.minLength} caractère(s).`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength)
      throw new Error(`Limiter la valeur à ${schema.maxLength} caractère(s).`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))
  )
    throw new Error('Choisir une valeur autorisée par le schéma.');
  return value;
}
