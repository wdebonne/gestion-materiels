import { Router, Response, NextFunction } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import {
  messageErreurDepot,
  nomDOrigine,
  REFUS_TYPE_PLAN,
  televersementPrive,
  TYPES_PLANS,
} from '../middleware/televersement';
import { uploadLimiter } from '../middleware/rateLimiter.middleware';
import {
  peutGererLieux,
  peutGererSite,
  requireConsultationSite,
  requireGestionLieux,
  requireGestionSite,
  siteDeLaPiece,
  siteDeLEtage,
  siteDuDocument,
  siteDuParametre,
  siteDuPlacement,
  siteDuSuivi,
  sitesGeresPar,
} from '../services/gestionOrganisation.service';
import {
  appliquerRubrique,
  cheminDuDocument,
  cheminPrive,
  creerRubrique,
  creerSuivi,
  detacherDocument,
  ErreurBatiment,
  etatDesSuivis,
  joindre,
  lireDocument,
  listerDocuments,
  listerRubriques,
  modifierDocument,
  modifierRubrique,
  modifierSuivi,
  perimetreBatiments,
  refuserDocument,
  resumeDesBatiments,
  SOUS_DOSSIER,
  STATUTS_DOCUMENT,
  supprimerFichierPrive,
  supprimerRubrique,
  supprimerSuivi,
  validerDocument,
  type StatutDocument,
} from '../services/batiments.service';
import { notifierDepot, notifierRefus } from '../services/batimentsNotify.service';
import {
  cheminDuPlan,
  cheminPlanPrive,
  creerEtage,
  creerPieceSurPlan,
  definirZone,
  dimensionsImage,
  ficheDePiece,
  lireEtage,
  listerEtages,
  materielDuBatiment,
  modifierEtage,
  modifierPlacement,
  piecesDuBatiment,
  piecesDuMateriel,
  placerMateriel,
  poserPlan,
  retirerPlacement,
  SOUS_DOSSIER_PLANS,
  supprimerEtage,
  supprimerPlanPrive,
} from '../services/plans.service';
import { peutVoirObjet, REFUS_PORTEE } from '../middleware/objectScope';
import { enregistrerCoutDuControle, lireCoutDuControle } from '../services/interventionsBatiments.service';

/**
 * Le module Bâtiments : contrôles obligatoires, documents, échéances.
 *
 * ## Deux cercles
 *
 * **Consulter** un bâtiment — voir ses contrôles, ses documents, y déposer un
 * rapport — est ouvert à qui le gère *et* à qui en est responsable : la
 * directrice d'école rédige le PPMS. **Gérer** — valider, reclasser, régler
 * un suivi — reste au gestionnaire du bâtiment, ou de toute l'organisation.
 * Le catalogue des rubriques est commun à tous les bâtiments : seul un
 * gestionnaire global le modifie.
 *
 * ## Reclasser vers un autre bâtiment
 *
 * Valider ou modifier un document peut le changer de bâtiment. La garde vérifie
 * le bâtiment **actuel** ; la route vérifie en plus le bâtiment **visé**. Sans
 * cela, le gestionnaire de l'école pourrait verser ses documents dans le dossier
 * de la mairie, qu'il ne gère pas.
 *
 * Les identifiants s'écrivent `/:id(\\d+)` : « rubriques », « suivis » ou
 * « a-valider » ne peuvent pas être pris pour un bâtiment.
 */

const router = Router();

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

function echouer(res: Response, erreur: unknown, contexte: string) {
  if (erreur instanceof ErreurBatiment) return refuser(res, erreur.statut, erreur.message);
  console.error(`Erreur ${contexte} :`, erreur);
  return refuser(res, 500, 'Erreur serveur');
}

const depot = televersementPrive(SOUS_DOSSIER);

/** Reçoit le fichier, et traduit en français ce que multer refuse. */
function recevoirFichier(req: AuthRequest, res: Response, next: NextFunction) {
  depot.single('fichier')(req, res, (erreur: any) => {
    if (erreur) return refuser(res, 400, messageErreurDepot(erreur));
    next();
  });
}

/** Le bâtiment visé par un reclassement est-il géré par l'appelant ? Absent = inchangé. */
async function cibleGeree(req: AuthRequest): Promise<boolean> {
  const cible = req.body?.siteId;
  if (cible === undefined || cible === null || cible === '') return true;
  return peutGererSite(req.user, Number(cible));
}

// ================================================================ la vue d'ensemble

/** Les bâtiments visibles, avec l'état de leurs contrôles. */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sites = await perimetreBatiments(req.user!);
    const geres = sites === null ? null : await sitesGeresPar(req.user!.userId);
    const batiments = await resumeDesBatiments(sites);
    res.json({
      success: true,
      gereTout: sites === null,
      batiments: batiments.map((b) => ({ ...b, gere: geres === null || geres.includes(b.id) })),
    });
  } catch (erreur) {
    echouer(res, erreur, 'liste des bâtiments');
  }
});

/**
 * La file des documents à relire, pour les bâtiments que l'appelant **gère** :
 * un responsable dépose, il ne valide pas.
 */
router.get('/a-valider', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sites = (await peutGererLieux(req.user)) ? null : await sitesGeresPar(req.user!.userId);
    res.json({ success: true, documents: await listerDocuments({ siteIds: sites, statut: 'a_valider' }) });
  } catch (erreur) {
    echouer(res, erreur, 'file de validation');
  }
});

// ================================================================== les rubriques

router.get('/rubriques', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Les rubriques désactivées ne servent qu'à l'écran de réglage.
    const toutes = req.query.toutes === 'true' && (await peutGererLieux(req.user));
    res.json({ success: true, rubriques: await listerRubriques({ toutes }) });
  } catch (erreur) {
    echouer(res, erreur, 'liste des rubriques');
  }
});

router.post('/rubriques', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    res.status(201).json({ success: true, id: await creerRubrique(req.body ?? {}) });
  } catch (erreur) {
    echouer(res, erreur, 'création de rubrique');
  }
});

router.put('/rubriques/:id(\\d+)', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    await modifierRubrique(req.params.id, req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'modification de rubrique');
  }
});

router.delete('/rubriques/:id(\\d+)', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    await supprimerRubrique(req.params.id);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'suppression de rubrique');
  }
});

/** « Les extincteurs, partout » : un suivi dans chaque bâtiment qui n'en a pas. */
router.post(
  '/rubriques/:id(\\d+)/appliquer',
  authenticateToken,
  requireGestionLieux,
  async (req: AuthRequest, res: Response) => {
    try {
      const siteIds: number[] =
        req.body?.tous === true
          ? (await db.query('SELECT id FROM cle_sites WHERE COALESCE(is_active, 1) = 1')).map((s: any) => Number(s.id))
          : Array.isArray(req.body?.siteIds)
            ? req.body.siteIds.map(Number)
            : [];
      const crees = await appliquerRubrique(Number(req.params.id), siteIds, req.user!.userId);
      res.json({ success: true, crees });
    } catch (erreur) {
      echouer(res, erreur, 'application de rubrique');
    }
  }
);

// ===================================================================== les suivis

router.get(
  '/suivis/:id(\\d+)',
  authenticateToken,
  requireConsultationSite(siteDuSuivi),
  async (req: AuthRequest, res: Response) => {
    try {
      const [suivi] = await etatDesSuivis({ suiviId: Number(req.params.id) });
      if (!suivi) return refuser(res, 404, 'Suivi introuvable');
      res.json({ success: true, suivi });
    } catch (erreur) {
      echouer(res, erreur, 'lecture de suivi');
    }
  }
);

router.put('/suivis/:id(\\d+)', authenticateToken, requireGestionSite(siteDuSuivi), async (req: AuthRequest, res: Response) => {
  try {
    await modifierSuivi(Number(req.params.id), req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'modification de suivi');
  }
});

router.delete('/suivis/:id(\\d+)', authenticateToken, requireGestionSite(siteDuSuivi), async (req: AuthRequest, res: Response) => {
  try {
    await supprimerSuivi(Number(req.params.id));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'suppression de suivi');
  }
});

// ================================================================== les documents

router.get(
  '/documents/:id(\\d+)',
  authenticateToken,
  requireConsultationSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      const document = await lireDocument(req.params.id);
      if (!document) return refuser(res, 404, 'Document introuvable');
      res.json({ success: true, document });
    } catch (erreur) {
      echouer(res, erreur, 'lecture de document');
    }
  }
);

/**
 * Le fichier lui-même.
 *
 * Jamais mis en cache — ni par le navigateur, ni par le service worker, qui a
 * une règle à part pour ces chemins : un PPMS ouvert sur le poste partagé de
 * l'accueil ne doit pas y rester. Le chemin ne porte pas d'extension, pour ne
 * pas tomber sous la règle de nginx qui met les `.pdf` et les `.png` en cache
 * public pour un an.
 */
router.get(
  '/documents/:id(\\d+)/fichier',
  authenticateToken,
  requireConsultationSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      const document = await lireDocument(req.params.id);
      const chemin = cheminPrive(await cheminDuDocument(req.params.id));
      if (!document || !chemin) return refuser(res, 404, 'Fichier introuvable');

      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.attachment(document.nomOrigine);
      if (document.mime) res.type(document.mime);
      res.sendFile(chemin, (erreur) => {
        if (erreur && !res.headersSent) refuser(res, 500, 'Lecture du fichier impossible');
      });
    } catch (erreur) {
      echouer(res, erreur, 'envoi de fichier');
    }
  }
);

router.put(
  '/documents/:id(\\d+)',
  authenticateToken,
  requireGestionSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await cibleGeree(req))) return refuser(res, 403, 'Vous ne gérez pas le bâtiment visé');
      const resultat = await modifierDocument(Number(req.params.id), req.body ?? {}, req.user!.userId);
      res.json({ success: true, ...resultat });
    } catch (erreur) {
      echouer(res, erreur, 'modification de document');
    }
  }
);

router.post(
  '/documents/:id(\\d+)/valider',
  authenticateToken,
  requireGestionSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await cibleGeree(req))) return refuser(res, 403, 'Vous ne gérez pas le bâtiment visé');
      // Lu avant de valider : un coût mal saisi ne laisse pas un document à moitié traité.
      const cout = lireCoutDuControle(req.body?.coutTtc);
      const resultat = await validerDocument(Number(req.params.id), req.body ?? {}, req.user!.userId);
      const interventionId =
        cout === null ? null : await enregistrerCoutDuControle(Number(req.params.id), cout, req.user!.userId);
      res.json({ success: true, ...resultat, interventionId });
    } catch (erreur) {
      echouer(res, erreur, 'validation de document');
    }
  }
);

router.post(
  '/documents/:id(\\d+)/refuser',
  authenticateToken,
  requireGestionSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      await refuserDocument(Number(req.params.id), req.body?.motif, req.user!.userId);
      void notifierRefus(Number(req.params.id));
      res.json({ success: true });
    } catch (erreur) {
      echouer(res, erreur, 'refus de document');
    }
  }
);

/**
 * Supprime un document et son fichier.
 *
 * Le gestionnaire du bâtiment le peut toujours ; celui qui l'a déposé, tant que
 * personne ne l'a encore relu — c'est le « je me suis trompé de fichier ».
 */
router.delete(
  '/documents/:id(\\d+)',
  authenticateToken,
  requireConsultationSite(siteDuDocument),
  async (req: AuthRequest, res: Response) => {
    try {
      const document = await lireDocument(req.params.id);
      if (!document) return refuser(res, 404, 'Document introuvable');
      const gere = await peutGererSite(req.user, document.siteId);
      const sien = document.deposePar?.id === req.user!.userId && document.statut === 'a_valider';
      if (!gere && !sien) return refuser(res, 403, 'Seul un gestionnaire du bâtiment peut supprimer ce document');
      await detacherDocument(document.id);
      res.json({ success: true });
    } catch (erreur) {
      echouer(res, erreur, 'suppression de document');
    }
  }
);

// ============================================================= étages et plans

/**
 * Les étages et le plan de chacun.
 *
 * Le plan est une image du dossier privé : il se lit comme un document, par une
 * route qui vérifie qu'on consulte le bâtiment, et ne se met pas en cache.
 */
router.get(
  '/:id(\\d+)/etages',
  authenticateToken,
  requireConsultationSite(siteDuParametre),
  async (req: AuthRequest, res: Response) => {
    try {
      const siteId = Number(req.params.id);
      res.json({
        success: true,
        etages: await listerEtages(siteId),
        pieces: await piecesDuBatiment(siteId),
      });
    } catch (erreur) {
      echouer(res, erreur, 'lecture des étages');
    }
  }
);

router.post('/:id(\\d+)/etages', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    res.status(201).json({ success: true, id: await creerEtage(Number(req.params.id), req.body ?? {}) });
  } catch (erreur) {
    echouer(res, erreur, "création d'étage");
  }
});

router.put('/etages/:id(\\d+)', authenticateToken, requireGestionSite(siteDeLEtage), async (req: AuthRequest, res: Response) => {
  try {
    await modifierEtage(Number(req.params.id), req.body ?? {});
    res.json({ success: true, etage: await lireEtage(req.params.id) });
  } catch (erreur) {
    echouer(res, erreur, "modification d'étage");
  }
});

router.delete('/etages/:id(\\d+)', authenticateToken, requireGestionSite(siteDeLEtage), async (req: AuthRequest, res: Response) => {
  try {
    supprimerPlanPrive(await supprimerEtage(Number(req.params.id)));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, "suppression d'étage");
  }
});

const depotPlan = televersementPrive(SOUS_DOSSIER_PLANS, TYPES_PLANS, REFUS_TYPE_PLAN);

/**
 * Pose le plan d'un étage. Une image seulement : un PDF est rendu en image par
 * le navigateur avant l'envoi. L'ancien plan est effacé une fois le nouveau en
 * place — dans cet ordre, pour qu'un échec ne laisse pas l'étage sans plan.
 */
router.post(
  '/etages/:id(\\d+)/plan',
  authenticateToken,
  requireGestionSite(siteDeLEtage),
  uploadLimiter,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    depotPlan.single('plan')(req, res, (erreur: any) => {
      if (erreur) return refuser(res, 400, messageErreurDepot(erreur));
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    const fichier = req.file;
    if (!fichier) return refuser(res, 400, 'Aucune image reçue');
    try {
      const { largeur, hauteur } = await dimensionsImage(fichier.path, {
        largeur: Number(req.body?.largeur) || null,
        hauteur: Number(req.body?.hauteur) || null,
      });
      const ancien = await poserPlan(Number(req.params.id), {
        chemin: fichier.filename,
        mime: fichier.mimetype,
        largeur,
        hauteur,
      });
      if (ancien && ancien !== fichier.filename) supprimerPlanPrive(ancien);
      res.status(201).json({ success: true, etage: await lireEtage(req.params.id) });
    } catch (erreur) {
      supprimerPlanPrive(fichier.filename);
      echouer(res, erreur, 'dépôt de plan');
    }
  }
);

router.get(
  '/etages/:id(\\d+)/plan',
  authenticateToken,
  requireConsultationSite(siteDeLEtage),
  async (req: AuthRequest, res: Response) => {
    try {
      const plan = await cheminDuPlan(req.params.id);
      const chemin = plan ? cheminPlanPrive(plan.chemin) : null;
      if (!plan || !chemin) return refuser(res, 404, 'Aucun plan pour cet étage');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (plan.mime) res.type(plan.mime);
      res.sendFile(chemin, (erreur) => {
        if (erreur && !res.headersSent) refuser(res, 500, 'Lecture du plan impossible');
      });
    } catch (erreur) {
      echouer(res, erreur, 'envoi de plan');
    }
  }
);

/** Crée une pièce depuis le contour qu'on vient de tracer. */
router.post(
  '/etages/:id(\\d+)/pieces',
  authenticateToken,
  requireGestionSite(siteDeLEtage),
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json({ success: true, ...(await creerPieceSurPlan(Number(req.params.id), req.body ?? {})) });
    } catch (erreur) {
      echouer(res, erreur, 'création de pièce sur le plan');
    }
  }
);

// ============================================================= pièces et matériel

router.get('/pieces/:id(\\d+)', authenticateToken, requireConsultationSite(siteDeLaPiece), async (req: AuthRequest, res: Response) => {
  try {
    const fiche = await ficheDePiece(Number(req.params.id), req);
    if (!fiche) return refuser(res, 404, 'Pièce introuvable');
    res.json({ success: true, ...fiche });
  } catch (erreur) {
    echouer(res, erreur, 'fiche de pièce');
  }
});

/** Pose, redessine ou efface la zone d'une pièce sur un étage. */
router.put('/pieces/:id(\\d+)/zone', authenticateToken, requireGestionSite(siteDeLaPiece), async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await definirZone(Number(req.params.id), req.body ?? {})) });
  } catch (erreur) {
    echouer(res, erreur, 'zone de pièce');
  }
});

/**
 * Pose un matériel du parc dans une pièce.
 *
 * Gérer le bâtiment ne suffit pas : il faut aussi voir le matériel. Le
 * gestionnaire de l'école ne pose pas dans sa salle un véhicule d'une catégorie
 * qui lui est fermée — il ne saurait même pas qu'il existe.
 */
router.post(
  '/pieces/:id(\\d+)/materiels',
  authenticateToken,
  requireGestionSite(siteDeLaPiece),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await peutVoirObjet(req, Number(req.body?.objectId)))) return refuser(res, 403, REFUS_PORTEE);
      res.status(201).json({
        success: true,
        ...(await placerMateriel(Number(req.params.id), req.body ?? {}, req.user!.userId)),
      });
    } catch (erreur) {
      echouer(res, erreur, 'pose de matériel');
    }
  }
);

router.put('/placements/:id(\\d+)', authenticateToken, requireGestionSite(siteDuPlacement), async (req: AuthRequest, res: Response) => {
  try {
    await modifierPlacement(Number(req.params.id), req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'modification de matériel posé');
  }
});

router.delete('/placements/:id(\\d+)', authenticateToken, requireGestionSite(siteDuPlacement), async (req: AuthRequest, res: Response) => {
  try {
    await retirerPlacement(Number(req.params.id));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'retrait de matériel posé');
  }
});

/** Tout le matériel posé dans le bâtiment, pour le retrouver sur le plan. */
router.get(
  '/:id(\\d+)/materiels',
  authenticateToken,
  requireConsultationSite(siteDuParametre),
  async (req: AuthRequest, res: Response) => {
    try {
      res.json({ success: true, materiels: await materielDuBatiment(Number(req.params.id), req) });
    } catch (erreur) {
      echouer(res, erreur, 'matériel du bâtiment');
    }
  }
);

/** Où se trouve ce matériel — la question posée depuis sa fiche. */
router.get('/materiels/:objectId(\\d+)/pieces', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutVoirObjet(req, Number(req.params.objectId)))) return refuser(res, 403, REFUS_PORTEE);
    res.json({ success: true, pieces: await piecesDuMateriel(Number(req.params.objectId)) });
  } catch (erreur) {
    echouer(res, erreur, 'pièces du matériel');
  }
});

// ==================================================================== un bâtiment

router.get('/:id(\\d+)', authenticateToken, requireConsultationSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const site = await db.queryOne('SELECT * FROM cle_sites WHERE id = ?', [req.params.id]);
    if (!site) return refuser(res, 404, 'Bâtiment introuvable');
    const pieces = await db.query(
      'SELECT id, name FROM site_pieces WHERE site_id = ? ORDER BY sort_order, name',
      [req.params.id]
    );
    res.json({
      success: true,
      batiment: {
        id: Number(site.id),
        nom: site.name,
        code: site.code ?? null,
        adresse: site.address ?? null,
        actif: Boolean(Number(site.is_active ?? 1)),
        // `SELECT *` : la colonne n'existe qu'après la migration 044.
        surfaceM2: site.surface_m2 === null || site.surface_m2 === undefined ? null : Number(site.surface_m2),
      },
      gere: await peutGererSite(req.user, Number(req.params.id)),
      pieces: pieces.map((p: any) => ({ id: Number(p.id), nom: p.name })),
    });
  } catch (erreur) {
    echouer(res, erreur, 'lecture de bâtiment');
  }
});

router.get(
  '/:id(\\d+)/suivis',
  authenticateToken,
  requireConsultationSite(siteDuParametre),
  async (req: AuthRequest, res: Response) => {
    try {
      res.json({ success: true, suivis: await etatDesSuivis({ siteIds: [Number(req.params.id)] }) });
    } catch (erreur) {
      echouer(res, erreur, 'état des suivis');
    }
  }
);

router.post('/:id(\\d+)/suivis', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const id = await creerSuivi(Number(req.params.id), req.body ?? {}, req.user!.userId);
    res.status(201).json({ success: true, id });
  } catch (erreur) {
    echouer(res, erreur, 'création de suivi');
  }
});

router.get(
  '/:id(\\d+)/documents',
  authenticateToken,
  requireConsultationSite(siteDuParametre),
  async (req: AuthRequest, res: Response) => {
    try {
      const statut = STATUTS_DOCUMENT.includes(req.query.statut as StatutDocument)
        ? (req.query.statut as StatutDocument)
        : undefined;
      const documents = await listerDocuments({
        siteIds: [Number(req.params.id)],
        statut,
        rubriqueId: Number(req.query.rubrique) || undefined,
        suiviId: Number(req.query.suivi) || undefined,
        recherche: typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined,
      });
      res.json({ success: true, documents });
    } catch (erreur) {
      echouer(res, erreur, 'liste des documents');
    }
  }
);

/**
 * Dépose un document.
 *
 * La garde passe **avant** multer : un compte qui ne consulte pas ce bâtiment
 * n'écrit pas un octet sur le disque. Le fichier reçu est retiré si
 * l'enregistrement échoue ensuite, pour ne rien laisser d'orphelin.
 */
router.post(
  '/:id(\\d+)/documents',
  authenticateToken,
  requireConsultationSite(siteDuParametre),
  uploadLimiter,
  recevoirFichier,
  async (req: AuthRequest, res: Response) => {
    const fichier = req.file;
    if (!fichier) return refuser(res, 400, 'Aucun fichier reçu');
    try {
      const siteId = Number(req.params.id);
      const gere = await peutGererSite(req.user, siteId);
      const corps = req.body ?? {};
      const resultat = await joindre({
        siteId,
        pieceId: corps.pieceId,
        rubriqueId: corps.rubriqueId,
        suiviId: corps.suiviId,
        titre: corps.titre,
        description: corps.description,
        commentaireDepot: corps.commentaire,
        dateDocument: corps.dateDocument,
        prochaineEcheance: corps.prochaineEcheance,
        resultat: corps.resultat,
        creerSuivi: corps.creerSuivi,
        source: 'interne',
        deposePar: req.user!.userId,
        fichier: {
          chemin: fichier.filename,
          nomOrigine: nomDOrigine(fichier),
          mime: fichier.mimetype,
          taille: fichier.size,
        },
        ...(gere ? { validePar: req.user!.userId } : {}),
      });
      if (resultat.statut === 'a_valider') void notifierDepot(resultat.id);
      res.status(201).json({ success: true, ...resultat });
    } catch (erreur) {
      supprimerFichierPrive(fichier.filename);
      echouer(res, erreur, 'dépôt de document');
    }
  }
);

export default router;
