import { Router, Response } from 'express';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireAdmin,
  requireSupervisor,
} from '../middleware/auth.middleware';
import { listerSites, lireSite, ouvrantsDe, sitesDe, sitesProposesA, usagesSite } from '../services/sites.service';
import { versDateTime } from '../services/tickets.service';

/**
 * Les sites et bâtiments de la commune.
 *
 * Le référentiel est physiquement celui du module Clés (`cle_sites`, migration
 * 024) : il porte déjà la mairie, la salle des fêtes et le centre de loisirs.
 * Cette route est la porte partagée, ouverte le jour où les demandes ont eu
 * besoin de désigner un lieu. Voir `sites.service.ts` pour la raison du nom.
 *
 * `/mes-sites` est déclarée **avant** `/:id` : Express résout dans l'ordre de
 * déclaration, et `/:id` avalerait autrement le chemin littéral.
 */

const router = Router();

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

/**
 * Mes bâtiments, et ce que le formulaire doit en faire.
 *
 * `impose` porte la réponse à « un utilisateur peut avoir que 1 bâtiment mais
 * aussi plusieurs » : renseigné, l'écran masque le champ et retient la valeur.
 * Le calcul est fait ici pour que les deux écrans qui en ont besoin — le
 * formulaire et la fiche — ne le refassent pas chacun à leur façon.
 */
router.get('/mes-sites', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const rattaches = await sitesDe(req.user!.userId);
    const proposes = await sitesProposesA(req.user!.userId);
    res.json({
      success: true,
      sites: proposes,
      rattaches,
      impose: proposes.length === 1 ? proposes[0].id : null,
      // Les bâtiments dont je lis les demandes des collègues.
      partages: rattaches.filter((s) => s.peutVoirTickets).map((s) => s.id),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture de mes sites :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, sites: await listerSites(req.query.tous === 'true') });
  } catch (erreur: any) {
    console.error('Erreur liste des sites :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');
    res.json({ success: true, site, ouvrants: await ouvrantsDe(req.params.id) });
  } catch (erreur: any) {
    console.error('Erreur lecture de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/:id/ouvrants', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ouvrants: await ouvrantsDe(req.params.id) });
  } catch (erreur: any) {
    console.error('Erreur lecture des ouvrants :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Qui est rattaché à ce bâtiment — pour l'écran de réglage. */
router.get('/:id/membres', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const membres = await db.query(
      `SELECT us.id, us.user_id, us.peut_voir_tickets, u.first_name, u.last_name, u.email
         FROM user_sites us
         JOIN users u ON u.id = us.user_id
        WHERE us.site_id = ?
        ORDER BY u.last_name ASC, u.first_name ASC`,
      [req.params.id]
    );
    res.json({
      success: true,
      membres: membres.map((m: any) => ({
        id: Number(m.id),
        userId: Number(m.user_id),
        nom: [m.first_name, m.last_name].filter(Boolean).join(' ').trim(),
        email: m.email ?? null,
        peutVoirTickets: Boolean(m.peut_voir_tickets),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des membres du site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const nom = String(req.body?.nom ?? '').trim();
    if (!nom) return refuser(res, 400, 'Le nom est obligatoire');

    const maintenant = versDateTime();
    const resultat = await db.execute(
      `INSERT INTO cle_sites (name, code, address, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [nom, req.body?.code ?? null, req.body?.adresse ?? null, Number(req.body?.ordre ?? 0), maintenant, maintenant]
    );
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    console.error('Erreur création de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');

    const colonnes: string[] = [];
    const params: any[] = [];
    const poser = (colonne: string, valeur: any) => {
      colonnes.push(`${colonne} = ?`);
      params.push(valeur);
    };

    if (req.body?.nom !== undefined) poser('name', String(req.body.nom).trim());
    if (req.body?.code !== undefined) poser('code', req.body.code);
    if (req.body?.adresse !== undefined) poser('address', req.body.adresse);
    if (req.body?.ordre !== undefined) poser('sort_order', Number(req.body.ordre));
    if (req.body?.actif !== undefined) poser('is_active', req.body.actif ? 1 : 0);

    if (colonnes.length === 0) return res.json({ success: true });

    poser('updated_at', versDateTime());
    await db.execute(`UPDATE cle_sites SET ${colonnes.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur modification de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Supprime un bâtiment — seulement s'il ne sert à rien.
 *
 * Un site cité par une demande ou ouvert par une clé ne se supprime pas :
 * l'effacer emporterait le lieu de l'historique qu'on veut justement pouvoir
 * relire. L'écran propose de le désactiver, ce qui le retire des formulaires
 * sans toucher au passé.
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');

    const usages = await usagesSite(req.params.id);
    const empeche = Object.entries(usages).filter(([, n]) => n > 0);
    if (empeche.length > 0) {
      const detail = empeche.map(([quoi, n]) => `${n} ${quoi}`).join(', ');
      return refuser(res, 409, `Ce bâtiment est encore employé (${detail}) : désactivez-le plutôt`);
    }

    await db.execute('DELETE FROM cle_sites WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Bâtiment supprimé' });
  } catch (erreur: any) {
    console.error('Erreur suppression de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

export default router;
