import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// GET /api/permissions/group/:role - Récupérer les permissions d'un groupe
router.get('/group/:role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.params;

    if (!['supervisor', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    }

    // Récupérer les permissions du groupe
    const permissions = await db.query(
      `SELECT * FROM group_permissions WHERE role = ?`,
      [role]
    );

    res.json({
      success: true,
      permissions: permissions.map((p: any) => ({
        categoryId: p.category_id,
        canView: !!p.can_view,
        canEdit: !!p.can_edit,
        canDelete: !!p.can_delete
      }))
    });
  } catch (error: any) {
    console.error('Erreur get group permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/permissions/group/:role - Mettre à jour les permissions d'un groupe
router.put('/group/:role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.params;
    const { permissions } = req.body;

    if (!['supervisor', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    }

    // Supprimer les anciennes permissions du groupe
    await db.execute('DELETE FROM group_permissions WHERE role = ?', [role]);

    // Ajouter les nouvelles permissions
    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) {
        await db.execute(
          `INSERT INTO group_permissions (role, category_id, can_view, can_edit, can_delete) 
           VALUES (?, ?, ?, ?, ?)`,
          [role, perm.categoryId, perm.canView ? 1 : 0, perm.canEdit ? 1 : 0, perm.canDelete ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Permissions du groupe mises à jour' });
  } catch (error: any) {
    console.error('Erreur update group permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/user/:userId - Récupérer les permissions d'un utilisateur
router.get('/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    const permissions = await db.query(
      `SELECT up.*, c.name as category_name 
       FROM user_permissions up 
       LEFT JOIN categories c ON c.id = up.category_id
       WHERE up.user_id = ?`,
      [userId]
    );

    res.json({
      success: true,
      permissions: permissions.map((p: any) => ({
        categoryId: p.category_id,
        categoryName: p.category_name,
        canView: !!p.can_view,
        canEdit: !!p.can_edit,
        canDelete: !!p.can_delete
      }))
    });
  } catch (error: any) {
    console.error('Erreur get user permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/effective/:userId - Récupérer les permissions effectives d'un utilisateur
// (combinaison des permissions groupe + individuelles)
router.get('/effective/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    // Récupérer l'utilisateur et son rôle
    const user = await db.queryOne('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Admin a tous les droits
    if (user.role === 'admin') {
      const categories = await db.query('SELECT id FROM categories');
      return res.json({
        success: true,
        permissions: categories.map((c: any) => ({
          categoryId: c.id,
          canView: true,
          canEdit: true,
          canDelete: true
        }))
      });
    }

    // Récupérer les permissions du groupe
    const groupPerms = await db.query(
      'SELECT * FROM group_permissions WHERE role = ?',
      [user.role]
    );

    // Récupérer les permissions individuelles
    const userPerms = await db.query(
      'SELECT * FROM user_permissions WHERE user_id = ?',
      [userId]
    );

    // Combiner les permissions (l'individuel s'ajoute au groupe)
    const effectivePerms: { [key: number]: { canView: boolean; canEdit: boolean; canDelete: boolean } } = {};

    // D'abord les permissions de groupe
    for (const gp of groupPerms) {
      effectivePerms[gp.category_id] = {
        canView: !!gp.can_view,
        canEdit: !!gp.can_edit,
        canDelete: !!gp.can_delete
      };
    }

    // Puis les permissions individuelles (OR logique)
    for (const up of userPerms) {
      if (!effectivePerms[up.category_id]) {
        effectivePerms[up.category_id] = { canView: false, canEdit: false, canDelete: false };
      }
      effectivePerms[up.category_id].canView = effectivePerms[up.category_id].canView || !!up.can_view;
      effectivePerms[up.category_id].canEdit = effectivePerms[up.category_id].canEdit || !!up.can_edit;
      effectivePerms[up.category_id].canDelete = effectivePerms[up.category_id].canDelete || !!up.can_delete;
    }

    res.json({
      success: true,
      permissions: Object.entries(effectivePerms).map(([categoryId, perms]) => ({
        categoryId: parseInt(categoryId),
        ...perms
      }))
    });
  } catch (error: any) {
    console.error('Erreur get effective permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
