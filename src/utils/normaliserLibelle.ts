/**
 * Ramène un intitulé à une forme comparable : sans accent, sans ponctuation,
 * sans astérisque d'obligation, sans parenthèses explicatives.
 *
 * « Date d'achat (AAAA-MM-JJ) » et « date achat » doivent se rejoindre.
 *
 * La fonction vivait dans `importMapping.service.ts`, où elle ne servait qu'aux
 * colonnes d'un tableur. La réception des demandes de manifestation doit
 * rapprocher les mêmes libellés — clés d'un JSON de formulaire, noms d'articles
 * de stock — selon exactement la même règle. Deux normalisations légèrement
 * différentes finiraient par diverger, et « Tables » cesserait de trouver
 * « table » d'un côté sans qu'on le voie de l'autre.
 */
export function normaliserLibelle(brut: unknown): string {
  return String(brut ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
