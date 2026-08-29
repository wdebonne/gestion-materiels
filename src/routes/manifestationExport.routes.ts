import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireSupervisor } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import {
  CHAMPS_EXPORT,
  TYPE_MIME_XLSX,
  genererClasseur,
  type ColonneProfil,
  type FiltresExport,
} from '../services/manifestationExport.service';
import {
  deposerFichier,
  lireConfiguration,
  verifierConfiguration,
  type ConfigurationNextcloud,
} from '../services/webdav.service';

/**
 * Export des manifestations, et dépôt sur Nextcloud.
 *
 * Monté sur `/api/manifestations/export`, **avant** le routeur des
 * manifestations pour que `/export/...` ne soit pas confondu avec un
 * identifiant — la leçon déjà apprise avec `/intake/sources`.
 *
 * Le sens est unique : l'application reste la source de vérité, le fichier
 * déposé sert à consulter et à annoter à côté. Une synchronisation
 * bidirectionnelle demanderait des verrous et une détection de conflits, et
 * permettrait surtout à deux personnes de contredire la base.
 */

const router = Router();

function lireJson<T>(brut: unknown, defaut: T): T {
  if (!brut) return defaut;
  try {
    return typeof brut === 'string' ? (JSON.parse(brut) as T) : (brut as T);
  } catch {
    return defaut;
  }
}

/** Chemin distant d'un profil, avec un repli lisible. */
function cheminDistant(profil: any, nomFichier: string): string {
  const dossier = (profil.remote_path || 'Manifestations').replace(/^\/+|\/+$/g, '');
  return `${dossier}/${nomFichier}`;
}

/** Note le résultat du dernier envoi : un dépôt raté doit se voir. */
async function noterResultat(
  profilId: number | string,
  status: 'ok' | 'echec',
  erreur?: string | null
): Promise<void> {
  await db.execute(
    `UPDATE manifestation_export_profiles
     SET last_export_at = ?, last_status = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [new Date().toISOString(), status, erreur ?? null, new Date().toISOString(), profilId]
  );
}

// ======================== CHAMPS DISPONIBLES ========================

/** Colonnes proposées à la configuration d'un profil. */
router.get('/fields', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: CHAMPS_EXPORT });
});

// ======================== PROFILS ========================

router.get('/profiles', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  try {
    const profils = await db.query(
      'SELECT * FROM manifestation_export_profiles ORDER BY name'
    );
    res.json({
      success: true,
      data: profils.map((p: any) => ({
        ...p,
        columns: lireJson<ColonneProfil[]>(p.columns, []),
        filters: lireJson<FiltresExport>(p.filters, {}),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/profiles', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, columns, filters, destination, remote_path, auto_export } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Le nom est requis' });
    }
    if (destination === 'webdav' && !(await lireConfiguration())) {
      return res.status(400).json({
        success: false,
        message: "Configurez d'abord Nextcloud (Paramètres › Nextcloud) avant de déposer un export",
      });
    }

    const maintenant = new Date().toISOString();
    const resultat = await db.execute(
      `INSERT INTO manifestation_export_profiles
         (name, columns, filters, destination, remote_path, auto_export, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        name.trim(),
        JSON.stringify(columns ?? []),
        JSON.stringify(filters ?? {}),
        destination === 'webdav' ? 'webdav' : 'download',
        remote_path?.trim() || 'Manifestations',
        auto_export ? 1 : 0,
        maintenant,
        maintenant,
      ]
    );

    await logService.success('api', `Profil d'export créé : ${name}`, {}, { userId: req.user?.userId });
    res.status(201).json({ success: true, data: { id: resultat.lastInsertRowid } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/profiles/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, columns, filters, destination, remote_path, auto_export, is_active } = req.body;
    const resultat = await db.execute(
      `UPDATE manifestation_export_profiles
       SET name = ?, columns = ?, filters = ?, destination = ?, remote_path = ?,
           auto_export = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      [
        name,
        JSON.stringify(columns ?? []),
        JSON.stringify(filters ?? {}),
        destination === 'webdav' ? 'webdav' : 'download',
        remote_path?.trim() || 'Manifestations',
        auto_export ? 1 : 0,
        is_active === false ? 0 : 1,
        new Date().toISOString(),
        req.params.id,
      ]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Profil non trouvé' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/profiles/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await db.execute(
      'DELETE FROM manifestation_export_profiles WHERE id = ?',
      [req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Profil non trouvé' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== GÉNÉRATION ========================

/**
 * Télécharge un export, avec ou sans profil.
 *
 * Sans `profile`, toutes les colonnes sortent dans l'ordre de référence : c'est
 * ce qu'on veut la première fois, avant d'avoir réglé quoi que ce soit.
 */
router.get('/', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { profile, status, date_from, date_to, archived } = req.query;

    let colonnes: ColonneProfil[] | null = null;
    let filtres: FiltresExport = {
      status: status ? String(status) : undefined,
      date_from: date_from ? String(date_from) : undefined,
      date_to: date_to ? String(date_to) : undefined,
      archived: archived === 'true',
    };

    if (profile) {
      const profil = await db.queryOne(
        'SELECT * FROM manifestation_export_profiles WHERE id = ?',
        [profile]
      );
      if (!profil) return res.status(404).json({ success: false, message: 'Profil non trouvé' });

      colonnes = lireJson<ColonneProfil[]>(profil.columns, []);
      filtres = { ...lireJson<FiltresExport>(profil.filters, {}), ...filtres };
    }

    const { contenu, nomFichier } = await genererClasseur(colonnes, filtres);

    res.setHeader('Content-Type', TYPE_MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename=${nomFichier}`);
    res.send(contenu);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Produit l'export d'un profil et le dépose sur Nextcloud.
 *
 * Attendu ici, contrairement au dépôt automatique : l'administrateur qui appuie
 * sur « Déposer maintenant » veut savoir si c'est passé.
 */
router.post('/profiles/:id/run', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const profil = await db.queryOne(
      'SELECT * FROM manifestation_export_profiles WHERE id = ?',
      [req.params.id]
    );
    if (!profil) return res.status(404).json({ success: false, message: 'Profil non trouvé' });

    const { contenu, lignes, nomFichier } = await genererClasseur(
      lireJson<ColonneProfil[]>(profil.columns, []),
      lireJson<FiltresExport>(profil.filters, {})
    );

    if (profil.destination !== 'webdav') {
      res.setHeader('Content-Type', TYPE_MIME_XLSX);
      res.setHeader('Content-Disposition', `attachment; filename=${nomFichier}`);
      return res.send(contenu);
    }

    const chemin = cheminDistant(profil, nomFichier);
    const depot = await deposerFichier(chemin, contenu, TYPE_MIME_XLSX);

    await noterResultat(profil.id, depot.success ? 'ok' : 'echec', depot.error);

    if (!depot.success) {
      return res.status(502).json({ success: false, message: depot.error });
    }

    await logService.success('api', `Export déposé sur Nextcloud : ${chemin}`, { lignes }, { userId: req.user?.userId });
    res.json({ success: true, data: { chemin, lignes } });
  } catch (error: any) {
    await noterResultat(req.params.id, 'echec', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== CONFIGURATION NEXTCLOUD ========================

/** Le mot de passe d'application ne ressort jamais. */
router.get('/nextcloud', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfiguration();
    res.json({
      success: true,
      data: config
        ? { url: config.url, username: config.username, folder: config.folder ?? 'Manifestations', configured: true }
        : { url: '', username: '', folder: 'Manifestations', configured: false },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/nextcloud', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { url, username, password, folder } = req.body;
    if (!url || !username) {
      return res.status(400).json({ success: false, message: 'Adresse et identifiant requis' });
    }

    // Un mot de passe vide à la modification veut dire « garde celui-ci » :
    // l'écran ne le réaffiche pas, il ne peut donc pas le renvoyer.
    const existante = await lireConfiguration();
    const motDePasse = password || existante?.password;
    if (!motDePasse) {
      return res.status(400).json({ success: false, message: "Mot de passe d'application requis" });
    }

    const config: ConfigurationNextcloud = {
      url: String(url).trim(),
      username: String(username).trim(),
      password: motDePasse,
      folder: folder?.trim() || 'Manifestations',
    };

    const maintenant = new Date().toISOString();
    const existant = await db.queryOne(
      "SELECT id FROM settings WHERE setting_key = 'nextcloud_config'"
    );
    if (existant) {
      await db.execute(
        'UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?',
        [JSON.stringify(config), maintenant, 'nextcloud_config']
      );
    } else {
      await db.execute(
        `INSERT INTO settings (setting_key, setting_value, setting_type, description, created_at, updated_at)
         VALUES (?, ?, 'json', ?, ?, ?)`,
        [
          'nextcloud_config',
          JSON.stringify(config),
          'Dépôt WebDAV des exports de manifestations',
          maintenant,
          maintenant,
        ]
      );
    }

    await logService.success('api', 'Configuration Nextcloud enregistrée', {}, { userId: req.user?.userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Vérifie la configuration en déposant réellement un fichier témoin.
 *
 * Valider seulement la forme des champs laisserait croire que tout est branché —
 * c'est le défaut des écrans SSO de ce projet, qui « testent » sans rien prouver.
 */
router.post('/nextcloud/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { url, username, password, folder } = req.body;
    const existante = await lireConfiguration();

    const config: ConfigurationNextcloud = {
      url: (url || existante?.url || '').trim(),
      username: (username || existante?.username || '').trim(),
      password: password || existante?.password || '',
      folder: folder?.trim() || existante?.folder || 'Manifestations',
    };

    if (!config.url || !config.username || !config.password) {
      return res.status(400).json({ success: false, message: 'Configuration incomplète' });
    }

    const resultat = await verifierConfiguration(config);
    res.status(resultat.success ? 200 : 502).json({ success: resultat.success, message: resultat.message });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
