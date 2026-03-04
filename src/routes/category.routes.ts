import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireSupervisor, checkCategoryAccess } from '../middleware/auth.middleware';
import { handleUpload } from '../services/upload.service';
import slugify from '../utils/slugify';

const router = Router();

// GET /api/categories/all - Liste de toutes les catégories (admin uniquement, pour les permissions)
router.get('/all', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await db.query(
      'SELECT * FROM categories ORDER BY sort_order, name'
    );

    res.json({
      success: true,
      categories: categories.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image,
        hasSubcategories: !!c.has_subcategories,
        sortOrder: c.sort_order,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get all categories:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/categories/all-with-subcategories - Liste de toutes les catégories avec leurs sous-catégories (admin uniquement)
router.get('/all-with-subcategories', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await db.query(
      'SELECT * FROM categories ORDER BY sort_order, name'
    );

    // Récupérer toutes les sous-catégories
    const subcategories = await db.query(
      'SELECT * FROM subcategories ORDER BY sort_order, name'
    );

    // Associer les sous-catégories à leurs catégories
    const categoriesWithSubs = categories.map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      image: c.image,
      hasSubcategories: !!c.has_subcategories,
      sortOrder: c.sort_order,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      subcategories: subcategories
        .filter((s: any) => s.category_id === c.id)
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          image: s.image,
          categoryId: s.category_id,
          sortOrder: s.sort_order,
          createdAt: s.created_at,
          updatedAt: s.updated_at
        }))
    }));

    res.json({
      success: true,
      categories: categoriesWithSubs
    });
  } catch (error: any) {
    console.error('Erreur get all categories with subcategories:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/categories - Liste des catégories
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    let categories;
    
    if (req.user?.role === 'admin') {
      // Admin voit tout
      categories = await db.query(
        'SELECT * FROM categories ORDER BY sort_order, name'
      );
    } else {
      // Autres utilisateurs: combiner permissions de groupe + individuelles
      categories = await db.query(
        `SELECT DISTINCT c.* FROM categories c
         LEFT JOIN group_permissions gp ON gp.category_id = c.id AND gp.role = ?
         LEFT JOIN user_permissions up ON up.category_id = c.id AND up.user_id = ?
         WHERE (gp.can_view = 1 OR up.can_view = 1)
         ORDER BY c.sort_order, c.name`,
        [req.user?.role, req.user?.userId]
      );
    }

    // Compter les objets par catégorie
    for (const cat of categories) {
      const countResult = await db.queryOne(
        'SELECT COUNT(*) as count FROM objects WHERE category_id = ?',
        [cat.id]
      );
      cat.objectCount = countResult?.count || 0;

      // Compter les sous-catégories
      const subCountResult = await db.queryOne(
        'SELECT COUNT(*) as count FROM subcategories WHERE category_id = ?',
        [cat.id]
      );
      cat.subcategoryCount = subCountResult?.count || 0;
    }

    res.json({
      success: true,
      categories: categories.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image,
        hasSubcategories: !!c.has_subcategories,
        sortOrder: c.sort_order,
        objectCount: c.objectCount,
        subcategoryCount: c.subcategoryCount,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get categories:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/categories/:id - Détail d'une catégorie
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const category = await db.queryOne('SELECT * FROM categories WHERE id = ? OR slug = ?', [id, id]);

    if (!category) {
      return res.status(404).json({ success: false, message: 'Catégorie non trouvée' });
    }

    // Vérifier les permissions
    if (!await checkCategoryAccess(req.user!.userId, req.user!.role, category.id)) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    // Récupérer les sous-catégories si applicable
    let subcategories = [];
    if (category.has_subcategories) {
      subcategories = await db.query(
        'SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order, name',
        [category.id]
      );
    }

    // Récupérer les plugins associés
    const plugins = await db.query(
      `SELECT p.* FROM plugins p
       INNER JOIN plugin_categories pc ON pc.plugin_id = p.id
       WHERE pc.category_id = ? AND p.is_active = 1`,
      [category.id]
    );

    res.json({
      success: true,
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        image: category.image,
        hasSubcategories: !!category.has_subcategories,
        sortOrder: category.sort_order,
        createdAt: category.created_at,
        updatedAt: category.updated_at,
        subcategories: subcategories.map((s: any) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          image: s.image,
          sortOrder: s.sort_order
        })),
        plugins: plugins.map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          icon: p.icon
        }))
      }
    });
  } catch (error: any) {
    console.error('Erreur get category:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/categories - Créer une catégorie
router.post('/', authenticateToken, requireSupervisor, [
  body('name').notEmpty().trim().withMessage('Nom requis')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, image, hasSubcategories } = req.body;
    const slug = slugify(name);

    // Vérifier l'unicité du slug
    const existing = await db.queryOne('SELECT id FROM categories WHERE slug = ?', [slug]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Une catégorie avec ce nom existe déjà' });
    }

    // Récupérer l'image par défaut si non fournie
    let finalImage = image;
    if (!finalImage) {
      const defaultImg = await db.queryOne(
        "SELECT setting_value FROM settings WHERE setting_key = 'default_image'"
      );
      finalImage = defaultImg?.setting_value || '';
    }

    // Récupérer le dernier ordre
    const lastOrder = await db.queryOne('SELECT MAX(sort_order) as maxOrder FROM categories');
    const sortOrder = (lastOrder?.maxOrder || 0) + 1;

    const result = await db.execute(
      'INSERT INTO categories (name, slug, image, has_subcategories, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name, slug, finalImage, hasSubcategories ? 1 : 0, sortOrder]
    );

    res.status(201).json({
      success: true,
      message: 'Catégorie créée',
      category: {
        id: result.lastInsertRowid,
        name,
        slug,
        image: finalImage,
        hasSubcategories: !!hasSubcategories,
        sortOrder
      }
    });
  } catch (error: any) {
    console.error('Erreur create category:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/categories/:id - Modifier une catégorie
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, image, hasSubcategories, sortOrder } = req.body;

    // Vérifier que la catégorie existe
    const category = await db.queryOne('SELECT * FROM categories WHERE id = ?', [id]);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Catégorie non trouvée' });
    }

    let updateFields = [];
    let values = [];

    if (name) {
      const newSlug = slugify(name);
      // Vérifier l'unicité du slug
      const existing = await db.queryOne('SELECT id FROM categories WHERE slug = ? AND id != ?', [newSlug, id]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Une catégorie avec ce nom existe déjà' });
      }
      updateFields.push('name = ?', 'slug = ?');
      values.push(name, newSlug);
    }

    if (image !== undefined) {
      updateFields.push('image = ?');
      values.push(image);
    }

    if (hasSubcategories !== undefined) {
      updateFields.push('has_subcategories = ?');
      values.push(hasSubcategories ? 1 : 0);
    }

    if (sortOrder !== undefined) {
      updateFields.push('sort_order = ?');
      values.push(sortOrder);
    }

    updateFields.push("updated_at = datetime('now')");
    values.push(id);

    await db.execute(
      `UPDATE categories SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Catégorie mise à jour' });
  } catch (error: any) {
    console.error('Erreur update category:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/categories/:id - Supprimer une catégorie
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.execute('DELETE FROM categories WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Catégorie non trouvée' });
    }

    res.json({ success: true, message: 'Catégorie supprimée' });
  } catch (error: any) {
    console.error('Erreur delete category:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === SOUS-CATÉGORIES ===

// GET /api/categories/:categoryId/subcategories - Liste des sous-catégories
router.get('/:categoryId/subcategories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;

    // Vérifier que l'utilisateur a accès à cette catégorie
    const hasAccess = await checkCategoryAccess(req.user!.userId, req.user!.role, parseInt(categoryId));
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Accès refusé à cette catégorie' });
    }

    const subcategories = await db.query(
      'SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order, name',
      [categoryId]
    );

    // Compter les objets par sous-catégorie
    for (const sub of subcategories) {
      const countResult = await db.queryOne(
        'SELECT COUNT(*) as count FROM objects WHERE subcategory_id = ?',
        [sub.id]
      );
      sub.objectCount = countResult?.count || 0;
    }

    res.json({
      success: true,
      subcategories: subcategories.map((s: any) => ({
        id: s.id,
        categoryId: s.category_id,
        name: s.name,
        slug: s.slug,
        image: s.image,
        sortOrder: s.sort_order,
        objectCount: s.objectCount,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get subcategories:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/categories/:categoryId/subcategories - Créer une sous-catégorie
router.post('/:categoryId/subcategories', authenticateToken, requireSupervisor, [
  body('name').notEmpty().trim().withMessage('Nom requis')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { categoryId } = req.params;
    const { name, image } = req.body;
    const slug = slugify(name);

    // Vérifier que la catégorie existe et a des sous-catégories
    const category = await db.queryOne('SELECT * FROM categories WHERE id = ?', [categoryId]);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Catégorie non trouvée' });
    }
    if (!category.has_subcategories) {
      return res.status(400).json({ success: false, message: 'Cette catégorie ne supporte pas les sous-catégories' });
    }

    // Vérifier l'unicité du slug dans la catégorie
    const existing = await db.queryOne(
      'SELECT id FROM subcategories WHERE category_id = ? AND slug = ?',
      [categoryId, slug]
    );
    if (existing) {
      return res.status(400).json({ success: false, message: 'Une sous-catégorie avec ce nom existe déjà' });
    }

    // Récupérer l'image par défaut si non fournie
    let finalImage = image;
    if (!finalImage) {
      const defaultImg = await db.queryOne(
        "SELECT setting_value FROM settings WHERE setting_key = 'default_image'"
      );
      finalImage = defaultImg?.setting_value || '';
    }

    // Récupérer le dernier ordre
    const lastOrder = await db.queryOne(
      'SELECT MAX(sort_order) as maxOrder FROM subcategories WHERE category_id = ?',
      [categoryId]
    );
    const sortOrder = (lastOrder?.maxOrder || 0) + 1;

    const result = await db.execute(
      'INSERT INTO subcategories (category_id, name, slug, image, sort_order) VALUES (?, ?, ?, ?, ?)',
      [categoryId, name, slug, finalImage, sortOrder]
    );

    res.status(201).json({
      success: true,
      message: 'Sous-catégorie créée',
      subcategory: {
        id: result.lastInsertRowid,
        categoryId: parseInt(categoryId),
        name,
        slug,
        image: finalImage,
        sortOrder
      }
    });
  } catch (error: any) {
    console.error('Erreur create subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/categories/:categoryId/subcategories/:id - Modifier une sous-catégorie
router.put('/:categoryId/subcategories/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, id } = req.params;
    const { name, image, sortOrder } = req.body;

    const subcategory = await db.queryOne(
      'SELECT * FROM subcategories WHERE id = ? AND category_id = ?',
      [id, categoryId]
    );
    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    let updateFields = [];
    let values = [];

    if (name) {
      const newSlug = slugify(name);
      const existing = await db.queryOne(
        'SELECT id FROM subcategories WHERE category_id = ? AND slug = ? AND id != ?',
        [categoryId, newSlug, id]
      );
      if (existing) {
        return res.status(400).json({ success: false, message: 'Une sous-catégorie avec ce nom existe déjà' });
      }
      updateFields.push('name = ?', 'slug = ?');
      values.push(name, newSlug);
    }

    if (image !== undefined) {
      updateFields.push('image = ?');
      values.push(image);
    }

    if (sortOrder !== undefined) {
      updateFields.push('sort_order = ?');
      values.push(sortOrder);
    }

    updateFields.push("updated_at = datetime('now')");
    values.push(id);

    await db.execute(
      `UPDATE subcategories SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Sous-catégorie mise à jour' });
  } catch (error: any) {
    console.error('Erreur update subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/categories/:categoryId/subcategories/:id - Supprimer une sous-catégorie
router.delete('/:categoryId/subcategories/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, id } = req.params;

    const result = await db.execute(
      'DELETE FROM subcategories WHERE id = ? AND category_id = ?',
      [id, categoryId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    res.json({ success: true, message: 'Sous-catégorie supprimée' });
  } catch (error: any) {
    console.error('Erreur delete subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === ROUTES INDÉPENDANTES POUR LES SOUS-CATÉGORIES ===
// Ces routes sont montées sur /api/subcategories dans le serveur

// Créer un router séparé pour les sous-catégories
export const subcategoryRouter = Router();

// GET /api/subcategories/by-slug/:slug - Récupérer une sous-catégorie par son slug
subcategoryRouter.get('/by-slug/:slug', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const subcategory = await db.queryOne(
      `SELECT s.*, c.name as category_name, c.slug as category_slug 
       FROM subcategories s
       JOIN categories c ON c.id = s.category_id
       WHERE s.slug = ?`,
      [slug]
    );

    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    // Vérifier l'accès à la catégorie parente
    const hasAccess = await checkCategoryAccess(req.user!.userId, req.user!.role, subcategory.category_id);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Accès refusé à cette catégorie' });
    }

    // Compter les objets
    const countResult = await db.queryOne(
      'SELECT COUNT(*) as count FROM objects WHERE subcategory_id = ?',
      [subcategory.id]
    );

    res.json({
      id: subcategory.id,
      categoryId: subcategory.category_id,
      categoryName: subcategory.category_name,
      categorySlug: subcategory.category_slug,
      name: subcategory.name,
      slug: subcategory.slug,
      image: subcategory.image,
      sortOrder: subcategory.sort_order,
      objectCount: countResult?.count || 0,
      createdAt: subcategory.created_at,
      updatedAt: subcategory.updated_at
    });
  } catch (error: any) {
    console.error('Erreur get subcategory by slug:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/subcategories/:id - Récupérer une sous-catégorie par ID
subcategoryRouter.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const subcategory = await db.queryOne(
      `SELECT s.*, c.name as category_name, c.slug as category_slug 
       FROM subcategories s
       JOIN categories c ON c.id = s.category_id
       WHERE s.id = ?`,
      [id]
    );

    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    // Vérifier l'accès à la catégorie parente
    const hasAccessById = await checkCategoryAccess(req.user!.userId, req.user!.role, subcategory.category_id);
    if (!hasAccessById) {
      return res.status(403).json({ success: false, message: 'Accès refusé à cette catégorie' });
    }

    res.json({
      id: subcategory.id,
      categoryId: subcategory.category_id,
      categoryName: subcategory.category_name,
      categorySlug: subcategory.category_slug,
      name: subcategory.name,
      slug: subcategory.slug,
      image: subcategory.image,
      sortOrder: subcategory.sort_order,
      createdAt: subcategory.created_at,
      updatedAt: subcategory.updated_at
    });
  } catch (error: any) {
    console.error('Erreur get subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/subcategories/:id - Modifier une sous-catégorie
subcategoryRouter.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, image } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (name) {
      updates.push('name = ?');
      params.push(name);
      updates.push('slug = ?');
      params.push(slugify(name));
    }

    if (image !== undefined) {
      updates.push('image = ?');
      params.push(image);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    await db.execute(
      `UPDATE subcategories SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.json({ success: true, message: 'Sous-catégorie mise à jour' });
  } catch (error: any) {
    console.error('Erreur update subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/subcategories/:id - Supprimer une sous-catégorie
subcategoryRouter.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.execute('DELETE FROM subcategories WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Sous-catégorie non trouvée' });
    }

    res.json({ success: true, message: 'Sous-catégorie supprimée' });
  } catch (error: any) {
    console.error('Erreur delete subcategory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
