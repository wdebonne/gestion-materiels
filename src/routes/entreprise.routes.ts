import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireGestionLieux } from '../services/gestionOrganisation.service';
import { ErreurBatiment } from '../services/batiments.service';
import {
  creerEntreprise,
  definirContacts,
  definirDroits,
  deverrouiller,
  envoyerAcces,
  genererAcces,
  lireEntreprise,
  listerEntreprises,
  modifierEntreprise,
  reglerAcces,
  supprimerEntreprise,
  urlPortail,
} from '../services/entreprises.service';
import { logService } from '../services/log.service';

/**
 * Les entreprises extérieures, côté collectivité.
 *
 * Toutes les routes sont gardées par la gestion de **tous** les lieux : une
 * entreprise intervient dans plusieurs bâtiments, et lui ouvrir l'école
 * n'appartient pas au seul gestionnaire de la mairie. Le code d'accès n'est
 * jamais relu — seule la génération le rend, une fois.
 */

const router = Router();
router.use(authenticateToken, requireGestionLieux);

function echouer(res: Response, erreur: unknown, contexte: string) {
  if (erreur instanceof ErreurBatiment) {
    return res.status(erreur.statut).json({ success: false, message: erreur.message });
  }
  console.error(`Erreur ${contexte} :`, erreur);
  return res.status(500).json({ success: false, message: 'Erreur serveur' });
}

const hote = (req: AuthRequest) => `${req.protocol}://${req.get('host')}`;

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, entreprises: await listerEntreprises() });
  } catch (erreur) {
    echouer(res, erreur, 'liste des entreprises');
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const id = await creerEntreprise(req.body ?? {}, req.user!.userId);
    if (Array.isArray(req.body?.contacts)) await definirContacts(id, req.body.contacts);
    res.status(201).json({ success: true, id });
  } catch (erreur) {
    echouer(res, erreur, "création d'entreprise");
  }
});

router.get('/:id(\\d+)', async (req: AuthRequest, res: Response) => {
  try {
    const entreprise = await lireEntreprise(req.params.id);
    if (!entreprise) return res.status(404).json({ success: false, message: 'Entreprise introuvable' });
    res.json({ success: true, entreprise, lien: await urlPortail(entreprise.lienJeton, hote(req)) });
  } catch (erreur) {
    echouer(res, erreur, "lecture d'entreprise");
  }
});

router.put('/:id(\\d+)', async (req: AuthRequest, res: Response) => {
  try {
    await modifierEntreprise(Number(req.params.id), req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, "modification d'entreprise");
  }
});

router.delete('/:id(\\d+)', async (req: AuthRequest, res: Response) => {
  try {
    await supprimerEntreprise(Number(req.params.id));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, "suppression d'entreprise");
  }
});

router.put('/:id(\\d+)/contacts', async (req: AuthRequest, res: Response) => {
  try {
    await definirContacts(Number(req.params.id), req.body?.contacts);
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'enregistrement des contacts');
  }
});

router.put('/:id(\\d+)/droits', async (req: AuthRequest, res: Response) => {
  try {
    await definirDroits(Number(req.params.id), req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'enregistrement des droits');
  }
});

/**
 * Tire un nouveau code — l'ancien cesse de fonctionner — et l'envoie si on le
 * demande. Le code et le lien reviennent **dans la réponse** : c'est la seule
 * fois qu'on peut les montrer, et l'écran les propose à la copie, que le
 * courriel soit parti ou non.
 */
router.post('/:id(\\d+)/acces', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const code = await genererAcces(id);
    const entreprise = (await lireEntreprise(id))!;
    const lien = await urlPortail(entreprise.lienJeton, hote(req));

    const envoi =
      req.body?.envoyer === false
        ? { resultat: 'non_demande' as const, destinataires: [] as string[] }
        : await envoyerAcces(id, code, { inclureCode: req.body?.inclureCode !== false, hote: hote(req) });

    // Un accès délivré est un fait de sécurité : qui l'a donné, à qui, quand.
    await logService.info(
      'security',
      `Accès au portail des entreprises régénéré pour ${entreprise.nom}`,
      { entrepriseId: id, envoi: envoi.resultat },
      { userId: req.user!.userId, userEmail: req.user!.email }
    );

    res.json({ success: true, code, lien, envoi });
  } catch (erreur) {
    echouer(res, erreur, "génération d'accès");
  }
});

router.put('/:id(\\d+)/acces', async (req: AuthRequest, res: Response) => {
  try {
    await reglerAcces(Number(req.params.id), req.body ?? {});
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, "réglage d'accès");
  }
});

router.post('/:id(\\d+)/deverrouiller', async (req: AuthRequest, res: Response) => {
  try {
    await deverrouiller(Number(req.params.id));
    res.json({ success: true });
  } catch (erreur) {
    echouer(res, erreur, 'déverrouillage');
  }
});

export default router;
