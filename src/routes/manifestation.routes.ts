import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';

const router = Router();

// ======================== STOCK MATÉRIEL ========================

// GET /stock - Liste du stock avec quantités réelles et prévisionnelles
router.get('/stock', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { search, category, etat, lieu, stock_type, category_id, subcategory_id } = req.query;
    let sql = `
      SELECT ms.*, c.name as category_name, c.slug as category_slug,
        sc.name as subcategory_name
      FROM manifestation_stock ms
      LEFT JOIN categories c ON c.id = ms.category_id
      LEFT JOIN subcategories sc ON sc.id = ms.subcategory_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search) {
      sql += ' AND (ms.name LIKE ? OR ms.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      sql += ' AND ms.category = ?';
      params.push(category);
    }
    if (etat) {
      sql += ' AND ms.etat = ?';
      params.push(etat);
    }
    if (lieu) {
      sql += ' AND ms.lieu = ?';
      params.push(lieu);
    }
    if (stock_type) {
      sql += ' AND ms.stock_type = ?';
      params.push(stock_type);
    }
    if (category_id) {
      sql += ' AND ms.category_id = ?';
      params.push(category_id);
    }
    if (subcategory_id) {
      sql += ' AND ms.subcategory_id = ?';
      params.push(subcategory_id);
    }
    sql += ' ORDER BY ms.category, ms.name';

    const stock = await db.query(sql, params);

    // Quantités engagées et prévisionnelles, agrégées en deux requêtes pour
    // tout le stock plutôt qu'en deux requêtes par article.
    const idsStock = stock.map((item: any) => item.id);
    const [pretParArticle, reserveParArticle] = await Promise.all([
      // En prêt : livré mais pas encore récupéré, sur les manifs validées ou livrées
      grouperEnfants(
        (marqueurs) => `
        SELECT mm.stock_id, COALESCE(SUM(mm.quantity_delivered - mm.quantity_recovered), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id IN (${marqueurs}) AND m.status IN ('validated', 'delivered')
        GROUP BY mm.stock_id
      `,
        idsStock,
        'stock_id'
      ),
      // Réservé pour des manifs futures (brouillon ou validé, date_start >= aujourd'hui)
      grouperEnfants(
        (marqueurs) => `
        SELECT mm.stock_id, COALESCE(SUM(mm.quantity_requested), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id IN (${marqueurs}) AND m.status IN ('draft', 'validated') AND m.date_start >= date('now')
        GROUP BY mm.stock_id
      `,
        idsStock,
        'stock_id'
      ),
    ]);

    const enriched = stock.map((item: any) => {
      const lent = enfantsDe<any>(pretParArticle, item.id)[0]?.qty || 0;
      const reserved = enfantsDe<any>(reserveParArticle, item.id)[0]?.qty || 0;

      return {
        ...item,
        quantity_available: item.quantity_total - lent,
        quantity_lent: lent,
        quantity_reserved_future: reserved
      };
    });

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/categories - Liste des catégories distinctes
router.get('/stock/categories', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await db.query(
      "SELECT DISTINCT category FROM manifestation_stock WHERE category != '' ORDER BY category"
    );
    res.json({ success: true, data: categories.map((c: any) => c.category) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/etats - Liste des états distincts
router.get('/stock/etats', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const etats = await db.query(
      "SELECT DISTINCT etat FROM manifestation_stock WHERE etat != '' ORDER BY etat"
    );
    res.json({ success: true, data: etats.map((e: any) => e.etat) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/lieux - Liste des lieux distincts
router.get('/stock/lieux', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const lieux = await db.query(
      "SELECT DISTINCT lieu FROM manifestation_stock WHERE lieu != '' ORDER BY lieu"
    );
    res.json({ success: true, data: lieux.map((l: any) => l.lieu) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/types - Liste des types distincts
router.get('/stock/types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query(
      "SELECT DISTINCT stock_type FROM manifestation_stock WHERE stock_type != '' ORDER BY stock_type"
    );
    res.json({ success: true, data: types.map((t: any) => t.stock_type) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /stock - Créer un article de stock
router.post('/stock', authenticateToken, requireSupervisor,
  body('name').notEmpty().withMessage('Le nom est requis'),
  body('quantity_total').isInt({ min: 0 }).withMessage('Quantité invalide'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price } = req.body;
      const result = await db.execute(
        'INSERT INTO manifestation_stock (name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0]
      );
      await logService.info('other', `Stock manifestation créé: ${name}`, { userId: req.user!.userId });
      const created = await db.queryOne('SELECT * FROM manifestation_stock WHERE id = ?', [result.lastInsertRowid]);
      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /stock/:id - Modifier un article de stock
router.put('/stock/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price } = req.body;
    await db.execute(
      `UPDATE manifestation_stock SET name = ?, description = ?, category = ?, quantity_total = ?, unit = ?, etat = ?, lieu = ?, stock_type = ?, category_id = ?, subcategory_id = ?, price = ?, updated_at = datetime('now') WHERE id = ?`,
      [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0, req.params.id]
    );
    const updated = await db.queryOne('SELECT * FROM manifestation_stock WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /stock/:id - Supprimer un article
router.delete('/stock/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    // Vérifier qu'il n'est pas utilisé dans des manifestations actives
    const used = await db.queryOne(`
      SELECT COUNT(*) as cnt FROM manifestation_materials mm
      JOIN manifestations m ON m.id = mm.manifestation_id
      WHERE mm.stock_id = ? AND m.status NOT IN ('archived', 'cancelled')
    `, [req.params.id]);
    if (used?.cnt > 0) {
      return res.status(400).json({ success: false, message: 'Cet article est utilisé dans des manifestations actives' });
    }
    await db.execute('DELETE FROM manifestation_stock WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/availability - Disponibilité stock à une date donnée
router.get('/stock/availability', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const stock = await db.query('SELECT * FROM manifestation_stock ORDER BY category, name');
    const engageParArticle = await grouperEnfants(
      (marqueurs) => `
        SELECT mm.stock_id, COALESCE(SUM(mm.quantity_delivered), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id IN (${marqueurs}) AND m.status IN ('validated', 'delivered')
          AND m.date_start <= ? AND (m.date_end >= ? OR m.date_end IS NULL)
        GROUP BY mm.stock_id
      `,
      stock.map((item: any) => item.id),
      'stock_id',
      (tranche) => [...tranche, targetDate, targetDate]
    );

    const enriched = stock.map((item: any) => {
      const engaged = enfantsDe<any>(engageParArticle, item.id)[0]?.qty || 0;

      return {
        ...item,
        quantity_engaged: engaged,
        quantity_available: item.quantity_total - engaged
      };
    });

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== STATS / DASHBOARD ========================

// GET /stats/summary - Statistiques globales
router.get('/stats/summary', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const total = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status != 'archived'");
    const upcoming = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status IN ('draft', 'validated') AND date_start >= date('now')");
    const delivered = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status = 'delivered'");
    const archived = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status = 'archived'");
    const stockItems = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestation_stock");

    res.json({
      success: true,
      data: {
        total: total?.cnt || 0,
        upcoming: upcoming?.cnt || 0,
        delivered: delivered?.cnt || 0,
        archived: archived?.cnt || 0,
        stockItems: stockItems?.cnt || 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MANIFESTATIONS ========================

// GET / - Liste des manifestations avec filtres
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, archived, date_from, date_to } = req.query;
    let sql = `
      SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
      FROM manifestations m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (archived === 'true') {
      sql += " AND m.status = 'archived'";
    } else if (!status) {
      sql += " AND m.status != 'archived'";
    }
    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (m.title LIKE ? OR m.contact_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (date_from) {
      sql += ' AND m.date_start >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND m.date_start <= ?';
      params.push(date_to);
    }

    sql += ' ORDER BY m.date_start DESC';

    const manifestations = await db.query(sql, params);

    // Matériaux de toutes les manifestations en une requête
    const materiauxParManifestation = await grouperEnfants(
      (marqueurs) => `
        SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category
        FROM manifestation_materials mm
        JOIN manifestation_stock ms ON ms.id = mm.stock_id
        WHERE mm.manifestation_id IN (${marqueurs})
      `,
      manifestations.map((m: any) => m.id),
      'manifestation_id'
    );

    const enriched = manifestations.map((m: any) => ({
      ...m,
      materials: enfantsDe(materiauxParManifestation, m.id)
    }));

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Libellé lisible de chaque transition, pour que l'historique se lise sans décodeur. */
const LIBELLES_TRANSITION: Record<string, string> = {
  draft: 'Retour en brouillon',
  validated: 'Validation',
  delivered: 'Livraison',
  recovered: 'Récupération',
  archived: 'Archivage',
  cancelled: 'Annulation',
};

/**
 * Consigne un événement dans l'historique d'une manifestation.
 *
 * La table `manifestation_history` était créée depuis le début et n'était ni
 * écrite ni lue : le README et la feuille de route annonçaient une « timeline
 * horodatée de toutes les actions » qui n'existait nulle part. Un prêt de
 * matériel pour un événement municipal engage la collectivité — savoir qui a
 * validé, qui a livré et à quelle date est le minimum.
 *
 * L'écriture ne doit jamais faire échouer l'action qu'elle décrit : perdre une
 * ligne d'historique est moins grave que perdre une livraison.
 */
async function consignerHistorique(
  manifestationId: number | string,
  userId: number | undefined,
  action: string,
  details: { fromStatus?: string | null; toStatus?: string | null; comment?: string | null } = {}
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO manifestation_history (manifestation_id, user_id, action, from_status, to_status, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        manifestationId,
        userId ?? null,
        action,
        details.fromStatus ?? null,
        details.toStatus ?? null,
        details.comment?.trim() || null,
        new Date().toISOString(),
      ]
    );
  } catch (erreur: any) {
    console.error('Historique manifestation non enregistré:', erreur.message);
  }
}

/** Historique d'une manifestation, du plus récent au plus ancien. */
async function lireHistorique(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT h.*, u.first_name, u.last_name, u.email
     FROM manifestation_history h
     LEFT JOIN users u ON u.id = h.user_id
     WHERE h.manifestation_id = ?
     ORDER BY h.created_at DESC, h.id DESC`,
    [manifestationId]
  );
}

// GET /:id - Détail d'une manifestation
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne(`
      SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
      FROM manifestations m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = ?
    `, [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });

    const materials = await db.query(`
      SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category, ms.quantity_total as stock_total
      FROM manifestation_materials mm
      JOIN manifestation_stock ms ON ms.id = mm.stock_id
      WHERE mm.manifestation_id = ?
    `, [m.id]);

    const history = await lireHistorique(m.id);

    res.json({ success: true, data: { ...m, materials, history } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id/history - Historique seul
router.get('/:id/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne('SELECT id FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });

    res.json({ success: true, data: await lireHistorique(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST / - Créer une manifestation
router.post('/', authenticateToken, requireSupervisor,
  body('title').notEmpty().withMessage('Le titre est requis'),
  body('date_start').notEmpty().withMessage('La date de début est requise'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const {
        title, date_start, date_end, start_time, end_time, expected_people,
        contact_name, contact_phone, contact_email, delivery_address, delivery_date,
        notes_interior, notes_exterior, materials
      } = req.body;

      const result = await db.execute(`
        INSERT INTO manifestations (title, date_start, date_end, start_time, end_time, expected_people,
          contact_name, contact_phone, contact_email, delivery_address, delivery_date,
          notes_interior, notes_exterior, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
      `, [
        title, date_start, date_end || null, start_time || null, end_time || null,
        expected_people || 0, contact_name || '', contact_phone || '', contact_email || '',
        delivery_address || '', delivery_date || null,
        notes_interior || '', notes_exterior || '', req.user!.userId
      ]);

      const manifestationId = result.lastInsertRowid;

      // Insérer les matériaux demandés
      if (materials && Array.isArray(materials)) {
        for (const mat of materials) {
          await db.execute(
            'INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested, unit_value, notes) VALUES (?, ?, ?, ?, ?)',
            [manifestationId, mat.stock_id, mat.quantity_requested || 0, mat.unit_value || 0, mat.notes || '']
          );
        }
      }

      await consignerHistorique(manifestationId, req.user!.userId, 'Création', { toStatus: 'draft' });
      await logService.info('other', `Manifestation créée: ${title}`, { userId: req.user!.userId });
      const created = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [manifestationId]);
      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /:id - Modifier une manifestation
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Non trouvée' });
    if (existing.status === 'archived') return res.status(400).json({ success: false, message: 'Manifestation archivée' });

    const {
      title, date_start, date_end, start_time, end_time, expected_people,
      contact_name, contact_phone, contact_email, delivery_address, delivery_date,
      notes_interior, notes_exterior, materials
    } = req.body;

    await db.execute(`
      UPDATE manifestations SET title = ?, date_start = ?, date_end = ?, start_time = ?, end_time = ?,
        expected_people = ?, contact_name = ?, contact_phone = ?, contact_email = ?,
        delivery_address = ?, delivery_date = ?, notes_interior = ?, notes_exterior = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      title, date_start, date_end || null, start_time || null, end_time || null,
      expected_people || 0, contact_name || '', contact_phone || '', contact_email || '',
      delivery_address || '', delivery_date || null,
      notes_interior || '', notes_exterior || '', req.params.id
    ]);

    // Mettre à jour les matériaux: supprimer puis réinsérer
    if (materials && Array.isArray(materials)) {
      await db.execute('DELETE FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]);
      for (const mat of materials) {
        await db.execute(
          'INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested, quantity_delivered, quantity_recovered, unit_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.params.id, mat.stock_id, mat.quantity_requested || 0, mat.quantity_delivered || 0, mat.quantity_recovered || 0, mat.unit_value || 0, mat.notes || '']
        );
      }
    }

    await consignerHistorique(req.params.id, req.user!.userId, 'Modification');
    await logService.info('other', `Manifestation modifiée: ${title}`, { userId: req.user!.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /:id/status - Changer le statut d'une manifestation
router.put('/:id/status', authenticateToken, requireSupervisor,
  body('status').isIn(['draft', 'validated', 'delivered', 'recovered', 'archived', 'cancelled']),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { status, comment } = req.body;
      const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
      if (!m) return res.status(404).json({ success: false, message: 'Non trouvée' });

      // Transitions autorisées
      const transitions: Record<string, string[]> = {
        draft: ['validated', 'cancelled'],
        validated: ['delivered', 'cancelled', 'draft'],
        delivered: ['recovered'],
        recovered: ['archived'],
        cancelled: ['draft'],
        archived: []
      };

      if (!transitions[m.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Transition de "${m.status}" vers "${status}" non autorisée`
        });
      }

      // Si on passe en "delivered", enregistrer les quantités livrées depuis les quantités demandées si pas déjà fait
      if (status === 'delivered') {
        const materials = await db.query(
          'SELECT * FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]
        );
        for (const mat of materials) {
          if (mat.quantity_delivered === 0) {
            await db.execute(
              'UPDATE manifestation_materials SET quantity_delivered = quantity_requested WHERE id = ?',
              [mat.id]
            );
          }
        }
      }

      const archiveDate = status === 'archived' ? "datetime('now')" : 'NULL';
      await db.execute(
        `UPDATE manifestations SET status = ?, archived_at = ${archiveDate}, updated_at = datetime('now') WHERE id = ?`,
        [status, req.params.id]
      );

      await consignerHistorique(req.params.id, req.user!.userId, LIBELLES_TRANSITION[status] ?? 'Changement de statut', {
        fromStatus: m.status,
        toStatus: status,
        comment,
      });
      await logService.info('other', `Manifestation "${m.title}" → ${status}`, { userId: req.user!.userId });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /:id/materials - Mise à jour spécifique du matériel livré/récupéré
router.put('/:id/materials', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { materials } = req.body;
    if (!materials || !Array.isArray(materials)) {
      return res.status(400).json({ success: false, message: 'Données de matériaux requises' });
    }
    // `changes` est compté : la route répondait 200 même quand aucune ligne ne
    // correspondait, par exemple avec un identifiant de stock à la place de
    // l'identifiant de ligne.
    let modifiees = 0;
    for (const mat of materials) {
      const r = await db.execute(
        'UPDATE manifestation_materials SET quantity_delivered = ?, quantity_recovered = ? WHERE id = ? AND manifestation_id = ?',
        [mat.quantity_delivered, mat.quantity_recovered, mat.id, req.params.id]
      );
      modifiees += r.changes;
    }

    if (modifiees === 0) {
      return res.status(400).json({
        success: false,
        message: "Aucune ligne de matériel ne correspond : vérifiez l'identifiant de ligne envoyé"
      });
    }

    await consignerHistorique(req.params.id, req.user!.userId, 'Quantités mises à jour', {
      comment: `${modifiees} ligne(s) de matériel`
    });

    res.json({ success: true, updated: modifiees });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id - Supprimer une manifestation
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Non trouvée' });
    if (m.status === 'delivered') {
      return res.status(400).json({ success: false, message: 'Impossible de supprimer une manifestation en cours de livraison' });
    }
    await db.execute('DELETE FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]);
    await db.execute('DELETE FROM manifestations WHERE id = ?', [req.params.id]);
    await logService.info('other', `Manifestation supprimée: ${m.title}`, { userId: req.user!.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
