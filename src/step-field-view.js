import { messageEditorValue } from './media-profiles.js';
import { participantOptions } from './flow-data.js';
import {
  PARTICIPANT_CATALOGUE,
  catalogueRows,
  catalogueDefinition,
  participantOperators,
} from './participant-catalogue.js';
import { renderParticipantValue } from './participant-value-control.js';
import { decisionOperatorLabels, isWolfDecision as isV5Decision } from './decision-fields.js';
import { booleanSwitchSpec, booleanControl } from './boolean-control.js';
import { esc } from './ui-kit.js';
import { languageOptions } from './language-options.js';
import { resourceEditor } from './resource-editor.js';
import { referenceOptions, targetTablesFor, routeLabelsFor } from './v5-fields.js';
const text = (value) => (value == null ? '' : String(value));
const selected = (a, b) => (String(a ?? '') === String(b ?? '') ? ' selected' : '');
export function stepFieldView(
  field,
  index,
  {
    node,
    pending = {},
    snapshot,
    resourceStates,
    connected = false,
    admin = false,
    advanced = false,
  } = {},
) {
  if (field.resource)
    return resourceEditor(field, index, {
      node,
      pending,
      state: resourceStates?.get(field.resource.catalogue),
      connected,
    });
  const id = `field-${index}`,
    rule = field.schema || {},
    key = field.key;
  const value = Object.hasOwn(pending, key)
    ? pending[key]
    : key === 'DESCRIPTION'
      ? (field.editorValue ?? field.value)
      : field.kind === 'audio'
        ? text(field.value).replace(/^tts:/i, '')
        : field.kind === 'message'
          ? messageEditorValue(field.value)
          : field.value;
  const label = esc(field.label),
    required = field.required ? ' <span aria-label="obligatoire">*</span>' : '',
    attrs = `id="${id}" data-field="${esc(key)}" ${field.required ? 'required' : ''}`;
  const typedCatalogue = Boolean(
    snapshot?.source?.participantCatalogueRequired ||
      snapshot?.tables?.some((table) => table.name === PARTICIPANT_CATALOGUE),
  );
  const decision = isV5Decision(node),
    definition = decision
      ? catalogueDefinition(
          snapshot,
          pending.PARTICIPANT_DATA_TO_CHECK ?? node.row.PARTICIPANT_DATA_TO_CHECK,
        )
      : null;
  const operator = pending.DECISION_OPERATOR ?? node?.row?.DECISION_OPERATOR;
  let helper = rule.description || '',
    control = '',
    options = (
      field.options
        ? field.options.filter((v) => !Array.isArray(rule.enum) || rule.enum.includes(v))
        : rule.enum
    )?.map((v) => ({
      value: v,
      label:
        field.optionLabels?.[String(v)] ||
        (typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v)),
    }));
  if (field.kind === 'boolean' && !options)
    options = [
      { value: 'true', label: 'Oui' },
      { value: 'false', label: 'Non' },
    ];
  if (key === 'MENU_TIMEOUT' && !options)
    options = [3, 5, 7, 10, 12].map((v) => ({ value: v, label: `${v} secondes` }));
  if (key === 'LANGUAGE') options = languageOptions(rule, value);
  if (key === 'PARTICIPANT_DATA_TO_CHECK' && (typedCatalogue || !advanced)) {
    options = (
      typedCatalogue
        ? catalogueRows(snapshot).map((row) => ({ name: row.key, label: row.LABEL }))
        : participantOptions(snapshot)
    )
      .filter((o) => !Array.isArray(rule.enum) || rule.enum.includes(o.name))
      .map((o) => ({
        value: o.name,
        label: typedCatalogue
          ? admin && o.label !== o.name
            ? `${o.label} · ${o.name}`
            : o.label || o.name
          : o.name,
      }));
    if (typedCatalogue)
      helper = options.length
        ? 'Choisissez une donnée définie dans le catalogue administrateur.'
        : 'Aucune donnée disponible. Complétez le catalogue dans Administration.';
  }
  if (key === 'DECISION_OPERATOR' && definition)
    options = participantOperators(definition)
      .filter((value) => !Array.isArray(rule.enum) || rule.enum.includes(value))
      .map((value) => ({ value, label: decisionOperatorLabels[value] || value }));
  if (field.kind === 'local-reference') options = referenceOptions(field.localTable, snapshot);
  const composite = field.kind === 'route-type' || field.kind === 'route-target';
  let unavailableValueLabel = 'valeur actuelle',
    emptyOptionLabel = field.required ? 'Choisir…' : 'Non renseigné';
  if (composite) {
    const [base, ...extras] = text(value).split('|'),
      suffix = extras.length ? '|' + extras.join('|') : '';
    if (field.kind === 'route-type') {
      options = Object.entries(routeLabelsFor(node)).map(([type, label]) => ({
        // Recognize BOT / bot alike without rewriting an existing WOLF value.
        value: type === base.trim().toLowerCase() ? text(value) : type + suffix,
        label,
      }));
      helper =
        'Choisissez le type de la prochaine étape. La liste des destinations dépend de ce choix.';
    } else {
      const route = text(pending[field.targetTypeKey] ?? node.row[field.targetTypeKey])
          .split('|')[0]
          .trim()
          .toLowerCase(),
        tableName = targetTablesFor(node)[route];
      helper = 'Choisissez sa destination. Les paramètres associés sont conservés.';
      if (tableName) {
        const tables = (snapshot?.tables || []).filter(
          (t) => t.name.toUpperCase() === tableName.toUpperCase(),
        );
        options = referenceOptions(tableName, snapshot).map((o) => ({
          value: o.value + suffix,
          label: o.label.endsWith(' · ' + o.value)
            ? o.value + ' · ' + o.label.slice(0, -(' · ' + o.value).length)
            : o.value,
        }));
        emptyOptionLabel = 'Choisir une destination…';
        helper =
          tables.length !== 1
            ? `La table ${tableName} est ${tables.length ? 'ambiguë' : 'absente de la source chargée'}. Rechargez les données pour choisir une destination.`
            : !options.length
              ? `Aucune destination disponible dans ${tableName}. Ajoutez une configuration dans cette table, puis actualisez les données.`
              : `Clés exactes de ${tableName}. Les paramètres associés sont conservés.`;
        unavailableValueLabel = 'référence à vérifier';
        if (base && !options.some((o) => o.value === text(value)))
          helper += ` La référence actuelle « ${base} » ne figure pas dans cette liste : sélectionnez une clé exacte.`;
      } else if (!route || ['disconnect', 'next', 'enable', 'disable'].includes(route)) {
        options = [];
        emptyOptionLabel = route ? 'Aucune destination nécessaire' : 'Choisissez d’abord le type';
        helper = route
          ? 'Cette action ne nécessite pas de destination.'
          : 'Choisissez le type de la prochaine étape pour afficher ses destinations.';
        unavailableValueLabel = 'incompatible avec ce type';
      } else if (!Object.hasOwn(routeLabelsFor(node), route)) {
        options = [];
        emptyOptionLabel = 'Choisissez un type reconnu';
        helper = 'Le type de destination doit être reconnu avant de choisir sa destination.';
        unavailableValueLabel = 'référence à vérifier';
      } else options = undefined; // External destinations (phone, user...) keep their editor.
    }
    if (advanced && admin) {
      options = undefined;
      helper =
        field.kind === 'route-type'
          ? 'Format WOLF : type|sub:CONTROLE|lang:fr-fr|status:ON_QUEUE'
          : 'Format WOLF : destination|pdata:CLE_CONTEXTE. Les références seront vérifiées.';
    }
  }
  const switchSpec = booleanSwitchSpec(value, { kind: field.kind, key, schema: rule });
  if (!field.editable)
    control = `<output class="read-value" id="${id}">${esc(field.display)}</output>`;
  else if (decision && key === 'DECISION_VALUE' && ['exist', 'empty'].includes(operator)) {
    control = `<output class="read-value" id="${id}">Aucune valeur de comparaison nécessaire.</output>`;
    helper = 'Cette condition vérifie uniquement la présence de la donnée.';
  } else if (decision && key === 'DECISION_VALUE' && definition) {
    control = renderParticipantValue({
      definition,
      value: text(value),
      id,
      attrs,
      label: field.label,
      allowEmpty: false,
    });
    helper = 'La valeur doit respecter la définition du catalogue.';
  } else if (decision && key === 'DECISION_VALUE' && typedCatalogue) {
    control = `<output class="read-value" id="${id}">${esc(text(value)) || 'Non renseigné'}</output>`;
    helper = 'Sélectionnez une donnée du catalogue pour définir sa valeur de comparaison.';
  } else if (switchSpec && (!advanced || switchSpec.typed))
    control = booleanControl({
      id,
      attrs,
      value,
      spec: switchSpec,
      label: field.label,
      textAction: 'field-mode',
      key,
    });
  else if (options) {
    const normalized = field.kind === 'boolean' ? text(value).toLowerCase() : text(value);
    control = `<select ${attrs}><option value=""${selected(normalized, '')}>${esc(emptyOptionLabel)}</option>${normalized && !options.some((o) => String(o.value) === normalized) ? `<option value="${esc(normalized)}" selected disabled>${esc(normalized)} · ${esc(unavailableValueLabel)}</option>` : ''}${options.map((o) => `<option value="${esc(o.value)}"${selected(normalized, o.value)} ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (
    ['pdata', 'controls', 'json', 'audio', 'message', 'list'].includes(field.kind) ||
    (composite && advanced)
  ) {
    if (field.kind === 'pdata')
      helper =
        'Un attribut : nom==valeur. Plusieurs attributs : nom==valeur||autre==valeur. Les variables WOLF sont conservées.';
    if (field.kind === 'controls')
      helper = 'Contrôles exécutés dans cet ordre, séparés par ;. Exemple : CHECK_AGENT;CHECK_EWT.';
    if (field.kind === 'message')
      helper =
        'Saisissez le texte à afficher. Les références cr:, pr:, var: et img: existantes sont conservées.';
    if (field.kind === 'json') helper = 'Valeur structurée JSON conforme au schéma de cette table.';
    control = `<textarea ${attrs} rows="3">${esc(field.kind === 'json' && typeof value === 'object' ? JSON.stringify(value, null, 2) : text(value))}</textarea>`;
  } else
    control = `<input ${attrs} type="${field.kind === 'number' ? 'number' : 'text'}" ${field.kind === 'number' ? `step="${rule.type === 'integer' ? '1' : 'any'}" ${Number.isFinite(rule.minimum) ? `min="${rule.minimum}"` : ''} ${Number.isFinite(rule.maximum) ? `max="${rule.maximum}"` : ''}` : ''} ${Number.isInteger(rule.maxLength) ? `maxlength="${rule.maxLength}"` : ''} value="${esc(text(value))}">`;
  return `<div class="field span2"><label for="${id}">${label}${required}${admin ? ` <code class="field-source-key">${esc(key)}</code>` : ''}</label>${control}${helper ? `<span class="helper">${esc(helper)}</span>` : ''}${key === 'PARTICIPANT_DATA_TO_CHECK' && !typedCatalogue && admin && field.editable ? `<button type="button" class="btn quiet small" data-action="field-mode" data-field-key="${esc(key)}">${advanced ? 'Choisir un attribut connu' : 'Saisir un autre attribut'}</button>` : ''}${admin && composite && field.editable ? `<button type="button" class="btn quiet small" data-action="field-mode" data-field-key="${esc(key)}">${advanced ? 'Choisir dans la liste' : 'Modifier les paramètres WOLF'}</button>` : ''}</div>`;
}
