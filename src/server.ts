import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

// Import des middlewares de sécurité avancés
import { globalLimiter, authLimiter, sensitiveOpsLimiter, uploadLimiter, exportLimiter } from './middleware/rateLimiter.middleware';
import { httpsRedirect, httpsStatus } from './middleware/https.middleware';

// Charger les variables d'environnement
dotenv.config();

// Import des routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import categoryRoutes, { subcategoryRouter } from './routes/category.routes';
import objectRoutes from './routes/object.routes';
import settingsRoutes from './routes/settings.routes';
import pluginRoutes from './routes/plugin.routes';
import emailTemplateRoutes from './routes/emailTemplate.routes';
import backupRoutes from './routes/backup.routes';
import calendarRoutes from './routes/calendar.routes';
import alertRoutes from './routes/alert.routes';
import uploadRoutes from './routes/upload.routes';
import dashboardRoutes from './routes/dashboard.routes';
import permissionRoutes from './routes/permission.routes';
import customFieldsRoutes from './routes/customFields.routes';
import logRoutes from './routes/log.routes';
import webhookRoutes from './routes/webhook.routes';
import trackingRoutes from './routes/tracking.routes';
import securityRoutes from './routes/security.routes';

// Import des services
import { initDatabase, db } from './database';
import { seedDatabase } from './database/seed';
import { initPluginSystem } from './services/plugin.service';
import { initCronJobs } from './services/cron.service';
import { logService } from './services/log.service';
import { jwtRotationService } from './services/jwtRotation.service';

/**
 * Synchronise la version du package.json vers la base de données
 */
async function syncVersionToDatabase() {
  try {
    // Lire la version depuis package.json
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;

    // Vérifier si le paramètre site_version existe
    const existing = await db.queryOne(
      'SELECT * FROM settings WHERE setting_key = ?', 
      ['site_version']
    );

    if (existing) {
      // Mettre à jour si différent
      if (existing.setting_value !== version) {
        const now = new Date().toISOString();
        await db.execute(
          "UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?",
          [version, now, 'site_version']
        );
        console.log(`✅ Version synchronisée: ${existing.setting_value} → ${version}`);
      }
    } else {
      // Créer le paramètre s'il n'existe pas
      await db.execute(
        "INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, 'string', 'Version du site')",
        ['site_version', version]
      );
      console.log(`✅ Version initialisée: ${version}`);
    }

    return version;
  } catch (error) {
    console.error('⚠️ Erreur lors de la synchronisation de la version:', error);
    return null;
  }
}

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware de redirection HTTPS (production uniquement)
app.use(httpsRedirect);

// Configurer Express pour faire confiance aux proxies (pour rate limiting et IP réelle)
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : 1);

// Rate limiting global
app.use(globalLimiter);

// Middlewares de sécurité et logging
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Disable CSP for now to allow assets loading
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : (process.env.CLIENT_URL || 'http://localhost:5173'),
  credentials: true
}));
app.use(morgan('combined'));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de vérification de token pour les fichiers sensibles
const verifyUploadAccess = (req: Request, res: Response, next: NextFunction): void => {
  // Permettre l'accès aux fichiers publics (logos, favicons, images de catégories)
  const publicPatterns = [/^logo/i, /^favicon/i, /^site_/i];
  const filename = path.basename(req.path);
  
  if (publicPatterns.some(pattern => pattern.test(filename))) {
    return next();
  }

  // Vérifier le token pour les autres fichiers
  // Priorité : Header Authorization > Cookie auth_token > Query parameter
  const authHeader = req.headers['authorization'];
  const tokenFromQuery = req.query.token as string;
  const tokenFromCookie = req.cookies?.auth_token;
  const token = (authHeader && authHeader.split(' ')[1]) || tokenFromCookie || tokenFromQuery;

  if (!token) {
    res.status(401).json({ success: false, message: 'Accès non autorisé' });
    return;
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Token invalide ou expiré' });
  }
};

// Servir les fichiers statiques (uploads) avec protection
app.use('/uploads', verifyUploadAccess, express.static(path.join(__dirname, '../uploads')));
// Plugins restent publics (contiennent uniquement du code/config)
app.use('/plugins', express.static(path.join(__dirname, '../plugins')));

// Route de vérification HTTPS (utile pour le debugging)
app.get('/api/https-status', httpsStatus);

// Swagger UI - Documentation API interactive
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Gestion Matériels - API Documentation',
}));

// Endpoint JSON de la spec OpenAPI
app.get('/api/swagger.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

// Endpoint d'information API (pour la page settings/api)
app.get('/api/api-info', (req: Request, res: Response) => {
  const spec = swaggerSpec as any;
  const paths = spec.paths || {};
  
  // Compter les endpoints par méthode
  const methodCounts: Record<string, number> = {};
  let totalEndpoints = 0;
  for (const pathKey of Object.keys(paths)) {
    for (const method of Object.keys(paths[pathKey])) {
      methodCounts[method.toUpperCase()] = (methodCounts[method.toUpperCase()] || 0) + 1;
      totalEndpoints++;
    }
  }

  // Compter les endpoints par tag
  const tagCounts: Record<string, number> = {};
  for (const pathKey of Object.keys(paths)) {
    for (const method of Object.keys(paths[pathKey])) {
      const tags = paths[pathKey][method].tags || ['Uncategorized'];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  res.json({
    success: true,
    data: {
      version: spec.info?.version || '1.0.0',
      title: spec.info?.title || 'API',
      totalEndpoints,
      methodCounts,
      tagCounts,
      tags: spec.tags || [],
      swaggerUrl: '/api-docs',
      specUrl: '/api/swagger.json',
    },
  });
});

// Routes API avec rate limiting spécifiques
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subcategoryRouter);
app.use('/api/objects', objectRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/backup', exportLimiter, backupRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/custom-fields', customFieldsRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/security', securityRoutes);

// Servir le frontend en production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Gestion des erreurs globales
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Erreur:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Démarrage du serveur
async function startServer() {
  try {
    // Initialiser la base de données
    await initDatabase();
    console.log('✅ Base de données initialisée');

    // Initialiser les données par défaut
    await seedDatabase();
    console.log('✅ Données par défaut initialisées');

    // Synchroniser la version depuis package.json
    await syncVersionToDatabase();

    // Initialiser le système de logs
    await logService.init();
    console.log('✅ Système de logs initialisé');

    // Initialiser le service de rotation JWT
    await jwtRotationService.init();
    console.log('✅ Service de rotation JWT initialisé');

    // Initialiser le système de plugins
    await initPluginSystem();
    console.log('✅ Système de plugins initialisé');

    // Initialiser les tâches cron
    initCronJobs();
    console.log('✅ Tâches planifiées initialisées');

    // Listen on 0.0.0.0 for Docker compatibility
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur démarré sur http://0.0.0.0:${PORT}`);
      console.log(`📊 Mode: ${process.env.NODE_ENV || 'development'}`);
      
      // Logger le démarrage du serveur
      logService.success('system', 'Serveur démarré', { 
        port: PORT, 
        mode: process.env.NODE_ENV || 'development' 
      });
    });
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    process.exit(1);
  }
}

startServer();

export default app;
