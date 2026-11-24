import test from 'node:test';
import assert from 'node:assert/strict';
import { initializationView } from '../src/initialization-view.js';

const row = (key, extra = {}) => ({ key, DESCRIPTION: '', DIVISION: '', ...extra });
const ready = (rows) => ({ result: { status: 'ready', table: { rows } } });
const valued = row('+33001', {
  DESCRIPTION: '<Accueil>',
  DIVISION: 'Gan',
  ATTRIBUTE_01_NAME: 'ACTIVE',
  ATTRIBUTE_01_TYPE: 'bool',
  ATTRIBUTE_01_VALUE: 'false',
  ATTRIBUTE_02_NAME: 'COUNT',
  ATTRIBUTE_02_TYPE: 'int',
  ATTRIBUTE_02_VALUE: '0',
  ATTRIBUTE_03_NAME: 'NOTE',
  ATTRIBUTE_03_TYPE: 'string',
  ATTRIBUTE_03_VALUE: '',
});

test('overview shows stored values and divisions, with no migration controls', () => {
  const html = initializationView(ready([valued]));
  assert.match(html, /Gan/);
  assert.match(html, /false/);
  assert.match(html, />0<\/dd>/);
  assert.match(html, /&lt;Accueil&gt;/);
  assert.doesNotMatch(html, /migration|initialization-create|style=/i);
});

test('every value is readable without opening anything', () => {
  const html = initializationView(ready([valued, row('+33002', { DIVISION: 'CR' })]));
  assert.doesNotMatch(html, /<details|<summary/);
  assert.match(html, /<dt>ACTIVE<\/dt>\s*<dd>false<\/dd>/);
  assert.match(html, /<dt>NOTE<\/dt>\s*<dd class="empty">Vide<\/dd>/);
  assert.match(html, /Aucune donnée/);
  assert.match(html, />2 numéros</);
  assert.doesNotMatch(html, /\(s\)/);
  assert.match(initializationView(ready([valued])), />1 numéro</);
});

test('a number opens the data of its journey, when that journey is loaded', () => {
  const flows = [
    { id: 'other', nodes: [{ id: 'other', key: '+33009' }] },
    {
      id: 'entry',
      nodes: [
        { id: 'step', key: '+33002' },
        { id: 'entry', key: '+33001' },
      ],
    },
  ];
  const html = initializationView(ready([valued, row('+33002')]), [], false, flows);
  assert.equal(html.match(/data-action="initialization-edit"/g).length, 1);
  assert.match(
    html,
    /data-action="initialization-edit"[^>]*data-index="1"[^>]*aria-label="Modifier les données du \+33001"/,
  );
  assert.doesNotMatch(initializationView(ready([valued])), /initialization-edit/);
});

test('the page gives no instructions about the Architect flow or its storage', () => {
  for (const state of [ready([valued]), ready([]), { result: { status: 'loading' } }])
    assert.doesNotMatch(
      initializationView(state),
      /Architect|Application pendant|STUDIO_PARCOURS_INIT_V5/,
    );
  assert.match(initializationView(ready([])), /Aucun numéro enregistré/);
});

test('table setup is offered only when missing, and errors do not show a loading message', () => {
  assert.match(
    initializationView({ result: { status: 'missing' } }, [{ id: 'g', name: 'G2S' }]),
    /initialization-create/,
  );
  const html = initializationView({ result: { status: 'error', error: 'Lecture refusée' } });
  assert.match(html, /Lecture refusée/);
  assert.doesNotMatch(html, /Lecture de la table|initialization-create/);
});
