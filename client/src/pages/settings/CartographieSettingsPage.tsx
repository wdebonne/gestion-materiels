import { MapPin } from 'lucide-react'
import MaterielVoiePubliquePage from './MaterielVoiePubliquePage'

/**
 * Tout ce qui règle la cartographie, au même endroit.
 *
 * Une seule entrée pour l'instant — quel matériel du parc se pose sur la voie
 * publique — mais l'écran est fait pour en accueillir d'autres : les secteurs
 * de la commune et les types d'intervention se déduisent aujourd'hui de ce qui
 * a été saisi, ce qui convient tant que l'inventaire est jeune et méritera un
 * référentiel le jour où plusieurs services y écriront.
 */
export default function CartographieSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <MapPin className="h-7 w-7 text-primary-600" />
          Cartographie
        </h1>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Ce que le parc propose quand on pose un mobilier sur la voie publique.
        </p>
      </div>

      <MaterielVoiePubliquePage />
    </div>
  )
}
