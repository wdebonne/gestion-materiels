/**
 * Ce qu'un formulaire laisse vide, et ce que la base doit en comprendre.
 *
 * Un champ date ou nombre qu'on n'a pas rempli arrive au serveur comme une
 * **chaîne vide**, pas comme une absence : c'est ce que rend un `<input>` non
 * saisi, et le JSON le transmet tel quel. SQLite, typé dynamiquement, range
 * cette chaîne dans une colonne `DATE` ou `DECIMAL` sans un mot. MySQL, en mode
 * strict, refuse — « Incorrect date value: '' » — et la route entière retombe
 * sur son `catch`, qui répond « Erreur serveur » sans dire pourquoi.
 *
 * Résultat : une saisie qui passait en développement échouait en production, et
 * la seule différence était le moteur. Ces deux fonctions traduisent le vide en
 * `NULL`, la seule écriture que les deux moteurs comprennent pareil.
 *
 * Elles ne touchent qu'aux valeurs destinées à une colonne date ou numérique :
 * pour une colonne texte, la chaîne vide est une valeur légitime, et la
 * convertir changerait le sens de ce qui est enregistré.
 */

/** Est-ce l'absence de saisie — `undefined`, `null`, ou un champ laissé vide ? */
function estVide(valeur: unknown): boolean {
  return valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '');
}

/**
 * Une date destinée à une colonne `DATE` ou `DATETIME`.
 *
 * La valeur n'est pas reformatée : seul le vide devient `NULL`. Corriger un
 * format ici masquerait une saisie fausse au lieu de la signaler.
 */
export function dateOuNull(valeur: unknown): string | null {
  return estVide(valeur) ? null : String(valeur);
}

/**
 * Un nombre destiné à une colonne numérique.
 *
 * Ce qui n'est pas un nombre finit à `NULL` plutôt qu'à `NaN` : une colonne
 * `DECIMAL` refuse les deux, mais `NULL` dit « non renseigné » quand `NaN`
 * dirait « saisi, et incompréhensible ».
 */
export function nombreOuNull(valeur: unknown): number | null {
  if (estVide(valeur)) return null;
  const nombre = Number(valeur);
  return Number.isFinite(nombre) ? nombre : null;
}
