import fs from 'fs';
import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import {
  delegationsDe,
  peutDeleguerPour,
  servicesDe,
} from '../services/manifestationServices.service';
import {
  appliquerCorrespondance,
  donneesExemple,
  donneesPourModele,
  VALEURS_MODELE,
} from '../services/donneesModele.service';
import {
  completerDonneesManquantes,
  detecterChamps,
  estDocxValide,
  remplirModele,
} from '../services/modeleDocx.service';
import { contenuDuModele } from '../services/generationDocuments.service';
import { cheminSurDisque, supprimerFichier } from '../services/manifestationDocuments.service';
import { lireFichier, listerDossier } from '../services/webdav.service';
import slugify from '../utils/slugify';

/**
 * Services concernés par les manifestations.
 *
 * Un service est un groupe de personnes **et** un périmètre de catégories de
 * matériel. C'est ce périmètre qui décide qui est sollicité : le service
 * informatique n'est ni alerté ni destinataire d'une brocante qui ne demande
 * aucun matériel informatique.
 *
 * Un service *observateur* — direction générale, élus — n'a pas de périmètre :
 * il suit tout, sans rien approuver.
 */

const router = Router();

/** Un seul message de refus, pour qu'il se lise pareil partout. */
const REFUS_DELEGATION =
  "Seul le responsable du service peut gérer ses délégations d'approbation";

/** Détail d'un service, avec son périmètre et ses membres. */
async function lireService(id: number | string): Promise<any | null> {
  const service = await db.queryOne('SELECT * FROM services WHERE id = ?', [id]);
  if (!service) return null;

  const categories = await db.query(
    `SELECT c.id, c.name FROM service_categories sc
     JOIN categories c ON c.id = sc.category_id
     WHERE sc.service_id = ? ORDER BY c.name`,
    [id]
  );
  const membres = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, sm.is_manager
     FROM service_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.service_id = ? ORDER BY u.last_name, u.first_name`,
    [id]
  );

  return { ...service, categories, members: membres };
}

/**
 * GET / - Liste des services.
 *
 * Ouverte à tout compte authentifié : les noms de service apparaissent dans le
 * suivi d'une manifestation, et un membre doit pouvoir savoir à qui il parle.
 * La composition détaillée reste réservée à l'administrateur.
 */
router.get('/', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const services = await db.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM service_members sm WHERE sm.service_id = s.id) as members_count,
        (SELECT COUNT(*) FROM service_categories sc WHERE sc.service_id = s.id) as categories_count
       FROM services s ORDER BY s.name`
    );
    res.json({ success: true, data: services });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /mine - Services auxquels appartient le compte courant. */
router.get('/mine', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await servicesDe(req.user!.userId) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /template-values - Valeurs qu'un modèle de document peut afficher.
 *
 * Déclarée **avant** `GET /:id`, qui accepte n'importe quel segment et
 * capterait « template-values » comme un identifiant de service.
 */
router.get('/template-values', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: VALEURS_MODELE });
});

/**
 * GET /nextcloud-templates - Modèles `.docx` présents dans un dossier Nextcloud.
 *
 * Tenir les modèles dans Nextcloud permet de les corriger à un seul endroit,
 * sans repasser par l'application : le fichier est relu à chaque génération.
 * Le dossier par défaut est celui du dépôt des exports, où l'on range déjà les
 * pièces partagées.
 */
router.get('/nextcloud-templates', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const dossier = req.query.path ? String(req.query.path) : '/Modeles';
    const resultat = await listerDossier(dossier);
    if (!resultat.success) {
      return res.status(400).json({ success: false, message: resultat.error });
    }

    res.json({
      success: true,
      data: {
        dossier,
        fichiers: (resultat.fichiers ?? []).map((nom) => ({
          nom,
          chemin: `${dossier.replace(/\/+$/, '')}/${nom}`,
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const service = await lireService(req.params.id);
    if (!service) return res.status(404).json({ success: false, message: 'Service non trouvé' });
    res.json({ success: true, data: service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, description, is_observer, is_coordinator, is_active } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }

    // Un seul service pilote les manifestations, ici comme à la modification.
    if (is_coordinator) {
      await db.execute('UPDATE services SET is_coordinator = 0');
    }

    const maintenant = new Date().toISOString();
    const resultat = await db.execute(
      `INSERT INTO services (name, slug, email, description, is_observer, is_coordinator, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        slugify(name),
        email?.trim() || null,
        description?.trim() || null,
        is_observer ? 1 : 0,
        is_coordinator ? 1 : 0,
        is_active === false ? 0 : 1,
        maintenant,
        maintenant,
      ]
    );

    await logService.success('user', `Service créé : ${name}`, {}, { userId: req.user?.userId });
    res.status(201).json({ success: true, data: await lireService(resultat.lastInsertRowid) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Un service porte déjà ce nom'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, email, description, is_observer, is_coordinator, is_active,
      notify_new_request, notify_status_change, notify_material_change, notify_message,
    } = req.body;

    // Un réglage absent vaut « activé » : couper une notification doit être un
    // geste explicite, jamais la conséquence d'un champ oublié.
    const actif = (valeur: unknown) => (valeur === false || valeur === 0 ? 0 : 1);

    // Un seul service pilote les manifestations : le désigner retire le drapeau
    // au précédent, plutôt que de laisser deux services se disputer la
    // validation finale sans que personne sache lequel tranche.
    if (is_coordinator) {
      await db.execute('UPDATE services SET is_coordinator = 0 WHERE id != ?', [req.params.id]);
    }

    const resultat = await db.execute(
      `UPDATE services SET name = ?, email = ?, description = ?, is_observer = ?, is_coordinator = ?, is_active = ?,
         notify_new_request = ?, notify_status_change = ?, notify_material_change = ?, notify_message = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        name, email?.trim() || null, description?.trim() || null,
        is_observer ? 1 : 0, is_coordinator ? 1 : 0, is_active === false ? 0 : 1,
        actif(notify_new_request), actif(notify_status_change),
        actif(notify_material_change), actif(notify_message),
        new Date().toISOString(), req.params.id,
      ]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Service non trouvé' });
    }
    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Un service qui a rendu des décisions fait partie de la traçabilité d'une
    // manifestation : le supprimer effacerait qui a approuvé quoi. On le
    // désactive, ce qui l'écarte des prochaines sollicitations sans réécrire
    // le passé.
    const decisions = await db.queryOne(
      "SELECT COUNT(*) as cnt FROM manifestation_approvals WHERE service_id = ? AND status != 'pending'",
      [req.params.id]
    );
    if (decisions?.cnt > 0) {
      await db.execute('UPDATE services SET is_active = 0, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        req.params.id,
      ]);
      return res.json({
        success: true,
        desactive: true,
        message: `Ce service a rendu ${decisions.cnt} décision(s) : il a été désactivé plutôt que supprimé, pour ne pas effacer la traçabilité`,
      });
    }

    // Le modèle part en cascade, mais pas son fichier : le supprimer ici évite
    // qu'un `.docx` reste indéfiniment sur le disque au nom d'un service qui
    // n'existe plus. Un modèle tenu dans Nextcloud n'appartient pas à
    // l'application : il n'y est jamais touché.
    const modele = await lireModele(req.params.id);
    if (modele?.source === 'upload') supprimerFichier(modele.file_path);

    const resultat = await db.execute('DELETE FROM services WHERE id = ?', [req.params.id]);
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Service non trouvé' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== PÉRIMÈTRE ========================

/**
 * PUT /:id/categories - Périmètre de matériel du service.
 *
 * Remplace la liste entière : c'est la forme que prend l'écran, une grille de
 * cases à cocher.
 */
router.put('/:id/categories', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { category_ids } = req.body;
    if (!Array.isArray(category_ids)) {
      return res.status(400).json({ success: false, message: 'Liste de catégories requise' });
    }

    await db.execute('DELETE FROM service_categories WHERE service_id = ?', [req.params.id]);
    for (const categoryId of category_ids) {
      await db.execute(
        'INSERT INTO service_categories (service_id, category_id) VALUES (?, ?)',
        [req.params.id, categoryId]
      );
    }

    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MEMBRES ========================

router.post('/:id/members', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, is_manager } = req.body;
    const utilisateur = await db.queryOne('SELECT id FROM users WHERE id = ?', [user_id]);
    if (!utilisateur) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    await db.execute(
      'INSERT INTO service_members (service_id, user_id, is_manager, created_at) VALUES (?, ?, ?, ?)',
      [req.params.id, user_id, is_manager ? 1 : 0, new Date().toISOString()]
    );
    res.status(201).json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Cette personne est déjà membre du service'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

/**
 * PUT /:id/members/:userId - Désigner ou retirer le responsable.
 *
 * C'est lui qui approuve au nom du service et lui seul qui délègue. Un service
 * sans responsable ne peut plus rien approuver : l'écran le signale plutôt que
 * de laisser découvrir le blocage le jour d'une validation.
 */
router.put('/:id/members/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'UPDATE service_members SET is_manager = ? WHERE service_id = ? AND user_id = ?',
      [req.body.is_manager ? 1 : 0, req.params.id, req.params.userId]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Membre non trouvé' });
    }

    // Retirer le dernier responsable laisse le service sans signature possible :
    // les délégations en cours perdent leur fondement au passage.
    if (!req.body.is_manager) {
      await db.execute('DELETE FROM service_delegations WHERE service_id = ?', [req.params.id]);
    }

    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id/members/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM service_members WHERE service_id = ? AND user_id = ?',
      [req.params.id, req.params.userId]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Membre non trouvé' });
    }
    res.json({ success: true, data: await lireService(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== DÉLÉGATIONS D'APPROBATION ========================
//
// Approuver engage la collectivité : la décision revient au responsable du
// service. Quand il s'absente, il désigne lui-même qui décide à sa place — et
// lui seul, car une délégation qui se redéléguerait rendrait la chaîne de
// responsabilité inconnaissable.

/** GET /:id/delegations - Délégations accordées par ce service. */
router.get('/:id/delegations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await peutDeleguerPour(req.user!.userId, req.user!.role, Number(req.params.id)))) {
      return res.status(403).json({ success: false, message: REFUS_DELEGATION });
    }
    res.json({ success: true, data: await delegationsDe(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/delegations - Déléguer ses approbations.
 *
 * Les dates sont facultatives : sans elles, la délégation vaut jusqu'à
 * révocation — le cas de l'adjoint permanent, aussi courant qu'un remplacement
 * de congés.
 */
router.post('/:id/delegations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const serviceId = Number(req.params.id);
    if (!(await peutDeleguerPour(req.user!.userId, req.user!.role, serviceId))) {
      return res.status(403).json({ success: false, message: REFUS_DELEGATION });
    }

    const { delegate_user_id, start_date, end_date } = req.body;
    if (!delegate_user_id) {
      return res.status(400).json({ success: false, message: 'Indiquez à qui déléguer' });
    }

    const destinataire = await db.queryOne(
      'SELECT id, is_active, anonymized_at FROM users WHERE id = ?',
      [delegate_user_id]
    );
    if (!destinataire) {
      return res.status(404).json({ success: false, message: 'Compte introuvable' });
    }
    if (!destinataire.is_active || destinataire.anonymized_at) {
      return res.status(400).json({
        success: false,
        message: 'Ce compte est désactivé : il ne pourrait pas se connecter pour décider',
      });
    }

    // Déléguer à soi-même n'ajoute rien et brouille la lecture du tableau.
    if (Number(delegate_user_id) === req.user!.userId) {
      return res.status(400).json({
        success: false,
        message: 'Vous décidez déjà pour ce service : la délégation serait sans effet',
      });
    }

    if (start_date && end_date && start_date > end_date) {
      return res.status(400).json({
        success: false,
        message: 'La fin de la délégation précède son début',
      });
    }

    await db.execute(
      `INSERT INTO service_delegations (service_id, delegate_user_id, granted_by, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [serviceId, delegate_user_id, req.user!.userId, start_date || null, end_date || null, new Date().toISOString()]
    );

    await logService.success(
      'user',
      `Délégation d'approbation accordée sur le service ${serviceId}`,
      { delegate_user_id },
      { userId: req.user?.userId }
    );

    res.status(201).json({ success: true, data: await delegationsDe(serviceId) });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Cette personne a déjà une délégation sur ce service'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

/** DELETE /:id/delegations/:delegationId - Révoquer une délégation. */
router.delete('/:id/delegations/:delegationId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const serviceId = Number(req.params.id);
    if (!(await peutDeleguerPour(req.user!.userId, req.user!.role, serviceId))) {
      return res.status(403).json({ success: false, message: REFUS_DELEGATION });
    }

    const resultat = await db.execute(
      'DELETE FROM service_delegations WHERE id = ? AND service_id = ?',
      [req.params.delegationId, serviceId]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Délégation non trouvée' });
    }

    await logService.warning(
      'user',
      `Délégation d'approbation révoquée sur le service ${serviceId}`,
      {},
      { userId: req.user?.userId }
    );

    res.json({ success: true, data: await delegationsDe(serviceId) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== MODÈLES DE DOCUMENT ========================
//
// Une demande reçue par formulaire concerne plusieurs services, mais chacun n'a
// besoin que de sa part : le service qui instruit un débit de boissons n'a que
// faire du raccordement électrique, du personnel demandé, ou du nombre de
// chaises. Seul le service qui pilote les manifestations a besoin de tout.
//
// Le modèle est un `.docx` ordinaire, écrit dans Word, où les valeurs à remplir
// s'écrivent entre accolades. Ses champs sont relevés à l'import, et l'écran de
// correspondance dit à quelle valeur de la demande chacun renvoie.

/** Lit un JSON stocké en colonne texte sans jamais lever. */
function lireJsonModele<T>(brut: unknown, defaut: T): T {
  if (!brut) return defaut;
  try {
    return typeof brut === 'string' ? (JSON.parse(brut) as T) : (brut as T);
  } catch {
    return defaut;
  }
}

/** Modèle d'un service, tel que l'écran l'attend. */
async function lireModele(serviceId: number | string): Promise<any | null> {
  const modele = await db.queryOne(
    'SELECT * FROM service_templates WHERE service_id = ? ORDER BY id DESC LIMIT 1',
    [serviceId]
  );
  if (!modele) return null;

  return {
    ...modele,
    detected_fields: lireJsonModele<string[]>(modele.detected_fields, []),
    field_mapping: lireJsonModele<Record<string, string>>(modele.field_mapping, {}),
  };
}

/**
 * Champs du modèle, quelle que soit sa provenance.
 *
 * Un modèle tenu dans Nextcloud est relu à chaque fois : c'est ce qui permet de
 * le corriger à un seul endroit, sans redéposer un fichier à chaque virgule
 * changée.
 */
async function champsDuFichier(
  source: string,
  filePath: string | null,
  remotePath: string | null
): Promise<{ champs?: string[]; error?: string }> {
  let contenu: Buffer | undefined;

  if (source === 'nextcloud') {
    if (!remotePath) return { error: 'Indiquez le chemin du modèle dans Nextcloud' };
    const lecture = await lireFichier(remotePath);
    if (!lecture.success || !lecture.contenu) return { error: lecture.error };
    contenu = lecture.contenu;
  } else {
    const complet = cheminSurDisque(filePath);
    if (!complet) return { error: 'Le fichier envoyé est introuvable' };
    contenu = fs.readFileSync(complet);
  }

  if (!(await estDocxValide(contenu))) {
    return { error: "Ce fichier n'est pas un document Word (.docx). Enregistrez-le au format .docx depuis Word ou LibreOffice." };
  }

  return { champs: await detecterChamps(contenu) };
}

/**
 * POST /:id/template - Rattacher un modèle à un service.
 *
 * Remplace celui qui existait : un service n'a qu'un modèle, sans quoi il
 * faudrait dire lequel s'applique, et personne ne saurait le dire.
 *
 * La correspondance est reprise pour les champs qui portent le même nom : un
 * modèle corrigé pour une faute de frappe ne fait pas recommencer tout le
 * réglage.
 */
router.post('/:id/template', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const service = await db.queryOne('SELECT id, name FROM services WHERE id = ?', [req.params.id]);
    if (!service) return res.status(404).json({ success: false, message: 'Service non trouvé' });

    const { name, source, file_path, remote_path } = req.body;
    const provenance = source === 'nextcloud' ? 'nextcloud' : 'upload';

    const { champs, error } = await champsDuFichier(
      provenance,
      file_path ?? null,
      remote_path ?? null
    );
    if (!champs) return res.status(400).json({ success: false, message: error });

    const ancien = await lireModele(req.params.id);
    const reprise: Record<string, string> = {};
    for (const champ of champs) {
      if (ancien?.field_mapping?.[champ]) reprise[champ] = ancien.field_mapping[champ];
    }

    // Le fichier remplacé n'a plus de raison d'occuper le disque.
    if (ancien) {
      await db.execute('DELETE FROM service_templates WHERE service_id = ?', [req.params.id]);
      if (ancien.source === 'upload' && ancien.file_path !== file_path) {
        supprimerFichier(ancien.file_path);
      }
    }

    const maintenant = new Date().toISOString();
    await db.execute(
      `INSERT INTO service_templates
         (service_id, name, source, file_path, remote_path, detected_fields, field_mapping,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        req.params.id,
        String(name ?? '').trim() || `Modèle ${service.name}`,
        provenance,
        provenance === 'upload' ? file_path : null,
        provenance === 'nextcloud' ? remote_path : null,
        JSON.stringify(champs),
        JSON.stringify(reprise),
        maintenant,
        maintenant,
      ]
    );

    await logService.success(
      'user',
      `Modèle de document rattaché au service ${service.name}`,
      { champs: champs.length },
      { userId: req.user?.userId }
    );

    res.status(201).json({ success: true, data: await lireModele(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /:id/template - Modèle du service, avec les valeurs offertes au réglage. */
router.get('/:id/template', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: { modele: await lireModele(req.params.id), valeurs: VALEURS_MODELE },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /:id/template - Correspondance des champs, libellé, activation.
 *
 * Un champ laissé sans correspondance n'est pas une erreur : s'il porte le nom
 * d'une valeur connue il sera rempli quand même, et sinon il ressortira vide
 * plutôt qu'en accolades au milieu d'un arrêté.
 */
router.put('/:id/template', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const modele = await lireModele(req.params.id);
    if (!modele) return res.status(404).json({ success: false, message: 'Aucun modèle sur ce service' });

    const { name, field_mapping, is_active } = req.body;
    await db.execute(
      `UPDATE service_templates SET name = ?, field_mapping = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(name ?? modele.name).trim(),
        JSON.stringify(field_mapping ?? modele.field_mapping),
        is_active === false ? 0 : 1,
        new Date().toISOString(),
        modele.id,
      ]
    );

    res.json({ success: true, data: await lireModele(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/template/detect - Relire les champs du modèle.
 *
 * Utile après avoir corrigé le modèle dans Nextcloud : les champs ajoutés
 * apparaissent dans l'écran de correspondance sans rien redéposer.
 */
router.post('/:id/template/detect', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const modele = await lireModele(req.params.id);
    if (!modele) return res.status(404).json({ success: false, message: 'Aucun modèle sur ce service' });

    const { champs, error } = await champsDuFichier(
      modele.source,
      modele.file_path,
      modele.remote_path
    );
    if (!champs) {
      await db.execute('UPDATE service_templates SET last_error = ? WHERE id = ?', [
        error,
        modele.id,
      ]);
      return res.status(400).json({ success: false, message: error });
    }

    // Le réglage déjà fait est conservé pour les champs qui subsistent ; ceux
    // qui ont disparu du modèle sont oubliés plutôt que gardés en désordre.
    const reprise: Record<string, string> = {};
    for (const champ of champs) {
      if (modele.field_mapping?.[champ]) reprise[champ] = modele.field_mapping[champ];
    }

    await db.execute(
      `UPDATE service_templates SET detected_fields = ?, field_mapping = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(champs), JSON.stringify(reprise), new Date().toISOString(), modele.id]
    );

    res.json({ success: true, data: await lireModele(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /:id/template/preview - Voir ce que le modèle donnerait.
 *
 * Sans manifestation, un jeu d'exemple sert de démonstration : on peut vérifier
 * son modèle avant qu'une vraie demande arrive, ce qui est le seul moment où la
 * correction est encore sans conséquence.
 */
router.post('/:id/template/preview', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const modele = await lireModele(req.params.id);
    if (!modele) return res.status(404).json({ success: false, message: 'Aucun modèle sur ce service' });

    const { contenu, error } = await contenuDuModele(modele);
    if (!contenu) return res.status(400).json({ success: false, message: error });

    const donnees = req.body?.manifestation_id
      ? await donneesPourModele(req.body.manifestation_id, Number(req.params.id))
      : donneesExemple(await db.queryOne('SELECT name FROM services WHERE id = ?', [req.params.id]));

    const rempli = await remplirModele(
      contenu,
      completerDonneesManquantes(
        appliquerCorrespondance(donnees, modele.detected_fields, modele.field_mapping),
        modele.detected_fields
      )
    );

    const nom = String(modele.name).replace(/[^A-Za-z0-9 _.-]/g, '-').trim() || 'apercu';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${nom}.docx"`);
    res.send(rempli);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** DELETE /:id/template - Retirer le modèle, et son fichier s'il était téléversé. */
router.delete('/:id/template', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const modele = await lireModele(req.params.id);
    if (!modele) return res.status(404).json({ success: false, message: 'Aucun modèle sur ce service' });

    await db.execute('DELETE FROM service_templates WHERE id = ?', [modele.id]);
    // Un modèle tenu dans Nextcloud n'appartient pas à l'application : le
    // détacher ne doit surtout pas l'effacer là-bas.
    if (modele.source === 'upload') supprimerFichier(modele.file_path);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
