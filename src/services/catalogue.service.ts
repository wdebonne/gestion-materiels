import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';
import { filtreStock } from '../middleware/manifestationScope';
import { filtreObjets } from '../middleware/objectScope';
import { conditionPerimetreService } from './manifestationServices.service';
import { disponibiliteSur, estPrestation } from './manifestationStock.service';
import { indisponibilites } from './manifestationObjets.service';
import { enrichirLots, expressionNature } from './lotParc.service';
import { expressionDisponibilite, jointuresDisponibilite } from './materielPretable.service';
import { expressionPrestation } from './prestationParc.service';

/**
 * Ce que la collectivité peut proposer pour une manifestation, d'où que ça vienne.
 *
 * Deux tables portent ce qu'on prête, et pour de bonnes raisons : `manifestation_stock` compte
 * des quantités anonymes — trois cents chaises, dont il reste tant — quand le parc suit des
 * exemplaires identifiés, des lots, et les prestations déclarées par branche. Un demandeur, lui,
 * ne connaît pas cette frontière : il veut « une nacelle, un raccordement électrique et cinquante
 * chaises », et n'a pas à savoir laquelle des deux tables les porte.
 *
 * Ce module rend donc **une seule liste**, chaque ligne disant d'où elle vient pour que la
 * réception sache ensuite où la ranger.
 *
 * Ce qui n'est pas proposé, et pourquoi :
 * - le matériel du parc non déclaré prêtable — le grill reste à la cuisine ;
 * - celui dont le statut n'est pas « actif » : un agent voit qu'une nacelle est en maintenance et
 *   décide en connaissance de cause, un habitant devant un formulaire, non.
 */

export type NatureCatalogue = 'prestation' | 'materiel';

export interface FiltresCatalogue {
  /** Identifiant, slug ou nom du service dont on veut le périmètre. */
  service?: unknown;
  kind?: unknown;
  categoryId?: unknown;
}

export interface ArticleCatalogue {
  /** Référence stable et sans collision entre les deux tables : `stock:7`, `parc:12`. */
  ref: string;
  source: 'stock' | 'parc';
  id: number;
  name: string;
  category: string;
  unit: string;
  is_prestation: boolean;
  /** `null` pour une prestation : elle ne se stocke pas. */
  quantity_total: number | null;
  /** `null` veut dire « sans limite », et non « zéro ». */
  quantity_available: number | null;
}

/** Seules deux valeurs filtrent ; tout le reste veut dire « les deux natures ». */
function natureDemandee(kind: unknown): NatureCatalogue | null {
  return kind === 'prestation' || kind === 'materiel' ? kind : null;
}

function nombreOuZero(valeur: unknown): number {
  const nombre = Number(valeur ?? 0);
  return Number.isFinite(nombre) ? nombre : 0;
}

/**
 * Articles du stock des manifestations.
 *
 * `null` quand le compte n'a accès à aucune catégorie de stock : ce n'est pas une liste vide,
 * c'est une absence de droit, et l'appelant doit pouvoir faire la différence.
 */
async function articlesDuStock(
  req: AuthRequest,
  debut: string,
  fin: string,
  filtres: FiltresCatalogue
): Promise<ArticleCatalogue[] | null> {
  const portee = await filtreStock(req, 'ms');
  if (portee === null) return null;

  let sql = `
    SELECT ms.*, c.name as category_name
    FROM manifestation_stock ms
    LEFT JOIN categories c ON c.id = ms.category_id
    WHERE 1=1${portee.sql}
  `;
  const params: any[] = [...portee.params];

  if (filtres.service) {
    const perimetre = conditionPerimetreService(String(filtres.service), 'ms');
    sql += perimetre.sql;
    params.push(...perimetre.params);
  }
  if (filtres.categoryId) {
    sql += ' AND ms.category_id = ?';
    params.push(filtres.categoryId);
  }
  const nature = natureDemandee(filtres.kind);
  if (nature === 'prestation') sql += ' AND ms.is_prestation = 1';
  else if (nature === 'materiel') sql += ' AND (ms.is_prestation IS NULL OR ms.is_prestation = 0)';

  const articles = await db.query(sql, params);
  if (articles.length === 0) return [];

  const engagements = await disponibiliteSur(
    articles.map((article: any) => article.id),
    debut,
    fin
  );

  return articles.map((article: any) => {
    const prestation = estPrestation(article);
    const engage = engagements.get(article.id);
    const total = nombreOuZero(article.quantity_total);

    return {
      ref: `stock:${article.id}`,
      source: 'stock' as const,
      id: Number(article.id),
      name: String(article.name ?? ''),
      category: String(article.category_name ?? article.category ?? ''),
      unit: String(article.unit ?? ''),
      is_prestation: prestation,
      // Une prestation n'a pas de stock : lui calculer une disponibilité la ferait paraître en
      // rupture permanente, son total valant zéro. Même règle qu'`enrichirStock`.
      quantity_total: prestation ? null : total,
      quantity_available: prestation
        ? null
        : Math.max(0, total - (engage?.engage_previsionnel ?? 0) - (engage?.engage_reel ?? 0)),
    };
  });
}

/** Matériels du parc déclarés prêtables, avec ce qu'il en reste sur la période. */
async function materielsDuParc(
  req: AuthRequest,
  debut: string,
  fin: string,
  filtres: FiltresCatalogue
): Promise<ArticleCatalogue[] | null> {
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  let sql = `
    SELECT o.id, o.name, o.quantity_total, o.material_type,
           pc.name as category_name,
           ${expressionPrestation()} as is_prestation,
           ${expressionNature()} as nature
    FROM objects o
    ${jointuresDisponibilite()}
    WHERE ${expressionDisponibilite()} = 1
      AND o.status = 'active'${portee.sql}
  `;
  const params: any[] = [...portee.params];

  if (filtres.service) {
    const perimetre = conditionPerimetreService(String(filtres.service), 'o');
    sql += perimetre.sql;
    params.push(...perimetre.params);
  }
  if (filtres.categoryId) {
    // La catégorie d'un matériel est sa catégorie directe **ou** celle de sa sous-catégorie : ne
    // tester que la première ferait disparaître tout un rayon rangé en sous-catégories.
    sql += ' AND COALESCE(o.category_id, psc.category_id) = ?';
    params.push(filtres.categoryId);
  }
  const nature = natureDemandee(filtres.kind);
  if (nature === 'prestation') sql += ` AND ${expressionPrestation()} = 1`;
  else if (nature === 'materiel') sql += ` AND ${expressionPrestation()} = 0`;

  sql += ' ORDER BY o.name';

  const objets = await db.query(sql, params);
  if (objets.length === 0) return [];

  // Seuls les exemplaires entrent en conflit : une prestation ne s'immobilise pas, et ce qui
  // arrive à un lot est un manque, compté en quantité. `indisponibilites` fait déjà ce tri, mais
  // ne lui donner que les exemplaires évite deux requêtes pour rien.
  const exemplaires = objets
    .filter((objet: any) => objet.nature === 'unique')
    .map((objet: any) => objet.id);

  const [conflits, avecLots] = await Promise.all([
    indisponibilites(exemplaires, debut, fin),
    enrichirLots(objets, { debut, fin }),
  ]);
  const pris = new Set(conflits.map((conflit) => Number(conflit.object_id)));

  return avecLots.map((objet: any) => {
    const prestation = objet.nature === 'prestation';
    const commun = {
      ref: `parc:${objet.id}`,
      source: 'parc' as const,
      id: Number(objet.id),
      name: String(objet.name ?? ''),
      category: String(objet.category_name ?? ''),
      // Le parc ne tient pas d'unité : un exemplaire est un exemplaire.
      unit: '',
      is_prestation: prestation,
    };

    if (prestation) {
      return { ...commun, quantity_total: null, quantity_available: null };
    }

    if (objet.nature === 'lot') {
      const total = nombreOuZero(objet.quantity_total);
      // `enrichirLots` a déduit le prévisionnel et le réel de la période demandée.
      const restant = objet.disponible_previsionnel ?? total;
      return {
        ...commun,
        quantity_total: total,
        quantity_available: Math.max(0, nombreOuZero(restant)),
      };
    }

    // Un exemplaire ne se partage pas : il est pris, ou il est libre.
    return {
      ...commun,
      quantity_total: 1,
      quantity_available: pris.has(Number(objet.id)) ? 0 : 1,
    };
  });
}

/**
 * Catalogue complet sur une période, filtres appliqués.
 *
 * `null` quand le compte n'a accès ni au stock ni au parc : la route doit alors refuser, plutôt
 * que rendre une liste vide qui se lirait comme « il n'y a rien à prêter ».
 */
export async function catalogue(
  req: AuthRequest,
  debut: string,
  fin: string,
  filtres: FiltresCatalogue = {}
): Promise<ArticleCatalogue[] | null> {
  const [stock, parc] = await Promise.all([
    articlesDuStock(req, debut, fin, filtres),
    materielsDuParc(req, debut, fin, filtres),
  ]);

  if (stock === null && parc === null) return null;

  return [...(stock ?? []), ...(parc ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
