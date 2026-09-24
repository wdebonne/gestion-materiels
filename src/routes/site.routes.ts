import { Router, Response } from 'express';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireSupervisor,
} from '../middleware/auth.middleware';
import { listerSites, lireSite, ouvrantsDe, sitesDe, sitesProposesA, usagesSite } from '../services/sites.service';
import {
  arbreDesLieux,
  creerPiece,
  lieuxPretables,
  lirePiece,
  listerPieces,
  modifierPiece,
  usagesPiece,
} from '../services/lieux.service';
import {
  creerJetonAgenda,
  jetonsDuSite,
  revoquerJetonAgenda,
} from '../services/agendaLieu.service';
import {
  avertissements,
  bloquants,
  conflitsPour,
  creerOccupation,
  listerOccupations,
  lireOccupation,
  modifierOccupation,
  supprimerOccupation,
  STATUTS_OCCUPATION,
  type StatutOccupation,
} from '../services/occupationLieux.service';
import { versDateTime } from '../services/tickets.service';
import {
  peutGererLieux,
  requireGestionLieux,
  requireGestionSite,
  siteDeLaPiece,
  siteDuCorps,
  siteDuParametre,
} from '../services/gestionOrganisation.service';

/**
 * Les sites et bâtiments de la commune.
 *
 * Le référentiel est physiquement celui du module Clés (`cle_sites`, migration
 * 024) : il porte déjà la mairie, la salle des fêtes et le centre de loisirs.
 * Cette route est la porte partagée, ouverte le jour où les demandes ont eu
 * besoin de désigner un lieu. Voir `sites.service.ts` pour la raison du nom.
 *
 * `/mes-sites` est déclarée **avant** `/:id` : Express résout dans l'ordre de
 * déclaration, et `/:id` avalerait autrement le chemin littéral.
 */

const router = Router();

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

/**
 * Lit un créneau depuis une requête, ou dit ce qui manque.
 *
 * Écrit une fois pour les quatre routes qui en prennent un : la disponibilité,
 * la création, la modification et le filtre. Quatre lectures séparées finiraient
 * par diverger sur ce qu'elles acceptent, et l'écran demanderait alors une
 * disponibilité sur des bornes que l'enregistrement refuserait.
 *
 * `fin` doit être **après** `debut`, jamais égale : un créneau de durée nulle
 * n'occupe rien, et ne heurterait jamais rien puisque les bornes sont
 * exclusives. L'accepter laisserait poser des réservations invisibles.
 */
function lireCreneau(
  source: any
): { siteId: number; pieceId: number | null; debut: string; fin: string } | { erreur: string } {
  const siteId = Number(source?.siteId);
  if (!Number.isFinite(siteId) || siteId <= 0) return { erreur: 'Le bâtiment est obligatoire' };

  const debut = String(source?.debut ?? '').trim();
  const fin = String(source?.fin ?? '').trim();
  if (!debut || !fin) return { erreur: 'Les dates de début et de fin sont obligatoires' };
  if (fin <= debut) return { erreur: 'La fin doit être après le début' };

  const pieceBrute = source?.pieceId;
  const pieceId =
    pieceBrute === undefined || pieceBrute === null || pieceBrute === '' ? null : Number(pieceBrute);
  if (pieceId !== null && !Number.isFinite(pieceId)) return { erreur: 'Pièce invalide' };

  return { siteId, pieceId, debut, fin };
}

/** Un statut inconnu retombe sur `confirme` plutôt que d'entrer en base tel quel. */
function lireStatut(brut: unknown): StatutOccupation {
  const valeur = String(brut ?? '').trim();
  return (STATUTS_OCCUPATION as readonly string[]).includes(valeur)
    ? (valeur as StatutOccupation)
    : 'confirme';
}

/**
 * Mes bâtiments, et ce que le formulaire doit en faire.
 *
 * `impose` porte la réponse à « un utilisateur peut avoir que 1 bâtiment mais
 * aussi plusieurs » : renseigné, l'écran masque le champ et retient la valeur.
 * Le calcul est fait ici pour que les deux écrans qui en ont besoin — le
 * formulaire et la fiche — ne le refassent pas chacun à leur façon.
 */
router.get('/mes-sites', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const rattaches = await sitesDe(req.user!.userId);
    const proposes = await sitesProposesA(req.user!.userId);
    res.json({
      success: true,
      sites: proposes,
      rattaches,
      impose: proposes.length === 1 ? proposes[0].id : null,
      // Les bâtiments dont je lis les demandes des collègues.
      partages: rattaches.filter((s) => s.peutVoirTickets).map((s) => s.id),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture de mes sites :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, sites: await listerSites(req.query.tous === 'true') });
  } catch (erreur: any) {
    console.error('Erreur liste des sites :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ============================ PIÈCES ET LIEUX ============================

/*
 * Tout ce qui suit jusqu'à `/:id` porte un segment littéral, et doit donc être
 * déclaré ici. C'est l'avertissement déjà posé plus haut pour `/mes-sites` :
 * Express résout dans l'ordre de déclaration, et `/:id` avalerait autrement
 * `arbre` et `pretables` en les prenant pour des identifiants.
 */

/** Le référentiel entier — bâtiments, pièces, ouvrants — en une lecture. */
router.get('/arbre', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, sites: await arbreDesLieux(req.query.tous === 'true') });
  } catch (erreur: any) {
    console.error('Erreur lecture du référentiel des lieux :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Les lieux ouverts au prêt.
 *
 * `capacite` écarte les salles trop petites pour le nombre annoncé. Une pièce
 * dont la jauge n'est pas renseignée reste proposée : voir `lieuxPretables`.
 */
router.get('/pretables', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const brut = req.query.capacite;
    const capacite = brut === undefined || brut === '' ? undefined : Number(brut);
    if (capacite !== undefined && !Number.isFinite(capacite)) {
      return refuser(res, 400, 'Capacité invalide');
    }
    res.json({ success: true, lieux: await lieuxPretables({ capaciteMinimale: capacite }) });
  } catch (erreur: any) {
    console.error('Erreur lecture des lieux prêtables :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/pieces', authenticateToken, requireGestionSite(siteDuCorps), async (req: AuthRequest, res: Response) => {
  try {
    const siteId = Number(req.body?.siteId);
    const nom = String(req.body?.nom ?? '').trim();
    if (!Number.isFinite(siteId) || siteId <= 0) return refuser(res, 400, 'Le bâtiment est obligatoire');
    if (!nom) return refuser(res, 400, 'Le nom est obligatoire');
    if (!(await lireSite(siteId))) return refuser(res, 404, 'Bâtiment introuvable');

    const id = await creerPiece({
      siteId,
      nom,
      code: req.body?.code ?? null,
      description: req.body?.description ?? null,
      typeLieu: req.body?.typeLieu ?? null,
      capacite: req.body?.capacite === undefined || req.body?.capacite === '' ? null : Number(req.body.capacite),
      pretable: req.body?.pretable,
      ordre: Number(req.body?.ordre ?? 0),
    });
    res.status(201).json({ success: true, id });
  } catch (erreur: any) {
    console.error('Erreur création de pièce :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/pieces/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const piece = await lirePiece(req.params.id);
    if (!piece) return refuser(res, 404, 'Pièce introuvable');
    res.json({ success: true, piece });
  } catch (erreur: any) {
    console.error('Erreur lecture de pièce :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/pieces/:id', authenticateToken, requireGestionSite(siteDeLaPiece), async (req: AuthRequest, res: Response) => {
  try {
    if (!(await lirePiece(req.params.id))) return refuser(res, 404, 'Pièce introuvable');

    await modifierPiece(req.params.id, {
      nom: req.body?.nom === undefined ? undefined : String(req.body.nom).trim(),
      code: req.body?.code,
      description: req.body?.description,
      typeLieu: req.body?.typeLieu,
      capacite:
        req.body?.capacite === undefined
          ? undefined
          : req.body.capacite === '' || req.body.capacite === null
            ? null
            : Number(req.body.capacite),
      // Passé tel quel : c'est `lireDisponibilite` qui distingue « hérite »
      // (chaîne vide, null) de « non » (false), et la route n'a pas à refaire
      // cette lecture d'une deuxième façon.
      pretable: req.body?.pretable,
      ordre: req.body?.ordre === undefined ? undefined : Number(req.body.ordre),
      actif: req.body?.actif === undefined ? undefined : Boolean(req.body.actif),
    });
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur modification de pièce :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Supprime une pièce — seulement si rien ne la cite.
 *
 * Même règle que pour un bâtiment, et même raison : une clé qui ouvre cette
 * pièce deviendrait un bout de métal sans usage connu, et un ticket perdrait
 * son lieu. Le refus porte le nombre, parce qu'il dit alors quoi faire.
 *
 * Les ouvrants ne bloquent pas : ils retombent sur le bâtiment, comme le
 * `ON DELETE SET NULL` de la migration 037 l'organise.
 */
router.delete('/pieces/:id', authenticateToken, requireGestionSite(siteDeLaPiece), async (req: AuthRequest, res: Response) => {
  try {
    if (!(await lirePiece(req.params.id))) return refuser(res, 404, 'Pièce introuvable');

    const usages = await usagesPiece(req.params.id);
    const { ouvrants, ...bloquants } = usages;
    const empeche = Object.entries(bloquants).filter(([, n]) => n > 0);
    if (empeche.length > 0) {
      const detail = empeche.map(([quoi, n]) => `${n} ${quoi}`).join(', ');
      return refuser(res, 409, `Cette pièce est encore employée (${detail}) : désactivez-la plutôt`);
    }

    await db.execute('DELETE FROM site_pieces WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Pièce supprimée' });
  } catch (erreur: any) {
    console.error('Erreur suppression de pièce :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// =========================== OCCUPATION DES LIEUX ===========================

/** Les créneaux d'une période, pour l'agenda d'une salle ou d'un bâtiment. */
router.get('/occupations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      occupations: await listerOccupations({
        debut: req.query.debut ? String(req.query.debut) : undefined,
        fin: req.query.fin ? String(req.query.fin) : undefined,
        siteId: req.query.siteId ? Number(req.query.siteId) : null,
        pieceId: req.query.pieceId ? Number(req.query.pieceId) : null,
        // `tous` ramène les annulés, que l'agenda masque par défaut.
        statuts: req.query.tous === 'true' ? STATUTS_OCCUPATION : undefined,
      }),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des occupations :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Ce qui heurte un créneau, avant de l'enregistrer.
 *
 * Le même appel que celui du refus, pour que l'écran et le serveur ne puissent
 * pas dire deux choses différentes — la règle posée par `requeteConflits` dans
 * `reservation.routes.ts`.
 */
router.get('/disponibilite', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const creneau = lireCreneau(req.query);
    if ('erreur' in creneau) return refuser(res, 400, creneau.erreur);

    const conflits = await conflitsPour({
      ...creneau,
      ignorerId: req.query.ignorerId ? Number(req.query.ignorerId) : null,
    });
    res.json({
      success: true,
      libre: conflits.length === 0,
      conflits,
      bloquants: bloquants(conflits),
      avertissements: avertissements(conflits),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture de disponibilité :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Pose un créneau.
 *
 * Un conflit **confirmé** refuse : deux manifestations ne tiennent pas dans la
 * même salle. Une simple **demande** n'est rendue qu'en avertissement, avec le
 * créneau créé : c'est au superviseur d'arbitrer, et refuser ici ferait perdre
 * la seconde demande.
 *
 * `force` permet de passer outre un conflit confirmé — le régisseur sait parfois
 * que l'autre occupation va être annulée, et l'application ne doit pas être plus
 * têtue que lui. Le créneau est alors posé tel quel, et les deux se voient.
 */
router.post('/occupations', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const creneau = lireCreneau(req.body);
    if ('erreur' in creneau) return refuser(res, 400, creneau.erreur);

    const titre = String(req.body?.titre ?? '').trim();
    if (!titre) return refuser(res, 400, 'Le titre est obligatoire');

    const conflits = await conflitsPour(creneau);
    const durs = bloquants(conflits);
    if (durs.length > 0 && req.body?.force !== true) {
      return res.status(409).json({
        success: false,
        message: `Ce lieu est déjà retenu sur ce créneau (${durs.length})`,
        conflits: durs,
      });
    }

    const id = await creerOccupation({
      ...creneau,
      titre,
      statut: lireStatut(req.body?.statut),
      demandeur: req.body?.demandeur ?? null,
      notes: req.body?.notes ?? null,
      creePar: req.user!.userId,
    });

    res.status(201).json({ success: true, id, avertissements: avertissements(conflits) });
  } catch (erreur: any) {
    console.error('Erreur création d’occupation :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/occupations/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existante = await lireOccupation(req.params.id);
    if (!existante) return refuser(res, 404, 'Créneau introuvable');

    // Le créneau n'est revérifié que s'il bouge : changer le seul titre ne doit
    // pas buter sur un conflit qui existait déjà et qu'on a accepté.
    const bouge =
      req.body?.debut !== undefined ||
      req.body?.fin !== undefined ||
      req.body?.siteId !== undefined ||
      req.body?.pieceId !== undefined;

    if (bouge) {
      const creneau = lireCreneau({
        siteId: req.body?.siteId ?? existante.site_id,
        pieceId: req.body?.pieceId === undefined ? existante.piece_id : req.body.pieceId,
        debut: req.body?.debut ?? existante.debut,
        fin: req.body?.fin ?? existante.fin,
      });
      if ('erreur' in creneau) return refuser(res, 400, creneau.erreur);

      const durs = bloquants(await conflitsPour({ ...creneau, ignorerId: Number(req.params.id) }));
      if (durs.length > 0 && req.body?.force !== true) {
        return res.status(409).json({
          success: false,
          message: `Ce lieu est déjà retenu sur ce créneau (${durs.length})`,
          conflits: durs,
        });
      }
    }

    await modifierOccupation(req.params.id, {
      siteId: req.body?.siteId === undefined ? undefined : Number(req.body.siteId),
      pieceId:
        req.body?.pieceId === undefined ? undefined : req.body.pieceId ? Number(req.body.pieceId) : null,
      titre: req.body?.titre === undefined ? undefined : String(req.body.titre).trim(),
      debut: req.body?.debut,
      fin: req.body?.fin,
      statut: req.body?.statut === undefined ? undefined : lireStatut(req.body.statut),
      demandeur: req.body?.demandeur,
      notes: req.body?.notes,
    });
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur modification d’occupation :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/occupations/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await lireOccupation(req.params.id))) return refuser(res, 404, 'Créneau introuvable');
    await supprimerOccupation(req.params.id);
    res.json({ success: true, message: 'Créneau supprimé' });
  } catch (erreur: any) {
    console.error('Erreur suppression d’occupation :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ============================ PARTAGE D'AGENDA ============================

/**
 * Les abonnements ouverts sur les lieux d'un bâtiment.
 *
 * Réservé au superviseur : la liste porte les URL, et une URL d'agenda vaut
 * l'accès qu'elle ouvre.
 */
router.get('/:id/agenda', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await lireSite(req.params.id))) return refuser(res, 404, 'Bâtiment introuvable');
    res.json({ success: true, jetons: await jetonsDuSite(req.params.id) });
  } catch (erreur: any) {
    console.error('Erreur lecture des abonnements :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/:id/agenda', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Bâtiment introuvable');

    const pieceId = req.body?.pieceId ? Number(req.body.pieceId) : null;
    if (pieceId !== null) {
      const piece = await lirePiece(pieceId);
      // Une pièce d'un autre bâtiment ouvrirait un agenda que l'écran croirait
      // rattaché à celui-ci.
      if (!piece || piece.siteId !== Number(req.params.id)) {
        return refuser(res, 400, 'Cette pièce n’appartient pas à ce bâtiment');
      }
    }

    const jeton = await creerJetonAgenda({
      siteId: Number(req.params.id),
      pieceId,
      label: req.body?.label ?? null,
      creePar: req.user!.userId,
    });
    res.status(201).json({ success: true, jeton });
  } catch (erreur: any) {
    console.error('Erreur création d’abonnement :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/agenda/:jetonId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    await revoquerJetonAgenda(req.params.jetonId);
    res.json({ success: true, message: 'Abonnement révoqué' });
  } catch (erreur: any) {
    console.error('Erreur révocation d’abonnement :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ============================== UN BÂTIMENT ==============================

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');
    res.json({
      success: true,
      site,
      ouvrants: await ouvrantsDe(req.params.id),
      pieces: await listerPieces(req.params.id),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/:id/ouvrants', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ouvrants: await ouvrantsDe(req.params.id) });
  } catch (erreur: any) {
    console.error('Erreur lecture des ouvrants :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/:id/pieces', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      pieces: await listerPieces(req.params.id, req.query.tous === 'true'),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des pièces :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Qui est rattaché à ce bâtiment, et avec quels droits.
 *
 * Les quatre droits sont ceux de `sites.service.ts`, plus `gereLieu` depuis la
 * migration 040. Lisible et modifiable par le gestionnaire du bâtiment, pour
 * qu'il tienne lui-même la liste de ceux qui y travaillent — à une exception
 * près, tenue par `peutAccorderGestion` : il ne fait pas d'autres gestionnaires.
 */
router.get('/:id/membres', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const membres = await db.query(
      `SELECT us.*, u.first_name, u.last_name, u.email
         FROM user_sites us
         JOIN users u ON u.id = us.user_id
        WHERE us.site_id = ?
        ORDER BY u.last_name ASC, u.first_name ASC`,
      [req.params.id]
    );
    res.json({
      success: true,
      peutAccorderGestion: await peutGererLieux(req.user),
      membres: membres.map((m: any) => ({
        id: Number(m.id),
        userId: Number(m.user_id),
        nom: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email,
        email: m.email ?? null,
        estResponsable: Boolean(Number(m.est_responsable ?? 0)),
        peutVoirTickets: Boolean(Number(m.peut_voir_tickets ?? 0)),
        notifie: Boolean(Number(m.notifie ?? 0)),
        gereLieu: Boolean(Number(m.gere_lieu ?? 0)),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des membres du site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Les droits d'un rattachement, lus depuis le corps ; absent = non touché. */
function lireDroits(corps: any): Partial<Record<'est_responsable' | 'peut_voir_tickets' | 'notifie' | 'gere_lieu', number>> {
  const droits: Partial<Record<'est_responsable' | 'peut_voir_tickets' | 'notifie' | 'gere_lieu', number>> = {};
  if (corps?.estResponsable !== undefined) droits.est_responsable = corps.estResponsable ? 1 : 0;
  if (corps?.peutVoirTickets !== undefined) droits.peut_voir_tickets = corps.peutVoirTickets ? 1 : 0;
  if (corps?.notifie !== undefined) droits.notifie = corps.notifie ? 1 : 0;
  if (corps?.gereLieu !== undefined) droits.gere_lieu = corps.gereLieu ? 1 : 0;
  return droits;
}

/**
 * Rattache une personne au bâtiment, ou règle ses droits si elle l'est déjà.
 *
 * Une seule route pour les deux gestes : l'écran coche une case, et n'a pas à
 * savoir si la ligne existait.
 */
router.put('/:id/membres/:userId', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const siteId = Number(req.params.id);
    const userId = Number(req.params.userId);
    if (!(await lireSite(siteId))) return refuser(res, 404, 'Bâtiment introuvable');
    if (!(await db.queryOne('SELECT id FROM users WHERE id = ?', [userId]))) {
      return refuser(res, 404, 'Compte introuvable');
    }

    const droits = lireDroits(req.body);
    const existant = await db.queryOne('SELECT * FROM user_sites WHERE user_id = ? AND site_id = ?', [
      userId,
      siteId,
    ]);

    // Faire ou défaire un gestionnaire revient au gestionnaire global : celui
    // d'un bâtiment se donnerait sinon des pairs, ou retirerait les siens.
    const toucheGestion =
      droits.gere_lieu !== undefined && droits.gere_lieu !== Number(existant?.gere_lieu ?? 0);
    if (toucheGestion && !(await peutGererLieux(req.user))) {
      return refuser(res, 403, 'Seul un gestionnaire de toute l’organisation désigne les gestionnaires d’un bâtiment');
    }

    if (existant) {
      const colonnes = Object.keys(droits);
      if (colonnes.length > 0) {
        await db.execute(
          `UPDATE user_sites SET ${colonnes.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
          [...colonnes.map((c) => (droits as any)[c]), existant.id]
        );
      }
    } else {
      await db.execute(
        `INSERT INTO user_sites (user_id, site_id, est_responsable, peut_voir_tickets, notifie, gere_lieu, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          siteId,
          droits.est_responsable ?? 0,
          droits.peut_voir_tickets ?? 0,
          droits.notifie ?? 0,
          droits.gere_lieu ?? 0,
          req.user!.userId,
          versDateTime(),
        ]
      );
    }
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur réglage d’un rattachement :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/:id/membres/:userId', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const existant = await db.queryOne('SELECT * FROM user_sites WHERE user_id = ? AND site_id = ?', [
      req.params.userId,
      req.params.id,
    ]);
    if (!existant) return refuser(res, 404, 'Cette personne n’est pas rattachée au bâtiment');

    // Même règle qu'à la modification : retirer la ligne d'un gestionnaire
    // retire sa gestion.
    if (Number(existant.gere_lieu ?? 0) === 1 && !(await peutGererLieux(req.user))) {
      return refuser(res, 403, 'Seul un gestionnaire de toute l’organisation retire un gestionnaire de bâtiment');
    }

    await db.execute('DELETE FROM user_sites WHERE id = ?', [existant.id]);
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur retrait d’un rattachement :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    const nom = String(req.body?.nom ?? '').trim();
    if (!nom) return refuser(res, 400, 'Le nom est obligatoire');

    const maintenant = versDateTime();
    const resultat = await db.execute(
      `INSERT INTO cle_sites (name, code, address, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [nom, req.body?.code ?? null, req.body?.adresse ?? null, Number(req.body?.ordre ?? 0), maintenant, maintenant]
    );
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    console.error('Erreur création de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/:id', authenticateToken, requireGestionSite(siteDuParametre), async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');

    const colonnes: string[] = [];
    const params: any[] = [];
    const poser = (colonne: string, valeur: any) => {
      colonnes.push(`${colonne} = ?`);
      params.push(valeur);
    };

    if (req.body?.nom !== undefined) poser('name', String(req.body.nom).trim());
    if (req.body?.code !== undefined) poser('code', req.body.code);
    if (req.body?.adresse !== undefined) poser('address', req.body.adresse);
    if (req.body?.ordre !== undefined) poser('sort_order', Number(req.body.ordre));
    if (req.body?.actif !== undefined) poser('is_active', req.body.actif ? 1 : 0);

    if (colonnes.length === 0) return res.json({ success: true });

    poser('updated_at', versDateTime());
    await db.execute(`UPDATE cle_sites SET ${colonnes.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur modification de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Supprime un bâtiment — seulement s'il ne sert à rien.
 *
 * Un site cité par une demande ou ouvert par une clé ne se supprime pas :
 * l'effacer emporterait le lieu de l'historique qu'on veut justement pouvoir
 * relire. L'écran propose de le désactiver, ce qui le retire des formulaires
 * sans toucher au passé.
 */
router.delete('/:id', authenticateToken, requireGestionLieux, async (req: AuthRequest, res: Response) => {
  try {
    const site = await lireSite(req.params.id);
    if (!site) return refuser(res, 404, 'Site introuvable');

    const usages = await usagesSite(req.params.id);
    const empeche = Object.entries(usages).filter(([, n]) => n > 0);
    if (empeche.length > 0) {
      const detail = empeche.map(([quoi, n]) => `${n} ${quoi}`).join(', ');
      return refuser(res, 409, `Ce bâtiment est encore employé (${detail}) : désactivez-le plutôt`);
    }

    await db.execute('DELETE FROM cle_sites WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Bâtiment supprimé' });
  } catch (erreur: any) {
    console.error('Erreur suppression de site :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

export default router;
