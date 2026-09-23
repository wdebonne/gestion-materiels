import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { MOT_DE_PASSE_TEST, NOMBRE_ETAPES, chargerDonneesTest, purger } from '../database/charge/index';
import { creerSauvegarde } from '../services/sauvegarde.service';
import {
  BaseEnProduction,
  etatDonneesTest,
  reinitialiserPourProduction,
  verifierHorsProduction,
} from '../services/donneesTest.service';
import { logService } from '../services/log.service';

/**
 * Données de test, depuis Paramètres › Base de données.
 *
 * Charger un gros jeu prend de quelques secondes (SQLite) à quelques minutes
 * (MySQL) : l'opération tourne en arrière-plan, et l'écran suit son avancement
 * par `GET /etat`. Une seule opération à la fois.
 */

const router = Router();

/** La phrase à taper pour réinitialiser : un clic ne suffit pas à vider une base. */
export const PHRASE_REINITIALISATION = 'REINITIALISER';

type TypeOperation = 'charger' | 'purger' | 'reinitialiser';

interface Operation {
  type: TypeOperation;
  debut: string;
  fin: string | null;
  etape: string | null;
  rang: number;
  total: number;
  erreur: string | null;
  sauvegardeDeSecurite: string | null;
  resultat: unknown;
}

let operation: Operation | null = null;

function enCours(): boolean {
  return operation !== null && operation.fin === null;
}

/**
 * Lance `travail` en arrière-plan et rend la main tout de suite. L'erreur n'est
 * pas perdue : elle reste dans l'état jusqu'à la prochaine opération.
 */
function lancer(req: AuthRequest, type: TypeOperation, total: number, travail: (op: Operation) => Promise<unknown>): Operation {
  const op: Operation = {
    type,
    debut: new Date().toISOString(),
    fin: null,
    etape: null,
    rang: 0,
    total,
    erreur: null,
    sauvegardeDeSecurite: null,
    resultat: null,
  };
  operation = op;
  const contexte = { userId: req.user?.userId, userEmail: req.user?.email };

  travail(op)
    .then(async (resultat) => {
      op.resultat = resultat;
      await logService.success('database', `Données de test : ${type} terminé`, { resultat, sauvegarde: op.sauvegardeDeSecurite }, contexte);
    })
    .catch(async (erreur) => {
      op.erreur = erreur instanceof Error ? erreur.message : String(erreur);
      console.error(`Données de test (${type}) :`, erreur);
      await logService.error('database', `Données de test : ${type} en échec`, { erreur: op.erreur }, contexte).catch(() => undefined);
    })
    .finally(() => {
      op.fin = new Date().toISOString();
      op.etape = null;
    });

  return op;
}

function refuserSiOccupe(res: Response): boolean {
  if (!enCours()) return false;
  res.status(409).json({ success: false, message: `Une opération est déjà en cours (${operation!.type}).` });
  return true;
}

function repondreErreur(res: Response, erreur: unknown) {
  if (erreur instanceof BaseEnProduction) {
    return res.status(403).json({ success: false, message: erreur.message });
  }
  console.error('Données de test :', erreur);
  res.status(500).json({ success: false, message: erreur instanceof Error ? erreur.message : 'Erreur serveur' });
}

// GET /api/donnees-test/etat
router.get('/etat', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: { ...(await etatDonneesTest()), operation, motDePasseTest: MOT_DE_PASSE_TEST, phrase: PHRASE_REINITIALISATION },
    });
  } catch (erreur) {
    repondreErreur(res, erreur);
  }
});

// POST /api/donnees-test/charger { echelle }
router.post('/charger', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (refuserSiOccupe(res)) return;
    await verifierHorsProduction();

    const echelle = Number(req.body?.echelle ?? 1);
    if (!Number.isFinite(echelle) || echelle <= 0 || echelle > 5) {
      return res.status(400).json({ success: false, message: "L'échelle doit être comprise entre 0,05 et 5." });
    }

    const op = lancer(req, 'charger', NOMBRE_ETAPES, async (courante) => {
      await chargerDonneesTest({ echelle, graine: Date.now() % 100_000 }, (etape, rang) => {
        courante.etape = etape;
        courante.rang = rang;
      });
      return { echelle };
    });
    res.status(202).json({ success: true, data: op });
  } catch (erreur) {
    repondreErreur(res, erreur);
  }
});

// POST /api/donnees-test/purger
router.post('/purger', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (refuserSiOccupe(res)) return;

    const op = lancer(req, 'purger', 2, async (courante) => {
      courante.etape = 'Sauvegarde de sécurité';
      courante.rang = 1;
      courante.sauvegardeDeSecurite = (await creerSauvegarde({ type: 'securite', notes: 'Avant la purge des données de test' })).filename;
      courante.etape = 'Purge du jeu de test';
      courante.rang = 2;
      return { lignes: await purger() };
    });
    res.status(202).json({ success: true, data: op });
  } catch (erreur) {
    repondreErreur(res, erreur);
  }
});

// POST /api/donnees-test/reinitialiser { confirmation }
router.post('/reinitialiser', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (refuserSiOccupe(res)) return;
    await verifierHorsProduction();

    if (String(req.body?.confirmation ?? '').trim() !== PHRASE_REINITIALISATION) {
      return res.status(400).json({ success: false, message: `Tapez ${PHRASE_REINITIALISATION} pour confirmer.` });
    }

    const op = lancer(req, 'reinitialiser', 2, async (courante) => {
      courante.etape = 'Sauvegarde de sécurité';
      courante.rang = 1;
      courante.sauvegardeDeSecurite = (
        await creerSauvegarde({ type: 'securite', notes: 'Avant la réinitialisation pour la production' })
      ).filename;
      courante.etape = 'Effacement des données';
      courante.rang = 2;
      return reinitialiserPourProduction();
    });
    res.status(202).json({ success: true, data: op });
  } catch (erreur) {
    repondreErreur(res, erreur);
  }
});

export default router;
