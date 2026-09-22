import { Router, Response } from 'express';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireAdmin,
  requireSupervisor,
} from '../middleware/auth.middleware';
import {
  cleParente,
  estViolationUnicite,
  listerCategories,
  listerStatuts,
  lireCategorie,
  MATERIEL_MODES,
  normaliserCategorie,
  SITE_MODES,
  usagesCategorie,
  usagesStatut,
  VISIBILITES,
} from '../services/ticketsReferentiel.service';
import { versDateTime } from '../services/tickets.service';
import { definirSitesDe, sitesDe } from '../services/sites.service';

/**
 * Le référentiel des demandes, et les rattachements des personnes.
 *
 * **Ce routeur doit être monté avant `/api/tickets`**, sinon
 * `GET /api/tickets/:id` avalerait `/api/tickets/referentiel` et répondrait
 * « demande introuvable » sur chaque écran de réglage. Le dépôt a déjà ce cas :
 * `/api/cles/public` précède `/api/cles` dans `server.ts`.
 *
 * Les lectures sont ouvertes à tout compte connecté : un formulaire a besoin du
 * nom et de la couleur des statuts pour s'afficher. Les écritures sont réservées
 * — le référentiel décide du routage, donc de qui voit quoi.
 */

const router = Router();

function refuser(res: Response, code: number, message: string) {
  return res.status(code).json({ success: false, message });
}

/** Une valeur d'énumération, ou `null` si elle n'est pas proposée. */
function parmi<T extends string>(valeur: unknown, admises: readonly T[]): T | null {
  const v = String(valeur ?? '').trim();
  return (admises as readonly string[]).includes(v) ? (v as T) : null;
}

/** Un entier, ou `null`. Distingue « absent » de « zéro ». */
function entierOuNull(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ statuts

router.get('/statuts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, statuts: await listerStatuts(req.query.tous === 'true') });
  } catch (erreur: any) {
    console.error('Erreur lecture statuts :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.post('/statuts', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const nom = String(req.body?.nom ?? '').trim();
    if (!nom) return refuser(res, 400, 'Le nom est obligatoire');

    const slug = normaliserCategorie(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const maintenant = versDateTime();

    const resultat = await db.execute(
      `INSERT INTO ticket_statuts (nom, slug, couleur, icone, ordre, is_ouvert, is_defaut, is_final, is_systeme, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      [
        nom,
        slug || `statut-${Date.now()}`,
        req.body?.couleur ?? null,
        req.body?.icone ?? null,
        entierOuNull(req.body?.ordre) ?? 99,
        req.body?.ouvert === false ? 0 : 1,
        req.body?.defaut ? 1 : 0,
        req.body?.final ? 1 : 0,
        maintenant,
        maintenant,
      ]
    );

    if (req.body?.defaut) await unSeulDefaut(Number(resultat.lastInsertRowid));
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    if (estViolationUnicite(erreur)) return refuser(res, 409, 'Un statut porte déjà ce nom');
    console.error('Erreur création de statut :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Un seul statut par défaut.
 *
 * La contrainte ne peut pas être posée en base — ni `CHECK` exploitable sur
 * MySQL 5.7, ni index partiel portable. Elle est donc appliquée ici, après
 * chaque écriture qui pose un défaut : deux statuts par défaut feraient
 * dépendre l'état d'ouverture de l'ordre de tri, donc du hasard.
 */
async function unSeulDefaut(gagnantId: number): Promise<void> {
  await db.execute('UPDATE ticket_statuts SET is_defaut = 0 WHERE id <> ?', [gagnantId]);
}

router.put('/statuts/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const statut = await db.queryOne('SELECT * FROM ticket_statuts WHERE id = ?', [req.params.id]);
    if (!statut) return refuser(res, 404, 'Statut introuvable');

    const colonnes: string[] = [];
    const params: any[] = [];
    const poser = (colonne: string, valeur: any) => {
      colonnes.push(`${colonne} = ?`);
      params.push(valeur);
    };

    if (req.body?.nom !== undefined) poser('nom', String(req.body.nom).trim());
    if (req.body?.couleur !== undefined) poser('couleur', req.body.couleur);
    if (req.body?.icone !== undefined) poser('icone', req.body.icone);
    if (req.body?.ordre !== undefined) poser('ordre', entierOuNull(req.body.ordre) ?? 0);
    if (req.body?.actif !== undefined) poser('is_active', req.body.actif ? 1 : 0);
    if (req.body?.ouvert !== undefined) poser('is_ouvert', req.body.ouvert ? 1 : 0);
    if (req.body?.defaut !== undefined) poser('is_defaut', req.body.defaut ? 1 : 0);
    if (req.body?.final !== undefined) poser('is_final', req.body.final ? 1 : 0);

    if (colonnes.length === 0) return res.json({ success: true });

    poser('updated_at', versDateTime());
    await db.execute(`UPDATE ticket_statuts SET ${colonnes.join(', ')} WHERE id = ?`, [
      ...params,
      req.params.id,
    ]);
    if (req.body?.defaut) await unSeulDefaut(Number(req.params.id));

    res.json({ success: true });
  } catch (erreur: any) {
    if (estViolationUnicite(erreur)) return refuser(res, 409, 'Un statut porte déjà ce nom');
    console.error('Erreur modification de statut :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/statuts/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const statut = await db.queryOne('SELECT * FROM ticket_statuts WHERE id = ?', [req.params.id]);
    if (!statut) return refuser(res, 404, 'Statut introuvable');

    // Un statut système peut être renommé et recoloré, jamais supprimé : le
    // code a besoin d'un point de départ et d'un point d'arrivée.
    if (statut.is_systeme) {
      return refuser(res, 409, 'Ce statut est nécessaire au fonctionnement : renommez-le ou désactivez-le');
    }

    const employe = await usagesStatut(req.params.id);
    if (employe > 0) {
      return refuser(
        res,
        409,
        `${employe} demande(s) portent ce statut : désactivez-le plutôt que de le supprimer`
      );
    }

    await db.execute('DELETE FROM ticket_statuts WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Statut supprimé' });
  } catch (erreur: any) {
    console.error('Erreur suppression de statut :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ---------------------------------------------------------------- catégories

router.get('/categories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await listerCategories(req.query.toutes === 'true');
    const liens = await db.query('SELECT * FROM ticket_categorie_materiels');
    res.json({
      success: true,
      categories: categories.map((c) => ({
        ...c,
        materiels: liens
          .filter((l: any) => Number(l.ticket_categorie_id) === c.id)
          .map((l: any) => ({
            categoryId: l.category_id === null ? null : Number(l.category_id),
            subcategoryId: l.subcategory_id === null ? null : Number(l.subcategory_id),
          })),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture catégories :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Les colonnes de routage, lues depuis un corps de requête. */
function routageDepuis(corps: any): { colonnes: string[]; params: any[] } {
  const colonnes: string[] = [];
  const params: any[] = [];
  const poser = (colonne: string, valeur: any) => {
    colonnes.push(colonne);
    params.push(valeur);
  };

  poser('service_id', entierOuNull(corps?.serviceId));
  poser('technicien_id', entierOuNull(corps?.technicienId));
  // `null` est une valeur utile sur une sous-catégorie : il veut dire
  // « hérite de la parente », et c'est le cas le plus courant.
  poser('visibilite', parmi(corps?.visibilite, VISIBILITES));
  poser('materiel_mode', parmi(corps?.materielMode, MATERIEL_MODES));
  poser('site_mode', parmi(corps?.siteMode, SITE_MODES));
  poser('sla_prise_en_charge_minutes', entierOuNull(corps?.slaPriseEnChargeMinutes));
  poser('sla_resolution_minutes', entierOuNull(corps?.slaResolutionMinutes));

  return { colonnes, params };
}

router.post('/categories', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const nom = String(req.body?.nom ?? '').trim();
    if (!nom) return refuser(res, 400, 'Le nom est obligatoire');

    const parentId = entierOuNull(req.body?.parentId);
    if (parentId !== null) {
      const parente = await lireCategorie(parentId);
      if (!parente) return refuser(res, 400, 'Catégorie parente introuvable');
      // Deux niveaux, pas davantage. La règle est tenue ici faute de `CHECK`
      // exploitable, et parce qu'une arborescence libre rendrait l'héritage du
      // routage impossible à expliquer.
      if (parente.parentId !== null) {
        return refuser(res, 400, 'Une sous-catégorie ne peut pas en porter une autre');
      }
    }

    const routage = routageDepuis(req.body);
    const maintenant = versDateTime();

    const resultat = await db.execute(
      `INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle, description, couleur, icone, ordre, is_active, ${routage.colonnes.join(', ')}, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ${routage.colonnes.map(() => '?').join(', ')}, ?, ?, ?)`,
      [
        nom,
        normaliserCategorie(nom),
        parentId,
        cleParente(parentId),
        req.body?.description ?? null,
        req.body?.couleur ?? null,
        req.body?.icone ?? null,
        entierOuNull(req.body?.ordre) ?? 99,
        ...routage.params,
        req.user!.userId,
        maintenant,
        maintenant,
      ]
    );

    await remplacerMaterielsDe(Number(resultat.lastInsertRowid), req.body?.materiels);
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    if (estViolationUnicite(erreur)) {
      return refuser(res, 409, 'Une catégorie porte déjà ce nom à ce niveau');
    }
    console.error('Erreur création de catégorie :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/categories/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const categorie = await lireCategorie(req.params.id);
    if (!categorie) return refuser(res, 404, 'Catégorie introuvable');

    const colonnes: string[] = [];
    const params: any[] = [];
    const poser = (colonne: string, valeur: any) => {
      colonnes.push(`${colonne} = ?`);
      params.push(valeur);
    };

    if (req.body?.nom !== undefined) {
      const nom = String(req.body.nom).trim();
      if (!nom) return refuser(res, 400, 'Le nom est obligatoire');
      poser('nom', nom);
      poser('name_normalise', normaliserCategorie(nom));
    }
    if (req.body?.description !== undefined) poser('description', req.body.description);
    if (req.body?.couleur !== undefined) poser('couleur', req.body.couleur);
    if (req.body?.icone !== undefined) poser('icone', req.body.icone);
    if (req.body?.ordre !== undefined) poser('ordre', entierOuNull(req.body.ordre) ?? 0);
    if (req.body?.actif !== undefined) poser('is_active', req.body.actif ? 1 : 0);

    for (const [i, colonne] of routageDepuis(req.body).colonnes.entries()) {
      const cles = [
        'serviceId',
        'technicienId',
        'visibilite',
        'materielMode',
        'siteMode',
        'slaPriseEnChargeMinutes',
        'slaResolutionMinutes',
      ];
      if (req.body?.[cles[i]] !== undefined) poser(colonne, routageDepuis(req.body).params[i]);
    }

    if (colonnes.length > 0) {
      poser('updated_at', versDateTime());
      await db.execute(`UPDATE ticket_categories SET ${colonnes.join(', ')} WHERE id = ?`, [
        ...params,
        req.params.id,
      ]);
    }

    if (req.body?.materiels !== undefined) {
      await remplacerMaterielsDe(Number(req.params.id), req.body.materiels);
    }

    res.json({ success: true });
  } catch (erreur: any) {
    if (estViolationUnicite(erreur)) {
      return refuser(res, 409, 'Une catégorie porte déjà ce nom à ce niveau');
    }
    console.error('Erreur modification de catégorie :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Applique la visibilité de la catégorie aux demandes déjà ouvertes.
 *
 * Le réglage ne rétroagit pas de lui-même : basculer « Bâtiment » en partagé ne
 * doit pas exposer d'un coup des demandes écrites quand elles étaient privées,
 * puisque leurs auteurs ne l'ont jamais accepté. Mais une commune qui règle son
 * référentiel après coup doit pouvoir le rattraper — d'un geste, et en le
 * sachant.
 */
router.post(
  '/categories/:id/appliquer-visibilite',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const categorie = await lireCategorie(req.params.id);
      if (!categorie) return refuser(res, 404, 'Catégorie introuvable');

      const { resoudreRoutage } = await import('../services/ticketsReferentiel.service');
      const routage = await resoudreRoutage(categorie.parentId ?? categorie.id, categorie.parentId ? categorie.id : null);
      const valeur = routage.visibilite === 'site' ? 1 : 0;

      const resultat = await db.execute(
        'UPDATE tickets SET visibilite_site = ? WHERE categorie_id = ? OR sous_categorie_id = ?',
        [valeur, req.params.id, req.params.id]
      );
      res.json({ success: true, modifiees: resultat.changes });
    } catch (erreur: any) {
      console.error('Erreur application de visibilité :', erreur);
      refuser(res, 500, 'Erreur serveur');
    }
  }
);

router.delete('/categories/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const usages = await usagesCategorie(req.params.id);
    if (usages.tickets > 0) {
      return refuser(
        res,
        409,
        `${usages.tickets} demande(s) portent cette catégorie : désactivez-la plutôt que de la supprimer`
      );
    }
    if (usages.enfants > 0) {
      return refuser(res, 409, 'Supprimez d’abord ses sous-catégories');
    }

    await db.execute('DELETE FROM ticket_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Catégorie supprimée' });
  } catch (erreur: any) {
    console.error('Erreur suppression de catégorie :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Remplace le parc proposé par une catégorie. Remplacement, non fusion. */
async function remplacerMaterielsDe(categorieId: number, materiels: any): Promise<void> {
  if (!Array.isArray(materiels)) return;
  await db.execute('DELETE FROM ticket_categorie_materiels WHERE ticket_categorie_id = ?', [categorieId]);
  for (const m of materiels) {
    const categoryId = entierOuNull(m?.categoryId);
    const subcategoryId = entierOuNull(m?.subcategoryId);
    if (categoryId === null && subcategoryId === null) continue;
    await db.execute(
      `INSERT INTO ticket_categorie_materiels (ticket_categorie_id, category_id, subcategory_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [categorieId, categoryId, subcategoryId, versDateTime()]
    );
  }
}

// ------------------------------------------------- rattachements d'une personne

router.get('/utilisateurs/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [sites, categories] = await Promise.all([
      sitesDe(req.params.userId),
      db.query('SELECT * FROM user_ticket_categories WHERE user_id = ?', [req.params.userId]),
    ]);
    res.json({
      success: true,
      sites: sites.map((s) => ({ siteId: s.id, nom: s.nom, peutVoirTickets: s.peutVoirTickets })),
      categories: categories.map((c: any) => ({
        categorieId: Number(c.ticket_categorie_id),
        materielAutorise:
          c.materiel_autorise === null || c.materiel_autorise === undefined
            ? null
            : Boolean(c.materiel_autorise),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des rattachements :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/utilisateurs/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);

    if (Array.isArray(req.body?.sites)) {
      await definirSitesDe(
        userId,
        req.body.sites.map((s: any) => ({
          siteId: Number(s.siteId),
          peutVoirTickets: Boolean(s.peutVoirTickets),
        })),
        req.user!.userId
      );
    }

    if (Array.isArray(req.body?.categories)) {
      await db.execute('DELETE FROM user_ticket_categories WHERE user_id = ?', [userId]);
      for (const c of req.body.categories) {
        const categorieId = entierOuNull(c?.categorieId);
        if (categorieId === null) continue;
        await db.execute(
          `INSERT INTO user_ticket_categories (user_id, ticket_categorie_id, materiel_autorise, created_by, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            categorieId,
            // `null` veut dire « ce que la catégorie a décidé ».
            c?.materielAutorise === null || c?.materielAutorise === undefined
              ? null
              : c.materielAutorise
                ? 1
                : 0,
            req.user!.userId,
            versDateTime(),
          ]
        );
      }
    }

    res.json({ success: true, message: 'Rattachements enregistrés' });
  } catch (erreur: any) {
    console.error('Erreur enregistrement des rattachements :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// ------------------------------------------------- les règles de diffusion

/**
 * Qui prévenir, et à quelle condition.
 *
 * Réservé à l'administrateur : une règle décide de qui reçoit quoi, et se
 * laisser ajouter comme destinataire reviendrait à s'abonner aux demandes des
 * autres services.
 */
router.get('/regles', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const regles = await db.query(
      `SELECT r.*,
              c.nom AS categorie_nom, sc.nom AS sous_categorie_nom,
              s.name AS site_nom, srv.name AS service_nom,
              du.first_name AS dest_prenom, du.last_name AS dest_nom,
              dsrv.name AS dest_service_nom
         FROM ticket_notification_regles r
         LEFT JOIN ticket_categories c ON c.id = r.categorie_id
         LEFT JOIN ticket_categories sc ON sc.id = r.sous_categorie_id
         LEFT JOIN cle_sites s ON s.id = r.site_id
         LEFT JOIN services srv ON srv.id = r.service_id
         LEFT JOIN users du ON du.id = r.destinataire_user_id
         LEFT JOIN services dsrv ON dsrv.id = r.destinataire_service_id
        ORDER BY r.id ASC`
    );

    res.json({
      success: true,
      regles: regles.map((r: any) => ({
        id: Number(r.id),
        evenement: r.evenement ?? null,
        libelle: r.libelle ?? null,
        actif: Boolean(r.is_active),
        portee: {
          categorieId: r.categorie_id === null ? null : Number(r.categorie_id),
          categorieNom: r.categorie_nom ?? null,
          sousCategorieId: r.sous_categorie_id === null ? null : Number(r.sous_categorie_id),
          sousCategorieNom: r.sous_categorie_nom ?? null,
          siteId: r.site_id === null ? null : Number(r.site_id),
          siteNom: r.site_nom ?? null,
          serviceId: r.service_id === null ? null : Number(r.service_id),
          serviceNom: r.service_nom ?? null,
        },
        destinataire: {
          type: r.destinataire_type,
          userId: r.destinataire_user_id === null ? null : Number(r.destinataire_user_id),
          userNom: [r.dest_prenom, r.dest_nom].filter(Boolean).join(' ').trim() || null,
          serviceId: r.destinataire_service_id === null ? null : Number(r.destinataire_service_id),
          serviceNom: r.dest_service_nom ?? null,
          role: r.destinataire_role ?? null,
        },
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des règles :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Valide un destinataire : exactement un des trois, faute de `CHECK` en base. */
function destinataireDepuis(corps: any): { type: string; userId: number | null; serviceId: number | null; role: string | null } | null {
  const userId = entierOuNull(corps?.destinataireUserId);
  const serviceId = entierOuNull(corps?.destinataireServiceId);
  const role = corps?.destinataireRole ? String(corps.destinataireRole) : null;

  const renseignes = [userId, serviceId, role].filter((v) => v !== null && v !== undefined);
  if (renseignes.length !== 1) return null;

  if (userId !== null) return { type: 'user', userId, serviceId: null, role: null };
  if (serviceId !== null) return { type: 'service', userId: null, serviceId, role: null };
  return { type: 'role', userId: null, serviceId: null, role };
}

router.post('/regles', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const destinataire = destinataireDepuis(req.body);
    if (!destinataire) {
      return refuser(res, 400, 'Indiquez exactement un destinataire : une personne, un service ou un rôle');
    }

    const maintenant = versDateTime();
    const resultat = await db.execute(
      `INSERT INTO ticket_notification_regles
         (evenement, categorie_id, sous_categorie_id, site_id, service_id,
          destinataire_type, destinataire_user_id, destinataire_service_id, destinataire_role,
          libelle, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        // `null` vaut « tous les événements » : c'est ce qu'on veut d'un élu qui
        // suit un bâtiment, et qui n'a pas à cocher six cases.
        req.body?.evenement || null,
        entierOuNull(req.body?.categorieId),
        entierOuNull(req.body?.sousCategorieId),
        entierOuNull(req.body?.siteId),
        entierOuNull(req.body?.serviceId),
        destinataire.type,
        destinataire.userId,
        destinataire.serviceId,
        destinataire.role,
        req.body?.libelle ?? null,
        req.user!.userId,
        maintenant,
        maintenant,
      ]
    );
    res.status(201).json({ success: true, id: Number(resultat.lastInsertRowid) });
  } catch (erreur: any) {
    console.error('Erreur création de règle :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.put('/regles/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.actif === undefined) return refuser(res, 400, 'Rien à modifier');
    await db.execute('UPDATE ticket_notification_regles SET is_active = ?, updated_at = ? WHERE id = ?', [
      req.body.actif ? 1 : 0,
      versDateTime(),
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (erreur: any) {
    console.error('Erreur modification de règle :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

router.delete('/regles/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await db.execute('DELETE FROM ticket_notification_regles WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Règle supprimée' });
  } catch (erreur: any) {
    console.error('Erreur suppression de règle :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/**
 * Qui recevrait, et pourquoi — sans rien envoyer.
 *
 * C'est ce qui transforme « très paramétrable » en « paramétrable
 * visuellement » : l'administrateur compose « une fuite à la mairie », appuie
 * sur *Tester*, et lit la liste avec la raison de chacun. Sans cela, il
 * découvrirait l'effet de ses règles sur une vraie demande, un mois plus tard.
 */
router.post('/regles/simulation', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const evenement = String(req.body?.evenement ?? '');
    if (!evenement) return refuser(res, 400, 'Choisissez un événement');

    const { simulerDestinataires } = await import('../services/ticketNotify.service');
    const destinataires = await simulerDestinataires({
      evenement,
      categorieId: entierOuNull(req.body?.categorieId),
      sousCategorieId: entierOuNull(req.body?.sousCategorieId),
      siteId: entierOuNull(req.body?.siteId),
      serviceId: entierOuNull(req.body?.serviceId),
    });

    res.json({
      success: true,
      destinataires: destinataires.map((d) => ({ email: d.email, raison: d.raison })),
    });
  } catch (erreur: any) {
    console.error('Erreur simulation des destinataires :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

// --------------------------------------------------- la reprise de GestSup

/**
 * Reprend un export GestSup.
 *
 * **L'essai à blanc est le défaut.** Il faut demander explicitement l'écriture
 * (`appliquer: true`) : découvrir après coup que trois cents demandes ont
 * atterri sur la mauvaise catégorie coûte bien plus cher que de lire un tableau
 * avant. L'écran enchaîne les deux — on lit le rapport, puis on confirme.
 */
router.post('/import/gestsup', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = req.body?.lignes;
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return refuser(res, 400, 'Aucune ligne à reprendre');
    }
    if (lignes.length > 5000) {
      // Une reprise se fait par lots : un fichier de cinquante mille lignes
      // tiendrait la connexion ouverte plusieurs minutes, et un délai
      // d'attente dépassé laisserait la reprise à moitié faite sans que
      // personne sache où elle s'est arrêtée.
      return refuser(res, 400, 'Reprenez par lots de 5000 lignes au maximum');
    }

    const { importerGestsup } = await import('../services/importGestsup.service');
    const rapport = await importerGestsup(lignes, {
      essaiABlanc: req.body?.appliquer !== true,
      auteurId: req.user!.userId,
    });

    res.json({ success: true, rapport });
  } catch (erreur: any) {
    console.error('Erreur reprise GestSup :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

/** Les correspondances retenues, pour les relire et les corriger. */
router.get('/import/correspondances', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const lignes = await db.query(
      'SELECT * FROM ticket_import_correspondances ORDER BY domaine ASC, valeur_source ASC'
    );
    res.json({
      success: true,
      correspondances: lignes.map((l: any) => ({
        id: Number(l.id),
        domaine: l.domaine,
        valeurSource: l.valeur_source,
        cibleId: l.cible_id === null ? null : Number(l.cible_id),
      })),
    });
  } catch (erreur: any) {
    console.error('Erreur lecture des correspondances :', erreur);
    refuser(res, 500, 'Erreur serveur');
  }
});

export default router;
