import test from 'node:test';
import assert from 'node:assert/strict';
import { businessFields } from '../src/business.js';
import { businessInspectorModel, adminSourceDetails, audienceNodeTitle, audienceNodeSubtitle, isContextNode, configuredStepFields } from '../src/journey-audience.js';

const node = (type, row, extra = {}) => ({ id: 'step', key: 'STEP_KEY', type, tableName: `W_${type.toUpperCase()}_v5`, row: { key: 'STEP_KEY', ...row }, ...extra });

test('business settings keep only configured business groups and preserve the existing editor field contract', () => {
  const step = node('service', { DESCRIPTION: 'Aider les clients', QUEUE: 'TEAM', PRIORITY: 5, WELCOME_AUDIO: 'tts:Bienvenue', INQUEUE_AUDIO_1: '', INQUEUE_HOLD_TIMEOUT_1: 10, SUBROUTINES_LIST: 'RECORDING', INQUEUE_SUBROUTINES_LIST_1: 'CHECK_AGENT', PDATA_LIST_1: 'segment==A', DECISION_OPERATOR: '==', SCRIPT: 'INTERNAL_SCRIPT', MINIMUM_AGENT_REQUIRED: 2 });
  const original = structuredClone(step);
  const result = businessInspectorModel(step);
  assert.deepEqual(result.fields.map(field => field.key), ['DESCRIPTION', 'INQUEUE_AUDIO_1', 'WELCOME_AUDIO', 'QUEUE', 'PRIORITY', 'INQUEUE_HOLD_TIMEOUT_1', 'MINIMUM_AGENT_REQUIRED', 'SCRIPT']);
  assert.ok(result.groups.every(group => group.fields.length > 0));
  assert.ok(result.groups.every(group => group.fields.every(field => result.fields.includes(field))));
  for (const field of result.fields) assert.deepEqual(field, businessFields(step).find(existing => existing.key === field.key));
  assert.equal(result.fields.find(field => field.key === 'QUEUE').editable, false);
  assert.equal(result.fields.find(field => field.key === 'WELCOME_AUDIO').editable, true);
  assert.deepEqual(step, original);
  assert.deepEqual(businessInspectorModel(node('pdata', { PDATA_LIST_1: 'CRISE==ACTIF' })).groups, []);
});

test('decision summaries remain factual while V5 conditions expose editable settings', () => {
  const v5 = node('decision', { PARTICIPANT_DATA_TO_CHECK: 'CRISE', DECISION_OPERATOR: '==', DECISION_VALUE: 'ACTIF' });
  const v4 = node('decision', { DECISION_TYPE: 'expression', DECISION_TARGET: 'CRISE|==|ACTIF' });
  for (const step of [v5, v4]) {
    const model = businessInspectorModel(step);
    assert.equal(model.summary, 'Crise est égal à Actif');
    assert.equal(model.summaryComplete, true);
    assert.deepEqual(model.fields.map(f=>f.key).sort(), step===v5?['DECISION_OPERATOR','DECISION_VALUE','PARTICIPANT_DATA_TO_CHECK']:[]);
    assert.equal(audienceNodeSubtitle(step), model.summary);
  }
  assert.equal(businessInspectorModel(node('decision', { DECISION_TYPE: 'Expression', DECISION_TARGET: 'CUSTOMER_DATA|>|0' })).summary, 'Customer Data est supérieur à 0');
  assert.equal(businessInspectorModel(node('decision', { PARTICIPANT_DATA_TO_CHECK: 'ACTIVATION_IT', DECISION_OPERATOR: '==', DECISION_VALUE: true })).summary, 'Activation IT est égal à Vrai');
});

test('missing and unsupported decisions remain visible as unresolved rather than receiving a guessed condition', () => {
  const missing = businessInspectorModel(node('decision', { PARTICIPANT_DATA_TO_CHECK: 'CRISE', DECISION_OPERATOR: '==' }));
  assert.equal(missing.summaryComplete, false);
  assert.match(missing.notes[0].message, /valeur de comparaison/);
  assert.equal(missing.summary, 'Condition incomplète');
  const unsupported = businessInspectorModel(node('decision', { DECISION_TYPE: 'LoggedInQueue', DECISION_TARGET: 'QUEUE|5' }));
  assert.equal(unsupported.summaryComplete, false);
  assert.match(unsupported.notes[0].message, /n’est pas interprété/);
  const complex = businessInspectorModel(node('decision', { DECISION_TYPE: 'expression', DECISION_TARGET: 'CRISE|==|ACTIF|AND|AUTRE' }));
  assert.equal(complex.summaryComplete, false);
  const blank = businessInspectorModel(node('decision', { PARTICIPANT_DATA_TO_CHECK: 'CRISE', DECISION_OPERATOR: '==', DECISION_VALUE: '' }));
  assert.equal(blank.summary, 'Crise est égal à une valeur vide');
});

test('business titles hide raw expressions and opaque keys but keep real descriptions; admin retains exact keys', () => {
  const raw = node('decision', { key: 'CRISE==|ACTIF', DESCRIPTION: 'CRISE==|ACTIF' }, { key: 'CRISE==|ACTIF' });
  assert.equal(audienceNodeTitle(raw), 'Règle d’orientation');
  assert.equal(audienceNodeTitle(raw, 'admin'), 'CRISE==|ACTIF');
  assert.deepEqual(businessInspectorModel(raw).fields, []);
  assert.equal(audienceNodeTitle(node('service', { DESCRIPTION: 'Assistance aux clients' })), 'Assistance aux clients');
  assert.equal(audienceNodeTitle(node('service', {}, { key: 'efb57f2e-3809-46e3-98fc-50fd41d3b525', row: {} })), 'Équipe de traitement');
  assert.equal(isContextNode(node('PDATA', {})), true);
});

test('existing source anomalies remain present in the business model', () => {
  const result = businessInspectorModel(node('service', { QUEUE: 'variable ', INQUEUE_TARGET_TYPE: 'service|satus:IDLE' }));
  assert.equal(result.notes.length, 2);
  assert.match(result.notes[0].message, /espaces/);
  assert.match(result.notes[1].message, /mal orthographié/);
  assert.equal(result.fields[0].display, 'File à vérifier · espaces dans la valeur');
});

test('administration renders all raw source and local fields as escaped readonly data, including pending input', () => {
  const source = node('decision', { UNKNOWN_FIELD: '<script>alert(1)</script>', PRIORITY: 1, REMOVED: 'old' });
  const local = node('decision', { UNKNOWN_FIELD: '<script>alert(1)</script>', PRIORITY: 2, EXTRA: { nested: 'value' } });
  const input = { node: local, sourceNode: source, pending: { PRIORITY: '3', NEW_INPUT: 'x' } };
  const original = structuredClone(input);
  const html = adminSourceDetails(input);
  assert.match(html, /W_DECISION_v5/);
  assert.match(html, /<dt>Version<\/dt><dd>5<\/dd>/);
  assert.match(html, /UNKNOWN_FIELD/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /À enregistrer/);
  assert.match(html, /Saisie non enregistrée/);
  assert.match(html, /Absent localement/);
  assert.match(html, /nested/);
  assert.equal((html.match(/<input/g) || []).length, 1, 'only the field search is an input');
  assert.doesNotMatch(html, /data-action="(?:save|apply)|contenteditable|<textarea|<select/);
  assert.deepEqual(input, original);
  const filtered = adminSourceDetails({ ...input, query: 'priority' });
  assert.match(filtered, /PRIORITY/);
  assert.doesNotMatch(filtered, /UNKNOWN_FIELD/);
});

test('missing administration baseline is explicit and never treated as a known unchanged source', () => {
  const html = adminSourceDetails({ node: node('menu', { MENU_TIMEOUT: 5 }) });
  assert.match(html, /source originale est indisponible/);
  assert.match(html, /Origine indisponible/);
  assert.doesNotMatch(html, />Identique</);
});


test('business groups use the agreed reading order and include empty selectable resources and preserve zero', () => {
  const step = node('menu', { DESCRIPTION: 'Menu client', PRIORITY: 0, MENU_TIMEOUT: 0, LANGUAGE: 'fr-fr', SCHEDULE_GROUP: '', SKILLS: '', WELCOME_AUDIO: '', MENU_AUDIO: '', INQUEUE_HOLD_TIMEOUT_1: '', SUBROUTINES_LIST: '' });
  const result = businessInspectorModel(step);
  assert.deepEqual(result.groups.map(group => group.id), ['name', 'messages', 'language', 'calendars', 'team', 'input']);
  assert.equal(result.fields.find(field => field.key === 'PRIORITY').value, 0);
  assert.equal(result.fields.find(field => field.key === 'MENU_TIMEOUT').value, 0);
  assert.ok(result.fields.some(field => field.key === 'WELCOME_AUDIO'));
  assert.ok(result.fields.some(field => field.key === 'MENU_AUDIO'));
  assert.ok(result.fields.some(field => field.key === 'SKILLS'));
  assert.ok(result.fields.some(field => field.key === 'SCHEDULE_GROUP'));
  assert.ok(!result.fields.some(field => field.key === 'INQUEUE_HOLD_TIMEOUT_1'));
});


test('business titles retain distinctive named keys and the human part of calendar descriptions', () => {
  const claims = node('service', { DESCRIPTION: 'SC2_DISTRIBUTION_SINISTRE_CR' }, { key: 'SC2_DISTRIBUTION_SINISTRE_CR' });
  const contracts = node('service', { DESCRIPTION: 'SC2_DISTRIBUTION_CONTRAT_CR' }, { key: 'SC2_DISTRIBUTION_CONTRAT_CR' });
  assert.equal(audienceNodeTitle(claims), 'SC2 Distribution Sinistre CR');
  assert.equal(audienceNodeTitle(contracts), 'SC2 Distribution Contrat CR');
  assert.notEqual(audienceNodeTitle(claims), audienceNodeTitle(contracts));
  assert.equal(audienceNodeTitle(node('service', {}, { key: 'SC2_DISTRIBUTION_SINISTRE_CR' })), 'SC2 Distribution Sinistre CR');
  const calendar = node('schedulegroup', { DESCRIPTION: 'calendrier du scenario 2 CRC | Schedule_Group_CR | EMERGENCY_CR' });
  assert.equal(audienceNodeTitle(calendar), 'calendrier du scenario 2 CRC');
  assert.equal(audienceNodeTitle(node('service', {}, { key: 'W_DISTRIBUTION_v4', row: {} })), 'Équipe de traitement');
  assert.equal(audienceNodeTitle(node('decision', {}, { key: 'CRISE|==|ACTIF', row: {} })), 'Règle d’orientation');
});

test('configured fields hide only empty values and retain name, zero, false and pending clears',()=>{
  const fields=Object.entries({DESCRIPTION:'',EMPTY:'',NULL:null,ABSENT:undefined,SPACES:'  ',ZERO:0,FALSE:false,TEXT:'Bonjour',CLEAR:'',NEW:null}).map(([key,value])=>({key,value}));
  assert.deepEqual(configuredStepFields(fields,{CLEAR:'',NEW:{resource:'Q Auto'}}).map(f=>f.key),['DESCRIPTION','ZERO','FALSE','TEXT','CLEAR','NEW']);
  assert.equal(configuredStepFields(fields,{},false),fields);
});
