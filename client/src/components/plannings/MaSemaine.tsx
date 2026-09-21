import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Clock, Copy, Pencil, Plus, Trash2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, LoadingInline, useConfirm } from '@/components/ui'
import { TachePlanning, planningApi } from '@/lib/api'
import { couleurDe } from '@/lib/paletteCategories'
import { useThemeSombre } from '@/lib/useThemeSombre'
import { decalerJours, formaterDuree, jourCourant, jourEnFrancais } from '@/lib/duree'
import { cn } from '@/lib/utils'

/**
 * La semaine d'une personne, telle qu'elle la remplit.
 *
 * Sept colonnes, le total de chaque jour, et les tâches en pastilles colorées
 * par catégorie. Ce n'est pas un agenda : personne ne saisit à la minute près
 * ce qu'il a fait il y a trois jours. C'est une liste par journée, où l'on
 * ajoute vite et où l'on corrige d'un doigt.
 *
 * « Refaire hier » existe parce que le travail d'une commune se répète : la
 * tonte du mardi ressemble à celle du mardi précédent, et la retaper en entier
 * est précisément ce qui fait abandonner ce genre d'outil.
 */

/** Référence stable, pour ne pas recalculer la semaine à chaque rendu. */
const AUCUNE_TACHE: TachePlanning[] = []

interface MaSemaineProps {
  /** La personne dont on regarde la semaine. */
  personneId: number
  personnes: { id: number; nom: string }[]
  onSaisir: (options: { jour?: string; tache?: TachePlanning | null }) => void
}

export default function MaSemaine({ personneId, personnes, onSaisir }: MaSemaineProps) {
  const sombre = useThemeSombre()
  const confirmer = useConfirm()
  const queryClient = useQueryClient()

  const [ancre, setAncre] = useState(jourCourant())
  const [jourOuvert, setJourOuvert] = useState<string>(jourCourant())

  const { data, isLoading } = useQuery({
    queryKey: ['plannings', 'semaine', ancre, personneId],
    queryFn: async () =>
      (await planningApi.taches({ periode: 'semaine', ancre, personneIds: [personneId] })).data.data,
  })

  const taches = data?.taches ?? AUCUNE_TACHE
  const debut = data?.periode.debut

  const jours = useMemo(() => {
    if (!debut) return []
    return Array.from({ length: 7 }, (_, index) => {
      const jour = decalerJours(debut, index)
      const dessus = taches.filter((t) => t.jour === jour)
      return {
        jour,
        taches: dessus,
        // Le temps *de cette personne*, pas celui mobilisé : c'est sa semaine
        // qu'elle regarde, et y voir les heures de ses collègues gonflerait
        // son total sans qu'elle comprenne pourquoi.
        minutes: dessus.reduce((total, t) => total + minutesDe(t, personneId), 0),
      }
    })
  }, [debut, taches, personneId])

  const totalSemaine = jours.reduce((total, j) => total + j.minutes, 0)
  const selectionne = jours.find((j) => j.jour === jourOuvert) ?? jours[0]

  const supprimer = useMutation({
    mutationFn: (id: number) => planningApi.supprimerTache(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plannings'] })
      toast.success('Saisie supprimée')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  const dupliquer = useMutation({
    mutationFn: async ({ tache, jour }: { tache: TachePlanning; jour: string }) =>
      planningApi.creerTache({
        userId: tache.titulaire.id,
        jour,
        heureDebut: tache.heureDebut,
        heureFin: tache.heureFin,
        categorieId: tache.categorie?.id ?? null,
        manifestationId: tache.manifestation?.id ?? null,
        description: tache.description,
        participants: tache.participants.map((p) => ({
          userId: p.personne?.id ?? null,
          libelle: p.personne ? null : p.libelle,
          minutes: p.minutes,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plannings'] })
      toast.success('Saisie dupliquée')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Duplication impossible'),
  })

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------- la semaine */}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Semaine précédente"
              onClick={() => setAncre(decalerJours(ancre, -7))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {debut && `${jourEnFrancais(debut, { day: 'numeric', month: 'short' })} – ${jourEnFrancais(decalerJours(debut, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                {formaterDuree(totalSemaine)}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Semaine suivante"
              onClick={() => setAncre(decalerJours(ancre, 7))}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Les sept jours. Chacun est une cible tactile pleine hauteur :
              on le choisit du pouce, pas au pointeur. */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {jours.map((jour) => {
              const actif = jour.jour === selectionne?.jour
              const aujourdhui = jour.jour === jourCourant()
              return (
                <button
                  key={jour.jour}
                  type="button"
                  onClick={() => setJourOuvert(jour.jour)}
                  aria-pressed={actif}
                  className={cn(
                    'flex min-h-[86px] flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors sm:p-2',
                    actif
                      ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/30'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'
                  )}
                >
                  <span className={cn(
                    'text-xs uppercase',
                    aujourdhui ? 'font-semibold text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400'
                  )}>
                    {jourEnFrancais(jour.jour, { weekday: 'short' }).replace('.', '')}
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {jourEnFrancais(jour.jour, { day: 'numeric' })}
                  </span>

                  <span className={cn(
                    'text-xs',
                    jour.minutes > 0
                      ? 'font-medium text-gray-800 dark:text-gray-200'
                      : 'text-gray-400 dark:text-gray-600'
                  )}>
                    {jour.minutes > 0 ? formaterDuree(jour.minutes) : '—'}
                  </span>

                  {/* Une pastille par tâche, coloriée par sa catégorie : la
                      forme de la journée se lit sans l'ouvrir. */}
                  <span className="flex flex-wrap justify-center gap-0.5">
                    {jour.taches.slice(0, 4).map((tache) => (
                      <span
                        key={tache.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: couleurDe(tache.categorie?.couleur, sombre) }}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------- la journée */}

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-medium capitalize text-gray-900 dark:text-white">
              {selectionne && jourEnFrancais(selectionne.jour)}
            </h3>
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => onSaisir({ jour: selectionne?.jour })}
            >
              Saisir du temps
            </Button>
          </div>

          {!selectionne || selectionne.taches.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-gray-600 dark:text-gray-400">Rien de saisi ce jour-là.</p>
              {(() => {
                const veille = jours.find((j) => j.jour === decalerJours(selectionne?.jour ?? '', -1))
                if (!veille?.taches.length) return null
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    icon={<Copy className="h-4 w-4" />}
                    onClick={() =>
                      veille.taches.forEach((tache) =>
                        dupliquer.mutate({ tache, jour: selectionne!.jour })
                      )
                    }
                  >
                    Refaire la veille ({formaterDuree(veille.minutes)})
                  </Button>
                )
              })()}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {selectionne.taches.map((tache) => (
                <li key={tache.id} className="flex items-start gap-3 py-3">
                  <span
                    className="mt-1.5 h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: couleurDe(tache.categorie?.couleur, sombre) }}
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {tache.categorie?.nom ?? 'Sans catégorie'}
                    </p>

                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-600 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {tache.heureDebut && tache.heureFin
                          ? `${tache.heureDebut} – ${tache.heureFin}`
                          : formaterDuree(tache.minutes)}
                      </span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {formaterDuree(tache.minutes)}
                      </span>
                      {tache.participants.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {formaterDuree(tache.minutesMobilisees)} mobilisées
                        </span>
                      )}
                    </p>

                    {tache.titulaire.id !== personneId && (
                      <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        Tâche de {tache.titulaire.nom}
                      </p>
                    )}

                    {tache.description && (
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{tache.description}</p>
                    )}

                    {tache.manifestation && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {tache.manifestation.titre}
                      </p>
                    )}

                    {tache.participants.length > 0 && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Avec {tache.participants
                          .map((p) => `${p.personne?.nom ?? p.libelle} (${formaterDuree(p.minutes)})`)
                          .join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Corriger"
                      onClick={() => onSaisir({ tache })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Supprimer"
                      onClick={async () => {
                        const oui = await confirmer({
                          title: 'Supprimer cette saisie ?',
                          message: `${formaterDuree(tache.minutes)} le ${jourEnFrancais(tache.jour, { day: 'numeric', month: 'long' })} seront retirées des statistiques.`,
                          confirmLabel: 'Supprimer',
                          variant: 'danger',
                        })
                        if (oui) supprimer.mutate(tache.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {personnes.length > 1 && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          Vous regardez la semaine de {personnes.find((p) => p.id === personneId)?.nom ?? 'cette personne'}.
        </p>
      )}
    </div>
  )
}

/**
 * Le temps d'une personne sur une tâche.
 *
 * Elle en est titulaire, ou elle y a prêté main-forte : dans les deux cas,
 * c'est **sa** contribution qui compte dans sa semaine, jamais la durée totale
 * de la tâche.
 */
function minutesDe(tache: TachePlanning, personneId: number): number {
  if (tache.titulaire.id === personneId) return tache.minutes
  const renfort = tache.participants.find((p) => p.personne?.id === personneId)
  return renfort?.minutes ?? 0
}
