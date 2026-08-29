import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { servicesDe } from '../services/manifestationServices.service';
import slugify from '../utils/slugify';

/**
 * Services concernés par les manifestations.
 *
 * Un service est un groupe de personnes **et** un périmètre de catégories de
 * matériel. C'est ce périmètre qui décide qui est sollicité : le service
 * informatique n'est ni alerté ni destinataire d'une brocante qui ne demande
 * aucun matériel informatique.
 *
 * Un service *observateur* — direction générale, élus — n'a pas de périmètre :
 * il suit tout, sans rien approuver.
 */

const router = Router();

/** Détail d'un service, avec son périmètre et ses membres. */
async function lireService(id: number | string): Promise<any | null> {
  const service = await db.queryOne('SELECT * FROM services WHERE id = ?', [id]);
  if (!service) return null;

  const categories = await db.query(
    `SELECT c.id, c.name FROM service_categories sc
     JOIN categories c ON c.id = sc.category_id
     WHERE sc.service_id = ? ORDER BY c.name`,
    [id]
  );
  const membres = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, sm.is_manager
     FROM service_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.service_id = ? ORDER BY u.last_name, u.first_name`,
    [id]
  );

  return { ...service, categories, members: membres };
}

/**
 * GET / - Liste des services.
 *
 * Ouverte à tout compte authentifié : les noms de service apparaissent dans le
 * suivi d'une manifestation, et un membre doit pouvoir savoir à qui il parle.
 * La composition détaillée reste réservée à l'administrateur.
 */
router.get('/', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const services = await db.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM service_members sm WHERE sm.service_id = s.id) as members_count,
        (SELECT COUNT(*) FROM service_categories sc WHERE sc.service_id = s.id) as categories_count
       FROM services s ORDER BY s.name`
    );
    res.json({ success: true, data: services });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /mine - Services auxquels appartient le compte courant. */
router.get('/mine', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await servicesDe(req.user!.userId) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const service = await lireService(req.params.id);
    if (!service) return res.status(404).json({ success: false, message: 'Service non trouvé' });
    res.json({ success: true, data: service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, description, is_observer, is_active } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const maintenant = new Date().toISOString();
    const resultat = await db.execute(
      `INSERT INTO services (name, slug, email, description, is_observer, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        slugify(name),
        email?.trim() || null,
        description?.trim() || null,
        is_observer ? 1 : 0,
        is_active === false ? 0 : 1,
        maintenant,
        maintenant,
      ]
    );

    await logService.success('user', `Service créé : ${name}`, {}, { userId: req.user?.userId });
    res.status(201).json({ success: true, data: await lireService(resultat.lastInsertRowid) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Un service porte déjà ce nom'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, email, description, is_observer, is_active,
      notify_new_request, notify_status_change, notify_material_change, notify_message,
    } = req.body;

    // Un réglage absent vaut « activé » : couper une notification doit être un
    // geste explicite, jamais la conséquence d'un champ oublié.
    const actif = (valeur: unknown) => (valeur === false || valeur === 0 ? 0 : 1);

    const resultat = await db.execute(
      `UPDATE services SET name = ?, email = ?, description = ?, is_observer = ?, is_active = ?,
         notify_new_request = ?, notify_status_change = ?, notify_material_change = ?, notify_message = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        name, email?.trim() || null, description?.trim() || null,
        is_observer ? 1 : 0, is_active === false ? 0 : 1,
        actif(notify_new_request), actif(notify_status_change),
        actif(notify_material_change), actif(notify_message),
        new Date().toISOString(), req.params.id,
      ]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Service non trouvé' });
    }
    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Un service qui a rendu des décisions fait partie de la traçabilité d'une
    // manifestation : le supprimer effacerait qui a approuvé quoi. On le
    // désactive, ce qui l'écarte des prochaines sollicitations sans réécrire
    // le passé.
    const decisions = await db.queryOne(
      "SELECT COUNT(*) as cnt FROM manifestation_approvals WHERE service_id = ? AND status != 'pending'",
      [req.params.id]
    );
    if (decisions?.cnt > 0) {
      await db.execute('UPDATE services SET is_active = 0, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        req.params.id,
      ]);
      return res.json({
        success: true,
        desactive: true,
        message: `Ce service a rendu ${decisions.cnt} décision(s) : il a été désactivé plutôt que supprimé, pour ne pas effacer la traçabilité`,
      });
    }

    const resultat = await db.execute('DELETE FROM services WHERE id = ?', [req.params.id]);
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Service non trouvé' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== PÉRIMÈTRE ========================

/**
 * PUT /:id/categories - Périmètre de matériel du service.
 *
 * Remplace la liste entière : c'est la forme que prend l'écran, une grille de
 * cases à cocher.
 */
router.put('/:id/categories', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { category_ids } = req.body;
    if (!Array.isArray(category_ids)) {
      return res.status(400).json({ success: false, message: 'Liste de catégories requise' });
    }

    await db.execute('DELETE FROM service_categories WHERE service_id = ?', [req.params.id]);
    for (const categoryId of category_ids) {
      await db.execute(
        'INSERT INTO service_categories (service_id, category_id) VALUES (?, ?)',
        [req.params.id, categoryId]
      );
    }

    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MEMBRES ========================

router.post('/:id/members', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, is_manager } = req.body;
    const utilisateur = await db.queryOne('SELECT id FROM users WHERE id = ?', [user_id]);
    if (!utilisateur) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    await db.execute(
      'INSERT INTO service_members (service_id, user_id, is_manager, created_at) VALUES (?, ?, ?, ?)',
      [req.params.id, user_id, is_manager ? 1 : 0, new Date().toISOString()]
    );
    res.status(201).json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Cette personne est déjà membre du service'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

router.delete('/:id/members/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM service_members WHERE service_id = ? AND user_id = ?',
      [req.params.id, req.params.userId]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Membre non trouvé' });
    }
    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
