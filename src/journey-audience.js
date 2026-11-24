import { businessFields, humanText, nodeTitle, nodeConfigurationNotes } from './business.js';
import { esc } from './ui-kit.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => (value == null ? '' : String(value));
const present = (value) => value != null && text(value).trim() !== '';
const canonical = (type) => text(type).trim().toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const operatorWords = new Map([
  ['exist', 'existe'],
  ['empty', 'est vide'],
  ['contains', 'contient'],
  ['==', 'est égal à'],
  ['=', 'est égal à'],
  ['!=', 'est différent de'],
  ['<>', 'est différent de'],
  ['>', 'est supérieur à'],
  ['>=', 'est supérieur ou égal à'],
  ['<', 'est inférieur à'],
  ['<=', 'est inférieur ou égal à'],
]);
const rawExpression = (value) => /[|]|==|!=|<=|>=|\$?var:|^W_[A-Z_]+(?:_v\d+)?$/i.test(text(value));
const roleTitle = (node) => node?.label || nodeTitle({ type: node?.type });
const groupOrder = [
  'name',
  'condition',
  'messages',
  'language',
  'calendars',
  'team',
  'input',
  'weights',
  'music',
  'waiting',
  'limits',
  'recording',
  'identity',
  'checks',
  'context',
  'references',
  'division',
  'routing',
  'other',
];

function readableTerm(value) {
  if (value === true || /^true$/i.test(text(value))) return 'Vrai';
  if (value === false || /^false$/i.test(text(value))) return 'Faux';
  const label = humanText(value);
  if (!label) return 'une valeur vide';
  return /^[\p{Lu}À-ÖØ-Þ]{3,}$/u.test(label)
    ? label[0] + label.slice(1).toLocaleLowerCase('fr-FR')
    : label;
}

export function isContextNode(node) {
  return canonical(node?.type) === 'pdata';
}

function businessTitle(value, node) {
  let title = text(value).trim();
  // Paired angle brackets may be literal label text; the renderer escapes them.
  const syntax = title.replace(/<[^<>]*>/g, '');
  if (!title || /[=<>]|\$?var:/i.test(syntax)) return '';
  if (title.includes('|')) {
    const first = title.split('|')[0].trim();
    // A human sentence may be followed by configuration references. A bare
    // expression operand or key is not enough evidence to interpret a pipe.
    if (!/\s/.test(first) || first.includes('_')) return '';
    title = first;
  }
  if (
    title === node?.tableName ||
    /^W_[A-Z0-9_]+_v\d+(?:\.\d+)?$/i.test(title) ||
    /^\{?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\}?$/i.test(title)
  )
    return '';
  return humanText(title);
}

/** Distinct business names remain distinct even when the saved name is also the row key. */
export function audienceNodeTitle(node, audience = 'business') {
  if (audience === 'admin' || audience === 'administration')
    return (
      text(node?.key || node?.row?.key || node?.name || node?.row?.DESCRIPTION) || nodeTitle(node)
    );
  for (const candidate of [node?.row?.DESCRIPTION, node?.name, node?.key, node?.row?.key]) {
    const title = businessTitle(candidate, node);
    if (title) return title;
  }
  return roleTitle(node);
}

function decisionSummary(node) {
  if (canonical(node?.type) !== 'decision') return { text: '', complete: true, notes: [] };
  const row = node?.row || {};
  let subject,
    operator,
    value,
    hasValue = false;
  if (
    own(row, 'PARTICIPANT_DATA_TO_CHECK') ||
    own(row, 'DECISION_OPERATOR') ||
    own(row, 'DECISION_VALUE')
  ) {
    subject = row.PARTICIPANT_DATA_TO_CHECK;
    operator = row.DECISION_OPERATOR;
    value = row.DECISION_VALUE;
    hasValue = own(row, 'DECISION_VALUE') && value != null;
  } else if (canonical(row.DECISION_TYPE) === 'expression') {
    const parts = text(row.DECISION_TARGET).split('|');
    if (parts.length === 3) {
      [subject, operator, value] = parts;
      hasValue = true;
    } else
      return {
        text: 'Condition à vérifier',
        complete: false,
        notes: [
          {
            message:
              'La condition ne peut pas être résumée : son expression est incomplète ou comporte plusieurs opérations.',
          },
        ],
      };
  } else if (present(row.DECISION_TYPE))
    return {
      text: 'Condition à consulter en Administration',
      complete: false,
      notes: [
        {
          message: `Cette condition utilise un mode qui n’est pas interprété dans la vue Métier : ${humanText(row.DECISION_TYPE)}.`,
        },
      ],
    };
  const unary = ['exist', 'empty'].includes(text(operator).trim());
  const missing = [
    !present(subject) && 'information à vérifier',
    !present(operator) && 'opérateur de comparaison',
    !unary && !hasValue && 'valeur de comparaison',
  ].filter(Boolean);
  if (missing.length)
    return {
      text: 'Condition incomplète',
      complete: false,
      notes: [{ message: `Condition incomplète. Il manque : ${missing.join(', ')}.` }],
    };
  const words = operatorWords.get(text(operator).trim());
  if (!words || rawExpression(subject) || (!unary && rawExpression(value)))
    return {
      text: 'Condition à vérifier',
      complete: false,
      notes: [
        {
          message:
            'Cette condition ne peut pas être traduite fidèlement dans la vue Métier. Consultez sa définition en Administration.',
        },
      ],
    };
  return {
    text: `${readableTerm(subject)} ${words}${unary ? '' : ' ' + readableTerm(value)}`,
    complete: true,
    notes: [],
  };
}

export function audienceNodeSubtitle(node, audience = 'business') {
  if (audience === 'admin' || audience === 'administration')
    return [node?.tableName, node?.type].filter(Boolean).join(' · ');
  return decisionSummary(node).text || roleTitle(node);
}

function groupFor(field) {
  const key = field.key.toUpperCase();
  if (key === 'DESCRIPTION') return ['name', 'Nom de cette étape'];
  if (field.kind === 'pdata') return ['context', 'Contexte client'];
  if (field.kind === 'controls') return ['checks', 'Contrôles automatiques'];
  if (field.kind === 'local-reference') return ['references', 'Configurations associées'];
  if (field.kind === 'route-type' || field.kind === 'route-target')
    return ['routing', 'Suites du parcours'];
  // Division is chosen for the journey at creation; per-row access stays in Administration.
  if (key === 'DIVISION') return null;
  if (
    field.editable &&
    ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_OPERATOR', 'DECISION_VALUE'].includes(key)
  )
    return ['condition', 'Condition à vérifier'];
  if (
    ['ENABLE_RECORDING', 'RECORDING_ENABLE', 'CONSENT_MENU', 'RECORDING_CONSENT_MENU'].includes(key)
  )
    return ['recording', 'Enregistrement et consentement'];
  if (
    [
      'USE_CALLER_ANI',
      'ASK_FOR_ANI_WITH_COUNTRY_CODE',
      'COUNTRY_CODE',
      'PRESENTATION_CALLER_NAME',
      'PRESENTATION_CALLER_ID',
      'CONFIRMATION_ANI_MENU',
      'CONFIRMATION_DIAL_MENU',
    ].includes(key)
  )
    return ['identity', 'Identification de l’appelant'];
  if (key === 'BLOCK_ANI_CHECK') return ['checks', 'Contrôle des appels'];
  if (key === 'INQUEUE_NOTLOGGEDIN_AGENT_CHECK') return ['limits', 'Seuils de prise en charge'];
  if (key === 'INQUEUE_PIQ_EWT_PLAY_POSITION')
    return ['waiting', 'Durées et répétitions de l’attente'];
  if (key === 'LANGUAGE') return ['language', 'Langue de l’appel'];
  if (
    [
      'SCHEDULE_GROUP',
      'EMERGENCY_GROUP',
      'EXCEPTIONAL_DAYS_NAME',
      'SCHEDULEGROUP_FOR_CALLBACK',
    ].includes(key)
  )
    return ['calendars', 'Calendriers associés'];
  if (
    ['QUEUE', 'CALLBACK_QUEUE', 'PRIORITY', 'SKILLS', 'LANGUAGE_SKILL', 'DIRECT_USER'].includes(key)
  )
    return ['team', 'Équipe et priorité'];
  if (
    /^(?:MENU_TIMEOUT|MENU_REPEAT|COLLECT_MENU_TIMEOUT|COLLECT_MENU_REPEAT|COLLECT_SIZE)$/.test(key)
  )
    return ['input', 'Réponse au menu'];
  if (/^INQUEUE_HOLD_TIMEOUT_(?:INIT|[1-4])$/.test(key) || key === 'INQUEUE_REPEAT')
    return ['waiting', 'Durées et répétitions de l’attente'];
  if (/^INQUEUE_HOLD_MUSIC_(?:INIT|[1-4])$/.test(key)) return ['music', 'Musique d’attente'];
  if (
    [
      'BUSY_QUEUE_NUM',
      'MINIMUM_AGENT_REQUIRED',
      'INTERACTIONS_MAXIMUM',
      'RATIO_AGENT_VS_INTERACTION',
      'INQUEUE_PIQ_EWT_THRESHOLD',
    ].includes(key)
  )
    return ['limits', 'Seuils de prise en charge'];
  if (/^RATIO_?\d+$/.test(key)) return ['weights', 'Répartition des appels'];
  if (field.kind === 'audio') return ['messages', 'Messages diffusés'];
  if (field.editable || field.resource) return ['other', 'Autres réglages'];
  return null;
}

/** Field objects retain the editor contract from businessFields, including readonly resources. */
export function businessInspectorModel(node) {
  const sourceFields = businessFields(node),
    groups = new Map(),
    summary = decisionSummary(node);
  for (const field of sourceFields) {
    const group = groupFor(field);
    if (!group) continue;
    if (field.key.toUpperCase() === 'DESCRIPTION' && rawExpression(field.value)) continue;
    // Empty optional slots are technical scaffolding, not configured business settings.
    if (
      !present(field.value) &&
      !field.schema &&
      group[0] !== 'condition' &&
      !field.resource &&
      !['WELCOME_AUDIO', 'MENU_AUDIO', 'DESCRIPTION'].includes(field.key.toUpperCase())
    )
      continue;
    if (!groups.has(group[0])) groups.set(group[0], { id: group[0], title: group[1], fields: [] });
    groups.get(group[0]).fields.push(field);
  }
  const orderedGroups = [...groups.values()].sort(
    (a, b) => groupOrder.indexOf(a.id) - groupOrder.indexOf(b.id),
  );
  for (const group of orderedGroups) group.fields.sort(compareBusinessFields);
  const fields = orderedGroups.flatMap((group) => group.fields);
  const notes = [...nodeConfigurationNotes(node), ...summary.notes];
  return {
    title: audienceNodeTitle(node),
    groups: orderedGroups,
    fields,
    summary: summary.text,
    summaryComplete: summary.complete,
    notes,
    hiddenCount: sourceFields.length - fields.length,
  };
}

function rawValue(value, exists) {
  if (!exists) return 'Champ absent';
  if (value === '') return '""';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

/** Source data is strictly readonly; pending values are identified as uncommitted input. */
export function adminSourceDetails({ node, sourceNode, pending = {}, query = '' } = {}) {
  if (!node) return '<section class="admin-source"><p>Étape introuvable.</p></section>';
  const row = node.row || {},
    source = sourceNode?.row || null;
  const fields = [
    ...new Set([...Object.keys(source || {}), ...Object.keys(row), ...Object.keys(pending || {})]),
  ];
  const needle = text(query).trim().toLocaleLowerCase('fr-FR');
  const records = fields
    .map((key) => {
      const pendingValue = own(pending, key),
        localExists = pendingValue || own(row, key),
        local = pendingValue ? pending[key] : row[key];
      const sourceExists = Boolean(source && own(source, key));
      return {
        key,
        source: source ? rawValue(source[key], sourceExists) : 'Source indisponible',
        local: rawValue(local, localExists),
        pending: pendingValue,
        changed: Boolean(source && (sourceExists !== localExists || !same(source[key], local))),
        sourceExists,
        localExists,
      };
    })
    .filter((record) =>
      [record.key, record.source, record.local]
        .join(' ')
        .toLocaleLowerCase('fr-FR')
        .includes(needle),
    );
  const version =
    node.version ?? sourceNode?.version ?? text(node.tableName).match(/_v([\d.]+)$/i)?.[1];
  return `<section class="admin-source"><dl class="admin-source-meta"><div><dt>Table WOLF</dt><dd>${esc(node.tableName || sourceNode?.tableName || 'Non renseignée')}</dd></div><div><dt>Clé de la ligne</dt><dd>${esc(node.key ?? row.key ?? 'Non renseignée')}</dd></div><div><dt>Version</dt><dd>${esc(version ?? 'Non renseignée')}</dd></div></dl>${source ? '' : '<p class="admin-source-warning" role="status">La ligne source originale est indisponible. Les valeurs locales restent consultables ; aucune comparaison d’origine n’est supposée.</p>'}<label class="admin-source-search" for="admin-field-search">Rechercher un champ ou une valeur<input id="admin-field-search" type="search" value="${esc(query)}" placeholder="Nom du champ, valeur…"></label><div class="admin-source-table-wrap"><table class="admin-source-table"><thead><tr><th scope="col">Champ</th><th scope="col">Source originale</th><th scope="col">Valeur locale</th><th scope="col">État</th></tr></thead><tbody id="admin-source-fields">${records.map((record) => `<tr class="${record.pending ? 'is-pending' : record.changed ? 'is-changed' : ''}"><th scope="row"><code>${esc(record.key)}</code></th><td><code>${esc(record.source)}</code></td><td>${record.pending ? '<small class="admin-source-pending-label">Saisie non enregistrée</small>' : ''}<code>${esc(record.local)}</code></td><td>${record.pending ? 'À enregistrer' : record.changed ? (!record.sourceExists ? 'Ajouté' : !record.localExists ? 'Absent localement' : 'Brouillon') : source ? 'Identique' : 'Origine indisponible'}</td></tr>`).join('') || '<tr><td colspan="4">Aucun champ ne correspond à cette recherche.</td></tr>'}</tbody></table></div></section>`;
}

/** Sequence order is semantic, independent of JSON property order. */
export function compareBusinessFields(a, b) {
  const conditionOrder = ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_OPERATOR', 'DECISION_VALUE'];
  const rank = (field) => {
    const key = field.key.toUpperCase(),
      conditionIndex = conditionOrder.indexOf(key);
    if (key === 'DESCRIPTION') return -100;
    if (conditionIndex !== -1) return -90 + conditionIndex;
    return key.endsWith('_INIT') ? -10 : key === 'INQUEUE_REPEAT' ? 100 : 0;
  };
  return rank(a) - rank(b) || a.label.localeCompare(b.label, 'fr', { numeric: true });
}

/** Keep explicit zero/false values and in-progress clears visible. */
export function configuredStepFields(fields, pending = {}, onlyConfigured = true) {
  return onlyConfigured
    ? fields.filter(
        (field) =>
          field.key === 'DESCRIPTION' ||
          own(pending, field.key) ||
          (field.targetTypeKey && own(pending, field.targetTypeKey)) ||
          present(field.value),
      )
    : fields;
}

/** Division belongs to the journey, not to editable step settings. */
export function adminInspectorFields(node, section) {
  return businessFields(node)
    .filter(
      (f) =>
        f.key.toUpperCase() !== 'DIVISION' &&
        (!section || f.section === section) &&
        (f.schema ||
          f.resource ||
          f.key.toUpperCase() === 'DESCRIPTION' ||
          f.key === 'WELCOME_AUDIO' ||
          f.key === 'MENU_AUDIO' ||
          (f.value !== '' && f.value !== null && f.value !== undefined)),
    )
    .sort(compareBusinessFields);
}
