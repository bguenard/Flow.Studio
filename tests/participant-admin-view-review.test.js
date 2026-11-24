import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participantAdminView,
  participantEditor,
  participantEditorRow,
} from '../src/participant-admin-view.js';
import {
  participantCatalogueDefinition,
  participantDefinition,
} from '../src/participant-catalogue.js';
import { renderParticipantValue } from '../src/participant-value-control.js';

const division = { id: 'g2s', name: 'G2S' };
const definition = {
  ...participantDefinition('ACTIVE', 'true', division),
  LABEL: 'Activation',
  ALLOWED_VALUES: '',
};
const options = {
  catalogue: {
    status: 'ready',
    table: { id: 'catalogue', ...participantCatalogueDefinition(division.id), rows: [definition] },
  },
  divisions: [division],
  snapshot: { tables: [] },
};

test('admin confirmation displays the checked plan even if mutable form state changes during validation', () => {
  const editor = participantEditor(definition);
  editor.label = 'Libellé vérifié';
  const after = participantEditorRow(editor, [division]);
  editor.review = {
    after: structuredClone(after),
    before: structuredClone(definition),
    dynamic: 0,
  };
  editor.label = 'Libellé non vérifié';
  editor.defaultValue = 'false';
  const html = participantAdminView({ editor }, options);
  assert.match(html, />Libellé vérifié</);
  assert.doesNotMatch(html, /Libellé non vérifié/);
  assert.match(html, /<dt>Valeur par défaut<\/dt><dd>true<\/dd>/);
});

test('unrelated malformed legacy runtime data cannot crash the catalogue editor', () => {
  const snapshot = {
    tables: [{ name: 'W_PARTICIPANT_DATA_v5', rows: [{ key: 'LEGACY', PDATA_LIST_1: 'BROKEN' }] }],
  };
  let html;
  assert.doesNotThrow(() => {
    html = participantAdminView(
      { editor: participantEditor(definition) },
      { ...options, snapshot },
    );
  });
  assert.match(html, /participant-admin-label/);
  assert.match(html, /vérifi|configur|invalide|lecture/i);
});

test('invalid legacy Boolean remains visible instead of looking unset', () => {
  const html = renderParticipantValue({ definition, value: 'LEGACY_INVALID', id: 'active-value' });
  // The hidden form value preserves the token, but the visible message must explain it too.
  const visible = html.replace(/<[^>]*>/g, ' ');
  assert.match(visible, /LEGACY_INVALID/);
  assert.match(html, /aria-invalid="true"/);
});
