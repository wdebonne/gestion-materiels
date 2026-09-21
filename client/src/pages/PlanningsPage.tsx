import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, CalendarDays, Clock, PieChart, Plus, Tags } from 'lucide-react'
import { Alert, Button, LoadingScreen, Tab, Tabs } from '@/components/ui'
import SaisirTemps from '@/components/SaisirTemps'
import MaSemaine from '@/components/plannings/MaSemaine'
import VuePlanning from '@/components/plannings/VuePlanning'
import Rapports from '@/components/plannings/Rapports'
import Categories from '@/components/plannings/Categories'
import { TachePlanning, planningApi } from '@/lib/api'

/**
 * Plannings et heures.
 *
 * Quatre onglets pour deux métiers. L'agent vient déclarer ce qu'il a fait et
 * repart : « Ma semaine » lui suffit, et c'est pour cela qu'il est le premier.
 * Le responsable vient chercher des chiffres pour une réunion : « Rapports »
 * est fait pour être projeté.
 *
 * Ce que chacun voit dépend d'un périmètre, pas d'un réglage : soi, plus les
 * personnes qui vous sont rattachées. Un agent rattaché à personne n'est donc
 * visible que de lui-même et de l'administrateur — une conséquence assumée du
 * cloisonnement, que l'écran des paramètres signale pour qu'elle ne passe pas
 * inaperçue.
 */

type Onglet = 'semaine' | 'planning' | 'rapports' | 'categories'

export default function PlanningsPage() {
  const [onglet, setOnglet] = useState<Onglet>('semaine')
  const [formulaire, setFormulaire] = useState<{
    ouvert: boolean
    jour?: string
    tache?: TachePlanning | null
  }>({ ouvert: false })

  const { data: droits, isLoading } = useQuery({
    queryKey: ['plannings', 'droits'],
    queryFn: async () => (await planningApi.droits()).data.data,
  })

  const [personneRegardee, setPersonneRegardee] = useState<number | null>(null)

  /**
   * Les personnes dont on peut regarder les heures.
   *
   * Soi d'abord — c'est le cas courant — puis celles qu'on encadre, dans
   * l'ordre où le serveur les donne. Un administrateur ne voit pas ici tout
   * l'annuaire : il choisit une personne depuis les filtres du rapport, sans
   * quoi cette liste ferait plusieurs centaines d'entrées.
   */
  const personnes = useMemo(() => {
    if (!droits) return []
    return [
      { id: droits.moi, nom: 'Moi' },
      ...droits.mesAgents.map((lien) => ({ id: lien.personneId, nom: lien.nom })),
    ]
  }, [droits])

  if (isLoading || !droits) return <LoadingScreen message="Chargement…" />

  const regardee = personneRegardee ?? droits.moi
  const titulaires = personnes.map((p) => ({
    id: p.id,
    nom: p.id === droits.moi ? 'Moi' : p.nom,
  }))

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900 dark:text-white">
            <Clock className="h-6 w-6 text-primary-600 dark:text-primary-400" />
            Plannings et heures
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Déclarer le temps passé, et en tirer des statistiques
          </p>
        </div>

        {droits.canWrite && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormulaire({ ouvert: true })}>
            Saisir du temps
          </Button>
        )}
      </div>

      {/* Les heures d'un agent rattaché à personne ne remontent à aucun
          responsable. Le dire ici évite de croire, en réunion, que la personne
          n'a rien saisi. */}
      {droits.mesAgents.length === 0 && !droits.voitTout && (
        <Alert type="info">
          Vous ne suivez les heures de personne pour l'instant. Un administrateur peut vous rattacher des
          agents depuis Paramètres → Plannings.
        </Alert>
      )}

      <Tabs value={onglet} onChange={(valeur) => setOnglet(valeur as Onglet)}>
        <Tab value="semaine" label="Ma semaine" icon={<CalendarDays className="h-4 w-4" />} />
        <Tab value="planning" label="Planning" icon={<CalendarClock className="h-4 w-4" />} />
        <Tab value="rapports" label="Rapports" icon={<PieChart className="h-4 w-4" />} />
        {droits.canManageCategories && (
          <Tab value="categories" label="Catégories" icon={<Tags className="h-4 w-4" />} />
        )}
      </Tabs>

      {onglet === 'semaine' && (
        <div className="space-y-3">
          {personnes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {personnes.map((personne) => (
                <button
                  key={personne.id}
                  type="button"
                  onClick={() => setPersonneRegardee(personne.id)}
                  aria-pressed={regardee === personne.id}
                  className={
                    regardee === personne.id
                      ? 'min-h-[36px] rounded-full bg-primary-600 px-3 text-sm text-white'
                      : 'min-h-[36px] rounded-full border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                  }
                >
                  {personne.nom}
                </button>
              ))}
            </div>
          )}

          <MaSemaine
            personneId={regardee}
            personnes={personnes}
            onSaisir={(options) => setFormulaire({ ouvert: true, ...options })}
          />
        </div>
      )}

      {onglet === 'planning' && (
        <VuePlanning
          personnes={personnes}
          moi={droits.moi}
          onSaisir={(options) => setFormulaire({ ouvert: true, ...options })}
        />
      )}

      {onglet === 'rapports' && <Rapports personnes={personnes} moi={droits.moi} />}

      {onglet === 'categories' && droits.canManageCategories && (
        <Categories
          peutModifier={droits.canManageCategories}
          peutDesactiver={droits.canDisableCategories}
        />
      )}

      <SaisirTemps
        ouvert={formulaire.ouvert}
        onClose={() => setFormulaire({ ouvert: false })}
        tache={formulaire.tache}
        jourInitial={formulaire.jour}
        titulaireId={formulaire.tache?.titulaire.id ?? regardee}
        titulairesPossibles={titulaires}
      />
    </div>
  )
}
