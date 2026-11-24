const labels = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Sort selectable destinations without changing graph or branch order. */
export function sortDestinations(destinations) {
  return [...destinations].sort((left, right) =>
    labels.compare(left.label || '', right.label || ''),
  );
}
