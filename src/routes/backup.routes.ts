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

// Stockage des tokens de téléchargement temporaires (en mémoire)
// Format: { token: { backupId, expiresAt, createdBy } }
const downloadTokens: Map<string, { backupId: number; expiresAt: Date; createdBy: string }> = new Map();

// Nettoyer les tokens expirés toutes les 10 minutes
setInterval(() => {
  const now = new Date();
  for (const [token, data] of downloadTokens.entries()) {
    if (data.expiresAt < now) {
      downloadTokens.delete(token);
    }
  }
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
    const { notes, backupType = 'manual', sendEmail: shouldSendEmail, emailAddress } = req.body;
    const dbType = db.getType();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}-${uuidv4().substring(0, 8)}.zip`;
    const filePath = path.join(BACKUP_DIR, filename);

    // Créer l'archive
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // Ajouter la base de données SQLite
    if (dbType === 'sqlite') {
      const dbPath = process.env.DB_PATH || './data/database.sqlite';
      
      // IMPORTANT: Forcer un checkpoint WAL pour s'assurer que toutes les données
      // sont écrites dans le fichier principal avant la sauvegarde
      const sqliteDb = db.getSQLiteDb();
      sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
      
      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'database.sqlite' });
      }
    } else {
      // Pour MySQL, exporter les données en JSON
      const tables = ['users', 'user_permissions', 'settings', 'smtp_config', 'email_templates',
        'categories', 'subcategories', 'objects', 'plugins', 'plugin_categories',
        'fuel_entries', 'technical_controls', 'maintenances', 'calendar_events',
        'alerts', 'backups', 'activity_logs'];

      const exportData: any = {};
      for (const table of tables) {
        exportData[table] = await db.query(`SELECT * FROM ${table}`);
      }
      
      archive.append(JSON.stringify(exportData, null, 2), { name: 'database.json' });
    }

    // Ajouter les uploads
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (fs.existsSync(uploadDir)) {
      archive.directory(uploadDir, 'uploads');
    }

    // Ajouter les plugins personnalisés
    const pluginsDir = './plugins';
    if (fs.existsSync(pluginsDir)) {
      archive.directory(pluginsDir, 'plugins');
    }

    // Ajouter les informations de backup
    const backupInfo = {
      version: process.env.SITE_VERSION || '1.0.0',
      createdAt: new Date().toISOString(),
      dbType,
      notes
    };
    archive.append(JSON.stringify(backupInfo, null, 2), { name: 'backup-info.json' });

    await archive.finalize();

    // Attendre que le fichier soit écrit
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    // Obtenir la taille du fichier
    const stats = fs.statSync(filePath);

    // Enregistrer dans la base
    const result = await db.execute(
      'INSERT INTO backups (filename, file_path, file_size, backup_type, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [filename, filePath, stats.size, backupType, 'completed', notes]
    );

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
        downloadTokens.set(token, {
          backupId: result.lastInsertRowid as number,
          expiresAt,
          createdBy: req.user?.email || 'unknown'
        });
        
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
        id: result.lastInsertRowid,
        filename,
        fileSize: stats.size
      },
      emailSent,
      emailError,
      downloadLink
    });

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

    const tokenData = downloadTokens.get(token);
    if (!tokenData) {
      return res.status(404).json({ success: false, message: 'Lien de téléchargement invalide ou expiré' });
    }

    if (new Date() > tokenData.expiresAt) {
      downloadTokens.delete(token);
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
    downloadTokens.set(token, {
      backupId: parseInt(id),
      expiresAt,
      createdBy: req.user?.email || 'unknown'
    });

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
      downloadTokens.set(token, {
        backupId: parseInt(id),
        expiresAt,
        createdBy: req.user?.email || 'unknown'
      });
      
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

// POST /api/backup/restore - Restaurer une sauvegarde
router.post('/restore', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { backupId } = req.body;

    const backup = await db.queryOne('SELECT * FROM backups WHERE id = ?', [backupId]);
    if (!backup) {
      return res.status(404).json({ success: false, message: 'Sauvegarde non trouvée' });
    }

    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ success: false, message: 'Fichier de sauvegarde non trouvé' });
    }

    const extractDir = path.join(BACKUP_DIR, `extract-${Date.now()}`);
    
    // Extraire l'archive
    await extract(backup.file_path, { dir: path.resolve(extractDir) });

    // Lire les informations de backup
    const infoPath = path.join(extractDir, 'backup-info.json');
    if (!fs.existsSync(infoPath)) {
      throw new Error('Fichier backup-info.json manquant');
    }

    const backupInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    const dbType = db.getType();

    // Restaurer la base de données
    if (backupInfo.dbType === 'sqlite' && dbType === 'sqlite') {
      const backupDbPath = path.join(extractDir, 'database.sqlite');
      const targetDbPath = process.env.DB_PATH || './data/database.sqlite';
      
      if (fs.existsSync(backupDbPath)) {
        // Fermer la connexion actuelle
        const sqliteDb = db.getSQLiteDb();
        sqliteDb.close();
        
        // Supprimer les fichiers WAL existants pour éviter les conflits
        const walPath = targetDbPath + '-wal';
        const shmPath = targetDbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        
        // Copier la base de données
        fs.copyFileSync(backupDbPath, targetDbPath);
        
        // Réinitialiser la connexion
        await db.init();
      }
    } else if (fs.existsSync(path.join(extractDir, 'database.json'))) {
      // Restaurer depuis JSON (pour MySQL ou migration)
      const exportData = JSON.parse(fs.readFileSync(path.join(extractDir, 'database.json'), 'utf8'));
      
      for (const [table, rows] of Object.entries(exportData) as [string, any[]][]) {
        if (rows.length > 0) {
          // Vider la table
          await db.execute(`DELETE FROM ${table}`);
          
          // Insérer les données
          const columns = Object.keys(rows[0]).filter(col => col !== 'id');
          const placeholders = columns.map(() => '?').join(', ');
          
          for (const row of rows) {
            const values = columns.map(col => row[col]);
            await db.execute(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
              values
            );
          }
        }
      }
    }

    // Restaurer les uploads
    const uploadsBackupDir = path.join(extractDir, 'uploads');
    const targetUploadDir = process.env.UPLOAD_DIR || './uploads';
    if (fs.existsSync(uploadsBackupDir)) {
      // Copier récursivement
      copyDirRecursive(uploadsBackupDir, targetUploadDir);
    }

    // Restaurer les plugins
    const pluginsBackupDir = path.join(extractDir, 'plugins');
    if (fs.existsSync(pluginsBackupDir)) {
      copyDirRecursive(pluginsBackupDir, './plugins');
    }

    // Nettoyer le dossier d'extraction
    fs.rmSync(extractDir, { recursive: true, force: true });

    res.json({ success: true, message: 'Restauration effectuée avec succès. Veuillez redémarrer l\'application.' });
  } catch (error: any) {
    console.error('Erreur restore backup:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/backup/upload - Uploader et restaurer une sauvegarde externe
router.post('/upload', authenticateToken, requireAdmin, backupUpload.single('backup'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const tempFilePath = req.file.path;
    const extractDir = path.join(BACKUP_DIR, `extract-${Date.now()}`);

    // Extraire l'archive
    await extract(tempFilePath, { dir: path.resolve(extractDir) });

    // Lire les informations de backup
    const infoPath = path.join(extractDir, 'backup-info.json');
    if (!fs.existsSync(infoPath)) {
      // Nettoyer
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(tempFilePath);
      return res.status(400).json({ success: false, message: 'Fichier backup-info.json manquant. Ce n\'est pas une sauvegarde valide.' });
    }

    const backupInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    const dbType = db.getType();

    // Restaurer la base de données
    if (backupInfo.dbType === 'sqlite' && dbType === 'sqlite') {
      const backupDbPath = path.join(extractDir, 'database.sqlite');
      const targetDbPath = process.env.DB_PATH || './data/database.sqlite';
      
      if (fs.existsSync(backupDbPath)) {
        // Fermer la connexion actuelle
        const sqliteDb = db.getSQLiteDb();
        sqliteDb.close();
        
        // Supprimer les fichiers WAL existants pour éviter les conflits
        const walPath = targetDbPath + '-wal';
        const shmPath = targetDbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        
        // Copier la base de données
        fs.copyFileSync(backupDbPath, targetDbPath);
        
        // Réinitialiser la connexion
        await db.init();
      }
    } else if (fs.existsSync(path.join(extractDir, 'database.json'))) {
      // Restaurer depuis JSON (pour MySQL ou migration)
      const exportData = JSON.parse(fs.readFileSync(path.join(extractDir, 'database.json'), 'utf8'));
      
      for (const [table, rows] of Object.entries(exportData) as [string, any[]][]) {
        if (rows.length > 0) {
          // Vider la table
          await db.execute(`DELETE FROM ${table}`);
          
          // Insérer les données
          const columns = Object.keys(rows[0]).filter(col => col !== 'id');
          const placeholders = columns.map(() => '?').join(', ');
          
          for (const row of rows) {
            const values = columns.map(col => row[col]);
            await db.execute(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
              values
            );
          }
        }
      }
    }

    // Restaurer les uploads
    const uploadsBackupDir = path.join(extractDir, 'uploads');
    const targetUploadDir = process.env.UPLOAD_DIR || './uploads';
    if (fs.existsSync(uploadsBackupDir)) {
      copyDirRecursive(uploadsBackupDir, targetUploadDir);
    }

    // Restaurer les plugins
    const pluginsBackupDir = path.join(extractDir, 'plugins');
    if (fs.existsSync(pluginsBackupDir)) {
      copyDirRecursive(pluginsBackupDir, './plugins');
    }

    // Nettoyer les fichiers temporaires
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(tempFilePath);

    res.json({ success: true, message: 'Sauvegarde externe restaurée avec succès. Veuillez redémarrer l\'application.' });
  } catch (error: any) {
    console.error('Erreur upload backup:', error);
    res.status(500).json({ success: false, message: error.message });
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

// Fonction utilitaire pour copier un dossier récursivement
function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export default router;
