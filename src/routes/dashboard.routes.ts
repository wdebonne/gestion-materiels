import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/dashboard/stats - Récupérer les statistiques du tableau de bord
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Nombre de catégories
    const categoriesResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM categories'
    );
    const categoriesCount = categoriesResult?.count || 0;

    // Nombre de matériels
    const objectsResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM objects'
    );
    const objectsCount = objectsResult?.count || 0;

    // Nombre d'alertes actives (non lues et non rejetées)
    const alertsResult = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM alerts WHERE is_dismissed = 0"
    );
    const activeAlertsCount = alertsResult?.count || 0;

    // Nombre d'événements ce mois
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    
    const eventsResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM calendar_events WHERE start_date >= ? AND start_date <= ?',
      [startOfMonth, endOfMonth]
    );
    const eventsThisMonth = eventsResult?.count || 0;

    // Valeur totale du parc
    const valueResult = await db.queryOne<{ total: number }>(
      'SELECT COALESCE(SUM(purchase_price), 0) as total FROM objects'
    );
    const totalValue = valueResult?.total || 0;

    // Nombre de sous-catégories
    const subcategoriesResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM subcategories'
    );
    const subcategoriesCount = subcategoriesResult?.count || 0;

    // Carburant consommé ce mois
    const fuelResult = await db.queryOne<{ total: number }>(
      'SELECT COALESCE(SUM(quantity), 0) as total FROM fuel_entries WHERE entry_date >= ? AND entry_date <= ?',
      [startOfMonth, endOfMonth]
    );
    const fuelThisMonth = fuelResult?.total || 0;

    // Contrôles techniques à venir (expiry_date dans les 30 prochains jours)
    const today = now.toISOString().split('T')[0];
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const controlsResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM technical_controls WHERE expiry_date >= ? AND expiry_date <= ?',
      [today, in30Days]
    );
    const upcomingControls = controlsResult?.count || 0;

    // Entretiens à prévoir (next_date dans les 30 prochains jours)
    const maintenanceResult = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM maintenances WHERE next_date >= ? AND next_date <= ?',
      [today, in30Days]
    );
    const upcomingMaintenance = maintenanceResult?.count || 0;

    res.json({
      success: true,
      categoriesCount,
      objectsCount,
      activeAlertsCount,
      eventsThisMonth,
      subcategoriesCount,
      totalValue,
      fuelThisMonth,
      upcomingControls,
      upcomingMaintenance
    });
  } catch (error: any) {
    console.error('Erreur dashboard stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
