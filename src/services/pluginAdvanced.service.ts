import fs from 'fs';
import path from 'path';
import { db } from '../database';
import extract from 'extract-zip';

const PLUGINS_DIR = './plugins';
const PLUGIN_PAGES_DIR = './plugins/pages';

// Types pour la configuration des plugins
export interface PluginTableColumn {
  name: string;
  type: string;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string;
  foreignKey?: {
    table: string;
    column: string;
    onDelete?: string;
    onUpdate?: string;
  };
}

export interface PluginTable {
  name: string;
  columns: PluginTableColumn[];
}

export interface PluginEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: string;
  action?: 'upload' | 'custom';
  table?: string;
  description?: string;
  params?: string[];
}

export interface PluginPageComponent {
  type: 'header' | 'filters' | 'dataGrid' | 'dataTable' | 'form' | 'stats' | 'chart' | 'custom';
  [key: string]: any;
}

export interface PluginPage {
  title: string;
  layout?: 'default' | 'grid' | 'split';
  components: PluginPageComponent[];
}

export interface PluginConfig {
  name: string;
  slug: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  type: 'menu' | 'object';
  route?: string;
  config?: Record<string, any>;
  database?: {
    tables: PluginTable[];
  };
  api?: {
    endpoints: PluginEndpoint[];
  };
  pages?: {
    [key: string]: PluginPage;
  };
}

// S'assurer que les dossiers existent
export function ensurePluginDirectories(): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PLUGIN_PAGES_DIR)) {
    fs.mkdirSync(PLUGIN_PAGES_DIR, { recursive: true });
  }
}

// Générer le SQL pour créer une table
function generateCreateTableSQL(table: PluginTable): string {
  const columns: string[] = [];
  const foreignKeys: string[] = [];

  for (const col of table.columns) {
    let colDef = `${col.name} ${col.type}`;

    if (col.primaryKey) {
      colDef += ' PRIMARY KEY';
    }
    if (col.autoIncrement) {
      colDef += ' AUTOINCREMENT';
    }
    if (col.notNull) {
      colDef += ' NOT NULL';
    }
    if (col.unique) {
      colDef += ' UNIQUE';
    }
    if (col.default) {
      if (col.default === 'CURRENT_TIMESTAMP') {
        const isSQLite = db.getType() === 'sqlite';
        colDef += isSQLite ? " DEFAULT (datetime('now'))" : ' DEFAULT CURRENT_TIMESTAMP';
      } else {
        colDef += ` DEFAULT ${col.default}`;
      }
    }

    columns.push(colDef);

    if (col.foreignKey) {
      let fk = `FOREIGN KEY (${col.name}) REFERENCES ${col.foreignKey.table}(${col.foreignKey.column})`;
      if (col.foreignKey.onDelete) {
        fk += ` ON DELETE ${col.foreignKey.onDelete}`;
      }
      if (col.foreignKey.onUpdate) {
        fk += ` ON UPDATE ${col.foreignKey.onUpdate}`;
      }
      foreignKeys.push(fk);
    }
  }

  const allColumns = [...columns, ...foreignKeys].join(',\n        ');
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n        ${allColumns}\n      )`;
}

// Créer les tables d'un plugin
export async function createPluginTables(pluginConfig: PluginConfig): Promise<void> {
  if (!pluginConfig.database?.tables) {
    return;
  }

  for (const table of pluginConfig.database.tables) {
    try {
      const sql = generateCreateTableSQL(table);
      console.log(`📊 Création table: ${table.name}`);
      await db.execute(sql);
    } catch (error: any) {
      console.error(`Erreur création table ${table.name}:`, error.message);
      throw error;
    }
  }
}

// Supprimer les tables d'un plugin
export async function dropPluginTables(pluginSlug: string): Promise<void> {
  // Récupérer les tables créées par ce plugin depuis la config stockée
  const plugin = await db.queryOne('SELECT config FROM plugins WHERE slug = ?', [pluginSlug]);
  if (!plugin?.config) return;

  try {
    const config = JSON.parse(plugin.config) as PluginConfig;
    if (config.database?.tables) {
      for (const table of config.database.tables) {
        console.log(`🗑️ Suppression table: ${table.name}`);
        await db.execute(`DROP TABLE IF EXISTS ${table.name}`);
      }
    }
  } catch (error) {
    console.error('Erreur suppression tables plugin:', error);
  }
}

// Sauvegarder les pages du plugin
export function savePluginPages(pluginSlug: string, pages: Record<string, PluginPage>): void {
  const pluginPagesDir = path.join(PLUGIN_PAGES_DIR, pluginSlug);
  
  if (!fs.existsSync(pluginPagesDir)) {
    fs.mkdirSync(pluginPagesDir, { recursive: true });
  }

  for (const [pageName, pageConfig] of Object.entries(pages)) {
    const pagePath = path.join(pluginPagesDir, `${pageName}.json`);
    fs.writeFileSync(pagePath, JSON.stringify(pageConfig, null, 2));
  }
}

// Charger les pages d'un plugin
export function loadPluginPages(pluginSlug: string): Record<string, PluginPage> {
  const pluginPagesDir = path.join(PLUGIN_PAGES_DIR, pluginSlug);
  const pages: Record<string, PluginPage> = {};

  if (!fs.existsSync(pluginPagesDir)) {
    return pages;
  }

  const files = fs.readdirSync(pluginPagesDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    const pageName = path.basename(file, '.json');
    const pagePath = path.join(pluginPagesDir, file);
    
    try {
      pages[pageName] = JSON.parse(fs.readFileSync(pagePath, 'utf8'));
    } catch (error) {
      console.error(`Erreur chargement page ${file}:`, error);
    }
  }

  return pages;
}

// Supprimer les pages d'un plugin
export function deletePluginPages(pluginSlug: string): void {
  const pluginPagesDir = path.join(PLUGIN_PAGES_DIR, pluginSlug);
  
  if (fs.existsSync(pluginPagesDir)) {
    fs.rmSync(pluginPagesDir, { recursive: true });
  }
}

// Importer un plugin depuis un fichier ZIP
export async function importPluginFromZip(zipPath: string): Promise<PluginConfig> {
  ensurePluginDirectories();

  // Créer un dossier temporaire pour l'extraction
  const tempDir = path.join(PLUGINS_DIR, `temp-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extraire le ZIP
    await extract(zipPath, { dir: path.resolve(tempDir) });

    // Chercher plugin.json
    const pluginJsonPath = path.join(tempDir, 'plugin.json');
    if (!fs.existsSync(pluginJsonPath)) {
      throw new Error('Fichier plugin.json manquant dans le ZIP');
    }

    // Lire la configuration
    const pluginConfig: PluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));

    // Valider les champs requis
    if (!pluginConfig.name || !pluginConfig.slug || !pluginConfig.type) {
      throw new Error('Configuration incomplète: name, slug et type sont requis');
    }

    // Vérifier si le plugin existe déjà
    const existingPlugin = await db.queryOne('SELECT id FROM plugins WHERE slug = ?', [pluginConfig.slug]);

    // Créer les tables si nécessaire
    if (pluginConfig.database?.tables) {
      await createPluginTables(pluginConfig);
    }

    // Sauvegarder les pages si c'est un plugin menu
    if (pluginConfig.pages) {
      savePluginPages(pluginConfig.slug, pluginConfig.pages);
    }

    // Sauvegarder les endpoints API dans la config
    const fullConfig = {
      ...pluginConfig.config,
      api: pluginConfig.api,
      database: pluginConfig.database,
      pages: Object.keys(pluginConfig.pages || {})
    };

    if (existingPlugin) {
      // Mettre à jour
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE plugins SET 
          name = ?, version = ?, description = ?, author = ?, icon = ?,
          plugin_type = ?, route = ?, config = ?, updated_at = ?
        WHERE slug = ?`,
        [
          pluginConfig.name,
          pluginConfig.version,
          pluginConfig.description || null,
          pluginConfig.author || null,
          pluginConfig.icon || null,
          pluginConfig.type,
          pluginConfig.route || pluginConfig.slug,
          JSON.stringify(fullConfig),
          now,
          pluginConfig.slug
        ]
      );
    } else {
      // Insérer
      await db.execute(
        `INSERT INTO plugins (name, slug, version, description, author, icon, plugin_type, route, is_active, config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          pluginConfig.name,
          pluginConfig.slug,
          pluginConfig.version,
          pluginConfig.description || null,
          pluginConfig.author || null,
          pluginConfig.icon || null,
          pluginConfig.type,
          pluginConfig.route || pluginConfig.slug,
          JSON.stringify(fullConfig)
        ]
      );
    }

    // Copier les fichiers supplémentaires (icône, assets)
    const pluginDir = path.join(PLUGINS_DIR, pluginConfig.slug);
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    // Copier l'icône si présente
    const iconPath = path.join(tempDir, 'icon.svg');
    if (fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join(pluginDir, 'icon.svg'));
    }

    // Copier le dossier assets si présent
    const assetsDir = path.join(tempDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      const destAssetsDir = path.join(pluginDir, 'assets');
      if (!fs.existsSync(destAssetsDir)) {
        fs.mkdirSync(destAssetsDir, { recursive: true });
      }
      copyDirRecursive(assetsDir, destAssetsDir);
    }

    return pluginConfig;

  } finally {
    // Nettoyer le dossier temporaire
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
}

// Copier un dossier récursivement
function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Instructions SQL interdites dans une requête de plugin, quelle que soit la
 * méthode : elles permettraient de modifier le schéma, d'exfiltrer des données
 * ou de manipuler les comptes.
 */
const FORBIDDEN_SQL = /\b(DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|LOAD_FILE|INTO\s+(OUT|DUMP)FILE)\b/i;

/** Tables du cœur applicatif, hors d'atteinte des plugins. */
const PROTECTED_TABLES = /\b(users|api_tokens|group_permissions|user_permissions|module_permissions|plugin_permissions|user_plugin_permissions|settings|auth_config|plugins)\b/i;

/**
 * Vérifie qu'une requête de plugin est une instruction unique, cohérente avec
 * la méthode HTTP de son endpoint, et qu'elle ne touche ni au schéma ni aux
 * tables sensibles.
 *
 * Ces requêtes proviennent du fichier de configuration d'un plugin installé par
 * un administrateur, mais elles sont déclenchables par n'importe quel compte
 * authentifié : il faut donc les contraindre.
 */
function assertQueryIsAllowed(pluginSlug: string, method: string, query: string): void {
  const normalized = query.trim().replace(/;\s*$/, '');

  if (normalized.includes(';')) {
    throw new Error(`Plugin "${pluginSlug}": une requête ne peut contenir qu'une seule instruction SQL.`);
  }

  if (FORBIDDEN_SQL.test(normalized)) {
    throw new Error(`Plugin "${pluginSlug}": instruction SQL non autorisée.`);
  }

  if (PROTECTED_TABLES.test(normalized)) {
    throw new Error(`Plugin "${pluginSlug}": accès refusé aux tables système.`);
  }

  const verb = normalized.split(/\s+/)[0]?.toUpperCase();
  const allowedVerbs = method === 'GET'
    ? ['SELECT', 'WITH']
    : ['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'WITH'];

  if (!verb || !allowedVerbs.includes(verb)) {
    throw new Error(`Plugin "${pluginSlug}": instruction "${verb ?? '?'}" interdite pour un endpoint ${method}.`);
  }
}

// Exécuter une requête dynamique pour un endpoint de plugin
export async function executePluginQuery(
  pluginSlug: string,
  endpoint: PluginEndpoint,
  params: Record<string, any> = {}
): Promise<any> {
  if (!endpoint.query) {
    return null;
  }

  assertQueryIsAllowed(pluginSlug, endpoint.method, endpoint.query);

  // Remplacer les paramètres dans la requête
  let query = endpoint.query;
  const queryParams: any[] = [];

  // Remplacer les :param par des ?
  const paramMatches = query.match(/:(\w+)/g);
  if (paramMatches) {
    for (const match of paramMatches) {
      const paramName = match.substring(1);
      query = query.replace(match, '?');
      queryParams.push(params[paramName]);
    }
  }

  // Exécuter selon la méthode
  if (endpoint.method === 'GET') {
    return db.query(query, queryParams);
  } else {
    return db.execute(query, queryParams);
  }
}

// Obtenir tous les endpoints d'un plugin
export async function getPluginEndpoints(pluginSlug: string): Promise<PluginEndpoint[]> {
  const plugin = await db.queryOne('SELECT config FROM plugins WHERE slug = ?', [pluginSlug]);
  
  if (!plugin?.config) {
    return [];
  }

  try {
    const config = JSON.parse(plugin.config);
    return config.api?.endpoints || [];
  } catch {
    return [];
  }
}

export default {
  ensurePluginDirectories,
  createPluginTables,
  dropPluginTables,
  savePluginPages,
  loadPluginPages,
  deletePluginPages,
  importPluginFromZip,
  executePluginQuery,
  getPluginEndpoints
};
