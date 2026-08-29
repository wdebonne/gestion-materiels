import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireSupervisor } from '../middleware/auth.middleware';
import {
  filtreManifestations,
  filtreStock,
  peutVoirManifestation,
  REFUS_PORTEE_MANIFESTATION,
} from '../middleware/manifestationScope';
import { logService } from '../services/log.service';
import {
  approbationsDe,
  approbationsEnAttente,
  creerApprobationsManquantes,
  peutDeciderPour,
  servicesDe,
} from '../services/manifestationServices.service';
import {
  notifierDecision,
  notifierMessage,
  notifierSollicitation,
  notifierServicesConcernes,
  notifierChangementDates,
  notifierChangementMateriel,
} from '../services/manifestationNotify.service';
import { notifierWebhooks } from '../services/webhook.service';
import {
  aujourdHui,
  detecterConflits,
  disponibiliteSur,
  enregistrerMouvement,
  enrichirStock,
  periodeDe,
} from '../services/manifestationStock.service';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';
import { normaliserLibelle } from '../utils/normaliserLibelle';

const router = Router();

// ======================== STOCK MATÉRIEL ========================

// GET /stock - Liste du stock, avec engagement réel et prévisionnel
//
// `date_from`/`date_to` répondent à « qu'aurai-je de disponible le 14 juillet ? »,
// question que ni cette route ni `/stock/availability` ne savaient traiter.
router.get('/stock', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { search, category, etat, lieu, stock_type, category_id, subcategory_id, date_from, date_to } = req.query;

    const portee = await filtreStock(req, 'ms');
    if (portee === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    let sql = `
      SELECT ms.*, c.name as category_name, c.slug as category_slug,
        sc.name as subcategory_name
      FROM manifestation_stock ms
      LEFT JOIN categories c ON c.id = ms.category_id
      LEFT JOIN subcategories sc ON sc.id = ms.subcategory_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search) {
      sql += ' AND (ms.name LIKE ? OR ms.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      sql += ' AND ms.category = ?';
      params.push(category);
    }
    if (etat) {
      sql += ' AND ms.etat = ?';
      params.push(etat);
    }
    if (lieu) {
      sql += ' AND ms.lieu = ?';
      params.push(lieu);
    }
    if (stock_type) {
      sql += ' AND ms.stock_type = ?';
      params.push(stock_type);
    }
    if (category_id) {
      sql += ' AND ms.category_id = ?';
      params.push(category_id);
    }
    if (subcategory_id) {
      sql += ' AND ms.subcategory_id = ?';
      params.push(subcategory_id);
    }

    sql += portee.sql;
    params.push(...portee.params);
    sql += ' ORDER BY ms.category, ms.name';

    const stock = await db.query(sql, params);
    const periode = date_from
      ? { debut: String(date_from), fin: String(date_to || date_from) }
      : null;

    res.json({ success: true, data: await enrichirStock(stock, periode) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== ALIAS D'ARTICLES ========================
//
// Le formulaire dit « tables », le stock dit « Table 180 cm ». Sans alias,
// chaque demande reçue obligerait à rattacher le matériel à la main, demande
// après demande. Les alias sont lus par l'appariement de la réception
// (`manifestationIntake.service.ts`).

// GET /stock/:id/aliases - Alias d'un article
router.get('/stock/:id/aliases', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const alias = await db.query(
      'SELECT * FROM manifestation_stock_aliases WHERE stock_id = ? ORDER BY alias',
      [req.params.id]
    );
    res.json({ success: true, data: alias });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /stock/:id/aliases - Ajouter un alias
router.post('/stock/:id/aliases', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const alias = String(req.body.alias ?? '').trim();
    if (!alias) {
      return res.status(400).json({ success: false, message: "L'alias ne peut pas être vide" });
    }

    const article = await db.queryOne('SELECT id FROM manifestation_stock WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ success: false, message: 'Article introuvable' });

    // Deux articles qui répondent au même alias rendraient l'appariement
    // arbitraire : mieux vaut refuser et laisser choisir.
    const deja = await db.query('SELECT stock_id, alias FROM manifestation_stock_aliases');
    const conflit = deja.find(
      (a: any) => normaliserLibelle(a.alias) === normaliserLibelle(alias) && a.stock_id !== Number(req.params.id)
    );
    if (conflit) {
      const porteur = await db.queryOne('SELECT name FROM manifestation_stock WHERE id = ?', [conflit.stock_id]);
      return res.status(400).json({
        success: false,
        message: `Cet alias est déjà utilisé par « ${porteur?.name ?? 'un autre article'} »`
      });
    }

    const resultat = await db.execute(
      'INSERT INTO manifestation_stock_aliases (stock_id, alias, created_at) VALUES (?, ?, ?)',
      [req.params.id, alias, new Date().toISOString()]
    );
    res.status(201).json({ success: true, data: { id: resultat.lastInsertRowid, stock_id: Number(req.params.id), alias } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /stock/aliases/:aliasId - Retirer un alias
router.delete('/stock/aliases/:aliasId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM manifestation_stock_aliases WHERE id = ?',
      [req.params.aliasId]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Alias introuvable' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/categories - Liste des catégories distinctes
router.get('/stock/categories', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await db.query(
      "SELECT DISTINCT category FROM manifestation_stock WHERE category != '' ORDER BY category"
    );
    res.json({ success: true, data: categories.map((c: any) => c.category) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/etats - Liste des états distincts
router.get('/stock/etats', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const etats = await db.query(
      "SELECT DISTINCT etat FROM manifestation_stock WHERE etat != '' ORDER BY etat"
    );
    res.json({ success: true, data: etats.map((e: any) => e.etat) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/lieux - Liste des lieux distincts
router.get('/stock/lieux', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const lieux = await db.query(
      "SELECT DISTINCT lieu FROM manifestation_stock WHERE lieu != '' ORDER BY lieu"
    );
    res.json({ success: true, data: lieux.map((l: any) => l.lieu) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/types - Liste des types distincts
router.get('/stock/types', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const types = await db.query(
      "SELECT DISTINCT stock_type FROM manifestation_stock WHERE stock_type != '' ORDER BY stock_type"
    );
    res.json({ success: true, data: types.map((t: any) => t.stock_type) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /stock - Créer un article de stock
router.post('/stock', authenticateToken, requireSupervisor,
  body('name').notEmpty().withMessage('Le nom est requis'),
  body('quantity_total').isInt({ min: 0 }).withMessage('Quantité invalide'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price } = req.body;
      const result = await db.execute(
        'INSERT INTO manifestation_stock (name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0]
      );
      await logService.info('other', `Stock manifestation créé: ${name}`, { userId: req.user!.userId });
      const created = await db.queryOne('SELECT * FROM manifestation_stock WHERE id = ?', [result.lastInsertRowid]);
      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /stock/:id - Modifier un article de stock
router.put('/stock/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price } = req.body;
    await db.execute(
      `UPDATE manifestation_stock SET name = ?, description = ?, category = ?, quantity_total = ?, unit = ?, etat = ?, lieu = ?, stock_type = ?, category_id = ?, subcategory_id = ?, price = ?, updated_at = datetime('now') WHERE id = ?`,
      [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0, req.params.id]
    );
    const updated = await db.queryOne('SELECT * FROM manifestation_stock WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /stock/:id - Supprimer un article
router.delete('/stock/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    // Vérifier qu'il n'est pas utilisé dans des manifestations actives
    const used = await db.queryOne(`
      SELECT COUNT(*) as cnt FROM manifestation_materials mm
      JOIN manifestations m ON m.id = mm.manifestation_id
      WHERE mm.stock_id = ? AND m.status NOT IN ('archived', 'cancelled')
    `, [req.params.id]);
    if (used?.cnt > 0) {
      return res.status(400).json({ success: false, message: 'Cet article est utilisé dans des manifestations actives' });
    }
    await db.execute('DELETE FROM manifestation_stock WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stock/availability - Disponibilité sur une date ou une période
//
// `date` reste accepté pour ne pas casser les appels existants ; `date_from` et
// `date_to` permettent d'interroger toute la durée d'une manifestation, ce qui
// est la vraie question quand on reçoit une demande.
router.get('/stock/availability', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { date, date_from, date_to } = req.query;
    const debut = String(date_from || date || aujourdHui());
    const fin = String(date_to || date || debut);

    const portee = await filtreStock(req, 'ms');
    if (portee === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const stock = await db.query(
      `SELECT ms.* FROM manifestation_stock ms WHERE 1=1${portee.sql} ORDER BY ms.category, ms.name`,
      portee.params
    );
    const engagements = await disponibiliteSur(stock.map((item: any) => item.id), debut, fin);

    const enriched = stock.map((item: any) => {
      const engage = engagements.get(item.id);
      const previsionnel = engage?.engage_previsionnel ?? 0;
      const reel = engage?.engage_reel ?? 0;

      return {
        ...item,
        engage_previsionnel: previsionnel,
        engage_reel: reel,
        // `quantity_engaged` et `quantity_available` gardent leur nom : ils sont
        // déjà lus ailleurs. Ils portent désormais le total engagé, réel comme
        // promis — c'est ce qu'un agent veut voir avant de promettre à son tour.
        quantity_engaged: previsionnel + reel,
        quantity_available: item.quantity_total - previsionnel - reel,
        disponible_reel: item.quantity_total - reel,
      };
    });

    res.json({ success: true, data: enriched, periode: { debut, fin } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== STATS / DASHBOARD ========================

// GET /stats/summary - Statistiques globales
router.get('/stats/summary', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    // `date('now')` est propre à SQLite : la date est passée en paramètre pour
    // que le décompte soit juste aussi sur MySQL.
    const jour = aujourdHui();
    const total = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status != 'archived'");
    const pending = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status = 'pending'");
    const upcoming = await db.queryOne(
      "SELECT COUNT(*) as cnt FROM manifestations WHERE status IN ('pending', 'draft', 'validated') AND date_start >= ?",
      [jour]
    );
    const delivered = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status = 'delivered'");
    const archived = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestations WHERE status = 'archived'");
    const stockItems = await db.queryOne("SELECT COUNT(*) as cnt FROM manifestation_stock");

    res.json({
      success: true,
      data: {
        total: total?.cnt || 0,
        pending: pending?.cnt || 0,
        upcoming: upcoming?.cnt || 0,
        delivered: delivered?.cnt || 0,
        archived: archived?.cnt || 0,
        stockItems: stockItems?.cnt || 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MANIFESTATIONS ========================

// GET / - Liste des manifestations avec filtres
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, archived, date_from, date_to } = req.query;

    const portee = await filtreManifestations(req, 'm');
    if (portee === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    let sql = `
      SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
      FROM manifestations m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (archived === 'true') {
      sql += " AND m.status = 'archived'";
    } else if (!status) {
      sql += " AND m.status != 'archived'";
    }
    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (m.title LIKE ? OR m.contact_name LIKE ? OR m.delivery_address LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (date_from) {
      sql += ' AND m.date_start >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND m.date_start <= ?';
      params.push(date_to);
    }

    sql += portee.sql;
    params.push(...portee.params);
    sql += ' ORDER BY m.date_start DESC';

    const manifestations = await db.query(sql, params);

    // Matériaux de toutes les manifestations en une requête
    const materiauxParManifestation = await grouperEnfants(
      (marqueurs) => `
        SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category
        FROM manifestation_materials mm
        JOIN manifestation_stock ms ON ms.id = mm.stock_id
        WHERE mm.manifestation_id IN (${marqueurs})
      `,
      manifestations.map((m: any) => m.id),
      'manifestation_id'
    );

    const enriched = manifestations.map((m: any) => ({
      ...m,
      materials: enfantsDe(materiauxParManifestation, m.id)
    }));

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Faut-il toutes les approbations avant de valider ?
 *
 * Réglage `manifestation_require_all_approvals`, sur le même mécanisme clé/valeur
 * que `alert_settings`. Vrai par défaut : c'est le comportement qui protège, et
 * l'assouplir doit être une décision consciente.
 */
async function exigerToutesLesApprobations(): Promise<boolean> {
  try {
    const reglage = await db.queryOne(
      "SELECT setting_value FROM settings WHERE setting_key = 'manifestation_require_all_approvals'"
    );
    return reglage?.setting_value !== 'false';
  } catch {
    return true;
  }
}

/** Libellé lisible de chaque transition, pour que l'historique se lise sans décodeur. */
const LIBELLES_TRANSITION: Record<string, string> = {
  pending: 'Retour en attente de confirmation',
  draft: 'Retour en brouillon',
  validated: 'Validation',
  delivered: 'Livraison',
  recovered: 'Récupération',
  archived: 'Archivage',
  cancelled: 'Annulation',
};

/**
 * Consigne un événement dans l'historique d'une manifestation.
 *
 * La table `manifestation_history` était créée depuis le début et n'était ni
 * écrite ni lue : le README et la feuille de route annonçaient une « timeline
 * horodatée de toutes les actions » qui n'existait nulle part. Un prêt de
 * matériel pour un événement municipal engage la collectivité — savoir qui a
 * validé, qui a livré et à quelle date est le minimum.
 *
 * L'écriture ne doit jamais faire échouer l'action qu'elle décrit : perdre une
 * ligne d'historique est moins grave que perdre une livraison.
 */
export async function consignerHistorique(
  manifestationId: number | string,
  userId: number | undefined,
  action: string,
  details: { fromStatus?: string | null; toStatus?: string | null; comment?: string | null } = {}
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO manifestation_history (manifestation_id, user_id, action, from_status, to_status, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        manifestationId,
        userId ?? null,
        action,
        details.fromStatus ?? null,
        details.toStatus ?? null,
        details.comment?.trim() || null,
        new Date().toISOString(),
      ]
    );
  } catch (erreur: any) {
    console.error('Historique manifestation non enregistré:', erreur.message);
  }
}

/** Historique d'une manifestation, du plus récent au plus ancien. */
export async function lireHistorique(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT h.*, u.first_name, u.last_name, u.email
     FROM manifestation_history h
     LEFT JOIN users u ON u.id = h.user_id
     WHERE h.manifestation_id = ?
     ORDER BY h.created_at DESC, h.id DESC`,
    [manifestationId]
  );
}

// GET /:id - Détail d'une manifestation
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne(`
      SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
      FROM manifestations m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = ?
    `, [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });

    // La liste filtrait, le détail non : la même fuite que celle corrigée sur
    // les matériels par `objectScope`.
    if (!(await peutVoirManifestation(req, m.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const materials = await db.query(`
      SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category, ms.quantity_total as stock_total
      FROM manifestation_materials mm
      JOIN manifestation_stock ms ON ms.id = mm.stock_id
      WHERE mm.manifestation_id = ?
    `, [m.id]);

    const history = await lireHistorique(m.id);

    res.json({ success: true, data: { ...m, materials, history } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id/history - Historique seul
router.get('/:id/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne('SELECT id FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });
    if (!(await peutVoirManifestation(req, m.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    res.json({ success: true, data: await lireHistorique(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST / - Créer une manifestation
router.post('/', authenticateToken, requireSupervisor,
  body('title').notEmpty().withMessage('Le titre est requis'),
  body('date_start').notEmpty().withMessage('La date de début est requise'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const {
        title, date_start, date_end, start_time, end_time, expected_people,
        contact_name, contact_phone, contact_email, delivery_address, delivery_date,
        recovery_date, notes_interior, notes_exterior, materials
      } = req.body;

      const result = await db.execute(`
        INSERT INTO manifestations (title, date_start, date_end, start_time, end_time, expected_people,
          contact_name, contact_phone, contact_email, delivery_address, delivery_date,
          recovery_date, notes_interior, notes_exterior, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
      `, [
        title, date_start, date_end || null, start_time || null, end_time || null,
        expected_people || 0, contact_name || '', contact_phone || '', contact_email || '',
        delivery_address || '', delivery_date || null, recovery_date || null,
        notes_interior || '', notes_exterior || '', req.user!.userId
      ]);

      const manifestationId = result.lastInsertRowid;

      // Insérer les matériaux demandés
      if (materials && Array.isArray(materials)) {
        for (const mat of materials) {
          await db.execute(
            'INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested, unit_value, notes) VALUES (?, ?, ?, ?, ?)',
            [manifestationId, mat.stock_id, mat.quantity_requested || 0, mat.unit_value || 0, mat.notes || '']
          );
        }
      }

      await consignerHistorique(manifestationId, req.user!.userId, 'Création', { toStatus: 'draft' });
      await logService.info('other', `Manifestation créée: ${title}`, { userId: req.user!.userId });
      const created = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [manifestationId]);

      // Avertissement, jamais refus : la manifestation est enregistrée telle
      // qu'elle a été demandée, et le manque est signalé pour être arbitré.
      const periode = periodeDe(created);
      const conflits = await detecterConflits(
        Array.isArray(materials) ? materials : [],
        periode.debut,
        periode.fin,
        manifestationId
      );

      // Les services concernés sont sollicités dès la création : c'est ce qui
      // rend le tableau des approbations lisible avant même la validation.
      const sollicites = await creerApprobationsManquantes(manifestationId, req.user!.userId);
      notifierServicesConcernes(manifestationId, title, sollicites);

      notifierWebhooks('manifestation.created', { id: manifestationId, title, status: 'draft' });
      res.status(201).json({ success: true, data: created, conflits });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /:id - Modifier une manifestation
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Non trouvée' });
    if (existing.status === 'archived') return res.status(400).json({ success: false, message: 'Manifestation archivée' });

    const {
      title, date_start, date_end, start_time, end_time, expected_people,
      contact_name, contact_phone, contact_email, delivery_address, delivery_date,
      recovery_date, notes_interior, notes_exterior, materials
    } = req.body;

    await db.execute(`
      UPDATE manifestations SET title = ?, date_start = ?, date_end = ?, start_time = ?, end_time = ?,
        expected_people = ?, contact_name = ?, contact_phone = ?, contact_email = ?,
        delivery_address = ?, delivery_date = ?, recovery_date = ?,
        notes_interior = ?, notes_exterior = ?, updated_at = ?
      WHERE id = ?
    `, [
      title, date_start, date_end || null, start_time || null, end_time || null,
      expected_people || 0, contact_name || '', contact_phone || '', contact_email || '',
      delivery_address || '', delivery_date || null, recovery_date || null,
      notes_interior || '', notes_exterior || '', new Date().toISOString(), req.params.id
    ]);

    // Mettre à jour les matériaux: supprimer puis réinsérer
    if (materials && Array.isArray(materials)) {
      // Les pertes déjà constatées ont diminué le stock physique. Les
      // réinsérer à zéro parce que le formulaire ne les renvoie pas ferait
      // disparaître la trace d'une casse dont le stock, lui, garde la marque.
      const precedentes = await db.query(
        'SELECT stock_id, quantity_lost, loss_reason FROM manifestation_materials WHERE manifestation_id = ?',
        [req.params.id]
      );
      const pertesConnues = new Map<any, any>(precedentes.map((l: any) => [l.stock_id, l]));

      await db.execute('DELETE FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]);
      for (const mat of materials) {
        const perte = pertesConnues.get(mat.stock_id);
        await db.execute(
          `INSERT INTO manifestation_materials
             (manifestation_id, stock_id, quantity_requested, quantity_delivered, quantity_recovered,
              quantity_lost, loss_reason, unit_value, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.params.id, mat.stock_id, mat.quantity_requested || 0,
            mat.quantity_delivered || 0, mat.quantity_recovered || 0,
            mat.quantity_lost ?? perte?.quantity_lost ?? 0,
            mat.loss_reason ?? perte?.loss_reason ?? null,
            mat.unit_value || 0, mat.notes || ''
          ]
        );
      }
    }

    await consignerHistorique(req.params.id, req.user!.userId, 'Modification');
    await logService.info('other', `Manifestation modifiée: ${title}`, { userId: req.user!.userId });

    const apres = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);

    // Un changement de date est la modification qui coûte le plus cher : un
    // service qui a bloqué une équipe sur un créneau doit l'apprendre autrement
    // qu'en se déplaçant le mauvais jour.
    notifierChangementDates(
      req.params.id,
      apres.title,
      { debut: existing.date_start, livraison: existing.delivery_date, recuperation: existing.recovery_date },
      { debut: apres.date_start, livraison: apres.delivery_date, recuperation: apres.recovery_date }
    );

    // Le matériel a pu changer : de nouveaux services peuvent être concernés.
    if (Array.isArray(materials)) {
      const nouvelles = await creerApprobationsManquantes(req.params.id, req.user!.userId);
      notifierServicesConcernes(req.params.id, apres.title, nouvelles);
      notifierChangementMateriel(req.params.id, apres.title, `${materials.length} ligne(s) de matériel`);
    }
    const periode = periodeDe(apres);
    const conflits = await detecterConflits(
      Array.isArray(materials) ? materials : [],
      periode.debut,
      periode.fin,
      req.params.id
    );

    notifierWebhooks('manifestation.updated', { id: Number(req.params.id), title });
    res.json({ success: true, conflits });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /:id/status - Changer le statut d'une manifestation
router.put('/:id/status', authenticateToken, requireSupervisor,
  body('status').isIn(['pending', 'draft', 'validated', 'delivered', 'recovered', 'archived', 'cancelled']),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { status, comment } = req.body;
      const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
      if (!m) return res.status(404).json({ success: false, message: 'Non trouvée' });

      // Transitions autorisées.
      //
      // `pending` est le statut d'une demande reçue d'un formulaire : elle
      // réserve le matériel au prévisionnel sans rien engager de réel, tant que
      // personne ne l'a confirmée. On peut la valider directement, la reprendre
      // en brouillon pour la compléter, ou la refuser.
      const transitions: Record<string, string[]> = {
        pending: ['validated', 'draft', 'cancelled'],
        draft: ['validated', 'cancelled'],
        validated: ['delivered', 'cancelled', 'draft'],
        delivered: ['recovered'],
        recovered: ['archived'],
        cancelled: ['draft'],
        archived: []
      };

      if (!transitions[m.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Transition de "${m.status}" vers "${status}" non autorisée`
        });
      }

      // Confirmer une manifestation, c'est engager les services qui la
      // servent. Tant que l'un d'eux n'a pas répondu, la valider reviendrait à
      // promettre à sa place — et c'est le jour de la livraison qu'on
      // découvrirait que le vidéoprojecteur n'était pas disponible.
      //
      // Les sollicitations manquantes sont créées **avant** le contrôle : une
      // manifestation créée directement en brouillon n'en avait aucune, si bien
      // que le contrôle ne trouvait rien à attendre et laissait passer la
      // validation — puis créait les approbations juste après, trop tard.
      //
      // Le blocage est réglable : certaines collectivités préfèrent valider
      // d'abord et régulariser ensuite.
      if (status === 'validated') {
        const nouvelles = await creerApprobationsManquantes(req.params.id, req.user!.userId);
        notifierServicesConcernes(req.params.id, m.title, nouvelles);

        if (await exigerToutesLesApprobations()) {
          const attendues = await approbationsEnAttente(req.params.id);
          if (attendues.length > 0) {
            const noms = attendues.map((a: any) => a.service_name || 'un destinataire').join(', ');
            return res.status(409).json({
              success: false,
              message: `En attente de : ${noms}`,
              approbations_en_attente: attendues,
            });
          }
        }
      }

      // Si on passe en "delivered", enregistrer les quantités livrées depuis les quantités demandées si pas déjà fait
      if (status === 'delivered') {
        const materials = await db.query(
          'SELECT * FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]
        );
        for (const mat of materials) {
          if (mat.quantity_delivered === 0) {
            await db.execute(
              'UPDATE manifestation_materials SET quantity_delivered = quantity_requested WHERE id = ?',
              [mat.id]
            );
          }
        }
      }

      const archiveDate = status === 'archived' ? "datetime('now')" : 'NULL';
      await db.execute(
        `UPDATE manifestations SET status = ?, archived_at = ${archiveDate}, updated_at = datetime('now') WHERE id = ?`,
        [status, req.params.id]
      );

      await consignerHistorique(req.params.id, req.user!.userId, LIBELLES_TRANSITION[status] ?? 'Changement de statut', {
        fromStatus: m.status,
        toStatus: status,
        comment,
      });
      await logService.info('other', `Manifestation "${m.title}" → ${status}`, { userId: req.user!.userId });
      notifierWebhooks('manifestation.status_changed', {
        id: Number(req.params.id),
        title: m.title,
        from: m.status,
        to: status,
      });

      // Une demande reprise en brouillon sollicite aussi les services concernés :
      // c'est le moment où quelqu'un s'en saisit pour la compléter.
      if (status === 'draft') {
        const nouvelles = await creerApprobationsManquantes(req.params.id, req.user!.userId);
        notifierServicesConcernes(req.params.id, m.title, nouvelles);
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// PUT /:id/materials - Quantités réellement demandées, livrées, récupérées, perdues
//
// C'est ici que le stock cesse d'être théorique. Un agent revient de terrain
// avec « ils n'avaient besoin que de 8 tables sur 10 », ou « 12 chaises livrées,
// 11 revenues, 1 cassée ». La casse et le vol diminuent le stock physique : sans
// cette écriture, le total resterait celui de l'achat et s'éloignerait un peu
// plus du réel à chaque manifestation.
router.put('/:id/materials', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { materials } = req.body;
    if (!materials || !Array.isArray(materials)) {
      return res.status(400).json({ success: false, message: 'Données de matériaux requises' });
    }

    // Les lignes actuelles servent de référence : une perte déjà enregistrée a
    // déjà diminué le stock, seul l'écart doit être appliqué. Sans cela, un
    // simple réenregistrement retirerait une deuxième fois la même chaise.
    const existantes = await db.query(
      `SELECT mm.*, ms.name as stock_name, ms.unit
       FROM manifestation_materials mm
       JOIN manifestation_stock ms ON ms.id = mm.stock_id
       WHERE mm.manifestation_id = ?`,
      [req.params.id]
    );
    const parLigne = new Map<any, any>(existantes.map((l: any) => [l.id, l]));

    // `changes` est compté : la route répondait 200 même quand aucune ligne ne
    // correspondait, par exemple avec un identifiant de stock à la place de
    // l'identifiant de ligne.
    let modifiees = 0;
    const mouvements: Array<{ stockId: number; ecart: number; raison: string | null }> = [];
    const resume: string[] = [];

    for (const mat of materials) {
      const avant = parLigne.get(mat.id);
      if (!avant) continue;

      const demande = mat.quantity_requested ?? avant.quantity_requested;
      const livre = mat.quantity_delivered ?? avant.quantity_delivered;
      const recupere = mat.quantity_recovered ?? avant.quantity_recovered;
      const perdu = mat.quantity_lost ?? avant.quantity_lost ?? 0;
      const raison = mat.loss_reason ?? avant.loss_reason ?? null;

      const r = await db.execute(
        `UPDATE manifestation_materials
         SET quantity_requested = ?, quantity_delivered = ?, quantity_recovered = ?,
             quantity_lost = ?, loss_reason = ?
         WHERE id = ? AND manifestation_id = ?`,
        [demande, livre, recupere, perdu, raison, mat.id, req.params.id]
      );
      modifiees += r.changes;

      if (r.changes === 0) continue;

      const ecart = perdu - (avant.quantity_lost ?? 0);
      if (ecart !== 0) {
        mouvements.push({ stockId: avant.stock_id, ecart, raison });
      }

      const morceaux = [`${avant.stock_name} : ${livre} livré(s)`, `${recupere} récupéré(s)`];
      if (perdu > 0) morceaux.push(`${perdu} perdu(s) ou cassé(s)`);
      resume.push(morceaux.join(', '));
    }

    if (modifiees === 0) {
      return res.status(400).json({
        success: false,
        message: "Aucune ligne de matériel ne correspond : vérifiez l'identifiant de ligne envoyé"
      });
    }

    // Les mouvements ne sont écrits qu'une fois les lignes acceptées : une
    // requête entièrement rejetée ne doit pas avoir touché au stock.
    for (const mouvement of mouvements) {
      await enregistrerMouvement(
        mouvement.stockId,
        req.params.id,
        mouvement.ecart > 0 ? 'perte' : 'entree',
        Math.abs(mouvement.ecart),
        mouvement.ecart > 0 ? mouvement.raison : 'Correction de perte',
        req.user!.userId
      );
    }

    await consignerHistorique(req.params.id, req.user!.userId, 'Quantités mises à jour', {
      comment: resume.join(' ; ') || `${modifiees} ligne(s) de matériel`
    });

    notifierWebhooks('manifestation.materials_updated', {
      id: Number(req.params.id),
      lignes: modifiees,
      pertes: mouvements.filter((m) => m.ecart > 0).length,
    });

    res.json({ success: true, updated: modifiees });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== APPROBATIONS PAR SERVICE ========================
//
// Une manifestation municipale engage plusieurs services. Chacun ne doit être
// sollicité que s'il est concerné — c'est-à-dire si la demande porte du matériel
// de ses catégories. Un service informatique alerté d'une brocante sans matériel
// informatique cesse vite de lire ses alertes, et rate celle qui comptait.

// GET /:id/approvals - Approbations et sollicitations d'une manifestation
router.get('/:id/approvals', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }
    res.json({ success: true, data: await approbationsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/approvals - Solliciter un service ou une personne.
 *
 * Sert aussi bien à demander une approbation qu'un simple avis. La distinction
 * compte : une demande d'information laissée sans réponse ne doit pas bloquer
 * une manifestation.
 */
router.post('/:id/approvals', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { service_id, user_id, kind, comment } = req.body;
    if (!service_id && !user_id) {
      return res.status(400).json({ success: false, message: 'Indiquez un service ou une personne' });
    }

    const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });

    const type = kind === 'information' ? 'information' : 'approbation';
    const resultat = await db.execute(
      `INSERT INTO manifestation_approvals
         (manifestation_id, service_id, user_id, kind, status, requested_by, requested_at, comment)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        req.params.id, service_id || null, user_id || null, type,
        req.user!.userId, new Date().toISOString(), comment?.trim() || null,
      ]
    );

    const libelle = type === 'information' ? "Demande d'information" : "Demande d'approbation";
    await consignerHistorique(req.params.id, req.user!.userId, libelle, { comment: comment?.trim() || null });
    notifierSollicitation(req.params.id, resultat.lastInsertRowid, m.title);

    res.status(201).json({ success: true, data: await approbationsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /:id/approvals/:approvalId - Rendre sa décision.
 *
 * Chaque service porte ses propres dates de livraison et de récupération : le
 * service informatique installe le vidéoprojecteur le matin, le service festif
 * livre les tables la veille.
 */
router.put('/:id/approvals/:approvalId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { status, comment, delivery_date, recovery_date } = req.body;
    if (!['approved', 'rejected', 'not_concerned'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Décision invalide' });
    }

    const approbation = await db.queryOne(
      'SELECT * FROM manifestation_approvals WHERE id = ? AND manifestation_id = ?',
      [req.params.approvalId, req.params.id]
    );
    if (!approbation) {
      return res.status(404).json({ success: false, message: 'Sollicitation non trouvée' });
    }

    // On ne décide que pour soi : sans cette garde, n'importe quel compte
    // pourrait approuver à la place du service informatique.
    const autorise = approbation.service_id
      ? await peutDeciderPour(req.user!.userId, req.user!.role, approbation.service_id)
      : approbation.user_id === req.user!.userId || req.user!.role === 'admin';

    if (!autorise) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez répondre que pour votre service',
      });
    }

    await db.execute(
      `UPDATE manifestation_approvals
       SET status = ?, decided_by = ?, decided_at = ?, comment = ?, delivery_date = ?, recovery_date = ?
       WHERE id = ?`,
      [
        status, req.user!.userId, new Date().toISOString(), comment?.trim() || null,
        delivery_date || null, recovery_date || null, req.params.approvalId,
      ]
    );

    const service = approbation.service_id
      ? await db.queryOne('SELECT name FROM services WHERE id = ?', [approbation.service_id])
      : null;
    const LIBELLES_DECISION: Record<string, string> = {
      approved: 'Approbation accordée',
      rejected: 'Approbation refusée',
      not_concerned: 'Service non concerné',
    };
    await consignerHistorique(req.params.id, req.user!.userId, LIBELLES_DECISION[status], {
      comment: [service?.name, comment?.trim()].filter(Boolean).join(' — ') || null,
    });

    const m = await db.queryOne('SELECT title FROM manifestations WHERE id = ?', [req.params.id]);
    notifierDecision(req.params.id, m?.title ?? '', status, service?.name ?? null, comment?.trim() || null);

    res.json({ success: true, data: await approbationsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== CONVERSATION ========================

// GET /:id/messages - Fil d'échange d'une manifestation
router.get('/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const messages = await db.query(
      `SELECT msg.*, (u.first_name || ' ' || u.last_name) as author_name, u.email as author_email,
              s.name as service_name
       FROM manifestation_messages msg
       LEFT JOIN users u ON u.id = msg.user_id
       LEFT JOIN services s ON s.id = msg.service_id
       WHERE msg.manifestation_id = ?
       ORDER BY msg.created_at, msg.id`,
      [req.params.id]
    );
    res.json({ success: true, data: messages });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/messages - Écrire dans le fil.
 *
 * Ouvert à tout compte qui voit la manifestation, rôle « service » compris :
 * c'est précisément ce que ces comptes viennent faire — signaler un changement
 * de date, demander un matériel de plus. Chaque message est aussi consigné dans
 * l'historique, pour que la chronologie reste l'unique source du suivi.
 */
router.post('/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const body = String(req.body.body ?? '').trim();
    if (!body) {
      return res.status(400).json({ success: false, message: 'Le message ne peut pas être vide' });
    }

    const m = await db.queryOne('SELECT id, title FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    // Le message est attribué au premier service de son auteur : dans le fil,
    // « Service informatique » est plus parlant qu'un nom seul.
    const [service] = await servicesDe(req.user!.userId);

    await db.execute(
      'INSERT INTO manifestation_messages (manifestation_id, user_id, service_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, req.user!.userId, service?.id ?? null, body, new Date().toISOString()]
    );

    await consignerHistorique(req.params.id, req.user!.userId, 'Message', {
      comment: body.length > 120 ? `${body.slice(0, 117)}…` : body,
    });
    notifierMessage(req.params.id, m.title, body);

    res.status(201).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== SUIVEURS ========================

// GET /:id/watchers - Personnes et services en copie du suivi
router.get('/:id/watchers', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const suiveurs = await db.query(
      `SELECT w.*, (u.first_name || ' ' || u.last_name) as user_name, u.email as user_email,
              s.name as service_name
       FROM manifestation_watchers w
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN services s ON s.id = w.service_id
       WHERE w.manifestation_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: suiveurs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/watchers - Mettre en copie du suivi : un DGS, un maire, un élu
router.post('/:id/watchers', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, service_id } = req.body;
    if (!user_id && !service_id) {
      return res.status(400).json({ success: false, message: 'Indiquez une personne ou un service' });
    }

    const deja = await db.queryOne(
      `SELECT id FROM manifestation_watchers
       WHERE manifestation_id = ? AND user_id IS ? AND service_id IS ?`,
      [req.params.id, user_id || null, service_id || null]
    );
    if (deja) return res.json({ success: true });

    await db.execute(
      'INSERT INTO manifestation_watchers (manifestation_id, user_id, service_id, added_by, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, user_id || null, service_id || null, req.user!.userId, new Date().toISOString()]
    );
    await consignerHistorique(req.params.id, req.user!.userId, 'Mise en copie');
    res.status(201).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id/watchers/:watcherId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM manifestation_watchers WHERE id = ? AND manifestation_id = ?',
      [req.params.watcherId, req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Suiveur non trouvé' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id - Supprimer une manifestation
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Non trouvée' });
    if (m.status === 'delivered') {
      return res.status(400).json({ success: false, message: 'Impossible de supprimer une manifestation en cours de livraison' });
    }
    await db.execute('DELETE FROM manifestation_materials WHERE manifestation_id = ?', [req.params.id]);
    await db.execute('DELETE FROM manifestations WHERE id = ?', [req.params.id]);
    await logService.info('other', `Manifestation supprimée: ${m.title}`, { userId: req.user!.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
