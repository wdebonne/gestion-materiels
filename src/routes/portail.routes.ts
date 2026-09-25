import { Router, Request, Response, NextFunction } from 'express';
import { connexionPortailLimiter } from '../middleware/rateLimiter.middleware';
import { messageErreurDepot, nomDOrigine, televersementPrive } from '../middleware/televersement';
import { cheminPrive, ErreurBatiment, SOUS_DOSSIER, supprimerFichierPrive } from '../services/batiments.service';
import { notifierDepot } from '../services/batimentsNotify.service';
import {
  deposer,
  documentsVisibles,
  documentVisible,
  droitsDe,
  echeancesVisibles,
  fermerSession,
  lireSession,
  ouvrirSession,
  retirerDepot,
  type SessionPortail,
} from '../services/portail.service';

/**
 * Le portail des entreprises extérieures — sans compte, par un lien et un code.
 *
 * Aucune route ici ne passe par `authenticateToken` : l'entreprise n'a pas de
 * jeton de l'application, et n'en aura jamais. Sa session est un jeton opaque,
 * porté par l'en-tête `X-Session-Portail` — et non par `Authorization`, que
 * l'intercepteur du client interne transformerait en déconnexion au premier
 * 401. Une session ne donne accès qu'à ces routes-ci.
 *
 * Monté derrière `portailLimiter` dans `server.ts` ; la saisie du code a en
 * plus son propre limiteur, par adresse et par lien.
 */

const router = Router();

interface RequetePortail extends Request {
  portail?: SessionPortail;
}

const ENTETE = 'x-session-portail';

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

function echouer(res: Response, erreur: unknown, contexte: string) {
  if (erreur instanceof ErreurBatiment) return refuser(res, erreur.statut, erreur.message);
  console.error(`Erreur portail — ${contexte} :`, erreur);
  return refuser(res, 500, 'Erreur serveur');
}

/** La session, ou un 401 qui renvoie l'entreprise à la saisie de son code. */
async function exigerSession(req: RequetePortail, res: Response, next: NextFunction) {
  try {
    const session = await lireSession(req.get(ENTETE));
    if (!session) return refuser(res, 401, 'Session expirée : saisissez à nouveau votre code');
    req.portail = session;
    next();
  } catch (erreur) {
    echouer(res, erreur, 'lecture de session');
  }
}

const MESSAGES_REFUS = {
  invalide: { code: 401, message: 'Lien ou code incorrect' },
  bloque: { code: 423, message: "Trop d'essais manqués : l'accès est bloqué pour une demi-heure" },
  suspendu: { code: 403, message: 'Votre accès est suspendu : contactez la collectivité' },
  expire: { code: 403, message: 'Votre accès a expiré : contactez la collectivité' },
} as const;

router.post('/:lien/connexion', connexionPortailLimiter, async (req: Request, res: Response) => {
  try {
    const resultat = await ouvrirSession(req.params.lien, req.body?.code, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    if ('refus' in resultat) {
      const { code, message } = MESSAGES_REFUS[resultat.refus];
      return refuser(res, code, message);
    }
    res.json({ success: true, ...resultat });
  } catch (erreur) {
    echouer(res, erreur, 'connexion');
  }
});

router.post('/deconnexion', async (req: Request, res: Response) => {
  try {
    await fermerSession(req.get(ENTETE));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'déconnexion');
  }
});

/** Qui l'on est, ce qui nous est ouvert, et ce qui arrive à échéance. */
router.get('/moi', exigerSession, async (req: RequetePortail, res: Response) => {
  try {
    const droits = await droitsDe(req.portail!.entrepriseId);
    res.json({
      success: true,
      entreprise: { nom: req.portail!.nom },
      batiments: droits.sites,
      objets: droits.rubriques,
      echeances: await echeancesVisibles(req.portail!.entrepriseId, droits),
    });
  } catch (erreur) {
    echouer(res, erreur, 'lecture des droits');
  }
});

router.get('/documents', exigerSession, async (req: RequetePortail, res: Response) => {
  try {
    res.json({ success: true, documents: await documentsVisibles(req.portail!.entrepriseId) });
  } catch (erreur) {
    echouer(res, erreur, 'liste des documents');
  }
});

/**
 * Le fichier, s'il est visible de l'entreprise. Un document qui ne l'est pas
 * répond comme un document qui n'existe pas.
 */
router.get('/documents/:id(\\d+)/fichier', exigerSession, async (req: RequetePortail, res: Response) => {
  try {
    const document = await documentVisible(req.portail!.entrepriseId, Number(req.params.id));
    const chemin = document ? cheminPrive(document.chemin) : null;
    if (!document || !chemin) return refuser(res, 404, 'Document introuvable');

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
});

const depot = televersementPrive(SOUS_DOSSIER);

/**
 * Dépose un document.
 *
 * La session est vérifiée **avant** multer : sans elle, pas un octet n'est
 * écrit sur le disque. Les droits le sont après, sur le bâtiment et l'objet
 * choisis ; un refus efface le fichier reçu.
 */
router.post(
  '/documents',
  exigerSession,
  (req: Request, res: Response, next: NextFunction) => {
    depot.single('fichier')(req, res, (erreur: any) => {
      if (erreur) return refuser(res, 400, messageErreurDepot(erreur));
      next();
    });
  },
  async (req: RequetePortail, res: Response) => {
    const fichier = req.file;
    if (!fichier) return refuser(res, 400, 'Aucun fichier reçu');
    try {
      const { id } = await deposer(req.portail!.entrepriseId, req.body ?? {}, {
        chemin: fichier.filename,
        nomOrigine: nomDOrigine(fichier),
        mime: fichier.mimetype,
        taille: fichier.size,
      });
      void notifierDepot(id);
      res.status(201).json({ success: true, id });
    } catch (erreur) {
      supprimerFichierPrive(fichier.filename);
      echouer(res, erreur, 'dépôt');
    }
  }
);

/** Retire l'un de ses dépôts, tant qu'il n'a pas été relu. */
router.delete('/documents/:id(\\d+)', exigerSession, async (req: RequetePortail, res: Response) => {
  try {
    const chemin = await retirerDepot(req.portail!.entrepriseId, Number(req.params.id));
    if (!chemin) return refuser(res, 404, 'Ce dépôt ne peut plus être retiré');
    supprimerFichierPrive(chemin);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'retrait de dépôt');
  }
});

export default router;
