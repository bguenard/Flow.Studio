import { FLOW_INITIALIZATION_LIMIT, initializationAttributes } from './flow-initialization.js';
import { esc, head, btn, notice } from './ui-kit.js';

/** Numéro appelé → position du parcours dans l'inventaire, pour ouvrir ses données depuis la liste. */
function journeysByNumber(flows) {
  const journeys = new Map();
  flows.forEach((flow, index) => {
    const number = flow.nodes?.find((node) => node.id === flow.id)?.key;
    if (number && !journeys.has(number)) journeys.set(number, index);
  });
  return journeys;
}

function renderValues(row) {
  const attributes = initializationAttributes(row);
  if (!attributes.length) return '<span class="initialization-none">Aucune donnée</span>';
  return `<dl class="initialization-values">${attributes
    .map(
      (attribute) =>
        `<div><dt>${esc(attribute.name)}</dt> ${attribute.value === '' ? '<dd class="empty">Vide</dd>' : `<dd${attribute.value.length > 30 ? ` title="${esc(attribute.value)}"` : ''}>${esc(attribute.value)}</dd>`}</div>`,
    )
    .join('')}</dl>`;
}

function renderRows(rows, journeys) {
  if (!rows.length)
    return '<p class="initialization-empty">Aucun numéro enregistré. Les valeurs se renseignent dans chaque parcours, depuis « Données du parcours ».</p>';
  return `<div class="initialization-table-wrap">
    <table class="initialization-table" aria-label="Données à l’entrée de l’appel, par numéro">
      <thead><tr><th scope="col">Numéro appelé</th><th scope="col">Division</th><th scope="col">Données à l’entrée de l’appel</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr>
        <th scope="row"><span class="initialization-number">${esc(row.key)}</span>${row.DESCRIPTION ? `<span class="initialization-description">${esc(row.DESCRIPTION)}</span>` : ''}</th>
        <td>${row.DIVISION ? esc(row.DIVISION) : '<span class="initialization-none">Non renseignée</span>'}</td>
        <td>${renderValues(row)}</td>
        <td class="initialization-action">${journeys.has(row.key) ? btn('Modifier', 'initialization-edit', 'secondary small', `data-index="${journeys.get(row.key)}" aria-label="Modifier les données du ${esc(row.key)}"`) : ''}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>`;
}

function renderSetup(divisions, busy) {
  return `<section class="flow-data-card initialization-setup">
    <h2>Activer l’initialisation par numéro</h2>
    <div class="field">
      <label for="initialization-division">Division de la nouvelle table</label>
      <select id="initialization-division" ${busy ? 'disabled' : ''}>
        <option value="">Choisir une division…</option>
        ${divisions.map((division) => `<option value="${esc(division.id)}" ${division.name === 'G2S' ? 'selected' : ''}>${esc(division.name)}</option>`).join('')}
      </select>
    </div>
    ${btn('Créer la table dédiée', 'initialization-create', 'primary', busy ? 'disabled' : '')}
  </section>`;
}

function renderResult(result, divisions, busy, journeys) {
  if (result.status === 'error') return notice(esc(result.error), 'warning');
  if (result.status === 'missing') return renderSetup(divisions, busy);
  if (result.status !== 'ready')
    return '<p class="initialization-empty" role="status">Lecture des numéros…</p>';
  const rows = result.table.rows;
  return `<div class="section-heading"><h2>Numéros enregistrés <span class="journey-count">${rows.length} numéro${rows.length > 1 ? 's' : ''}</span></h2></div>${renderRows(rows, journeys)}`;
}

/** Vue d'ensemble en lecture : les valeurs se modifient dans chaque parcours et suivent sa publication. */
export function initializationView(state = {}, divisions = [], busy = false, flows = []) {
  return (
    head(
      'ADMINISTRATION',
      'Initialisation par numéro',
      `Données renseignées dès l’entrée de l’appel, selon le numéro appelé · ${FLOW_INITIALIZATION_LIMIT} au maximum par numéro.`,
      btn('Actualiser', 'initialization-open', 'secondary', busy ? 'disabled' : ''),
    ) +
    `<section class="initialization-overview">
      ${renderResult(state.result || {}, divisions, busy, journeysByNumber(flows))}
      ${state.error ? `<div class="error-box" role="alert" tabindex="-1">${esc(state.error)}</div>` : ''}
    </section>`
  );
}
