import { NavLink } from 'react-router-dom'
import { Home, QrCode, Search, Bell, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MobileBottomBarProps {
  onOuvrirRecherche: () => void
  nombreAlertes?: number
}

/**
 * Navigation principale sur téléphone.
 *
 * L'application n'offrait qu'un menu burger : chaque déplacement demandait
 * d'ouvrir le tiroir, de lire douze entrées, puis de choisir. Les quatre gestes
 * réellement quotidiens méritent d'être à portée de pouce, en permanence.
 */
export default function MobileBottomBar({ onOuvrirRecherche, nombreAlertes }: MobileBottomBarProps) {
  const classes = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
      isActive
        ? 'text-primary-600 dark:text-primary-400'
        : 'text-gray-600 dark:text-gray-400'
    )

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white/95 backdrop-blur-md lg:hidden dark:border-gray-700 dark:bg-gray-800/95"
      // Respecte la zone réservée au geste système sur iPhone
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavLink to="/" end className={classes}>
        <Home className="h-6 w-6" />
        Accueil
      </NavLink>

      <NavLink to="/scan" className={classes}>
        <QrCode className="h-6 w-6" />
        Scanner
      </NavLink>

      <button onClick={onOuvrirRecherche} className={classes({ isActive: false })}>
        <Search className="h-6 w-6" />
        Chercher
      </button>

      <NavLink to="/alerts" className={classes}>
        <span className="relative">
          <Bell className="h-6 w-6" />
          {nombreAlertes ? (
            <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {nombreAlertes > 9 ? '9+' : nombreAlertes}
            </span>
          ) : null}
        </span>
        Alertes
      </NavLink>

      <NavLink to="/profile" className={classes}>
        <User className="h-6 w-6" />
        Profil
      </NavLink>
    </nav>
  )
}
