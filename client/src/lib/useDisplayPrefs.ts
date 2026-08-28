import { useEffect, useState } from 'react'

export type TextSize = 'normal' | 'large' | 'xlarge'

const TEXT_SIZE_KEY = 'display-text-size'
const HIGH_CONTRAST_KEY = 'display-high-contrast'

/** Taille de base du document. Toute l'échelle Tailwind étant en `rem`, la
 *  changer ici agrandit proportionnellement l'ensemble de l'interface. */
const ROOT_FONT_SIZE: Record<TextSize, string> = {
  normal: '16px',
  large: '18px',
  xlarge: '20px',
}

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  normal: 'Normal',
  large: 'Grand',
  xlarge: 'Très grand',
}

/** Lecture tolérante : en navigation privée, `localStorage` peut lever. */
function lire(cle: string): string | null {
  try {
    return localStorage.getItem(cle)
  } catch {
    return null
  }
}

/**
 * Préférences d'affichage, calquées sur `useDarkMode`.
 *
 * Un agent qui travaille dehors, en plein soleil ou sans ses lunettes, doit
 * pouvoir grossir le texte et renforcer le contraste sans passer par les
 * réglages de son téléphone.
 */
export function useDisplayPrefs() {
  const [textSize, setTextSize] = useState<TextSize>(() => {
    const enregistre = lire(TEXT_SIZE_KEY)
    return enregistre && enregistre in ROOT_FONT_SIZE ? (enregistre as TextSize) : 'normal'
  })
  const [highContrast, setHighContrast] = useState<boolean>(() => lire(HIGH_CONTRAST_KEY) === 'true')

  useEffect(() => {
    document.documentElement.style.fontSize = ROOT_FONT_SIZE[textSize]
    try {
      localStorage.setItem(TEXT_SIZE_KEY, textSize)
    } catch {
      /* navigation privée : la préférence ne survivra pas, ce n'est pas bloquant */
    }
  }, [textSize])

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast)
    try {
      localStorage.setItem(HIGH_CONTRAST_KEY, String(highContrast))
    } catch {
      /* idem */
    }
  }, [highContrast])

  return { textSize, setTextSize, highContrast, setHighContrast }
}
