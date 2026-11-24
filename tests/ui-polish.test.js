import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceInventory } from '../src/data-source.js';
import { demoSnapshot } from '../src/demo-snapshot.js';
import { stepIcon } from '../src/journey-navigation.js';

const flow = buildVoiceInventory(demoSnapshot).flows.find(
  (item) => item.key === 'DEMO_ENTREE_ATLANTIQUE',
);

test('step types have distinct icons, with a neutral one for unknown types', () => {
  assert.ok(new Set(flow.nodes.map((node) => stepIcon(node.type))).size >= 4);
  assert.equal(stepIcon('type-inconnu'), 'layers');
});

test('background loading is one quiet line; only a failed load gets a framed notice with a retry', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    css = await readFile(new URL('../src/catalogue.css', import.meta.url), 'utf8');
  const start = app.indexOf('function sourceLoadingNotice()'),
    notice = app.slice(start, app.indexOf('\n}\n', start));
  assert.match(notice, /<p class="source-loading-status" role="status">/);
  assert.match(
    notice,
    /<div class="source-loading-status failed" role="alert">[\s\S]*source-retry/,
  );
  // The count is refreshed in place while tables arrive: both states keep its anchor.
  assert.equal(notice.split('id="source-load-count"').length - 1, 1);
  assert.equal(notice.split('${count}').length - 1, 2);
  const rule = (selector) =>
    css.match(new RegExp(selector.replace(/[.]/g, '\\.') + ' \\{([^}]*)\\}'))?.[1] || '';
  assert.doesNotMatch(rule('.source-loading-status'), /background|border/);
  assert.match(rule('.source-loading-status.failed'), /background/);
});

test('each sidebar entry has its own icon, and every icon exists', async () => {
  const { readFile } = await import('node:fs/promises');
  const { icons } = await import('../src/ui-kit.js');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function shell(body)'),
    shell = app.slice(start, app.indexOf('\n}\n', start));
  const names = [
    // One entry per line: [view, icon].
    ...[...shell.matchAll(/^\s+\['\w+', '(\w+)'\],$/gm)].map((match) => match[1]),
    ...[...shell.matchAll(/icon\('(\w+)'\)/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'chevron'),
  ];
  assert.equal(names.length, 9);
  assert.deepEqual(
    names.filter((name, index) => names.indexOf(name) !== index),
    [],
  );
  for (const name of names) assert.ok(icons[name], name);
});
