/**
 * Offline demonstration only. All entities, resources, messages and identifiers
 * below are fictitious. This module contains no configuration from a customer.
 * It uses the same WOLF v5 row contracts as a live snapshot.
 */
import { normalizeSnapshot } from './data-source.js';

const stringField = title => ({ type: 'string', title });
const integerField = (title, minimum = 0) => ({ type: 'integer', title, minimum });
const schema = (keyTitle, properties) => ({
  type: 'object', required: ['key'],
  properties: {
    key: { type: 'string', title: keyTitle, minLength: 1, maxLength: 256 },
    DESCRIPTION: stringField('Description métier'), DIVISION: stringField('Entité'),
    ...properties,
  },
});
const targetSchema = branches => Object.fromEntries(branches.flatMap(branch => [
  [`${branch}_TARGET_TYPE`, stringField('Type de destination')],
  [`${branch}_TARGET`, stringField('Destination')],
  [`${branch}_TARGET_AUDIO`, stringField('Annonce avant destination')],
]));
const branches = (openTarget, closedMessage) => ({
  OPEN_TARGET_TYPE: 'menu', OPEN_TARGET: openTarget, OPEN_TARGET_AUDIO: '',
  CLOSED_TARGET_TYPE: 'disconnect', CLOSED_TARGET: 'Service fermé', CLOSED_TARGET_AUDIO: `tts:${closedMessage}`,
  HOLIDAY_TARGET_TYPE: 'disconnect', HOLIDAY_TARGET: 'Jour de fermeture', HOLIDAY_TARGET_AUDIO: 'tts:Notre agence est fermée aujourd’hui. Retrouvez vos démarches dans votre espace personnel.',
  EMERGENCY_TARGET_TYPE: 'disconnect', EMERGENCY_TARGET: 'Fermeture exceptionnelle', EMERGENCY_TARGET_AUDIO: 'tts:Notre agence est exceptionnellement indisponible. Nous vous invitons à renouveler votre appel.',
});
const service = (key, name, division, queue, priority, skills) => ({
  key, DESCRIPTION: name, DIVISION: division, QUEUE: queue, PRIORITY: priority,
  SKILLS: skills, WHISPER_AUDIO: '',
  INQUEUE_HOLD_MUSIC_INIT: '', INQUEUE_HOLD_TIMEOUT_INIT: 0,
  INQUEUE_REPEAT: 2,
  INQUEUE_AUDIO_1: 'tts:Votre demande est importante. Un conseiller vous répondra dès que possible.',
  INQUEUE_HOLD_MUSIC_1: '', INQUEUE_HOLD_TIMEOUT_1: 0,
  INQUEUE_TARGET_TYPE: 'disconnect', INQUEUE_TARGET: 'Fin de l’attente',
  INQUEUE_TARGET_AUDIO: 'tts:Tous nos conseillers sont actuellement occupés. Merci de renouveler votre appel.',
});

/**
 * source.resources is an explicit, fictitious resource catalogue for the demo.
 * Live snapshots must use actual Genesys resources to display weekly hours or
 * resource names; a WOLF SCHEDULE_GROUP reference does not contain those hours.
 */
const demoData = {
  source: {
    kind: 'demo', demo: true, readOnly: true,
    label: 'Démonstration · données fictives',
    description: 'Deux agences fictives pour découvrir l’administration métier des parcours voix.',
    resources: {
      fictitious: true,
      scheduleGroups: [
        { id: 'DEMO_CAL_ATLANTIQUE', name: 'Horaires de l’agence Atlantique', summary: 'Lundi à vendredi · 9 h–18 h', timeZone: 'Europe/Paris', openingHours: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }] },
        { id: 'DEMO_CAL_RHONE', name: 'Horaires de l’agence Rhône', summary: 'Lundi à vendredi · 8 h 30–17 h 30', timeZone: 'Europe/Paris', openingHours: [{ days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' }] },
      ],
      queues: [
        { id: 'DEMO_EQ_ATL_SINISTRES', name: 'Conseillers sinistres · Atlantique' },
        { id: 'DEMO_EQ_ATL_CONTRATS', name: 'Conseillers contrats · Atlantique' },
        { id: 'DEMO_EQ_RHONE_SINISTRES', name: 'Conseillers sinistres · Rhône' },
        { id: 'DEMO_EQ_RHONE_CONTRATS', name: 'Conseillers contrats · Rhône' },
      ],
      divisions: [
        { id: 'DEMO_DIV_ATLANTIQUE', name: 'Agence Atlantique' },
        { id: 'DEMO_DIV_RHONE', name: 'Agence Rhône' },
      ],
    },
  },
  tables: [
    {
      id: 'demo-voice-inbound-v5', name: 'W_INBOUND_CALL_v5',
      schema: schema('DNIS_SEGMENT', { LANGUAGE: stringField('Langue'), WELCOME_AUDIO: stringField('Message d’accueil'), ...targetSchema(['NEXT', 'DEFAULT']) }),
      rows: [
        { key: 'DEMO_ENTREE_ATLANTIQUE', DESCRIPTION: 'Agence Atlantique · accueil et conseil', DIVISION: 'DEMO_DIV_ATLANTIQUE', LANGUAGE: 'fr-fr', WELCOME_AUDIO: 'tts:Bienvenue à l’agence Atlantique. Nous sommes à votre écoute pour vous accompagner dans vos démarches.', NEXT_TARGET_TYPE: 'schedulegroup', NEXT_TARGET: 'DEMO_HORAIRES_ATLANTIQUE', NEXT_TARGET_AUDIO: '', DEFAULT_TARGET_TYPE: 'disconnect', DEFAULT_TARGET: '', DEFAULT_TARGET_AUDIO: '' },
        { key: 'DEMO_ENTREE_RHONE', DESCRIPTION: 'Agence Rhône · accueil et conseil', DIVISION: 'DEMO_DIV_RHONE', LANGUAGE: 'fr-fr', WELCOME_AUDIO: 'tts:Bienvenue à l’agence Rhône. Un conseiller vous accompagne pour votre contrat ou votre déclaration de sinistre.', NEXT_TARGET_TYPE: 'schedulegroup', NEXT_TARGET: 'DEMO_HORAIRES_RHONE', NEXT_TARGET_AUDIO: '', DEFAULT_TARGET_TYPE: 'disconnect', DEFAULT_TARGET: '', DEFAULT_TARGET_AUDIO: '' },
      ],
    },
    {
      id: 'demo-voice-hours-v5', name: 'W_SCHEDULE_GROUP_v5',
      schema: schema('SCHEDULE_GROUP_KEY', { SCHEDULE_GROUP: stringField('Calendrier de disponibilité'), EMERGENCY_GROUP: stringField('Calendrier d’urgence'), ...targetSchema(['OPEN', 'CLOSED', 'HOLIDAY', 'EMERGENCY']) }),
      rows: [
        { key: 'DEMO_HORAIRES_ATLANTIQUE', DESCRIPTION: 'Disponibilité de l’agence Atlantique', DIVISION: 'DEMO_DIV_ATLANTIQUE', SCHEDULE_GROUP: 'DEMO_CAL_ATLANTIQUE', EMERGENCY_GROUP: '', ...branches('DEMO_MENU_ATLANTIQUE', 'Nos conseillers vous accueillent du lundi au vendredi, de 9 heures à 18 heures. À bientôt.') },
        { key: 'DEMO_HORAIRES_RHONE', DESCRIPTION: 'Disponibilité de l’agence Rhône', DIVISION: 'DEMO_DIV_RHONE', SCHEDULE_GROUP: 'DEMO_CAL_RHONE', EMERGENCY_GROUP: '', ...branches('DEMO_MENU_RHONE', 'Nos conseillers vous accueillent du lundi au vendredi, de 8 heures 30 à 17 heures 30. À bientôt.') },
      ],
    },
    {
      id: 'demo-voice-menu-v5', name: 'W_MENU_v5',
      schema: schema('MENU_NAME', { MENU_AUDIO: stringField('Annonce du menu'), MENU_TIMEOUT: { type: 'integer', title: 'Délai de réponse', enum: [3, 5, 7, 10, 12] }, MENU_REPEAT: integerField('Nombre de répétitions'), MENU_ERROR_AUDIO: stringField('Annonce de saisie incorrecte'), ...targetSchema(['DEFAULT', 'OPTION1', 'OPTION2']), OPTION1_AUDIO: stringField('Annonce du choix 1'), OPTION2_AUDIO: stringField('Annonce du choix 2') }),
      rows: [
        { key: 'DEMO_MENU_ATLANTIQUE', DESCRIPTION: 'Orienter la demande · Atlantique', DIVISION: 'DEMO_DIV_ATLANTIQUE', MENU_AUDIO: 'tts:Pour déclarer ou suivre un sinistre, tapez 1. Pour une question sur votre contrat, tapez 2.', MENU_TIMEOUT: 5, MENU_REPEAT: 2, MENU_ERROR_AUDIO: 'tts:Nous n’avons pas reconnu votre choix. Pour un sinistre, tapez 1. Pour votre contrat, tapez 2.', OPTION1_AUDIO: '', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'DEMO_ATL_SINISTRES', OPTION2_AUDIO: '', OPTION2_TARGET_TYPE: 'service', OPTION2_TARGET: 'DEMO_ATL_CONTRATS', DEFAULT_TARGET_TYPE: 'service', DEFAULT_TARGET: 'DEMO_ATL_CONTRATS', DEFAULT_TARGET_AUDIO: 'tts:Nous vous mettons en relation avec un conseiller.' },
        { key: 'DEMO_MENU_RHONE', DESCRIPTION: 'Orienter la demande · Rhône', DIVISION: 'DEMO_DIV_RHONE', MENU_AUDIO: 'tts:Pour déclarer ou suivre un sinistre, tapez 1. Pour une question sur votre contrat, tapez 2.', MENU_TIMEOUT: 7, MENU_REPEAT: 2, MENU_ERROR_AUDIO: 'tts:Nous n’avons pas reconnu votre choix. Pour un sinistre, tapez 1. Pour votre contrat, tapez 2.', OPTION1_AUDIO: '', OPTION1_TARGET_TYPE: 'service', OPTION1_TARGET: 'DEMO_RHONE_SINISTRES', OPTION2_AUDIO: '', OPTION2_TARGET_TYPE: 'service', OPTION2_TARGET: 'DEMO_RHONE_CONTRATS', DEFAULT_TARGET_TYPE: 'service', DEFAULT_TARGET: 'DEMO_RHONE_CONTRATS', DEFAULT_TARGET_AUDIO: 'tts:Nous vous mettons en relation avec un conseiller.' },
      ],
    },
    {
      id: 'demo-voice-distribution-v5', name: 'W_SERVICES_v5',
      schema: schema('SERVICE', { QUEUE: stringField('Équipe de traitement'), PRIORITY: integerField('Priorité de distribution'), SKILLS: stringField('Compétences'), WHISPER_AUDIO: stringField('Annonce au conseiller'), INQUEUE_HOLD_MUSIC_INIT: stringField('Musique initiale'), INQUEUE_HOLD_TIMEOUT_INIT: integerField('Durée initiale'), INQUEUE_REPEAT: integerField('Répétitions du cycle'), INQUEUE_AUDIO_1: stringField('Message pendant l’attente'), INQUEUE_HOLD_MUSIC_1: stringField('Musique d’attente'), INQUEUE_HOLD_TIMEOUT_1: integerField('Durée de musique'), ...targetSchema(['INQUEUE']) }),
      rows: [
        service('DEMO_ATL_SINISTRES', 'Déclarer ou suivre un sinistre', 'DEMO_DIV_ATLANTIQUE', 'DEMO_EQ_ATL_SINISTRES', 3, 'Sinistres;Habitation'),
        service('DEMO_ATL_CONTRATS', 'Gérer un contrat', 'DEMO_DIV_ATLANTIQUE', 'DEMO_EQ_ATL_CONTRATS', 1, 'Contrats'),
        service('DEMO_RHONE_SINISTRES', 'Déclarer ou suivre un sinistre', 'DEMO_DIV_RHONE', 'DEMO_EQ_RHONE_SINISTRES', 2, 'Sinistres;Habitation'),
        service('DEMO_RHONE_CONTRATS', 'Gérer un contrat', 'DEMO_DIV_RHONE', 'DEMO_EQ_RHONE_CONTRATS', 1, 'Contrats'),
      ],
    },
  ],
};

// One whole reference journey and two explicit local variants. These bindings
// exist only in this fictitious demo; live inheritance is never guessed.
const coreKeys = {
  DEMO_ENTREE_ATLANTIQUE: 'DEMO_CORE_MODEL_ACCUEIL',
  DEMO_HORAIRES_ATLANTIQUE: 'DEMO_CORE_MODEL_HORAIRES',
  DEMO_MENU_ATLANTIQUE: 'DEMO_CORE_MODEL_MENU',
  DEMO_ATL_SINISTRES: 'DEMO_CORE_MODEL_SINISTRES',
  DEMO_ATL_CONTRATS: 'DEMO_CORE_MODEL_CONTRATS',
};
const coreNames = {
  'demo-voice-inbound-v5': 'Accueil et conseil · Core Model (template)',
  'demo-voice-hours-v5': 'Disponibilité du parcours de référence',
  'demo-voice-menu-v5': 'Choix proposés dans le parcours de référence',
};
const coreNodes = [];
for (const table of demoData.tables) {
  const originals = table.rows.filter(row => Object.hasOwn(coreKeys, row.key));
  const referenceRows = originals.map(original => {
    const row = structuredClone(original);
    row.key = coreKeys[original.key];
    row.DIVISION = 'DEMO_DIV_GROUPE';
    if (Object.hasOwn(coreNames, table.id)) row.DESCRIPTION = coreNames[table.id];
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === 'string' && field !== 'key' && Object.hasOwn(coreKeys, value)) row[field] = coreKeys[value];
    }
    if (row.SCHEDULE_GROUP) row.SCHEDULE_GROUP = 'DEMO_CAL_GROUPE';
    if (row.QUEUE) row.QUEUE = row.QUEUE.includes('SINISTRES') ? 'DEMO_EQ_GROUPE_SINISTRES' : 'DEMO_EQ_GROUPE_CONTRATS';
    if (row.WELCOME_AUDIO) row.WELCOME_AUDIO = 'tts:Bienvenue. Nos conseillers vous accompagnent pour votre contrat ou votre déclaration de sinistre.';
    coreNodes.push({ tableId: table.id, referenceKey: row.key, atlanticKey: original.key });
    return row;
  });
  table.rows.unshift(...referenceRows);
}
const referenceFlowId = 'demo-voice-inbound-v5:DEMO_CORE_MODEL_ACCUEIL';

// Version 2 fictive du même parcours de référence : une évolution Groupe
// complète (accueil, attente, priorité, délai, répétitions et repli du menu).
// Les lignes de la version 1 restent intactes : une version est immuable.
const v2Key = key => key.replace('DEMO_CORE_MODEL_', 'DEMO_CORE_MODEL_V2_');
const v2Changes = {
  DEMO_CORE_MODEL_ACCUEIL: { WELCOME_AUDIO: 'tts:Bienvenue et merci de votre appel. Nos conseillers vous accompagnent pour votre contrat ou votre déclaration de sinistre.' },
  DEMO_CORE_MODEL_MENU: { MENU_TIMEOUT: 7, MENU_REPEAT: 3, DEFAULT_TARGET: 'DEMO_CORE_MODEL_SINISTRES' },
  DEMO_CORE_MODEL_SINISTRES: { PRIORITY: 4, INQUEUE_AUDIO_1: 'tts:Merci de patienter. Un conseiller prend votre appel dans quelques instants.' },
  DEMO_CORE_MODEL_CONTRATS: { INQUEUE_AUDIO_1: 'tts:Merci de patienter. Un conseiller prend votre appel dans quelques instants.' },
};
const referenceKeys = new Set(Object.values(coreKeys));
for (const table of demoData.tables) {
  const secondVersion = table.rows.filter(row => referenceKeys.has(row.key)).map(original => {
    const row = { ...structuredClone(original), ...(v2Changes[original.key] || {}) };
    for (const [field, value] of Object.entries(row)) if (typeof value === 'string' && referenceKeys.has(value)) row[field] = v2Key(value);
    return row;
  });
  table.rows.push(...secondVersion);
}
const referenceV2FlowId = `demo-voice-inbound-v5:${v2Key('DEMO_CORE_MODEL_ACCUEIL')}`;
const rhoneKeys = {
  DEMO_ENTREE_ATLANTIQUE: 'DEMO_ENTREE_RHONE', DEMO_HORAIRES_ATLANTIQUE: 'DEMO_HORAIRES_RHONE',
  DEMO_MENU_ATLANTIQUE: 'DEMO_MENU_RHONE', DEMO_ATL_SINISTRES: 'DEMO_RHONE_SINISTRES', DEMO_ATL_CONTRATS: 'DEMO_RHONE_CONTRATS',
};
demoData.source.description = 'Un Core Model voix complet en deux versions et ses deux déclinaisons fictives Atlantique et Rhône.';
// Référentiel explicite du jeu fictif. Une source réelle n'en fournit pas :
// les rôles y sont déclarés par l'utilisateur, jamais déduits des tables.
demoData.source.coreModels = [{ id: 'demo-core-model-accueil', name: 'Accueil et conseil', demoOnly: true, versions: [{ flowId: referenceFlowId, label: '1' }, { flowId: referenceV2FlowId, label: '2' }] }];
const demoScopes = [{ scope: 'active', scopeNote: '' }, { scope: 'inactive', scopeNote: 'Entité pas encore prête (exemple fictif)' }];
demoData.source.relationships = ['Atlantique', 'Rhône'].map((name, index) => ({
  type: 'declination', demoOnly: true, coreModelId: 'demo-core-model-accueil', referenceFlowId, ...demoScopes[index],
  flowId: `demo-voice-inbound-v5:${index ? 'DEMO_ENTREE_RHONE' : 'DEMO_ENTREE_ATLANTIQUE'}`,
  name: `Agence ${name}`,
  nodeMappings: coreNodes.map(node => ({ referenceNodeId: `${node.tableId}:${node.referenceKey}`, localNodeId: `${node.tableId}:${index ? rhoneKeys[node.atlanticKey] : node.atlanticKey}` })),
}));
demoData.source.resources.scheduleGroups.unshift({ id: 'DEMO_CAL_GROUPE', name: 'Horaires du parcours de référence', summary: 'Lundi à vendredi · 9 h–18 h', timeZone: 'Europe/Paris', openingHours: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }] });
demoData.source.resources.queues.unshift({ id: 'DEMO_EQ_GROUPE_SINISTRES', name: 'Équipe de référence · Sinistres' }, { id: 'DEMO_EQ_GROUPE_CONTRATS', name: 'Équipe de référence · Contrats' });
demoData.source.resources.divisions.unshift({ id: 'DEMO_DIV_GROUPE', name: 'Groupe · Core Model' });

export const demoSnapshot = normalizeSnapshot(demoData);
