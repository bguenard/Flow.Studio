import { declareReference, normalizeRegistry, roleOf } from './governance.js';
import { flowTitle } from './business.js';
import { esc, head, btn, icon, notice } from './ui-kit.js';

export function coreModelCandidates(registry, flows, transientIds = []) {
  const pending = new Set(transientIds);
  return flows
    .filter((flow) => !pending.has(flow.id) && roleOf(registry, flow.id).role === 'none')
    .sort((a, b) =>
      flowTitle(a).localeCompare(flowTitle(b), 'fr', { numeric: true, sensitivity: 'base' }),
    );
}
export function validateCoreModelIdentity(registry, form) {
  // Reuse domain constraints before a new journey has its final flow ID.
  let temporary = 'core-model-wizard:identity';
  while (roleOf(registry, temporary).role !== 'none') temporary += '-';
  declareReference(registry, { flowId: temporary, name: form.name, versionLabel: form.version });
}
export function prepareCoreModel(registry, form, flows, transientIds = [], declaredAt = '') {
  validateCoreModelIdentity(registry, form);
  if (!coreModelCandidates(registry, flows, transientIds).some((flow) => flow.id === form.flowId))
    throw Error('Choisissez un parcours publié sans rattachement existant.');
  return declareReference(registry, {
    flowId: form.flowId,
    name: form.name,
    versionLabel: form.version,
    declaredAt,
  });
}
export function removeCoreModel(registry, modelId) {
  const next = normalizeRegistry(registry),
    model = next.coreModels.find((m) => m.id === modelId);
  if (!model) throw Error('Ce Core Model n’existe plus.');
  // Check the full registry, including children whose flows are absent locally.
  if (
    next.declinations.some(
      (d) => d.coreModelId === modelId || model.versions.some((v) => v.flowId === d.baseFlowId),
    )
  )
    throw Error('Ce Core Model possède des déclinaisons. La suppression est impossible.');
  next.coreModels = next.coreModels.filter((m) => m.id !== modelId);
  return next;
}
export function coreModelWizardView(state, candidates, { busy = false } = {}) {
  const f = state.form,
    review = state.step === 1,
    flow = candidates.find((c) => c.id === f.flowId);
  return (
    head(
      'CORE MODELS',
      'Créer un Core Model',
      'Nom de la référence et parcours servant de modèle.',
      btn('Annuler', 'core-model-cancel', 'secondary'),
    ) +
    `<section class="flow-wizard core-model-wizard"><ol class="wizard-progress" aria-label="Étapes de création"><li class="${!review ? 'active' : 'done'}" ${!review ? 'aria-current="step"' : ''}><span>1</span><strong>Définir le modèle</strong></li><li class="${review ? 'active' : ''}" ${review ? 'aria-current="step"' : ''}><span>2</span><strong>${f.mode === 'new' ? 'Construire le parcours' : 'Vérifier et créer'}</strong></li></ol><div class="editor-card">${
      review
        ? `<h2>Récapitulatif du Core Model</h2><dl class="core-model-summary"><div><dt>Nom</dt><dd>${esc(f.name)}</dd></div><div><dt>Première version</dt><dd>${esc(f.version)}</dd></div><div><dt>Parcours de référence</dt><dd>${esc(flow ? flowTitle(flow) : 'Parcours indisponible')}</dd></div><div><dt>Numéro</dt><dd>${esc(flow?.key || '')}</dd></div></dl>${notice('Le Core Model sera enregistré dans le référentiel partagé Genesys. Les règles du parcours sélectionné restent identiques.')}`
        : `<div class="field-grid"><div class="field"><label for="core-model-name">Nom du Core Model *</label><input id="core-model-name" maxlength="80" required value="${esc(f.name)}" placeholder="Ex. Accueil des agences"></div><div class="field"><label for="core-model-version">Première version *</label><input id="core-model-version" maxlength="24" required value="${esc(f.version)}"></div></div><fieldset class="choice-list core-model-origin"><legend>Votre point de départ</legend><label class="check-row"><input type="radio" name="core-model-mode" value="existing" ${f.mode === 'existing' ? 'checked' : ''}><span><strong>Un parcours existant</strong><small>Utiliser un parcours publié comme référence.</small></span></label><label class="check-row"><input type="radio" name="core-model-mode" value="new" ${f.mode === 'new' ? 'checked' : ''}><span><strong>Un nouveau parcours</strong><small>Construire son accueil, son orientation et ses équipes avec l’assistant.</small></span></label></fieldset>${f.mode === 'existing' ? `<div class="field"><label for="core-model-flow">Parcours de référence *</label><select id="core-model-flow" required><option value="">Choisir un parcours…</option>${candidates.map((c) => `<option value="${esc(c.id)}" ${c.id === f.flowId ? 'selected' : ''}>${esc(flowTitle(c))} · ${esc(c.key)}</option>`).join('')}</select><span class="helper">${candidates.length ? 'Parcours publiés disponibles, sans rôle déjà déclaré.' : 'Aucun parcours disponible. Choisissez « Un nouveau parcours ».'}</span></div>` : notice('Le parcours WOLF aura son propre numéro et sa division. Son rattachement au Core Model sera enregistré dans Genesys à la publication.')}`
    }</div><footer class="wizard-footer"><span>${review ? 'Vérification' : 'Définition'}<small>${review ? 'Vérifiez la référence choisie.' : 'Les champs marqués * sont obligatoires.'}</small></span><div>${review ? btn('Précédent', 'core-model-back', 'secondary') : ''}${btn(busy ? 'Enregistrement…' : review ? 'Créer le Core Model' : f.mode === 'new' ? 'Construire le parcours' : 'Continuer ' + icon('chevron'), review ? 'core-model-create' : 'core-model-next', 'primary', busy ? 'disabled' : '')}</div></footer></section>`
  );
}
export function coreModelDeleteView(model, { busy = false } = {}) {
  return (
    head(
      'CORE MODELS',
      'Supprimer ce Core Model',
      model.name,
      btn('Annuler', 'core-model-cancel', 'secondary'),
    ) +
    `<section class="editor-card"><h2>${esc(model.name)}</h2><p>Ce Core Model n’a aucune déclinaison. Sa déclaration et ses ${model.versions.length} version(s) seront retirées du référentiel partagé Genesys.</p>${notice('Les parcours, leurs numéros et toutes les lignes des tables WOLF sont conservés. Ils resteront accessibles dans « Parcours clients ».')}<div class="page-actions">${btn('Conserver le Core Model', 'core-model-cancel', 'secondary')}${btn(busy ? 'Suppression…' : 'Confirmer la suppression', 'core-model-delete-confirm', 'primary', `data-model="${esc(model.id)}" ${busy ? 'disabled' : ''}`)}</div></section>`
  );
}
