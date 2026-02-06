import { Request, Response, NextFunction } from 'express';
import { logService } from '../services/log.service';

/**
 * Middleware de redirection HTTP vers HTTPS
 * Actif uniquement en production
 */
export const httpsRedirect = (req: Request, res: Response, next: NextFunction): void => {
  // Ne pas rediriger en développement
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Vérifier si la requête est déjà en HTTPS
  // Prendre en compte les proxies (Nginx, load balancer, etc.)
  const isHttps = 
    req.secure || // Connexion directe HTTPS
    req.headers['x-forwarded-proto'] === 'https' || // Derrière un proxy
    req.headers['x-forwarded-ssl'] === 'on';

  if (!isHttps) {
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    
    // Logger la redirection
    logService.info('security', 'Redirection HTTP vers HTTPS', {
      originalUrl: `http://${req.headers.host}${req.url}`,
      redirectTo: httpsUrl,
      ip: req.ip
    }, {
      ipAddress: req.ip,
      requestPath: req.path,
      requestMethod: req.method
    });

    // Redirection permanente (301) avec HSTS
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.redirect(301, httpsUrl);
    return;
  }

  // Ajouter le header HSTS pour les connexions HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
};

/**
 * Middleware pour vérifier la configuration HTTPS
 * Utile pour le debugging et les health checks
 */
export const httpsStatus = (req: Request, res: Response): void => {
  const isHttps = 
    req.secure || 
    req.headers['x-forwarded-proto'] === 'https' || 
    req.headers['x-forwarded-ssl'] === 'on';

  res.json({
    success: true,
    https: {
      enabled: isHttps,
      protocol: isHttps ? 'https' : 'http',
      forwardedProto: req.headers['x-forwarded-proto'],
      forwardedSsl: req.headers['x-forwarded-ssl'],
      secure: req.secure,
      environment: process.env.NODE_ENV
    }
  });
};
