/**
 * Menu latéral : déployé (pictogrammes et libellés) ou réduit (pictogrammes seuls).
 * Le choix de l'utilisateur vaut sur toutes les pages et est gardé d'une session à l'autre.
 */
const KEY = 'wolf-core-studio.sidebar';

/**
 * Faut-il afficher le menu réduit ? Sans choix exprimé, il l'est là où la place manque :
 * dans un parcours et sur une fenêtre étroite. Sur téléphone, le menu a sa propre disposition
 * (bandeau en haut, ou rail dans un parcours) et le choix fait sur grand écran ne s'applique pas.
 */
export function sidebarCollapsed({ preference = null, studio = false, width = 1440 } = {}) {
  if (width <= 700) return studio;
  if (preference !== null) return preference;
  return studio || width <= 1000;
}

/** Le choix enregistré : true (réduit), false (déployé) ou null (aucun, ou stockage indisponible). */
export function readSidebarPreference(storage) {
  try {
    const value = storage?.getItem(KEY);
    return value === 'collapsed' ? true : value === 'expanded' ? false : null;
  } catch {
    return null;
  }
}

export function writeSidebarPreference(storage, collapsed) {
  try {
    storage?.setItem(KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* le choix vaudra pour cette session seulement */
  }
}
