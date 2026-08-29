import { db } from '../database';
import { AuthRequest, getAccessibleCategoryIds } from './auth.middleware';

/**
 * Restriction des lectures du module Manifestations aux catégories du compte.
 *
 * `objectScope.ts` a fermé la même fuite sur la table `objects`, mais sa règle
 * ne dit rien de `manifestation_stock`, qui porte pourtant ses propres
 * `category_id` et `subcategory_id`. Résultat : `GET /manifestations`,
 * `GET /manifestations/:id`, `/stock` et `/stock/availability` étaient
 * accessibles à **tout compte authentifié**, sans aucun filtre — seules les
 * écritures étaient gardées. Le test de non-régression `objectScope.test.ts` ne
 * pouvait pas le voir : il ne cherche que la chaîne `objects`.
 *
 * La règle est écrite ici une seule fois, pour que la prochaine route du module
 * n'ait pas à la redécouvrir.
 */

export type PorteeStock =
  /** Administrateur : aucune restriction. */
  | { type: 'tout' }
  /** Aucune catégorie accessible : la route doit refuser. */
  | { type: 'aucune' }
  /** Restriction à appliquer, à concaténer à la clause `WHERE`. */
  | { type: 'limitee'; sql: string; params: any[] };

/**
 * Portée des articles de stock visibles par l'auteur de la requête.
 *
 * `alias` est le préfixe de `manifestation_stock` dans la requête appelante.
 *
 * Un article **sans aucune** catégorie reste visible : le stock des
 * manifestations a été saisi bien avant que les catégories existent, et
 * beaucoup d'articles n'en ont pas. Les masquer reviendrait à vider l'écran
 * pour tout le monde sauf l'administrateur.
 *
 * « Sans aucune » veut dire ni catégorie directe, ni sous-catégorie : tester le
 * seul `category_id IS NULL` laissait passer les articles rattachés uniquement
 * par leur sous-catégorie — un vidéoprojecteur du service informatique
 * redevenait visible de tous.
 */
export async function porteeStock(req: AuthRequest, alias = 'ms'): Promise<PorteeStock> {
  const accessibles = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);
  if (accessibles === null) return { type: 'tout' };
  if (accessibles.length === 0) return { type: 'aucune' };

  const prefixe = alias ? `${alias}.` : '';
  const marqueurs = accessibles.map(() => '?').join(',');

  return {
    type: 'limitee',
    sql: ` AND ((${prefixe}category_id IS NULL AND ${prefixe}subcategory_id IS NULL) OR ${prefixe}category_id IN (${marqueurs}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = ${prefixe}subcategory_id AND sc.category_id IN (${marqueurs})))`,
    params: [...accessibles, ...accessibles],
  };
}

/** Fragment à concaténer et paramètres à ajouter, `null` si l'accès est nul. */
export async function filtreStock(
  req: AuthRequest,
  alias = 'ms'
): Promise<{ sql: string; params: any[] } | null> {
  const portee = await porteeStock(req, alias);
  if (portee.type === 'aucune') return null;
  if (portee.type === 'tout') return { sql: '', params: [] };
  return { sql: portee.sql, params: portee.params };
}

/**
 * Restriction des manifestations elles-mêmes.
 *
 * Une manifestation est visible dès qu'elle contient au moins un article
 * accessible, ou qu'elle n'en contient aucun. Filtrer plus strictement ferait
 * disparaître les manifestations encore vides — celles qu'on vient justement de
 * recevoir et qu'il faut traiter.
 *
 * `alias` est le préfixe de `manifestations` dans la requête appelante.
 */
export async function filtreManifestations(
  req: AuthRequest,
  alias = 'm'
): Promise<{ sql: string; params: any[] } | null> {
  const accessibles = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);
  if (accessibles === null) return { sql: '', params: [] };

  const prefixe = alias ? `${alias}.` : '';

  if (accessibles.length === 0) {
    // Aucune catégorie : seules les manifestations sans matériel subsistent.
    return {
      sql: ` AND NOT EXISTS (SELECT 1 FROM manifestation_materials mmp WHERE mmp.manifestation_id = ${prefixe}id)`,
      params: [],
    };
  }

  const marqueurs = accessibles.map(() => '?').join(',');
  return {
    sql: ` AND (
      NOT EXISTS (SELECT 1 FROM manifestation_materials mmp WHERE mmp.manifestation_id = ${prefixe}id)
      OR EXISTS (
        SELECT 1 FROM manifestation_materials mma
        JOIN manifestation_stock msa ON msa.id = mma.stock_id
        WHERE mma.manifestation_id = ${prefixe}id
          AND ((msa.category_id IS NULL AND msa.subcategory_id IS NULL) OR msa.category_id IN (${marqueurs})
               OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = msa.subcategory_id AND sc.category_id IN (${marqueurs})))
      )
    )`,
    params: [...accessibles, ...accessibles],
  };
}

/**
 * L'auteur de la requête peut-il consulter cette manifestation ?
 *
 * Pour les routes qui travaillent sur un identifiant plutôt que sur une liste.
 */
export async function peutVoirManifestation(
  req: AuthRequest,
  manifestationId: number | string
): Promise<boolean> {
  const filtre = await filtreManifestations(req, 'm');
  if (filtre === null) return false;

  const ligne = await db.queryOne(
    `SELECT m.id FROM manifestations m WHERE m.id = ?${filtre.sql}`,
    [manifestationId, ...filtre.params]
  );
  return Boolean(ligne);
}

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_PORTEE_MANIFESTATION =
  'Cette manifestation ne fait pas partie des catégories qui vous sont accessibles';
