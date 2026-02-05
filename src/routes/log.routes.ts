import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import logService, { LogFilter, LogLevel, LogCategory } from '../services/log.service';

const router = Router();

// GET /api/logs - Récupérer les logs avec filtres
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const filter: LogFilter = {};

    // Niveau
    if (req.query.level) {
      const levels = (req.query.level as string).split(',') as LogLevel[];
      filter.level = levels.length === 1 ? levels[0] : levels;
    }

    // Catégorie
    if (req.query.category) {
      const categories = (req.query.category as string).split(',') as LogCategory[];
      filter.category = categories.length === 1 ? categories[0] : categories;
    }

    // Recherche
    if (req.query.search) {
      filter.search = req.query.search as string;
    }

    // Utilisateur
    if (req.query.userId) {
      filter.userId = parseInt(req.query.userId as string);
    }

    // Dates
    if (req.query.startDate) {
      filter.startDate = req.query.startDate as string;
    }
    if (req.query.endDate) {
      filter.endDate = req.query.endDate as string;
    }

    // Pagination
    filter.limit = parseInt(req.query.limit as string) || 50;
    filter.offset = parseInt(req.query.offset as string) || 0;

    const result = await logService.getLogs(filter);

    res.json({
      success: true,
      ...result,
      page: Math.floor(filter.offset / filter.limit) + 1,
      totalPages: Math.ceil(result.total / filter.limit)
    });
  } catch (error: any) {
    console.error('Erreur get logs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/logs/stats - Statistiques des logs
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const stats = await logService.getStats();
    res.json({ success: true, stats });
  } catch (error: any) {
    console.error('Erreur get logs stats:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/logs/settings - Récupérer les paramètres de logs
router.get('/settings', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = logService.getSettings();
    res.json({ success: true, settings });
  } catch (error: any) {
    console.error('Erreur get logs settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/logs/settings - Mettre à jour les paramètres de logs
router.put('/settings', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = req.body.settings;
    await logService.saveSettings(settings);

    // Logger cette action
    await logService.info('system', 'Paramètres de logs modifiés', settings, {
      userId: req.user?.userId,
      userEmail: req.user?.email
    });

    res.json({ success: true, message: 'Paramètres sauvegardés' });
  } catch (error: any) {
    console.error('Erreur update logs settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/logs/export - Exporter les logs
router.get('/export', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as 'json' | 'csv') || 'json';
    
    const filter: LogFilter = {};
    if (req.query.level) {
      filter.level = (req.query.level as string).split(',') as LogLevel[];
    }
    if (req.query.category) {
      filter.category = (req.query.category as string).split(',') as LogCategory[];
    }
    if (req.query.startDate) {
      filter.startDate = req.query.startDate as string;
    }
    if (req.query.endDate) {
      filter.endDate = req.query.endDate as string;
    }
    if (req.query.search) {
      filter.search = req.query.search as string;
    }

    const data = await logService.exportLogs(filter, format);

    const filename = `logs_export_${new Date().toISOString().split('T')[0]}.${format}`;
    
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Ajouter BOM pour Excel
    if (format === 'csv') {
      res.send('\ufeff' + data);
    } else {
      res.send(data);
    }

    // Logger cette action
    await logService.info('system', 'Export des logs effectué', { format, filter }, {
      userId: req.user?.userId,
      userEmail: req.user?.email
    });
  } catch (error: any) {
    console.error('Erreur export logs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/logs/cleanup - Nettoyer les vieux logs manuellement
router.post('/cleanup', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const count = await logService.cleanupOldLogs();
    
    res.json({ 
      success: true, 
      message: `${count} logs supprimés`,
      deletedCount: count
    });
  } catch (error: any) {
    console.error('Erreur cleanup logs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/logs - Supprimer des logs selon les filtres
router.delete('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const filter: LogFilter = {};
    
    if (req.body.level) {
      filter.level = req.body.level;
    }
    if (req.body.category) {
      filter.category = req.body.category;
    }
    if (req.body.startDate) {
      filter.startDate = req.body.startDate;
    }
    if (req.body.endDate) {
      filter.endDate = req.body.endDate;
    }

    let count: number;
    if (req.body.deleteAll) {
      count = await logService.deleteAllLogs();
    } else {
      count = await logService.deleteLogs(filter);
    }

    // Logger cette action
    await logService.warning('system', `${count} logs supprimés manuellement`, { filter, deleteAll: req.body.deleteAll }, {
      userId: req.user?.userId,
      userEmail: req.user?.email
    });

    res.json({ 
      success: true, 
      message: `${count} logs supprimés`,
      deletedCount: count
    });
  } catch (error: any) {
    console.error('Erreur delete logs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
