import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, getAccessibleCategoryIds } from '../middleware/auth.middleware';

const router = Router();

// GET /api/dashboard/stats - Récupérer les statistiques du tableau de bord
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Récupérer les catégories accessibles pour filtrer les stats
    const accessibleIds = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);

    // Construire les clauses de filtrage
    let categoryFilter = '';
    let objectFilter = '';
    let objectSubFilter = '';
    const categoryParams: any[] = [];
    const objectParams: any[] = [];
    const objectSubParams: any[] = [];

    if (accessibleIds !== null) {
      if (accessibleIds.length === 0) {
        // Aucun accès — retourner des stats à zéro
        return res.json({
          success: true,
          categoriesCount: 0,
          objectsCount: 0,
          activeAlertsCount: 0,
          eventsThisMonth: 0,
          subcategoriesCount: 0,
          totalValue: 0,
          fuelThisMonth: 0,
          upcomingControls: 0,
          upcomingMaintenance: 0
        });
      }
      const placeholders = accessibleIds.map(() => '?').join(',');
      categoryFilter = ` WHERE id IN (${placeholders})`;
      categoryParams.push(...accessibleIds);

      // Filtre pour les objets (catégorie directe ou via sous-catégorie)
      objectFilter = ` AND (o.category_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = o.subcategory_id AND sc.category_id IN (${placeholders})))`;
      objectParams.push(...accessibleIds, ...accessibleIds);

      objectSubFilter = ` AND (object_id IN (SELECT id FROM objects WHERE category_id IN (${placeholders}) OR subcategory_id IN (SELECT id FROM subcategories WHERE category_id IN (${placeholders}))))`;
      objectSubParams.push(...accessibleIds, ...accessibleIds);
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Exécuter toutes les requêtes en parallèle
    const [
      categoriesResult,
      objectsResult,
      alertsResult,
      eventsResult,
      valueResult,
      subcategoriesResult,
      fuelResult,
      controlsResult,
      maintenanceResult
    ] = await Promise.all([
      // Nombre de catégories
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM categories${categoryFilter}`,
        categoryParams
      ),
      // Nombre de matériels
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM objects o WHERE 1=1${objectFilter}`,
        objectParams
      ),
      // Nombre d'alertes actives (non rejetées)
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM alerts WHERE is_dismissed = 0${objectSubFilter}`,
        objectSubParams
      ),
      // Nombre d'événements ce mois
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM calendar_events WHERE start_date >= ? AND start_date <= ?${accessibleIds !== null ? ` AND (object_id IS NULL OR object_id IN (SELECT id FROM objects WHERE category_id IN (${accessibleIds.map(() => '?').join(',')}) OR subcategory_id IN (SELECT id FROM subcategories WHERE category_id IN (${accessibleIds.map(() => '?').join(',')}))))` : ''}`,
        [startOfMonth, endOfMonth, ...(accessibleIds !== null ? [...accessibleIds, ...accessibleIds] : [])]
      ),
      // Valeur totale du parc
      db.queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(purchase_price), 0) as total FROM objects o WHERE 1=1${objectFilter}`,
        objectParams
      ),
      // Nombre de sous-catégories
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM subcategories${accessibleIds !== null ? ` WHERE category_id IN (${accessibleIds.map(() => '?').join(',')})` : ''}`,
        accessibleIds !== null ? accessibleIds : []
      ),
      // Carburant consommé ce mois
      db.queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(quantity), 0) as total FROM fuel_entries WHERE entry_date >= ? AND entry_date <= ?${objectSubFilter}`,
        [startOfMonth, endOfMonth, ...objectSubParams]
      ),
      // Contrôles techniques à venir (30 jours)
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM technical_controls WHERE expiry_date >= ? AND expiry_date <= ?${objectSubFilter}`,
        [today, in30Days, ...objectSubParams]
      ),
      // Entretiens à prévoir (30 jours)
      db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM maintenances WHERE next_date >= ? AND next_date <= ?${objectSubFilter}`,
        [today, in30Days, ...objectSubParams]
      )
    ]);

    res.json({
      success: true,
      categoriesCount: categoriesResult?.count || 0,
      objectsCount: objectsResult?.count || 0,
      activeAlertsCount: alertsResult?.count || 0,
      eventsThisMonth: eventsResult?.count || 0,
      subcategoriesCount: subcategoriesResult?.count || 0,
      totalValue: valueResult?.total || 0,
      fuelThisMonth: fuelResult?.total || 0,
      upcomingControls: controlsResult?.count || 0,
      upcomingMaintenance: maintenanceResult?.count || 0
    });
  } catch (error: any) {
    console.error('Erreur dashboard stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
