/**
 * Contrôles (« subroutines » WOLF) attachés à une suite par `|sub:A;B` ou listés
 * dans une colonne SUBROUTINES_LIST. Lecture seule : rien n'est interprété au-delà
 * de ce que les Data Tables chargées permettent d'affirmer.
 */
const text = (value) => (value == null ? '' : String(value));
const LABELS = new Map(
  Object.entries({
    CHECK_AGENT: 'Disponibilité des conseillers',
    CHECK_AGENT_LOGGED: 'Conseillers connectés',
    CHECK_INTERACTION: 'Charge des équipes',
    CHECK_INTERACTION_NB: 'Volume des interactions',
    CHECK_EWT: 'Temps d’attente estimé',
    CHECK_PIQ: 'Position dans la file',
    CHECK_EWT_PIQ: 'Position et temps d’attente',
    RECORDING: 'Enregistrement de l’appel',
    CHECK_RECORDING: 'Enregistrement de l’appel',
    CHECK_CUSTOMER: 'Contexte du client',
    CHECK_CUSTOMER_HOME: 'Contexte du client',
  }),
);
const agents =
    'Vérifie qu’assez de conseillers sont connectés sur la file du service. Seuils et suite de repli : table W_CHECK_AGENT_LOGGED_V5.',
  interactions =
    'Compare les interactions en cours et en attente aux seuils de la table W_CHECK_INTERACTION_NB_v5.',
  customer =
    'Recherche un réglage propre au client (numéro, courriel ou identifiant) et peut détourner l’appel.';
const DESCRIPTIONS = new Map(
  Object.entries({
    CHECK_AGENT: agents,
    CHECK_AGENT_LOGGED: agents,
    CHECK_INTERACTION: interactions,
    CHECK_INTERACTION_NB: interactions,
    CHECK_EWT:
      'Compare le temps d’attente estimé de la file aux bornes de la table W_THRESHOLD_EWT_PIQ_v5.',
    CHECK_PIQ: 'Compare la position dans la file aux bornes de la table W_THRESHOLD_EWT_PIQ_v5.',
    CHECK_EWT_PIQ:
      'Compare la position et le temps d’attente aux bornes de la table W_THRESHOLD_EWT_PIQ_v5.',
    CHECK_CUSTOMER: customer,
    CHECK_CUSTOMER_HOME: customer,
  }),
);
const CUSTOM =
  'Traitement propre à votre organisation, défini dans le flow Architect. Les Data Tables WOLF ne le décrivent pas.';
const enabled = (value) => [true, 'true', '1', 1].includes(value);
const disabled = (value) => [false, 'false', '0', 0].includes(value);

/** `RECORDING_50` enregistre une part des appels ; sans suffixe, tous. */
function recordingShare(name) {
  const match = /^(?:CHECK_)?RECORDING(?:_(\d{1,3}))?$/i.exec(name);
  return match ? { share: match[1] ? Number(match[1]) : null } : null;
}

/** Noms d'une liste de contrôles (`A;B`), dans l'ordre d'exécution. */
export const controlNames = (value) =>
  text(value)
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
export const isRecordingControl = (name) => Boolean(recordingShare(text(name).trim()));
/** Contrôle par lequel le parcours reçoit ses données de contexte au démarrage. */
export const isContextControl = (name) => /^INFO_ROUTAGE$/i.test(text(name).trim());
const CONTEXT =
  'Données de contexte du parcours, attachées à l’appel à son démarrage. Elles se consultent et se modifient depuis le bloc « Données de contexte » du parcours.';
/** Vrai si une liste de contrôles (`A;B`) appelle l'enregistrement. */
export function callsRecording(value) {
  return text(value)
    .split(';')
    .some((name) => recordingShare(name.trim()));
}
/** Champs d'une ligne qui appellent l'enregistrement avant la mise en file : liste de démarrage ou `|sub:` d'une suite. */
export function recordingCallFields(row) {
  return Object.keys(row || {}).filter((field) => {
    if (/^INQUEUE_/.test(field)) return false;
    if (field === 'SUBROUTINES_LIST') return callsRecording(row[field]);
    return (
      /(^|_)TARGET_TYPE(?:_\d+)?$/.test(field) &&
      text(row[field])
        .split('|')
        .slice(1)
        .some((part) => /^\s*sub:/i.test(part) && callsRecording(part.slice(part.indexOf(':') + 1)))
    );
  });
}
/** Réglage d'enregistrement appliqué à un parcours : sa division, sinon le repli « Home ». */
export function recordingSetting(snapshot, division) {
  const tables = (snapshot?.tables || []).filter((t) => /^W_RECORDING_V5$/i.test(t.name));
  if (tables.length !== 1) return { table: null, row: null, own: false };
  const rows = tables[0].rows || [],
    own = division ? rows.find((r) => text(r.key) === text(division)) : null;
  return {
    table: tables[0],
    row: own || rows.find((r) => text(r.key) === 'Home') || null,
    own: Boolean(own),
  };
}
/** Libellé métier d'un contrôle connu de WOLF ; vide pour un traitement propre à l'organisation. */
export function controlLabel(name) {
  const recording = recordingShare(text(name).trim());
  if (recording)
    return (
      LABELS.get('RECORDING') +
      (recording.share == null ? '' : ` (${recording.share} % des appels)`)
    );
  if (isContextControl(name)) return 'Données de contexte';
  return LABELS.get(text(name).trim().toUpperCase()) || '';
}

function recordingControl(name, { share }, { snapshot, flow, waiting }) {
  const notes = [];
  let warning = '';
  if (share != null) notes.push(`Demandé pour ${share} % des appels.`);
  const division = text((flow?.nodes || []).find((n) => n.type === 'inboundcall')?.row?.DIVISION),
    { table, row, own } = recordingSetting(snapshot, division);
  if (waiting)
    warning =
      'RECORDING n’est pas disponible pendant l’attente : il ne s’exécute qu’avant la mise en file.';
  else if (!table)
    warning =
      'La table W_RECORDING_V5 n’est pas chargée : le réglage d’enregistrement ne peut pas être affiché.';
  else {
    if (!row)
      warning = division
        ? `Aucun réglage dans W_RECORDING_V5 pour la division « ${division} » ni pour « Home » : à vérifier.`
        : 'La division du parcours n’est pas renseignée et W_RECORDING_V5 ne contient pas de réglage ni pour « Home » : à vérifier.';
    else {
      notes.push(
        own
          ? `Réglage de la division « ${division} » (W_RECORDING_V5).`
          : division
            ? `Aucun réglage pour la division « ${division} » : le réglage de repli « Home » s’applique.`
            : 'Division du parcours non renseignée : le réglage de repli « Home » s’applique.',
      );
      if (enabled(row.ENABLE_RECORDING)) notes.push('Enregistrement autorisé.');
      else if (disabled(row.ENABLE_RECORDING))
        warning =
          'Enregistrement désactivé dans ce réglage : le contrôle est appelé, mais l’appel n’est pas enregistré.';
      else notes.push('Autorisation d’enregistrement non renseignée dans ce réglage.');
      const audio = text(row.AUDIO_RECORDING).trim();
      notes.push(
        audio
          ? /^tts:/i.test(audio)
            ? `Annonce : « ${audio.slice(4).trim()} »`
            : `Annonce : ${audio}`
          : 'Aucune annonce d’enregistrement.',
      );
      const menu = text(row.CONSENT_MENU).trim();
      notes.push(
        menu ? `Consentement demandé par le menu « ${menu} ».` : 'Pas de menu de consentement.',
      );
    }
  }
  return { name, kind: 'recording', title: LABELS.get('RECORDING'), notes, warning };
}

/**
 * Un élément par contrôle, dans l'ordre d'exécution.
 * `kind` : recording (réglage lu dans W_RECORDING_V5), context (données du parcours), standard (contrôle WOLF documenté)
 * ou custom (traitement du flow Architect, inconnu des Data Tables).
 */
export function routeControls(value, context = {}) {
  return text(value)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => {
      const recording = recordingShare(name);
      if (recording) return recordingControl(name, recording, context);
      if (isContextControl(name))
        return {
          name,
          kind: 'context',
          title: 'Données de contexte',
          notes: [CONTEXT],
          warning: '',
        };
      const key = name.toUpperCase();
      return LABELS.has(key)
        ? {
            name,
            kind: 'standard',
            title: LABELS.get(key),
            notes: [DESCRIPTIONS.get(key)].filter(Boolean),
            warning: '',
          }
        : { name, kind: 'custom', title: name, notes: [CUSTOM], warning: '' };
    });
}
