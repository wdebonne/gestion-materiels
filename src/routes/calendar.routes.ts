import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';

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
        end: e.end_date,
        allDay: !!e.all_day,
        objectId: e.object_id,
        objectName: e.object_name,
        pluginReference: e.plugin_reference,
        pluginReferenceId: e.plugin_reference_id,
        color: e.color,
        reminderBefore: e.reminder_before,
        createdAt: e.created_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get calendar:', error);
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
        end: e.end_date,
        allDay: !!e.all_day,
        objectId: e.object_id,
        objectName: e.object_name,
        pluginReference: e.plugin_reference,
        pluginReferenceId: e.plugin_reference_id,
        color: e.color,
        reminderBefore: e.reminder_before,
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

    const event = await db.queryOne(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE ce.id = ?`,
      [id]
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

    updateFields.push("updated_at = datetime('now')");
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

    const events = await db.query(
      `SELECT ce.*, o.name as object_name 
       FROM calendar_events ce
       LEFT JOIN objects o ON o.id = ce.object_id
       WHERE date(start_date) >= date('now') AND date(start_date) <= date('now', '+${days} days')
       ORDER BY start_date
       LIMIT 50`
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

export default router;
