import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /**
   * Ce que fait le bouton, en clair. **Obligatoire.**
   *
   * L'application comptait 175 boutons-icônes identifiés uniquement par un
   * attribut `title` — une infobulle qui ne s'affiche jamais au doigt. Un
   * utilisateur sur tablette n'avait aucun moyen de savoir ce que faisait
   * une icône avant d'appuyer dessus.
   */
  label: string
  icon: ReactNode
  variant?: 'default' | 'danger' | 'primary'
  /** Affiche le libellé sous l'icône (utile sur les écrans peu denses). */
  showLabel?: boolean
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, icon, variant = 'default', showLabel = false, ...props }, ref) => {
    const variantClasses = {
      default:
        'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100',
      primary:
        'text-primary-600 hover:bg-primary-50 focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-primary-900/30',
      danger:
        'text-red-600 hover:bg-red-50 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-900/30',
    }

    return (
      <button
        ref={ref}
        // `title` pour la souris, `aria-label` pour les lecteurs d'écran.
        title={label}
        aria-label={label}
        className={cn(
          'inline-flex flex-shrink-0 items-center justify-center rounded-lg transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
          // 44 px minimum : en dessous, la cible est manquée une fois sur trois
          // au doigt, et systématiquement avec des gants.
          showLabel ? 'min-h-[44px] min-w-[44px] flex-col gap-0.5 px-2 py-1' : 'h-11 w-11',
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {icon}
        {showLabel && <span className="text-xs leading-none">{label}</span>}
      </button>
    )
  }
)

IconButton.displayName = 'IconButton'

export default IconButton
