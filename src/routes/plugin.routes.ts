import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import path from 'path';
import fs from 'fs';
import extract from 'extract-zip';
import multer from 'multer';
import pluginAdvancedService, { PluginConfig, PluginEndpoint } from '../services/pluginAdvanced.service';

const router = Router();

const PLUGINS_DIR = './plugins';

// Assurer que le dossier plugins existe
if (!fs.existsSync(PLUGINS_DIR)) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

// Configuration multer pour l'upload de plugins
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `plugin-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers ZIP sont autorisés'));
    }
  }
});

// GET /api/plugins - Liste des plugins
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const plugins = await db.query('SELECT * FROM plugins ORDER BY is_system DESC, name');

    res.json({
      success: true,
      plugins: plugins.map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        version: p.version,
        description: p.description,
        author: p.author,
        icon: p.icon,
        pluginType: p.plugin_type || 'object',
        route: p.route || p.slug,
        isActive: !!p.is_active,
        isSystem: !!p.is_system,
        config: p.config ? JSON.parse(p.config) : {},
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get plugins:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/plugins/menu - Liste des plugins de type menu (pour la sidebar, filtrée par permissions)
router.get('/menu', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const plugins = await db.query('SELECT * FROM plugins WHERE is_active = 1 AND plugin_type = ? ORDER BY name', ['menu']);
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    // Les admins voient tout
    if (userRole === 'admin') {
      return res.json(plugins.map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        route: p.route || p.slug,
        icon: p.icon,
        config: p.config ? JSON.parse(p.config) : {}
      })));
    }

    // Récupérer les permissions par rôle et individuelles
    const rolePerms = await db.query(
      'SELECT plugin_id, can_access FROM plugin_permissions WHERE role = ?',
      [userRole]
    );
    const userPerms = await db.query(
      'SELECT plugin_id, can_access FROM user_plugin_permissions WHERE user_id = ?',
      [userId]
    );

    const rolePermMap: Record<number, boolean> = {};
    for (const rp of rolePerms) {
      rolePermMap[rp.plugin_id] = !!rp.can_access;
    }
    const userPermMap: Record<number, boolean> = {};
    for (const up of userPerms) {
      userPermMap[up.plugin_id] = !!up.can_access;
    }

    // Filtrer : permission individuelle > permission rôle > autorisé par défaut
    const filtered = plugins.filter((p: any) => {
      if (userPermMap[p.id] !== undefined) return userPermMap[p.id];
      if (rolePermMap[p.id] !== undefined) return rolePermMap[p.id];
      return true; // Par défaut autorisé si pas de config
    });

    res.json(filtered.map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      route: p.route || p.slug,
      icon: p.icon,
      config: p.config ? JSON.parse(p.config) : {}
    })));
  } catch (error: any) {
    console.error('Erreur get menu plugins:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/plugins/:id - Détail d'un plugin
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const plugin = await db.queryOne('SELECT * FROM plugins WHERE id = ? OR slug = ?', [id, id]);
    if (!plugin) {
      return res.status(404).json({ success: false, message: 'Plugin non trouvé' });
    }

    // Récupérer les catégories associées
    const associations = await db.query(
      `SELECT pc.*, c.name as category_name, s.name as subcategory_name
       FROM plugin_categories pc
       LEFT JOIN categories c ON c.id = pc.category_id
       LEFT JOIN subcategories s ON s.id = pc.subcategory_id
       WHERE pc.plugin_id = ?`,
      [plugin.id]
    );

    res.json({
      success: true,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        slug: plugin.slug,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        icon: plugin.icon,
        pluginType: plugin.plugin_type || 'object',
        route: plugin.route || plugin.slug,
        isActive: !!plugin.is_active,
        isSystem: !!plugin.is_system,
        config: plugin.config ? JSON.parse(plugin.config) : {},
        createdAt: plugin.created_at,
        updatedAt: plugin.updated_at,
        associations: associations.map((a: any) => ({
          id: a.id,
          categoryId: a.category_id,
          categoryName: a.category_name,
          subcategoryId: a.subcategory_id,
          subcategoryName: a.subcategory_name
        }))
      }
    });
  } catch (error: any) {
    console.error('Erreur get plugin:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/plugins/import - Importer un plugin
router.post('/import', authenticateToken, requireAdmin, upload.single('plugin'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const extractDir = path.join(PLUGINS_DIR, `temp-${Date.now()}`);
    
    // Extraire le ZIP
    await extract(req.file.path, { dir: path.resolve(extractDir) });

    // Chercher le manifest.json
    let manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      // Chercher dans un sous-dossier
      const subdirs = fs.readdirSync(extractDir, { withFileTypes: true });
      for (const subdir of subdirs) {
        if (subdir.isDirectory()) {
          const subManifestPath = path.join(extractDir, subdir.name, 'manifest.json');
          if (fs.existsSync(subManifestPath)) {
            manifestPath = subManifestPath;
            break;
          }
        }
      }
    }

    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'manifest.json non trouvé dans le plugin' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Valider le manifest
    if (!manifest.name || !manifest.slug || !manifest.version) {
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Manifest invalide: name, slug et version sont requis' });
    }

    // Vérifier si le plugin existe déjà
    const existing = await db.queryOne('SELECT id FROM plugins WHERE slug = ?', [manifest.slug]);
    if (existing) {
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Un plugin avec ce slug existe déjà' });
    }

    // Déplacer le plugin vers le dossier final
    const pluginDir = path.join(PLUGINS_DIR, manifest.slug);
    const manifestDir = path.dirname(manifestPath);
    
    if (manifestDir !== extractDir) {
      fs.renameSync(manifestDir, pluginDir);
      fs.rmSync(extractDir, { recursive: true, force: true });
    } else {
      fs.renameSync(extractDir, pluginDir);
    }

    // Enregistrer le plugin dans la base
    const result = await db.execute(
      'INSERT INTO plugins (name, slug, version, description, author, icon, is_active, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [manifest.name, manifest.slug, manifest.version, manifest.description || '', manifest.author || '', manifest.icon || 'puzzle', 0, JSON.stringify(manifest.config || {})]
    );

    // Nettoyer le fichier temporaire
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      success: true,
      message: 'Plugin importé avec succès',
      plugin: {
        id: result.lastInsertRowid,
        name: manifest.name,
        slug: manifest.slug,
        version: manifest.version
      }
    });
  } catch (error: any) {
    console.error('Erreur import plugin:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/plugins/:id/toggle - Activer/désactiver un plugin
router.put('/:id/toggle', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const plugin = await db.queryOne('SELECT * FROM plugins WHERE id = ?', [id]);
    if (!plugin) {
      return res.status(404).json({ success: false, message: 'Plugin non trouvé' });
    }

    const newStatus = plugin.is_active ? 0 : 1;
    const now = new Date().toISOString();
    await db.execute(
      "UPDATE plugins SET is_active = ?, updated_at = ? WHERE id = ?",
      [newStatus, now, id]
    );

    res.json({
      success: true,
      message: newStatus ? 'Plugin activé' : 'Plugin désactivé',
      isActive: !!newStatus
    });
  } catch (error: any) {
    console.error('Erreur toggle plugin:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/plugins/:id/config - Mettre à jour la configuration d'un plugin
router.put('/:id/config', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { config } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      "UPDATE plugins SET config = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(config), now, id]
    );

    res.json({ success: true, message: 'Configuration mise à jour' });
  } catch (error: any) {
    console.error('Erreur update plugin config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/plugins/:id/settings - Mettre à jour les paramètres d'un plugin (alias pour config)
router.put('/:id/settings', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { settings } = req.body;

    const now = new Date().toISOString();
    await db.execute(
      "UPDATE plugins SET config = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(settings), now, id]
    );

    res.json({ success: true, message: 'Paramètres mis à jour' });
  } catch (error: any) {
    console.error('Erreur update plugin settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/plugins/:id/type - Mettre à jour le type de plugin
router.put('/:id/type', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { type, route } = req.body;

    if (!['menu', 'object'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type de plugin invalide (menu ou object)' });
    }

    const now = new Date().toISOString();
    await db.execute(
      "UPDATE plugins SET plugin_type = ?, route = ?, updated_at = ? WHERE id = ?",
      [type, route || null, now, id]
    );

    res.json({ success: true, message: 'Type de plugin mis à jour' });
  } catch (error: any) {
    console.error('Erreur update plugin type:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/plugins/:id/associations - Mettre à jour les associations catégories
router.put('/:id/associations', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { associations } = req.body;

    // Supprimer les anciennes associations
    await db.execute('DELETE FROM plugin_categories WHERE plugin_id = ?', [id]);

    // Ajouter les nouvelles
    if (associations && Array.isArray(associations)) {
      for (const assoc of associations) {
        await db.execute(
          'INSERT INTO plugin_categories (plugin_id, category_id, subcategory_id) VALUES (?, ?, ?)',
          [id, assoc.categoryId || null, assoc.subcategoryId || null]
        );
      }
    }

    res.json({ success: true, message: 'Associations mises à jour' });
  } catch (error: any) {
    console.error('Erreur update associations:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/plugins/:id - Supprimer un plugin
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const plugin = await db.queryOne('SELECT * FROM plugins WHERE id = ?', [id]);
    if (!plugin) {
      return res.status(404).json({ success: false, message: 'Plugin non trouvé' });
    }

    // Empêcher la suppression des plugins système
    if (plugin.is_system) {
      return res.status(400).json({ success: false, message: 'Les plugins système ne peuvent pas être supprimés' });
    }

    // Supprimer le dossier du plugin
    const pluginDir = path.join(PLUGINS_DIR, plugin.slug);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }

    // Supprimer de la base
    await db.execute('DELETE FROM plugin_categories WHERE plugin_id = ?', [id]);
    await db.execute('DELETE FROM plugins WHERE id = ?', [id]);

    res.json({ success: true, message: 'Plugin supprimé' });
  } catch (error: any) {
    console.error('Erreur delete plugin:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/plugins/:id/export - Exporter un plugin
router.get('/:id/export', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const plugin = await db.queryOne('SELECT * FROM plugins WHERE id = ?', [id]);
    if (!plugin) {
      return res.status(404).json({ success: false, message: 'Plugin non trouvé' });
    }

    // Créer le manifest à exporter
    const manifest = {
      name: plugin.name,
      slug: plugin.slug,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      icon: plugin.icon,
      config: plugin.config ? JSON.parse(plugin.config) : {}
    };

    // Récupérer les associations
    const associations = await db.query(
      'SELECT category_id, subcategory_id FROM plugin_categories WHERE plugin_id = ?',
      [plugin.id]
    );

    const exportData = {
      manifest,
      associations: associations.map((a: any) => ({
        categoryId: a.category_id,
        subcategoryId: a.subcategory_id
      })),
      exportedAt: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${plugin.slug}-export.json"`);
    res.json(exportData);
  } catch (error: any) {
    console.error('Erreur export plugin:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/plugins/import-json - Importer un plugin depuis JSON
router.post('/import-json', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { manifest, associations, activateOnImport } = req.body;

    if (!manifest || !manifest.name || !manifest.slug || !manifest.version) {
      return res.status(400).json({ success: false, message: 'Manifest invalide: name, slug et version sont requis' });
    }

    // Vérifier si le plugin existe déjà
    const existing = await db.queryOne('SELECT id FROM plugins WHERE slug = ?', [manifest.slug]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Un plugin avec ce slug existe déjà' });
    }

    // Créer le plugin (activé par défaut lors de l'import)
    const result = await db.execute(
      'INSERT INTO plugins (name, slug, version, description, author, icon, is_active, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [manifest.name, manifest.slug, manifest.version, manifest.description || '', manifest.author || '', manifest.icon || 'puzzle', 1, JSON.stringify(manifest.config || {})]
    );

    const pluginId = result.lastInsertRowid;

    // Ajouter les associations
    let associationsAdded = 0;
    if (associations && Array.isArray(associations)) {
      for (const assoc of associations) {
        if (assoc.categoryId || assoc.subcategoryId) {
          // Vérifier que la catégorie/sous-catégorie existe
          if (assoc.categoryId) {
            const catExists = await db.queryOne('SELECT id FROM categories WHERE id = ?', [assoc.categoryId]);
            if (!catExists) {
              console.log(`Import plugin: catégorie ${assoc.categoryId} non trouvée, ignorée`);
              continue;
            }
          }
          if (assoc.subcategoryId) {
            const subExists = await db.queryOne('SELECT id FROM subcategories WHERE id = ?', [assoc.subcategoryId]);
            if (!subExists) {
              console.log(`Import plugin: sous-catégorie ${assoc.subcategoryId} non trouvée, ignorée`);
              continue;
            }
          }
          
          await db.execute(
            'INSERT INTO plugin_categories (plugin_id, category_id, subcategory_id) VALUES (?, ?, ?)',
            [pluginId, assoc.categoryId || null, assoc.subcategoryId || null]
          );
          associationsAdded++;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `Plugin importé avec succès${associationsAdded > 0 ? ` (${associationsAdded} association(s) ajoutée(s))` : ' (aucune association - disponible pour tous les objets)'}`,
      plugin: {
        id: pluginId,
        name: manifest.name,
        slug: manifest.slug,
        version: manifest.version,
        isActive: true
      }
    });
  } catch (error: any) {
    console.error('Erreur import plugin JSON:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/plugins/import-zip - Importer un plugin avancé depuis ZIP
router.post('/import-zip', authenticateToken, requireAdmin, upload.single('plugin'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier ZIP fourni' });
    }

    const pluginConfig = await pluginAdvancedService.importPluginFromZip(req.file.path);

    // Nettoyer le fichier temporaire
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      success: true,
      message: 'Plugin importé avec succès',
      plugin: {
        name: pluginConfig.name,
        slug: pluginConfig.slug,
        version: pluginConfig.version,
        type: pluginConfig.type,
        tablesCreated: pluginConfig.database?.tables?.length || 0,
        pagesCreated: Object.keys(pluginConfig.pages || {}).length,
        endpointsCreated: pluginConfig.api?.endpoints?.length || 0
      }
    });
  } catch (error: any) {
    console.error('Erreur import plugin ZIP:', error);
    // Nettoyer le fichier temporaire en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ success: false, message: error.message });
  }
});

// GET /api/plugins/:slug/pages - Récupérer les pages d'un plugin
router.get('/:slug/pages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const plugin = await db.queryOne('SELECT * FROM plugins WHERE slug = ?', [slug]);
    if (!plugin) {
      return res.status(404).json({ success: false, message: 'Plugin non trouvé' });
    }

    const pages = pluginAdvancedService.loadPluginPages(slug);

    res.json({
      success: true,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        slug: plugin.slug,
        type: plugin.plugin_type,
        route: plugin.route || plugin.slug,
        config: plugin.config ? JSON.parse(plugin.config) : {}
      },
      pages
    });
  } catch (error: any) {
    console.error('Erreur get plugin pages:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/plugins/:slug/pages/:pageName - Récupérer une page spécifique d'un plugin
router.get('/:slug/pages/:pageName', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, pageName } = req.params;

    const pages = pluginAdvancedService.loadPluginPages(slug);
    const page = pages[pageName];

    if (!page) {
      return res.status(404).json({ success: false, message: 'Page non trouvée' });
    }

    res.json({
      success: true,
      page
    });
  } catch (error: any) {
    console.error('Erreur get plugin page:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Routes API dynamiques pour les plugins
// GET /api/plugins/:slug/data/:endpoint - Exécuter un endpoint GET
router.get('/:slug/data/*', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const endpointPath = '/' + req.params[0];

    // Récupérer les endpoints du plugin
    const endpoints = await pluginAdvancedService.getPluginEndpoints(slug);
    
    // Trouver l'endpoint correspondant (avec support des paramètres dynamiques)
    let matchedEndpoint: PluginEndpoint | undefined;
    let extractedParams: Record<string, any> = {};

    for (const endpoint of endpoints) {
      if (endpoint.method !== 'GET') continue;

      // Convertir le path de l'endpoint en regex pour matcher les paramètres
      const pathRegex = endpoint.path.replace(/:(\w+)/g, '([^/]+)');
      const regex = new RegExp(`^${pathRegex}$`);
      const match = endpointPath.match(regex);

      if (match) {
        matchedEndpoint = endpoint;
        // Extraire les paramètres
        const paramNames = (endpoint.path.match(/:(\w+)/g) || []).map(p => p.substring(1));
        paramNames.forEach((name, index) => {
          extractedParams[name] = match[index + 1];
        });
        break;
      }
    }

    if (!matchedEndpoint) {
      return res.status(404).json({ success: false, message: 'Endpoint non trouvé' });
    }

    // Ajouter les query params
    const allParams = { ...extractedParams, ...req.query };

    const result = await pluginAdvancedService.executePluginQuery(slug, matchedEndpoint, allParams);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Erreur plugin data GET:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/plugins/:slug/data/:endpoint - Exécuter un endpoint POST
router.post('/:slug/data/*', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const endpointPath = '/' + req.params[0];

    const endpoints = await pluginAdvancedService.getPluginEndpoints(slug);
    
    const matchedEndpoint = endpoints.find(e => 
      e.method === 'POST' && e.path === endpointPath
    );

    if (!matchedEndpoint) {
      return res.status(404).json({ success: false, message: 'Endpoint non trouvé' });
    }

    // Si c'est une action d'upload
    if (matchedEndpoint.action === 'upload') {
      // Gérer l'upload de fichier
      return res.json({ success: true, message: 'Upload endpoint - à implémenter avec multer' });
    }

    const result = await pluginAdvancedService.executePluginQuery(
      slug, 
      matchedEndpoint, 
      { ...req.body, userId: req.user?.userId }
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Erreur plugin data POST:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/plugins/:slug/data/:endpoint - Exécuter un endpoint DELETE
router.delete('/:slug/data/*', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const endpointPath = '/' + req.params[0];

    const endpoints = await pluginAdvancedService.getPluginEndpoints(slug);
    
    // Trouver l'endpoint avec matching de paramètres
    let matchedEndpoint: PluginEndpoint | undefined;
    let extractedParams: Record<string, any> = {};

    for (const endpoint of endpoints) {
      if (endpoint.method !== 'DELETE') continue;

      const pathRegex = endpoint.path.replace(/:(\w+)/g, '([^/]+)');
      const regex = new RegExp(`^${pathRegex}$`);
      const match = endpointPath.match(regex);

      if (match) {
        matchedEndpoint = endpoint;
        const paramNames = (endpoint.path.match(/:(\w+)/g) || []).map(p => p.substring(1));
        paramNames.forEach((name, index) => {
          extractedParams[name] = match[index + 1];
        });
        break;
      }
    }

    if (!matchedEndpoint) {
      return res.status(404).json({ success: false, message: 'Endpoint non trouvé' });
    }

    const result = await pluginAdvancedService.executePluginQuery(slug, matchedEndpoint, extractedParams);

    res.json({
      success: true,
      message: 'Élément supprimé'
    });
  } catch (error: any) {
    console.error('Erreur plugin data DELETE:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/plugins/:slug/pages - Mettre à jour les pages d'un plugin (admin seulement)
router.put('/:slug/pages', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { pages } = req.body;

    if (!pages || typeof pages !== 'object') {
      return res.status(400).json({ success: false, message: 'Pages invalides' });
    }

    pluginAdvancedService.savePluginPages(slug, pages);

    res.json({
      success: true,
      message: 'Pages mises à jour'
    });
  } catch (error: any) {
    console.error('Erreur update plugin pages:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
