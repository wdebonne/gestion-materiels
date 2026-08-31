/**
 * Source unique du modèle de rôles.
 *
 * Le rôle était auparavant une chaîne libre recopiée dans huit tableaux
 * différents (`user.routes.ts`, `permission.routes.ts`, `swagger.ts`...) :
 * en ajouter un obligeait à tous les retrouver, et en oublier un produisait
 * un rôle à moitié fonctionnel — visible dans la liste mais impossible à
 * configurer dans l'écran Droits.
 *
 * `service` n'est pas un cran de plus sur l'échelle des pouvoirs : c'est un
 * accès *latéral*, qui écrit dans les manifestations qui le concernent et ne
 * voit rien du reste. Le service communication suit les manifestations, le
 * service informatique approuve le prêt d'un vidéoprojecteur ; ni l'un ni
 * l'autre n'a à connaître les pleins de carburant ou les entretiens. Le
 * cloisonnement est appliqué par `restreindreAuxManifestations`.
 */

export const ROLES = ['admin', 'supervisor', 'agent', 'user', 'service'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Rôles configurables dans l'écran Droits. L'administrateur en est exclu :
 * il a accès à tout par construction (voir `checkCategoryAccess`).
 */
export const CONFIGURABLE_ROLES = ['supervisor', 'agent', 'user', 'service'] as const;

/** Libellés affichés à l'utilisateur. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  supervisor: 'Superviseur',
  agent: 'Agent de terrain',
  user: 'Utilisateur',
  service: 'Service partenaire',
};

/** Ce que chaque rôle est censé pouvoir faire, pour l'écran de gestion des comptes. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Accès complet, y compris la configuration de l'application.",
  supervisor: 'Gère le matériel, les référentiels et les droits sur son périmètre.',
  agent:
    "Saisit sur le terrain : pleins, entretiens, contrôles et photos. Ne peut ni configurer ni supprimer.",
  user: 'Consultation seule.',
  service:
    "Ne voit que les manifestations qui le concernent : suivi, approbations et échanges. " +
    'Aucun accès au parc, aux entretiens ni à la configuration.',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
