/** Active Studio perimeter. Engine version is independent of Core Model labels. */
export const isWolfV5VoiceTable = (name) =>
  typeof name === 'string' && /^W_.+_v5$/i.test(name) && !/MESSAGE/i.test(name);

export function selectWolfV5(snapshot) {
  const excluded = snapshot.tables.filter((table) => !isWolfV5VoiceTable(table.name));
  return {
    ...snapshot,
    source: {
      ...snapshot.source,
      wolfVersion: '5',
      excludedLegacyTableIds: [
        ...new Set([
          ...(snapshot.source?.excludedLegacyTableIds || []),
          ...snapshot.tables.filter((table) => /_v4$/i.test(table.name)).map((table) => table.id),
        ]),
      ],
      excludedScopeTables: (snapshot.source?.excludedScopeTables || 0) + excluded.length,
    },
    tables: snapshot.tables.filter((table) => isWolfV5VoiceTable(table.name)),
  };
}

/** Hide known V4 declarations in the view, preserving the stored registry. */
export function registryInScope(registry, source) {
  const excluded = new Set(source?.excludedLegacyTableIds || []);
  const allowed = (id) => !excluded.has(String(id).split(':')[0]);
  const coreModels = registry.coreModels
    .map((model) => ({
      ...model,
      versions: model.versions.filter((version) => allowed(version.flowId)),
    }))
    .filter((model) => model.versions.length);
  const versions = new Set(
    coreModels.flatMap((model) => model.versions.map((version) => version.flowId)),
  );
  return {
    ...registry,
    coreModels,
    declinations: registry.declinations.filter(
      (item) => allowed(item.flowId) && versions.has(item.baseFlowId),
    ),
  };
}
