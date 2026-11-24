/** Progressive enhancement: the native select remains the form/data authority. */
export const normalizeSelectSearch = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[’‘]/g, "'").trim();
export function matchingSelectOptions(options, query = '') {
  const words = normalizeSelectSearch(query).split(/\s+/).filter(Boolean);
  return options.filter(option => { const label = normalizeSelectSearch(`${option.label} ${option.group || ''}`); return words.every(word => label.includes(word)); });
}
export function selectNeedsSearch(options) {
  return !(options.length === 2 && options.map(option => normalizeSelectSearch(option.label)).sort().join('|') === 'non|oui');
}

const managers = new WeakMap();
let unique = 0;
const chevron = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const magnifier = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/><path d="m13 13 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const checkmark = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Call immediately after rendering and before restoring focus. Idempotent per document. */
export function enhanceSelects(root = document) {
  const doc = root.ownerDocument || root, win = doc.defaultView;
  managers.get(doc)?.destroy();
  const controller = new win.AbortController(), cleanups = [], enhanced = new Map();
  let opened = null;
  const listen = (target, type, handler, extra = {}) => target.addEventListener(type, handler, { ...extra, signal: controller.signal });
  const element = (tag, className, text) => { const item = doc.createElement(tag); if (className) item.className = className; if (text != null) item.textContent = text; return item; };
  const disabled = select => select.disabled || select.matches(':disabled');

  function close(restore = false) {
    if (!opened) return;
    const item = opened; opened = null;
    item.popupController?.abort(); item.popup.remove(); item.button.setAttribute('aria-expanded', 'false'); item.button.removeAttribute('aria-activedescendant');
    if (restore && item.button.isConnected) item.button.focus({ preventScroll: true });
  }
  function optionsFor(select) {
    return [...select.options].map((option, index) => ({ index, value: option.value, label: option.label, group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '', disabled: option.disabled || option.parentElement?.disabled === true, hidden: option.hidden || option.parentElement?.hidden === true }));
  }
  function sync(item) {
    item.button.disabled = disabled(item.select);
    item.value.textContent = item.select.selectedOptions[0]?.label || item.select.getAttribute('data-placeholder') || 'Choisir une option';
    item.button.classList.toggle('is-placeholder', item.select.value === '');
    item.button.setAttribute('aria-required', String(item.select.required));
    if (item.select.getAttribute('aria-describedby')) item.button.setAttribute('aria-describedby', item.select.getAttribute('aria-describedby'));
    if (item.select.getAttribute('aria-invalid')) item.button.setAttribute('aria-invalid', item.select.getAttribute('aria-invalid'));
  }
  function activate(item, index) {
    const enabled = item.filtered.filter(option => !option.disabled);
    if (!enabled.some(option => option.index === index)) index = enabled[0]?.index ?? -1;
    item.activeIndex = index;
    for (const option of item.list.querySelectorAll('[role="option"]')) option.classList.toggle('is-active', Number(option.dataset.optionIndex) === index);
    const id = index < 0 ? '' : `${item.list.id}-${index}`;
    for (const control of [item.button, item.search].filter(Boolean)) { if (id) control.setAttribute('aria-activedescendant', id); else control.removeAttribute('aria-activedescendant'); }
    const active = id && doc.getElementById(id);
    if (active) { const top = active.offsetTop - item.list.offsetTop; if (top < item.list.scrollTop) item.list.scrollTop = top; else if (top + active.offsetHeight > item.list.scrollTop + item.list.clientHeight) item.list.scrollTop = top + active.offsetHeight - item.list.clientHeight; }
  }
  function renderOptions(item, query = '') {
    item.filtered = matchingSelectOptions(item.options.filter(option => !option.hidden), query);
    item.list.replaceChildren();
    let previousGroup = null;
    for (const option of item.filtered) {
      if (option.group && option.group !== previousGroup) { const group = element('div', 'wolf-select-group', option.group); group.setAttribute('role', 'presentation'); item.list.append(group); }
      previousGroup = option.group;
      const row = element('div', 'wolf-select-option');
      row.id = `${item.list.id}-${option.index}`; row.dataset.optionIndex = String(option.index); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(item.select.selectedIndex === option.index));
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.append(element('span', 'wolf-select-option-label', option.label || 'Aucune sélection'));
      const mark = element('span', 'wolf-select-option-check'); mark.innerHTML = checkmark; row.append(mark); item.list.append(row);
    }
    if (!item.filtered.length) item.list.append(element('div', 'wolf-select-empty', 'Aucun résultat. Essayez un autre terme.'));
    item.count.textContent = `${item.filtered.length} choix${query ? ' correspondant' + (item.filtered.length > 1 ? 's' : '') : ''}`;
    activate(item, item.filtered.some(option => option.index === item.select.selectedIndex) ? item.select.selectedIndex : -1);
  }
  function position(item) {
    const rect = item.button.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 300), 760, win.innerWidth - 24);
    const below = win.innerHeight - rect.bottom - 14, above = rect.top - 14, up = below < 220 && above > below;
    const available = Math.max(100, Math.min(420, up ? above : below));
    item.popup.style.width = `${width}px`; item.popup.style.maxHeight = `${available}px`;
    item.popup.style.left = `${Math.max(12, Math.min(rect.left, win.innerWidth - width - 12))}px`;
    item.popup.style.top = `${up ? Math.max(12, rect.top - item.popup.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
    item.popup.dataset.placement = up ? 'above' : 'below';
  }
  function choose(item, index) {
    const option = item.options.find(option => option.index === index);
    if (!option || option.disabled || disabled(item.select)) return;
    const previous = item.select.selectedIndex, id = item.select.id, pickerId = item.button.id;
    item.select.selectedIndex = index; sync(item); close(true);
    if (previous !== index) {
      item.select.dispatchEvent(new win.Event('input', { bubbles: true }));
      // An input handler may synchronously re-render the page before change.
      const current = item.select.isConnected ? item.select : id ? doc.getElementById(id) : null;
      if (current?.tagName === 'SELECT') current.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
    doc.getElementById(pickerId)?.focus({ preventScroll: true });
  }
  function open(item, initialQuery = '') {
    if (disabled(item.select)) return;
    if (opened === item) return;
    close(); sync(item); item.options = optionsFor(item.select);
    item.popup = element('div', 'wolf-select-popup'); item.popupController = new win.AbortController();
    const popupListen = (target, type, handler) => target.addEventListener(type, handler, { signal: item.popupController.signal });
    item.list = element('div', 'wolf-select-list'); item.list.id = `${item.button.id}--list`; item.list.setAttribute('role', 'listbox'); item.list.setAttribute('aria-label', item.label);
    item.count = element('div', 'wolf-select-count'); item.count.setAttribute('role', 'status'); item.count.setAttribute('aria-live', 'polite');
    item.search = null;
    if (selectNeedsSearch(item.options)) {
      const searchWrap = element('div', 'wolf-select-search'); const icon = element('span', 'wolf-select-search-icon'); icon.innerHTML = magnifier;
      item.search = element('input'); item.search.type = 'search'; item.search.placeholder = 'Rechercher…'; item.search.autocomplete = 'off'; item.search.spellcheck = false;
      item.search.setAttribute('aria-label', `Rechercher dans ${item.label}`); item.search.setAttribute('aria-controls', item.list.id); item.search.value = initialQuery;
      searchWrap.append(icon, item.search); item.popup.append(searchWrap);
      popupListen(item.search, 'input', () => { renderOptions(item, item.search.value); position(item); });
      popupListen(item.search, 'keydown', event => keyboard(event, item));
    }
    item.popup.append(item.list, item.count); doc.body.append(item.popup); opened = item;
    item.button.setAttribute('aria-expanded', 'true'); item.button.setAttribute('aria-controls', item.list.id);
    renderOptions(item, initialQuery); position(item);
    popupListen(item.list, 'pointerdown', event => { if (event.target.closest('[role="option"]')) event.preventDefault(); });
    popupListen(item.list, 'click', event => { const row = event.target.closest('[role="option"]'); if (row) choose(item, Number(row.dataset.optionIndex)); });
    popupListen(item.list, 'pointermove', event => { const row = event.target.closest('[role="option"]'); if (row && row.getAttribute('aria-disabled') !== 'true') activate(item, Number(row.dataset.optionIndex)); });
    if (item.search) item.search.focus({ preventScroll: true });
  }
  function keyboard(event, item) {
    if (event.key === 'Escape' && opened === item) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab' && opened === item) { close(true); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (opened !== item) { open(item); return; }
      const enabled = item.filtered.filter(option => !option.disabled), current = enabled.findIndex(option => option.index === item.activeIndex);
      if (enabled.length) activate(item, enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length].index);
      return;
    }
    if (['Home', 'End'].includes(event.key) && opened === item && event.target !== item.search) { event.preventDefault(); const choices = item.filtered.filter(option => !option.disabled); activate(item, (event.key === 'Home' ? choices[0] : choices.at(-1))?.index ?? -1); return; }
    if (event.key === 'Enter' || event.key === ' ' && event.target === item.button) { event.preventDefault(); if (opened === item) choose(item, item.activeIndex); else open(item); return; }
    if (opened !== item && event.target === item.button && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); open(item, selectNeedsSearch(optionsFor(item.select)) ? event.key : ''); }
  }

  const manager = { destroy() { close(); controller.abort(); for (const cleanup of cleanups) cleanup(); managers.delete(doc); } };
  managers.set(doc, manager);
  for (const select of root.querySelectorAll('select')) {
    if (select.multiple || select.size > 1 || select.hidden || select.closest('[hidden]')) continue;
    const originalTab = select.getAttribute('tabindex'), originalAria = select.getAttribute('aria-hidden'), labels = [...(select.labels || [])];
    const labelled = textFromLabels(select, labels, doc), wrapper = element('div', 'wolf-select'), button = element('button', 'wolf-select-trigger'), value = element('span', 'wolf-select-value');
    button.type = 'button'; button.id = `${select.id || `wolf-select-${++unique}`}--picker`; button.setAttribute('role', 'combobox'); button.setAttribute('aria-label', labelled); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false'); button.append(value);
    const arrow = element('span', 'wolf-select-chevron'); arrow.innerHTML = chevron; button.append(arrow);
    select.before(wrapper); wrapper.append(select, button); select.classList.add('wolf-select-native'); select.setAttribute('tabindex', '-1'); select.setAttribute('aria-hidden', 'true');
    const labelFors = labels.map(label => [label, label.getAttribute('for')]);
    for (const [label] of labelFors) label.setAttribute('for', button.id);
    const item = { select, wrapper, button, value, label: labelled }; enhanced.set(select, item); sync(item);
    listen(button, 'click', () => opened === item ? close(true) : open(item));
    listen(button, 'keydown', event => keyboard(event, item));
    listen(select, 'change', () => sync(item));
    listen(select, 'input', () => sync(item));
    listen(select, 'invalid', event => { event.preventDefault(); button.setAttribute('aria-invalid', 'true'); button.focus(); });
    listen(select, 'focus', () => button.focus({ preventScroll: true }));
    cleanups.push(() => { for (const [label, original] of labelFors) { if (original == null) label.removeAttribute('for'); else label.setAttribute('for', original); } select.classList.remove('wolf-select-native'); if (originalTab == null) select.removeAttribute('tabindex'); else select.setAttribute('tabindex', originalTab); if (originalAria == null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', originalAria); if (wrapper.parentNode) { wrapper.before(select); wrapper.remove(); } });
  }
  listen(doc, 'pointerdown', event => { if (opened && !opened.popup.contains(event.target) && !opened.button.contains(event.target)) close(); }, { capture: true });
  listen(win, 'resize', () => close());
  listen(doc, 'scroll', event => { if (opened && !opened.popup.contains(event.target)) close(); }, { capture: true, passive: true });
  listen(doc, 'reset', () => win.queueMicrotask(() => { for (const item of enhanced.values()) sync(item); }));
  return manager.destroy;
}

function textFromLabels(select, labels, doc) {
  const referenced = (select.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)?.textContent || '').join(' ').trim();
  const labelText = labels.map(label => { const clone = label.cloneNode(true); for (const control of clone.querySelectorAll('select,input,button,textarea')) control.remove(); return clone.textContent.trim(); }).join(' ');
  return select.getAttribute('aria-label') || referenced || labelText || select.getAttribute('title') || 'Choisir une option';
}
