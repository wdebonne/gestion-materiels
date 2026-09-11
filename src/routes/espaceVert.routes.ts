import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor, requireFieldWrite } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';
import { filtreObjets, REFUS_PORTEE } from '../middleware/objectScope';
import { lireDisponibilite, versColonne } from '../services/disponibiliteParc.service';
import {
  arbreImplantable,
  expressionImplantable,
  objetsDeLaCategorie as objetsImplantablesDeLaCategorie,
  rechercherObjetsImplantables,
  REFUS_IMPLANTATION,
} from '../services/materielEspaceVert.service';
import {
  COUT_IMPLANTATION,
  coutEspace,
  syntheseCouts,
  implantationsParObjet,
  prixUnitaireDuParc,
} from '../services/coutEspaceVert.service';
import { expressionNature } from '../services/lotParc.service';
import { jointuresPrestation } from '../services/prestationParc.service';
import { dateOuNull, fusionner, nombreFusionne, nombreOuNull } from '../utils/valeursSql';
import {
  lireZone,
  positionValide,
  REFUS_POSITION,
  REFUS_ZONE,
} from '../services/geometriePlan.service';
import {
  bornerPoint,
  cadrageEnregistre,
  capturer as capturerPlan,
  contoursDuCadre,
  fond as fondCarte,
  lireCadrage,
  transposerObjet,
  FONDS,
  LIMITES,
  REFUS_CADRAGE,
  REFUS_FOND,
  type Cadrage as CadrageCapture,
} from '../services/captureCarte.service';
import { exportLimiter } from '../middleware/rateLimiter.middleware';
import path from 'path';

const router = Router();

// ======================== STATISTIQUES ========================

router.get('/stats', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const [total, totalElements, totalSuperficie, typesCount, cout] = await Promise.all([
      db.queryOne("SELECT COUNT(*) as cnt FROM green_spaces"),
      db.queryOne("SELECT COUNT(*) as cnt FROM green_space_elements"),
      db.queryOne("SELECT COALESCE(SUM(area_m2), 0) as total FROM green_spaces"),
      db.query("SELECT space_type, COUNT(*) as cnt FROM green_spaces GROUP BY space_type ORDER BY cnt DESC"),
      // Ce qui a été dépensé, au prix figé à la pose. `sansPrix` accompagne
      // toujours le total : un montant seul laisserait croire qu'il est complet
      // alors que les lignes sans prix n'y sont pas.
      db.queryOne(
        `SELECT COALESCE(SUM(${COUT_IMPLANTATION}), 0) as total,
                COALESCE(SUM(CASE WHEN gse.exclude_from_costs = 1 THEN 0
                                   WHEN gse.purchase_price IS NULL OR gse.purchase_price = 0 THEN 1
                                   ELSE 0 END), 0) as sans_prix
         FROM green_space_elements gse`
      ),
    ]);

    res.json({
      success: true,
      data: {
        total: total?.cnt || 0,
        totalElements: totalElements?.cnt || 0,
        totalSuperficie: totalSuperficie?.total || 0,
        coutTotal: Number(cout?.total || 0),
        coutSansPrix: Number(cout?.sans_prix || 0),
        byType: typesCount
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== COÛTS ========================

/**
 * GET /couts — ce que le fleurissement et le mobilier ont coûté, tous espaces.
 *
 * Déclarée avant `/:id`, sans quoi Express y verrait un espace vert nommé
 * « couts ». Le filtre `space_type` répond à la question posée le plus souvent :
 * « combien pour les ronds-points », « combien pour les rues » — un coût par
 * nature de lieu, sans avoir à additionner les fiches à la main.
 */
router.get('/couts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { space_type, status } = req.query;

    // Sans filtre, la synthèse porte sur tout : inutile de lister tous les
    // identifiants pour redire « tout ».
    let espaceIds: number[] | undefined;
    if (space_type || status) {
      const conditions: string[] = [];
      const params: any[] = [];
      if (space_type) { conditions.push('space_type = ?'); params.push(space_type); }
      if (status) { conditions.push('status = ?'); params.push(status); }
      const lignes = await db.query(
        `SELECT id FROM green_spaces WHERE ${conditions.join(' AND ')}`,
        params
      );
      espaceIds = lignes.map((l: any) => Number(l.id));
    }

    const synthese = await syntheseCouts(espaceIds ? { espaceIds } : undefined);
    res.json({ success: true, data: synthese });
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

// ======================== MATÉRIEL IMPLANTABLE (RÉGLAGE) ========================
//
// Ces routes sont déclarées **avant** `GET /:id` : Express prend la première qui
// correspond, et `/materiel-implantable` serait sinon lu comme l'identifiant
// d'un espace vert.

/** GET /materiel-implantable/tree - Catégories et sous-catégories, avec leur réglage. */
router.get('/materiel-implantable/tree', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await arbreImplantable() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /materiel-implantable/objects - Matériels d'une catégorie et leur réglage.
 *
 * Rend à la fois le réglage propre au matériel et le résultat effectif : sans
 * les deux, on ne saurait pas pourquoi un matériel est exclu alors qu'on n'a
 * rien coché dessus.
 */
router.get('/materiel-implantable/objects', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { category_id } = req.query;
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'Catégorie requise' });
    }
    const objets = await objetsImplantablesDeLaCategorie(req, String(category_id));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /materiel-implantable/search - Chercher un matériel dans tout le parc.
 *
 * Trente catégories et soixante sous-catégories rendent le déroulement branche
 * par branche impraticable. La réponse porte le rattachement de chaque matériel
 * pour que l'écran n'ouvre que les branches concernées.
 */
router.get('/materiel-implantable/search', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const objets = await rechercherObjetsImplantables(req, String(req.query.q || ''));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /materiel-implantable/:niveau/:id - Régler un niveau.
 *
 * Une catégorie ne peut pas hériter : c'est elle la valeur de référence, et lui
 * permettre `null` laisserait la résolution sans point de départ.
 */
router.put('/materiel-implantable/:niveau/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const TABLES: Record<string, string> = {
      category: 'categories',
      subcategory: 'subcategories',
      object: 'objects',
    };
    const table = TABLES[req.params.niveau];
    if (!table) {
      return res.status(400).json({
        success: false,
        message: 'Niveau inconnu (attendu : category, subcategory ou object)',
      });
    }

    const valeur = lireDisponibilite(req.body.available);
    if (table === 'categories' && valeur === null) {
      return res.status(400).json({
        success: false,
        message: "Une catégorie ne peut pas hériter : c'est elle qui donne le ton",
      });
    }

    const resultat = await db.execute(
      `UPDATE ${table} SET available_for_green_spaces = ? WHERE id = ?`,
      [versColonne(valeur), req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    await logService.info(
      'other',
      `Disponibilité espaces verts modifiée (${req.params.niveau} ${req.params.id})`,
      { available: valeur },
      { userId: req.user?.userId }
    );

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
    //
    // `o.purchase_price` est renommé, et ce détail vaut une explication : sous
    // son nom d'origine il arrivait après `gse.*` et **écrasait** le prix figé
    // à la pose. Le prix courant du parc s'affichait donc partout à sa place,
    // et mettre à jour un tarif réécrivait rétroactivement le coût de tous les
    // massifs déjà plantés — exactement ce que le prix figé sert à empêcher.
    const elements = await db.query(`
      SELECT gse.*, o.name as object_name, o.image as object_image, o.reference,
        o.serial_number, o.purchase_price as object_purchase_price,
        o.unit_cost as object_unit_cost, o.material_type as object_material_type,
        o.status as object_status,
        ${COUT_IMPLANTATION} as cout_total,
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
      image, plan_image, custom_fields,
      plan_scale_metres, plan_ratio, plan_scale_points
    } = req.body;

    /*
      Une image de plan réellement remplacée emmène tout ce qui la décrivait.

      C'est la crainte qui avait motivé l'effacement d'origine, et elle est
      juste : garder l'échelle de l'ancienne image rendrait toutes les surfaces
      fausses sans que rien ne le dise. Mais l'effacement était déclenché par
      « le champ n'est pas mentionné », ce qui arrive à *chaque* modification —
      corriger une adresse suffisait à décalibrer le plan. La condition est
      maintenant celle qu'on voulait vraiment : l'image a changé.

      Le cadrage part avec : il décrivait où regardait la capture, et une image
      envoyée à la main ne regarde nulle part.
    */
    const planRemplace =
      plan_image !== undefined && String(plan_image ?? '') !== String(existing.plan_image ?? '');

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_spaces SET name = ?, description = ?, address = ?,
        latitude = ?, longitude = ?, area_m2 = ?, space_type = ?,
        soil_type = ?, status = ?, image = ?, plan_image = ?,
        custom_fields = ?, plan_scale_metres = ?, plan_ratio = ?,
        plan_scale_points = ?, plan_capture = ?, updated_at = ?
       WHERE id = ?`,
      [
        name || existing.name, description ?? existing.description,
        address ?? existing.address, latitude ?? existing.latitude,
        longitude ?? existing.longitude, area_m2 ?? existing.area_m2,
        space_type ?? existing.space_type, soil_type ?? existing.soil_type,
        status ?? existing.status, image ?? existing.image,
        plan_image ?? existing.plan_image,
        custom_fields ? JSON.stringify(custom_fields) : existing.custom_fields,
        // Le calibrage s'efface aussi sur demande explicite — `null` reçu —,
        // ce dont se sert le bouton « Effacer le calibrage ».
        planRemplace ? null : nombreFusionne(plan_scale_metres, existing.plan_scale_metres),
        planRemplace ? null : nombreFusionne(plan_ratio, existing.plan_ratio),
        planRemplace
          ? null
          : plan_scale_points !== undefined
          ? (plan_scale_points ? JSON.stringify(plan_scale_points) : null)
          : existing.plan_scale_points,
        planRemplace ? null : existing.plan_capture,
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
    // `o.purchase_price` renommé : sous son nom d'origine il écrasait le prix
    // figé à la pose porté par `gse.*` (voir GET /:id).
    let sql = `
      SELECT gse.*, o.name as object_name, o.image as object_image,
        o.reference, o.serial_number, o.purchase_date,
        o.purchase_price as object_purchase_price,
        o.unit_cost as object_unit_cost, o.material_type as object_material_type,
        o.status as object_status, o.custom_fields as object_custom_fields,
        ${COUT_IMPLANTATION} as cout_total,
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

/**
 * GET /:id/couts — ce que cet espace a coûté, par groupe, type, variété, année.
 *
 * Le détail par groupe est celui qu'on regarde vraiment : une jardinière mêle
 * trois variétés à trois prix, et son coût n'apparaît nulle part ailleurs.
 */
router.get('/:id/couts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const space = await db.queryOne('SELECT id FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!space) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }
    res.json({ success: true, data: await coutEspace(req.params.id) });
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
        pos_x, pos_y, quantity, purchase_price, cost_source, maintenance_notes,
        species, planting_date, last_maintenance_date, next_maintenance_date,
        condition_state, custom_fields, area_m2, area_source, exclude_from_costs,
        zone_points, latitude, longitude
      } = req.body;

      const zone = lireZone(zone_points);
      if (zone.etat === 'refusee') {
        return res.status(400).json({ success: false, message: REFUS_ZONE });
      }

      const now = new Date().toISOString();
      const result = await db.execute(
        `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
          element_type, description, image, pos_x, pos_y, quantity,
          purchase_price, cost_source, maintenance_notes, species, planting_date,
          last_maintenance_date, next_maintenance_date, condition_state,
          custom_fields, area_m2, area_source, exclude_from_costs,
          zone_points, latitude, longitude, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, object_id || null, label, code || '',
          element_type || 'autre', description || '', image || '',
          pos_x || null, pos_y || null, quantity || 1,
          // Prix unitaire, figé ici : c'est ce qu'on a payé, et rien de ce qui
          // arrivera au tarif du parc ne doit le réécrire.
          nombreOuNull(purchase_price), cost_source === 'parc' ? 'parc' : 'saisi',
          maintenance_notes || '',
          species || '', planting_date || null,
          last_maintenance_date || null, next_maintenance_date || null,
          condition_state || 'bon',
          custom_fields ? JSON.stringify(custom_fields) : '{}',
          nombreOuNull(area_m2),
          // 'calcule' : la surface suit le polygone. 'saisi' : elle a été tapée
          // et ne doit plus bouger, même si l'on déplace un sommet ensuite.
          area_source === 'calcule' ? 'calcule' : 'saisi',
          exclude_from_costs ? 1 : 0,
          zone.etat === 'valide' ? JSON.stringify(zone.points) : null,
          nombreOuNull(latitude), nombreOuNull(longitude),
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

/**
 * POST /:id/implantations — poser du matériel du parc dans un espace vert.
 *
 * C'est l'entrée normale d'un élément dans un espace vert, et elle part
 * toujours du parc : dix rosiers, trois bancs, une corbeille, choisis dans le
 * catalogue et posés d'un coup, éventuellement tous dans la même jardinière.
 * Chaque ligne devient un élément, parce que dix rosiers et trois bancs ne se
 * remplacent pas, ne s'entretiennent pas et ne se chiffrent pas ensemble.
 *
 * **Le prix est figé ici et jamais recalculé.** Repris du parc au moment de la
 * pose, ou saisi si la facture du pépiniériste disait autre chose. Ce que le
 * parc vaudra demain ne changera rien à ce qui est écrit aujourd'hui : c'est ce
 * qui permet de dire ce qu'un massif a réellement coûté, des années après.
 *
 * Une pose partielle vaut mieux qu'un refus global : les lignes acceptées sont
 * enregistrées, les autres rendues avec leur motif. Refuser les quinze parce
 * qu'une prestation s'est glissée dans la sélection obligerait à tout ressaisir.
 */
router.post('/:id/implantations', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const space = await db.queryOne('SELECT id FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!space) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    const { lignes, group_id } = req.body;
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun matériel à implanter' });
    }

    const identifiants = lignes
      .map((l: any) => Number(l.object_id))
      .filter((n: number) => Number.isFinite(n));
    if (identifiants.length === 0) {
      return res.status(400).json({ success: false, message: 'Chaque ligne doit désigner un matériel du parc' });
    }

    // La portée s'applique ici comme partout ailleurs : on ne pose pas dans un
    // espace vert du matériel qu'on n'a pas le droit de consulter.
    const filtre = await filtreObjets(req, 'o');
    if (filtre === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const objets = await db.query(
      `SELECT o.id, o.name, o.reference, o.image, o.description, o.purchase_price,
              o.unit_cost, o.custom_fields,
              ${expressionNature()} as nature,
              ${expressionImplantable()} as implantable
       FROM objects o
       ${jointuresPrestation()}
       WHERE o.id IN (${identifiants.map(() => '?').join(', ')})${filtre.sql}`,
      [...identifiants, ...filtre.params]
    );
    const parId = new Map(objets.map((o: any) => [Number(o.id), o]));

    // Un groupe reçu doit appartenir à cet espace : un identifiant venu d'une
    // autre fiche rattacherait la jardinière au mauvais parc. Les groupes sont
    // vérifiés en une fois — les quinze lignes d'une pose désignent presque
    // toujours la même jardinière, et une requête par ligne les revérifierait
    // quinze fois.
    const groupesDemandes = [group_id, ...lignes.map((l: any) => l.group_id)]
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    const groupesValides = await groupesDeLEspace(groupesDemandes, req.params.id);
    const groupeRetenu = (brut: any): number | null => {
      const identifiant = Number(brut);
      return groupesValides.has(identifiant) ? identifiant : null;
    };

    const groupeCommun = groupeRetenu(group_id);

    const now = new Date().toISOString();
    const crees: any[] = [];
    const refuses: Array<{ object_id: any; motif: string }> = [];

    for (const ligne of lignes) {
      const objet = parId.get(Number(ligne.object_id));
      if (!objet) {
        refuses.push({ object_id: ligne.object_id, motif: REFUS_PORTEE });
        continue;
      }
      // Le réglage du module l'emporte sur une sélection périmée : un onglet
      // resté ouvert depuis qu'un administrateur a fermé la catégorie proposerait
      // encore le matériel, et l'écran ne dirait pas pourquoi la pose échoue.
      if (!objet.implantable) {
        refuses.push({ object_id: ligne.object_id, motif: `« ${objet.name} » : ${REFUS_IMPLANTATION}` });
        continue;
      }

      // Une prestation — un raccordement électrique, une vacation d'agent — n'a
      // ni quantité en terre ni emplacement : elle ne se plante pas.
      if (objet.nature === 'prestation') {
        refuses.push({ object_id: ligne.object_id, motif: `« ${objet.name} » est une prestation : elle ne s'implante pas` });
        continue;
      }

      // Un exemplaire identifié est posé une fois : ce banc-là, pas trois.
      const quantite = objet.nature === 'lot'
        ? Math.max(1, Math.floor(Number(ligne.quantity) || 1))
        : 1;

      // Le prix figé : celui saisi, sinon celui du parc au moment de la pose.
      // `cost_source` ne dit « saisi » que si le nombre s'écarte du parc — la
      // fenêtre pré-remplit avec le tarif du parc, et renvoyer ce même tarif ne
      // fait pas de la ligne un prix négocié.
      const prixParc = prixUnitaireDuParc(objet);
      const saisi = nombreOuNull(ligne.unit_price);
      const prixUnitaire = saisi !== null ? saisi : prixParc;
      const source = saisi !== null && saisi !== prixParc ? 'saisi' : 'parc';

      const groupe = ligne.group_id !== undefined ? groupeRetenu(ligne.group_id) : groupeCommun;

      const result = await db.execute(
        `INSERT INTO green_space_elements (green_space_id, object_id, label, code,
          element_type, description, image, quantity, purchase_price, cost_source,
          species, planting_date, condition_state, group_id, custom_fields,
          maintenance_notes, pos_x, pos_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, objet.id,
          texte(ligne.label) || objet.name,
          texte(ligne.code) || objet.reference || '',
          ligne.element_type || 'autre',
          ligne.description ?? '',
          ligne.image || objet.image || '',
          quantite,
          prixUnitaire,
          source,
          ligne.species || especeDe(objet),
          dateOuNull(ligne.planting_date),
          ligne.condition_state || 'neuf',
          groupe,
          ligne.custom_fields ? JSON.stringify(ligne.custom_fields) : '{}',
          '',
          // Posé depuis le plan : les lignes arrivent avec leur emplacement, et
          // il n'y a plus à les retrouver une à une dans la liste « à poser ».
          nombreOuNull(ligne.pos_x), nombreOuNull(ligne.pos_y),
          now, now,
        ]
      );

      crees.push(await elementComplet(result.lastInsertRowid));
    }

    await logService.info(
      'other',
      `Implantation depuis le parc : ${crees.length} ligne(s) posée(s) dans l'espace vert ${req.params.id}`,
      { userId: req.user!.userId }
    );

    res.status(201).json({ success: true, data: crees, refuses });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** L'espèce déclarée sur la fiche du parc, si elle y est. */
function especeDe(objet: any): string {
  try {
    const champs = typeof objet.custom_fields === 'string'
      ? JSON.parse(objet.custom_fields || '{}')
      : (objet.custom_fields || {});
    return champs.espece || champs.variete || champs.species || champs.espece_variete || '';
  } catch {
    return '';
  }
}

/** Une chaîne propre, ou rien — ce qui arrive d'une API n'est pas toujours du texte. */
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/** Ceux de ces groupes qui appartiennent bien à cet espace vert. */
async function groupesDeLEspace(
  groupIds: number[],
  greenSpaceId: string
): Promise<Set<number>> {
  const uniques = [...new Set(groupIds)];
  if (uniques.length === 0) return new Set();

  const lignes = await db.query(
    `SELECT id FROM green_space_groups
     WHERE green_space_id = ? AND id IN (${uniques.map(() => '?').join(', ')})`,
    [greenSpaceId, ...uniques]
  );
  return new Set(lignes.map((l: any) => Number(l.id)));
}

/** Un élément tel que les écrans l'attendent, coût figé compris. */
async function elementComplet(elementId: number | string): Promise<any> {
  return db.queryOne(`
    SELECT gse.*, o.name as object_name, o.image as object_image, o.reference,
      o.purchase_price as object_purchase_price, o.unit_cost as object_unit_cost,
      o.material_type as object_material_type,
      ${COUT_IMPLANTATION} as cout_total,
      c.name as category_name, sc.name as subcategory_name
    FROM green_space_elements gse
    LEFT JOIN objects o ON o.id = gse.object_id
    LEFT JOIN categories c ON c.id = o.category_id
    LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
    WHERE gse.id = ?
  `, [elementId]);
}

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
      condition_state, custom_fields, area_m2, area_source, exclude_from_costs,
      zone_points, latitude, longitude
    } = req.body;

    // Corriger un prix à la main, c'est dire que la facture ne disait pas ce
    // que le parc affichait : la ligne cesse alors de se réclamer du parc.
    const zone = lireZone(zone_points);
    if (zone.etat === 'refusee') {
      return res.status(400).json({ success: false, message: REFUS_ZONE });
    }

    const prixCorrige = purchase_price !== undefined
      && nombreOuNull(purchase_price) !== (existing.purchase_price === null ? null : Number(existing.purchase_price));

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_elements SET object_id = ?, label = ?, code = ?,
        element_type = ?, description = ?, image = ?,
        pos_x = ?, pos_y = ?, quantity = ?,
        purchase_price = ?, cost_source = ?, maintenance_notes = ?,
        species = ?, planting_date = ?,
        last_maintenance_date = ?, next_maintenance_date = ?,
        condition_state = ?, custom_fields = ?, area_m2 = ?, area_source = ?,
        exclude_from_costs = ?, zone_points = ?,
        latitude = ?, longitude = ?, updated_at = ?
       WHERE id = ?`,
      [
        object_id ?? existing.object_id, label ?? existing.label,
        code ?? existing.code, element_type ?? existing.element_type,
        description ?? existing.description, image ?? existing.image,
        // `fusionner` et non `??` : le client envoie `null` pour retirer du
        // plan, et `??` gardait alors l'ancienne position.
        nombreFusionne(pos_x, existing.pos_x), nombreFusionne(pos_y, existing.pos_y),
        quantity ?? existing.quantity,
        purchase_price !== undefined ? nombreOuNull(purchase_price) : existing.purchase_price,
        prixCorrige ? 'saisi' : (existing.cost_source || 'saisi'),
        maintenance_notes ?? existing.maintenance_notes,
        species ?? existing.species, planting_date ?? existing.planting_date,
        last_maintenance_date ?? existing.last_maintenance_date,
        next_maintenance_date ?? existing.next_maintenance_date,
        condition_state ?? existing.condition_state,
        custom_fields ? JSON.stringify(custom_fields) : existing.custom_fields,
        nombreFusionne(area_m2, existing.area_m2),
        // Une surface corrigée à la main ne doit plus jamais être recalculée :
        // c'est le métré qui fait foi, pas le tracé approximatif du plan.
        area_source === undefined
          ? existing.area_source || 'saisi'
          : area_source === 'calcule' ? 'calcule' : 'saisi',
        exclude_from_costs === undefined
          ? (existing.exclude_from_costs ? 1 : 0)
          : (exclude_from_costs ? 1 : 0),
        zone.etat === 'absente'
          ? existing.zone_points
          : zone.etat === 'valide' ? JSON.stringify(zone.points) : null,
        nombreFusionne(latitude, existing.latitude),
        nombreFusionne(longitude, existing.longitude),
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

    // Ces deux nombres partaient en base sans le moindre contrôle. Une position
    // hors du plan y reste : le repère devient invisible, et rien ne permet de
    // le rattraper puisqu'on ne peut plus cliquer dessus.
    const position = positionValide(pos_x, pos_y);
    if (!position) {
      return res.status(400).json({ success: false, message: REFUS_POSITION });
    }

    const now = new Date().toISOString();
    const result = await db.execute(
      `INSERT INTO green_space_annotations (green_space_id, element_id, pos_x, pos_y, label, icon, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, element_id || null, position.x, position.y, label || '', icon || 'circle', color || '#22c55e', now]
    );

    const created = await db.queryOne('SELECT * FROM green_space_annotations WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /annotations/:annotationId - Modifier une annotation.
 *
 * Modification partielle, et non remplacement : renommer un repère n'envoie que
 * son libellé, et l'écriture précédente en profitait pour vider sa position, son
 * icône et sa couleur. C'est d'ailleurs pourquoi il n'y avait aucun renommage
 * dans l'interface — corriger une faute imposait de supprimer et de recréer.
 */
router.put('/annotations/:annotationId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM green_space_annotations WHERE id = ?', [req.params.annotationId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Repère non trouvé' });
    }

    const { pos_x, pos_y, label, icon, color } = req.body;

    const deplace = pos_x !== undefined || pos_y !== undefined;
    const position = deplace
      ? positionValide(pos_x ?? existing.pos_x, pos_y ?? existing.pos_y)
      : { x: Number(existing.pos_x), y: Number(existing.pos_y) };
    if (!position) {
      return res.status(400).json({ success: false, message: REFUS_POSITION });
    }

    await db.execute(
      `UPDATE green_space_annotations SET pos_x = ?, pos_y = ?, label = ?, icon = ?, color = ? WHERE id = ?`,
      [
        position.x,
        position.y,
        label ?? existing.label,
        icon ?? existing.icon,
        color ?? existing.color,
        req.params.annotationId,
      ]
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

// ======================== PLAN CAPTURÉ DEPUIS LA CARTE ========================

/** Les trois familles d'objets qui se posent sur un plan, et leur table. */
const POSES_SUR_LE_PLAN = [
  { table: 'green_space_elements', libelle: 'label', zones: true },
  { table: 'green_space_groups', libelle: 'name', zones: true },
  { table: 'green_space_annotations', libelle: 'label', zones: false },
] as const;

/**
 * Ce qu'un nouveau cadrage couperait.
 *
 * Un recadrage plus serré est le geste le plus naturel du monde — on vient de
 * capturer six cents mètres de ville pour un massif de six cents mètres carrés.
 * Mais rogner un contour lui laisserait une forme plausible et une surface
 * fausse, qui repartirait aussitôt en quantité puis en coût, sans que rien ne
 * l'annonce. Le refus est donc préférable au rognage : on élargit le cadre, ou
 * on retire l'objet du plan d'abord.
 */
async function cequiSeraitAmpute(
  espaceId: string,
  avant: CadrageCapture,
  apres: CadrageCapture
): Promise<string[]> {
  const dehors: string[] = [];

  for (const famille of POSES_SUR_LE_PLAN) {
    const colonnes = famille.zones
      ? `${famille.libelle} AS nom, pos_x, pos_y, zone_points`
      : `${famille.libelle} AS nom, pos_x, pos_y`;
    const lignes = await db.query(
      `SELECT ${colonnes} FROM ${famille.table} WHERE green_space_id = ?`,
      [espaceId]
    );
    for (const ligne of lignes) {
      if (transposerObjet(ligne, avant, apres).sort) {
        dehors.push(String(ligne.nom || 'Sans nom'));
      }
    }
  }

  return dehors;
}

/**
 * Replace sur le nouveau cadre tout ce qui était posé sur l'ancien.
 *
 * Rend le nombre d'objets touchés, pour le dire au journal et à l'utilisateur.
 * N'est appelée qu'après `cequiSeraitAmpute` : ici, tout rentre.
 */
async function deplacerLePose(
  espaceId: string,
  avant: CadrageCapture,
  apres: CadrageCapture
): Promise<number> {
  let touches = 0;

  for (const famille of POSES_SUR_LE_PLAN) {
    const colonnes = famille.zones ? 'id, pos_x, pos_y, zone_points' : 'id, pos_x, pos_y';
    const lignes = await db.query(
      `SELECT ${colonnes} FROM ${famille.table} WHERE green_space_id = ?`,
      [espaceId]
    );

    for (const ligne of lignes) {
      const { pos, zone } = transposerObjet(ligne, avant, apres);
      if (!pos && !zone) continue;

      const borne = pos ? bornerPoint(pos) : null;
      if (famille.zones) {
        await db.execute(
          `UPDATE ${famille.table} SET pos_x = ?, pos_y = ?, zone_points = ? WHERE id = ?`,
          [
            borne ? borne.x : null,
            borne ? borne.y : null,
            zone ? JSON.stringify(zone.map(bornerPoint)) : ligne.zone_points ?? null,
            ligne.id,
          ]
        );
      } else {
        await db.execute(
          `UPDATE ${famille.table} SET pos_x = ?, pos_y = ? WHERE id = ?`,
          [borne ? borne.x : null, borne ? borne.y : null, ligne.id]
        );
      }
      touches++;
    }
  }

  return touches;
}

/**
 * GET /plan/fonds - Les fonds de carte disponibles.
 *
 * Déclarée avant les routes en `/:id` pour qu'« plan » ne soit pas lu comme un
 * identifiant d'espace vert, comme `/materiel-implantable` plus haut.
 *
 * Le client a besoin des mêmes modèles d'URL que le serveur — il affiche la
 * carte pendant qu'on cadre, le serveur assemble ensuite la même vue. Les
 * décrire ici évite que les deux listes divergent : une URL corrigée d'un seul
 * côté donnerait une capture qui ne ressemble pas à ce qu'on visait.
 */
router.get('/plan/fonds', authenticateToken, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      fonds: FONDS.map((f) => ({
        cle: f.cle,
        libelle: f.libelle,
        court: f.court,
        description: f.description,
        modele: f.modele,
        attribution: f.attribution,
        zoomMax: f.zoomMax,
      })),
      // Les limites voyagent avec les fonds : le client choisit sa finesse en
      // fonction d'elles plutôt que d'essuyer un refus après le clic.
      limites: LIMITES,
    },
  });
});

/**
 * POST /:id/plan/capture - Fabriquer le plan depuis la carte.
 *
 * Remplace l'image du plan **et** son échelle d'un seul geste. Les deux vont
 * ensemble : garder l'ancien calibrage sur une nouvelle image rendrait toutes
 * les surfaces fausses en silence, ce contre quoi le PUT plus haut se protège
 * déjà en effaçant l'échelle quand le plan change.
 *
 * Le segment de calibrage manuel est effacé pour la même raison : il désignait
 * deux points de l'ancienne image.
 */
router.post('/:id/plan/capture', authenticateToken, requireSupervisor, exportLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const espace = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    if (!espace) {
      return res.status(404).json({ success: false, message: 'Espace vert non trouvé' });
    }

    const cadrage = lireCadrage(req.body);
    if (!cadrage) {
      return res.status(400).json({ success: false, message: REFUS_CADRAGE });
    }

    const choix = fondCarte(String(req.body?.fond ?? ''));
    if (!choix) {
      return res.status(400).json({ success: false, message: REFUS_FOND });
    }
    if (cadrage.zoom > choix.zoomMax) {
      return res.status(400).json({
        success: false,
        message: `« ${choix.libelle} » ne va pas au-delà du zoom ${choix.zoomMax}`,
      });
    }

    /*
      Le cadrage du plan qu'on remplace, quand il venait lui aussi d'une
      capture. C'est lui qui permet de retraduire tout ce qui est posé : sans
      lui — plan chargé à la main, ou capturé avant que le cadrage ne soit
      mémorisé — il n'y a rien à retraduire et les pourcentages sont conservés
      tels quels, faute de mieux.
    */
    const ancien = cadrageEnregistre(espace.plan_capture);

    // Le contrôle a lieu **avant** de télécharger la moindre tuile : refuser
    // après trois secondes d'assemblage ferait payer l'attente pour rien.
    const ampute = ancien ? await cequiSeraitAmpute(req.params.id, ancien, cadrage) : [];
    if (ampute.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          'Ce cadrage couperait ce qui est déjà posé sur le plan. Élargissez-le, ' +
          'ou retirez ces objets du plan avant de recadrer.',
        data: { ampute },
      });
    }

    const capture = await capturerPlan(cadrage, choix, path.join(__dirname, '../../uploads'));

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_spaces SET plan_image = ?, plan_scale_metres = ?, plan_ratio = ?,
        plan_scale_points = NULL, plan_capture = ?, updated_at = ? WHERE id = ?`,
      [
        capture.url, capture.metresParPourcent, capture.ratio,
        JSON.stringify({ ...cadrage, fond: choix.cle }),
        now, req.params.id,
      ]
    );

    // Le déplacement vient après l'écriture du plan : si le serveur tombe entre
    // les deux, on se retrouve avec un plan neuf et des coordonnées anciennes,
    // ce qui se voit et se rattrape. L'inverse laisserait des coordonnées
    // déplacées sur l'ancienne image, ce qui ne se voit pas.
    const deplaces = ancien ? await deplacerLePose(req.params.id, ancien, cadrage) : 0;

    await logService.info(
      'other',
      `Plan capturé depuis la carte (${choix.libelle}) : ${espace.name}`
        + (deplaces > 0 ? ` — ${deplaces} objet(s) replacés sur le nouveau cadre` : ''),
      { userId: req.user!.userId }
    );

    const updated = await db.queryOne('SELECT * FROM green_spaces WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: { espace: updated, capture, deplaces } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/plan/contour - Ce qu'OpenStreetMap connaît dans le cadre capturé.
 *
 * Séparée de la capture à dessein : Overpass met parfois une dizaine de
 * secondes à répondre, et le plan n'a pas à attendre pour s'afficher. La
 * réponse est consultative — le contour n'est enregistré que si quelqu'un
 * l'accepte, par le chemin habituel des zones.
 */
router.post('/:id/plan/contour', authenticateToken, requireSupervisor, exportLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const cadrage = lireCadrage(req.body);
    if (!cadrage) {
      return res.status(400).json({ success: false, message: REFUS_CADRAGE });
    }
    res.json({ success: true, data: await contoursDuCadre(cadrage) });
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

/**
 * GET /parc/catalogue — le matériel du parc qu'un espace vert peut recevoir.
 *
 * C'est la liste dans laquelle on puise pour garnir un massif : des **lots**
 * — rosiers, bulbes, graminées, comptés à l'unité — et du **mobilier**, tenu à
 * l'exemplaire ou en lot. Chaque ligne arrive avec ce qu'il faut pour décider :
 * sa nature, son prix unitaire courant, ce que le parc en détient, et ce qui
 * est **déjà implanté** ailleurs. Savoir que trente rosiers sont déjà en terre
 * dans quatre espaces évite d'en recommander cent pour être tranquille.
 *
 * Les prestations sont écartées : un raccordement électrique ou une vacation
 * d'agent ne se plante pas, et les proposer ferait chercher longtemps pourquoi
 * la pose échoue.
 *
 * Sans recherche, la liste complète est rendue, ordonnée par catégorie : on
 * choisit le plus souvent en parcourant « Fleurissement », pas en tapant un nom
 * qu'on ne connaît pas encore.
 */
router.get('/parc/catalogue', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { q, category_id, nature } = req.query;

    const filtre = await filtreObjets(req, 'o');
    if (filtre === null) {
      return res.json({ success: true, data: [] });
    }

    // Deux filtres qui se cumulent et ne disent pas la même chose : la portée
    // (plus bas) dit ce que ce compte a le droit de voir, ce réglage-ci dit ce
    // que le module accepte de planter. Un jardinier n'a pas à chercher « gazon »
    // au milieu des barrières Vauban et des radars pédagogiques.
    const conditions: string[] = [
      `${expressionNature()} != 'prestation'`,
      `${expressionImplantable()} = 1`,
    ];
    const params: any[] = [];

    if (q && String(q).trim() !== '') {
      conditions.push('(o.name LIKE ? OR o.reference LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (category_id) {
      // La catégorie effective est la directe, ou celle de la sous-catégorie :
      // un matériel rangé sous « Fleurissement › Rosiers » n'a pas toujours de
      // catégorie propre, et le filtre le perdrait.
      conditions.push('COALESCE(o.category_id, psc.category_id) = ?');
      params.push(category_id);
    }
    if (nature === 'lot' || nature === 'unique') {
      conditions.push(`${expressionNature()} = ?`);
      params.push(nature);
    }

    const objets = await db.query(
      `SELECT o.id, o.name, o.reference, o.image, o.description, o.status,
              o.purchase_price, o.unit_cost, o.quantity_total, o.custom_fields,
              ${expressionNature()} as nature,
              COALESCE(o.category_id, psc.category_id) as category_id,
              pc.name as category_name, psc.name as subcategory_name
       FROM objects o
       ${jointuresPrestation()}
       WHERE ${conditions.join(' AND ')}${filtre.sql}
       LIMIT 300`,
      [...params, ...filtre.params]
    );

    const implantations = await implantationsParObjet(objets.map((o: any) => o.id));

    const catalogue = objets
      .map((objet: any) => ({
        ...objet,
        prix_unitaire: prixUnitaireDuParc(objet),
        implante: implantations.get(Number(objet.id))?.quantite ?? 0,
        implante_espaces: implantations.get(Number(objet.id))?.espaces ?? 0,
      }))
      // Tri fait ici et non en SQL : `ORDER BY name` compare des octets sous
      // SQLite, et « Érable » se retrouverait après « Rosier ».
      .sort(
        (a: any, b: any) =>
          (a.category_name || '').localeCompare(b.category_name || '', 'fr') ||
          (a.name || '').localeCompare(b.name || '', 'fr')
      );

    res.json({ success: true, data: catalogue });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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
        o.unit_cost, o.material_type, o.status, o.description, o.custom_fields,
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
    const zone = lireZone(zone_points);
    if (zone.etat === 'refusee') {
      return res.status(400).json({ success: false, message: REFUS_ZONE });
    }
    const now = new Date().toISOString();

    const result = await db.execute(
      `INSERT INTO green_space_groups (green_space_id, name, group_type, description, color, icon, area_m2, zone_points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, name, group_type || 'massif', description || '', color || '#8b5cf6', icon || 'layers', nombreOuNull(area_m2), zone.etat === 'valide' ? JSON.stringify(zone.points) : null, now, now]
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
    const existing = await db.queryOne('SELECT * FROM green_space_groups WHERE id = ?', [req.params.groupId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Groupe non trouvé' });
    }

    const { name, group_type, description, color, icon, pos_x, pos_y, area_m2, zone_points } = req.body;

    const zone = lireZone(zone_points);
    if (zone.etat === 'refusee') {
      return res.status(400).json({ success: false, message: REFUS_ZONE });
    }

    // Modification partielle, et non remplacement : déplacer le repère d'un
    // groupe n'envoie que `pos_x` et `pos_y`, et l'écriture précédente en
    // profitait pour remettre `zone_points` et `area_m2` à NULL — le polygone
    // patiemment dessiné disparaissait au premier déplacement du marqueur.
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE green_space_groups SET name = ?, group_type = ?, description = ?, color = ?, icon = ?, pos_x = ?, pos_y = ?, area_m2 = ?, zone_points = ?, updated_at = ? WHERE id = ?`,
      [
        name ?? existing.name,
        group_type ?? existing.group_type,
        description ?? existing.description ?? '',
        color ?? existing.color ?? '#8b5cf6',
        icon ?? existing.icon ?? 'layers',
        nombreFusionne(pos_x, existing.pos_x),
        nombreFusionne(pos_y, existing.pos_y),
        nombreFusionne(area_m2, existing.area_m2),
        zone.etat === 'absente'
          ? existing.zone_points
          : zone.etat === 'valide' ? JSON.stringify(zone.points) : null,
        now,
        req.params.groupId,
      ]
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
        plan_scale_metres, plan_ratio, plan_scale_points,
        cloned_from_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cloneName, source.description, source.address,
        source.latitude, source.longitude,
        source.area_m2, source.space_type, source.soil_type,
        status || 'projet', source.image, source.plan_image,
        source.custom_fields,
        // Le clone reprend le même plan : il doit reprendre son échelle, sinon
        // les surfaces recopiées ne correspondraient plus à rien de mesurable.
        source.plan_scale_metres, source.plan_ratio, source.plan_scale_points,
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
            purchase_price, cost_source, maintenance_notes, species, planting_date,
            last_maintenance_date, next_maintenance_date, condition_state,
            custom_fields, area_m2, area_source, exclude_from_costs,
            zone_points, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newSpaceId, el.object_id, el.label, el.code,
            el.element_type, el.description, el.image,
            el.pos_x, el.pos_y, el.quantity,
            // `cost_source` manquait : un clone présentait comme saisi à la main
            // un prix pourtant repris du parc, et la lecture des coûts changeait
            // de sens d'une copie à l'autre.
            el.purchase_price, el.cost_source || 'saisi', el.maintenance_notes,
            el.species, el.planting_date,
            el.last_maintenance_date, el.next_maintenance_date,
            el.condition_state, el.custom_fields || '{}',
            el.area_m2, el.area_source || 'saisi', el.exclude_from_costs ? 1 : 0,
            el.zone_points, now, now
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
