import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CalendarRange, Fuel, LifeBuoy, MessageSquarePlus, QrCode, Search, Star } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { useAccueil, useFavoris, type IdAction } from '@/lib/accueil'
import { useFavoritesStore } from '@/stores/favorites.store'

interface QuickActionsProps {
  onOuvrirRecherche: () => void
}

export interface ActionRapide {
  id: IdAction
  libelle: string
  detail: string
  icone: ComponentType<{ className?: string }>
  couleur: string
  action: () => void
  /** Même règle que le serveur : une tuile ne promet pas un geste qu'il refusera. */
  visible: boolean
}

/**
 * Le catalogue des actions rapides, avec ce que chacune permet à ce compte.
 *
 * Partagé avec le panneau « Personnaliser », qui ne propose que les actions
 * visibles.
 */
export function useActionsRapides(onOuvrirRecherche: () => void): ActionRapide[] {
  const navigate = useNavigate()
  const { canFieldWrite, canManage } = usePermissions()
  const { moduleActif } = useAccueil()
  const { favoris } = useFavoris()
  const { recents } = useFavoritesStore()

  // « Faire un plein » n'a de sens que s'il mène quelque part : on vise le
  // premier matériel épinglé, sinon le dernier consulté sur cet appareil.
  const epingle = favoris.find((f) => f.type === 'materiel' && f.disponible)
  const materielPrefere = epingle
    ? { id: epingle.cibleId, name: epingle.libelle }
    : recents[0]
      ? { id: recents[0].id, name: recents[0].name }
      : null

  return [
    {
      id: 'scanner',
      libelle: 'Scanner',
      detail: "l'étiquette",
      icone: QrCode,
      couleur: 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
      action: () => navigate('/scan'),
      visible: true,
    },
    {
      id: 'plein',
      libelle: 'Faire un plein',
      detail: materielPrefere?.name ?? 'choisir un véhicule',
      icone: Fuel,
      couleur: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      action: () => (materielPrefere ? navigate(`/objects/${materielPrefere.id}?action=plein`) : onOuvrirRecherche()),
      visible: canFieldWrite,
    },
    {
      id: 'chercher',
      libelle: 'Chercher',
      detail: 'un matériel',
      icone: Search,
      couleur: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      action: onOuvrirRecherche,
      visible: true,
    },
    {
      id: 'favoris',
      libelle: 'Mes favoris',
      detail: favoris.length > 0 ? `${favoris.length} épinglé(s)` : 'aucun épinglé',
      icone: Star,
      couleur: 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      action: onOuvrirRecherche,
      visible: true,
    },
    {
      id: 'nouvelle-demande',
      libelle: 'Nouvelle demande',
      detail: 'signaler un problème',
      icone: MessageSquarePlus,
      couleur: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
      action: () => navigate('/tickets?nouvelle=1'),
      visible: moduleActif('tickets'),
    },
    {
      id: 'mes-tickets',
      libelle: 'Mes tickets',
      detail: 'ceux qui me sont confiés',
      icone: LifeBuoy,
      couleur: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
      action: () => navigate('/tickets?moi=1'),
      visible: moduleActif('tickets'),
    },
    {
      id: 'reserver',
      libelle: 'Réserver',
      detail: 'un matériel',
      icone: CalendarRange,
      couleur: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      action: () => navigate('/reservations?nouvelle=1'),
      visible: moduleActif('reservations') && canFieldWrite,
    },
    {
      id: 'nouvelle-manifestation',
      libelle: 'Manifestation',
      detail: 'en créer une',
      icone: CalendarPlus,
      couleur: 'bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
      action: () => navigate('/manifestations?nouvelle=1'),
      visible: moduleActif('manifestations') && canManage,
    },
  ]
}

/**
 * Actions rapides en tête d'accueil.
 *
 * Le tableau de bord empilait treize blocs de statistiques sans hiérarchie —
 * une vue de gestion, pas un point de départ. Un agent qui ouvre l'application
 * vient faire une chose précise : relever un plein, retrouver une machine,
 * signaler une panne. Chacun choisit ses quatre tuiles (« Personnaliser ») ;
 * sans choix, ce sont celles du terrain.
 */
export default function QuickActions({ onOuvrirRecherche }: QuickActionsProps) {
  const { actions } = useAccueil()
  const catalogue = useActionsRapides(onOuvrirRecherche)
  const tuiles = actions
    .map((id) => catalogue.find((a) => a.id === id))
    .filter((a): a is ActionRapide => !!a && a.visible)

  if (tuiles.length === 0) return null

  return (
    <section aria-label="Actions rapides" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tuiles.map(({ id, libelle, detail, icone: Icone, couleur, action }) => (
        <button
          key={id}
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
