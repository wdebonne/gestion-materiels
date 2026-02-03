import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.middleware';

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

// Filtrer les types de fichiers
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé. Utilisez: JPG, PNG, GIF, WebP ou SVG'));
  }
};

// Configuration multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// POST /api/upload/image - Upload une image
router.post('/image', authenticateToken, upload.single('image'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    // Construire l'URL
    const url = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error: any) {
    console.error('Erreur upload:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/upload/images - Upload plusieurs images
router.post('/images', authenticateToken, upload.array('images', 10), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const uploadedFiles = files.map(file => ({
      url: `/uploads/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    }));

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
router.delete('/:filename', authenticateToken, (req: Request, res: Response) => {
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
      return res.status(400).json({ success: false, message: 'Le fichier est trop volumineux (max 10MB)' });
    }
    return res.status(400).json({ success: false, message: error.message });
  }
  
  if (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  
  next();
});

export default router;
