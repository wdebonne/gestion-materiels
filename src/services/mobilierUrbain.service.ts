import { db } from '../database';

/**
 * Le vocabulaire et les questions du mobilier de voie publique.
 *
 * Tout ce qui suit répond à une seule exigence : **retrouver un exemplaire**.
 * Un parc de mille points ne se parcourt pas ; il se filtre. Et il se filtre
 * selon la façon dont une commune travaille réellement — par modèle (« tous les
 * candélabres »), par rue (« la rue de la Gare, jeudi »), par secteur (« le
 * quartier de la gare »), par état (« ce qui est cassé »), par échéance (« ce
 * qui devait être repassé en mars »).
 *
 * Ce fichier porte ce qui appartient en propre à la **voie publique** : son
 * vocabulaire, la lecture d'une position, la numérotation des exemplaires et
 * la tenue de leurs échéances.
 *
 * Le filtrage, lui, a déménagé dans `implantations.service.ts` le jour où la
 * carte a cessé de ne montrer que les trottoirs. Un banc de parc et un banc de
 * trottoir se cherchent avec les mêmes mots ; deux définitions des mêmes
 * filtres, une par gisement, divergeraient au premier critère ajouté.
 */

// ---------------------------------------------------------------- vocabulaire

export interface Terme {
  valeur: string;
  libelle: string;
}

/**
 * L'état de service, qui décide de ce qui se voit sur la carte.
 *
 * `depose` mérite d'exister : un candélabre retiré n'est pas un candélabre
 * supprimé. Effacer la ligne effacerait aussi ses interventions, et la question
 * « qu'y avait-il à cet angle avant ? » n'aurait plus de réponse. Il sort de la
 * carte, il reste dans l'historique.
 */
export const STATUTS: readonly Terme[] = [
  { valeur: 'en_service', libelle: 'En service' },
  { valeur: 'maintenance', libelle: 'En intervention' },
  { valeur: 'hors_service', libelle: 'Hors service' },
  { valeur: 'depose', libelle: 'Déposé' },
];

/**
 * L'état physique, qui décide de ce qu'on va programmer.
 *
 * Exactement la liste des espaces verts (`client/src/lib/espacesVerts.ts`),
 * « à remplacer » compris. Ce n'est pas une coïncidence : la carte montre les
 * deux, et deux vocabulaires voisins mais différents donneraient un filtre
 * « mauvais état » qui ne ramènerait que la moitié du parc sans le dire.
 */
export const ETATS: readonly Terme[] = [
  { valeur: 'neuf', libelle: 'Neuf' },
  { valeur: 'bon', libelle: 'Bon' },
  { valeur: 'moyen', libelle: 'Moyen' },
  { valeur: 'mauvais', libelle: 'Mauvais' },
  { valeur: 'remplacer', libelle: 'À remplacer' },
];

/** D'où vient le point posé sur la carte. */
export const SOURCES_POSITION: readonly Terme[] = [
  { valeur: 'carte', libelle: 'Pointé sur la carte' },
  { valeur: 'gps', libelle: 'Relevé sur le terrain' },
  { valeur: 'saisie', libelle: 'Coordonnées saisies' },
];

/**
 * Ce qu'on fait à un mobilier, et qui n'arrive qu'à lui.
 *
 * « Repeint » est un type à part entière et non une note libre : c'est
 * l'exemple que donne le terrain, et c'est ce qui permet de répondre à « quels
 * bancs ont été repeints cette année ? » sans relire cent descriptions.
 */
export const TYPES_INTERVENTION: readonly Terme[] = [
  { valeur: 'pose', libelle: 'Pose' },
  { valeur: 'controle', libelle: 'Contrôle' },
  { valeur: 'nettoyage', libelle: 'Nettoyage' },
  { valeur: 'entretien', libelle: 'Entretien' },
  { valeur: 'peinture', libelle: 'Peinture' },
  { valeur: 'reparation', libelle: 'Réparation' },
  { valeur: 'remplacement', libelle: 'Remplacement de pièce' },
  { valeur: 'deplacement', libelle: 'Déplacement' },
  { valeur: 'depose', libelle: 'Dépose' },
  { valeur: 'degradation', libelle: 'Dégradation constatée' },
  { valeur: 'autre', libelle: 'Autre' },
];

/** Une valeur du référentiel, ou le repli — jamais ce qu'on a reçu tel quel. */
export function termeValide(
  liste: readonly Terme[],
  recu: unknown,
  repli: string
): string {
  const texte = typeof recu === 'string' ? recu.trim() : '';
  return liste.some((t) => t.valeur === texte) ? texte : repli;
}

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_POSITION =
  'Position invalide : une latitude entre -90 et 90 et une longitude entre -180 et 180 sont attendues';

// ------------------------------------------------------------------ position

export interface Position {
  latitude: number;
  longitude: number;
}

/**
 * Une position utilisable, ou rien.
 *
 * `Number(null)` vaut 0, et `Number('')` aussi : tester la seule finitude
 * accepterait un champ vide et poserait le banc au large du golfe de Guinée.
 * Le point (0, 0) est un point valide du globe ; c'est l'**absence** de valeur
 * qu'il faut refuser, pas le zéro.
 */
export function lirePosition(latitude: unknown, longitude: unknown): Position | null {
  const nombre = (valeur: unknown): number | null => {
    if (valeur === null || valeur === undefined || valeur === '') return null;
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  };

  const lat = nombre(latitude);
  const lng = nombre(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Distance entre deux points, en mètres.
 *
 * Sert au filtre « autour de moi » : sur le terrain, la question n'est jamais
 * « quels bancs sont dans ce rectangle » mais « qu'y a-t-il à cent mètres ».
 * La formule de Haversine suffit largement à l'échelle d'une commune — l'écart
 * au modèle ellipsoïdal se compte en décimètres sur un kilomètre, quand le GPS
 * d'un téléphone se trompe déjà de plusieurs mètres.
 */
export function distanceMetres(a: Position, b: Position): number {
  const RAYON = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------- calendrier
/** La date du jour au format que la base stocke. */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** L'emprise demandée par la carte, ou rien si elle n'a aucun sens. */
export function lireEmprise(
  brut: unknown
): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
  if (typeof brut !== 'string' || !brut.trim()) return null;
  const bornes = brut.split(',').map((m) => Number(m.trim()));
  if (bornes.length !== 4 || bornes.some((n) => !Number.isFinite(n))) return null;
  const [minLat, minLng, maxLat, maxLng] = bornes;
  if (minLat > maxLat || minLng > maxLng) return null;
  return { minLat, minLng, maxLat, maxLng };
}

// ------------------------------------------------------------------ numérotation

/**
 * Le rang du prochain exemplaire de ce modèle.
 *
 * `MAX + 1` et non `COUNT + 1` : supprimer le banc 12 ne doit pas faire
 * réapparaître le numéro 12 sur le banc suivant. Deux bancs 12 dans
 * l'historique, dont l'un a été repeint et l'autre non, c'est une question sans
 * réponse — et la plaque vissée sur l'assise, elle, n'est pas réattribuable.
 */
export async function prochainNumero(objectId: number | string): Promise<number> {
  const ligne = await db.queryOne(
    'SELECT COALESCE(MAX(numero), 0) as dernier FROM street_furniture WHERE object_id = ?',
    [objectId]
  );
  return Number(ligne?.dernier ?? 0) + 1;
}

/**
 * Le nom qu'on lit sur la carte quand personne n'en a donné.
 *
 * « Banc 23 » plutôt que « Banc » répété vingt-trois fois : c'est le nom que le
 * terrain emploie de toute façon, et l'écrire d'office évite de demander à
 * chaque pose un libellé que personne n'a envie d'inventer.
 */
export function libelleParDefaut(nomModele: string, numero: number): string {
  return `${(nomModele || 'Mobilier').trim()} ${numero}`;
}

// ------------------------------------------------------------------ échéances

/**
 * Recopie sur l'exemplaire la dernière intervention faite et la prochaine à
 * faire.
 *
 * Ces deux dates sont dérivées : elles se relisent des interventions. Les
 * recopier est une dénormalisation assumée, et le seul moyen de teindre mille
 * points sur une carte sans lire mille historiques. Recalculée à chaque
 * écriture d'intervention plutôt que maintenue à la main, pour qu'une
 * suppression la corrige aussi.
 *
 * La prochaine échéance retenue est **la plus proche encore devant nous**, et à
 * défaut la plus lointaine du passé : une échéance dépassée doit rester
 * visible, c'est justement celle qu'on cherche.
 */
export async function rafraichirEcheances(itemId: number | string): Promise<void> {
  const bilan = await db.queryOne(
    `SELECT MAX(performed_on) as derniere FROM street_furniture_interventions
     WHERE item_id = ? AND performed_on IS NOT NULL`,
    [itemId]
  );

  const jour = aujourdhui();
  const aVenir = await db.queryOne(
    `SELECT MIN(next_date) as prochaine FROM street_furniture_interventions
     WHERE item_id = ? AND next_date IS NOT NULL AND next_date >= ?`,
    [itemId, jour]
  );
  const passee = await db.queryOne(
    `SELECT MAX(next_date) as prochaine FROM street_furniture_interventions
     WHERE item_id = ? AND next_date IS NOT NULL AND next_date < ?`,
    [itemId, jour]
  );

  await db.execute(
    `UPDATE street_furniture
     SET last_intervention_date = ?, next_intervention_date = ?, updated_at = ?
     WHERE id = ?`,
    [
      bilan?.derniere ?? null,
      aVenir?.prochaine ?? passee?.prochaine ?? null,
      new Date().toISOString(),
      itemId,
    ]
  );
}

/**
 * Porte au calendrier la prochaine échéance d'une intervention, ou l'en retire.
 *
 * Les espaces verts le font depuis toujours : un entretien qui annonce une date
 * de retour pose un rendez-vous. La voirie ne le faisait pas — l'échéance
 * s'inscrivait sur l'exemplaire, se teintait en rouge une fois dépassée, et
 * n'apparaissait nulle part avant. Autant dire qu'elle était dépassée avant
 * d'être vue.
 *
 * L'événement porte `object_id` : c'est lui qui fait que le calendrier applique
 * la portée par catégorie, et que la ligne ne s'affiche pas chez un compte qui
 * n'a pas accès à ce matériel.
 *
 * Rejouée à chaque écriture — création, correction, suppression — et non tenue à
 * la main : l'ancien rendez-vous est effacé avant que le nouveau ne soit posé,
 * ce qui évite les doublons et rattrape les corrections de date.
 */
export async function rendezVousIntervention(interventionId: number | string): Promise<void> {
  await db.execute(
    `DELETE FROM calendar_events
     WHERE plugin_reference = 'street-furniture-intervention' AND plugin_reference_id = ?`,
    [interventionId]
  );

  const ligne = await db.queryOne(
    `SELECT i.next_date, i.intervention_type, i.performed_by,
            sf.id as item_id, sf.label, sf.street, sf.object_id
     FROM street_furniture_interventions i
     JOIN street_furniture sf ON sf.id = i.item_id
     WHERE i.id = ?`,
    [interventionId]
  );
  if (!ligne?.next_date) return;

  const nature = TYPES_INTERVENTION.find((t) => t.valeur === ligne.intervention_type);
  await db.execute(
    `INSERT INTO calendar_events (title, description, event_type, start_date, end_date,
       all_day, color, object_id, plugin_reference, plugin_reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `🔧 ${ligne.label} : ${nature?.libelle ?? ligne.intervention_type}`,
      [
        'Intervention prévue sur la voie publique',
        ligne.street ? `Lieu : ${ligne.street}` : null,
        ligne.performed_by ? `Intervenant : ${ligne.performed_by}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      'maintenance',
      ligne.next_date,
      ligne.next_date,
      1,
      '#2563eb',
      ligne.object_id,
      'street-furniture-intervention',
      interventionId,
      new Date().toISOString(),
    ]
  );
}
// -------------------------------------------------------------------- lecture

/**
 * Les colonnes que tous les écrans attendent d'un exemplaire.
 *
 * Le modèle voyage avec : sans son nom, sa référence et sa catégorie, la carte
 * afficherait des points anonymes et l'export PDF ne saurait pas les regrouper.
 */
export const COLONNES_EXEMPLAIRE = `
  sf.*,
  o.name as object_name,
  o.reference as object_reference,
  o.image as object_image,
  o.status as object_status,
  o.unit_cost as object_unit_cost,
  o.purchase_price as object_purchase_price,
  COALESCE(o.category_id, psc.category_id) as category_id,
  pc.name as category_name,
  o.subcategory_id as subcategory_id,
  psc.name as subcategory_name
`;

/** Les jointures qu'exige `COLONNES_EXEMPLAIRE`. */
export const JOINTURES_EXEMPLAIRE = `
  LEFT JOIN objects o ON o.id = sf.object_id
  LEFT JOIN subcategories psc ON psc.id = o.subcategory_id
  LEFT JOIN categories pc ON pc.id = COALESCE(o.category_id, psc.category_id)
`;

/** Un exemplaire tel que les écrans l'attendent, ou `null`. */
export async function exemplaireComplet(itemId: number | string): Promise<any | null> {
  return db.queryOne(
    `SELECT ${COLONNES_EXEMPLAIRE}
     FROM street_furniture sf
     ${JOINTURES_EXEMPLAIRE}
     WHERE sf.id = ?`,
    [itemId]
  );
}
