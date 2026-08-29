import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../database';
import { getJwtSecret } from '../config/secrets';

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // Vérifier si un token API est fourni via X-API-Token
    const apiToken = req.headers['x-api-token'] as string;
    if (apiToken) {
      return authenticateApiToken(apiToken, req, res, next);
    }
    res.status(401).json({ success: false, message: 'Token d\'authentification requis' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    
    // Vérifier que l'utilisateur existe toujours et est actif
    const user = await db.queryOne(
      'SELECT id, email, role, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user || !user.is_active) {
      res.status(401).json({ success: false, message: 'Utilisateur non trouvé ou désactivé' });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Token invalide ou expiré' });
  }
};

/**
 * Authentifie une requête via un token API (header X-API-Token)
 */
/** Permissions qu'un token API peut porter, telles que proposées à l'administrateur. */
export const PERMISSIONS_TOKEN = ['read', 'write', 'delete'] as const;
export type PermissionToken = (typeof PERMISSIONS_TOKEN)[number];

const LIBELLE_PERMISSION: Record<PermissionToken, string> = {
  read: 'Lecture',
  write: 'Écriture',
  delete: 'Suppression',
};

/**
 * Permission exigée par une méthode HTTP.
 *
 * Le découpage est celui affiché dans l'écran des tokens : lecture pour GET,
 * écriture pour POST/PUT/PATCH, suppression pour DELETE. Une méthode inconnue
 * est traitée comme une écriture, pour ne jamais élargir par défaut.
 */
export function permissionRequise(methode: string): PermissionToken {
  switch (methode.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'DELETE':
      return 'delete';
    default:
      return 'write';
  }
}

/**
 * Permissions stockées sur un token, ramenées à une liste sûre.
 *
 * Colonne absente, JSON corrompu ou valeur inconnue : on retombe sur la lecture
 * seule plutôt que d'ouvrir des droits qu'un administrateur n'a pas accordés.
 */
export function lirePermissions(brut: unknown): PermissionToken[] {
  let valeurs: unknown;
  try {
    valeurs = typeof brut === 'string' ? JSON.parse(brut) : brut;
  } catch {
    return ['read'];
  }

  if (!Array.isArray(valeurs)) return ['read'];

  const retenues = valeurs.filter((v): v is PermissionToken =>
    PERMISSIONS_TOKEN.includes(v as PermissionToken)
  );
  return retenues.length > 0 ? retenues : ['read'];
}

async function authenticateApiToken(
  rawToken: string,
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const apiToken = await db.queryOne(
      'SELECT t.*, u.email, u.role, u.is_active FROM api_tokens t JOIN users u ON t.created_by = u.id WHERE t.token_hash = ?',
      [tokenHash]
    );

    if (!apiToken || !apiToken.is_active) {
      res.status(401).json({ success: false, message: 'Token API invalide ou désactivé' });
      return;
    }

    if (!apiToken.is_active) {
      res.status(401).json({ success: false, message: 'Le compte utilisateur associé est désactivé' });
      return;
    }

    // Vérifier l'expiration
    if (apiToken.expires_at && new Date(apiToken.expires_at) < new Date()) {
      res.status(401).json({ success: false, message: 'Token API expiré' });
      return;
    }

    // Mettre à jour last_used_at
    const now = new Date().toISOString();
    db.execute('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [now, apiToken.id]).catch(() => {});

    // Attacher les infos utilisateur (le token hérite du rôle du créateur)
    req.user = {
      userId: apiToken.created_by,
      email: apiToken.email,
      role: apiToken.role
    };

    // Les permissions du token limitent ce qu'il peut faire, en plus du rôle
    // hérité de son créateur. Elles étaient lues puis ignorées : un token
    // « lecture seule » pouvait supprimer autant que son créateur.
    const permissions = lirePermissions(apiToken.permissions);
    (req as any).apiTokenPermissions = permissions;

    const requise = permissionRequise(req.method);
    if (!permissions.includes(requise)) {
      res.status(403).json({
        success: false,
        message: `Ce token API n'a pas la permission « ${LIBELLE_PERMISSION[requise]} »`
      });
      return;
    }

    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Erreur de validation du token API' });
  }
}

/** Garde de rôle, portant la liste des rôles autorisés pour pouvoir être inspectée. */
export interface RoleGuard {
  (req: AuthRequest, res: Response, next: NextFunction): void;
  /** Rôles acceptés. Exposés pour que les tests vérifient le contrat de chaque route. */
  allowedRoles: readonly string[];
}

export const requireRole = (...roles: string[]): RoleGuard => {
  const guard = (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Accès refusé - Rôle insuffisant' });
      return;
    }

    next();
  };

  guard.allowedRoles = roles as readonly string[];
  return guard;
};

export const requireAdmin = requireRole('admin');
export const requireSupervisor = requireRole('admin', 'supervisor');

/**
 * Saisie de terrain : relever un plein, un entretien, un contrôle, joindre une
 * photo. Ces gestes sont le quotidien des agents et ne doivent pas exiger le
 * rôle de superviseur, qui donne au passage la suppression du matériel et la
 * configuration des seuils d'alerte.
 */
export const requireFieldWrite = requireRole('admin', 'supervisor', 'agent');

// ==================== HELPERS PERMISSIONS CATÉGORIES ====================

/**
 * Vérifie si un utilisateur a accès (vue) à une catégorie donnée
 */
export async function checkCategoryAccess(userId: number, userRole: string, categoryId: number): Promise<boolean> {
  if (userRole === 'admin') return true;
  
  // Vérifier les permissions du groupe
  const groupPermission = await db.queryOne(
    'SELECT can_view FROM group_permissions WHERE role = ? AND category_id = ? AND can_view = 1',
    [userRole, categoryId]
  );
  
  if (groupPermission) return true;
  
  // Vérifier les permissions individuelles
  const userPermission = await db.queryOne(
    'SELECT can_view FROM user_permissions WHERE user_id = ? AND category_id = ? AND can_view = 1',
    [userId, categoryId]
  );
  
  return !!userPermission;
}

/**
 * Vérifie si un utilisateur a une permission spécifique (view/edit/delete) sur une catégorie
 */
export async function checkCategoryPermission(
  userId: number, 
  userRole: string, 
  categoryId: number, 
  permission: 'can_view' | 'can_edit' | 'can_delete'
): Promise<boolean> {
  if (userRole === 'admin') return true;
  
  // Vérifier les permissions du groupe
  const groupPermission = await db.queryOne(
    `SELECT ${permission} FROM group_permissions WHERE role = ? AND category_id = ? AND ${permission} = 1`,
    [userRole, categoryId]
  );
  
  if (groupPermission) return true;
  
  // Vérifier les permissions individuelles
  const userPermission = await db.queryOne(
    `SELECT ${permission} FROM user_permissions WHERE user_id = ? AND category_id = ? AND ${permission} = 1`,
    [userId, categoryId]
  );
  
  return !!userPermission;
}

/**
 * Récupère les IDs des catégories accessibles (vue) par un utilisateur
 */
export async function getAccessibleCategoryIds(userId: number, userRole: string): Promise<number[] | null> {
  // Admin a accès à tout — retourne null pour signifier "pas de filtre"
  if (userRole === 'admin') return null;
  
  // Permissions du groupe
  const groupPerms = await db.query(
    'SELECT category_id FROM group_permissions WHERE role = ? AND can_view = 1',
    [userRole]
  );
  
  // Permissions individuelles
  const userPerms = await db.query(
    'SELECT category_id FROM user_permissions WHERE user_id = ? AND can_view = 1',
    [userId]
  );
  
  const categoryIds = new Set<number>();
  groupPerms.forEach((p: any) => categoryIds.add(p.category_id));
  userPerms.forEach((p: any) => categoryIds.add(p.category_id));
  
  return Array.from(categoryIds);
}
