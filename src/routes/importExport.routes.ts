import { Router, Response } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireSupervisor, getAccessibleCategoryIds } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// Configuration multer pour l'upload de fichiers CSV/Excel
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/imports');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `import-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    const allowedExts = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Utilisez CSV ou Excel (.xlsx)'));
    }
  }
});

// ===== EXPORT =====

// Exporter les matériels en Excel
router.get('/export', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { categoryId, subcategoryId, status, format = 'xlsx' } = req.query;

    let sql = `
      SELECT o.*, c.name as category_name, s.name as subcategory_name
      FROM objects o
      LEFT JOIN categories c ON o.category_id = c.id
      LEFT JOIN subcategories s ON o.subcategory_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // Même filtrage que `GET /objects`. Sans lui, cette route n'avait que
    // `authenticateToken` : n'importe quel compte exportait le parc entier,
    // y compris les catégories qu'il n'a pas le droit de consulter à l'écran.
    const accessibleIds = await getAccessibleCategoryIds(req.user!.userId, req.user!.role);
    if (accessibleIds !== null) {
      if (accessibleIds.length === 0) {
        res.status(403).json({ success: false, message: 'Aucune catégorie ne vous est accessible' });
        return;
      }
      const placeholders = accessibleIds.map(() => '?').join(',');
      sql += ` AND (o.category_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = o.subcategory_id AND sc.category_id IN (${placeholders})))`;
      params.push(...accessibleIds, ...accessibleIds);
    }

    if (categoryId) {
      sql += ' AND o.category_id = ?';
      params.push(categoryId);
    }
    if (subcategoryId) {
      sql += ' AND o.subcategory_id = ?';
      params.push(subcategoryId);
    }
    if (status) {
      sql += ' AND o.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY o.name ASC';

    const objects = await db.query(sql, params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Gestion Matériels';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Matériels');

    // Colonnes
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Nom', key: 'name', width: 30 },
      { header: 'Catégorie', key: 'category_name', width: 20 },
      { header: 'Sous-catégorie', key: 'subcategory_name', width: 20 },
      { header: 'Référence', key: 'reference', width: 15 },
      { header: 'N° Série', key: 'serial_number', width: 20 },
      { header: 'Statut', key: 'status', width: 15 },
      { header: 'Localisation', key: 'location', width: 25 },
      { header: 'Date d\'achat', key: 'purchase_date', width: 15 },
      { header: 'Prix d\'achat', key: 'purchase_price', width: 15 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];

    // Style de l'en-tête
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Données
    for (const obj of objects) {
      sheet.addRow({
        id: obj.id,
        name: obj.name,
        category_name: obj.category_name || '',
        subcategory_name: obj.subcategory_name || '',
        reference: obj.reference || '',
        serial_number: obj.serial_number || '',
        status: obj.status || '',
        location: obj.location || '',
        purchase_date: obj.purchase_date || '',
        purchase_price: obj.purchase_price ? Number(obj.purchase_price) : '',
        description: obj.description || '',
        notes: obj.notes || '',
      });
    }

    // Générer le fichier
    if (format === 'csv') {
      // Le classeur est écrit tel quel. La version précédente en recopiait le
      // contenu dans un second classeur dont `columns` avait déjà posé une
      // ligne d'en-tête, puis recopiait aussi la ligne 1 de la source : chaque
      // CSV exporté commençait par deux en-têtes identiques, ce qui décale
      // toute relecture et fait échouer un réimport.
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=materiels_${Date.now()}.csv`);
      await workbook.csv.write(res);
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=materiels_${Date.now()}.xlsx`);
      await workbook.xlsx.write(res);
    }

    await logService.info('other', 'Export matériels', {
      userId: req.user?.userId,
      format,
      count: objects.length
    });

    res.end();
  } catch (error: any) {
    console.error('Erreur export:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'export' });
  }
});

// Télécharger un template d'import
router.get('/template', authenticateToken, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import Matériels');

    sheet.columns = [
      { header: 'Nom *', key: 'name', width: 30 },
      { header: 'Catégorie *', key: 'category', width: 20 },
      { header: 'Sous-catégorie', key: 'subcategory', width: 20 },
      { header: 'Référence', key: 'reference', width: 15 },
      { header: 'N° Série', key: 'serial_number', width: 20 },
      { header: 'Statut', key: 'status', width: 15 },
      { header: 'Localisation', key: 'location', width: 25 },
      { header: 'Date d\'achat (AAAA-MM-JJ)', key: 'purchase_date', width: 20 },
      { header: 'Prix d\'achat', key: 'purchase_price', width: 15 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];

    // Style en-tête
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
    });

    // Ligne d'exemple
    sheet.addRow({
      name: 'Tondeuse John Deere X350',
      category: 'Espaces verts',
      subcategory: 'Tondeuses',
      reference: 'REF-001',
      serial_number: 'SN-123456',
      status: 'active',
      location: 'Hangar principal',
      purchase_date: '2024-03-15',
      purchase_price: 2500,
      description: 'Tondeuse autoportée',
      notes: ''
    });

    // Note explicative
    const noteSheet = workbook.addWorksheet('Instructions');
    noteSheet.getCell('A1').value = 'Instructions d\'import';
    noteSheet.getCell('A1').font = { bold: true, size: 14 };
    noteSheet.getCell('A3').value = '• Les champs marqués * sont obligatoires';
    noteSheet.getCell('A4').value = '• La catégorie doit correspondre exactement au nom d\'une catégorie existante';
    noteSheet.getCell('A5').value = '• Statuts valides : active, inactive, maintenance, out_of_service';
    noteSheet.getCell('A6').value = '• Format de date : AAAA-MM-JJ (ex: 2024-03-15)';
    noteSheet.getCell('A7').value = '• Le prix doit être un nombre (ex: 2500.50)';
    noteSheet.getColumn(1).width = 80;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=template_import_materiels.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Erreur template:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ===== IMPORT =====

// Importer des matériels depuis un fichier CSV/Excel
router.post('/import', authenticateToken, requireSupervisor, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
      return;
    }

    const filePath = req.file.path;
    const workbook = new ExcelJS.Workbook();

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      res.status(400).json({ success: false, message: 'Fichier vide' });
      return;
    }

    // Récupérer les catégories existantes
    const categories = await db.query('SELECT id, name, slug FROM categories');
    const categoryMap = new Map(categories.map((c: any) => [c.name.toLowerCase(), c]));

    // Récupérer les sous-catégories
    const subcategories = await db.query('SELECT id, category_id, name, slug FROM subcategories');

    const results = { imported: 0, errors: [] as string[], skipped: 0 };
    const now = new Date().toISOString();

    // Parcourir les lignes (skip header)
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const values = row.values as any[];
      // ExcelJS row values are 1-indexed
      const name = values[1]?.toString()?.trim();
      const categoryName = values[2]?.toString()?.trim();
      const subcategoryName = values[3]?.toString()?.trim();
      const reference = values[4]?.toString()?.trim() || null;
      const serialNumber = values[5]?.toString()?.trim() || null;
      const status = values[6]?.toString()?.trim() || 'active';
      const location = values[7]?.toString()?.trim() || null;
      const purchaseDate = values[8]?.toString()?.trim() || null;
      const purchasePrice = values[9] ? Number(values[9]) : null;
      const description = values[10]?.toString()?.trim() || null;
      const notes = values[11]?.toString()?.trim() || null;

      if (!name) {
        results.errors.push(`Ligne ${rowNumber}: Nom manquant`);
        return;
      }

      if (!categoryName) {
        results.errors.push(`Ligne ${rowNumber}: Catégorie manquante pour "${name}"`);
        return;
      }

      const category = categoryMap.get(categoryName.toLowerCase());
      if (!category) {
        results.errors.push(`Ligne ${rowNumber}: Catégorie "${categoryName}" introuvable`);
        return;
      }

      // Valider le statut
      const validStatuses = ['active', 'inactive', 'maintenance', 'out_of_service'];
      if (!validStatuses.includes(status)) {
        results.errors.push(`Ligne ${rowNumber}: Statut "${status}" invalide pour "${name}"`);
        return;
      }

      let subcategoryId = null;
      if (subcategoryName) {
        const sub = subcategories.find(
          (s: any) => s.category_id === category.id && s.name.toLowerCase() === subcategoryName.toLowerCase()
        );
        if (sub) {
          subcategoryId = sub.id;
        } else {
          results.errors.push(`Ligne ${rowNumber}: Sous-catégorie "${subcategoryName}" introuvable dans "${categoryName}"`);
          return;
        }
      }

      // Valider et formater le prix
      let validPrice = purchasePrice;
      if (validPrice !== null && isNaN(validPrice)) {
        validPrice = null;
      }

      try {
        // We can't use await inside eachRow, so we collect and process after
        // This is a sync operation for SQLite
        db.execute(
          `INSERT INTO objects (name, category_id, subcategory_id, reference, serial_number, status, location, purchase_date, purchase_price, description, notes, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [name, category.id, subcategoryId, reference, serialNumber, status, location, purchaseDate, validPrice, description, notes, now, now]
        );
        results.imported++;
      } catch (err: any) {
        results.errors.push(`Ligne ${rowNumber}: Erreur d'insertion pour "${name}" - ${err.message}`);
      }
    });

    // Supprimer le fichier uploadé
    try { fs.unlinkSync(filePath); } catch (_) {}

    await logService.info('other', 'Import matériels', {
      userId: req.user?.userId,
      imported: results.imported,
      errors: results.errors.length,
      filename: req.file.originalname
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error: any) {
    console.error('Erreur import:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'import' });
  }
});

export default router;
