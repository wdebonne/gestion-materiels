import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { ROLES, ROLE_LABELS } from '../config/roles';
import {
  EVENEMENTS_NOTIFICATION,
  enregistrerDefauts,
  enregistrerPreference,
  lireDefauts,
  preferencesDe,
} from '../services/notificationPreferences.service';

/**
 * Réglage des notifications : défauts de la collectivité, choix de chacun.
 *
 * Deux écrans, deux portées. L'administrateur dit qui reçoit quoi par défaut ;
 * chaque compte ajuste ensuite pour lui-même, sans toucher à ses collègues —
 * c'est précisément ce qui manquait, un agent noyé sous les messages ne pouvant
 * rien couper sans couper aussi son service.
 */

const router = Router();

/**
 * GET /events - Catalogue des événements notifiables.
 *
 * Servi au lieu d'être recopié dans l'interface : une liste tenue des deux côtés
 * finirait par diverger, et un événement à moitié déclaré serait proposé sans
 * jamais partir.
 */
router.get('/events', authenticateToken, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      events: EVENEMENTS_NOTIFICATION,
      roles: ROLES.map((role) => ({ role, label: ROLE_LABELS[role] })),
    },
  });
});

// ======================== DÉFAUTS DE LA COLLECTIVITÉ ========================

router.get('/defaults', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await lireDefauts() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/defaults', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await enregistrerDefauts(req.body?.defaults ?? {});
    await logService.success('user', 'Réglages de notification modifiés', {}, { userId: req.user?.userId });
    res.json({ success: true, data: await lireDefauts() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== CHOIX DE CHACUN ========================

/**
 * GET /preferences - Ce que le compte courant reçoit, et ce qu'il peut couper.
 *
 * Chaque événement porte son état effectif : un événement sans choix explicite
 * suit le réglage général, et l'écran doit pouvoir le dire plutôt que d'afficher
 * une case dont on ne sait pas si elle a été décochée ou jamais touchée.
 */
router.get('/preferences', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const choix = await preferencesDe(req.user!.userId);

    res.json({
      success: true,
      data: EVENEMENTS_NOTIFICATION.map((definition) => ({
        ...definition,
        /** `null` : aucun choix explicite, le réglage général s'applique. */
        choix: choix.has(definition.evenement) ? choix.get(definition.evenement) : null,
        actif: definition.engageant ? true : (choix.get(definition.evenement) ?? true),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/preferences', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { event, enabled } = req.body;
    if (typeof event !== 'string' || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Événement et état requis' });
    }

    const resultat = await enregistrerPreference(req.user!.userId, event, enabled);
    if (!resultat.ok) {
      return res.status(400).json({ success: false, message: resultat.message });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
