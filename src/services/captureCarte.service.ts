import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { PointPlan } from './geometriePlan.service';

/**
 * Fabriquer le plan d'un espace vert depuis une carte en ligne.
 *
 * Jusqu'ici, avoir un plan annoté supposait d'obtenir une image par un autre
 * chemin — une capture d'écran recadrée à la main, un PDF du géomètre — puis de
 * la calibrer en traçant un segment sur une longueur qu'on croit connaître. Les
 * deux étapes se passent mal : la capture d'écran arrive déformée, et le
 * calibrage manuel dépend de la main qui clique. Une erreur de 5 % sur le
 * segment devient 10 % sur toutes les surfaces, donc sur tous les coûts.
 *
 * Une carte, elle, sait exactement ce qu'elle représente. En projection Web
 * Mercator — celle d'OpenStreetMap comme celle des tuiles IGN — la taille d'un
 * pixel ne dépend que du niveau de zoom et de la latitude :
 *
 *     mètres par pixel = 156 543,034 × cos(latitude) / 2^zoom
 *
 * L'échelle est donc **calculée**, jamais relevée : le plan sort calibré, et
 * l'écran de calibrage ne sert plus que si quelqu'un veut le corriger.
 *
 * L'assemblage est fait ici et non dans le navigateur. Composer des tuiles dans
 * un `<canvas>` depuis une page web « souille » le canvas dès qu'une tuile vient
 * d'un autre domaine, et l'image ne peut plus être relue. Le serveur n'a pas
 * cette limite, peut garder les tuiles en cache pour ne pas les redemander, et
 * grave l'attribution dans l'image — ce que les deux fournisseurs exigent.
 */

// ------------------------------------------------------------ fonds de carte

export type CleFond = 'photo' | 'plan-ign' | 'osm';

export interface FondCarte {
  cle: CleFond;
  libelle: string;
  description: string;
  /** Modèle d'URL de tuile, au format Leaflet : `{z}`, `{x}`, `{y}`. */
  modele: string;
  attribution: string;
  zoomMax: number;
  /** Format renvoyé par le fournisseur, pour ne pas se tromper de décodeur. */
  format: 'png' | 'jpeg';
}

/**
 * Les trois fonds proposés, dans l'ordre où ils servent.
 *
 * La photo aérienne d'abord : sur un parc, c'est la seule qui montre les allées,
 * les massifs et les arbres. Les cartes dessinées ne montrent qu'un aplat vert,
 * sur lequel il n'y a rien à repérer.
 *
 * Aucune ne demande de clé ni de compte. Les tuiles IGN sont diffusées par la
 * Géoplateforme sous licence ouverte ; OpenStreetMap sous ODbL. Les deux
 * imposent de citer la source, ce dont `graverAttribution` se charge.
 */
export const FONDS: FondCarte[] = [
  {
    cle: 'photo',
    libelle: 'Photo aérienne',
    description: 'Vue du ciel : allées, massifs et arbres visibles. Le meilleur fond pour un parc.',
    modele: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    attribution: 'Photographies aériennes © IGN — Géoplateforme',
    zoomMax: 19,
    format: 'jpeg',
  },
  {
    cle: 'plan-ign',
    libelle: 'Plan IGN',
    description: 'Carte dessinée officielle : bâtiments, voirie et limites de parcelles.',
    modele: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    attribution: 'Plan IGN v2 © IGN — Géoplateforme',
    zoomMax: 19,
    format: 'png',
  },
  {
    cle: 'osm',
    libelle: 'OpenStreetMap',
    description: 'La carte déjà utilisée ailleurs dans l’application. Lisible, mais pauvre à l’échelle d’un massif.',
    modele: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© les contributeurs OpenStreetMap',
    zoomMax: 19,
    format: 'png',
  },
];

export function fond(cle: string): FondCarte | null {
  return FONDS.find((f) => f.cle === cle) ?? null;
}

// ------------------------------------------------------------------- limites

const TAILLE_TUILE = 256;

/** Résolution de Web Mercator à l'équateur, au zoom 0, en mètres par pixel. */
const RESOLUTION_EQUATEUR = 156543.03392804097;

/** En deçà, le parc tient dans une tuile et le plan ne montre plus rien. */
const ZOOM_MIN = 12;

/**
 * Bornes de l'image produite.
 *
 * Le garde-fou qui compte est `TUILES_MAX`, et non les dimensions : ce qu'il
 * faut retenir, c'est le nombre de tuiles téléchargées d'un coup. La politique
 * d'usage d'OpenStreetMap tolère l'usage occasionnel et refuse le moissonnage ;
 * une capture de parc en demande une soixantaine, au-delà c'est qu'on cadre une
 * commune entière, ce qui n'est pas l'objet de cet écran.
 *
 * `COTE_MAX` ne sert qu'à refuser une image absurde à afficher. Il a d'abord
 * été fixé à 2400, ce qui refusait une capture ordinaire : sur un écran large,
 * le doublement de finesse demande près de 2800 pixels pour une vingtaine de
 * tuiles seulement. Le plafond punissait la netteté sans rien protéger.
 */
const LARGEUR_MIN = 320;
const COTE_MAX = 4096;
const TUILES_MAX = 90;

/**
 * Ce que le client doit savoir pour ne pas demander l'impossible.
 *
 * Publié plutôt que recopié dans le navigateur : deux listes de limites
 * divergent toujours, et la divergence se manifeste par un refus que
 * l'utilisateur ne peut pas comprendre — « Utiliser cette vue » qui échoue
 * simplement parce que l'écran est large.
 */
export const LIMITES = {
  coteMin: LARGEUR_MIN,
  coteMax: COTE_MAX,
  tuilesMax: TUILES_MAX,
  zoomMin: ZOOM_MIN,
  tailleTuile: TAILLE_TUILE,
};

/** Un fournisseur qui ne répond pas ne doit pas retenir la requête. */
const DELAI_TUILE_MS = 12_000;

/** Quatre à la fois : assez pour que ce soit rapide, assez peu pour rester poli. */
const TUILES_SIMULTANEES = 4;

/**
 * Identité annoncée aux fournisseurs de tuiles.
 *
 * Un `User-Agent` générique se fait bloquer par OpenStreetMap, et à juste
 * titre : sans lui, impossible de savoir qui télécharge ni de prévenir avant de
 * couper.
 */
const AGENT = 'gestion-materiels/1.3 (plan des espaces verts)';

export const REFUS_CADRAGE =
  'Le cadrage demandé sort des limites : vérifiez la position, le zoom et la taille du plan';

export const REFUS_FOND = 'Fond de carte inconnu';

// ---------------------------------------------------------- Web Mercator

/** Abscisse du point, en pixels du monde entier à ce niveau de zoom. */
function pixelX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TAILLE_TUILE * 2 ** zoom;
}

/** Ordonnée du point, en pixels du monde entier à ce niveau de zoom. */
function pixelY(lat: number, zoom: number): number {
  const phi = (lat * Math.PI) / 180;
  const y = Math.log(Math.tan(phi) + 1 / Math.cos(phi));
  return (1 - y / Math.PI) / 2 * TAILLE_TUILE * 2 ** zoom;
}

/** Taille réelle d'un pixel, à cette latitude et à ce zoom. */
export function metresParPixel(lat: number, zoom: number): number {
  return (RESOLUTION_EQUATEUR * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

// ------------------------------------------------------------------ cadrage

export interface Cadrage {
  lat: number;
  lng: number;
  zoom: number;
  largeur: number;
  hauteur: number;
}

/** Le cadrage relu et borné, ou `null` s'il ne veut rien dire. */
export function lireCadrage(brut: any): Cadrage | null {
  const lat = Number(brut?.lat);
  const lng = Number(brut?.lng);
  const zoom = Math.round(Number(brut?.zoom));
  const largeur = Math.round(Number(brut?.largeur));
  const hauteur = Math.round(Number(brut?.hauteur));

  if (!Number.isFinite(lat) || lat < -85 || lat > 85) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (!Number.isFinite(zoom) || zoom < ZOOM_MIN || zoom > 22) return null;
  if (!Number.isFinite(largeur) || largeur < LARGEUR_MIN || largeur > COTE_MAX) return null;
  if (!Number.isFinite(hauteur) || hauteur < LARGEUR_MIN || hauteur > COTE_MAX) return null;

  // Le nombre de tuiles se compte après bornage : c'est lui, et non les
  // dimensions seules, qui dit ce qu'on va demander au fournisseur.
  const tuiles = (Math.ceil(largeur / TAILLE_TUILE) + 1) * (Math.ceil(hauteur / TAILLE_TUILE) + 1);
  if (tuiles > TUILES_MAX) return null;

  return { lat, lng, zoom, largeur, hauteur };
}

/**
 * Le rectangle capturé, exprimé en pixels du monde.
 *
 * Tout le reste — quelles tuiles chercher, où retomber un point GPS sur le
 * plan — se déduit de ces quatre nombres.
 */
interface Fenetre {
  gauche: number;
  haut: number;
  largeur: number;
  hauteur: number;
  zoom: number;
}

function fenetreDe(cadrage: Cadrage): Fenetre {
  return {
    gauche: pixelX(cadrage.lng, cadrage.zoom) - cadrage.largeur / 2,
    haut: pixelY(cadrage.lat, cadrage.zoom) - cadrage.hauteur / 2,
    largeur: cadrage.largeur,
    hauteur: cadrage.hauteur,
    zoom: cadrage.zoom,
  };
}

// ------------------------------------------------------------ cache de tuiles

/**
 * Délibérément **hors** de `uploads/` : les sauvegardes archivent ce dossier en
 * entier, et le cache s'y serait retrouvé dans chaque archive — des dizaines de
 * mégaoctets de poids mort, puisqu'une tuile se retélécharge et que la restaurer
 * n'a aucun intérêt. Il est aussi hors de `data/`, qui porte la base.
 *
 * Le chemin se règle par `TILE_CACHE_DIR` pour les déploiements où le dossier
 * de l'application n'est pas inscriptible.
 */
const DOSSIER_CACHE =
  process.env.TILE_CACHE_DIR || path.join(__dirname, '../../.cache/tuiles');

/**
 * Un fond de carte bouge peu ; un mois évite de redemander la même tuile.
 *
 * Une tuile périmée est réécrite par la suivante, jamais dupliquée : le dossier
 * est donc borné par le nombre de tuiles distinctes déjà demandées, pas par le
 * temps. Une commune qui capture une cinquantaine de parcs y laisse quelques
 * dizaines de mégaoctets, et le supprimer est sans conséquence.
 */
const DUREE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

function cheminCache(cle: CleFond, z: number, x: number, y: number): string {
  return path.join(DOSSIER_CACHE, `${cle}-${z}-${x}-${y}`);
}

function lireCache(chemin: string): Buffer | null {
  try {
    const info = fs.statSync(chemin);
    if (Date.now() - info.mtimeMs > DUREE_CACHE_MS) return null;
    return fs.readFileSync(chemin);
  } catch {
    return null;
  }
}

function ecrireCache(chemin: string, contenu: Buffer): void {
  try {
    fs.mkdirSync(DOSSIER_CACHE, { recursive: true });
    fs.writeFileSync(chemin, contenu);
  } catch {
    // Un cache qui n'écrit pas ne doit pas faire échouer une capture.
  }
}

/**
 * Une tuile, du cache ou du réseau.
 *
 * `null` quand le fournisseur ne l'a pas : au bord d'un jeu de photos aériennes,
 * ou au-delà du zoom couvert localement. C'est un trou dans l'image, pas une
 * erreur — la capture continue et le manque se voit.
 */
async function tuile(f: FondCarte, z: number, x: number, y: number): Promise<Buffer | null> {
  const chemin = cheminCache(f.cle, z, x, y);
  const enCache = lireCache(chemin);
  if (enCache) return enCache;

  const url = f.modele
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  try {
    const reponse = await fetch(url, {
      headers: { 'User-Agent': AGENT, Accept: `image/${f.format},image/*` },
      signal: AbortSignal.timeout(DELAI_TUILE_MS),
    });
    if (!reponse.ok) return null;
    const contenu = Buffer.from(await reponse.arrayBuffer());
    // Les deux fournisseurs répondent 200 avec une image d'erreur minuscule
    // quand la dalle n'existe pas : la garder en cache figerait le trou.
    if (contenu.length < 500) return null;
    ecrireCache(chemin, contenu);
    return contenu;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- l'assemblage

export interface PlanCapture {
  /** URL publique de l'image produite, à ranger dans `plan_image`. */
  url: string;
  largeur: number;
  hauteur: number;
  /** Ce que vaut un pourcent de largeur du plan, en mètres. */
  metresParPourcent: number;
  /** Hauteur divisée par largeur, ce dont l'échelle a besoin pour être juste. */
  ratio: number;
  attribution: string;
  /** Largeur réelle de ce qui est représenté, pour le dire à l'utilisateur. */
  largeurMetres: number;
  /** Nombre de tuiles que le fournisseur n'a pas fournies. */
  trous: number;
}

/**
 * Assemble les tuiles du cadrage en une image, et en donne l'échelle.
 *
 * `sharp` est chargé à la demande, comme dans `imageNormalize` : le module est
 * natif, et son absence doit donner un message clair plutôt qu'un serveur qui
 * ne démarre pas.
 */
export async function capturer(
  cadrage: Cadrage,
  f: FondCarte,
  dossierUploads: string
): Promise<PlanCapture> {
  let sharp: typeof import('sharp');
  try {
    sharp = require('sharp');
  } catch {
    throw new Error("La capture de plan demande la bibliothèque d'images « sharp », absente de cette installation");
  }

  const vue = fenetreDe(cadrage);
  const monde = 2 ** vue.zoom;

  const xDebut = Math.floor(vue.gauche / TAILLE_TUILE);
  const yDebut = Math.floor(vue.haut / TAILLE_TUILE);
  const xFin = Math.floor((vue.gauche + vue.largeur - 1) / TAILLE_TUILE);
  const yFin = Math.floor((vue.haut + vue.hauteur - 1) / TAILLE_TUILE);

  const demandes: Array<{ x: number; y: number; gauche: number; haut: number }> = [];
  for (let ty = yDebut; ty <= yFin; ty++) {
    // Au-delà des pôles il n'y a pas de tuile : la ligne est simplement vide.
    if (ty < 0 || ty >= monde) continue;
    for (let tx = xDebut; tx <= xFin; tx++) {
      demandes.push({
        // La longitude fait le tour du monde, pas la latitude.
        x: ((tx % monde) + monde) % monde,
        y: ty,
        gauche: tx * TAILLE_TUILE - vue.gauche,
        haut: ty * TAILLE_TUILE - vue.haut,
      });
    }
  }

  const morceaux: Array<{ input: Buffer; left: number; top: number }> = [];
  let trous = 0;

  // Par paquets : tout lancer d'un coup ferait tomber une centaine de requêtes
  // simultanées sur un service public gratuit.
  for (let i = 0; i < demandes.length; i += TUILES_SIMULTANEES) {
    const paquet = demandes.slice(i, i + TUILES_SIMULTANEES);
    const contenus = await Promise.all(paquet.map((d) => tuile(f, vue.zoom, d.x, d.y)));
    contenus.forEach((contenu, j) => {
      if (!contenu) {
        trous++;
        return;
      }
      morceaux.push({ input: contenu, left: Math.round(paquet[j].gauche), top: Math.round(paquet[j].haut) });
    });
  }

  if (morceaux.length === 0) {
    throw new Error(`Aucune tuile n'a pu être téléchargée depuis « ${f.libelle} ». Vérifiez l'accès à Internet du serveur.`);
  }

  // Le fond gris clair reste visible là où une tuile manque : un trou doit se
  // voir sur le plan, pas se déguiser en zone vide.
  const assemble = await sharp({
    create: {
      width: vue.largeur,
      height: vue.hauteur,
      channels: 3,
      background: { r: 233, g: 233, b: 231 },
    },
  })
    .composite(morceaux)
    .jpeg({ quality: 88 })
    .toBuffer();

  const avecAttribution = await graverAttribution(sharp, assemble, vue.largeur, vue.hauteur, f.attribution);

  const nom = `plan-${uuidv4().slice(0, 8)}-${Date.now()}.jpg`;
  fs.mkdirSync(dossierUploads, { recursive: true });
  fs.writeFileSync(path.join(dossierUploads, nom), avecAttribution);

  const mpp = metresParPixel(cadrage.lat, vue.zoom);
  return {
    url: `/uploads/${nom}`,
    largeur: vue.largeur,
    hauteur: vue.hauteur,
    // Un pourcent de largeur, c'est un centième de l'image.
    metresParPourcent: (mpp * vue.largeur) / 100,
    ratio: vue.hauteur / vue.largeur,
    attribution: f.attribution,
    largeurMetres: mpp * vue.largeur,
    trous,
  };
}

/**
 * Écrit la source en bas de l'image.
 *
 * Elle est gravée plutôt qu'affichée à côté : le plan part en PDF, en archive et
 * en pièce jointe de courriel, et l'obligation de citer la source suit l'image,
 * pas l'écran qui la montrait.
 */
async function graverAttribution(
  sharp: typeof import('sharp'),
  image: Buffer,
  largeur: number,
  hauteur: number,
  texte: string
): Promise<Buffer> {
  const hauteurBande = Math.max(18, Math.round(largeur / 55));
  const taillePolice = Math.round(hauteurBande * 0.62);
  const echappe = texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const bande = Buffer.from(
    `<svg width="${largeur}" height="${hauteurBande}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" fill-opacity="0.78"/>
      <text x="${Math.round(hauteurBande * 0.4)}" y="${Math.round(hauteurBande * 0.72)}"
            font-family="DejaVu Sans, Arial, sans-serif" font-size="${taillePolice}" fill="#333333">${echappe}</text>
    </svg>`
  );

  try {
    return await sharp(image)
      .composite([{ input: bande, left: 0, top: hauteur - hauteurBande }])
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    // Sans polices installées, `sharp` ne sait pas rendre le texte. Le plan
    // reste utilisable ; l'attribution est alors portée par l'écran seul.
    return image;
  }
}

// ------------------------------------------------------- contour du parc

export interface ContourPropose {
  /** Nom porté par OpenStreetMap, quand il y en a un. */
  nom: string;
  /** Ce que la donnée dit de l'endroit : « parc », « jardin », « pelouse »… */
  nature: string;
  points: PointPlan[];
  surface_m2: number | null;
  /**
   * Le contour sort du cadre capturé.
   *
   * Il est renvoyé quand même, mais ne doit pas être proposé tel quel : un
   * polygone tronqué donnerait une surface fausse, et une surface fausse
   * devient un coût faux sans que rien ne le signale.
   */
  deborde: boolean;
}

/**
 * Ce que la recherche de contours a donné.
 *
 * Deux échecs se ressemblent et n'appellent pas la même phrase : « aucun parc
 * n'est cartographié ici » invite à tracer soi-même, « le service n'a pas
 * répondu » invite à réessayer dans un instant. Les confondre ferait retracer à
 * la main un contour qui existe — Overpass est un service public partagé, et il
 * lui arrive régulièrement de refuser une requête quand il est chargé.
 */
export type RechercheContours =
  | { etat: 'ok'; contours: ContourPropose[] }
  | { etat: 'indisponible' };

const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Overpass est un service public partagé : au-delà, on renonce sans insister. */
const DELAI_OVERPASS_MS = 20_000;

/** Assez pour un parc détaillé, en deçà du plafond de `geometriePlan`. */
const SOMMETS_MAX = 400;

/** Ce qu'on reconnaît comme « espace vert » dans les données OpenStreetMap. */
const NATURES: Record<string, string> = {
  park: 'parc',
  garden: 'jardin',
  playground: 'aire de jeux',
  pitch: 'terrain de sport',
  common: 'terrain communal',
  grass: 'pelouse',
  recreation_ground: 'terrain de loisirs',
  village_green: 'place engazonnée',
  cemetery: 'cimetière',
  meadow: 'prairie',
  forest: 'bois',
  wood: 'bois',
  scrub: 'broussailles',
  grassland: 'prairie',
};

/**
 * Demande à OpenStreetMap ce qu'il connaît à cet endroit, et le ramène dans les
 * coordonnées du plan.
 *
 * Le contour d'un parc est souvent déjà cartographié, au mètre près et par
 * quelqu'un qui était sur place. Le retracer à la souris donne un polygone
 * moins juste, pour dix minutes de travail. Quand la donnée existe, autant la
 * proposer — quitte à ce qu'elle soit refusée.
 *
 * Ne lève jamais : la capture, elle, a déjà réussi. Un service lent ou en panne
 * rend `indisponible`, une zone sans donnée rend une liste vide — les deux se
 * disent différemment à l'écran.
 */
export async function contoursDuCadre(cadrage: Cadrage): Promise<RechercheContours> {
  const vue = fenetreDe(cadrage);
  const monde = TAILLE_TUILE * 2 ** vue.zoom;

  // La boîte de recherche est celle de l'image, sans marge : ce qu'on ne voit
  // pas ne peut pas être posé sur le plan.
  const sud = latDepuisPixel(Math.min(monde, vue.haut + vue.hauteur), vue.zoom);
  const nord = latDepuisPixel(Math.max(0, vue.haut), vue.zoom);
  const ouest = lngDepuisPixel(vue.gauche, vue.zoom);
  const est = lngDepuisPixel(vue.gauche + vue.largeur, vue.zoom);

  const boite = `${sud.toFixed(6)},${ouest.toFixed(6)},${nord.toFixed(6)},${est.toFixed(6)}`;
  const requete = `[out:json][timeout:18];
(
  way["leisure"~"^(park|garden|playground|pitch|common)$"](${boite});
  way["landuse"~"^(grass|recreation_ground|village_green|cemetery|meadow|forest)$"](${boite});
  way["natural"~"^(wood|scrub|grassland)$"](${boite});
);
out geom;`;

  let elements: any[];
  try {
    const reponse = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': AGENT },
      body: `data=${encodeURIComponent(requete)}`,
      signal: AbortSignal.timeout(DELAI_OVERPASS_MS),
    });
    if (!reponse.ok) {
      console.warn(`Contours OpenStreetMap indisponibles : Overpass a répondu ${reponse.status}`);
      return { etat: 'indisponible' };
    }
    elements = ((await reponse.json()) as any)?.elements ?? [];
  } catch (erreur: any) {
    console.warn('Contours OpenStreetMap indisponibles :', erreur?.message ?? erreur);
    return { etat: 'indisponible' };
  }

  const mpp = metresParPixel(cadrage.lat, vue.zoom);
  const contours: ContourPropose[] = [];

  for (const element of elements) {
    if (!Array.isArray(element?.geometry) || element.geometry.length < 4) continue;

    let points: PointPlan[] = [];
    let deborde = false;
    for (const sommet of element.geometry) {
      const x = ((pixelX(sommet.lon, vue.zoom) - vue.gauche) / vue.largeur) * 100;
      const y = ((pixelY(sommet.lat, vue.zoom) - vue.haut) / vue.hauteur) * 100;
      // Un dépassement d'un demi-pourcent vient de l'arrondi de la requête,
      // pas d'un parc réellement plus grand que le cadre.
      if (x < -0.5 || x > 100.5 || y < -0.5 || y > 100.5) deborde = true;
      points.push({ x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) });
    }

    // Un tracé fermé répète son premier point : gardé, il ferait un sommet
    // superposé qu'on ne peut ni voir ni attraper.
    if (points.length > 3 && memePoint(points[0], points[points.length - 1])) points.pop();
    if (points.length < 3) continue;
    if (points.length > SOMMETS_MAX) points = alleger(points, SOMMETS_MAX);

    const aire = aireEnPourcentsCarres(points);
    // Sous un millième de l'image, ce n'est pas l'espace cadré mais un banc ou
    // un massif voisin : le proposer comme contour du parc serait trompeur.
    if (aire < 0.05) continue;

    const tags = element.tags ?? {};
    const cleNature = tags.leisure ?? tags.landuse ?? tags.natural ?? '';
    contours.push({
      nom: tags.name ?? '',
      nature: NATURES[cleNature] ?? cleNature ?? 'espace',
      points,
      surface_m2: aire * (mpp * vue.largeur / 100) ** 2 * (vue.hauteur / vue.largeur),
      deborde,
    });
  }

  // Le plus grand d'abord : c'est presque toujours le parc lui-même, les
  // suivants étant ses pelouses et ses aires de jeux.
  return {
    etat: 'ok',
    contours: contours.sort((a, b) => (b.surface_m2 ?? 0) - (a.surface_m2 ?? 0)).slice(0, 6),
  };
}

function lngDepuisPixel(px: number, zoom: number): number {
  return (px / (TAILLE_TUILE * 2 ** zoom)) * 360 - 180;
}

function latDepuisPixel(py: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * py) / (TAILLE_TUILE * 2 ** zoom);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function memePoint(a: PointPlan, b: PointPlan): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Aire du polygone en « pourcents carrés », par la formule du lacet. */
function aireEnPourcentsCarres(points: PointPlan[]): number {
  let somme = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    somme += a.x * b.y - b.x * a.y;
  }
  return Math.abs(somme) / 2;
}

/**
 * Réduit le nombre de sommets sans déformer le contour (Douglas-Peucker).
 *
 * Une haie cartographiée finement peut compter plusieurs milliers de points.
 * Au-delà de quelques centaines, l'affichage SVG et l'export PDF ralentissent à
 * chaque ouverture de la fiche, pour un contour visuellement identique.
 */
function alleger(points: PointPlan[], cible: number): PointPlan[] {
  let tolerance = 0.01;
  let allege = points;
  // La tolérance qui donne le bon compte ne se calcule pas : on la double
  // jusqu'à passer sous la cible, ce qui converge en quelques tours.
  for (let essai = 0; essai < 24 && allege.length > cible; essai++) {
    allege = douglasPeucker(points, tolerance);
    tolerance *= 2;
  }
  return allege.length >= 3 ? allege : points.slice(0, cible);
}

function douglasPeucker(points: PointPlan[], tolerance: number): PointPlan[] {
  if (points.length < 3) return points;

  let indexMax = 0;
  let distanceMax = 0;
  const premier = points[0];
  const dernier = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceAuSegment(points[i], premier, dernier);
    if (distance > distanceMax) {
      distanceMax = distance;
      indexMax = i;
    }
  }

  if (distanceMax <= tolerance) return [premier, dernier];

  const gauche = douglasPeucker(points.slice(0, indexMax + 1), tolerance);
  const droite = douglasPeucker(points.slice(indexMax), tolerance);
  return [...gauche.slice(0, -1), ...droite];
}

function distanceAuSegment(point: PointPlan, a: PointPlan, b: PointPlan): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const longueur = dx * dx + dy * dy;
  if (longueur === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / longueur;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
