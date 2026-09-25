import { Router, Response } from 'express';
import QRCode from 'qrcode';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireSupervisor,
  requireFieldWrite,
} from '../middleware/auth.middleware';
import { filtreObjets, peutVoirObjet, REFUS_PORTEE } from '../middleware/objectScope';
import { logService } from '../services/log.service';
import {
  TYPES_DETENTEUR,
  type TypeDetenteur,
  compositionDuTrousseau,
  definirOuvrants,
  detenteurActuel,
  detenteursDe,
  historique,
  jetonPour,
  ouvrantsDeLaCle,
  prochainNumero,
  recalculerDepuisLots,
  stockDeLaCle,
  trousseauxContenant,
  valeurDuStock,
} from '../services/cles.service';
import { enfantsDe } from '../utils/batchQuery';
import { arbreDesLieux } from '../services/lieux.service';
import { usagesSite } from '../services/sites.service';
import { lireDisponibilite, versColonne } from '../services/disponibiliteParc.service';
import {
  requireGestionLieux,
  requireGestionSite,
  siteDeLOuvrant,
  siteDuCorps,
  siteDuParametre,
} from '../services/gestionOrganisation.service';
import { urlPubliqueDe } from './clePublic.routes';

/**
 * Clés, badges et trousseaux.
 *
 * Le module ne crée pas de matériel : clés et trousseaux sont des `objects`, et
 * c'est `POST /api/objects` qui les pose, avec sa validation, ses droits et son
 * journal. Ces routes décrivent ce que le parc ne sait pas dire — ce qu'une clé
 * ouvre, ce qu'elle a coûté, de quoi un trousseau est fait, chez qui il est.
 *
 * La seule exception est `POST /trousseaux`, qui crée l'objet **et** sa
 * composition en une fois : composer un trousseau en deux temps laisserait, si
 * la seconde étape échoue, un trousseau vide portant déjà son numéro
 * d'inventaire — c'est-à-dire une étiquette imprimable qui ne désigne rien.
 *
 * Les gardes suivent celles des manifestations : le référentiel et les lots
 * relèvent du superviseur, mais **remise et restitution sont ouvertes à l'agent
 * de terrain**. C'est lui qui rend le trousseau en revenant de tournée ; l'en
 * empêcher garantirait que la restitution soit saisie le lendemain, ou jamais.
 */

const router = Router();

const entier = (valeur: unknown): number | null => {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const texte = (valeur: unknown, max = 255): string | null => {
  const t = String(valeur ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/** Refuse une requête portant sur un matériel hors périmètre. */
async function materielAccessible(
  req: AuthRequest,
  res: Response,
  objectId: number
): Promise<boolean> {
  if (await peutVoirObjet(req, objectId)) return true;
  res.status(403).json({ success: false, message: REFUS_PORTEE });
  return false;
}

// ======================== RÉFÉRENTIEL DES LIEUX ========================

/**
 * La pièce d'une porte est-elle bien dans son bâtiment ?
 *
 * Rien ne l'empêchait : la porte du hall de l'école pouvait se ranger sous la
 * salle du conseil de la mairie. Depuis que le gestionnaire d'un bâtiment n'a
 * la main que sur le sien, c'est aussi ce qui l'empêche d'accrocher ses portes
 * aux salles d'un autre. Pas de pièce : la porte reste au bâtiment, c'est permis.
 */
async function pieceDuSite(pieceId: number | null | undefined, siteId: number | null): Promise<boolean> {
  if (!pieceId) return true;
  const piece = await db.queryOne<{ site_id: number }>('SELECT site_id FROM site_pieces WHERE id = ?', [pieceId]);
  return Boolean(piece) && Number(piece!.site_id) === Number(siteId);
}

router.get('/sites', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const sites = await db.query(
      `SELECT s.*, (SELECT COUNT(*) FROM cle_ouvrants o WHERE o.site_id = s.id) AS ouvrants_count
         FROM cle_sites s
        ORDER BY s.sort_order, s.name`
    );
    res.json({ success: true, data: sites });
  } catch (error) {
    console.error('Erreur liste sites:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.get('/sites/:id/ouvrants', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const ouvrants = await db.query(
      'SELECT * FROM cle_ouvrants WHERE site_id = ? ORDER BY sort_order, name',
      [req.params.id]
    );
    res.json({ success: true, data: ouvrants });
  } catch (error) {
    console.error('Erreur liste ouvrants:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * Le référentiel entier — bâtiments, pièces et ouvrants imbriqués.
 *
 * L'assemblage est délégué à `arbreDesLieux` depuis la migration 037 : le même
 * arbre est lu par le module Clés et par `/api/sites/arbre`, et deux
 * assemblages parallèles finiraient par ranger la barrière principale à deux
 * endroits différents.
 *
 * `site.ouvrants` ne porte plus que les ouvrants rattachés à aucune pièce ; les
 * autres sont sous `site.pieces[].ouvrants`. C'est précisément le niveau qui
 * manquait, et l'écran l'affiche tel quel.
 */
router.get('/referentiel', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await arbreDesLieux(true) });
  } catch (error) {
    console.error('Erreur référentiel clés:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.post('/sites', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    const name = texte(req.body?.name);
    if (!name) {
      res.status(400).json({ success: false, message: 'Le nom du site est obligatoire' });
      return;
    }

    const resultat = await db.execute(
      'INSERT INTO cle_sites (name, code, address, sort_order, pretable) VALUES (?, ?, ?, ?, ?)',
      [
        name,
        texte(req.body?.code, 50),
        texte(req.body?.address, 500),
        Number(req.body?.sortOrder) || 0,
        // Trois états : une chaîne vide dit « hérite », pas « non ». Voir
        // `lieux.service.ts` pour le repli, qui est « non » chez les lieux.
        versColonne(lireDisponibilite(req.body?.pretable)),
      ]
    );

    res.status(201).json({ success: true, data: { id: resultat.lastInsertRowid, name } });
  } catch (error) {
    console.error('Erreur création site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/sites/:id', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const name = texte(req.body?.name);
    if (!name) {
      res.status(400).json({ success: false, message: 'Le nom du site est obligatoire' });
      return;
    }

    await db.execute(
      'UPDATE cle_sites SET name = ?, code = ?, address = ?, sort_order = ?, pretable = ? WHERE id = ?',
      [
        name,
        texte(req.body?.code, 50),
        texte(req.body?.address, 500),
        Number(req.body?.sortOrder) || 0,
        versColonne(lireDisponibilite(req.body?.pretable)),
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur modification site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * Supprime un site, et avec lui ses ouvrants (cascade).
 *
 * Refusé tant qu'une clé s'y rattache. La cascade effacerait silencieusement ce
 * que ces clés ouvrent, et la clé deviendrait un bout de métal sans usage connu
 * — la donnée qu'on cherchait justement à ne pas perdre.
 */
router.delete('/sites/:id', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    const attaches = await db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM cle_ouvre
        WHERE site_id = ?
           OR ouvrant_id IN (SELECT id FROM cle_ouvrants WHERE site_id = ?)`,
      [req.params.id, req.params.id]
    );

    if ((attaches?.total ?? 0) > 0) {
      res.status(409).json({
        success: false,
        message: `${attaches!.total} clé(s) ouvrent encore ce site. Détachez-les avant de le supprimer.`,
      });
      return;
    }

    // Les documents du module Bâtiments tiennent le site (`RESTRICT`) : sans ce
    // contrôle, la suppression échouerait sur la clé étrangère avec une erreur
    // serveur, au lieu de dire quoi faire.
    const { documents, etages, materiels } = await usagesSite(req.params.id);
    if (documents + etages + materiels > 0) {
      const detail = [
        documents && `${documents} document(s) de contrôle`,
        etages && `${etages} étage(s) avec leurs plans`,
        materiels && `${materiels} matériel(s) posé(s) dans ses pièces`,
      ]
        .filter(Boolean)
        .join(', ');
      res.status(409).json({
        success: false,
        message: `Ce bâtiment porte encore ${detail} : désactivez-le plutôt.`,
      });
      return;
    }

    await db.execute('DELETE FROM cle_sites WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.post('/ouvrants', authenticateToken, requireGestionSite(siteDuCorps), async (req: AuthRequest, res: Response) => {
  try {
    const siteId = entier(req.body?.siteId);
    const name = texte(req.body?.name);

    if (!siteId || !name) {
      res.status(400).json({ success: false, message: 'Le site et le nom sont obligatoires' });
      return;
    }
    if (!(await pieceDuSite(entier(req.body?.pieceId), siteId))) {
      res.status(400).json({ success: false, message: 'Cette pièce n’est pas dans ce bâtiment' });
      return;
    }

    const resultat = await db.execute(
      'INSERT INTO cle_ouvrants (site_id, piece_id, name, code, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [
        siteId,
        // Nul est le cas normal de la barrière et du portail, qui ne sont dans
        // aucune salle : voir `lieux.service.ts`.
        entier(req.body?.pieceId) || null,
        name,
        texte(req.body?.code, 50),
        texte(req.body?.description, 2000),
        Number(req.body?.sortOrder) || 0,
      ]
    );

    res.status(201).json({ success: true, data: { id: resultat.lastInsertRowid, name } });
  } catch (error) {
    console.error('Erreur création ouvrant:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/ouvrants/:id', authenticateToken, requireGestionSite(siteDeLOuvrant), async (req: AuthRequest, res: Response) => {
  try {
    const name = texte(req.body?.name);
    if (!name) {
      res.status(400).json({ success: false, message: 'Le nom est obligatoire' });
      return;
    }
    if (!(await pieceDuSite(entier(req.body?.pieceId), await siteDeLOuvrant(req)))) {
      res.status(400).json({ success: false, message: 'Cette pièce n’est pas dans le bâtiment de la porte' });
      return;
    }

    await db.execute(
      'UPDATE cle_ouvrants SET name = ?, code = ?, description = ?, sort_order = ?, piece_id = ? WHERE id = ?',
      [
        name,
        texte(req.body?.code, 50),
        texte(req.body?.description, 2000),
        Number(req.body?.sortOrder) || 0,
        entier(req.body?.pieceId) || null,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur modification ouvrant:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.delete('/ouvrants/:id', authenticateToken, requireGestionSite(siteDeLOuvrant), async (req: AuthRequest, res: Response) => {
  try {
    const attaches = await db.queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM cle_ouvre WHERE ouvrant_id = ?',
      [req.params.id]
    );

    if ((attaches?.total ?? 0) > 0) {
      res.status(409).json({
        success: false,
        message: `${attaches!.total} clé(s) ouvrent encore cette porte. Détachez-les avant de la supprimer.`,
      });
      return;
    }

    await db.execute('DELETE FROM cle_ouvrants WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression ouvrant:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== CONFIGURATION ========================

/**
 * Ce dont les écrans ont besoin pour proposer des choix cohérents : les
 * préfixes de numérotation, et les catégories que l'administrateur a rattachées
 * au plugin.
 *
 * Réuni en une route parce que ces deux listes sont toujours lues ensemble, à
 * l'ouverture du formulaire de trousseau, et qu'aucune ne vaut sans l'autre :
 * un préfixe sans catégorie où ranger le trousseau ne mène nulle part.
 */
router.get('/configuration', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const plugin = await db.queryOne<{ id: number; config: string }>(
      "SELECT id, config FROM plugins WHERE slug = 'cles'"
    );

    let prefixes: any[] = [];
    let etatsRetour: string[] = [];
    try {
      const config = plugin?.config ? JSON.parse(plugin.config) : {};
      prefixes = Array.isArray(config.prefixes) ? config.prefixes : [];
      etatsRetour = Array.isArray(config.etats_retour) ? config.etats_retour : [];
    } catch {
      // Une configuration illisible ne doit pas bloquer l'écran : on repart des
      // listes vides, que l'administrateur pourra corriger.
    }

    const categories = plugin
      ? await db.query(
          `SELECT pc.category_id, pc.subcategory_id,
                  c.name AS category_name,
                  sc.name AS subcategory_name,
                  pc2.name AS parent_name
             FROM plugin_categories pc
             LEFT JOIN categories c ON c.id = pc.category_id
             LEFT JOIN subcategories sc ON sc.id = pc.subcategory_id
             LEFT JOIN categories pc2 ON pc2.id = sc.category_id
            WHERE pc.plugin_id = ?`,
          [plugin.id]
        )
      : [];

    res.json({
      success: true,
      data: {
        prefixes,
        etatsRetour,
        categories: categories.map((ligne: any) =>
          ligne.subcategory_id
            ? {
                id: ligne.subcategory_id,
                genre: 'subcategory',
                chemin: [ligne.parent_name, ligne.subcategory_name].filter(Boolean).join(' › '),
              }
            : {
                id: ligne.category_id,
                genre: 'category',
                chemin: ligne.category_name,
              }
        ),
      },
    });
  } catch (error) {
    console.error('Erreur configuration clés:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== NUMÉROTATION ========================

router.get('/prochain-numero', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const numero = await prochainNumero(String(req.query.prefixe ?? ''));
    res.json({ success: true, data: { numero } });
  } catch (error) {
    console.error('Erreur prochain numéro:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== LISTE DES CLÉS ET TROUSSEAUX ========================

/**
 * Les matériels des catégories rattachées au plugin.
 *
 * Le rattachement passe par `plugin_categories`, comme pour tout plugin : c'est
 * l'administrateur qui décide quelles catégories sont des clés, depuis l'écran
 * des plugins. Aucune catégorie rattachée signifie « aucune », et non « toutes »
 * — l'inverse afficherait le parc entier dans un écran de clés le jour de
 * l'installation.
 */
async function clauseCategoriesDuPlugin(): Promise<{ sql: string; params: any[] } | null> {
  const liens = await db.query<{ category_id: number | null; subcategory_id: number | null }>(
    `SELECT pc.category_id, pc.subcategory_id
       FROM plugin_categories pc
       JOIN plugins p ON p.id = pc.plugin_id
      WHERE p.slug = 'cles'`
  );

  const categories = liens.map((l) => l.category_id).filter((v): v is number => Boolean(v));
  const sousCategories = liens.map((l) => l.subcategory_id).filter((v): v is number => Boolean(v));

  if (categories.length === 0 && sousCategories.length === 0) return null;

  const morceaux: string[] = [];
  const params: any[] = [];

  if (categories.length > 0) {
    morceaux.push(`o.category_id IN (${categories.map(() => '?').join(',')})`);
    params.push(...categories);
  }
  if (sousCategories.length > 0) {
    morceaux.push(`o.subcategory_id IN (${sousCategories.map(() => '?').join(',')})`);
    params.push(...sousCategories);
  }

  return { sql: ` AND (${morceaux.join(' OR ')})`, params };
}

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const perimetre = await clauseCategoriesDuPlugin();
    if (!perimetre) {
      res.json({ success: true, data: [], meta: { sansCategorie: true } });
      return;
    }

    const portee = await filtreObjets(req, 'o');
    if (portee === null) {
      res.status(403).json({ success: false, message: REFUS_PORTEE });
      return;
    }

    const params: any[] = [...perimetre.params, ...portee.params];
    let sql = `
      SELECT o.id, o.name, o.reference, o.image, o.material_type, o.quantity_total, o.unit_cost,
             o.status, o.category_id, o.subcategory_id, o.custom_fields,
             c.name AS category_name, sc.name AS subcategory_name
        FROM objects o
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
       WHERE 1 = 1${perimetre.sql}${portee.sql}`;

    const recherche = texte(req.query.search);
    if (recherche) {
      sql += ' AND (o.name LIKE ? OR o.reference LIKE ? OR o.custom_fields LIKE ?)';
      const motif = `%${recherche}%`;
      params.push(motif, motif, motif);
    }

    const nature = texte(req.query.nature, 20);
    if (nature === 'trousseau') sql += " AND o.material_type = 'unique'";
    if (nature === 'cle') sql += " AND o.material_type = 'lot'";

    sql += ' ORDER BY o.reference, o.name';

    const materiels = await db.query(sql, params);
    if (materiels.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const ids = materiels.map((m: any) => m.id);
    const detenteurs = await detenteursDe(ids);

    res.json({
      success: true,
      data: materiels.map((materiel: any) => ({
        ...materiel,
        detenteur: enfantsDe(detenteurs, materiel.id)[0] ?? null,
      })),
    });
  } catch (error) {
    console.error('Erreur liste clés:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== FICHE D'UNE CLÉ ========================

router.get('/:objectId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    const materiel = await db.queryOne(
      `SELECT o.*, c.name AS category_name, sc.name AS subcategory_name
         FROM objects o
         LEFT JOIN categories c ON c.id = o.category_id
         LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
        WHERE o.id = ?`,
      [objectId]
    );

    if (!materiel) {
      res.status(404).json({ success: false, message: 'Matériel introuvable' });
      return;
    }

    const [ouvre, lots, stock, valeur, detenteur, composition, trousseaux] = await Promise.all([
      ouvrantsDeLaCle(objectId),
      db.query('SELECT * FROM cle_lots WHERE object_id = ? ORDER BY acquired_on DESC, id DESC', [
        objectId,
      ]),
      stockDeLaCle(objectId),
      valeurDuStock(objectId),
      detenteurActuel(objectId),
      compositionDuTrousseau(objectId),
      trousseauxContenant(objectId),
    ]);

    res.json({
      success: true,
      data: { ...materiel, ouvre, lots, stock, valeur, detenteur, composition, trousseaux },
    });
  } catch (error) {
    console.error('Erreur fiche clé:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== CE QUE ÇA OUVRE ========================

router.put('/:objectId/ouvre', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    const entrees = Array.isArray(req.body?.ouvre) ? req.body.ouvre : [];
    await definirOuvrants(objectId, entrees);

    res.json({ success: true, data: await ouvrantsDeLaCle(objectId) });
  } catch (error) {
    console.error('Erreur ouvrants:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== LOTS ========================

router.post('/:objectId/lots', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    const quantity = entier(req.body?.quantity);
    if (!quantity) {
      res.status(400).json({ success: false, message: 'La quantité doit être un entier positif' });
      return;
    }

    // Un prix absent est légitime — c'est le « stock initial ». Un prix négatif
    // ne l'est pas, et fausserait la valeur du stock sans jamais se voir.
    const prixBrut = req.body?.unitPrice;
    const unitPrice =
      prixBrut === null || prixBrut === undefined || prixBrut === '' ? null : Number(prixBrut);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      res.status(400).json({ success: false, message: 'Le prix unitaire est invalide' });
      return;
    }

    await db.execute(
      `INSERT INTO cle_lots (object_id, quantity, unit_price, acquired_on, supplier, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        objectId,
        quantity,
        unitPrice,
        texte(req.body?.acquiredOn, 20),
        texte(req.body?.supplier),
        texte(req.body?.reference, 100),
        texte(req.body?.notes, 2000),
        req.user!.userId,
      ]
    );

    const stock = await recalculerDepuisLots(objectId);

    await logService.log({
      level: 'info',
      category: 'other',
      message: `Lot de ${quantity} clé(s) ajouté au matériel #${objectId}`,
      userId: req.user!.userId,
    });

    res.status(201).json({
      success: true,
      data: {
        stock,
        valeur: await valeurDuStock(objectId),
        lots: await db.query(
          'SELECT * FROM cle_lots WHERE object_id = ? ORDER BY acquired_on DESC, id DESC',
          [objectId]
        ),
      },
    });
  } catch (error) {
    console.error('Erreur ajout lot:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.delete('/lots/:lotId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const lot = await db.queryOne<{ object_id: number }>(
      'SELECT object_id FROM cle_lots WHERE id = ?',
      [req.params.lotId]
    );

    if (!lot) {
      res.status(404).json({ success: false, message: 'Lot introuvable' });
      return;
    }
    if (!(await materielAccessible(req, res, lot.object_id))) return;

    await db.execute('DELETE FROM cle_lots WHERE id = ?', [req.params.lotId]);
    const stock = await recalculerDepuisLots(lot.object_id);

    res.json({ success: true, data: { stock, valeur: await valeurDuStock(lot.object_id) } });
  } catch (error) {
    console.error('Erreur suppression lot:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== TROUSSEAUX ========================

/**
 * Crée le trousseau et sa composition d'un seul tenant.
 *
 * Le matériel est posé ici plutôt que par `POST /api/objects` parce que le
 * trousseau n'a de sens qu'avec ce qu'il contient : en deux appels, un échec du
 * second laisserait un numéro d'inventaire attribué à un trousseau vide, donc
 * une étiquette imprimable qui ne désigne rien.
 */
router.post('/trousseaux', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const name = texte(req.body?.name);
    const reference = texte(req.body?.reference, 100);
    const categoryId = entier(req.body?.categoryId);
    const subcategoryId = entier(req.body?.subcategoryId);

    if (!name || !reference) {
      res.status(400).json({
        success: false,
        message: "Le nom et le numéro d'inventaire sont obligatoires",
      });
      return;
    }

    if (!categoryId && !subcategoryId) {
      res.status(400).json({
        success: false,
        message: 'Un trousseau doit être rangé dans une catégorie',
      });
      return;
    }

    const doublon = await db.queryOne('SELECT id FROM objects WHERE reference = ?', [reference]);
    if (doublon) {
      res.status(409).json({
        success: false,
        message: `Le numéro d'inventaire ${reference} est déjà utilisé`,
      });
      return;
    }

    const resultat = await db.execute(
      `INSERT INTO objects (name, reference, category_id, subcategory_id, material_type, quantity_total, status, notes)
       VALUES (?, ?, ?, ?, 'unique', 1, 'active', ?)`,
      [name, reference, categoryId, subcategoryId, texte(req.body?.notes, 2000)]
    );

    const trousseauId = Number(resultat.lastInsertRowid);
    const composants = Array.isArray(req.body?.composants) ? req.body.composants : [];

    for (const composant of composants) {
      const objectId = entier(composant?.objectId);
      if (!objectId || objectId === trousseauId) continue;
      await db.execute(
        'INSERT INTO trousseau_composants (trousseau_id, object_id, quantity, notes) VALUES (?, ?, ?, ?)',
        [trousseauId, objectId, entier(composant?.quantity) ?? 1, texte(composant?.notes, 500)]
      );
    }

    await logService.log({
      level: 'info',
      category: 'other',
      message: `Trousseau ${reference} créé avec ${composants.length} composant(s)`,
      userId: req.user!.userId,
    });

    res.status(201).json({
      success: true,
      data: { id: trousseauId, reference, jeton: await jetonPour(trousseauId) },
    });
  } catch (error) {
    console.error('Erreur création trousseau:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/trousseaux/:id/composants', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const trousseauId = entier(req.params.id);
    if (!trousseauId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, trousseauId))) return;

    const composants = Array.isArray(req.body?.composants) ? req.body.composants : [];

    await db.execute('DELETE FROM trousseau_composants WHERE trousseau_id = ?', [trousseauId]);

    for (const composant of composants) {
      const objectId = entier(composant?.objectId);
      // Un trousseau qui se contiendrait lui-même ferait tourner en rond tout
      // affichage récursif de la composition.
      if (!objectId || objectId === trousseauId) continue;
      await db.execute(
        'INSERT INTO trousseau_composants (trousseau_id, object_id, quantity, notes) VALUES (?, ?, ?, ?)',
        [trousseauId, objectId, entier(composant?.quantity) ?? 1, texte(composant?.notes, 500)]
      );
    }

    res.json({ success: true, data: await compositionDuTrousseau(trousseauId) });
  } catch (error) {
    console.error('Erreur composition trousseau:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== DÉTENTION ========================

router.get('/:objectId/historique', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    res.json({ success: true, data: await historique(objectId) });
  } catch (error) {
    console.error('Erreur historique clé:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.post('/:objectId/attribuer', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    const holderType = String(req.body?.holderType ?? '') as TypeDetenteur;
    if (!TYPES_DETENTEUR.includes(holderType)) {
      res.status(400).json({ success: false, message: 'Type de détenteur invalide' });
      return;
    }

    const holderUserId = holderType === 'user' ? entier(req.body?.holderUserId) : null;
    const holderServiceId = holderType === 'service' ? entier(req.body?.holderServiceId) : null;
    const holderOuvrantId = holderType === 'ouvrant' ? entier(req.body?.holderOuvrantId) : null;
    const holderLabel = holderType === 'externe' ? texte(req.body?.holderLabel) : null;

    if (!holderUserId && !holderServiceId && !holderOuvrantId && !holderLabel) {
      res.status(400).json({ success: false, message: 'Le détenteur est obligatoire' });
      return;
    }

    const materiel = await db.queryOne<{ material_type: string }>(
      'SELECT material_type FROM objects WHERE id = ?',
      [objectId]
    );

    const quantity = entier(req.body?.quantity) ?? 1;

    // Un exemplaire unique — un trousseau — ne se remet qu'une fois. Laisser
    // deux détentions ouvertes rendrait la question « qui l'a ? » insoluble, et
    // c'est la seule question que cet écran existe pour répondre.
    if (materiel?.material_type !== 'lot') {
      const ouverte = await detenteurActuel(objectId);
      if (ouverte) {
        res.status(409).json({
          success: false,
          message: 'Ce trousseau est déjà attribué. Enregistrez sa restitution avant de le remettre.',
        });
        return;
      }
    } else {
      const stock = await stockDeLaCle(objectId);
      if (quantity > stock.disponibles) {
        res.status(409).json({
          success: false,
          message: `Il ne reste que ${stock.disponibles} exemplaire(s) disponible(s)`,
        });
        return;
      }
    }

    const resultat = await db.execute(
      `INSERT INTO cle_attributions
         (object_id, quantity, holder_type, holder_user_id, holder_service_id, holder_ouvrant_id,
          holder_label, remise_on, remise_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        objectId,
        quantity,
        holderType,
        holderUserId,
        holderServiceId,
        holderOuvrantId,
        holderLabel,
        texte(req.body?.remiseOn, 30) ?? new Date().toISOString(),
        req.user!.userId,
        texte(req.body?.notes, 2000),
      ]
    );

    await logService.log({
      level: 'info',
      category: 'other',
      message: `Matériel #${objectId} remis (${holderType})`,
      userId: req.user!.userId,
    });

    res.status(201).json({
      success: true,
      data: { id: resultat.lastInsertRowid, detenteur: await detenteurActuel(objectId) },
    });
  } catch (error) {
    console.error('Erreur attribution:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.post('/:objectId/restituer', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = entier(req.params.objectId);
    if (!objectId) {
      res.status(400).json({ success: false, message: 'Identifiant invalide' });
      return;
    }
    if (!(await materielAccessible(req, res, objectId))) return;

    // L'écran peut viser une remise précise — utile pour un lot dont plusieurs
    // exemplaires sont dehors ; à défaut on referme la plus ancienne ouverte.
    const attributionId = entier(req.body?.attributionId);
    const ouverte = attributionId
      ? await db.queryOne(
          'SELECT id FROM cle_attributions WHERE id = ? AND object_id = ? AND restitution_on IS NULL',
          [attributionId, objectId]
        )
      : await db.queryOne(
          `SELECT id FROM cle_attributions
            WHERE object_id = ? AND restitution_on IS NULL
            ORDER BY remise_on ASC, id ASC`,
          [objectId]
        );

    if (!ouverte) {
      res.status(404).json({ success: false, message: 'Aucune remise en cours pour ce matériel' });
      return;
    }

    await db.execute(
      `UPDATE cle_attributions
          SET restitution_on = ?, restitution_by = ?, etat_retour = ?,
              notes = COALESCE(?, notes)
        WHERE id = ?`,
      [
        texte(req.body?.restitutionOn, 30) ?? new Date().toISOString(),
        req.user!.userId,
        texte(req.body?.etatRetour, 50),
        texte(req.body?.notes, 2000),
        ouverte.id,
      ]
    );

    await logService.log({
      level: 'info',
      category: 'other',
      message: `Matériel #${objectId} restitué`,
      userId: req.user!.userId,
    });

    res.json({ success: true, data: { detenteur: await detenteurActuel(objectId) } });
  } catch (error) {
    console.error('Erreur restitution:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== ÉTIQUETTES ========================

/**
 * Données d'impression d'une planche d'étiquettes.
 *
 * Le QR pointe vers la **page publique** et non vers la fiche interne : une clé
 * perdue est ramassée par quelqu'un qui n'a pas de compte, et c'est précisément
 * lui que l'étiquette doit renseigner. Le lien reste utile à l'agent connecté,
 * qui y verra en plus le détenteur et la composition.
 */
router.post('/etiquettes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.objectIds) ? req.body.objectIds : [];
    if (ids.length === 0) {
      res.status(400).json({ success: false, message: 'Aucun matériel sélectionné' });
      return;
    }
    if (ids.length > 200) {
      res.status(400).json({ success: false, message: 'Maximum 200 étiquettes par planche' });
      return;
    }

    const portee = await filtreObjets(req, 'o');
    if (portee === null) {
      res.status(403).json({ success: false, message: REFUS_PORTEE });
      return;
    }

    const marqueurs = ids.map(() => '?').join(',');
    const materiels = await db.query(
      `SELECT o.id, o.name, o.reference
         FROM objects o
        WHERE o.id IN (${marqueurs})${portee.sql}`,
      [...ids, ...portee.params]
    );

    const etiquettes = [];
    for (const materiel of materiels) {
      const jeton = await jetonPour(materiel.id);
      const url = await urlPubliqueDe(req, jeton);
      const ouvre = await ouvrantsDeLaCle(materiel.id);

      etiquettes.push({
        objectId: materiel.id,
        nom: materiel.name,
        inventaire: materiel.reference || '',
        url,
        // Correction basse : l'étiquette est petite et le QR doit rester lisible
        // même imprimé à huit millimètres de côté. La redondance haute gonflerait
        // la matrice sans servir — une étiquette rayée se remplace, elle ne se
        // corrige pas.
        qrCode: await QRCode.toDataURL(url, {
          width: 320,
          margin: 0,
          errorCorrectionLevel: 'L',
          color: { dark: '#000000', light: '#ffffff' },
        }),
        ouvre: ouvre.map((o: any) => o.site_name || o.ouvrant_name).filter(Boolean),
      });
    }

    res.json({ success: true, data: etiquettes });
  } catch (error) {
    console.error('Erreur étiquettes:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
