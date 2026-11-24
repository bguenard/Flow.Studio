import test from 'node:test';
import assert from 'node:assert/strict';
import { booleanSwitchSpec, booleanControl } from '../src/boolean-control.js';
import { stepFieldView } from '../src/step-field-view.js';
import { prepareStepDraft } from '../src/step-draft.js';

const schema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    DESCRIPTION: { type: 'string' },
    PARTICIPANT_DATA_TO_CHECK: { type: 'string' },
    DECISION_OPERATOR: { type: 'string' },
    DECISION_VALUE: { type: 'string' },
  },
};
const node = {
  id: 'decision:d',
  key: 'd',
  tableId: 'decision',
  tableName: 'W_DECISION_v5',
  schema,
  row: {
    key: 'd',
    DESCRIPTION: 'Activation',
    PARTICIPANT_DATA_TO_CHECK: 'Actif',
    DECISION_OPERATOR: '==',
    DECISION_VALUE: 'True',
  },
};
const field = {
  key: 'DECISION_VALUE',
  label: 'Valeur de comparaison',
  kind: 'text',
  schema: { type: 'string' },
  editable: true,
  value: 'True',
};

test('decision values use switches without changing their string type or unrelated fields', () => {
  const spec = booleanSwitchSpec('True', { key: 'DECISION_VALUE', schema: { type: 'string' } });
  assert.deepEqual([spec.on, spec.off, spec.checked], ['True', 'False', true]);
  const html = stepFieldView(field, 2, { node, admin: true });
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /data-field="DECISION_VALUE"/);
  assert.match(html, /value="True"/);
  assert.match(html, /Saisir une autre valeur/);
  assert.deepEqual(
    prepareStepDraft({ node, schema, visibleValues: { DECISION_VALUE: 'True' } }),
    node.row,
  );
  const saved = prepareStepDraft({
    node,
    schema,
    pending: { DECISION_VALUE: spec.off },
    visibleValues: { DECISION_VALUE: spec.off },
  });
  assert.equal(saved.DECISION_VALUE, 'False');
  assert.equal(typeof saved.DECISION_VALUE, 'string');
  assert.equal(node.row.DECISION_VALUE, 'True');
  assert.deepEqual({ ...saved, DECISION_VALUE: 'True' }, node.row);
});

test('native false and unset booleans stay distinct; enums retain their exact tokens', () => {
  assert.equal(
    booleanSwitchSpec(false, { kind: 'boolean', schema: { type: 'boolean' } }).empty,
    false,
  );
  const spec = booleanSwitchSpec(null, { kind: 'boolean', schema: { type: ['boolean', 'null'] } });
  assert.equal(spec.empty, true);
  assert.equal(spec.checked, false);
  const html = booleanControl({
    id: 'x',
    attrs: 'id="x" data-field="FLAG"',
    value: null,
    spec,
    label: 'Activer',
  });
  assert.match(html, /Non renseigné/);
  assert.match(html, /value=""/);
  assert.equal(
    booleanSwitchSpec('TRUE', { schema: { type: 'string', enum: ['TRUE', 'FALSE'] } }).off,
    'FALSE',
  );
  assert.equal(
    booleanSwitchSpec('True', { kind: 'boolean', schema: { type: 'boolean' } }).off,
    'false',
  );
});

test('free text, audio, read-only fields and constrained non-boolean enums keep their editors', () => {
  for (const value of ['true story', '1', 'yes', '$var:Active$'])
    assert.equal(booleanSwitchSpec(value, { schema: { type: 'string' } }), null);
  assert.equal(booleanSwitchSpec('true', { key: 'DESCRIPTION', schema: { type: 'string' } }), null);
  assert.equal(booleanSwitchSpec('true', { kind: 'audio' }), null);
  assert.equal(
    booleanSwitchSpec('true', { schema: { type: 'string', enum: ['true', 'other'] } }),
    null,
  );
  assert.doesNotMatch(
    stepFieldView({ ...field, editable: false, display: 'True' }, 2, { node }),
    /role="switch"/,
  );
  const html = stepFieldView(field, 2, { node, advanced: true });
  assert.doesNotMatch(html, /role="switch"/);
  assert.match(html, /type="text"/);
});

test('pending false remains off after rendering the step again', () => {
  const html = stepFieldView(field, 2, { node, pending: { DECISION_VALUE: 'False' } });
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /value="False"/);
});
