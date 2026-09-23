import { db } from '../index';
import { colonnesDeTable, insererPaquet, lignesParPaquet } from '../lots';

/**
 * Outils communs au jeu de données de charge.
 *
 * Tout ce qui est généré porte une marque, pour que `--purger` retrouve ses
 * lignes sans toucher au reste : courriels en `@charge.test`, références en
 * `CHG-`, slugs en `chg-`. Les constantes ci-dessous sont la seule source de
 * ces marques.
 */
export const DOMAINE_COURRIEL = 'charge.test';
export const PREFIXE = 'CHG-';
export const PREFIXE_SLUG = 'chg-';

// ---------------------------------------------------------------------------
// Hasard reproductible
// ---------------------------------------------------------------------------

/**
 * Générateur à graine (mulberry32) : la même graine rend le même jeu, ce qui
 * permet de rejouer à l'identique un scénario qui a fait tomber l'application.
 */
export class Alea {
  private etat: number;

  constructor(graine: number) {
    this.etat = graine >>> 0;
  }

  /** Réel dans [0, 1). */
  nombre(): number {
    this.etat = (this.etat + 0x6d2b79f5) >>> 0;
    let t = this.etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [min, max], bornes comprises. */
  entier(min: number, max: number): number {
    return min + Math.floor(this.nombre() * (max - min + 1));
  }

  reel(min: number, max: number, decimales = 2): number {
    const facteur = 10 ** decimales;
    return Math.round((min + this.nombre() * (max - min)) * facteur) / facteur;
  }

  chance(probabilite: number): boolean {
    return this.nombre() < probabilite;
  }

  choix<T>(liste: readonly T[]): T {
    return liste[Math.floor(this.nombre() * liste.length)];
  }

  /** Choix pondéré : `[[valeur, poids], ...]`. */
  pondere<T>(options: ReadonlyArray<readonly [T, number]>): T {
    const total = options.reduce((s, [, p]) => s + p, 0);
    let tirage = this.nombre() * total;
    for (const [valeur, poids] of options) {
      tirage -= poids;
      if (tirage < 0) return valeur;
    }
    return options[options.length - 1][0];
  }

  /** `k` éléments distincts, dans un ordre quelconque. */
  plusieurs<T>(liste: readonly T[], k: number): T[] {
    const copie = liste.slice();
    const n = Math.min(k, copie.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(this.nombre() * (copie.length - i));
      [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie.slice(0, n);
  }

  /** Une date entre `-joursAvant` et `+joursApres` autour de `autour`. */
  dateAutour(autour: Date, joursAvant: number, joursApres: number): Date {
    const decalage = this.reel(-joursAvant, joursApres, 4);
    const d = new Date(autour.getTime() + decalage * 86_400_000);
    // Des heures de bureau, pour que l'agenda ressemble à un agenda.
    d.setHours(this.entier(7, 18), this.choix([0, 0, 15, 30, 45]), 0, 0);
    return d;
  }

  hexa(longueur: number): string {
    let s = '';
    while (s.length < longueur) s += Math.floor(this.nombre() * 16).toString(16);
    return s;
  }
}

// ---------------------------------------------------------------------------
// Dates, au format que les deux moteurs relisent sans le réinterpréter
// ---------------------------------------------------------------------------

const deux = (n: number) => String(n).padStart(2, '0');

/** `AAAA-MM-JJ` : un jour, et non un instant (voir le décalage de mysql2). */
export function jour(d: Date): string {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** `AAAA-MM-JJ HH:MM:SS`, heure locale. */
export function instant(d: Date): string {
  return `${jour(d)} ${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
}

export function heure(d: Date): string {
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

export function plusJours(d: Date, jours: number): Date {
  return new Date(d.getTime() + jours * 86_400_000);
}

export function plusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function slugifier(s: string): string {
  return sansAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Contexte partagé entre les domaines
// ---------------------------------------------------------------------------

/**
 * Ce que chaque domaine laisse aux suivants : les identifiants créés, pour
 * que les tickets pointent vers de vrais sites, les prêts vers de vrais
 * matériels, et ainsi de suite.
 */
export interface Contexte {
  alea: Alea;
  echelle: number;
  maintenant: Date;
  adminId: number;
  motDePasse: string;
  utilisateurs: Array<{ id: number; role: string; nom: string }>;
  services: number[];
  categories: Array<{ id: number; nom: string; nature: NatureCategorie }>;
  sousCategories: Array<{ id: number; categorieId: number; nom: string }>;
  materiels: Array<{
    id: number;
    categorieId: number;
    sousCategorieId: number | null;
    nature: NatureCategorie;
    nom: string;
    lot: boolean;
  }>;
  sites: Array<{ id: number; nom: string }>;
  pieces: Array<{ id: number; siteId: number; nom: string; pretable: boolean }>;
  ouvrants: Array<{ id: number; siteId: number }>;
  manifestations: Array<{ id: number; debut: string; fin: string; statut: string }>;
  tickets: number[];
}

export type NatureCategorie =
  | 'vehicule'
  | 'engin'
  | 'cle'
  | 'informatique'
  | 'evenementiel'
  | 'mobilier_urbain'
  | 'espaces_verts'
  | 'divers';

/** Un volume de base multiplié par l'échelle, jamais nul. */
export function volume(ctx: Contexte, base: number): number {
  return Math.max(1, Math.round(base * ctx.echelle));
}

export function utilisateurAuHasard(ctx: Contexte, roles?: string[]): number {
  const candidats = roles ? ctx.utilisateurs.filter((u) => roles.includes(u.role)) : ctx.utilisateurs;
  return ctx.alea.choix(candidats.length > 0 ? candidats : ctx.utilisateurs).id;
}

export function materielsDe(ctx: Contexte, ...natures: NatureCategorie[]): Contexte['materiels'] {
  return ctx.materiels.filter((m) => natures.includes(m.nature));
}

// ---------------------------------------------------------------------------
// Écriture en base
// ---------------------------------------------------------------------------

const colonnesConnues = new Map<string, Set<string>>();
const avertissementsDonnes = new Set<string>();

/**
 * Colonnes réelles d'une table. Un champ que le générateur connaît mais que le
 * schéma a perdu — une migration l'a renommé — est ignoré avec un
 * avertissement, plutôt que de faire échouer tout le chargement.
 */
export async function colonnesDe(table: string): Promise<Set<string>> {
  const deja = colonnesConnues.get(table);
  if (deja) return deja;

  const colonnes = new Set(await colonnesDeTable(table));
  colonnesConnues.set(table, colonnes);
  return colonnes;
}

export async function tableExiste(table: string): Promise<boolean> {
  return (await colonnesDe(table)).size > 0;
}

type Ligne = Record<string, unknown>;

/**
 * Insère des lignes par paquets de `INSERT … VALUES (…), (…)` et rend leurs
 * identifiants, dans l'ordre des lignes.
 *
 * Les identifiants se déduisent de ce que rend le moteur — le premier sur
 * MySQL, le dernier sur SQLite — puisqu'un seul `INSERT` multiligne reçoit des
 * identifiants consécutifs. `cle` nomme une colonne marquée, relue ensuite
 * pour le vérifier : une écriture concurrente ou un `auto_increment_increment`
 * différent de 1 sont alors détectés au lieu de produire des liens faux.
 */
export async function inserer(table: string, lignes: Ligne[], cle?: string): Promise<number[]> {
  if (lignes.length === 0) return [];

  const existantes = await colonnesDe(table);
  if (existantes.size === 0) {
    avertirUneFois(`table:${table}`, `⚠️  Table ${table} absente : ignorée`);
    return [];
  }

  const demandees = new Set<string>();
  for (const ligne of lignes) for (const c of Object.keys(ligne)) demandees.add(c);
  const colonnes = [...demandees].filter((c) => existantes.has(c));
  for (const c of demandees) {
    if (!existantes.has(c)) avertirUneFois(`${table}.${c}`, `⚠️  ${table}.${c} n'existe pas : ignorée`);
  }

  const parPaquet = lignesParPaquet(colonnes.length);
  const ids: number[] = [];

  for (let debut = 0; debut < lignes.length; debut += parPaquet) {
    const paquet = lignes.slice(debut, debut + parPaquet);
    const premier = await insererPaquet(
      table,
      colonnes,
      paquet.map((ligne) => colonnes.map((c) => normaliser(ligne[c])))
    );
    const idsPaquet = paquet.map((_, i) => premier + i);

    if (cle) await verifierIdentifiants(table, cle, paquet, idsPaquet);
    ids.push(...idsPaquet);
  }

  return ids;
}

async function verifierIdentifiants(table: string, cle: string, paquet: Ligne[], ids: number[]) {
  const relues = await db.query<{ id: number; valeur: unknown }>(
    `SELECT id, ${cle} AS valeur FROM ${table} WHERE id >= ? AND id <= ?`,
    [ids[0], ids[ids.length - 1]]
  );
  const parId = new Map(relues.map((r) => [Number(r.id), String(r.valeur)]));
  paquet.forEach((ligne, i) => {
    if (parId.get(ids[i]) !== String(ligne[cle])) {
      throw new Error(
        `${table} : l'identifiant ${ids[i]} ne correspond pas à la ligne « ${String(ligne[cle])} ». ` +
          `Une autre écriture a-t-elle eu lieu pendant le chargement ?`
      );
    }
  });
}

function normaliser(valeur: unknown): unknown {
  if (valeur === undefined) return null;
  if (typeof valeur === 'boolean') return valeur ? 1 : 0;
  if (valeur instanceof Date) return instant(valeur);
  if (valeur !== null && typeof valeur === 'object') return JSON.stringify(valeur);
  return valeur;
}

function avertirUneFois(cle: string, message: string) {
  if (avertissementsDonnes.has(cle)) return;
  avertissementsDonnes.add(cle);
  console.warn(message);
}

export async function compter(table: string): Promise<number> {
  if (!(await tableExiste(table))) return 0;
  const ligne = await db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(ligne?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Matière première des textes
// ---------------------------------------------------------------------------

export const PRENOMS = [
  'Camille', 'Léa', 'Chloé', 'Inès', 'Manon', 'Zoé', 'Jade', 'Louise', 'Anaïs', 'Maëlys',
  'Hélène', 'Élodie', 'Gaëlle', 'Noémie', 'Océane', 'Solène', 'Agnès', 'Béatrice', 'Céline', 'Françoise',
  'Lucas', 'Hugo', 'Théo', 'Nathan', 'Louis', 'Jules', 'Raphaël', 'Gabriel', 'Noé', 'Mathéo',
  'Jérôme', 'Stéphane', 'Frédéric', 'Grégoire', 'Benoît', 'Joël', 'Hervé', 'François', 'Loïc', 'Yannick',
  'Jean-Pierre', 'Marie-Claire', 'Anne-Sophie', 'Pierre-Yves', 'Marc-Antoine', 'Aïcha', 'Mohamed', 'Nguyen', 'Zoë', 'Ophélie',
];

export const NOMS = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier',
  'Morel', 'Girard', 'André', 'Lefebvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez',
  "D'Almeida", "L'Hermitte", 'Le Goff', 'De La Fontaine', 'Béranger', 'Châtelain', 'Lemaître', 'Poulain', 'Hébert', 'Lecœur',
  'Müller', 'Nguyễn', 'Ben Saïd', 'Carré-Duval', 'Delaunay-Froissart', 'Østergaard', "O'Connor", 'Ruiz-Pérez', 'Leblanc', 'Quéré',
];

export const RUES = [
  'rue de la République', 'rue Jean Jaurès', 'avenue du Général de Gaulle', 'place de la Mairie',
  'rue Victor Hugo', 'chemin des Prés', 'impasse des Tilleuls', 'rue du Moulin', 'route de Rouen',
  'rue Pasteur', "rue de l'Église", 'allée des Charmilles', 'rue du 8 Mai 1945', 'boulevard de la Gare',
  'rue Émile Zola', 'chemin du Val', 'rue des Écoles', 'place du Marché', 'rue Guy de Maupassant', 'sente aux Loups',
];

export const COMMUNES = ['Pavilly', 'Barentin', 'Sainte-Austreberthe', 'Limésy', 'Mesnil-Panneville', 'Villers-Écalles'];

export function adresse(alea: Alea): string {
  return `${alea.entier(1, 180)}${alea.chance(0.1) ? ' bis' : ''} ${alea.choix(RUES)}, 76570 ${alea.choix(COMMUNES)}`;
}

export function telephone(alea: Alea): string {
  return `0${alea.choix([2, 6, 7])} ${deux(alea.entier(0, 99))} ${deux(alea.entier(0, 99))} ${deux(alea.entier(0, 99))} ${deux(alea.entier(0, 99))}`;
}

const PHRASES = [
  "Le matériel a été vérifié avant la sortie.",
  "Merci de prévoir l'intervention avant vendredi.",
  "L'agent signale un bruit anormal au démarrage.",
  "Constat fait sur place avec le responsable du site.",
  "Pièce commandée chez le fournisseur, délai annoncé : 3 semaines.",
  "À voir avec l'élu référent — ça coince côté budget.",
  "Rien à signaler, tout est conforme.",
  "La porte ne ferme plus correctement depuis l'orage de mardi.",
  "Prévoir deux agents et le camion benne.",
  "Voir photo jointe (côté est du bâtiment).",
  "Retour usager : « très satisfait de la réactivité » 👍",
  "Attention : accès par la cour arrière uniquement ⚠️",
  "Test de caractères : œ Œ æ ß ç ñ « guillemets » — tiret cadratin… et l'apostrophe ’ typographique.",
  "Réglage effectué ; à surveiller dans les prochains jours.",
  "Les enfants de l'école ont signalé le problème à la directrice.",
  "Intervention reportée à cause de la météo 🌧️",
  "Clé récupérée à l'accueil de la mairie.",
  "Devis n° 2025-0142 validé par la commission.",
  "Chiffre à vérifier : 1 250,50 € TTC.",
  "Le compteur affichait 12 345 km au moment du constat.",
];

/** Un texte de quelques phrases ; parfois très long, parfois vide. */
export function texte(alea: Alea, min = 1, max = 4): string {
  const n = alea.entier(min, max);
  const morceaux: string[] = [];
  for (let i = 0; i < n; i++) morceaux.push(alea.choix(PHRASES));
  return morceaux.join(' ');
}

/** Un texte de plus de 2 000 caractères, pour éprouver les affichages. */
export function texteLong(alea: Alea): string {
  const morceaux: string[] = [];
  while (morceaux.join(' ').length < 2_200) morceaux.push(alea.choix(PHRASES));
  return morceaux.join(alea.chance(0.5) ? ' ' : '\n\n');
}

/** Description : vide, courte, ou longue, dans des proportions réalistes. */
export function description(alea: Alea): string | null {
  return alea.pondere<() => string | null>([
    [() => null, 15],
    [() => '', 5],
    [() => texte(alea), 70],
    [() => texteLong(alea), 10],
  ])();
}
