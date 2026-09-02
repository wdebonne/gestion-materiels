import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireSupervisor, requireFieldWrite, getAccessibleCategoryIds, checkCategoryPermission, checkCategoryAccess } from '../middleware/auth.middleware';
import { notifierWebhooks } from '../services/webhook.service';
import { dateOuNull, nombreOuNull } from '../utils/valeursSql';
import { filtreObjets, peutVoirObjet, REFUS_PORTEE } from '../middleware/objectScope';
import {
  expressionPrestation,
  lireChoixPrestation,
  versColonnePrestation,
} from '../services/prestationParc.service';
import { enrichirLots, expressionNature } from '../services/lotParc.service';
import { expressionDisponibilite } from '../services/materielPretable.service';
import {
  appliquerReleves,
  compteursAvecValeurs,
  compteursDuMateriel,
  lireChampsPersonnalises,
  natureEcriture,
  natureEnergie,
  relevesDUneEcriture,
  relevesPourEcriture,
  valeurEnergie,
} from '../services/compteurs.service';

const router = Router();

// Helper pour récupérer les paramètres d'alertes
async function getAlertSettings(): Promise<{
  technical_control: { days: number; priority: string };
  maintenance: { days: number; priority: string };
  fuel: { days: number; priority: string };
  custom: { days: number; priority: string };
}> {
  const defaultSettings = {
    technical_control: { days: 30, priority: 'medium' },
    maintenance: { days: 14, priority: 'low' },
    fuel: { days: 7, priority: 'low' },
    custom: { days: 7, priority: 'low' }
  };

  try {
    const setting = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'alert_settings'"
    );
    if (setting && setting.setting_value) {
      const parsed = JSON.parse(setting.setting_value);
      return { ...defaultSettings, ...parsed };
    }
  } catch (error) {
    console.error('Erreur récupération paramètres alertes:', error);
  }
  return defaultSettings;
}

// Helper pour vérifier si une alerte doit être créée
function shouldCreateAlert(dueDate: string, daysLimit: number): boolean {
  const dueDateObj = new Date(dueDate);
  const now = new Date();
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() + daysLimit);
  
  // Créer l'alerte seulement si la date d'échéance est dans la période configurée
  return dueDateObj >= now && dueDateObj <= limitDate;
}

// Helper pour convertir la priorité en sévérité
function priorityToSeverity(priority: string, daysUntilDue: number): string {
  if (daysUntilDue <= 7) return 'critical';
  if (daysUntilDue <= 15) return 'warning';
  switch (priority) {
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'info';
  }
}

// GET /api/objects - Liste des objets
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, subcategoryId, status, search, page = 1, limit = 20, sort } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    // Filtrer par catégories accessibles selon les permissions
    const accessibleIds = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);
    if (accessibleIds !== null) {
      if (accessibleIds.length === 0) {
        // Aucun accès — retourner une liste vide
        return res.json({
          success: true,
          objects: [],
          pagination: { page: Number(page), limit: Number(limit), total: 0, totalPages: 0 }
        });
      }
      const placeholders = accessibleIds.map(() => '?').join(',');
      whereClause += ` AND (o.category_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = o.subcategory_id AND sc.category_id IN (${placeholders})))`;
      params.push(...accessibleIds, ...accessibleIds);
    }

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

    // Tri
    const allowedSorts: Record<string, string> = {
      name: 'o.name ASC',
      updatedAt: 'o.updated_at DESC',
      createdAt: 'o.created_at DESC',
      status: 'o.status ASC, o.name ASC'
    };
    const orderBy = allowedSorts[sort as string] || 'o.name ASC';

    // Récupérer les objets (catégorie résolue via sous-catégorie si nécessaire)
    const objects = await db.query(
      `SELECT o.*, 
              COALESCE(c.name, c2.name) as category_name, 
              COALESCE(c.id, c2.id) as resolved_category_id,
              s.name as subcategory_name,
              ${expressionPrestation('o', 's', 'pc')} as prestation,
              ${expressionNature('o', 's', 'pc')} as nature
       FROM objects o
       LEFT JOIN subcategories s ON s.id = o.subcategory_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN categories c2 ON c2.id = s.category_id
       -- La catégorie effective, directe ou via la sous-catégorie : sans elle,
       -- le caractère de prestation retomberait sur le repli et le réglage
       -- porté par la catégorie n'aurait aucun effet visible.
       LEFT JOIN categories pc ON pc.id = COALESCE(o.category_id, s.category_id)
       WHERE ${whereClause}
       ORDER BY ${orderBy}
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
        // Le choix propre au matériel (`null` = il hérite) et le résultat
        // effectif : montrer les deux évite la question « pourquoi est-ce une
        // prestation alors que je n'ai rien coché dessus ? ».
        isPrestation: o.is_prestation === null || o.is_prestation === undefined
          ? null
          : Boolean(o.is_prestation),
        prestation: Boolean(o.prestation),
        nature: o.nature,
        materialType: o.material_type ?? 'unique',
        quantityTotal: o.quantity_total ?? 0,
        unitCost: o.unit_cost ?? 0,
        availableForManifestations:
          o.available_for_manifestations === null || o.available_for_manifestations === undefined
            ? null
            : Boolean(o.available_for_manifestations),
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

    // La liste filtrait par catégories accessibles, le détail non : n'importe
    // quel compte lisait la fiche complète d'un matériel en connaissant son
    // identifiant.
    const filtre = await filtreObjets(req, 'o');
    if (filtre === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    // Récupérer la catégorie soit directement (o.category_id) soit via la sous-catégorie (s.category_id)
    const obj = await db.queryOne(
      `SELECT o.*, 
              COALESCE(c.name, c2.name) as category_name, 
              COALESCE(c.slug, c2.slug) as category_slug,
              COALESCE(c.id, c2.id) as resolved_category_id,
              s.name as subcategory_name, s.slug as subcategory_slug,
              ${expressionPrestation('o', 's', 'pc')} as prestation,
              ${expressionNature('o', 's', 'pc')} as nature,
              ${expressionDisponibilite('o', 's', 'pc')} as pretable
       FROM objects o
       LEFT JOIN subcategories s ON s.id = o.subcategory_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN categories c2 ON c2.id = s.category_id
       LEFT JOIN categories pc ON pc.id = COALESCE(o.category_id, s.category_id)
       WHERE o.id = ?${filtre.sql}`,
      [id, ...filtre.params]
    );

    if (!obj) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    // Vérifier la permission d'accès à la catégorie de l'objet
    const categoryId = obj.resolved_category_id || obj.category_id;
    if (categoryId) {
      const hasAccess = await checkCategoryAccess(req.user!.userId, req.user!.role, categoryId);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Accès refusé à cette catégorie' });
      }
    }

    const nature: string = obj.nature ?? 'unique';

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

    // Un lot n'a ni plein d'essence ni contrôle technique : ces suivis portent
    // sur un exemplaire, pas sur un modèle. On ne fait pas le plein « des
    // chaises ». Le filtre est posé ici plutôt que dans l'écran : la donnée
    // cesse d'être chargée en même temps que l'onglet disparaît, et tous les
    // écrans en profitent d'un coup.
    //
    // L'**entretien** reste : un lot se répare et se nettoie, et c'est
    // justement ce qu'on veut consigner.
    const pluginsRetenus =
      nature === 'lot'
        ? plugins.filter((p: any) => p.slug !== 'fuel' && p.slug !== 'technical-control')
        : plugins;

    // Récupérer les données des plugins
    const pluginData: any = {};

    for (const plugin of pluginsRetenus) {
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

    // Compteurs déclarés sur la branche du matériel, et énergie qu'il consomme.
    // Les deux commandent ce que la page a le droit d'afficher : sans compteur
    // aucun champ de relevé, et une voiture électrique ne se voit pas demander
    // des litres.
    const compteurs = await compteursAvecValeurs(id);
    const champsPersonnalises = lireChampsPersonnalises(obj.custom_fields);

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
        customFields: champsPersonnalises,
        // Compteurs relevables et leur valeur du moment.
        counters: compteurs,
        energy: {
          kind: natureEnergie(champsPersonnalises),
          label: valeurEnergie(champsPersonnalises),
        },
        isPrestation: obj.is_prestation === null || obj.is_prestation === undefined
          ? null
          : Boolean(obj.is_prestation),
        prestation: Boolean(obj.prestation),
        nature: obj.nature,
        materialType: obj.material_type ?? 'unique',
        quantityTotal: obj.quantity_total ?? 0,
        unitCost: obj.unit_cost ?? 0,
        availableForManifestations:
          obj.available_for_manifestations === null || obj.available_for_manifestations === undefined
            ? null
            : Boolean(obj.available_for_manifestations),
        // Ce qui s'applique vraiment après héritage : la case cochée sur le
        // matériel ne dit rien tant qu'on ignore ce que sa branche décide.
        pretable: Boolean(obj.pretable),
        // Stock d'un lot, lu directement sur sa fiche de parc : ce qui est
        // dehors aujourd'hui, ce qui est promis, ce qui reste.
        ...(await stockDuLot(obj)),
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
        activePlugins: pluginsRetenus.map((p: any) => ({
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
          readings: relevesDUneEcriture(f, compteurs),
          energyKind: f.energy_kind === 'electric' ? 'electric' : 'fuel',
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
          readings: relevesDUneEcriture(m, compteurs),
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
          readings: relevesDUneEcriture(t, compteurs),
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
      status = 'active', location, notes, customFields, isPrestation,
      materialType, quantityTotal, unitCost, availableForManifestations
    } = req.body;

    // Vérifier la permission d'édition sur la catégorie cible
    const targetCategoryId = categoryId || (subcategoryId ? (await db.queryOne('SELECT category_id FROM subcategories WHERE id = ?', [subcategoryId]))?.category_id : null);
    if (targetCategoryId) {
      const canEdit = await checkCategoryPermission(req.user!.userId, req.user!.role, targetCategoryId, 'can_edit');
      if (!canEdit) {
        return res.status(403).json({ success: false, message: 'Accès refusé - Vous n\'avez pas la permission de créer dans cette catégorie' });
      }
    }

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
       reference, serial_number, purchase_date, purchase_price, status, location, notes, custom_fields,
       is_prestation, material_type, quantity_total, unit_cost, available_for_manifestations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId || null, subcategoryId || null, name, description || null, finalImage,
        reference || null, serialNumber || null, purchaseDate || null, purchasePrice || null,
        status, location || null, notes || null, customFields ? JSON.stringify(customFields) : null,
        // Laissé à `null` par défaut : le matériel hérite de sa sous-catégorie,
        // puis de sa catégorie. C'est ce qui permet de marquer une branche une
        // fois pour toutes plutôt qu'article par article.
        versColonnePrestation(lireChoixPrestation(isPrestation)),
        materialType === 'lot' ? 'lot' : 'unique',
        // La quantité n'a de sens que pour un lot : un exemplaire vaut 1, et
        // laisser saisir « 12 » sur un camion ferait croire qu'on en a douze.
        materialType === 'lot' ? Math.max(0, Number(quantityTotal) || 0) : 0,
        Math.max(0, Number(unitCost) || 0),
        // Trois états ici aussi : `null` laisse hériter de la branche, ce qui
        // reste le cas le plus fréquent.
        versColonnePrestation(lireChoixPrestation(availableForManifestations))
      ]
    );

    // Log de l'activité
    await db.execute(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user?.userId, 'create', 'object', result.lastInsertRowid, `Objet créé: ${name}`]
    );

    notifierWebhooks('object.created', { id: result.lastInsertRowid, name, categoryId, subcategoryId });

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
      status, location, notes, customFields, isPrestation, materialType, quantityTotal,
      unitCost, availableForManifestations
    } = req.body;

    const obj = await db.queryOne('SELECT id, category_id, subcategory_id FROM objects WHERE id = ?', [id]);
    if (!obj) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    // Vérifier la permission d'édition sur la catégorie de l'objet
    const objCategoryId = categoryId || obj.category_id || (obj.subcategory_id ? (await db.queryOne('SELECT category_id FROM subcategories WHERE id = ?', [obj.subcategory_id]))?.category_id : null);
    if (objCategoryId) {
      const canEdit = await checkCategoryPermission(req.user!.userId, req.user!.role, objCategoryId, 'can_edit');
      if (!canEdit) {
        return res.status(403).json({ success: false, message: 'Accès refusé - Vous n\'avez pas la permission de modifier dans cette catégorie' });
      }
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
    if (isPrestation !== undefined) {
      updateFields.push('is_prestation = ?');
      values.push(versColonnePrestation(lireChoixPrestation(isPrestation)));
    }
    if (materialType !== undefined) {
      updateFields.push('material_type = ?');
      values.push(materialType === 'lot' ? 'lot' : 'unique');
      // Repasser un lot en exemplaire remet sa quantité à zéro : la garder
      // afficherait « 50 » sur une fiche qui n'en compte plus qu'un.
      if (materialType !== 'lot') {
        updateFields.push('quantity_total = ?');
        values.push(0);
      }
    }
    if (quantityTotal !== undefined && materialType !== 'unique') {
      updateFields.push('quantity_total = ?');
      values.push(Math.max(0, Number(quantityTotal) || 0));
    }
    if (unitCost !== undefined) {
      updateFields.push('unit_cost = ?');
      values.push(Math.max(0, Number(unitCost) || 0));
    }
    if (availableForManifestations !== undefined) {
      updateFields.push('available_for_manifestations = ?');
      values.push(versColonnePrestation(lireChoixPrestation(availableForManifestations)));
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.execute(
      `UPDATE objects SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    notifierWebhooks('object.updated', { id: Number(id) });

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

    notifierWebhooks('object.deleted', { id: Number(id) });

    res.json({ success: true, message: 'Objet supprimé' });
  } catch (error: any) {
    console.error('Erreur delete object:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PLUGIN: CARBURANT ===

// POST /api/objects/:id/fuel - Ajouter une entrée carburant
router.post('/:id/fuel', authenticateToken, requireFieldWrite, [
  body('quantity').notEmpty().withMessage('La quantité est obligatoire')
    .isFloat({ gt: 0 }).withMessage('La quantité doit être un nombre supérieur à 0'),
  body('cost').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Le coût doit être un nombre positif'),
  body('mileage').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Le kilométrage doit être un entier positif'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
    }

    const { id } = req.params;
    // Support des noms de champs du frontend (date, cost) et backend (entryDate, unitPrice)
    const { fuelType, quantity, cost, mileage, station, entryDate, date, notes, attachments, readings, energyKind } = req.body;

    // Utiliser les valeurs du frontend si disponibles
    const finalEntryDate = date || entryDate;
    const totalPrice = cost ? parseFloat(cost) : null;
    const qty = quantity ? parseFloat(quantity) : null;

    // Prix unitaire = coût total / quantité. L'unité suit la nature de
    // l'écriture : €/L pour un plein, €/kWh pour une recharge.
    const unitPriceCalculated = (totalPrice && qty && qty > 0) ? (totalPrice / qty) : null;

    const objectData = await db.queryOne('SELECT custom_fields FROM objects WHERE id = ?', [id]);
    if (!objectData) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }
    const champsPersonnalises = lireChampsPersonnalises(objectData.custom_fields);

    // Carburant ou électricité : ce que le client précise, sinon ce que le
    // champ d'énergie du matériel indique.
    const nature = natureEcriture(energyKind, champsPersonnalises);

    // À défaut de type précisé, celui de la fiche — et un repli qui dit au
    // moins de quoi il s'agit plutôt que « Carburant » sur une recharge.
    const finalFuelType =
      fuelType || valeurEnergie(champsPersonnalises) || (nature === 'electric' ? 'Électrique' : 'Carburant');

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    // Relevés de compteurs : rangés sur l'écriture, puis reportés sur la fiche
    // sans jamais la faire reculer.
    const releves = await relevesPourEcriture(id, readings, mileage);

    const result = await db.execute(
      `INSERT INTO fuel_entries (object_id, fuel_type, energy_kind, quantity, unit_price, total_price, mileage, readings, station, entry_date, notes, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, finalFuelType, nature, qty, unitPriceCalculated, totalPrice, releves.mileage,
        releves.readings, station || null, dateOuNull(finalEntryDate), notes || null, attachmentsJson,
      ]
    );

    const compteurs = await appliquerReleves(id, releves.valeurs);

    notifierWebhooks('fuel.created', { objectId: Number(id), quantity, cost, energyKind: nature });

    res.status(201).json({
      success: true,
      message: nature === 'electric' ? 'Recharge ajoutée' : 'Entrée carburant ajoutée',
      entryId: result.lastInsertRowid,
      energyKind: nature,
      unitPrice: unitPriceCalculated ? unitPriceCalculated.toFixed(3) : null,
      compteurs
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
    const { fuelType, quantity, cost, mileage, station, date, notes, attachments, readings, energyKind } = req.body;

    const totalPrice = cost ? parseFloat(cost) : null;
    const qty = quantity ? parseFloat(quantity) : null;
    const unitPriceCalculated = (totalPrice && qty && qty > 0) ? (totalPrice / qty) : null;

    const objectData = await db.queryOne('SELECT custom_fields FROM objects WHERE id = ?', [id]);
    if (!objectData) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }
    const nature = natureEcriture(energyKind, lireChampsPersonnalises(objectData.custom_fields));

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const releves = await relevesPourEcriture(id, readings, mileage);

    const result = await db.execute(
      `UPDATE fuel_entries SET
        fuel_type = ?, energy_kind = ?, quantity = ?, unit_price = ?, total_price = ?,
        mileage = ?, readings = ?, station = ?, entry_date = ?, notes = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [
        fuelType || (nature === 'electric' ? 'Électrique' : 'Carburant'), nature, qty,
        unitPriceCalculated, totalPrice, releves.mileage, releves.readings, station || null,
        dateOuNull(date), notes || null, attachmentsJson, entryId, id,
      ]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée' });
    }

    const compteurs = await appliquerReleves(id, releves.valeurs);

    res.json({
      success: true,
      message: nature === 'electric' ? 'Recharge modifiée' : 'Entrée carburant modifiée',
      energyKind: nature,
      unitPrice: unitPriceCalculated,
      compteurs
    });
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

// === COMPTEURS ===

/**
 * PATCH /api/objects/:id/compteurs — relever un compteur depuis la fiche.
 *
 * Ouvert à l'agent de terrain, contrairement à la modification de la fiche
 * réservée au superviseur : relever un compteur est le geste quotidien du
 * chauffeur qui rentre au dépôt, et l'obliger à passer par « Modifier » lui
 * donnerait au passage le droit de changer le nom et la catégorie du véhicule.
 */
router.patch('/:id/compteurs', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { readings } = req.body;

    const objet = await db.queryOne('SELECT id FROM objects WHERE id = ?', [id]);
    if (!objet) {
      return res.status(404).json({ success: false, message: 'Objet non trouvé' });
    }

    // Relever le compteur d'un matériel suppose de pouvoir le consulter : sans
    // ce contrôle, un compte cantonné aux espaces verts pourrait faire avancer
    // le kilométrage d'un camion qu'il n'a pas le droit de voir.
    if (!(await peutVoirObjet(req, id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const compteurs = await appliquerReleves(id, readings);
    if (compteurs.retenus.length === 0 && compteurs.ignores.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun relevé exploitable' });
    }

    res.json({
      success: true,
      message: compteurs.retenus.length > 0 ? 'Compteur mis à jour' : 'Relevé non retenu',
      compteurs,
      valeurs: await compteursAvecValeurs(id),
    });
  } catch (error: any) {
    console.error('Erreur relevé compteur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === STATIONS ET BORNES ===

/**
 * GET /api/objects/fuel-stations - Liste des points de ravitaillement.
 *
 * `?kind=electric` ne rend que les bornes de recharge. Sans filtre, tout est
 * rendu : les écrans d'administration du référentiel les gèrent ensemble.
 */
router.get('/fuel-stations/list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const nature = req.query.kind === 'electric' ? 'electric' : req.query.kind === 'fuel' ? 'fuel' : null;

    // `kind IS NULL` couvre les lignes créées avant la migration 014 : elles
    // sont des stations-service, et les exclure viderait la liste existante.
    const stations = nature
      ? await db.query(
          nature === 'fuel'
            ? "SELECT * FROM fuel_stations WHERE kind = 'fuel' OR kind IS NULL ORDER BY name ASC"
            : "SELECT * FROM fuel_stations WHERE kind = 'electric' ORDER BY name ASC"
        )
      : await db.query('SELECT * FROM fuel_stations ORDER BY name ASC');

    res.json({ success: true, stations });
  } catch (error: any) {
    console.error('Erreur get fuel stations:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/objects/fuel-stations - Ajouter une station
/**
 * Cherche une entree de referentiel en ignorant la casse et les espaces.
 *
 * La contrainte UNIQUE de SQLite etant sensible a la casse, « Total Pavilly »
 * et « TOTAL Pavilly » etaient acceptes tous les deux : les couts se
 * retrouvaient alors eclates entre deux stations dans le module Suivi.
 */
async function trouverEntreeExistante(table: string, nom: string): Promise<{ id: number; name: string } | null> {
  return db.queryOne(
    `SELECT id, name FROM ${table} WHERE LOWER(TRIM(name)) = ?`,
    [nom.trim().toLowerCase()]
  );
}

router.post('/fuel-stations', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, kind } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    const nature = kind === 'electric' ? 'electric' : 'fuel';

    const existante = await trouverEntreeExistante('fuel_stations', name);
    if (existante) {
      return res.status(400).json({
        success: false,
        message: `Ce point de ravitaillement existe déjà sous le nom « ${existante.name} ».`
      });
    }

    const result = await db.execute(
      'INSERT INTO fuel_stations (name, address, kind) VALUES (?, ?, ?)',
      [name.trim(), address?.trim() || null, nature]
    );

    res.status(201).json({
      success: true,
      message: nature === 'electric' ? 'Borne ajoutée' : 'Station ajoutée',
      station: { id: result.lastInsertRowid, name: name.trim(), address: address?.trim() || null, kind: nature }
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
    const { name, address, kind } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    // La nature se corrige : une borne créée avant la distinction se retrouve
    // sinon coincée dans la liste des stations-service, sans moyen d'en sortir.
    const result = await db.execute(
      'UPDATE fuel_stations SET name = ?, address = ?, kind = ? WHERE id = ?',
      [name.trim(), address?.trim() || null, kind === 'electric' ? 'electric' : 'fuel', stationId]
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

    const existante = await trouverEntreeExistante('maintenance_types', name);
    if (existante) {
      return res.status(400).json({
        success: false,
        message: `Ce type d'entretien existe déjà sous le nom « ${existante.name} ».`
      });
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

    const existante = await trouverEntreeExistante('maintenance_providers', name);
    if (existante) {
      return res.status(400).json({
        success: false,
        message: `Ce prestataire existe déjà sous le nom « ${existante.name} ».`
      });
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

    const existante = await trouverEntreeExistante('control_centers', name);
    if (existante) {
      return res.status(400).json({
        success: false,
        message: `Ce centre de contrôle existe déjà sous le nom « ${existante.name} ».`
      });
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
router.post('/:id/technical-control', authenticateToken, requireFieldWrite, [
  // La route lit `controlDate` / `expiryDate` : c'est ce que le client envoie
  // après mappage. Valider `date` rejetterait toutes les saisies légitimes.
  body('controlDate').notEmpty().withMessage('La date du contrôle est obligatoire'),
  body('expiryDate').notEmpty().withMessage("La date d'expiration est obligatoire"),
  body('cost').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Le coût doit être un nombre positif'),
  body('mileage').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Le kilométrage doit être un entier positif'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { controlDate, expiryDate, mileage, result: controlResult, centerName, cost, document, notes, attachments, readings } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const releves = await relevesPourEcriture(id, readings, mileage);

    const insertResult = await db.execute(
      `INSERT INTO technical_controls (object_id, control_date, expiry_date, mileage, readings, result, center_name, cost, document, notes, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, dateOuNull(controlDate), dateOuNull(expiryDate), releves.mileage, releves.readings,
        controlResult, centerName, nombreOuNull(cost), document, notes, attachmentsJson,
      ]
    );

    const compteurs = await appliquerReleves(id, releves.valeurs);

    // Créer une alerte pour le prochain contrôle (seulement si dans la période configurée)
    if (expiryDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      const alertSettings = await getAlertSettings();
      
      // Vérifier si l'alerte doit être créée selon les paramètres
      if (shouldCreateAlert(expiryDate, alertSettings.technical_control.days)) {
        const daysUntilDue = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const severity = priorityToSeverity(alertSettings.technical_control.priority, daysUntilDue);
        
        await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Contrôle technique: ${obj?.name}`,
            `Le contrôle technique expire le ${expiryDate}`,
            'technical_control',
            severity,
            id,
            'technical-control',
            insertResult.lastInsertRowid,
            expiryDate
          ]
        );
      }

      // Ajouter au calendrier (toujours, indépendamment des paramètres d'alertes)
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
      controlId: insertResult.lastInsertRowid,
      compteurs
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
    const { controlDate, expiryDate, mileage, result: controlResult, centerName, cost, document, notes, attachments, readings } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const releves = await relevesPourEcriture(id, readings, mileage);

    const result = await db.execute(
      `UPDATE technical_controls SET
        control_date = ?, expiry_date = ?, mileage = ?, readings = ?, result = ?,
        center_name = ?, cost = ?, document = ?, notes = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [
        dateOuNull(controlDate), dateOuNull(expiryDate), releves.mileage, releves.readings,
        controlResult, centerName, nombreOuNull(cost), document, notes, attachmentsJson, controlId, id,
      ]
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
      
      // Créer une nouvelle alerte seulement si dans la période configurée
      const alertSettings = await getAlertSettings();
      if (shouldCreateAlert(expiryDate, alertSettings.technical_control.days)) {
        const daysUntilDue = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const severity = priorityToSeverity(alertSettings.technical_control.priority, daysUntilDue);
        
        await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Contrôle technique: ${obj?.name}`,
            `Le contrôle technique expire le ${expiryDate}`,
            'technical_control',
            severity,
            id,
            'technical-control',
            controlId,
            expiryDate
          ]
        );
      }
    }

    res.json({ success: true, message: 'Contrôle technique modifié' });
  } catch (error: any) {
    console.error('Erreur update technical control:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === PLUGIN: MAINTENANCE ===

// POST /api/objects/:id/maintenance - Ajouter une maintenance
router.post('/:id/maintenance', authenticateToken, requireFieldWrite, [
  body('maintenanceType').notEmpty().trim().withMessage("Le type d'entretien est obligatoire"),
  body('maintenanceDate').notEmpty().withMessage("La date de l'entretien est obligatoire"),
  body('cost').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Le coût doit être un nombre positif'),
  body('mileage').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Le kilométrage doit être un entier positif'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
    }

    const { id } = req.params;
    const {
      maintenanceType, maintenanceDate, nextDate, mileage, nextMileage,
      cost, provider, document, notes, addToCalendar, attachments, readings
    } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    // Relevés de compteurs. Une catégorie qui n'en déclare aucun — mobilier,
    // outillage — n'en reçoit pas et n'en enregistre pas.
    const releves = await relevesPourEcriture(id, readings, mileage);

    const insertResult = await db.execute(
      `INSERT INTO maintenances (object_id, maintenance_type, maintenance_date, next_date, mileage, readings, next_mileage, cost, provider, document, notes, add_to_calendar, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, maintenanceType, dateOuNull(maintenanceDate), dateOuNull(nextDate),
        releves.mileage, releves.readings, nombreOuNull(nextMileage), nombreOuNull(cost),
        provider, document, notes, addToCalendar ? 1 : 0, attachmentsJson,
      ]
    );

    const compteurs = await appliquerReleves(id, releves.valeurs);

    // Créer une alerte pour la prochaine maintenance (seulement si dans la période configurée)
    if (nextDate) {
      const obj = await db.queryOne('SELECT name FROM objects WHERE id = ?', [id]);
      const alertSettings = await getAlertSettings();
      
      // Vérifier si l'alerte doit être créée selon les paramètres
      if (shouldCreateAlert(nextDate, alertSettings.maintenance.days)) {
        const daysUntilDue = Math.ceil((new Date(nextDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const severity = priorityToSeverity(alertSettings.maintenance.priority, daysUntilDue);
        
        await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Maintenance: ${obj?.name}`,
            `${maintenanceType} prévue le ${nextDate}`,
            'maintenance',
            severity,
            id,
            'maintenance',
            insertResult.lastInsertRowid,
            nextDate
          ]
        );
      }

      // Ajouter au calendrier si demandé (toujours, indépendamment des paramètres d'alertes)
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

    notifierWebhooks('maintenance.created', { objectId: Number(id), maintenanceType, maintenanceDate });

    res.status(201).json({
      success: true,
      message: 'Maintenance ajoutée',
      maintenanceId: insertResult.lastInsertRowid,
      compteurs
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
      cost, provider, document, notes, addToCalendar, attachments, readings
    } = req.body;

    // Sérialiser les pièces jointes en JSON
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const releves = await relevesPourEcriture(id, readings, mileage);

    const result = await db.execute(
      `UPDATE maintenances SET
        maintenance_type = ?, maintenance_date = ?, next_date = ?,
        mileage = ?, readings = ?, next_mileage = ?, cost = ?, provider = ?,
        document = ?, notes = ?, add_to_calendar = ?, attachments = ?
       WHERE id = ? AND object_id = ?`,
      [
        maintenanceType, dateOuNull(maintenanceDate), dateOuNull(nextDate),
        releves.mileage, releves.readings, nombreOuNull(nextMileage), nombreOuNull(cost),
        provider, document, notes, addToCalendar ? 1 : 0, attachmentsJson, maintenanceId, id,
      ]
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
      
      // Créer une nouvelle alerte seulement si dans la période configurée
      const alertSettings = await getAlertSettings();
      if (shouldCreateAlert(nextDate, alertSettings.maintenance.days)) {
        const daysUntilDue = Math.ceil((new Date(nextDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const severity = priorityToSeverity(alertSettings.maintenance.priority, daysUntilDue);
        
        await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Maintenance: ${obj?.name}`,
            `${maintenanceType} prévue le ${nextDate}`,
            'maintenance',
            severity,
            id,
            'maintenance',
            maintenanceId,
            nextDate
          ]
        );
      }
    }

    res.json({ success: true, message: 'Maintenance modifiée' });
  } catch (error: any) {
    console.error('Erreur update maintenance:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * Stock d'un lot, tel que sa fiche de parc l'affiche.
 *
 * Rend un objet vide pour un exemplaire ou une prestation : leur calculer un
 * stock les ferait paraître en rupture en permanence, leur total valant zéro.
 * C'est ce qui permet d'étaler le résultat dans la réponse sans condition.
 */
async function stockDuLot(obj: any): Promise<Record<string, unknown>> {
  if (obj.nature !== 'lot') return {};

  const [enrichi] = await enrichirLots([
    { id: obj.id, nature: 'lot', quantity_total: obj.quantity_total ?? 0 },
  ]);

  return {
    quantityLent: enrichi.quantity_lent ?? 0,
    quantityReservedFuture: enrichi.quantity_reserved_future ?? 0,
    quantityAvailable: enrichi.quantity_available ?? 0,
  };
}

export default router;
