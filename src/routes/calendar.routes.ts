import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { filtreObjetsLies } from '../middleware/objectScope';

const router = Router();

// GET /api/calendar - Liste des événements (raccourci)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, start, end, objectId, eventType } = req.query;
    
    // Support des deux formats de paramètres
    const startParam = startDate || start;
    const endParam = endDate || end;

    let whereClause = '1=1';
    const params: any[] = [];

    if (startParam) {
      whereClause += ' AND start_date >= ?';
      params.push(startParam);
    }

    if (endParam) {
      whereClause += ' AND start_date <= ?';
      params.push(endParam);
    }

    if (objectId) {
      whereClause += ' AND object_id = ?';
      params.push(objectId);
    }

    if (eventType) {
      whereClause += ' AND event_type = ?';
      params.push(eventType);
    }

    // Un événement rattaché à un matériel en révèle le nom. Ceux qui n'en
    // portent aucun — la plupart — restent visibles de tous.
    const filtre = await filtreObjetsLies(req, 'o', 'ce.object_id');
    if (filtre) {
      whereClause += filtre.sql;
      params.push(...filtre.params);
    }

    const events = await db.query(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ${whereClause}
       ORDER BY start_date`,
      params
    );

    res.json({
      success: true,
      events: events.map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        eventType: e.event_type,
        start: e.start_date,
        startDate: e.start_date,
        end: e.end_date,
        endDate: e.end_date,
        allDay: !!e.all_day,
        objectId: e.object_id,
        objectName: e.object_name,
        pluginReference: e.plugin_reference,
        pluginReferenceId: e.plugin_reference_id,
        color: e.color,
        reminderBefore: e.reminder_before,
        source: e.source || 'local',
        externalId: e.external_id,
        createdAt: e.created_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get calendar:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar - Créer un événement (raccourci)
router.post('/', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title, description, eventType = 'other', startDate, endDate,
      allDay, objectId, color = '#3b82f6', reminderBefore = 0
    } = req.body;

    const result = await db.execute(
      `INSERT INTO calendar_events (title, description, event_type, start_date, end_date, all_day, object_id, color, reminder_before, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, eventType, startDate, endDate, allDay ? 1 : 0, objectId || null, color, reminderBefore, req.user?.userId]
    );

    res.status(201).json({
      success: true,
      message: 'Événement créé',
      eventId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/calendar/events - Liste des événements
router.get('/events', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { start, end, objectId, eventType } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (start) {
      whereClause += ' AND start_date >= ?';
      params.push(start);
    }

    if (end) {
      whereClause += ' AND start_date <= ?';
      params.push(end);
    }

    if (objectId) {
      whereClause += ' AND object_id = ?';
      params.push(objectId);
    }

    if (eventType) {
      whereClause += ' AND event_type = ?';
      params.push(eventType);
    }

    // Un événement rattaché à un matériel en révèle le nom. Ceux qui n'en
    // portent aucun — la plupart — restent visibles de tous.
    const filtre = await filtreObjetsLies(req, 'o', 'ce.object_id');
    if (filtre) {
      whereClause += filtre.sql;
      params.push(...filtre.params);
    }

    const events = await db.query(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ${whereClause}
       ORDER BY start_date`,
      params
    );

    res.json({
      success: true,
      events: events.map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        eventType: e.event_type,
        start: e.start_date,
        startDate: e.start_date,
        end: e.end_date,
        endDate: e.end_date,
        allDay: !!e.all_day,
        objectId: e.object_id,
        objectName: e.object_name,
        pluginReference: e.plugin_reference,
        pluginReferenceId: e.plugin_reference_id,
        color: e.color,
        reminderBefore: e.reminder_before,
        source: e.source || 'local',
        externalId: e.external_id,
        createdAt: e.created_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get calendar events:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/calendar/events/:id - Détail d'un événement
router.get('/events/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const filtre = await filtreObjetsLies(req, 'o', 'ce.object_id');

    const event = await db.queryOne(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ce.id = ?${filtre?.sql ?? ''}`,
      [id, ...(filtre?.params ?? [])]
    );

    if (!event) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé' });
    }

    res.json({
      success: true,
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        eventType: event.event_type,
        start: event.start_date,
        end: event.end_date,
        allDay: !!event.all_day,
        objectId: event.object_id,
        objectName: event.object_name,
        pluginReference: event.plugin_reference,
        pluginReferenceId: event.plugin_reference_id,
        color: event.color,
        reminderBefore: event.reminder_before,
        createdAt: event.created_at
      }
    });
  } catch (error: any) {
    console.error('Erreur get calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/events - Créer un événement
router.post('/events', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title, description, eventType = 'other', startDate, endDate,
      allDay, objectId, color = '#3b82f6', reminderBefore = 0
    } = req.body;

    const result = await db.execute(
      `INSERT INTO calendar_events (title, description, event_type, start_date, end_date, all_day, object_id, color, reminder_before, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, eventType, startDate, endDate, allDay ? 1 : 0, objectId || null, color, reminderBefore, req.user?.userId]
    );

    res.status(201).json({
      success: true,
      message: 'Événement créé',
      eventId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/calendar/:id - Modifier un événement (raccourci)
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title, description, eventType, startDate, endDate,
      allDay, objectId, color, reminderBefore
    } = req.body;

    const event = await db.queryOne('SELECT * FROM calendar_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé' });
    }

    if (event.plugin_reference) {
      return res.status(400).json({ success: false, message: 'Cet événement est lié à un plugin et ne peut pas être modifié directement' });
    }

    let updateFields = [];
    let values: any[] = [];

    if (title) { updateFields.push('title = ?'); values.push(title); }
    if (description !== undefined) { updateFields.push('description = ?'); values.push(description); }
    if (eventType) { updateFields.push('event_type = ?'); values.push(eventType); }
    if (startDate) { updateFields.push('start_date = ?'); values.push(startDate); }
    if (endDate !== undefined) { updateFields.push('end_date = ?'); values.push(endDate); }
    if (allDay !== undefined) { updateFields.push('all_day = ?'); values.push(allDay ? 1 : 0); }
    if (objectId !== undefined) { updateFields.push('object_id = ?'); values.push(objectId || null); }
    if (color) { updateFields.push('color = ?'); values.push(color); }
    if (reminderBefore !== undefined) { updateFields.push('reminder_before = ?'); values.push(reminderBefore); }

    if (updateFields.length > 0) {
      values.push(id);
      await db.execute(
        `UPDATE calendar_events SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
    }

    res.json({ success: true, message: 'Événement modifié' });
  } catch (error: any) {
    console.error('Erreur update calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/calendar/:id - Supprimer un événement (raccourci)
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const event = await db.queryOne('SELECT * FROM calendar_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé' });
    }

    if (event.plugin_reference) {
      return res.status(400).json({ success: false, message: 'Cet événement est lié à un plugin et ne peut pas être supprimé directement' });
    }

    await db.execute('DELETE FROM calendar_events WHERE id = ?', [id]);
    res.json({ success: true, message: 'Événement supprimé' });
  } catch (error: any) {
    console.error('Erreur delete calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/calendar/events/:id - Modifier un événement
router.put('/events/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title, description, eventType, startDate, endDate,
      allDay, objectId, color, reminderBefore
    } = req.body;

    const event = await db.queryOne('SELECT * FROM calendar_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé' });
    }

    // Les événements créés par des plugins ne peuvent pas être modifiés directement
    if (event.plugin_reference) {
      return res.status(400).json({ success: false, message: 'Cet événement est lié à un plugin et ne peut pas être modifié directement' });
    }

    let updateFields = [];
    let values = [];

    if (title) {
      updateFields.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      values.push(description);
    }
    if (eventType) {
      updateFields.push('event_type = ?');
      values.push(eventType);
    }
    if (startDate) {
      updateFields.push('start_date = ?');
      values.push(startDate);
    }
    if (endDate !== undefined) {
      updateFields.push('end_date = ?');
      values.push(endDate);
    }
    if (allDay !== undefined) {
      updateFields.push('all_day = ?');
      values.push(allDay ? 1 : 0);
    }
    if (objectId !== undefined) {
      updateFields.push('object_id = ?');
      values.push(objectId);
    }
    if (color) {
      updateFields.push('color = ?');
      values.push(color);
    }
    if (reminderBefore !== undefined) {
      updateFields.push('reminder_before = ?');
      values.push(reminderBefore);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.execute(
      `UPDATE calendar_events SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Événement mis à jour' });
  } catch (error: any) {
    console.error('Erreur update calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/calendar/events/:id - Supprimer un événement
router.delete('/events/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const event = await db.queryOne('SELECT * FROM calendar_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé' });
    }

    // Les événements créés par des plugins ne peuvent pas être supprimés directement
    if (event.plugin_reference) {
      return res.status(400).json({ success: false, message: 'Cet événement est lié à un plugin et ne peut pas être supprimé directement' });
    }

    await db.execute('DELETE FROM calendar_events WHERE id = ?', [id]);

    res.json({ success: true, message: 'Événement supprimé' });
  } catch (error: any) {
    console.error('Erreur delete calendar event:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/calendar/upcoming - Événements à venir
router.get('/upcoming', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { days = 30 } = req.query;

    const filtre = await filtreObjetsLies(req, 'o', 'ce.object_id');

    const events = await db.query(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE date(start_date) >= date('now') AND date(start_date) <= date('now', '+${days} days')${filtre?.sql ?? ''}
       ORDER BY start_date
       LIMIT 50`,
      filtre?.params ?? []
    );

    res.json({
      success: true,
      events: events.map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        eventType: e.event_type,
        start: e.start_date,
        end: e.end_date,
        allDay: !!e.all_day,
        objectId: e.object_id,
        objectName: e.object_name,
        color: e.color
      }))
    });
  } catch (error: any) {
    console.error('Erreur get upcoming events:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== SYNCHRONISATION CALENDRIERS ====================

// GET /api/calendar/sync/status - Statut de synchronisation
router.get('/sync/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    let outlookData: any = {};
    let caldavData: any = {};

    try {
      const outlookConfig = await db.queryOne(
        "SELECT * FROM settings WHERE setting_key = 'calendar_outlook_config'"
      );
      if (outlookConfig && outlookConfig.setting_value) {
        outlookData = JSON.parse(outlookConfig.setting_value);
      }
    } catch (e) {
      // Si le parsing échoue ou si la table n'existe pas, on continue avec les valeurs par défaut
    }

    try {
      const caldavConfig = await db.queryOne(
        "SELECT * FROM settings WHERE setting_key = 'calendar_caldav_config'"
      );
      if (caldavConfig && caldavConfig.setting_value) {
        caldavData = JSON.parse(caldavConfig.setting_value);
      }
    } catch (e) {
      // Si le parsing échoue ou si la table n'existe pas, on continue avec les valeurs par défaut
    }

    res.json({
      outlook: {
        connected: !!outlookData.enabled && !!outlookData.clientId,
        lastSync: outlookData.lastSync || null,
        email: outlookData.email || null
      },
      caldav: {
        connected: !!caldavData.enabled && !!caldavData.serverUrl,
        lastSync: caldavData.lastSync || null,
        server: caldavData.serverUrl || null
      }
    });
  } catch (error: any) {
    console.error('Erreur get sync status:', error);
    // En cas d'erreur, retourner un statut par défaut plutôt qu'une erreur 500
    res.json({
      outlook: { connected: false, lastSync: null, email: null },
      caldav: { connected: false, lastSync: null, server: null }
    });
  }
});

// GET /api/calendar/sync/config - Configuration de synchronisation
router.get('/sync/config', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const outlookConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_outlook_config'"
    );
    const caldavConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_caldav_config'"
    );

    const outlookData = outlookConfig ? JSON.parse(outlookConfig.setting_value || '{}') : {};
    const caldavData = caldavConfig ? JSON.parse(caldavConfig.setting_value || '{}') : {};

    // Ne pas renvoyer les secrets complets
    res.json({
      outlook: {
        clientId: outlookData.clientId || '',
        clientSecret: outlookData.clientSecret ? '••••••••' : '',
        tenantId: outlookData.tenantId || '',
        enabled: !!outlookData.enabled
      },
      caldav: {
        serverUrl: caldavData.serverUrl || '',
        username: caldavData.username || '',
        password: caldavData.password ? '••••••••' : '',
        calendarPath: caldavData.calendarPath || '',
        enabled: !!caldavData.enabled
      }
    });
  } catch (error: any) {
    console.error('Erreur get sync config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/sync/outlook/config - Configurer Outlook
router.post('/sync/outlook/config', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { clientId, clientSecret, tenantId, enabled } = req.body;

    // Récupérer la config existante pour ne pas écraser le secret si non modifié
    const existingConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_outlook_config'"
    );
    const existingData = existingConfig ? JSON.parse(existingConfig.setting_value || '{}') : {};

    const newConfig = {
      clientId: clientId || existingData.clientId,
      clientSecret: clientSecret === '••••••••' ? existingData.clientSecret : clientSecret,
      tenantId: tenantId || existingData.tenantId,
      enabled: !!enabled,
      lastSync: existingData.lastSync
    };

    if (existingConfig) {
      await db.execute(
        "UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = 'calendar_outlook_config'",
        [JSON.stringify(newConfig), new Date().toISOString()]
      );
    } else {
      const now = new Date().toISOString();
      await db.execute(
        "INSERT INTO settings (setting_key, setting_value, created_at, updated_at) VALUES ('calendar_outlook_config', ?, ?, ?)",
        [JSON.stringify(newConfig), now, now]
      );
    }

    res.json({ success: true, message: 'Configuration Outlook enregistrée' });
  } catch (error: any) {
    console.error('Erreur save outlook config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/sync/caldav/config - Configurer CalDAV
router.post('/sync/caldav/config', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { serverUrl, username, password, calendarPath, enabled } = req.body;

    // Récupérer la config existante pour ne pas écraser le mot de passe si non modifié
    const existingConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_caldav_config'"
    );
    const existingData = existingConfig ? JSON.parse(existingConfig.setting_value || '{}') : {};

    const newConfig = {
      serverUrl: serverUrl || existingData.serverUrl,
      username: username || existingData.username,
      password: password === '••••••••' ? existingData.password : password,
      calendarPath: calendarPath || existingData.calendarPath,
      enabled: !!enabled,
      lastSync: existingData.lastSync
    };

    if (existingConfig) {
      await db.execute(
        "UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = 'calendar_caldav_config'",
        [JSON.stringify(newConfig), new Date().toISOString()]
      );
    } else {
      const now = new Date().toISOString();
      await db.execute(
        "INSERT INTO settings (setting_key, setting_value, created_at, updated_at) VALUES ('calendar_caldav_config', ?, ?, ?)",
        [JSON.stringify(newConfig), now, now]
      );
    }

    res.json({ success: true, message: 'Configuration CalDAV enregistrée' });
  } catch (error: any) {
    console.error('Erreur save caldav config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/sync/outlook/test - Tester la connexion Outlook
router.post('/sync/outlook/test', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const config = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_outlook_config'"
    );
    
    if (!config) {
      return res.status(400).json({ success: false, error: 'Configuration Outlook non trouvée' });
    }

    const data = JSON.parse(config.setting_value || '{}');
    
    if (!data.clientId || !data.clientSecret || !data.tenantId) {
      return res.status(400).json({ success: false, error: 'Configuration incomplète' });
    }

    // Test de connexion à Microsoft Graph API
    // Pour une vraie implémentation, il faudrait utiliser @azure/msal-node
    // Ici on simule juste un test basique
    const tokenEndpoint = `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`;
    
    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: data.clientId,
          client_secret: data.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials'
        })
      });

      if (response.ok) {
        res.json({ success: true, message: 'Connexion Outlook réussie' });
      } else {
        const errorData = await response.json() as { error_description?: string };
        res.status(400).json({ 
          success: false, 
          error: errorData.error_description || 'Erreur d\'authentification' 
        });
      }
    } catch (fetchError) {
      res.status(400).json({ success: false, error: 'Impossible de contacter le serveur Microsoft' });
    }
  } catch (error: any) {
    console.error('Erreur test outlook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/sync/caldav/test - Tester la connexion CalDAV
router.post('/sync/caldav/test', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const config = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_caldav_config'"
    );
    
    if (!config) {
      return res.status(400).json({ success: false, error: 'Configuration CalDAV non trouvée' });
    }

    const data = JSON.parse(config.setting_value || '{}');
    
    if (!data.serverUrl || !data.username || !data.password) {
      return res.status(400).json({ success: false, error: 'Configuration incomplète' });
    }

    // Test de connexion CalDAV basique avec PROPFIND
    try {
      const auth = Buffer.from(`${data.username}:${data.password}`).toString('base64');
      const response = await fetch(data.serverUrl, {
        method: 'PROPFIND',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Depth': '0',
          'Content-Type': 'application/xml'
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <propfind xmlns="DAV:">
            <prop>
              <displayname/>
              <resourcetype/>
            </prop>
          </propfind>`
      });

      if (response.ok || response.status === 207) {
        res.json({ success: true, message: 'Connexion CalDAV réussie' });
      } else if (response.status === 401) {
        res.status(400).json({ success: false, error: 'Identifiants incorrects' });
      } else {
        res.status(400).json({ success: false, error: `Erreur serveur: ${response.status}` });
      }
    } catch (fetchError) {
      res.status(400).json({ success: false, error: 'Impossible de contacter le serveur CalDAV' });
    }
  } catch (error: any) {
    console.error('Erreur test caldav:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/calendar/sync - Synchroniser tous les calendriers
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const results = {
      outlook: { synced: false, events: 0, error: null as string | null },
      caldav: { synced: false, events: 0, error: null as string | null }
    };

    // Synchroniser Outlook
    const outlookConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_outlook_config'"
    );
    if (outlookConfig) {
      const data = JSON.parse(outlookConfig.setting_value || '{}');
      if (data.enabled && data.clientId && data.clientSecret) {
        try {
          const syncResult = await syncOutlookCalendar(data);
          results.outlook = { synced: true, events: syncResult.count, error: null };
          
          // Mettre à jour lastSync
          data.lastSync = new Date().toISOString();
          await db.execute(
            "UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = 'calendar_outlook_config'",
            [JSON.stringify(data), new Date().toISOString()]
          );
        } catch (err: any) {
          results.outlook.error = err.message;
        }
      }
    }

    // Synchroniser CalDAV
    const caldavConfig = await db.queryOne(
      "SELECT * FROM settings WHERE setting_key = 'calendar_caldav_config'"
    );
    if (caldavConfig) {
      const data = JSON.parse(caldavConfig.setting_value || '{}');
      if (data.enabled && data.serverUrl && data.username) {
        try {
          const syncResult = await syncCaldavCalendar(data);
          results.caldav = { synced: true, events: syncResult.count, error: null };
          
          // Mettre à jour lastSync
          data.lastSync = new Date().toISOString();
          await db.execute(
            "UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = 'calendar_caldav_config'",
            [JSON.stringify(data), new Date().toISOString()]
          );
        } catch (err: any) {
          results.caldav.error = err.message;
        }
      }
    }

    res.json({ success: true, results });
  } catch (error: any) {
    console.error('Erreur sync:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/calendar/sync/outlook - Déconnecter Outlook
router.delete('/sync/outlook', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    // Supprimer les événements synchronisés depuis Outlook
    await db.execute(
      "DELETE FROM calendar_events WHERE source = 'outlook'"
    );
    
    // Désactiver la config
    await db.execute(
      "UPDATE settings SET setting_value = '{}', updated_at = ? WHERE setting_key = 'calendar_outlook_config'",
      [new Date().toISOString()]
    );

    res.json({ success: true, message: 'Outlook déconnecté' });
  } catch (error: any) {
    console.error('Erreur disconnect outlook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/calendar/sync/caldav - Déconnecter CalDAV
router.delete('/sync/caldav', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    // Supprimer les événements synchronisés depuis CalDAV
    await db.execute(
      "DELETE FROM calendar_events WHERE source = 'caldav'"
    );
    
    // Désactiver la config
    await db.execute(
      "UPDATE settings SET setting_value = '{}', updated_at = ? WHERE setting_key = 'calendar_caldav_config'",
      [new Date().toISOString()]
    );

    res.json({ success: true, message: 'CalDAV déconnecté' });
  } catch (error: any) {
    console.error('Erreur disconnect caldav:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Fonction helper pour synchroniser Outlook
async function syncOutlookCalendar(config: any): Promise<{ count: number }> {
  try {
    // Obtenir un token d'accès
    const tokenEndpoint = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Impossible d\'obtenir un token Outlook');
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // Récupérer les événements des 30 prochains jours
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const eventsUrl = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${now.toISOString()}&endDateTime=${endDate.toISOString()}&$select=subject,start,end,isAllDay,bodyPreview&$top=100`;
    
    const eventsResponse = await fetch(eventsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'outlook.timezone="Europe/Paris"'
      }
    });

    if (!eventsResponse.ok) {
      // Pour les applications daemon, on ne peut pas accéder aux calendriers utilisateur sans permissions spéciales
      // Retourner un résultat vide mais valide
      console.log('Note: Outlook sync requires delegated permissions for user calendars');
      return { count: 0 };
    }

    const eventsData = await eventsResponse.json() as { value?: Array<{ subject: string; bodyPreview?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; isAllDay?: boolean; id: string }> };
    const events = eventsData.value || [];

    // Supprimer les anciens événements Outlook et insérer les nouveaux
    await db.execute("DELETE FROM calendar_events WHERE source = 'outlook'");

    let count = 0;
    for (const event of events) {
      await db.execute(
        `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, source, external_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'outlook', ?, ?)`,
        [
          event.subject,
          event.bodyPreview || '',
          event.start?.dateTime || null,
          event.end?.dateTime || null,
          event.isAllDay ? 1 : 0,
          '#0078D4', // Bleu Outlook
          event.id,
          new Date().toISOString()
        ]
      );
      count++;
    }

    return { count };
  } catch (error: any) {
    console.error('Erreur sync Outlook:', error);
    throw error;
  }
}

// Fonction helper pour synchroniser CalDAV
async function syncCaldavCalendar(config: any): Promise<{ count: number }> {
  try {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const calendarUrl = config.calendarPath 
      ? `${config.serverUrl}${config.calendarPath}`
      : config.serverUrl;

    // Requête REPORT pour récupérer les événements
    const now = new Date();
    const endDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const reportBody = `<?xml version="1.0" encoding="utf-8"?>
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${formatICalDate(now)}" end="${formatICalDate(endDate)}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;

    const response = await fetch(calendarUrl, {
      method: 'REPORT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Depth': '1',
        'Content-Type': 'application/xml'
      },
      body: reportBody
    });

    if (!response.ok && response.status !== 207) {
      throw new Error(`Erreur CalDAV: ${response.status}`);
    }

    const xmlText = await response.text();
    const events = parseCalDavResponse(xmlText);

    // Supprimer les anciens événements CalDAV et insérer les nouveaux
    await db.execute("DELETE FROM calendar_events WHERE source = 'caldav'");

    let count = 0;
    for (const event of events) {
      await db.execute(
        `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, source, external_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'caldav', ?, ?)`,
        [
          event.summary,
          event.description || '',
          event.dtstart,
          event.dtend,
          event.allDay ? 1 : 0,
          '#10B981', // Vert pour CalDAV
          event.uid,
          new Date().toISOString()
        ]
      );
      count++;
    }

    return { count };
  } catch (error: any) {
    console.error('Erreur sync CalDAV:', error);
    throw error;
  }
}

// Helper pour formater une date en format iCal
function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Parser simple pour les réponses CalDAV
function parseCalDavResponse(xmlText: string): Array<{
  uid: string;
  summary: string;
  description?: string;
  dtstart: string;
  dtend?: string;
  allDay: boolean;
}> {
  const events: Array<any> = [];
  
  // Extraire les données calendar-data (contient le iCalendar)
  const calendarDataMatches = xmlText.match(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/gi);
  
  if (!calendarDataMatches) return events;

  for (const match of calendarDataMatches) {
    const icalData = match.replace(/<\/?cal:calendar-data[^>]*>/gi, '').trim();
    
    // Parser basique iCalendar
    const uidMatch = icalData.match(/UID:(.+)/);
    const summaryMatch = icalData.match(/SUMMARY:(.+)/);
    const descMatch = icalData.match(/DESCRIPTION:(.+)/);
    const dtstartMatch = icalData.match(/DTSTART[^:]*:(.+)/);
    const dtendMatch = icalData.match(/DTEND[^:]*:(.+)/);
    
    if (summaryMatch && dtstartMatch) {
      const dtstart = parseICalDate(dtstartMatch[1].trim());
      const dtend = dtendMatch ? parseICalDate(dtendMatch[1].trim()) : undefined;
      
      events.push({
        uid: uidMatch ? uidMatch[1].trim() : `caldav-${Date.now()}-${Math.random()}`,
        summary: summaryMatch[1].trim(),
        description: descMatch ? descMatch[1].trim().replace(/\\n/g, '\n') : undefined,
        dtstart,
        dtend,
        allDay: !dtstartMatch[0].includes('T') || dtstartMatch[0].includes('VALUE=DATE')
      });
    }
  }

  return events;
}

// Parser une date iCalendar
function parseICalDate(icalDate: string): string {
  // Format: 20260205T100000Z ou 20260205
  const cleanDate = icalDate.replace(/[^0-9TZ]/g, '');
  
  if (cleanDate.length === 8) {
    // Date seule
    return `${cleanDate.slice(0, 4)}-${cleanDate.slice(4, 6)}-${cleanDate.slice(6, 8)}`;
  } else if (cleanDate.length >= 15) {
    // Date avec heure
    const year = cleanDate.slice(0, 4);
    const month = cleanDate.slice(4, 6);
    const day = cleanDate.slice(6, 8);
    const hour = cleanDate.slice(9, 11);
    const minute = cleanDate.slice(11, 13);
    const second = cleanDate.slice(13, 15);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  
  return icalDate;
}

export default router;
