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
const clesCalculees = new WeakMap<Request, string>();

function cleParPersonne(req: Request): string {
  const connue = clesCalculees.get(req);
  if (connue) return connue;
  const cle = calculerCle(req);
  clesCalculees.set(req, cle);
  return cle;
}

function calculerCle(req: Request): string {
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

/**
 * Le plafond d'une personne connectée est plus haut que celui d'une adresse.
 *
 * À mille, une trentaine de pages parcourues d'affilée suffisaient : chaque
 * écran charge une dizaine de listes, plus les compteurs d'alertes qui se
 * rafraîchissent seuls. Un agent qui fait le tour du parc un lundi matin
 * tombait dessus. Le compteur d'une personne n'est ouvert qu'à un jeton dont
 * la signature a été vérifiée : le relever ne desserre rien pour un inconnu,
 * qui reste à mille par adresse.
 */
export const PLAFOND_PERSONNE = 3000;
export const PLAFOND_ADRESSE = 1000;

// Rate limiter global pour toutes les routes API
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: (req: Request) => (cleParPersonne(req).startsWith('u:') ? PLAFOND_PERSONNE : PLAFOND_ADRESSE),
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

/**
 * Le portail des entreprises extérieures.
 *
 * Un compteur à lui, et non `intakeLimiter` : celui-ci est partagé par trois
 * préfixes publics, et une entreprise qui parcourt ses documents en
 * consommerait le budget. Large — une page du portail déclenche trois ou quatre
 * requêtes —, il sert à borner un robot, pas une personne.
 */
export const portailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req: Request) => `ip:${ipKeyGenerator(req.ip || '')}`,
  message: {
    success: false,
    message: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * La saisie du code d'accès d'une entreprise.
 *
 * Compté par adresse **et** par lien : dix essais manqués par quart d'heure
 * depuis un poste, sur un portail donné. Les réussites ne comptent pas — une
 * entreprise qui se reconnecte dix fois dans la journée n'a rien à se
 * reprocher. Le verrou du service, lui, ne tombe qu'après vingt échecs
 * d'affilée toutes adresses confondues.
 */
export const connexionPortailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `ip:${ipKeyGenerator(req.ip || '')}:${String(req.params?.lien ?? '').slice(0, 32)}`,
  message: {
    success: false,
    message: 'Trop d\'essais. Veuillez réessayer dans un quart d\'heure.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Cérémonies WebAuthn.
 *
 * `authLimiter` serait trop serré ici, et pour une mauvaise raison. Ses dix
 * tentatives par quart d'heure comptent des essais de mot de passe, qui se
 * devinent ; une passkey ne se devine pas — il faudrait produire la signature
 * d'un défi aléatoire par une clé privée qu'on ne possède pas. De plus une
 * connexion coûte deux appels, et la clé du limiteur d'authentification
 * comprend l'email, que la connexion sans mot de passe ne demande pas : tous
 * les agents d'une mairie derrière la même adresse publique partageraient le
 * même compteur, soit cinq connexions par quart d'heure pour tout le monde.
 *
 * Le seuil ci-dessous ne protège donc pas d'un devinage, mais du coût :
 * chaque défi émis est une ligne écrite en base.
 */
export const passkeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `passkey:${ipKeyGenerator(req.ip || '')}`
});
