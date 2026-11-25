import { isMessageNode } from './media-profiles.js';
import { branchRank as routeBranchRank } from './business.js';
import { routeTargetKey, routeTypeLabels } from './v5-fields.js';
import { fieldLabel } from './draft-fields.js';
import { esc } from './ui-kit.js';
import { routeControls } from './route-controls.js';
const present = (value) => value != null && String(value).trim() !== '';
const valueOf = (field, pending) =>
  Object.hasOwn(pending, field.key) ? pending[field.key] : field.value;
const branchOrder = [
  'NEXT',
  'OPEN',
  'CLOSED',
  'HOLIDAY',
  'EMERGENCY',
  'TRUE',
  'FALSE',
  'LOGGEDIN',
  'NOTLOGGEDIN',
  'NOT_BUSY',
  'BUSY',
  'LOWER_BOUND',
  'BETWEEN_BOUNDS',
  'UPPER_BOUND',
  'INTENT',
  'NO_MATCH',
  'NO_INPUT',
  'INQUEUE',
  'DEFAULT',
  'BYPASS',
  'ERROR',
];
const branchRank = (id) => {
  const prefix = id.replace(/_?TARGET_TYPE(?:_\d+)?$/, '');
  if (/^OPTION(?:\d|STAR|DIEZ)$/.test(prefix)) return routeBranchRank(prefix);
  const i = branchOrder.indexOf(prefix);
  return i < 0 ? 50 : i;
};
const rank = (field) =>
  field.kind === 'route-type'
    ? 1
    : field.kind === 'route-target'
      ? 2
      : field.kind === 'audio' || field.resource?.audio
        ? 3
        : 0;

/** Keep each issue's destination, announcement and weight together, without changing source values. */
export function businessBranches(node, fields, pending = {}, onlyConfigured = true) {
  const columns = { ...node.schema?.properties, ...node.row },
    claimed = new Set();
  const all = fields
    .filter((f) => f.kind === 'route-type')
    .map((type) => {
      const target = routeTargetKey(type.key, columns),
        prefix = type.key.replace(/_?TARGET_TYPE(?:_\d+)?$/, ''),
        number = type.key.match(/_(\d+)$/)?.[1];
      const keys = new Set([
        type.key,
        target,
        type.key.replace('TARGET_TYPE', 'TARGET_AUDIO'),
        type.key.replace('TARGET_TYPE', 'AUDIO'),
        type.key.replace('TARGET_TYPE', 'MESSAGE'),
        type.key.replace('TARGET_TYPE', 'TARGET_MESSAGE'),
        type.key.replace('TARGET_TYPE', 'LABEL'),
      ]);
      if (prefix) keys.add(prefix + '_AUDIO');
      if (/^RATIO\d+$/.test(prefix)) keys.add(prefix);
      if (number) {
        keys.add('RATIO' + number);
        keys.add('RATIO_' + number);
      }
      if (prefix === 'BETWEEN_BOUNDS') keys.add('BETWEEN_BOUND_AUDIO');
      if (!prefix && !number) keys.add('TARGET_MESSAGE_AUDIO');
      const members = fields.filter((f) => keys.has(f.key) && !claimed.has(f.key));
      members.forEach((f) => claimed.add(f.key));
      const label = fieldLabel(type.key)
        .replace(/ · type de destination$/, '')
        .replace(/^Type de destination$/, 'Suite du parcours');
      const buttonLabel = members.find((f) => f.key === prefix + '_LABEL');
      const configured =
        isMessageNode(node) && /^OPTION\d$/.test(prefix) && buttonLabel
          ? present(valueOf(buttonLabel, pending))
          : members.some((f) => present(valueOf(f, pending))) ||
            members.some((f) => Object.hasOwn(pending, f.key));
      const route = String(valueOf(type, pending) || '')
        .split('|')[0]
        .toLowerCase();
      return {
        id: type.key,
        label,
        configured,
        route,
        fields: members.sort(
          (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'fr', { numeric: true }),
        ),
      };
    })
    .sort((a, b) => {
      const option = (x) => /^OPTION(?:\d|STAR|DIEZ)/.test(x.id);
      return (
        Number(option(b)) - Number(option(a)) ||
        branchRank(a.id) - branchRank(b.id) ||
        a.label.localeCompare(b.label, 'fr', { numeric: true })
      );
    });
  return { all, branches: onlyConfigured ? all.filter((b) => b.configured) : all, claimed };
}
/** Lecture seule de la suite d'une branche, pour la vue Métier. */
function destination(branch) {
  const type = branch.fields.find((f) => f.kind === 'route-type'),
    target = branch.fields.find((f) => f.kind === 'route-target');
  const parts = [
    type?.display,
    !['disconnect', 'next', 'enable', 'disable'].includes(branch.route) && present(target?.value)
      ? target.display
      : '',
  ].filter(present);
  return `<p class="business-branch-destination"><span>Suite du parcours</span>${esc(parts.join(' · ') || 'Non configuré')}<button type="button" class="btn quiet small" data-action="set-audience" data-audience="admin">Modifier en Administration</button></p>`;
}
export function businessBranchView(
  model,
  selected,
  renderField,
  pending = {},
  { routing = true, admin = false, context = {} } = {},
) {
  if (!model.all.length) return '';
  const branch = model.branches.find((b) => b.id === selected) || model.branches[0];
  return `<section class="business-setting-group business-branch-editor"><h3>Choix et suites du parcours</h3><p class="helper">Seuls les réglages du choix sélectionné sont affichés.</p>${
    branch
      ? `<div class="field"><label for="business-branch">${model.all.some((b) => /^OPTION/.test(b.id)) ? 'Choix à modifier' : 'Situation à modifier'}</label><select id="business-branch">${model.branches.map((b) => `<option value="${esc(b.id)}" ${b.id === branch.id ? 'selected' : ''}>${esc(b.label)}${b.route ? '' : ' · non configuré'}</option>`).join('')}</select></div><div class="business-branch-panel"><h4>${esc(branch.label)}</h4>${!branch.route ? '<p class="helper">Non configuré : aucune action n’est définie pour ce choix.</p>' : ''}${routing ? '' : destination(branch)}${branchParametersView(branch, pending, { ...context, admin })}<div class="field-grid">${branch.fields
          .filter((f) =>
            routing
              ? !(
                  f.kind === 'route-target' &&
                  ['disconnect', 'next', 'enable', 'disable'].includes(branch.route) &&
                  !present(valueOf(f, pending))
                )
              : f.kind !== 'route-type' && f.kind !== 'route-target',
          )
          .map((f) =>
            renderField({
              ...f,
              label: admin
                ? f.label
                : f.kind === 'route-type'
                  ? 'Action à effectuer'
                  : f.kind === 'route-target'
                    ? branch.route === 'number'
                      ? 'Numéro à appeler'
                      : 'Destination'
                    : f.kind === 'audio' || f.resource?.audio
                      ? 'Message pour ce choix'
                      : f.label,
            }),
          )
          .join(
            '',
          )}</div>${routing && ['disconnect', 'next', 'enable', 'disable'].includes(branch.route) ? `<p class="helper">${esc(routeTypeLabels[branch.route])} : aucune destination à renseigner.</p>` : ''}</div>`
      : '<p class="helper">Aucun choix renseigné.</p>'
  }${model.branches.length < model.all.length ? '<button type="button" class="btn quiet small" data-action="business-show-choices">Afficher aussi les choix non renseignés</button>' : ''}</section>`;
}

/** Un contrôle par ligne, avec ce que les tables chargées permettent d'en dire. */
function controlsView(value, branch, context) {
  const controls = routeControls(value, { ...context, waiting: /^INQUEUE/.test(branch.id) });
  if (!controls.length) return '';
  // Le réglage d'enregistrement de ce parcours est un bloc que l'on peut ouvrir et modifier.
  const link = (context.flow?.edges || []).find(
      (edge) => edge.from === context.nodeId && edge.type === 'recording' && edge.to,
    ),
    block = link ? context.flow.nodes.findIndex((node) => node.id === link.to) : -1;
  return `<div><dt>${controls.length > 1 ? 'Contrôles exécutés avant cette suite' : 'Contrôle exécuté avant cette suite'}</dt><dd><ol class="route-controls">${controls
    .map(
      (control) =>
        `<li class="route-control route-control-${control.kind}"><strong>${esc(control.title)}</strong>${context.admin && control.kind !== 'custom' ? ` <code>${esc(control.name)}</code>` : ''}${control.notes.map((note) => `<span>${esc(note)}</span>`).join('')}${control.warning ? `<span class="route-control-warning" role="note">${esc(control.warning)}</span>` : ''}${control.kind === 'context' && context.flow?.version === '5' && context.flow.media !== 'messaging' ? '<button type="button" class="btn quiet small" data-action="context-data-open">Ouvrir les données de contexte</button>' : ''}${control.kind === 'recording' && block >= 0 ? `<button type="button" class="btn quiet small" data-action="select-node" data-node="${block}">Ouvrir le bloc d’enregistrement</button>` : ''}</li>`,
    )
    .join('')}</ol></dd></div>`;
}
/** Show the parameters specific to the selected exit, even when destinations match. */
export function branchParametersView(branch, pending = {}, context = {}) {
  const type = branch.fields.find((f) => f.kind === 'route-type'),
    target = branch.fields.find((f) => f.kind === 'route-target');
  const details = [type, target]
    .filter(Boolean)
    .flatMap((f) =>
      String(valueOf(f, pending) ?? '')
        .split('|')
        .slice(1),
    )
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(':'),
        name = at < 0 ? '' : part.slice(0, at).toLowerCase(),
        value = at < 0 ? part : part.slice(at + 1);
      if (name === 'sub') return controlsView(value, branch, context);
      const label =
        { pdata: 'Contexte transmis', lang: 'Langue', status: 'Statut' }[name] ||
        'Paramètre associé';
      return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    });
  return details.length
    ? `<section class="branch-parameters" aria-label="Paramètres de cette situation"><h5>Paramètres de cette situation</h5><dl>${details.join('')}</dl><p class="helper">Ces paramètres sont propres à cette situation, même si la destination est commune.</p></section>`
    : '';
}
