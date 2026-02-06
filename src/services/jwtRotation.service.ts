import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../database';
import { logService } from './log.service';

/**
 * Service de rotation des secrets JWT
 * 
 * Ce service gère la rotation périodique des secrets JWT pour renforcer la sécurité.
 * Il supporte une période de grâce avec deux secrets actifs simultanément.
 */

export interface JwtSecret {
  id: number;
  secret: string;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
}

export interface JwtRotationSettings {
  rotationIntervalDays: number;    // Intervalle entre les rotations (défaut: 90 jours)
  gracePeriodHours: number;        // Période de grâce avec ancien secret (défaut: 24h)
  autoRotate: boolean;             // Rotation automatique activée
  lastRotation: string | null;     // Date de la dernière rotation
  nextRotation: string | null;     // Date de la prochaine rotation
}

const DEFAULT_SETTINGS: JwtRotationSettings = {
  rotationIntervalDays: 90,
  gracePeriodHours: 24,
  autoRotate: false, // Désactivé par défaut pour sécurité
  lastRotation: null,
  nextRotation: null
};

class JwtRotationService {
  private static instance: JwtRotationService;
  private settings: JwtRotationSettings = DEFAULT_SETTINGS;
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): JwtRotationService {
    if (!JwtRotationService.instance) {
      JwtRotationService.instance = new JwtRotationService();
    }
    return JwtRotationService.instance;
  }

  /**
   * Initialise le service de rotation JWT
   */
  public async init(): Promise<void> {
    if (this.initialized) return;

    await this.createTable();
    await this.loadSettings();
    this.initialized = true;

    await logService.info('security', 'Service de rotation JWT initialisé', {
      autoRotate: this.settings.autoRotate,
      rotationInterval: `${this.settings.rotationIntervalDays} jours`,
      lastRotation: this.settings.lastRotation,
      nextRotation: this.settings.nextRotation
    });
  }

  /**
   * Crée la table pour stocker les secrets JWT
   */
  private async createTable(): Promise<void> {
    const isSQLite = db.getType() === 'sqlite';
    const autoIncrement = isSQLite ? 'AUTOINCREMENT' : 'AUTO_INCREMENT';
    const timestampDefault = isSQLite ? "DEFAULT (datetime('now'))" : 'DEFAULT CURRENT_TIMESTAMP';

    await db.execute(`
      CREATE TABLE IF NOT EXISTS jwt_secrets (
        id INTEGER PRIMARY KEY ${autoIncrement},
        secret VARCHAR(255) NOT NULL,
        created_at DATETIME ${timestampDefault},
        expires_at DATETIME NOT NULL,
        is_active INTEGER DEFAULT 1,
        rotated_by INTEGER,
        rotation_reason VARCHAR(255)
      )
    `);
  }

  /**
   * Charge les paramètres depuis la base de données
   */
  private async loadSettings(): Promise<void> {
    try {
      const setting = await db.queryOne(
        "SELECT setting_value FROM settings WHERE setting_key = 'jwt_rotation_settings'"
      );

      if (setting) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(setting.setting_value) };
      } else {
        // Créer le paramètre par défaut
        await db.execute(
          "INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, 'json', ?)",
          ['jwt_rotation_settings', JSON.stringify(DEFAULT_SETTINGS), 'Configuration de la rotation des secrets JWT']
        );
      }
    } catch (error) {
      console.error('Erreur chargement paramètres JWT rotation:', error);
    }
  }

  /**
   * Sauvegarde les paramètres dans la base de données
   */
  private async saveSettings(): Promise<void> {
    await db.execute(
      "UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE setting_key = 'jwt_rotation_settings'",
      [JSON.stringify(this.settings)]
    );
  }

  /**
   * Génère un nouveau secret JWT cryptographiquement sécurisé
   */
  public generateSecret(length: number = 64): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Effectue une rotation du secret JWT
   */
  public async rotateSecret(userId?: number, reason?: string): Promise<{ success: boolean; newSecret?: string; message: string }> {
    try {
      // Générer un nouveau secret
      const newSecret = this.generateSecret();
      const now = new Date();
      const gracePeriodEnd = new Date(now.getTime() + this.settings.gracePeriodHours * 60 * 60 * 1000);
      const nextRotation = new Date(now.getTime() + this.settings.rotationIntervalDays * 24 * 60 * 60 * 1000);

      // Marquer l'ancien secret comme expirant bientôt (période de grâce)
      await db.execute(
        "UPDATE jwt_secrets SET expires_at = ? WHERE is_active = 1",
        [gracePeriodEnd.toISOString()]
      );

      // Insérer le nouveau secret
      await db.execute(
        "INSERT INTO jwt_secrets (secret, expires_at, is_active, rotated_by, rotation_reason) VALUES (?, ?, 1, ?, ?)",
        [newSecret, nextRotation.toISOString(), userId || null, reason || 'Rotation manuelle']
      );

      // Mettre à jour les paramètres
      this.settings.lastRotation = now.toISOString();
      this.settings.nextRotation = nextRotation.toISOString();
      await this.saveSettings();

      // Logger l'événement
      await logService.success('security', 'Rotation du secret JWT effectuée', {
        rotatedBy: userId,
        reason: reason || 'Rotation manuelle',
        gracePeriodEnd: gracePeriodEnd.toISOString(),
        nextRotation: nextRotation.toISOString()
      }, {
        userId: userId
      });

      // IMPORTANT: En production, ce secret doit être stocké de manière sécurisée
      // et le fichier .env doit être mis à jour
      return {
        success: true,
        newSecret,
        message: `Rotation effectuée. Nouveau secret généré. Période de grâce: ${this.settings.gracePeriodHours}h. IMPORTANT: Mettez à jour JWT_SECRET dans votre fichier .env`
      };
    } catch (error: any) {
      await logService.error('security', 'Erreur lors de la rotation du secret JWT', {
        error: error.message
      });
      return {
        success: false,
        message: `Erreur lors de la rotation: ${error.message}`
      };
    }
  }

  /**
   * Récupère les secrets actifs (pour la vérification des tokens pendant la période de grâce)
   */
  public async getActiveSecrets(): Promise<string[]> {
    try {
      const secrets = await db.queryAll<{ secret: string }>(
        "SELECT secret FROM jwt_secrets WHERE is_active = 1 AND expires_at > datetime('now') ORDER BY created_at DESC"
      );
      return secrets.map(s => s.secret);
    } catch (error) {
      // Fallback sur le secret de l'environnement
      return [process.env.JWT_SECRET || 'secret'];
    }
  }

  /**
   * Vérifie si une rotation est nécessaire
   */
  public async checkRotationNeeded(): Promise<boolean> {
    if (!this.settings.autoRotate) return false;
    if (!this.settings.nextRotation) return true;

    const nextRotation = new Date(this.settings.nextRotation);
    return new Date() >= nextRotation;
  }

  /**
   * Effectue une rotation automatique si nécessaire
   */
  public async autoRotateIfNeeded(): Promise<void> {
    if (await this.checkRotationNeeded()) {
      await this.rotateSecret(undefined, 'Rotation automatique programmée');
    }
  }

  /**
   * Nettoie les anciens secrets expirés
   */
  public async cleanupExpiredSecrets(): Promise<number> {
    try {
      const result = await db.execute(
        "DELETE FROM jwt_secrets WHERE expires_at < datetime('now', '-7 days')"
      );
      
      const deletedCount = result.changes || 0;
      if (deletedCount > 0) {
        await logService.info('security', 'Nettoyage des anciens secrets JWT', {
          deletedCount
        });
      }
      return deletedCount;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Obtient les paramètres actuels
   */
  public getSettings(): JwtRotationSettings {
    return { ...this.settings };
  }

  /**
   * Met à jour les paramètres
   */
  public async updateSettings(newSettings: Partial<JwtRotationSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };
    await this.saveSettings();

    await logService.info('security', 'Paramètres de rotation JWT mis à jour', {
      settings: this.settings
    });
  }

  /**
   * Obtient l'historique des rotations
   */
  public async getRotationHistory(limit: number = 10): Promise<any[]> {
    return db.queryAll(
      `SELECT id, created_at, expires_at, is_active, rotated_by, rotation_reason 
       FROM jwt_secrets 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * Génère un rapport de sécurité JWT
   */
  public async generateSecurityReport(): Promise<any> {
    const activeSecrets = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM jwt_secrets WHERE is_active = 1 AND expires_at > datetime('now')"
    );

    const expiredSecrets = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM jwt_secrets WHERE expires_at <= datetime('now')"
    );

    const lastRotation = await db.queryOne(
      "SELECT created_at FROM jwt_secrets ORDER BY created_at DESC LIMIT 1"
    );

    return {
      activeSecretsCount: activeSecrets?.count || 0,
      expiredSecretsCount: expiredSecrets?.count || 0,
      lastRotation: lastRotation?.created_at || this.settings.lastRotation,
      nextRotation: this.settings.nextRotation,
      autoRotateEnabled: this.settings.autoRotate,
      rotationIntervalDays: this.settings.rotationIntervalDays,
      gracePeriodHours: this.settings.gracePeriodHours,
      recommendations: this.getSecurityRecommendations()
    };
  }

  /**
   * Génère des recommandations de sécurité
   */
  private getSecurityRecommendations(): string[] {
    const recommendations: string[] = [];

    if (!this.settings.autoRotate) {
      recommendations.push('Envisagez d\'activer la rotation automatique des secrets JWT');
    }

    if (this.settings.rotationIntervalDays > 90) {
      recommendations.push('L\'intervalle de rotation (>90 jours) pourrait être réduit pour plus de sécurité');
    }

    if (this.settings.gracePeriodHours < 12) {
      recommendations.push('La période de grâce (<12h) pourrait être insuffisante pour les utilisateurs connectés');
    }

    if (this.settings.gracePeriodHours > 48) {
      recommendations.push('La période de grâce (>48h) est longue, considérez la réduire');
    }

    if (process.env.JWT_SECRET === 'secret' || !process.env.JWT_SECRET) {
      recommendations.push('CRITIQUE: Définissez un JWT_SECRET fort dans votre fichier .env');
    }

    return recommendations;
  }
}

export const jwtRotationService = JwtRotationService.getInstance();
