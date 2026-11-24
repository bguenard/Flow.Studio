/** Friendly labels; values remain the exact language codes stored by WOLF. */
const languages = {
  'fr-fr': 'Français',
  'en-gb': 'Anglais (Royaume-Uni)',
  'en-us': 'Anglais (États-Unis)',
  'de-de': 'Allemand',
  'es-es': 'Espagnol',
  'it-it': 'Italien',
  'nl-nl': 'Néerlandais',
  'pt-pt': 'Portugais',
  'pt-br': 'Portugais (Brésil)',
};
export function languageOptions(schema = {}, current = '') {
  const codes = Array.isArray(schema.enum) ? schema.enum : Object.keys(languages);
  const values = [
    ...new Set([
      ...codes.filter((v) => typeof v === 'string' && v),
      ...(current ? [String(current)] : []),
    ]),
  ];
  return values
    .map((value) => ({
      value,
      label: languages[value.toLowerCase()] || value,
      disabled: Array.isArray(schema.enum) && !schema.enum.includes(value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));
}
