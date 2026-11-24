import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldLabel,
  fieldSection,
  isIdentityField,
  isCopyableField,
  coerceRowValue,
} from '../src/draft-fields.js';

test('French labels and identity recognition are safe for arbitrary column names', () => {
  assert.equal(fieldLabel('WELCOME_AUDIO'), 'Message d’accueil');
  assert.equal(fieldLabel('OPEN_TARGET_TYPE'), 'En ouverture · type de destination');
  assert.equal(fieldLabel('OPTION1_TARGET'), 'Choix 1 · destination');
  assert.equal(fieldLabel('OPTIONSTAR_TARGET_TYPE'), 'Choix étoile (*) · type de destination');
  assert.equal(fieldLabel('OPTIONDIEZ_AUDIO'), 'Choix dièse (#) · annonce');
  assert.equal(fieldLabel('TARGET_TYPE_10'), 'Répartition 10 · type de destination');
  assert.equal(fieldLabel('RATIO_10'), 'Poids de répartition 10');
  assert.equal(fieldLabel('RECORDING_ANNOUNCE_AUDIO'), 'Annonce d’enregistrement');
  assert.equal(fieldLabel('constructor'), 'constructor');
  assert.equal(fieldLabel('__proto__'), '__proto__');
  for (const key of [
    'key',
    'DNIS_SEGMENT',
    'SERVICE',
    'MENU_NAME',
    'PDATA_NAME',
    'SCHEDULE_GROUP_KEY',
  ])
    assert.equal(isIdentityField(key), true, key);
  assert.equal(isIdentityField('PRIORITY'), false);
});

test('copy allowlist excludes IDs, resource references, unknowns and target type changes', () => {
  for (const key of [
    'key',
    'DNIS_SEGMENT',
    'DIVISION',
    'QUEUE',
    'SKILLS',
    'LANGUAGE_SKILL',
    'NEXT_TARGET',
    'NEXT_TARGET_TYPE',
    'INQUEUE_MENU_1',
    'CUSTOM_REFERENCE',
    'constructor',
  ])
    assert.equal(isCopyableField(key, 'a'), false, key);
  for (const key of [
    'DESCRIPTION',
    'PRIORITY',
    'MENU_TIMEOUT',
    'MENU_REPEAT',
    'INQUEUE_REPEAT',
    'INQUEUE_HOLD_TIMEOUT_4',
  ])
    assert.equal(isCopyableField(key, '1'), true, key);
  assert.equal(isCopyableField('WELCOME_AUDIO', 'tts:Bonjour'), true);
  for (const value of [
    'pr:Accueil',
    'tts:',
    'tts:Bonjour|pr:Accueil',
    'tts:Bonjour|var:CLIENT',
    'tts:Bonjour $var:CLIENT$',
  ])
    assert.equal(isCopyableField('WELCOME_AUDIO', value), false, value);
});

test('CSV strings remain strings, schema numbers are explicit and blanks are not zero', () => {
  assert.equal(coerceRowValue('0012', '0013'), '0013');
  assert.equal(coerceRowValue('0', 'false'), 'false');
  assert.equal(coerceRowValue('12', '13', { type: 'integer' }), 13);
  assert.equal(coerceRowValue('12', '13', { type: 'string' }), '13');
  assert.equal(coerceRowValue(1, '2'), 2);
  for (const invalid of ['', ' ', 'NaN', 'Infinity', '0x10', '1e999'])
    assert.throws(() => coerceRowValue(1, invalid));
  assert.throws(() => coerceRowValue(1, '1.5', { type: 'integer' }), /entier/);
});

test('voice v4 and v5 fields group into business sections without hiding unknowns', () => {
  const expected = {
    key: 'identite',
    DESCRIPTION: 'identite',
    DIVISION: 'identite',
    RECORDING_ENABLE: 'accueil',
    RECORDING_ANNOUNCE_AUDIO: 'accueil',
    RECORDING_CONSENT_MENU: 'accueil',
    BLOCK_ANI_CHECK: 'accueil',
    SCHEDULE_GROUP: 'horaires',
    EXCEPTIONAL_DAYS_NAME: 'horaires',
    OPEN_TARGET: 'horaires',
    EMERGENCY_TARGET_TYPE: 'horaires',
    PRIORITY: 'distribution',
    NOTLOGGEDIN_TARGET_TYPE: 'distribution',
    QUEUE: 'distribution',
    OPTIONSTAR_AUDIO: 'menu',
    OPTIONDIEZ_TARGET: 'menu',
    MENU_TIMEOUT: 'menu',
    INQUEUE_TARGET: 'attente',
    INQUEUE_PIQ_EWT_PLAY_POSITION: 'attente',
    NEXT_TARGET: 'routage',
    TARGET_TYPE_10: 'routage',
    RATIO_10: 'routage',
    FLOW_NAME: 'routage',
    PDATA_LIST_1: 'contexte',
    DECISION_OPERATOR: 'contexte',
    SUBROUTINES_LIST: 'avance',
    CUSTOM_FIELD: 'avance',
    constructor: 'avance',
    __proto__: 'avance',
  };
  for (const [key, section] of Object.entries(expected))
    assert.equal(fieldSection(key), section, key);
  assert.equal(fieldSection('__proto__'), 'avance');
});

test('strict booleans, schemas, bounds and enum reject invalid local drafts', () => {
  assert.equal(coerceRowValue(true, 'false'), false);
  assert.throws(() => coerceRowValue(true, '0'), /true ou false/);
  assert.throws(() => coerceRowValue(2, '-1', { type: 'number', minimum: 0 }), /au moins/);
  assert.throws(() => coerceRowValue(2, '11', { type: 'number', maximum: 10 }), /au plus/);
  assert.throws(() => coerceRowValue(2, '3', { type: 'integer', enum: [2, 5] }), /autorisée/);
  assert.throws(() => coerceRowValue('a', 'abcd', { type: 'string', maxLength: 3 }), /Limiter/);
  assert.equal(coerceRowValue(null, 'null', { type: ['string', 'null'] }), null);
  assert.equal(coerceRowValue(null, 'Accueil', { type: ['string', 'null'] }), 'Accueil');
  assert.deepEqual(coerceRowValue({ a: 1 }, '{"a":2}'), { a: 2 });
  assert.throws(() => coerceRowValue({}, '[]'), /object/);
});
