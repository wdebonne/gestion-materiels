import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import {
  enregistrerConfiguration,
  explorerDossier,
  lireConfiguration,
  lireFichier,
  normaliserChemin,
  normaliserUrl,
  verifierConfiguration,
  type ConfigurationNextcloud,
} from '../services/webdav.service';

/**
 * Connexion au Nextcloud de la commune.
 *
 * La configuration vivait sous `/api/manifestations/export`, où elle avait été
 * écrite : c'est le dépôt du suivi qui l'avait rendue nécessaire. Elle sert
 * depuis aux modèles de document, et servira à tout ce qui se range dans un
 * dossier partagé — elle n'appartient plus aux manifestations, et l'écran qui la
 * règle n'a pas à se chercher dans un onglet d'export.
 *
 * L'exploration n'est pas un confort : un chemin se recopie à la main dans les
 * profils comme dans les modèles, et le dépôt étant silencieux par construction,
 * une faute de frappe ne se voit qu'au fichier qu'on ne trouve jamais.
 */
const router = Router();

/** Le mot de passe d'application ne ressort jamais. */
router.get('/', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
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

router.put('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { url, username, password, folder } = req.body;
    if (!url?.trim() || !username?.trim()) {
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
      url: normaliserUrl(String(url), String(username)),
      username: String(username).trim(),
      password: motDePasse,
      folder: normaliserChemin(folder) || 'Manifestations',
    };

    await enregistrerConfiguration(config);
    await logService.success('api', 'Configuration Nextcloud enregistrée', {}, { userId: req.user?.userId });

    // L'adresse complétée est renvoyée : l'écran affiche ce qui est réellement
    // enregistré, au lieu de laisser croire que la saisie a été gardée telle quelle.
    res.json({ success: true, data: { url: config.url, folder: config.folder } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Vérifie la configuration en déposant réellement un fichier témoin.
 *
 * Valider seulement la forme des champs laisserait croire que tout est branché —
 * c'est le défaut des écrans qui « testent » sans rien prouver.
 */
router.post('/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { url, username, password, folder } = req.body;
    const existante = await lireConfiguration();
    const compte = (username ?? existante?.username ?? '').trim();

    const config: ConfigurationNextcloud = {
      url: url?.trim() ? normaliserUrl(String(url), compte) : existante?.url ?? '',
      username: compte,
      password: password || existante?.password || '',
      folder: normaliserChemin(folder) || existante?.folder || 'Manifestations',
    };

    if (!config.url || !config.username || !config.password) {
      return res.status(400).json({ success: false, message: 'Configuration incomplète' });
    }

    const resultat = await verifierConfiguration(config);
    res.status(resultat.success ? 200 : 502).json({
      success: resultat.success,
      message: resultat.message,
      data: { url: config.url },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Contenu d'un dossier.
 *
 * Un serveur injoignable ou des identifiants refusés ne sont pas une erreur de
 * l'application : `502` et la phrase du service, qui dit quoi corriger.
 */
router.get('/browse', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await explorerDossier(String(req.query.path ?? ''));
    if (!resultat.success) {
      return res.status(502).json({ success: false, message: resultat.error });
    }

    res.json({ success: true, data: { chemin: resultat.chemin, entrees: resultat.entrees } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Télécharge un fichier distant.
 *
 * Un lien direct vers Nextcloud demanderait de s'y connecter à son tour ; ici
 * c'est le compte de service qui lit, et l'administrateur voit le fichier qu'il
 * vient de désigner — la seule façon de vérifier qu'un dépôt contient bien ce
 * qu'on croit.
 */
router.get('/download', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const chemin = normaliserChemin(String(req.query.path ?? ''));
    if (!chemin) return res.status(400).json({ success: false, message: 'Chemin requis' });

    const resultat = await lireFichier(chemin);
    if (!resultat.success || !resultat.contenu) {
      return res.status(502).json({ success: false, message: resultat.error });
    }

    const nom = chemin.split('/').pop() ?? 'fichier';
    res.setHeader('Content-Type', 'application/octet-stream');
    // `filename*` porte les accents : « Fête.xlsx » arrive intact, et la forme
    // simple reste là pour les navigateurs qui l'ignorent.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nom.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nom)}`
    );
    res.send(resultat.contenu);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
