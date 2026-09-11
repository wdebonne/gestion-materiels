import { db } from '../database';
import { filtreObjets } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';

/**
 * « Ce matériel est-il ouvert à ce module ? », écrit une seule fois.
 *
 * La question s'est posée d'abord pour les manifestations : une catégorie ne se
 * prête pas d'un bloc, un réfrigérateur part en brocante quand le grill de la
 * même catégorie reste. Elle se repose à l'identique pour les espaces verts :
 * on y plante du gazon et de l'enrobé, pas les prestations de la police
 * municipale ni le matériel de fête.
 *
 * Deux modules, une seule règle : **trois niveaux, le plus précis l'emporte**.
 * La catégorie donne le ton, la sous-catégorie l'affine, le matériel fait
 * exception. `NULL` veut dire « suivre le niveau au-dessus » — trois états et
 * non deux, sans quoi ouvrir une catégorie obligerait à recocher chacun de ses
 * matériels, et personne ne le ferait.
 *
 * Recopier ce fichier par module ferait diverger deux écrans qui disent la même
 * chose. Seule la **colonne** change, et elle se passe en paramètre.
 */

/** Trois états : `true` ouvert, `false` exclu, `null` hérite du niveau au-dessus. */
export type Disponibilite = boolean | null;

/** Traduit une valeur reçue en trois états, pour ne jamais confondre « non » et « hérite ». */
export function lireDisponibilite(brut: unknown): Disponibilite {
  if (brut === null || brut === undefined || brut === '') return null;
  if (brut === true || brut === 1 || brut === '1' || brut === 'true') return true;
  return false;
}

/** Valeur à écrire en base : `null` reste `null`, le reste devient 0 ou 1. */
export function versColonne(valeur: Disponibilite): number | null {
  return valeur === null ? null : valeur ? 1 : 0;
}

/**
 * Nom de colonne accepté, vérifié plutôt que concaténé de confiance.
 *
 * Ces noms partent dans du SQL assemblé à la main : les lister ici ferme la
 * porte à une injection par un appelant distrait, et dit du même coup quels
 * modules savent restreindre le parc.
 */
export type ColonneDisponibilite =
  | 'available_for_manifestations'
  | 'available_for_green_spaces';

/**
 * Fragment SQL rendant la disponibilité effective d'un matériel.
 *
 * Suppose que la requête appelante joint la sous-catégorie et la catégorie sous
 * les alias donnés. `COALESCE` traduit littéralement « le plus précis l'emporte,
 * et à défaut c'est ouvert » — le comportement d'avant le réglage.
 */
export function expressionDisponibilite(
  colonne: ColonneDisponibilite,
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return `COALESCE(${aliasObjet}.${colonne}, ${aliasSousCategorie}.${colonne}, ${aliasCategorie}.${colonne}, 1)`;
}

/**
 * Jointures nécessaires à `expressionDisponibilite`.
 *
 * La catégorie d'un matériel est sa catégorie directe **ou** celle de sa
 * sous-catégorie : les deux colonnes coexistent et l'une peut être nulle. Les
 * oublier ferait retomber tout le monde sur le repli « ouvert », et le réglage
 * n'aurait aucun effet visible. Ne dépend pas de la colonne : les mêmes
 * jointures servent aux deux modules.
 */
export function jointuresDisponibilite(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return `
    LEFT JOIN subcategories ${aliasSousCategorie} ON ${aliasSousCategorie}.id = ${aliasObjet}.subcategory_id
    LEFT JOIN categories ${aliasCategorie} ON ${aliasCategorie}.id = COALESCE(${aliasObjet}.category_id, ${aliasSousCategorie}.category_id)
  `;
}

/**
 * Ce matériel est-il ouvert à ce module ?
 *
 * Pour les routes qui travaillent sur un identifiant. Un matériel introuvable
 * rend `false` : mieux vaut refuser que réserver un fantôme.
 */
export async function estDisponible(
  colonne: ColonneDisponibilite,
  objectId: number | string
): Promise<boolean> {
  const ligne = await db.queryOne(
    `SELECT ${expressionDisponibilite(colonne)} as ouvert
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE o.id = ?`,
    [objectId]
  );
  return Boolean(ligne?.ouvert);
}

/**
 * Arbre des catégories et sous-catégories, avec leur réglage et le nombre de
 * matériels qu'elles portent.
 *
 * Le décompte sert à l'écran : ouvrir une catégorie de 40 tondeuses n'a pas les
 * mêmes conséquences qu'une catégorie vide, et l'administrateur doit le voir
 * avant de cocher.
 */
export async function arbreDisponibilite(colonne: ColonneDisponibilite): Promise<any[]> {
  const categories = await db.query(
    `SELECT c.id, c.name, c.${colonne},
       (SELECT COUNT(*) FROM objects o WHERE o.category_id = c.id) as objets_directs
     FROM categories c`
  );

  const sousCategories = await db.query(
    `SELECT sc.id, sc.category_id, sc.name, sc.${colonne},
       (SELECT COUNT(*) FROM objects o WHERE o.subcategory_id = sc.id) as objets
     FROM subcategories sc`
  );

  return categories
    .map((categorie: any) => ({
      ...categorie,
      // Une catégorie n'a jamais `NULL` : c'est elle la valeur de référence.
      [colonne]: categorie[colonne] === 0 ? 0 : 1,
      subcategories: sousCategories
        .filter((sc: any) => sc.category_id === categorie.id)
        .sort(parNom),
    }))
    .sort(parNom);
}

/**
 * Tri alphabétique français.
 *
 * `ORDER BY name` trie par octets en SQLite : « Électroménager » se retrouve
 * après « Véhicules », parce que le É encodé commence par 0xC3. Sur un
 * référentiel communal — Éclairage, Équipement, Espaces verts — cela rejette en
 * bas de liste précisément ce qu'on cherche.
 */
const parNom = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'fr');

/**
 * Matériels d'une catégorie, avec leur réglage propre et le résultat effectif.
 *
 * La colonne porte le choix fait sur ce matériel (`null` = il hérite), `alias`
 * porte ce qui s'applique réellement. Afficher les deux évite la question
 * « pourquoi ce matériel est-il exclu alors que je n'ai rien coché dessus ? ».
 */
export async function objetsDeLaCategorie(
  colonne: ColonneDisponibilite,
  alias: string,
  req: AuthRequest,
  categoryId: number | string
): Promise<any[] | null> {
  // Régler la disponibilité reste une lecture du parc : un compte ne doit pas
  // découvrir ici les matériels des catégories qui lui sont fermées.
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  // `COALESCE(...)` est une expression, donc sans affinité de colonne : SQLite
  // ne convertit pas `'39'` en 39 et la comparaison est fausse en silence. Un
  // identifiant venu d'une chaîne de requête est toujours du texte.
  const identifiant = Number(categoryId);
  if (!Number.isFinite(identifiant)) return [];

  const objets = await db.query(
    `SELECT o.id, o.name, o.reference, o.serial_number, o.subcategory_id,
            o.${colonne},
            ${expressionDisponibilite(colonne)} as ${alias},
            psc.name as subcategory_name
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE COALESCE(o.category_id, psc.category_id) = ?${portee.sql}`,
    [identifiant, ...portee.params]
  );

  return objets.sort(parNom);
}

/**
 * Matériels dont le nom, la référence ou le numéro de série contient le terme.
 *
 * Sur un parc de cent matériels répartis en trente catégories et soixante
 * sous-catégories, dérouler chaque branche pour retrouver un grill est
 * intenable. La recherche traverse l'arbre d'un coup et rend le rattachement de
 * chaque matériel, pour que l'écran sache quelles branches ouvrir.
 */
export async function rechercherObjets(
  colonne: ColonneDisponibilite,
  alias: string,
  req: AuthRequest,
  recherche: string
): Promise<any[] | null> {
  // Même portée qu'ailleurs : la recherche ne doit pas révéler les matériels
  // des catégories fermées au compte.
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  const terme = recherche.trim();
  if (!terme) return [];

  const motif = `%${terme}%`;
  const objets = await db.query(
    `SELECT o.id, o.name, o.reference, o.serial_number, o.subcategory_id,
            o.${colonne},
            ${expressionDisponibilite(colonne)} as ${alias},
            psc.name as subcategory_name,
            pc.id as category_id, pc.name as category_name
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE (o.name LIKE ? OR o.reference LIKE ? OR o.serial_number LIKE ?)${portee.sql}`,
    [motif, motif, motif, ...portee.params]
  );

  return objets.sort(parNom);
}
