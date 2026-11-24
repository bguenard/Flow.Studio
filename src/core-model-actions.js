import { normalizeRegistry, declareReference, attachDeclination, roleOf } from './governance.js';
import { cloneFlow } from './flow-clone.js';
import { buildJourneyInventory, normalizeSnapshot } from './data-source.js';
import { esc, head, btn, notice } from './ui-kit.js';

export function renameCoreModel(registry, modelId, name) {
  const next = normalizeRegistry(registry),
    model = next.coreModels.find((m) => m.id === modelId),
    label = String(name || '').trim();
  if (!model) throw Error('Ce Core Model n’existe plus.');
  if (!label || label.length > 80)
    throw Error('Indiquez un nom de Core Model entre 1 et 80 caractères.');
  if (
    next.coreModels.some(
      (m) => m.id !== modelId && m.name.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'),
    )
  )
    throw Error('Un Core Model porte déjà ce nom.');
  model.name = label;
  return next;
}
export function nextVersionLabel(model) {
  const labels = new Set(model.versions.map((v) => v.label.toLowerCase()));
  let n =
    Math.max(0, ...model.versions.map((v) => Number(/^v?(\d+)$/i.exec(v.label)?.[1] || 0))) + 1;
  while (labels.has('v' + n)) n++;
  return 'V' + n;
}
export function prepareCoreModelCopy({
  snapshot,
  registry,
  form,
  transientIds = [],
  declaredAt = '',
}) {
  const source = buildJourneyInventory(snapshot).flows.find((f) => f.id === form.sourceFlowId),
    r = roleOf(registry, form.sourceFlowId);
  if (
    !source ||
    (source.version !== '5' && source.media !== 'messaging') ||
    r.role !== 'reference' ||
    r.model.id !== form.modelId
  )
    throw Error('Choisissez une version de référence présente dans ce Core Model.');
  if (new Set(transientIds).has(source.id))
    throw Error('Publiez cette version de référence avant de la réutiliser.');
  if (source.media !== 'messaging' && !/^\+[1-9]\d{7,14}$/.test(String(form.phone || '').trim()))
    throw Error('Renseignez un nouveau numéro d’entrée au format international.');
  if (!String(form.division || '').trim()) throw Error('Choisissez une division Genesys.');
  if (!['version', 'declination'].includes(form.kind)) throw Error('Type de création inconnu.');
  const name =
    form.kind === 'version'
      ? `${r.model.name} · ${String(form.versionLabel || '').trim()}`
      : String(form.name || '').trim();
  const result = cloneFlow(snapshot, source, {
    name,
    phone: form.phone.trim(),
    division: form.division,
  });
  const next =
    form.kind === 'version'
      ? declareReference(registry, {
          flowId: result.flowId,
          coreModelId: r.model.id,
          versionLabel: form.versionLabel,
          declaredAt,
        })
      : attachDeclination(registry, {
          flowId: result.flowId,
          baseFlowId: source.id,
          origin: 'created',
          declaredAt,
          nodeMappings: result.summary.mappings
            .filter((m) => !m.initialization)
            .map((m) => ({ referenceNodeId: m.sourceNodeId, localNodeId: m.nodeId })),
        });
  // The copy has a business name; the draft state is tracked separately.
  const copy = structuredClone(result.snapshot);
  const entry = copy.tables
    .flatMap((t) => t.rows.map((row) => ({ id: `${t.id}:${row.key}`, row })))
    .find((x) => x.id === result.flowId);
  entry.row.DESCRIPTION = name;
  if (form.kind === 'version')
    copy.source.relationships = copy.source.relationships.map((x) =>
      x.flowId === result.flowId
        ? { ...x, type: 'core-model-version', coreModelId: r.model.id }
        : x,
    );
  return { ...result, snapshot: normalizeSnapshot(copy), registry: next };
}
export function renameCoreModelView(model, name, { busy = false } = {}) {
  return (
    head(
      'CORE MODEL',
      'Renommer le Core Model',
      model.name,
      btn('Annuler', 'model-action-cancel', 'secondary'),
    ) +
    `<section class="editor-card"><div class="field"><label for="model-rename">Nom du Core Model *</label><input id="model-rename" maxlength="80" required value="${esc(name)}"></div>${notice('Le nouveau nom sera partagé dans Genesys. Les versions et les rattachements sont conservés.')}<div class="page-actions">${btn(busy ? 'Enregistrement…' : 'Enregistrer le nom', 'model-rename-save', 'primary', busy ? 'disabled' : '')}</div></section>`
  );
}
export function coreModelCopyView(
  state,
  model,
  divisions = [],
  { busy = false, resourceState } = {},
) {
  const f = state.form,
    version = f.kind === 'version',
    review = state.step === 1;
  const options = model.versions.filter((v) => v.flow && !state.transientIds?.includes(v.flowId));
  const selected = options.find((v) => v.flowId === f.sourceFlowId);
  return (
    head(
      version ? 'ÉVOLUTION DU CORE MODEL' : 'DU CORE MODEL AU PARCOURS',
      version ? 'Créer une nouvelle version' : 'Créer un parcours depuis ce modèle',
      model.name,
      btn('Annuler', 'clone-cancel', 'secondary'),
    ) +
    `<section class="flow-wizard core-model-wizard"><ol class="wizard-progress"><li class="${review ? 'done' : 'active'}"><span>1</span><strong>Définir ${version ? 'la version' : 'le parcours'}</strong></li><li class="${review ? 'active' : ''}"><span>2</span><strong>Vérifier la copie</strong></li></ol><section class="editor-card">${review ? `<h2>${esc(version ? model.name + ' · ' + f.versionLabel : f.name)}</h2><dl class="core-model-summary"><div><dt>Version source</dt><dd>${esc(selected?.label || 'Indisponible')}</dd></div><div><dt>${selected?.flow?.media === 'messaging' ? 'Nouveau segment' : 'Nouveau numéro'}</dt><dd>${esc(f.phone)}</dd></div><div><dt>Division</dt><dd>${esc(f.division)}</dd></div><div><dt>Configurations copiées</dt><dd>${state.plan?.summary.nodeCount || 0}</dd></div></dl>${state.plan?.summary.needsReview.length ? notice(`${state.plan.summary.needsReview.length} référence(s) nécessitent un contrôle avant publication. Les dépendances calculées pendant l’appel restent à vérifier.`, 'warning') : ''}` : `<div class="field-grid"><div class="field span2"><label for="clone-source">Version à reprendre *</label><select id="clone-source">${options.map((v) => `<option value="${esc(v.flowId)}" ${v.flowId === f.sourceFlowId ? 'selected' : ''}>Version ${esc(v.label)} · ${esc(v.flow.key)}</option>`).join('')}</select></div>${version ? `<div class="field"><label for="clone-version">Nouvelle version *</label><input id="clone-version" value="${esc(f.versionLabel)}" maxlength="24" required placeholder="V2"></div>` : `<div class="field"><label for="clone-name">Nom du nouveau parcours *</label><input id="clone-name" value="${esc(f.name)}" required placeholder="Ex. Accueil de l’agence Centre"></div>`}<div class="field"><label for="clone-phone">${selected?.flow?.media === 'messaging' ? 'Nouveau segment d’entrée' : 'Nouveau numéro d’entrée'} *</label><input id="clone-phone" type="${selected?.flow?.media === 'messaging' ? 'text' : 'tel'}" value="${esc(f.phone)}" required><span class="helper">Une entrée distincte pour conserver la version source.</span></div><div class="field span2"><label for="clone-division">Division Genesys *</label><select id="clone-division" required><option value="">Choisir une division…</option>${divisions.map((d) => `<option value="${esc(d.name)}" ${d.name === f.division ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>${resourceState?.status === 'error' ? `<span class="helper">${esc(resourceState.error)}</span>` : resourceState?.status === 'loading' ? '<span class="helper">Lecture des divisions…</span>' : ''}${btn('Actualiser les divisions', 'clone-divisions', 'quiet small')}</div></div>`}${notice(version ? 'Une copie indépendante du parcours sera préparée. Les déclinaisons existantes restent rattachées à leur version actuelle.' : 'L’accueil, les horaires, les menus et les règles sont copiés. Les files, calendriers et messages Genesys sont repris et pourront être adaptés.')}<p class="helper">Après création : personnalisez et simulez le parcours, puis publiez depuis « Mes changements ». Le rattachement sera enregistré dans Genesys à la publication.</p></section><footer class="wizard-footer"><span>${review ? 'Copie prête à préparer' : 'Version source conservée'}</span><div>${review ? btn('Précédent', 'clone-back', 'secondary') : ''}${btn(busy ? 'Enregistrement…' : review ? (version ? 'Préparer la nouvelle version' : 'Créer le parcours en brouillon') : 'Vérifier la copie', review ? 'clone-confirm' : 'clone-review', 'primary', busy ? 'disabled' : '')}</div></footer></section>`
  );
}
