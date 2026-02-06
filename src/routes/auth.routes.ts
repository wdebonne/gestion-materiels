import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, JwtPayload } from '../middleware/auth.middleware';
import { sendEmail } from '../services/email.service';
import { logService } from '../services/log.service';

const router = Router();

// Validation des entrées
const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
  body('password').notEmpty().withMessage('Mot de passe requis')
];

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères'),
  body('firstName').optional().trim().escape(),
  body('lastName').optional().trim().escape()
];

// Générer les tokens JWT
function generateTokens(user: any): { accessToken: string; refreshToken: string } {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(payload, process.env.JWT_SECRET || 'secret', {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  } as jwt.SignOptions);

  return { accessToken, refreshToken };
}

// POST /api/auth/login - Connexion
router.post('/login', loginValidation, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    // Chercher l'utilisateur
    const user = await db.queryOne(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      await logService.warning('auth', 'Tentative de connexion avec email inconnu', { email }, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    if (!user.is_active) {
      await logService.warning('auth', 'Tentative de connexion sur compte désactivé', { email }, {
        userId: user.id,
        userEmail: user.email,
        ipAddress: req.ip
      });
      return res.status(401).json({ success: false, message: 'Compte désactivé' });
    }

    // Vérifier le mot de passe
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await logService.warning('auth', 'Tentative de connexion avec mot de passe incorrect', { email }, {
        userId: user.id,
        userEmail: user.email,
        ipAddress: req.ip
      });
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    // Mettre à jour la dernière connexion
    await db.execute(
      "UPDATE users SET last_login = datetime('now') WHERE id = ?",
      [user.id]
    );

    // Générer les tokens
    const tokens = generateTokens(user);

    // Log de l'activité
    try {
      await db.execute(
        'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [user.id, 'login', 'Connexion réussie', req.ip]
      );
    } catch (e) {
      // La table activity_logs n'existe peut-être pas
    }

    // Log avec le nouveau système
    await logService.success('auth', 'Connexion réussie', { role: user.role }, {
      userId: user.id,
      userEmail: user.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Définir un cookie HttpOnly pour l'accès aux fichiers uploadés
    res.cookie('auth_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        avatar: user.avatar
      },
      ...tokens
    });
  } catch (error: any) {
    console.error('Erreur login:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/register - Inscription (admin only)
router.post('/register', authenticateToken, registerValidation, async (req: AuthRequest, res: Response) => {
  try {
    // Seuls les admins peuvent créer des utilisateurs
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, firstName, lastName, role = 'user' } = req.body;

    // Vérifier si l'email existe déjà
    const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Créer l'utilisateur
    const result = await db.execute(
      'INSERT INTO users (email, password, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName, lastName, role]
    );

    // Envoyer l'email de bienvenue
    try {
      await sendEmail('welcome', email, {
        first_name: firstName,
        last_name: lastName,
        email,
        role
      });
    } catch (emailError) {
      console.error('Erreur envoi email bienvenue:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      userId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur register:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/forgot-password - Mot de passe oublié
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Email invalide')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email } = req.body;

    // Chercher l'utilisateur
    const user = await db.queryOne('SELECT * FROM users WHERE email = ?', [email]);

    // Toujours retourner succès pour éviter les fuites d'information
    if (!user) {
      return res.json({ success: true, message: 'Si cet email existe, un lien de réinitialisation a été envoyé' });
    }

    // Générer un token de réinitialisation
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 heure

    // Sauvegarder le token
    await db.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [hashedToken, expiresAt, user.id]
    );

    // Envoyer l'email
    const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;
    
    try {
      await sendEmail('password_reset', email, {
        first_name: user.first_name || 'Utilisateur',
        reset_link: resetLink,
        expiry_hours: '1'
      });
    } catch (emailError) {
      console.error('Erreur envoi email reset:', emailError);
    }

    res.json({ success: true, message: 'Si cet email existe, un lien de réinitialisation a été envoyé' });
  } catch (error: any) {
    console.error('Erreur forgot-password:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/reset-password - Réinitialiser le mot de passe
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token requis'),
  body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { token, password } = req.body;

    // Hasher le token pour la comparaison
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Chercher l'utilisateur avec ce token
    const user = await db.queryOne(
      "SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > datetime('now')",
      [hashedToken]
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token invalide ou expiré' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Mettre à jour le mot de passe et supprimer le token
    await db.execute(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.json({ success: true, message: 'Mot de passe mis à jour avec succès' });
  } catch (error: any) {
    console.error('Erreur reset-password:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/auth/me - Obtenir les infos de l'utilisateur connecté
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.queryOne(
      'SELECT id, email, first_name, last_name, role, avatar, created_at, last_login FROM users WHERE id = ?',
      [req.user?.userId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error: any) {
    console.error('Erreur get me:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/auth/profile - Mettre à jour le profil
router.put('/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, avatar } = req.body;

    await db.execute(
      "UPDATE users SET first_name = ?, last_name = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?",
      [firstName, lastName, avatar, req.user?.userId]
    );

    res.json({ success: true, message: 'Profil mis à jour' });
  } catch (error: any) {
    console.error('Erreur update profile:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/auth/change-password - Changer le mot de passe
router.put('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
  body('newPassword').isLength({ min: 6 }).withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    // Récupérer l'utilisateur
    const user = await db.queryOne('SELECT password FROM users WHERE id = ?', [req.user?.userId]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Vérifier le mot de passe actuel
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });
    }

    // Hasher et mettre à jour le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await db.execute(
      "UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?",
      [hashedPassword, req.user?.userId]
    );

    // Log du changement de mot de passe
    await logService.success('auth', 'Mot de passe changé', {}, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({ success: true, message: 'Mot de passe mis à jour' });
  } catch (error: any) {
    console.error('Erreur change-password:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/refresh - Rafraîchir le token
router.post('/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token requis' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET || 'secret') as JwtPayload;
    
    const user = await db.queryOne('SELECT * FROM users WHERE id = ? AND is_active = 1', [decoded.userId]);
    
    if (!user) {
      await logService.warning('auth', 'Tentative de rafraîchissement de token pour utilisateur inexistant ou inactif', {
        decodedUserId: decoded.userId
      }, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(401).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const tokens = generateTokens(user);
    
    // Log du rafraîchissement de token
    await logService.info('auth', 'Token rafraîchi', {}, {
      userId: user.id,
      userEmail: user.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Mettre à jour le cookie d'authentification
    res.cookie('auth_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
    });

    res.json({ success: true, ...tokens });
  } catch (error) {
    await logService.warning('auth', 'Tentative de rafraîchissement de token invalide', {
      error: error instanceof Error ? error.message : 'Token invalide'
    }, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    res.status(403).json({ success: false, message: 'Refresh token invalide' });
  }
});

// POST /api/auth/logout - Déconnexion
router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Log de l'activité dans la table activity_logs
    try {
      await db.execute(
        'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [req.user?.userId, 'logout', 'Déconnexion', req.ip]
      );
    } catch (e) {
      // La table activity_logs n'existe peut-être pas
    }

    // Log détaillé avec le système de logs
    await logService.success('auth', 'Déconnexion réussie', {
      sessionDuration: 'N/A' // Pourrait être calculé avec le token
    }, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Supprimer le cookie d'authentification
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.json({ success: true, message: 'Déconnexion réussie' });
  } catch (error) {
    // Log même en cas d'erreur
    await logService.warning('auth', 'Erreur lors de la déconnexion', {
      error: error instanceof Error ? error.message : 'Unknown error'
    }, {
      userId: req.user?.userId,
      ipAddress: req.ip
    });
    res.json({ success: true, message: 'Déconnexion réussie' });
  }
});

export default router;
