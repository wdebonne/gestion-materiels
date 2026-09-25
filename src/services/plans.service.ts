import fs from 'fs';
import path from 'path';
import { db } from '../database';
import { dossierPrive } from '../middleware/televersement';
import { lireZone, type PointPlan } from './geometriePlan.service';
import { creerPiece } from './lieux.service';
import { ErreurBatiment } from './batiments.service';
import { detenteursDe } from './cles.service';
import { versDateTime } from './tickets.service';
import { filtreObjets } from '../middleware/objectScope';
import type { AuthRequest } from '../middleware/auth.middleware';

/**
 * La portée des catégories de l'appelant, pour un alias de `objects`.
 *
 * `undefined` : appel interne, sans lecteur — pas de restriction. `null` :
 * aucune catégorie ouverte — rien à montrer. Consulter un bâtiment ne donne pas
 * le droit de voir tout le parc : la directrice d'école voit sa salle, pas le
 * matériel d'une catégorie qui lui est fermée qu'on y aurait rangé.
 */
async function porteeDe(req: AuthRequest | undefined, alias: string): Promise<{ sql: string; params: any[] } | null | undefined> {
  if (!req) return undefined;
  return filtreObjets(req, alias);
}

/**
 * Les étages d'un bâtiment, leurs plans, et ce que chaque pièce contient.
 *
 * ## Le plan est privé
 *
 * Un plan d'école dit où sont les issues et les locaux sensibles : il va dans
 * `uploads/prive/plans/`, comme les documents, et ne sort que par une route qui
 * vérifie que l'on consulte le bâtiment.
 *
 * ## Les zones sont en pourcentages
 *
 * Comme sur le plan des espaces verts : de 0 à 100 sur chaque axe, quelle que
 * soit l'image. Remplacer le plan par une version de même cadrage ne déplace
 * rien. La surface se calcule quand l'étage est étalonné — un segment tracé
 * sur une longueur connue —, par la même formule que `plan/geometrie.ts` côté
 * client : `aire en %² × (mètres par % de largeur)² × ratio`.
 *
 * ## Un matériel unique n'est que dans une pièce
 *
 * Un vidéoprojecteur est dans la salle 12 **ou** dans la salle 14. Le poser
 * ailleurs le déplace, et le dit. Un lot — cinquante chaises — se répartit, à
 * concurrence de sa quantité quand elle est connue.
 */

export const SOUS_DOSSIER_PLANS = 'plans';

export interface EchelleEtage {
  metresParPourcent: number;
  /** Le segment d'étalonnage, gardé pour pouvoir le corriger plutôt que le refaire. */
  points: { a: PointPlan; b: PointPlan; metres: number } | null;
}

export interface Etage {
  id: number;
  siteId: number;
  nom: string;
  niveau: number;
  ordre: number;
  plan: { mime: string | null; largeur: number | null; hauteur: number | null; ratio: number | null } | null;
  echelle: EchelleEtage | null;
}

export interface PieceSurPlan {
  id: number;
  nom: string;
  code: string | null;
  typeLieu: string | null;
  capacite: number | null;
  actif: boolean;
  etageId: number | null;
  zone: PointPlan[];
  surfaceM2: number | null;
  materiels: number;
}

const nombreOuNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function lireJson<T>(brut: unknown): T | null {
  if (!brut) return null;
  try {
    return typeof brut === 'string' ? (JSON.parse(brut) as T) : (brut as T);
  } catch {
    return null;
  }
}

function enEtage(l: any): Etage {
  const metres = nombreOuNull(l.echelle_metres);
  return {
    id: Number(l.id),
    siteId: Number(l.site_id),
    nom: l.nom,
    niveau: Number(l.niveau ?? 0),
    ordre: Number(l.sort_order ?? 0),
    plan: l.plan_chemin
      ? {
          mime: l.plan_mime ?? null,
          largeur: nombreOuNull(l.plan_largeur),
          hauteur: nombreOuNull(l.plan_hauteur),
          ratio: nombreOuNull(l.plan_ratio),
        }
      : null,
    echelle: metres ? { metresParPourcent: metres, points: lireJson(l.echelle_points) } : null,
  };
}

// ================================================================ les étages

export async function listerEtages(siteId: number): Promise<Etage[]> {
  const lignes = await db.query(
    'SELECT * FROM site_etages WHERE site_id = ? ORDER BY niveau, sort_order, id',
    [siteId]
  );
  return lignes.map(enEtage);
}

export async function lireEtage(id: number | string): Promise<Etage | null> {
  const ligne = await db.queryOne('SELECT * FROM site_etages WHERE id = ?', [id]);
  return ligne ? enEtage(ligne) : null;
}

function lireNom(valeur: unknown): string {
  const nom = String(valeur ?? '').trim().slice(0, 100);
  if (!nom) throw new ErreurBatiment(400, "Le nom de l'étage est obligatoire");
  return nom;
}

function lireNiveau(valeur: unknown): number {
  const niveau = Number(valeur ?? 0);
  if (!Number.isInteger(niveau) || niveau < -10 || niveau > 100) {
    throw new ErreurBatiment(400, 'Le niveau est un entier (0 pour le rez-de-chaussée, -1 pour le sous-sol)');
  }
  return niveau;
}

export async function creerEtage(siteId: number, saisie: { nom?: unknown; niveau?: unknown }): Promise<number> {
  if (!(await db.queryOne('SELECT id FROM cle_sites WHERE id = ?', [siteId]))) {
    throw new ErreurBatiment(404, 'Bâtiment introuvable');
  }
  const maintenant = versDateTime();
  const resultat = await db.execute(
    'INSERT INTO site_etages (site_id, nom, niveau, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [siteId, lireNom(saisie.nom), lireNiveau(saisie.niveau), maintenant, maintenant]
  );
  return Number(resultat.lastInsertRowid);
}

/**
 * Renomme un étage, change son niveau, ou règle son échelle.
 *
 * Régler l'échelle recalcule la surface de toutes les pièces dessinées sur
 * l'étage : elles dépendent d'elle, et une surface d'avant l'étalonnage
 * mentirait.
 */
export async function modifierEtage(
  id: number,
  saisie: { nom?: unknown; niveau?: unknown; ordre?: unknown; echelle?: unknown }
): Promise<void> {
  const etage = await lireEtage(id);
  if (!etage) throw new ErreurBatiment(404, 'Étage introuvable');

  const champs: string[] = [];
  const valeurs: unknown[] = [];
  const poser = (colonne: string, valeur: unknown) => {
    champs.push(`${colonne} = ?`);
    valeurs.push(valeur);
  };

  if (saisie.nom !== undefined) poser('nom', lireNom(saisie.nom));
  if (saisie.niveau !== undefined) poser('niveau', lireNiveau(saisie.niveau));
  if (saisie.ordre !== undefined && Number.isInteger(Number(saisie.ordre))) poser('sort_order', Number(saisie.ordre));

  let echelleChangee = false;
  if (saisie.echelle !== undefined) {
    echelleChangee = true;
    if (saisie.echelle === null) {
      poser('echelle_metres', null);
      poser('echelle_points', null);
    } else {
      const e = saisie.echelle as any;
      const metres = Number(e?.metresParPourcent);
      if (!(metres > 0) || !Number.isFinite(metres)) throw new ErreurBatiment(400, 'Échelle invalide');
      poser('echelle_metres', metres);
      poser('echelle_points', e?.points ? JSON.stringify(e.points) : null);
    }
  }
  if (champs.length === 0) return;

  poser('updated_at', versDateTime());
  await db.execute(`UPDATE site_etages SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
  if (echelleChangee) await recalculerSurfaces(id);
}

/**
 * Supprime un étage. Ses pièces restent — elles portent des clés, des tickets —,
 * rendues au bâtiment et sans zone : un contour n'a pas de sens sans le plan
 * sur lequel il a été tracé. Rend le chemin du plan à effacer.
 */
export async function supprimerEtage(id: number): Promise<string | null> {
  const ligne = await db.queryOne('SELECT plan_chemin FROM site_etages WHERE id = ?', [id]);
  if (!ligne) throw new ErreurBatiment(404, 'Étage introuvable');
  await db.execute(
    'UPDATE site_pieces SET etage_id = NULL, zone_points = NULL, surface_m2 = NULL WHERE etage_id = ?',
    [id]
  );
  await db.execute('DELETE FROM site_etages WHERE id = ?', [id]);
  return ligne.plan_chemin ?? null;
}

/** Pose le plan d'un étage ; rend le chemin de l'ancien, à effacer. */
export async function poserPlan(
  id: number,
  plan: { chemin: string; mime: string; largeur: number | null; hauteur: number | null }
): Promise<string | null> {
  const ligne = await db.queryOne('SELECT plan_chemin FROM site_etages WHERE id = ?', [id]);
  if (!ligne) throw new ErreurBatiment(404, 'Étage introuvable');
  const ratio = plan.largeur && plan.hauteur ? plan.hauteur / plan.largeur : null;
  await db.execute(
    `UPDATE site_etages
        SET plan_chemin = ?, plan_mime = ?, plan_largeur = ?, plan_hauteur = ?, plan_ratio = ?, updated_at = ?
      WHERE id = ?`,
    [plan.chemin, plan.mime, plan.largeur, plan.hauteur, ratio, versDateTime(), id]
  );
  // Le ratio a pu changer : les surfaces qui en dépendent aussi.
  await recalculerSurfaces(id);
  return ligne.plan_chemin ?? null;
}

export async function cheminDuPlan(id: number | string): Promise<{ chemin: string; mime: string | null } | null> {
  const ligne = await db.queryOne('SELECT plan_chemin, plan_mime FROM site_etages WHERE id = ?', [id]);
  return ligne?.plan_chemin ? { chemin: ligne.plan_chemin, mime: ligne.plan_mime ?? null } : null;
}

/**
 * Les dimensions d'une image, lues par sharp quand il est là.
 *
 * L'orientation EXIF compte : une photo de plan prise au téléphone, en
 * portrait, déclare souvent une largeur qui est sa hauteur à l'affichage. Sans
 * sharp, on s'en remet aux dimensions que le navigateur a mesurées.
 */
export async function dimensionsImage(
  fichier: string,
  repli: { largeur: number | null; hauteur: number | null }
): Promise<{ largeur: number | null; hauteur: number | null }> {
  try {
    const sharp = require('sharp');
    const meta = await sharp(fichier).metadata();
    if (!meta.width || !meta.height) return repli;
    const tourne = (meta.orientation ?? 1) >= 5;
    return tourne ? { largeur: meta.height, hauteur: meta.width } : { largeur: meta.width, hauteur: meta.height };
  } catch {
    return repli;
  }
}

// ============================================================ les pièces sur le plan

/** Les pièces d'un bâtiment, avec leur étage, leur zone et ce qu'elles contiennent. */
export async function piecesDuBatiment(siteId: number): Promise<PieceSurPlan[]> {
  const lignes = await db.query(
    `SELECT p.*, (SELECT COUNT(*) FROM piece_materiels pm WHERE pm.piece_id = p.id) AS nb_materiels
       FROM site_pieces p
      WHERE p.site_id = ?
      ORDER BY p.sort_order, p.name`,
    [siteId]
  );
  return lignes.map((l: any) => ({
    id: Number(l.id),
    nom: l.name,
    code: l.code ?? null,
    typeLieu: l.type_lieu ?? null,
    capacite: nombreOuNull(l.capacite),
    actif: l.is_active === undefined || l.is_active === null ? true : Boolean(Number(l.is_active)),
    etageId: nombreOuNull(l.etage_id),
    zone: lireJson<PointPlan[]>(l.zone_points) ?? [],
    surfaceM2: nombreOuNull(l.surface_m2),
    materiels: Number(l.nb_materiels ?? 0),
  }));
}

/** Aire du polygone en « pourcents carrés », par la formule du lacet. */
function aireEnPourcents(points: PointPlan[]): number {
  let somme = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    somme += a.x * b.y - b.x * a.y;
  }
  return Math.abs(somme) / 2;
}

/** La surface réelle d'une zone, ou `null` tant que l'étage n'est pas étalonné. */
export function surfaceEnM2(points: PointPlan[], etage: Pick<Etage, 'echelle' | 'plan'>): number | null {
  const metres = etage.echelle?.metresParPourcent;
  const ratio = etage.plan?.ratio;
  if (!metres || !ratio || points.length < 3) return null;
  const aire = aireEnPourcents(points) * metres ** 2 * ratio;
  return Number.isFinite(aire) ? Math.round(aire * 100) / 100 : null;
}

async function recalculerSurfaces(etageId: number): Promise<void> {
  const etage = await lireEtage(etageId);
  if (!etage) return;
  const pieces = await db.query(
    'SELECT id, zone_points FROM site_pieces WHERE etage_id = ? AND zone_points IS NOT NULL',
    [etageId]
  );
  for (const p of pieces) {
    const points = lireJson<PointPlan[]>(p.zone_points) ?? [];
    await db.execute('UPDATE site_pieces SET surface_m2 = ? WHERE id = ?', [surfaceEnM2(points, etage), p.id]);
  }
}

/**
 * Pose, remplace ou efface la zone d'une pièce sur un étage de son bâtiment.
 *
 * `points` vide ou `null` efface la zone ; la pièce garde alors son étage.
 */
export async function definirZone(
  pieceId: number,
  saisie: { etageId?: unknown; points?: unknown }
): Promise<{ surfaceM2: number | null }> {
  const piece = await db.queryOne('SELECT id, site_id, etage_id FROM site_pieces WHERE id = ?', [pieceId]);
  if (!piece) throw new ErreurBatiment(404, 'Pièce introuvable');

  const etageId = saisie.etageId !== undefined ? nombreOuNull(saisie.etageId) : nombreOuNull(piece.etage_id);
  const etage = etageId ? await lireEtage(etageId) : null;
  if (etageId && (!etage || etage.siteId !== Number(piece.site_id))) {
    throw new ErreurBatiment(400, "Cet étage n'est pas dans le bâtiment de la pièce");
  }

  const zone = lireZone(saisie.points);
  if (zone.etat === 'refusee') {
    throw new ErreurBatiment(400, 'Une zone demande entre 3 et 500 points, en pourcentages du plan');
  }
  if (zone.etat === 'valide' && !etage) throw new ErreurBatiment(400, "Choisissez l'étage sur lequel la pièce est dessinée");

  const points = zone.etat === 'valide' ? zone.points : null;
  const surface = points && etage ? surfaceEnM2(points, etage) : null;

  if (zone.etat === 'absente') {
    await db.execute('UPDATE site_pieces SET etage_id = ? WHERE id = ?', [etageId, pieceId]);
    return { surfaceM2: null };
  }
  await db.execute('UPDATE site_pieces SET etage_id = ?, zone_points = ?, surface_m2 = ? WHERE id = ?', [
    etageId,
    points ? JSON.stringify(points) : null,
    surface,
    pieceId,
  ]);
  return { surfaceM2: surface };
}

/** Crée une pièce d'un geste, depuis le contour qu'on vient de tracer. */
export async function creerPieceSurPlan(
  etageId: number,
  saisie: { nom?: unknown; typeLieu?: unknown; points?: unknown }
): Promise<{ id: number; surfaceM2: number | null }> {
  const etage = await lireEtage(etageId);
  if (!etage) throw new ErreurBatiment(404, 'Étage introuvable');
  const nom = String(saisie.nom ?? '').trim().slice(0, 255);
  if (!nom) throw new ErreurBatiment(400, 'Le nom de la pièce est obligatoire');
  if (lireZone(saisie.points).etat !== 'valide') {
    throw new ErreurBatiment(400, 'Tracez le contour de la pièce avant de la créer');
  }

  const id = await creerPiece({
    siteId: etage.siteId,
    nom,
    typeLieu: saisie.typeLieu ? String(saisie.typeLieu).slice(0, 50) : null,
  });
  const { surfaceM2 } = await definirZone(id, { etageId, points: saisie.points });
  return { id, surfaceM2 };
}

// ============================================================ le matériel dans les pièces

export interface MaterielDansPiece {
  placementId: number;
  pieceId: number;
  objectId: number;
  nom: string;
  reference: string | null;
  image: string | null;
  unique: boolean;
  quantite: number;
  notes: string | null;
}

const SELECT_PLACEMENT = `SELECT pm.id, pm.piece_id, pm.object_id, pm.quantite, pm.notes,
       o.name, o.reference, o.image, o.material_type
  FROM piece_materiels pm
  JOIN objects o ON o.id = pm.object_id`;

const enPlacement = (l: any): MaterielDansPiece => ({
  placementId: Number(l.id),
  pieceId: Number(l.piece_id),
  objectId: Number(l.object_id),
  nom: l.name,
  reference: l.reference ?? null,
  image: l.image ?? null,
  unique: (l.material_type ?? 'unique') !== 'lot',
  quantite: Number(l.quantite),
  notes: l.notes ?? null,
});

export async function materielDeLaPiece(pieceId: number, lecteur?: AuthRequest): Promise<MaterielDansPiece[]> {
  const portee = await porteeDe(lecteur, 'o');
  if (portee === null) return [];
  return (
    await db.query(`${SELECT_PLACEMENT} WHERE pm.piece_id = ?${portee?.sql ?? ''} ORDER BY o.name`, [
      pieceId,
      ...(portee?.params ?? []),
    ])
  ).map(enPlacement);
}

/** Tout le matériel posé dans le bâtiment — pour « où est le vidéoprojecteur ? ». */
export async function materielDuBatiment(siteId: number, lecteur?: AuthRequest): Promise<MaterielDansPiece[]> {
  const portee = await porteeDe(lecteur, 'o');
  if (portee === null) return [];
  return (
    await db.query(
      `${SELECT_PLACEMENT} JOIN site_pieces p ON p.id = pm.piece_id
        WHERE p.site_id = ?${portee?.sql ?? ''} ORDER BY o.name`,
      [siteId, ...(portee?.params ?? [])]
    )
  ).map(enPlacement);
}

/**
 * Pose un matériel du parc dans une pièce.
 *
 * Un matériel **unique** déjà posé ailleurs n'est pas dupliqué : sans
 * `deplacer`, le refus dit où il est ; avec, il y est retiré. Un **lot** se
 * répartit ; reposé dans la même pièce, sa quantité s'y ajoute. La somme ne
 * dépasse pas la quantité du lot quand elle est connue.
 */
export async function placerMateriel(
  pieceId: number,
  saisie: { objectId?: unknown; quantite?: unknown; notes?: unknown; deplacer?: unknown },
  userId: number
): Promise<{ placementId: number; deplaceDe: string | null }> {
  const piece = await db.queryOne('SELECT id, name FROM site_pieces WHERE id = ?', [pieceId]);
  if (!piece) throw new ErreurBatiment(404, 'Pièce introuvable');
  const objectId = Number(saisie.objectId);
  const objet = Number.isInteger(objectId)
    ? await db.queryOne('SELECT id, name, material_type, quantity_total FROM objects WHERE id = ?', [objectId])
    : null;
  if (!objet) throw new ErreurBatiment(400, 'Matériel inconnu');

  const unique = (objet.material_type ?? 'unique') !== 'lot';
  const notes = saisie.notes === undefined || saisie.notes === null ? null : String(saisie.notes).trim().slice(0, 500) || null;
  const maintenant = versDateTime();

  if (unique) {
    const ailleurs = await db.queryOne(
      `SELECT pm.id, p.name AS piece_nom, s.name AS site_nom FROM piece_materiels pm
         JOIN site_pieces p ON p.id = pm.piece_id JOIN cle_sites s ON s.id = p.site_id
        WHERE pm.object_id = ? AND pm.piece_id <> ?`,
      [objectId, pieceId]
    );
    let deplaceDe: string | null = null;
    if (ailleurs) {
      const ou = `${ailleurs.piece_nom} — ${ailleurs.site_nom}`;
      if (!saisie.deplacer) throw new ErreurBatiment(409, `« ${objet.name} » est déjà dans ${ou}`);
      await db.execute('DELETE FROM piece_materiels WHERE id = ?', [ailleurs.id]);
      deplaceDe = ou;
    }
    const deja = await db.queryOne('SELECT id FROM piece_materiels WHERE piece_id = ? AND object_id = ?', [pieceId, objectId]);
    if (deja) return { placementId: Number(deja.id), deplaceDe };
    const r = await db.execute(
      `INSERT INTO piece_materiels (piece_id, object_id, quantite, notes, created_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      [pieceId, objectId, notes, userId, maintenant, maintenant]
    );
    return { placementId: Number(r.lastInsertRowid), deplaceDe };
  }

  const quantite = Number(saisie.quantite ?? 1);
  if (!Number.isInteger(quantite) || quantite < 1) throw new ErreurBatiment(400, 'La quantité est un entier positif');
  await verifierQuantite(objet, quantite, null);

  const deja = await db.queryOne('SELECT id, quantite FROM piece_materiels WHERE piece_id = ? AND object_id = ?', [
    pieceId,
    objectId,
  ]);
  if (deja) {
    await db.execute('UPDATE piece_materiels SET quantite = quantite + ?, updated_at = ? WHERE id = ?', [
      quantite,
      maintenant,
      deja.id,
    ]);
    return { placementId: Number(deja.id), deplaceDe: null };
  }
  const r = await db.execute(
    `INSERT INTO piece_materiels (piece_id, object_id, quantite, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pieceId, objectId, quantite, notes, userId, maintenant, maintenant]
  );
  return { placementId: Number(r.lastInsertRowid), deplaceDe: null };
}

/** Un lot ne se répartit pas au-delà de sa quantité, quand elle est connue. */
async function verifierQuantite(objet: any, ajout: number, horsPlacement: number | null): Promise<void> {
  const total = Number(objet.quantity_total ?? 0);
  if (!(total > 0)) return;
  const pose = await db.queryOne(
    `SELECT COALESCE(SUM(quantite), 0) AS n FROM piece_materiels WHERE object_id = ?${horsPlacement ? ' AND id <> ?' : ''}`,
    horsPlacement ? [objet.id, horsPlacement] : [objet.id]
  );
  const deja = Number(pose?.n ?? 0);
  if (deja + ajout > total) {
    throw new ErreurBatiment(
      409,
      `Le lot « ${objet.name} » compte ${total} unité(s), dont ${deja} déjà posée(s) : il en reste ${Math.max(0, total - deja)}`
    );
  }
}

export async function modifierPlacement(id: number, saisie: { quantite?: unknown; notes?: unknown }): Promise<void> {
  const ligne = await db.queryOne(
    `SELECT pm.id, o.id AS object_id, o.name, o.material_type, o.quantity_total
       FROM piece_materiels pm JOIN objects o ON o.id = pm.object_id WHERE pm.id = ?`,
    [id]
  );
  if (!ligne) throw new ErreurBatiment(404, 'Matériel introuvable dans cette pièce');
  const champs: string[] = [];
  const valeurs: unknown[] = [];
  if (saisie.quantite !== undefined && (ligne.material_type ?? 'unique') === 'lot') {
    const quantite = Number(saisie.quantite);
    if (!Number.isInteger(quantite) || quantite < 1) throw new ErreurBatiment(400, 'La quantité est un entier positif');
    await verifierQuantite({ id: ligne.object_id, name: ligne.name, quantity_total: ligne.quantity_total }, quantite, id);
    champs.push('quantite = ?');
    valeurs.push(quantite);
  }
  if (saisie.notes !== undefined) {
    champs.push('notes = ?');
    valeurs.push(saisie.notes === null ? null : String(saisie.notes).trim().slice(0, 500) || null);
  }
  if (champs.length === 0) return;
  await db.execute(`UPDATE piece_materiels SET ${champs.join(', ')}, updated_at = ? WHERE id = ?`, [
    ...valeurs,
    versDateTime(),
    id,
  ]);
}

export async function retirerPlacement(id: number): Promise<void> {
  await db.execute('DELETE FROM piece_materiels WHERE id = ?', [id]);
}

/** Les pièces où se trouve un matériel — la question posée depuis sa fiche. */
export async function piecesDuMateriel(objectId: number): Promise<
  Array<{ placementId: number; pieceId: number; pieceNom: string; siteId: number; siteNom: string; etage: string | null; quantite: number }>
> {
  const lignes = await db.query(
    `SELECT pm.id, pm.quantite, p.id AS piece_id, p.name AS piece_nom, s.id AS site_id, s.name AS site_nom,
            e.nom AS etage_nom
       FROM piece_materiels pm
       JOIN site_pieces p ON p.id = pm.piece_id
       JOIN cle_sites s ON s.id = p.site_id
       LEFT JOIN site_etages e ON e.id = p.etage_id
      WHERE pm.object_id = ?
      ORDER BY s.name, p.name`,
    [objectId]
  );
  return lignes.map((l: any) => ({
    placementId: Number(l.id),
    pieceId: Number(l.piece_id),
    pieceNom: l.piece_nom,
    siteId: Number(l.site_id),
    siteNom: l.site_nom,
    etage: l.etage_nom ?? null,
    quantite: Number(l.quantite),
  }));
}

// ============================================================ la fiche d'une pièce

/**
 * Les clés qui ouvrent une pièce, et qui les détient.
 *
 * Trois portées y répondent, comme pour une porte (`clesQuiOuvrent`) : le passe
 * du bâtiment, le passe de la pièce, et la clé de l'une de ses portes. Chacune
 * est dite, parce qu'« une clé de la porte du couloir » et « le passe général »
 * ne se prêtent pas pareil.
 */
export async function clesDeLaPiece(pieceId: number, lecteur?: AuthRequest): Promise<
  Array<{ id: number; nom: string; reference: string | null; portee: 'batiment' | 'piece' | 'porte'; porte: string | null; detenteurs: string[] }>
> {
  // Une clé est un matériel du parc : même portée par catégorie que le reste.
  const portee = await porteeDe(lecteur, 'ob');
  if (portee === null) return [];
  const lignes = await db.query(
    `SELECT DISTINCT ob.id, ob.name, ob.reference,
            CASE WHEN co.site_id IS NOT NULL THEN 'batiment'
                 WHEN co.piece_id IS NOT NULL THEN 'piece'
                 ELSE 'porte' END AS portee,
            ouv.name AS porte
       FROM cle_ouvre co
       JOIN objects ob ON ob.id = co.object_id
       JOIN site_pieces p ON p.id = ?
       LEFT JOIN cle_ouvrants ouv ON ouv.id = co.ouvrant_id
      WHERE (co.piece_id = p.id
         OR co.site_id = p.site_id
         OR ouv.piece_id = p.id)${portee?.sql ?? ''}
      ORDER BY ob.name`,
    [pieceId, ...(portee?.params ?? [])]
  );
  if (lignes.length === 0) return [];

  const detentions = await detenteursDe(lignes.map((l: any) => Number(l.id)));
  const nomDetenteur = (d: any): string =>
    d.holder_label ||
    [d.holder_first_name, d.holder_last_name].filter(Boolean).join(' ') ||
    d.holder_service_name ||
    (d.holder_ouvrant_name ? `${d.holder_ouvrant_name}${d.holder_site_name ? ` (${d.holder_site_name})` : ''}` : '') ||
    'Détenteur inconnu';

  return lignes.map((l: any) => ({
    id: Number(l.id),
    nom: l.name,
    reference: l.reference ?? null,
    portee: l.portee,
    porte: l.porte ?? null,
    detenteurs: (detentions.get(Number(l.id)) ?? detentions.get(l.id) ?? []).map(nomDetenteur),
  }));
}

export async function ficheDePiece(pieceId: number, lecteur?: AuthRequest) {
  const piece = await db.queryOne(
    `SELECT p.*, e.nom AS etage_nom FROM site_pieces p LEFT JOIN site_etages e ON e.id = p.etage_id WHERE p.id = ?`,
    [pieceId]
  );
  if (!piece) return null;

  const [materiels, cles, portes, documents] = await Promise.all([
    materielDeLaPiece(pieceId, lecteur),
    clesDeLaPiece(pieceId, lecteur),
    db.query('SELECT id, name, code FROM cle_ouvrants WHERE piece_id = ? ORDER BY sort_order, name', [pieceId]),
    db.query(
      `SELECT d.id, d.titre, d.date_document, r.libelle AS rubrique
         FROM batiment_documents d LEFT JOIN batiment_rubriques r ON r.id = d.rubrique_id
        WHERE d.piece_id = ? AND d.statut = 'valide'
        ORDER BY COALESCE(d.date_document, '') DESC, d.id DESC LIMIT 50`,
      [pieceId]
    ),
  ]);

  return {
    piece: {
      id: Number(piece.id),
      siteId: Number(piece.site_id),
      nom: piece.name,
      code: piece.code ?? null,
      typeLieu: piece.type_lieu ?? null,
      capacite: nombreOuNull(piece.capacite),
      etageId: nombreOuNull(piece.etage_id),
      etageNom: piece.etage_nom ?? null,
      surfaceM2: nombreOuNull(piece.surface_m2),
      aUneZone: Boolean(piece.zone_points),
    },
    materiels,
    cles,
    portes: portes.map((o: any) => ({ id: Number(o.id), nom: o.name, code: o.code ?? null })),
    documents: documents.map((d: any) => ({
      id: Number(d.id),
      titre: d.titre,
      date: d.date_document ?? null,
      rubrique: d.rubrique ?? null,
    })),
  };
}

// ============================================================ les fichiers de plan

/** Le chemin complet d'un plan du dossier privé, ou `null` — même garde que les documents. */
export function cheminPlanPrive(chemin: string | null | undefined): string | null {
  if (!chemin) return null;
  try {
    const racine = path.resolve(dossierPrive(SOUS_DOSSIER_PLANS));
    const complet = path.resolve(racine, chemin);
    if (!complet.startsWith(racine + path.sep)) return null;
    return fs.existsSync(complet) ? complet : null;
  } catch {
    return null;
  }
}

export function supprimerPlanPrive(chemin: string | null | undefined): void {
  const complet = cheminPlanPrive(chemin);
  if (!complet) return;
  try {
    fs.unlinkSync(complet);
  } catch (erreur: any) {
    console.error('Plan non supprimé :', erreur?.message ?? erreur);
  }
}
