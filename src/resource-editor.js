import { resourceOptions } from './genesys-resources.js';
import { esc } from './ui-kit.js';

export function resourceEditor(field, index, { node, pending, state, connected } = {}) {
  const spec = field.resource,
    saved = String(field.value ?? ''),
    edit = pending?.[field.key];
  const resourceEdit = edit && typeof edit === 'object' && Object.hasOwn(edit, 'resource');
  const value = resourceEdit ? edit.resource : saved;
  const options = resourceOptions(field, node, state?.entities);
  const ready = state?.status === 'ready';
  const select = (id, current, attrs = '') =>
    `<select id="${id}" ${attrs} ${field.required ? 'required' : ''} ${ready ? '' : 'disabled'}><option value="__keep__" ${current === '__keep__' ? 'selected' : ''}>Conserver : ${esc(field.display)}</option><option value="" ${current === '' ? 'selected' : ''}>${field.required ? 'Choisir…' : 'Aucune ressource'}</option>${current && current !== '__keep__' && !options.some((o) => o.value === current) ? `<option value="${esc(current)}" selected disabled>${esc(current)} · valeur actuelle</option>` : ''}${options.map((option) => `<option value="${esc(option.value)}" ${option.disabled ? 'disabled' : ''} ${option.value === current ? 'selected' : ''}>${esc(option.label)}${option.disabled ? ' · référence ambiguë' : ''}</option>`).join('')}</select>`;
  let control = '';
  if (spec.multiple) {
    const values = value ? value.split(';') : [];
    control = `<div class="resource-skills">${Array.from({ length: Math.min(6, values.length + 1) }, (_, slot) => `<label for="resource-${index}-${slot}">Compétence ${slot + 1}</label>${select(`resource-${index}-${slot}`, values[slot] || '', `data-skill-field="${esc(field.key)}"`)}`).join('')}</div>`;
  } else
    control = select(
      `resource-${index}`,
      resourceEdit ? value : '__keep__',
      `data-resource-field="${esc(field.key)}"`,
    );
  const literal =
    typeof edit === 'string'
      ? edit
      : /^tts:/i.test(saved) && !saved.includes('|') && !/\$?var:/i.test(saved)
        ? saved.slice(4)
        : saved === ''
          ? ''
          : null;
  const textMode = !resourceEdit && literal !== null;
  if (spec.audio) {
    const modes = `<div class="segmented audio-mode" role="group" aria-label="Type de message : ${esc(field.label)}"><button type="button" data-action="resource-tts" data-field-key="${esc(field.key)}" aria-pressed="${textMode}">Texte à lire (TTS)</button><button type="button" data-action="resource-recorded" data-field-key="${esc(field.key)}" aria-pressed="${!textMode}">Message enregistré</button></div>`;
    control =
      modes +
      (textMode
        ? `<label for="field-${index}">Texte à lire</label><textarea id="field-${index}" data-field="${esc(field.key)}" rows="4" placeholder="Saisissez le message à lire…">${esc(literal)}</textarea>`
        : `<label for="resource-${index}">Message enregistré</label>${control}`);
  }
  if (spec.external)
    control = `<label for="resource-${index}">Bot Genesys Cloud</label>${control}<button type="button" class="btn quiet small" data-action="resource-external" data-field-key="${esc(field.key)}">Utiliser un bot externe</button>${edit && typeof edit === 'object' && Object.hasOwn(edit, 'external') ? `<label for="external-${index}">Identifiant du bot externe</label><input id="external-${index}" data-external-field="${esc(field.key)}" value="${esc(edit.external)}"><span class="helper">Identifiant utilisé par les Data Actions de ce parcours.</span>` : ''}`;
  const status =
    state?.status === 'loading'
      ? 'Chargement des ressources Genesys…'
      : state?.status === 'error'
        ? state.error
        : ready
          ? `${options.length} ${options.length > 1 ? 'ressources' : 'ressource'} Genesys · recherche par nom`
          : connected
            ? 'Liste Genesys à charger.'
            : 'Connectez-vous à Genesys pour charger la liste.';
  return `<div class="field span2 resource-field"><label for="${spec.multiple ? `resource-${index}-0` : spec.audio && literal !== null && !resourceEdit ? `field-${index}` : `resource-${index}`}">${esc(field.label)}${field.required ? ' <span aria-label="obligatoire">*</span>' : ''}</label>${!spec.audio ? `<span class="helper">Valeur actuelle : ${esc(field.display)}</span>` : ''}${control}${!spec.audio || !textMode ? `<span class="helper" role="status">${esc(status)}</span>${connected ? `<button type="button" class="btn quiet small" data-action="resource-load" data-kind="${spec.catalogue}" ${state?.status === 'loading' ? 'disabled' : ''}>${ready ? 'Actualiser la liste' : 'Charger la liste Genesys'}</button>` : '<button type="button" class="btn quiet small" data-action="nav" data-view="settings">Connexion Genesys</button>'}` : ''}</div>`;
}

export function audioModeEdit(saved, edit, mode) {
  const value = String(saved ?? '');
  if (mode === 'tts')
    return typeof edit === 'string'
      ? edit
      : /^tts:/i.test(value) && !/[|]|\$?var:/i.test(value)
        ? value.slice(4)
        : '';
  if (edit && typeof edit === 'object' && Object.hasOwn(edit, 'resource')) return edit;
  // Returning to the recorded mode can restore an existing message, but never
  // silently flatten compound WOLF audio into a single prompt.
  if (/^(?:pr|prompt):[^|]+$/i.test(value)) return { resource: value };
  // Without a typed replacement, a compound or dynamic message is already shown in this mode:
  // re-selecting it must not queue an empty value.
  return edit === undefined && value !== '' && !/^tts:[^|]*$/i.test(value)
    ? undefined
    : { resource: '' };
}
