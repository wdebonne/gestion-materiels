import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { exportLimiter } from '../middleware/rateLimiter.middleware';
import { db } from '../database';
import { moduleOuvert } from '../services/modules.service';
import { lireConfiguration } from '../services/webdav.service';
import {
  analyserFichier,
  annulerExport,
  annulerIntegration,
  annulerSortie,
  confirmerIntegration,
  droitsComptaDe,
  enregistrerReglages,
  envoyerLot,
  exigerGeste,
  ficheBien,
  fichierExport,
  ignorerImmobilisation,
  importerFichier,
  IntrouvableCompta,
  LIBELLES_GESTES,
  lierObjet,
  listerBiens,
  listerExports,
  listerImmobilisations,
  listerSorties,
  lireReglages,
  lireSuivi,
  COLONNES_EXPORT,
  MOTIFS,
  rangerImmobilisations,
  RefusCompta,
  renvoyerLot,
  retablirImmobilisation,
  SaisieCompta,
  sortirObjet,
  testerEnvoi,
  type FiltreSorties,
  type GesteCompta,
} from '../services/comptabilite.service';

/**
 * La passerelle comptable : `/api/comptabilite`.
 *
 * Deux portes successives. **Voir le module** — le droit de menu habituel, qui
 * suffit pour consulter : suivi, sorties, biens, historique des envois. Puis,
 * pour chaque geste, **sa case** : importer, ranger, sortir, envoyer, intégrer,
 * régler. Ranger dans les catégories est l'affaire de l'inventaire, pas de la
 * comptabilité : un comptable voit ce qui attend d'être rangé sans pouvoir le
 * faire, sauf si on le lui a coché.
 *
 * Le rangement ne vérifie pas le droit d'édition de la catégorie : la case
 * « Ranger » est accordée par un administrateur, en connaissance de cause, à
 * une personne qui n'a parfois aucune catégorie.
 *
 * Seules les routes qui produisent ou reçoivent un fichier passent par
 * `exportLimiter` : dix requêtes par heure sur tout le module rendraient le
 * tableau de suivi inutilisable.
 */

const router = Router();

const DOSSIER_IMPORTS = path.join(__dirname, '../../uploads/imports');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(DOSSIER_IMPORTS)) fs.mkdirSync(DOSSIER_IMPORTS, { recursive: true });
      cb(null, DOSSIER_IMPORTS);
    },
    filename: (_req, file, cb) => {
      cb(null, `compta-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.txt', '.xlsx'].includes(ext)) cb(null, true);
    else cb(new Error('Format non supporté : CSV ou Excel (.xlsx)'));
  },
});

/** Traduit les erreurs du service en réponses. */
function repondreErreur(res: Response, erreur: any, contexte: string) {
  if (erreur instanceof SaisieCompta) return res.status(400).json({ success: false, message: erreur.message });
  if (erreur instanceof RefusCompta) return res.status(403).json({ success: false, message: erreur.message });
  if (erreur instanceof IntrouvableCompta) return res.status(404).json({ success: false, message: erreur.message });
  console.error(`Comptabilité — ${contexte} :`, erreur);
  return res.status(500).json({ success: false, message: 'Erreur serveur' });
}

/** Porte du module : le même droit que l'entrée de menu. */
async function moduleComptabilite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role === 'service' || !(await moduleOuvert(req.user!, 'comptabilite'))) {
      res.status(403).json({ success: false, message: 'Le module Comptabilité ne vous est pas ouvert.' });
      return;
    }
    next();
  } catch (erreur) {
    repondreErreur(res, erreur, 'contrôle du module');
  }
}

/** Porte d'un geste : sa case, cochée pour ce compte. */
function geste(nom: GesteCompta) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await exigerGeste(req.user!, nom);
      next();
    } catch (erreur) {
      repondreErreur(res, erreur, `droit ${nom}`);
    }
  };
}

const supprimer = (chemin?: string) => {
  if (!chemin) return;
  try { fs.unlinkSync(chemin); } catch (_) {}
};

router.use(authenticateToken, moduleComptabilite);

// ------------------------------------------------------------------ consulter

router.get('/mes-droits', async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      droits: await droitsComptaDe(req.user!.userId, req.user!.role),
      estAdmin: req.user!.role === 'admin',
      gestes: LIBELLES_GESTES,
      motifs: MOTIFS,
      colonnes: COLONNES_EXPORT,
    });
  } catch (erreur) {
    repondreErreur(res, erreur, 'droits');
  }
});

router.get('/suivi', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, suivi: await lireSuivi() });
  } catch (erreur) {
    repondreErreur(res, erreur, 'suivi');
  }
});

router.get('/immobilisations', async (req: AuthRequest, res: Response) => {
  try {
    const { etat, recherche, page, limite } = req.query as Record<string, string>;
    res.json({ success: true, ...(await listerImmobilisations({ etat, recherche, page: Number(page), limite: Number(limite) })) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'liste des immobilisations');
  }
});

router.get('/sorties', async (req: AuthRequest, res: Response) => {
  try {
    const filtre = String(req.query.filtre ?? 'toutes') as FiltreSorties;
    res.json({ success: true, sorties: await listerSorties(filtre) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'liste des sorties');
  }
});

router.get('/exports', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, exports: await listerExports() });
  } catch (erreur) {
    repondreErreur(res, erreur, 'historique des envois');
  }
});

router.get('/exports/:id/fichier', async (req: AuthRequest, res: Response) => {
  try {
    const { chemin, nom } = await fichierExport(Number(req.params.id));
    res.download(chemin, nom);
  } catch (erreur) {
    repondreErreur(res, erreur, 'fichier d’un envoi');
  }
});

router.get('/biens', async (req: AuthRequest, res: Response) => {
  try {
    const { recherche, sortis, page, limite } = req.query as Record<string, string>;
    res.json({ success: true, ...(await listerBiens({ recherche, sortis, page: Number(page), limite: Number(limite) })) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'liste des biens');
  }
});

router.get('/biens/:id', async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, bien: await ficheBien(Number(req.params.id)) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'fiche d’un bien');
  }
});

// ------------------------------------------------------------------ importer

router.post('/immobilisations/analyser', exportLimiter, geste('importer'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    res.json({ success: true, analyse: await analyserFichier(req.file.path, req.file.originalname) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'analyse de l’import');
  } finally {
    supprimer(req.file?.path);
  }
});

router.post('/immobilisations/importer', exportLimiter, geste('importer'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    let correspondance = null;
    if (req.body?.correspondance) {
      try {
        correspondance = JSON.parse(req.body.correspondance);
      } catch {
        return res.status(400).json({ success: false, message: 'Correspondance des colonnes illisible' });
      }
    }
    const resultat = await importerFichier(req.file.path, req.file.originalname, correspondance, req.user!.userId);
    res.json({ success: true, resultat });
  } catch (erreur) {
    repondreErreur(res, erreur, 'import');
  } finally {
    supprimer(req.file?.path);
  }
});

// ------------------------------------------------------------------ ranger

router.post('/immobilisations/ranger', geste('ranger'), async (req: AuthRequest, res: Response) => {
  try {
    const { ids, categoryId, subcategoryId, exemplaires, location } = req.body ?? {};
    const resultat = await rangerImmobilisations(
      { ids: Array.isArray(ids) ? ids : [], categoryId, subcategoryId, exemplaires, location },
      req.user!.userId
    );
    res.json({ success: true, ...resultat });
  } catch (erreur) {
    repondreErreur(res, erreur, 'rangement');
  }
});

router.post('/immobilisations/:id/rattacher', geste('ranger'), async (req: AuthRequest, res: Response) => {
  try {
    const objectId = Number(req.body?.objectId);
    if (!Number.isInteger(objectId) || objectId <= 0) return res.status(400).json({ success: false, message: 'Choisissez un objet' });
    await lierObjet(objectId, Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'rattachement');
  }
});

router.post('/immobilisations/:id/ignorer', geste('ranger'), async (req: AuthRequest, res: Response) => {
  try {
    await ignorerImmobilisation(Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'ignorer');
  }
});

router.post('/immobilisations/:id/retablir', geste('ranger'), async (req: AuthRequest, res: Response) => {
  try {
    await retablirImmobilisation(Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'rétablir');
  }
});

/** Recherche d'un objet à rattacher, pour qui range sans voir les catégories. */
router.get('/objets-a-rattacher', geste('ranger'), async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ success: true, objets: [] });
    const motif = `%${q}%`;
    const objets = await db.query(
      `SELECT o.id, o.name, o.inventaire_interne, o.serial_number, o.location, o.immobilisation_id,
              COALESCE(c.name, c2.name) AS categorie, i.numero
         FROM objects o
         LEFT JOIN categories c ON c.id = o.category_id
         LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
         LEFT JOIN categories c2 ON c2.id = sc.category_id
         LEFT JOIN immobilisations i ON i.id = o.immobilisation_id
        WHERE o.status <> 'sorti'
          AND (o.name LIKE ? OR o.inventaire_interne LIKE ? OR o.serial_number LIKE ? OR o.reference LIKE ?)
        ORDER BY o.name ASC LIMIT 20`,
      [motif, motif, motif, motif]
    );
    res.json({
      success: true,
      objets: objets.map((o: any) => ({
        id: Number(o.id),
        nom: o.name,
        inventaireInterne: o.inventaire_interne ?? null,
        numeroSerie: o.serial_number ?? null,
        localisation: o.location ?? null,
        categorie: o.categorie ?? null,
        numeroComptable: o.numero ?? null,
      })),
    });
  } catch (erreur) {
    repondreErreur(res, erreur, 'recherche d’objet');
  }
});

// ------------------------------------------------------------------ sortir

router.post('/biens/:id/sortie', geste('sortir'), async (req: AuthRequest, res: Response) => {
  try {
    await sortirObjet(Number(req.params.id), req.body ?? {}, req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'sortie');
  }
});

router.delete('/biens/:id/sortie', geste('sortir'), async (req: AuthRequest, res: Response) => {
  try {
    await annulerSortie(Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'annulation de sortie');
  }
});

// ------------------------------------------------------------------ envoyer

router.post('/envoyer', exportLimiter, geste('envoyer'), async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await envoyerLot('envoi', 'manuel', req.user!.userId);
    res.json({ success: true, resultat });
  } catch (erreur) {
    repondreErreur(res, erreur, 'envoi');
  }
});

/** Un nouveau lot, rendu en téléchargement : les sorties quittent la file. */
router.post('/exports', exportLimiter, geste('envoyer'), async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await envoyerLot('telechargement', 'manuel', req.user!.userId);
    if (!resultat.contenu) return res.status(400).json({ success: false, message: 'Aucune sortie en attente d’envoi.' });
    res.setHeader('Content-Type', resultat.type!);
    res.setHeader('Content-Disposition', `attachment; filename="${resultat.nomFichier}"`);
    res.send(resultat.contenu);
  } catch (erreur) {
    repondreErreur(res, erreur, 'téléchargement du lot');
  }
});

router.post('/exports/:id/renvoyer', exportLimiter, geste('envoyer'), async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, resultat: await renvoyerLot(Number(req.params.id), req.user!.userId) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'renvoi');
  }
});

router.delete('/exports/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await annulerExport(Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'annulation d’envoi');
  }
});

// ------------------------------------------------------------------ intégrer

router.post('/exports/:id/integration', geste('integrer'), async (req: AuthRequest, res: Response) => {
  try {
    await confirmerIntegration(Number(req.params.id), req.user!.userId);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'intégration');
  }
});

router.delete('/exports/:id/integration', geste('integrer'), async (req: AuthRequest, res: Response) => {
  try {
    await annulerIntegration(Number(req.params.id), req.user!);
    res.json({ success: true });
  } catch (erreur) {
    repondreErreur(res, erreur, 'annulation d’intégration');
  }
});

// ------------------------------------------------------------------ régler

router.get('/reglages', async (_req: AuthRequest, res: Response) => {
  try {
    const smtp = await db.queryOne('SELECT id FROM smtp_config WHERE is_active = 1 LIMIT 1').catch(() => null);
    res.json({
      success: true,
      reglages: await lireReglages(),
      nextcloudConfigure: Boolean(await lireConfiguration()),
      smtpConfigure: Boolean(smtp),
    });
  } catch (erreur) {
    repondreErreur(res, erreur, 'lecture des réglages');
  }
});

router.put('/reglages', geste('regler'), async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, reglages: await enregistrerReglages(req.body ?? {}) });
  } catch (erreur) {
    repondreErreur(res, erreur, 'enregistrement des réglages');
  }
});

router.post('/envoi/tester', exportLimiter, geste('regler'), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, resultat: await testerEnvoi() });
  } catch (erreur) {
    repondreErreur(res, erreur, 'test d’envoi');
  }
});

export default router;
