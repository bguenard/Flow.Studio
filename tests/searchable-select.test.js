import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelectSearch, matchingSelectOptions, selectNeedsSearch } from '../src/searchable-select.js';

test('search accepts unaccented French, ligatures and typographic apostrophes', () => {
  assert.equal(normalizeSelectSearch('  Équipe CŒUR d’appel  '), "equipe coeur d'appel");
  const options = [{ label: 'Équipe sinistres', group: 'Rhône' }, { label: 'Équipe contrats', group: 'Île-de-France' }, { label: 'Accueil général', disabled: true }];
  assert.deepEqual(matchingSelectOptions(options, 'rhone sinistres'), [options[0]]);
  assert.deepEqual(matchingSelectOptions(options, 'CONTRATS ile'), [options[1]]);
  assert.deepEqual(matchingSelectOptions(options, 'inconnu'), []);
  assert.deepEqual(matchingSelectOptions(options, ''), options);
  assert.deepEqual(matchingSelectOptions(options, 'general'), [options[2]], 'disabled options remain discoverable, never silently removed');
});

test('only the exact yes/no pair omits search, including small destination lists and placeholders', () => {
  assert.equal(selectNeedsSearch([{ label: 'Oui' }, { label: 'Non' }]), false);
  assert.equal(selectNeedsSearch([{ label: 'Choisir' }, { label: 'Oui' }, { label: 'Non' }]), true);
  assert.equal(selectNeedsSearch([{ label: 'Conserver le comportement source' }, { label: 'Choisir une étape cible' }]), true);
});
