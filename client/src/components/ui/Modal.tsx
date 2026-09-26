import { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFenetreModale } from './useFenetreModale'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
  /** Le nom annoncé quand la fenêtre n'a pas de titre visible. */
  ariaLabel?: string
  /** `alertdialog` pour une confirmation qui attend une réponse. */
  role?: 'dialog' | 'alertdialog'
}

/**
 * Fenêtre modale.
 *
 * Elle s'annonce comme telle (`role="dialog"`, nommée par son titre) : sans
 * cela, un lecteur d'écran lisait son contenu mêlé à la page derrière, sans
 * dire qu'une fenêtre s'était ouverte. Le focus y entre à l'ouverture, n'en
 * sort pas au clavier tant qu'elle est ouverte, et revient à la fermeture sur
 * le bouton qui l'avait ouverte — sans quoi l'utilisateur du clavier se
 * retrouvait en haut de la page.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  ariaLabel,
  role = 'dialog',
}: ModalProps) {
  const { ref: panneauRef, idTitre, proprietes } = useFenetreModale(isOpen, onClose)

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw]'
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panneauRef}
          {...proprietes}
          role={role}
          aria-labelledby={title ? idTitre : undefined}
          aria-label={title ? undefined : ariaLabel}
          className={cn(
            "relative bg-white rounded-xl shadow-xl w-full max-h-[90vh] overflow-hidden animate-slide-in outline-none dark:bg-gray-800",
            sizeClasses[size]
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              {title && (
                <h2 id={idTitre} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
              )}
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fermer"
                  title="Fermer"
                  className="p-2 text-gray-600 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors dark:hover:bg-gray-700 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          )}

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(90vh-8rem)]">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Composants utilitaires pour le contenu du modal
export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-6 py-4", className)}>
      {children}
    </div>
  )
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200 dark:bg-gray-900/40 dark:border-gray-700", className)}>
      {children}
    </div>
  )
}
