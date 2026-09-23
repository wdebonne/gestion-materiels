import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, LayoutGrid } from 'lucide-react'
import { Alert, Badge, Button, Card, LoadingInline } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Les salles retenues par une manifestation, et ce qui s'y heurte.
 *
 * Le formulaire de demande envoie déjà ses salles en une phrase, que la
 * réception rapproche du référentiel. Ce qu'elle n'a pas su rapprocher — « le
 * parc municipal », une salle mal orthographiée — reste dans les détails de la
 * demande, et c'est ici que l'agent le reprend à la main.
 *
 * **Les conflits ne bloquent pas l'enregistrement.** Une manifestation est un
 * dossier qu'on instruit, pas une réservation de guichet : refuser obligerait à
 * défaire l'autre réservation avant de pouvoir noter celle-ci. Ils sont donc
 * affichés, et c'est au superviseur d'arbitrer.
 *
 * La liste des lieux est **remplacée** à chaque enregistrement, comme celle de
 * ce qu'une clé ouvre : l'écran montre l'état complet, et décocher une salle
 * doit la libérer. Une fusion la laisserait retenue sans que personne ne
 * comprenne pourquoi.
 */

interface Occupation {
  id: number
  site_id: number
  piece_id: number | null
  titre: string
  debut: string
  fin: string
  statut: 'demande' | 'confirme' | 'annule'
  site_name: string | null
  piece_name: string | null
}

interface Conflit {
  occupation: Occupation
  conflits: Occupation[]
}

interface Piece {
  id: number
  name: string
  pretable_effectif: boolean
}

interface SiteArbre {
  id: number
  name: string
  pretable_effectif: boolean
  pieces: Piece[]
}

/** Un lieu choisi : le bâtiment, et la pièce quand il y en a une. */
type Choix = { siteId: number; pieceId: number | null }

const cleDuChoix = (c: Choix) => `${c.siteId}:${c.pieceId ?? ''}`

const quandCaSePasse = (o: Occupation) =>
  `${o.debut.slice(0, 16).replace('T', ' ')} → ${o.fin.slice(0, 16).replace('T', ' ')}`

export default function LieuxDeLaManifestation({
  manifestationId,
  modifiable,
}: {
  manifestationId: number
  modifiable: boolean
}) {
  const queryClient = useQueryClient()
  const [choix, setChoix] = useState<Choix[] | null>(null)

  const { data: sites = [], isLoading: chargeSites } = useQuery<SiteArbre[]>({
    queryKey: ['lieux-arbre'],
    queryFn: async () => (await api.get('/sites/arbre')).data.sites,
  })

  const { data: occupations = [], isLoading } = useQuery<Occupation[]>({
    queryKey: ['manifestation-lieux', manifestationId],
    queryFn: async () => (await api.get(`/manifestations/${manifestationId}/lieux`)).data.data,
  })

  const { data: conflits = [] } = useQuery<Conflit[]>({
    queryKey: ['manifestation-conflits', manifestationId],
    queryFn: async () => (await api.get(`/manifestations/${manifestationId}/conflits`)).data.data,
  })

  /*
   * La sélection part de ce qui est enregistré, et n'est réinitialisée qu'au
   * premier chargement : la reprendre à chaque rafraîchissement effacerait les
   * cases que l'utilisateur vient de cocher.
   */
  useEffect(() => {
    if (choix === null && !isLoading) {
      setChoix(occupations.map((o) => ({ siteId: o.site_id, pieceId: o.piece_id })))
    }
  }, [isLoading, occupations, choix])

  const selection = choix ?? []
  const selectionnes = useMemo(() => new Set(selection.map(cleDuChoix)), [selection])

  const basculer = (c: Choix) => {
    const cle = cleDuChoix(c)
    setChoix((actuel) => {
      const liste = actuel ?? []
      return selectionnes.has(cle)
        ? liste.filter((x) => cleDuChoix(x) !== cle)
        : [...liste, c]
    })
  }

  const enregistrer = useMutation({
    mutationFn: async () => api.put(`/manifestations/${manifestationId}/lieux`, { lieux: selection }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestation-lieux', manifestationId] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-conflits', manifestationId] })
      queryClient.invalidateQueries({ queryKey: ['lieux-occupations'] })
      toast.success('Lieux enregistrés')
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  if (isLoading || chargeSites) return <LoadingInline />

  // Seuls les lieux ouverts au prêt sont proposés : on ne réserve pas la
  // chaufferie pour une fête de la musique.
  const pretables = sites
    .map((s) => ({ ...s, pieces: (s.pieces ?? []).filter((p) => p.pretable_effectif) }))
    .filter((s) => s.pretable_effectif || s.pieces.length > 0)

  return (
    <div className="space-y-4">
      {conflits.length > 0 && (
        <Alert
          type={
            conflits.some((c) => c.conflits.some((x) => x.statut === 'confirme'))
              ? 'error'
              : 'warning'
          }
          title="Conflit de lieu"
        >
          <ul className="mt-1 space-y-1 text-sm">
            {conflits.flatMap((c) =>
              c.conflits.map((autre) => (
                <li key={`${c.occupation.id}-${autre.id}`}>
                  <strong>{c.occupation.piece_name ?? c.occupation.site_name}</strong> est déjà
                  retenu par « {autre.titre} », {quandCaSePasse(autre)}
                  {autre.statut === 'demande' && (
                    <Badge variant="warning" size="sm" className="ml-2">
                      à arbitrer
                    </Badge>
                  )}
                </li>
              ))
            )}
          </ul>
        </Alert>
      )}

      {pretables.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gray-600 dark:text-gray-300">
          Aucun lieu n'est ouvert au prêt. Un administrateur doit cocher « prêtable » sur les
          bâtiments et les salles concernés, dans Clés et badges › Lieux.
        </Card>
      ) : (
        <div className="space-y-3">
          {pretables.map((site) => (
            <Card key={site.id} className="p-4">
              <div className="space-y-2">
                {site.pretable_effectif && (
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      disabled={!modifiable}
                      checked={selectionnes.has(cleDuChoix({ siteId: site.id, pieceId: null }))}
                      onChange={() => basculer({ siteId: site.id, pieceId: null })}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600"
                    />
                    <Building2 className="h-4 w-4 flex-shrink-0 text-primary-600" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {site.name}
                    </span>
                    <span className="text-xs text-gray-500">bâtiment entier</span>
                  </label>
                )}

                {site.pieces.map((piece) => (
                  <label
                    key={piece.id}
                    className="flex cursor-pointer items-center gap-3 pl-6"
                  >
                    <input
                      type="checkbox"
                      disabled={!modifiable}
                      checked={selectionnes.has(
                        cleDuChoix({ siteId: site.id, pieceId: piece.id })
                      )}
                      onChange={() => basculer({ siteId: site.id, pieceId: piece.id })}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600"
                    />
                    <LayoutGrid className="h-4 w-4 flex-shrink-0 text-primary-500" />
                    <span className="text-sm text-gray-800 dark:text-gray-200">{piece.name}</span>
                    {!site.pretable_effectif && (
                      <span className="text-xs text-gray-500">dans {site.name}</span>
                    )}
                  </label>
                ))}
              </div>
            </Card>
          ))}

          {modifiable && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Les créneaux reprennent les dates et les horaires de la manifestation.
              </p>
              <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
                Enregistrer les lieux
              </Button>
            </div>
          )}
        </div>
      )}

      {occupations.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Créneaux posés
          </p>
          <ul className="space-y-1 text-sm">
            {occupations.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="text-gray-900 dark:text-gray-100">
                  {o.piece_name ?? o.site_name}
                </span>
                <span className="text-gray-500">{quandCaSePasse(o)}</span>
                <Badge variant={o.statut === 'confirme' ? 'success' : 'warning'} size="sm">
                  {o.statut === 'confirme' ? 'Confirmé' : 'Demandé'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
