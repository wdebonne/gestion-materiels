import { Router, Response } from 'express';
import { db } from '../database';
import {
  AuthRequest,
  authenticateToken,
  requireAdmin,
  requireFieldWrite,
  requireSupervisor,
} from '../middleware/auth.middleware';
import { exportLimiter } from '../middleware/rateLimiter.middleware';
import { logService } from '../services/log.service';
import { EMPLACEMENTS_COULEUR, estEmplacementCouleur } from '../config/paletteCategories';
import {
  Bornes,
  Granularite,
  bornesPeriode,
  estJourValide,
  granularitePour,
  jourCourant,
  memePeriodeAnneePrecedente,
  periodePrecedente,
} from '../utils/periodes';
import {
  SaisieInvalide,
  agentsSansSuperviseur,
  creerTache,
  encadresPar,
  estViolationUnicite,
  lireCategorie,
  lireTache,
  listerCategories,
  listerTaches,
  modifierTache,
  normaliserCategorie,
  perimetreDe,
  peutEcrirePour,
  resoudreCategorie,
  superviseursDe,
  supprimerTache,
  usagesCategorie,
} from '../services/plannings.service';
import { Mesure, comparer, construireRapport } from '../services/planningsRapport.service';
import { TYPE_MIME_XLSX, genererClasseur, genererCsv } from '../services/planningsExport.service';

/**
 * Plannings et heures.
 *
 * Deux droits, et il ne faut pas les confondre. **Saisir son temps** relève de
 * l'écriture de terrain : l'agent, l'encadrant et l'administrateur le peuvent
 * toujours, parce que personne ne doit pouvoir être empêché de déclarer ses
 * propres heures par un réglage. **Lire les heures des autres** ne dépend que
 * du périmètre — soi, plus les personnes qui vous sont rattachées.
 *
 * Le rattachement, lui, est réservé à l'administrateur. Laisser un encadrant
 * s'attribuer des agents lui permettrait d'élargir seul ce qu'il voit, et le
 * cloisonnement ne tiendrait plus que par la bonne volonté de chacun.
 *
 * Les comptes « service » n'arrivent jamais ici : `cloisonnementService` ferme
 * par défaut tout `/api/*` qui n'est pas explicitement ouvert, et ce module ne
 * l'est pas. C'est voulu — avec pour conséquence, qu'il faut connaître, qu'une
 * personne de rôle « service » citée comme renfort ne verra pas ses propres
 * heures.
 */

const router = Router();

const MESURES: Mesure[] = ['mobilise', 'personne'];
const GRANULARITES: Granularite[] = ['jour', 'semaine', 'mois', 'annee'];

// ------------------------------------------------------------------- lecture

function erreurServeur(res: Response, contexte: string, erreur: any): void {
  console.error(`Erreur ${contexte} :`, erreur);
  res.status(500).json({ success: false, message: 'Erreur serveur' });
}

/** Une liste d'identifiants passée en `?x=1,2,3`. */
function identifiants(valeur: unknown): number[] | undefined {
  if (typeof valeur !== 'string' || valeur.trim() === '') return undefined;
  const nombres = valeur.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nombres.length > 0 ? nombres : undefined;
}

/**
 * Les bornes demandées.
 *
 * `periode` + `ancre` sont résolus **ici** et renvoyés avec le rapport. Si le
 * client recalculait la semaine de son côté, la règle ISO vivrait à deux
 * endroits, et le pied de page d'un export finirait par contredire l'écran
 * depuis lequel il a été demandé.
 */
function bornesDemandees(query: any): Bornes | null {
  const { debut, fin, periode, ancre } = query;

  if (estJourValide(debut) && estJourValide(fin)) {
    return debut <= fin ? { debut, fin } : { debut: fin, fin: debut };
  }

  const granularite = GRANULARITES.includes(periode) ? (periode as Granularite) : 'semaine';
  const reference = estJourValide(ancre) ? ancre : jourCourant();
  return bornesPeriode(granularite, reference);
}

// ==================== Ce que l'utilisateur a le droit de faire ====================

router.get('/permissions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    const [mesSuperviseurs, mesAgents] = await Promise.all([
      superviseursDe(userId),
      encadresPar(userId),
    ]);

    res.json({
      success: true,
      data: {
        canWrite: ['admin', 'supervisor', 'agent'].includes(role),
        canManageCategories: ['admin', 'supervisor', 'agent'].includes(role),
        canDisableCategories: ['admin', 'supervisor'].includes(role),
        canManageLinks: role === 'admin',
        voitTout: role === 'admin',
        moi: userId,
        mesSuperviseurs,
        mesAgents,
        couleurs: EMPLACEMENTS_COULEUR,
      },
    });
  } catch (erreur) {
    erreurServeur(res, 'permissions plannings', erreur);
  }
});

// ==================== Le référentiel des catégories ====================

router.get('/categories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const inclureInactives = req.query.inclureInactives === '1';
    res.json({ success: true, data: await listerCategories(inclureInactives) });
  } catch (erreur) {
    erreurServeur(res, 'liste catégories plannings', erreur);
  }
});

/**
 * Crée la catégorie manquante — ou rend celle qui existait déjà.
 *
 * Ouvert à l'agent : c'est lui qui découvre, sur le terrain, qu'il manque
 * « Livraison Manifestation ». L'envoyer demander à son responsable le
 * ramènerait à choisir « Autre », et la statistique qu'on cherche à bâtir
 * s'effondrerait dans cette case-là.
 */
router.post('/categories', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const categorie = await resoudreCategorie(req.body?.nom, req.user!.userId);
    res.status(201).json({ success: true, data: categorie });
  } catch (erreur: any) {
    if (erreur?.message && !estViolationUnicite(erreur)) {
      return res.status(400).json({ success: false, message: erreur.message });
    }
    erreurServeur(res, 'création catégorie planning', erreur);
  }
});

router.put('/categories/:id', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existante = await lireCategorie(id);
    if (!existante) {
      return res.status(404).json({ success: false, message: 'Catégorie introuvable' });
    }

    const nom = String(req.body?.nom ?? existante.nom).replace(/\s+/g, ' ').trim();
    if (nom.length === 0 || nom.length > 160) {
      return res.status(400).json({ success: false, message: 'Le nom doit tenir en 1 à 160 caractères.' });
    }

    const couleur = req.body?.couleur ?? existante.couleur;
    if (!estEmplacementCouleur(couleur)) {
      return res.status(400).json({ success: false, message: 'Cette couleur ne fait pas partie de la palette.' });
    }

    await db.execute(
      'UPDATE planning_categories SET name = ?, name_normalise = ?, couleur = ?, updated_at = ? WHERE id = ?',
      [nom, normaliserCategorie(nom), couleur, new Date().toISOString(), id]
    );

    res.json({ success: true, data: await lireCategorie(id) });
  } catch (erreur: any) {
    if (estViolationUnicite(erreur)) {
      return res.status(409).json({ success: false, message: 'Une catégorie porte déjà ce nom.' });
    }
    erreurServeur(res, 'modification catégorie planning', erreur);
  }
});

/** Retirer une catégorie de l'autocomplétion, sans toucher à l'historique. */
router.put('/categories/:id/actif', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await lireCategorie(id))) {
      return res.status(404).json({ success: false, message: 'Catégorie introuvable' });
    }

    await db.execute(
      'UPDATE planning_categories SET is_active = ?, updated_at = ? WHERE id = ?',
      [req.body?.active === false ? 0 : 1, new Date().toISOString(), id]
    );

    res.json({ success: true, data: await lireCategorie(id) });
  } catch (erreur) {
    erreurServeur(res, 'activation catégorie planning', erreur);
  }
});

/**
 * Supprimer une catégorie, si rien ne s'en sert.
 *
 * Refusé, avec le nombre de tâches concernées, plutôt que cascadé : la
 * personne peut alors choisir en connaissance de cause entre désactiver et
 * reprendre ses saisies. C'est ce que fait déjà le référentiel des clés.
 */
router.delete('/categories/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const categorie = await lireCategorie(id);
    if (!categorie) {
      return res.status(404).json({ success: false, message: 'Catégorie introuvable' });
    }

    const usages = await usagesCategorie(id);
    if (usages > 0) {
      return res.status(409).json({
        success: false,
        data: { usages },
        message:
          `« ${categorie.nom} » est employée par ${usages} tâche${usages > 1 ? 's' : ''}. ` +
          'Désactivez-la pour la retirer des propositions sans effacer ces heures.',
      });
    }

    await db.execute('DELETE FROM planning_categories WHERE id = ?', [id]);
    await logService.info('other', `Catégorie de planning supprimée : ${categorie.nom}`, { id }, { userId: req.user?.userId });
    res.json({ success: true });
  } catch (erreur) {
    erreurServeur(res, 'suppression catégorie planning', erreur);
  }
});

// ==================== Les tâches ====================

router.get('/taches', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const bornes = bornesDemandees(req.query);
    if (!bornes) {
      return res.status(400).json({ success: false, message: 'Période invalide' });
    }

    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    const taches = await listerTaches(
      {
        ...bornes,
        categorieIds: identifiants(req.query.categorieIds),
        personneIds: identifiants(req.query.personneIds),
        manifestationId: req.query.manifestationId ? Number(req.query.manifestationId) : null,
      },
      perimetre
    );

    res.json({ success: true, data: { periode: bornes, taches } });
  } catch (erreur) {
    erreurServeur(res, 'liste tâches planning', erreur);
  }
});

router.get('/taches/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    const tache = await lireTache(Number(req.params.id), perimetre);
    // 404 et non 403 : dire « interdit » confirmerait que la tâche existe, et
    // à qui, ce que le cloisonnement existe justement pour taire.
    if (!tache) return res.status(404).json({ success: false, message: 'Tâche introuvable' });
    res.json({ success: true, data: tache });
  } catch (erreur) {
    erreurServeur(res, 'lecture tâche planning', erreur);
  }
});

function saisieDepuis(corps: any, parDefaut: number) {
  return {
    userId: corps?.userId ? Number(corps.userId) : parDefaut,
    jour: String(corps?.jour ?? ''),
    heureDebut: corps?.heureDebut ?? null,
    heureFin: corps?.heureFin ?? null,
    minutes: corps?.minutes == null ? null : Number(corps.minutes),
    categorieId: corps?.categorieId == null ? null : Number(corps.categorieId),
    manifestationId: corps?.manifestationId == null ? null : Number(corps.manifestationId),
    description: corps?.description ?? null,
    participants: Array.isArray(corps?.participants) ? corps.participants : [],
  };
}

router.post('/taches', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const saisie = saisieDepuis(req.body, req.user!.userId);

    if (!(await peutEcrirePour(req.user!.userId, req.user!.role, saisie.userId))) {
      return res.status(403).json({
        success: false,
        message: "Vous ne pouvez saisir du temps que pour vous-même ou pour les personnes que vous encadrez.",
      });
    }

    const id = await creerTache(saisie, req.user!.userId);
    await logService.info('other', `Temps saisi : ${saisie.jour}`, { id, pour: saisie.userId }, { userId: req.user?.userId });

    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    res.status(201).json({ success: true, data: await lireTache(id, perimetre) });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) {
      return res.status(400).json({ success: false, message: erreur.message });
    }
    erreurServeur(res, 'création tâche planning', erreur);
  }
});

/** La tâche existe-t-elle, et a-t-on le droit d'y toucher ? */
async function tacheModifiable(req: AuthRequest): Promise<{ id: number; titulaireId: number } | null> {
  const id = Number(req.params.id);
  const ligne = await db.queryOne('SELECT id, user_id FROM planning_taches WHERE id = ?', [id]);
  if (!ligne) return null;

  const titulaireId = Number(ligne.user_id);
  const autorise = await peutEcrirePour(req.user!.userId, req.user!.role, titulaireId);
  return autorise ? { id, titulaireId } : null;
}

router.put('/taches/:id', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const cible = await tacheModifiable(req);
    if (!cible) return res.status(404).json({ success: false, message: 'Tâche introuvable' });

    const saisie = saisieDepuis(req.body, cible.titulaireId);
    // Changer le titulaire demande le droit sur l'ancien **et** sur le nouveau.
    if (saisie.userId !== cible.titulaireId
        && !(await peutEcrirePour(req.user!.userId, req.user!.role, saisie.userId))) {
      return res.status(403).json({
        success: false,
        message: "Vous ne pouvez pas attribuer cette tâche à cette personne.",
      });
    }

    await modifierTache(cible.id, saisie);
    await logService.info('other', `Temps modifié : tâche #${cible.id}`, {}, { userId: req.user?.userId });

    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    res.json({ success: true, data: await lireTache(cible.id, perimetre) });
  } catch (erreur: any) {
    if (erreur instanceof SaisieInvalide) {
      return res.status(400).json({ success: false, message: erreur.message });
    }
    erreurServeur(res, 'modification tâche planning', erreur);
  }
});

router.delete('/taches/:id', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const cible = await tacheModifiable(req);
    if (!cible) return res.status(404).json({ success: false, message: 'Tâche introuvable' });

    await supprimerTache(cible.id);
    await logService.info('other', `Temps supprimé : tâche #${cible.id}`, {}, { userId: req.user?.userId });
    res.json({ success: true });
  } catch (erreur) {
    erreurServeur(res, 'suppression tâche planning', erreur);
  }
});

// ==================== Le rapport ====================

/** Les filtres d'un rapport, lus une fois pour la consultation comme pour l'export. */
function rapportDemande(query: any) {
  const bornes = bornesDemandees(query);
  if (!bornes) return null;

  // La nature de la période, et non le découpage de son graphique : c'est
  // elle qui nomme le rapport et qui désigne à quoi le comparer. Des bornes
  // libres (`debut`/`fin`) n'ont pas de nature : on la déduit de leur durée.
  const typePeriode: Granularite = GRANULARITES.includes(query.periode)
    ? query.periode
    : granularitePour(bornes);

  const mesure: Mesure = MESURES.includes(query.mesure) ? query.mesure : 'mobilise';
  const personneId = query.personneId ? Number(query.personneId) : null;
  const granularite: Granularite | undefined = GRANULARITES.includes(query.granularite)
    ? query.granularite
    : undefined;

  return {
    bornes,
    typePeriode,
    filtres: {
      mesure,
      personneId,
      typePeriode,
      granularite: granularite ?? granularitePour(bornes),
      categorieIds: identifiants(query.categorieIds),
      personneIds: identifiants(query.personneIds),
      manifestationId: query.manifestationId ? Number(query.manifestationId) : null,
    },
  };
}

/** La période à laquelle se comparer : la précédente, l'an dernier, ou celle qu'on nomme. */
function bornesComparaison(query: any, bornes: Bornes, granularite: Granularite): Bornes | null {
  const { comparer: mode, compareDebut, compareFin } = query;

  if (estJourValide(compareDebut) && estJourValide(compareFin)) {
    return { debut: compareDebut, fin: compareFin };
  }
  if (mode === 'precedente') return periodePrecedente(granularite, bornes.debut);
  if (mode === 'n-1') return memePeriodeAnneePrecedente(granularite, bornes.debut);
  return null;
}

router.get('/rapport', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const demande = rapportDemande(req.query);
    if (!demande) return res.status(400).json({ success: false, message: 'Période invalide' });

    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    const rapport = await construireRapport(demande.bornes, demande.filtres, perimetre);

    // La granularité de la période comparée est celle du rapport : deux
    // découpages différents donneraient deux séries qu'on ne peut pas poser
    // côte à côte.
    const bornesRef = bornesComparaison(req.query, demande.bornes, demande.typePeriode);
    const comparaison = bornesRef
      ? comparer(
          rapport,
          await construireRapport(
            bornesRef,
            { ...demande.filtres, granularite: rapport.periode.granularite },
            perimetre
          )
        )
      : null;

    res.json({ success: true, data: { rapport, comparaison } });
  } catch (erreur) {
    erreurServeur(res, 'rapport planning', erreur);
  }
});

router.get('/rapport/export', authenticateToken, exportLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const demande = rapportDemande(req.query);
    if (!demande) return res.status(400).json({ success: false, message: 'Période invalide' });

    const perimetre = await perimetreDe(req.user!.userId, req.user!.role);
    const csv = req.query.format === 'csv';
    const resultat = csv
      ? await genererCsv(demande.bornes, demande.filtres, perimetre)
      : await genererClasseur(demande.bornes, demande.filtres, perimetre);

    await logService.info(
      'other',
      `Export des heures (${csv ? 'csv' : 'xlsx'}) : ${demande.bornes.debut} → ${demande.bornes.fin}`,
      { lignes: resultat.lignes },
      { userId: req.user?.userId }
    );

    res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : TYPE_MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${resultat.nomFichier}"`);
    res.send(resultat.contenu);
  } catch (erreur) {
    erreurServeur(res, 'export planning', erreur);
  }
});

// ==================== L'encadrement ====================

router.get('/superviseurs', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const agentId = req.query.agentId ? Number(req.query.agentId) : null;
    if (!agentId) {
      return res.status(400).json({ success: false, message: 'Indiquez la personne concernée.' });
    }
    res.json({ success: true, data: await superviseursDe(agentId) });
  } catch (erreur) {
    erreurServeur(res, 'lecture encadrement planning', erreur);
  }
});

/**
 * Remplace d'un bloc les encadrants d'une personne.
 *
 * Réservé à l'administrateur : un encadrant qui pourrait s'attribuer des agents
 * élargirait seul ce qu'il voit, et le cloisonnement ne serait plus qu'une
 * convention. C'est le même raisonnement que pour l'écran Droits.
 */
router.put('/superviseurs/:agentId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const agentId = Number(req.params.agentId);
    const liens: { superviseurId: number; intitule?: string }[] = Array.isArray(req.body?.liens)
      ? req.body.liens
      : [];

    const personne = await db.queryOne('SELECT id FROM users WHERE id = ?', [agentId]);
    if (!personne) return res.status(404).json({ success: false, message: 'Personne introuvable' });

    const vus = new Set<number>();
    for (const lien of liens) {
      const superviseurId = Number(lien?.superviseurId);
      if (!Number.isInteger(superviseurId) || superviseurId <= 0) {
        return res.status(400).json({ success: false, message: 'Encadrant invalide.' });
      }
      if (superviseurId === agentId) {
        return res.status(400).json({ success: false, message: 'Une personne ne peut pas être son propre encadrant.' });
      }
      if (vus.has(superviseurId)) {
        return res.status(400).json({ success: false, message: 'Cet encadrant figure deux fois.' });
      }
      vus.add(superviseurId);
    }

    // Remplacement de l'ensemble, comme pour les catégories d'un service :
    // l'écran envoie l'état voulu, pas une suite de gestes.
    await db.execute('DELETE FROM planning_superviseurs WHERE agent_id = ?', [agentId]);
    for (const lien of liens) {
      await db.execute(
        'INSERT INTO planning_superviseurs (agent_id, superviseur_id, intitule, created_at) VALUES (?, ?, ?, ?)',
        [agentId, Number(lien.superviseurId), lien.intitule?.trim() || null, new Date().toISOString()]
      );
    }

    await logService.info('user', `Encadrement des heures mis à jour pour la personne ${agentId}`,
      { encadrants: liens.length }, { userId: req.user?.userId });

    res.json({ success: true, data: await superviseursDe(agentId) });
  } catch (erreur) {
    erreurServeur(res, 'enregistrement encadrement planning', erreur);
  }
});

/**
 * Les personnes qui saisissent des heures sans être rattachées à quiconque.
 *
 * Leurs heures ne sont visibles que d'elles-mêmes et de l'administrateur. Ce
 * n'est pas une anomalie du code mais une conséquence du cloisonnement choisi,
 * et la seule façon qu'elle ne passe pas inaperçue est de l'afficher.
 */
router.get('/agents-sans-superviseur', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await agentsSansSuperviseur() });
  } catch (erreur) {
    erreurServeur(res, 'agents sans encadrant', erreur);
  }
});

export default router;
