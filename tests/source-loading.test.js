import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedDuringSourceLoad } from '../src/source-loading.js';

test('partial catalogues allow discovery and recovery controls, never changes or incomplete analyses', () => {
  for (const view of ['catalogue', 'references', 'settings'])
    assert.equal(allowedDuringSourceLoad('nav', view), true);
  for (const view of [
    'flow',
    'family',
    'changes',
    'publication',
    'simulation',
    'compare',
    'configuration',
    'diagnostic',
  ])
    assert.equal(allowedDuringSourceLoad('nav', view), false);
  for (const action of [
    'catalogue-reset',
    'catalogue-model-clear',
    'source-retry',
    'logout',
    'refresh',
  ])
    assert.equal(allowedDuringSourceLoad(action), true);
  for (const action of [
    'save-node',
    'workspace-restore',
    'workspace-dismiss',
    'open-flow',
    'open-activity',
    'model-rename-save',
    'core-model-next',
    'clone-confirm',
    'simulation-start',
    'publication-prepare',
    'publication-commit',
    'import',
  ])
    assert.equal(allowedDuringSourceLoad(action), false);
});
