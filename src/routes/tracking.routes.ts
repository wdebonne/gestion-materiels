import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// Middleware pour vérifier les permissions de suivi
async function checkTrackingPermission(req: AuthRequest, res: Response, next: any) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    
    // Les admins ont toujours accès
    if (userRole === 'admin') {
      return next();
    }
    
    // Vérifier les permissions du module suivi
    const permission = await db.queryOne(
      `SELECT * FROM module_permissions WHERE module_name = 'tracking' AND role = ?`,
      [userRole]
    );
    
    if (!permission || !permission.can_view) {
      // Vérifier les permissions individuelles
      const userPerm = await db.queryOne(
        `SELECT * FROM user_module_permissions WHERE user_id = ? AND module_name = 'tracking'`,
        [userId]
      );
      
      if (!userPerm || !userPerm.can_view) {
        return res.status(403).json({ success: false, message: 'Accès non autorisé au module Suivi' });
      }
    }
    
    next();
  } catch (error) {
    console.error('Erreur vérification permission suivi:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
}

// Interface pour les filtres
interface TrackingFilters {
  startDate?: string;
  endDate?: string;
  categoryIds?: number[];
  subcategoryIds?: number[];
  objectIds?: number[];
  dataTypes?: ('fuel' | 'maintenance' | 'technical_control')[];
  maintenanceTypes?: string[];
  fuelTypes?: string[];
  compareStartDate?: string;
  compareEndDate?: string;
}

// GET /api/tracking/data - Récupérer les données de suivi
router.get('/data', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const filters: TrackingFilters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      categoryIds: req.query.categoryIds ? (req.query.categoryIds as string).split(',').map(Number) : undefined,
      subcategoryIds: req.query.subcategoryIds ? (req.query.subcategoryIds as string).split(',').map(Number) : undefined,
      objectIds: req.query.objectIds ? (req.query.objectIds as string).split(',').map(Number) : undefined,
      dataTypes: req.query.dataTypes ? (req.query.dataTypes as string).split(',') as any : ['fuel', 'maintenance', 'technical_control'],
      maintenanceTypes: req.query.maintenanceTypes ? (req.query.maintenanceTypes as string).split(',') : undefined,
      fuelTypes: req.query.fuelTypes ? (req.query.fuelTypes as string).split(',') : undefined,
      compareStartDate: req.query.compareStartDate as string,
      compareEndDate: req.query.compareEndDate as string,
    };

    const result: any = {
      fuel: [],
      maintenance: [],
      technicalControl: [],
      summary: {
        totalFuelCost: 0,
        totalFuelQuantity: 0,
        totalMaintenanceCost: 0,
        totalControlCost: 0,
        totalCost: 0,
        fuelEntryCount: 0,
        maintenanceCount: 0,
        controlCount: 0,
      },
      comparison: null,
    };

    // Construction des conditions WHERE communes
    let objectCondition = '';
    const objectParams: any[] = [];
    
    if (filters.objectIds?.length) {
      objectCondition = ` AND o.id IN (${filters.objectIds.map(() => '?').join(',')})`;
      objectParams.push(...filters.objectIds);
    } else if (filters.subcategoryIds?.length) {
      objectCondition = ` AND o.subcategory_id IN (${filters.subcategoryIds.map(() => '?').join(',')})`;
      objectParams.push(...filters.subcategoryIds);
    } else if (filters.categoryIds?.length) {
      objectCondition = ` AND o.category_id IN (${filters.categoryIds.map(() => '?').join(',')})`;
      objectParams.push(...filters.categoryIds);
    }

    // Récupérer les données de carburant
    if (filters.dataTypes?.includes('fuel')) {
      let fuelQuery = `
        SELECT f.*, o.name as object_name, o.reference, o.image as object_image,
               c.name as category_name, c.id as category_id,
               s.name as subcategory_name, s.id as subcategory_id
        FROM fuel_entries f
        JOIN objects o ON o.id = f.object_id
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories s ON s.id = o.subcategory_id
        WHERE 1=1
      `;
      const fuelParams: any[] = [];

      if (filters.startDate) {
        fuelQuery += ` AND f.entry_date >= ?`;
        fuelParams.push(filters.startDate);
      }
      if (filters.endDate) {
        fuelQuery += ` AND f.entry_date <= ?`;
        fuelParams.push(filters.endDate);
      }
      if (filters.fuelTypes?.length) {
        fuelQuery += ` AND f.fuel_type IN (${filters.fuelTypes.map(() => '?').join(',')})`;
        fuelParams.push(...filters.fuelTypes);
      }
      
      fuelQuery += objectCondition.replace(/o\./g, 'o.');
      fuelParams.push(...objectParams);
      
      fuelQuery += ' ORDER BY f.entry_date DESC';

      const fuelData = await db.query(fuelQuery, fuelParams);
      result.fuel = fuelData.map((f: any) => ({
        id: f.id,
        objectId: f.object_id,
        objectName: f.object_name,
        objectReference: f.reference,
        objectImage: f.object_image,
        categoryId: f.category_id,
        categoryName: f.category_name,
        subcategoryId: f.subcategory_id,
        subcategoryName: f.subcategory_name,
        date: f.entry_date,
        fuelType: f.fuel_type,
        quantity: parseFloat(f.quantity) || 0,
        unitPrice: parseFloat(f.unit_price) || 0,
        totalPrice: parseFloat(f.total_price) || 0,
        mileage: f.mileage,
        station: f.station,
        notes: f.notes,
        attachments: f.attachments ? JSON.parse(f.attachments) : [],
      }));

      result.summary.totalFuelCost = result.fuel.reduce((sum: number, f: any) => sum + f.totalPrice, 0);
      result.summary.totalFuelQuantity = result.fuel.reduce((sum: number, f: any) => sum + f.quantity, 0);
      result.summary.fuelEntryCount = result.fuel.length;
    }

    // Récupérer les données d'entretien
    if (filters.dataTypes?.includes('maintenance')) {
      let maintenanceQuery = `
        SELECT m.*, o.name as object_name, o.reference, o.image as object_image,
               c.name as category_name, c.id as category_id,
               s.name as subcategory_name, s.id as subcategory_id
        FROM maintenances m
        JOIN objects o ON o.id = m.object_id
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories s ON s.id = o.subcategory_id
        WHERE 1=1
      `;
      const maintenanceParams: any[] = [];

      if (filters.startDate) {
        maintenanceQuery += ` AND m.maintenance_date >= ?`;
        maintenanceParams.push(filters.startDate);
      }
      if (filters.endDate) {
        maintenanceQuery += ` AND m.maintenance_date <= ?`;
        maintenanceParams.push(filters.endDate);
      }
      if (filters.maintenanceTypes?.length) {
        maintenanceQuery += ` AND m.maintenance_type IN (${filters.maintenanceTypes.map(() => '?').join(',')})`;
        maintenanceParams.push(...filters.maintenanceTypes);
      }

      maintenanceQuery += objectCondition.replace(/o\./g, 'o.');
      maintenanceParams.push(...objectParams);
      
      maintenanceQuery += ' ORDER BY m.maintenance_date DESC';

      const maintenanceData = await db.query(maintenanceQuery, maintenanceParams);
      result.maintenance = maintenanceData.map((m: any) => ({
        id: m.id,
        objectId: m.object_id,
        objectName: m.object_name,
        objectReference: m.reference,
        objectImage: m.object_image,
        categoryId: m.category_id,
        categoryName: m.category_name,
        subcategoryId: m.subcategory_id,
        subcategoryName: m.subcategory_name,
        date: m.maintenance_date,
        type: m.maintenance_type,
        cost: parseFloat(m.cost) || 0,
        mileage: m.mileage,
        nextDate: m.next_date,
        nextMileage: m.next_mileage,
        provider: m.provider,
        notes: m.notes,
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
        document: m.document,
      }));

      result.summary.totalMaintenanceCost = result.maintenance.reduce((sum: number, m: any) => sum + m.cost, 0);
      result.summary.maintenanceCount = result.maintenance.length;
    }

    // Récupérer les données de contrôle technique
    if (filters.dataTypes?.includes('technical_control')) {
      let controlQuery = `
        SELECT tc.*, o.name as object_name, o.reference, o.image as object_image,
               c.name as category_name, c.id as category_id,
               s.name as subcategory_name, s.id as subcategory_id
        FROM technical_controls tc
        JOIN objects o ON o.id = tc.object_id
        LEFT JOIN categories c ON c.id = o.category_id
        LEFT JOIN subcategories s ON s.id = o.subcategory_id
        WHERE 1=1
      `;
      const controlParams: any[] = [];

      if (filters.startDate) {
        controlQuery += ` AND tc.control_date >= ?`;
        controlParams.push(filters.startDate);
      }
      if (filters.endDate) {
        controlQuery += ` AND tc.control_date <= ?`;
        controlParams.push(filters.endDate);
      }

      controlQuery += objectCondition.replace(/o\./g, 'o.');
      controlParams.push(...objectParams);
      
      controlQuery += ' ORDER BY tc.control_date DESC';

      const controlData = await db.query(controlQuery, controlParams);
      result.technicalControl = controlData.map((tc: any) => ({
        id: tc.id,
        objectId: tc.object_id,
        objectName: tc.object_name,
        objectReference: tc.reference,
        objectImage: tc.object_image,
        categoryId: tc.category_id,
        categoryName: tc.category_name,
        subcategoryId: tc.subcategory_id,
        subcategoryName: tc.subcategory_name,
        date: tc.control_date,
        expiryDate: tc.expiry_date,
        result: tc.result,
        centerName: tc.center_name,
        cost: parseFloat(tc.cost) || 0,
        mileage: tc.mileage,
        notes: tc.notes,
        attachments: tc.attachments ? JSON.parse(tc.attachments) : [],
        document: tc.document,
      }));

      result.summary.totalControlCost = result.technicalControl.reduce((sum: number, tc: any) => sum + tc.cost, 0);
      result.summary.controlCount = result.technicalControl.length;
    }

    // Calculer le coût total
    result.summary.totalCost = result.summary.totalFuelCost + result.summary.totalMaintenanceCost + result.summary.totalControlCost;

    // Comparaison de périodes si demandée
    if (filters.compareStartDate && filters.compareEndDate) {
      const compareResult: any = {
        fuel: [],
        maintenance: [],
        technicalControl: [],
        summary: {
          totalFuelCost: 0,
          totalFuelQuantity: 0,
          totalMaintenanceCost: 0,
          totalControlCost: 0,
          totalCost: 0,
        }
      };

      // Récupérer les données de comparaison pour le carburant
      if (filters.dataTypes?.includes('fuel')) {
        let compareFuelQuery = `
          SELECT SUM(CAST(total_price AS DECIMAL(10,2))) as total_cost, 
                 SUM(CAST(quantity AS DECIMAL(10,2))) as total_quantity,
                 COUNT(*) as entry_count
          FROM fuel_entries f
          JOIN objects o ON o.id = f.object_id
          WHERE f.entry_date >= ? AND f.entry_date <= ?
        `;
        const compareFuelParams = [filters.compareStartDate, filters.compareEndDate];
        
        if (filters.fuelTypes?.length) {
          compareFuelQuery += ` AND f.fuel_type IN (${filters.fuelTypes.map(() => '?').join(',')})`;
          compareFuelParams.push(...filters.fuelTypes);
        }
        compareFuelQuery += objectCondition;
        compareFuelParams.push(...objectParams);

        const compareFuel = await db.queryOne(compareFuelQuery, compareFuelParams);
        compareResult.summary.totalFuelCost = parseFloat(compareFuel?.total_cost) || 0;
        compareResult.summary.totalFuelQuantity = parseFloat(compareFuel?.total_quantity) || 0;
      }

      // Récupérer les données de comparaison pour la maintenance
      if (filters.dataTypes?.includes('maintenance')) {
        let compareMaintenanceQuery = `
          SELECT SUM(CAST(cost AS DECIMAL(10,2))) as total_cost,
                 COUNT(*) as entry_count
          FROM maintenances m
          JOIN objects o ON o.id = m.object_id
          WHERE m.maintenance_date >= ? AND m.maintenance_date <= ?
        `;
        const compareMaintenanceParams = [filters.compareStartDate, filters.compareEndDate];
        
        if (filters.maintenanceTypes?.length) {
          compareMaintenanceQuery += ` AND m.maintenance_type IN (${filters.maintenanceTypes.map(() => '?').join(',')})`;
          compareMaintenanceParams.push(...filters.maintenanceTypes);
        }
        compareMaintenanceQuery += objectCondition;
        compareMaintenanceParams.push(...objectParams);

        const compareMaintenance = await db.queryOne(compareMaintenanceQuery, compareMaintenanceParams);
        compareResult.summary.totalMaintenanceCost = parseFloat(compareMaintenance?.total_cost) || 0;
      }

      // Récupérer les données de comparaison pour le contrôle technique
      if (filters.dataTypes?.includes('technical_control')) {
        let compareControlQuery = `
          SELECT SUM(CAST(cost AS DECIMAL(10,2))) as total_cost,
                 COUNT(*) as entry_count
          FROM technical_controls tc
          JOIN objects o ON o.id = tc.object_id
          WHERE tc.control_date >= ? AND tc.control_date <= ?
        `;
        const compareControlParams = [filters.compareStartDate, filters.compareEndDate];
        compareControlQuery += objectCondition;
        compareControlParams.push(...objectParams);

        const compareControl = await db.queryOne(compareControlQuery, compareControlParams);
        compareResult.summary.totalControlCost = parseFloat(compareControl?.total_cost) || 0;
      }

      compareResult.summary.totalCost = 
        compareResult.summary.totalFuelCost + 
        compareResult.summary.totalMaintenanceCost + 
        compareResult.summary.totalControlCost;

      result.comparison = {
        period: { start: filters.compareStartDate, end: filters.compareEndDate },
        summary: compareResult.summary,
        difference: {
          totalFuelCost: result.summary.totalFuelCost - compareResult.summary.totalFuelCost,
          totalFuelQuantity: result.summary.totalFuelQuantity - compareResult.summary.totalFuelQuantity,
          totalMaintenanceCost: result.summary.totalMaintenanceCost - compareResult.summary.totalMaintenanceCost,
          totalControlCost: result.summary.totalControlCost - compareResult.summary.totalControlCost,
          totalCost: result.summary.totalCost - compareResult.summary.totalCost,
        },
        percentageChange: {
          totalFuelCost: compareResult.summary.totalFuelCost ? 
            ((result.summary.totalFuelCost - compareResult.summary.totalFuelCost) / compareResult.summary.totalFuelCost * 100).toFixed(1) : null,
          totalMaintenanceCost: compareResult.summary.totalMaintenanceCost ?
            ((result.summary.totalMaintenanceCost - compareResult.summary.totalMaintenanceCost) / compareResult.summary.totalMaintenanceCost * 100).toFixed(1) : null,
          totalControlCost: compareResult.summary.totalControlCost ?
            ((result.summary.totalControlCost - compareResult.summary.totalControlCost) / compareResult.summary.totalControlCost * 100).toFixed(1) : null,
          totalCost: compareResult.summary.totalCost ?
            ((result.summary.totalCost - compareResult.summary.totalCost) / compareResult.summary.totalCost * 100).toFixed(1) : null,
        }
      };
    }

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Erreur tracking data:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/tracking/charts - Données pour les graphiques
router.get('/charts', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, groupBy = 'month', categoryIds, subcategoryIds, objectIds, dataTypes } = req.query;
    
    const types = dataTypes ? (dataTypes as string).split(',') : ['fuel', 'maintenance', 'technical_control'];
    
    // Construction des conditions WHERE communes
    let objectCondition = '';
    const objectParams: any[] = [];
    
    if (objectIds) {
      const ids = (objectIds as string).split(',').map(Number);
      objectCondition = ` AND o.id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    } else if (subcategoryIds) {
      const ids = (subcategoryIds as string).split(',').map(Number);
      objectCondition = ` AND o.subcategory_id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    } else if (categoryIds) {
      const ids = (categoryIds as string).split(',').map(Number);
      objectCondition = ` AND o.category_id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    }

    const dateFormat = db.getType() === 'sqlite' 
      ? groupBy === 'year' ? "strftime('%Y', %s)" 
        : groupBy === 'week' ? "strftime('%Y-W%W', %s)"
        : "strftime('%Y-%m', %s)"
      : groupBy === 'year' ? "DATE_FORMAT(%s, '%Y')"
        : groupBy === 'week' ? "DATE_FORMAT(%s, '%Y-W%u')"
        : "DATE_FORMAT(%s, '%Y-%m')";

    const result: any = {
      fuelByPeriod: [],
      maintenanceByPeriod: [],
      controlByPeriod: [],
      fuelByType: [],
      maintenanceByType: [],
      costByCategory: [],
      costByObject: [],
    };

    // Carburant par période
    if (types.includes('fuel')) {
      const fuelDateFormat = dateFormat.replace('%s', 'f.entry_date');
      let fuelQuery = `
        SELECT ${fuelDateFormat} as period,
               SUM(CAST(total_price AS DECIMAL(10,2))) as total_cost,
               SUM(CAST(quantity AS DECIMAL(10,2))) as total_quantity,
               COUNT(*) as entry_count
        FROM fuel_entries f
        JOIN objects o ON o.id = f.object_id
        WHERE 1=1
      `;
      const fuelParams: any[] = [];

      if (startDate) {
        fuelQuery += ` AND f.entry_date >= ?`;
        fuelParams.push(startDate);
      }
      if (endDate) {
        fuelQuery += ` AND f.entry_date <= ?`;
        fuelParams.push(endDate);
      }
      fuelQuery += objectCondition;
      fuelParams.push(...objectParams);
      fuelQuery += ` GROUP BY period ORDER BY period`;

      result.fuelByPeriod = (await db.query(fuelQuery, fuelParams)).map((r: any) => ({
        period: r.period,
        cost: parseFloat(r.total_cost) || 0,
        quantity: parseFloat(r.total_quantity) || 0,
        count: r.entry_count
      }));

      // Carburant par type
      let fuelTypeQuery = `
        SELECT f.fuel_type,
               SUM(CAST(total_price AS DECIMAL(10,2))) as total_cost,
               SUM(CAST(quantity AS DECIMAL(10,2))) as total_quantity,
               COUNT(*) as entry_count
        FROM fuel_entries f
        JOIN objects o ON o.id = f.object_id
        WHERE 1=1
      `;
      const fuelTypeParams: any[] = [];

      if (startDate) {
        fuelTypeQuery += ` AND f.entry_date >= ?`;
        fuelTypeParams.push(startDate);
      }
      if (endDate) {
        fuelTypeQuery += ` AND f.entry_date <= ?`;
        fuelTypeParams.push(endDate);
      }
      fuelTypeQuery += objectCondition;
      fuelTypeParams.push(...objectParams);
      fuelTypeQuery += ` GROUP BY f.fuel_type`;

      result.fuelByType = (await db.query(fuelTypeQuery, fuelTypeParams)).map((r: any) => ({
        type: r.fuel_type,
        cost: parseFloat(r.total_cost) || 0,
        quantity: parseFloat(r.total_quantity) || 0,
        count: r.entry_count
      }));
    }

    // Maintenance par période
    if (types.includes('maintenance')) {
      const maintenanceDateFormat = dateFormat.replace('%s', 'm.maintenance_date');
      let maintenanceQuery = `
        SELECT ${maintenanceDateFormat} as period,
               SUM(CAST(cost AS DECIMAL(10,2))) as total_cost,
               COUNT(*) as entry_count
        FROM maintenances m
        JOIN objects o ON o.id = m.object_id
        WHERE 1=1
      `;
      const maintenanceParams: any[] = [];

      if (startDate) {
        maintenanceQuery += ` AND m.maintenance_date >= ?`;
        maintenanceParams.push(startDate);
      }
      if (endDate) {
        maintenanceQuery += ` AND m.maintenance_date <= ?`;
        maintenanceParams.push(endDate);
      }
      maintenanceQuery += objectCondition;
      maintenanceParams.push(...objectParams);
      maintenanceQuery += ` GROUP BY period ORDER BY period`;

      result.maintenanceByPeriod = (await db.query(maintenanceQuery, maintenanceParams)).map((r: any) => ({
        period: r.period,
        cost: parseFloat(r.total_cost) || 0,
        count: r.entry_count
      }));

      // Maintenance par type
      let maintenanceTypeQuery = `
        SELECT m.maintenance_type as type,
               SUM(CAST(cost AS DECIMAL(10,2))) as total_cost,
               COUNT(*) as entry_count
        FROM maintenances m
        JOIN objects o ON o.id = m.object_id
        WHERE 1=1
      `;
      const maintenanceTypeParams: any[] = [];

      if (startDate) {
        maintenanceTypeQuery += ` AND m.maintenance_date >= ?`;
        maintenanceTypeParams.push(startDate);
      }
      if (endDate) {
        maintenanceTypeQuery += ` AND m.maintenance_date <= ?`;
        maintenanceTypeParams.push(endDate);
      }
      maintenanceTypeQuery += objectCondition;
      maintenanceTypeParams.push(...objectParams);
      maintenanceTypeQuery += ` GROUP BY m.maintenance_type ORDER BY total_cost DESC`;

      result.maintenanceByType = (await db.query(maintenanceTypeQuery, maintenanceTypeParams)).map((r: any) => ({
        type: r.type,
        cost: parseFloat(r.total_cost) || 0,
        count: r.entry_count
      }));
    }

    // Contrôle technique par période
    if (types.includes('technical_control')) {
      const controlDateFormat = dateFormat.replace('%s', 'tc.control_date');
      let controlQuery = `
        SELECT ${controlDateFormat} as period,
               SUM(CAST(cost AS DECIMAL(10,2))) as total_cost,
               COUNT(*) as entry_count
        FROM technical_controls tc
        JOIN objects o ON o.id = tc.object_id
        WHERE 1=1
      `;
      const controlParams: any[] = [];

      if (startDate) {
        controlQuery += ` AND tc.control_date >= ?`;
        controlParams.push(startDate);
      }
      if (endDate) {
        controlQuery += ` AND tc.control_date <= ?`;
        controlParams.push(endDate);
      }
      controlQuery += objectCondition;
      controlParams.push(...objectParams);
      controlQuery += ` GROUP BY period ORDER BY period`;

      result.controlByPeriod = (await db.query(controlQuery, controlParams)).map((r: any) => ({
        period: r.period,
        cost: parseFloat(r.total_cost) || 0,
        count: r.entry_count
      }));
    }

    // Coûts par catégorie
    let costByCategoryQuery = `
      SELECT c.id, c.name, c.image,
             COALESCE(SUM(f.total), 0) as fuel_cost,
             COALESCE(SUM(m.total), 0) as maintenance_cost,
             COALESCE(SUM(tc.total), 0) as control_cost
      FROM categories c
      LEFT JOIN objects o ON o.category_id = c.id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(total_price AS DECIMAL(10,2))) as total
        FROM fuel_entries
        WHERE 1=1 ${startDate ? 'AND entry_date >= ?' : ''} ${endDate ? 'AND entry_date <= ?' : ''}
        GROUP BY object_id
      ) f ON f.object_id = o.id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(cost AS DECIMAL(10,2))) as total
        FROM maintenances
        WHERE 1=1 ${startDate ? 'AND maintenance_date >= ?' : ''} ${endDate ? 'AND maintenance_date <= ?' : ''}
        GROUP BY object_id
      ) m ON m.object_id = o.id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(cost AS DECIMAL(10,2))) as total
        FROM technical_controls
        WHERE 1=1 ${startDate ? 'AND control_date >= ?' : ''} ${endDate ? 'AND control_date <= ?' : ''}
        GROUP BY object_id
      ) tc ON tc.object_id = o.id
      GROUP BY c.id, c.name, c.image
      HAVING (fuel_cost + maintenance_cost + control_cost) > 0
      ORDER BY (fuel_cost + maintenance_cost + control_cost) DESC
    `;
    const costByCategoryParams: any[] = [];
    if (startDate) costByCategoryParams.push(startDate);
    if (endDate) costByCategoryParams.push(endDate);
    if (startDate) costByCategoryParams.push(startDate);
    if (endDate) costByCategoryParams.push(endDate);
    if (startDate) costByCategoryParams.push(startDate);
    if (endDate) costByCategoryParams.push(endDate);

    result.costByCategory = (await db.query(costByCategoryQuery, costByCategoryParams)).map((r: any) => ({
      id: r.id,
      name: r.name,
      image: r.image,
      fuelCost: parseFloat(r.fuel_cost) || 0,
      maintenanceCost: parseFloat(r.maintenance_cost) || 0,
      controlCost: parseFloat(r.control_cost) || 0,
      totalCost: (parseFloat(r.fuel_cost) || 0) + (parseFloat(r.maintenance_cost) || 0) + (parseFloat(r.control_cost) || 0)
    }));

    // Top 10 objets les plus coûteux
    let costByObjectQuery = `
      SELECT o.id, o.name, o.reference, o.image,
             c.name as category_name,
             COALESCE(f.total, 0) as fuel_cost,
             COALESCE(m.total, 0) as maintenance_cost,
             COALESCE(tc.total, 0) as control_cost
      FROM objects o
      LEFT JOIN categories c ON c.id = o.category_id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(total_price AS DECIMAL(10,2))) as total
        FROM fuel_entries
        WHERE 1=1 ${startDate ? 'AND entry_date >= ?' : ''} ${endDate ? 'AND entry_date <= ?' : ''}
        GROUP BY object_id
      ) f ON f.object_id = o.id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(cost AS DECIMAL(10,2))) as total
        FROM maintenances
        WHERE 1=1 ${startDate ? 'AND maintenance_date >= ?' : ''} ${endDate ? 'AND maintenance_date <= ?' : ''}
        GROUP BY object_id
      ) m ON m.object_id = o.id
      LEFT JOIN (
        SELECT object_id, SUM(CAST(cost AS DECIMAL(10,2))) as total
        FROM technical_controls
        WHERE 1=1 ${startDate ? 'AND control_date >= ?' : ''} ${endDate ? 'AND control_date <= ?' : ''}
        GROUP BY object_id
      ) tc ON tc.object_id = o.id
      WHERE 1=1
    `;
    const costByObjectParams: any[] = [];
    if (startDate) costByObjectParams.push(startDate);
    if (endDate) costByObjectParams.push(endDate);
    if (startDate) costByObjectParams.push(startDate);
    if (endDate) costByObjectParams.push(endDate);
    if (startDate) costByObjectParams.push(startDate);
    if (endDate) costByObjectParams.push(endDate);

    costByObjectQuery += objectCondition;
    costByObjectParams.push(...objectParams);
    costByObjectQuery += ` HAVING (fuel_cost + maintenance_cost + control_cost) > 0
      ORDER BY (fuel_cost + maintenance_cost + control_cost) DESC
      LIMIT 10`;

    result.costByObject = (await db.query(costByObjectQuery, costByObjectParams)).map((r: any) => ({
      id: r.id,
      name: r.name,
      reference: r.reference,
      image: r.image,
      categoryName: r.category_name,
      fuelCost: parseFloat(r.fuel_cost) || 0,
      maintenanceCost: parseFloat(r.maintenance_cost) || 0,
      controlCost: parseFloat(r.control_cost) || 0,
      totalCost: (parseFloat(r.fuel_cost) || 0) + (parseFloat(r.maintenance_cost) || 0) + (parseFloat(r.control_cost) || 0)
    }));

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Erreur tracking charts:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/tracking/filters - Récupérer les options de filtrage
router.get('/filters', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    // Catégories
    const categories = await db.query(
      `SELECT id, name, slug, image FROM categories ORDER BY sort_order, name`
    );

    // Sous-catégories
    const subcategories = await db.query(
      `SELECT id, category_id, name, slug, image FROM subcategories ORDER BY sort_order, name`
    );

    // Objets
    const objects = await db.query(
      `SELECT o.id, o.name, o.reference, o.image, o.category_id, o.subcategory_id,
              c.name as category_name, s.name as subcategory_name
       FROM objects o
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN subcategories s ON s.id = o.subcategory_id
       ORDER BY o.name`
    );

    // Types de carburant distincts
    const fuelTypes = await db.query(
      `SELECT DISTINCT fuel_type FROM fuel_entries WHERE fuel_type IS NOT NULL ORDER BY fuel_type`
    );

    // Types d'entretien
    const maintenanceTypes = await db.query(
      `SELECT DISTINCT maintenance_type FROM maintenances WHERE maintenance_type IS NOT NULL 
       UNION SELECT name FROM maintenance_types
       ORDER BY 1`
    );

    res.json({
      success: true,
      categories: categories.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image
      })),
      subcategories: subcategories.map((s: any) => ({
        id: s.id,
        categoryId: s.category_id,
        name: s.name,
        slug: s.slug,
        image: s.image
      })),
      objects: objects.map((o: any) => ({
        id: o.id,
        name: o.name,
        reference: o.reference,
        image: o.image,
        categoryId: o.category_id,
        categoryName: o.category_name,
        subcategoryId: o.subcategory_id,
        subcategoryName: o.subcategory_name
      })),
      fuelTypes: fuelTypes.map((f: any) => f.fuel_type),
      maintenanceTypes: maintenanceTypes.map((m: any) => m.maintenance_type || m.name)
    });
  } catch (error: any) {
    console.error('Erreur tracking filters:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/tracking/permissions - Vérifier les permissions de l'utilisateur
router.get('/permissions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    // Les admins ont tous les droits
    if (userRole === 'admin') {
      return res.json({
        success: true,
        canView: true,
        canExport: true,
        canCompare: true
      });
    }

    // Récupérer les permissions du groupe
    const groupPerm = await db.queryOne(
      `SELECT * FROM module_permissions WHERE module_name = 'tracking' AND role = ?`,
      [userRole]
    );

    // Récupérer les permissions individuelles
    const userPerm = await db.queryOne(
      `SELECT * FROM user_module_permissions WHERE user_id = ? AND module_name = 'tracking'`,
      [userId]
    );

    // Combiner les permissions (OR logique)
    const canView = !!(groupPerm?.can_view || userPerm?.can_view);
    const canExport = !!(groupPerm?.can_export || userPerm?.can_export);
    const canCompare = !!(groupPerm?.can_compare || userPerm?.can_compare);

    res.json({
      success: true,
      canView,
      canExport,
      canCompare
    });
  } catch (error: any) {
    console.error('Erreur tracking permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/tracking/yearly-comparison - Comparaison annuelle
router.get('/yearly-comparison', authenticateToken, checkTrackingPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { year1, year2, categoryIds, subcategoryIds, objectIds, dataTypes } = req.query;
    
    const y1 = parseInt(year1 as string) || new Date().getFullYear();
    const y2 = parseInt(year2 as string) || y1 - 1;
    const types = dataTypes ? (dataTypes as string).split(',') : ['fuel', 'maintenance', 'technical_control'];

    // Construction des conditions de filtre d'objet
    let objectCondition = '';
    const objectParams: any[] = [];
    
    if (objectIds) {
      const ids = (objectIds as string).split(',').map(Number);
      objectCondition = ` AND o.id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    } else if (subcategoryIds) {
      const ids = (subcategoryIds as string).split(',').map(Number);
      objectCondition = ` AND o.subcategory_id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    } else if (categoryIds) {
      const ids = (categoryIds as string).split(',').map(Number);
      objectCondition = ` AND o.category_id IN (${ids.map(() => '?').join(',')})`;
      objectParams.push(...ids);
    }

    // Données mensuelles pour chaque année
    const result: any = {
      monthly: {
        year1: [],
        year2: []
      },
      summary: {
        year1: { total: 0, fuel: 0, maintenance: 0, control: 0 },
        year2: { total: 0, fuel: 0, maintenance: 0, control: 0 }
      },
      difference: {
        total: 0,
        fuel: 0,
        maintenance: 0,
        control: 0,
        percentage: 0
      }
    };

    // Fonction pour récupérer les données mensuelles d'une année
    const getYearlyData = async (year: number) => {
      const monthlyData: any[] = [];
      let totalFuel = 0;
      let totalMaintenance = 0;
      let totalControl = 0;

      for (let month = 1; month <= 12; month++) {
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Dernier jour du mois
        
        let fuelCost = 0;
        let maintenanceCost = 0;
        let controlCost = 0;

        // Carburant
        if (types.includes('fuel')) {
          const fuelQuery = `
            SELECT COALESCE(SUM(CAST(f.total_price AS DECIMAL(10,2))), 0) as total
            FROM fuel_entries f
            JOIN objects o ON o.id = f.object_id
            WHERE f.entry_date >= ? AND f.entry_date <= ?${objectCondition}
          `;
          const fuelResult = await db.queryOne(fuelQuery, [startDate, endDate, ...objectParams]);
          fuelCost = parseFloat(fuelResult?.total) || 0;
        }

        // Entretiens
        if (types.includes('maintenance')) {
          const maintenanceQuery = `
            SELECT COALESCE(SUM(CAST(m.cost AS DECIMAL(10,2))), 0) as total
            FROM maintenances m
            JOIN objects o ON o.id = m.object_id
            WHERE m.maintenance_date >= ? AND m.maintenance_date <= ?${objectCondition}
          `;
          const maintenanceResult = await db.queryOne(maintenanceQuery, [startDate, endDate, ...objectParams]);
          maintenanceCost = parseFloat(maintenanceResult?.total) || 0;
        }

        // Contrôles techniques
        if (types.includes('technical_control')) {
          const controlQuery = `
            SELECT COALESCE(SUM(CAST(tc.cost AS DECIMAL(10,2))), 0) as total
            FROM technical_controls tc
            JOIN objects o ON o.id = tc.object_id
            WHERE tc.control_date >= ? AND tc.control_date <= ?${objectCondition}
          `;
          const controlResult = await db.queryOne(controlQuery, [startDate, endDate, ...objectParams]);
          controlCost = parseFloat(controlResult?.total) || 0;
        }

        const monthTotal = fuelCost + maintenanceCost + controlCost;
        totalFuel += fuelCost;
        totalMaintenance += maintenanceCost;
        totalControl += controlCost;

        monthlyData.push({
          month,
          fuel: fuelCost,
          maintenance: maintenanceCost,
          control: controlCost,
          total: monthTotal
        });
      }

      return {
        monthly: monthlyData,
        totals: {
          fuel: totalFuel,
          maintenance: totalMaintenance,
          control: totalControl,
          total: totalFuel + totalMaintenance + totalControl
        }
      };
    };

    // Récupérer les données pour les deux années
    const data1 = await getYearlyData(y1);
    const data2 = await getYearlyData(y2);

    result.monthly.year1 = data1.monthly;
    result.monthly.year2 = data2.monthly;
    
    result.summary.year1 = data1.totals;
    result.summary.year2 = data2.totals;

    // Calcul des différences
    result.difference = {
      fuel: data1.totals.fuel - data2.totals.fuel,
      maintenance: data1.totals.maintenance - data2.totals.maintenance,
      control: data1.totals.control - data2.totals.control,
      total: data1.totals.total - data2.totals.total,
      percentage: data2.totals.total > 0 
        ? ((data1.totals.total - data2.totals.total) / data2.totals.total * 100)
        : 0
    };

    res.json({
      success: true,
      year1: y1,
      year2: y2,
      ...result
    });
  } catch (error: any) {
    console.error('Erreur yearly comparison:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
