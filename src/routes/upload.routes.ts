import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requireSupervisor, requireFieldWrite } from '../middleware/auth.middleware';
import { normalizeImage } from '../services/imageNormalize.service';

const router = Router();

// Configuration du stockage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Générer un nom unique
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

// Filtrer les types de fichiers (images uniquement)
const imageFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé. Utilisez: JPG, PNG, GIF, WebP ou SVG'));
  }
};

/**
 * Types acceptés en pièce jointe.
 *
 * Les formats bureautiques ont été ajoutés : l'écran des espaces verts propose
 * depuis toujours `.doc,.docx,.xls,.xlsx,.odt,.ods` que le serveur refusait,
 * si bien qu'un utilisateur voyait son document rejeté sans comprendre pourquoi.
 * Et un arrêté municipal arrive plus souvent en traitement de texte qu'en PDF.
 */
const TYPES_ACCEPTES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain',
  'text/csv',
];

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (TYPES_ACCEPTES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé. Utilisez une image, un PDF, un document Word, Excel ou OpenDocument'));
  }
};

// Configuration multer pour images uniquement
const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // filet de sécurité : le client réduit déjà les photos
  }
});

// Configuration multer pour fichiers (images + PDF)
const uploadFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // filet de sécurité : le client réduit déjà les photos
  }
});

// POST /api/upload/image - Upload une image
router.post('/image', authenticateToken, requireFieldWrite, uploadImage.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    // Redresse les photos couchées (EXIF) et plafonne la taille
    const tailleNormalisee = await normalizeImage(req.file.path, req.file.mimetype);

    // Construire l'URL
    const url = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: tailleNormalisee ?? req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error: any) {
    console.error('Erreur upload:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/upload/file - Upload un fichier (image ou PDF)
router.post('/file', authenticateToken, requireFieldWrite, uploadFile.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    // Sans effet sur les PDF : seules les images matricielles sont traitées
    const tailleNormalisee = await normalizeImage(req.file.path, req.file.mimetype);

    // Construire l'URL
    const url = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: tailleNormalisee ?? req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error: any) {
    console.error('Erreur upload fichier:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/upload/images - Upload plusieurs images
router.post('/images', authenticateToken, requireFieldWrite, uploadImage.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const uploadedFiles = await Promise.all(files.map(async file => ({
      url: `/uploads/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      size: (await normalizeImage(file.path, file.mimetype)) ?? file.size,
      mimetype: file.mimetype
    })));

    res.json({
      success: true,
      files: uploadedFiles
    });
  } catch (error: any) {
    console.error('Erreur upload multiple:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/upload/:filename - Supprimer une image
router.delete('/:filename', authenticateToken, requireSupervisor, (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../../uploads', filename);

    // Vérifier que le fichier existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    }

    // Supprimer le fichier
    fs.unlinkSync(filePath);

    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (error: any) {
    console.error('Erreur suppression:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Middleware de gestion des erreurs multer
router.use((error: any, req: Request, res: Response, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Le fichier est trop volumineux (maximum 25 Mo).' });
    }
    return res.status(400).json({ success: false, message: error.message });
  }
  
  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  
  next();
});

export default router;
