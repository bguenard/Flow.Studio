import { renderParticipantValue } from './participant-value-control.js';
import { esc, head, btn, icon, notice } from './ui-kit.js';
import { humanText } from './business.js';

/** The business screen consumes administrator definitions; it never creates one. */
export function flowDataView(state, title, { catalogue, busy = false } = {}) {
  const { model, values, additions, review } = state;
  const error = state.error
    ? `<div class="error-box flow-data-error" role="alert" tabindex="-1">${esc(state.error)}</div>`
    : '';
  const definition = (name) => model.catalogue?.rows.find((row) => row.key === name);
  const nameLabel = (name) => definition(name)?.LABEL || humanText(name) || name;
  const adminLink = btn('Gérer le catalogue', 'participant-admin-open', 'quiet small');
  const intro =
    head(
      'Configuration du parcours',
      'Données du parcours',
      title,
      btn('Retour au parcours', 'flow-data-close', 'secondary'),
    ) +
    (model.dedicated
      ? ''
      : notice(
          `L’initialisation par numéro doit être activée avant d’enregistrer des valeurs. ${btn('Initialisation par numéro', 'initialization-open', 'secondary small')}`,
          'warning',
        ));
  const options = model.options.filter((o) => o.catalogued);
  const cataloguePanel =
    catalogue?.status === 'missing'
      ? notice(
          `Le catalogue doit être créé par un administrateur avant d’ajouter une donnée. ${adminLink}`,
          'warning',
        )
      : catalogue?.status === 'error'
        ? `<section class="flow-data-card flow-catalogue-panel" role="alert"><h2>Catalogue indisponible</h2><p>${esc(catalogue.error)}</p>${btn('Réessayer', 'participant-catalogue-reload', 'secondary')}${adminLink}</section>`
        : model.catalogue
          ? `<div class="flow-catalogue-source">Catalogue partagé · ${model.catalogue.rows.length} donnée${model.catalogue.rows.length > 1 ? 's' : ''} ${adminLink}<br>Les types et les choix autorisés sont définis par votre administrateur.</div>`
          : `<div class="flow-catalogue-source">Les définitions du catalogue sont nécessaires pour ajouter ou modifier une donnée. ${adminLink}</div>`;
  if (review)
    return (
      intro +
      `<section class="flow-data-card"><h2>Vérifier l’initialisation</h2><p>${review.updatedRows.length} configuration(s) à modifier · ${review.createdRows.length} configuration(s) à créer.</p>${review.summary.notices.map((n) => notice(esc(n))).join('')}<div class="flow-data-review">${model.items
        .filter((i) => Object.hasOwn(values, i.id) && values[i.id] !== i.value)
        .map(
          (i) =>
            `<p><strong>${esc(nameLabel(i.name))}</strong><span>${esc(i.value || '(vide)')} → ${esc(values[i.id] || '(vide)')}</span></p>`,
        )
        .join(
          '',
        )}${additions.map((a) => `<p><strong>${esc(nameLabel(a.name))}</strong><span>Valeur initiale : ${esc(a.value || '(vide)')}</span></p>`).join('')}</div><p class="helper">Les valeurs des autres parcours ne sont pas modifiées.</p>${error}<div class="flow-data-actions">${btn('Modifier', 'flow-data-edit', 'secondary')}${btn('Enregistrer le brouillon', 'flow-data-save', 'primary', review.createdRows.length + review.updatedRows.length ? '' : 'disabled')}</div></section>`
    );
  return (
    intro +
    cataloguePanel +
    `<div class="flow-data-layout"><section class="flow-data-card"><div class="flow-data-heading">${icon('database')}<div><h2>Valeurs à l’entrée du parcours</h2><p>Choisissez une donnée du catalogue et renseignez sa valeur pour ce parcours.</p></div></div><div class="flow-data-timing">Entrée du parcours <span>→</span> Initialisation des données <span>→</span> Première étape</div>${
      model.items.length
        ? model.items
            .map((item, index) => {
              const id = 'init-existing-' + index,
                value = Object.hasOwn(values, item.id) ? values[item.id] : item.value,
                def = definition(item.name);
              const control = item.dynamic
                ? `<output id="${id}" class="read-value">${esc(item.value)}</output><small>Valeur calculée à l’exécution · modification en Administration.</small>`
                : def
                  ? renderParticipantValue({
                      definition: def,
                      value,
                      id,
                      attrs: `id="${id}" data-init-id="${esc(item.id)}"`,
                      label: 'Valeur initiale de ' + nameLabel(item.name),
                    })
                  : `<output id="${id}" class="read-value">${esc(value || '(vide)')}</output><small>Donnée existante non référencée. L’administrateur doit la définir dans le catalogue avant modification.</small>`;
              return `<article class="flow-data-item"><div><strong>${esc(nameLabel(item.name))}</strong>${!def ? `<code>${esc(item.name)}</code>` : ''}${model.items.some((other, j) => j > index && other.name === item.name) ? '<small>Remplacé par une affectation suivante</small>' : ''}</div><div class="field"><label for="${id}">Valeur initiale</label>${control}</div></article>`;
            })
            .join('')
        : '<p class="helper">Aucune donnée n’est enregistrée pour ce numéro dans la table dédiée.</p>'
    }
 ${additions
   .map((a, i) => {
     const id = 'init-new-' + i,
       def = definition(a.selection),
       unavailable = a.selection && !options.some((o) => o.name === a.selection);
     return `<article class="flow-data-item new"><div class="field"><label for="${id}-name">Donnée à initialiser</label><select id="${id}-name" data-init-new="${i}" data-init-part="selection"><option value="">Choisir une donnée…</option>${unavailable ? `<option value="${esc(a.selection)}" selected disabled>Donnée non disponible : ${esc(a.selection)}</option>` : ''}${options.map((o) => `<option value="${esc(o.name)}" ${a.selection === o.name ? 'selected' : ''}>${esc(o.label || o.name)}</option>`).join('')}</select><small>Les noms et les types sont gérés dans le catalogue administrateur.</small></div><div class="field"><label for="${id}">Valeur initiale</label>${def ? renderParticipantValue({ definition: def, value: a.value, id, attrs: `id="${id}" data-init-new="${i}" data-init-part="value"`, label: 'Valeur initiale de ' + nameLabel(a.selection) }) : `<input id="${id}" value="" disabled placeholder="Choisissez d’abord une donnée" aria-label="Valeur initiale">`}<div class="flow-data-actions">${btn('Retirer', 'flow-data-remove', 'quiet small', `data-index="${i}" aria-label="Retirer la nouvelle donnée ${i + 1}"`)}</div></div></article>`;
   })
   .join('')}
 <div class="flow-data-actions">${btn(icon('plus') + ' Ajouter une donnée du catalogue', 'flow-data-add', 'secondary', !options.length || busy || model.items.length + additions.length >= 15 ? 'disabled' : '')}</div><p class="helper">Les choix proposés respectent le type de la donnée. Une valeur vide et « Non » sont deux valeurs différentes.</p>${error}<div class="flow-data-actions">${btn('Vérifier les modifications', 'flow-data-review', 'primary')}</div></section>
 <aside class="flow-data-card"><div class="flow-data-heading">${icon('phone')}<div><h2>Données utilisées pendant l’appel</h2><p>Attributs évalués par les conditions de ce parcours.</p></div></div>${model.used.length ? model.used.map((name) => `<article class="flow-data-usage"><strong>${esc(nameLabel(name))}</strong><span>${model.runtime.includes(name) ? 'Non initialisé à l’entrée · origine à vérifier dans les étapes, le bot ou le CRM.' : 'Valeur initialisée à l’entrée du parcours.'}</span></article>`).join('') : '<p>Aucun attribut évalué par une condition dans ce parcours.</p>'}</aside></div>`
  );
}
