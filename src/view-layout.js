/** Numeric geometry only. Static presentation belongs in the component's CSS. */
const units = {
  left: 'left',
  top: 'top',
  width: 'width',
  height: 'height',
  maxHeight: 'max-height',
};
const documents = new WeakMap();

export function layoutDeclarations(values) {
  return Object.entries(values)
    .map(([name, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new TypeError('Invalid layout value: ' + name);
      if (Object.hasOwn(units, name)) return `${units[name]}:${value}px`;
      if (name === 'scale' && value > 0) return `transform:scale(${value})`;
      if (name === 'lineClamp' && Number.isInteger(value) && value > 0)
        return `-webkit-line-clamp:${value}`;
      throw new TypeError('Unsupported layout property: ' + name);
    })
    .join(';');
}

/** Templates declare numbers, never CSS or executable handlers. */
export function layoutAttributes(values) {
  layoutDeclarations(values);
  return `data-layout="${JSON.stringify(values).replaceAll('"', '&quot;')}"`;
}

function manager(doc) {
  if (!documents.has(doc)) {
    const sheet = new doc.defaultView.CSSStyleSheet();
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    documents.set(doc, { sheet, entries: new Map(), nextId: 0 });
  }
  return documents.get(doc);
}

function remember(state, element, values) {
  layoutDeclarations(values);
  const entry = state.entries.get(element) || { id: ++state.nextId, values: {} };
  entry.values = { ...entry.values, ...values };
  element.setAttribute('data-layout-id', String(entry.id));
  state.entries.set(element, entry);
}

function refresh(state) {
  const rules = [];
  for (const [element, entry] of state.entries) {
    if (!element.isConnected) {
      state.entries.delete(element);
      continue;
    }
    rules.push(`[data-layout-id="${entry.id}"]{${layoutDeclarations(entry.values)}}`);
  }
  state.sheet.replaceSync(rules.join('\n'));
}

/** One stylesheet update per render; detached cards and popups are discarded. */
export function applyViewLayout(root) {
  const state = manager(root.ownerDocument || root);
  for (const element of root.querySelectorAll('[data-layout]')) {
    remember(state, element, JSON.parse(element.getAttribute('data-layout')));
  }
  refresh(state);
}

/** Used when zoom or viewport placement changes without re-rendering the view. */
export function setElementLayout(element, values) {
  const state = manager(element.ownerDocument);
  remember(state, element, values);
  refresh(state);
}
