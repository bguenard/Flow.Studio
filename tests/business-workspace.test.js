import test from 'node:test';
import assert from 'node:assert/strict';
import { businessFields } from '../src/business.js';
import { availableBusinessTasks, taskFields } from '../src/business-workspace.js';
import { prepareStepDraft } from '../src/step-draft.js';
const node = {
  id: 'service:one',
  type: 'service',
  key: 'one',
  row: {
    key: 'one',
    DESCRIPTION: 'Conseil',
    PRIORITY: 3,
    MENU_TIMEOUT: 8,
    INQUEUE_REPEAT: 2,
    MINIMUM_AGENT_REQUIRED: 1,
    RATIO_1: 50,
    ENABLE_RECORDING: false,
    BLOCK_ANI_CHECK: true,
    USE_CALLER_ANI: true,
    ASK_FOR_ANI_WITH_COUNTRY_CODE: false,
    INQUEUE_NOTLOGGEDIN_AGENT_CHECK: true,
    INQUEUE_PIQ_EWT_PLAY_POSITION: false,
    SCHEDULE_GROUP: 'calendar',
    QUEUE: 'team',
  },
};
test('every supported editable scalar is accessible through a business filter beyond messages and priorities', () => {
  const tasks = availableBusinessTasks({ nodes: [node] });
  assert.deepEqual(
    tasks.map((t) => t.id),
    [
      'all',
      'team',
      'calendars',
      'input',
      'waiting',
      'limits',
      'weights',
      'recording',
      'identity',
      'checks',
    ],
  );
  const reachable = new Set(
    tasks.filter((t) => t.id !== 'all').flatMap((t) => taskFields(node, t.id).map((f) => f.key)),
  );
  for (const field of businessFields(node).filter((f) => f.editable && f.key !== 'DESCRIPTION'))
    assert.ok(reachable.has(field.key), field.key);
  assert.equal(taskFields(node, 'recording')[0].value, false);
  assert.equal(taskFields(node, 'calendars')[0].editable, false);
});
test('editing another business category preserves resource references and pending changes from other categories', () => {
  const before = structuredClone(node);
  const row = prepareStepDraft({
    node,
    pending: { MENU_TIMEOUT: '12' },
    visibleValues: { DESCRIPTION: 'Conseil', ENABLE_RECORDING: 'true' },
  });
  assert.equal(row.MENU_TIMEOUT, 12);
  assert.equal(row.ENABLE_RECORDING, true);
  assert.equal(row.QUEUE, 'team');
  assert.equal(row.PRIORITY, 3);
  assert.deepEqual(node, before);
});
