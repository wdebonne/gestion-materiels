import { db } from '../database';
import { filtreObjets, filtreObjetsLies } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';
import { cadrageEnregistre, positionGeographique } from './captureCarte.service';
import {
  aujourdhui,
  distanceMetres,
  ETATS,
  lireEmprise,
  lirePosition,
  STATUTS,
  type Terme,
} from './mobilierUrbain.service';

/**
 * Toutes les implantations du parc, d'où qu'elles viennent.
 *
 * Un banc est un banc. Scellé sur un trottoir il vit dans `street_furniture` ;
 * posé dans un parc il vit dans `green_space_elements` — deux tables, deux
 * modules, deux écrans. Or la question qu'on se pose ne connaît pas cette
 * frontière : « où sont mes bancs, lesquels sont à repeindre » ne veut pas dire
 * « où sont mes bancs de trottoir ». Obliger à chercher deux fois, c'est
 * garantir qu'on cherchera une fois et qu'on conclura faux.
 *
 * Ce service **lit** les deux et n'en fait qu'une liste. Il n'écrit rien : un
 * arbre d'espace vert se modifie dans sa fiche d'espace vert, où l'on voit ses
 * voisins, son plan, ses coûts et ses saisons. La carte y renvoie. Fusionner
 * aussi l'écriture aurait demandé de fondre deux modèles que tout sépare —
 * l'un porte des surfaces, des saisons et des coûts figés, l'autre une rue et
 * un numéro d'inventaire — pour un bénéfice nul : on ne veut pas *saisir* au
 * même endroit, on veut *trouver* au même endroit.
 *
 * **Le filtrage se fait en mémoire, pas en SQL.** Deux requêtes SQL portant les
 * mêmes quinze critères sur deux schémas différents divergeraient au premier
 * critère ajouté, et la carte ne dirait plus la même chose que l'export. La
 * portée du compte, elle, reste en SQL : c'est du contrôle d'accès, il ne se
 * délègue pas à un filtre d'affichage. À l'échelle d'une commune — quelques
 * milliers de lignes — normaliser puis filtrer coûte quelques millisecondes.
 */

export type SourceImplantation = 'voirie' | 'espace_vert';

/** À quel point on sait où se trouve une implantation. */
export type PrecisionPosition =
  /** Relevée au GPS ou pointée sur la carte : le point est le bon. */
  | 'exacte'
  /** Calculée depuis le plan capturé de son espace vert : le point est le bon. */
  | 'plan'
  /** Repliée sur la position de l'espace vert : « quelque part dans ce parc ». */
  | 'espace'
  /** Ni l'un ni l'autre : la ligne existe, la carte ne peut pas la montrer. */
  | 'inconnue';

export interface Implantation {
  /** Clé unique tous gisements confondus : `voirie-12`, `espace_vert-45`. */
  cle: string;
  source: SourceImplantation;
  id: number;
  object_id: number | null;
  /** Le rang dans son modèle. Nul côté espaces verts, qui ne numérote pas. */
  numero: number | null;
  label: string;
  code: string;
  quantity: number;
  latitude: number | null;
  longitude: number | null;
  precision_position: PrecisionPosition;
  address: string;
  street: string;
  sector: string;
  /** Où c'est posé, en toutes lettres : « Voie publique » ou le nom du parc. */
  lieu: string;
  /** L'espace vert d'accueil, pour le lien qui y renvoie. */
  green_space_id: number | null;
  /** Le contenant : une jardinière de trottoir, un massif d'espace vert. */
  contenant: string;
  status: string;
  condition_state: string;
  installed_on: string | null;
  last_intervention_date: string | null;
  next_intervention_date: string | null;
  notes: string;
  image: string;
  object_name: string | null;
  object_reference: string | null;
  category_id: number | null;
  category_name: string | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  /** Rendu par le seul filtre « autour de moi ». */
  distance_m?: number;
  /** Rendu par l'export qui les demande. */
  interventions?: any[];
}

/** Le libellé des deux gisements, pour que l'écran n'ait pas à les inventer. */
export const SOURCES: readonly Terme[] = [
  { valeur: 'voirie', libelle: 'Voie publique' },
  { valeur: 'espace_vert', libelle: 'Espaces verts' },
];

// -------------------------------------------------------------------- filtres

export interface FiltresImplantations {
  q?: string;
  source?: string;
  category_id?: string;
  subcategory_id?: string;
  object_id?: string;
  green_space_id?: string;
  status?: string;
  condition_state?: string;
  street?: string;
  sector?: string;
  bbox?: string;
  pose_du?: string;
  pose_au?: string;
  en_retard?: string;
  echeance_avant?: string;
  jamais_entretenu?: string;
  avec_deposes?: string;
  lat?: string;
  lng?: string;
  rayon?: string;
  limit?: string;
}

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

/** Les dix premiers caractères d'une date, quelle que soit sa forme en base. */
const jourDe = (valeur: unknown): string | null =>
  valeur ? String(valeur).slice(0, 10) : null;

/**
 * Cette implantation répond-elle aux critères ?
 *
 * **La seule** définition de ce que veulent dire les filtres. La carte, la
 * liste et l'export l'appellent tous les trois ; c'est ce qui garantit qu'un
 * document imprimé contient exactement ce que l'écran montrait.
 */
export function correspond(ligne: Implantation, filtres: FiltresImplantations): boolean {
  const sources = termes(SOURCES, filtres.source);
  if (sources.length > 0 && !sources.includes(ligne.source)) return false;

  // Un exemplaire déposé n'est pas supprimé, mais il n'encombre pas la carte
  // tant qu'on ne le demande pas.
  const statuts = termes(STATUTS, filtres.status);
  if (statuts.length > 0) {
    if (!statuts.includes(ligne.status)) return false;
  } else if (!vraiDansUrl(filtres.avec_deposes) && ligne.status === 'depose') {
    return false;
  }

  const terme = typeof filtres.q === 'string' ? filtres.q.trim().toLowerCase() : '';
  if (terme) {
    // La recherche traverse l'implantation **et** son modèle : on cherche
    // « candélabre » sans savoir si le mot a été recopié sur chaque point.
    const foin = [
      ligne.label,
      ligne.code,
      ligne.address,
      ligne.street,
      ligne.sector,
      ligne.notes,
      ligne.lieu,
      ligne.contenant,
      ligne.object_name,
      ligne.object_reference,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!foin.includes(terme)) return false;
  }

  const modeles = identifiants(filtres.object_id);
  if (modeles.length > 0 && (ligne.object_id === null || !modeles.includes(ligne.object_id))) {
    return false;
  }

  const categories = identifiants(filtres.category_id);
  if (categories.length > 0 && (ligne.category_id === null || !categories.includes(ligne.category_id))) {
    return false;
  }

  const sousCategories = identifiants(filtres.subcategory_id);
  if (
    sousCategories.length > 0 &&
    (ligne.subcategory_id === null || !sousCategories.includes(ligne.subcategory_id))
  ) {
    return false;
  }

  const espaces = identifiants(filtres.green_space_id);
  if (espaces.length > 0 && (ligne.green_space_id === null || !espaces.includes(ligne.green_space_id))) {
    return false;
  }

  const etats = termes(ETATS, filtres.condition_state);
  if (etats.length > 0 && !etats.includes(ligne.condition_state)) return false;

  // Rue et secteur se comparent sans casse ni accent : « rue de la Gare » et
  // « Rue de la gare » sont la même rue, et personne ne tape deux fois de suite
  // la même casse.
  const rue = typeof filtres.street === 'string' ? filtres.street.trim() : '';
  if (rue && !sansAccent(ligne.street).includes(sansAccent(rue))) return false;

  const secteur = typeof filtres.sector === 'string' ? filtres.sector.trim() : '';
  if (secteur && !sansAccent(ligne.sector).includes(sansAccent(secteur))) return false;

  const emprise = lireEmprise(filtres.bbox);
  if (emprise) {
    if (ligne.latitude === null || ligne.longitude === null) return false;
    if (ligne.latitude < emprise.minLat || ligne.latitude > emprise.maxLat) return false;
    if (ligne.longitude < emprise.minLng || ligne.longitude > emprise.maxLng) return false;
  }

  const pose = jourDe(ligne.installed_on);
  const poseDu = dateOuRien(filtres.pose_du);
  if (poseDu && (!pose || pose < poseDu)) return false;
  const poseAu = dateOuRien(filtres.pose_au);
  if (poseAu && (!pose || pose > poseAu)) return false;

  const echeance = jourDe(ligne.next_intervention_date);
  if (vraiDansUrl(filtres.en_retard) && (!echeance || echeance >= aujourdhui())) return false;

  const avant = dateOuRien(filtres.echeance_avant);
  if (avant && (!echeance || echeance > avant)) return false;

  if (vraiDansUrl(filtres.jamais_entretenu) && ligne.last_intervention_date) return false;

  return true;
}

/**
 * Minuscules sans accents, pour comparer des noms de rue tapés par des humains.
 *
 * `localeCompare` comparerait, mais ne sait pas dire « contient ». La
 * décomposition Unicode sépare la lettre de son accent, qu'on jette ensuite.
 */
const sansAccent = (texte: string | null | undefined): string =>
  (texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// ------------------------------------------------------------------ lecture

/**
 * Les implantations visibles par ce compte, normalisées, filtrées.
 *
 * Rend `null` si le compte n'a accès à aucune catégorie — le refus est alors
 * l'affaire de la route, qui sait quel code HTTP lui correspond.
 */
export async function lireImplantations(
  req: AuthRequest,
  filtres: FiltresImplantations
): Promise<Implantation[] | null> {
  const sources = termes(SOURCES, filtres.source);
  const veut = (source: SourceImplantation) => sources.length === 0 || sources.includes(source);

  const morceaux: Implantation[] = [];

  if (veut('voirie')) {
    const lignes = await lireVoirie(req);
    if (lignes === null) return null;
    morceaux.push(...lignes);
  }

  if (veut('espace_vert')) {
    const lignes = await lireEspacesVerts(req);
    if (lignes === null) return null;
    morceaux.push(...lignes);
  }

  let retenues = morceaux.filter((ligne) => correspond(ligne, filtres));

  // « Autour de moi » se termine ici plutôt qu'en SQL : le filtre est un
  // cercle, et un rectangle laisse passer les coins. La distance est rendue
  // avec la ligne — sur le terrain, « à 40 m » vaut mieux que la seule présence.
  const centre = lirePosition(filtres.lat, filtres.lng);
  const rayon = Number(filtres.rayon);
  if (centre && Number.isFinite(rayon) && rayon > 0) {
    retenues = retenues
      .map((ligne) => ({
        ...ligne,
        distance_m:
          ligne.latitude === null || ligne.longitude === null
            ? Number.POSITIVE_INFINITY
            : Math.round(
                distanceMetres(centre, { latitude: ligne.latitude, longitude: ligne.longitude })
              ),
      }))
      .filter((ligne) => (ligne.distance_m ?? Infinity) <= rayon)
      .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
  } else {
    retenues.sort(
      (a, b) =>
        String(a.object_name ?? a.label).localeCompare(String(b.object_name ?? b.label), 'fr') ||
        (a.numero ?? 0) - (b.numero ?? 0) ||
        a.label.localeCompare(b.label, 'fr')
    );
  }

  const limite = Math.min(Math.max(1, Number(filtres.limit ?? 3000)), 20000);
  return retenues.slice(0, limite);
}

/** Le mobilier de voie publique, normalisé. */
async function lireVoirie(req: AuthRequest): Promise<Implantation[] | null> {
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  const lignes = await db.query(
    `SELECT sf.*, o.name as object_name, o.reference as object_reference,
            COALESCE(o.category_id, psc.category_id) as category_id,
            pc.name as category_name,
            o.subcategory_id as subcategory_id, psc.name as subcategory_name,
            parent.label as contenant
     FROM street_furniture sf
     LEFT JOIN objects o ON o.id = sf.object_id
     LEFT JOIN subcategories psc ON psc.id = o.subcategory_id
     LEFT JOIN categories pc ON pc.id = COALESCE(o.category_id, psc.category_id)
     LEFT JOIN street_furniture parent ON parent.id = sf.parent_id
     WHERE 1=1${portee.sql}`,
    portee.params
  );

  return lignes.map(
    (l: any): Implantation => ({
      cle: `voirie-${l.id}`,
      source: 'voirie',
      id: Number(l.id),
      object_id: l.object_id === null ? null : Number(l.object_id),
      numero: l.numero === null ? null : Number(l.numero),
      label: l.label ?? '',
      code: l.code ?? '',
      quantity: Number(l.quantity ?? 1) || 1,
      latitude: nombreOuNul(l.latitude),
      longitude: nombreOuNul(l.longitude),
      precision_position: 'exacte',
      address: l.address ?? '',
      street: l.street ?? '',
      sector: l.sector ?? '',
      lieu: 'Voie publique',
      green_space_id: null,
      contenant: l.contenant ?? '',
      status: l.status ?? 'en_service',
      condition_state: l.condition_state ?? 'bon',
      installed_on: l.installed_on ?? null,
      last_intervention_date: l.last_intervention_date ?? null,
      next_intervention_date: l.next_intervention_date ?? null,
      notes: l.notes ?? '',
      image: l.image ?? '',
      object_name: l.object_name ?? null,
      object_reference: l.object_reference ?? null,
      category_id: l.category_id === null ? null : Number(l.category_id),
      category_name: l.category_name ?? null,
      subcategory_id: l.subcategory_id === null ? null : Number(l.subcategory_id),
      subcategory_name: l.subcategory_name ?? null,
    })
  );
}

/**
 * Les éléments d'espaces verts, normalisés — et surtout **géolocalisés**.
 *
 * Un élément de plan ne connaît que des pourcentages d'image. Le cadrage
 * mémorisé à la capture (`plan_capture`) dit à quel morceau de globe ces
 * pourcentages correspondent : c'est lui qui permet à un arbre posé sur le plan
 * d'un parc d'apparaître au bon endroit sur la carte de la commune.
 *
 * Quatre cas, du plus précis au moins précis, et l'écran doit pouvoir les
 * distinguer — afficher « quelque part dans ce parc » comme une position exacte
 * serait un mensonge à l'échelle de cent mètres.
 */
async function lireEspacesVerts(req: AuthRequest): Promise<Implantation[] | null> {
  // `filtreObjetsLies` et non `filtreObjets` : un élément d'espace vert peut
  // n'être rattaché à aucun matériel du parc — un arbre existant, saisi à la
  // main. Le filtrer par la catégorie d'un matériel absent le ferait
  // disparaître, alors qu'il n'a rien à cacher.
  const portee = await filtreObjetsLies(req, 'o', 'gse.object_id');
  if (portee === null) return null;

  const lignes = await db.query(
    `SELECT gse.*,
            gs.id as espace_id, gs.name as espace_nom, gs.address as espace_adresse,
            gs.latitude as espace_lat, gs.longitude as espace_lng, gs.plan_capture,
            o.name as object_name, o.reference as object_reference,
            COALESCE(o.category_id, psc.category_id) as category_id,
            pc.name as category_name,
            o.subcategory_id as subcategory_id, psc.name as subcategory_name,
            grp.name as contenant
     FROM green_space_elements gse
     JOIN green_spaces gs ON gs.id = gse.green_space_id
     LEFT JOIN objects o ON o.id = gse.object_id
     LEFT JOIN subcategories psc ON psc.id = o.subcategory_id
     LEFT JOIN categories pc ON pc.id = COALESCE(o.category_id, psc.category_id)
     LEFT JOIN green_space_groups grp ON grp.id = gse.group_id
     WHERE 1=1${portee.sql}`,
    portee.params
  );

  // Le cadrage se relit une fois par espace vert et non une fois par élément :
  // un parc de trois cents arbres ferait trois cents analyses du même JSON.
  const cadrages = new Map<number, ReturnType<typeof cadrageEnregistre>>();

  return lignes.map((l: any): Implantation => {
    const espaceId = Number(l.espace_id);
    if (!cadrages.has(espaceId)) cadrages.set(espaceId, cadrageEnregistre(l.plan_capture));
    const cadrage = cadrages.get(espaceId) ?? null;

    const situation = situer(l, cadrage);

    return {
      cle: `espace_vert-${l.id}`,
      source: 'espace_vert',
      id: Number(l.id),
      object_id: l.object_id === null ? null : Number(l.object_id),
      // Les espaces verts ne numérotent pas leurs éléments : chaque ligne y est
      // déjà nommée à la main, et inventer un rang ici le ferait diverger de ce
      // que la fiche de l'espace affiche.
      numero: null,
      label: l.label ?? '',
      code: l.code ?? '',
      quantity: Number(l.quantity ?? 1) || 1,
      latitude: situation.lat,
      longitude: situation.lng,
      precision_position: situation.precision,
      address: l.espace_adresse ?? '',
      // Un élément d'espace vert n'a pas de rue : il a un parc. Lui en inventer
      // une le ferait apparaître dans une tournée de voirie où il n'a rien à
      // faire.
      street: '',
      sector: '',
      lieu: l.espace_nom ?? 'Espace vert',
      green_space_id: espaceId,
      contenant: l.contenant ?? '',
      // Le module n'a pas de notion de statut : ce qui est planté est en place.
      // « À remplacer » se dit par l'état, que les deux modules partagent.
      status: 'en_service',
      condition_state: l.condition_state ?? 'bon',
      installed_on: l.planting_date ?? null,
      last_intervention_date: l.last_maintenance_date ?? null,
      next_intervention_date: l.next_maintenance_date ?? null,
      notes: l.maintenance_notes ?? l.description ?? '',
      image: l.image ?? '',
      object_name: l.object_name ?? null,
      object_reference: l.object_reference ?? null,
      category_id: l.category_id === null ? null : Number(l.category_id),
      category_name: l.category_name ?? null,
      subcategory_id: l.subcategory_id === null ? null : Number(l.subcategory_id),
      subcategory_name: l.subcategory_name ?? null,
    };
  });
}

/** Où poser cet élément d'espace vert sur la carte de la commune, et à quel titre. */
function situer(
  ligne: any,
  cadrage: ReturnType<typeof cadrageEnregistre>
): { lat: number | null; lng: number | null; precision: PrecisionPosition } {
  // 1. Un relevé de terrain l'emporte sur tout : un agent est allé voir.
  const relevee = lirePosition(ligne.latitude, ligne.longitude);
  if (relevee) {
    return { lat: relevee.latitude, lng: relevee.longitude, precision: 'exacte' };
  }

  // 2. Le plan capturé est géoréférencé : le pourcentage redevient un point.
  if (cadrage) {
    const point = pointDuPlan(ligne);
    if (point) {
      const position = positionGeographique(point, cadrage);
      return { lat: position.lat, lng: position.lng, precision: 'plan' };
    }
  }

  // 3. À défaut, l'espace vert lui-même : « quelque part dans ce parc ».
  const espace = lirePosition(ligne.espace_lat, ligne.espace_lng);
  if (espace) {
    return { lat: espace.latitude, lng: espace.longitude, precision: 'espace' };
  }

  // 4. Rien. La ligne existe et se liste, la carte ne peut pas la montrer.
  return { lat: null, lng: null, precision: 'inconnue' };
}

/**
 * Le point du plan qu'occupe un élément : son repère, ou le centre de sa zone.
 *
 * Une pelouse tracée n'a pas de repère posé — elle a un contour. L'oublier
 * ferait disparaître de la carte tout ce qui est dessiné plutôt que pointé,
 * c'est-à-dire les surfaces, qui sont l'essentiel d'un parc.
 */
function pointDuPlan(ligne: any): { x: number; y: number } | null {
  const x = Number(ligne.pos_x);
  const y = Number(ligne.pos_y);
  if (ligne.pos_x !== null && ligne.pos_y !== null && Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }

  try {
    const sommets = typeof ligne.zone_points === 'string'
      ? JSON.parse(ligne.zone_points || 'null')
      : ligne.zone_points;
    if (!Array.isArray(sommets) || sommets.length === 0) return null;
    const valides = sommets
      .map((s: any) => ({ x: Number(s?.x), y: Number(s?.y) }))
      .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
    if (valides.length === 0) return null;
    // La moyenne des sommets, et non le centre de la boîte englobante : sur une
    // forme en L, la boîte tombe en dehors de la zone.
    return {
      x: valides.reduce((somme, s) => somme + s.x, 0) / valides.length,
      y: valides.reduce((somme, s) => somme + s.y, 0) / valides.length,
    };
  } catch {
    return null;
  }
}

/** Un nombre, ou `null` — jamais `NaN`, qui traverserait le JSON en `null` sans le dire. */
function nombreOuNul(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------- historiques

/**
 * Ce qui a été fait sur ces implantations, des deux côtés.
 *
 * Côté voirie, les interventions sont portées par l'exemplaire. Côté espaces
 * verts, ce sont les entretiens de l'espace **rattachés à cet élément** — le
 * module les organise par chantier et non par sujet, mais la question « qu'a-t-on
 * fait sur cet arbre ? » a bien une réponse, et c'est celle-là.
 */
export async function historiques(lignes: Implantation[]): Promise<void> {
  const voirie = lignes.filter((l) => l.source === 'voirie').map((l) => l.id);
  const elements = lignes.filter((l) => l.source === 'espace_vert').map((l) => l.id);

  const parCle = new Map<string, any[]>();

  if (voirie.length > 0) {
    const interventions = await db.query(
      `SELECT i.*, CONCAT_WS(' ', u.first_name, u.last_name) as auteur
       FROM street_furniture_interventions i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.item_id IN (${voirie.map(() => '?').join(',')})
       ORDER BY i.performed_on DESC, i.id DESC`,
      voirie
    );
    for (const intervention of interventions) {
      const cle = `voirie-${intervention.item_id}`;
      if (!parCle.has(cle)) parCle.set(cle, []);
      parCle.get(cle)!.push(intervention);
    }
  }

  if (elements.length > 0) {
    const entretiens = await db.query(
      `SELECT gme.element_id, gm.id, gm.maintenance_type as intervention_type,
              gm.performed_date as performed_on, gm.next_maintenance_date as next_date,
              -- NULLIF avant COALESCE : le titre d'un entretien vaut la chaîne
              -- vide et non NULL quand il n'a pas été rempli, et COALESCE
              -- retenait donc ce vide plutôt que la description. L'historique
              -- affichait une ligne sans texte.
              COALESCE(NULLIF(gm.title, ''), gm.description) as description,
              gm.cost, gm.performed_by
       FROM green_space_maintenance_elements gme
       JOIN green_space_maintenances gm ON gm.id = gme.maintenance_id
       WHERE gme.element_id IN (${elements.map(() => '?').join(',')})
       ORDER BY gm.performed_date DESC, gm.id DESC`,
      elements
    );
    for (const entretien of entretiens) {
      const cle = `espace_vert-${entretien.element_id}`;
      if (!parCle.has(cle)) parCle.set(cle, []);
      parCle.get(cle)!.push(entretien);
    }
  }

  for (const ligne of lignes) {
    ligne.interventions = parCle.get(ligne.cle) ?? [];
  }
}
