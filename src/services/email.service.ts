import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { db } from '../database';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

// Créer le transporteur SMTP
async function createTransporter() {
  const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

  if (!smtp) {
    throw new Error('Configuration SMTP non trouvée ou inactive');
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure,
    auth: {
      user: smtp.username,
      pass: smtp.password
    }
  });
}

// Envoyer un email
export async function sendEmailRaw(options: EmailOptions): Promise<void> {
  const transporter = await createTransporter();
  const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

  await transporter.sendMail({
    from: `"${smtp.from_name || 'Gestion Matériels'}" <${smtp.from_email}>`,
    to: options.to,
    subject: options.subject,
    html: options.html
  });
}

// Envoyer un email avec un template
export async function sendEmail(templateName: string, to: string, data: Record<string, any>): Promise<void> {
  // Récupérer le template
  const template = await db.queryOne(
    'SELECT * FROM email_templates WHERE name = ? AND is_active = 1',
    [templateName]
  );

  if (!template) {
    throw new Error(`Template "${templateName}" non trouvé ou inactif`);
  }

  // Récupérer les paramètres du site
  const siteNameSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_name'");
  const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");

  // Ajouter les variables par défaut
  const templateData = {
    site_name: siteNameSetting?.setting_value || 'Gestion Matériels',
    site_url: siteUrlSetting?.setting_value || 'http://localhost:3000',
    year: new Date().getFullYear(),
    ...data
  };

  // Compiler le template
  const compiledSubject = Handlebars.compile(template.subject)(templateData);
  const compiledBody = Handlebars.compile(template.body)(templateData);

  // Envoyer l'email
  await sendEmailRaw({
    to,
    subject: compiledSubject,
    html: compiledBody
  });
}

// Envoyer un email de test
export async function sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = await createTransporter();
    const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

    // Vérifier la connexion
    await transporter.verify();

    // Envoyer un email de test
    await transporter.sendMail({
      from: `"${smtp.from_name || 'Gestion Matériels'}" <${smtp.from_email}>`,
      to,
      subject: 'Test de configuration SMTP - Gestion Matériels',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h1 style="color: #3b82f6;">✅ Configuration SMTP réussie</h1>
          <p>Ceci est un email de test envoyé depuis l'application Gestion Matériels.</p>
          <p>Votre configuration SMTP fonctionne correctement.</p>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            Email envoyé le ${new Date().toLocaleString('fr-FR')}
          </p>
        </div>
      `
    });

    return { success: true };
  } catch (error: any) {
    console.error('Erreur test SMTP:', error);
    return { success: false, error: error.message };
  }
}

// Envoyer une alerte par email
export async function sendAlertEmail(alertId: number): Promise<void> {
  const alert = await db.queryOne(
    `SELECT a.*, o.name as object_name FROM alerts a
     LEFT JOIN objects o ON o.id = a.object_id
     WHERE a.id = ?`,
    [alertId]
  );

  if (!alert) {
    throw new Error('Alerte non trouvée');
  }

  // Récupérer les utilisateurs admin et superviseurs
  const users = await db.query(
    "SELECT email FROM users WHERE role IN ('admin', 'supervisor') AND is_active = 1"
  );

  for (const user of users) {
    try {
      await sendEmail('alert_notification', user.email, {
        alert_title: alert.title,
        alert_message: alert.message,
        object_name: alert.object_name || 'N/A',
        object_id: alert.object_id || '',
        due_date: alert.due_date ? new Date(alert.due_date).toLocaleDateString('fr-FR') : 'N/A'
      });
    } catch (error) {
      console.error(`Erreur envoi email alerte à ${user.email}:`, error);
    }
  }
}

// Envoyer une sauvegarde par email avec pièce jointe
export async function sendBackupEmail(to: string, backupFilePath: string, backupFilename: string): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = await createTransporter();
    const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

    // Récupérer le template
    const template = await db.queryOne(
      'SELECT * FROM email_templates WHERE name = ? AND is_active = 1',
      ['backup_notification']
    );

    // Récupérer les paramètres du site
    const siteNameSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_name'");
    const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");

    const templateData = {
      site_name: siteNameSetting?.setting_value || 'Gestion Matériels',
      site_url: siteUrlSetting?.setting_value || 'http://localhost:3000',
      year: new Date().getFullYear(),
      backup_filename: backupFilename,
      backup_date: new Date().toLocaleString('fr-FR'),
      backup_size: formatFileSize(require('fs').statSync(backupFilePath).size)
    };

    let subject = 'Sauvegarde - {{site_name}}';
    let html = `<p>Veuillez trouver ci-joint la sauvegarde de ${templateData.site_name}</p>`;

    if (template) {
      const Handlebars = require('handlebars');
      subject = Handlebars.compile(template.subject)(templateData);
      html = Handlebars.compile(template.body)(templateData);
    }

    await transporter.sendMail({
      from: `"${smtp.from_name || 'Gestion Matériels'}" <${smtp.from_email}>`,
      to,
      subject,
      html,
      attachments: [
        {
          filename: backupFilename,
          path: backupFilePath
        }
      ]
    });

    return { success: true };
  } catch (error: any) {
    console.error('Erreur envoi backup par email:', error);
    return { success: false, error: error.message };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default {
  sendEmail,
  sendEmailRaw,
  sendTestEmail,
  sendAlertEmail,
  sendBackupEmail
};
