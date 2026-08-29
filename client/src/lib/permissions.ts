import { useAuthStore } from '@/stores/auth.store'

/**
 * Modèle de rôles, côté client.
 *
 * Doit rester le miroir exact de `src/config/roles.ts` et des gardes appliqués
 * aux routes : un bouton affiché à quelqu'un que le serveur va refuser est pire
 * que pas de bouton du tout — l'utilisateur remplit un formulaire pour rien.
 */

export const ROLES = ['admin', 'supervisor', 'agent', 'user', 'service'] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  supervisor: 'Superviseur',
  agent: 'Agent de terrain',
  user: 'Utilisateur',
  service: 'Service partenaire',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Accès complet, y compris la configuration de l'application.",
  supervisor: 'Gère le matériel, les référentiels et les droits sur son périmètre.',
  agent:
    'Saisit sur le terrain : pleins, entretiens, contrôles et photos. Ne peut ni configurer ni supprimer.',
  user: 'Consultation seule.',
  service:
    'Ne voit que les manifestations qui le concernent : suivi, approbations et échanges.',
}

/** Rôles configurables dans l'écran Droits (l'administrateur a tout par construction). */
export const CONFIGURABLE_ROLES = ['supervisor', 'agent', 'user', 'service'] as const

/**
 * Rôles autorisés à saisir des données de terrain.
 *
 * ⚠️ Cette liste doit correspondre exactement à `requireFieldWrite`
 * (`src/middleware/auth.middleware.ts`). Les faire diverger ramène le problème
 * des boutons qui mentent.
 */
const FIELD_WRITE_ROLES: readonly Role[] = ['admin', 'supervisor', 'agent']

/** Rôles autorisés à gérer le matériel et les référentiels (`requireSupervisor`). */
const MANAGE_ROLES: readonly Role[] = ['admin', 'supervisor']

export interface Permissions {
  /** Relever un plein, un entretien, un contrôle, joindre une photo. */
  canFieldWrite: boolean
  /** Cloisonné au seul module Manifestations : la navigation doit s'y réduire. */
  isService: boolean
  /** Créer ou modifier du matériel, gérer les référentiels et les listes. */
  canManage: boolean
  /** Supprimer, configurer l'application, gérer les comptes. */
  canAdmin: boolean
  role: Role | undefined
}

export function usePermissions(): Permissions {
  const user = useAuthStore((state) => state.user)
  const role = user?.role as Role | undefined

  return {
    canFieldWrite: !!role && FIELD_WRITE_ROLES.includes(role),
    isService: role === 'service',
    canManage: !!role && MANAGE_ROLES.includes(role),
    canAdmin: role === 'admin',
    role,
  }
}
