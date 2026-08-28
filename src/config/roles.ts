/**
 * Source unique du modèle de rôles.
 *
 * Le rôle était auparavant une chaîne libre recopiée dans huit tableaux
 * différents (`user.routes.ts`, `permission.routes.ts`, `swagger.ts`...) :
 * en ajouter un obligeait à tous les retrouver, et en oublier un produisait
 * un rôle à moitié fonctionnel — visible dans la liste mais impossible à
 * configurer dans l'écran Droits.
 */

export const ROLES = ['admin', 'supervisor', 'agent', 'user'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Rôles configurables dans l'écran Droits. L'administrateur en est exclu :
 * il a accès à tout par construction (voir `checkCategoryAccess`).
 */
export const CONFIGURABLE_ROLES = ['supervisor', 'agent', 'user'] as const;

/** Libellés affichés à l'utilisateur. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  supervisor: 'Superviseur',
  agent: 'Agent de terrain',
  user: 'Utilisateur',
};

/** Ce que chaque rôle est censé pouvoir faire, pour l'écran de gestion des comptes. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Accès complet, y compris la configuration de l'application.",
  supervisor: 'Gère le matériel, les référentiels et les droits sur son périmètre.',
  agent:
    "Saisit sur le terrain : pleins, entretiens, contrôles et photos. Ne peut ni configurer ni supprimer.",
  user: 'Consultation seule.',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
