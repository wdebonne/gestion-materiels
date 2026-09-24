import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import {
  peutGererLieux,
  perimetreDeGestion,
  sitesGeresPar,
} from '../services/gestionOrganisation.service';
import { listerSalles } from '../services/lieux.service';

/**
 * L'organisation de la commune : ses bâtiments, ses salles, ses services — et
 * qui les gère.
 *
 * Les référentiels eux-mêmes restent servis là où ils l'étaient
 * (`/api/sites`, `/api/cles`, `/api/services`) : ce routeur ne porte que ce qui
 * n'avait pas de place ailleurs, c'est-à-dire la délégation de leur gestion et
 * la vue transversale des salles.
 */

const router = Router();

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

function nomDe(u: any): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `#${u.id}`;
}

/** Ce que je gère — l'interface n'affiche que ce que le serveur acceptera. */
router.get('/moi', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await perimetreDeGestion(req.user!)) });
  } catch (erreur: any) {
    console.error('Erreur lecture du périmètre de gestion :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Les personnes qu'on peut rattacher à un bâtiment ou ajouter à un service.
 *
 * `/api/users` est réservé à l'encadrement : la directrice qui gère son école,
 * ou le responsable des sports, n'y a pas accès, et ne pourrait donc ajouter
 * personne. On leur ouvre ici le strict nécessaire — un nom et une adresse,
 * des seuls comptes actifs qui se connectent — à condition qu'ils gèrent
 * quelque chose.
 */
router.get('/personnes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const p = await perimetreDeGestion(req.user!);
    const gere = p.gereLieux || p.gereServices || p.sitesGeres.length > 0 || p.servicesGeres.length > 0;
    if (!gere) return refuser(res, 403, "Vous ne gérez rien dans l'organisation");

    const personnes = await db.query(
      `SELECT id, first_name, last_name, email FROM users
        WHERE is_active = 1 AND can_login = 1
        ORDER BY last_name, first_name`
    );
    res.json({
      success: true,
      personnes: personnes.map((u: any) => ({ userId: Number(u.id), nom: nomDe(u), email: u.email ?? null })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des personnes :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Qui gère quoi, sur un seul écran.
 *
 * Réservé à l'administrateur : c'est lui qui fait les gestionnaires globaux, et
 * la vue d'ensemble sert d'abord à repérer un bâtiment ou un service que
 * personne ne tient.
 */
router.get('/gestionnaires', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [globaux, batiments, rattachements, services, responsables] = await Promise.all([
      db.query(
        `SELECT id, first_name, last_name, email, role FROM users
          WHERE gere_organisation = 1 AND is_active = 1
          ORDER BY last_name, first_name`
      ),
      db.query('SELECT id, name, is_active FROM cle_sites ORDER BY sort_order, name'),
      db.query(
        `SELECT us.site_id, u.id, u.first_name, u.last_name, u.email
           FROM user_sites us JOIN users u ON u.id = us.user_id
          WHERE us.gere_lieu = 1
          ORDER BY u.last_name, u.first_name`
      ),
      db.query('SELECT id, name, is_active FROM services ORDER BY name'),
      db.query(
        `SELECT sm.service_id, u.id, u.first_name, u.last_name, u.email
           FROM service_members sm JOIN users u ON u.id = sm.user_id
          WHERE sm.is_manager = 1
          ORDER BY u.last_name, u.first_name`
      ),
    ]);

    const personne = (u: any) => ({ userId: Number(u.id), nom: nomDe(u), email: u.email ?? null });

    res.json({
      success: true,
      globaux: globaux.map((u: any) => ({ ...personne(u), role: u.role })),
      batiments: batiments.map((b: any) => ({
        siteId: Number(b.id),
        nom: b.name,
        actif: b.is_active === undefined || b.is_active === null ? true : Boolean(Number(b.is_active)),
        gestionnaires: rattachements.filter((r: any) => Number(r.site_id) === Number(b.id)).map(personne),
      })),
      services: services.map((s: any) => ({
        serviceId: Number(s.id),
        nom: s.name,
        actif: s.is_active === undefined || s.is_active === null ? true : Boolean(Number(s.is_active)),
        responsables: responsables
          .filter((r: any) => Number(r.service_id) === Number(s.id))
          .map(personne),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des gestionnaires :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Faire ou défaire un gestionnaire de toute l'organisation. */
router.put('/gestionnaires/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const compte = await db.queryOne('SELECT id, can_login FROM users WHERE id = ?', [req.params.userId]);
    if (!compte) return refuser(res, 404, 'Compte introuvable');

    const gere = Boolean(req.body?.gereOrganisation);
    // Une fiche d'annuaire ne se connecte pas : elle ne gérerait rien.
    if (gere && !Number(compte.can_login)) {
      return refuser(res, 400, 'Cette personne n’a pas de compte : elle ne pourrait pas se connecter pour gérer');
    }

    await db.execute('UPDATE users SET gere_organisation = ? WHERE id = ?', [gere ? 1 : 0, compte.id]);
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur désignation d’un gestionnaire :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Toutes les salles, tous bâtiments confondus.
 *
 * Lisible par tout compte connecté, comme l'arbre des lieux. `modifiable` dit
 * à l'écran lesquelles cet appelant peut changer : toutes pour un gestionnaire
 * global, celles de ses bâtiments pour un gestionnaire local.
 */
router.get('/salles', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const salles = await listerSalles(req.query.tous === 'true');
    const global = await peutGererLieux(req.user);
    const miens = global ? [] : await sitesGeresPar(req.user!.userId);
    res.json({
      success: true,
      salles: salles.map((s) => ({ ...s, modifiable: global || miens.includes(s.siteId) })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des salles :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

export default router;
