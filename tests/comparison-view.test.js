import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonWorkspace } from '../src/comparison-view.js';

const params = extra => ({
  left: { id: 'source' }, right: { id: 'target' }, leftTitle: 'Source', rightTitle: 'Cible',
  diff: { matches: [], unmatched: [], ambiguous: [] }, choices: [], decisions: {}, plan: { changes: [], errors: [] }, ...extra,
});
const item = extra => ({
  id: 'source|target|PRIORITY', label: 'Priorité',
  leftNode: { id: 'source', row: { DESCRIPTION: 'Équipe source' } }, rightNode: { id: 'target', row: { DESCRIPTION: 'Équipe cible' } },
  beforeDisplay: '1', afterDisplay: '3', value: 3, kind: 'number', canCopy: true, canEdit: true, ...extra,
});
const button = (html, action) => html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] || '';

test('a decision whose diff disappeared stays visible and explicitly removable, with reset enabled', () => {
  const id = 'old|target|PRIORITY', decision = { mode: 'copy' };
  for (const decisions of [{ [id]: decision }, new Map([[id, decision]])]) {
    const input = params({ decisions, plan: { changes: [], errors: [{ id, message: 'Le réglage a changé depuis votre choix.' }] } });
    const html = comparisonWorkspace(input);
    assert.match(html, /Choix à actualiser/);
    assert.match(html, /Le réglage a changé depuis votre choix\./);
    assert.match(html, /data-action="decision-keep" data-id="old\|target\|PRIORITY"[^>]*>Retirer ce choix/);
    assert.ok(button(html, 'comparison-reset'));
    assert.doesNotMatch(button(html, 'comparison-reset'), /disabled/);
    assert.match(html, /1 changement choisi/);
    const reviewed = comparisonWorkspace({ ...input, review: true });
    assert.match(reviewed, /Retirer ce choix/);
    assert.match(button(reviewed, 'comparison-apply'), /disabled/);
    assert.equal(decisions instanceof Map ? decisions.get(id) : decisions[id], decision, 'rendering must not silently remove the stale decision');
  }
});

test('comparison conserves the target by default and exposes no custom editor before an explicit choice', () => {
  const html = comparisonWorkspace(params({ choices: [item()] }));
  assert.match(button(html, 'decision-keep'), /aria-pressed="true"/);
  assert.match(button(html, 'decision-copy'), /aria-pressed="false"/);
  assert.match(button(html, 'decision-edit'), /aria-pressed="false"/);
  assert.doesNotMatch(html, /name="comparison-value"/);
  assert.match(button(html, 'comparison-reset'), /disabled/);
  assert.match(button(html, 'comparison-review'), /disabled/);
});

test('custom values and labels remain escaped and a destination selects only its chosen option', () => {
  const audio = item({ id: 'audio', kind: 'audio', label: 'Message <client>', value: 'Bonjour' });
  const destination = item({ id: 'destination', kind: 'destination', destinationOptions: [{ value: 'a', label: 'Équipe A' }, { value: 'b', label: 'Équipe <B>' }] });
  const html = comparisonWorkspace(params({ choices: [audio, destination], decisions: { audio: { mode: 'edit', value: '</textarea><img src=x onerror=alert(1)>' }, destination: { mode: 'edit', value: 'b' } } }));
  assert.match(html, /Message &lt;client&gt;/);
  assert.match(html, /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<option value="b" selected>Équipe &lt;B&gt;<\/option>/);
  assert.doesNotMatch(html, /<option value="a" selected>/);
});

test('copy shows the current target and proposed result together without a duplicated journey banner', () => {
  const choice = item({ beforeDisplay: 'Accueil <source>', afterDisplay: 'Accueil cible' });
  const html = comparisonWorkspace(params({ choices: [choice], decisions: { [choice.id]: { mode: 'copy' } } }));
  const target = html.match(/<div class="comparison-target">([\s\S]*?)<\/article>/)?.[1];
  assert.ok(target);
  assert.match(target, /Valeur actuelle[\s\S]*Accueil cible/);
  assert.match(target, /Après copie[\s\S]*Accueil &lt;source&gt;/);
  assert.match(target, /data-action="decision-copy"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html, /comparison-context|comparison-decision/);
});

test('a copied destination previews the mapped target destination and never promises a source destination for an invalid plan', () => {
  const destination = item({ id: 'destination', kind: 'destination', beforeDisplay: 'Calendrier source', afterDisplay: 'Fin d’appel' });
  const input = params({ choices: [destination], decisions: { destination: { mode: 'copy' } }, plan: { changes: [{ id: 'destination', afterDisplay: 'Calendrier cible <ouverture>' }], errors: [] } });
  const preview = html => html.match(/<div class="comparison-planned">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(preview(comparisonWorkspace(input)), /Après copie[\s\S]*Calendrier cible &lt;ouverture&gt;/);
  assert.doesNotMatch(preview(comparisonWorkspace(input)), /Calendrier source/);
  const invalid = comparisonWorkspace({ ...input, plan: { changes: [], errors: [{ id: 'destination', message: 'Association nécessaire' }] } });
  assert.match(preview(invalid), /Choix à corriger/);
  assert.doesNotMatch(preview(invalid), /Calendrier source/);
});

test('uncompared steps count unique nodes, stay collapsed, and do not distract from the result review', () => {
  const sourceNode = { id: 'unpaired-left', name: 'Qualification' };
  const diff = { unmatched: [{ side: 'left', node: sourceNode }], ambiguous: [{ leftNodes: [sourceNode], rightNodes: [{ id: 'unpaired-right', name: 'Horaires' }] }] };
  const html = comparisonWorkspace(params({ diff }));
  assert.match(html, /Associer les étapes \(2 à vérifier\)/);
  assert.match(html, /<details class="comparison-unpaired">/);
  assert.match(html, /2 étapes non comparées/);
  assert.match(html, /1 côté source · 1 côté cible/);
  assert.doesNotMatch(comparisonWorkspace(params({ diff, review: true })), /comparison-unpaired/);
});

test('groups follow target journey order and route labels identify the target in the result review', () => {
  const source = { id: 'source-entry', row: { DESCRIPTION: 'SCENARIO 2 TEMPETE' } };
  const target = { id: 'target-entry', row: { DESCRIPTION: 'SCENARIO POC' } };
  const calendar = { id: 'target-calendar', row: { DESCRIPTION: 'Calendrier cible' } };
  const route = item({ id: 'route', structural: true, label: 'SCENARIO 2 TEMPETE · Puis', leftNode: source, rightNode: target });
  const calendarChoice = item({ id: 'calendar', label: 'Calendrier', rightNode: calendar });
  const input = params({ right: { nodes: [target, calendar] }, choices: [calendarChoice, route], decisions: { route: { mode: 'copy' } }, plan: { changes: [{ id: 'route', label: route.label, mode: 'copy', beforeDisplay: 'Ancienne destination', afterDisplay: 'Calendrier cible' }], errors: [] } });
  const html = comparisonWorkspace(input);
  assert.ok(html.indexOf('<h2>SCENARIO POC</h2>') < html.indexOf('<h2>Calendrier cible</h2>'));
  assert.match(html, /<strong>Destination · Puis<\/strong>/);
  const review = comparisonWorkspace({ ...input, review: true });
  assert.match(review, /<strong>Destination · Puis<\/strong><small class="comparison-review-step">SCENARIO POC<\/small>/);
  assert.doesNotMatch(review, /SCENARIO 2 TEMPETE · Puis/);
});
