import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
 * Les fenêtres ouvertes, de la plus ancienne à celle du dessus.
 *
 * Chaque fenêtre écoutait Échap sur tout le document : avec une confirmation
 * ouverte par-dessus un formulaire, une seule touche fermait les deux, et le
 * formulaire se perdait. Seule celle du dessus répond désormais. La page ne
 * défile de nouveau que quand la dernière est fermée.
 */
const pile: symbol[] = []

const FOCALISABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focalisables(conteneur: HTMLElement): HTMLElement[] {
  return Array.from(conteneur.querySelectorAll<HTMLElement>(FOCALISABLES)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  )
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
  const idTitre = useId()
  const panneauRef = useRef<HTMLDivElement>(null)
  // `onClose` est souvent une fonction recréée à chaque rendu : la lire par
  // référence évite de rouvrir la fenêtre dans la pile à chaque rendu.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen) return
    const moi = Symbol('modale')
    pile.push(moi)
    document.body.style.overflow = 'hidden'

    // Le focus : sur l'élément marqué `autoFocus` s'il y en a un (déjà placé
    // au montage), sinon sur le premier élément utilisable, sinon la fenêtre.
    const precedent = document.activeElement as HTMLElement | null
    const panneau = panneauRef.current
    if (panneau && !panneau.contains(document.activeElement)) {
      const cible = focalisables(panneau)[0] ?? panneau
      cible.focus()
    }

    const surEchap = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pile[pile.length - 1] === moi) onCloseRef.current()
    }
    document.addEventListener('keydown', surEchap)

    return () => {
      document.removeEventListener('keydown', surEchap)
      pile.splice(pile.indexOf(moi), 1)
      if (pile.length === 0) document.body.style.overflow = ''
      // Rendre le focus là où il était, si cet élément existe encore.
      if (precedent && precedent.isConnected) precedent.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  // Tab et Maj+Tab tournent dans la fenêtre au lieu de partir dans la page derrière.
  const garderLeFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panneauRef.current) return
    const liste = focalisables(panneauRef.current)
    if (liste.length === 0) {
      e.preventDefault()
      return
    }
    const premier = liste[0]
    const dernier = liste[liste.length - 1]
    if (e.shiftKey && (document.activeElement === premier || document.activeElement === panneauRef.current)) {
      e.preventDefault()
      dernier.focus()
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault()
      premier.focus()
    }
  }

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
          role={role}
          aria-modal="true"
          aria-labelledby={title ? idTitre : undefined}
          aria-label={title ? undefined : ariaLabel}
          tabIndex={-1}
          onKeyDown={garderLeFocus}
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
