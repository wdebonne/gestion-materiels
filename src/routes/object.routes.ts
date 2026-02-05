import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireSupervisor } from '../middleware/auth.middleware';

const router = Router();

// GET /api/objects - Liste des objets
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, subcategoryId, status, search, page = 1, limit = 20 } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (categoryId) {
      whereClause += ' AND o.category_id = ?';
      params.push(categoryId);
    }

    if (subcategoryId) {
      whereClause += ' AND o.subcategory_id = ?';
      params.push(subcategoryId);
    }

    if (status) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (search) {
      // Recherche dans les champs standards ET dans les champs personnalisés (JSON)
      whereClause += ' AND (o.name LIKE ? OR o.reference LIKE ? OR o.serial_number LIKE ? OR o.custom_fields LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Pagination
    const offset = (Number(page) - 1) * Number(limit);

    // Compter le total
    const countResult = await db.queryOne(
      `SELECT COUNT(*) as count FROM objects o WHERE ${whereClause}`,
      params
    );

    // Récupérer les objets (catégorie résolue via sous-catégorie si nécessaire)
    const objects = await db.query(
      `SELECT o.*, 
              COALESCE(c.name, c2.name) as category_name, 
              COALESCE(c.id, c2.id) as resolved_category_id,
              s.name as subcategory_name 
       FROM objects o
       LEFT JOIN subcategories s ON s.id = o.subcategory_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN categories c2 ON c2.id = s.category_id
       WHERE ${whereClause}
       ORDER BY o.name
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({
      success: true,
      objects: objects.map((o: any) => ({
        id: o.id,
        categoryId: o.resolved_category_id || o.category_id,
        categoryName: o.category_name,
        subcategoryId: o.subcategory_id,
        subcategoryName: o.subcategory_name,
        name: o.name,
        description: o.description,
        image: o.image,
        reference: o.reference,
        serialNumber: o.serial_number,
        purchaseDate: o.purchase_date,
        purchasePrice: o.purchase_price,
        status: o.status,
        location: o.location,
        notes: o.notes,
        customFields: o.custom_fields ? JSON.parse(o.custom_fields) : {},
        createdAt: o.created_at,
        updatedAt: o.updated_at
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countResult?.count || 0,
        totalPages: Math.ceil((countResult?.count || 0) / Number(limit))
      }
    });
  } catch (error: any) {
    console.error('Erreur get objects:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/objects/:id - Détail d'un objet
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Récupérer la catégorie soit directement (o.category_id) soit via la sous-catégorie (s.category_id)
    const obj = await db.queryOne(
      `SELECT o.*, 
              COALESCE(c.name, c2.name) as category_name, 
              COALESCE(c.slug, c2.slug) as category_slug,
              COALESCE(c.id, c2.id) as resolved_category_id,
              s.name as subcategory_name, s.slug as subcategory_slug
       FROM objects o
       LEFT JOIN subcategories s ON s.id = o.subcategory_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN categories c2 ON c2.id = s.category_id
       WHERE o.id = ?`,
      [id]
    );

    if (!obj) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    // Récupérer les plugins actifs :
    // - soit sans aucune association (disponibles pour tous)
    // - soit associés à la catégorie de l'objet (avec subcategory_id NULL = toute la catégorie)
    // - soit associés à la sous-catégorie spécifique de l'objet
    const plugins = await db.query(
      `SELECT DISTINCT p.* FROM plugins p
       WHERE p.is_active = 1 
       AND (
         NOT EXISTS (SELECT 1 FROM plugin_categories pc2 WHERE pc2.plugin_id = p.id)
         OR EXISTS (
           SELECT 1 FROM plugin_categories pc 
           WHERE pc.plugin_id = p.id 
           AND (
             (pc.category_id = ? AND pc.subcategory_id IS NULL)
             OR (pc.subcategory_id = ? AND ? IS NOT NULL)
             OR (pc.category_id = ? AND pc.subcategory_id = ?)
           )
         )
       )`,
      [obj.category_id, obj.subcategory_id, obj.subcategory_id, obj.category_id, obj.subcategory_id]
    );

    // Récupérer les données des plugins
    const pluginData: any = {};

    for (const plugin of plugins) {
      switch (plugin.slug) {
        case 'fuel':
          pluginData.fuel = await db.query(
            'SELECT * FROM fuel_entries WHERE object_id = ? ORDER BY entry_date DESC',
            [id]
          );
          break;
        case 'technical-control':
          pluginData.technicalControls = await db.query(
            'SELECT * FROM technical_controls WHERE object_id = ? ORDER BY control_date DESC',
            [id]
          );
          break;
        case 'maintenance':
          pluginData.maintenances = await db.query(
            'SELECT * FROM maintenances WHERE object_id = ? ORDER BY maintenance_date DESC',
            [id]
          );
          break;
      }
    }

    // Récupérer les alertes actives
    const alerts = await db.query(
      `SELECT * FROM alerts WHERE object_id = ? AND is_dismissed = 0 ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      object: {
        id: obj.id,
        categoryId: obj.category_id,
        categoryName: obj.category_name,
        categorySlug: obj.category_slug,
        subcategoryId: obj.subcategory_id,
        subcategoryName: obj.subcategory_name,
        subcategorySlug: obj.subcategory_slug,
        name: obj.name,
        description: obj.description,
        image: obj.image,
        reference: obj.reference,
        serialNumber: obj.serial_number,
        purchaseDate: obj.purchase_date,
        purchasePrice: obj.purchase_price,
        status: obj.status,
        location: obj.location,
        notes: obj.notes,
        customFields: obj.custom_fields ? JSON.parse(obj.custom_fields) : {},
        createdAt: obj.created_at,
        updatedAt: obj.updated_at,
        category: obj.category_name ? {
          id: obj.resolved_category_id || obj.category_id,
          name: obj.category_name,
          slug: obj.category_slug
        } : null,
        subcategory: obj.subcategory_name ? {
          id: obj.subcategory_id,
          name: obj.subcategory_name,
          slug: obj.subcategory_slug
        } : null,
        activePlugins: plugins.map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          icon: p.icon,
          config: p.config ? JSON.parse(p.config) : {}
        })),
        fuelRecords: pluginData.fuel?.map((f: any) => ({
          id: f.id,
          date: f.entry_date,
          fuelType: f.fuel_type,
          quantity: f.quantity,
          unitPrice: f.unit_price,
          totalPrice: f.total_price,
          cost: f.total_price, // Alias pour le frontend
          mileage: f.mileage,
          station: f.station,
          notes: f.notes,
          attachments: f.attachments ? JSON.parse(f.attachments) : []
        })) || [],
        maintenanceRecords: pluginData.maintenances?.map((m: any) => ({
          id: m.id,
          date: m.maintenance_date,
          type: m.maintenance_type,
          description: m.description,
          cost: m.cost,
          mileage: m.mileage,
          nextDate: m.next_date,
          provider: m.provider,
          notes: m.notes,
          attachments: m.attachments ? JSON.parse(m.attachments) : []
        })) || [],
        technicalControls: pluginData.technicalControls?.map((t: any) => ({
          id: t.id,
          date: t.control_date,
          expiryDate: t.expiry_date,
          mileage: t.mileage,
          result: t.result,
          centerName: t.center_name,
          cost: t.cost,
          document: t.document,
          notes: t.notes,
          attachments: t.attachments ? JSON.parse(t.attachments) : []
        })) || [],
        alerts: alerts.map((a: any) => ({
          id: a.id,
          title: a.title,
          message: a.message,
          type: a.alert_type,
          severity: a.severity,
          dueDate: a.due_date,
          createdAt: a.created_at
        }))
      }
    });
  } catch (error: any) {
    console.error('Erreur get object:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects - Créer un objet
router.post('/', authenticateToken, requireSupervisor, [
  body('name').notEmpty().trim().withMessage('Nom requis')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      categoryId, subcategoryId, name, description, image,
      reference, serialNumber, purchaseDate, purchasePrice,
      status = 'active', location, notes, customFields
    } = req.body;

    // Récupérer l'image par défaut si non fournie
    let finalImage = image;
    if (!finalImage) {
      const defaultImg = await db.queryOne(
        "SELECT setting_value FROM settings WHERE setting_key = 'default_image'"
      );
      finalImage = defaultImg?.setting_value || '';
    }

    const result = await db.execute(
      `INSERT INTO objects (category_id, subcategory_id, name, description, image, 
       reference, serial_number, purchase_date, purchase_price, status, location, notes, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId || null, subcategoryId || null, name, description || null, finalImage,
        reference || null, serialNumber || null, purchaseDate || null, purchasePrice || null,
        status, location || null, notes || null, customFields ? JSON.stringify(customFields) : null
      ]
    );

    // Log de l'activité
    await db.execute(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user?.userId, 'create', 'object', result.lastInsertRowid, `Objet créé: ${name}`]
    );

    res.status(201).json({
      success: true,
      message: 'Objet créé',
      objectId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create object:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/:id - Modifier un objet
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      categoryId, subcategoryId, name, description, image,
      reference, serialNumber, purchaseDate, purchasePrice,
      status, location, notes, customFields
    } = req.body;

    const obj = await db.queryOne('SELECT id FROM objects WHERE id = ?', [id]);
    if (!obj) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    let updateFields = [];
    let values = [];

    if (categoryId !== undefined) {
      updateFields.push('category_id = ?');
      values.push(categoryId);
    }
    if (subcategoryId !== undefined) {
      updateFields.push('subcategory_id = ?');
      values.push(subcategoryId);
    }
    if (name) {
      updateFields.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      values.push(description);
    }
    if (image !== undefined) {
      updateFields.push('image = ?');
      values.push(image);
    }
    if (reference !== undefined) {
      updateFields.push('reference = ?');
      values.push(reference);
    }
    if (serialNumber !== undefined) {
      updateFields.push('serial_number = ?');
      values.push(serialNumber);
    }
    if (purchaseDate !== undefined) {
      updateFields.push('purchase_date = ?');
      values.push(purchaseDate);
    }
    if (purchasePrice !== undefined) {
      updateFields.push('purchase_price = ?');
      values.push(purchasePrice);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(status);
    }
    if (location !== undefined) {
      updateFields.push('location = ?');
      values.push(location);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      values.push(notes);
    }
    if (customFields !== undefined) {
      updateFields.push('custom_fields = ?');
      values.push(JSON.stringify(customFields));
    }

    updateFields.push("updated_at = datetime('now')");
    values.push(id);

    await db.execute(
      `UPDATE objects SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Objet mis à jour' });
  } catch (error: any) {
    console.error('Erreur update object:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/:id - Supprimer un objet
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.execute('DELETE FROM objects WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    res.json({ success: true, message: 'Objet supprimé' });
  } catch (error: any) {
    console.error('Erreur delete object:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PLUGIN: CARBURANT ===

// POST /api/objects/:id/fuel - Ajouter une entrée carburant
router.post('/:id/fuel', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // Support des noms de champs du frontend (date, cost) et backend (entryDate, unitPrice)
    const { fuelType, quantity, cost, mileage, station, entryDate, date, notes, attachments } = req.body;

    // Utiliser les valeurs du frontend si disponibles
    const finalEntryDate = date || entryDate;
    const totalPrice = cost ? parseFloat(cost) : null;
    const qty = quantity ? parseFloat(quantity) : null;
    
    // Calculer le prix unitaire (€/L) = coût total / quantité
    const unitPriceCalculated = (totalPrice && qty && qty > 0) ? (totalPrice / qty) : null;

    // Récupérer le type de carburant depuis les customFields de l'objet si non fourni
    let finalFuelType = fuelType;
    if (!finalFuelType) {
      const objectData = await db.query(
        'SELECT custom_fields FROM objects WHERE id = ?',
        [id]
      );
      if (objectData && objectData.length > 0 && objectData[0].custom_fields) {
        try {
          const customFields = JSON.parse(objectData[0].custom_fields);
          // Chercher le type de carburant dans différents noms possibles
          finalFuelType = customFields.fuelType || customFields.typeCarburant || 
                         customFields['Type de carburant'] || customFields.carburant ||
                         customFields.fuel_type;
        } catch (e) {
          // Ignorer les erreurs de parsing JSON
        }
      }
      // Valeur par défaut si toujours non défini
      finalFuelType = finalFuelType || 'Carburant';
    }

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const result = await db.execute(
      `INSERT INTO fuel_entries (object_id, fuel_type, quantity, unit_price, total_price, mileage, station, entry_date, notes, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, finalFuelType, qty, unitPriceCalculated, totalPrice, mileage || null, station || null, finalEntryDate, notes || null, attachmentsJson]
    );

    res.status(201).json({
      success: true,
      message: 'Entrée carburant ajoutée',
      entryId: result.lastInsertRowid,
      unitPrice: unitPriceCalculated ? unitPriceCalculated.toFixed(3) : null
    });
  } catch (error: any) {
    console.error('Erreur add fuel entry:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/:id/fuel/:entryId - Modifier une entrée carburant
router.put('/:id/fuel/:entryId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, entryId } = req.params;
    const { fuelType, quantity, cost, mileage, station, date, notes, attachments } = req.body;

    const totalPrice = cost ? parseFloat(cost) : null;
    const qty = quantity ? parseFloat(quantity) : null;
    const unitPriceCalculated = (totalPrice && qty && qty > 0) ? (totalPrice / qty) : null;
    
    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const result = await db.execute(
      `UPDATE fuel_entries SET 
        fuel_type = ?, quantity = ?, unit_price = ?, total_price = ?, 
        mileage = ?, station = ?, entry_date = ?, notes = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [fuelType || 'Carburant', qty, unitPriceCalculated, totalPrice, mileage || null, station || null, date, notes || null, attachmentsJson, entryId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée' });
    }

    res.json({ success: true, message: 'Entrée carburant modifiée', unitPrice: unitPriceCalculated });
  } catch (error: any) {
    console.error('Erreur update fuel entry:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/:id/fuel/:entryId - Supprimer une entrée carburant
router.delete('/:id/fuel/:entryId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, entryId } = req.params;

    const result = await db.execute(
      'DELETE FROM fuel_entries WHERE id = ? AND object_id = ?',
      [entryId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée' });
    }

    res.json({ success: true, message: 'Entrée carburant supprimée' });
  } catch (error: any) {
    console.error('Erreur delete fuel entry:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === STATIONS DE CARBURANT ===

// GET /api/objects/fuel-stations - Liste des stations
router.get('/fuel-stations/list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stations = await db.query('SELECT * FROM fuel_stations ORDER BY name ASC');
    res.json({ success: true, stations });
  } catch (error: any) {
    console.error('Erreur get fuel stations:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects/fuel-stations - Ajouter une station
router.post('/fuel-stations', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, address } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'INSERT INTO fuel_stations (name, address) VALUES (?, ?)',
      [name.trim(), address?.trim() || null]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Station ajoutée',
      station: { id: result.lastInsertRowid, name: name.trim(), address: address?.trim() || null }
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Cette station existe déjà' });
    }
    console.error('Erreur add fuel station:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/fuel-stations/:id - Modifier une station
router.put('/fuel-stations/:stationId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { stationId } = req.params;
    const { name, address } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'UPDATE fuel_stations SET name = ?, address = ? WHERE id = ?',
      [name.trim(), address?.trim() || null, stationId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Station non trouvée' });
    }

    res.json({ success: true, message: 'Station modifiée' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce nom de station existe déjà' });
    }
    console.error('Erreur update fuel station:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/fuel-stations/:id - Supprimer une station
router.delete('/fuel-stations/:stationId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { stationId } = req.params;

    const result = await db.execute(
      'DELETE FROM fuel_stations WHERE id = ?',
      [stationId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Station non trouvée' });
    }

    res.json({ success: true, message: 'Station supprimée' });
  } catch (error: any) {
    console.error('Erreur delete fuel station:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === TYPES D'ENTRETIEN ===

// GET /api/objects/maintenance-types/list - Liste des types d'entretien
router.get('/maintenance-types/list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const types = await db.query('SELECT * FROM maintenance_types ORDER BY name ASC');
    res.json({ success: true, types });
  } catch (error: any) {
    console.error('Erreur get maintenance types:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects/maintenance-types - Ajouter un type d'entretien
router.post('/maintenance-types', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'INSERT INTO maintenance_types (name) VALUES (?)',
      [name.trim()]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Type d\'entretien ajouté',
      type: { id: result.lastInsertRowid, name: name.trim() }
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce type d\'entretien existe déjà' });
    }
    console.error('Erreur add maintenance type:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/maintenance-types/:id - Modifier un type d'entretien
router.put('/maintenance-types/:typeId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { typeId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'UPDATE maintenance_types SET name = ? WHERE id = ?',
      [name.trim(), typeId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Type d\'entretien non trouvé' });
    }

    res.json({ success: true, message: 'Type d\'entretien modifié' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce type d\'entretien existe déjà' });
    }
    console.error('Erreur update maintenance type:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/maintenance-types/:id - Supprimer un type d'entretien
router.delete('/maintenance-types/:typeId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { typeId } = req.params;

    const result = await db.execute(
      'DELETE FROM maintenance_types WHERE id = ?',
      [typeId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Type d\'entretien non trouvé' });
    }

    res.json({ success: true, message: 'Type d\'entretien supprimé' });
  } catch (error: any) {
    console.error('Erreur delete maintenance type:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PRESTATAIRES D'ENTRETIEN ===

// GET /api/objects/maintenance-providers/list - Liste des prestataires
router.get('/maintenance-providers/list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const providers = await db.query('SELECT * FROM maintenance_providers ORDER BY name ASC');
    res.json({ success: true, providers });
  } catch (error: any) {
    console.error('Erreur get maintenance providers:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects/maintenance-providers - Ajouter un prestataire
router.post('/maintenance-providers', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, phone } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'INSERT INTO maintenance_providers (name, address, phone) VALUES (?, ?, ?)',
      [name.trim(), address?.trim() || null, phone?.trim() || null]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Prestataire ajouté',
      provider: { id: result.lastInsertRowid, name: name.trim(), address: address?.trim() || null, phone: phone?.trim() || null }
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce prestataire existe déjà' });
    }
    console.error('Erreur add maintenance provider:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/maintenance-providers/:id - Modifier un prestataire
router.put('/maintenance-providers/:providerId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { providerId } = req.params;
    const { name, address, phone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'UPDATE maintenance_providers SET name = ?, address = ?, phone = ? WHERE id = ?',
      [name.trim(), address?.trim() || null, phone?.trim() || null, providerId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Prestataire non trouvé' });
    }

    res.json({ success: true, message: 'Prestataire modifié' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce nom de prestataire existe déjà' });
    }
    console.error('Erreur update maintenance provider:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/maintenance-providers/:id - Supprimer un prestataire
router.delete('/maintenance-providers/:providerId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { providerId } = req.params;

    const result = await db.execute(
      'DELETE FROM maintenance_providers WHERE id = ?',
      [providerId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Prestataire non trouvé' });
    }

    res.json({ success: true, message: 'Prestataire supprimé' });
  } catch (error: any) {
    console.error('Erreur delete maintenance provider:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === CENTRES DE CONTRÔLE TECHNIQUE ===

// GET /api/objects/control-centers/list - Liste des centres de contrôle
router.get('/control-centers/list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const centers = await db.query('SELECT * FROM control_centers ORDER BY name ASC');
    res.json({ success: true, centers });
  } catch (error: any) {
    console.error('Erreur get control centers:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects/control-centers - Ajouter un centre de contrôle
router.post('/control-centers', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, phone } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'INSERT INTO control_centers (name, address, phone) VALUES (?, ?, ?)',
      [name.trim(), address?.trim() || null, phone?.trim() || null]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Centre de contrôle ajouté',
      center: { id: result.lastInsertRowid, name: name.trim(), address: address?.trim() || null, phone: phone?.trim() || null }
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce centre de contrôle existe déjà' });
    }
    console.error('Erreur add control center:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/control-centers/:id - Modifier un centre de contrôle
router.put('/control-centers/:centerId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { centerId } = req.params;
    const { name, address, phone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const result = await db.execute(
      'UPDATE control_centers SET name = ?, address = ?, phone = ? WHERE id = ?',
      [name.trim(), address?.trim() || null, phone?.trim() || null, centerId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Centre de contrôle non trouvé' });
    }

    res.json({ success: true, message: 'Centre de contrôle modifié' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint') || error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ce nom de centre existe déjà' });
    }
    console.error('Erreur update control center:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/control-centers/:id - Supprimer un centre de contrôle
router.delete('/control-centers/:centerId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { centerId } = req.params;

    const result = await db.execute(
      'DELETE FROM control_centers WHERE id = ?',
      [centerId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Centre de contrôle non trouvé' });
    }

    res.json({ success: true, message: 'Centre de contrôle supprimé' });
  } catch (error: any) {
    console.error('Erreur delete control center:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PLUGIN: CONTRÔLE TECHNIQUE ===

// POST /api/objects/:id/technical-control - Ajouter un contrôle technique
router.post('/:id/technical-control', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { controlDate, expiryDate, mileage, result: controlResult, centerName, cost, document, notes, attachments } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const insertResult = await db.execute(
      `INSERT INTO technical_controls (object_id, control_date, expiry_date, mileage, result, center_name, cost, document, notes, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, controlDate, expiryDate, mileage, controlResult, centerName, cost, document, notes, attachmentsJson]
    );

    // Créer une alerte pour le prochain contrôle
    if (expiryDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `Contrôle technique: ${obj?.name}`,
          `Le contrôle technique expire le ${expiryDate}`,
          'technical_control',
          'warning',
          id,
          'technical-control',
          insertResult.lastInsertRowid,
          expiryDate
        ]
      );

      // Ajouter au calendrier
      await db.execute(
        `INSERT INTO calendar_events (title, description, event_type, start_date, all_day, object_id, plugin_reference, plugin_reference_id, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `CT: ${obj?.name}`,
          `Contrôle technique à effectuer`,
          'technical_control',
          expiryDate,
          1,
          id,
          'technical-control',
          insertResult.lastInsertRowid,
          '#ef4444'
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Contrôle technique ajouté',
      controlId: insertResult.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur add technical control:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/:id/technical-control/:controlId
router.delete('/:id/technical-control/:controlId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, controlId } = req.params;

    // Supprimer les alertes et événements associés
    await db.execute(
      "DELETE FROM alerts WHERE plugin_reference = 'technical-control' AND plugin_reference_id = ?",
      [controlId]
    );
    await db.execute(
      "DELETE FROM calendar_events WHERE plugin_reference = 'technical-control' AND plugin_reference_id = ?",
      [controlId]
    );

    const result = await db.execute(
      'DELETE FROM technical_controls WHERE id = ? AND object_id = ?',
      [controlId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Contrôle non trouvé' });
    }

    res.json({ success: true, message: 'Contrôle technique supprimé' });
  } catch (error: any) {
    console.error('Erreur delete technical control:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/:id/technical-control/:controlId - Modifier un contrôle technique
router.put('/:id/technical-control/:controlId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, controlId } = req.params;
    const { controlDate, expiryDate, mileage, result: controlResult, centerName, cost, document, notes, attachments } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const result = await db.execute(
      `UPDATE technical_controls SET 
        control_date = ?, expiry_date = ?, mileage = ?, result = ?, 
        center_name = ?, cost = ?, document = ?, notes = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [controlDate, expiryDate, mileage, controlResult, centerName, cost, document, notes, attachmentsJson, controlId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Contrôle non trouvé' });
    }

    // Mettre à jour l'alerte si expiryDate a changé
    if (expiryDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      // Supprimer l'ancienne alerte
      await db.execute(
        "DELETE FROM alerts WHERE plugin_reference = 'technical-control' AND plugin_reference_id = ?",
        [controlId]
      );
      // Créer une nouvelle alerte
      await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `Contrôle technique: ${obj?.name}`,
          `Le contrôle technique expire le ${expiryDate}`,
          'technical_control',
          'warning',
          id,
          'technical-control',
          controlId,
          expiryDate
        ]
      );
    }

    res.json({ success: true, message: 'Contrôle technique modifié' });
  } catch (error: any) {
    console.error('Erreur update technical control:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PLUGIN: MAINTENANCE ===

// POST /api/objects/:id/maintenance - Ajouter une maintenance
router.post('/:id/maintenance', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      maintenanceType, maintenanceDate, nextDate, mileage, nextMileage,
      cost, provider, document, notes, addToCalendar, attachments 
    } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const insertResult = await db.execute(
      `INSERT INTO maintenances (object_id, maintenance_type, maintenance_date, next_date, mileage, next_mileage, cost, provider, document, notes, add_to_calendar, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, maintenanceType, maintenanceDate, nextDate, mileage, nextMileage, cost, provider, document, notes, addToCalendar ? 1 : 0, attachmentsJson]
    );

    // Créer une alerte pour la prochaine maintenance
    if (nextDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `Maintenance: ${obj?.name}`,
          `${maintenanceType} prévue le ${nextDate}`,
          'maintenance',
          'info',
          id,
          'maintenance',
          insertResult.lastInsertRowid,
          nextDate
        ]
      );

      // Ajouter au calendrier si demandé
      if (addToCalendar) {
        await db.execute(
          `INSERT INTO calendar_events (title, description, event_type, start_date, all_day, object_id, plugin_reference, plugin_reference_id, color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${maintenanceType}: ${obj?.name}`,
            `Maintenance prévue`,
            'maintenance',
            nextDate,
            1,
            id,
            'maintenance',
            insertResult.lastInsertRowid,
            '#8b5cf6'
          ]
        );
      }
    }

    res.status(201).json({
      success: true,
      message: 'Maintenance ajoutée',
      maintenanceId: insertResult.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur add maintenance:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/objects/:id/maintenance/:maintenanceId
router.delete('/:id/maintenance/:maintenanceId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, maintenanceId } = req.params;

    // Supprimer les alertes et événements associés
    await db.execute(
      "DELETE FROM alerts WHERE plugin_reference = 'maintenance' AND plugin_reference_id = ?",
      [maintenanceId]
    );
    await db.execute(
      "DELETE FROM calendar_events WHERE plugin_reference = 'maintenance' AND plugin_reference_id = ?",
      [maintenanceId]
    );

    const result = await db.execute(
      'DELETE FROM maintenances WHERE id = ? AND object_id = ?',
      [maintenanceId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Maintenance non trouvée' });
    }

    res.json({ success: true, message: 'Maintenance supprimée' });
  } catch (error: any) {
    console.error('Erreur delete maintenance:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/objects/:id/maintenance/:maintenanceId - Modifier une maintenance
router.put('/:id/maintenance/:maintenanceId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, maintenanceId } = req.params;
    const { 
      maintenanceType, maintenanceDate, nextDate, mileage, nextMileage,
      cost, provider, document, notes, addToCalendar, attachments 
    } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const result = await db.execute(
      `UPDATE maintenances SET 
        maintenance_type = ?, maintenance_date = ?, next_date = ?, 
        mileage = ?, next_mileage = ?, cost = ?, provider = ?, 
        document = ?, notes = ?, add_to_calendar = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [maintenanceType, maintenanceDate, nextDate, mileage, nextMileage, cost, provider, document, notes, addToCalendar ? 1 : 0, attachmentsJson, maintenanceId, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Maintenance non trouvée' });
    }

    // Mettre à jour l'alerte si nextDate a changé
    if (nextDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      // Supprimer l'ancienne alerte
      await db.execute(
        "DELETE FROM alerts WHERE plugin_reference = 'maintenance' AND plugin_reference_id = ?",
        [maintenanceId]
      );
      // Créer une nouvelle alerte
      await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `Maintenance: ${obj?.name}`,
          `${maintenanceType} prévue le ${nextDate}`,
          'maintenance',
          'info',
          id,
          'maintenance',
          maintenanceId,
          nextDate
        ]
      );
    }

    res.json({ success: true, message: 'Maintenance modifiée' });
  } catch (error: any) {
    console.error('Erreur update maintenance:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
