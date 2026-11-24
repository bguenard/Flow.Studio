import test from 'node:test';
import assert from 'node:assert/strict';
import { initializationView } from '../src/initialization-view.js';
test('overview shows stored values and divisions, with no migration controls', () => {
  const html = initializationView({
    result: {
      status: 'ready',
      table: {
        rows: [
          {
            key: '+33001',
            DESCRIPTION: '<Accueil>',
            DIVISION: 'Gan',
            ATTRIBUTE_01_NAME: 'ACTIVE',
            ATTRIBUTE_01_TYPE: 'bool',
            ATTRIBUTE_01_VALUE: 'false',
            ATTRIBUTE_02_NAME: 'COUNT',
            ATTRIBUTE_02_TYPE: 'int',
            ATTRIBUTE_02_VALUE: '0',
          },
        ],
      },
    },
  });
  assert.match(html, /Gan/);
  assert.match(html, /false/);
  assert.match(html, />0<\/dd>/);
  assert.match(html, /&lt;Accueil&gt;/);
  assert.match(html, /Données du parcours/);
  assert.doesNotMatch(html, /migration|initialization-create|style=/i);
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
