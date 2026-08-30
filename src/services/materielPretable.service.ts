import { db } from '../database';
import { filtreObjets } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur proposait tout le parc. Or une catégorie ne se prête pas d'un
 * bloc : un réfrigérateur de la catégorie Électroménager part volontiers pour
 * une brocante, le grill de la même catégorie non.
 *
 * Trois niveaux, **le plus précis l'emporte** : la catégorie donne le ton, la
 * sous-catégorie l'affine, le matériel fait exception. `NULL` veut dire « suivre
 * le niveau au-dessus » — trois états et non deux, sans quoi ouvrir une
 * catégorie obligerait à recocher chacun de ses matériels.
 *
 * La règle est écrite ici une seule fois, en SQL et en TypeScript, pour que la
 * liste affichée et le refus opposé à une demande disent toujours la même chose.
 */

/**
 * Fragment SQL rendant la disponibilité effective d'un matériel.
 *
 * Suppose que la requête appelante joint la sous-catégorie et la catégorie sous
 * les alias donnés. `COALESCE` traduit littéralement « le plus précis l'emporte,
 * et à défaut on prête » — le comportement d'avant ce réglage.
 */
export function expressionDisponibilite(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return `COALESCE(${aliasObjet}.available_for_manifestations, ${aliasSousCategorie}.available_for_manifestations, ${aliasCategorie}.available_for_manifestations, 1)`;
}

/**
 * Jointures nécessaires à `expressionDisponibilite`.
 *
 * La catégorie d'un matériel est sa catégorie directe **ou** celle de sa
 * sous-catégorie : les deux colonnes coexistent et l'une peut être nulle. Les
 * oublier ferait retomber tout le monde sur le repli « prêtable », et le réglage
 * n'aurait aucun effet visible.
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

/** Trois états : `true` prêtable, `false` exclu, `null` hérite du niveau au-dessus. */
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
 * Ce matériel peut-il être prêté ?
 *
 * Pour les routes qui travaillent sur un identifiant. Un matériel introuvable
 * rend `false` : mieux vaut refuser que réserver un fantôme.
 */
export async function estPretable(objectId: number | string): Promise<boolean> {
  const ligne = await db.queryOne(
    `SELECT ${expressionDisponibilite()} as pretable
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE o.id = ?`,
    [objectId]
  );
  return Boolean(ligne?.pretable);
}

/**
 * Arbre des catégories et sous-catégories, avec leur réglage et le nombre de
 * matériels qu'elles portent.
 *
 * Le décompte sert à l'écran : ouvrir une catégorie de 40 tondeuses n'a pas les
 * mêmes conséquences qu'une catégorie vide, et l'administrateur doit le voir
 * avant de cocher.
 */
export async function arbreDisponibilite(): Promise<any[]> {
  const categories = await db.query(
    `SELECT c.id, c.name, c.available_for_manifestations,
       (SELECT COUNT(*) FROM objects o WHERE o.category_id = c.id) as objets_directs
     FROM categories c`
  );

  const sousCategories = await db.query(
    `SELECT sc.id, sc.category_id, sc.name, sc.available_for_manifestations,
       (SELECT COUNT(*) FROM objects o WHERE o.subcategory_id = sc.id) as objets
     FROM subcategories sc`
  );

  return categories
    .map((categorie: any) => ({
      ...categorie,
      // Une catégorie n'a jamais `NULL` : c'est elle la valeur de référence.
      available_for_manifestations: categorie.available_for_manifestations === 0 ? 0 : 1,
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
 * `available_for_manifestations` est le choix fait sur ce matériel (`null` = il
 * hérite), `pretable` est ce qui s'applique réellement. Afficher les deux évite
 * la question « pourquoi ce matériel est-il exclu alors que je n'ai rien coché
 * dessus ? ».
 */
export async function objetsDeLaCategorie(
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
            o.available_for_manifestations,
            ${expressionDisponibilite()} as pretable,
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
export async function rechercherObjetsPretables(
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
            o.available_for_manifestations,
            ${expressionDisponibilite()} as pretable,
            psc.name as subcategory_name,
            pc.id as category_id, pc.name as category_name
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE (o.name LIKE ? OR o.reference LIKE ? OR o.serial_number LIKE ?)${portee.sql}`,
    [motif, motif, motif, ...portee.params]
  );

  return objets.sort(parNom);
}
