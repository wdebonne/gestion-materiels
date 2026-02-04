import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Types de champs disponibles
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'textarea', 'checkbox', 'email', 'tel', 'url'];

// Champs système par défaut (ceux qui apparaissent toujours dans les détails)
const SYSTEM_FIELDS = [
  { fieldName: 'category', fieldLabel: 'Catégorie', fieldType: 'system', isSystem: true },
  { fieldName: 'subcategory', fieldLabel: 'Sous-catégorie', fieldType: 'system', isSystem: true },
  { fieldName: 'updatedAt', fieldLabel: 'Dernière modification', fieldType: 'system', isSystem: true },
  { fieldName: 'id', fieldLabel: 'Identifiant', fieldType: 'system', isSystem: true }
];

// GET /api/custom-fields/config/:categoryId - Récupérer la configuration des champs pour une catégorie
router.get('/config/category/:categoryId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;

    // Récupérer les configurations existantes pour cette catégorie (au niveau catégorie, pas sous-catégorie)
    const configs = await db.query(
      `SELECT * FROM custom_fields_config 
       WHERE category_id = ? AND subcategory_id IS NULL
       ORDER BY sort_order, field_label`,
      [categoryId]
    );

    // Si aucune configuration, retourner les champs système par défaut
    if (configs.length === 0) {
      return res.json({
        success: true,
        fields: SYSTEM_FIELDS.map((f, index) => ({
          ...f,
          id: null,
          categoryId: parseInt(categoryId),
          subcategoryId: null,
          isVisible: true,
          isRequired: false,
          sortOrder: index,
          fieldOptions: null
        }))
      });
    }

    res.json({
      success: true,
      fields: configs.map((c: any) => ({
        id: c.id,
        categoryId: c.category_id,
        subcategoryId: c.subcategory_id,
        fieldName: c.field_name,
        fieldLabel: c.field_label,
        fieldType: c.field_type,
        fieldOptions: c.field_options ? JSON.parse(c.field_options) : null,
        isRequired: !!c.is_required,
        isVisible: !!c.is_visible,
        isSystem: !!c.is_system,
        sortOrder: c.sort_order
      }))
    });
  } catch (error: any) {
    console.error('Erreur get custom fields config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/custom-fields/config/subcategory/:subcategoryId - Récupérer la configuration pour une sous-catégorie
router.get('/config/subcategory/:subcategoryId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { subcategoryId } = req.params;

    // Récupérer la sous-catégorie pour avoir la catégorie parente
    const subcategory = await db.queryOne(
      'SELECT * FROM subcategories WHERE id = ?',
      [subcategoryId]
    );

    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    // D'abord, chercher une config spécifique à cette sous-catégorie
    let configs = await db.query(
      `SELECT * FROM custom_fields_config 
       WHERE subcategory_id = ?
       ORDER BY sort_order, field_label`,
      [subcategoryId]
    );

    // Si pas de config spécifique, hériter de la catégorie parente
    if (configs.length === 0) {
      configs = await db.query(
        `SELECT * FROM custom_fields_config 
         WHERE category_id = ? AND subcategory_id IS NULL
         ORDER BY sort_order, field_label`,
        [subcategory.category_id]
      );
    }

    // Si toujours rien, retourner les champs système par défaut
    if (configs.length === 0) {
      return res.json({
        success: true,
        fields: SYSTEM_FIELDS.map((f, index) => ({
          ...f,
          id: null,
          categoryId: subcategory.category_id,
          subcategoryId: parseInt(subcategoryId),
          isVisible: true,
          isRequired: false,
          sortOrder: index,
          fieldOptions: null
        })),
        inherited: true
      });
    }

    res.json({
      success: true,
      fields: configs.map((c: any) => ({
        id: c.id,
        categoryId: c.category_id,
        subcategoryId: c.subcategory_id,
        fieldName: c.field_name,
        fieldLabel: c.field_label,
        fieldType: c.field_type,
        fieldOptions: c.field_options ? JSON.parse(c.field_options) : null,
        isRequired: !!c.is_required,
        isVisible: !!c.is_visible,
        isSystem: !!c.is_system,
        sortOrder: c.sort_order
      })),
      inherited: !configs[0]?.subcategory_id
    });
  } catch (error: any) {
    console.error('Erreur get subcategory custom fields config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/custom-fields/for-object/:objectId - Récupérer les champs configurés pour un objet spécifique
router.get('/for-object/:objectId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { objectId } = req.params;

    // Récupérer l'objet pour connaître sa catégorie/sous-catégorie
    const object = await db.queryOne(
      'SELECT category_id, subcategory_id FROM objects WHERE id = ?',
      [objectId]
    );

    if (!object) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    let configs: any[] = [];

    // Priorité: sous-catégorie > catégorie > défaut
    if (object.subcategory_id) {
      configs = await db.query(
        `SELECT * FROM custom_fields_config 
         WHERE subcategory_id = ?
         ORDER BY sort_order, field_label`,
        [object.subcategory_id]
      );
    }

    if (configs.length === 0 && object.category_id) {
      configs = await db.query(
        `SELECT * FROM custom_fields_config 
         WHERE category_id = ? AND subcategory_id IS NULL
         ORDER BY sort_order, field_label`,
        [object.category_id]
      );
    }

    // Si aucune config, retourner les champs système par défaut (tous visibles)
    if (configs.length === 0) {
      return res.json({
        success: true,
        fields: SYSTEM_FIELDS.map((f, index) => ({
          ...f,
          id: null,
          isVisible: true,
          isRequired: false,
          sortOrder: index,
          fieldOptions: null
        }))
      });
    }

    res.json({
      success: true,
      fields: configs.map((c: any) => ({
        id: c.id,
        categoryId: c.category_id,
        subcategoryId: c.subcategory_id,
        fieldName: c.field_name,
        fieldLabel: c.field_label,
        fieldType: c.field_type,
        fieldOptions: c.field_options ? JSON.parse(c.field_options) : null,
        isRequired: !!c.is_required,
        isVisible: !!c.is_visible,
        isSystem: !!c.is_system,
        sortOrder: c.sort_order
      }))
    });
  } catch (error: any) {
    console.error('Erreur get object custom fields:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/custom-fields/config - Sauvegarder la configuration des champs
router.post('/config', authenticateToken, requireAdmin, [
  body('categoryId').optional().isInt(),
  body('subcategoryId').optional().isInt(),
  body('fields').isArray()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { categoryId, subcategoryId, fields } = req.body;

    if (!categoryId && !subcategoryId) {
      return res.status(400).json({ success: false, message: 'categoryId ou subcategoryId requis' });
    }

    // Supprimer les anciennes configurations pour cette catégorie/sous-catégorie
    if (subcategoryId) {
      await db.execute('DELETE FROM custom_fields_config WHERE subcategory_id = ?', [subcategoryId]);
    } else {
      await db.execute('DELETE FROM custom_fields_config WHERE category_id = ? AND subcategory_id IS NULL', [categoryId]);
    }

    // Insérer les nouvelles configurations
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      await db.execute(
        `INSERT INTO custom_fields_config 
         (category_id, subcategory_id, field_name, field_label, field_type, field_options, is_required, is_visible, is_system, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          subcategoryId ? null : categoryId,
          subcategoryId || null,
          field.fieldName,
          field.fieldLabel,
          field.fieldType || 'text',
          field.fieldOptions ? JSON.stringify(field.fieldOptions) : null,
          field.isRequired ? 1 : 0,
          field.isVisible !== false ? 1 : 0,
          field.isSystem ? 1 : 0,
          field.sortOrder ?? i
        ]
      );
    }

    // Si c'est pour une sous-catégorie, récupérer l'ID de la catégorie parente
    let finalCategoryId = categoryId;
    if (subcategoryId && !categoryId) {
      const sub = await db.queryOne('SELECT category_id FROM subcategories WHERE id = ?', [subcategoryId]);
      if (sub) finalCategoryId = sub.category_id;
    }

    res.json({
      success: true,
      message: 'Configuration sauvegardée'
    });
  } catch (error: any) {
    console.error('Erreur save custom fields config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/custom-fields/add - Ajouter un nouveau champ
router.post('/add', authenticateToken, requireAdmin, [
  body('fieldName').notEmpty().trim(),
  body('fieldLabel').notEmpty().trim(),
  body('fieldType').isIn(FIELD_TYPES)
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { categoryId, subcategoryId, fieldName, fieldLabel, fieldType, fieldOptions, isRequired } = req.body;

    if (!categoryId && !subcategoryId) {
      return res.status(400).json({ success: false, message: 'categoryId ou subcategoryId requis' });
    }

    // Vérifier si le champ existe déjà
    const existing = await db.queryOne(
      `SELECT id FROM custom_fields_config 
       WHERE field_name = ? AND (category_id = ? OR subcategory_id = ?)`,
      [fieldName, categoryId, subcategoryId]
    );

    if (existing) {
      return res.status(400).json({ success: false, message: 'Un champ avec ce nom existe déjà' });
    }

    // Récupérer le prochain sort_order
    const maxOrder = await db.queryOne(
      `SELECT MAX(sort_order) as max_order FROM custom_fields_config 
       WHERE category_id = ? OR subcategory_id = ?`,
      [categoryId, subcategoryId]
    );

    const sortOrder = (maxOrder?.max_order || 0) + 1;

    const result = await db.execute(
      `INSERT INTO custom_fields_config 
       (category_id, subcategory_id, field_name, field_label, field_type, field_options, is_required, is_visible, is_system, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      [
        subcategoryId ? null : categoryId,
        subcategoryId || null,
        fieldName,
        fieldLabel,
        fieldType,
        fieldOptions ? JSON.stringify(fieldOptions) : null,
        isRequired ? 1 : 0,
        sortOrder
      ]
    );

    res.json({
      success: true,
      field: {
        id: result.lastInsertRowid,
        categoryId,
        subcategoryId,
        fieldName,
        fieldLabel,
        fieldType,
        fieldOptions,
        isRequired,
        isVisible: true,
        isSystem: false,
        sortOrder
      }
    });
  } catch (error: any) {
    console.error('Erreur add custom field:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/custom-fields/:id - Supprimer un champ
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Vérifier que ce n'est pas un champ système
    const field = await db.queryOne('SELECT * FROM custom_fields_config WHERE id = ?', [id]);
    
    if (!field) {
      return res.status(404).json({ success: false, message: 'Champ non trouvé' });
    }

    if (field.is_system) {
      return res.status(400).json({ success: false, message: 'Impossible de supprimer un champ système' });
    }

    await db.execute('DELETE FROM custom_fields_config WHERE id = ?', [id]);

    res.json({ success: true, message: 'Champ supprimé' });
  } catch (error: any) {
    console.error('Erreur delete custom field:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/custom-fields/reset/:categoryId - Réinitialiser les champs d'une catégorie aux valeurs par défaut
router.put('/reset/category/:categoryId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;

    // Supprimer toutes les configurations pour cette catégorie
    await db.execute('DELETE FROM custom_fields_config WHERE category_id = ? AND subcategory_id IS NULL', [categoryId]);

    res.json({ success: true, message: 'Configuration réinitialisée' });
  } catch (error: any) {
    console.error('Erreur reset custom fields:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/custom-fields/reset/subcategory/:subcategoryId - Réinitialiser pour une sous-catégorie
router.put('/reset/subcategory/:subcategoryId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { subcategoryId } = req.params;

    // Supprimer les configurations spécifiques à cette sous-catégorie (héritera de la catégorie)
    await db.execute('DELETE FROM custom_fields_config WHERE subcategory_id = ?', [subcategoryId]);

    res.json({ success: true, message: 'Configuration réinitialisée (hérite de la catégorie)' });
  } catch (error: any) {
    console.error('Erreur reset subcategory custom fields:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
