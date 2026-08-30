import Database from 'better-sqlite3';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import path from 'path';
import fs from 'fs';
import { appliquerMigrations } from './migrationRunner';

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

  /**
   * `migrationsAuto: false` ouvre la connexion et crée les tables sans appliquer
   * les migrations versionnées. La commande `db:migrate --dry-run` en a besoin :
   * inspecter ce qui reste à faire ne doit rien modifier.
   */
  public async init(options: { migrationsAuto?: boolean } = {}): Promise<void> {
    if (this.config.type === 'sqlite') {
      await this.initSQLite();
    } else {
      await this.initMySQL();
    }
    await this.createTables(options.migrationsAuto ?? true);
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

  /** Chemin du fichier SQLite, `null` sur MySQL. */
  public getSQLitePath(): string | null {
    return this.config.type === 'sqlite' ? this.config.sqlite!.path : null;
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

  private async createTables(migrationsAuto = true): Promise<void> {
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
        anonymized_at DATETIME,
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
        available_for_manifestations ${boolType} DEFAULT 1,
        is_prestation ${boolType} DEFAULT 0,
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
        available_for_manifestations ${boolType},
        is_prestation ${boolType},
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
        available_for_manifestations ${boolType},
        is_prestation ${boolType},
        material_type VARCHAR(20) DEFAULT 'unique',
        quantity_total INTEGER DEFAULT 0,
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

      /*
       * État de lecture des alertes, par utilisateur.
       *
       * La colonne alerts.is_read est globale : « tout marquer comme lu »
       * vidait la pastille de toute la collectivité. Une ligne ici signifie
       * « cet agent a vu cette alerte », sans effet pour les autres.
       *
       * `is_dismissed` reste global : ignorer une alerte, c'est déclarer que
       * la situation est traitée — ce qui vaut pour tout le monde.
       */
      `CREATE TABLE IF NOT EXISTS alert_reads (
        id INTEGER PRIMARY KEY ${autoIncrement},
        alert_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at DATETIME ${timestampDefault},
        UNIQUE (alert_id, user_id),
        FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        is_prestation ${boolType} DEFAULT 0,
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
        recovery_date DATE,
        intake_request_id INTEGER,
        intake_unmatched ${textType},
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
        quantity_lost INTEGER NOT NULL DEFAULT 0,
        loss_reason ${textType},
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
        return_state VARCHAR(20),
        notes ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`,

      // Sources autorisées à déposer une demande de manifestation, et journal
      // de ce qu'elles ont envoyé. Voir la migration 003 : ces tables y sont
      // aussi créées, pour les bases déjà déployées.
      `CREATE TABLE IF NOT EXISTS manifestation_intake_sources (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        secret VARCHAR(255) NOT NULL,
        is_active ${boolType} DEFAULT 1,
        field_mapping ${textType},
        material_mapping ${textType},
        last_payload ${textType},
        last_received_at DATETIME,
        last_status VARCHAR(20),
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      `CREATE TABLE IF NOT EXISTS manifestation_intake_requests (
        id INTEGER PRIMARY KEY ${autoIncrement},
        source_id INTEGER,
        external_id VARCHAR(255),
        payload ${textType},
        signature_ok ${boolType} DEFAULT 0,
        status VARCHAR(20) NOT NULL,
        manifestation_id INTEGER,
        error ${textType},
        received_at DATETIME ${timestampDefault},
        FOREIGN KEY (source_id) REFERENCES manifestation_intake_sources(id) ON DELETE SET NULL,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE SET NULL
      )`,

      // « tables » dans le formulaire, « Table 180 cm » dans le stock.
      `CREATE TABLE IF NOT EXISTS manifestation_stock_aliases (
        id INTEGER PRIMARY KEY ${autoIncrement},
        stock_id INTEGER NOT NULL,
        alias VARCHAR(255) NOT NULL,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE CASCADE
      )`,

      // Journal des mouvements de stock : un total doit toujours pouvoir
      // s'expliquer, en particulier quand une perte l'a diminué.
      `CREATE TABLE IF NOT EXISTS manifestation_stock_movements (
        id INTEGER PRIMARY KEY ${autoIncrement},
        stock_id INTEGER NOT NULL,
        manifestation_id INTEGER,
        type VARCHAR(20) NOT NULL,
        quantity INTEGER NOT NULL,
        reason ${textType},
        user_id INTEGER,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE CASCADE,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Pièces jointes d'une manifestation : arrêté, plan, constat, photo. Voir
      // la migration 009. Le lien vers le matériel porte sur l'article et non
      // sur la ligne, qui est réécrite à chaque modification.
      `CREATE TABLE IF NOT EXISTS manifestation_documents (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        doc_type VARCHAR(100) DEFAULT 'autre',
        description ${textType},
        file_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100),
        size INTEGER,
        stock_id INTEGER,
        object_id INTEGER,
        service_id INTEGER,
        generated_from_template ${boolType} DEFAULT 0,
        uploaded_by INTEGER,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE SET NULL,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Modèle .docx rattaché à un service, avec ses champs détectés et leur
      // correspondance. Voir la migration 010.
      `CREATE TABLE IF NOT EXISTS service_templates (
        id INTEGER PRIMARY KEY ${autoIncrement},
        service_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'upload',
        file_path VARCHAR(500),
        remote_path VARCHAR(500),
        detected_fields ${textType},
        field_mapping ${textType},
        is_active ${boolType} DEFAULT 1,
        last_error ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS manifestation_doc_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        is_default ${boolType} DEFAULT 0,
        disabled ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault}
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

      // Services concernés par une manifestation. Voir la migration 004 :
      // un service est un groupe de personnes ET un périmètre de catégories,
      // et c'est ce périmètre qui décide qui est sollicité.
      `CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255),
        description ${textType},
        is_observer ${boolType} DEFAULT 0,
        is_coordinator ${boolType} DEFAULT 0,
        is_active ${boolType} DEFAULT 1,
        notify_new_request ${boolType} DEFAULT 1,
        notify_status_change ${boolType} DEFAULT 1,
        notify_material_change ${boolType} DEFAULT 1,
        notify_message ${boolType} DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
      )`,

      `CREATE TABLE IF NOT EXISTS service_categories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        service_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        UNIQUE(service_id, category_id),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS service_members (
        id INTEGER PRIMARY KEY ${autoIncrement},
        service_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        is_manager ${boolType} DEFAULT 0,
        created_at DATETIME ${timestampDefault},
        UNIQUE(service_id, user_id),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS manifestation_approvals (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        service_id INTEGER,
        user_id INTEGER,
        kind VARCHAR(20) NOT NULL DEFAULT 'approbation',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        requested_by INTEGER,
        requested_at DATETIME ${timestampDefault},
        decided_by INTEGER,
        decided_at DATETIME,
        comment ${textType},
        delivery_date DATE,
        recovery_date DATE,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS manifestation_messages (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        user_id INTEGER,
        service_id INTEGER,
        body ${textType} NOT NULL,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS manifestation_watchers (
        id INTEGER PRIMARY KEY ${autoIncrement},
        manifestation_id INTEGER NOT NULL,
        user_id INTEGER,
        service_id INTEGER,
        added_by INTEGER,
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Délégation d'approbation, accordée par un responsable de service.
      // Voir la migration 007 : seul un responsable décide, et lui seul délègue.
      `CREATE TABLE IF NOT EXISTS service_delegations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        service_id INTEGER NOT NULL,
        delegate_user_id INTEGER NOT NULL,
        granted_by INTEGER,
        start_date DATE,
        end_date DATE,
        created_at DATETIME ${timestampDefault},
        UNIQUE(service_id, delegate_user_id),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
      )`,

      // Préférences de notification, une ligne par compte et par événement.
      // L'absence de ligne vaut « suivre le réglage par défaut ». Voir la
      // migration 006.
      `CREATE TABLE IF NOT EXISTS notification_preferences (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        event VARCHAR(50) NOT NULL,
        enabled ${boolType} NOT NULL DEFAULT 1,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        UNIQUE(user_id, event),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Profils d'export des manifestations. Voir la migration 005 : quelles
      // colonnes, dans quel ordre, sous quel intitulé, et vers où.
      `CREATE TABLE IF NOT EXISTS manifestation_export_profiles (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        columns ${textType},
        filters ${textType},
        destination VARCHAR(20) NOT NULL DEFAULT 'download',
        remote_path VARCHAR(500),
        is_active ${boolType} DEFAULT 1,
        auto_export ${boolType} DEFAULT 0,
        last_export_at DATETIME,
        last_status VARCHAR(20),
        last_error ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault}
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
        cloned_from_id INTEGER,
        created_by INTEGER,
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (cloned_from_id) REFERENCES green_spaces(id) ON DELETE SET NULL
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
      )`,

      // Groupes de composition (massif, haie composée, etc.)
      `CREATE TABLE IF NOT EXISTS green_space_groups (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        group_type VARCHAR(100) DEFAULT 'massif',
        description ${textType},
        color VARCHAR(20) DEFAULT '#8b5cf6',
        icon VARCHAR(50) DEFAULT 'layers',
        pos_x DECIMAL(10,4),
        pos_y DECIMAL(10,4),
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE
      )`,

      // Entretiens des espaces verts
      `CREATE TABLE IF NOT EXISTS green_space_maintenances (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        maintenance_type VARCHAR(100) NOT NULL,
        title VARCHAR(255),
        description ${textType},
        performed_date DATE,
        next_maintenance_date DATE,
        performed_by VARCHAR(255),
        duration_minutes INTEGER,
        cost DECIMAL(10,2),
        notes ${textType},
        created_at DATETIME ${timestampDefault},
        updated_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE
      )`,

      // Liaison entretien <-> éléments
      `CREATE TABLE IF NOT EXISTS green_space_maintenance_elements (
        id INTEGER PRIMARY KEY ${autoIncrement},
        maintenance_id INTEGER NOT NULL,
        element_id INTEGER NOT NULL,
        FOREIGN KEY (maintenance_id) REFERENCES green_space_maintenances(id) ON DELETE CASCADE,
        FOREIGN KEY (element_id) REFERENCES green_space_elements(id) ON DELETE CASCADE
      )`,

      // Liaison entretien <-> documents
      `CREATE TABLE IF NOT EXISTS green_space_maintenance_documents (
        id INTEGER PRIMARY KEY ${autoIncrement},
        maintenance_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        FOREIGN KEY (maintenance_id) REFERENCES green_space_maintenances(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES green_space_documents(id) ON DELETE CASCADE
      )`,

      // Liaison documents <-> éléments
      `CREATE TABLE IF NOT EXISTS green_space_document_elements (
        id INTEGER PRIMARY KEY ${autoIncrement},
        document_id INTEGER NOT NULL,
        element_id INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES green_space_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (element_id) REFERENCES green_space_elements(id) ON DELETE CASCADE
      )`,

      // Snapshots / Archives d'un espace vert
      `CREATE TABLE IF NOT EXISTS green_space_snapshots (
        id INTEGER PRIMARY KEY ${autoIncrement},
        green_space_id INTEGER NOT NULL,
        label VARCHAR(255) NOT NULL,
        snapshot_date DATETIME NOT NULL,
        plan_image VARCHAR(500),
        elements_data ${textType} DEFAULT '[]',
        annotations_data ${textType} DEFAULT '[]',
        groups_data ${textType} DEFAULT '[]',
        notes ${textType},
        created_at DATETIME ${timestampDefault},
        FOREIGN KEY (green_space_id) REFERENCES green_spaces(id) ON DELETE CASCADE
      )`,

      // Types d'espaces verts
      `CREATE TABLE IF NOT EXISTS green_space_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        icon VARCHAR(10) DEFAULT '🌳',
        is_default INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault}
      )`,

      // Statuts d'espaces verts
      `CREATE TABLE IF NOT EXISTS green_space_statuses (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        color VARCHAR(50) DEFAULT '',
        is_default INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault}
      )`,

      // Types de documents pour espaces verts
      `CREATE TABLE IF NOT EXISTS green_space_doc_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        is_default INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault}
      )`,

      // Types d'entretien pour espaces verts
      `CREATE TABLE IF NOT EXISTS green_space_maintenance_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        icon VARCHAR(10) DEFAULT '🔧',
        is_default INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault}
      )`,

      // Types de groupes de composition
      `CREATE TABLE IF NOT EXISTS green_space_group_types (
        id INTEGER PRIMARY KEY ${autoIncrement},
        value VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        icon VARCHAR(10) DEFAULT '🌺',
        color VARCHAR(20) DEFAULT '#8b5cf6',
        is_default INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME ${timestampDefault}
      )`,

      // Historique de remplacement d'éléments
      `CREATE TABLE IF NOT EXISTS green_space_element_replacements (
        id INTEGER PRIMARY KEY ${autoIncrement},
        element_id INTEGER NOT NULL,
        green_space_id INTEGER NOT NULL,
        group_id INTEGER,
        replaced_at DATETIME ${timestampDefault},
        season VARCHAR(50) DEFAULT '',
        year INTEGER,
        reason TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        previous_label VARCHAR(255),
        previous_species VARCHAR(255),
        previous_element_type VARCHAR(100),
        previous_description TEXT,
        previous_condition_state VARCHAR(50),
        previous_image VARCHAR(500),
        previous_quantity INTEGER,
        previous_purchase_price DECIMAL(10,2),
        previous_planting_date DATE,
        previous_custom_fields TEXT DEFAULT '{}',
        previous_data TEXT DEFAULT '{}',
        created_at DATETIME ${timestampDefault}
      )`
    ];

    for (const table of tables) {
      await this.execute(table);
    }

    // Exécuter les migrations pour ajouter les colonnes manquantes
    await this.runMigrations();

    await this.createIndexes();

    // Migrations versionnées. Elles s'exécutent au démarrage parce que le
    // conteneur ne lance que `node dist/server.js` : une évolution de schéma
    // qui dépendrait d'une commande manuelle ne serait jamais appliquée.
    if (!migrationsAuto) return;

    const resultat = await appliquerMigrations(this, {
      cheminSqlite: this.getSQLitePath() ?? undefined,
      journaliser: (message) => console.log(`[migration] ${message}`),
    });
    if (resultat.appliquees.length > 0) {
      console.log(`[migration] ${resultat.appliquees.length} migration(s) appliquée(s)`);
    }
  }

  /**
   * Index de recherche.
   *
   * Le schéma n'en déclarait aucun sur ses 54 tables : chaque lecture par clé
   * étrangère balayait la table entière. Le coût se voyait surtout à
   * l'ouverture d'une fiche matériel et lors de la vérification horaire des
   * alertes, qui parcourt `technical_controls` et `maintenances` en entier.
   *
   * `IF NOT EXISTS` est accepté par SQLite comme par MySQL 8 : la méthode est
   * rejouable à chaque démarrage, comme `createTables`.
   */
  private async createIndexes(): Promise<void> {
    const indexes: Array<[string, string, string]> = [
      // [nom, table, colonnes]

      // Relevés de terrain — lus à chaque ouverture de fiche
      ['idx_fuel_object', 'fuel_entries', 'object_id, entry_date'],
      ['idx_maintenance_object', 'maintenances', 'object_id'],
      ['idx_control_object', 'technical_controls', 'object_id'],

      // Échéances — parcourues chaque heure par le cron
      ['idx_maintenance_next', 'maintenances', 'next_date'],
      ['idx_control_expiry', 'technical_controls', 'expiry_date'],
      ['idx_greenspace_maint_next', 'green_space_maintenances', 'next_maintenance_date'],
      ['idx_calendar_start', 'calendar_events', 'start_date'],

      // Navigation dans le parc
      ['idx_objects_category', 'objects', 'category_id'],
      ['idx_objects_subcategory', 'objects', 'subcategory_id'],
      ['idx_objects_status', 'objects', 'status'],
      ['idx_subcategories_category', 'subcategories', 'category_id'],

      // Alertes et pastille
      ['idx_alerts_etat', 'alerts', 'is_dismissed, is_read'],
      ['idx_alerts_reference', 'alerts', 'plugin_reference, plugin_reference_id'],
      ['idx_alerts_object', 'alerts', 'object_id'],
      ['idx_alert_reads_user', 'alert_reads', 'user_id'],
      ['idx_alert_reads_alert', 'alert_reads', 'alert_id'],

      // Espaces verts
      ['idx_gs_elements_space', 'green_space_elements', 'green_space_id'],
      ['idx_gs_maint_space', 'green_space_maintenances', 'green_space_id'],
      ['idx_gs_documents_space', 'green_space_documents', 'green_space_id'],

      // Manifestations
      ['idx_manif_materials', 'manifestation_materials', 'manifestation_id'],
      ['idx_manif_intake_external', 'manifestation_intake_requests', 'external_id'],
      ['idx_manif_movements_stock', 'manifestation_stock_movements', 'stock_id'],
      ['idx_manif_alias_stock', 'manifestation_stock_aliases', 'stock_id'],
      ['idx_manif_approvals', 'manifestation_approvals', 'manifestation_id'],
      ['idx_manif_approvals_service', 'manifestation_approvals', 'service_id, status'],
      ['idx_manif_messages', 'manifestation_messages', 'manifestation_id'],
      ['idx_manif_watchers', 'manifestation_watchers', 'manifestation_id'],
      ['idx_service_categories', 'service_categories', 'category_id'],
      ['idx_service_members_user', 'service_members', 'user_id'],
      ['idx_manif_items', 'manifestation_items', 'manifestation_id'],
      ['idx_manif_items_object', 'manifestation_items', 'object_id'],
      ['idx_notif_prefs_user', 'notification_preferences', 'user_id'],
      ['idx_service_delegations', 'service_delegations', 'service_id'],
      ['idx_manif_documents', 'manifestation_documents', 'manifestation_id'],
      ['idx_manif_documents_stock', 'manifestation_documents', 'stock_id'],
      ['idx_service_templates', 'service_templates', 'service_id'],

      // Droits — consultés à chaque requête filtrée par catégorie
      ['idx_user_permissions_user', 'user_permissions', 'user_id'],
      ['idx_group_permissions_role', 'group_permissions', 'role'],

      // Authentification par jeton API
      ['idx_api_tokens_hash', 'api_tokens', 'token_hash'],

      // Réservations
      ['idx_reservations_object', 'reservations', 'object_id'],
      ['idx_reservations_status', 'reservations', 'status'],
    ];

    for (const [nom, table, colonnes] of indexes) {
      try {
        await this.execute(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`);
      } catch (error: any) {
        // Une table absente (module non déployé) ne doit pas empêcher le
        // démarrage : on note et on continue.
        console.warn(`Index ${nom} non créé : ${error.message}`);
      }
    }
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
      },
      // Groupe de composition pour les éléments d'espace vert
      {
        table: 'green_space_elements',
        column: 'group_id',
        type: 'INTEGER'
      },
      // Superficie en m² pour les éléments d'espace vert
      {
        table: 'green_space_elements',
        column: 'area_m2',
        type: 'DECIMAL(12,2)'
      },
      // Points de zone (polygone) pour les éléments d'espace vert
      {
        table: 'green_space_elements',
        column: 'zone_points',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // Superficie en m² pour les groupes de composition
      {
        table: 'green_space_groups',
        column: 'area_m2',
        type: 'DECIMAL(12,2)'
      },
      // Points de zone (polygone) pour les groupes de composition
      {
        table: 'green_space_groups',
        column: 'zone_points',
        type: this.config.type === 'sqlite' ? 'TEXT' : 'LONGTEXT'
      },
      // is_default pour types de documents
      {
        table: 'green_space_doc_types',
        column: 'is_default',
        type: 'INTEGER DEFAULT 0'
      },
      // disabled pour types de documents
      {
        table: 'green_space_doc_types',
        column: 'disabled',
        type: 'INTEGER DEFAULT 0'
      },
      // is_default pour types d'entretien
      {
        table: 'green_space_maintenance_types',
        column: 'is_default',
        type: 'INTEGER DEFAULT 0'
      },
      // disabled pour types d'entretien
      {
        table: 'green_space_maintenance_types',
        column: 'disabled',
        type: 'INTEGER DEFAULT 0'
      },
      // Coordonnées GPS pour les éléments d'espace vert
      {
        table: 'green_space_elements',
        column: 'latitude',
        type: 'DECIMAL(10,7)'
      },
      {
        table: 'green_space_elements',
        column: 'longitude',
        type: 'DECIMAL(10,7)'
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

    // Seed types par défaut si la table est vide
    await this.seedDefaultTypes();
  }

  private async seedDefaultTypes(): Promise<void> {
    const defaultSpaceTypes = [
      { value: 'parc', label: 'Parc', icon: '🌳' },
      { value: 'jardin', label: 'Jardin public', icon: '🌺' },
      { value: 'square', label: 'Square', icon: '🏛️' },
      { value: 'aire_jeux', label: 'Aire de jeux', icon: '🎠' },
      { value: 'espace_naturel', label: 'Espace naturel', icon: '🌿' },
      { value: 'rond_point', label: 'Rond-point', icon: '🔄' },
      { value: 'allee', label: 'Allée / Promenade', icon: '🚶' },
      { value: 'berge', label: 'Berge / Bord de rivière', icon: '🌊' },
      { value: 'cimetiere', label: 'Cimetière végétalisé', icon: '⚱️' },
      { value: 'terrain_sport', label: 'Terrain de sport', icon: '⚽' },
      { value: 'autre', label: 'Autre', icon: '📍' },
    ];

    const defaultStatuses = [
      { value: 'actif', label: 'Actif', color: 'green' },
      { value: 'en_travaux', label: 'En travaux', color: 'orange' },
      { value: 'ferme', label: 'Fermé au public', color: 'red' },
      { value: 'projet', label: 'En projet', color: 'blue' },
    ];

    for (const st of defaultSpaceTypes) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO green_space_types (value, label, icon, is_default) VALUES (?, ?, ?, 1)',
          [st.value, st.label, st.icon]
        );
      } catch { /* ignore duplicates */ }
    }

    for (const s of defaultStatuses) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO green_space_statuses (value, label, color, is_default) VALUES (?, ?, ?, 1)',
          [s.value, s.label, s.color]
        );
      } catch { /* ignore duplicates */ }
    }

    const defaultDocTypes = [
      { value: 'plan', label: 'Plan / Cadastre' },
      { value: 'permis', label: 'Permis / Autorisation' },
      { value: 'diagnostic', label: 'Diagnostic phytosanitaire' },
      { value: 'conformite', label: 'Certificat de conformité' },
      { value: 'securite', label: 'Rapport de sécurité' },
      { value: 'accessibilite', label: 'Accessibilité PMR' },
      { value: 'contrat', label: "Contrat d'entretien" },
      { value: 'facture', label: 'Facture' },
      { value: 'photo', label: 'Photo / Relevé' },
      { value: 'autre', label: 'Autre' },
    ];

    const defaultMaintenanceTypes = [
      { value: 'tonte', label: 'Tonte', icon: '🌿' },
      { value: 'elagage', label: 'Élagage', icon: '✂️' },
      { value: 'taille', label: 'Taille', icon: '🌳' },
      { value: 'arrosage', label: 'Arrosage', icon: '💧' },
      { value: 'desherbage', label: 'Désherbage', icon: '🌱' },
      { value: 'fertilisation', label: 'Fertilisation', icon: '🧪' },
      { value: 'traitement_phytosanitaire', label: 'Traitement phytosanitaire', icon: '🧴' },
      { value: 'plantation', label: 'Plantation', icon: '🌺' },
      { value: 'ramassage_feuilles', label: 'Ramassage de feuilles', icon: '🍂' },
      { value: 'nettoyage', label: 'Nettoyage', icon: '🧹' },
      { value: 'reparation', label: 'Réparation', icon: '🔧' },
      { value: 'inspection', label: 'Inspection', icon: '🔍' },
      { value: 'autre', label: 'Autre', icon: '📋' },
    ];

    for (const dt of defaultDocTypes) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO green_space_doc_types (value, label, is_default) VALUES (?, ?, 1)',
          [dt.value, dt.label]
        );
      } catch { /* ignore duplicates */ }
    }

    // Pièces qu'une manifestation municipale rassemble réellement. La liste est
    // éditable ensuite : chaque collectivité nomme ses documents à sa façon, et
    // une liste figée obligerait à un développeur pour ajouter « autorisation de
    // buvette ».
    const defaultManifestationDocTypes = [
      { value: 'arrete_circulation', label: 'Arrêté de circulation' },
      { value: 'arrete_boisson', label: 'Arrêté de débit de boissons' },
      { value: 'plan', label: "Plan d'implantation" },
      { value: 'constat_materiel', label: 'Constat matériel' },
      { value: 'constat_lieu', label: 'Constat du lieu' },
      { value: 'photo', label: 'Photo' },
      { value: 'assurance', label: "Attestation d'assurance" },
      { value: 'devis', label: 'Devis ou facture' },
      { value: 'convention', label: 'Convention de prêt' },
      { value: 'autre', label: 'Autre' },
    ];

    for (const dt of defaultManifestationDocTypes) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO manifestation_doc_types (value, label, is_default) VALUES (?, ?, 1)',
          [dt.value, dt.label]
        );
      } catch { /* ignore duplicates */ }
    }

    for (const mt of defaultMaintenanceTypes) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO green_space_maintenance_types (value, label, icon, is_default) VALUES (?, ?, ?, 1)',
          [mt.value, mt.label, mt.icon]
        );
      } catch { /* ignore duplicates */ }
    }

    // Types de groupes de composition par défaut
    const defaultGroupTypes = [
      { value: 'massif', label: 'Massif floral', icon: '🌺', color: '#ec4899' },
      { value: 'haie', label: 'Haie composée', icon: '🌲', color: '#15803d' },
      { value: 'bosquet', label: 'Bosquet', icon: '🌳', color: '#16a34a' },
      { value: 'rocaille', label: 'Rocaille', icon: '🪨', color: '#78716c' },
      { value: 'jardiniere', label: 'Jardinière', icon: '🌷', color: '#f472b6' },
      { value: 'plate_bande', label: 'Plate-bande', icon: '🌸', color: '#a855f7' },
      { value: 'mixed_border', label: 'Mixed-border', icon: '🌼', color: '#f59e0b' },
      { value: 'autre', label: 'Autre', icon: '📍', color: '#6b7280' },
    ];

    for (const gt of defaultGroupTypes) {
      try {
        await this.execute(
          'INSERT OR IGNORE INTO green_space_group_types (value, label, icon, color, is_default) VALUES (?, ?, ?, ?, 1)',
          [gt.value, gt.label, gt.icon, gt.color]
        );
      } catch { /* ignore duplicates */ }
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
