import { useNavigate } from 'react-router-dom'
import { QrCode, Fuel, Search, Star } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { useFavoritesStore } from '@/stores/favorites.store'

interface QuickActionsProps {
  onOuvrirRecherche: () => void
}

/**
 * Actions rapides en tête d'accueil.
 *
 * Le tableau de bord empilait treize blocs de statistiques sans hiérarchie —
 * une vue de gestion, pas un point de départ. Un agent qui ouvre l'application
 * vient faire une chose précise : relever un plein, retrouver une machine.
 * Ces quatre tuiles répondent à « que voulez-vous faire ? ».
 */
export default function QuickActions({ onOuvrirRecherche }: QuickActionsProps) {
  const navigate = useNavigate()
  const { canFieldWrite } = usePermissions()
  const { favoris, recents } = useFavoritesStore()

  // Le raccourci « faire un plein » n'a de sens que s'il mène quelque part :
  // on vise le matériel épinglé, sinon le dernier consulté.
  const materielPrefere = favoris[0] ?? recents[0]

  const tuiles = [
    {
      libelle: 'Scanner',
      detail: "l'étiquette",
      icone: QrCode,
      couleur: 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
      action: () => navigate('/scan'),
      visible: true,
    },
    {
      libelle: 'Faire un plein',
      detail: materielPrefere ? materielPrefere.name : 'choisir un véhicule',
      icone: Fuel,
      couleur: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      action: () =>
        materielPrefere
          ? navigate(`/objects/${materielPrefere.id}?action=plein`)
          : onOuvrirRecherche(),
      visible: canFieldWrite,
    },
    {
      libelle: 'Chercher',
      detail: 'un matériel',
      icone: Search,
      couleur: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      action: onOuvrirRecherche,
      visible: true,
    },
    {
      libelle: 'Mes matériels',
      detail: favoris.length > 0 ? `${favoris.length} épinglé(s)` : 'aucun épinglé',
      icone: Star,
      couleur: 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      action: onOuvrirRecherche,
      visible: true,
    },
  ].filter((t) => t.visible)

  return (
    <section aria-label="Actions rapides" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tuiles.map(({ libelle, detail, icone: Icone, couleur, action }) => (
        <button
          key={libelle}
          onClick={action}
          className="flex min-h-[96px] flex-col items-start justify-between rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${couleur}`}>
            <Icone className="h-5 w-5" />
          </span>
          <span className="mt-2 w-full">
            <span className="block font-medium text-gray-900 dark:text-gray-100">{libelle}</span>
            <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{detail}</span>
          </span>
        </button>
      ))}
    </section>
  )
}
