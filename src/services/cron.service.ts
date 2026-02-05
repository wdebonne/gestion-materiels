import cron from 'node-cron';
import { db } from '../database';
import { sendAlertEmail } from './email.service';

// Récupérer les paramètres d'alertes
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

// Convertir la priorité en sévérité
function priorityToSeverity(priority: string, daysUntilExpiry: number): string {
  // Si très proche de l'échéance, toujours critique
  if (daysUntilExpiry <= 7) return 'critical';
  if (daysUntilExpiry <= 15) return 'warning';
  
  // Sinon, utiliser la priorité configurée
  switch (priority) {
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'info';
  }
}

// Vérifier les alertes à envoyer
async function checkAlerts(): Promise<void> {
  try {
    // Récupérer les paramètres d'alerte configurés
    const alertSettings = await getAlertSettings();

    // Vérifier les contrôles techniques arrivant à échéance
    const technicalControls = await db.query(
      `SELECT tc.*, o.name as object_name FROM technical_controls tc
       INNER JOIN objects o ON o.id = tc.object_id
       WHERE tc.reminder_sent = 0 
       AND date(tc.expiry_date) <= date('now', '+${alertSettings.technical_control.days} days')
       AND date(tc.expiry_date) >= date('now')`
    );

    for (const tc of technicalControls) {
      // Créer ou mettre à jour l'alerte
      const existingAlert = await db.queryOne(
        "SELECT id FROM alerts WHERE plugin_reference = 'technical-control' AND plugin_reference_id = ?",
        [tc.id]
      );

      const daysUntilExpiry = Math.ceil(
        (new Date(tc.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const severity = priorityToSeverity(alertSettings.technical_control.priority, daysUntilExpiry);

      if (!existingAlert) {
        const alertResult = await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Contrôle technique: ${tc.object_name}`,
            `Le contrôle technique expire le ${tc.expiry_date}`,
            'technical_control',
            severity,
            tc.object_id,
            'technical-control',
            tc.id,
            tc.expiry_date
          ]
        );

        // Envoyer l'email d'alerte
        try {
          await sendAlertEmail(alertResult.lastInsertRowid);
          await db.execute('UPDATE technical_controls SET reminder_sent = 1 WHERE id = ?', [tc.id]);
        } catch (error) {
          console.error('Erreur envoi email alerte CT:', error);
        }
      } else {
        // Mettre à jour la sévérité
        await db.execute(
          'UPDATE alerts SET severity = ?, message = ? WHERE id = ?',
          [severity, `Le contrôle technique expire le ${tc.expiry_date}`, existingAlert.id]
        );
      }
    }

    // Vérifier les maintenances programmées
    const maintenances = await db.query(
      `SELECT m.*, o.name as object_name FROM maintenances m
       INNER JOIN objects o ON o.id = m.object_id
       WHERE m.reminder_sent = 0 AND m.next_date IS NOT NULL
       AND date(m.next_date) <= date('now', '+${alertSettings.maintenance.days} days')
       AND date(m.next_date) >= date('now')`
    );

    for (const m of maintenances) {
      const existingAlert = await db.queryOne(
        "SELECT id FROM alerts WHERE plugin_reference = 'maintenance' AND plugin_reference_id = ?",
        [m.id]
      );

      const daysUntilDue = Math.ceil(
        (new Date(m.next_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const severity = priorityToSeverity(alertSettings.maintenance.priority, daysUntilDue);

      if (!existingAlert) {
        const alertResult = await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Maintenance: ${m.object_name}`,
            `${m.maintenance_type} prévue le ${m.next_date}`,
            'maintenance',
            severity,
            m.object_id,
            'maintenance',
            m.id,
            m.next_date
          ]
        );

        try {
          await sendAlertEmail(alertResult.lastInsertRowid);
          await db.execute('UPDATE maintenances SET reminder_sent = 1 WHERE id = ?', [m.id]);
        } catch (error) {
          console.error('Erreur envoi email alerte maintenance:', error);
        }
      }
    }

    // Vérifier les événements du calendrier avec rappel
    const events = await db.query(
      `SELECT ce.*, o.name as object_name FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ce.reminder_sent = 0 AND ce.reminder_before > 0
       AND datetime(ce.start_date, '-' || ce.reminder_before || ' minutes') <= datetime('now')
       AND datetime(ce.start_date) > datetime('now')`
    );

    for (const event of events) {
      // Créer une alerte pour l'événement
      await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `Rappel: ${event.title}`,
          event.description || `Événement prévu le ${new Date(event.start_date).toLocaleString('fr-FR')}`,
          'calendar',
          'info',
          event.object_id,
          event.start_date
        ]
      );

      await db.execute('UPDATE calendar_events SET reminder_sent = 1 WHERE id = ?', [event.id]);
    }

    console.log(`✅ Vérification des alertes terminée: ${technicalControls.length} CT, ${maintenances.length} maintenances, ${events.length} événements`);
  } catch (error) {
    console.error('❌ Erreur lors de la vérification des alertes:', error);
  }
}

// Créer une sauvegarde automatique
async function autoBackup(): Promise<void> {
  try {
    const autoBackupSetting = await db.queryOne(
      "SELECT setting_value FROM settings WHERE setting_key = 'auto_backup'"
    );

    if (autoBackupSetting?.setting_value !== 'true') {
      return;
    }

    // Importer dynamiquement pour éviter les dépendances circulaires
    const { Router } = await import('express');
    const fs = await import('fs');
    const path = await import('path');
    const archiver = await import('archiver');
    const { v4: uuidv4 } = await import('uuid');

    const BACKUP_DIR = './backups';
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-auto-${timestamp}-${uuidv4().substring(0, 8)}.zip`;
    const filePath = path.join(BACKUP_DIR, filename);

    const output = fs.createWriteStream(filePath);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // Ajouter la base de données
    const dbType = db.getType();
    if (dbType === 'sqlite') {
      const dbPath = process.env.DB_PATH || './data/database.sqlite';
      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'database.sqlite' });
      }
    }

    // Ajouter les uploads
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (fs.existsSync(uploadDir)) {
      archive.directory(uploadDir, 'uploads');
    }

    archive.append(JSON.stringify({
      version: process.env.SITE_VERSION || '1.0.0',
      createdAt: new Date().toISOString(),
      dbType,
      type: 'auto'
    }, null, 2), { name: 'backup-info.json' });

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    const stats = fs.statSync(filePath);

    await db.execute(
      'INSERT INTO backups (filename, file_path, file_size, backup_type, status) VALUES (?, ?, ?, ?, ?)',
      [filename, filePath, stats.size, 'auto', 'completed']
    );

    // Supprimer les anciennes sauvegardes automatiques (garder les 10 dernières)
    const oldBackups = await db.query(
      `SELECT * FROM backups WHERE backup_type = 'auto' ORDER BY created_at DESC LIMIT -1 OFFSET 10`
    );

    for (const backup of oldBackups) {
      if (fs.existsSync(backup.file_path)) {
        fs.unlinkSync(backup.file_path);
      }
      await db.execute('DELETE FROM backups WHERE id = ?', [backup.id]);
    }

    console.log(`✅ Sauvegarde automatique créée: ${filename}`);
  } catch (error) {
    console.error('❌ Erreur sauvegarde automatique:', error);
  }
}

// Initialiser les tâches cron
export function initCronJobs(): void {
  // Vérifier les alertes toutes les heures
  cron.schedule('0 * * * *', checkAlerts);

  // Sauvegarde automatique quotidienne à 2h du matin
  cron.schedule('0 2 * * *', autoBackup);

  // Exécuter une première vérification au démarrage
  setTimeout(checkAlerts, 10000);

  console.log('📅 Tâches cron initialisées');
}

export default { initCronJobs, checkAlerts, autoBackup };
