import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueModelOptions, filterCatalogueEntries } from '../src/catalogue-filter.js';
const registry = {
  coreModels: [
    { id: 'a', name: 'Accueil' },
    { id: 'b', name: 'Accueil' },
  ],
  declinations: [
    { flowId: 'old', coreModelId: 'a', baseFlowId: 'v1' },
    { flowId: 'new', coreModelId: 'a', baseFlowId: 'v2' },
    { flowId: 'other', coreModelId: 'b' },
  ],
};
const entries = [
  { f: { id: 'old', title: 'Agence Été', key: '+331', division: 'Nord' }, i: 4 },
  { f: { id: 'new', title: 'Agence Sud', key: '+332', division: 'Sud' }, i: 7 },
  { f: { id: 'other', title: 'Autre agence' }, i: 8 },
  { f: { id: 'free', title: 'Indépendant' }, i: 9 },
];
test('core model filter groups all adopted versions by stable ID and intersects accent-insensitive search', () => {
  assert.deepEqual(
    filterCatalogueEntries(entries, registry, { model: 'model:a' }).map((x) => x.i),
    [4, 7],
  );
  assert.deepEqual(
    filterCatalogueEntries(entries, registry, { model: 'model:a', query: 'ete nord' }).map(
      (x) => x.i,
    ),
    [4],
  );
  assert.equal(
    filterCatalogueEntries(entries, registry, { model: 'model:b', query: 'ete' }).length,
    0,
  );
  assert.deepEqual(
    filterCatalogueEntries(entries, registry, { model: 'unassigned' }).map((x) => x.i),
    [9],
  );
  assert.deepEqual(
    filterCatalogueEntries(entries, registry, { query: '+332' }).map((x) => x.i),
    [7],
  );
});
test('filter counts use only visible entity journeys, including zero-child models, and do not depend on model names', () => {
  const options = catalogueModelOptions(
    entries.map((e) => e.f),
    {
      ...registry,
      coreModels: [...registry.coreModels, { id: 'empty', name: 'Zéro' }],
      declinations: [...registry.declinations, { flowId: 'absent', coreModelId: 'a' }],
    },
  );
  assert.deepEqual(
    options.map((o) => o.count),
    [4, 2, 1, 0, 1],
  );
  assert.equal(
    filterCatalogueEntries(
      entries,
      {
        ...registry,
        coreModels: [
          { id: 'a', name: 'Renommé' },
          { id: 'b', name: 'Accueil' },
        ],
      },
      { model: 'model:a' },
    ).length,
    2,
  );
});
