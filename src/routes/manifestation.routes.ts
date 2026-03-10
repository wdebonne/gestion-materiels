import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

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

    // Pour chaque article, calculer les quantités engagées et prévisionnelles
    const enriched = await Promise.all(stock.map(async (item: any) => {
      // Quantité actuellement en prêt (livrée mais pas encore récupérée) pour manifs validées/livrées
      const lent = await db.queryOne(`
        SELECT COALESCE(SUM(mm.quantity_delivered - mm.quantity_recovered), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id = ? AND m.status IN ('validated', 'delivered')
      `, [item.id]);

      // Quantité réservée pour des manifs futures (brouillon ou validé, date_start >= aujourd'hui)
      const reserved = await db.queryOne(`
        SELECT COALESCE(SUM(mm.quantity_requested), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id = ? AND m.status IN ('draft', 'validated') AND m.date_start >= date('now')
      `, [item.id]);

      return {
        ...item,
        quantity_available: item.quantity_total - (lent?.qty || 0),
        quantity_lent: lent?.qty || 0,
        quantity_reserved_future: reserved?.qty || 0
      };
    }));

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
      const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id } = req.body;
      const result = await db.execute(
        'INSERT INTO manifestation_stock (name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null]
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
    const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id } = req.body;
    await db.execute(
      `UPDATE manifestation_stock SET name = ?, description = ?, category = ?, quantity_total = ?, unit = ?, etat = ?, lieu = ?, stock_type = ?, category_id = ?, subcategory_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, req.params.id]
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
    const enriched = await Promise.all(stock.map(async (item: any) => {
      const engaged = await db.queryOne(`
        SELECT COALESCE(SUM(mm.quantity_delivered), 0) as qty
        FROM manifestation_materials mm
        JOIN manifestations m ON m.id = mm.manifestation_id
        WHERE mm.stock_id = ? AND m.status IN ('validated', 'delivered')
          AND m.date_start <= ? AND (m.date_end >= ? OR m.date_end IS NULL)
      `, [item.id, targetDate, targetDate]);

      return {
        ...item,
        quantity_engaged: engaged?.qty || 0,
        quantity_available: item.quantity_total - (engaged?.qty || 0)
      };
    }));

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
      SELECT m.*, u.username as created_by_name
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

    // Ajouter les matériaux pour chaque manifestation
    const enriched = await Promise.all(manifestations.map(async (m: any) => {
      const materials = await db.query(`
        SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category
        FROM manifestation_materials mm
        JOIN manifestation_stock ms ON ms.id = mm.stock_id
        WHERE mm.manifestation_id = ?
      `, [m.id]);
      return { ...m, materials };
    }));

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    console.error('[GET /manifestations] ERROR:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id - Détail d'une manifestation
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne(`
      SELECT m.*, u.username as created_by_name
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

    res.json({ success: true, data: { ...m, materials } });
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
      const { status } = req.body;
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
    for (const mat of materials) {
      await db.execute(
        'UPDATE manifestation_materials SET quantity_delivered = ?, quantity_recovered = ? WHERE id = ? AND manifestation_id = ?',
        [mat.quantity_delivered, mat.quantity_recovered, mat.id, req.params.id]
      );
    }
    res.json({ success: true });
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
