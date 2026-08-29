import { useCallback, useState } from 'react'

export interface Position {
  lat: number
  lng: number
  /** Rayon d'incertitude en mètres, tel que rapporté par l'appareil. */
  accuracy: number
}

/**
 * Relevé de position par l'appareil.
 *
 * L'application ne faisait jusqu'ici aucun appel à `navigator.geolocation` :
 * pour situer un massif ou un arbre, l'agent devait saisir une latitude et une
 * longitude à sept décimales, dans deux champs numériques libres. Sur le
 * terrain, personne ne connaît ces chiffres.
 */

/** Messages compréhensibles, à la place des codes d'erreur de la norme. */
function messageErreur(erreur: GeolocationPositionError): string {
  switch (erreur.code) {
    case erreur.PERMISSION_DENIED:
      return "Localisation refusée. Autorisez l'accès à votre position dans les réglages du navigateur."
    case erreur.POSITION_UNAVAILABLE:
      return 'Signal GPS trop faible. Placez-vous à découvert et réessayez.'
    case erreur.TIMEOUT:
      return "La localisation a pris trop de temps. Réessayez."
    default:
      return "Impossible de relever votre position."
  }
}

export function useGeolocation() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator

  const getPosition = useCallback(
    (options?: { timeout?: number }): Promise<Position> => {
      setError(null)

      if (!supported) {
        const message = "Cet appareil ne sait pas donner sa position."
        setError(message)
        return Promise.reject(new Error(message))
      }

      setLoading(true)

      return new Promise<Position>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLoading(false)
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            })
          },
          (err) => {
            setLoading(false)
            const message = messageErreur(err)
            setError(message)
            reject(new Error(message))
          },
          {
            enableHighAccuracy: true,
            // Dehors, un premier point peut mettre plusieurs secondes à arriver.
            timeout: options?.timeout ?? 15000,
            maximumAge: 0,
          }
        )
      })
    },
    [supported]
  )

  return { getPosition, loading, error, supported }
}

/** Coordonnée affichée : 6 décimales suffisent (précision ~10 cm). */
export function formatCoord(valeur: number): string {
  return valeur.toFixed(6)
}
