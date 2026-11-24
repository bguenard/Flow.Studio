import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyViewLayout,
  setElementLayout,
  layoutAttributes,
  layoutDeclarations,
} from '../src/view-layout.js';

function documentFixture() {
  const doc = {
    adoptedStyleSheets: [],
    defaultView: {
      CSSStyleSheet: class {
        replaceSync(css) {
          this.css = css;
        }
      },
    },
  };
  const element = (values = {}) => ({
    ownerDocument: doc,
    isConnected: true,
    attributes: { 'data-layout': JSON.stringify(values) },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    getAttribute(key) {
      return this.attributes[key];
    },
  });
  return { doc, element };
}
test('geometry accepts finite numeric values only, never CSS strings', () => {
  assert.equal(
    layoutDeclarations({ left: -10, width: 300, scale: 0.75, lineClamp: 3 }),
    'left:-10px;width:300px;transform:scale(0.75);-webkit-line-clamp:3',
  );
  for (const values of [
    { width: Infinity },
    { top: NaN },
    { left: '0;display:none' },
    { color: 1 },
    { scale: 0 },
    { lineClamp: 1.5 },
  ])
    assert.throws(() => layoutAttributes(values));
  assert.doesNotMatch(layoutAttributes({ width: 320 }), /style=/);
});
test('render, zoom and popup updates preserve other geometry without inline style', () => {
  const { doc, element } = documentFixture(),
    card = element({ left: 20, width: 300, scale: 1 });
  applyViewLayout({ ownerDocument: doc, querySelectorAll: () => [card] });
  setElementLayout(card, { scale: 0.7 });
  const popup = element();
  setElementLayout(popup, { top: 45, maxHeight: 210 });
  assert.equal(doc.adoptedStyleSheets.length, 1);
  assert.match(doc.adoptedStyleSheets[0].css, /left:20px;width:300px;transform:scale\(0.7\)/);
  assert.match(doc.adoptedStyleSheets[0].css, /top:45px;max-height:210px/);
  assert.equal(card.attributes.style, undefined);
  card.isConnected = false;
  setElementLayout(popup, { top: 60 });
  assert.doesNotMatch(doc.adoptedStyleSheets[0].css, /left:20px/);
});
