import { Router, Response } from 'express';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.middleware';
import { jwtRotationService } from '../services/jwtRotation.service';
import { logService } from '../services/log.service';

const router = Router();

// Toutes les routes nécessitent l'authentification admin
router.use(authenticateToken, requireAdmin);

/**
 * GET /api/security/jwt/status - Obtenir le statut de la rotation JWT
 */
router.get('/jwt/status', async (req: AuthRequest, res: Response) => {
  try {
    const report = await jwtRotationService.generateSecurityReport();
    res.json({ success: true, ...report });
  } catch (error: any) {
    console.error('Erreur récupération statut JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * GET /api/security/jwt/settings - Obtenir les paramètres de rotation
 */
router.get('/jwt/settings', async (req: AuthRequest, res: Response) => {
  try {
    const settings = jwtRotationService.getSettings();
    res.json({ success: true, settings });
  } catch (error: any) {
    console.error('Erreur récupération paramètres JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * PUT /api/security/jwt/settings - Mettre à jour les paramètres de rotation
 */
router.put('/jwt/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { rotationIntervalDays, gracePeriodHours, autoRotate } = req.body;

    await jwtRotationService.updateSettings({
      rotationIntervalDays,
      gracePeriodHours,
      autoRotate
    });

    await logService.info('security', 'Paramètres de rotation JWT modifiés', {
      rotationIntervalDays,
      gracePeriodHours,
      autoRotate
    }, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Paramètres mis à jour' });
  } catch (error: any) {
    console.error('Erreur mise à jour paramètres JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * POST /api/security/jwt/rotate - Effectuer une rotation manuelle
 */
router.post('/jwt/rotate', async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body;
    const result = await jwtRotationService.rotateSecret(req.user?.userId, reason || 'Rotation manuelle par admin');

    if (result.success) {
      // Ne pas renvoyer le nouveau secret dans la réponse API pour des raisons de sécurité
      // Il sera uniquement logué côté serveur
      res.json({ 
        success: true, 
        message: result.message,
        note: 'Le nouveau secret a été généré. Consultez les logs serveur et mettez à jour votre fichier .env'
      });
    } else {
      res.status(500).json({ success: false, message: result.message });
    }
  } catch (error: any) {
    console.error('Erreur rotation JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * GET /api/security/jwt/history - Obtenir l'historique des rotations
 */
router.get('/jwt/history', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const history = await jwtRotationService.getRotationHistory(limit);
    res.json({ success: true, history });
  } catch (error: any) {
    console.error('Erreur récupération historique JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * POST /api/security/jwt/cleanup - Nettoyer les anciens secrets
 */
router.post('/jwt/cleanup', async (req: AuthRequest, res: Response) => {
  try {
    const deletedCount = await jwtRotationService.cleanupExpiredSecrets();
    res.json({ success: true, deletedCount, message: `${deletedCount} ancien(s) secret(s) supprimé(s)` });
  } catch (error: any) {
    console.error('Erreur nettoyage JWT:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
