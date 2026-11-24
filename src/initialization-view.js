import {
  FLOW_INITIALIZATION,
  FLOW_INITIALIZATION_LIMIT,
  initializationAttributes,
} from './flow-initialization.js';
import { esc, head, btn, notice } from './ui-kit.js';

function renderAttributes(row) {
  const attributes = initializationAttributes(row);
  if (!attributes.length) return '<span class="muted">Aucun attribut</span>';
  return `<details class="initialization-details">
    <summary>${attributes.length}/${FLOW_INITIALIZATION_LIMIT} attribut${attributes.length > 1 ? 's' : ''}</summary>
    <dl class="initialization-values">
      ${attributes
        .map(
          (attribute) => `<div>
        <dt><code>${esc(attribute.name)}</code> <span>${esc(attribute.type)}</span></dt>
        <dd>${esc(attribute.value === '' ? '(vide)' : attribute.value)}</dd>
      </div>`,
        )
        .join('')}
    </dl>
  </details>`;
}

function renderRows(rows) {
  if (!rows.length)
    return '<p class="helper">Aucun numéro enregistré. Ajoutez ses valeurs depuis Données du parcours.</p>';
  return `<div class="initialization-table-wrap">
    <table class="initialization-table">
      <caption class="sr-only">Valeurs initiales enregistrées par numéro</caption>
      <thead><tr><th scope="col">Numéro exact</th><th scope="col">Division</th><th scope="col">Attributs</th></tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr>
        <td>${esc(row.key)}${row.DESCRIPTION ? `<small class="initialization-description">${esc(row.DESCRIPTION)}</small>` : ''}</td>
        <td>${esc(row.DIVISION || 'Non renseignée')}</td>
        <td>${renderAttributes(row)}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>`;
}

function renderTable(result, divisions, busy) {
  if (result.status === 'error') return notice(esc(result.error), 'warning');
  if (result.status === 'missing')
    return `<div class="field initialization-setup">
    <label for="initialization-division">Division de la nouvelle table</label>
    <select id="initialization-division" ${busy ? 'disabled' : ''}>
      <option value="">Choisir une division…</option>
      ${divisions.map((division) => `<option value="${esc(division.id)}" ${division.name === 'G2S' ? 'selected' : ''}>${esc(division.name)}</option>`).join('')}
    </select>
    ${btn('Créer la table dédiée', 'initialization-create', 'primary', busy ? 'disabled' : '')}
  </div>`;
  if (result.status !== 'ready') return '<p role="status">Lecture de la table…</p>';
  const rows = result.table.rows;
  return `<p>${rows.length} numéro(s) enregistré(s). Pour modifier les valeurs, ouvrez <strong>Données du parcours</strong> dans le parcours concerné.</p>${renderRows(rows)}`;
}

/** Read-only overview; row changes follow the journey's normal publication workflow. */
export function initializationView(state = {}, divisions = [], busy = false) {
  return (
    head(
      'ADMINISTRATION',
      'Initialisation par numéro',
      `${FLOW_INITIALIZATION_LIMIT} attributs maximum · nom, type et valeur`,
      btn('Actualiser', 'initialization-open', 'secondary', busy ? 'disabled' : ''),
    ) +
    `
    <section class="flow-data-card initialization-overview">
      <h2>Valeurs enregistrées</h2>
      <p class="helper"><code>${FLOW_INITIALIZATION}</code></p>
      ${renderTable(state.result || {}, divisions, busy)}
      ${state.error ? `<div class="error-box" role="alert" tabindex="-1">${esc(state.error)}</div>` : ''}
    </section>
    <section class="flow-data-card initialization-runtime">
      <h2>Application pendant l’appel</h2>
      <p>Architect doit lire la ligne du numéro appelé et affecter les attributs avant la première condition. L’enregistrement de ces valeurs ne publie pas le flow Architect.</p>
    </section>`
  );
}
