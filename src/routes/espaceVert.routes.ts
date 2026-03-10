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

// GET /maintenance-types - Liste des types d'entretien (autocomplete éditable)
router.get('/maintenance-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query(
      "SELECT DISTINCT maintenance_type FROM green_space_maintenances WHERE maintenance_type != '' ORDER BY maintenance_type"
    );
    const defaultTypes = ['tonte', 'elagage', 'taille', 'arrosage', 'desherbage', 'fertilisation', 'traitement_phytosanitaire', 'plantation', 'ramassage_feuilles', 'nettoyage', 'reparation', 'inspection', 'autre'];
    const existingTypes = types.map((t: any) => t.maintenance_type);
    const allTypes = [...new Set([...existingTypes, ...defaultTypes])].sort();
    res.json({ success: true, data: allTypes });
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
    const defaultTypes = ['arbre', 'arbuste', 'fleur', 'mobilier_urbain', 'jeux', 'poubelle', 'banc', 'eclairage', 'cloture', 'allee', 'pelouse', 'bassin', 'autre'];
    const existingTypes = types.map((t: any) => t.element_type);
    const allTypes = [...new Set([...existingTypes, ...defaultTypes])].sort();
    res.json({ success: true, data: allTypes });
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

    // Récupérer les groupes de composition
    const groups = await db.query(
      'SELECT * FROM green_space_groups WHERE green_space_id = ? ORDER BY name ASC',
      [req.params.id]
    );

    // Récupérer les entretiens avec éléments et documents liés
    const maintenances = await db.query(
      'SELECT * FROM green_space_maintenances WHERE green_space_id = ? ORDER BY performed_date DESC, created_at DESC',
      [req.params.id]
    );
    for (const m of maintenances as any[]) {
      m.element_ids = (await db.query(
        'SELECT element_id FROM green_space_maintenance_elements WHERE maintenance_id = ?', [m.id]
      )).map((r: any) => r.element_id);
      m.document_ids = (await db.query(
        'SELECT document_id FROM green_space_maintenance_documents WHERE maintenance_id = ?', [m.id]
      )).map((r: any) => r.document_id);
    }

    res.json({
      success: true,
      data: { ...space, elements, annotations, seasons, documents, groups, maintenances }
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
        condition_state, custom_fields, area_m2, zone_points
      } = req.body;

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
          element_type, description, image, pos_x, pos_y, quantity,
          purchase_price, maintenance_notes, species, planting_date,
          last_maintenance_date, next_maintenance_date, condition_state,
          custom_fields, area_m2, zone_points, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, object_id || null, label, code || '',
          element_type || 'autre', description || '', image || '',
          pos_x || null, pos_y || null, quantity || 1,
          purchase_price || null, maintenance_notes || '',
          species || '', planting_date || null,
          last_maintenance_date || null, next_maintenance_date || null,
          condition_state || 'bon',
          custom_fields ? JSON.stringify(custom_fields) : '{}',
          area_m2 || null,
          zone_points ? JSON.stringify(zone_points) : null,
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
      condition_state, custom_fields, area_m2, zone_points
    } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_elements SET object_id = ?, label = ?, code = ?,
        element_type = ?, description = ?, image = ?,
        pos_x = ?, pos_y = ?, quantity = ?,
        purchase_price = ?, maintenance_notes = ?,
        species = ?, planting_date = ?,
        last_maintenance_date = ?, next_maintenance_date = ?,
        condition_state = ?, custom_fields = ?, area_m2 = ?, zone_points = ?, updated_at = ?
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
        area_m2 ?? existing.area_m2,
        zone_points !== undefined ? (zone_points ? JSON.stringify(zone_points) : null) : existing.zone_points,
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

// ======================== GROUPES DE COMPOSITION ========================

// POST /:id/groups - Créer un groupe de composition
router.post('/:id/groups', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { name, group_type, description, color, icon, area_m2, zone_points } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Le nom est requis' });
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_groups (green_space_id, name, group_type, description, color, icon, area_m2, zone_points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, name, group_type || 'massif', description || '', color || '#8b5cf6', icon || 'layers', area_m2 || null, zone_points ? JSON.stringify(zone_points) : null, now, now]
    );

    const created = await db.queryOne('SELECT * FROM green_space_groups WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /groups/:groupId - Modifier un groupe
router.put('/groups/:groupId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { name, group_type, description, color, icon, pos_x, pos_y, area_m2, zone_points } = req.body;
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_groups SET name = ?, group_type = ?, description = ?, color = ?, icon = ?, pos_x = ?, pos_y = ?, area_m2 = ?, zone_points = ?, updated_at = ? WHERE id = ?`,
      [name, group_type, description || '', color || '#8b5cf6', icon || 'layers', pos_x ?? null, pos_y ?? null, area_m2 ?? null, zone_points !== undefined ? (zone_points ? JSON.stringify(zone_points) : null) : null, now, req.params.groupId]
    );
    const updated = await db.queryOne('SELECT * FROM green_space_groups WHERE id = ?', [req.params.groupId]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /groups/:groupId - Supprimer un groupe (les éléments sont détachés, pas supprimés)
router.delete('/groups/:groupId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    // Détacher les éléments du groupe
    await db.execute('UPDATE green_space_elements SET group_id = NULL WHERE group_id = ?', [req.params.groupId]);
    await db.execute('DELETE FROM green_space_groups WHERE id = ?', [req.params.groupId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /groups/:groupId/elements - Assigner des éléments à un groupe
router.put('/groups/:groupId/elements', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { element_ids } = req.body;
    if (!Array.isArray(element_ids)) return res.status(400).json({ success: false, message: 'element_ids doit être un tableau' });
    // Détacher les éléments du groupe existant
    await db.execute('UPDATE green_space_elements SET group_id = NULL WHERE group_id = ?', [req.params.groupId]);
    // Assigner les nouveaux
    for (const eid of element_ids) {
      await db.execute('UPDATE green_space_elements SET group_id = ? WHERE id = ?', [req.params.groupId, eid]);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== ENTRETIENS ========================

// POST /:id/maintenances - Créer un entretien
router.post('/:id/maintenances', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { maintenance_type, title, description, performed_date, next_maintenance_date, performed_by, duration_minutes, cost, notes, element_ids, document_ids } = req.body;
    if (!maintenance_type) return res.status(400).json({ success: false, message: 'Le type d\'entretien est requis' });

    const now = new Date().toISOString();
    const result = await db.execute(
      `INSERT INTO green_space_maintenances (green_space_id, maintenance_type, title, description, performed_date, next_maintenance_date, performed_by, duration_minutes, cost, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, maintenance_type, title || '', description || '', performed_date || null, next_maintenance_date || null, performed_by || '', duration_minutes || null, cost || null, notes || '', now, now]
    );

    const maintenanceId = result.lastInsertRowid;

    // Lier les éléments
    if (Array.isArray(element_ids)) {
      for (const eid of element_ids) {
        await db.execute('INSERT INTO green_space_maintenance_elements (maintenance_id, element_id) VALUES (?, ?)', [maintenanceId, eid]);
      }
      // Mettre à jour la date de dernier entretien des éléments
      if (performed_date) {
        for (const eid of element_ids) {
          await db.execute('UPDATE green_space_elements SET last_maintenance_date = ? WHERE id = ?', [performed_date, eid]);
        }
      }
      if (next_maintenance_date) {
        for (const eid of element_ids) {
          await db.execute('UPDATE green_space_elements SET next_maintenance_date = ? WHERE id = ?', [next_maintenance_date, eid]);
        }
      }
    }

    // Lier les documents
    if (Array.isArray(document_ids)) {
      for (const did of document_ids) {
        await db.execute('INSERT INTO green_space_maintenance_documents (maintenance_id, document_id) VALUES (?, ?)', [maintenanceId, did]);
      }
    }

    // Créer un événement calendrier si prochaine date d'entretien
    if (next_maintenance_date) {
      const space = await db.queryOne('SELECT name FROM green_spaces WHERE id = ?', [req.params.id]);
      const spaceName = space?.name || 'Espace vert';
      await db.execute(
        `INSERT INTO calendar_events (title, description, event_type, start_date, end_date, all_day, color, plugin_reference, plugin_reference_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `🌿 ${spaceName}: ${maintenance_type}`,
          `Entretien prévu - ${title || maintenance_type}${performed_by ? `\nIntervenant: ${performed_by}` : ''}`,
          'maintenance',
          next_maintenance_date,
          next_maintenance_date,
          1,
          '#16a34a',
          'green-space-maintenance',
          maintenanceId,
          req.user?.userId
        ]
      );
    }

    const created = await db.queryOne('SELECT * FROM green_space_maintenances WHERE id = ?', [maintenanceId]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /maintenances/:maintenanceId - Modifier un entretien
router.put('/maintenances/:maintenanceId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { maintenance_type, title, description, performed_date, next_maintenance_date, performed_by, duration_minutes, cost, notes, element_ids, document_ids } = req.body;
    const now = new Date().toISOString();

    await db.execute(
      `UPDATE green_space_maintenances SET maintenance_type = ?, title = ?, description = ?, performed_date = ?, next_maintenance_date = ?, performed_by = ?, duration_minutes = ?, cost = ?, notes = ?, updated_at = ? WHERE id = ?`,
      [maintenance_type, title || '', description || '', performed_date || null, next_maintenance_date || null, performed_by || '', duration_minutes || null, cost || null, notes || '', now, req.params.maintenanceId]
    );

    // Re-lier les éléments
    if (Array.isArray(element_ids)) {
      await db.execute('DELETE FROM green_space_maintenance_elements WHERE maintenance_id = ?', [req.params.maintenanceId]);
      for (const eid of element_ids) {
        await db.execute('INSERT INTO green_space_maintenance_elements (maintenance_id, element_id) VALUES (?, ?)', [req.params.maintenanceId, eid]);
      }
      // Mettre à jour les dates d'entretien des éléments liés
      if (performed_date) {
        for (const eid of element_ids) {
          await db.execute('UPDATE green_space_elements SET last_maintenance_date = ? WHERE id = ?', [performed_date, eid]);
        }
      }
      if (next_maintenance_date) {
        for (const eid of element_ids) {
          await db.execute('UPDATE green_space_elements SET next_maintenance_date = ? WHERE id = ?', [next_maintenance_date, eid]);
        }
      }
    }

    // Re-lier les documents
    if (Array.isArray(document_ids)) {
      await db.execute('DELETE FROM green_space_maintenance_documents WHERE maintenance_id = ?', [req.params.maintenanceId]);
      for (const did of document_ids) {
        await db.execute('INSERT INTO green_space_maintenance_documents (maintenance_id, document_id) VALUES (?, ?)', [req.params.maintenanceId, did]);
      }
    }

    // Mettre à jour / créer l'événement calendrier
    await db.execute(
      "DELETE FROM calendar_events WHERE plugin_reference = 'green-space-maintenance' AND plugin_reference_id = ?",
      [req.params.maintenanceId]
    );
    if (next_maintenance_date) {
      const maintenance = await db.queryOne('SELECT green_space_id FROM green_space_maintenances WHERE id = ?', [req.params.maintenanceId]);
      const space = maintenance ? await db.queryOne('SELECT name FROM green_spaces WHERE id = ?', [maintenance.green_space_id]) : null;
      const spaceName = space?.name || 'Espace vert';
      await db.execute(
        `INSERT INTO calendar_events (title, description, event_type, start_date, end_date, all_day, color, plugin_reference, plugin_reference_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `🌿 ${spaceName}: ${maintenance_type}`,
          `Entretien prévu - ${title || maintenance_type}${performed_by ? `\nIntervenant: ${performed_by}` : ''}`,
          'maintenance',
          next_maintenance_date,
          next_maintenance_date,
          1,
          '#16a34a',
          'green-space-maintenance',
          req.params.maintenanceId,
          req.user?.userId
        ]
      );
    }

    // Mettre à jour / supprimer l'alerte existante
    await db.execute(
      "DELETE FROM alerts WHERE plugin_reference = 'green-space-maintenance' AND plugin_reference_id = ? AND is_dismissed = 0",
      [req.params.maintenanceId]
    );

    const updated = await db.queryOne('SELECT * FROM green_space_maintenances WHERE id = ?', [req.params.maintenanceId]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /maintenances/:maintenanceId - Supprimer un entretien
router.delete('/maintenances/:maintenanceId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_maintenance_elements WHERE maintenance_id = ?', [req.params.maintenanceId]);
    await db.execute('DELETE FROM green_space_maintenance_documents WHERE maintenance_id = ?', [req.params.maintenanceId]);
    await db.execute("DELETE FROM calendar_events WHERE plugin_reference = 'green-space-maintenance' AND plugin_reference_id = ?", [req.params.maintenanceId]);
    await db.execute("DELETE FROM alerts WHERE plugin_reference = 'green-space-maintenance' AND plugin_reference_id = ?", [req.params.maintenanceId]);
    await db.execute('DELETE FROM green_space_maintenances WHERE id = ?', [req.params.maintenanceId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== TYPES DE DOCUMENTS (CRUD) ========================

// GET /doc-types - Liste des types de documents
router.get('/doc-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query('SELECT * FROM green_space_doc_types ORDER BY is_default DESC, label ASC');
    res.json({ success: true, data: types });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /doc-types - Ajouter un type de document
router.post('/doc-types', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { value, label } = req.body;
    if (!value || !label) return res.status(400).json({ success: false, message: 'value et label sont requis' });
    const now = new Date().toISOString();
    const result = await db.execute(
      'INSERT INTO green_space_doc_types (value, label, is_default, created_at) VALUES (?, ?, 0, ?)',
      [value.toLowerCase().replace(/\s+/g, '_'), label, now]
    );
    const created = await db.queryOne('SELECT * FROM green_space_doc_types WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: 'Ce type existe déjà' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /doc-types/:id - Modifier un type de document
router.put('/doc-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, disabled } = req.body;
    if (label !== undefined) {
      await db.execute('UPDATE green_space_doc_types SET label = ? WHERE id = ?', [label, req.params.id]);
    }
    if (disabled !== undefined) {
      await db.execute('UPDATE green_space_doc_types SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, req.params.id]);
    }
    const updated = await db.queryOne('SELECT * FROM green_space_doc_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /doc-types/:id - Supprimer un type de document
router.delete('/doc-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_doc_types WHERE id = ? AND is_default = 0', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== TYPES D'ENTRETIEN PERSONNALISÉS (CRUD) ========================

// GET /custom-maintenance-types - Liste des types d'entretien personnalisés
router.get('/custom-maintenance-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query('SELECT * FROM green_space_maintenance_types ORDER BY is_default DESC, label ASC');
    res.json({ success: true, data: types });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /custom-maintenance-types - Ajouter un type d'entretien
router.post('/custom-maintenance-types', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { value, label, icon } = req.body;
    if (!value || !label) return res.status(400).json({ success: false, message: 'value et label sont requis' });
    const now = new Date().toISOString();
    const result = await db.execute(
      'INSERT INTO green_space_maintenance_types (value, label, icon, is_default, created_at) VALUES (?, ?, ?, 0, ?)',
      [value.toLowerCase().replace(/\s+/g, '_'), label, icon || '🔧', now]
    );
    const created = await db.queryOne('SELECT * FROM green_space_maintenance_types WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: 'Ce type existe déjà' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /custom-maintenance-types/:id - Modifier un type d'entretien
router.put('/custom-maintenance-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, icon, disabled } = req.body;
    if (label !== undefined) {
      await db.execute('UPDATE green_space_maintenance_types SET label = ?, icon = ? WHERE id = ?', [label, icon || '🔧', req.params.id]);
    }
    if (disabled !== undefined) {
      await db.execute('UPDATE green_space_maintenance_types SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, req.params.id]);
    }
    const updated = await db.queryOne('SELECT * FROM green_space_maintenance_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /custom-maintenance-types/:id - Supprimer un type d'entretien
router.delete('/custom-maintenance-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_maintenance_types WHERE id = ? AND is_default = 0', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
