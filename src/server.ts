import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';

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

// Import des services
import { initDatabase } from './database';
import { seedDatabase } from './database/seed';
import { initPluginSystem } from './services/plugin.service';
import { initCronJobs } from './services/cron.service';
import { logService } from './services/log.service';

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir les fichiers statiques (uploads)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/plugins', express.static(path.join(__dirname, '../plugins')));

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subcategoryRouter);
app.use('/api/objects', objectRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/custom-fields', customFieldsRoutes);
app.use('/api/logs', logRoutes);

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

    // Initialiser le système de logs
    await logService.init();
    console.log('✅ Système de logs initialisé');

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
