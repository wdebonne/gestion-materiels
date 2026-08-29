import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Mot de passe plus ancien que la durée configurée par l'administrateur.
 *
 * Le réglage « expiration » existait dans Paramètres > Authentification sans
 * qu'aucune ligne ne le lise. Il est désormais appliqué — mais en signalement,
 * pas en blocage : refuser l'accès à un agent au fond d'un parc parce que son
 * mot de passe a 91 jours l'empêcherait de faire son travail sans rien
 * protéger de plus.
 *
 * Le bandeau reste tant que le mot de passe n'est pas renouvelé : il disparaît
 * à la connexion suivante, une fois la date de changement mise à jour.
 */
export default function PasswordExpiredBanner() {
  const passwordExpired = useAuthStore((s) => s.passwordExpired)

  if (!passwordExpired) return null

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <KeyRound className="h-5 w-5 flex-shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
          Votre mot de passe a dépassé la durée fixée par votre administrateur.
        </p>
        <Link
          to="/profile"
          className="touch-target inline-flex min-h-[44px] items-center rounded-lg bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
        >
          Le changer
        </Link>
      </div>
    </div>
  )
}
