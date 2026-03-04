import fs from 'fs';
import path from 'path';
import { db } from '../database';

interface PluginManifest {
  name: string;
  slug: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  config?: Record<string, any>;
  routes?: string;
  components?: string;
}

const PLUGINS_DIR = './plugins';

// Charger un plugin depuis son dossier
async function loadPlugin(pluginSlug: string): Promise<PluginManifest | null> {
  const pluginDir = path.join(PLUGINS_DIR, pluginSlug);
  const manifestPath = path.join(pluginDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest;
  } catch (error) {
    console.error(`Erreur chargement plugin ${pluginSlug}:`, error);
    return null;
  }
}

// Initialiser le système de plugins
export async function initPluginSystem(): Promise<void> {
  // S'assurer que le dossier plugins existe
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  // Récupérer les plugins actifs de la base
  const activePlugins = await db.query('SELECT * FROM plugins WHERE is_active = 1');

  for (const plugin of activePlugins) {
    try {
      // Charger le manifest si le plugin a un dossier
      const pluginDir = path.join(PLUGINS_DIR, plugin.slug);
      if (fs.existsSync(pluginDir)) {
        const manifest = await loadPlugin(plugin.slug);
        
        if (manifest && manifest.routes) {
          // Charger les routes du plugin
          const routesPath = path.join(pluginDir, manifest.routes);
          if (fs.existsSync(routesPath)) {
            // Les routes seront chargées dynamiquement si nécessaire
            console.log(`📦 Plugin chargé: ${plugin.name}`);
          }
        }
      }
    } catch (error) {
      console.error(`Erreur initialisation plugin ${plugin.name}:`, error);
    }
  }
}

// Obtenir la configuration d'un plugin
export async function getPluginConfig(pluginSlug: string): Promise<Record<string, any>> {
  const plugin = await db.queryOne('SELECT config FROM plugins WHERE slug = ?', [pluginSlug]);
  
  if (!plugin || !plugin.config) {
    return {};
  }

  return JSON.parse(plugin.config);
}

// Mettre à jour la configuration d'un plugin
export async function updatePluginConfig(pluginSlug: string, config: Record<string, any>): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    "UPDATE plugins SET config = ?, updated_at = ? WHERE slug = ?",
    [JSON.stringify(config), now, pluginSlug]
  );
}

// Vérifier si un plugin est actif pour une catégorie
export async function isPluginActiveForCategory(pluginSlug: string, categoryId: number, subcategoryId?: number): Promise<boolean> {
  const plugin = await db.queryOne('SELECT id FROM plugins WHERE slug = ? AND is_active = 1', [pluginSlug]);
  
  if (!plugin) {
    return false;
  }

  let query = 'SELECT id FROM plugin_categories WHERE plugin_id = ?';
  const params: any[] = [plugin.id];

  if (subcategoryId) {
    query += ' AND (subcategory_id = ? OR (category_id = ? AND subcategory_id IS NULL))';
    params.push(subcategoryId, categoryId);
  } else {
    query += ' AND category_id = ?';
    params.push(categoryId);
  }

  const association = await db.queryOne(query, params);
  return !!association;
}

// Obtenir les plugins actifs pour une catégorie/sous-catégorie
export async function getActivePluginsForCategory(categoryId: number, subcategoryId?: number): Promise<any[]> {
  let query = `
    SELECT DISTINCT p.* FROM plugins p
    INNER JOIN plugin_categories pc ON pc.plugin_id = p.id
    WHERE p.is_active = 1 AND (pc.category_id = ?`;
  
  const params: any[] = [categoryId];

  if (subcategoryId) {
    query += ' OR pc.subcategory_id = ?';
    params.push(subcategoryId);
  }

  query += ')';

  return db.query(query, params);
}

export default {
  initPluginSystem,
  loadPlugin,
  getPluginConfig,
  updatePluginConfig,
  isPluginActiveForCategory,
  getActivePluginsForCategory
};
