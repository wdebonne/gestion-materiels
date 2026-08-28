import { ReactNode } from 'react'
import { usePermissions } from '@/lib/permissions'

interface CanProps {
  /** Saisie de terrain : plein, entretien, contrôle, photo. */
  fieldWrite?: boolean
  /** Gestion du matériel et des référentiels. */
  manage?: boolean
  /** Configuration de l'application, suppressions. */
  admin?: boolean
  /** Affiché à la place quand le droit manque (rien par défaut). */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Masque une action que le serveur refuserait.
 *
 * Avant, l'interface affichait « Ajouter un plein », « Nouvel espace vert » ou
 * « Supprimer » à tout le monde : l'utilisateur remplissait le formulaire,
 * appuyait, et rien ne se passait. Le 403 n'était intercepté nulle part.
 */
export default function Can({ fieldWrite, manage, admin, fallback = null, children }: CanProps) {
  const permissions = usePermissions()

  const allowed =
    (admin && permissions.canAdmin) ||
    (manage && permissions.canManage) ||
    (fieldWrite && permissions.canFieldWrite)

  return <>{allowed ? children : fallback}</>
}
