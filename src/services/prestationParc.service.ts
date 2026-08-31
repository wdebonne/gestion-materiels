import { db } from '../database';
import { filtreObjets } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';
import { jointuresDisponibilite } from './materielPretable.service';

/**
 * Quelles branches du parc contiennent des prestations.
 *
 * Une prestation — un raccordement électrique, un débit de boissons, du
 * personnel pour une cérémonie — ne se créait que dans le catalogue séparé des
 * manifestations. Or l'arbre des catégories est **déjà partagé** entre les deux :
 * rien n'empêchait de tenir ses prestations là où le service tient déjà son
 * matériel, sauf de pouvoir dire « cette branche, ce sont des prestations ».
 *
 * L'organisation visée est celle d'une collectivité, où la **catégorie est le
 * service** : Technique porte une sous-catégorie Prestation et une
 * sous-catégorie Mobilier, Urbanisme porte Prestation, Armoires et Bureau,
 * Restauration porte Prestation et Verrerie. Le routage d'approbation en découle
 * sans rien ajouter, puisque le périmètre d'un service est un ensemble de
 * catégories.
 *
 * Trois niveaux, **le plus précis l'emporte**, comme la disponibilité pour les
 * manifestations — et les mêmes jointures, réutilisées plutôt que recopiées.
 *
 * La règle est écrite ici une seule fois, en SQL et en TypeScript, pour que la
 * liste affichée, le calcul de disponibilité et le document envoyé au service
 * disent tous la même chose.
 */

/**
 * Fragment SQL rendant le caractère de prestation d'un matériel.
 *
 * Suppose que la requête appelante joint la sous-catégorie et la catégorie sous
 * les alias donnés — voir `jointuresDisponibilite`, qui pose exactement les
 * mêmes. Le repli est `0` : tout le parc existant reste du matériel, et on
 * désigne ce qui n'en est pas.
 */
export function expressionPrestation(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return `COALESCE(${aliasObjet}.is_prestation, ${aliasSousCategorie}.is_prestation, ${aliasCategorie}.is_prestation, 0)`;
}

/** Les mêmes jointures que la disponibilité : une seule écriture pour les deux. */
export { jointuresDisponibilite as jointuresPrestation };

/** Trois états : `true` prestation, `false` matériel, `null` hérite du niveau au-dessus. */
export type ChoixPrestation = boolean | null;

/** Traduit une valeur reçue en trois états, pour ne jamais confondre « non » et « hérite ». */
export function lireChoixPrestation(brut: unknown): ChoixPrestation {
  if (brut === null || brut === undefined || brut === '') return null;
  if (brut === true || brut === 1 || brut === '1' || brut === 'true') return true;
  return false;
}

/** Valeur à écrire en base : `null` reste `null`, le reste devient 0 ou 1. */
export function versColonnePrestation(valeur: ChoixPrestation): number | null {
  return valeur === null ? null : valeur ? 1 : 0;
}

/**
 * Ce matériel du parc est-il une prestation ?
 *
 * Un matériel introuvable rend `false` : il sera traité comme du matériel, donc
 * soumis aux contrôles de disponibilité — refuser vaut mieux que promettre.
 */
export async function estPrestationObjet(objectId: number | string): Promise<boolean> {
  const identifiant = Number(objectId);
  if (!Number.isFinite(identifiant)) return false;

  const ligne = await db.queryOne(
    `SELECT ${expressionPrestation()} as prestation
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE o.id = ?`,
    [identifiant]
  );
  return Boolean(ligne?.prestation);
}

/**
 * Ceux de ces matériels qui sont des prestations.
 *
 * Rendu en `Set` parce que les appelants s'en servent pour écarter des lignes
 * d'une liste : `indisponibilites` doit sauter les prestations, et une requête
 * par ligne sur une manifestation de trente articles serait trente allers-retours.
 */
export async function prestationsParmi(
  objectIds: Array<number | string>
): Promise<Set<number>> {
  const identifiants = objectIds.map(Number).filter((n) => Number.isFinite(n));
  if (identifiants.length === 0) return new Set();

  const lignes = await db.query(
    `SELECT o.id
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE o.id IN (${identifiants.map(() => '?').join(',')})
       AND ${expressionPrestation()} = 1`,
    identifiants
  );
  return new Set(lignes.map((l: any) => Number(l.id)));
}

/**
 * Tri alphabétique français.
 *
 * `ORDER BY name` trie par octets en SQLite : « Électroménager » se retrouve
 * après « Véhicules ». Sur un référentiel communal, cela rejette en bas de liste
 * précisément ce qu'on cherche.
 */
const parNom = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'fr');

/**
 * Arbre des catégories et sous-catégories, avec leur réglage et leurs effectifs.
 *
 * Le décompte sert à l'écran : marquer une sous-catégorie de quarante articles
 * n'a pas les mêmes conséquences qu'une sous-catégorie vide, et il faut le voir
 * avant de cocher.
 */
export async function arbrePrestations(): Promise<any[]> {
  const categories = await db.query(
    `SELECT c.id, c.name, c.is_prestation,
       (SELECT COUNT(*) FROM objects o WHERE o.category_id = c.id) as objets_directs
     FROM categories c`
  );

  const sousCategories = await db.query(
    `SELECT sc.id, sc.category_id, sc.name, sc.is_prestation,
       (SELECT COUNT(*) FROM objects o WHERE o.subcategory_id = sc.id) as objets
     FROM subcategories sc`
  );

  return categories
    .map((categorie: any) => ({
      ...categorie,
      // Une catégorie n'a jamais `NULL` : c'est elle la valeur de référence.
      is_prestation: categorie.is_prestation === 1 ? 1 : 0,
      subcategories: sousCategories
        .filter((sc: any) => sc.category_id === categorie.id)
        .sort(parNom),
    }))
    .sort(parNom);
}

/**
 * Matériels d'une catégorie, avec leur réglage propre et le résultat effectif.
 *
 * `is_prestation` est le choix fait sur ce matériel (`null` = il hérite),
 * `prestation` est ce qui s'applique réellement. Afficher les deux évite la
 * question « pourquoi cet article est-il une prestation alors que je n'ai rien
 * coché dessus ? ».
 *
 * La portée par catégorie est appliquée **ici** plutôt que laissée à l'appelant :
 * régler les prestations reste une lecture du parc, et un compte ne doit pas y
 * découvrir les matériels des catégories qui lui sont fermées.
 */
export async function objetsPourPrestation(
  req: AuthRequest,
  categoryId: number | string
): Promise<any[] | null> {
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  // `COALESCE(...)` est une expression, donc sans affinité de colonne : SQLite
  // ne convertit pas `'39'` en 39 et la comparaison est fausse en silence.
  const identifiant = Number(categoryId);
  if (!Number.isFinite(identifiant)) return [];

  const objets = await db.query(
    `SELECT o.id, o.name, o.reference, o.subcategory_id, o.is_prestation,
            ${expressionPrestation()} as prestation,
            psc.name as subcategory_name
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE COALESCE(o.category_id, psc.category_id) = ?${portee.sql}`,
    [identifiant, ...portee.params]
  );

  return objets.sort(parNom);
}
