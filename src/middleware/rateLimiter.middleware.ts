import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/secrets';
import { Request, Response, NextFunction } from 'express';
import { logService } from '../services/log.service';

/**
 * Configuration du Rate Limiting
 * Protège l'API contre les attaques par force brute et les abus
 */

/**
 * À qui imputer une requête : la personne si elle est connue, l'adresse IP
 * sinon.
 *
 * Le compte global était tenu par adresse. Derrière le NAT d'une mairie —
 * une seule adresse publique pour tout le monde — les mille requêtes par
 * quart d'heure étaient partagées entre tous les agents, soit environ
 * soixante-six par minute pour l'ensemble du service, alors qu'une seule
 * page en déclenche une dizaine. Le premier à travailler consommait le
 * budget des autres.
 *
 * Le jeton est *vérifié*, non pas seulement décodé : un identifiant forgé
 * ouvrirait sinon un compteur neuf à volonté, ce qui reviendrait à retirer
 * la limite. Une signature invalide retombe sur l'adresse, qui reste la
 * bonne unité pour le trafic anonyme — celui dont viennent les abus.
 */
function cleParPersonne(req: Request): string {
  const entete = req.headers.authorization;
  const jeton = entete?.startsWith('Bearer ') ? entete.slice(7) : null;

  if (jeton) {
    try {
      const charge = jwt.verify(jeton, getJwtSecret()) as { userId?: number };
      if (charge?.userId) return `u:${charge.userId}`;
    } catch {
      // Jeton absent, expiré ou signé d'un autre secret : on compte par IP.
    }
  }

  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

// Rate limiter global pour toutes les routes API
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // par personne connectée, ou par adresse pour le trafic anonyme
  keyGenerator: cleParPersonne,
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
    // Utilise l'IP (avec support IPv6) et l'email (si disponible) comme clé
    const email = req.body?.email || '';
    const ip = ipKeyGenerator(req.ip || '');
    return `${ip}-${email}`;
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

/**
 * Réception des demandes de manifestation.
 *
 * La route est ouverte : sans signature valide elle refuse, mais un tiers peut
 * toujours la marteler. Le seuil reste large — une commune peut recevoir
 * plusieurs demandes dans la même minute un lundi matin — et sert seulement à
 * empêcher qu'une boucle emballée remplisse le journal des réceptions.
 */
export const intakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: 'Trop de demandes reçues. Veuillez réessayer dans une minute.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
