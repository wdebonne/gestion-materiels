import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor, requireFieldWrite } from '../middleware/auth.middleware';
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

/**
 * Statuts qui rendent un matériel indisponible.
 *
 * Une demande `pending` n'en fait pas partie : c'est au superviseur de trancher
 * entre deux demandes. Elle est signalée à l'écran sans bloquer.
 */
export const STATUTS_BLOQUANTS = ['reserved', 'borrowed'] as const;

/**
 * Deux périodes se chevauchent dès que l'une commence avant la fin de l'autre
 * et finit après son début. Les bornes sont incluses : un matériel n'est pas
 * rendu et repris dans la même seconde.
 *
 * Écrit une seule fois : la disponibilité affichée à l'écran, le refus de la
 * création et la liste des demandes en attente doivent parler de la même chose.
 * Paramètres attendus, dans cet ordre : date de fin, puis date de début.
 */
export const CHEVAUCHEMENT = 'start_date <= ? AND end_date >= ?';

/**
 * Conflit de réservation sur une période.
 *
 * Partagé entre la vérification de disponibilité et la création : s'ils
 * divergeaient, l'écran annoncerait « disponible » puis le serveur répondrait
 * 409 — pire que de ne rien annoncer, parce que l'utilisateur cesserait de
 * faire confiance à l'indication.
 */
export function requeteConflits(
  objectId: number | string,
  startDate: string,
  endDate: string,
  colonnes = 'id'
): { sql: string; params: any[] } {
  const marqueurs = STATUTS_BLOQUANTS.map(() => '?').join(', ');
  return {
    sql: `SELECT ${colonnes} FROM reservations
          WHERE object_id = ? AND status IN (${marqueurs})
          AND ${CHEVAUCHEMENT}`,
    params: [objectId, ...STATUTS_BLOQUANTS, endDate, startDate],
  };
}

/**
 * Complète des réservations avec le nom de leur emprunteur.
 *
 * En une requête pour l'ensemble : la boucle « une requête par ligne » est
 * exactement le motif retiré ailleurs dans ce dépôt.
 */
async function nommerEmprunteurs(lignes: any[]): Promise<void> {
  const ids = [...new Set(lignes.map((l) => l.user_id).filter(Boolean))];
  if (ids.length === 0) return;

  const marqueurs = ids.map(() => '?').join(', ');
  const utilisateurs = await db.query(
    `SELECT id, first_name, last_name FROM users WHERE id IN (${marqueurs})`,
    ids
  );
  const parId = new Map(utilisateurs.map((u: any) => [u.id, u]));

  for (const ligne of lignes) {
    const u = parId.get(ligne.user_id);
    ligne.first_name = u?.first_name ?? null;
    ligne.last_name = u?.last_name ?? null;
  }
}

// Vérifier la disponibilité d'un objet
router.get('/availability/:objectId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { objectId } = req.params;
    const { startDate, endDate } = req.query;

    const periodeComplete = Boolean(startDate && endDate);

    // Le verdict s'appuie sur `requeteConflits`, celle-là même qu'utilise la
    // création : c'est ce qui garantit que l'écran n'annonce jamais
    // « disponible » sur un créneau que le serveur refuserait ensuite.
    const reservations = periodeComplete
      ? await (async () => {
          const conflit = requeteConflits(
            objectId,
            String(startDate),
            String(endDate),
            'reservations.*'
          );
          return db.query(conflit.sql + ' ORDER BY start_date ASC', conflit.params);
        })()
      : await db.query(
          `SELECT * FROM reservations
           WHERE object_id = ? AND status IN ('reserved', 'borrowed')
           ORDER BY start_date ASC`,
          [objectId]
        );

    // Une demande en attente ne bloque pas la création, mais deux agents qui
    // demandent le même créneau sans le savoir aboutissent à une demande
    // validée et une autre qui reste en attente pour toujours.
    let sqlAttente = `SELECT * FROM reservations WHERE object_id = ? AND status = 'pending'`;
    const paramsAttente: any[] = [objectId];
    if (periodeComplete) {
      sqlAttente += ` AND ${CHEVAUCHEMENT}`;
      paramsAttente.push(endDate, startDate);
    }
    const pending = await db.query(sqlAttente + ' ORDER BY start_date ASC', paramsAttente);

    // Le nom de l'emprunteur, en une requête pour l'ensemble.
    await nommerEmprunteurs([...reservations, ...pending]);

    const isAvailable = reservations.length === 0;

    res.json({
      success: true,
      data: { isAvailable, reservations, pending }
    });
  } catch (error: any) {
    console.error('Erreur vérification disponibilité:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Créer une réservation
router.post('/',
  authenticateToken,
  requireFieldWrite,
  [
    body('objectId').isInt({ min: 1 }),
    body('userId').optional().isInt({ min: 1 }),
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

      const { objectId, startDate, endDate, reason } = req.body;

      // Un agent ne réserve que pour lui-même : il ne peut pas engager
      // le matériel au nom d'un collègue.
      const isSupervisor = req.user!.role === 'admin' || req.user!.role === 'supervisor';
      const userId = isSupervisor ? req.body.userId : req.user!.userId;

      // Vérifier que l'objet existe
      const object = await db.queryOne('SELECT id, name FROM objects WHERE id = ?', [objectId]);
      if (!object) {
        res.status(404).json({ success: false, message: 'Objet non trouvé' });
        return;
      }

      // Vérifier les conflits de réservation, avec le filtre que la
      // vérification de disponibilité utilise déjà.
      const conflit = requeteConflits(objectId, startDate, endDate);
      const conflicts = await db.query(conflit.sql, conflit.params);

      if (conflicts.length > 0) {
        res.status(409).json({ success: false, message: 'Conflit avec une réservation existante' });
        return;
      }

      const now = new Date().toISOString();
      // Une demande d'agent attend la validation d'un superviseur ; celle d'un
      // superviseur vaut réservation ferme.
      const status = isSupervisor ? 'reserved' : 'pending';

      const result = await db.execute(
        `INSERT INTO reservations (object_id, user_id, start_date, end_date, reason, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [objectId, userId, startDate, endDate, reason || null, status, req.user!.userId, now, now]
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
  [body('status').isIn(['pending', 'reserved', 'borrowed', 'returned', 'cancelled', 'overdue'])],
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
