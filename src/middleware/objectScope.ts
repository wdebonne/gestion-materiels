import { db } from '../database';
import { AuthRequest, getAccessibleCategoryIds } from './auth.middleware';

/**
 * Restriction des lectures de `objects` aux catégories visibles par le compte.
 *
 * `GET /objects` filtrait déjà, mais la règle était réécrite à la main à chaque
 * endroit qui en avait besoin — et oubliée partout ailleurs. Une revue des
 * treize fichiers touchant la table a trouvé quatre endpoints qui rendaient des
 * matériels qu'un compte n'a pas le droit de consulter :
 *
 *   GET /objects/:id                    la liste filtrait, le détail non
 *   GET /green-spaces/search/objects    recherche libre sur tout le parc
 *   GET /reservations                   noms et références via les réservations
 *   GET /calendar/events                noms via les événements
 *
 * Toutes ces routes étaient authentifiées : c'est le contrôle qui suit
 * l'authentification qui manquait. Une seule écriture de la règle, ici, pour que
 * la prochaine route n'ait pas à la redécouvrir.
 */

export type PorteeObjets =
  /** Administrateur : aucune restriction. */
  | { type: 'tout' }
  /** Aucune catégorie accessible : la route doit refuser. */
  | { type: 'aucune' }
  /** Restriction à appliquer, à concaténer à la clause `WHERE`. */
  | { type: 'limitee'; sql: string; params: any[] };

/**
 * Portée des matériels visibles par l'auteur de la requête.
 *
 * `alias` est le préfixe de la table `objects` dans la requête appelante — `o`
 * pour un `FROM objects o`, chaîne vide pour un `FROM objects` sans alias.
 */
export async function porteeObjets(req: AuthRequest, alias = 'o'): Promise<PorteeObjets> {
  const accessibles = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);
  if (accessibles === null) return { type: 'tout' };
  if (accessibles.length === 0) return { type: 'aucune' };

  const prefixe = alias ? `${alias}.` : '';
  const marqueurs = accessibles.map(() => '?').join(',');

  // Un matériel est visible par sa catégorie directe, ou par la catégorie de sa
  // sous-catégorie : les deux colonnes coexistent et l'une peut être nulle.
  return {
    type: 'limitee',
    sql: ` AND (${prefixe}category_id IN (${marqueurs}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = ${prefixe}subcategory_id AND sc.category_id IN (${marqueurs})))`,
    params: [...accessibles, ...accessibles],
  };
}

/** Fragment à concaténer et paramètres à ajouter, `null` si l'accès est nul. */
export async function filtreObjets(
  req: AuthRequest,
  alias = 'o'
): Promise<{ sql: string; params: any[] } | null> {
  const portee = await porteeObjets(req, alias);
  if (portee.type === 'aucune') return null;
  if (portee.type === 'tout') return { sql: '', params: [] };
  return { sql: portee.sql, params: portee.params };
}

/**
 * Variante pour une table qui *référence* un matériel sans en être un.
 *
 * Un événement de calendrier ou une réservation portent un `object_id`. Filtrer
 * simplement sur la catégorie ferait disparaître les lignes sans matériel — la
 * plupart des événements n'en ont pas — alors qu'elles n'ont rien à cacher.
 * `colonneLien` désigne la colonne de rattachement, laissée passer quand elle
 * est nulle.
 */
export async function filtreObjetsLies(
  req: AuthRequest,
  aliasObjet: string,
  colonneLien: string
): Promise<{ sql: string; params: any[] } | null> {
  const portee = await porteeObjets(req, aliasObjet);
  if (portee.type === 'aucune') {
    // Aucune catégorie accessible : seules les lignes sans matériel subsistent.
    return { sql: ` AND ${colonneLien} IS NULL`, params: [] };
  }
  if (portee.type === 'tout') return { sql: '', params: [] };

  // `portee.sql` commence par ' AND (' : on le replie dans une alternative.
  const condition = portee.sql.replace(/^ AND /, '');
  return {
    sql: ` AND (${colonneLien} IS NULL OR ${condition})`,
    params: portee.params,
  };
}

/**
 * L'auteur de la requête peut-il consulter ce matériel ?
 *
 * Pour les routes qui travaillent sur un identifiant plutôt que sur une liste.
 */
export async function peutVoirObjet(req: AuthRequest, objectId: number | string): Promise<boolean> {
  const filtre = await filtreObjets(req, 'o');
  if (filtre === null) return false;

  const ligne = await db.queryOne(
    `SELECT o.id FROM objects o WHERE o.id = ?${filtre.sql}`,
    [objectId, ...filtre.params]
  );
  return Boolean(ligne);
}

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_PORTEE = "Ce matériel ne fait pas partie des catégories qui vous sont accessibles";
