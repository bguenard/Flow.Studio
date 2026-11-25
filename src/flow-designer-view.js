import { isMessageNode, messageTextField, messageEditorValue } from './media-profiles.js';
import { booleanSwitchSpec, booleanControl } from './boolean-control.js';
import { esc, icon, btn, head, notice } from './ui-kit.js';
import { fieldLabel } from './draft-fields.js';
import { languageOptions } from './language-options.js';
import { resourceForField, resourceOptions } from './genesys-resources.js';
import { participantOperators } from './participant-catalogue.js';
import { renderParticipantValue } from './participant-value-control.js';
import { decisionOperatorLabels } from './decision-fields.js';

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) =>
  typeof value === 'boolean'
    ? value
      ? 'Oui'
      : 'Non'
    : value == null
      ? 'Non renseigné'
      : String(value);
const icons = {
  inboundcall: 'phone',
  menu: 'menu',
  segment: 'message',
  quickreplies: 'menu',
  carousel: 'layers',
  waitforinput: 'message',
  service: 'people',
  schedulegroup: 'clock',
  decision: 'diff',
  ratiodistrib: 'diff',
  bot: 'message',
  transfercallflow: 'link',
};
const descriptions = {
  inboundcall: 'Un numéro, un accueil et la première étape.',
  menu: 'Orienter l’appel avec les touches du téléphone.',
  quickreplies: 'Proposer des choix sous forme de boutons.',
  carousel: 'Présenter plusieurs cartes et leurs actions.',
  waitforinput: 'Recueillir une réponse écrite du client.',
  service: 'Distribuer les demandes à une équipe.',
  schedulegroup: 'Adapter le parcours aux horaires.',
  decision: 'Choisir une branche selon une condition.',
  ratiodistrib: 'Répartir les demandes entre plusieurs branches.',
  bot: 'Passer par un assistant conversationnel.',
  transfercallflow: 'Rejoindre un autre flow Genesys.',
};
const selected = (a, b) => (String(a ?? '') === String(b ?? '') ? ' selected' : '');
const fieldId = (key) =>
  'designer-value-' +
  Array.from(String(key))
    .map((c) => c.codePointAt(0).toString(16))
    .join('-');
const errorText = (error) => (typeof error === 'string' ? error : error?.message || '');
function input({
  id,
  label,
  value = '',
  helper = '',
  required = false,
  type = 'text',
  extra = '',
}) {
  return `<div class="designer-field"><label for="${id}">${esc(label)}${required ? ' <span aria-label="obligatoire">*</span>' : ''}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}>${helper ? `<small>${esc(helper)}</small>` : ''}</div>`;
}
function selector({
  id,
  label,
  value = '',
  options = [],
  placeholder = 'Choisir…',
  helper = '',
  required = false,
}) {
  return `<div class="designer-field"><label for="${id}">${esc(label)}${required ? ' <span aria-label="obligatoire">*</span>' : ''}</label><select id="${id}" name="${id}" ${required ? 'required' : ''}><option value=""${selected(value, '')}>${esc(placeholder)}</option>${options.map((option) => `<option value="${esc(option.value)}"${selected(value, option.value)} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}</option>`).join('')}</select>${helper ? `<small>${esc(helper)}</small>` : ''}</div>`;
}
function resourceField(field, form, entry, value, { resourceStates, connected } = {}) {
  const node = { tableName: entry.tableName },
    spec = resourceForField(field.key, node),
    id = fieldId(field.key);
  const state =
      resourceStates instanceof Map
        ? resourceStates.get(spec.catalogue)
        : resourceStates?.[spec.catalogue],
    ready = state?.status === 'ready';
  const options = resourceOptions(field, node, state?.entities || []),
    mode =
      form.audioModes?.[field.key] ||
      (/^pr:|^prompt:/i.test(String(value || '')) ? 'recorded' : 'tts');
  const selector = (current, slot = '') =>
    `<select id="${id}${slot}" name="designer-value" data-field="${esc(field.key)}" data-value-type="${spec.multiple ? 'skills' : 'string'}" ${ready ? '' : 'disabled'} ${field.required ? 'required' : ''}><option value=""${selected(current, '')}>${field.required ? 'Choisir une ressource' : 'Aucune ressource'}</option>${current && !options.some((o) => o.value === String(current)) ? `<option value="${esc(current)}" selected disabled>${esc(current)} · à vérifier</option>` : ''}${options.map((o) => `<option value="${esc(o.value)}"${selected(current, o.value)} ${o.disabled ? 'disabled' : ''}>${esc(o.label)}${o.disabled ? ' · référence ambiguë' : ''}</option>`).join('')}</select>`;
  const status =
    state?.status === 'loading'
      ? 'Chargement des ressources Genesys…'
      : state?.status === 'error'
        ? state.error
        : ready
          ? `${options.length} ${options.length > 1 ? 'ressources' : 'ressource'} Genesys · recherche par nom`
          : connected
            ? 'Liste Genesys à charger.'
            : 'Connectez-vous à Genesys pour choisir une ressource.';
  let control = spec.multiple
    ? Array.from(
        {
          length: Math.min(
            6,
            String(value || '')
              .split(';')
              .filter(Boolean).length + 1,
          ),
        },
        (_, i) =>
          `<label for="${id}-${i}">Compétence ${i + 1}</label>${selector(String(value || '').split(';')[i] || '', '-' + i)}`,
      ).join('')
    : selector(value || '');
  if (spec.audio) {
    const literal = /^tts:/i.test(String(value || '')) ? String(value).slice(4) : '';
    control =
      `<div class="segmented designer-audio-mode" role="group" aria-label="Type de message : ${esc(field.label || fieldLabel(field.key))}">${btn('Texte à lire', 'designer-audio-mode', mode === 'tts' ? 'active' : '', `data-field="${esc(field.key)}" data-mode="tts" aria-pressed="${mode === 'tts'}"`)}${btn('Message enregistré', 'designer-audio-mode', mode === 'recorded' ? 'active' : '', `data-field="${esc(field.key)}" data-mode="recorded" aria-pressed="${mode === 'recorded'}"`)}</div>` +
      (mode === 'tts'
        ? `<textarea id="${id}" name="designer-value" data-field="${esc(field.key)}" data-value-type="audio-tts" rows="3" ${field.required ? 'required' : ''} placeholder="Saisissez le message à lire…">${esc(literal)}</textarea>`
        : control);
  }
  return `<div class="designer-field designer-resource"><label for="${spec.multiple ? id + '-0' : id}">${esc(field.label || fieldLabel(field.key))}${field.required ? ' <span aria-label="obligatoire">*</span>' : ''}</label>${control}${!spec.audio || mode === 'recorded' ? `<small role="status">${esc(status)}</small>${connected ? btn(ready ? 'Actualiser la liste' : 'Charger la liste Genesys', 'designer-resource-load', 'quiet small', `data-kind="${spec.catalogue}" ${state?.status === 'loading' ? 'disabled' : ''}`) : ''}` : ''}</div>`;
}
function schemaField(field, form, entry, context) {
  const rule = field.schema || {},
    value = Object.hasOwn(form.values || {}, field.key)
      ? form.values[field.key]
      : (field.default ?? rule.default);
  if (resourceForField(field.key, { tableName: entry.tableName }))
    return resourceField(field, form, entry, value, context);
  const type = Array.isArray(rule.type)
      ? rule.type.find((t) => t !== 'null')
      : rule.type || 'string',
    id = fieldId(field.key),
    label = field.label || fieldLabel(field.key);
  const attrs = `id="${id}" name="designer-value" data-field="${esc(field.key)}" data-value-type="${esc(type)}" ${field.required ? 'required' : ''}`;
  let options =
    field.key === 'LANGUAGE'
      ? languageOptions(rule, value)
      : type === 'boolean'
        ? [
            { value: 'true', label: 'Oui' },
            { value: 'false', label: 'Non' },
          ]
        : list(rule.enum).map((v) => ({
            value: String(v),
            label:
              field.key === 'DECISION_OPERATOR' ? decisionOperatorLabels[v] || text(v) : text(v),
          }));
  const decision = entry.type === 'decision',
    participantData = context?.participantData,
    definitions = participantData?.definitions || [];
  const effective = (key) =>
    Object.hasOwn(form.values || {}, key)
      ? form.values[key]
      : (entry.fields.find((f) => f.key === key)?.default ??
        entry.fields.find((f) => f.key === key)?.schema?.default);
  const definition = definitions.find((d) => d.key === effective('PARTICIPANT_DATA_TO_CHECK')),
    operator = effective('DECISION_OPERATOR');
  const participantSelect =
    decision && field.key === 'PARTICIPANT_DATA_TO_CHECK' && participantData?.required;
  if (participantSelect)
    options = definitions
      .filter((d) => !Array.isArray(rule.enum) || rule.enum.includes(d.key))
      .map((d) => ({ value: d.key, label: d.LABEL || d.key }));
  if (decision && field.key === 'DECISION_OPERATOR' && definition)
    options = participantOperators(definition)
      .filter((v) => !Array.isArray(rule.enum) || rule.enum.includes(v))
      .map((value) => ({ value, label: decisionOperatorLabels[value] || value }));
  const switchSpec = booleanSwitchSpec(value, { kind: type, key: field.key, schema: rule });
  let control;
  if (decision && field.key === 'DECISION_VALUE' && ['exist', 'empty'].includes(operator))
    control = `<output id="${id}" class="read-value">Aucune valeur de comparaison nécessaire.</output>`;
  else if (decision && field.key === 'DECISION_VALUE' && definition)
    control = renderParticipantValue({
      definition,
      value: value == null ? '' : String(value),
      id,
      attrs,
      label,
      allowEmpty: false,
    });
  else if (decision && field.key === 'DECISION_VALUE' && participantData?.required)
    control = `<output id="${id}" class="read-value">Sélectionnez une donnée du catalogue.</output>`;
  else if (switchSpec && (!form.booleanTextFields?.includes(field.key) || switchSpec.typed))
    control = booleanControl({
      id,
      attrs,
      value,
      spec: switchSpec,
      label,
      textAction: 'designer-boolean-text',
      key: field.key,
    });
  else if (options.length || participantSelect)
    control = `<select ${attrs}><option value=""${selected(value, '')}>${field.required ? 'Choisir…' : 'Non renseigné'}</option>${value && !options.some((o) => String(o.value) === String(value)) ? `<option value="${esc(value)}" selected disabled>${esc(value)} · à vérifier</option>` : ''}${options.map((option) => `<option value="${esc(option.value)}"${selected(value, option.value)} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}</option>`).join('')}</select>`;
  else if (['integer', 'number'].includes(type))
    control = `<input ${attrs} type="number" value="${esc(value ?? '')}" step="${type === 'integer' ? '1' : 'any'}" ${Number.isFinite(rule.minimum) ? `min="${rule.minimum}"` : ''} ${Number.isFinite(rule.maximum) ? `max="${rule.maximum}"` : ''}>`;
  else if (isMessageNode({ tableName: entry.tableName }) && messageTextField(field.key))
    control = `<textarea id="${id}" name="designer-value" data-field="${esc(field.key)}" data-value-type="message" rows="3">${esc(messageEditorValue(value))}</textarea>`;
  else
    control = `<input ${attrs} type="text" value="${esc(value ?? '')}" ${Number.isInteger(rule.maxLength) ? `maxlength="${rule.maxLength}"` : ''}>`;
  return `<div class="designer-field"><label for="${id}">${esc(label)}${field.required ? ' <span aria-label="obligatoire">*</span>' : ''}</label>${control}${rule.description ? `<small>${esc(rule.description)}</small>` : ''}</div>`;
}
function schemaFields(entry, form, { create = false, ...context } = {}) {
  const fields = list(entry?.fields).filter(
    (f) => !['DESCRIPTION', 'key'].includes(f.key) && (!create || f.key !== 'DIVISION'),
  );
  const required = fields.filter((f) => f.required),
    optional = fields.filter((f) => !f.required);
  return `${required.length ? `<section class="designer-section"><div class="designer-section-title">${icon('shield')}<div><h2>Réglages nécessaires</h2><p>Ces valeurs sont requises par la table WOLF sélectionnée.</p></div></div><div class="designer-fields">${required.map((f) => schemaField(f, form, entry, context)).join('')}</div></section>` : ''}${optional.length ? `<details class="designer-optional"><summary>Réglages complémentaires <span>${optional.length}</span></summary><p>Vous pourrez aussi les ajuster dans les réglages de l’étape.</p><div class="designer-fields">${optional.map((f) => schemaField(f, form, entry, context)).join('')}</div></details>` : ''}`;
}
function palette(catalogue, form) {
  return `<aside class="designer-palette"><div class="eyebrow">BIBLIOTHÈQUE WOLF</div><h2>Quel bloc ajouter ?</h2><div class="designer-block-list">${catalogue
    .filter((c) => !['inboundcall', 'segment'].includes(c.type))
    .map(
      (entry) =>
        `<button class="designer-block ${(Boolean(form.tableId) && entry.tableId === form.tableId) || (!form.tableId && entry.type === form.type) ? 'selected' : ''}" data-action="designer-type" data-type="${esc(entry.type)}" data-table="${esc(entry.tableId || '')}" aria-pressed="${(Boolean(form.tableId) && entry.tableId === form.tableId) || (!form.tableId && entry.type === form.type)}" ${entry.available === false ? 'disabled' : ''}><span class="designer-block-icon">${icon(icons[entry.type] || 'layers')}</span><span><strong>${esc(entry.label)}</strong><small>${esc(entry.available === false ? entry.reason || 'Table WOLF indisponible' : descriptions[entry.type] || entry.tableName)}</small></span>${entry.available !== false ? icon('chevron') : ''}</button>`,
    )
    .join('')}</div></aside>`;
}
function identity(mode, entry, form, catalogue, context) {
  const create = mode === 'create',
    entries = catalogue.filter(
      (c) => ['inboundcall', 'segment'].includes(c.type) && c.available !== false,
    );
  return `<section class="designer-section"><div class="designer-section-title">${icon(create ? 'phone' : icons[entry?.type] || 'layers')}<div><h2>${create ? 'Identifier le parcours' : 'Nom de cette étape'}</h2><p>${create ? (form.media === 'messaging' ? 'Le segment identifie le parcours. Plusieurs points d’entrée peuvent le réutiliser.' : 'Le numéro identifie l’entrée WOLF. Le nom permet à votre équipe de la retrouver.') : esc(entry?.label || 'Nouveau bloc')}</p></div></div><div class="designer-fields">${input({ id: 'designer-name', label: create ? 'Nom du parcours' : 'Nom de l’étape', value: form.name, required: true, extra: 'autocomplete="off"' })}${create ? input({ id: 'designer-phone', label: form.media === 'messaging' ? 'Segment d’entrée' : 'Numéro d’entrée', value: form.phone, type: form.media === 'messaging' ? 'text' : 'tel', required: true, helper: form.media === 'messaging' ? 'Clé utilisée par INITIAL_SEGMENT ou par le nom du déploiement Messenger.' : 'Format international, par exemple +33123456789.', extra: 'autocomplete="off"' }) : input({ id: 'designer-key', label: 'Identifiant de l’étape', value: form.key, required: true, helper: 'Une clé unique dans la table WOLF de ce bloc.', extra: 'autocomplete="off"' })}${create && entry?.divisionSchema ? resourceField({ key: 'DIVISION', label: 'Division', required: Boolean(entry.divisionRequired) }, form, entry, form.division, context) : ''}${create && entries.length > 1 ? selector({ id: 'designer-table', label: 'Table d’entrée V5', value: form.tableId, options: entries.map((c) => ({ value: c.tableId, label: c.tableName })), required: true }) : ''}</div></section>`;
}
function insertion(entry, form, options) {
  const placement = list(options.placements).find((p) => p.id === form.placementId),
    outlets = list(entry?.outlets);
  return `<section class="designer-section"><div class="designer-section-title">${icon('link')}<div><h2>Placer le bloc dans le parcours</h2><p>Choisissez une branche, puis la sortie du nouveau bloc qui reprend sa suite.</p></div></div><div class="designer-fields">${selector({ id: 'designer-placement', label: 'Après quelle étape et quelle branche ?', value: form.placementId, options: list(options.placements).map((p) => ({ value: p.id, label: p.label })), required: true, placeholder: 'Choisir la branche à modifier' })}${selector({ id: 'designer-continuation', label: 'Sortie qui conserve la suite actuelle', value: form.continuationField, options: outlets.map((o) => ({ value: o.field, label: o.label })), required: true, placeholder: 'Choisir la sortie du nouveau bloc' })}</div>${placement ? `<div class="designer-route-preview"><span>${esc(placement.label)}</span>${icon('chevron')}<strong>${esc(form.name || entry?.label || 'Nouveau bloc')}</strong>${icon('chevron')}<span>Suite actuelle conservée</span></div>` : ''}<p class="designer-note">${options.media === 'messaging' ? 'Les boutons sans libellé ne sont pas proposés. Les autres sorties doivent être vérifiées avant publication.' : 'Les autres sorties non renseignées termineront l’appel.'} Vous pourrez les raccorder à d’autres blocs après l’ajout.</p></section>`;
}
function routeEditor(form, options) {
  const destinations = list(options.destinations).map((d) => ({ value: d.nodeId, label: d.label }));
  const placement =
    list(options.placements).find((p) => p.fromId === form.nodeId && p.field === form.field) ||
    list(options.placements).find((p) => p.id === form.placementId);
  const destination =
    typeof form.destination === 'string'
      ? form.destination
      : form.destination?.nodeId ||
        (form.destination?.type ? 'terminal:' + form.destination.type : '');
  return `<section class="designer-section"><div class="designer-section-title">${icon('link')}<div><h2>Modifier la suite d’une branche</h2><p>La destination choisie remplace celle de cette branche.</p></div></div><div class="designer-fields">${selector({ id: 'designer-route', label: 'Étape et branche à raccorder', value: placement?.id || form.placementId, options: list(options.placements).map((p) => ({ value: p.id, label: p.label })), required: true })}${selector({ id: 'designer-destination', label: 'Nouvelle destination', value: destination, options: [...destinations, { value: 'terminal:disconnect', label: options.media === 'messaging' ? 'Terminer la conversation' : 'Terminer l’appel' }, ...(list(options.returnAllowedNodes).includes(placement?.fromId) ? [{ value: 'terminal:next', label: 'Revenir au cycle d’attente' }] : [])], required: true })}</div>${placement ? `<div class="designer-current-route"><small>Destination actuelle</small><strong>${esc(placement.currentTarget || placement.currentType || 'Non renseignée')}</strong></div>` : ''}</section>`;
}
/** Retirer un bloc : lequel, et où vont désormais les branches qui y menaient. */
function removalEditor(form, options) {
  const removals = list(options.removals),
    removal = removals.find((r) => r.nodeId === form.removeNodeId),
    end = options.media === 'messaging' ? 'Terminer la conversation' : 'Terminer l’appel';
  const destinations = removal
    ? [
        ...list(removal.outlets).map((o) => ({
          value: 'outlet:' + o.field,
          label: `Suite du bloc · ${o.label}${o.target ? ' → ' + o.target : ''}`,
        })),
        ...list(options.destinations)
          .filter((d) => d.nodeId !== removal.nodeId)
          .map((d) => ({ value: d.nodeId, label: d.label })),
        { value: 'terminal:disconnect', label: end },
      ]
    : [];
  const incoming = list(removal?.incoming);
  return `<section class="designer-section"><div class="designer-section-title">${icon('link')}<div><h2>Retirer un bloc du parcours</h2><p>Les branches qui menaient à ce bloc reçoivent la destination choisie. Sa ligne reste dans sa table : rien n’est supprimé dans Genesys.</p></div></div><div class="designer-fields">${selector({ id: 'designer-remove-node', label: 'Bloc à retirer', value: form.removeNodeId, options: removals.map((r) => ({ value: r.nodeId, label: r.label })), required: true, placeholder: removals.length ? 'Choisir le bloc' : 'Aucun bloc à retirer' })}${removal && !removal.blocked ? selector({ id: 'designer-remove-destination', label: 'Où envoyer ce qui arrivait à ce bloc ?', value: form.removeTo, options: destinations, required: true, placeholder: 'Choisir la nouvelle destination' }) : `<div class="designer-field"><label for="designer-remove-destination">Où envoyer ce qui arrivait à ce bloc ?</label><select id="designer-remove-destination" name="designer-remove-destination" disabled><option value="">${removal ? 'Retrait impossible depuis cet écran' : 'Choisissez d’abord le bloc'}</option></select></div>`}</div>${removal?.blocked ? `<p class="designer-note" role="status">${esc(removal.blocked)}</p>` : ''}${incoming.length && !removal.blocked ? `<div class="designer-current-route"><small>${incoming.length > 1 ? 'Branches raccordées ailleurs' : 'Branche raccordée ailleurs'}</small>${incoming.map((link) => `<strong>${esc(link.label)}</strong>`).join('')}</div>` : ''}</section>`;
}
function planReview(plan, mode) {
  const created = list(plan?.createdRows),
    updated = list(plan?.updatedRows),
    removed = list(plan?.summary?.removed),
    notices = list(plan?.summary?.notices);
  const rowCards = created.map((entry) => ({
    kind: 'Nouvelle étape',
    title: entry.row?.DESCRIPTION || entry.row?.key || 'Nouvelle étape',
    table: entry.tableName || entry.table?.name,
    fields: Object.entries(entry.row || {}),
  }));
  for (const entry of updated) {
    const before = entry.node?.row || entry.before || {},
      after = entry.row || entry.after || {};
    rowCards.push({
      kind: 'Raccordement modifié',
      title:
        after.DESCRIPTION || before.DESCRIPTION || after.key || before.key || 'Étape existante',
      table: entry.node?.tableName || entry.tableName,
      fields: Object.entries(after).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key]),
      ),
      before,
    });
  }
  return `<section class="designer-review"><div class="designer-section-title">${icon('circlecheck')}<div><h2>${mode === 'create' ? 'Votre nouveau parcours' : 'Vérifier les changements'}</h2><p>${created.length} étape(s) créée(s) · ${updated.length} étape(s) mise(s) à jour${removed.length ? ` · ${removed.length} étape(s) retirée(s)` : ''}</p></div></div>${removed.map((step) => `<article class="designer-review-card"><header><span>Retiré du parcours</span><h3>${esc(step.title)}</h3>${step.tableName ? `<small>${esc(step.tableName)}</small>` : ''}</header></article>`).join('')}${rowCards.map((row) => `<article class="designer-review-card"><header><span>${esc(row.kind)}</span><h3>${esc(row.title)}</h3>${row.table ? `<small>${esc(row.table)}</small>` : ''}</header><dl>${row.fields.map(([key, value]) => `<div><dt>${esc(fieldLabel(key))}</dt><dd>${row.before ? `<span class="designer-before">${esc(text(row.before[key]))}</span>${icon('chevron')}` : ''}<strong>${esc(text(value))}</strong></dd></div>`).join('')}</dl></article>`).join('')}${notices.map((n) => notice(esc(errorText(n)), 'warning')).join('')}<p class="designer-note">Les changements sont préparés dans le parcours. Leur publication dans Genesys se fait depuis « Mes changements ».</p></section>`;
}

/** Pure HTML: caller owns form state, engine plans and publication. */
export function designerView({
  mode = 'create',
  flow,
  options = {},
  form = {},
  plan = null,
  review = false,
  error = '',
  resourceStates,
  connected = false,
} = {}) {
  const catalogue = list(options.catalogue),
    entry = catalogue.find((c) =>
      form.tableId
        ? c.tableId === form.tableId
        : c.type ===
          (mode === 'create'
            ? form.media === 'messaging'
              ? 'segment'
              : 'inboundcall'
            : form.type),
    );
  const title =
    mode === 'create'
      ? 'Créer un parcours'
      : mode === 'connect'
        ? 'Raccorder les étapes'
        : mode === 'remove'
          ? 'Retirer un bloc'
          : 'Ajouter un bloc';
  const errors = [error, ...list(plan?.errors)].map(errorText).filter(Boolean),
    removal = list(options.removals).find((r) => r.nodeId === form.removeNodeId),
    available =
      mode === 'connect' ||
      (mode === 'remove'
        ? Boolean(removal && !removal.blocked)
        : Boolean(entry && entry.available !== false));
  const body =
    review && plan?.ok
      ? planReview(plan, mode)
      : mode === 'connect'
        ? routeEditor(form, options)
        : mode === 'remove'
          ? removalEditor(form, options)
          : available
            ? identity(mode, entry, form, catalogue, { resourceStates, connected }) +
              (mode === 'insert'
                ? insertion(entry, form, options)
                : '<div class="designer-start"><span>' +
                  icon('phone') +
                  ' Entrée du parcours</span>' +
                  icon('chevron') +
                  (form.media === 'messaging'
                    ? '<span>Fin de conversation</span><p>Ajoutez ensuite vos blocs. Le raccordement du site à Web Messenger reste à configurer dans Genesys.</p></div>'
                    : '<span>Fin d’appel</span><p>Ajoutez ensuite vos blocs. La création du parcours ne provisionne pas le numéro téléphonique dans Genesys.</p></div>')) +
              schemaFields(entry, form, {
                create: mode === 'create',
                resourceStates,
                connected,
                participantData: options.participantData,
              })
            : `<div class="designer-placeholder">${icon('layers')}<h2>${mode === 'insert' ? 'Choisissez un bloc pour commencer' : 'Table d’entrée indisponible'}</h2><p>${esc(entry?.reason || (mode === 'insert' ? 'La bibliothèque affiche les types V5 disponibles dans votre organisation.' : form.media === 'messaging' ? 'La table W_INBOUND_MESSAGE_v1 et son schéma doivent être accessibles.' : 'La table W_INBOUND_CALL_v5 et son schéma doivent être accessibles.'))}</p></div>`;
  return `${head(form.media === 'messaging' ? 'DESIGNER MESSAGING' : 'DESIGNER WOLF V5', title, mode === 'create' ? (form.media === 'messaging' ? 'Web Messaging · parcours indépendant de ses points d’entrée.' : 'Construisez un parcours à partir de son numéro d’entrée.') : flow?.name || flow?.key || 'Le parcours', btn(icon('close') + ' Fermer', 'designer-cancel', 'secondary'))}<section class="flow-designer"><ol class="designer-progress" aria-label="Étapes de préparation"><li class="${!review ? 'active' : ''}"><span>1</span>${mode === 'create' ? 'Définir le parcours' : 'Configurer le changement'}</li><li class="${review ? 'active' : ''}"><span>2</span>${mode === 'remove' ? 'Vérifier et retirer' : 'Vérifier et ajouter'}</li></ol>${errors.length ? `<div class="designer-errors" role="alert">${icon('alert')}<div><strong>Quelques points restent à préciser</strong><ul>${[...new Set(errors)].map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>` : ''}<div class="designer-workspace ${mode === 'insert' && !review ? 'has-palette' : ''}">${mode === 'insert' && !review ? palette(catalogue, form) : ''}<div class="designer-main">${body}</div></div><footer class="designer-footer"><div>${icon(review ? 'shield' : 'layers')}<span>${review ? 'Le parcours sera modifiable avant publication.' : 'Préparez les étapes et leurs raccordements.'}</span></div><div>${review ? btn('Modifier les choix', 'designer-edit', 'secondary') : btn('Annuler', 'designer-cancel', 'quiet')}${review ? btn(mode === 'create' ? 'Créer le parcours' : 'Appliquer au parcours', 'designer-apply', 'primary', !plan?.ok || errors.length ? 'disabled' : '') : btn('Vérifier le résultat', 'designer-review', 'primary', !available ? 'disabled' : '')}</div></footer></section>`;
}
