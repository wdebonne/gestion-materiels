import Database from 'better-sqlite3';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

export type DatabaseType = 'sqlite' | 'mysql';

interface DatabaseConfig {
  type: DatabaseType;
  sqlite?: {
    path: string;
  };
  mysql?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private sqliteDb: Database.Database | null = null;
  private mysqlPool: Pool | null = null;
  private config: DatabaseConfig;

  private constructor() {
    this.config = {
      type: (process.env.DB_TYPE as DatabaseType) || 'sqlite',
      sqlite: {
        path: process.env.DB_PATH || './data/database.sqlite'
      },
      mysql: {
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'gestion_materiels'
      }
    };
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async init(): Promise<void> {
    if (this.config.type === 'sqlite') {
      await this.initSQLite();
    } else {
      await this.initMySQL();
    }
    await this.createTables();
  }

  private async initSQLite(): Promise<void> {
    const dbPath = this.config.sqlite!.path;
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma('journal_mode = WAL');
    this.sqliteDb.pragma('foreign_keys = ON');
  }

  private async initMySQL(): Promise<void> {
    const config = this.config.mysql!;
    
    // Créer la base de données si elle n'existe pas
    const tempPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });

    await tempPool.execute(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await tempPool.end();

    // Connexion à la base de données
    this.mysqlPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  public getType(): DatabaseType {
    return this.config.type;
  }

  public getSQLiteDb(): Database.Database {
    if (!this.sqliteDb) {
      throw new Error('SQLite non initialisé');
    }
    return this.sqliteDb;
  }

  public getMySQLPool(): Pool {
    if (!this.mysqlPool) {
      throw new Error('MySQL non initialisé');
    }
    return this.mysqlPool;
  }

  // Méthode unifiée pour exécuter des requêtes
  public async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (this.config.type === 'sqlite') {
      const stmt = this.sqliteDb!.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params) as T[];
      } else {
        const result = stmt.run(...params);
        return [{ lastInsertRowid: result.lastInsertRowid, changes: result.changes }] as any;
      }
    } else {
      const [rows] = await this.mysqlPool!.execute(sql, params);
      return rows as T[];
    }
  }

  // Méthode pour obtenir un seul résultat
  public async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // Méthode pour exécuter une requête sans retour
  public async execute(sql: string, params: any[] = []): Promise<{ lastInsertRowid: number; changes: number }> {
    if (this.config.type === 'sqlite') {
      const stmt = this.sqliteDb!.prepare(sql);
      const result = stmt.run(...params);
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.changes };
    } else {
      const [result]: any = await this.mysqlPool!.execute(sql, params);
      return { lastInsertRowid: result.insertId, changes: result.affectedRows };
    }
  }

  private async createTables(): Promise<void> {
    const isSQLite = this.config.type === 'sqlite';
    const autoIncrement = isSQLite ? 'AUTOINCREMENT' : 'AUTO_INCREMENT';
    const textType = isSQLite ? 'TEXT' : 'LONGTEXT';
    const boolType = isSQLite ? 'INTEGER' : 'TINYINT(1)';
    const timestampDefault = isSQLite ? "DEFAULT (datetime('now'))" : 'DEFAULT CURRENT_TIMESTAMP';

    const tables = [
      // Table des utilisateurs
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY ${autoIncrement},
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(50) DEFAULT 'user',
        avatar VARCHAR(500),
        is_active ${boolType} DEFAULT 1,
        reset_token VARCHAR(255),
        reset_token_expires DATETIME,
        last_login DATETIME,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des permissions utilisateurs (catégories visibles)
      `CREATE TABLE IF NOT EXISTS user_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        category_id INTEGER,
        subcategory_id INTEGER,
        can_view ${boolType} DEFAULT 1,
        can_edit ${boolType} DEFAULT 0,
        can_delete ${boolType} DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Table des permissions par groupe (supervisor, user)
      `CREATE TABLE IF NOT EXISTS group_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        role VARCHAR(50) NOT NULL,
        category_id INTEGER NOT NULL,
        can_view ${boolType} DEFAULT 1,
        can_edit ${boolType} DEFAULT 0,
        can_delete ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )`,

      // Table des paramètres généraux
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY ${autoIncrement},
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value ${textType},
        setting_type VARCHAR(50) DEFAULT 'string',
        description VARCHAR(500),
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des configurations SMTP
      `CREATE TABLE IF NOT EXISTS smtp_config (
        id INTEGER PRIMARY KEY ${autoIncrement},
        host VARCHAR(255),
        port INTEGER DEFAULT 587,
        secure ${boolType} DEFAULT 0,
        username VARCHAR(255),
        password VARCHAR(255),
        from_email VARCHAR(255),
        from_name VARCHAR(255),
        is_active ${boolType} DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des templates email
      `CREATE TABLE IF NOT EXISTS email_templates (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(100) UNIQUE NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body ${textType} NOT NULL,
        variables ${textType},
        description VARCHAR(500),
        is_active ${boolType} DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des catégories
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        image VARCHAR(500),
        has_subcategories ${boolType} DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des sous-catégories
      `CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        category_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        image VARCHAR(500),
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )`,

      // Table des objets (matériels)
      `CREATE TABLE IF NOT EXISTS objects (
        id INTEGER PRIMARY KEY ${autoIncrement},
        category_id INTEGER,
        subcategory_id INTEGER,
        name VARCHAR(255) NOT NULL,
        description ${textType},
        image VARCHAR(500),
        reference VARCHAR(100),
        serial_number VARCHAR(100),
        purchase_date DATE,
        purchase_price DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'active',
        location VARCHAR(255),
        notes ${textType},
        custom_fields ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL
      )`,

      // Table des plugins
      `CREATE TABLE IF NOT EXISTS plugins (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(100) UNIQUE NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        version VARCHAR(20) DEFAULT '1.0.0',
        description ${textType},
        author VARCHAR(100),
        icon VARCHAR(100),
        plugin_type VARCHAR(20) DEFAULT 'object',
        route VARCHAR(100),
        is_active ${boolType} DEFAULT 0,
        is_system ${boolType} DEFAULT 0,
        config ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table de liaison plugins-catégories
      `CREATE TABLE IF NOT EXISTS plugin_categories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        plugin_id INTEGER NOT NULL,
        category_id INTEGER,
        subcategory_id INTEGER,
        FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
      )`,

      // Table pour le plugin Carburant
      `CREATE TABLE IF NOT EXISTS fuel_entries (
        id INTEGER PRIMARY KEY ${autoIncrement},
        object_id INTEGER NOT NULL,
        fuel_type VARCHAR(50) NOT NULL,
        quantity DECIMAL(10,2) NOT NULL,
        unit_price DECIMAL(10,2),
        total_price DECIMAL(10,2),
        mileage INTEGER,
        station VARCHAR(255),
        entry_date DATE NOT NULL,
        notes ${textType},
        attachments ${textType},
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Table pour les stations de carburant
      `CREATE TABLE IF NOT EXISTS fuel_stations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL UNIQUE,
        address VARCHAR(500),
        created_at DATETIME ${timestampDefault}
      )`,

      // Table pour les types d'entretien
      `CREATE TABLE IF NOT EXISTS maintenance_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at DATETIME ${timestampDefault}
      )`,

      // Table pour les prestataires d'entretien
      `CREATE TABLE IF NOT EXISTS maintenance_providers (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL UNIQUE,
        address VARCHAR(500),
        phone VARCHAR(50),
        created_at DATETIME ${timestampDefault}
      )`,

      // Table pour les centres de contrôle technique
      `CREATE TABLE IF NOT EXISTS control_centers (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL UNIQUE,
        address VARCHAR(500),
        phone VARCHAR(50),
        created_at DATETIME ${timestampDefault}
      )`,

      // Table pour le plugin Contrôle Technique
      `CREATE TABLE IF NOT EXISTS technical_controls (
        id INTEGER PRIMARY KEY ${autoIncrement},
        object_id INTEGER NOT NULL,
        control_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        mileage INTEGER,
        result VARCHAR(50),
        center_name VARCHAR(255),
        cost DECIMAL(10,2),
        document VARCHAR(500),
        notes ${textType},
        reminder_sent ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Table pour le plugin Maintenance
      `CREATE TABLE IF NOT EXISTS maintenances (
        id INTEGER PRIMARY KEY ${autoIncrement},
        object_id INTEGER NOT NULL,
        maintenance_type VARCHAR(100) NOT NULL,
        maintenance_date DATE NOT NULL,
        next_date DATE,
        mileage INTEGER,
        next_mileage INTEGER,
        cost DECIMAL(10,2),
        provider VARCHAR(255),
        document VARCHAR(500),
        notes ${textType},
        add_to_calendar ${boolType} DEFAULT 0,
        reminder_sent ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Table des événements du calendrier
      `CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY ${autoIncrement},
        title VARCHAR(255) NOT NULL,
        description ${textType},
        event_type VARCHAR(50) NOT NULL,
        start_date DATETIME NOT NULL,
        end_date DATETIME,
        all_day ${boolType} DEFAULT 0,
        object_id INTEGER,
        plugin_reference VARCHAR(100),
        plugin_reference_id INTEGER,
        color VARCHAR(20) DEFAULT '#3b82f6',
        reminder_before INTEGER DEFAULT 0,
        reminder_sent ${boolType} DEFAULT 0,
        source VARCHAR(50) DEFAULT 'local',
        external_id VARCHAR(500),
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Table des alertes
      `CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY ${autoIncrement},
        title VARCHAR(255) NOT NULL,
        message ${textType},
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) DEFAULT 'info',
        object_id INTEGER,
        plugin_reference VARCHAR(100),
        plugin_reference_id INTEGER,
        is_read ${boolType} DEFAULT 0,
        is_dismissed ${boolType} DEFAULT 0,
        due_date DATETIME,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Table des sauvegardes
      `CREATE TABLE IF NOT EXISTS backups (
        id INTEGER PRIMARY KEY ${autoIncrement},
        filename VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER,
        backup_type VARCHAR(50) DEFAULT 'manual',
        status VARCHAR(50) DEFAULT 'completed',
        notes ${textType},
        created_at DATETIME ${timestampDefault}
      )`,

      // Table de log d'activité
      `CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id INTEGER,
        details ${textType},
        ip_address VARCHAR(45),
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Table de configuration des champs personnalisables par catégorie/sous-catégorie
      `CREATE TABLE IF NOT EXISTS custom_fields_config (
        id INTEGER PRIMARY KEY ${autoIncrement},
        category_id INTEGER,
        subcategory_id INTEGER,
        field_name VARCHAR(100) NOT NULL,
        field_label VARCHAR(255) NOT NULL,
        field_type VARCHAR(50) DEFAULT 'text',
        field_options ${textType},
        is_required ${boolType} DEFAULT 0,
        is_visible ${boolType} DEFAULT 1,
        is_system ${boolType} DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
      )`,

      // Table des webhooks
      `CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        url VARCHAR(500) NOT NULL,
        events ${textType},
        headers ${textType},
        secret VARCHAR(255),
        is_active ${boolType} DEFAULT 1,
        last_triggered_at DATETIME,
        last_status INTEGER,
        last_response ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Table des permissions par module (pour les modules spéciaux comme Suivi)
      `CREATE TABLE IF NOT EXISTS module_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        module_name VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        can_view ${boolType} DEFAULT 0,
        can_export ${boolType} DEFAULT 0,
        can_compare ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        UNIQUE(module_name, role)
      )`,

      // Table des permissions utilisateur par module (override individuel)
      `CREATE TABLE IF NOT EXISTS user_module_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        module_name VARCHAR(100) NOT NULL,
        can_view ${boolType} DEFAULT 0,
        can_export ${boolType} DEFAULT 0,
        can_compare ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, module_name)
      )`,

      // Table des tokens API (pour les applications externes)
      `CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_prefix VARCHAR(8) NOT NULL,
        permissions ${textType} DEFAULT '["read"]',
        is_active ${boolType} DEFAULT 1,
        expires_at DATETIME,
        last_used_at DATETIME,
        created_by INTEGER NOT NULL,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Table des réservations / prêts de matériel
      `CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        object_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        start_date DATETIME NOT NULL,
        end_date DATETIME NOT NULL,
        actual_return_date DATETIME,
        reason ${textType},
        status VARCHAR(20) DEFAULT 'reserved',
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Table du stock matériel manifestations
      `CREATE TABLE IF NOT EXISTS manifestation_stock (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        description ${textType},
        category VARCHAR(100) DEFAULT '',
        quantity_total INTEGER NOT NULL DEFAULT 0,
        unit VARCHAR(50) DEFAULT 'unité',
        etat VARCHAR(50) DEFAULT 'bon',
        lieu VARCHAR(255) DEFAULT '',
        stock_type VARCHAR(100) DEFAULT '',
        price REAL DEFAULT 0,
        category_id INTEGER,
        subcategory_id INTEGER,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL
      )`,

      // Table des manifestations
      `CREATE TABLE IF NOT EXISTS manifestations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        title VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        description ${textType},
        date_start DATE NOT NULL,
        date_end DATE,
        start_date DATE,
        end_date DATE,
        start_time VARCHAR(10),
        end_time VARCHAR(10),
        expected_people INTEGER DEFAULT 0,
        contact VARCHAR(255),
        contact_name VARCHAR(255),
        contact_phone VARCHAR(50),
        contact_email VARCHAR(255),
        location VARCHAR(255),
        delivery_address ${textType},
        delivery_date DATE,
        notes_interior ${textType},
        notes_exterior ${textType},
        status VARCHAR(20) DEFAULT 'draft',
        created_by INTEGER,
        archived_at DATETIME,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Table de liaison matériel ↔ manifestation
      `CREATE TABLE IF NOT EXISTS manifestation_materials (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        stock_id INTEGER NOT NULL,
        quantity_requested INTEGER NOT NULL DEFAULT 0,
        quantity_delivered INTEGER NOT NULL DEFAULT 0,
        quantity_recovered INTEGER NOT NULL DEFAULT 0,
        unit_value REAL DEFAULT 0,
        notes ${textType},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE CASCADE
      )`,

      // Table des items de manifestation (objets du parc)
      `CREATE TABLE IF NOT EXISTS manifestation_items (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        object_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        quantity_delivered INTEGER DEFAULT 0,
        quantity_returned INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Table historique des manifestations
      `CREATE TABLE IF NOT EXISTS manifestation_history (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        from_status VARCHAR(50),
        to_status VARCHAR(50),
        comment ${textType},
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Table de configuration de l'authentification (SSO, LDAP, Passkey)
      `CREATE TABLE IF NOT EXISTS auth_config (
        id INTEGER PRIMARY KEY ${autoIncrement},
        provider VARCHAR(50) NOT NULL,
        is_active ${boolType} DEFAULT 0,
        config ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      // Permissions d'accès aux plugins par rôle
      `CREATE TABLE IF NOT EXISTS plugin_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        plugin_id INTEGER NOT NULL,
        role VARCHAR(50) NOT NULL,
        can_access ${boolType} DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
        UNIQUE(plugin_id, role)
      )`,

      // Permissions d'accès aux plugins par utilisateur (override individuel)
      `CREATE TABLE IF NOT EXISTS user_plugin_permissions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        plugin_id INTEGER NOT NULL,
        can_access ${boolType} DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
        UNIQUE(user_id, plugin_id)
      )`,

      // ======================== ESPACES VERTS ========================

      // Table principale des espaces verts
      `CREATE TABLE IF NOT EXISTS green_spaces (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        description ${textType},
        address VARCHAR(500),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        area_m2 DECIMAL(12,2) DEFAULT 0,
        space_type VARCHAR(100) DEFAULT 'parc',
        soil_type VARCHAR(100) DEFAULT '',
        status VARCHAR(50) DEFAULT 'actif',
        image VARCHAR(500),
        plan_image VARCHAR(500),
        custom_fields ${textType} DEFAULT '{}',
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Éléments placés dans un espace vert (arbres, bancs, poubelles, etc.)
      `CREATE TABLE IF NOT EXISTS green_space_elements (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        object_id INTEGER,
        label VARCHAR(255) NOT NULL,
        code VARCHAR(100) DEFAULT '',
        element_type VARCHAR(100) DEFAULT 'autre',
        description ${textType},
        image VARCHAR(500),
        pos_x DECIMAL(10,4),
        pos_y DECIMAL(10,4),
        quantity INTEGER DEFAULT 1,
        purchase_price DECIMAL(10,2),
        maintenance_notes ${textType},
        species VARCHAR(255) DEFAULT '',
        planting_date DATE,
        last_maintenance_date DATE,
        next_maintenance_date DATE,
        condition_state VARCHAR(50) DEFAULT 'bon',
        custom_fields ${textType} DEFAULT '{}',
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL
      )`,

      // Annotations visuelles sur le plan
      `CREATE TABLE IF NOT EXISTS green_space_annotations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        element_id INTEGER,
        pos_x DECIMAL(10,4) NOT NULL,
        pos_y DECIMAL(10,4) NOT NULL,
        label VARCHAR(255) DEFAULT '',
        icon VARCHAR(50) DEFAULT 'circle',
        color VARCHAR(20) DEFAULT '#22c55e',
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (element_id) REFERENCES green_space_elements(id) ON DELETE SET NULL
      )`,

      // Suivi saisonnier
      `CREATE TABLE IF NOT EXISTS green_space_seasons (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        season VARCHAR(20) NOT NULL,
        year INTEGER NOT NULL,
        notes ${textType},
        actions_done ${textType},
        actions_planned ${textType},
        photos ${textType} DEFAULT '[]',
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Documents légaux et pièces jointes
      `CREATE TABLE IF NOT EXISTS green_space_documents (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        doc_type VARCHAR(100) DEFAULT 'autre',
        file_path VARCHAR(500),
        expiry_date DATE,
        notes ${textType},
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
      )`
    ];

    for (const table of tables) {
      await this.execute(table);
    }

    // Exécuter les migrations pour ajouter les colonnes manquantes
    await this.runMigrations();
  }

  // Méthode pour ajouter les colonnes manquantes aux tables existantes
  private async runMigrations(): Promise<void> {
    const migrations = [
      // Ajouter la colonne attachments à fuel_entries si elle n'existe pas
      {
        table: 'fuel_entries',
        column: 'attachments',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // Transformer document en attachments pour maintenances (JSON)
      {
        table: 'maintenances',
        column: 'attachments',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // Transformer document en attachments pour technical_controls (JSON)
      {
        table: 'technical_controls',
        column: 'attachments',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // Ajouter la colonne source à calendar_events pour la synchronisation
      {
        table: 'calendar_events',
        column: 'source',
        type: "VARCHAR(50) DEFAULT 'local'"
      },
      // Ajouter la colonne external_id à calendar_events pour la synchronisation
      {
        table: 'calendar_events',
        column: 'external_id',
        type: 'VARCHAR(500)'
      },
      // Ajouter la colonne applicable_subcategories pour restreindre les champs à certaines sous-catégories
      {
        table: 'custom_fields_config',
        column: 'applicable_subcategories',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // Manifestation stock: ajout champ état
      {
        table: 'manifestation_stock',
        column: 'etat',
        type: "VARCHAR(50) DEFAULT 'bon'"
      },
      // Manifestation stock: ajout champ lieu
      {
        table: 'manifestation_stock',
        column: 'lieu',
        type: "VARCHAR(255) DEFAULT ''"
      },
      // Manifestation stock: ajout champ type
      {
        table: 'manifestation_stock',
        column: 'stock_type',
        type: "VARCHAR(100) DEFAULT ''"
      },
      // Manifestation stock: lien catégorie
      {
        table: 'manifestation_stock',
        column: 'category_id',
        type: 'INTEGER'
      },
      // Manifestation stock: lien sous-catégorie
      {
        table: 'manifestation_stock',
        column: 'subcategory_id',
        type: 'INTEGER'
      },
      // Manifestation stock: prix unitaire
      {
        table: 'manifestation_stock',
        column: 'price',
        type: 'REAL DEFAULT 0'
      }
    ];

    for (const migration of migrations) {
      try {
        // Vérifier si la colonne existe déjà
        if (this.config.type === 'sqlite') {
          const tableInfo = this.sqliteDb!.prepare(`PRAGMA table_info(${migration.table})`).all() as any[];
          const columnExists = tableInfo.some(col => col.name === migration.column);
          
          if (!columnExists) {
            await this.execute(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`);
            console.log(`Migration: Ajout de la colonne ${migration.column} à ${migration.table}`);
          }
        } else {
          // MySQL
          const [columns] = await this.mysqlPool!.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [migration.table, migration.column]
          ) as any[];
          
          if (columns.length === 0) {
            await this.execute(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`);
            console.log(`Migration: Ajout de la colonne ${migration.column} à ${migration.table}`);
          }
        }
      } catch (error: any) {
        // Ignorer les erreurs si la colonne existe déjà
        if (!error.message.includes('duplicate column') && !error.message.includes('Duplicate column')) {
          console.error(`Erreur migration ${migration.table}.${migration.column}:`, error.message);
        }
      }
    }
  }

  // Méthode pour migrer de SQLite vers MySQL
  public async migrateToMySQL(mysqlConfig: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }): Promise<{ success: boolean; message: string }> {
    if (this.config.type !== 'sqlite') {
      return { success: false, message: 'La migration est uniquement possible depuis SQLite' };
    }

    try {
      // Créer la connexion MySQL temporaire
      const tempPool = mysql.createPool({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password
      });

      // Créer la base de données
      await tempPool.execute(`CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await tempPool.end();

      // Connexion à la nouvelle base
      const newPool = mysql.createPool({
        ...mysqlConfig,
        waitForConnections: true,
        connectionLimit: 10
      });

      // Créer les tables dans MySQL
      this.mysqlPool = newPool;
      this.config.type = 'mysql';
      await this.createTables();

      // Liste des tables à migrer
      const tablesToMigrate = [
        'users', 'user_permissions', 'settings', 'smtp_config', 'email_templates',
        'categories', 'subcategories', 'objects', 'plugins', 'plugin_categories',
        'fuel_entries', 'technical_controls', 'maintenances', 'calendar_events',
        'alerts', 'backups', 'activity_logs'
      ];

      // Migrer les données
      for (const table of tablesToMigrate) {
        const rows = this.sqliteDb!.prepare(`SELECT * FROM ${table}`).all() as any[];
        
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]).filter(col => col !== 'id');
          const placeholders = columns.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
          
          for (const row of rows) {
            const values = columns.map(col => row[col]);
            await newPool.execute(insertSql, values);
          }
        }
      }

      return { success: true, message: 'Migration réussie vers MySQL' };
    } catch (error: any) {
      // Rétablir SQLite en cas d'erreur
      this.config.type = 'sqlite';
      this.mysqlPool = null;
      return { success: false, message: `Erreur de migration: ${error.message}` };
    }
  }

  public async close(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
    if (this.mysqlPool) {
      await this.mysqlPool.end();
    }
  }
}

export const db = DatabaseManager.getInstance();

export async function initDatabase(): Promise<void> {
  await db.init();
}

export default db;
