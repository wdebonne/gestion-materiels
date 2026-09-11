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
 * Ces filtres sont assemblés ici plutôt que dans les routes parce qu'ils
 * servent trois fois pour la même question : la liste, la carte et l'export
 * PDF. Trois écritures divergeraient, et l'export ne dirait plus la même chose
 * que la carte qu'on venait de regarder — ce qui est exactement ce qu'on
 * n'attend pas d'un document qu'on imprime pour l'emmener sur le terrain.
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

/** L'état physique, qui décide de ce qu'on va programmer. */
export const ETATS: readonly Terme[] = [
  { valeur: 'neuf', libelle: 'Neuf' },
  { valeur: 'bon', libelle: 'Bon' },
  { valeur: 'moyen', libelle: 'Moyen' },
  { valeur: 'mauvais', libelle: 'Mauvais' },
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

// -------------------------------------------------------------------- filtres

/** Ce qu'une requête peut demander. Tout est facultatif, et tout se combine. */
export interface FiltresMobilier {
  q?: string;
  category_id?: string;
  subcategory_id?: string;
  /** Plusieurs modèles séparés par des virgules : « bancs et corbeilles ». */
  object_id?: string;
  status?: string;
  condition_state?: string;
  street?: string;
  sector?: string;
  /** « minLat,minLng,maxLat,maxLng » — ce que la carte affiche. */
  bbox?: string;
  pose_du?: string;
  pose_au?: string;
  /** Échéance d'entretien dépassée à la date du jour. */
  en_retard?: string;
  /** Échéance d'entretien au plus tard à cette date : ce qu'il reste à faire. */
  echeance_avant?: string;
  /** Jamais aucune intervention : ce qui n'a pas été revu depuis la pose. */
  jamais_entretenu?: string;
  /** `1` pour inclure les exemplaires déposés, absents par défaut. */
  avec_deposes?: string;
}

/** Vrai au sens d'une chaîne de requête : `1`, `true`, `oui`. */
const vraiDansUrl = (valeur: unknown): boolean =>
  valeur === '1' || valeur === 1 || valeur === true || valeur === 'true' || valeur === 'oui';

/** Une liste d'identifiants, depuis « 3,7,12 ». Les intrus sont écartés. */
function identifiants(brut: unknown): number[] {
  if (brut === null || brut === undefined || brut === '') return [];
  return String(brut)
    .split(',')
    .map((morceau) => Number(morceau.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Une liste de valeurs de référentiel, depuis « bon,moyen ». */
function termes(liste: readonly Terme[], brut: unknown): string[] {
  if (brut === null || brut === undefined || brut === '') return [];
  const connus = new Set(liste.map((t) => t.valeur));
  return String(brut)
    .split(',')
    .map((morceau) => morceau.trim())
    .filter((valeur) => connus.has(valeur));
}

/** Une date `AAAA-MM-JJ`, ou rien : ce qui vient d'une URL n'est pas une date. */
function dateOuRien(brut: unknown): string | null {
  const texte = typeof brut === 'string' ? brut.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(texte) ? texte : null;
}

/**
 * Le fragment `WHERE` correspondant aux filtres, et ses paramètres.
 *
 * Suppose que la requête appelante écrit `FROM street_furniture sf` et joint
 * `objects o` sous cet alias. Le fragment commence toujours par ` AND ` : il
 * se concatène derrière une condition déjà posée, ce qui évite d'avoir à
 * décider ici s'il y a ou non un `WHERE` avant.
 */
export function clauseFiltres(filtres: FiltresMobilier): { sql: string; params: any[] } {
  const morceaux: string[] = [];
  const params: any[] = [];

  // Un exemplaire déposé n'est pas supprimé, mais il n'encombre pas la carte
  // tant qu'on ne le demande pas. Le filtrer par défaut évite d'expliquer à
  // chaque ouverture pourquoi un candélabre retiré en 2019 est encore là.
  const statuts = termes(STATUTS, filtres.status);
  if (statuts.length > 0) {
    morceaux.push(`sf.status IN (${statuts.map(() => '?').join(',')})`);
    params.push(...statuts);
  } else if (!vraiDansUrl(filtres.avec_deposes)) {
    morceaux.push(`sf.status <> 'depose'`);
  }

  const terme = typeof filtres.q === 'string' ? filtres.q.trim() : '';
  if (terme) {
    // La recherche traverse l'exemplaire **et** son modèle : on cherche
    // « candélabre » sans savoir si le mot a été recopié sur chaque point.
    const motif = `%${terme}%`;
    morceaux.push(`(
      sf.label LIKE ? OR sf.code LIKE ? OR sf.address LIKE ?
      OR sf.street LIKE ? OR sf.sector LIKE ? OR sf.notes LIKE ?
      OR o.name LIKE ? OR o.reference LIKE ?
    )`);
    params.push(motif, motif, motif, motif, motif, motif, motif, motif);
  }

  const modeles = identifiants(filtres.object_id);
  if (modeles.length > 0) {
    morceaux.push(`sf.object_id IN (${modeles.map(() => '?').join(',')})`);
    params.push(...modeles);
  }

  // La catégorie d'un matériel est sa catégorie directe **ou** celle de sa
  // sous-catégorie : filtrer sur la seule colonne directe raterait tout ce qui
  // est rangé dans une sous-catégorie, c'est-à-dire l'essentiel d'un parc classé.
  const categorie = identifiants(filtres.category_id);
  if (categorie.length > 0) {
    morceaux.push(`COALESCE(o.category_id, (
      SELECT sc.category_id FROM subcategories sc WHERE sc.id = o.subcategory_id
    )) IN (${categorie.map(() => '?').join(',')})`);
    params.push(...categorie);
  }

  const sousCategorie = identifiants(filtres.subcategory_id);
  if (sousCategorie.length > 0) {
    morceaux.push(`o.subcategory_id IN (${sousCategorie.map(() => '?').join(',')})`);
    params.push(...sousCategorie);
  }

  const etats = termes(ETATS, filtres.condition_state);
  if (etats.length > 0) {
    morceaux.push(`sf.condition_state IN (${etats.map(() => '?').join(',')})`);
    params.push(...etats);
  }

  // Rue et secteur sont comparés en `LIKE` et non en égalité : « rue de la
  // Gare » et « Rue de la gare » sont la même rue, et personne ne tape deux
  // fois de suite la même casse.
  const rue = typeof filtres.street === 'string' ? filtres.street.trim() : '';
  if (rue) {
    morceaux.push('sf.street LIKE ?');
    params.push(`%${rue}%`);
  }

  const secteur = typeof filtres.sector === 'string' ? filtres.sector.trim() : '';
  if (secteur) {
    morceaux.push('sf.sector LIKE ?');
    params.push(`%${secteur}%`);
  }

  const emprise = lireEmprise(filtres.bbox);
  if (emprise) {
    morceaux.push('sf.latitude BETWEEN ? AND ? AND sf.longitude BETWEEN ? AND ?');
    params.push(emprise.minLat, emprise.maxLat, emprise.minLng, emprise.maxLng);
  }

  const poseDu = dateOuRien(filtres.pose_du);
  if (poseDu) {
    morceaux.push('sf.installed_on >= ?');
    params.push(poseDu);
  }

  const poseAu = dateOuRien(filtres.pose_au);
  if (poseAu) {
    morceaux.push('sf.installed_on <= ?');
    params.push(poseAu);
  }

  if (vraiDansUrl(filtres.en_retard)) {
    morceaux.push(`sf.next_intervention_date IS NOT NULL AND sf.next_intervention_date < ?`);
    params.push(aujourdhui());
  }

  const avant = dateOuRien(filtres.echeance_avant);
  if (avant) {
    morceaux.push('sf.next_intervention_date IS NOT NULL AND sf.next_intervention_date <= ?');
    params.push(avant);
  }

  if (vraiDansUrl(filtres.jamais_entretenu)) {
    morceaux.push('sf.last_intervention_date IS NULL');
  }

  if (morceaux.length === 0) return { sql: '', params: [] };
  return { sql: ` AND ${morceaux.join(' AND ')}`, params };
}

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
