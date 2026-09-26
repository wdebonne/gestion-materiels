import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';
import { filtreObjets } from '../middleware/objectScope';
import { porteeTickets } from '../middleware/ticketScope';
import { filtreManifestations } from '../middleware/manifestationScope';
import { perimetreBatiments } from './batiments.service';

/**
 * L'accueil de chacun : quels blocs, dans quel ordre, quelles actions rapides,
 * et ses favoris.
 *
 * Ce qui est figé ici :
 *
 *   **Le catalogue est tenu par le serveur.** Un identifiant de bloc ou
 *   d'action inconnu est écarté, pas refusé : un client plus ancien, ou plus
 *   récent, ne perd pas toute sa disposition pour un bloc que l'autre ne connaît
 *   pas.
 *
 *   **Un favori ne dit que ce qu'on peut encore voir.** Le nom est relu à
 *   chaque lecture, à travers les mêmes portées que les listes de chaque module.
 *   Retirer à quelqu'un l'accès à un bâtiment ne laisse pas son nom dans ses
 *   favoris : la ligne reste, « indisponible », pour qu'il puisse la retirer.
 *
 *   **Un raccourci ne mène que dans l'application.** Un chemin qui commence
 *   par `/`, jamais `//` : sans quoi un favori piégé enverrait ailleurs.
 */

export const BLOCS = [
  'tickets',
  'batiments',
  'manifestations',
  'reservations',
  'favoris',
  'parc',
  'categories',
  'alertes',
  'evenements',
  'activite',
  'vehicules',
] as const;

export const ACTIONS = [
  'scanner',
  'plein',
  'chercher',
  'favoris',
  'nouvelle-demande',
  'mes-tickets',
  'reserver',
  'nouvelle-manifestation',
] as const;

export const TYPES_FAVORI = ['materiel', 'batiment', 'ticket', 'manifestation', 'cle', 'lien'] as const;

export type TypeFavori = (typeof TYPES_FAVORI)[number];

export const MAX_ACTIONS = 4;
export const MAX_FAVORIS = 50;
const MAX_LIBELLE = 120;
const MAX_URL = 500;

export class ErreurAccueil extends Error {
  constructor(
    message: string,
    public statut = 400
  ) {
    super(message);
  }
}

export interface BlocDisposition {
  id: string;
  visible: boolean;
}

export interface Accueil {
  /** `null` : la disposition d'origine. */
  blocs: BlocDisposition[] | null;
  actions: string[] | null;
  favorisImportes: boolean;
}

export interface Favori {
  id: number;
  type: TypeFavori;
  cibleId: number | null;
  /** Le chemin à ouvrir ; `null` quand la cible n'est plus accessible. */
  url: string | null;
  libelle: string | null;
  /** Le nom choisi par la personne, s'il diffère de celui de la cible. */
  libellePerso: string | null;
  detail: string | null;
  disponible: boolean;
}

// ------------------------------------------------------------------ validation

function lireJson(valeur: unknown): unknown {
  if (typeof valeur !== 'string' || valeur === '') return null;
  try {
    return JSON.parse(valeur);
  } catch {
    return null;
  }
}

export function normaliserBlocs(valeur: unknown): BlocDisposition[] {
  if (!Array.isArray(valeur)) throw new ErreurAccueil('La disposition doit être une liste de blocs');
  const vus = new Set<string>();
  const blocs: BlocDisposition[] = [];
  for (const b of valeur) {
    const id = typeof b === 'string' ? b : b && typeof b === 'object' ? (b as any).id : null;
    if (typeof id !== 'string' || !(BLOCS as readonly string[]).includes(id) || vus.has(id)) continue;
    vus.add(id);
    blocs.push({ id, visible: typeof b === 'object' ? (b as any).visible !== false : true });
  }
  return blocs;
}

export function normaliserActions(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) throw new ErreurAccueil('Les actions rapides doivent être une liste');
  const actions = [...new Set(valeur.filter((a): a is string => (ACTIONS as readonly string[]).includes(a)))];
  if (actions.length > MAX_ACTIONS) {
    throw new ErreurAccueil(`${MAX_ACTIONS} actions rapides au plus`);
  }
  return actions;
}

/** Un chemin interne à l'application, ou une erreur. */
export function normaliserUrl(valeur: unknown): string {
  const url = typeof valeur === 'string' ? valeur.trim() : '';
  if (!url) throw new ErreurAccueil('Le raccourci doit indiquer une page');
  if (url.length > MAX_URL) throw new ErreurAccueil('Adresse trop longue');
  // `//hote` et `/\hote` sont lus par les navigateurs comme une autre origine.
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    throw new ErreurAccueil("Un raccourci ne peut mener qu'à une page de l'application");
  }
  if (/[\u0000-\u001f\u007f]/.test(url)) throw new ErreurAccueil('Adresse invalide');
  return url;
}

function normaliserLibelle(valeur: unknown, requis: boolean): string | null {
  const libelle = typeof valeur === 'string' ? valeur.trim().slice(0, MAX_LIBELLE) : '';
  if (!libelle) {
    if (requis) throw new ErreurAccueil('Donnez un nom à ce raccourci');
    return null;
  }
  return libelle;
}

function entierPositif(valeur: unknown): number | null {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ------------------------------------------------------------------ disposition

export async function lireAccueil(userId: number): Promise<Accueil> {
  const ligne = await db.queryOne('SELECT blocs, actions, favoris_importes FROM user_accueil WHERE user_id = ?', [
    userId,
  ]);
  if (!ligne) return { blocs: null, actions: null, favorisImportes: false };

  const blocs = lireJson(ligne.blocs);
  const actions = lireJson(ligne.actions);
  return {
    blocs: Array.isArray(blocs) ? normaliserBlocs(blocs) : null,
    actions: Array.isArray(actions) ? normaliserActions(actions.slice(0, MAX_ACTIONS)) : null,
    favorisImportes: Boolean(Number(ligne.favoris_importes)),
  };
}

async function ecrireAccueil(userId: number, champs: Record<string, unknown>): Promise<void> {
  const colonnes = Object.keys(champs);
  if (colonnes.length === 0) return;
  const existe = await db.queryOne('SELECT user_id FROM user_accueil WHERE user_id = ?', [userId]);
  const maintenant = new Date().toISOString();
  if (existe) {
    await db.execute(
      `UPDATE user_accueil SET ${colonnes.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`,
      [...colonnes.map((c) => champs[c]), maintenant, userId]
    );
  } else {
    await db.execute(
      `INSERT INTO user_accueil (user_id, ${colonnes.join(', ')}, updated_at) VALUES (?, ${colonnes.map(() => '?').join(', ')}, ?)`,
      [userId, ...colonnes.map((c) => champs[c]), maintenant]
    );
  }
}

/**
 * Enregistre la disposition. Un champ absent ne change pas ; `null` revient à
 * l'origine.
 */
export async function enregistrerAccueil(
  userId: number,
  saisie: { blocs?: unknown; actions?: unknown }
): Promise<Accueil> {
  const champs: Record<string, unknown> = {};
  if (saisie.blocs !== undefined) {
    champs.blocs = saisie.blocs === null ? null : JSON.stringify(normaliserBlocs(saisie.blocs));
  }
  if (saisie.actions !== undefined) {
    champs.actions = saisie.actions === null ? null : JSON.stringify(normaliserActions(saisie.actions));
  }
  await ecrireAccueil(userId, champs);
  return lireAccueil(userId);
}

// ------------------------------------------------------------------ favoris

interface Cible {
  nom: string;
  detail: string | null;
}

const marqueurs = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * Les cibles encore visibles, par type : `type:id` → nom et précision.
 *
 * Chaque type passe par la portée de son module, et rien d'autre : une cible
 * absente de la table est ou supprimée, ou hors de portée — les deux se
 * disent de la même façon.
 */
async function ciblesVisibles(
  req: AuthRequest,
  demandes: Array<{ type: TypeFavori; cibleId: number | null }>
): Promise<Map<string, Cible>> {
  const visibles = new Map<string, Cible>();
  const idsDe = (...types: TypeFavori[]) => [
    ...new Set(demandes.filter((d) => types.includes(d.type) && d.cibleId).map((d) => d.cibleId as number)),
  ];

  // Matériels et clés : une clé est un matériel, rangé dans le module Clés.
  const objets = idsDe('materiel', 'cle');
  if (objets.length > 0) {
    const filtre = await filtreObjets(req, 'o');
    if (filtre) {
      const lignes = await db.query(
        `SELECT o.id, o.name, o.reference FROM objects o WHERE o.id IN (${marqueurs(objets.length)})${filtre.sql}`,
        [...objets, ...filtre.params]
      );
      for (const l of lignes) {
        const cible = { nom: l.name, detail: l.reference ?? null };
        visibles.set(`materiel:${l.id}`, cible);
        visibles.set(`cle:${l.id}`, cible);
      }
    }
  }

  const batiments = idsDe('batiment');
  if (batiments.length > 0) {
    const perimetre = await perimetreBatiments(req.user!);
    const permis = perimetre === null ? batiments : batiments.filter((id) => perimetre.includes(id));
    if (permis.length > 0) {
      const lignes = await db.query(
        `SELECT id, name, address FROM cle_sites WHERE id IN (${marqueurs(permis.length)})`,
        permis
      );
      for (const l of lignes) visibles.set(`batiment:${l.id}`, { nom: l.name, detail: l.address ?? null });
    }
  }

  const tickets = idsDe('ticket');
  if (tickets.length > 0) {
    const portee = await porteeTickets(req, 't');
    const lignes = await db.query(
      `SELECT t.id, t.titre, t.reference FROM tickets t WHERE t.id IN (${marqueurs(tickets.length)})${portee.sql}`,
      [...tickets, ...portee.params]
    );
    for (const l of lignes) visibles.set(`ticket:${l.id}`, { nom: l.titre, detail: l.reference ?? null });
  }

  const manifestations = idsDe('manifestation');
  if (manifestations.length > 0) {
    const filtre = await filtreManifestations(req, 'm');
    if (filtre) {
      const lignes = await db.query(
        `SELECT m.id, m.title, m.date_start FROM manifestations m WHERE m.id IN (${marqueurs(manifestations.length)})${filtre.sql}`,
        [...manifestations, ...filtre.params]
      );
      for (const l of lignes) {
        visibles.set(`manifestation:${l.id}`, { nom: l.title, detail: l.date_start ? String(l.date_start).slice(0, 10) : null });
      }
    }
  }

  return visibles;
}

function cheminDe(type: TypeFavori, cibleId: number | null, url: string | null): string | null {
  switch (type) {
    case 'materiel':
      return `/objects/${cibleId}`;
    case 'cle':
      return `/cles/${cibleId}`;
    case 'batiment':
      return `/batiments/${cibleId}`;
    case 'ticket':
      return `/tickets/${cibleId}`;
    case 'manifestation':
      return `/manifestations?fiche=${cibleId}`;
    case 'lien':
      return url;
  }
}

export async function listerFavoris(req: AuthRequest): Promise<Favori[]> {
  const lignes = await db.query(
    'SELECT id, type, cible_id, libelle, url FROM user_favoris WHERE user_id = ? ORDER BY position ASC, id ASC',
    [req.user!.userId]
  );
  const favoris = lignes
    .filter((l: any) => (TYPES_FAVORI as readonly string[]).includes(l.type))
    .map((l: any) => ({
      id: Number(l.id),
      type: l.type as TypeFavori,
      cibleId: l.cible_id === null || l.cible_id === undefined ? null : Number(l.cible_id),
      libelle: l.libelle ?? null,
      url: l.url ?? null,
    }));

  const visibles = await ciblesVisibles(req, favoris);

  return favoris.map((f) => {
    if (f.type === 'lien') {
      return { ...f, libellePerso: f.libelle, detail: null, disponible: true };
    }
    const cible = visibles.get(`${f.type}:${f.cibleId}`);
    if (!cible) {
      // Ni nom, ni chemin : le nom qu'elle avait choisi pouvait être celui de la cible.
      return { ...f, url: null, libelle: null, libellePerso: null, detail: null, disponible: false };
    }
    return {
      ...f,
      url: cheminDe(f.type, f.cibleId, null),
      libelle: f.libelle ?? cible.nom,
      libellePerso: f.libelle,
      detail: cible.detail,
      disponible: true,
    };
  });
}

async function prochainePosition(userId: number): Promise<number> {
  const ligne = await db.queryOne('SELECT MAX(position) AS m FROM user_favoris WHERE user_id = ?', [userId]);
  return ligne?.m === null || ligne?.m === undefined ? 0 : Number(ligne.m) + 1;
}

async function nombreDeFavoris(userId: number): Promise<number> {
  const ligne = await db.queryOne('SELECT COUNT(*) AS n FROM user_favoris WHERE user_id = ?', [userId]);
  return Number(ligne?.n ?? 0);
}

/** Épingle une cible, ou enregistre un raccourci. Épingler deux fois ne double pas. */
export async function ajouterFavori(
  req: AuthRequest,
  saisie: { type?: unknown; cibleId?: unknown; url?: unknown; libelle?: unknown }
): Promise<{ id: number; cree: boolean }> {
  const userId = req.user!.userId;
  const type = saisie.type as TypeFavori;
  if (!(TYPES_FAVORI as readonly string[]).includes(type)) throw new ErreurAccueil('Type de favori inconnu');

  let cibleId: number | null = null;
  let url: string | null = null;
  const libelle = normaliserLibelle(saisie.libelle, type === 'lien');

  if (type === 'lien') {
    url = normaliserUrl(saisie.url);
    const existant = await db.queryOne("SELECT id FROM user_favoris WHERE user_id = ? AND type = 'lien' AND url = ?", [
      userId,
      url,
    ]);
    if (existant) return { id: Number(existant.id), cree: false };
  } else {
    cibleId = entierPositif(saisie.cibleId);
    if (!cibleId) throw new ErreurAccueil('Cible invalide');
    const existant = await db.queryOne('SELECT id FROM user_favoris WHERE user_id = ? AND type = ? AND cible_id = ?', [
      userId,
      type,
      cibleId,
    ]);
    if (existant) return { id: Number(existant.id), cree: false };
    // Épingler ce qu'on ne voit pas révélerait son nom à la lecture suivante… si
    // la lecture ne le filtrait pas. Elle le filtre, mais refuser ici dit la
    // vérité tout de suite.
    const visibles = await ciblesVisibles(req, [{ type, cibleId }]);
    if (!visibles.has(`${type}:${cibleId}`)) throw new ErreurAccueil('Introuvable, ou hors de votre périmètre', 404);
  }

  if ((await nombreDeFavoris(userId)) >= MAX_FAVORIS) {
    throw new ErreurAccueil(`${MAX_FAVORIS} favoris au plus : retirez-en un d'abord`);
  }

  const r = await db.execute(
    'INSERT INTO user_favoris (user_id, type, cible_id, libelle, url, position) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, type, cibleId, libelle, url, await prochainePosition(userId)]
  );
  return { id: Number(r.lastInsertRowid), cree: true };
}

/** Renomme un favori ; un nom vide rend celui de la cible (sauf pour un raccourci). */
export async function renommerFavori(userId: number, id: number, libelle: unknown): Promise<void> {
  const favori = await db.queryOne('SELECT type FROM user_favoris WHERE id = ? AND user_id = ?', [id, userId]);
  if (!favori) throw new ErreurAccueil('Favori introuvable', 404);
  await db.execute('UPDATE user_favoris SET libelle = ? WHERE id = ? AND user_id = ?', [
    normaliserLibelle(libelle, favori.type === 'lien'),
    id,
    userId,
  ]);
}

export async function retirerFavori(userId: number, id: number): Promise<boolean> {
  const r = await db.execute('DELETE FROM user_favoris WHERE id = ? AND user_id = ?', [id, userId]);
  return r.changes > 0;
}

/** Retire une cible épinglée, sans connaître l'identifiant du favori. */
export async function retirerCible(userId: number, type: unknown, cibleId: unknown): Promise<boolean> {
  const id = entierPositif(cibleId);
  if (!(TYPES_FAVORI as readonly string[]).includes(type as string) || type === 'lien' || !id) {
    throw new ErreurAccueil('Cible invalide');
  }
  const r = await db.execute('DELETE FROM user_favoris WHERE user_id = ? AND type = ? AND cible_id = ?', [
    userId,
    type,
    id,
  ]);
  return r.changes > 0;
}

/** L'ordre voulu ; les favoris d'autrui et les identifiants inconnus sont ignorés. */
export async function reordonnerFavoris(userId: number, ids: unknown): Promise<void> {
  if (!Array.isArray(ids)) throw new ErreurAccueil("L'ordre doit être une liste");
  const ordre = [...new Set(ids.map(entierPositif).filter((n): n is number => n !== null))];
  await db.transaction(async () => {
    for (const [position, id] of ordre.entries()) {
      await db.execute('UPDATE user_favoris SET position = ? WHERE id = ? AND user_id = ?', [position, id, userId]);
    }
  });
}

/**
 * Reprend, une seule fois, les matériels épinglés dans le navigateur.
 *
 * Une fois : sans le drapeau, un second appareil qui garde d'anciens favoris
 * locaux ferait réapparaître ceux qu'on a retirés depuis.
 */
export async function importerFavorisLocaux(req: AuthRequest, ids: unknown): Promise<{ importes: number }> {
  const userId = req.user!.userId;
  const accueil = await lireAccueil(userId);
  if (accueil.favorisImportes) return { importes: 0 };

  const demandes = Array.isArray(ids)
    ? [...new Set(ids.map(entierPositif).filter((n): n is number => n !== null))].slice(0, MAX_FAVORIS)
    : [];
  const visibles = await ciblesVisibles(
    req,
    demandes.map((cibleId) => ({ type: 'materiel' as const, cibleId }))
  );

  let importes = 0;
  for (const cibleId of demandes) {
    if (!visibles.has(`materiel:${cibleId}`)) continue;
    try {
      const { cree } = await ajouterFavori(req, { type: 'materiel', cibleId });
      if (cree) importes++;
    } catch (erreur) {
      if (erreur instanceof ErreurAccueil) break; // la limite est atteinte
      throw erreur;
    }
  }
  await ecrireAccueil(userId, { favoris_importes: 1 });
  return { importes };
}
