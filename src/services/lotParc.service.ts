import { db } from '../database';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';
import { expressionPrestation, jointuresPrestation } from './prestationParc.service';
import {
  aujourdHui,
  STATUTS_PREVISIONNELS,
  STATUTS_SORTIS,
  type EngagementArticle,
} from './manifestationStock.service';

/**
 * Matériel du parc tenu en lot : quantités, prévisionnel et réel.
 *
 * Le parc ne savait compter que des exemplaires. Cinquante chaises identiques
 * n'ont rien à faire dans ce moule : les saisir une par une donnerait cinquante
 * fiches, cinquante QR codes et cinquante historiques d'entretien pour un même
 * modèle. Un matériel peut donc être déclaré **lot** et porter sa quantité, et
 * le stock se lit alors directement sur sa fiche de parc.
 *
 * L'arithmétique est **exactement celle du stock des manifestations** — mêmes
 * statuts, même fenêtre d'immobilisation, même séparation du promis et du sorti.
 * Elle porte simplement sur l'autre table : `manifestation_items` plutôt que
 * `manifestation_materials`. Les constantes sont importées et non recopiées :
 * deux définitions de « ce qui est dehors » finiraient par diverger, et les deux
 * écrans donneraient des chiffres différents pour la même chaise.
 *
 * La différence de fond avec un exemplaire tient en une phrase : **deux
 * manifestations se partagent cent chaises, elles ne se partagent pas le
 * camion**. Un manque sur un lot est donc un avertissement, pas un conflit.
 */

/** Les trois natures qu'un matériel du parc peut prendre. */
export type NatureMateriel = 'unique' | 'lot' | 'prestation';

const DEBUT_PERIODE = 'COALESCE(m.delivery_date, m.date_start)';
const FIN_PERIODE = 'COALESCE(m.recovery_date, m.date_end, m.date_start)';
const CHEVAUCHEMENT = `${DEBUT_PERIODE} <= ? AND ${FIN_PERIODE} >= ?`;

/**
 * Ce qui reste dehors sur une ligne : livré moins rendu, jamais négatif.
 *
 * `MAX(a, b)` à deux arguments est scalaire en SQLite mais agrégat en MySQL :
 * `CASE` est la seule écriture qui dise la même chose aux deux moteurs.
 */
const RESTE_DEHORS = `CASE
  WHEN mi.quantity_delivered - mi.quantity_returned > 0
  THEN mi.quantity_delivered - mi.quantity_returned
  ELSE 0 END`;

const marqueurs = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(', ');

/**
 * Fragment SQL rendant la nature effective d'un matériel.
 *
 * La prestation l'emporte : déclarée par branche, elle n'a ni stock ni
 * exemplaire, et lui reconnaître un `material_type` ferait calculer une
 * disponibilité sur un débit de boissons.
 *
 * Suppose les jointures de `jointuresPrestation` sous les alias donnés.
 */
export function expressionNature(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return `CASE
    WHEN ${expressionPrestation(aliasObjet, aliasSousCategorie, aliasCategorie)} = 1 THEN 'prestation'
    WHEN ${aliasObjet}.material_type = 'lot' THEN 'lot'
    ELSE 'unique' END`;
}

/** Nature d'un matériel, ou `unique` s'il est introuvable — le cas le plus prudent. */
export async function natureDe(objectId: number | string): Promise<NatureMateriel> {
  const identifiant = Number(objectId);
  if (!Number.isFinite(identifiant)) return 'unique';

  const ligne = await db.queryOne(
    `SELECT ${expressionNature()} as nature
     FROM objects o
     ${jointuresPrestation()}
     WHERE o.id = ?`,
    [identifiant]
  );
  return (ligne?.nature as NatureMateriel) ?? 'unique';
}

/**
 * Ceux de ces matériels qui sont des lots.
 *
 * Rendu en `Set` : les appelants s'en servent pour écarter des lignes d'une
 * liste, et une requête par ligne sur une manifestation de trente articles
 * ferait trente allers-retours.
 */
export async function lotsParmi(objectIds: Array<number | string>): Promise<Set<number>> {
  const identifiants = objectIds.map(Number).filter((n) => Number.isFinite(n));
  if (identifiants.length === 0) return new Set();

  const lignes = await db.query(
    `SELECT o.id
     FROM objects o
     ${jointuresPrestation()}
     WHERE o.id IN (${marqueurs(identifiants)}) AND ${expressionNature()} = 'lot'`,
    identifiants
  );
  return new Set(lignes.map((l: any) => Number(l.id)));
}

/**
 * Engagement de chaque lot sur une période.
 *
 * Deux engagements, à ne jamais confondre : le **réel**, ce qui est
 * physiquement sorti, et le **prévisionnel**, ce qui est promis — demandes
 * reçues et non encore confirmées comprises. Une manifestation ne compte que
 * dans un seul des deux selon son statut, sans quoi une manifestation livrée
 * serait comptée deux fois.
 *
 * `exclureManifestationId` sert au moment où l'on modifie une manifestation :
 * ses propres lignes ne doivent pas se compter comme un manque avec elle-même.
 */
export async function disponibiliteObjets(
  objectIds: Array<number | string>,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<Map<any, EngagementArticle>> {
  const engagements = new Map<any, EngagementArticle>();
  if (objectIds.length === 0) return engagements;

  const exclusion = exclureManifestationId ? ' AND m.id != ?' : '';
  const finDeRequete = exclureManifestationId ? [exclureManifestationId] : [];

  const [previsionnel, reel] = await Promise.all([
    grouperEnfants(
      (marqueursIds) => `
        SELECT mi.object_id, COALESCE(SUM(mi.quantity), 0) as qty
        FROM manifestation_items mi
        JOIN manifestations m ON m.id = mi.manifestation_id
        WHERE mi.object_id IN (${marqueursIds})
          AND m.status IN (${marqueurs(STATUTS_PREVISIONNELS)})
          AND ${CHEVAUCHEMENT}${exclusion}
        GROUP BY mi.object_id
      `,
      objectIds,
      'object_id',
      (tranche) => [...tranche, ...STATUTS_PREVISIONNELS, dateFin, dateDebut, ...finDeRequete]
    ),
    grouperEnfants(
      (marqueursIds) => `
        SELECT mi.object_id, COALESCE(SUM(${RESTE_DEHORS}), 0) as qty
        FROM manifestation_items mi
        JOIN manifestations m ON m.id = mi.manifestation_id
        WHERE mi.object_id IN (${marqueursIds})
          AND m.status IN (${marqueurs(STATUTS_SORTIS)})
          AND ${CHEVAUCHEMENT}${exclusion}
        GROUP BY mi.object_id
      `,
      objectIds,
      'object_id',
      (tranche) => [...tranche, ...STATUTS_SORTIS, dateFin, dateDebut, ...finDeRequete]
    ),
  ]);

  for (const id of new Set(objectIds)) {
    engagements.set(id, {
      engage_previsionnel: enfantsDe<any>(previsionnel, id)[0]?.qty || 0,
      engage_reel: enfantsDe<any>(reel, id)[0]?.qty || 0,
    });
  }

  return engagements;
}

/**
 * Complète des matériels du parc avec leur stock, quand ce sont des lots.
 *
 * Sans période, on répond sur l'instant : ce qui est dehors aujourd'hui et ce
 * qui est promis pour plus tard. Avec une période, on ajoute le prévisionnel et
 * le réel sur cette période — la question « aurai-je 200 chaises le 14 juillet ? »
 * posée cette fois depuis le parc.
 *
 * Un exemplaire ou une prestation ressort inchangé : leur calculer un stock les
 * ferait paraître en rupture en permanence, leur total valant zéro.
 */
export async function enrichirLots(
  objets: any[],
  periode?: { debut: string; fin: string } | null
): Promise<any[]> {
  const lots = objets.filter((o) => o.nature === 'lot' || o.material_type === 'lot');
  if (lots.length === 0) return objets;

  const ids = lots.map((o) => o.id);
  const jour = aujourdHui();
  const lointain = '9999-12-31';

  const [maintenant, aVenir, surPeriode] = await Promise.all([
    disponibiliteObjets(ids, jour, jour),
    disponibiliteObjets(ids, jour, lointain),
    periode ? disponibiliteObjets(ids, periode.debut, periode.fin) : Promise.resolve(null),
  ]);

  const parId = new Set(ids);
  return objets.map((objet) => {
    if (!parId.has(objet.id)) return objet;

    const total = Number(objet.quantity_total ?? 0);
    const dehors = maintenant.get(objet.id)?.engage_reel ?? 0;
    const promis = aVenir.get(objet.id)?.engage_previsionnel ?? 0;
    const sur = surPeriode?.get(objet.id);

    return {
      ...objet,
      quantity_lent: dehors,
      quantity_reserved_future: promis,
      quantity_available: total - dehors,
      ...(sur
        ? {
            engage_previsionnel: sur.engage_previsionnel,
            engage_reel: sur.engage_reel,
            disponible_previsionnel: total - sur.engage_previsionnel - sur.engage_reel,
            disponible_reel: total - sur.engage_reel,
          }
        : {}),
    };
  });
}

/** Ce qui manquerait sur un lot, si l'on servait la demande telle quelle. */
export interface ManqueLot {
  object_id: number;
  object_name: string;
  demande: number;
  disponible: number;
  manque: number;
}

/**
 * Manques sur les lots demandés, sur la période de la manifestation.
 *
 * **Avertissement, jamais refus** : la demande est enregistrée telle qu'elle a
 * été faite, et le manque est signalé pour être arbitré. C'est la règle déjà
 * suivie par le stock des manifestations — refuser une saisie parce qu'il
 * manque deux chaises obligerait à ressaisir toute la demande.
 */
export async function manquesSurLots(
  lignes: Array<{ object_id: number; quantity?: number | null }>,
  dateDebut: string,
  dateFin: string,
  exclureManifestationId?: number | string | null
): Promise<ManqueLot[]> {
  if (lignes.length === 0) return [];

  const lots = await lotsParmi(lignes.map((l) => l.object_id));
  const concernees = lignes.filter((l) => lots.has(Number(l.object_id)));
  if (concernees.length === 0) return [];

  const ids = concernees.map((l) => l.object_id);
  const engagements = await disponibiliteObjets(
    ids,
    dateDebut,
    dateFin,
    exclureManifestationId
  );

  const totaux = await db.query(
    `SELECT id, name, quantity_total FROM objects WHERE id IN (${marqueurs(ids)})`,
    ids
  );
  const parId = new Map(totaux.map((o: any) => [Number(o.id), o]));

  const manques: ManqueLot[] = [];
  for (const ligne of concernees) {
    const objet = parId.get(Number(ligne.object_id));
    if (!objet) continue;

    const engage = engagements.get(ligne.object_id);
    const disponible =
      Number(objet.quantity_total ?? 0) -
      (engage?.engage_previsionnel ?? 0) -
      (engage?.engage_reel ?? 0);
    const demande = Math.max(1, Number(ligne.quantity ?? 1) || 1);

    if (demande > disponible) {
      manques.push({
        object_id: Number(ligne.object_id),
        object_name: objet.name,
        demande,
        disponible: Math.max(0, disponible),
        manque: demande - Math.max(0, disponible),
      });
    }
  }

  return manques;
}
