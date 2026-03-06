import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// Lister les réservations (avec filtres)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { objectId, status, startDate, endDate, userId } = req.query;

    let sql = `
      SELECT r.*, o.name as object_name, o.reference as object_reference,
             u.first_name as borrower_first_name, u.last_name as borrower_last_name, u.email as borrower_email,
             cu.first_name as created_by_first_name, cu.last_name as created_by_last_name
      FROM reservations r
      LEFT JOIN objects o ON r.object_id = o.id
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN users cu ON r.created_by = cu.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (objectId) {
      sql += ' AND r.object_id = ?';
      params.push(objectId);
    }
    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    if (userId) {
      sql += ' AND r.user_id = ?';
      params.push(userId);
    }
    if (startDate) {
      sql += ' AND r.end_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND r.start_date <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY r.start_date DESC';

    const reservations = await db.query(sql, params);
    res.json({ success: true, data: reservations });
  } catch (error: any) {
    console.error('Erreur liste réservations:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Vérifier la disponibilité d'un objet
router.get('/availability/:objectId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { objectId } = req.params;
    const { startDate, endDate } = req.query;

    let sql = `
      SELECT r.*, u.first_name, u.last_name
      FROM reservations r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.object_id = ? AND r.status IN ('reserved', 'borrowed')
    `;
    const params: any[] = [objectId];

    if (startDate && endDate) {
      sql += ' AND r.start_date <= ? AND r.end_date >= ?';
      params.push(endDate, startDate);
    }

    sql += ' ORDER BY r.start_date ASC';

    const reservations = await db.query(sql, params);
    const isAvailable = reservations.length === 0;

    res.json({
      success: true,
      data: { isAvailable, reservations }
    });
  } catch (error: any) {
    console.error('Erreur vérification disponibilité:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Créer une réservation
router.post('/',
  authenticateToken,
  requireSupervisor,
  [
    body('objectId').isInt({ min: 1 }),
    body('userId').isInt({ min: 1 }),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('reason').optional().isString().trim(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ success: false, errors: errors.array() });
        return;
      }

      const { objectId, userId, startDate, endDate, reason } = req.body;

      // Vérifier que l'objet existe
      const object = await db.queryOne('SELECT id, name FROM objects WHERE id = ?', [objectId]);
      if (!object) {
        res.status(404).json({ success: false, message: 'Objet non trouvé' });
        return;
      }

      // Vérifier les conflits de réservation
      const conflicts = await db.query(
        `SELECT id FROM reservations 
         WHERE object_id = ? AND status IN ('reserved', 'borrowed')
         AND start_date <= ? AND end_date >= ?`,
        [objectId, endDate, startDate]
      );

      if (conflicts.length > 0) {
        res.status(409).json({ success: false, message: 'Conflit avec une réservation existante' });
        return;
      }

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO reservations (object_id, user_id, start_date, end_date, reason, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
        [objectId, userId, startDate, endDate, reason || null, req.user!.userId, now, now]
      );

      await logService.info('other', `Réservation créée pour "${object.name}"`, {
        userId: req.user?.userId,
        objectId,
        startDate,
        endDate
      });

      res.status(201).json({
        success: true,
        message: 'Réservation créée',
        data: { id: result.lastInsertRowid }
      });
    } catch (error: any) {
      console.error('Erreur création réservation:', error);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// Modifier le statut d'une réservation
router.put('/:id/status',
  authenticateToken,
  requireSupervisor,
  [body('status').isIn(['reserved', 'borrowed', 'returned', 'cancelled', 'overdue'])],
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ success: false, errors: errors.array() });
        return;
      }

      const { id } = req.params;
      const { status } = req.body;
      const now = new Date().toISOString();

      const reservation = await db.queryOne('SELECT * FROM reservations WHERE id = ?', [id]);
      if (!reservation) {
        res.status(404).json({ success: false, message: 'Réservation non trouvée' });
        return;
      }

      const updateFields: string[] = ['status = ?', 'updated_at = ?'];
      const updateParams: any[] = [status, now];

      if (status === 'returned') {
        updateFields.push('actual_return_date = ?');
        updateParams.push(now);
      }

      updateParams.push(id);
      await db.execute(
        `UPDATE reservations SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
      );

      await logService.info('other', `Statut réservation #${id} changé en "${status}"`, {
        userId: req.user?.userId
      });

      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error: any) {
      console.error('Erreur mise à jour réservation:', error);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// Supprimer une réservation
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const reservation = await db.queryOne('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!reservation) {
      res.status(404).json({ success: false, message: 'Réservation non trouvée' });
      return;
    }

    await db.execute('DELETE FROM reservations WHERE id = ?', [id]);

    await logService.info('other', `Réservation #${id} supprimée`, {
      userId: req.user?.userId
    });

    res.json({ success: true, message: 'Réservation supprimée' });
  } catch (error: any) {
    console.error('Erreur suppression réservation:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
