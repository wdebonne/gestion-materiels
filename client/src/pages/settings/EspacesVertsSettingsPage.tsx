import { TreePine } from 'lucide-react'
import MaterielImplantablePage from './MaterielImplantablePage'

/**
 * Tout ce qui règle les espaces verts, au même endroit.
 *
 * Une seule entrée pour l'instant — quel matériel du parc s'implante — mais
 * l'écran est fait pour en accueillir d'autres : les types de groupes, les types
 * d'entretien et les statuts d'espace se règlent aujourd'hui depuis des fenêtres
 * cachées dans la fiche d'un espace, ce qui oblige à ouvrir un parc au hasard
 * pour modifier un référentiel commun à tous.
 */
export default function EspacesVertsSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <TreePine className="w-7 h-7 text-green-600" />
          Espaces verts
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Ce que le parc propose quand on garnit un espace vert.
        </p>
      </div>

      <MaterielImplantablePage />
    </div>
  )
}
