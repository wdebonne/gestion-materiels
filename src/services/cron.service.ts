import cron from 'node-cron';
import { db } from '../database';
import { sendAlertEmail, sendEmailRaw } from './email.service';
import { emitAlert } from './websocket.service';

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
export async function checkAlerts(): Promise<void> {
  try {
    // Récupérer les paramètres d'alerte configurés
    const alertSettings = await getAlertSettings();

    // Vérifier les contrôles techniques arrivant à échéance (à venir dans les X jours OU expirés)
    const technicalControls = await db.query(
      `SELECT tc.*, o.name as object_name FROM technical_controls tc
       INNER JOIN objects o ON o.id = tc.object_id
       WHERE (
         (tc.reminder_sent = 0 AND date(tc.expiry_date) <= date('now', '+${alertSettings.technical_control.days} days') AND date(tc.expiry_date) >= date('now'))
         OR date(tc.expiry_date) < date('now')
       )`
    );

    for (const tc of technicalControls) {
      // Créer ou mettre à jour l'alerte
      const existingAlert = await db.queryOne(
        "SELECT id FROM alerts WHERE plugin_reference = 'technical-control' AND plugin_reference_id = ? AND is_dismissed = 0",
        [tc.id]
      );

      const daysUntilExpiry = Math.ceil(
        (new Date(tc.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const isExpired = daysUntilExpiry < 0;
      const severity = isExpired ? 'critical' : priorityToSeverity(alertSettings.technical_control.priority, daysUntilExpiry);
      const message = isExpired
        ? `Le contrôle technique a expiré le ${tc.expiry_date}`
        : `Le contrôle technique expire le ${tc.expiry_date}`;

      if (!existingAlert) {
        const alertResult = await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Contrôle technique: ${tc.object_name}`,
            message,
            'technical_control',
            severity,
            tc.object_id,
            'technical-control',
            tc.id,
            tc.expiry_date
          ]
        );

        // Notifier les clients connectés en temps réel
        emitAlert({
          id: alertResult.lastInsertRowid,
          title: `Contrôle technique: ${tc.object_name}`,
          message,
          alertType: 'technical_control',
          severity
        });

        // Envoyer l'email d'alerte
        try {
          await sendAlertEmail(alertResult.lastInsertRowid);
          await db.execute('UPDATE technical_controls SET reminder_sent = 1 WHERE id = ?', [tc.id]);
        } catch (error) {
          console.error('Erreur envoi email alerte CT:', error);
        }
      } else {
        // Mettre à jour la sévérité et le message
        await db.execute(
          'UPDATE alerts SET severity = ?, message = ? WHERE id = ?',
          [severity, message, existingAlert.id]
        );
      }
    }

    // Vérifier les maintenances programmées (à venir dans les X jours OU en retard)
    const maintenances = await db.query(
      `SELECT m.*, o.name as object_name FROM maintenances m
       INNER JOIN objects o ON o.id = m.object_id
       WHERE m.next_date IS NOT NULL
       AND (
         (m.reminder_sent = 0 AND date(m.next_date) <= date('now', '+${alertSettings.maintenance.days} days') AND date(m.next_date) >= date('now'))
         OR date(m.next_date) < date('now')
       )`
    );

    for (const m of maintenances) {
      const existingAlert = await db.queryOne(
        "SELECT id FROM alerts WHERE plugin_reference = 'maintenance' AND plugin_reference_id = ? AND is_dismissed = 0",
        [m.id]
      );

      const daysUntilDue = Math.ceil(
        (new Date(m.next_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const isOverdue = daysUntilDue < 0;
      const severity = isOverdue ? 'critical' : priorityToSeverity(alertSettings.maintenance.priority, daysUntilDue);
      const message = isOverdue 
        ? `${m.maintenance_type} en retard depuis le ${m.next_date}` 
        : `${m.maintenance_type} prévue le ${m.next_date}`;

      if (!existingAlert) {
        const alertResult = await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Maintenance: ${m.object_name}`,
            message,
            'maintenance',
            severity,
            m.object_id,
            'maintenance',
            m.id,
            m.next_date
          ]
        );

        // Notifier les clients connectés en temps réel
        emitAlert({
          id: alertResult.lastInsertRowid,
          title: `Maintenance: ${m.object_name}`,
          message,
          alertType: 'maintenance',
          severity
        });

        try {
          await sendAlertEmail(alertResult.lastInsertRowid);
          await db.execute('UPDATE maintenances SET reminder_sent = 1 WHERE id = ?', [m.id]);
        } catch (error) {
          console.error('Erreur envoi email alerte maintenance:', error);
        }
      } else if (isOverdue) {
        // Mettre à jour l'alerte existante si en retard
        await db.execute(
          'UPDATE alerts SET severity = ?, message = ? WHERE id = ?',
          [severity, message, existingAlert.id]
        );
      }
    }

    // Vérifier les événements du calendrier avec rappel
    const now = new Date().toISOString();

    // ======= Vérifier les entretiens espaces verts programmés =======
    const greenSpaceMaintenances = await db.query(
      `SELECT gsm.*, gs.name as space_name FROM green_space_maintenances gsm
       INNER JOIN green_spaces gs ON gs.id = gsm.green_space_id
       WHERE gsm.next_maintenance_date IS NOT NULL
       AND (
         (date(gsm.next_maintenance_date) <= date('now', '+${alertSettings.maintenance.days} days') AND date(gsm.next_maintenance_date) >= date('now'))
         OR date(gsm.next_maintenance_date) < date('now')
       )`
    );

    for (const gsm of greenSpaceMaintenances) {
      const existingAlert = await db.queryOne(
        "SELECT id FROM alerts WHERE plugin_reference = 'green-space-maintenance' AND plugin_reference_id = ? AND is_dismissed = 0",
        [gsm.id]
      );

      const daysUntilDue = Math.ceil(
        (new Date(gsm.next_maintenance_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const isOverdue = daysUntilDue < 0;
      const severity = isOverdue ? 'critical' : priorityToSeverity(alertSettings.maintenance.priority, daysUntilDue);
      const message = isOverdue
        ? `Entretien "${gsm.maintenance_type}" en retard depuis le ${gsm.next_maintenance_date}`
        : `Entretien "${gsm.maintenance_type}" prévu le ${gsm.next_maintenance_date}`;

      if (!existingAlert) {
        const alertResult = await db.execute(
          `INSERT INTO alerts (title, message, alert_type, severity, plugin_reference, plugin_reference_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            `Espace vert - ${gsm.space_name}: ${gsm.maintenance_type}`,
            message,
            'maintenance',
            severity,
            'green-space-maintenance',
            gsm.id,
            gsm.next_maintenance_date
          ]
        );

        // Notifier les clients connectés en temps réel
        emitAlert({
          id: alertResult.lastInsertRowid,
          title: `Espace vert - ${gsm.space_name}: ${gsm.maintenance_type}`,
          message,
          alertType: 'maintenance',
          severity
        });
      } else if (isOverdue) {
        await db.execute(
          'UPDATE alerts SET severity = ?, message = ? WHERE id = ?',
          [severity, message, existingAlert.id]
        );
      }
    }

    // Vérifier les événements du calendrier avec rappel
    const isSQLite = db.getType() === 'sqlite';
    const dateSubExpr = isSQLite
      ? "datetime(ce.start_date, '-' || ce.reminder_before || ' minutes')"
      : "DATE_SUB(ce.start_date, INTERVAL ce.reminder_before MINUTE)";
    const events = await db.query(
      `SELECT ce.*, o.name as object_name FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ce.reminder_sent = 0 AND ce.reminder_before > 0
       AND ${dateSubExpr} <= ?
       AND ce.start_date > ?`,
      [now, now]
    );

    for (const event of events) {
      const eventMessage =
        event.description || `Événement prévu le ${new Date(event.start_date).toLocaleString('fr-FR')}`;

      // Créer une alerte pour l'événement
      const alertResult = await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `Rappel: ${event.title}`,
          eventMessage,
          'calendar',
          'info',
          event.object_id,
          event.start_date
        ]
      );

      // Notifier les clients connectés en temps réel
      emitAlert({
        id: alertResult.lastInsertRowid,
        title: `Rappel: ${event.title}`,
        message: eventMessage,
        alertType: 'calendar',
        severity: 'info'
      });

      await db.execute('UPDATE calendar_events SET reminder_sent = 1 WHERE id = ?', [event.id]);
    }

    console.log(`✅ Vérification des alertes terminée: ${technicalControls.length} CT, ${maintenances.length} maintenances, ${greenSpaceMaintenances.length} espaces verts, ${events.length} événements`);
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

  // Vérification des réservations en retard (tous les jours à 8h)
  cron.schedule('0 8 * * *', checkOverdueReservations);

  // Rapport hebdomadaire le lundi à 7h
  cron.schedule('0 7 * * 1', generateWeeklyReport);

  // Exécuter une première vérification au démarrage
  setTimeout(checkAlerts, 10000);

  console.log('📅 Tâches cron initialisées');
}

// Vérifier les réservations en retard
async function checkOverdueReservations(): Promise<void> {
  try {
    const now = new Date().toISOString();
    
    // Marquer les réservations dont la date de fin est passée et qui sont encore "borrowed"
    const overdueReservations = await db.query(
      `SELECT r.id, r.object_id, o.name as object_name, u.email, u.first_name, u.last_name
       FROM reservations r
       LEFT JOIN objects o ON r.object_id = o.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.status = 'borrowed' AND r.end_date < ?`,
      [now]
    );

    for (const res of overdueReservations) {
      await db.execute(
        `UPDATE reservations SET status = 'overdue', updated_at = ? WHERE id = ?`,
        [now, res.id]
      );

      // Créer une alerte
      const overdueMessage = `Le matériel "${res.object_name}" emprunté par ${res.first_name} ${res.last_name} n'a pas été retourné.`;
      const alertResult = await db.execute(
        `INSERT INTO alerts (title, message, alert_type, severity, object_id, created_at)
         VALUES (?, ?, 'reservation_overdue', 'warning', ?, ?)`,
        [
          `Retour en retard: ${res.object_name}`,
          overdueMessage,
          res.object_id,
          now
        ]
      );

      // Notifier les clients connectés en temps réel
      emitAlert({
        id: alertResult.lastInsertRowid,
        title: `Retour en retard: ${res.object_name}`,
        message: overdueMessage,
        alertType: 'reservation_overdue',
        severity: 'warning'
      });
    }

    if (overdueReservations.length > 0) {
      console.log(`⚠️ ${overdueReservations.length} réservation(s) marquée(s) en retard`);
    }
  } catch (error) {
    console.error('Erreur vérification réservations:', error);
  }
}

// Générer un rapport hebdomadaire
async function generateWeeklyReport(): Promise<void> {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weekAgoStr = oneWeekAgo.toISOString();

    // Statistiques de la semaine
    const totalObjects = await db.queryOne('SELECT COUNT(*) as count FROM objects');
    const newObjects = await db.queryOne('SELECT COUNT(*) as count FROM objects WHERE created_at >= ?', [weekAgoStr]);
    const activeAlerts = await db.queryOne("SELECT COUNT(*) as count FROM alerts WHERE status = 'active'");
    const newAlerts = await db.queryOne('SELECT COUNT(*) as count FROM alerts WHERE created_at >= ?', [weekAgoStr]);
    const overdueReservations = await db.queryOne("SELECT COUNT(*) as count FROM reservations WHERE status = 'overdue'");
    const activeReservations = await db.queryOne("SELECT COUNT(*) as count FROM reservations WHERE status IN ('reserved', 'borrowed')");

    const siteNameSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_name'");
    const siteName = siteNameSetting?.setting_value || 'Gestion Matériels';

    const reportDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #0284c7; border-bottom: 2px solid #0284c7; padding-bottom: 10px;">📊 Rapport Hebdomadaire</h1>
        <p style="color: #6b7280; font-size: 14px;">${siteName} — ${reportDate}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f0f9ff;">
            <td style="padding: 12px; border: 1px solid #e0f2fe; font-weight: bold;">Total matériels</td>
            <td style="padding: 12px; border: 1px solid #e0f2fe; text-align: right;">${totalObjects?.count || 0}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Nouveaux cette semaine</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; color: #059669;">${newObjects?.count || 0}</td>
          </tr>
          <tr style="background: #f0f9ff;">
            <td style="padding: 12px; border: 1px solid #e0f2fe; font-weight: bold;">Alertes actives</td>
            <td style="padding: 12px; border: 1px solid #e0f2fe; text-align: right; color: ${(activeAlerts?.count || 0) > 0 ? '#dc2626' : '#059669'};">${activeAlerts?.count || 0}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Nouvelles alertes cette semaine</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${newAlerts?.count || 0}</td>
          </tr>
          <tr style="background: #f0f9ff;">
            <td style="padding: 12px; border: 1px solid #e0f2fe; font-weight: bold;">Réservations actives</td>
            <td style="padding: 12px; border: 1px solid #e0f2fe; text-align: right;">${activeReservations?.count || 0}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Réservations en retard</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; color: ${(overdueReservations?.count || 0) > 0 ? '#dc2626' : '#059669'};">${overdueReservations?.count || 0}</td>
          </tr>
        </table>

        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">Ce rapport est généré automatiquement chaque lundi matin.</p>
      </div>
    `;

    // Envoyer aux admins et superviseurs
    const users = await db.query(
      "SELECT email FROM users WHERE role IN ('admin', 'supervisor') AND is_active = 1"
    );

    for (const user of users) {
      try {
        await sendEmailRaw({
          to: user.email,
          subject: `📊 Rapport hebdomadaire — ${siteName}`,
          html
        });
      } catch (err) {
        console.error(`Erreur envoi rapport à ${user.email}:`, err);
      }
    }

    console.log(`📊 Rapport hebdomadaire envoyé à ${users.length} destinataire(s)`);
  } catch (error) {
    console.error('Erreur génération rapport hebdomadaire:', error);
  }
}

export default { initCronJobs, checkAlerts, autoBackup, checkOverdueReservations, generateWeeklyReport };
