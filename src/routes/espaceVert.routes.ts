import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor, requireFieldWrite } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';
import { filtreObjets, REFUS_PORTEE } from '../middleware/objectScope';

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

// ======================== TYPES D'ESPACES VERTS (CRUD) ========================

router.get('/space-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query('SELECT * FROM green_space_types ORDER BY is_default DESC, label ASC');
    res.json({ success: true, data: types });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/space-types', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { value, label, icon } = req.body;
    if (!value || !label) return res.status(400).json({ success: false, message: 'value et label sont requis' });
    const now = new Date().toISOString();
    const result = await db.execute(
      'INSERT INTO green_space_types (value, label, icon, is_default, created_at) VALUES (?, ?, ?, 0, ?)',
      [value.toLowerCase().replace(/\s+/g, '_'), label, icon || '🌳', now]
    );
    const created = await db.queryOne('SELECT * FROM green_space_types WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'Ce type existe déjà' });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/space-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, icon, disabled } = req.body;
    if (label !== undefined) {
      await db.execute('UPDATE green_space_types SET label = ?, icon = ? WHERE id = ?', [label, icon || '🌳', req.params.id]);
    }
    if (disabled !== undefined) {
      await db.execute('UPDATE green_space_types SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, req.params.id]);
    }
    const updated = await db.queryOne('SELECT * FROM green_space_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/space-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_types WHERE id = ? AND is_default = 0', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== STATUTS D'ESPACES VERTS (CRUD) ========================

router.get('/space-statuses', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const statuses = await db.query('SELECT * FROM green_space_statuses ORDER BY is_default DESC, label ASC');
    res.json({ success: true, data: statuses });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/space-statuses', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { value, label, color } = req.body;
    if (!value || !label) return res.status(400).json({ success: false, message: 'value et label sont requis' });
    const now = new Date().toISOString();
    const result = await db.execute(
      'INSERT INTO green_space_statuses (value, label, color, is_default, created_at) VALUES (?, ?, ?, 0, ?)',
      [value.toLowerCase().replace(/\s+/g, '_'), label, color || '', now]
    );
    const created = await db.queryOne('SELECT * FROM green_space_statuses WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'Ce statut existe déjà' });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/space-statuses/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, color, disabled } = req.body;
    if (label !== undefined) {
      await db.execute('UPDATE green_space_statuses SET label = ?, color = ? WHERE id = ?', [label, color || '', req.params.id]);
    }
    if (disabled !== undefined) {
      await db.execute('UPDATE green_space_statuses SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, req.params.id]);
    }
    const updated = await db.queryOne('SELECT * FROM green_space_statuses WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/space-statuses/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_statuses WHERE id = ? AND is_default = 0', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== TYPES DE GROUPES DE COMPOSITION (CRUD) ========================

router.get('/group-types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query('SELECT * FROM green_space_group_types ORDER BY is_default DESC, label ASC');
    res.json({ success: true, data: types });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/group-types', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { value, label, icon, color } = req.body;
    if (!value || !label) return res.status(400).json({ success: false, message: 'value et label sont requis' });
    const now = new Date().toISOString();
    const result = await db.execute(
      'INSERT INTO green_space_group_types (value, label, icon, color, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      [value.toLowerCase().replace(/\s+/g, '_'), label, icon || '🌺', color || '#8b5cf6', now]
    );
    const created = await db.queryOne('SELECT * FROM green_space_group_types WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'Ce type de groupe existe déjà' });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/group-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, icon, color, disabled } = req.body;
    if (label !== undefined) {
      await db.execute('UPDATE green_space_group_types SET label = ?, icon = ?, color = ? WHERE id = ?', [label, icon || '🌺', color || '#8b5cf6', req.params.id]);
    }
    if (disabled !== undefined) {
      await db.execute('UPDATE green_space_group_types SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, req.params.id]);
    }
    const updated = await db.queryOne('SELECT * FROM green_space_group_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/group-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_group_types WHERE id = ? AND is_default = 0', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== REMPLACEMENT D'ÉLÉMENTS (HISTORIQUE) ========================

// POST /elements/:elementId/replace - Remplacer un élément en archivant l'ancien
router.post('/elements/:elementId/replace', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_space_elements WHERE id = ?', [req.params.elementId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    const { season, year, reason, notes, new_label, new_species, new_element_type, new_description,
      new_condition_state, new_image, new_quantity, new_purchase_price, new_planting_date, new_custom_fields } = req.body;

    const now = new Date().toISOString();

    // Archiver l'état actuel de l'élément
    await db.execute(
      `INSERT INTO green_space_element_replacements (element_id, green_space_id, group_id, replaced_at, season, year, reason, notes,
        previous_label, previous_species, previous_element_type, previous_description, previous_condition_state,
        previous_image, previous_quantity, previous_purchase_price, previous_planting_date, previous_custom_fields,
        previous_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        existing.id, existing.green_space_id, existing.group_id || null,
        now, season || '', year || new Date().getFullYear(), reason || '', notes || '',
        existing.label, existing.species, existing.element_type, existing.description,
        existing.condition_state, existing.image, existing.quantity, existing.purchase_price,
        existing.planting_date, existing.custom_fields || '{}',
        JSON.stringify(existing),
        now
      ]
    );

    // Mettre à jour l'élément avec les nouvelles données
    await db.execute(
      `UPDATE green_space_elements SET
        label = ?, species = ?, element_type = ?, description = ?,
        condition_state = ?, image = ?, quantity = ?, purchase_price = ?,
        planting_date = ?, custom_fields = ?, updated_at = ?
       WHERE id = ?`,
      [
        new_label ?? existing.label, new_species ?? existing.species,
        new_element_type ?? existing.element_type, new_description ?? existing.description,
        new_condition_state ?? 'bon', new_image ?? existing.image,
        new_quantity ?? existing.quantity, new_purchase_price ?? existing.purchase_price,
        new_planting_date || now.split('T')[0], new_custom_fields ? JSON.stringify(new_custom_fields) : existing.custom_fields,
        now, req.params.elementId
      ]
    );

    const updated = await db.queryOne(`
      SELECT gse.*, o.name as object_name, o.image as object_image
      FROM green_space_elements gse
      LEFT JOIN objects o ON o.id = gse.object_id
      WHERE gse.id = ?
    `, [req.params.elementId]);

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /elements/:elementId/history - Historique des remplacements d'un élément
router.get('/elements/:elementId/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const history = await db.query(
      'SELECT * FROM green_space_element_replacements WHERE element_id = ? ORDER BY replaced_at DESC',
      [req.params.elementId]
    );
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id/replacement-history - Historique global de tous les remplacements d'un espace
router.get('/:id/replacement-history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const history = await db.query(
      `SELECT r.*, e.label as current_label, e.species as current_species, e.element_type as current_element_type
       FROM green_space_element_replacements r
       LEFT JOIN green_space_elements e ON e.id = r.element_id
       WHERE r.green_space_id = ?
       ORDER BY r.replaced_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: history });
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

    // Récupérer les documents avec éléments liés
    const documents = await db.query(
      'SELECT * FROM green_space_documents WHERE green_space_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    const elementsParDocument = await grouperEnfants(
      (marqueurs) => `SELECT document_id, element_id FROM green_space_document_elements WHERE document_id IN (${marqueurs})`,
      (documents as any[]).map((d) => d.id),
      'document_id'
    );
    for (const doc of documents as any[]) {
      doc.element_ids = enfantsDe(elementsParDocument, doc.id).map((r: any) => r.element_id);
    }

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
    const idsEntretiens = (maintenances as any[]).map((m) => m.id);
    const [elementsParEntretien, documentsParEntretien] = await Promise.all([
      grouperEnfants(
        (marqueurs) => `SELECT maintenance_id, element_id FROM green_space_maintenance_elements WHERE maintenance_id IN (${marqueurs})`,
        idsEntretiens,
        'maintenance_id'
      ),
      grouperEnfants(
        (marqueurs) => `SELECT maintenance_id, document_id FROM green_space_maintenance_documents WHERE maintenance_id IN (${marqueurs})`,
        idsEntretiens,
        'maintenance_id'
      ),
    ]);
    for (const m of maintenances as any[]) {
      m.element_ids = enfantsDe(elementsParEntretien, m.id).map((r: any) => r.element_id);
      m.document_ids = enfantsDe(documentsParEntretien, m.id).map((r: any) => r.document_id);
    }

    // Récupérer les snapshots
    const snapshots = await db.query(
      'SELECT id, label, snapshot_date, notes, created_at FROM green_space_snapshots WHERE green_space_id = ? ORDER BY snapshot_date DESC',
      [req.params.id]
    );

    res.json({
      success: true,
      data: { ...space, elements, annotations, seasons, documents, groups, maintenances, snapshots }
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
        condition_state, custom_fields, area_m2, zone_points, latitude, longitude
      } = req.body;

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
          element_type, description, image, pos_x, pos_y, quantity,
          purchase_price, maintenance_notes, species, planting_date,
          last_maintenance_date, next_maintenance_date, condition_state,
          custom_fields, area_m2, zone_points, latitude, longitude, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          latitude || null, longitude || null,
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
      condition_state, custom_fields, area_m2, zone_points, latitude, longitude
    } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_elements SET object_id = ?, label = ?, code = ?,
        element_type = ?, description = ?, image = ?,
        pos_x = ?, pos_y = ?, quantity = ?,
        purchase_price = ?, maintenance_notes = ?,
        species = ?, planting_date = ?,
        last_maintenance_date = ?, next_maintenance_date = ?,
        condition_state = ?, custom_fields = ?, area_m2 = ?, zone_points = ?,
        latitude = ?, longitude = ?, updated_at = ?
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
        latitude ?? existing.latitude, longitude ?? existing.longitude,
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
    const { name, doc_type, file_path, expiry_date, notes, element_ids } = req.body;
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_documents (green_space_id, name, doc_type, file_path, expiry_date, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, name, doc_type || 'autre', file_path || '', expiry_date || null, notes || '', req.user!.userId, now]
    );

    const docId = result.lastInsertRowid;

    // Lier les éléments au document
    if (element_ids && Array.isArray(element_ids)) {
      for (const elId of element_ids) {
        await db.execute(
          'INSERT INTO green_space_document_elements (document_id, element_id) VALUES (?, ?)',
          [docId, elId]
        );
      }
    }

    const created = await db.queryOne('SELECT * FROM green_space_documents WHERE id = ?', [docId]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /documents/:docId - Modifier un document (éléments liés)
router.put('/documents/:docId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_space_documents WHERE id = ?', [req.params.docId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Document non trouvé' });
    }

    const { name, doc_type, file_path, expiry_date, notes, element_ids } = req.body;

    await db.execute(
      `UPDATE green_space_documents SET name = ?, doc_type = ?, file_path = ?, expiry_date = ?, notes = ? WHERE id = ?`,
      [
        name ?? existing.name, doc_type ?? existing.doc_type,
        file_path ?? existing.file_path, expiry_date !== undefined ? (expiry_date || null) : existing.expiry_date,
        notes ?? existing.notes, req.params.docId
      ]
    );

    // Mettre à jour les éléments liés
    if (element_ids && Array.isArray(element_ids)) {
      await db.execute('DELETE FROM green_space_document_elements WHERE document_id = ?', [req.params.docId]);
      for (const elId of element_ids) {
        await db.execute(
          'INSERT INTO green_space_document_elements (document_id, element_id) VALUES (?, ?)',
          [req.params.docId, elId]
        );
      }
    }

    const updated = await db.queryOne('SELECT * FROM green_space_documents WHERE id = ?', [req.params.docId]);
    res.json({ success: true, data: updated });
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
    // Recherche libre sur tout le parc, sans aucun filtre : elle rendait nom,
    // référence, prix d'achat et description de matériels que le compte n'a pas
    // le droit de consulter.
    const filtre = await filtreObjets(req, 'o');
    if (filtre === null) {
      return res.json({ success: true, data: [] });
    }

    const objects = await db.query(`
      SELECT o.id, o.name, o.reference, o.image, o.purchase_price, o.purchase_date,
        o.status, o.description, o.custom_fields,
        c.name as category_name, sc.name as subcategory_name
      FROM objects o
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
      WHERE (o.name LIKE ? OR o.reference LIKE ?)${filtre.sql}
      ORDER BY o.name
      LIMIT 20
    `, [`%${q}%`, `%${q}%`, ...filtre.params]);
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
router.post('/:id/maintenances', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
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

// ======================== SNAPSHOTS / ARCHIVES ========================

// POST /:id/snapshots - Créer un snapshot de l'état actuel
router.post('/:id/snapshots', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const space = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!space) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    const { label, notes } = req.body;
    const now = new Date().toISOString();

    // Capturer les éléments actuels
    const elements = await db.query(
      `SELECT gse.*, o.name as object_name FROM green_space_elements gse
       LEFT JOIN objects o ON o.id = gse.object_id
       WHERE gse.green_space_id = ?`, [req.params.id]
    );

    // Capturer les annotations actuelles
    const annotations = await db.query(
      'SELECT * FROM green_space_annotations WHERE green_space_id = ?', [req.params.id]
    );

    // Capturer les groupes actuels
    const groups = await db.query(
      'SELECT * FROM green_space_groups WHERE green_space_id = ?', [req.params.id]
    );

    const result = await db.execute(
      `INSERT INTO green_space_snapshots (green_space_id, label, snapshot_date, plan_image, elements_data, annotations_data, groups_data, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        label || `Snapshot du ${new Date().toLocaleDateString('fr-FR')}`,
        now,
        space.plan_image || '',
        JSON.stringify(elements),
        JSON.stringify(annotations),
        JSON.stringify(groups),
        notes || '',
        now
      ]
    );

    const created = await db.queryOne('SELECT * FROM green_space_snapshots WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id/snapshots - Liste des snapshots
router.get('/:id/snapshots', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const snapshots = await db.query(
      'SELECT id, green_space_id, label, snapshot_date, notes, created_at FROM green_space_snapshots WHERE green_space_id = ? ORDER BY snapshot_date DESC',
      [req.params.id]
    );
    res.json({ success: true, data: snapshots });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /snapshots/:snapshotId - Détail d'un snapshot
router.get('/snapshots/:snapshotId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const snapshot = await db.queryOne('SELECT * FROM green_space_snapshots WHERE id = ?', [req.params.snapshotId]);
    if (!snapshot) {
      return res.status(404).json({ success: false, message: 'Snapshot non trouvé' });
    }
    // Parser les données JSON
    snapshot.elements_data = JSON.parse(snapshot.elements_data || '[]');
    snapshot.annotations_data = JSON.parse(snapshot.annotations_data || '[]');
    snapshot.groups_data = JSON.parse(snapshot.groups_data || '[]');
    res.json({ success: true, data: snapshot });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /snapshots/:snapshotId - Supprimer un snapshot
router.delete('/snapshots/:snapshotId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM green_space_snapshots WHERE id = ?', [req.params.snapshotId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/clone - Cloner un espace vert
router.post('/:id/clone', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const source = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!source) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    const { name, status, element_ids, copy_elements } = req.body;
    const now = new Date().toISOString();

    // 1. Créer un snapshot automatique de l'espace source avant le clonage
    const sourceElements = await db.query(
      `SELECT gse.*, o.name as object_name FROM green_space_elements gse
       LEFT JOIN objects o ON o.id = gse.object_id
       WHERE gse.green_space_id = ?`, [req.params.id]
    );
    const sourceAnnotations = await db.query(
      'SELECT * FROM green_space_annotations WHERE green_space_id = ?', [req.params.id]
    );
    const sourceGroups = await db.query(
      'SELECT * FROM green_space_groups WHERE green_space_id = ?', [req.params.id]
    );

    await db.execute(
      `INSERT INTO green_space_snapshots (green_space_id, label, snapshot_date, plan_image, elements_data, annotations_data, groups_data, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        `Avant clonage - ${new Date().toLocaleDateString('fr-FR')}`,
        now, source.plan_image || '',
        JSON.stringify(sourceElements),
        JSON.stringify(sourceAnnotations),
        JSON.stringify(sourceGroups),
        `Snapshot automatique avant clonage vers "${name || source.name + ' (copie)'}"`,
        now
      ]
    );

    // 2. Créer le nouvel espace vert
    const cloneName = name || `${source.name} (copie)`;
    const cloneResult = await db.execute(
      `INSERT INTO green_spaces (name, description, address, latitude, longitude,
        area_m2, space_type, soil_type, status, image, plan_image, custom_fields,
        cloned_from_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cloneName, source.description, source.address,
        source.latitude, source.longitude,
        source.area_m2, source.space_type, source.soil_type,
        status || 'projet', source.image, source.plan_image,
        source.custom_fields,
        source.id, req.user!.userId, now, now
      ]
    );

    const newSpaceId = cloneResult.lastInsertRowid;

    // 3. Copier les éléments sélectionnés
    if (copy_elements) {
      const elementsToCopy = element_ids && element_ids.length > 0
        ? (sourceElements as any[]).filter((el: any) => element_ids.includes(el.id))
        : sourceElements as any[];

      const elementIdMap: Record<number, number> = {};

      for (const el of elementsToCopy) {
        const elResult = await db.execute(
          `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
            element_type, description, image, pos_x, pos_y, quantity,
            purchase_price, maintenance_notes, species, planting_date,
            last_maintenance_date, next_maintenance_date, condition_state,
            custom_fields, area_m2, zone_points, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newSpaceId, el.object_id, el.label, el.code,
            el.element_type, el.description, el.image,
            el.pos_x, el.pos_y, el.quantity,
            el.purchase_price, el.maintenance_notes,
            el.species, el.planting_date,
            el.last_maintenance_date, el.next_maintenance_date,
            el.condition_state, el.custom_fields || '{}',
            el.area_m2, el.zone_points, now, now
          ]
        );
        elementIdMap[el.id] = Number(elResult.lastInsertRowid);
      }

      // 4. Copier les annotations liées aux éléments copiés (et les annotations libres)
      for (const ann of sourceAnnotations as any[]) {
        const newElementId = ann.element_id ? elementIdMap[ann.element_id] : null;
        if (ann.element_id && !newElementId) continue; // skip si l'élément n'a pas été copié
        await db.execute(
          `INSERT INTO green_space_annotations (green_space_id, element_id, pos_x, pos_y, label, icon, color, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newSpaceId, newElementId || null, ann.pos_x, ann.pos_y, ann.label, ann.icon, ann.color, now]
        );
      }

      // 5. Copier les groupes
      for (const g of sourceGroups as any[]) {
        await db.execute(
          `INSERT INTO green_space_groups (green_space_id, name, group_type, description, color, icon, pos_x, pos_y, area_m2, zone_points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newSpaceId, g.name, g.group_type, g.description, g.color, g.icon, g.pos_x, g.pos_y, g.area_m2, g.zone_points]
        );
      }
    }

    await logService.info('other', `Espace vert cloné: ${source.name} -> ${cloneName}`, { userId: req.user!.userId });

    const created = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [newSpaceId]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id/archives - Récupérer les données archivées (espace source si cloné)
router.get('/:id/archives', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const space = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!space) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    // Snapshots de cet espace
    const snapshots = await db.query(
      'SELECT id, label, snapshot_date, notes, created_at FROM green_space_snapshots WHERE green_space_id = ? ORDER BY snapshot_date DESC',
      [req.params.id]
    );

    // Si l'espace est un clone, récupérer aussi les données de l'original
    let sourceSpace = null;
    let sourceDocuments: any[] = [];
    let sourceMaintenances: any[] = [];
    let sourceSnapshots: any[] = [];

    if (space.cloned_from_id) {
      sourceSpace = await db.queryOne('SELECT id, name, status FROM green_spaces WHERE id = ?', [space.cloned_from_id]);
      if (sourceSpace) {
        sourceDocuments = await db.query(
          'SELECT * FROM green_space_documents WHERE green_space_id = ? ORDER BY created_at DESC',
          [space.cloned_from_id]
        ) as any[];
        sourceMaintenances = await db.query(
          'SELECT * FROM green_space_maintenances WHERE green_space_id = ? ORDER BY performed_date DESC',
          [space.cloned_from_id]
        ) as any[];
        sourceSnapshots = await db.query(
          'SELECT id, label, snapshot_date, notes, created_at FROM green_space_snapshots WHERE green_space_id = ? ORDER BY snapshot_date DESC',
          [space.cloned_from_id]
        ) as any[];
      }
    }

    res.json({
      success: true,
      data: {
        snapshots,
        cloned_from: sourceSpace,
        source_documents: sourceDocuments,
        source_maintenances: sourceMaintenances,
        source_snapshots: sourceSnapshots
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
