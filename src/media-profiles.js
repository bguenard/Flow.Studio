/** Engine contracts and channel capabilities are separate from journey identity. */
const freeze = (value) => {
  Object.values(value).forEach((v) => {
    if (v && typeof v === 'object') freeze(v);
  });
  return Object.freeze(value);
};
export const MESSAGE_TABLES = freeze({
  segment: 'W_INBOUND_MESSAGE_v1',
  service: 'W_SERVICE_MESSAGE_v1',
  quickreplies: 'W_MENU_MESSAGE_v1',
  carousel: 'W_CAROUSEL_MESSAGE_v1',
  card: 'W_CARD_MESSAGE_v1',
  callback: 'W_CALLBACK_MESSAGE_v1',
  waitforinput: 'W_OPEN_QUESTION_MESSAGE_v1',
  decision: 'W_DECISION_MESSAGE_v1',
  schedulegroup: 'W_SCHEDULE_GROUP_MESSAGE_v1',
  ratiodistrib: 'W_RATIO_DISTRIB_MESSAGE_v1',
  bot: 'W_BOT_MESSAGE_v1',
  pdata: 'W_PARTICIPANT_DATA_MESSAGE_v1',
  check_agent: 'W_CHECK_AGENT_LOGGED_MESSAGE_v1',
  check_interaction: 'W_CHECK_INTERACTION_NB_MESSAGE_v1',
  check_ewt: 'W_CHECK_EWT_PIQ_MESSAGE_v1',
  send_sms: 'W_SEND_SMS_MESSAGE_v1',
  send_email: 'W_SEND_EMAIL_MESSAGE_v1',
  bot_parameters: 'W_BOT_PARAMETERS_MESSAGE_v1',
  collect: 'W_COLLECT_DATA_v1',
});
export const MESSAGE_LABELS = freeze({
  segment: 'Accueil de la conversation',
  service: 'Équipe de traitement',
  quickreplies: 'Choix par boutons',
  carousel: 'Carrousel',
  card: 'Carte',
  callback: 'Rappel',
  waitforinput: 'Question ouverte',
  decision: 'Règle métier',
  schedulegroup: 'Horaires',
  ratiodistrib: 'Répartition',
  bot: 'Bot digital',
  pdata: 'Contexte client',
  collect: 'Collecte de donnée',
  check_agent: 'Disponibilité des conseillers',
  check_interaction: 'Charge de la file',
  check_ewt: 'Temps d’attente',
  disconnect: 'Fin de conversation',
  next: 'Continuer l’attente',
});
export const MESSAGE_ROUTE_TABLES = freeze(
  Object.fromEntries(
    [
      'segment',
      'service',
      'quickreplies',
      'carousel',
      'callback',
      'waitforinput',
      'decision',
      'schedulegroup',
      'ratiodistrib',
      'bot',
    ].map((type) => [type, MESSAGE_TABLES[type]]),
  ),
);
export const MESSAGE_ROUTE_LABELS = freeze(
  Object.fromEntries(
    [...Object.keys(MESSAGE_ROUTE_TABLES), 'next', 'disconnect'].map((type) => [
      type,
      MESSAGE_LABELS[type],
    ]),
  ),
);
const messageNames = new Set(Object.values(MESSAGE_TABLES).map((name) => name.toUpperCase()));
export const isMessageTable = (name) =>
  typeof name === 'string' && messageNames.has(name.toUpperCase());
export const isMessageNode = (node) => isMessageTable(node?.tableName || node?.name);
export const CHANNELS = freeze({
  webmessaging: {
    id: 'webmessaging',
    media: 'messaging',
    label: 'Web Messaging',
    enabled: true,
    entryKind: 'deployment',
    formats: ['text', 'quickreplies', 'carousel', 'image'],
  },
  whatsapp: {
    id: 'whatsapp',
    media: 'messaging',
    label: 'WhatsApp',
    enabled: false,
    entryKind: 'address',
    formats: [],
  },
});
export function channelProfile(id, { requireEnabled = true } = {}) {
  const profile = Object.hasOwn(CHANNELS, id) ? CHANNELS[id] : null;
  if (!profile) throw Error('Canal de messagerie inconnu.');
  if (requireEnabled && !profile.enabled)
    throw Error(`${profile.label} n’est pas encore disponible dans le Studio.`);
  return profile;
}
/** Multiple explicit bindings may point to the same journey. Never infer a channel from its key. */
export function validateChannelBindings(bindings, journeys, { requireEnabled = true } = {}) {
  if (!Array.isArray(bindings)) throw Error('Les points d’entrée doivent être une liste.');
  const ids = new Set(),
    routes = new Set();
  return bindings.map((binding) => {
    if (!binding || typeof binding !== 'object') throw Error('Point d’entrée invalide.');
    const channel = channelProfile(binding.channel, { requireEnabled });
    const flow = journeys.find((f) => f.id === binding.flowId);
    if (!flow || flow.media !== channel.media)
      throw Error('Le point d’entrée doit cibler un parcours Messaging existant.');
    for (const key of ['id', 'flowId', 'endpoint'])
      if (
        typeof binding[key] !== 'string' ||
        !binding[key].trim() ||
        binding[key] !== binding[key].trim()
      )
        throw Error(
          `Point d’entrée : ${key} est obligatoire et ne doit pas comporter d’espaces aux extrémités.`,
        );
    const segment = binding.segment ?? flow.key;
    if (typeof segment !== 'string' || segment !== flow.key)
      throw Error('Le segment doit correspondre à la clé du parcours ciblé.');
    const route = JSON.stringify([channel.id, binding.endpoint, segment]);
    if (ids.has(binding.id) || routes.has(route))
      throw Error('Ce point d’entrée est déjà déclaré.');
    ids.add(binding.id);
    routes.add(route);
    return {
      id: binding.id,
      flowId: flow.id,
      channel: channel.id,
      endpoint: binding.endpoint,
      segment,
    };
  });
}
/** Mirrors the supplied inbound YAML. The deployment name is resolved externally, not guessed. */
export function messageEntryCandidates({
  channel,
  initialSegment,
  deploymentName,
  address,
  isNewConversation,
}) {
  channelProfile(channel, { requireEnabled: false });
  if (typeof isNewConversation !== 'boolean')
    throw Error('Précisez si la conversation est nouvelle.');
  const segment = channel === 'webmessaging' ? initialSegment || deploymentName : address;
  if (typeof segment !== 'string' || !segment)
    throw Error('Le point d’entrée ne fournit aucun segment.');
  return isNewConversation ? [segment] : [segment + '_THREADING', segment];
}
export function messageLocalReference(key) {
  if (/^CARD[0-9]$/.test(key)) return MESSAGE_TABLES.card;
  if (
    /^INQUEUE_MENU_[1-4]$/.test(key) ||
    ['INQUEUE_MENU_REPEAT', 'CONFIRMATION_DIAL_MENU'].includes(key)
  )
    return MESSAGE_TABLES.quickreplies;
  return null;
}
export function messageTextField(key) {
  key = key.toUpperCase();
  return (
    /(?:^|_)MESSAGE(?:_[1-4]|_[1-9])?$/.test(key) ||
    /^(QUESTION|CAROUSEL_QUESTION|OPTION[0-8]_LABEL)$/.test(key)
  );
}

/** Plain text is edited without its transport prefix; structured references remain exact. */
export const messageEditorValue = (value) => String(value ?? '').replace(/^ttm:/i, '');
export function messageStoredValue(value) {
  const text = String(value ?? '');
  if (!text.trim()) return '';
  return /^(ttm|cr|pr|var|img):/i.test(text) ? text : 'ttm:' + text;
}
