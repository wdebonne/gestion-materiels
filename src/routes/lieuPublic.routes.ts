import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/secrets';
import type { JwtPayload } from '../middleware/auth.middleware';
import { lieuxPretables, TYPE_SALLE } from '../services/lieux.service';
import { conflitsPour } from '../services/occupationLieux.service';
import { fluxDuLieu, lieuDuJeton } from '../services/agendaLieu.service';

/**
 * Ce que le formulaire externe peut demander, sans compte.
 *
 * Monté **avant** `/api/sites`, comme le dépôt d'une demande de manifestation
 * l'est avant `/api/manifestations` et la page du trousseau avant `/api/cles` :
 * c'est la seule route des lieux qui n'exige pas de compte, et elle ne doit pas
 * se retrouver derrière `authenticateToken`.
 *
 * ## Deux publics, une adresse — et l'anonyme n'apprend pas qui se marie
 *
 * C'est le raisonnement de `clePublic.routes.ts`, qui montre au passant un
 * message et à l'agent connecté le détenteur du trousseau. Ici :
 *
 *   **un inconnu** — l'habitant qui remplit le formulaire de demande de salle —
 *   reçoit les **bornes** des créneaux déjà pris, et rien d'autre. Il voit que
 *   la salle des mariages est occupée le 28 de 16h à 18h, et peut choisir un
 *   autre horaire sans savoir qui s'y marie.
 *
 *   **un agent connecté** reçoit en plus l'intitulé et le demandeur, parce que
 *   c'est lui qui arbitre.
 *
 * Renvoyer « Mariage Dupont, 16h–18h » sur une URL publique publierait l'agenda
 * des administrés. Le jeton est donc lu en *optionnel* : absent ou périmé, la
 * réponse se dégrade sans jamais produire un 401 — une route publique qui
 * répondrait « non autorisé » aurait manqué sa seule raison d'être.
 *
 * ## Seuls les lieux ouverts au prêt répondent
 *
 * C'est ce qui rend l'adresse publiable. Un lieu qui n'est pas marqué prêtable
 * n'existe pas pour cette route : on n'expose pas l'occupation du centre
 * technique ni du local électrique parce que quelqu'un a deviné un identifiant.
 */

const router = Router();

/** Qui appelle, si tant est qu'on puisse le dire. Jamais un refus. */
function agentConnecte(req: Request): boolean {
  const entete = req.headers.authorization;
  const jeton = entete?.startsWith('Bearer ') ? entete.slice(7) : (req as any).cookies?.token;
  if (!jeton) return false;

  try {
    jwt.verify(jeton, getJwtSecret()) as JwtPayload;
    return true;
  } catch {
    // Jeton périmé ou illisible : on dégrade vers la vue anonyme.
    return false;
  }
}

/**
 * Les lieux qu'on peut demander, et leur occupation sur un créneau.
 *
 * Sans `debut`/`fin`, rend simplement la liste des lieux prêtables — ce dont le
 * formulaire a besoin pour composer sa question. Avec, il ajoute à chacun ce qui
 * l'occupe déjà.
 *
 * `type` restreint à un type de pièce (`?type=Salle`), sans tenir compte de la
 * casse ; les bâtiments entiers sont alors écartés. Chaque lieu porte un
 * `libelle` — « Salle du conseil — Mairie » — que le formulaire affiche tel
 * quel, sans avoir à recomposer nom et bâtiment.
 */
router.get('/disponibilite', (req: Request, res: Response) =>
  repondreDisponibilite(req, res, req.query.type ? String(req.query.type) : null)
);

/**
 * Les salles qu'on peut demander : `/disponibilite?type=Salle`, sous un nom
 * qui se lit.
 *
 * C'est l'adresse à donner au formulaire de réservation de salle — la salle du
 * conseil, des mariages, du CCAS. Mêmes paramètres (`debut`, `fin`,
 * `capacite`), même réponse, mêmes règles d'anonymat.
 */
router.get('/salles', (req: Request, res: Response) => repondreDisponibilite(req, res, TYPE_SALLE));

async function repondreDisponibilite(req: Request, res: Response, typeLieu: string | null) {
  try {
    const debut = req.query.debut ? String(req.query.debut) : null;
    const fin = req.query.fin ? String(req.query.fin) : null;

    const capaciteBrute = req.query.capacite;
    const capacite =
      capaciteBrute === undefined || capaciteBrute === '' ? undefined : Number(capaciteBrute);
    if (capacite !== undefined && !Number.isFinite(capacite)) {
      return res.status(400).json({ success: false, message: 'Capacité invalide' });
    }

    const lieux = await lieuxPretables({ capaciteMinimale: capacite, typeLieu });

    if (!debut || !fin) {
      return res.json({ success: true, lieux, creneau: null });
    }
    if (fin <= debut) {
      return res.status(400).json({ success: false, message: 'La fin doit être après le début' });
    }

    const detaille = agentConnecte(req);

    const avecOccupation = [];
    for (const lieu of lieux) {
      const conflits = await conflitsPour({
        siteId: lieu.siteId,
        pieceId: lieu.pieceId,
        debut,
        fin,
      });

      avecOccupation.push({
        ...lieu,
        libre: conflits.length === 0,
        occupe: conflits.map((c) => ({
          debut: c.debut,
          fin: c.fin,
          statut: c.statut,
          // L'intitulé et le demandeur ne sortent que pour un agent connecté.
          ...(detaille ? { titre: c.titre, lieu: c.piece_name ?? c.site_name } : {}),
        })),
      });
    }

    res.json({ success: true, lieux: avecOccupation, creneau: { debut, fin }, detaille });
  } catch (erreur: any) {
    console.error('Erreur disponibilité publique des lieux :', erreur);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
}

/**
 * Le flux d'abonnement d'un lieu.
 *
 * `:token.ics` et non `:token` : plusieurs clients d'agenda refusent une URL
 * qui ne finit pas par `.ics`, quel que soit le `Content-Type` renvoyé. Le
 * suffixe est donc retiré ici plutôt qu'exigé de l'abonné.
 *
 * Un jeton inconnu **ou révoqué** répond 404, jamais 403 : une URL retirée doit
 * disparaître, pas confirmer à qui l'a gardée que la salle existe et qu'il avait
 * bien l'adresse.
 */
router.get('/agenda/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token).replace(/\.ics$/i, '');
    const jeton = await lieuDuJeton(token);
    if (!jeton) return res.status(404).json({ success: false, message: 'Agenda introuvable' });

    const flux = await fluxDuLieu(jeton);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // Un agenda n'est pas une page : les clients le rechargent d'eux-mêmes, et
    // un cache intermédiaire servirait des créneaux périmés à tout le monde.
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(flux);
  } catch (erreur: any) {
    console.error('Erreur flux d’agenda de lieu :', erreur);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
