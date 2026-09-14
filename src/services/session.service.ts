import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import type { AuthRequest, JwtPayload } from '../middleware/auth.middleware';
import { getJwtSecret } from '../config/secrets';
import { logService } from './log.service';
import { notifierWebhooks } from './webhook.service';
import { lirePolitique, motDePasseExpire, type PolitiqueAuth } from './passwordPolicy.service';

/**
 * Ouvrir une session, quelle que soit la porte empruntée.
 *
 * Une connexion réussie ne se résume pas à signer un jeton : elle remet à zéro
 * le compteur d'échecs, débloque le compte, date la dernière venue, écrit deux
 * journaux, notifie les webhooks et pose le cookie qui donne accès aux fichiers
 * joints. Tout cela vivait dans le corps de `POST /auth/login`.
 *
 * L'arrivée des passkeys ouvre une deuxième porte, et une troisième avec le
 * second facteur. Recopier ces sept gestes à chaque fois, c'est se garantir
 * qu'une porte finira par en oublier un — le compteur d'échecs jamais remis à
 * zéro, par exemple, bloquerait un compte qui vient pourtant de se connecter.
 * Ils tiennent donc ici, une fois.
 */

/** Par où la personne est entrée. Apparaît tel quel dans les journaux. */
export type MoyenDeConnexion = 'mot de passe' | 'passkey' | 'mot de passe + passkey';

/** Compte tel que les routes d'authentification le lisent en base. */
export interface CompteConnecte {
  id: number;
  email: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar?: string | null;
  password_changed_at?: string | null;
  token_version?: number | null;
}

/** Jetons d'accès et de rafraîchissement, à la version courante du compte. */
export function genererJetons(user: CompteConnecte): {
  accessToken: string;
  refreshToken: string;
} {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tv: user.token_version ?? 0,
  };

  const accessToken = jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  } as jwt.SignOptions);

  return { accessToken, refreshToken };
}

/**
 * Cookie HttpOnly donnant accès aux fichiers déposés.
 *
 * Les pièces jointes sont servies par `<img src>` et par des liens, qui ne
 * portent pas d'en-tête d'autorisation : c'est ce cookie, et non le jeton du
 * magasin, qui les rend lisibles.
 */
export function poserCookieSession(res: Response, accessToken: string): void {
  res.cookie('auth_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
}

/** Ce que le client reçoit d'une connexion réussie. */
export interface SessionOuverte {
  success: true;
  user: {
    id: number;
    email: string;
    firstName: string | null | undefined;
    lastName: string | null | undefined;
    role: string;
    avatar: string | null | undefined;
  };
  /**
   * Signalé, jamais bloquant : refuser l'accès à un agent en extérieur parce
   * que son mot de passe a 91 jours coûte plus qu'il ne protège. Le client
   * affiche un bandeau tant qu'il n'est pas renouvelé.
   */
  passwordExpired: boolean;
  accessToken: string;
  refreshToken: string;
}

/**
 * Tout ce qui suit une authentification réussie, avant la réponse.
 *
 * `politique` est passée quand l'appelant l'a déjà lue — c'est le cas de la
 * connexion par mot de passe, qui s'en sert pour le blocage de compte — pour ne
 * pas la relire à deux pas d'intervalle.
 */
export async function ouvrirSession(
  user: CompteConnecte,
  req: AuthRequest,
  res: Response,
  moyen: MoyenDeConnexion,
  politique?: PolitiqueAuth
): Promise<SessionOuverte> {
  // Le compteur d'échecs repart de zéro, et un blocage arrivé à terme est
  // effacé : la personne vient de prouver qui elle est.
  await db.execute(
    'UPDATE users SET last_login = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [new Date().toISOString(), user.id]
  );

  const jetons = genererJetons(user);

  try {
    await db.execute(
      'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [user.id, 'login', `Connexion réussie (${moyen})`, req.ip]
    );
  } catch (e) {
    // La table activity_logs n'existe peut-être pas
  }

  await logService.success(
    'auth',
    'Connexion réussie',
    { role: user.role, moyen },
    {
      userId: user.id,
      userEmail: user.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }
  );

  notifierWebhooks('user.login', { id: user.id, email: user.email, role: user.role, moyen });

  poserCookieSession(res, jetons.accessToken);

  const enVigueur = politique ?? (await lirePolitique());

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      avatar: user.avatar,
    },
    passwordExpired: motDePasseExpire(user.password_changed_at, enVigueur),
    ...jetons,
  };
}
