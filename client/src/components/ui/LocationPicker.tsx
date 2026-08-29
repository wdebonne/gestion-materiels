import { useState } from 'react'
import { MapPin, Crosshair, X, Pencil, ExternalLink } from 'lucide-react'
import { useGeolocation, formatCoord } from '@/lib/useGeolocation'

interface LocationPickerProps {
  latitude: string
  longitude: string
  onChange: (latitude: string, longitude: string) => void
  label?: string
  /** Libellés compacts, pour les formulaires denses. */
  compact?: boolean
}

/**
 * Relevé de position.
 *
 * Remplace deux champs numériques libres (« Latitude », placeholder
 * « ex: 48.8566 ») que personne ne peut renseigner depuis le terrain. La
 * saisie manuelle reste possible, mais repliée : c'est le cas rare.
 */
export default function LocationPicker({
  latitude,
  longitude,
  onChange,
  label = 'Position',
  compact = false,
}: LocationPickerProps) {
  const { getPosition, loading, error, supported } = useGeolocation()
  const [precision, setPrecision] = useState<number | null>(null)
  const [saisieManuelle, setSaisieManuelle] = useState(false)

  const renseignee = Boolean(latitude && longitude)

  const releverPosition = async () => {
    try {
      const pos = await getPosition()
      onChange(formatCoord(pos.lat), formatCoord(pos.lng))
      setPrecision(Math.round(pos.accuracy))
    } catch {
      // Le message est déjà porté par `error`
    }
  }

  const effacer = () => {
    onChange('', '')
    setPrecision(null)
  }

  const tailleLabel = compact
    ? 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'
    : 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <div>
      <label className={tailleLabel}>{label}</label>

      {renseignee ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
          <MapPin className="h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-gray-900 dark:text-gray-100">
              {latitude}, {longitude}
            </p>
            {precision !== null && (
              <p className="text-xs text-gray-600 dark:text-gray-400">Précision : ±{precision} m</p>
            )}
          </div>
          <a
            href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Voir sur la carte"
            aria-label="Voir sur la carte"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={effacer}
            title="Effacer la position"
            aria-label="Effacer la position"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={releverPosition}
          disabled={loading || !supported}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-green-600 px-4 font-medium text-green-700 transition-colors hover:bg-green-50 disabled:opacity-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-900/30"
        >
          {loading ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
              Recherche du signal…
            </>
          ) : (
            <>
              <Crosshair className="h-5 w-5" />
              Utiliser ma position
            </>
          )}
        </button>
      )}

      {error && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {!supported && !error && (
        <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
          Cet appareil ne sait pas donner sa position : saisissez-la à la main.
        </p>
      )}

      {/* La saisie manuelle reste possible, mais ce n'est plus le chemin principal. */}
      {!saisieManuelle ? (
        <button
          type="button"
          onClick={() => setSaisieManuelle(true)}
          className="mt-1.5 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <Pencil className="h-4 w-4" />
          Saisir les coordonnées à la main
        </button>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Latitude</label>
            <input
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(e) => onChange(e.target.value, longitude)}
              placeholder="48.856600"
              className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Longitude</label>
            <input
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(e) => onChange(latitude, e.target.value)}
              placeholder="2.352200"
              className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>
      )}
    </div>
  )
}
