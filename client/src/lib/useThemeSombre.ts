import { useEffect, useState } from 'react'

/**
 * Le thème effectivement appliqué, et non celui que l'utilisateur a choisi.
 *
 * `useDarkMode` rend `'light' | 'dark' | 'system'` : ce que la personne a
 * réglé. Un graphique, lui, a besoin de savoir de quelle couleur est la surface
 * sur laquelle il se dessine — ce qui, en mode « système », dépend du système
 * d'exploitation et peut changer sans que le réglage bouge.
 *
 * La classe `dark` posée sur `<html>` est la seule source qui connaisse déjà la
 * réponse dans les trois cas. On l'observe plutôt que de refaire le calcul, ce
 * qui éviterait de devoir le tenir en phase avec `useDarkMode`.
 *
 * Les couleurs de Recharts sont des attributs SVG, pas des propriétés CSS :
 * elles ne se redéfinissent pas sous un sélecteur `.dark` et doivent donc être
 * calculées en JavaScript au moment du rendu.
 */
export function useThemeSombre(): boolean {
  const [sombre, setSombre] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const racine = document.documentElement
    const relire = () => setSombre(racine.classList.contains('dark'))

    relire()
    const observateur = new MutationObserver(relire)
    observateur.observe(racine, { attributes: true, attributeFilter: ['class'] })
    return () => observateur.disconnect()
  }, [])

  return sombre
}
