import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import {
  CLES,
  SOURCES,
  collecter,
  conditionObjets,
  ecart,
  ErreurSuivi,
  etendueDe,
  fenetreAnnee,
  fenetreMois,
  lireFenetre,
  lireFiltre,
  lireGranularite,
  lirePerimetre,
  parBatiment,
  parCategorie,
  parObjet,
  parSous,
  resumeApi,
  resumer,
  serie,
  sourcesOuvertes,
  type FiltreSuivi,
  type Perimetre,
} from '../services/suiviCouts.service';
import type { Bornes } from '../utils/periodes';

const router = Router();

// Middleware pour vérifier les permissions de suivi
async function checkTrackingPermission(req: AuthRequest, res: Response, next: any) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    // Les admins ont toujours accès
    if (userRole === 'admin') {
      return next();
    }

    // Vérifier les permissions du module suivi
    const permission = await db.queryOne(
      `SELECT * FROM module_permissions WHERE module_name = 'tracking' AND role = ?`,
      [userRole]
    );

    if (!permission || !permission.can_view) {
      // Vérifier les permissions individuelles
      const userPerm = await db.queryOne(
        `SELECT * FROM user_module_permissions WHERE user_id = ? AND module_name = 'tracking'`,
        [userId]
      );

      if (!userPerm || !userPerm.can_view) {
        return res.status(403).json({ success: false, message: 'Accès non autorisé au module Suivi' });
      }
    }

    next();
  } catch (error) {
    console.error('Erreur vérification permission suivi:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
}

function echouer(res: Response, erreur: unknown, contexte: string) {
  if (erreur instanceof ErreurSuivi) {
    return res.status(erreur.statut).json({ success: false, message: erreur.message });
  }
  console.error(`Erreur ${contexte}:`, erreur);
  return res.status(500).json({ success: false, message: 'Erreur serveur' });
}

const parseJson = (valeur: unknown) => {
  if (!valeur) return [];
  try {
    return typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
  } catch {
    return [];
  }
};

/**
 * Le détail ligne à ligne du parc, pour les tableaux et le PDF. Les montants
 * agrégés viennent de `suiviCouts.service` ; ces lignes-ci ne servent qu'à
 * montrer d'où ils viennent.
 */
async function detailsParc(filtre: FiltreSuivi, perimetre: Perimetre, fenetre: Bornes) {
  const details = { fuel: [] as any[], maintenance: [] as any[], technicalControl: [] as any[] };
  const condition = conditionObjets(filtre, perimetre);
  if (!condition) return details;
  const veut = (s: string) => filtre.sources.includes(s as any);
  const colonnesObjet = `o.name as object_name, o.reference, o.image as object_image,
               c.name as category_name, c.id as category_id,
               s.name as subcategory_name, s.id as subcategory_id`;
  const jointures = `JOIN objects o ON o.id = x.object_id
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories s ON s.id = o.subcategory_id`;
  const objet = (x: any) => ({
    objectId: x.object_id,
    objectName: x.object_name,
    objectReference: x.reference,
    objectImage: x.object_image,
    categoryId: x.category_id,
    categoryName: x.category_name,
    subcategoryId: x.subcategory_id,
    subcategoryName: x.subcategory_name,
  });

  if (veut('fuel')) {
    let sql = `SELECT x.*, ${colonnesObjet} FROM fuel_entries x ${jointures}
               WHERE x.entry_date >= ? AND x.entry_date <= ?`;
    const params: any[] = [fenetre.debut, fenetre.fin];
    if (filtre.fuelTypes.length) {
      sql += ` AND x.fuel_type IN (${filtre.fuelTypes.map(() => '?').join(',')})`;
      params.push(...filtre.fuelTypes);
    }
    const lignes = await db.query(`${sql}${condition.sql} ORDER BY x.entry_date DESC`, [...params, ...condition.params]);
    details.fuel = lignes.map((f: any) => ({
      id: f.id,
      ...objet(f),
      date: f.entry_date,
      fuelType: f.fuel_type,
      quantity: parseFloat(f.quantity) || 0,
      unitPrice: parseFloat(f.unit_price) || 0,
      totalPrice: parseFloat(f.total_price) || 0,
      mileage: f.mileage,
      station: f.station,
      notes: f.notes,
      attachments: parseJson(f.attachments),
    }));
  }

  if (veut('maintenance')) {
    let sql = `SELECT x.*, ${colonnesObjet} FROM maintenances x ${jointures}
               WHERE x.maintenance_date >= ? AND x.maintenance_date <= ?`;
    const params: any[] = [fenetre.debut, fenetre.fin];
    if (filtre.maintenanceTypes.length) {
      sql += ` AND x.maintenance_type IN (${filtre.maintenanceTypes.map(() => '?').join(',')})`;
      params.push(...filtre.maintenanceTypes);
    }
    const lignes = await db.query(`${sql}${condition.sql} ORDER BY x.maintenance_date DESC`, [...params, ...condition.params]);
    details.maintenance = lignes.map((m: any) => ({
      id: m.id,
      ...objet(m),
      date: m.maintenance_date,
      type: m.maintenance_type,
      cost: parseFloat(m.cost) || 0,
      mileage: m.mileage,
      nextDate: m.next_date,
      nextMileage: m.next_mileage,
      provider: m.provider,
      notes: m.notes,
      attachments: parseJson(m.attachments),
      document: m.document,
    }));
  }

  if (veut('technical_control')) {
    const lignes = await db.query(
      `SELECT x.*, ${colonnesObjet} FROM technical_controls x ${jointures}
        WHERE x.control_date >= ? AND x.control_date <= ?${condition.sql}
        ORDER BY x.control_date DESC`,
      [fenetre.debut, fenetre.fin, ...condition.params]
    );
    details.technicalControl = lignes.map((tc: any) => ({
      id: tc.id,
      ...objet(tc),
      date: tc.control_date,
      expiryDate: tc.expiry_date,
      result: tc.result,
      centerName: tc.center_name,
      cost: parseFloat(tc.cost) || 0,
      mileage: tc.mileage,
      notes: tc.notes,
      attachments: parseJson(tc.attachments),
      document: tc.document,
    }));
  }

  return details;
}

async function detailsEspacesVerts(fenetre: Bornes) {
  // La colonne de `green_spaces` s'appelle `space_type`, pas `type`.
  const lignes = await db.query(
    `SELECT gsm.*, gs.name as space_name, gs.space_type
       FROM green_space_maintenances gsm
       JOIN green_spaces gs ON gs.id = gsm.green_space_id
      WHERE gsm.performed_date >= ? AND gsm.performed_date <= ?
      ORDER BY gsm.performed_date DESC`,
    [fenetre.debut, fenetre.fin]
  );
  return lignes.map((g: any) => ({
    id: g.id,
    spaceName: g.space_name,
    spaceType: g.space_type,
    date: g.performed_date,
    type: g.maintenance_type,
    title: g.title,
    cost: parseFloat(g.cost) || 0,
    duration: g.duration_minutes,
    performer: g.performed_by,
    nextDate: g.next_maintenance_date,
    notes: g.notes,
  }));
}

/** La fenêtre de comparaison d'une période, si les deux bornes sont données. */
function fenetreComparee(query: Record<string, unknown>): Bornes | null {
  if (!query.compareStartDate || !query.compareEndDate) return null;
  return lireFenetre(query.compareStartDate, query.compareEndDate);
}

// GET /api/tracking/data - Récupérer les données de suivi
router.get('/data', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as Record<string, unknown>;
    const fenetre = lireFenetre(query.startDate, query.endDate);
    const comparee = fenetreComparee(query);
    const filtre = lireFiltre(query);
    const perimetre = await lirePerimetre(req);
    const ouvertes = sourcesOuvertes(perimetre);
    const veut = (s: (typeof SOURCES)[number]) => filtre.sources.includes(s) && ouvertes.includes(s);

    const { depenses, evenements, sites } = await collecter(filtre, perimetre, etendueDe(fenetre, comparee), req);
    const resume = resumer(depenses, fenetre);
    const parc = await detailsParc({ ...filtre, sources: filtre.sources.filter(veut) }, perimetre, fenetre);

    let comparison = null;
    if (comparee) {
      const reference = resumer(depenses, comparee);
      comparison = {
        period: { start: comparee.debut, end: comparee.fin },
        summary: resumeApi(reference),
        ...ecart(resume, reference),
      };
    }

    res.json({
      success: true,
      sources: ouvertes,
      ...parc,
      greenSpace: veut('green_space') ? await detailsEspacesVerts(fenetre) : [],
      buildings: veut('buildings') ? await parBatiment(depenses, fenetre, sites, comparee) : [],
      events: evenements.filter((e) => e.date >= fenetre.debut && e.date <= fenetre.fin),
      summary: resumeApi(resume),
      comparison,
    });
  } catch (erreur) {
    echouer(res, erreur, 'tracking data');
  }
});

// GET /api/tracking/charts - Données pour les graphiques
router.get('/charts', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as Record<string, unknown>;
    const fenetre = lireFenetre(query.startDate, query.endDate);
    const granularite = lireGranularite(query.groupBy);
    const filtre = lireFiltre(query);
    const perimetre = await lirePerimetre(req);
    const { depenses, sites } = await collecter(filtre, perimetre, fenetre, req);

    const costByPeriod = serie(depenses, fenetre, granularite);
    const parPeriode = (cle: string) => costByPeriod.map((p) => ({ period: p.period, label: p.label, cost: p[cle] as number }));

    res.json({
      success: true,
      granularity: granularite,
      costByPeriod,
      fuelByPeriod: parPeriode(CLES.fuel.serie),
      maintenanceByPeriod: parPeriode(CLES.maintenance.serie),
      controlByPeriod: parPeriode(CLES.technical_control.serie),
      fuelByType: parSous(depenses, fenetre, 'fuel'),
      maintenanceByType: parSous(depenses, fenetre, 'maintenance'),
      greenSpaceByType: parSous(depenses, fenetre, 'green_space'),
      buildingByCategory: parSous(depenses, fenetre, 'buildings'),
      eventByType: parSous(depenses, fenetre, 'events'),
      costByCategory: parCategorie(depenses, fenetre),
      costByObject: parObjet(depenses, fenetre),
      costByBuilding: (await parBatiment(depenses, fenetre, sites)).slice(0, 10),
    });
  } catch (erreur) {
    echouer(res, erreur, 'tracking charts');
  }
});

// GET /api/tracking/filters - Récupérer les options de filtrage
router.get('/filters', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const perimetre = await lirePerimetre(req);
    const accessibleCategoryIds = perimetre.categories;

    // Les bâtiments du périmètre : ceux qu'on peut choisir dans le filtre.
    const sites = perimetre.sites?.length
      ? await db.query(
          `SELECT id, name FROM cle_sites WHERE id IN (${perimetre.sites.map(() => '?').join(',')}) ORDER BY sort_order, name`,
          perimetre.sites
        )
      : [];
    const autres = {
      sources: sourcesOuvertes(perimetre),
      sites: sites.map((s: any) => ({ id: Number(s.id), name: s.name })),
    };

    let categoryCondition = '';
    const categoryParams: any[] = [];
    if (accessibleCategoryIds !== null) {
      if (accessibleCategoryIds.length === 0) {
        return res.json({ success: true, categories: [], subcategories: [], objects: [], fuelTypes: [], maintenanceTypes: [], ...autres });
      }
      categoryCondition = ` WHERE id IN (${accessibleCategoryIds.map(() => '?').join(',')})`;
      categoryParams.push(...accessibleCategoryIds);
    }

    // Catégories
    const categories = await db.query(
      `SELECT id, name, slug, image FROM categories${categoryCondition} ORDER BY sort_order, name`,
      categoryParams
    );

    const catIds = categories.map((c: any) => c.id);

    // Sous-catégories (filtrées par catégories accessibles)
    let subcategoryQuery = `SELECT id, category_id, name, slug, image FROM subcategories`;
    const subcatParams: any[] = [];
    if (catIds.length > 0 && accessibleCategoryIds !== null) {
      subcategoryQuery += ` WHERE category_id IN (${catIds.map(() => '?').join(',')})`;
      subcatParams.push(...catIds);
    }
    subcategoryQuery += ` ORDER BY sort_order, name`;
    const subcategories = await db.query(subcategoryQuery, subcatParams);

    // Objets (filtrés par catégories accessibles)
    let objectQuery = `SELECT o.id, o.name, o.reference, o.image, o.category_id, o.subcategory_id,
              c.name as category_name, s.name as subcategory_name
       FROM objects o
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN subcategories s ON s.id = o.subcategory_id`;
    const objectParams: any[] = [];
    if (accessibleCategoryIds !== null) {
      objectQuery += ` WHERE o.category_id IN (${catIds.map(() => '?').join(',')})`;
      objectParams.push(...catIds);
    }
    objectQuery += ` ORDER BY o.name`;
    const objects = await db.query(objectQuery, objectParams);

    // Types de carburant distincts
    const fuelTypes = await db.query(
      `SELECT DISTINCT fuel_type FROM fuel_entries WHERE fuel_type IS NOT NULL ORDER BY fuel_type`
    );

    // Types d'entretien
    const maintenanceTypes = await db.query(
      `SELECT DISTINCT maintenance_type FROM maintenances WHERE maintenance_type IS NOT NULL
       UNION SELECT name FROM maintenance_types
       ORDER BY 1`
    );

    res.json({
      success: true,
      categories: categories.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image
      })),
      subcategories: subcategories.map((s: any) => ({
        id: s.id,
        categoryId: s.category_id,
        name: s.name,
        slug: s.slug,
        image: s.image
      })),
      objects: objects.map((o: any) => ({
        id: o.id,
        name: o.name,
        reference: o.reference,
        image: o.image,
        categoryId: o.category_id,
        categoryName: o.category_name,
        subcategoryId: o.subcategory_id,
        subcategoryName: o.subcategory_name
      })),
      fuelTypes: fuelTypes.map((f: any) => f.fuel_type),
      maintenanceTypes: maintenanceTypes.map((m: any) => m.maintenance_type || m.name),
      ...autres,
    });
  } catch (error: any) {
    console.error('Erreur tracking filters:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/tracking/permissions - Vérifier les permissions de l'utilisateur
router.get('/permissions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    // Les admins ont tous les droits
    if (userRole === 'admin') {
      return res.json({
        success: true,
        canView: true,
        canExport: true,
        canCompare: true
      });
    }

    // Récupérer les permissions du groupe
    const groupPerm = await db.queryOne(
      `SELECT * FROM module_permissions WHERE module_name = 'tracking' AND role = ?`,
      [userRole]
    );

    // Récupérer les permissions individuelles
    const userPerm = await db.queryOne(
      `SELECT * FROM user_module_permissions WHERE user_id = ? AND module_name = 'tracking'`,
      [userId]
    );

    // Combiner les permissions (OR logique)
    const canView = !!(groupPerm?.can_view || userPerm?.can_view);
    const canExport = !!(groupPerm?.can_export || userPerm?.can_export);
    const canCompare = !!(groupPerm?.can_compare || userPerm?.can_compare);

    res.json({
      success: true,
      canView,
      canExport,
      canCompare
    });
  } catch (error: any) {
    console.error('Erreur tracking permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/** Les montants d'un résumé sous les noms courts de la comparaison annuelle : `fuel`, `buildings`… */
function totauxCourts(parSource: Record<string, number>, total: number) {
  const sortie: Record<string, number> = { total };
  for (const s of SOURCES) sortie[CLES[s].annuel] = parSource[s];
  return sortie;
}

// GET /api/tracking/yearly-comparison - Comparaison annuelle ou mensuelle
router.get('/yearly-comparison', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { year1, year2, month1, month2 } = req.query;
    const annee = (v: unknown, defaut: number) => {
      const n = parseInt(v as string);
      return Number.isInteger(n) && n >= 1990 && n <= 2200 ? n : defaut;
    };
    const mois = (v: unknown) => {
      const n = parseInt(v as string);
      return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
    };
    const y1 = annee(year1, new Date().getFullYear());
    const y2 = annee(year2, y1 - 1);
    const m1 = mois(month1);
    const m2 = mois(month2);
    const mensuel = m1 !== null && m2 !== null;

    const fenetre1 = mensuel ? fenetreMois(y1, m1!) : fenetreAnnee(y1);
    const fenetre2 = mensuel ? fenetreMois(y2, m2!) : fenetreAnnee(y2);
    const filtre = lireFiltre(req.query as Record<string, unknown>);
    const perimetre = await lirePerimetre(req);
    const { depenses } = await collecter(filtre, perimetre, etendueDe(fenetre1, fenetre2), req);

    const resume1 = resumer(depenses, fenetre1);
    const resume2 = resumer(depenses, fenetre2);
    const summary = {
      year1: totauxCourts(resume1.parSource, resume1.total),
      year2: totauxCourts(resume2.parSource, resume2.total),
    };
    // « 2026 vs 2025 » se lit « 2026 comparé à 2025 » : la première période est
    // celle qu'on regarde, la seconde la référence — comme la comparaison de
    // périodes, où l'écart est « période actuelle − période comparée ». D'où
    // year1 - year2, en pourcentage de year2. L'inverse (year2 - year1) faisait
    // afficher « augmentation » à une année 2026 moins chère que 2025.
    const difference: Record<string, number | null> = {};
    for (const cle of Object.keys(summary.year1)) {
      difference[cle] = Math.round((summary.year1[cle] - summary.year2[cle]) * 100) / 100;
    }
    // Rien sur la référence : pas de pourcentage, plutôt qu'un 0 % trompeur.
    difference.percentage =
      resume2.total !== 0 ? Math.round(((resume1.total - resume2.total) / resume2.total) * 1000) / 10 : null;

    const mensuelDe = (fenetre: Bornes) =>
      serie(depenses, fenetre, 'mois').map((p, i) => {
        const ligne: Record<string, number> = { month: i + 1, total: p.totalCost };
        for (const s of SOURCES) ligne[CLES[s].annuel] = p[CLES[s].serie] as number;
        return ligne;
      });

    res.json({
      success: true,
      year1: y1,
      year2: y2,
      ...(mensuel ? { month1: m1, month2: m2 } : {}),
      mode: mensuel ? 'monthly' : 'yearly',
      monthly: mensuel ? { year1: [], year2: [] } : { year1: mensuelDe(fenetre1), year2: mensuelDe(fenetre2) },
      summary,
      difference,
    });
  } catch (erreur) {
    echouer(res, erreur, 'yearly comparison');
  }
});

export default router;
