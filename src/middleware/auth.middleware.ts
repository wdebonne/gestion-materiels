import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database';

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
    res.status(401).json({ success: false, message: 'Token d\'authentification requis' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
    
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

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
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
};

export const requireAdmin = requireRole('admin');
export const requireSupervisor = requireRole('admin', 'supervisor');

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
