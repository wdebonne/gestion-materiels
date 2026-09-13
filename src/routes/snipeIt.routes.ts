import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import {
  analyser,
  appliquer,
  configEnregistree,
  verifierConnexion,
  type ChoixImport,
  type PlanImport,
} from '../services/snipeIt.service';

/**
 * Reprise d'un inventaire Snipe-IT.
 *
 * Tout est réservé à l'administrateur, pour deux raisons distinctes : ces
 * routes manipulent un **jeton d'API** vers un système tiers, et elles créent
 * du matériel en masse. Ni l'un ni l'autre n'est du ressort d'un superviseur,
 * qui gère un parc existant.
 *
 * Le jeton n'est jamais rendu au client. `GET /config` dit qu'il existe et
 * montre ses quatre derniers caractères — de quoi reconnaître lequel est en
 * place sans permettre de le réutiliser ailleurs. C'est la même retenue que
 * pour le mot de passe SMTP.
 */

const router = Router();

router.use(authenticateToken, requireAdmin);

/** Empreinte lisible d'un secret, pour l'identifier sans le divulguer. */
function empreinte(jeton: string): string {
  const propre = String(jeton ?? '');
  return propre.length <= 4 ? '••••' : `••••${propre.slice(-4)}`;
}

// ======================== CONFIGURATION ========================

router.get('/config', async (_req: AuthRequest, res: Response) => {
  try {
    const ligne = await db.queryOne<{
      id: number;
      base_url: string;
      token: string;
      last_import_at: string | null;
    }>('SELECT id, base_url, token, last_import_at FROM snipeit_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

    res.json({
      success: true,
      data: ligne
        ? {
            configure: true,
            baseUrl: ligne.base_url,
            jeton: empreinte(ligne.token),
            dernierImport: ligne.last_import_at,
          }
        : { configure: false, baseUrl: '', jeton: '', dernierImport: null },
    });
  } catch (error) {
    console.error('Erreur config Snipe-IT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/config', async (req: AuthRequest, res: Response) => {
  try {
    const baseUrl = String(req.body?.baseUrl ?? '').trim();
    const jeton = String(req.body?.token ?? '').trim();

    if (!baseUrl) {
      res.status(400).json({ success: false, message: "L'adresse de l'instance est obligatoire" });
      return;
    }

    const existant = await db.queryOne<{ id: number; token: string }>(
      'SELECT id, token FROM snipeit_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );

    // Un jeton vide à la modification veut dire « garde celui en place » :
    // l'écran ne l'affiche pas, il ne peut donc pas le renvoyer, et exiger sa
    // ressaisie pour corriger une faute de frappe dans l'adresse serait absurde.
    const tokenFinal = jeton || existant?.token;
    if (!tokenFinal) {
      res.status(400).json({ success: false, message: "Le jeton d'API est obligatoire" });
      return;
    }

    if (existant) {
      await db.execute('UPDATE snipeit_config SET base_url = ?, token = ? WHERE id = ?', [
        baseUrl,
        tokenFinal,
        existant.id,
      ]);
    } else {
      await db.execute('INSERT INTO snipeit_config (base_url, token) VALUES (?, ?)', [
        baseUrl,
        tokenFinal,
      ]);
    }

    await logService.log({
      level: 'info',
      category: 'system',
      message: `Connexion Snipe-IT configurée (${baseUrl})`,
      userId: req.user!.userId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur config Snipe-IT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.post('/tester', async (req: AuthRequest, res: Response) => {
  try {
    // On teste ce que l'écran a sous les yeux quand il l'envoie, et la
    // configuration en base sinon : vérifier autre chose que ce qu'on
    // s'apprête à enregistrer ne prouverait rien.
    const baseUrl = String(req.body?.baseUrl ?? '').trim();
    const jeton = String(req.body?.token ?? '').trim();

    const enregistree = await configEnregistree();
    const config = {
      baseUrl: baseUrl || enregistree?.baseUrl || '',
      token: jeton || enregistree?.token || '',
    };

    if (!config.baseUrl || !config.token) {
      res.status(400).json({ success: false, message: 'Adresse et jeton requis' });
      return;
    }

    res.json({ success: true, data: await verifierConnexion(config) });
  } catch (error) {
    console.error('Erreur test Snipe-IT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ======================== ANALYSE ========================

/**
 * Lit Snipe-IT et rend le plan, sans rien écrire.
 *
 * Le plan revient au client, qui le renverra tel quel — corrigé — à l'import.
 * C'est ce qui garantit que ce qui a été montré est ce qui sera écrit, même si
 * l'inventaire distant change entre-temps.
 */
router.post('/analyser', async (_req: AuthRequest, res: Response) => {
  try {
    const config = await configEnregistree();
    if (!config) {
      res.status(400).json({ success: false, message: 'Aucune connexion Snipe-IT configurée' });
      return;
    }

    res.json({ success: true, data: await analyser(config) });
  } catch (error: any) {
    console.error('Erreur analyse Snipe-IT:', error);
    res.status(502).json({
      success: false,
      message: error?.message ?? "Lecture de Snipe-IT impossible",
    });
  }
});

// ======================== IMPORT ========================

router.post('/importer', async (req: AuthRequest, res: Response) => {
  try {
    const plan = req.body?.plan as PlanImport | undefined;
    const choix = req.body?.choix as ChoixImport | undefined;

    if (!plan || !Array.isArray(plan.cles) || !Array.isArray(plan.trousseaux)) {
      res.status(400).json({ success: false, message: 'Plan d\'import absent ou mal formé' });
      return;
    }
    if (!choix || !Number(choix.categoryId)) {
      res.status(400).json({
        success: false,
        message: 'La catégorie de destination est obligatoire',
      });
      return;
    }

    const categorie = await db.queryOne('SELECT id FROM categories WHERE id = ?', [
      choix.categoryId,
    ]);
    if (!categorie) {
      res.status(400).json({ success: false, message: 'Catégorie introuvable' });
      return;
    }

    const resultat = await appliquer(plan, choix, req.user!.userId);

    await db.execute(
      "UPDATE snipeit_config SET last_import_at = ? WHERE is_active = 1",
      [new Date().toISOString()]
    );

    await logService.log({
      level: 'success',
      category: 'system',
      message:
        `Import Snipe-IT : ${resultat.clesCreees} clé(s) et ${resultat.trousseauxCrees} trousseau(x) créés, ` +
        `${resultat.clesMisesAJour + resultat.trousseauxMisAJour} mis à jour`,
      userId: req.user!.userId,
    });

    res.json({ success: true, data: resultat });
  } catch (error: any) {
    console.error('Erreur import Snipe-IT:', error);
    res.status(500).json({ success: false, message: error?.message ?? 'Erreur serveur' });
  }
});

export default router;
