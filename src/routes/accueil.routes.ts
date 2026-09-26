import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import {
  ACTIONS,
  BLOCS,
  ErreurAccueil,
  MAX_ACTIONS,
  ajouterFavori,
  enregistrerAccueil,
  importerFavorisLocaux,
  lireAccueil,
  listerFavoris,
  renommerFavori,
  reordonnerFavoris,
  retirerCible,
  retirerFavori,
} from '../services/accueil.service';

/**
 * L'accueil de la personne connectée : sa disposition, ses favoris.
 *
 * Aucune route ne prend d'identifiant d'utilisateur : chacun ne lit et
 * n'écrit que les siens, et il n'y a donc rien à vérifier de plus.
 */
const router = Router();

function echouer(res: Response, erreur: unknown, contexte: string) {
  if (erreur instanceof ErreurAccueil) {
    return res.status(erreur.statut).json({ success: false, message: erreur.message });
  }
  console.error(`Erreur accueil (${contexte}) :`, erreur);
  return res.status(500).json({ success: false, message: 'Erreur serveur' });
}

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      ...(await lireAccueil(req.user!.userId)),
      catalogue: { blocs: BLOCS, actions: ACTIONS, maxActions: MAX_ACTIONS },
    });
  } catch (erreur) {
    echouer(res, erreur, 'lecture');
  }
});

router.put('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { blocs, actions } = req.body ?? {};
    res.json({ success: true, ...(await enregistrerAccueil(req.user!.userId, { blocs, actions })) });
  } catch (erreur) {
    echouer(res, erreur, 'enregistrement');
  }
});

router.get('/favoris', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, favoris: await listerFavoris(req) });
  } catch (erreur) {
    echouer(res, erreur, 'favoris');
  }
});

router.post('/favoris', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await ajouterFavori(req, req.body ?? {});
    res.status(resultat.cree ? 201 : 200).json({ success: true, ...resultat });
  } catch (erreur) {
    echouer(res, erreur, 'ajout de favori');
  }
});

// Avant `/favoris/:id` : « ordre » et « import » ne sont pas des identifiants.
router.put('/favoris/ordre', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await reordonnerFavoris(req.user!.userId, req.body?.ids);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'ordre des favoris');
  }
});

router.post('/favoris/import', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await importerFavorisLocaux(req, req.body?.ids)) });
  } catch (erreur) {
    echouer(res, erreur, 'import des favoris');
  }
});

/** Retirer depuis une fiche, qui connaît sa cible et pas le favori. */
router.delete('/favoris/cible/:type/:cibleId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await retirerCible(req.user!.userId, req.params.type, req.params.cibleId);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'retrait de favori');
  }
});

router.patch('/favoris/:id(\\d+)', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await renommerFavori(req.user!.userId, Number(req.params.id), req.body?.libelle);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'renommage de favori');
  }
});

router.delete('/favoris/:id(\\d+)', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await retirerFavori(req.user!.userId, Number(req.params.id)))) {
      return res.status(404).json({ success: false, message: 'Favori introuvable' });
    }
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'retrait de favori');
  }
});

export default router;
