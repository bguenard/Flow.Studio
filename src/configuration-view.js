import { esc, head, btn, icon, empty } from './ui-kit.js';
import { isV5 } from './v5-fields.js';
export function configurationFlow(snapshot, tableId) {
  const tables = (snapshot?.tables || []).filter((t) => isV5({ tableName: t.name }));
  const table =
    tables.find((t) => t.id === tableId) || tables.find((t) => t.rows.length) || tables[0];
  if (!table) return null;
  const types = {
    W_INBOUND_CALL_V5: 'inboundcall',
    W_SERVICES_V5: 'service',
    W_MENU_V5: 'menu',
    W_MENU_CB_V5: 'menu',
    W_DECISION_V5: 'decision',
    W_PARTICIPANT_DATA_V5: 'pdata',
    W_SCHEDULE_GROUP_V5: 'schedulegroup',
    W_RATIO_DISTRIB_V5: 'ratiodistrib',
  };
  return {
    id: 'configuration:' + table.id,
    name: table.name,
    tableId: table.id,
    edges: [],
    nodes: table.rows
      .map((row) => ({
        id: `${table.id}:${row.key}`,
        key: String(row.key),
        name: row.DESCRIPTION || String(row.key),
        label: table.name,
        type: types[table.name.toUpperCase()] || 'configuration',
        tableId: table.id,
        tableName: table.name,
        schema: table.schema,
        row,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })),
  };
}
export function configurationView(snapshot, flow, index, editor) {
  const tables = (snapshot?.tables || [])
    .filter((t) => isV5({ tableName: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  return (
    head(
      'ADMINISTRATION V5',
      'Configurations des blocs',
      'Retrouvez les réglages de toutes les tables V5, y compris les configurations de rappel et les contrôles associés.',
      btn('Retour aux parcours', 'nav', 'secondary', 'data-view="catalogue"'),
    ) +
    `<section class="settings-panel"><div class="field-grid"><div class="field"><label for="configuration-table">Type de configuration</label><select id="configuration-table">${tables.map((t) => `<option value="${esc(t.id)}" ${t.id === flow?.tableId ? 'selected' : ''}>${esc(t.name)} · ${t.rows.length} configuration(s)</option>`).join('')}</select></div><div class="field"><label for="configuration-row">Configuration à modifier</label><select id="configuration-row" ${!flow?.nodes.length ? 'disabled' : ''}>${flow?.nodes.map((n, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${esc(n.name)}${n.name !== n.key ? ' · ' + esc(n.key) : ''}</option>`).join('') || '<option>Aucune configuration dans cette table</option>'}</select></div></div></section>${editor ? `<section class="settings-panel configuration-editor"><p class="helper">Clé de la configuration : <strong>${esc(flow.nodes[index].key)}</strong></p>${editor}<div class="page-actions">${btn(icon('check') + ' Enregistrer le brouillon', 'save-node', 'primary', `data-node="${index}"`)}</div></section>` : empty('Aucune configuration', 'Cette table ne contient pas encore de ligne à modifier.')}`
  );
}
