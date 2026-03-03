import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { handleUpload } from '../services/upload.service';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configuration multer pour les uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'));
    }
  }
});

// GET /api/settings - Récupérer tous les paramètres
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await db.query('SELECT * FROM settings');
    
    const settingsMap: Record<string, any> = {};
    for (const s of settings) {
      let value = s.setting_value;
      if (s.setting_type === 'number') value = Number(value);
      if (s.setting_type === 'boolean') value = value === 'true';
      if (s.setting_type === 'json') value = JSON.parse(value || '{}');
      settingsMap[s.setting_key] = value;
    }

    res.json({ success: true, settings: settingsMap });
  } catch (error: any) {
    console.error('Erreur get settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/settings - Mettre à jour les paramètres
router.put('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, message: 'Paramètres invalides' });
    }

    for (const [key, value] of Object.entries(settings)) {
      const existing = await db.queryOne('SELECT * FROM settings WHERE setting_key = ?', [key]);
      
      let stringValue = String(value);
      if (typeof value === 'object') stringValue = JSON.stringify(value);

      if (existing) {
        await db.execute(
          "UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE setting_key = ?",
          [stringValue, key]
        );
      } else {
        let type = 'string';
        if (typeof value === 'number') type = 'number';
        if (typeof value === 'boolean') type = 'boolean';
        if (typeof value === 'object') type = 'json';
        
        await db.execute(
          'INSERT INTO settings (setting_key, setting_value, setting_type) VALUES (?, ?, ?)',
          [key, stringValue, type]
        );
      }
    }

    res.json({ success: true, message: 'Paramètres mis à jour' });
  } catch (error: any) {
    console.error('Erreur update settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// === SMTP Configuration ===

// GET /api/settings/smtp - Récupérer la configuration SMTP
router.get('/smtp', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const smtp = await db.queryOne('SELECT * FROM smtp_config ORDER BY id DESC LIMIT 1');

    if (!smtp) {
      return res.json({
        success: true,
        smtp: {
          host: '',
          port: 587,
          secure: false,
          username: '',
          password: '',
          fromEmail: '',
          fromName: '',
          isActive: false
        }
      });
    }

    res.json({
      success: true,
      smtp: {
        id: smtp.id,
        host: smtp.host,
        port: smtp.port,
        secure: !!smtp.secure,
        username: smtp.username,
        password: smtp.password ? '********' : '',
        fromEmail: smtp.from_email,
        fromName: smtp.from_name,
        isActive: !!smtp.is_active
      }
    });
  } catch (error: any) {
    console.error('Erreur get smtp:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/settings/smtp - Mettre à jour la configuration SMTP
router.put('/smtp', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { host, port, secure, username, password, fromEmail, fromName, isActive } = req.body;

    const existing = await db.queryOne('SELECT * FROM smtp_config ORDER BY id DESC LIMIT 1');

    if (existing) {
      let updateFields = ['host = ?', 'port = ?', 'secure = ?', 'username = ?', 'from_email = ?', 'from_name = ?', 'is_active = ?', "updated_at = datetime('now')"];
      let values: any[] = [host, port, secure ? 1 : 0, username, fromEmail, fromName, isActive ? 1 : 0];

      // Ne mettre à jour le mot de passe que s'il est fourni
      if (password && password !== '********') {
        updateFields.splice(4, 0, 'password = ?');
        values.splice(4, 0, password);
      }

      values.push(existing.id);

      await db.execute(
        `UPDATE smtp_config SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
    } else {
      await db.execute(
        'INSERT INTO smtp_config (host, port, secure, username, password, from_email, from_name, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [host, port, secure ? 1 : 0, username, password, fromEmail, fromName, isActive ? 1 : 0]
      );
    }

    res.json({ success: true, message: 'Configuration SMTP mise à jour' });
  } catch (error: any) {
    console.error('Erreur update smtp:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/settings/smtp/test - Tester la configuration SMTP
router.post('/smtp/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Adresse email requise' });
    }

    const { sendTestEmail } = await import('../services/email.service');
    
    const result = await sendTestEmail(email);
    
    if (result.success) {
      res.json({ success: true, message: 'Email de test envoyé avec succès' });
    } else {
      res.status(400).json({ success: false, message: result.error });
    }
  } catch (error: any) {
    console.error('Erreur test smtp:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/settings/upload - Upload d'un fichier (logo, favicon, etc.)
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl
      }
    });
  } catch (error: any) {
    console.error('Erreur upload:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/settings/database - Informations sur la base de données
router.get('/database', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const dbType = db.getType();
    
    let dbInfo: any = {
      type: dbType,
      isConnected: true
    };

    if (dbType === 'sqlite') {
      const dbPath = process.env.DB_PATH || './data/database.sqlite';
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        dbInfo.size = stats.size;
        dbInfo.path = dbPath;
      }
    } else {
      dbInfo.host = process.env.MYSQL_HOST;
      dbInfo.database = process.env.MYSQL_DATABASE;
    }

    // Compter les enregistrements
    const tables = ['users', 'categories', 'subcategories', 'objects', 'fuel_entries', 'technical_controls', 'maintenances', 'calendar_events', 'alerts'];
    dbInfo.tables = {};
    
    for (const table of tables) {
      const count = await db.queryOne(`SELECT COUNT(*) as count FROM ${table}`);
      dbInfo.tables[table] = count?.count || 0;
    }

    res.json({ success: true, database: dbInfo });
  } catch (error: any) {
    console.error('Erreur get database info:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/settings/database/migrate - Migrer vers MySQL
router.post('/database/migrate', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { host, port, user, password, database } = req.body;

    const result = await db.migrateToMySQL({
      host,
      port: parseInt(port),
      user,
      password,
      database
    });

    if (result.success) {
      // Mettre à jour le fichier .env
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      // Mettre à jour les variables
      envContent = envContent.replace(/DB_TYPE=.*/g, 'DB_TYPE=mysql');
      envContent = envContent.replace(/MYSQL_HOST=.*/g, `MYSQL_HOST=${host}`);
      envContent = envContent.replace(/MYSQL_PORT=.*/g, `MYSQL_PORT=${port}`);
      envContent = envContent.replace(/MYSQL_USER=.*/g, `MYSQL_USER=${user}`);
      envContent = envContent.replace(/MYSQL_PASSWORD=.*/g, `MYSQL_PASSWORD=${password}`);
      envContent = envContent.replace(/MYSQL_DATABASE=.*/g, `MYSQL_DATABASE=${database}`);

      fs.writeFileSync(envPath, envContent);

      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error: any) {
    console.error('Erreur migration:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/settings/database/test-connection - Tester la connexion MySQL
router.post('/database/test-connection', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { host, port, user, password, database } = req.body;
    const mysql = await import('mysql2/promise');

    const connection = await mysql.createConnection({
      host,
      port: parseInt(port),
      user,
      password
    });

    await connection.execute('SELECT 1');
    await connection.end();

    res.json({ success: true, message: 'Connexion réussie' });
  } catch (error: any) {
    console.error('Erreur test connection:', error);
    res.status(400).json({ success: false, message: `Erreur de connexion: ${error.message}` });
  }
});

export default router;
