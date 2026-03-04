import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// GET /api/users - Liste des utilisateurs (admin)
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await db.query(
      `SELECT id, email, first_name, last_name, role, avatar, is_active, created_at, last_login 
       FROM users ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      users: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
        avatar: u.avatar,
        isActive: !!u.is_active,
        createdAt: u.created_at,
        lastLogin: u.last_login
      }))
    });
  } catch (error: any) {
    console.error('Erreur get users:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/users/:id - Détail d'un utilisateur
router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await db.queryOne(
      `SELECT id, email, first_name, last_name, role, avatar, is_active, created_at, last_login 
       FROM users WHERE id = ?`,
      [id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Récupérer les permissions
    const permissions = await db.query(
      `SELECT * FROM user_permissions WHERE user_id = ?`,
      [id]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        avatar: user.avatar,
        isActive: !!user.is_active,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        permissions
      }
    });
  } catch (error: any) {
    console.error('Erreur get user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/users - Créer un utilisateur
router.post('/', authenticateToken, requireAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères'),
  body('role').isIn(['admin', 'supervisor', 'user']).withMessage('Rôle invalide')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, firstName, lastName, role } = req.body;

    // Vérifier si l'email existe
    const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Créer l'utilisateur
    const result = await db.execute(
      'INSERT INTO users (email, password, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName || '', lastName || '', role]
    );

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé',
      userId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/users/:id - Modifier un utilisateur
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, role, isActive, password } = req.body;

    // Vérifier que l'utilisateur existe
    const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Vérifier l'unicité de l'email
    if (email) {
      const existing = await db.queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
      }
    }

    // Construire la requête de mise à jour
    let updateFields = [];
    let values = [];

    if (email) {
      updateFields.push('email = ?');
      values.push(email);
    }
    if (firstName !== undefined) {
      updateFields.push('first_name = ?');
      values.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push('last_name = ?');
      values.push(lastName);
    }
    if (role) {
      updateFields.push('role = ?');
      values.push(role);
    }
    if (isActive !== undefined) {
      updateFields.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });
      }
      const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
      updateFields.push('password = ?');
      values.push(hashedPassword);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Utilisateur mis à jour' });
  } catch (error: any) {
    console.error('Erreur update user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/users/:id - Supprimer un utilisateur
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Empêcher de se supprimer soi-même
    if (parseInt(id) === req.user?.userId) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas vous supprimer vous-même' });
    }

    const result = await db.execute('DELETE FROM users WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (error: any) {
    console.error('Erreur delete user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/permissions - Mettre à jour les permissions
router.put('/:id/permissions', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    // Supprimer les anciennes permissions
    await db.execute('DELETE FROM user_permissions WHERE user_id = ?', [id]);

    // Ajouter les nouvelles permissions
    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) {
        await db.execute(
          `INSERT INTO user_permissions (user_id, category_id, subcategory_id, can_view, can_edit, can_delete) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, perm.categoryId || null, perm.subcategoryId || null, perm.canView ? 1 : 0, perm.canEdit ? 1 : 0, perm.canDelete ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Permissions mises à jour' });
  } catch (error: any) {
    console.error('Erreur update permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
