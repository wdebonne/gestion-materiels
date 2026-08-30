import { db } from '../database';
import { filtreObjets } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';
import { expressionDisponibilite, jointuresDisponibilite } from './materielPretable.service';
import { expressionPrestation, prestationsParmi } from './prestationParc.service';

/**
 * Matériel **unique** rattaché à une manifestation.
 *
 * Une manifestation ne savait demander que des quantités : « 50 tables ». Un
 * véhicule n'est pas une quantité — c'est un exemplaire identifié, avec son
 * numéro de série, ses entretiens et ses pleins, et il ne peut pas être à deux
 * endroits le même jour. Il vit dans `objects`, où toute son histoire est déjà
 * tenue ; le dupliquer dans le stock des manifestations créerait deux vérités.
 *
 * `manifestation_items` existait depuis l'origine pour faire ce lien et n'a
 * jamais été ni lue ni écrite. Ce module la met enfin en service.
 *
 * La différence essentielle avec le stock quantitatif : ici, **un conflit est un
 * conflit**. Deux manifestations peuvent se partager 100 chaises sur 50 chacune ;
 * elles ne peuvent pas se partager le camion.
 */

/** Statuts d'une manifestation qui immobilisent le matériel du parc. */
export const STATUTS_IMMOBILISANTS = ['pending', 'draft', 'validated', 'delivered'] as const;

/**
 * Statuts de réservation qui bloquent déjà un matériel.
 *
 * Repris de `reservation.routes.ts` : `pending` ne bloque pas, c'est une demande
 * que personne n'a encore acceptée. Un matériel réservé par ailleurs doit
 * apparaître indisponible pour une manifestation — sinon les deux circuits se
 * promettent le même camion sans jamais se croiser.
 */
const STATUTS_RESERVATION_BLOQUANTS = ['reserved', 'borrowed'] as const;

/** État du matériel unique à son retour. */
export const ETATS_RETOUR = ['intact', 'abime', 'perdu'] as const;
export type EtatRetour = (typeof ETATS_RETOUR)[number];

const marqueurs = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(',');

/** Fenêtre d'immobilisation, identique à celle du stock quantitatif. */
const DEBUT_PERIODE = 'COALESCE(m.delivery_date, m.date_start)';
const FIN_PERIODE = 'COALESCE(m.recovery_date, m.date_end, m.date_start)';

export interface IndisponibiliteObjet {
  object_id: number;
  object_name: string;
  /** `manifestation` ou `reservation` : ce qui retient le matériel. */
  origine: 'manifestation' | 'reservation';
  /** Titre de la manifestation, ou motif de la réservation. */
  detail: string;
  debut: string;
  fin: string;
}

/**
 * Ce qui empêche de disposer de ces matériels sur la période.
 *
 * Interroge les deux circuits — manifestations et réservations — parce qu'ils
 * engagent le même parc sans se connaître.
 */
export async function indisponibilites(
  objectIds: Array<number | string>,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<IndisponibiliteObjet[]> {
  if (objectIds.length === 0) return [];

  // Une prestation n'est jamais retenue ailleurs. Un raccordement électrique
  // demandé le 21 juin ne rend pas le raccordement indisponible pour la
  // manifestation d'à côté le même jour : ce n'est pas un exemplaire, c'est un
  // acte. Sans cette exception, la première demande de l'année bloquerait
  // toutes les suivantes, et personne ne comprendrait pourquoi.
  const prestations = await prestationsParmi(objectIds);
  const aVerifier = objectIds.filter((id) => !prestations.has(Number(id)));
  if (aVerifier.length === 0) return [];

  const exclusion = exclureManifestationId ? ' AND m.id != ?' : '';
  const finDeRequete = exclureManifestationId ? [exclureManifestationId] : [];

  const [parManifestation, parReservation] = await Promise.all([
    grouperEnfants(
      (marqueursIds) => `
        SELECT mi.object_id, o.name as object_name, m.title as detail,
               ${DEBUT_PERIODE} as debut, ${FIN_PERIODE} as fin
        FROM manifestation_items mi
        JOIN manifestations m ON m.id = mi.manifestation_id
        JOIN objects o ON o.id = mi.object_id
        WHERE mi.object_id IN (${marqueursIds})
          AND m.status IN (${marqueurs(STATUTS_IMMOBILISANTS)})
          AND ${DEBUT_PERIODE} <= ? AND ${FIN_PERIODE} >= ?${exclusion}
      `,
      aVerifier,
      'object_id',
      (tranche) => [...tranche, ...STATUTS_IMMOBILISANTS, dateFin, dateDebut, ...finDeRequete]
    ),
    grouperEnfants(
      (marqueursIds) => `
        SELECT r.object_id, o.name as object_name,
               COALESCE(r.reason, 'Réservation') as detail,
               r.start_date as debut, r.end_date as fin
        FROM reservations r
        JOIN objects o ON o.id = r.object_id
        WHERE r.object_id IN (${marqueursIds})
          AND r.status IN (${marqueurs(STATUTS_RESERVATION_BLOQUANTS)})
          AND r.start_date <= ? AND r.end_date >= ?
      `,
      aVerifier,
      'object_id',
      (tranche) => [...tranche, ...STATUTS_RESERVATION_BLOQUANTS, dateFin, dateDebut]
    ),
  ]);

  const conflits: IndisponibiliteObjet[] = [];
  for (const id of new Set(aVerifier)) {
    for (const ligne of enfantsDe<any>(parManifestation, id)) {
      conflits.push({ ...ligne, origine: 'manifestation' });
    }
    for (const ligne of enfantsDe<any>(parReservation, id)) {
      conflits.push({ ...ligne, origine: 'reservation' });
    }
  }

  return conflits;
}

/** Matériels du parc demandés par une manifestation, avec leur fiche. */
export async function objetsDe(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT mi.*, o.name as object_name, o.reference, o.serial_number,
            o.status as object_status, o.category_id, o.subcategory_id,
            c.name as category_name,
            ${expressionPrestation()} as is_prestation
     FROM manifestation_items mi
     JOIN objects o ON o.id = mi.object_id
     LEFT JOIN categories c ON c.id = o.category_id
     ${jointuresDisponibilite()}
     WHERE mi.manifestation_id = ?
     ORDER BY o.name`,
    [manifestationId]
  );
}

/**
 * Remplace la liste des matériels uniques d'une manifestation.
 *
 * L'état de retour et les notes déjà saisis sont conservés pour les matériels
 * qui restent : les effacer parce que le formulaire ne les renvoie pas perdrait
 * le constat fait au retour, qui est précisément ce qu'on veut garder.
 */
export async function remplacerObjets(
  manifestationId: number | string,
  objets: Array<{ object_id: number; quantity?: number | null; notes?: string | null }>
): Promise<void> {
  const precedents = await db.query(
    'SELECT object_id, quantity, quantity_delivered, quantity_returned, return_state, notes FROM manifestation_items WHERE manifestation_id = ?',
    [manifestationId]
  );
  const connus = new Map<any, any>(precedents.map((l: any) => [l.object_id, l]));

  // Une prestation se demande en nombre — « 3 agents pour la cérémonie » — là
  // où un exemplaire du parc vaut toujours 1 : le camion ne se demande pas en
  // double. La quantité reçue n'est donc retenue que pour les prestations.
  const prestations = await prestationsParmi(objets.map((o) => o.object_id));

  await db.execute('DELETE FROM manifestation_items WHERE manifestation_id = ?', [manifestationId]);

  const maintenant = new Date().toISOString();
  const dejaVus = new Set<number>();

  for (const objet of objets) {
    // Un même matériel deux fois dans la même demande n'a aucun sens : il est
    // unique. On garde la première occurrence plutôt que de créer un doublon
    // qui se compterait deux fois dans les conflits.
    if (!objet.object_id || dejaVus.has(objet.object_id)) continue;
    dejaVus.add(objet.object_id);

    const avant = connus.get(objet.object_id);
    await db.execute(
      `INSERT INTO manifestation_items
         (manifestation_id, object_id, quantity, quantity_delivered, quantity_returned,
          return_state, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        manifestationId,
        objet.object_id,
        prestations.has(objet.object_id)
          ? Math.max(1, Number(objet.quantity ?? avant?.quantity ?? 1) || 1)
          : 1,
        avant?.quantity_delivered ?? 0,
        avant?.quantity_returned ?? 0,
        avant?.return_state ?? null,
        objet.notes ?? avant?.notes ?? null,
        maintenant,
        maintenant,
      ]
    );
  }
}

/**
 * Matériels du parc disponibles sur une période, pour le sélecteur.
 *
 * Rend le parc **visible par l'appelant**, chaque ligne portant ce qui la
 * retient. Masquer les matériels pris priverait l'agent de l'information utile :
 * savoir *qui* a le camion, et pouvoir demander un décalage.
 *
 * La portée par catégorie est appliquée **ici**, et non laissée à l'appelant :
 * une recherche libre sur tout le parc est exactement la fuite que
 * `objectScope.ts` a fermée sur `GET /green-spaces/search/objects`. Rend `null`
 * quand le compte n'a accès à aucune catégorie.
 */
export async function parcAvecDisponibilite(
  req: AuthRequest,
  recherche: string | undefined,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<any[] | null> {
  const filtre = await filtreObjets(req, 'o');
  if (filtre === null) return null;

  // Seul le matériel déclaré prêtable est proposé : une catégorie ne se prête
  // pas d'un bloc — le réfrigérateur part pour la brocante, le grill non.
  let sql = `
    SELECT o.id, o.name, o.reference, o.serial_number, o.status,
           o.category_id, o.subcategory_id, COALESCE(c.name, pc.name) as category_name,
           ${expressionPrestation()} as is_prestation
    FROM objects o
    LEFT JOIN categories c ON c.id = o.category_id
    ${jointuresDisponibilite()}
    WHERE ${expressionDisponibilite()} = 1
  `;
  const params: any[] = [];

  if (recherche) {
    sql += ' AND (o.name LIKE ? OR o.reference LIKE ? OR o.serial_number LIKE ?)';
    params.push(`%${recherche}%`, `%${recherche}%`, `%${recherche}%`);
  }

  sql += filtre.sql;
  params.push(...filtre.params);
  sql += ' ORDER BY o.name LIMIT 100';

  const objets = await db.query(sql, params);
  if (objets.length === 0) return [];

  const conflits = await indisponibilites(
    objets.map((o: any) => o.id),
    dateDebut,
    dateFin,
    exclureManifestationId
  );

  return objets.map((objet: any) => {
    const retenues = conflits.filter((c) => c.object_id === objet.id);
    return {
      ...objet,
      disponible: retenues.length === 0,
      indisponibilites: retenues,
    };
  });
}
