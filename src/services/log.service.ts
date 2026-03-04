import { db } from '../database';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export type LogLevel = 'info' | 'warning' | 'error' | 'debug' | 'success';
export type LogCategory = 'auth' | 'system' | 'user' | 'backup' | 'plugin' | 'database' | 'email' | 'api' | 'security' | 'other';

export interface LogEntry {
  id?: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: string;
  userId?: number;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  requestPath?: string;
  requestMethod?: string;
  createdAt?: string;
}

export interface LogFilter {
  level?: LogLevel | LogLevel[];
  category?: LogCategory | LogCategory[];
  search?: string;
  userId?: number;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface LogSettings {
  retentionDays: number;
  enabledLevels: LogLevel[];
  enabledCategories: LogCategory[];
  autoCleanup: boolean;
  logApiRequests: boolean;
  logAuthAttempts: boolean;
  logSystemEvents: boolean;
  maxLogsPerExport: number;
}

const DEFAULT_SETTINGS: LogSettings = {
  retentionDays: 90,
  enabledLevels: ['info', 'warning', 'error', 'success'],
  enabledCategories: ['auth', 'system', 'user', 'backup', 'plugin', 'database', 'email', 'api', 'security'],
  autoCleanup: true,
  logApiRequests: true,
  logAuthAttempts: true,
  logSystemEvents: true,
  maxLogsPerExport: 50000
};

class LogService {
  private static instance: LogService;
  private settings: LogSettings = DEFAULT_SETTINGS;
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    await this.createTable();
    await this.loadSettings();
    this.initialized = true;

    // Lancer le nettoyage automatique si activé
    if (this.settings.autoCleanup) {
      this.scheduleCleanup();
    }
  }

  private async createTable(): Promise<void> {
    const isSQLite = db.getType() === 'sqlite';
    const autoIncrement = isSQLite ? 'AUTOINCREMENT' : 'AUTO_INCREMENT';
    const textType = isSQLite ? 'TEXT' : 'LONGTEXT';
    const timestampDefault = isSQLite ? "DEFAULT (datetime('now'))" : 'DEFAULT CURRENT_TIMESTAMP';

    await db.execute(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY ${autoIncrement},
        level VARCHAR(20) NOT NULL,
        category VARCHAR(50) NOT NULL,
        message VARCHAR(1000) NOT NULL,
        details ${textType},
        user_id INTEGER,
        user_email VARCHAR(255),
        ip_address VARCHAR(50),
        user_agent VARCHAR(500),
        request_path VARCHAR(500),
        request_method VARCHAR(10),
        created_at DATETIME ${timestampDefault}
      )
    `);

    // Créer les index pour de meilleures performances
    try {
      await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)');
    } catch (e) {
      // Les index existent peut-être déjà
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const setting = await db.queryOne(
        "SELECT setting_value FROM settings WHERE setting_key = 'log_settings'"
      );
      if (setting?.setting_value) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(setting.setting_value) };
      }
    } catch (e) {
      console.error('Erreur lors du chargement des paramètres de logs:', e);
    }
  }

  public async saveSettings(newSettings: Partial<LogSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };
    
    const settingValue = JSON.stringify(this.settings);
    const existing = await db.queryOne(
      "SELECT id FROM settings WHERE setting_key = 'log_settings'"
    );

    if (existing) {
      const now = new Date().toISOString();
      await db.execute(
        "UPDATE settings SET setting_value = ?, setting_type = 'json', updated_at = ? WHERE setting_key = 'log_settings'",
        [settingValue, now]
      );
    } else {
      await db.execute(
        "INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, 'json', 'Paramètres de journalisation')",
        ['log_settings', settingValue]
      );
    }

    // Relancer le nettoyage si activé
    if (this.settings.autoCleanup) {
      this.scheduleCleanup();
    }
  }

  public getSettings(): LogSettings {
    return { ...this.settings };
  }

  private scheduleCleanup(): void {
    // Exécuter le nettoyage toutes les 24 heures
    setInterval(() => {
      this.cleanupOldLogs();
    }, 24 * 60 * 60 * 1000);
  }

  public async cleanupOldLogs(): Promise<number> {
    const isSQLite = db.getType() === 'sqlite';
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - this.settings.retentionDays);
    const dateStr = retentionDate.toISOString().split('T')[0];

    const countResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM logs WHERE DATE(created_at) < ?',
      [dateStr]
    );
    const count = countResult?.count || 0;

    if (count > 0) {
      await db.execute('DELETE FROM logs WHERE DATE(created_at) < ?', [dateStr]);
      await this.log({
        level: 'info',
        category: 'system',
        message: `Nettoyage automatique: ${count} logs supprimés (rétention: ${this.settings.retentionDays} jours)`
      });
    }

    return count;
  }

  public async log(entry: Omit<LogEntry, 'id' | 'createdAt'>): Promise<void> {
    // Vérifier si ce niveau/catégorie est activé
    if (!this.settings.enabledLevels.includes(entry.level)) return;
    if (!this.settings.enabledCategories.includes(entry.category)) return;

    try {
      await db.execute(
        `INSERT INTO logs (level, category, message, details, user_id, user_email, ip_address, user_agent, request_path, request_method) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.level,
          entry.category,
          entry.message,
          entry.details || null,
          entry.userId || null,
          entry.userEmail || null,
          entry.ipAddress || null,
          entry.userAgent || null,
          entry.requestPath || null,
          entry.requestMethod || null
        ]
      );
    } catch (e) {
      console.error('Erreur lors de l\'enregistrement du log:', e);
    }
  }

  // Méthodes raccourcies pour les différents niveaux
  public async info(category: LogCategory, message: string, details?: object, context?: Partial<LogEntry>): Promise<void> {
    await this.log({ level: 'info', category, message, details: details ? JSON.stringify(details) : undefined, ...context });
  }

  public async warning(category: LogCategory, message: string, details?: object, context?: Partial<LogEntry>): Promise<void> {
    await this.log({ level: 'warning', category, message, details: details ? JSON.stringify(details) : undefined, ...context });
  }

  public async error(category: LogCategory, message: string, details?: object, context?: Partial<LogEntry>): Promise<void> {
    await this.log({ level: 'error', category, message, details: details ? JSON.stringify(details) : undefined, ...context });
  }

  public async success(category: LogCategory, message: string, details?: object, context?: Partial<LogEntry>): Promise<void> {
    await this.log({ level: 'success', category, message, details: details ? JSON.stringify(details) : undefined, ...context });
  }

  public async debug(category: LogCategory, message: string, details?: object, context?: Partial<LogEntry>): Promise<void> {
    await this.log({ level: 'debug', category, message, details: details ? JSON.stringify(details) : undefined, ...context });
  }

  public async getLogs(filter: LogFilter = {}): Promise<{ logs: LogEntry[], total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    // Filtrer par niveau
    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      conditions.push(`level IN (${levels.map(() => '?').join(', ')})`);
      params.push(...levels);
    }

    // Filtrer par catégorie
    if (filter.category) {
      const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
      conditions.push(`category IN (${categories.map(() => '?').join(', ')})`);
      params.push(...categories);
    }

    // Recherche textuelle
    if (filter.search) {
      conditions.push('(message LIKE ? OR details LIKE ? OR user_email LIKE ?)');
      const searchTerm = `%${filter.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filtrer par utilisateur
    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }

    // Filtrer par date de début
    if (filter.startDate) {
      conditions.push('DATE(created_at) >= ?');
      params.push(filter.startDate);
    }

    // Filtrer par date de fin
    if (filter.endDate) {
      conditions.push('DATE(created_at) <= ?');
      params.push(filter.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Compter le total
    const countResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM logs ${whereClause}`,
      params
    );
    const total = countResult?.count || 0;

    // Pagination
    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    // Récupérer les logs
    const logs = await db.query<any>(
      `SELECT * FROM logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      logs: logs.map(log => ({
        id: log.id,
        level: log.level,
        category: log.category,
        message: log.message,
        details: log.details,
        userId: log.user_id,
        userEmail: log.user_email,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        requestPath: log.request_path,
        requestMethod: log.request_method,
        createdAt: log.created_at
      })),
      total
    };
  }

  public async getStats(): Promise<{
    totalLogs: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<LogCategory, number>;
    last24h: number;
    last7d: number;
    last30d: number;
  }> {
    const isSQLite = db.getType() === 'sqlite';

    // Total des logs
    const totalResult = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM logs');
    const totalLogs = totalResult?.count || 0;

    // Par niveau
    const levelStats = await db.query<{ level: LogLevel; count: number }>(
      'SELECT level, COUNT(*) as count FROM logs GROUP BY level'
    );
    const byLevel: Record<string, number> = {};
    for (const stat of levelStats) {
      byLevel[stat.level] = stat.count;
    }

    // Par catégorie
    const categoryStats = await db.query<{ category: LogCategory; count: number }>(
      'SELECT category, COUNT(*) as count FROM logs GROUP BY category'
    );
    const byCategory: Record<string, number> = {};
    for (const stat of categoryStats) {
      byCategory[stat.category] = stat.count;
    }

    // Dernières 24h
    const last24hResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM logs WHERE created_at >= datetime('now', '-1 day')`
    );
    const last24h = last24hResult?.count || 0;

    // Derniers 7 jours
    const last7dResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM logs WHERE created_at >= datetime('now', '-7 days')`
    );
    const last7d = last7dResult?.count || 0;

    // Derniers 30 jours
    const last30dResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM logs WHERE created_at >= datetime('now', '-30 days')`
    );
    const last30d = last30dResult?.count || 0;

    return {
      totalLogs,
      byLevel: byLevel as Record<LogLevel, number>,
      byCategory: byCategory as Record<LogCategory, number>,
      last24h,
      last7d,
      last30d
    };
  }

  public async exportLogs(filter: LogFilter = {}, format: 'json' | 'csv' = 'json'): Promise<string> {
    const { logs } = await this.getLogs({ ...filter, limit: this.settings.maxLogsPerExport, offset: 0 });

    if (format === 'csv') {
      const headers = ['ID', 'Date', 'Niveau', 'Catégorie', 'Message', 'Détails', 'Utilisateur', 'IP', 'Chemin', 'Méthode'];
      const rows = logs.map(log => [
        log.id,
        log.createdAt,
        log.level,
        log.category,
        `"${(log.message || '').replace(/"/g, '""')}"`,
        `"${(log.details || '').replace(/"/g, '""')}"`,
        log.userEmail || '',
        log.ipAddress || '',
        log.requestPath || '',
        log.requestMethod || ''
      ]);

      return [headers.join(';'), ...rows.map(row => row.join(';'))].join('\n');
    }

    return JSON.stringify(logs, null, 2);
  }

  public async deleteLogs(filter: LogFilter = {}): Promise<number> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      conditions.push(`level IN (${levels.map(() => '?').join(', ')})`);
      params.push(...levels);
    }

    if (filter.category) {
      const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
      conditions.push(`category IN (${categories.map(() => '?').join(', ')})`);
      params.push(...categories);
    }

    if (filter.startDate) {
      conditions.push('DATE(created_at) >= ?');
      params.push(filter.startDate);
    }

    if (filter.endDate) {
      conditions.push('DATE(created_at) <= ?');
      params.push(filter.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM logs ${whereClause}`,
      params
    );
    const count = countResult?.count || 0;

    if (count > 0) {
      await db.execute(`DELETE FROM logs ${whereClause}`, params);
    }

    return count;
  }

  public async deleteAllLogs(): Promise<number> {
    const countResult = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM logs');
    const count = countResult?.count || 0;

    if (count > 0) {
      await db.execute('DELETE FROM logs');
    }

    return count;
  }
}

export const logService = LogService.getInstance();
export default logService;
