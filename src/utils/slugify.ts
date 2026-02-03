/**
 * Génère un slug à partir d'une chaîne de caractères
 * @param text - Le texte à transformer en slug
 * @returns Le slug généré
 */
export default function slugify(text: string): string {
  return text
    .toString()
    .normalize('NFD')                   // Normaliser les caractères unicode
    .replace(/[\u0300-\u036f]/g, '')    // Supprimer les accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')               // Remplacer les espaces par des tirets
    .replace(/[^\w\-]+/g, '')           // Supprimer les caractères non alphanumériques
    .replace(/\-\-+/g, '-')             // Remplacer les tirets multiples par un seul
    .replace(/^-+/, '')                 // Supprimer les tirets au début
    .replace(/-+$/, '');                // Supprimer les tirets à la fin
}
