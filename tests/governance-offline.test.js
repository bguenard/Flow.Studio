import test from 'node:test';
import assert from 'node:assert/strict';
import { governanceSettingsView } from '../src/governance-settings-view.js';
import { coreModelsView } from '../src/governance-views.js';
import { buildVoiceInventory } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';

const candidates = buildVoiceInventory(demoSnapshot).flows.filter(
  (flow) => flow.category === 'template',
);
const page = (options) =>
  coreModelsView({
    resolved: { models: [], candidates, missing: 0 },
    summaries: new Map(),
    meta: () => '',
    ...options,
  });

test('a local export explains the missing shared registry and offers the connection instead of a retry', () => {
  const html = governanceSettingsView({ status: 'offline' });
  assert.ok(html.includes('export local'));
  assert.match(html, /data-action="nav"[^>]*data-view="settings"/);
  assert.doesNotMatch(html, /governance-load/);
});

test('a failed registry read keeps its error detail and its retry, separated from the text', () => {
  const html = governanceSettingsView({ status: 'error', error: 'Lecture <refusée>' });
  assert.ok(html.includes('Lecture &lt;refusée&gt;'));
  assert.match(html, /class="notice-actions">[^]*data-action="governance-load"/);
  assert.doesNotMatch(governanceSettingsView({ status: 'loading' }), /governance-load/);
});

test('without the shared registry, model-marked journeys stay reachable but cannot be declared', () => {
  assert.ok(candidates.length > 0);
  const html = page({ readOnly: true });
  assert.match(html, /<h1[^>]*>Core Models<\/h1>/);
  for (const flow of candidates)
    assert.ok(html.includes(`data-action="open-flow-id" data-id="${flow.id}"`));
  assert.doesNotMatch(html, /data-action="(declare-start|core-model-open|core-model-delete)"/);
});

test('with the shared registry, declaration and creation remain available and the banner follows the title', () => {
  const html = page({ shared: true, banner: '<div id="registry-banner"></div>' });
  assert.match(html, /data-action="declare-start"/);
  assert.match(html, /data-action="core-model-open"/);
  assert.ok(html.indexOf('<h1') < html.indexOf('registry-banner'));
  assert.ok(html.indexOf('registry-banner') < html.indexOf('Parcours à classer'));
});
