import { db } from '../database';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';

/**
 * Disponibilité du stock des manifestations : prévisionnel et réel.
 *
 * Les deux notions étaient mélangées et réécrites à la main dans chaque route.
 * `GET /stock` soustrayait le matériel dehors mais pas les réservations à venir,
 * `GET /stock/availability` faisait l'inverse, et aucune des deux ne savait dire
 * ce qui serait disponible entre deux dates — alors que c'est exactement la
 * question qu'on se pose en recevant une demande pour le mois prochain.
 *
 * Deux engagements, à ne jamais confondre :
 *
 * - **réel** : ce qui est physiquement sorti, donc livré et pas encore récupéré ;
 * - **prévisionnel** : ce qui est promis sur une période, demandes reçues et non
 *   encore confirmées comprises.
 *
 * Une manifestation ne compte que dans un seul des deux, selon son statut : sans
 * cette séparation, une manifestation livrée serait comptée deux fois — une fois
 * pour ce qu'elle avait demandé, une fois pour ce qu'elle a emporté.
 */

/** Statuts dont le matériel est promis mais pas encore sorti. */
export const STATUTS_PREVISIONNELS = ['pending', 'draft', 'validated'] as const;

/** Statuts dont le matériel est physiquement dehors. */
export const STATUTS_SORTIS = ['delivered'] as const;

/**
 * Fenêtre pendant laquelle une manifestation immobilise son matériel.
 *
 * Elle commence à la livraison — ou à défaut au premier jour — et se termine à
 * la récupération, à défaut au dernier jour, à défaut au premier. Sans
 * `recovery_date`, une manifestation d'un jour libérerait son matériel le
 * matin même.
 */
const DEBUT_PERIODE = 'COALESCE(m.delivery_date, m.date_start)';
const FIN_PERIODE = 'COALESCE(m.recovery_date, m.date_end, m.date_start)';

/** Deux périodes se chevauchent si chacune commence avant que l'autre finisse. */
const CHEVAUCHEMENT = `${DEBUT_PERIODE} <= ? AND ${FIN_PERIODE} >= ?`;

/**
 * Ce qui reste dehors sur une ligne : livré moins récupéré, jamais négatif.
 *
 * `MAX(a, b)` à deux arguments est scalaire en SQLite mais agrégat en MySQL :
 * `CASE` est la seule écriture qui dise la même chose aux deux moteurs.
 */
const RESTE_DEHORS = `CASE
  WHEN mm.quantity_delivered - mm.quantity_recovered > 0
  THEN mm.quantity_delivered - mm.quantity_recovered
  ELSE 0 END`;

const marqueursPour = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(', ');

export interface EngagementArticle {
  /** Promis sur la période, demandes à confirmer comprises. */
  engage_previsionnel: number;
  /** Physiquement sorti sur la période. */
  engage_reel: number;
}

/** Date du jour au format des colonnes DATE, sans dépendre du dialecte SQL. */
export function aujourdHui(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Engagement de chaque article sur une période.
 *
 * `exclureManifestationId` sert au moment où l'on modifie une manifestation :
 * ses propres lignes ne doivent pas se compter comme un conflit avec elle-même.
 */
export async function disponibiliteSur(
  stockIds: Array<number | string>,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<Map<any, EngagementArticle>> {
  const engagements = new Map<any, EngagementArticle>();
  if (stockIds.length === 0) return engagements;

  const exclusion = exclureManifestationId ? ' AND m.id != ?' : '';
  const finDeRequete = exclureManifestationId ? [exclureManifestationId] : [];

  const [previsionnel, reel] = await Promise.all([
    grouperEnfants(
      (marqueurs) => `
        SELECT mm.stock_id, COALESCE(SUM(mm.quantity_requested), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id IN (${marqueurs})
          AND m.status IN (${marqueursPour(STATUTS_PREVISIONNELS)})
          AND ${CHEVAUCHEMENT}${exclusion}
        GROUP BY mm.stock_id
      `,
      stockIds,
      'stock_id',
      (tranche) => [...tranche, ...STATUTS_PREVISIONNELS, dateFin, dateDebut, ...finDeRequete]
    ),
    grouperEnfants(
      (marqueurs) => `
        SELECT mm.stock_id, COALESCE(SUM(${RESTE_DEHORS}), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id IN (${marqueurs})
          AND m.status IN (${marqueursPour(STATUTS_SORTIS)})
          AND ${CHEVAUCHEMENT}${exclusion}
        GROUP BY mm.stock_id
      `,
      stockIds,
      'stock_id',
      (tranche) => [...tranche, ...STATUTS_SORTIS, dateFin, dateDebut, ...finDeRequete]
    ),
  ]);

  for (const id of new Set(stockIds)) {
    engagements.set(id, {
      engage_previsionnel: enfantsDe<any>(previsionnel, id)[0]?.qty || 0,
      engage_reel: enfantsDe<any>(reel, id)[0]?.qty || 0,
    });
  }

  return engagements;
}

/**
 * Complète une liste d'articles avec leurs quantités engagées.
 *
 * Sans période, on répond sur l'instant : ce qui est dehors aujourd'hui et ce
 * qui est promis pour plus tard. Avec une période, on ajoute le prévisionnel et
 * le réel sur cette période, ce que demande la question « aurai-je 200 chaises
 * le 14 juillet ? ».
 *
 * `quantity_lent`, `quantity_reserved_future` et `quantity_available` gardent
 * leur nom : l'écran Stock les affiche déjà.
 */
export async function enrichirStock(
  articles: any[],
  periode?: { debut: string; fin: string } | null
): Promise<any[]> {
  if (articles.length === 0) return [];

  const ids = articles.map((a) => a.id);
  const jour = aujourdHui();
  const lointain = '9999-12-31';

  const [maintenant, aVenir, surPeriode] = await Promise.all([
    // Dehors en ce moment : la période « aujourd'hui » suffit à le dire.
    disponibiliteSur(ids, jour, jour),
    // Promis d'ici la fin des temps.
    disponibiliteSur(ids, jour, lointain),
    periode ? disponibiliteSur(ids, periode.debut, periode.fin) : Promise.resolve(null),
  ]);

  return articles.map((article) => {
    const dehors = maintenant.get(article.id)?.engage_reel ?? 0;
    const promis = aVenir.get(article.id)?.engage_previsionnel ?? 0;
    const sur = surPeriode?.get(article.id);

    return {
      ...article,
      quantity_lent: dehors,
      quantity_reserved_future: promis,
      quantity_available: article.quantity_total - dehors,
      ...(sur
        ? {
            engage_previsionnel: sur.engage_previsionnel,
            engage_reel: sur.engage_reel,
            disponible_previsionnel:
              article.quantity_total - sur.engage_previsionnel - sur.engage_reel,
            disponible_reel: article.quantity_total - sur.engage_reel,
          }
        : {}),
    };
  });
}

export interface Conflit {
  stock_id: number;
  stock_name: string;
  demande: number;
  disponible: number;
  manquant: number;
}

/**
 * Articles demandés en quantité supérieure à ce qui restera disponible.
 *
 * Rendu comme un avertissement, jamais comme un refus : une commune substitue du
 * matériel, décale une livraison ou emprunte ailleurs. Bloquer la saisie
 * l'obligerait à mentir sur ce qu'elle a demandé pour pouvoir enregistrer.
 */
export async function detecterConflits(
  lignes: Array<{ stock_id: number; quantity_requested: number }>,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<Conflit[]> {
  const demandes = lignes.filter((l) => l.stock_id && l.quantity_requested > 0);
  if (demandes.length === 0) return [];

  const ids = demandes.map((l) => l.stock_id);
  const articles = await db.query(
    `SELECT id, name, quantity_total FROM manifestation_stock WHERE id IN (${marqueursPour(ids)})`,
    ids
  );
  const parId = new Map<any, any>(articles.map((a: any) => [a.id, a]));
  const engagements = await disponibiliteSur(ids, dateDebut, dateFin, exclureManifestationId);

  const conflits: Conflit[] = [];
  for (const ligne of demandes) {
    const article = parId.get(ligne.stock_id);
    if (!article) continue;

    const engage = engagements.get(ligne.stock_id);
    const disponible = Math.max(
      article.quantity_total - (engage?.engage_previsionnel ?? 0) - (engage?.engage_reel ?? 0),
      0
    );

    if (ligne.quantity_requested > disponible) {
      conflits.push({
        stock_id: ligne.stock_id,
        stock_name: article.name,
        demande: ligne.quantity_requested,
        disponible,
        manquant: ligne.quantity_requested - disponible,
      });
    }
  }

  return conflits;
}

/**
 * Période immobilisée par une manifestation, telle que la lit le SQL ci-dessus.
 *
 * Écrite ici pour que les routes n'aient pas à refaire les `COALESCE` à la main
 * et à finir par en oublier un.
 */
export function periodeDe(m: {
  date_start: string;
  date_end?: string | null;
  delivery_date?: string | null;
  recovery_date?: string | null;
}): { debut: string; fin: string } {
  return {
    debut: m.delivery_date || m.date_start,
    fin: m.recovery_date || m.date_end || m.date_start,
  };
}

/**
 * Enregistre une perte et diminue le stock physique, en une seule opération.
 *
 * Une chaise cassée ou volée ne revient pas : sans cette écriture, le total
 * affiché resterait celui de l'achat et s'éloignerait un peu plus du réel à
 * chaque manifestation. Le mouvement est journalisé pour qu'un total puisse
 * toujours s'expliquer — et se corriger si la saisie était fausse.
 */
export async function enregistrerMouvement(
  stockId: number,
  manifestationId: number | string | null,
  type: 'perte' | 'ajustement' | 'entree',
  quantite: number,
  raison: string | null,
  userId?: number
): Promise<void> {
  if (!quantite) return;

  const maintenant = new Date().toISOString();
  await db.execute(
    `INSERT INTO manifestation_stock_movements (stock_id, manifestation_id, type, quantity, reason, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [stockId, manifestationId ?? null, type, quantite, raison?.trim() || null, userId ?? null, maintenant]
  );

  // Une perte retire du stock, une entrée en remet. Le total ne descend jamais
  // sous zéro : une saisie erronée ne doit pas rendre le stock incompréhensible.
  const delta = type === 'entree' ? quantite : -quantite;
  await db.execute(
    `UPDATE manifestation_stock
     SET quantity_total = CASE WHEN quantity_total + ? < 0 THEN 0 ELSE quantity_total + ? END,
         updated_at = ?
     WHERE id = ?`,
    [delta, delta, maintenant, stockId]
  );
}
