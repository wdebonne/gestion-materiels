import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logService } from '../services/log.service';

/**
 * Configuration du Rate Limiting
 * Protège l'API contre les attaques par force brute et les abus
 */

// Rate limiter global pour toutes les routes API
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limite de 1000 requêtes par fenêtre de 15 minutes
  message: {
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  },
  standardHeaders: true, // Renvoie les headers `RateLimit-*`
  legacyHeaders: false, // Désactive les headers `X-RateLimit-*`
  handler: async (req: Request, res: Response, next: NextFunction, options: any) => {
    await logService.warning('security', 'Rate limit global atteint', {
      ip: req.ip,
      path: req.path,
      method: req.method
    }, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestPath: req.path,
      requestMethod: req.method
    });
    res.status(429).json(options.message);
  },
  skip: (req: Request) => {
    // Ignorer les fichiers statiques
    return req.path.startsWith('/uploads/') || req.path.startsWith('/plugins/');
  }
});

// Rate limiter strict pour l'authentification (login/register/forgot-password)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max par fenêtre de 15 minutes
  message: {
    success: false,
    message: 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response, next: NextFunction, options: any) => {
    await logService.error('security', 'Rate limit authentification atteint - Possible attaque brute force', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      email: req.body?.email
    }, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestPath: req.path,
      requestMethod: req.method
    });
    res.status(429).json(options.message);
  },
  keyGenerator: (req: Request) => {
    // Utilise l'IP et l'email (si disponible) comme clé
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
  }
});

// Rate limiter pour les opérations sensibles (reset password, etc.)
export const sensitiveOpsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 tentatives max par heure
  message: {
    success: false,
    message: 'Trop de tentatives. Veuillez réessayer dans une heure.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response, next: NextFunction, options: any) => {
    await logService.warning('security', 'Rate limit opérations sensibles atteint', {
      ip: req.ip,
      path: req.path,
      method: req.method
    }, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestPath: req.path,
      requestMethod: req.method
    });
    res.status(429).json(options.message);
  }
});

// Rate limiter pour les uploads
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 100, // 100 uploads max par heure
  message: {
    success: false,
    message: 'Trop d\'uploads. Veuillez réessayer plus tard.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter pour les exports/backups
export const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10, // 10 exports max par heure
  message: {
    success: false,
    message: 'Trop d\'exports. Veuillez réessayer plus tard.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
