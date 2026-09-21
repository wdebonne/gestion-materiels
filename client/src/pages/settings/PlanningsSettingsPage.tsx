import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Save, UserCog, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Alert, Button, Card, CardBody, Input, LoadingInline, Select } from '@/components/ui'
import api, { LienEncadrement, planningApi } from '@/lib/api'
import { usePermissions } from '@/lib/permissions'

/**
 * Qui suit les heures de qui.
 *
 * Le module cloisonne strictement : chacun voit ses propres heures, et un
 * encadrant celles des personnes qui lui sont rattachées ici. C'est ce qui rend
 * cet écran important — et c'est aussi ce qui en fait un piège, parce qu'une
 * personne rattachée à personne disparaît de tous les rapports sauf du sien et
 * de celui de l'administrateur. L'avertissement en tête existe pour que cet
 * oubli ne se découvre pas en réunion.
 *
 * Le rattachement lui-même est réservé à l'administrateur. Un encadrant qui
 * pourrait s'attribuer des agents élargirait seul son propre périmètre, et le
 * cloisonnement ne tiendrait plus que par convention. Le superviseur consulte
 * donc cet écran sans pouvoir le modifier — il y voit qui il suit, et qui
 * n'est suivi par personne.
 */

/**
 * Le tableau vide, une fois pour toutes.
 *
 * Écrire `const { data = [] } = useQuery(…)` fabrique un **nouveau** tableau
 * à chaque rendu tant que la requête n'a rien rendu. Posé en dépendance d'un
 * `useEffect` qui appelle `setState`, il relance l'effet à chaque rendu, qui
 * provoque un rendu, qui relance l'effet : React s'arrête au bout de
 * cinquante tours avec « Maximum update depth exceeded », et l'écran se fige.
 * Une référence stable suffit à rompre la boucle.
 */
const AUCUN_LIEN: LienEncadrement[] = []

interface LienEnCours {
  cle: number
  superviseurId: number | null
  intitule: string
}

export default function PlanningsSettingsPage() {
  const { canAdmin } = usePermissions()
  const queryClient = useQueryClient()

  const [agentId, setAgentId] = useState<number | null>(null)
  const [liens, setLiens] = useState<LienEnCours[]>([])
  const [modifie, setModifie] = useState(false)

  const { data: annuaire = [] } = useQuery({
    queryKey: ['annuaire'],
    queryFn: async () => (await api.get('/users/annuaire')).data.users ?? [],
  })

  const { data: orphelins = [], isLoading: chargementOrphelins } = useQuery({
    queryKey: ['plannings', 'agents-sans-superviseur'],
    queryFn: async () => (await planningApi.agentsSansSuperviseur()).data.data,
  })

  const { data: existants = AUCUN_LIEN, isFetching } = useQuery({
    queryKey: ['plannings', 'superviseurs', agentId],
    queryFn: async () => (await planningApi.superviseurs(agentId!)).data.data,
    enabled: agentId != null,
  })

  // On repart de ce que dit le serveur à chaque changement de personne :
  // garder les lignes de la précédente les attribuerait à la suivante.
  useEffect(() => {
    setLiens(
      existants.map((lien: LienEncadrement, index: number) => ({
        cle: index,
        superviseurId: lien.personneId,
        intitule: lien.intitule ?? '',
      }))
    )
    setModifie(false)
  }, [existants, agentId])

  const options = useMemo(
    () =>
      annuaire.map((u: any) => ({
        value: u.id,
        label: [u.firstName, u.lastName].filter(Boolean).join(' ') || `Personne n° ${u.id}`,
      })),
    [annuaire]
  )

  const enregistrer = useMutation({
    mutationFn: () =>
      planningApi.definirSuperviseurs(
        agentId!,
        liens
          .filter((l) => l.superviseurId != null)
          .map((l) => ({ superviseurId: l.superviseurId!, intitule: l.intitule.trim() || undefined }))
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plannings'] })
      setModifie(false)
      toast.success('Encadrement enregistré')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "L'enregistrement n'a pas abouti."),
  })

  const majLien = (cle: number, champs: Partial<LienEnCours>) => {
    setLiens((liste) => liste.map((l) => (l.cle === cle ? { ...l, ...champs } : l)))
    setModifie(true)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
          <UserCog className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          Encadrement des heures
        </h2>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Un encadrant voit les heures des personnes qui lui sont rattachées, en plus des siennes.
          Une personne peut en avoir plusieurs — par exemple un responsable de service et un référent d'équipe.
        </p>
      </div>

      {/* ------------------------------------------- ce qui ne remonte nulle part */}

      {chargementOrphelins ? (
        <LoadingInline />
      ) : orphelins.length > 0 ? (
        <Alert type="warning" title={`${orphelins.length} personne${orphelins.length > 1 ? 's saisissent' : ' saisit'} des heures sans être rattachée à un encadrant`}>
          <p className="mb-2">
            Leurs heures ne sont visibles que d'elles-mêmes et des administrateurs : elles n'apparaîtront
            dans aucun rapport d'équipe.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {orphelins.map((personne) => (
              <li key={personne.id}>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={() => setAgentId(personne.id)}
                >
                  {personne.nom}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert type="success">
          Toutes les personnes qui saisissent des heures sont rattachées à un encadrant.
        </Alert>
      )}

      {/* ------------------------------------------------------ le rattachement */}

      <Card>
        <CardBody className="space-y-4">
          <Select
            label="Personne"
            placeholder="Choisir une personne…"
            value={agentId ?? ''}
            onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
            options={options}
          />

          {agentId == null ? (
            <p className="py-6 text-center text-gray-600 dark:text-gray-400">
              Choisissez une personne pour voir et modifier qui suit ses heures.
            </p>
          ) : isFetching ? (
            <LoadingInline />
          ) : (
            <>
              {liens.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  Personne ne suit les heures de cette personne pour l'instant.
                </p>
              ) : (
                <ul className="space-y-3">
                  {liens.map((lien) => (
                    <li key={lien.cle} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <Select
                        label="Encadrant"
                        placeholder="Choisir…"
                        value={lien.superviseurId ?? ''}
                        disabled={!canAdmin}
                        onChange={(e) =>
                          majLien(lien.cle, { superviseurId: e.target.value ? Number(e.target.value) : null })
                        }
                        options={options.filter(
                          (o: any) =>
                            o.value !== agentId &&
                            !liens.some((autre) => autre.cle !== lien.cle && autre.superviseurId === o.value)
                        )}
                      />
                      <Input
                        label="À quel titre"
                        placeholder="Ex. : Responsable du service"
                        value={lien.intitule}
                        disabled={!canAdmin}
                        onChange={(e) => majLien(lien.cle, { intitule: e.target.value })}
                      />
                      {canAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Retirer cet encadrant"
                          onClick={() => {
                            setLiens((liste) => liste.filter((l) => l.cle !== lien.cle))
                            setModifie(true)
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      setLiens((liste) => [
                        ...liste,
                        { cle: Date.now() + liste.length, superviseurId: null, intitule: '' },
                      ])
                      setModifie(true)
                    }}
                  >
                    Ajouter un encadrant
                  </Button>
                  <Button
                    icon={<Save className="h-4 w-4" />}
                    loading={enregistrer.isPending}
                    disabled={!modifie || liens.some((l) => l.superviseurId == null)}
                    onClick={() => enregistrer.mutate()}
                  >
                    Enregistrer
                  </Button>
                </div>
              )}

              {!canAdmin && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Seul un administrateur peut modifier ces rattachements : pouvoir s'attribuer des agents
                  reviendrait à élargir soi-même ce que l'on voit.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
