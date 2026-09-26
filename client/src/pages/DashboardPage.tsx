import { useState, type ComponentType } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui'
import QuickActions from '@/components/QuickActions'
import GlobalSearch from '@/components/GlobalSearch'
import HelpSheet from '@/components/HelpSheet'
import PanneauPersonnalisation from '@/components/accueil/PanneauPersonnalisation'
import { BlocFavoris } from '@/components/accueil/MesFavoris'
import { CarteBatiments, CarteManifestations, CarteReservations, CarteTickets } from '@/components/accueil/CartesModules'
import {
  BlocActivite,
  BlocAlertes,
  BlocCategories,
  BlocEvenements,
  BlocParc,
  BlocVehicules,
} from '@/components/accueil/BlocsParc'
import { useAccueil, type IdBloc } from '@/lib/accueil'
import { cn } from '@/lib/utils'

/** Ce que chaque identifiant du catalogue (`lib/accueil.ts`) affiche. */
const COMPOSANTS: Record<IdBloc, ComponentType> = {
  favoris: BlocFavoris,
  tickets: CarteTickets,
  batiments: CarteBatiments,
  manifestations: CarteManifestations,
  reservations: CarteReservations,
  parc: BlocParc,
  categories: BlocCategories,
  alertes: BlocAlertes,
  evenements: BlocEvenements,
  activite: BlocActivite,
  vehicules: BlocVehicules,
}

/**
 * L'accueil, tel que chacun l'a composé.
 *
 * La page ne décide plus de rien : elle range les blocs dans l'ordre enregistré
 * sur le compte, en saute ceux qu'on a masqués et ceux d'un module qu'on n'a
 * pas. Un bloc masqué n'est pas monté : il ne coûte aucune requête.
 */
export default function DashboardPage() {
  const [rechercheOuverte, setRechercheOuverte] = useState(false)
  const [personnalisation, setPersonnalisation] = useState(false)
  const { blocs } = useAccueil()

  const affiches = blocs.filter((b) => b.visible && b.disponible)

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tableau de bord</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Ce qui vous attend, à votre façon</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            icon={<SlidersHorizontal className="w-4 h-4" />}
            onClick={() => setPersonnalisation(true)}
            aria-label="Personnaliser mon tableau de bord"
          >
            <span className="hidden sm:inline">Personnaliser</span>
          </Button>
          <HelpSheet
            titre="Le tableau de bord"
            points={[
              'Les tuiles du haut sont vos gestes du quotidien. « Personnaliser » vous laisse choisir les quatre qui vous servent : nouvelle demande, mes tickets, réserver, faire un plein…',
              "Chaque carte de module (tickets, bâtiments, manifestations, réservations) dit ce qui vous attend. Chaque chiffre ouvre la liste correspondante.",
              "Touchez l'étoile d'une fiche pour l'épingler dans « Mes favoris ». Pour revenir à une page ou une liste filtrée, choisissez « Ajouter cette page à mes raccourcis » dans le menu de votre nom.",
              '« Personnaliser » : cochez les blocs à afficher, rangez-les avec les flèches. Tout est enregistré sur votre compte, et vous le retrouvez sur tous vos appareils.',
              'La pastille rouge sur « Alertes » compte les contrôles, entretiens et échéances de bâtiments à prévoir.',
            ]}
          />
        </div>
      </div>

      {/* Ce que l'agent vient faire, avant les chiffres */}
      <QuickActions onOuvrirRecherche={() => setRechercheOuverte(true)} />
      <GlobalSearch ouvert={rechercheOuverte} onFermer={() => setRechercheOuverte(false)} />

      {affiches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600 dark:border-gray-600 dark:text-gray-400">
          Tous les blocs sont masqués. « Personnaliser » permet d'en afficher de nouveau.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {affiches.map((b) => {
            const Bloc = COMPOSANTS[b.id]
            return (
              <div key={b.id} className={cn('min-w-0', b.largeur === 'plein' && 'lg:col-span-2')}>
                <Bloc />
              </div>
            )
          })}
        </div>
      )}

      <PanneauPersonnalisation ouvert={personnalisation} onFermer={() => setPersonnalisation(false)} />
    </div>
  )
}
