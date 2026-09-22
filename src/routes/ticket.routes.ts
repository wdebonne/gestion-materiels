import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireAdmin,
  requireSupervisor,
} from '../middleware/auth.middleware';
import {
  accesTicket,
  contexteTickets,
  materielsVisibles,
  porteeTickets,
  MATERIEL_HORS_PORTEE,
  REFUS_PORTEE_TICKET,
} from '../middleware/ticketScope';
import { messageErreurDepot, televersementPiece } from '../middleware/televersement';
import { resoudreSous } from '../utils/cheminSous';
import {
  ajouterMessage,
  changerStatut,
  compteursParStatut,
  compterTickets,
  creerTicket,
  filUnifie,
  listerTickets,
  lireTicket,
  modifierTicket,
  observateursDe,
  piecesDuTicket,
  prochaineSequence,
  SaisieInvalide,
  tracer,
  versDateTime,
} from '../services/tickets.service';
import {
  categoriesProposeesA,
  estViolationCleEtrangere,
  filtreMaterielDe,
  listerStatuts,
  materielAutorisePour,
  materielsDe,
  resoudreRoutage,
} from '../services/ticketsReferentiel.service';
import { sitesDe, sitesProposesA } from '../services/sites.service';
import {
  notifierAffectation,
  notifierMessage,
  notifierOuverture,
  notifierStatut,
} from '../services/ticketNotify.service';
import { servicesDe } from '../middleware/ticketScope';

/**
 * Les demandes internes.
 *
 * ## Aucune garde de rôle sur l'essentiel
 *
 * Ouvrir une demande, écrire dans son fil, y joindre une photo : rien de tout
 * cela ne porte `requireFieldWrite`. Ce serait un contresens — le demandeur est
 * précisément un compte `user` ou `service`, et lui refuser le dépôt d'une photo
 * viderait le module de son usage.
 *
 * Ce qui protège ces routes n'est donc pas le rôle mais **la portée** : on
 * n'écrit que dans une demande qu'on a le droit de lire entièrement.
 * `accesTicket()` tranche, et rien ici ne réécrit la règle à la main.
 *
 * Seule la suppression définitive reste à l'administrateur : une demande efface
 * son fil et ses pièces, et c'est irréversible.
 *
 * ## Voir n'est pas lire
 *
 * Un ticket qu'on ne voit que par son bâtiment se lit en **voisinage** : de quoi
 * constater que le rideau cassé est déjà signalé, sans ouvrir la correspondance
 * d'autrui. `GET /:id` le rend amputé de sa description, le fil et les pièces
 * sont refusés, et l'écriture aussi.
 */

const router = Router();

/**
 * Ce qu'on répond quand un identifiant transmis ne désigne plus rien.
 *
 * Le cas arrive pour de bon : un formulaire resté ouvert pendant qu'un
 * administrateur désactivait un bâtiment ou supprimait une catégorie. Sans ce
 * message, la contrainte de clé étrangère ressort en « Erreur serveur », et
 * celui qui vient d'écrire sa demande la ressaisit à l'identique.
 */
const REFUS_REFERENCE =
  'Un des éléments choisis n’existe plus (bâtiment, catégorie ou matériel) : rechargez la page';

/** Réponse d'erreur unique, pour que le refus se lise pareil partout. */
function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

/** Le lecteur est-il un intervenant sur cette demande, ou seulement le demandeur ? */
async function estIntervenant(req: AuthRequest, ticket: any): Promise<boolean> {
  const ctx = await contexteTickets(req);
  if (ctx.voitTout) return true;
  if (ticket.technicien_id && ctx.personnes.includes(Number(ticket.technicien_id))) return true;
  if (ticket.service_id && ctx.services.includes(Number(ticket.service_id))) return true;
  return false;
}

// ------------------------------------------------------------ ce que je peux

/**
 * Ce dont le formulaire a besoin pour se dessiner.
 *
 * Un seul appel décide de tout, parce qu'un formulaire qui se construit en
 * quatre requêtes clignote. C'est ici que se règle « un utilisateur peut avoir
 * que 1 bâtiment mais aussi plusieurs » : `sites.length === 1` et l'écran masque
 * le champ, sans avoir à connaître la règle.
 */
router.get('/formulaire', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const [rattachements, categories, statuts] = await Promise.all([
      sitesDe(userId),
      categoriesProposeesA(userId),
      listerStatuts(),
    ]);

    const sites = await sitesProposesA(userId);
    // Signaler *pour le bâtiment* — un bureau abîmé, une fuite — suppose d'en
    // être responsable. Un simple occupant reste rattaché : c'est ce qui
    // pré-remplit son bâtiment quand il signale une panne sur son poste.
    const sitesDontResponsable = rattachements.filter((s) => s.estResponsable);

    res.json({
      success: true,
      sites,
      sitesResponsable: sitesDontResponsable.map(({ estResponsable, peutVoirTickets, notifie, ...site }) => site),
      estResponsable: sitesDontResponsable.length > 0,
      // L'arbre est rendu à plat : l'écran regroupe sur `parentId`, ce qui lui
      // évite de redescendre une structure imbriquée pour remplir un `select`.
      categories,
      statuts,
      // Un seul bâtiment : le champ n'a pas à être posé.
      siteImpose: sites.length === 1 ? sites[0].id : null,
      // Rien ne lui a été attribué : l'écran le dit et vers qui se tourner,
      // plutôt que d'afficher des listes vides sans explication.
      sansRattachement: sites.length === 0 && categories.length === 0,
    });
  } catch (erreur: any) {
    console.error('Erreur formulaire ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Ce qu'une catégorie implique, une fois choisie — sans créer la demande. */
router.get('/formulaire/routage', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const categorieId = req.query.categorieId ? Number(req.query.categorieId) : null;
    const sousCategorieId = req.query.sousCategorieId ? Number(req.query.sousCategorieId) : null;

    const routage = await resoudreRoutage(categorieId, sousCategorieId);
    const materielAutorise = await materielAutorisePour(req.user!.userId, categorieId, routage);

    // Le nom du service destinataire est rendu en clair : « cette demande
    // partira au service Informatique ». Personne n'aime envoyer dans le vide.
    const service = routage.serviceId
      ? await db.queryOne('SELECT id, name FROM services WHERE id = ?', [routage.serviceId])
      : null;
    const technicien = routage.technicienId
      ? await db.queryOne('SELECT id, first_name, last_name FROM users WHERE id = ?', [routage.technicienId])
      : null;

    res.json({
      success: true,
      routage: {
        siteMode: routage.siteMode,
        materielMode: materielAutorise ? routage.materielMode : 'aucun',
        visibilite: routage.visibilite,
      },
      destinataire: {
        service: service ? { id: Number(service.id), nom: service.name } : null,
        technicien: technicien
          ? {
              id: Number(technicien.id),
              nom: [technicien.first_name, technicien.last_name].filter(Boolean).join(' ').trim(),
            }
          : null,
      },
    });
  } catch (erreur: any) {
    console.error('Erreur routage ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Le parc que cette catégorie de demande propose, déjà cloisonné par les droits. */
router.get('/formulaire/materiels', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const categorieId = req.query.categorieId ? Number(req.query.categorieId) : null;
    const sousCategorieId = req.query.sousCategorieId ? Number(req.query.sousCategorieId) : null;

    const routage = await resoudreRoutage(categorieId, sousCategorieId);
    if (!(await materielAutorisePour(req.user!.userId, categorieId, routage))) {
      return res.json({ success: true, materiels: [] });
    }

    const filtreCategorie = await filtreMaterielDe(categorieId, sousCategorieId);

    /*
     * Le matériel qui lui est **attribué**, et lui seul.
     *
     * C'est la demande : « je signale une panne sur mon téléphone ou mon PC ».
     * Dérouler tout le parc informatique de la commune obligerait à retrouver
     * son poste parmi trois cents, ce que personne ne fait — on choisit le
     * premier de la liste, et la demande part sur le matériel d'un collègue.
     *
     * `objectScope` n'a pas à s'appliquer ici : un matériel qu'on a attribué à
     * quelqu'un est, par définition, un matériel qu'il peut nommer. Le filtrer
     * par les catégories de parc qui lui sont ouvertes lui cacherait son propre
     * ordinateur.
     */
    const mesMateriels = await materielsDe(req.user!.userId, filtreCategorie);

    const recherche = String(req.query.recherche ?? '').trim();
    const materiels = recherche
      ? mesMateriels.filter((m) =>
          [m.name, m.reference].some((v) => String(v ?? '').toLowerCase().includes(recherche.toLowerCase()))
        )
      : mesMateriels;

    res.json({ success: true, materiels });
  } catch (erreur: any) {
    console.error('Erreur matériels proposés :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Ce que je peux faire : sert à masquer les boutons qui mentiraient. */
router.get('/permissions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await contexteTickets(req);
    res.json({
      success: true,
      voitTout: ctx.voitTout,
      services: ctx.services,
      sitesPartages: ctx.sitesPartages,
      estIntervenant: ctx.services.length > 0 || ctx.voitTout,
    });
  } catch (erreur: any) {
    console.error('Erreur permissions tickets :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ------------------------------------------------------------------- la file

function filtresDepuis(req: AuthRequest) {
  const nombre = (v: any) => (v === undefined || v === '' ? null : Number(v));
  const ouverts =
    req.query.ouverts === 'true' ? true : req.query.ouverts === 'false' ? false : null;

  return {
    statutId: nombre(req.query.statutId),
    categorieId: nombre(req.query.categorieId),
    sousCategorieId: nombre(req.query.sousCategorieId),
    siteId: nombre(req.query.siteId),
    technicienId: nombre(req.query.technicienId),
    serviceId: nombre(req.query.serviceId),
    demandeurId: nombre(req.query.demandeurId),
    objectId: nombre(req.query.objectId),
    ouverts,
    recherche: (req.query.recherche as string) ?? null,
    limite: nombre(req.query.limite) ?? 100,
    depuis: nombre(req.query.depuis) ?? 0,
  };
}

/** Les compteurs de la colonne de gauche, dans la portée du lecteur. */
router.get('/compteurs', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const portee = await porteeTickets(req, 't');
    const filtres = filtresDepuis(req);
    const [parStatut, total] = await Promise.all([
      compteursParStatut(portee, filtres),
      compterTickets(portee, { ...filtres, statutId: null }),
    ]);
    res.json({ success: true, parStatut, total });
  } catch (erreur: any) {
    console.error('Erreur compteurs tickets :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await contexteTickets(req);
    const portee = await porteeTickets(req, 't');
    const filtres = filtresDepuis(req);

    const lignes = await listerTickets(portee, filtres);
    const total = await compterTickets(portee, filtres);

    // Un seul passage pour savoir quels matériels peuvent être nommés : on ne
    // cache pas la ligne, on vide la colonne (voir `materielsVisibles`).
    const visibles = await materielsVisibles(req, lignes.map((l: any) => l.object_id));

    // Ce qu'on voit sans pouvoir le lire : la même règle, privée du bâtiment.
    const portee_privee = await porteeTickets(req, 't', false);
    const idsComplets = new Set<number>();
    if (lignes.length > 0) {
      const marqueurs = lignes.map(() => '?').join(',');
      const complets = await db.query(
        `SELECT t.id FROM tickets t WHERE t.id IN (${marqueurs})${portee_privee.sql}`,
        [...lignes.map((l: any) => l.id), ...portee_privee.params]
      );
      for (const l of complets) idsComplets.add(Number(l.id));
    }

    res.json({
      success: true,
      total,
      tickets: lignes.map((l: any) => presenterLigne(l, visibles, ctx.voitTout || idsComplets.has(Number(l.id)))),
    });
  } catch (erreur: any) {
    console.error('Erreur liste tickets :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Une ligne de liste, telle que l'écran l'attend. */
function presenterLigne(l: any, materielsOk: Set<number>, accesComplet: boolean) {
  const personne = (prenom: any, nom: any, id: any) =>
    id === null || id === undefined
      ? null
      : { id: Number(id), nom: [prenom, nom].filter(Boolean).join(' ').trim() };

  const objetVisible = l.object_id !== null && materielsOk.has(Number(l.object_id));

  return {
    id: Number(l.id),
    reference: l.reference,
    titre: l.titre,
    // Le voisinage donne de quoi reconnaître un doublon, pas de quoi lire.
    description: accesComplet ? l.description : null,
    accesComplet,
    statut: { id: Number(l.statut_id), nom: l.statut_nom, couleur: l.statut_couleur, ouvert: Boolean(l.statut_ouvert) },
    categorie: l.categorie_id ? { id: Number(l.categorie_id), nom: l.categorie_nom, couleur: l.categorie_couleur } : null,
    sousCategorie: l.sous_categorie_id ? { id: Number(l.sous_categorie_id), nom: l.sous_categorie_nom } : null,
    site: l.site_id ? { id: Number(l.site_id), nom: l.site_nom } : null,
    service: l.service_id ? { id: Number(l.service_id), nom: l.service_nom } : null,
    demandeur: personne(l.demandeur_prenom, l.demandeur_nom, l.demandeur_id),
    technicien: personne(l.technicien_prenom, l.technicien_nom, l.technicien_id),
    materiel:
      l.object_id === null
        ? null
        : objetVisible
          ? { id: Number(l.object_id), nom: l.objet_nom, reference: l.objet_reference }
          : { id: null, nom: MATERIEL_HORS_PORTEE, reference: null },
    priorite: l.priorite,
    echeanceResolution: l.echeance_resolution ?? null,
    enRetard: Boolean(
      l.echeance_resolution && !l.resolu_at && new Date(l.echeance_resolution).getTime() < Date.now()
    ),
    creeLe: l.created_at,
    misAJourLe: l.updated_at,
  };
}

// ------------------------------------------------------------------ rapports

/**
 * Volumes, délais tenus et temps passé sur une période.
 *
 * Aucune garde de rôle : le rapport est **borné par la portée du lecteur**, et
 * n'agrège que ce qu'il a déjà le droit de voir. Un agent y lit ses propres
 * chiffres, un responsable ceux de son équipe. Réserver l'écran à
 * l'encadrement priverait un agent de savoir ce qu'il a traité.
 */
router.get('/rapport', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const aujourdhui = new Date();
    const parDefautDebut = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1);
    const jour = (d: Date) => d.toISOString().slice(0, 10);

    const bornes = {
      debut: String(req.query.debut ?? jour(parDefautDebut)),
      fin: String(req.query.fin ?? jour(aujourdhui)),
    };

    const portee = await porteeTickets(req, 't');
    const { construireRapport } = await import('../services/ticketsRapport.service');
    res.json({ success: true, rapport: await construireRapport(portee, bornes) });
  } catch (erreur: any) {
    console.error('Erreur rapport des demandes :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Les demandes qui concernent un matériel — pour sa fiche.
 *
 * L'accès au matériel lui-même est vérifié : sans cela, on apprendrait par le
 * nombre de demandes qu'un matériel existe hors de son périmètre.
 */
router.get('/materiel/:objectId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { peutVoirObjet } = await import('../middleware/objectScope');
    if (!(await peutVoirObjet(req, req.params.objectId))) {
      return refuser(res, 404, 'Matériel introuvable');
    }

    const portee = await porteeTickets(req, 't');
    const { demandesDuMateriel } = await import('../services/ticketsRapport.service');
    const demandes = await demandesDuMateriel(portee, req.params.objectId);

    res.json({
      success: true,
      demandes: demandes.map((d: any) => ({
        id: Number(d.id),
        reference: d.reference,
        titre: d.titre,
        statut: { nom: d.statut_nom, couleur: d.statut_couleur, ouvert: Boolean(d.statut_ouvert) },
        categorie: d.categorie_nom ?? null,
        demandeur: [d.demandeur_prenom, d.demandeur_nom].filter(Boolean).join(' ').trim() || null,
        creeLe: d.created_at,
        closeLe: d.ferme_at ?? null,
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur demandes du matériel :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * À qui ce matériel est attribué.
 *
 * L'attribution se règle depuis les deux bouts : la fiche d'une personne, dans
 * *Paramètres › Tickets*, et la fiche du matériel — ici. C'est le même lien, et
 * les deux entrées valent : on affecte un poste en équipant quelqu'un, et on
 * corrige en ouvrant la fiche du poste le jour où il change de bureau.
 *
 * Lecture ouverte à qui peut voir le matériel : savoir qui détient le
 * vidéoprojecteur est la question que la fiche existe pour répondre. L'écriture
 * reste à l'encadrement — attribuer un matériel décide de qui pourra ouvrir une
 * demande dessus.
 */
router.get('/materiel/:objectId/detenteurs', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { peutVoirObjet } = await import('../middleware/objectScope');
    if (!(await peutVoirObjet(req, req.params.objectId))) {
      return refuser(res, 404, 'Matériel introuvable');
    }

    const lignes = await db.query(
      `SELECT um.id, um.user_id, um.note, um.created_at,
              u.first_name, u.last_name, u.email, u.can_login
         FROM user_materiels um
         JOIN users u ON u.id = um.user_id
        WHERE um.object_id = ?
        ORDER BY u.last_name ASC, u.first_name ASC`,
      [req.params.objectId]
    );

    res.json({
      success: true,
      detenteurs: lignes.map((l: any) => ({
        id: Number(l.id),
        userId: Number(l.user_id),
        nom: [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.email,
        email: l.email ?? null,
        seConnecte: Boolean(l.can_login),
        note: l.note ?? null,
        depuis: l.created_at,
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des détenteurs :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post(
  '/materiel/:objectId/detenteurs',
  authenticateToken,
  requireSupervisor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = Number(req.body?.userId);
      if (!Number.isFinite(userId)) return refuser(res, 400, 'Indiquez une personne');

      const { peutVoirObjet } = await import('../middleware/objectScope');
      if (!(await peutVoirObjet(req, req.params.objectId))) {
        return refuser(res, 404, 'Matériel introuvable');
      }

      // Un matériel peut être attribué à plusieurs personnes — un véhicule de
      // service partagé, un vidéoprojecteur d'étage. Attribuer deux fois la
      // même n'est pas une erreur, c'est un geste sans effet.
      const deja = await db.queryOne(
        'SELECT id FROM user_materiels WHERE user_id = ? AND object_id = ?',
        [userId, req.params.objectId]
      );
      if (deja) return res.json({ success: true, id: Number(deja.id) });

      const resultat = await db.execute(
        `INSERT INTO user_materiels (user_id, object_id, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, req.params.objectId, req.body?.note ?? null, req.user!.userId, versDateTime()]
      );
      res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
    } catch (erreur: any) {
      if (estViolationCleEtrangere(erreur)) return refuser(res, 400, REFUS_REFERENCE);
      console.error('Erreur attribution de matériel :', erreur);
      refuser(res, 500, 'Erreur serveur');
    }
  }
);

router.delete(
  '/materiel/:objectId/detenteurs/:userId',
  authenticateToken,
  requireSupervisor,
  async (req: AuthRequest, res: Response) => {
    try {
      await db.execute('DELETE FROM user_materiels WHERE object_id = ? AND user_id = ?', [
        req.params.objectId,
        req.params.userId,
      ]);
      /*
       * Les demandes déjà ouvertes sur ce matériel ne bougent pas : retirer une
       * affectation ne réécrit pas l'histoire. La personne ne pourra simplement
       * plus en ouvrir de nouvelle dessus.
       */
      res.json({ success: true, message: 'Attribution retirée' });
    } catch (erreur: any) {
      console.error('Erreur retrait d’attribution :', erreur);
      refuser(res, 500, 'Erreur serveur');
    }
  }
);

// ----------------------------------------------------------------- la demande

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = await creerTicket(req.body ?? {}, req.user!.userId);
    const ticket = await lireTicket(id);

    // Après la réponse, jamais avant : un SMTP injoignable ne doit pas empêcher
    // d'ouvrir une demande. `notifierOuverture` est en « tire-et-oublie ».
    notifierOuverture(id, req.user!.userId);
    if (ticket?.technicien_id) notifierAffectation(id, req.user!.userId);

    res.status(201).json({ success: true, id, reference: ticket?.reference, ticket });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) return refuser(res, 400, erreur.message);
    if (estViolationCleEtrangere(erreur)) return refuser(res, 400, REFUS_REFERENCE);
    console.error('Erreur création ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const acces = await accesTicket(req, req.params.id);
    // 404 et non 403 sur `aucun` : répondre « interdit » confirmerait qu'une
    // demande existe sous ce numéro, ce qui est déjà un renseignement.
    if (acces === 'aucun') return refuser(res, 404, 'Demande introuvable');

    const ligne = await lireTicket(req.params.id);
    if (!ligne) return refuser(res, 404, 'Demande introuvable');

    const visibles = await materielsVisibles(req, [ligne.object_id]);
    const ticket = presenterLigne(ligne, visibles, acces === 'complet');

    if (acces === 'voisinage') {
      return res.json({
        success: true,
        ticket,
        acces,
        fil: [],
        pieces: [],
        observateurs: [],
        message: 'Demande visible au titre de votre bâtiment : le détail en est réservé aux intervenants',
      });
    }

    const intervenant = await estIntervenant(req, ligne);
    const [fil, pieces, observateurs] = await Promise.all([
      filUnifie(Number(req.params.id), intervenant),
      piecesDuTicket(req.params.id),
      observateursDe(req.params.id),
    ]);

    res.json({ success: true, ticket, acces, intervenant, fil, pieces, observateurs });
  } catch (erreur: any) {
    console.error('Erreur lecture ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Garde d'écriture : la portée complète, et rien d'autre. */
async function exigerAccesComplet(req: AuthRequest, res: Response): Promise<boolean> {
  const acces = await accesTicket(req, req.params.id);
  if (acces === 'complet') return true;
  if (acces === 'voisinage') {
    refuser(res, 403, 'Cette demande ne vous est visible qu’au titre de votre bâtiment');
    return false;
  }
  refuser(res, 404, 'Demande introuvable');
  return false;
}

router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;

    const avant = await lireTicket(req.params.id);
    await modifierTicket(Number(req.params.id), req.body ?? {}, req.user!.userId);
    const apres = await lireTicket(req.params.id);

    // Confier une demande à quelqu'un est le seul changement qui vaut un avis :
    // corriger une faute de frappe dans un titre n'a personne à prévenir.
    const confieeAutrement =
      String(avant?.technicien_id ?? '') !== String(apres?.technicien_id ?? '') ||
      String(avant?.service_id ?? '') !== String(apres?.service_id ?? '');
    if (confieeAutrement) notifierAffectation(Number(req.params.id), req.user!.userId);

    res.json({ success: true, ticket: apres });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) return refuser(res, 400, erreur.message);
    if (estViolationCleEtrangere(erreur)) return refuser(res, 400, REFUS_REFERENCE);
    console.error('Erreur modification ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/:id/statut', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;
    const statutId = Number(req.body?.statutId);
    if (!Number.isFinite(statutId)) return refuser(res, 400, 'Statut manquant');

    const avant = await lireTicket(req.params.id);
    await changerStatut(Number(req.params.id), statutId, req.user!.userId);
    const apres = await lireTicket(req.params.id);

    if (String(avant?.statut_id ?? '') !== String(apres?.statut_id ?? '')) {
      notifierStatut(
        Number(req.params.id),
        req.user!.userId,
        avant?.statut_nom ?? null,
        apres?.statut_nom ?? '',
        Boolean(apres?.ferme_at)
      );
    }

    res.json({ success: true, ticket: apres });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) return refuser(res, 400, erreur.message);
    console.error('Erreur changement de statut :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Les pièces partent avec la demande : les laisser sur le disque
    // accumulerait des fichiers que plus rien ne nomme.
    const pieces = await db.query('SELECT file_path FROM ticket_documents WHERE ticket_id = ?', [
      req.params.id,
    ]);
    await db.execute('DELETE FROM tickets WHERE id = ?', [req.params.id]);
    for (const piece of pieces) supprimerDuDisque(piece.file_path);

    res.json({ success: true, message: 'Demande supprimée' });
  } catch (erreur: any) {
    console.error('Erreur suppression ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// --------------------------------------------------------------------- le fil

router.get('/:id/fil', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;
    const ligne = await lireTicket(req.params.id);
    const fil = await filUnifie(Number(req.params.id), await estIntervenant(req, ligne));
    res.json({ success: true, fil });
  } catch (erreur: any) {
    console.error('Erreur fil du ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;
    const ligne = await lireTicket(req.params.id);

    // Une note interne n'a de sens que d'un intervenant : laisser le demandeur
    // en écrire une lui cacherait son propre message.
    const interne = Boolean(req.body?.interne) && (await estIntervenant(req, ligne));

    const messageId = await ajouterMessage(
      Number(req.params.id),
      { body: req.body?.body, interne, serviceId: req.body?.serviceId ?? null },
      req.user!.userId
    );

    // Les pièces déposées avant l'envoi se rattachent au message qui vient de
    // partir : c'est ce qui les fait apparaître dans sa bulle.
    const piecesIds: number[] = Array.isArray(req.body?.piecesIds) ? req.body.piecesIds.map(Number) : [];
    for (const pieceId of piecesIds) {
      await db.execute(
        'UPDATE ticket_documents SET message_id = ? WHERE id = ? AND ticket_id = ? AND message_id IS NULL',
        [messageId, pieceId, req.params.id]
      );
    }

    notifierMessage(Number(req.params.id), req.user!.userId, String(req.body?.body ?? ''), interne);

    res.status(201).json({ success: true, messageId });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) return refuser(res, 400, erreur.message);
    console.error('Erreur message de ticket :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ---------------------------------------------------------- les pièces jointes

/**
 * Dépose une pièce.
 *
 * Gardée par la portée, **pas par le rôle** : `POST /api/upload/file` exige
 * `requireFieldWrite` et refuserait donc au demandeur la photo de son rideau
 * cassé. Même mécanique de dépôt, garde différente.
 */
router.post(
  '/:id/documents',
  authenticateToken,
  (req, res, next) => {
    televersementPiece.single('file')(req, res, (erreur: any) => {
      if (erreur) return res.status(400).json({ success: false, message: messageErreurDepot(erreur) });
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await exigerAccesComplet(req, res))) {
        if (req.file) supprimerDuDisque(`/uploads/${req.file.filename}`);
        return;
      }
      if (!req.file) return refuser(res, 400, 'Aucun fichier reçu');

      const cheminPublic = `/uploads/${req.file.filename}`;
      const resultat = await db.execute(
        `INSERT INTO ticket_documents (ticket_id, message_id, name, description, file_path, mime_type, size, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          req.body?.messageId ? Number(req.body.messageId) : null,
          req.file.originalname,
          req.body?.description ?? null,
          cheminPublic,
          req.file.mimetype,
          req.file.size,
          req.user!.userId,
          versDateTime(),
        ]
      );

      await tracer(Number(req.params.id), req.user!.userId, 'piece_jointe', null, null, req.file.originalname);

      res.status(201).json({
        success: true,
        document: {
          id: Number(resultat.lastInsertRowid),
          nom: req.file.originalname,
          url: cheminPublic,
          mime: req.file.mimetype,
          taille: req.file.size,
        },
      });
    } catch (erreur: any) {
      console.error('Erreur dépôt de pièce :', erreur);
      refuser(res, 500, 'Erreur serveur');
    }
  }
);

router.delete('/:id/documents/:docId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;

    const piece = await db.queryOne('SELECT * FROM ticket_documents WHERE id = ? AND ticket_id = ?', [
      req.params.docId,
      req.params.id,
    ]);
    if (!piece) return refuser(res, 404, 'Pièce introuvable');

    // L'auteur retire ce qu'il a déposé ; au-delà, il faut encadrer.
    const estAuteur = Number(piece.uploaded_by) === Number(req.user!.userId);
    const encadre = ['admin', 'supervisor'].includes(req.user!.role);
    if (!estAuteur && !encadre) return refuser(res, 403, 'Seul l’auteur du dépôt peut le retirer');

    await db.execute('DELETE FROM ticket_documents WHERE id = ?', [req.params.docId]);
    supprimerDuDisque(piece.file_path);
    res.json({ success: true, message: 'Pièce retirée' });
  } catch (erreur: any) {
    console.error('Erreur suppression de pièce :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Retire un fichier du disque, sans jamais sortir du dossier de dépôt.
 *
 * `resoudreSous` est la protection déjà employée par `upload.routes.ts` contre
 * la traversée de chemin : un `file_path` trafiqué ne doit pas faire supprimer
 * un fichier de l'application.
 */
function supprimerDuDisque(cheminPublic: string | null | undefined): void {
  if (!cheminPublic) return;
  try {
    const dossier = path.join(__dirname, '../../uploads');
    const chemin = resoudreSous(dossier, path.basename(cheminPublic));
    if (chemin && fs.existsSync(chemin)) fs.unlinkSync(chemin);
  } catch (erreur: any) {
    // Un fichier déjà absent n'est pas une erreur : la ligne est partie, c'est
    // ce qui compte. On ne fait pas échouer une suppression pour cela.
    console.warn('Pièce de ticket non supprimée du disque :', erreur?.message ?? erreur);
  }
}

// ------------------------------------------------------------ les observateurs

router.post('/:id/observateurs', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;

    const userId = req.body?.userId ? Number(req.body.userId) : null;
    const serviceId = req.body?.serviceId ? Number(req.body.serviceId) : null;
    if (!userId && !serviceId) return refuser(res, 400, 'Indiquez une personne ou un service');
    if (userId && serviceId) return refuser(res, 400, 'Une personne ou un service, pas les deux');

    const deja = await db.queryOne(
      `SELECT id FROM ticket_watchers WHERE ticket_id = ? AND ${userId ? 'user_id = ?' : 'service_id = ?'}`,
      [req.params.id, userId ?? serviceId]
    );
    if (deja) return res.json({ success: true, id: Number(deja.id) });

    const resultat = await db.execute(
      `INSERT INTO ticket_watchers (ticket_id, user_id, service_id, added_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, userId, serviceId, req.user!.userId, versDateTime()]
    );
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    console.error('Erreur ajout d’observateur :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/:id/observateurs/:obsId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await exigerAccesComplet(req, res))) return;
    await db.execute('DELETE FROM ticket_watchers WHERE id = ? AND ticket_id = ?', [
      req.params.obsId,
      req.params.id,
    ]);
    res.json({ success: true, message: 'Observateur retiré' });
  } catch (erreur: any) {
    console.error('Erreur retrait d’observateur :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

export { REFUS_PORTEE_TICKET, prochaineSequence, servicesDe };
export default router;
