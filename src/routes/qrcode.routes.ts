import { Router, Response } from 'express';
import QRCode from 'qrcode';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Générer un QR code pour un objet spécifique (PNG data URL)
router.get('/:objectId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { objectId } = req.params;
    const object = await db.queryOne('SELECT id, name FROM objects WHERE id = ?', [objectId]);

    if (!object) {
      res.status(404).json({ success: false, message: 'Objet non trouvé' });
      return;
    }

    // Construire l'URL de la fiche objet
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const objectUrl = `${baseUrl}/objects/${objectId}`;

    const qrDataUrl = await QRCode.toDataURL(objectUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.json({
      success: true,
      data: {
        objectId: Number(objectId),
        objectName: object.name,
        url: objectUrl,
        qrCode: qrDataUrl
      }
    });
  } catch (error: any) {
    console.error('Erreur génération QR code:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Générer des QR codes en lot (pour impression d'étiquettes)
router.post('/batch', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { objectIds } = req.body;

    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      res.status(400).json({ success: false, message: 'Liste d\'objets requise' });
      return;
    }

    if (objectIds.length > 100) {
      res.status(400).json({ success: false, message: 'Maximum 100 objets par lot' });
      return;
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const results = [];

    const placeholders = objectIds.map(() => '?').join(',');
    const objects = await db.query(
      `SELECT id, name, reference, serial_number FROM objects WHERE id IN (${placeholders})`,
      objectIds
    );

    for (const obj of objects) {
      const objectUrl = `${baseUrl}/objects/${obj.id}`;
      const qrDataUrl = await QRCode.toDataURL(objectUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });

      results.push({
        objectId: obj.id,
        objectName: obj.name,
        reference: obj.reference || '',
        serialNumber: obj.serial_number || '',
        url: objectUrl,
        qrCode: qrDataUrl
      });
    }

    res.json({ success: true, data: results });
  } catch (error: any) {
    console.error('Erreur génération QR codes en lot:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
