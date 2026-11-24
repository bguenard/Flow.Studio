export const icons = {
  pause: '<path d="M8 5v14M16 5v14"/>',
  chart: '<path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  building:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
  diff: '<path d="M7 3v18m10-18v18M4 6l3-3 3 3m4 12 3 3 3-3M4 13h6m4-3h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circlecheck: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  phone: '<path d="m8 3 2 5-3 2c1 3 4 6 7 7l2-3 5 2v4c0 2-3 2-5 1C9 19 5 15 3 8 2 5 2 3 4 3Z"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-3-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  shield: '<path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
  menu: '<path d="M7 5h14M7 12h14M7 19h14M3 5h.1M3 12h.1M3 19h.1"/>',
  message:
    '<path d="M21 15a3 3 0 0 1-3 3H8l-6 4V5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3Z"/><path d="M7 7h10M7 12h7"/>',
  hash: '<path d="M9.5 3 7 21M17 3l-2.5 18M4.5 8.5h16M3.5 15.5h16"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  undo: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 7"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
  play: '<path d="m7 3 14 9-14 9Z"/>',
  link: '<path d="m10 14 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  bell: '<path d="M5 17h14l-2-3V9A5 5 0 0 0 7 9v5ZM10 21h4"/>',
  pencil: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 19Z"/><path d="m14.5 6 3 3"/>',
  speaker:
    '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  hangup:
    '<path transform="rotate(135 12 12)" d="m8 3 2 5-3 2c1 3 4 6 7 7l2-3 5 2v4c0 2-3 2-5 1C9 19 5 15 3 8 2 5 2 3 4 3Z"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.layers}</svg>`;
export const btn = (label, action, style = '', extra = '') =>
  `<button class="btn ${style}" data-action="${action}" ${extra}>${label}</button>`;
export const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const tag = (text, tone = '', symbol = '') =>
  `<span class="tag ${tone}">${symbol ? icon(symbol) : ''}${esc(text)}</span>`;
// Accord en nombre : « 1 étape », « 2 étapes ». Le pluriel irrégulier se passe en troisième argument.
export const plural = (count, one, many = one + 's') => `${count} ${count > 1 ? many : one}`;
export const display = (v) =>
  Array.isArray(v)
    ? v.join(' · ')
    : typeof v === 'boolean'
      ? v
        ? 'Oui'
        : 'Non'
      : String(v ?? '—');
export const date = (v) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(v));

// Blocs de page partagés par les vues. `text` de notice() est du HTML déjà échappé par l'appelant.
export const head = (kicker, title, description, actions = '') =>
  `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
export const notice = (text, tone = '') =>
  `<div class="notice ${tone}">${icon(tone === 'warning' ? 'alert' : 'shield')}<div>${text}</div></div>`;
export const empty = (title, text, action = '') =>
  `<div class="empty-state">${icon('layers')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
