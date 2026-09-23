import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import extract from 'extract-zip';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { sendBackupEmail, sendBackupDownloadLink } from '../services/email.service';
import { logService } from '../services/log.service';
import { notifierWebhooks } from '../services/webhook.service';
import { ArchiveInvalide, RapportRestauration, creerSauvegarde, restaurerArchive } from '../services/sauvegarde.service';

/**
 * Liens de téléchargement temporaires d'une sauvegarde.
 *
 * Ils vivaient dans une `Map` : le premier redémarrage du serveur effaçait
 * des liens annoncés pour sept jours, et le destinataire tombait sur un
 * « lien invalide ou expiré » qui n'était ni l'un ni l'autre.
 */
async function enregistrerLien(token: string, backupId: number, expiresAt: Date, createdBy: string) {
  await db.execute(
    'INSERT INTO backup_download_tokens (token, backup_id, expires_at, created_by) VALUES (?, ?, ?, ?)',
    [token, backupId, expiresAt.toISOString(), createdBy]
  );
}

/** Rend le lien s'il existe et n'a pas expiré ; `null` sinon. */
async function lireLien(token: string) {
  const ligne = await db.queryOne(
    'SELECT backup_id, expires_at, created_by FROM backup_download_tokens WHERE token = ?',
    [token]
  );
  if (!ligne) return null;
  return {
    backupId: ligne.backup_id as number,
    expiresAt: new Date(ligne.expires_at),
    createdBy: (ligne.created_by ?? '') as string,
  };
}

async function oublierLien(token: string) {
  await db.execute('DELETE FROM backup_download_tokens WHERE token = ?', [token]);
}

// Ménage des liens périmés, toutes les dix minutes.
setInterval(() => {
  db.execute('DELETE FROM backup_download_tokens WHERE expires_at < ?', [new Date().toISOString()]).catch(
    (erreur) => console.error('Erreur nettoyage des liens de sauvegarde :', erreur)
  );
}, 10 * 60 * 1000);

// Configuration multer pour les backups
const backupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    cb(null, backupDir);
  },
  filename: (req, file, cb) => {
    cb(null, `temp-${Date.now()}.zip`);
  }
});

const backupUpload = multer({
  storage: backupStorage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.zip') || file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
      cb(null, true);
    } else {
      cb(new Error('Le fichier doit être au format ZIP'));
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max pour les backups
  }
});

const router = Router();

const BACKUP_DIR = './backups';

// Assurer que le dossier de backup existe
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// GET /api/backup - Liste des sauvegardes
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const backups = await db.query('SELECT * FROM backups ORDER BY created_at DESC');

    res.json({
      success: true,
      backups: backups.map((b: any) => ({
        id: b.id,
        filename: b.filename,
        fileSize: b.file_size,
        backupType: b.backup_type,
        status: b.status,
        notes: b.notes,
        createdAt: b.created_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get backups:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/backup - Créer une sauvegarde
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { notes, sendEmail: shouldSendEmail, emailAddress } = req.body;
    const backupType = req.body?.backupType === 'auto' ? 'auto' : 'manual';

    const { id: backupId, filename, filePath, fileSize } = await creerSauvegarde({ type: backupType, notes });
    const stats = { size: fileSize };

    // Envoyer par email si demandé
    let emailSent = false;
    let emailError = null;
    let downloadLink = null;
    
    if (shouldSendEmail && emailAddress) {
      // Vérifier la taille (limite 25 MB pour pièce jointe)
      if (stats.size <= 25 * 1024 * 1024) {
        const emailResult = await sendBackupEmail(emailAddress, filePath, filename);
        emailSent = emailResult.success;
        if (!emailResult.success) {
          emailError = emailResult.error;
        }
      } else {
        // Générer un lien de téléchargement temporaire pour les gros fichiers
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
        await enregistrerLien(
          token,
          backupId,
          expiresAt,
          req.user?.email || 'unknown'
        );
        
        // Récupérer l'URL du site
        const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
        const siteUrl = siteUrlSetting?.setting_value || `${req.protocol}://${req.get('host')}`;
        downloadLink = `${siteUrl}/api/backup/download/${token}`;
        
        // Envoyer l'email avec le lien de téléchargement
        const emailResult = await sendBackupDownloadLink(emailAddress, downloadLink, filename, stats.size, expiresAt);
        emailSent = emailResult.success;
        if (!emailResult.success) {
          emailError = emailResult.error;
        }
      }
    }

    res.json({
      success: true,
      message: 'Sauvegarde créée avec succès' + (emailSent ? ' et envoyée par email' : ''),
      backup: {
        id: backupId,
        filename,
        fileSize: stats.size
      },
      emailSent,
      emailError,
      downloadLink
    });

    notifierWebhooks('backup.created', { filename, fileSize: stats.size, emailSent });

    // Logger la création de backup
    await logService.success('backup', 'Sauvegarde créée avec succès', {
      filename,
      fileSize: stats.size,
      emailSent
    }, {
      userId: req.user?.userId,
      userEmail: req.user?.email
    });
  } catch (error: any) {
    console.error('Erreur create backup:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/backup/:id/download - Télécharger une sauvegarde
router.get('/:id/download', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [id]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    res.download(backup.file_path, backup.filename);
  } catch (error: any) {
    console.error('Erreur download backup:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/backup/download/:token - Télécharger une sauvegarde via token temporaire (public)
router.get('/download/:token', async (req, res: Response) => {
  try {
    const { token } = req.params;

    const tokenData = await lireLien(token);
    if (!tokenData) {
      return res.status(404).json({ success: false, message: 'Lien de téléchargement invalide ou expiré' });
    }

    if (new Date() > tokenData.expiresAt) {
      await oublierLien(token);
      return res.status(410).json({ success: false, message: 'Ce lien de téléchargement a expiré' });
    }

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [tokenData.backupId]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    // Logger le téléchargement
    await logService.info('backup', `Téléchargement via lien temporaire`, {
      filename: backup.filename,
      token: token.substring(0, 8) + '...',
      createdBy: tokenData.createdBy
    });

    res.download(backup.file_path, backup.filename);
  } catch (error: any) {
    console.error('Erreur download backup via token:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/backup/:id/generate-link - Générer un lien de téléchargement temporaire
router.post('/:id/generate-link', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { expiresInDays = 7 } = req.body;

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [id]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    // Générer le token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await enregistrerLien(token, parseInt(id), expiresAt, req.user?.email || 'unknown');

    // Récupérer l'URL du site
    const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
    const siteUrl = siteUrlSetting?.setting_value || `${req.protocol}://${req.get('host')}`;
    const downloadLink = `${siteUrl}/api/backup/download/${token}`;

    res.json({
      success: true,
      downloadLink,
      expiresAt: expiresAt.toISOString(),
      expiresInDays
    });
  } catch (error: any) {
    console.error('Erreur generate download link:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/backup/:id/send-email - Envoyer une sauvegarde par email
router.post('/:id/send-email', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Adresse email requise' });
    }

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [id]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    // Vérifier la taille du fichier (limite à 25 MB pour les emails avec pièce jointe)
    const stats = fs.statSync(backup.file_path);
    
    if (stats.size > 25 * 1024 * 1024) {
      // Générer un lien de téléchargement temporaire pour les gros fichiers
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
      await enregistrerLien(token, parseInt(id), expiresAt, req.user?.email || 'unknown');
      
      // Récupérer l'URL du site
      const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
      const siteUrl = siteUrlSetting?.setting_value || `${req.protocol}://${req.get('host')}`;
      const downloadLink = `${siteUrl}/api/backup/download/${token}`;
      
      // Envoyer l'email avec le lien de téléchargement
      const result = await sendBackupDownloadLink(email, downloadLink, backup.filename, stats.size, expiresAt);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Lien de téléchargement envoyé à ${email}`,
          downloadLink,
          usedLink: true
        });
      } else {
        res.status(500).json({ success: false, message: result.error || 'Erreur lors de l\'envoi' });
      }
    } else {
      // Envoyer directement en pièce jointe
      const result = await sendBackupEmail(email, backup.file_path, backup.filename);

      if (result.success) {
        res.json({ success: true, message: `Sauvegarde envoyée à ${email}` });
      } else {
        res.status(500).json({ success: false, message: result.error || 'Erreur lors de l\'envoi' });
      }
    }
  } catch (error: any) {
    console.error('Erreur send backup email:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Réponse commune aux deux restaurations. Une archive inutilisable est une
 * erreur de saisie (400), pas une panne du serveur.
 */
function repondreRestauration(res: Response, rapport: RapportRestauration, message: string) {
  const avertissements: string[] = [];
  if (rapport.liensOrphelins > 0) {
    avertissements.push(`${rapport.liensOrphelins} ligne(s) pointent vers un élément absent de la sauvegarde.`);
  }
  if (rapport.tablesIgnorees.length > 0) {
    avertissements.push(`Tables inconnues de cette version, ignorées : ${rapport.tablesIgnorees.join(', ')}.`);
  }
  if (rapport.colonnesIgnorees.length > 0) {
    avertissements.push(`Colonnes disparues du schéma, ignorées : ${rapport.colonnesIgnorees.join(', ')}.`);
  }
  res.json({ success: true, message, rapport, avertissements });
}

function repondreErreurRestauration(res: Response, error: any) {
  console.error('Erreur restauration :', error);
  res
    .status(error instanceof ArchiveInvalide ? 400 : 500)
    .json({ success: false, message: `La restauration a échoué et la base n'a pas été modifiée : ${error.message}` });
}

// POST /api/backup/restore - Restaurer une sauvegarde
router.post('/restore', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [req.body?.backupId]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }
    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    const rapport = await restaurerArchive(backup.file_path);
    await logService.success('backup', 'Sauvegarde restaurée', { filename: backup.filename, ...rapport }, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
    });
    repondreRestauration(res, rapport, "Restauration effectuée avec succès. Veuillez redémarrer l'application.");
  } catch (error: any) {
    repondreErreurRestauration(res, error);
  }
});

// POST /api/backup/upload - Uploader et restaurer une sauvegarde externe
router.post('/upload', authenticateToken, requireAdmin, backupUpload.single('backup'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
  }
  try {
    const rapport = await restaurerArchive(req.file.path);
    await logService.success('backup', 'Sauvegarde externe restaurée', { filename: req.file.originalname, ...rapport }, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
    });
    repondreRestauration(res, rapport, "Sauvegarde externe restaurée avec succès. Veuillez redémarrer l'application.");
  } catch (error: any) {
    repondreErreurRestauration(res, error);
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

// DELETE /api/backup/:id - Supprimer une sauvegarde
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [id]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    // Supprimer le fichier
    if (fs.existsSync(backup.file_path)) {
      fs.unlinkSync(backup.file_path);
    }

    // Supprimer l'enregistrement
    await db.execute('DELETE FROM backups WHERE id = ?', [id]);

    res.json({ success: true, message: 'Sauvegarde supprimée' });
  } catch (error: any) {
    console.error('Erreur delete backup:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
