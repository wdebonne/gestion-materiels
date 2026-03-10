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

    // Seul un admin ou l'utilisateur lui-même peut consulter ses permissions effectives
    if (req.user!.role !== 'admin' && req.user!.userId !== parseInt(userId)) {
      return res.status(403).json({ success: false, message: 'Accès refusé - Vous ne pouvez consulter que vos propres permissions' });
    }

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

// ==================== PERMISSIONS MODULES ====================

// GET /api/permissions/modules - Liste des modules disponibles
router.get('/modules', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const modules = [
      { name: 'tracking', label: 'Suivi des coûts', description: 'Accès au module de suivi des dépenses, carburant, entretiens et contrôles techniques' }
    ];
    res.json({ success: true, modules });
  } catch (error: any) {
    console.error('Erreur get modules:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== PERMISSIONS PLUGINS ====================

// GET /api/permissions/plugins - Récupérer les permissions plugins pour tous les rôles
router.get('/plugins', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const plugins = await db.query('SELECT id, name, slug, icon, plugin_type, is_active FROM plugins ORDER BY name');
    const permissions = await db.query('SELECT * FROM plugin_permissions');

    // Structurer : { pluginId: { supervisor: { canAccess }, user: { canAccess } } }
    const permMap: Record<number, Record<string, boolean>> = {};
    for (const p of permissions) {
      if (!permMap[p.plugin_id]) permMap[p.plugin_id] = {};
      permMap[p.plugin_id][p.role] = !!p.can_access;
    }

    res.json({
      success: true,
      plugins: plugins.map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        icon: p.icon,
        pluginType: p.plugin_type,
        isActive: !!p.is_active,
        permissions: {
          supervisor: permMap[p.id]?.supervisor ?? true,
          user: permMap[p.id]?.user ?? true
        }
      }))
    });
  } catch (error: any) {
    console.error('Erreur get plugin permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/permissions/plugins/:pluginId/role/:role - Mettre à jour la permission plugin d'un rôle
router.put('/plugins/:pluginId/role/:role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { pluginId, role } = req.params;
    const { canAccess } = req.body;

    if (!['supervisor', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    }

    const existing = await db.queryOne(
      'SELECT id FROM plugin_permissions WHERE plugin_id = ? AND role = ?',
      [pluginId, role]
    );

    if (existing) {
      await db.execute(
        'UPDATE plugin_permissions SET can_access = ?, updated_at = ? WHERE plugin_id = ? AND role = ?',
        [canAccess ? 1 : 0, new Date().toISOString(), pluginId, role]
      );
    } else {
      await db.execute(
        'INSERT INTO plugin_permissions (plugin_id, role, can_access) VALUES (?, ?, ?)',
        [pluginId, role, canAccess ? 1 : 0]
      );
    }

    res.json({ success: true, message: 'Permission plugin mise à jour' });
  } catch (error: any) {
    console.error('Erreur update plugin permission:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/plugins/user/:userId - Récupérer les permissions plugins d'un utilisateur
router.get('/plugins/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const permissions = await db.query(
      'SELECT * FROM user_plugin_permissions WHERE user_id = ?',
      [userId]
    );

    const permMap: Record<number, boolean> = {};
    for (const p of permissions) {
      permMap[p.plugin_id] = !!p.can_access;
    }

    res.json({ success: true, permissions: permMap });
  } catch (error: any) {
    console.error('Erreur get user plugin permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/permissions/plugins/:pluginId/user/:userId - Mettre à jour la permission plugin d'un utilisateur
router.put('/plugins/:pluginId/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { pluginId, userId } = req.params;
    const { canAccess, remove } = req.body;

    if (remove) {
      await db.execute(
        'DELETE FROM user_plugin_permissions WHERE plugin_id = ? AND user_id = ?',
        [pluginId, userId]
      );
    } else {
      const existing = await db.queryOne(
        'SELECT id FROM user_plugin_permissions WHERE plugin_id = ? AND user_id = ?',
        [pluginId, userId]
      );

      if (existing) {
        await db.execute(
          'UPDATE user_plugin_permissions SET can_access = ?, updated_at = ? WHERE plugin_id = ? AND user_id = ?',
          [canAccess ? 1 : 0, new Date().toISOString(), pluginId, userId]
        );
      } else {
        await db.execute(
          'INSERT INTO user_plugin_permissions (user_id, plugin_id, can_access) VALUES (?, ?, ?)',
          [userId, pluginId, canAccess ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Permission plugin utilisateur mise à jour' });
  } catch (error: any) {
    console.error('Erreur update user plugin permission:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/modules/:moduleName/group/:role - Récupérer les permissions module d'un groupe
router.get('/modules/:moduleName/group/:role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { moduleName, role } = req.params;

    if (!['supervisor', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    }

    const permission = await db.queryOne(
      `SELECT * FROM module_permissions WHERE module_name = ? AND role = ?`,
      [moduleName, role]
    );

    res.json({
      success: true,
      permission: permission ? {
        canView: !!permission.can_view,
        canExport: !!permission.can_export,
        canCompare: !!permission.can_compare
      } : {
        canView: false,
        canExport: false,
        canCompare: false
      }
    });
  } catch (error: any) {
    console.error('Erreur get module group permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/permissions/modules/:moduleName/group/:role - Mettre à jour les permissions module d'un groupe
router.put('/modules/:moduleName/group/:role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { moduleName, role } = req.params;
    const { canView, canExport, canCompare } = req.body;

    if (!['supervisor', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    }

    // Vérifier si l'entrée existe
    const existing = await db.queryOne(
      `SELECT id FROM module_permissions WHERE module_name = ? AND role = ?`,
      [moduleName, role]
    );

    if (existing) {
      await db.execute(
        `UPDATE module_permissions SET can_view = ?, can_export = ?, can_compare = ?, updated_at = ?
         WHERE module_name = ? AND role = ?`,
        [canView ? 1 : 0, canExport ? 1 : 0, canCompare ? 1 : 0, new Date().toISOString(), moduleName, role]
      );
    } else {
      await db.execute(
        `INSERT INTO module_permissions (module_name, role, can_view, can_export, can_compare) VALUES (?, ?, ?, ?, ?)`,
        [moduleName, role, canView ? 1 : 0, canExport ? 1 : 0, canCompare ? 1 : 0]
      );
    }

    res.json({ success: true, message: 'Permissions module mises à jour' });
  } catch (error: any) {
    console.error('Erreur update module group permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/modules/:moduleName/user/:userId - Récupérer les permissions module d'un utilisateur
router.get('/modules/:moduleName/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { moduleName, userId } = req.params;

    const permission = await db.queryOne(
      `SELECT * FROM user_module_permissions WHERE module_name = ? AND user_id = ?`,
      [moduleName, userId]
    );

    res.json({
      success: true,
      permission: permission ? {
        canView: !!permission.can_view,
        canExport: !!permission.can_export,
        canCompare: !!permission.can_compare
      } : null
    });
  } catch (error: any) {
    console.error('Erreur get module user permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/permissions/modules/:moduleName/user/:userId - Mettre à jour les permissions module d'un utilisateur
router.put('/modules/:moduleName/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { moduleName, userId } = req.params;
    const { canView, canExport, canCompare, remove } = req.body;

    if (remove) {
      await db.execute(
        `DELETE FROM user_module_permissions WHERE module_name = ? AND user_id = ?`,
        [moduleName, userId]
      );
    } else {
      // Vérifier si l'entrée existe
      const existing = await db.queryOne(
        `SELECT id FROM user_module_permissions WHERE module_name = ? AND user_id = ?`,
        [moduleName, userId]
      );

      if (existing) {
        await db.execute(
          `UPDATE user_module_permissions SET can_view = ?, can_export = ?, can_compare = ?, updated_at = ?
           WHERE module_name = ? AND user_id = ?`,
          [canView ? 1 : 0, canExport ? 1 : 0, canCompare ? 1 : 0, new Date().toISOString(), moduleName, userId]
        );
      } else {
        await db.execute(
          `INSERT INTO user_module_permissions (user_id, module_name, can_view, can_export, can_compare) VALUES (?, ?, ?, ?, ?)`,
          [userId, moduleName, canView ? 1 : 0, canExport ? 1 : 0, canCompare ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Permissions module utilisateur mises à jour' });
  } catch (error: any) {
    console.error('Erreur update module user permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/permissions/modules/all-groups - Récupérer toutes les permissions modules de tous les groupes
router.get('/modules/all-groups', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const permissions = await db.query('SELECT * FROM module_permissions');
    
    const result: Record<string, Record<string, any>> = {};
    for (const p of permissions) {
      if (!result[p.module_name]) {
        result[p.module_name] = {};
      }
      result[p.module_name][p.role] = {
        canView: !!p.can_view,
        canExport: !!p.can_export,
        canCompare: !!p.can_compare
      };
    }

    res.json({ success: true, permissions: result });
  } catch (error: any) {
    console.error('Erreur get all module permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
