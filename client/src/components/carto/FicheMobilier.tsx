import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Crosshair,
  ExternalLink,
  History,
  MapPin,
  Move,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Spinner, useConfirm } from '@/components/ui'
import { mobilierUrbainApi, type MobilierUrbain } from '@/lib/api'
import {
  ETATS,
  STATUTS,
  TYPES_INTERVENTION,
  alerteDe,
  coord,
  etat,
  familleExemplaire,
  jour,
  nomComplet,
  sourcePosition,
  statut,
  typeIntervention,
} from '@/lib/mobilierUrbain'
import { useGeolocation } from '@/lib/useGeolocation'

/**
 * La fiche d'un exemplaire : « le banc 23 ».
 *
 * Tout le module existe pour cet écran. Il répond à la phrase qui l'a fait
 * naître — « le banc 23 a été repeint, je veux le retrouver sans avoir créé
 * vingt-trois bancs » — en tenant deux choses côte à côte :
 *
 * **Ce qui est commun au modèle** (le nom au catalogue, la référence, le prix),
 * qui n'est pas modifiable ici et renvoie à la fiche du parc. Le modifier
 * depuis un exemplaire le modifierait pour les vingt-deux autres.
 *
 * **Ce qui n'appartient qu'à cet exemplaire** : sa position, son état, sa rue,
 * et surtout son historique. C'est là que « repeint le 14 mars » se range, et
 * nulle part ailleurs.
 */

interface Props {
  itemId: number
  /** La version déjà connue de la liste : évite un écran vide le temps du détail. */
  apercu?: MobilierUrbain | null
  onFermer: () => void
  /** Passe la carte en mode « pointer » pour déplacer cet exemplaire. */
  onDeplacer?: (item: MobilierUrbain) => void
  onSupprime?: () => void
}

const CHAMP =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
const LIBELLE = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

export default function FicheMobilier({ itemId, apercu, onFermer, onDeplacer, onSupprime }: Props) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [edition, setEdition] = useState(false)
  const [ajout, setAjout] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['mobilier', itemId],
    queryFn: async () => (await mobilierUrbainApi.detail(itemId)).data.data,
  })

  const item = data ?? apercu ?? null

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['mobilier'] })
    queryClient.invalidateQueries({ queryKey: ['mobilier-facettes'] })
    queryClient.invalidateQueries({ queryKey: ['mobilier-stats'] })
  }

  const supprimer = useMutation({
    mutationFn: () => mobilierUrbainApi.supprimer(itemId),
    onSuccess: () => {
      toast.success('Mobilier supprimé')
      rafraichir()
      onSupprime?.()
      onFermer()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'La suppression a échoué'),
  })

  const demanderSuppression = async () => {
    const ok = await confirmer({
      title: 'Supprimer ce mobilier ?',
      message:
        "Son historique d'interventions part avec lui. Pour un mobilier retiré du terrain, préférez le statut « Déposé » : il sort de la carte et garde sa mémoire.",
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate()
  }

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        {isLoading ? <Spinner /> : <p className="text-sm text-gray-500">Mobilier introuvable.</p>}
      </div>
    )
  }

  const famille = familleExemplaire(item)
  const alerte = alerteDe(item)
  const leStatut = statut(item.status)
  const lEtat = etat(item.condition_state)

  return (
    <div className="flex h-full flex-col">
      {/* En-tête */}
      <div className="flex items-start gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xl"
          style={{ background: `${famille.couleur}22` }}
        >
          {famille.icone}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold text-gray-900 dark:text-gray-100">
            {nomComplet(item)}
          </h3>
          <p className="truncate text-sm text-gray-500 dark:text-gray-400">
            {item.street || item.address || famille.libelle}
          </p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer la fiche"
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {alerte && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: `${alerte.couleur}1a`, color: alerte.couleur }}
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">{alerte.motif}</span>
            {item.next_intervention_date && (
              <span className="opacity-80">— échéance au {jour(item.next_intervention_date)}</span>
            )}
          </div>
        )}

        {/* Le modèle : commun aux vingt-trois, et modifiable ailleurs. */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Matériel du parc
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.object_name}
              </p>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {[item.object_reference, item.category_name, item.subcategory_name]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Link
              to={`/objects/${item.object_id}`}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
            >
              Ouvrir
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Exemplaire <strong>n° {item.numero}</strong> de ce modèle. Ce qui est écrit ici ne
            concerne que lui.
          </p>
        </div>

        {edition ? (
          <Edition item={item} onFini={() => setEdition(false)} onEnregistre={rafraichir} />
        ) : (
          <>
            {/* Identité et état */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Donnee libelle="Statut">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${leStatut.pastille}`}>
                  {leStatut.libelle}
                </span>
              </Donnee>
              <Donnee libelle="État">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${lEtat.pastille}`}>
                  {lEtat.libelle}
                </span>
              </Donnee>
              <Donnee libelle="Posé le">{jour(item.installed_on)}</Donnee>
              <Donnee libelle="Dernière intervention">{jour(item.last_intervention_date)}</Donnee>
              <Donnee libelle="Prochaine échéance">{jour(item.next_intervention_date)}</Donnee>
              <Donnee libelle="Zone / secteur">{item.sector || '—'}</Donnee>
            </div>

            {item.notes && (
              <div>
                <p className={LIBELLE}>Notes</p>
                <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                  {item.notes}
                </p>
              </div>
            )}

            {/* Position */}
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <MapPin className="h-3.5 w-3.5" />
                Position
              </p>
              <p className="text-sm text-gray-900 dark:text-gray-100">{item.address || '—'}</p>
              <p className="mt-0.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                {coord(item.latitude)}, {coord(item.longitude)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {sourcePosition(item.position_source).libelle}
                {item.position_accuracy ? ` · ±${Math.round(Number(item.position_accuracy))} m` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {onDeplacer && (
                  <button
                    type="button"
                    onClick={() => onDeplacer(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-white dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <Move className="h-3.5 w-3.5" />
                    Déplacer sur la carte
                  </button>
                )}
                <ReleverIci item={item} onEnregistre={rafraichir} />
                <a
                  href={`https://www.openstreetmap.org/?mlat=${item.latitude}&mlon=${item.longitude}#map=19/${item.latitude}/${item.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-white dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Itinéraire
                </a>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEdition(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Modifier
              </Button>
              <Button variant="ghost" onClick={demanderSuppression} disabled={supprimer.isPending}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Supprimer
              </Button>
            </div>
          </>
        )}

        {/* Historique */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <History className="h-4 w-4" />
              Interventions
              <span className="font-normal text-gray-500 dark:text-gray-400">
                ({item.interventions?.length ?? 0})
              </span>
            </h4>
            <Button variant="secondary" onClick={() => setAjout((v) => !v)}>
              <Plus className="mr-1 h-4 w-4" />
              Ajouter
            </Button>
          </div>

          {ajout && (
            <AjoutIntervention
              item={item}
              onFini={() => setAjout(false)}
              onEnregistre={rafraichir}
            />
          )}

          {(item.interventions ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Rien n’a encore été consigné sur cet exemplaire.
            </p>
          ) : (
            <ol className="space-y-2">
              {(item.interventions ?? []).map((intervention) => {
                const type = typeIntervention(intervention.intervention_type)
                return (
                  <li
                    key={intervention.id}
                    className="flex gap-3 rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
                  >
                    <span className="text-lg leading-none">{type.icone}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {type.libelle}
                        <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                          {jour(intervention.performed_on)}
                        </span>
                      </p>
                      {intervention.description && (
                        <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
                          {intervention.description}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {[
                          intervention.performed_by || intervention.auteur,
                          intervention.cost ? `${Number(intervention.cost).toFixed(2)} €` : null,
                          intervention.next_date ? `à revoir le ${jour(intervention.next_date)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

function Donnee({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={LIBELLE}>{libelle}</p>
      <div className="text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  )
}

/**
 * « Je suis devant : reprends ma position. »
 *
 * Le cas le plus fréquent de correction sur le terrain. Un point posé de
 * mémoire sur une photo aérienne se retrouve régulièrement du mauvais côté de
 * la chaussée ; l'agent qui passe devant est le mieux placé pour le corriger, à
 * condition que cela tienne en un bouton.
 */
function ReleverIci({ item, onEnregistre }: { item: MobilierUrbain; onEnregistre: () => void }) {
  const queryClient = useQueryClient()
  const { getPosition, loading } = useGeolocation()

  const enregistrer = useMutation({
    mutationFn: (position: { lat: number; lng: number; accuracy: number }) =>
      mobilierUrbainApi.modifier(item.id, {
        latitude: position.lat,
        longitude: position.lng,
        position_source: 'gps',
        position_accuracy: position.accuracy,
      }),
    onSuccess: () => {
      toast.success('Position mise à jour')
      queryClient.invalidateQueries({ queryKey: ['mobilier', item.id] })
      onEnregistre()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const relever = async () => {
    try {
      enregistrer.mutate(await getPosition())
    } catch (erreur: any) {
      toast.error(erreur?.message ?? 'Position indisponible')
    }
  }

  return (
    <button
      type="button"
      onClick={relever}
      disabled={loading || enregistrer.isPending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-900/30"
    >
      <Crosshair className="h-3.5 w-3.5" />
      {loading ? 'Signal…' : 'Je suis devant'}
    </button>
  )
}

/** Modification de ce qui n'appartient qu'à cet exemplaire. */
function Edition({
  item,
  onFini,
  onEnregistre,
}: {
  item: MobilierUrbain
  onFini: () => void
  onEnregistre: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    label: item.label ?? '',
    code: item.code ?? '',
    address: item.address ?? '',
    street: item.street ?? '',
    sector: item.sector ?? '',
    status: item.status,
    condition_state: item.condition_state,
    installed_on: item.installed_on ? String(item.installed_on).slice(0, 10) : '',
    notes: item.notes ?? '',
  })

  const enregistrer = useMutation({
    mutationFn: () => mobilierUrbainApi.modifier(item.id, form),
    onSuccess: () => {
      toast.success('Modifications enregistrées')
      queryClient.invalidateQueries({ queryKey: ['mobilier', item.id] })
      onEnregistre()
      onFini()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const champ = (clef: keyof typeof form) => ({
    value: form[clef],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [clef]: e.target.value }),
  })

  return (
    <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-800 dark:bg-primary-900/10">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LIBELLE}>Nom sur la carte</label>
          <input type="text" {...champ('label')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>Numéro d’inventaire</label>
          <input type="text" {...champ('code')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>Date de pose</label>
          <input type="date" {...champ('installed_on')} className={CHAMP} />
        </div>
        <div className="sm:col-span-2">
          <label className={LIBELLE}>Adresse</label>
          <input type="text" {...champ('address')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>Rue</label>
          <input type="text" {...champ('street')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>Zone / secteur</label>
          <input type="text" {...champ('sector')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>Statut</label>
          <select {...champ('status')} className={CHAMP}>
            {STATUTS.map((s) => (
              <option key={s.valeur} value={s.valeur}>
                {s.libelle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LIBELLE}>État</label>
          <select {...champ('condition_state')} className={CHAMP}>
            {ETATS.map((e) => (
              <option key={e.valeur} value={e.valeur}>
                {e.libelle}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LIBELLE}>Notes</label>
          <textarea rows={2} {...champ('notes')} className={CHAMP} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onFini} disabled={enregistrer.isPending}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
          Enregistrer
        </Button>
      </div>
    </div>
  )
}

/**
 * Consigner ce qui vient d'être fait.
 *
 * L'état du mobilier est demandé **dans le même formulaire** : un banc qu'on
 * vient de repeindre est en bon état, et exiger d'aller le retaper dans la
 * fiche garantit que personne ne le fera. La prochaine échéance aussi, parce
 * que c'est en refermant une intervention qu'on sait quand repasser.
 */
function AjoutIntervention({
  item,
  onFini,
  onEnregistre,
}: {
  item: MobilierUrbain
  onFini: () => void
  onEnregistre: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    intervention_type: 'entretien',
    performed_on: new Date().toISOString().slice(0, 10),
    next_date: '',
    description: '',
    cost: '',
    performed_by: '',
    condition_state: item.condition_state,
    status: item.status,
  })

  const enregistrer = useMutation({
    mutationFn: () => mobilierUrbainApi.ajouterIntervention(item.id, form),
    onSuccess: () => {
      toast.success('Intervention consignée')
      queryClient.invalidateQueries({ queryKey: ['mobilier', item.id] })
      onEnregistre()
      onFini()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const champ = (clef: keyof typeof form) => ({
    value: form[clef],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [clef]: e.target.value }),
  })

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LIBELLE}>Nature</label>
          <select {...champ('intervention_type')} className={CHAMP}>
            {TYPES_INTERVENTION.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.icone} {t.libelle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LIBELLE}>Date</label>
          <input type="date" {...champ('performed_on')} className={CHAMP} />
        </div>
        <div className="sm:col-span-2">
          <label className={LIBELLE}>Ce qui a été fait</label>
          <textarea
            rows={2}
            {...champ('description')}
            placeholder="Repeint en vert RAL 6005, lattes 3 et 4 remplacées…"
            className={CHAMP}
          />
        </div>
        <div>
          <label className={LIBELLE}>Par</label>
          <input
            type="text"
            {...champ('performed_by')}
            placeholder="Régie, entreprise…"
            className={CHAMP}
          />
        </div>
        <div>
          <label className={LIBELLE}>Coût (€)</label>
          <input type="number" step="0.01" {...champ('cost')} className={CHAMP} />
        </div>
        <div>
          <label className={LIBELLE}>État après intervention</label>
          <select {...champ('condition_state')} className={CHAMP}>
            {ETATS.map((e) => (
              <option key={e.valeur} value={e.valeur}>
                {e.libelle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LIBELLE}>À revoir le</label>
          <input type="date" {...champ('next_date')} className={CHAMP} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onFini} disabled={enregistrer.isPending}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
          Consigner
        </Button>
      </div>
    </div>
  )
}
