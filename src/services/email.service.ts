import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { db } from '../database';

/**
 * Une pièce jointe se désigne par un chemin sur le disque.
 *
 * Sert aux documents de service produits pour une manifestation : le service
 * qui doit approuver reçoit sa part remplie en pièce jointe, plutôt qu'un lien
 * qui l'obligerait à se connecter pour savoir de quoi il s'agit.
 */
interface PieceJointe {
  filename: string;
  path: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: PieceJointe[];
  /**
   * Envoi demandé par la personne elle-même — mot de passe oublié, compte
   * créé : il part même quand les envois automatiques sont suspendus.
   */
  essentiel?: boolean;
}

/**
 * Réglage qui suspend les envois automatiques.
 *
 * Trois valeurs : `false` (les envois partent), `manuel` (suspendus par un
 * administrateur), `donnees_test` (suspendus par le chargement du jeu de test,
 * et rétablis par sa purge). Un jeu de test compte des milliers de tickets dont
 * l'échéance est déjà dépassée : sans cette suspension, la vérification des
 * échéances les signalait tous au premier passage, y compris aux vrais
 * administrateurs désignés par les règles de diffusion.
 */
export const CLE_SUSPENSION = 'emails_suspendus';
export type EtatSuspension = 'manuel' | 'donnees_test';

/** Gabarits qui partent toujours : la personne les attend, elle vient de les demander. */
const GABARITS_ESSENTIELS = new Set(['password_reset', 'welcome']);

/**
 * Domaines réservés aux essais (RFC 2606 et 6761) : aucun courrier n'y est
 * jamais remis. Les comptes du jeu de test sont en `@charge.test` ; tenter de
 * leur écrire ne produit qu'une erreur par destinataire dans les journaux.
 */
const DOMAINE_RESERVE = /@(?:[^@\s]+\.)?(?:[^@.\s]+\.(?:test|example|invalid|localhost)|example\.(?:com|net|org))$/i;

export function adresseReservee(adresse: string): boolean {
  return DOMAINE_RESERVE.test(adresse.trim());
}

export async function etatSuspension(): Promise<EtatSuspension | null> {
  const ligne = await db.queryOne<{ setting_value: string }>(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    [CLE_SUSPENSION]
  );
  const valeur = ligne?.setting_value;
  return valeur === 'manuel' || valeur === 'donnees_test' ? valeur : null;
}

export async function definirSuspension(etat: EtatSuspension | null): Promise<void> {
  const valeur = etat ?? 'false';
  const deja = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [CLE_SUSPENSION]);
  if (deja) {
    await db.execute('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [valeur, CLE_SUSPENSION]);
  } else {
    await db.execute(
      'INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, ?, ?)',
      [CLE_SUSPENSION, valeur, 'string', 'Suspend les envois automatiques d’e-mails (false, manuel, donnees_test).']
    );
  }
}

// Un courrier retenu n'est pas une erreur : on le compte, et on le dit de temps
// en temps plutôt qu'une ligne de journal par destinataire.
let retenus = 0;
let dernierBilan = 0;
function compterRetenu(): void {
  retenus++;
  if (Date.now() - dernierBilan > 5 * 60_000) {
    console.info(`✉️  ${retenus} e-mail(s) automatique(s) retenu(s) : envois suspendus.`);
    dernierBilan = Date.now();
    retenus = 0;
  }
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
  const destinataires = options.to
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a && !adresseReservee(a));
  if (destinataires.length === 0) return;

  if (!options.essentiel && (await etatSuspension())) {
    compterRetenu();
    return;
  }

  const transporter = await createTransporter();
  const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

  await transporter.sendMail({
    from: `"${smtp.from_name || 'Gestion Matériels'}" <${smtp.from_email}>`,
    to: destinataires.join(', '),
    subject: options.subject,
    html: options.html,
    // Omise quand il n'y en a pas : nodemailer accepte un tableau vide, mais
    // certains serveurs alourdissent alors le message d'un corps multipart.
    ...(options.attachments?.length ? { attachments: options.attachments } : {})
  });
}

// Envoyer un email avec un template
export async function sendEmail(
  templateName: string,
  to: string,
  data: Record<string, any>,
  attachments?: PieceJointe[]
): Promise<void> {
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
    html: compiledBody,
    attachments,
    essentiel: GABARITS_ESSENTIELS.has(templateName)
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
/**
 * Destinataires d'une alerte.
 *
 * Les responsables reçoivent tout, comme avant. S'y ajoutent les agents dont
 * le périmètre couvre la catégorie du matériel concerné : ce sont eux qui
 * feront le geste. Le périmètre est celui accordé dans l'écran Droits, seul
 * rattachement explicite dont dispose l'application (les interventions
 * n'enregistrent pas leur auteur).
 */
async function destinatairesAlerte(categorieId: number | null): Promise<string[]> {
  // Sans matériel rattaché (alerte manuelle, rappel de calendrier), il n'y a
  // pas de périmètre à déduire : on s'en tient aux responsables.
  if (categorieId === null || categorieId === undefined) {
    const responsables = await db.query(
      `SELECT email FROM users
       WHERE role IN ('admin', 'supervisor')
         AND is_active = 1 AND can_login = 1 AND email IS NOT NULL`
    );
    return responsables.map((u: any) => u.email);
  }

  const users = await db.query(
    `SELECT DISTINCT u.email FROM users u
     WHERE u.is_active = 1
       AND u.can_login = 1
       AND u.email IS NOT NULL
       AND (
         u.role IN ('admin', 'supervisor')
         OR EXISTS (
           SELECT 1 FROM group_permissions gp
           WHERE gp.role = u.role AND gp.category_id = ? AND gp.can_view = 1
         )
         OR EXISTS (
           SELECT 1 FROM user_permissions up
           WHERE up.user_id = u.id AND up.category_id = ? AND up.can_view = 1
         )
       )`,
    [categorieId, categorieId]
  );

  return users.map((u: any) => u.email);
}

// Envoyer une alerte par email
export async function sendAlertEmail(alertId: number): Promise<void> {
  const alert = await db.queryOne(
    `SELECT a.*, o.name as object_name,
            COALESCE(o.category_id, sc.category_id) as categorie_id
     FROM alerts a
     LEFT JOIN objects o ON o.id = a.object_id
     LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
     WHERE a.id = ?`,
    [alertId]
  );

  if (!alert) {
    throw new Error('Alerte non trouvée');
  }

  const emails = await destinatairesAlerte(alert.categorie_id ?? null);

  if (emails.length === 0) {
    console.warn(`Alerte ${alertId} : aucun destinataire — vérifiez les droits de catégorie.`);
    return;
  }

  let envoyes = 0;
  for (const email of emails) {
    try {
      await sendEmail('alert_notification', email, {
        alert_title: alert.title,
        alert_message: alert.message,
        object_name: alert.object_name || 'N/A',
        object_id: alert.object_id || '',
        due_date: alert.due_date ? new Date(alert.due_date).toLocaleDateString('fr-FR') : 'N/A'
      });
      envoyes++;
    } catch (error: any) {
      // SMTP non configuré : le dire une fois, clairement, plutôt que de
      // répéter la même erreur pour chaque destinataire. Sans ce message,
      // l'absence d'e-mail passe totalement inaperçue.
      if (/SMTP/i.test(error?.message ?? '')) {
        console.warn(
          `Alerte ${alertId} : aucun e-mail envoyé — le serveur SMTP n'est pas configuré ` +
          `(Paramètres › SMTP). ${emails.length} destinataire(s) concerné(s).`
        );
        return;
      }
      console.error(`Erreur envoi email alerte à ${email}:`, error);
    }
  }

  console.log(`Alerte ${alertId} : ${envoyes}/${emails.length} e-mail(s) envoyé(s)`);
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

// Envoyer un lien de téléchargement de sauvegarde par email (pour les gros fichiers)
export async function sendBackupDownloadLink(
  to: string, 
  downloadLink: string, 
  backupFilename: string, 
  fileSize: number,
  expiresAt: Date
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = await createTransporter();
    const smtp = await db.queryOne('SELECT * FROM smtp_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

    // Récupérer les paramètres du site
    const siteNameSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_name'");
    const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");

    const siteName = siteNameSetting?.setting_value || 'Gestion Matériels';
    const siteUrl = siteUrlSetting?.setting_value || 'http://localhost:3000';
    const formattedSize = formatFileSize(fileSize);
    const expiresFormatted = expiresAt.toLocaleDateString('fr-FR', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const subject = `Lien de téléchargement - Sauvegarde ${siteName}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .file-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .file-info h3 { margin: 0 0 10px 0; color: #1e40af; }
          .file-info p { margin: 5px 0; color: #64748b; }
          .download-btn { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
          .download-btn:hover { background: linear-gradient(135deg, #059669 0%, #047857 100%); }
          .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0; color: #92400e; }
          .warning strong { color: #78350f; }
          .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; color: #64748b; font-size: 12px; }
          .link-text { background: #f1f5f9; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📦 Sauvegarde disponible</h1>
          </div>
          <div class="content">
            <p>Bonjour,</p>
            <p>Une sauvegarde de votre site <strong>${siteName}</strong> est disponible au téléchargement.</p>
            
            <div class="file-info">
              <h3>📁 Informations du fichier</h3>
              <p><strong>Nom :</strong> ${backupFilename}</p>
              <p><strong>Taille :</strong> ${formattedSize}</p>
              <p><strong>Date :</strong> ${new Date().toLocaleString('fr-FR')}</p>
            </div>
            
            <p style="text-align: center;">
              <a href="${downloadLink}" class="download-btn">⬇️ Télécharger la sauvegarde</a>
            </p>
            
            <div class="warning">
              <strong>⚠️ Important :</strong> Ce lien de téléchargement expire le <strong>${expiresFormatted}</strong>. 
              Assurez-vous de télécharger votre sauvegarde avant cette date.
            </div>
            
            <p style="font-size: 12px; color: #64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
            <div class="link-text">${downloadLink}</div>
          </div>
          <div class="footer">
            <p>${siteName} - ${new Date().getFullYear()}</p>
            <p><a href="${siteUrl}" style="color: #3b82f6;">${siteUrl}</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"${smtp.from_name || 'Gestion Matériels'}" <${smtp.from_email}>`,
      to,
      subject,
      html
    });

    return { success: true };
  } catch (error: any) {
    console.error('Erreur envoi lien backup par email:', error);
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
  sendBackupEmail,
  sendBackupDownloadLink
};
