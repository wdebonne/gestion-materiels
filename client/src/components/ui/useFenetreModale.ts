import { KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from 'react'

/**
 * Ce qui fait d'un bloc une fenêtre modale, pour un lecteur d'écran et au
 * clavier. `Modal` s'en sert, et les fenêtres dessinées à la main aussi : la
 * règle est écrite une fois.
 *
 *   - elle s'annonce (`role="dialog"`, `aria-modal`) — à l'appelant de la
 *     nommer, par `aria-labelledby={idTitre}` sur son titre, ou `aria-label` ;
 *   - le focus y entre à l'ouverture, n'en sort pas au clavier, et revient à
 *     la fermeture sur l'élément qui l'avait ouverte ;
 *   - Échap ferme la fenêtre du dessus, et seulement elle ;
 *   - la page derrière ne défile plus tant qu'une fenêtre est ouverte.
 */

/**
 * Les fenêtres ouvertes, de celle du dessous à celle du dessus.
 *
 * Chaque fenêtre écoutait Échap sur tout le document : une confirmation
 * ouverte par-dessus un formulaire les fermait toutes les deux. Seule celle du
 * dessus répond ; la page ne défile de nouveau qu'une fois la dernière fermée.
 *
 * L'ordre d'ouverture ne suffit pas : une fenêtre et celle qu'elle contient,
 * montées ensemble, voient l'effet de l'enfant passer avant celui du parent.
 * Une fenêtre qui en contient une autre se range donc sous elle.
 */
const pile: Array<{ id: symbol; element: HTMLElement | null }> = []

function empiler(entree: { id: symbol; element: HTMLElement | null }) {
  const contenue = pile.findIndex((e) => !!entree.element && !!e.element && entree.element.contains(e.element))
  if (contenue === -1) pile.push(entree)
  else pile.splice(contenue, 0, entree)
}

const FOCALISABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

function focalisables(conteneur: HTMLElement): HTMLElement[] {
  return Array.from(conteneur.querySelectorAll<HTMLElement>(FOCALISABLES)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  )
}

export function useFenetreModale<T extends HTMLElement = HTMLDivElement>(ouvert: boolean, onFermer: () => void) {
  const ref = useRef<T>(null)
  const idTitre = useId()
  // `onFermer` est souvent recréée à chaque rendu : la lire par référence
  // évite de replacer la fenêtre dans la pile à chaque rendu.
  const onFermerRef = useRef(onFermer)
  onFermerRef.current = onFermer

  useEffect(() => {
    if (!ouvert) return
    const moi = Symbol('fenetre')
    empiler({ id: moi, element: ref.current })
    document.body.style.overflow = 'hidden'

    // Sur l'élément marqué `autoFocus` s'il y en a un (déjà placé au montage),
    // sinon sur le premier élément utilisable, sinon sur la fenêtre elle-même.
    const precedent = document.activeElement as HTMLElement | null
    const fenetre = ref.current
    if (fenetre && !fenetre.contains(document.activeElement)) {
      const cible = focalisables(fenetre)[0] ?? fenetre
      cible.focus()
    }

    const surEchap = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pile[pile.length - 1]?.id === moi) onFermerRef.current()
    }
    document.addEventListener('keydown', surEchap)

    return () => {
      document.removeEventListener('keydown', surEchap)
      pile.splice(pile.findIndex((e) => e.id === moi), 1)
      if (pile.length === 0) document.body.style.overflow = ''
      // Rendre le focus là où il était, si cet élément existe encore.
      if (precedent && precedent.isConnected) precedent.focus()
    }
  }, [ouvert])

  // Tab et Maj+Tab tournent dans la fenêtre au lieu de partir dans la page derrière.
  const onKeyDown = (e: ReactKeyboardEvent<T>) => {
    const fenetre = ref.current
    if (e.key !== 'Tab' || !fenetre || e.defaultPrevented) return
    // Une touche tapée dans une fenêtre contenue remonte jusqu'ici : c'est à elle d'en décider.
    if ((e.target as HTMLElement).closest('[aria-modal="true"]') !== fenetre) return
    const liste = focalisables(fenetre)
    if (liste.length === 0) {
      e.preventDefault()
      return
    }
    const premier = liste[0]
    const dernier = liste[liste.length - 1]
    if (e.shiftKey && (document.activeElement === premier || document.activeElement === fenetre)) {
      e.preventDefault()
      dernier.focus()
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault()
      premier.focus()
    }
  }

  return {
    ref,
    idTitre,
    /** À étaler sur l'élément qui contient la fenêtre (pas sur le fond grisé). */
    proprietes: {
      role: 'dialog' as 'dialog' | 'alertdialog',
      'aria-modal': true as const,
      tabIndex: -1,
      onKeyDown,
    },
  }
}
