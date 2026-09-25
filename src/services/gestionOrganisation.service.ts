import type { NextFunction, Response } from 'express';
import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';

/**
 * Qui gère les bâtiments, les salles et les services.
 *
 * Le rôle ne suffisait pas à le dire. Confier les salles au régisseur, ou la
 * composition du service des sports à son chef, obligeait à les faire
 * superviseur ou administrateur — et donc à leur donner au passage la
 * suppression du matériel, les seuils d'alerte ou la configuration. On leur
 * donnait tout pour qu'ils puissent faire une chose.
 *
 * ## Deux niveaux
 *
 *   **global**  `users.gere_organisation` — tous les bâtiments, toutes les
 *               salles, tous les services. Le superviseur l'est d'office pour
 *               les lieux, qu'il gérait déjà : lui retirer serait une
 *               régression, pas une délégation.
 *
 *   **local**   `user_sites.gere_lieu` — un bâtiment, ses salles et ses portes ;
 *               `service_members.is_manager` — les membres d'un service.
 *
 * ## Ce qu'un gestionnaire local ne peut pas faire
 *
 * **S'étendre lui-même.** Le gestionnaire d'un bâtiment ne peut pas accorder
 * `gere_lieu`, ni créer un bâtiment : il gérerait alors ce qu'il vient de se
 * donner. Le responsable d'un service ne désigne pas d'autre responsable, ne
 * touche pas au périmètre de catégories — qui décide des manifestations dont le
 * service est saisi — ni à sa propre appartenance. C'est la règle déjà tenue
 * pour les plannings : pouvoir s'attribuer des agents reviendrait à élargir seul
 * son périmètre.
 *
 * Les modèles de documents d'un service restent à l'administrateur : ils
 * touchent à Nextcloud et au stockage, pas à l'organisation.
 */

interface Appelant {
  userId: number;
  role: string;
}

/** Le compte coche-t-il « gère l'organisation » ? Colonne absente = non. */
async function estGestionnaireGlobal(userId: number): Promise<boolean> {
  try {
    const ligne = await db.queryOne('SELECT gere_organisation FROM users WHERE id = ?', [userId]);
    return Boolean(Number(ligne?.gere_organisation ?? 0));
  } catch {
    // Base pas encore migrée : personne n'a ce droit.
    return false;
  }
}

/** Tous les bâtiments, toutes les salles, toutes les portes. */
export async function peutGererLieux(appelant: Appelant | undefined): Promise<boolean> {
  if (!appelant) return false;
  if (appelant.role === 'admin' || appelant.role === 'supervisor') return true;
  return estGestionnaireGlobal(appelant.userId);
}

/** Créer, modifier, supprimer n'importe quel service. */
export async function peutGererServices(appelant: Appelant | undefined): Promise<boolean> {
  if (!appelant) return false;
  if (appelant.role === 'admin') return true;
  return estGestionnaireGlobal(appelant.userId);
}

/** Ce bâtiment-là : lui, ses salles, ses portes, les personnes qui y sont rattachées. */
export async function peutGererSite(
  appelant: Appelant | undefined,
  siteId: number | null
): Promise<boolean> {
  if (!appelant) return false;
  if (await peutGererLieux(appelant)) return true;
  if (!siteId) return false;
  return (await sitesGeresPar(appelant.userId)).includes(Number(siteId));
}

/** Les membres de ce service-là. */
export async function peutGererService(
  appelant: Appelant | undefined,
  serviceId: number | null
): Promise<boolean> {
  if (!appelant) return false;
  if (await peutGererServices(appelant)) return true;
  if (!serviceId) return false;
  return (await servicesGeresPar(appelant.userId)).includes(Number(serviceId));
}

/** Les bâtiments dont ce compte est gestionnaire local. */
export async function sitesGeresPar(userId: number): Promise<number[]> {
  try {
    const lignes = await db.query('SELECT site_id FROM user_sites WHERE user_id = ? AND gere_lieu = 1', [
      userId,
    ]);
    return lignes.map((l: any) => Number(l.site_id));
  } catch {
    return [];
  }
}

/**
 * Les bâtiments que ce compte **consulte** : ceux qu'il gère, et ceux dont il
 * est responsable.
 *
 * La directrice d'une école n'en gère pas le référentiel — elle ne crée ni
 * salle ni porte — mais c'est elle qui rédige le PPMS et consigne les exercices
 * d'évacuation. Elle doit donc voir les contrôles de son école et y déposer ses
 * rapports, qu'un gestionnaire validera. `est_responsable` le dit déjà pour les
 * demandes (migration 035) ; il le dit ici pour les contrôles.
 */
export async function sitesConsultesPar(userId: number): Promise<number[]> {
  try {
    const lignes = await db.query(
      'SELECT site_id FROM user_sites WHERE user_id = ? AND (gere_lieu = 1 OR est_responsable = 1)',
      [userId]
    );
    return lignes.map((l: any) => Number(l.site_id));
  } catch {
    // Base pas encore migrée : on retombe sur les seuls bâtiments gérés.
    return sitesGeresPar(userId);
  }
}

/** Voir ce bâtiment dans le module Bâtiments : ses contrôles, ses documents. */
export async function peutConsulterSite(
  appelant: Appelant | undefined,
  siteId: number | null
): Promise<boolean> {
  if (!appelant) return false;
  if (await peutGererSite(appelant, siteId)) return true;
  if (!siteId) return false;
  return (await sitesConsultesPar(appelant.userId)).includes(Number(siteId));
}

/** Les services dont ce compte est responsable. */
export async function servicesGeresPar(userId: number): Promise<number[]> {
  const lignes = await db.query(
    'SELECT service_id FROM service_members WHERE user_id = ? AND is_manager = 1',
    [userId]
  );
  return lignes.map((l: any) => Number(l.service_id));
}

/**
 * Ce que l'interface doit savoir pour n'afficher que ce que le serveur
 * accepterait. Lu une fois, à la connexion, par `/auth/me`.
 */
export async function perimetreDeGestion(appelant: Appelant): Promise<{
  gereOrganisation: boolean;
  gereLieux: boolean;
  gereServices: boolean;
  sitesGeres: number[];
  /** Gérés ou dont le compte est responsable : ce que le module Bâtiments lui montre. */
  sitesConsultes: number[];
  servicesGeres: number[];
}> {
  const [gereOrganisation, gereLieux, gereServices, sitesGeres, sitesConsultes, servicesGeres] =
    await Promise.all([
      estGestionnaireGlobal(appelant.userId),
      peutGererLieux(appelant),
      peutGererServices(appelant),
      sitesGeresPar(appelant.userId),
      sitesConsultesPar(appelant.userId),
      servicesGeresPar(appelant.userId),
    ]);
  return { gereOrganisation, gereLieux, gereServices, sitesGeres, sitesConsultes, servicesGeres };
}

// ------------------------------------------------------------------ les gardes

/** Garde de gestion, portant ce qu'elle protège pour que les tests le vérifient. */
export interface GardeGestion {
  (req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
  /** `lieux`, `services`, `site`, `service`, ou `consultation` d'un bâtiment. */
  gestion: 'lieux' | 'services' | 'site' | 'service' | 'consultation';
}

const REFUS = "Vous ne gérez pas cet élément de l'organisation";

function garde(
  gestion: GardeGestion['gestion'],
  verifier: (req: AuthRequest) => Promise<boolean>
): GardeGestion {
  const g = (async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }
    try {
      if (await verifier(req)) {
        next();
        return;
      }
      res.status(403).json({ success: false, message: REFUS });
    } catch (erreur) {
      console.error('Erreur de contrôle des droits de gestion :', erreur);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }) as GardeGestion;
  g.gestion = gestion;
  return g;
}

export const requireGestionLieux = garde('lieux', (req) => peutGererLieux(req.user));

export const requireGestionServices = garde('services', (req) => peutGererServices(req.user));

/**
 * Le bâtiment concerné se lit différemment selon la route — `:id` d'un
 * bâtiment, `siteId` du corps à la création d'une salle, le bâtiment d'une
 * salle ou d'une porte existante. La route donne sa lecture.
 */
export function requireGestionSite(
  lireSiteId: (req: AuthRequest) => Promise<number | null> | number | null
): GardeGestion {
  return garde('site', async (req) => peutGererSite(req.user, await lireSiteId(req)));
}

/**
 * Consulter un bâtiment : le gérer, ou en être responsable.
 *
 * Plus large que `requireGestionSite`, et réservée aux lectures et aux dépôts
 * qui passent par une validation — jamais à ce qui modifie le référentiel.
 */
export function requireConsultationSite(
  lireSiteId: (req: AuthRequest) => Promise<number | null> | number | null
): GardeGestion {
  return garde('consultation', async (req) => peutConsulterSite(req.user, await lireSiteId(req)));
}

export function requireGestionService(
  lireServiceId: (req: AuthRequest) => number | null = (req) => Number(req.params.id) || null
): GardeGestion {
  return garde('service', (req) => peutGererService(req.user, lireServiceId(req)));
}

// --------------------------------------------- lectures du bâtiment concerné

export const siteDuParametre = (req: AuthRequest): number | null => Number(req.params.id) || null;

export const siteDuCorps = (req: AuthRequest): number | null => Number(req.body?.siteId) || null;

export async function siteDeLaPiece(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne('SELECT site_id FROM site_pieces WHERE id = ?', [req.params.id]);
  return ligne ? Number(ligne.site_id) : null;
}

export async function siteDeLOuvrant(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne('SELECT site_id FROM cle_ouvrants WHERE id = ?', [req.params.id]);
  return ligne ? Number(ligne.site_id) : null;
}

/** Le bâtiment d'un document du module Bâtiments. */
export async function siteDuDocument(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne('SELECT site_id FROM batiment_documents WHERE id = ?', [req.params.id]);
  return ligne ? Number(ligne.site_id) : null;
}

/** Le bâtiment d'un étage. */
export async function siteDeLEtage(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne('SELECT site_id FROM site_etages WHERE id = ?', [req.params.id]);
  return ligne ? Number(ligne.site_id) : null;
}

/** Le bâtiment d'un matériel posé dans une pièce. */
export async function siteDuPlacement(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne(
    'SELECT p.site_id FROM piece_materiels pm JOIN site_pieces p ON p.id = pm.piece_id WHERE pm.id = ?',
    [req.params.id]
  );
  return ligne ? Number(ligne.site_id) : null;
}

/** Le bâtiment d'un suivi de contrôle. */
export async function siteDuSuivi(req: AuthRequest): Promise<number | null> {
  const ligne = await db.queryOne('SELECT site_id FROM batiment_suivis WHERE id = ?', [req.params.id]);
  return ligne ? Number(ligne.site_id) : null;
}
