import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarCollapsed, readSidebarPreference, writeSidebarPreference } from '../src/sidebar.js';

const store = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test('without a choice, the menu is reduced where room is scarce: in a journey and on a narrow window', () => {
  assert.equal(sidebarCollapsed({ studio: false, width: 1600 }), false);
  assert.equal(sidebarCollapsed({ studio: true, width: 1600 }), true);
  assert.equal(sidebarCollapsed({ studio: false, width: 980 }), true);
});

test('the choice of the user applies on every page', () => {
  assert.equal(sidebarCollapsed({ preference: true, studio: false, width: 1600 }), true);
  assert.equal(sidebarCollapsed({ preference: false, studio: true, width: 1600 }), false);
  assert.equal(sidebarCollapsed({ preference: false, studio: false, width: 980 }), false);
});

test('on a phone the menu keeps its own layout whatever was chosen on a large screen', () => {
  assert.equal(sidebarCollapsed({ preference: true, studio: false, width: 600 }), false);
  assert.equal(sidebarCollapsed({ preference: false, studio: true, width: 600 }), true);
});

test('the choice is remembered, and an unavailable or unknown storage means no choice', () => {
  const storage = store();
  assert.equal(readSidebarPreference(storage), null);
  writeSidebarPreference(storage, true);
  assert.equal(readSidebarPreference(storage), true);
  writeSidebarPreference(storage, false);
  assert.equal(readSidebarPreference(storage), false);
  assert.equal(readSidebarPreference(null), null);
  assert.equal(
    readSidebarPreference({
      getItem() {
        throw Error('bloqué');
      },
    }),
    null,
  );
  assert.doesNotThrow(() =>
    writeSidebarPreference(
      {
        setItem() {
          throw Error('plein');
        },
      },
      true,
    ),
  );
  assert.equal(readSidebarPreference({ getItem: () => 'autre chose' }), null);
});
