import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import { filtreObjetsLies } from '../middleware/objectScope';
import { logService } from '../services/log.service';
import {
  apercuExport,
  destination as destinationParId,
  destinations,
  DIRECTIONS,
  exporterVers,
  NATURES,
  noterPassage,
  sansSecrets,
  tester,
  type Destination,
} from '../services/agendasExternes.service';

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

// ======================== AGENDAS EXTERNES ========================
//
// Déclarées **avant** `PUT /:id` et `DELETE /:id` : Express prend la première
// route qui correspond, et `/agendas` serait sinon lu comme l'identifiant d'un
// événement.

/** GET /agendas/vocabulaire - Les natures et les sens, publiés par le serveur. */
router.get('/agendas/vocabulaire', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { natures: NATURES, directions: DIRECTIONS } });
});

/** GET /agendas - Les carnets configurés, sans leurs secrets. */
router.get('/agendas', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  try {
    const liste = await destinations();
    res.json({ success: true, data: liste.map(sansSecrets) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Les champs qu'un écran envoie, relus sans confiance. */
function lireCorps(corps: any) {
  const texte = (valeur: unknown): string => (typeof valeur === 'string' ? valeur.trim() : '');
  const listeDeNombres = (valeur: unknown): number[] =>
    Array.isArray(valeur) ? valeur.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  const listeDeTermes = (valeur: unknown): string[] =>
    Array.isArray(valeur)
      ? valeur.map(String).filter((v) => NATURES.some((n) => n.valeur === v))
      : [];

  return {
    name: texte(corps.name) || 'Agenda externe',
    kind: corps.kind === 'outlook' ? 'outlook' : 'caldav',
    server_url: texte(corps.server_url),
    username: texte(corps.username),
    calendar_path: texte(corps.calendar_path),
    client_id: texte(corps.client_id),
    tenant_id: texte(corps.tenant_id),
    direction: ['import', 'export', 'deux_sens'].includes(corps.direction)
      ? corps.direction
      : 'export',
    natures: JSON.stringify(listeDeTermes(corps.natures)),
    category_ids: JSON.stringify(listeDeNombres(corps.category_ids)),
    include_uncategorized: corps.include_uncategorized === false ? 0 : 1,
    color: texte(corps.color) || '#10b981',
    enabled: corps.enabled === false ? 0 : 1,
  };
}

/** POST /agendas - Ajouter un carnet. */
router.post('/agendas', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const champs = lireCorps(req.body);
    const maintenant = new Date().toISOString();
    const resultat = await db.execute(
      `INSERT INTO calendar_destinations
         (name, kind, server_url, username, password, calendar_path,
          client_id, client_secret, tenant_id, direction, natures, category_ids,
          include_uncategorized, color, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        champs.name, champs.kind, champs.server_url, champs.username,
        typeof req.body.password === 'string' ? req.body.password : '',
        champs.calendar_path, champs.client_id,
        typeof req.body.client_secret === 'string' ? req.body.client_secret : '',
        champs.tenant_id, champs.direction, champs.natures, champs.category_ids,
        champs.include_uncategorized, champs.color, champs.enabled, maintenant, maintenant,
      ]
    );

    await logService.info('other', `Agenda externe ajouté : ${champs.name}`, {}, { userId: req.user?.userId });
    const creee = await destinationParId(resultat.lastInsertRowid);
    res.status(201).json({ success: true, data: creee ? sansSecrets(creee) : null });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /agendas/:id - Modifier un carnet.
 *
 * Un secret affiché en pastilles revient tel quel : le réécrire viderait le mot
 * de passe à chaque enregistrement d'un simple changement de règle.
 */
router.put('/agendas/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existante = await destinationParId(req.params.id);
    if (!existante) {
      return res.status(404).json({ success: false, message: 'Agenda non trouvé' });
    }

    const champs = lireCorps(req.body);
    const secret = (recu: unknown, actuel: string): string =>
      typeof recu === 'string' && recu !== '••••••••' ? recu : actuel;

    await db.execute(
      `UPDATE calendar_destinations SET
         name = ?, kind = ?, server_url = ?, username = ?, password = ?, calendar_path = ?,
         client_id = ?, client_secret = ?, tenant_id = ?, direction = ?, natures = ?,
         category_ids = ?, include_uncategorized = ?, color = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
      [
        champs.name, champs.kind, champs.server_url, champs.username,
        secret(req.body.password, existante.password), champs.calendar_path,
        champs.client_id, secret(req.body.client_secret, existante.client_secret),
        champs.tenant_id, champs.direction, champs.natures, champs.category_ids,
        champs.include_uncategorized, champs.color, champs.enabled,
        new Date().toISOString(), req.params.id,
      ]
    );

    const miseAJour = await destinationParId(req.params.id);
    res.json({ success: true, data: miseAJour ? sansSecrets(miseAJour) : null });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /agendas/:id - Retirer un carnet.
 *
 * Ce qui a été déposé là-bas y reste : l'application n'a pas à vider l'agenda
 * de quelqu'un parce qu'on débranche la liaison. La mémoire de ce qui a été
 * poussé part avec la destination (cascade), et les événements importés de ce
 * carnet sont retirés du calendrier — ils n'ont plus de source.
 */
router.delete('/agendas/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existante = await destinationParId(req.params.id);
    if (!existante) {
      return res.status(404).json({ success: false, message: 'Agenda non trouvé' });
    }

    await db.execute('DELETE FROM calendar_events WHERE external_calendar_id = ?', [req.params.id]);
    await db.execute('DELETE FROM calendar_destinations WHERE id = ?', [req.params.id]);

    await logService.warning('other', `Agenda externe retiré : ${existante.name}`, {}, { userId: req.user?.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** POST /agendas/:id/test - Le carnet répond-il, et accepte-t-il les identifiants ? */
router.post('/agendas/:id/test', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const cible = await destinationParId(req.params.id);
    if (!cible) {
      return res.status(404).json({ success: false, message: 'Agenda non trouvé' });
    }
    await tester(cible);
    res.json({ success: true, message: 'Connexion réussie' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /agendas/:id/apercu - Ce que l'export enverrait, sans rien envoyer.
 *
 * Un aiguillage se règle autrement à l'aveugle : on coche des natures et des
 * catégories sans savoir combien d'événements cela représente, et on ne le
 * découvre qu'une fois le carnet de quelqu'un d'autre rempli.
 */
router.get('/agendas/:id/apercu', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const cible = await destinationParId(req.params.id);
    if (!cible) {
      return res.status(404).json({ success: false, message: 'Agenda non trouvé' });
    }
    res.json({ success: true, data: await apercuExport(cible) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** POST /agendas/:id/sync - Synchroniser ce carnet seul. */
router.post('/agendas/:id/sync', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const cible = await destinationParId(req.params.id);
    if (!cible) {
      return res.status(404).json({ success: false, message: 'Agenda non trouvé' });
    }
    res.json({ success: true, data: await synchroniserDestination(cible) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
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
       WHERE date(start_date) >= CURRENT_DATE AND date(start_date) <= ${db.dateDecalee(Number(days))}${filtre?.sql ?? ''}
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

// GET /api/calendar/sync/status - Ce que les carnets ont donné au dernier passage
//
// Rend la liste des destinations plutôt qu'un couple Outlook/CalDAV figé : il
// n'y a plus « un » agenda externe mais autant que la commune en branche.
router.get('/sync/status', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const liste = await destinations();
    res.json({
      success: true,
      agendas: liste.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        direction: d.direction,
        enabled: d.enabled,
        lastSync: d.last_sync,
        lastError: d.last_error,
        color: d.color,
      })),
      // Un carnet en panne se voit sans avoir à ouvrir les réglages.
      enErreur: liste.filter((d) => d.enabled && d.last_error).length,
    });
  } catch (error: any) {
    console.error('Erreur get sync status:', error);
    res.json({ success: true, agendas: [], enErreur: 0 });
  }
});

/**
 * Un passage complet sur un carnet : ce qu'il donne, ce qu'il reçoit.
 *
 * L'échec est noté sur la destination plutôt que remonté seul : avec plusieurs
 * carnets, un serveur injoignable ne doit pas empêcher les autres de passer, et
 * la raison doit rester lisible après coup dans l'écran des réglages.
 */
async function synchroniserDestination(d: Destination): Promise<{
  id: number;
  name: string;
  importes: number;
  envoyes: number;
  retires: number;
  erreur: string | null;
}> {
  const bilan = { id: d.id, name: d.name, importes: 0, envoyes: 0, retires: 0, erreur: null as string | null };

  try {
    if (d.direction === 'import' || d.direction === 'deux_sens') {
      const recus = d.kind === 'caldav' ? await importerCaldav(d) : await importerOutlook(d);
      bilan.importes = recus.count;
    }
    if (d.direction === 'export' || d.direction === 'deux_sens') {
      const envoi = await exporterVers(d);
      bilan.envoyes = envoi.envoyes;
      bilan.retires = envoi.retires;
    }
    await noterPassage(d.id);
  } catch (erreur: any) {
    bilan.erreur = erreur?.message ?? 'Échec de la synchronisation';
    await noterPassage(d.id, bilan.erreur ?? undefined);
  }

  return bilan;
}

/**
 * POST /api/calendar/sync - Faire passer tous les carnets actifs.
 *
 * Reste ouverte à tout compte authentifié, comme avant : déclencher une
 * synchronisation ne révèle rien et ne configure rien. Seul le réglage des
 * carnets demande le rôle de superviseur.
 */
router.post('/sync', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const liste = (await destinations()).filter((d) => d.enabled);
    const resultats = [];
    for (const d of liste) {
      resultats.push(await synchroniserDestination(d));
    }
    res.json({ success: true, results: resultats });
  } catch (error: any) {
    console.error('Erreur sync:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

async function importerOutlook(d: Destination): Promise<{ count: number }> {
  try {
    // Obtenir un token d'accès
    const tokenEndpoint = `https://login.microsoftonline.com/${d.tenant_id}/oauth2/v2.0/token`;
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: d.client_id,
        client_secret: d.client_secret,
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
    // Seulement les siens, pour la même raison que côté CalDAV.
    await db.execute(
      "DELETE FROM calendar_events WHERE source = 'outlook' AND external_calendar_id = ?",
      [d.id]
    );

    let count = 0;
    for (const event of events) {
      await db.execute(
        `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, source, external_id, external_calendar_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'outlook', ?, ?, ?)`,
        [
          event.subject,
          event.bodyPreview || '',
          event.start?.dateTime || null,
          event.end?.dateTime || null,
          event.isAllDay ? 1 : 0,
          d.color,
          event.id,
          d.id,
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
async function importerCaldav(d: Destination): Promise<{ count: number }> {
  try {
    const auth = Buffer.from(`${d.username}:${d.password}`).toString('base64');
    const calendarUrl = d.calendar_path 
      ? `${d.server_url}${d.calendar_path}`
      : d.server_url;

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

    // Seulement les siens : deux carnets CalDAV s'effaçaient l'un l'autre à
    // chaque passage, chacun croyant que « source = caldav » le désignait.
    await db.execute(
      "DELETE FROM calendar_events WHERE source = 'caldav' AND external_calendar_id = ?",
      [d.id]
    );

    let count = 0;
    for (const event of events) {
      await db.execute(
        `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, source, external_id, external_calendar_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'caldav', ?, ?, ?)`,
        [
          event.summary,
          event.description || '',
          event.dtstart,
          event.dtend,
          event.allDay ? 1 : 0,
          d.color,
          event.uid,
          d.id,
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
