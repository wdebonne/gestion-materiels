import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// GET /api/api-tokens - Lister tous les tokens
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await db.query(`
      SELECT t.id, t.name, t.token_prefix, t.permissions, t.is_active, 
             t.expires_at, t.last_used_at, t.created_at, t.updated_at,
             CONCAT_WS(' ', u.first_name, u.last_name) as created_by_name
      FROM api_tokens t
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `);

    res.json({ success: true, tokens });
  } catch (error: any) {
    console.error('Erreur get api tokens:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/api-tokens - Créer un nouveau token
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, permissions, expires_at } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom de l\'application est requis' });
    }

    // Générer un token aléatoire sécurisé
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenPrefix = rawToken.substring(0, 8);
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Valider les permissions
    const validPermissions = ['read', 'write', 'delete'];
    const perms = Array.isArray(permissions)
      ? permissions.filter((p: string) => validPermissions.includes(p))
      : ['read'];

    if (perms.length === 0) {
      return res.status(400).json({ success: false, message: 'Au moins une permission est requise' });
    }

    const now = new Date().toISOString();
    const result = await db.execute(
      `INSERT INTO api_tokens (name, token_hash, token_prefix, permissions, is_active, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        name.trim(),
        tokenHash,
        tokenPrefix,
        JSON.stringify(perms),
        expires_at || null,
        req.user!.userId,
        now,
        now
      ]
    );

    await logService.success('api', `Token API créé: ${name}`, { tokenId: result.lastInsertRowid }, { userId: req.user?.userId });

    // Retourner le token en clair UNE SEULE FOIS
    res.status(201).json({
      success: true,
      token: {
        id: result.lastInsertRowid,
        name: name.trim(),
        raw_token: rawToken,
        token_prefix: tokenPrefix,
        permissions: perms,
        expires_at: expires_at || null,
        created_at: now
      },
      message: 'Token créé. Copiez-le maintenant, il ne sera plus visible.'
    });
  } catch (error: any) {
    console.error('Erreur create api token:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/api-tokens/:id - Modifier un token (nom, permissions, actif)
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, permissions, is_active, expires_at } = req.body;

    const existing = await db.queryOne('SELECT * FROM api_tokens WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Token non trouvé' });
    }

    const validPermissions = ['read', 'write', 'delete'];
    const perms = Array.isArray(permissions)
      ? permissions.filter((p: string) => validPermissions.includes(p))
      : undefined;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE api_tokens SET 
        name = COALESCE(?, name),
        permissions = COALESCE(?, permissions),
        is_active = COALESCE(?, is_active),
        expires_at = COALESCE(?, expires_at),
        updated_at = ?
       WHERE id = ?`,
      [
        name?.trim() || null,
        perms ? JSON.stringify(perms) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        expires_at !== undefined ? (expires_at || null) : null,
        now,
        id
      ]
    );

    const updated = await db.queryOne('SELECT id, name, token_prefix, permissions, is_active, expires_at, last_used_at, created_at, updated_at FROM api_tokens WHERE id = ?', [id]);

    await logService.success('api', `Token API modifié: ${updated.name}`, { tokenId: id }, { userId: req.user?.userId });

    res.json({ success: true, token: updated });
  } catch (error: any) {
    console.error('Erreur update api token:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/api-tokens/:id - Supprimer un token
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await db.queryOne('SELECT * FROM api_tokens WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Token non trouvé' });
    }

    await db.execute('DELETE FROM api_tokens WHERE id = ?', [id]);

    await logService.success('api', `Token API supprimé: ${existing.name}`, { tokenId: id }, { userId: req.user?.userId });

    res.json({ success: true, message: 'Token supprimé' });
  } catch (error: any) {
    console.error('Erreur delete api token:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/api-tokens/:id/regenerate - Régénérer un token
router.post('/:id/regenerate', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await db.queryOne('SELECT * FROM api_tokens WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Token non trouvé' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenPrefix = rawToken.substring(0, 8);
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = new Date().toISOString();

    await db.execute(
      `UPDATE api_tokens SET token_hash = ?, token_prefix = ?, updated_at = ? WHERE id = ?`,
      [tokenHash, tokenPrefix, now, id]
    );

    await logService.success('api', `Token API régénéré: ${existing.name}`, { tokenId: id }, { userId: req.user?.userId });

    res.json({
      success: true,
      raw_token: rawToken,
      token_prefix: tokenPrefix,
      message: 'Token régénéré. Copiez-le maintenant, il ne sera plus visible.'
    });
  } catch (error: any) {
    console.error('Erreur regenerate api token:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
