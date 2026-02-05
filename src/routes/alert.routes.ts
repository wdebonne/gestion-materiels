import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';

const router = Router();

// GET /api/alerts - Liste des alertes
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { objectId, alertType, severity, showDismissed = 'false' } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (showDismissed !== 'true') {
      whereClause += ' AND is_dismissed = 0';
    }

    if (objectId) {
      whereClause += ' AND object_id = ?';
      params.push(objectId);
    }

    if (alertType) {
      whereClause += ' AND alert_type = ?';
      params.push(alertType);
    }

    if (severity) {
      whereClause += ' AND severity = ?';
      params.push(severity);
    }

    const alerts = await db.query(
      `SELECT a.*, o.name as object_name 
       FROM alerts a
       LEFT JOIN objects o ON o.id = a.object_id
       WHERE ${whereClause}
       ORDER BY 
         CASE severity 
           WHEN 'critical' THEN 1 
           WHEN 'warning' THEN 2 
           WHEN 'info' THEN 3 
           ELSE 4 
         END,
         due_date ASC,
         created_at DESC`,
      params
    );

    res.json({
      success: true,
      alerts: alerts.map((a: any) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        alertType: a.alert_type,
        severity: a.severity,
        objectId: a.object_id,
        objectName: a.object_name,
        pluginReference: a.plugin_reference,
        pluginReferenceId: a.plugin_reference_id,
        isRead: !!a.is_read,
        isDismissed: !!a.is_dismissed,
        dueDate: a.due_date,
        createdAt: a.created_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get alerts:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/alerts/count - Nombre d'alertes non lues
router.get('/count', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.queryOne(
      'SELECT COUNT(*) as count FROM alerts WHERE is_dismissed = 0 AND is_read = 0'
    );

    const bySeverity = await db.query(
      `SELECT severity, COUNT(*) as count FROM alerts 
       WHERE is_dismissed = 0 AND is_read = 0 
       GROUP BY severity`
    );

    res.json({
      success: true,
      count: result?.count || 0,
      bySeverity: Object.fromEntries(bySeverity.map((s: any) => [s.severity, s.count]))
    });
  } catch (error: any) {
    console.error('Erreur get alerts count:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/alerts/settings - Récupérer les paramètres des alertes
router.get('/settings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const setting = await db.queryOne(
      "SELECT * FROM settings WHERE key = 'alert_settings'"
    );

    const defaultSettings = {
      technical_control: { days: 30, priority: 'medium' },
      maintenance: { days: 14, priority: 'low' },
      fuel: { days: 7, priority: 'low' },
      custom: { days: 7, priority: 'low' }
    };

    if (setting && setting.value) {
      try {
        const settings = JSON.parse(setting.value);
        res.json({ success: true, settings: { ...defaultSettings, ...settings } });
      } catch {
        res.json({ success: true, settings: defaultSettings });
      }
    } else {
      res.json({ success: true, settings: defaultSettings });
    }
  } catch (error: any) {
    console.error('Erreur get alert settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/alerts/settings - Mettre à jour les paramètres des alertes
router.put('/settings', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;

    if (!settings) {
      return res.status(400).json({ success: false, message: 'Paramètres requis' });
    }

    const existingSetting = await db.queryOne(
      "SELECT * FROM settings WHERE key = 'alert_settings'"
    );

    if (existingSetting) {
      await db.execute(
        "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'alert_settings'",
        [JSON.stringify(settings)]
      );
    } else {
      await db.execute(
        "INSERT INTO settings (key, value) VALUES ('alert_settings', ?)",
        [JSON.stringify(settings)]
      );
    }

    res.json({ success: true, message: 'Paramètres enregistrés' });
  } catch (error: any) {
    console.error('Erreur save alert settings:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/alerts/:id/read - Marquer une alerte comme lue
router.put('/:id/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await db.execute('UPDATE alerts SET is_read = 1 WHERE id = ?', [id]);

    res.json({ success: true, message: 'Alerte marquée comme lue' });
  } catch (error: any) {
    console.error('Erreur mark alert read:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/alerts/:id/dismiss - Ignorer une alerte
router.put('/:id/dismiss', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await db.execute('UPDATE alerts SET is_dismissed = 1, is_read = 1 WHERE id = ?', [id]);

    res.json({ success: true, message: 'Alerte ignorée' });
  } catch (error: any) {
    console.error('Erreur dismiss alert:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/alerts/read-all - Marquer toutes les alertes comme lues
router.put('/read-all', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('UPDATE alerts SET is_read = 1 WHERE is_dismissed = 0');

    res.json({ success: true, message: 'Toutes les alertes marquées comme lues' });
  } catch (error: any) {
    console.error('Erreur mark all alerts read:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/alerts - Créer une alerte manuellement
router.post('/', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { title, message, alertType = 'custom', severity = 'info', objectId, dueDate } = req.body;

    const result = await db.execute(
      `INSERT INTO alerts (title, message, alert_type, severity, object_id, due_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, message, alertType, severity, objectId || null, dueDate || null]
    );

    res.status(201).json({
      success: true,
      message: 'Alerte créée',
      alertId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create alert:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/alerts/:id - Supprimer une alerte
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.execute('DELETE FROM alerts WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Alerte non trouvée' });
    }

    res.json({ success: true, message: 'Alerte supprimée' });
  } catch (error: any) {
    console.error('Erreur delete alert:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
