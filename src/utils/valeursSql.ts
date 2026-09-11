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

/**
 * Ce que devient une colonne lors d'une modification partielle.
 *
 * `recu ?? existant` confond deux intentions que le client distingue pourtant :
 * ne **pas** parler d'un champ (`undefined` — on le garde) et demander à
 * l'**effacer** (`null` — on le vide). Retirer un élément du plan envoyait
 * `pos_x: null` et repartait avec l'ancienne position ; le bouton « Retirer »
 * ne faisait rien, sans erreur ni message.
 *
 * À réserver aux colonnes où `NULL` veut dire quelque chose — position, zone,
 * coordonnées, surface. Pour un libellé, la chaîne vide dit déjà « rien ».
 */
export function fusionner<T>(recu: T | null | undefined, existant: T | null): T | null {
  return recu === undefined ? existant : recu;
}

/**
 * Une colonne numérique lors d'une modification partielle.
 *
 * À utiliser **à la place** de `fusionner(nombreOuNull(x), existant)`, qui a
 * l'air correct et ne l'est pas : `nombreOuNull` traduit aussi bien
 * « non mentionné » (`undefined`) que « vidé » (`''`, `null`) par un même
 * `null`, si bien que `fusionner` reçoit toujours `null` et n'a plus rien à
 * distinguer. Les deux fonctions se neutralisaient, et la seconde effaçait
 * précisément ce que la première existait pour préserver.
 *
 * Ce que cela coûtait, en vrai : faire glisser un massif sur le plan envoie
 * `{pos_x, pos_y}` et rien d'autre — sa surface partait à `NULL` au passage,
 * donc sa quantité et son coût. Modifier l'adresse d'un espace vert effaçait le
 * calibrage de son plan, et toutes les surfaces cessaient de se calculer. Aucun
 * message, aucune trace : un chiffre juste devenait un vide.
 *
 * L'effacement volontaire reste possible et se dit comme avant, en envoyant
 * `null` — c'est ce que fait « Retirer du plan ».
 */
export function nombreFusionne(recu: unknown, existant: number | null): number | null {
  return recu === undefined ? existant : nombreOuNull(recu);
}
