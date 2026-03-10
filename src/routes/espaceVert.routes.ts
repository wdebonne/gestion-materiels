import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// ======================== STATISTIQUES ========================

router.get('/stats', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const [total, totalElements, totalSuperficie, typesCount] = await Promise.all([
      db.queryOne("SELECT COUNT(*) as cnt FROM green_spaces"),
      db.queryOne("SELECT COUNT(*) as cnt FROM green_space_elements"),
      db.queryOne("SELECT COALESCE(SUM(area_m2), 0) as total FROM green_spaces"),
      db.query("SELECT space_type, COUNT(*) as cnt FROM green_spaces GROUP BY space_type ORDER BY cnt DESC")
    ]);

    res.json({
      success: true,
      data: {
        total: total?.cnt || 0,
        totalElements: totalElements?.cnt || 0,
        totalSuperficie: totalSuperficie?.total || 0,
        byType: typesCount
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== ESPACES VERTS (CRUD) ========================

// GET / - Liste des espaces verts avec filtres
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { search, space_type, status } = req.query;
    let sql = `
      SELECT gs.*,
        (SELECT COUNT(*) FROM green_space_elements WHERE green_space_id = gs.id) as element_count
      FROM green_spaces gs
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search) {
      sql += ' AND (gs.name LIKE ? OR gs.address LIKE ? OR gs.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (space_type) {
      sql += ' AND gs.space_type = ?';
      params.push(space_type);
    }
    if (status) {
      sql += ' AND gs.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY gs.name ASC';

    const spaces = await db.query(sql, params);
    res.json({ success: true, data: spaces });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /types - Liste des types d'espaces verts
router.get('/types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query(
      "SELECT DISTINCT space_type FROM green_spaces WHERE space_type != '' ORDER BY space_type"
    );
    res.json({ success: true, data: types.map((t: any) => t.space_type) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id - Détail d'un espace vert avec éléments
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const space = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!space) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    // Récupérer les éléments liés
    const elements = await db.query(`
      SELECT gse.*, o.name as object_name, o.image as object_image, o.reference,
        o.serial_number, o.purchase_price, o.status as object_status,
        c.name as category_name, sc.name as subcategory_name
      FROM green_space_elements gse
      LEFT JOIN objects o ON o.id = gse.object_id
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
      WHERE gse.green_space_id = ?
      ORDER BY gse.element_type, gse.label
    `, [req.params.id]);

    // Récupérer les annotations du plan
    const annotations = await db.query(
      'SELECT * FROM green_space_annotations WHERE green_space_id = ? ORDER BY created_at',
      [req.params.id]
    );

    // Récupérer l'historique saisonnier
    const seasons = await db.query(
      'SELECT * FROM green_space_seasons WHERE green_space_id = ? ORDER BY year DESC, season DESC',
      [req.params.id]
    );

    // Récupérer les documents
    const documents = await db.query(
      'SELECT * FROM green_space_documents WHERE green_space_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      success: true,
      data: { ...space, elements, annotations, seasons, documents }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST / - Créer un espace vert
router.post('/', authenticateToken, requireSupervisor,
  body('name').notEmpty().withMessage('Le nom est requis'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const {
        name, description, address, latitude, longitude,
        area_m2, space_type, soil_type, status,
        image, plan_image, custom_fields
      } = req.body;

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO green_spaces (name, description, address, latitude, longitude,
          area_m2, space_type, soil_type, status, image, plan_image, custom_fields,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, description || '', address || '',
          latitude || null, longitude || null,
          area_m2 || 0, space_type || 'parc', soil_type || '',
          status || 'actif', image || '', plan_image || '',
          custom_fields ? JSON.stringify(custom_fields) : '{}',
          req.user!.userId, now, now
        ]
      );

      await logService.info('other', `Espace vert créé: ${name}`, { userId: req.user!.userId });
      const created = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [result.lastInsertRowid]);
      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /:id - Modifier un espace vert
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    const {
      name, description, address, latitude, longitude,
      area_m2, space_type, soil_type, status,
      image, plan_image, custom_fields
    } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_spaces SET name = ?, description = ?, address = ?,
        latitude = ?, longitude = ?, area_m2 = ?, space_type = ?,
        soil_type = ?, status = ?, image = ?, plan_image = ?,
        custom_fields = ?, updated_at = ?
       WHERE id = ?`,
      [
        name || existing.name, description ?? existing.description,
        address ?? existing.address, latitude ?? existing.latitude,
        longitude ?? existing.longitude, area_m2 ?? existing.area_m2,
        space_type ?? existing.space_type, soil_type ?? existing.soil_type,
        status ?? existing.status, image ?? existing.image,
        plan_image ?? existing.plan_image,
        custom_fields ? JSON.stringify(custom_fields) : existing.custom_fields,
        now, req.params.id
      ]
    );

    const updated = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id - Supprimer un espace vert
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }
    await db.execute('DELETE FROM green_spaces WHERE id = ?', [req.params.id]);
    await logService.info('other', `Espace vert supprimé: ${existing.name}`, { userId: req.user!.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== ÉLÉMENTS (objets dans l'espace vert) ========================

// GET /:id/elements - Liste des éléments d'un espace vert
router.get('/:id/elements', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { search, element_type } = req.query;
    let sql = `
      SELECT gse.*, o.name as object_name, o.image as object_image,
        o.reference, o.serial_number, o.purchase_price, o.purchase_date,
        o.status as object_status, o.custom_fields as object_custom_fields,
        c.name as category_name, sc.name as subcategory_name
      FROM green_space_elements gse
      LEFT JOIN objects o ON o.id = gse.object_id
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
      WHERE gse.green_space_id = ?
    `;
    const params: any[] = [req.params.id];

    if (search) {
      sql += ' AND (gse.label LIKE ? OR gse.code LIKE ? OR o.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (element_type) {
      sql += ' AND gse.element_type = ?';
      params.push(element_type);
    }

    sql += ' ORDER BY gse.element_type, gse.label';

    const elements = await db.query(sql, params);
    res.json({ success: true, data: elements });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/elements - Ajouter un élément à un espace vert
router.post('/:id/elements', authenticateToken, requireSupervisor,
  body('label').notEmpty().withMessage('Le libellé est requis'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const space = await db.queryOne('SELECT id FROM green_spaces WHERE id = ?', [req.params.id]);
      if (!space) {
        return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
      }

      const {
        object_id, label, code, element_type, description, image,
        pos_x, pos_y, quantity, purchase_price, maintenance_notes,
        species, planting_date, last_maintenance_date, next_maintenance_date,
        condition_state, custom_fields
      } = req.body;

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
          element_type, description, image, pos_x, pos_y, quantity,
          purchase_price, maintenance_notes, species, planting_date,
          last_maintenance_date, next_maintenance_date, condition_state,
          custom_fields, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, object_id || null, label, code || '',
          element_type || 'autre', description || '', image || '',
          pos_x || null, pos_y || null, quantity || 1,
          purchase_price || null, maintenance_notes || '',
          species || '', planting_date || null,
          last_maintenance_date || null, next_maintenance_date || null,
          condition_state || 'bon',
          custom_fields ? JSON.stringify(custom_fields) : '{}',
          now, now
        ]
      );

      const created = await db.queryOne(`
        SELECT gse.*, o.name as object_name, o.image as object_image,
          c.name as category_name, sc.name as subcategory_name
        FROM green_space_elements gse
        LEFT JOIN objects o ON o.id = gse.object_id
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
        WHERE gse.id = ?
      `, [result.lastInsertRowid]);

      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /elements/:elementId - Modifier un élément
router.put('/elements/:elementId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_space_elements WHERE id = ?', [req.params.elementId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    const {
      object_id, label, code, element_type, description, image,
      pos_x, pos_y, quantity, purchase_price, maintenance_notes,
      species, planting_date, last_maintenance_date, next_maintenance_date,
      condition_state, custom_fields
    } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_elements SET object_id = ?, label = ?, code = ?,
        element_type = ?, description = ?, image = ?,
        pos_x = ?, pos_y = ?, quantity = ?,
        purchase_price = ?, maintenance_notes = ?,
        species = ?, planting_date = ?,
        last_maintenance_date = ?, next_maintenance_date = ?,
        condition_state = ?, custom_fields = ?, updated_at = ?
       WHERE id = ?`,
      [
        object_id ?? existing.object_id, label ?? existing.label,
        code ?? existing.code, element_type ?? existing.element_type,
        description ?? existing.description, image ?? existing.image,
        pos_x ?? existing.pos_x, pos_y ?? existing.pos_y,
        quantity ?? existing.quantity, purchase_price ?? existing.purchase_price,
        maintenance_notes ?? existing.maintenance_notes,
        species ?? existing.species, planting_date ?? existing.planting_date,
        last_maintenance_date ?? existing.last_maintenance_date,
        next_maintenance_date ?? existing.next_maintenance_date,
        condition_state ?? existing.condition_state,
        custom_fields ? JSON.stringify(custom_fields) : existing.custom_fields,
        now, req.params.elementId
      ]
    );

    const updated = await db.queryOne(`
      SELECT gse.*, o.name as object_name, o.image as object_image,
        c.name as category_name, sc.name as subcategory_name
      FROM green_space_elements gse
      LEFT JOIN objects o ON o.id = gse.object_id
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
      WHERE gse.id = ?
    `, [req.params.elementId]);

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /elements/:elementId - Supprimer un élément
router.delete('/elements/:elementId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_space_elements WHERE id = ?', [req.params.elementId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }
    await db.execute('DELETE FROM green_space_elements WHERE id = ?', [req.params.elementId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== ANNOTATIONS DU PLAN ========================

// POST /:id/annotations - Ajouter une annotation sur le plan
router.post('/:id/annotations', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { element_id, pos_x, pos_y, label, icon, color } = req.body;
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_annotations (green_space_id, element_id, pos_x, pos_y, label, icon, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, element_id || null, pos_x, pos_y, label || '', icon || 'circle', color || '#22c55e', now]
    );

    const created = await db.queryOne('SELECT * FROM green_space_annotations WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /annotations/:annotationId - Modifier une annotation
router.put('/annotations/:annotationId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { pos_x, pos_y, label, icon, color } = req.body;
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_annotations SET pos_x = ?, pos_y = ?, label = ?, icon = ?, color = ? WHERE id = ?`,
      [pos_x, pos_y, label, icon, color, req.params.annotationId]
    );
    const updated = await db.queryOne('SELECT * FROM green_space_annotations WHERE id = ?', [req.params.annotationId]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /annotations/:annotationId
router.delete('/annotations/:annotationId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_annotations WHERE id = ?', [req.params.annotationId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== SUIVI SAISONNIER ========================

// POST /:id/seasons - Ajouter une entrée saisonnière
router.post('/:id/seasons', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { season, year, notes, actions_done, actions_planned, photos } = req.body;
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_seasons (green_space_id, season, year, notes,
        actions_done, actions_planned, photos, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, season, year || new Date().getFullYear(),
        notes || '', actions_done || '', actions_planned || '',
        photos ? JSON.stringify(photos) : '[]',
        req.user!.userId, now
      ]
    );

    const created = await db.queryOne('SELECT * FROM green_space_seasons WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /seasons/:seasonId
router.put('/seasons/:seasonId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { season, year, notes, actions_done, actions_planned, photos } = req.body;
    await db.execute(
      `UPDATE green_space_seasons SET season = ?, year = ?, notes = ?,
        actions_done = ?, actions_planned = ?, photos = ?
       WHERE id = ?`,
      [season, year, notes || '', actions_done || '', actions_planned || '',
       photos ? JSON.stringify(photos) : '[]', req.params.seasonId]
    );
    const updated = await db.queryOne('SELECT * FROM green_space_seasons WHERE id = ?', [req.params.seasonId]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /seasons/:seasonId
router.delete('/seasons/:seasonId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_seasons WHERE id = ?', [req.params.seasonId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== DOCUMENTS ========================

// POST /:id/documents - Ajouter un document
router.post('/:id/documents', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { name, doc_type, file_path, expiry_date, notes } = req.body;
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_documents (green_space_id, name, doc_type, file_path, expiry_date, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, name, doc_type || 'autre', file_path || '', expiry_date || null, notes || '', req.user!.userId, now]
    );

    const created = await db.queryOne('SELECT * FROM green_space_documents WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /documents/:docId
router.delete('/documents/:docId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_documents WHERE id = ?', [req.params.docId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== RECHERCHE D'OBJETS DU PARC ========================

router.get('/search/objects', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || String(q).length < 2) {
      return res.json({ success: true, data: [] });
    }
    const objects = await db.query(`
      SELECT o.id, o.name, o.reference, o.image, o.purchase_price, o.purchase_date,
        o.status, o.description, o.custom_fields,
        c.name as category_name, sc.name as subcategory_name
      FROM objects o
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
      WHERE o.name LIKE ? OR o.reference LIKE ?
      ORDER BY o.name
      LIMIT 20
    `, [`%${q}%`, `%${q}%`]);
    res.json({ success: true, data: objects });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== TYPES D'ÉLÉMENTS ========================

router.get('/element-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query(
      "SELECT DISTINCT element_type FROM green_space_elements WHERE element_type != '' ORDER BY element_type"
    );
    // Ajouter les types par défaut s'ils n'existent pas
    const defaultTypes = ['arbre', 'arbuste', 'fleur', 'mobilier_urbain', 'jeux', 'poubelle', 'banc', 'eclairage', 'cloture', 'allee', 'pelouse', 'bassin', 'autre'];
    const existingTypes = types.map((t: any) => t.element_type);
    const allTypes = [...new Set([...existingTypes, ...defaultTypes])].sort();
    res.json({ success: true, data: allTypes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
