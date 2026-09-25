import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { DoorOpen, FileText, KeyRound, Package, PenLine, Plus, Search, Trash2, Wrench, X } from 'lucide-react'
import api, { batimentsApi, plansApi, type FichePiece as Fiche } from '@/lib/api'
import { Badge, Button, Input, LoadingInline, useConfirm } from '@/components/ui'
import { formaterSurface } from '@/components/plan/geometrie'
import { ouvrirFichier } from '../ouvrirFichier'
import { invaliderBatiments } from '../cache'
import { jourFr } from '../libelles'
import { FormulaireIntervention, InterventionsDeLaPiece } from '../exploitation/OngletInterventions'

/**
 * Ce qu'on apprend en cliquant une pièce : ce qu'elle contient, et qui peut y
 * entrer.
 *
 * Le matériel se pose depuis le parc, par recherche. Un matériel **unique**
 * déjà posé ailleurs n'est pas dupliqué : le serveur dit où il est, et l'on
 * propose de le déplacer. Un **lot** se répartit — trente chaises ici, vingt
 * là —, dans la limite de sa quantité.
 *
 * Les clés sont dites avec leur portée : le passe général n'ouvre pas la salle
 * « de la même façon » que la clé de sa porte, et ne se prête pas pareil.
 */

const PORTEES: Record<Fiche['cles'][number]['portee'], string> = {
  batiment: 'Passe du bâtiment',
  piece: 'Passe de la pièce',
  porte: 'Porte',
}

interface ObjetTrouve {
  id: number
  name: string
  reference: string | null
  categoryName: string | null
  materialType: 'unique' | 'lot'
  quantityTotal: number
}

export default function FichePiece({
  pieceId,
  gere,
  onFermer,
  onRedessiner,
  onEffacerZone,
}: {
  pieceId: number
  gere: boolean
  onFermer: () => void
  onRedessiner: () => void
  onEffacerZone: () => void
}) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [ajout, setAjout] = useState(false)
  const [intervention, setIntervention] = useState(false)

  const { data: fiche, isLoading } = useQuery({
    queryKey: ['batiments', 'piece', pieceId],
    queryFn: async () => (await plansApi.fiche(pieceId)).data,
  })

  const retirer = useMutation({
    mutationFn: (placementId: number) => plansApi.retirerPlacement(placementId),
    onSuccess: () => {
      toast.success('Matériel retiré de la pièce')
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "Le retrait n'a pas abouti"),
  })

  if (isLoading || !fiche) return <LoadingInline />
  const p = fiche.piece

  const demanderEffacement = async () => {
    const ok = await confirmer({
      title: `Effacer le contour de « ${p.nom} » ?`,
      message: 'La pièce reste, avec son matériel et ses clés ; elle ne sera plus dessinée sur le plan.',
      confirmLabel: 'Effacer le contour',
      variant: 'danger',
    })
    if (ok) onEffacerZone()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{p.nom}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {[p.typeLieu, p.etageNom, p.surfaceM2 ? formaterSurface(p.surfaceM2) : null, p.capacite ? `${p.capacite} places` : null]
              .filter(Boolean)
              .join(' · ') || 'Pièce'}
          </p>
        </div>
        <button type="button" onClick={onFermer} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>

      {gere && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<PenLine className="h-4 w-4" />} onClick={onRedessiner}>
            {p.aUneZone ? 'Redessiner' : 'Dessiner sur le plan'}
          </Button>
          {p.aUneZone && (
            <Button size="sm" variant="ghost" onClick={demanderEffacement}>
              Effacer le contour
            </Button>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ matériel */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <Package className="h-4 w-4" /> Matériel
          </h4>
          {gere && !ajout && (
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setAjout(true)}>
              Ajouter
            </Button>
          )}
        </div>
        {ajout && <AjoutMateriel pieceId={pieceId} onFermer={() => setAjout(false)} />}
        {fiche.materiels.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucun matériel posé ici.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
            {fiche.materiels.map((m) => (
              <li key={m.placementId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Link to={`/objects/${m.objectId}`} className="min-w-0 flex-1 truncate text-primary-600 hover:underline">
                  {m.nom}
                  {m.reference && <span className="ml-1 text-xs text-gray-500">({m.reference})</span>}
                </Link>
                {!m.unique && <Badge size="sm">× {m.quantite}</Badge>}
                {gere && (
                  <button
                    type="button"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700"
                    onClick={() => retirer.mutate(m.placementId)}
                    aria-label={`Retirer ${m.nom} de la pièce`}
                    title="Retirer de la pièce"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ clés */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <KeyRound className="h-4 w-4" /> Clés qui l'ouvrent
        </h4>
        {fiche.cles.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucune clé enregistrée pour cette pièce.</p>
        ) : (
          <ul className="space-y-2">
            {fiche.cles.map((c) => (
              <li key={`${c.id}-${c.portee}-${c.porte ?? ''}`} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/cles/${c.id}`} className="text-primary-600 hover:underline">
                    {c.nom}
                  </Link>
                  <Badge size="sm" variant={c.portee === 'batiment' ? 'warning' : 'default'}>
                    {c.portee === 'porte' && c.porte ? `Porte « ${c.porte} »` : PORTEES[c.portee]}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {c.detenteurs.length > 0 ? `Détenue par ${c.detenteurs.join(', ')}` : 'Au coffre'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {fiche.portes.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <DoorOpen className="h-4 w-4" /> Portes
          </h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">{fiche.portes.map((o) => o.nom).join(', ')}</p>
        </section>
      )}

      {fiche.documents.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <FileText className="h-4 w-4" /> Documents
          </h4>
          <ul className="space-y-1">
            {fiche.documents.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="text-left text-sm text-primary-600 hover:underline"
                  onClick={() => ouvrirFichier(() => batimentsApi.fichier(d.id), d.titre)}
                >
                  {d.titre}
                </button>
                <span className="ml-1 text-xs text-gray-500">
                  {[d.rubrique, d.date && jourFr(d.date)].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------- interventions */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <Wrench className="h-4 w-4" /> Interventions
          </h4>
          {gere && !intervention && (
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setIntervention(true)}>
              Noter
            </Button>
          )}
        </div>
        <InterventionsDeLaPiece siteId={p.siteId} pieceId={pieceId} />
      </section>
      {intervention && (
        <FormulaireIntervention
          siteId={p.siteId}
          pieces={[{ id: p.id, nom: p.nom }]}
          intervention={null}
          pieceParDefaut={p.id}
          onFermer={() => setIntervention(false)}
        />
      )}
    </div>
  )
}

/** Chercher un matériel du parc et le poser dans la pièce. */
function AjoutMateriel({ pieceId, onFermer }: { pieceId: number; onFermer: () => void }) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [terme, setTerme] = useState('')
  const [recherche, setRecherche] = useState('')
  const [quantites, setQuantites] = useState<Record<number, number>>({})

  // La recherche part après une courte pause : pas une requête par lettre tapée.
  useEffect(() => {
    const minuterie = setTimeout(() => setRecherche(terme.trim()), 250)
    return () => clearTimeout(minuterie)
  }, [terme])

  const { data: trouves = [], isFetching } = useQuery({
    queryKey: ['objets-recherche', recherche],
    queryFn: async () =>
      (await api.get<{ objects: ObjetTrouve[] }>('/objects', { params: { search: recherche, limit: 8 } })).data.objects,
    enabled: recherche.length >= 2,
  })

  const poser = async (objet: ObjetTrouve, deplacer = false) => {
    try {
      const { data } = await plansApi.placer(pieceId, {
        objectId: objet.id,
        quantite: objet.materialType === 'lot' ? quantites[objet.id] ?? 1 : undefined,
        deplacer,
      })
      toast.success(data.deplaceDe ? `« ${objet.name} » déplacé depuis ${data.deplaceDe}` : `« ${objet.name} » posé dans la pièce`)
      invaliderBatiments(queryClient)
      setTerme('')
    } catch (erreur: any) {
      const message = erreur?.response?.data?.message ?? "La pose n'a pas abouti"
      // Un matériel unique déjà ailleurs : on propose de le déplacer.
      if (erreur?.response?.status === 409 && objet.materialType !== 'lot' && !deplacer) {
        const ok = await confirmer({ title: message, message: "Le déplacer dans cette pièce ?", confirmLabel: 'Déplacer' })
        if (ok) await poser(objet, true)
        return
      }
      toast.error(message)
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3 dark:border-primary-900 dark:bg-primary-900/10">
      <div className="flex gap-2">
        <Input
          size="sm"
          autoFocus
          placeholder="Chercher dans le parc…"
          icon={<Search className="h-4 w-4" />}
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        <Button size="sm" variant="ghost" onClick={onFermer} aria-label="Fermer la recherche">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {isFetching && <LoadingInline />}
      {recherche.length >= 2 && !isFetching && trouves.length === 0 && (
        <p className="text-xs text-gray-500">Rien dans le parc qui corresponde.</p>
      )}
      <ul className="space-y-1">
        {trouves.map((o) => (
          <li key={o.id} className="flex items-center gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-gray-900 dark:text-gray-100">{o.name}</div>
              <div className="truncate text-xs text-gray-500">
                {[o.reference, o.categoryName, o.materialType === 'lot' ? `lot de ${o.quantityTotal}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            {o.materialType === 'lot' && (
              <input
                type="number"
                min={1}
                aria-label={`Quantité de ${o.name}`}
                className="w-16 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                value={quantites[o.id] ?? 1}
                onChange={(e) => setQuantites({ ...quantites, [o.id]: Math.max(1, Number(e.target.value) || 1) })}
              />
            )}
            <Button size="sm" onClick={() => poser(o)}>
              Poser
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
