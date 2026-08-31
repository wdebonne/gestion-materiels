import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireFieldWrite, requireSupervisor } from '../middleware/auth.middleware';
import {
  filtreManifestations,
  filtreStock,
  peutVoirManifestation,
  REFUS_PORTEE_MANIFESTATION,
} from '../middleware/manifestationScope';
import { peutVoirObjet, REFUS_PORTEE } from '../middleware/objectScope';
import {
  ETATS_RETOUR,
  indisponibilites,
  objetsDe,
  parcAvecDisponibilite,
  remplacerObjets,
} from '../services/manifestationObjets.service';
import {
  arbreDisponibilite,
  estPretable,
  lireDisponibilite,
  objetsDeLaCategorie,
  rechercherObjetsPretables,
  versColonne,
} from '../services/materielPretable.service';
import { logService } from '../services/log.service';
import {
  approbationsDe,
  approbationsEnAttente,
  approbationsEnAttenteHorsCoordinateur,
  creerApprobationsManquantes,
  peutDeciderPour,
  serviceCoordinateur,
  servicesDe,
  toutEstApprouve,
} from '../services/manifestationServices.service';
import {
  notifierDecision,
  notifierMessage,
  notifierSollicitation,
  notifierChangementDates,
  notifierChangementMateriel,
  redeposerSuivi,
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
import slugify from '../utils/slugify';
import {
  detacher,
  documentPrecis,
  documentsDe,
  documentsVisiblesPar,
  joindre,
  supprimerFichier,
  typeValide,
  typesDocuments,
} from '../services/manifestationDocuments.service';
import {
  genererPourManifestation,
  produireEtNotifier,
} from '../services/generationDocuments.service';
import { manquesSurLots } from '../services/lotParc.service';
import { coutDe } from '../services/coutManifestation.service';

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
      const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price, is_prestation } = req.body;
      const result = await db.execute(
        'INSERT INTO manifestation_stock (name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price, is_prestation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0, is_prestation ? 1 : 0]
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
    const { name, description, category, quantity_total, unit, etat, lieu, stock_type, category_id, subcategory_id, price, is_prestation } = req.body;
    await db.execute(
      `UPDATE manifestation_stock SET name = ?, description = ?, category = ?, quantity_total = ?, unit = ?, etat = ?, lieu = ?, stock_type = ?, category_id = ?, subcategory_id = ?, price = ?, is_prestation = ?, updated_at = ? WHERE id = ?`,
      [name, description || '', category || '', quantity_total, unit || 'unité', etat || 'bon', lieu || '', stock_type || '', category_id || null, subcategory_id || null, price || 0, is_prestation ? 1 : 0, new Date().toISOString(), req.params.id]
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
      SELECT m.*, (CONCAT_WS(' ', u.first_name, u.last_name)) as created_by_name
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
      // Les pièces jointes entrent dans la recherche : « arrêté buvette » doit
      // ramener la manifestation dont un document porte ces mots, sans qu'on ait
      // à se souvenir de son titre.
      sql += ` AND (
        m.title LIKE ? OR m.contact_name LIKE ? OR m.delivery_address LIKE ?
        OR EXISTS (
          SELECT 1 FROM manifestation_documents md
          WHERE md.manifestation_id = m.id
            AND (md.name LIKE ? OR md.description LIKE ?)
        )
      )`;
      const motif = `%${search}%`;
      params.push(motif, motif, motif, motif, motif);
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
        SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category, ms.is_prestation
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

// ======================== TYPES DE PIÈCES JOINTES ========================
//
// Déclarées **avant** `GET /:id`, qui accepte n'importe quel segment : placées
// après, « /doc-types » serait pris pour un identifiant de manifestation et
// répondrait « non trouvée ». Le même piège avait déjà coûté la création des
// sources de réception.

/** GET /doc-types - Types proposés. `?tous=true` inclut les désactivés. */
router.get('/doc-types', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await typesDocuments(req.query.tous === 'true') });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/doc-types', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const label = String(req.body.label ?? '').trim();
    if (!label) return res.status(400).json({ success: false, message: 'Le libellé est requis' });

    // La valeur technique est dérivée du libellé : personne n'a à la saisir.
    const value = slugify(label);
    await db.execute(
      'INSERT INTO manifestation_doc_types (value, label, is_default, created_at) VALUES (?, ?, 0, ?)',
      [value, label, new Date().toISOString()]
    );

    res.status(201).json({ success: true, data: await typesDocuments(true) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Ce type de document existe déjà'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

/**
 * PUT /doc-types/:id - Renommer, activer ou désactiver.
 *
 * Désactiver plutôt que supprimer : les documents déjà classés sous ce type
 * garderaient sinon une valeur que plus rien ne nomme.
 */
router.put('/doc-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { label, disabled } = req.body;
    const resultat = await db.execute(
      'UPDATE manifestation_doc_types SET label = ?, disabled = ? WHERE id = ?',
      [String(label ?? '').trim(), disabled ? 1 : 0, req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Type non trouvé' });
    }
    res.json({ success: true, data: await typesDocuments(true) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/doc-types/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const type = await db.queryOne('SELECT * FROM manifestation_doc_types WHERE id = ?', [req.params.id]);
    if (!type) return res.status(404).json({ success: false, message: 'Type non trouvé' });

    // Un type semé fait partie du référentiel de base : on le désactive.
    if (type.is_default) {
      return res.status(400).json({
        success: false,
        message: 'Ce type fait partie du référentiel : désactivez-le plutôt que de le supprimer',
      });
    }

    const utilise = await db.queryOne(
      'SELECT COUNT(*) as cnt FROM manifestation_documents WHERE doc_type = ?',
      [type.value]
    );
    if (utilise?.cnt > 0) {
      return res.status(400).json({
        success: false,
        message: `${utilise.cnt} document(s) portent ce type : désactivez-le plutôt que de le supprimer`,
      });
    }

    await db.execute('DELETE FROM manifestation_doc_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: await typesDocuments(true) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id - Détail d'une manifestation
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne(`
      SELECT m.*, (CONCAT_WS(' ', u.first_name, u.last_name)) as created_by_name
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
      SELECT mm.*, ms.name as stock_name, ms.unit, ms.category as stock_category,
             ms.quantity_total as stock_total, ms.is_prestation
      FROM manifestation_materials mm
      JOIN manifestation_stock ms ON ms.id = mm.stock_id
      WHERE mm.manifestation_id = ?
    `, [m.id]);

    const history = await lireHistorique(m.id);
    // Deux natures de matériel : des quantités (`materials`) et des exemplaires
    // identifiés du parc (`objects`).
    const objects = await objetsDe(m.id);
    // Jointes au détail : la fiche PDF en fait l'inventaire, et l'onglet
    // Documents les affiche sans second appel.
    const documents = await documentsVisiblesPar(
      await documentsDe(m.id),
      req.user!.userId,
      req.user!.role
    );

    // Le coût est calculé à la lecture plutôt que stocké : les prix bougent,
    // les retours se saisissent après coup, et une valeur figée mentirait dès
    // la première correction.
    const cout = await coutDe(m.id);

    res.json({ success: true, data: { ...m, materials, objects, documents, history, cout } });
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
        recovery_date, notes_interior, notes_exterior, materials, objects
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

      // Matériels uniques du parc : un véhicule, un vidéoprojecteur identifié.
      if (Array.isArray(objects) && objects.length > 0) {
        await remplacerObjets(manifestationId, objects);
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
      const conflitsObjets = await indisponibilites(
        Array.isArray(objects) ? objects.map((o: any) => o.object_id) : [],
        periode.debut,
        periode.fin,
        manifestationId
      );
      // Un lot ne connaît pas le conflit mais le manque : ce n'est pas « le
      // camion est pris », c'est « il ne reste que 42 chaises sur 50 demandées ».
      const manquesLots = await manquesSurLots(
        Array.isArray(objects) ? objects : [],
        periode.debut,
        periode.fin,
        manifestationId
      );

      // Les services concernés sont sollicités dès la création : c'est ce qui
      // rend le tableau des approbations lisible avant même la validation.
      const sollicites = await creerApprobationsManquantes(manifestationId, req.user!.userId);
      produireEtNotifier(manifestationId, title, sollicites, req.user!.userId);

      notifierWebhooks('manifestation.created', { id: manifestationId, title, status: 'draft' });
      res.status(201).json({
        success: true,
        data: created,
        conflits,
        conflits_objets: conflitsObjets,
        manques_lots: manquesLots,
      });
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
      recovery_date, notes_interior, notes_exterior, materials, objects
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

    if (Array.isArray(objects)) {
      await remplacerObjets(req.params.id, objects);
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
      // Le matériel a changé : les documents déjà produits ne disent plus la
      // vérité. Ils sont refaits pour tous les services, pas seulement pour
      // les nouveaux — un service qui a reçu « 10 tables » doit apprendre
      // qu'on en demande désormais 40.
      produireEtNotifier(req.params.id, apres.title, nouvelles, req.user!.userId);
      notifierChangementMateriel(req.params.id, apres.title, `${materials.length} ligne(s) de matériel`);
    }
    const periode = periodeDe(apres);
    const conflits = await detecterConflits(
      Array.isArray(materials) ? materials : [],
      periode.debut,
      periode.fin,
      req.params.id
    );
    const conflitsObjets = await indisponibilites(
      Array.isArray(objects) ? objects.map((o: any) => o.object_id) : [],
      periode.debut,
      periode.fin,
      req.params.id
    );
    const manquesLots = await manquesSurLots(
      Array.isArray(objects) ? objects : [],
      periode.debut,
      periode.fin,
      req.params.id
    );

    notifierWebhooks('manifestation.updated', { id: Number(req.params.id), title });
    res.json({ success: true, conflits, conflits_objets: conflitsObjets, manques_lots: manquesLots });
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
        produireEtNotifier(req.params.id, m.title, nouvelles, req.user!.userId);

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

      // CURRENT_TIMESTAMP plutôt que datetime('now') : les deux moteurs le
      // comprennent et rendent le même format, alors que datetime() est propre à
      // SQLite et faisait échouer tout changement de statut sur MySQL.
      const archiveDate = status === 'archived' ? 'CURRENT_TIMESTAMP' : 'NULL';
      await db.execute(
        `UPDATE manifestations SET status = ?, archived_at = ${archiveDate}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
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

      // Le suivi partagé sur Nextcloud n'a d'intérêt que s'il est à jour.
      redeposerSuivi();

      // Une demande reprise en brouillon sollicite aussi les services concernés :
      // c'est le moment où quelqu'un s'en saisit pour la compléter.
      if (status === 'draft') {
        const nouvelles = await creerApprobationsManquantes(req.params.id, req.user!.userId);
        produireEtNotifier(req.params.id, m.title, nouvelles, req.user!.userId);
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
    redeposerSuivi();

    res.json({ success: true, updated: modifiees });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== PIÈCES JOINTES ========================
//
// Un arrêté de circulation, un plan d'implantation, la photo d'une chaise
// revenue cassée ou d'un trottoir abîmé sur le lieu. Ce sont ces pièces qui font
// la différence en cas de litige, des mois plus tard.
//
// Le fichier est téléversé d'abord par `POST /api/upload/file`, puis enregistré
// ici avec son libellé, son type et sa description — c'est la marche déjà
// suivie par les documents des espaces verts.

/** GET /:id/documents - Pièces d'une manifestation, filtrables par `?q=`. */
router.get('/:id/documents', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }
    const q = req.query.q ? String(req.query.q) : undefined;
    // Chaque service ne voit que le document produit pour lui : le lui masquer
    // dans son courriel et le lui montrer ici reviendrait au même que ne rien
    // masquer du tout.
    res.json({
      success: true,
      data: await documentsVisiblesPar(
        await documentsDe(req.params.id, q),
        req.user!.userId,
        req.user!.role
      ),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/documents - Joindre une pièce déjà téléversée.
 *
 * Ouvert à la saisie de terrain : un agent qui constate une casse au retour doit
 * pouvoir photographier sans être superviseur.
 */
router.post('/:id/documents', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const { name, doc_type, description, file_path, mime_type, size, stock_id, object_id } = req.body;

    if (!file_path) {
      return res.status(400).json({ success: false, message: 'Aucun fichier envoyé' });
    }
    if (!String(name ?? '').trim()) {
      return res.status(400).json({ success: false, message: 'Le libellé est requis' });
    }

    const m = await db.queryOne('SELECT id, title FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    await joindre(
      req.params.id,
      { name, doc_type, description, file_path, mime_type, size, stock_id, object_id },
      req.user!.userId
    );

    await consignerHistorique(req.params.id, req.user!.userId, 'Pièce jointe ajoutée', {
      comment: String(name).trim(),
    });

    res.status(201).json({ success: true, data: await documentsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** PUT /documents/:docId - Corriger le libellé, le type, la description ou le lien. */
router.put('/documents/:docId', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const document = await documentPrecis(req.params.docId);
    if (!document) return res.status(404).json({ success: false, message: 'Document non trouvé' });
    if (!(await peutVoirManifestation(req, document.manifestation_id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const { name, doc_type, description, stock_id, object_id } = req.body;
    await db.execute(
      `UPDATE manifestation_documents
       SET name = ?, doc_type = ?, description = ?, stock_id = ?, object_id = ?
       WHERE id = ?`,
      [
        String(name ?? document.name).trim(),
        await typeValide(doc_type ?? document.doc_type),
        description?.trim() || null,
        stock_id || null,
        object_id || null,
        req.params.docId,
      ]
    );

    res.json({ success: true, data: await documentsDe(document.manifestation_id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** DELETE /documents/:docId - Retire la ligne **et** le fichier. */
router.delete('/documents/:docId', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const document = await documentPrecis(req.params.docId);
    if (!document) return res.status(404).json({ success: false, message: 'Document non trouvé' });
    if (!(await peutVoirManifestation(req, document.manifestation_id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    await detacher(req.params.docId);
    await consignerHistorique(document.manifestation_id, req.user!.userId, 'Pièce jointe retirée', {
      comment: document.name,
    });

    res.json({ success: true, data: await documentsDe(document.manifestation_id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/documents/generate - Refaire les documents des services.
 *
 * La production est automatique à la réception et à chaque changement de
 * matériel. Ce geste manuel sert aux deux cas où l'automatisme ne suffit pas :
 * un modèle corrigé après coup, et un Nextcloud qui était injoignable au
 * moment où la demande est arrivée.
 *
 * Le compte rendu nomme les services servis **et** ceux qui ont échoué, avec la
 * raison : un modèle mal enregistré doit se voir, sinon on découvre le document
 * manquant le jour où le service le réclame.
 */
router.post('/:id/documents/generate', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const m = await db.queryOne('SELECT id, title FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }

    const resultats = await genererPourManifestation(req.params.id, req.user!.userId);
    const produits = resultats.filter((r) => r.success);

    if (produits.length > 0) {
      await consignerHistorique(req.params.id, req.user!.userId, 'Documents de service produits', {
        comment: produits.map((r) => r.service_name).join(', '),
      });
    }

    res.json({
      success: true,
      data: {
        resultats,
        documents: await documentsVisiblesPar(
          await documentsDe(req.params.id),
          req.user!.userId,
          req.user!.role
        ),
      },
      message: resultats.length === 0
        ? "Aucun service sollicité n'a de modèle de document"
        : `${produits.length} document(s) produit(s) sur ${resultats.length}`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MATÉRIEL PRÊTABLE ========================
//
// Une catégorie ne se prête pas d'un bloc : un réfrigérateur de la catégorie
// Électroménager part volontiers pour une brocante, le grill de la même
// catégorie non. Trois niveaux de réglage, le plus précis l'emporte.

/** GET /availability/tree - Catégories et sous-catégories, avec leur réglage. */
router.get('/availability/tree', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await arbreDisponibilite() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /availability/objects - Matériels d'une catégorie et leur disponibilité.
 *
 * Rend à la fois le réglage propre au matériel et le résultat effectif : sans
 * les deux, on ne saurait pas pourquoi un matériel est exclu alors qu'on n'a
 * rien coché dessus.
 */
router.get('/availability/objects', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { category_id } = req.query;
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'Catégorie requise' });
    }
    const objets = await objetsDeLaCategorie(req, String(category_id));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /availability/search - Chercher un matériel dans tout le parc.
 *
 * Trente catégories et soixante sous-catégories rendent le déroulement branche
 * par branche impraticable. La réponse porte le rattachement de chaque matériel
 * pour que l'écran n'ouvre que les branches concernées.
 */
router.get('/availability/search', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const objets = await rechercherObjetsPretables(req, String(req.query.q || ''));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /availability/:niveau/:id - Régler un niveau.
 *
 * Une catégorie ne peut pas hériter : c'est elle la valeur de référence, et lui
 * permettre `null` laisserait la résolution sans point de départ.
 */
router.put('/availability/:niveau/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const TABLES: Record<string, string> = {
      category: 'categories',
      subcategory: 'subcategories',
      object: 'objects',
    };
    const table = TABLES[req.params.niveau];
    if (!table) {
      return res.status(400).json({
        success: false,
        message: 'Niveau inconnu (attendu : category, subcategory ou object)',
      });
    }

    const valeur = lireDisponibilite(req.body.available);
    if (table === 'categories' && valeur === null) {
      return res.status(400).json({
        success: false,
        message: "Une catégorie ne peut pas hériter : c'est elle qui donne le ton",
      });
    }

    const resultat = await db.execute(
      `UPDATE ${table} SET available_for_manifestations = ? WHERE id = ?`,
      [versColonne(valeur), req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    await logService.info(
      'other',
      `Disponibilité manifestation modifiée (${req.params.niveau} ${req.params.id})`,
      { available: valeur },
      { userId: req.user?.userId }
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MATÉRIEL UNIQUE DU PARC ========================
//
// Une manifestation ne savait demander que des quantités : « 50 tables ». Un
// véhicule n'est pas une quantité — c'est un exemplaire identifié, qui ne peut
// pas être à deux endroits le même jour, et dont l'histoire (entretiens, pleins,
// contrôles) est déjà tenue dans le parc. On l'y rattache plutôt que de le
// recopier dans le stock des manifestations, ce qui créerait deux vérités.

/**
 * GET /objects/search - Parc consultable pour une période, avec ce qui le retient.
 *
 * Les matériels pris restent visibles, en disant *qui* les retient : savoir que
 * le camion est sur la brocante permet de demander un décalage, ce qu'une liste
 * amputée ne permet pas.
 */
router.get('/objects/search', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { q, date_from, date_to, exclude } = req.query;
    const debut = String(date_from || aujourdHui());
    const fin = String(date_to || debut);

    const parc = await parcAvecDisponibilite(
      req,
      q ? String(q) : undefined,
      debut,
      fin,
      exclude ? String(exclude) : null
    );

    if (parc === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    res.json({ success: true, data: parc, periode: { debut, fin } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /:id/objects - Matériels uniques demandés par une manifestation. */
router.get('/:id/objects', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirManifestation(req, req.params.id))) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE_MANIFESTATION });
    }
    res.json({ success: true, data: await objetsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /:id/objects - Remplace la liste des matériels uniques.
 *
 * Les conflits sont rendus mais ne bloquent pas : comme pour le stock, une
 * commune arbitre, décale ou emprunte ailleurs. La différence est qu'ici un
 * conflit est toujours réel — deux manifestations ne peuvent pas se partager le
 * même camion, alors qu'elles peuvent se partager cent chaises.
 */
router.put('/:id/objects', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { objects } = req.body;
    if (!Array.isArray(objects)) {
      return res.status(400).json({ success: false, message: 'Liste de matériels requise' });
    }

    const m = await db.queryOne('SELECT * FROM manifestations WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ success: false, message: 'Manifestation non trouvée' });
    if (m.status === 'archived') {
      return res.status(400).json({ success: false, message: 'Manifestation archivée' });
    }

    // Un compte ne peut engager que le matériel qu'il a le droit de voir : sans
    // ce contrôle, il suffirait de connaître un identifiant pour réserver un
    // véhicule d'une catégorie qui lui est fermée.
    for (const objet of objects) {
      if (!(await peutVoirObjet(req, objet.object_id))) {
        return res.status(403).json({ success: false, message: REFUS_PORTEE });
      }
      // Le sélecteur ne le propose pas, mais rien n'empêche d'envoyer un
      // identifiant à la main : le refus doit vivre ici aussi.
      if (!(await estPretable(objet.object_id))) {
        return res.status(400).json({
          success: false,
          message: "Ce matériel n'est pas déclaré prêtable pour les manifestations",
        });
      }
    }

    await remplacerObjets(req.params.id, objects);

    const periode = periodeDe(m);
    const conflits = await indisponibilites(
      objects.map((o: any) => o.object_id),
      periode.debut,
      periode.fin,
      req.params.id
    );
    const manquesLots = await manquesSurLots(objects, periode.debut, periode.fin, req.params.id);

    await consignerHistorique(req.params.id, req.user!.userId, 'Matériel unique mis à jour', {
      comment: `${objects.length} matériel(s) du parc`,
    });
    notifierChangementMateriel(req.params.id, m.title, `${objects.length} matériel(s) du parc`);
    redeposerSuivi();

    res.json({
      success: true,
      data: await objetsDe(req.params.id),
      conflits,
      manques_lots: manquesLots,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /:id/objects/:itemId - Sortie et retour d'un matériel du parc.
 *
 * Un véhicule ne se compte pas : il est sorti ou non, revenu ou non, et son état
 * au retour se constate — intact, abîmé, perdu. C'est ce constat qui manquait
 * pour que le suivi d'un prêt de véhicule vaille celui d'un prêt de chaises.
 *
 * Un **lot** se compte, lui : quarante-huit chaises revenues sur cinquante
 * livrées, et deux qui manquent. Les mêmes champs acceptent donc un nombre —
 * `delivered_quantity` et `returned_quantity` — là où un exemplaire se contente
 * d'un oui ou d'un non. Dire « revenu » d'un lot dont il manque deux chaises
 * ferait rentrer au stock du matériel qui n'existe plus.
 */
router.put('/:id/objects/:itemId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { delivered, returned, delivered_quantity, returned_quantity, return_state, notes } =
      req.body;

    if (return_state && !ETATS_RETOUR.includes(return_state)) {
      return res.status(400).json({
        success: false,
        message: `État de retour invalide (attendu : ${ETATS_RETOUR.join(', ')})`,
      });
    }

    const ligne = await db.queryOne(
      `SELECT mi.*, o.name as object_name FROM manifestation_items mi
       JOIN objects o ON o.id = mi.object_id
       WHERE mi.id = ? AND mi.manifestation_id = ?`,
      [req.params.itemId, req.params.id]
    );
    if (!ligne) {
      return res.status(404).json({ success: false, message: 'Matériel non trouvé sur cette manifestation' });
    }

    // Un nombre l'emporte sur un booléen : l'écran d'un lot envoie une quantité,
    // celui d'un exemplaire une case cochée, et les deux passent par ici.
    const nombreOuBooleen = (
      nombre: unknown,
      booleen: unknown,
      actuel: number,
      demande: number
    ): number => {
      if (nombre !== undefined && nombre !== null && nombre !== '') {
        return Math.min(Math.max(0, Number(nombre) || 0), demande);
      }
      if (booleen === undefined) return actuel;
      return booleen ? demande : 0;
    };

    const demande = Math.max(1, Number(ligne.quantity) || 1);
    const sorti = nombreOuBooleen(delivered_quantity, delivered, ligne.quantity_delivered, demande);
    const revenu = nombreOuBooleen(returned_quantity, returned, ligne.quantity_returned, demande);

    await db.execute(
      `UPDATE manifestation_items
       SET quantity_delivered = ?, quantity_returned = ?, return_state = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        sorti,
        revenu,
        return_state ?? ligne.return_state ?? null,
        notes ?? ligne.notes ?? null,
        new Date().toISOString(),
        req.params.itemId,
      ]
    );

    const etat = return_state ?? ligne.return_state;
    // Un lot se raconte en nombres — « 50 livrées, 48 revenues » — un exemplaire
    // en états. Le même résumé pour les deux rendrait l'historique illisible.
    const enLot = demande > 1;
    const resume = [
      ligne.object_name,
      enLot ? `${sorti} livrée(s)` : sorti ? 'sorti' : 'non sorti',
      enLot ? `${revenu} revenue(s)` : revenu ? 'revenu' : 'non revenu',
      etat ? `état : ${etat}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    await consignerHistorique(req.params.id, req.user!.userId, 'Matériel unique suivi', { comment: resume });
    redeposerSuivi();

    res.json({ success: true, data: await objetsDe(req.params.id) });
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
      // Distinguer les deux refus : « ce n'est pas votre service » et « vous en
      // êtes membre mais pas responsable » n'appellent pas la même action, et un
      // message unique laisserait chercher.
      const membre = approbation.service_id
        ? await db.queryOne('SELECT id FROM service_members WHERE user_id = ? AND service_id = ?', [
            req.user!.userId,
            approbation.service_id,
          ])
        : null;

      return res.status(403).json({
        success: false,
        message: membre
          ? "Seul le responsable du service, ou son délégataire, peut approuver en son nom"
          : 'Vous ne pouvez répondre que pour votre service',
      });
    }

    // Le coordinateur tranche en dernier : lui demander son avis avant que les
    // services aient répondu le ferait valider à l'aveugle, ce qui viderait sa
    // signature de son sens.
    const coordinateur = await serviceCoordinateur();
    const estCoordinateur = Boolean(coordinateur && approbation.service_id === coordinateur.id);

    if (estCoordinateur && status === 'approved') {
      const restantes = await approbationsEnAttenteHorsCoordinateur(req.params.id);
      if (restantes.length > 0) {
        const noms = restantes.map((a: any) => a.service_name || 'un destinataire').join(', ');
        return res.status(409).json({
          success: false,
          message: `Les services concernés n'ont pas tous répondu : ${noms}`,
          approbations_en_attente: restantes,
        });
      }
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

    const m = await db.queryOne('SELECT title, status FROM manifestations WHERE id = ?', [req.params.id]);
    notifierDecision(req.params.id, m?.title ?? '', status, service?.name ?? null, comment?.trim() || null);

    /**
     * L'accord du coordinateur **est** la validation.
     *
     * Lui faire approuver puis exiger qu'un second geste change le statut
     * dédoublerait la décision, et laisserait une manifestation approuvée par
     * tous rester en brouillon parce que personne n'a cliqué une seconde fois.
     */
    let validee = false;
    if (
      estCoordinateur &&
      status === 'approved' &&
      m &&
      ['pending', 'draft'].includes(m.status) &&
      (await toutEstApprouve(req.params.id))
    ) {
      await db.execute(
        "UPDATE manifestations SET status = 'validated', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), req.params.id]
      );
      await consignerHistorique(req.params.id, req.user!.userId, LIBELLES_TRANSITION.validated, {
        fromStatus: m.status,
        toStatus: 'validated',
        comment: `Validée par ${service?.name ?? 'le service coordinateur'}`,
      });
      notifierWebhooks('manifestation.status_changed', {
        id: Number(req.params.id),
        title: m.title,
        from: m.status,
        to: 'validated',
      });
      redeposerSuivi();
      validee = true;
    }

    res.json({ success: true, data: await approbationsDe(req.params.id), manifestation_validee: validee });
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
      `SELECT msg.*, (CONCAT_WS(' ', u.first_name, u.last_name)) as author_name, u.email as author_email,
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
      `SELECT w.*, (CONCAT_WS(' ', u.first_name, u.last_name)) as user_name, u.email as user_email,
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
    // Les lignes des pièces jointes partent en cascade, mais pas les fichiers :
    // un dossier de manifestation contient des photos de sinistre et des
    // arrêtés, et le disque n'a pas à conserver ce qu'on a demandé de retirer.
    // C'est la même règle que pour le retrait d'une pièce isolée.
    for (const document of await documentsDe(req.params.id)) {
      supprimerFichier(document.file_path);
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
