import { normalizeRegistry } from './governance.js';

/** Persist roles only once all rows of the new journey have been published. */
export function durableRegistry(registry, transientIds = []) {
  const pending = new Set(transientIds),
    normalized = normalizeRegistry(registry);
  return normalizeRegistry({
    ...normalized,
    coreModels: normalized.coreModels.map((model) => ({
      ...model,
      versions: model.versions.filter((v) => !pending.has(v.flowId)),
    })),
    declinations: normalized.declinations.filter(
      (d) => !pending.has(d.flowId) && !pending.has(d.baseFlowId),
    ),
  });
}

/** A recovered workspace may add pending journeys, never overwrite remote roles. */
export function restorePendingRegistry(remote, draft, transientIds = []) {
  const pending = new Set(transientIds),
    base = normalizeRegistry(remote),
    local = normalizeRegistry(draft);
  for (const model of local.coreModels) {
    const versions = model.versions.filter((v) => pending.has(v.flowId));
    if (!versions.length) continue;
    const existing = base.coreModels.find((m) => m.id === model.id);
    if (existing) {
      // IDs are derived from names, so two authors can independently create the
      // same ID. Only a common, already-published version proves the same family.
      const common = model.versions.some(
        (v) =>
          !pending.has(v.flowId) &&
          existing.versions.some((remoteVersion) => remoteVersion.flowId === v.flowId),
      );
      if (
        !common &&
        versions.some(
          (v) => !existing.versions.some((remoteVersion) => remoteVersion.flowId === v.flowId),
        )
      )
        throw Error(
          'Conflit de Core Model : une autre famille utilise cet identifiant dans Genesys. Reprenez les rattachements sur le référentiel partagé.',
        );
      for (const version of versions)
        if (!existing.versions.some((v) => v.flowId === version.flowId)) {
          if (existing.versions.some((v) => v.label.toLowerCase() === version.label.toLowerCase()))
            throw Error(
              'Conflit de version : ce libellé est déjà utilisé dans le Core Model Genesys.',
            );
          existing.versions.push(version);
        }
    } else base.coreModels.push({ ...model, versions });
  }
  for (const item of local.declinations)
    if (
      (pending.has(item.flowId) || pending.has(item.baseFlowId)) &&
      !base.declinations.some((d) => d.flowId === item.flowId)
    )
      base.declinations.push(item);
  return normalizeRegistry(base);
}
