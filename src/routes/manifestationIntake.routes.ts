import { Router, Request, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { notifierWebhooks } from '../services/webhook.service';
import { consignerHistorique } from './manifestation.routes';
import {
  CHAMPS_INTAKE,
  CorrespondanceIntake,
  CorrespondanceMateriel,
  apparierMateriel,
  cheminsDe,
  extraireManifestation,
  extraireMateriels,
  genererSecret,
  resoudreCorrespondance,
  signatureValide,
} from '../services/manifestationIntake.service';
import {
  creerApprobationsManquantes,
  serviceCoordinateur,
  servicesPourArticles,
  servicesPourObjetsDuParc,
} from '../services/manifestationServices.service';
import { modeleDuService } from '../services/generationDocuments.service';
import { VALEURS_MODELE } from '../services/donneesModele.service';
import { produireEtNotifier } from '../services/generationDocuments.service';

/**
 * Réception des demandes de manifestation, et configuration des sources.
 *
 * Monté sur `/api/manifestations/intake`, **avant** le routeur des
 * manifestations : le dépôt d'une demande est la seule route de ce module qui
 * n'exige pas de compte, et elle ne doit pas se retrouver derrière
 * `authenticateToken`. Tout le reste — création de sources, journal — est
 * réservé à l'administrateur.
 *
 * L'ordre à l'intérieur du fichier compte : `POST /:slug` accepte n'importe quel
 * segment, y compris `sources`. Déclaré en premier, il captait la création de
 * source et la refusait en « source de réception inconnue ». Le dépôt est donc
 * déclaré en dernier, après toutes les routes nommées.
 */

const router = Router();

/** Segments déjà pris par les routes d'administration de ce routeur. */
const SLUGS_RESERVES = ['sources', 'requests'];

/** Une source configurée mais sans correspondance ne doit pas faire échouer la lecture. */
function lireJson<T>(brut: unknown, defaut: T): T {
  if (!brut) return defaut;
  try {
    return typeof brut === 'string' ? (JSON.parse(brut) as T) : (brut as T);
  } catch {
    return defaut;
  }
}

// ======================== DÉPÔT D'UNE DEMANDE ========================

/**
 * Enregistre ce qui a été reçu, quoi qu'il advienne ensuite.
 *
 * Une demande refusée pour signature invalide ou pour titre manquant doit
 * laisser une trace : sans journal, une demande perdue est indiscernable d'une
 * demande jamais envoyée, et c'est l'administrateur qui découvre le problème
 * le jour de la manifestation.
 */
async function journaliser(entree: {
  sourceId: number | null;
  externalId: string | null;
  payload: unknown;
  signatureOk: boolean;
  status: 'accepted' | 'rejected' | 'duplicate';
  manifestationId?: number | null;
  error?: string | null;
}): Promise<number> {
  const resultat = await db.execute(
    `INSERT INTO manifestation_intake_requests
       (source_id, external_id, payload, signature_ok, status, manifestation_id, error, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entree.sourceId,
      entree.externalId,
      JSON.stringify(entree.payload ?? null),
      entree.signatureOk ? 1 : 0,
      entree.status,
      entree.manifestationId ?? null,
      entree.error ?? null,
      new Date().toISOString(),
    ]
  );
  return resultat.lastInsertRowid;
}

// ======================== CONFIGURATION DES SOURCES ========================

/** Le secret ne ressort qu'à la création et sur demande explicite. */
function sansSecret(source: any): any {
  const { secret, last_payload, ...reste } = source;
  return { ...reste, has_secret: Boolean(secret) };
}

router.get('/sources/list', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const sources = await db.query(
      'SELECT * FROM manifestation_intake_sources ORDER BY created_at DESC'
    );
    res.json({ success: true, data: sources.map(sansSecret) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Chemins présents dans la dernière demande reçue, et correspondance déduite.
 *
 * C'est ce qui permet à l'écran de proposer des chemins réels au lieu d'un champ
 * de saisie libre où la moindre faute de frappe reste invisible.
 */
router.get('/sources/:id/champs', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const source = await db.queryOne(
      'SELECT * FROM manifestation_intake_sources WHERE id = ?',
      [req.params.id]
    );
    if (!source) return res.status(404).json({ success: false, message: 'Source non trouvée' });

    const payload = lireJson<unknown>(source.last_payload, null);
    const { correspondance, origine } = resoudreCorrespondance(
      payload,
      lireJson<CorrespondanceIntake | null>(source.field_mapping, null)
    );

    res.json({
      success: true,
      data: {
        champs: CHAMPS_INTAKE,
        chemins: payload ? cheminsDe(payload) : [],
        correspondance,
        origine,
        derniere_demande: payload,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /champs - Champs qu'une demande peut porter, indépendamment d'une source.
 *
 * Sert l'écran d'essai : on peut préparer son formulaire avant d'avoir créé la
 * moindre source, ce qui est l'ordre dans lequel les choses se font en pratique.
 */
router.get('/champs', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: CHAMPS_INTAKE });
});

/**
 * POST /sources/test - Essayer une charge utile **sans rien créer**.
 *
 * L'écran de réglage demande de deviner à l'avance quels chemins un formulaire
 * enverra, et la seule façon de le vérifier était d'envoyer une vraie demande —
 * qui créait une vraie manifestation, réservait du matériel, et écrivait aux
 * services. On l'essaie donc à blanc : rien n'est enregistré, personne n'est
 * prévenu, et le compte rendu dit ce qui *serait* arrivé.
 *
 * `créer: true` fait exception, pour qui veut aller jusqu'au bout : mais c'est
 * un geste explicite, jamais le comportement par défaut.
 */
router.post('/sources/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { payload, source_id } = req.body ?? {};
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Collez la charge utile JSON envoyée par votre formulaire',
      });
    }

    const source = source_id
      ? await db.queryOne('SELECT * FROM manifestation_intake_sources WHERE id = ?', [source_id])
      : null;

    const { correspondance, origine } = resoudreCorrespondance(
      payload,
      lireJson<CorrespondanceIntake | null>(source?.field_mapping, null)
    );
    const { champs, manquants } = extraireManifestation(payload, correspondance);

    const materiels = extraireMateriels(
      payload,
      lireJson<CorrespondanceMateriel | null>(source?.material_mapping, null)
    );

    const apparies: any[] = [];
    const nonApparies: any[] = [];
    for (const ligne of materiels) {
      const article = await apparierMateriel(ligne.libelle);
      if (article) {
        apparies.push({
          libelle: ligne.libelle,
          quantite: ligne.quantite,
          source: article.source,
          // `stock_id` et `stock_name` gardent leur nom : l'écran d'essai les lit déjà. Ils
          // portent l'identifiant dans la table que `source` désigne.
          stock_id: article.id,
          stock_name: article.name,
          is_prestation: article.is_prestation,
        });
      } else {
        nonApparies.push(ligne);
      }
    }

    // Qui serait sollicité, et ce que chacun recevrait. C'est la question qu'on
    // se pose vraiment devant un formulaire : « le service d'urbanisme va-t-il
    // être alerté, et avec quoi ? »
    //
    // Les deux sources sollicitent, chacune par sa règle : ne compter que le stock aurait dit
    // « personne » sur une demande qui ne porte que des prestations du parc.
    const parSource = (source: 'stock' | 'parc') =>
      apparies.filter((a) => a.source === source).map((a) => a.stock_id);
    const concernes = [
      ...(await servicesPourArticles(parSource('stock'))),
      ...(await servicesPourObjetsDuParc(parSource('parc'))),
    ].filter(
      (service, i, tous) => tous.findIndex((autre: any) => autre.id === service.id) === i
    );
    const coordinateur = await serviceCoordinateur();
    if (coordinateur && !concernes.some((s: any) => s.id === coordinateur.id)) {
      concernes.push(coordinateur);
    }

    const services = [];
    for (const service of concernes) {
      const modele = await modeleDuService(service.id);
      services.push({
        id: service.id,
        name: service.name,
        email: service.email,
        is_coordinator: !!service.is_coordinator,
        modele: modele
          ? {
              name: modele.name,
              source: modele.source,
              champs: lireJson<string[]>(modele.detected_fields, []).length,
              last_error: modele.last_error,
            }
          : null,
      });
    }

    res.json({
      success: true,
      data: {
        source: source ? { id: source.id, name: source.name, slug: source.slug } : null,
        origine_correspondance: origine,
        correspondance,
        chemins: cheminsDe(payload),
        champs_disponibles: CHAMPS_INTAKE,
        extrait: champs,
        manquants,
        recevable: manquants.length === 0,
        materiels: { apparies, non_apparies: nonApparies },
        services,
        valeurs_modele: VALEURS_MODELE,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/sources', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, field_mapping, material_mapping, is_active } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: 'Nom et identifiant requis' });
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant ne peut contenir que des minuscules, des chiffres et des tirets",
      });
    }
    // Ces segments désignent déjà des routes d'administration : une source qui
    // les porterait serait créée sans jamais pouvoir recevoir quoi que ce soit.
    if (SLUGS_RESERVES.includes(slug)) {
      return res.status(400).json({
        success: false,
        message: `« ${slug} » est réservé, choisissez un autre identifiant`,
      });
    }

    const secret = genererSecret();
    const maintenant = new Date().toISOString();
    const resultat = await db.execute(
      `INSERT INTO manifestation_intake_sources
         (name, slug, secret, is_active, field_mapping, material_mapping, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        slug,
        secret,
        is_active === false ? 0 : 1,
        field_mapping ? JSON.stringify(field_mapping) : null,
        material_mapping ? JSON.stringify(material_mapping) : null,
        maintenant,
        maintenant,
      ]
    );

    await logService.success('api', `Source de réception créée : ${name}`, { slug }, { userId: req.user?.userId });

    // Le secret n'est montré qu'ici : il n'est plus jamais renvoyé ensuite.
    res.status(201).json({
      success: true,
      data: { id: resultat.lastInsertRowid, name, slug, secret },
    });
  } catch (error: any) {
    const message = /UNIQUE|Duplicate/i.test(error.message)
      ? 'Cet identifiant est déjà utilisé'
      : error.message;
    res.status(400).json({ success: false, message });
  }
});

router.put('/sources/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, field_mapping, material_mapping, is_active } = req.body;
    const resultat = await db.execute(
      `UPDATE manifestation_intake_sources
       SET name = ?, field_mapping = ?, material_mapping = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      [
        name,
        field_mapping ? JSON.stringify(field_mapping) : null,
        material_mapping ? JSON.stringify(material_mapping) : null,
        is_active === false ? 0 : 1,
        new Date().toISOString(),
        req.params.id,
      ]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Source non trouvée' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Régénère le secret : la source doit alors être reconfigurée côté formulaire. */
router.post('/sources/:id/secret', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const secret = genererSecret();
    const resultat = await db.execute(
      'UPDATE manifestation_intake_sources SET secret = ?, updated_at = ? WHERE id = ?',
      [secret, new Date().toISOString(), req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Source non trouvée' });
    }
    await logService.warning('api', 'Secret de réception régénéré', { sourceId: req.params.id }, { userId: req.user?.userId });
    res.json({ success: true, data: { secret } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/sources/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM manifestation_intake_sources WHERE id = ?',
      [req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Source non trouvée' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Journal des demandes reçues, la plus récente en premier. */
router.get('/requests', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, source_id } = req.query;
    let sql = `
      SELECT r.*, s.name as source_name, m.title as manifestation_title
      FROM manifestation_intake_requests r
      LEFT JOIN manifestation_intake_sources s ON s.id = r.source_id
      LEFT JOIN manifestations m ON m.id = r.manifestation_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    if (source_id) {
      sql += ' AND r.source_id = ?';
      params.push(source_id);
    }
    sql += ' ORDER BY r.received_at DESC, r.id DESC LIMIT 200';

    res.json({ success: true, data: await db.query(sql, params) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/manifestations/intake/:slug
 *
 * Ouvert, mais signé : la source prouve son identité par un HMAC calculé sur les
 * octets exacts du corps, comme le fait déjà l'application quand elle émet un
 * webhook. La demande arrive en statut « à confirmer » — elle réserve le
 * matériel au prévisionnel sans engager le stock réel.
 */
router.post('/:slug', async (req: Request, res: Response) => {
  const source = await db.queryOne(
    'SELECT * FROM manifestation_intake_sources WHERE slug = ?',
    [req.params.slug]
  );

  if (!source || !source.is_active) {
    // Le même refus pour une source inconnue et pour une source désactivée :
    // l'appelant n'a pas à découvrir quels slugs existent.
    return res.status(404).json({ success: false, message: 'Source de réception inconnue' });
  }

  const corpsBrut = (req as any).rawBody as Buffer | undefined;
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const signatureOk = signatureValide(corpsBrut, signature, source.secret);

  if (!signatureOk) {
    await journaliser({
      sourceId: source.id,
      externalId: null,
      payload: req.body,
      signatureOk: false,
      status: 'rejected',
      error: 'Signature absente ou invalide',
    });
    await logService.warning('api', `Demande de manifestation refusée : signature invalide (${source.name})`);
    return res.status(401).json({ success: false, message: 'Signature absente ou invalide' });
  }

  try {
    const payload = req.body;
    const { correspondance } = resoudreCorrespondance(
      payload,
      lireJson<CorrespondanceIntake | null>(source.field_mapping, null)
    );
    const { champs, manquants } = extraireManifestation(payload, correspondance);
    const externalId = champs.external_id ? String(champs.external_id) : null;

    // La dernière charge utile est conservée : l'écran de correspondance propose
    // les chemins réellement reçus plutôt que de les faire deviner.
    await db.execute(
      `UPDATE manifestation_intake_sources
       SET last_payload = ?, last_received_at = ?, last_status = ?, updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(payload ?? null),
        new Date().toISOString(),
        manquants.length > 0 ? 'rejected' : 'accepted',
        new Date().toISOString(),
        source.id,
      ]
    );

    if (manquants.length > 0) {
      const message = `Champs obligatoires non renseignés : ${manquants.map((m) => m.libelle).join(', ')}`;
      await journaliser({
        sourceId: source.id,
        externalId,
        payload,
        signatureOk: true,
        status: 'rejected',
        error: message,
      });
      return res.status(422).json({ success: false, message, champs_attendus: CHAMPS_INTAKE });
    }

    // Idempotence : un formulaire qui réessaie après un délai réseau ne doit pas
    // créer deux manifestations et réserver deux fois le matériel.
    if (externalId) {
      const deja = await db.queryOne(
        `SELECT manifestation_id FROM manifestation_intake_requests
         WHERE external_id = ? AND status = 'accepted' AND manifestation_id IS NOT NULL`,
        [externalId]
      );
      if (deja) {
        await journaliser({
          sourceId: source.id,
          externalId,
          payload,
          signatureOk: true,
          status: 'duplicate',
          manifestationId: deja.manifestation_id,
        });
        return res.status(200).json({
          success: true,
          message: 'Demande déjà reçue',
          data: { id: deja.manifestation_id, duplicate: true },
        });
      }
    }

    const materiels = extraireMateriels(
      payload,
      lireJson<CorrespondanceMateriel | null>(source.material_mapping, null)
    );

    const apparies: Array<{ source: 'stock' | 'parc'; id: number; quantite: number }> = [];
    const nonApparies: Array<{ libelle: string; quantite: number }> = [];
    for (const ligne of materiels) {
      const article = await apparierMateriel(ligne.libelle);
      if (article) apparies.push({ source: article.source, id: article.id, quantite: ligne.quantite });
      else nonApparies.push(ligne);
    }

    const maintenant = new Date().toISOString();
    const creation = await db.execute(
      `INSERT INTO manifestations
         (title, date_start, date_end, start_time, end_time, expected_people,
          contact_name, contact_phone, contact_email, delivery_address, delivery_date,
          recovery_date, notes_interior, notes_exterior, status, created_by,
          intake_unmatched, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`,
      [
        champs.title,
        champs.date_start,
        champs.date_end ?? null,
        champs.start_time ?? null,
        champs.end_time ?? null,
        champs.expected_people ?? 0,
        champs.contact_name ?? '',
        champs.contact_phone ?? '',
        champs.contact_email ?? '',
        champs.delivery_address ?? '',
        champs.delivery_date ?? null,
        champs.recovery_date ?? null,
        champs.notes_interior ?? '',
        champs.notes_exterior ?? '',
        nonApparies.length > 0 ? JSON.stringify(nonApparies) : null,
        maintenant,
        maintenant,
      ]
    );

    const manifestationId = creation.lastInsertRowid;

    // Chaque ligne retourne dans la table dont elle vient : le stock compte des quantités
    // anonymes, le parc engage des exemplaires, des lots et des prestations. Tout ranger dans
    // `manifestation_materials` aurait fait porter à un identifiant de stock un numéro d'objet
    // du parc — et réservé, au hasard des identifiants, un tout autre matériel.
    for (const ligne of apparies) {
      if (ligne.source === 'parc') {
        await db.execute(
          `INSERT INTO manifestation_items (manifestation_id, object_id, quantity)
           VALUES (?, ?, ?)`,
          [manifestationId, ligne.id, ligne.quantite]
        );
      } else {
        await db.execute(
          `INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested)
           VALUES (?, ?, ?)`,
          [manifestationId, ligne.id, ligne.quantite]
        );
      }
    }

    const journalId = await journaliser({
      sourceId: source.id,
      externalId,
      payload,
      signatureOk: true,
      status: 'accepted',
      manifestationId,
    });
    await db.execute('UPDATE manifestations SET intake_request_id = ? WHERE id = ?', [
      journalId,
      manifestationId,
    ]);

    const resume = nonApparies.length
      ? `Reçue de « ${source.name} » — ${apparies.length} article(s) rattaché(s), ${nonApparies.length} à rattacher`
      : `Reçue de « ${source.name} » — ${apparies.length} article(s) rattaché(s)`;
    await consignerHistorique(manifestationId, undefined, 'Demande reçue', {
      toStatus: 'pending',
      comment: resume,
    });

    // Les services concernés sont sollicités dès la réception, et chacun reçoit
    // sa part du dossier déjà remplie. Attendre qu'un agent ouvre la demande
    // pour prévenir le service d'urbanisme lui ferait perdre les jours qui
    // comptent : un arrêté de débit de boissons ne s'instruit pas la veille.
    const sollicites = await creerApprobationsManquantes(manifestationId);
    produireEtNotifier(manifestationId, String(champs.title), sollicites);
    await logService.info('api', `Demande de manifestation reçue : ${champs.title}`, {
      source: source.name,
      manifestationId,
    });
    notifierWebhooks('manifestation.received', {
      id: manifestationId,
      title: champs.title,
      source: source.name,
      unmatched: nonApparies,
    });

    res.status(202).json({
      success: true,
      data: {
        id: manifestationId,
        status: 'pending',
        materials_matched: apparies.length,
        materials_unmatched: nonApparies,
      },
    });
  } catch (error: any) {
    await journaliser({
      sourceId: source.id,
      externalId: null,
      payload: req.body,
      signatureOk: true,
      status: 'rejected',
      error: error.message,
    });
    await logService.error('api', `Demande de manifestation non enregistrée : ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
