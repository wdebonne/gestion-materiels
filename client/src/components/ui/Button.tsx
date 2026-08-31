import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  /** `icon` : carré de 44 px pour un bouton sans texte. */
  size?: 'sm' | 'md' | 'lg' | 'icon'
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className, 
    variant = 'primary', 
    size = 'md', 
    loading = false, 
    icon,
    children, 
    disabled,
    ...props 
  }, ref) => {
    // `focus-visible` et non `focus` : l'anneau ne doit apparaître qu'à la
    // navigation au clavier, pas à chaque clic de souris.
    const baseClasses = "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"

    const variantClasses = {
      primary: "bg-gradient-to-r from-primary-600 to-primary-500 text-white hover:from-primary-700 hover:to-primary-600 focus-visible:ring-primary-500 shadow-sm hover:shadow-md border border-transparent",
      secondary: "bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-200 border border-gray-200 shadow-sm dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600",
      danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 focus-visible:ring-red-500 dark:bg-red-900/30 dark:text-red-300 dark:border-red-900 dark:hover:bg-red-900/50",
      ghost: "text-gray-600 hover:bg-gray-100 focus-visible:ring-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white",
      outline: "border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-primary-500 hover:border-gray-400"
    }

    // Hauteurs minimales : une cible tactile descend difficilement sous 44 px,
    // et l'application est utilisée dehors, parfois avec des gants.
    // `sm` reste plus compact car il sert dans les barres d'outils denses,
    // mais ne descend plus sous 40 px.
    const sizeClasses = {
      sm: "min-h-[40px] px-3 py-1.5 text-sm gap-1.5",
      md: "min-h-[44px] px-4 py-2 text-sm gap-2",
      lg: "min-h-[52px] px-6 py-3 text-base gap-2",
      icon: "h-11 w-11 p-0 flex-shrink-0"
    }

    return (
      <button
        ref={ref}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : icon ? (
          <span className="flex-shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

export default Button
