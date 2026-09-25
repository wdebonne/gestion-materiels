import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  KeyRound,
  Plus,
  Trash2,
  DoorOpen,
  Package,
  History,
  Undo2,
  ExternalLink,
} from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  Badge,
  Button,
  Card,
  Input,
  LoadingScreen,
  Modal,
  ModalBody,
  ModalFooter,
  Tabs,
  Tab,
  useConfirm,
} from '@/components/ui'
import Can from '@/components/Can'
import HistoriqueCle from '@/components/HistoriqueCle'
import AttribuerTrousseau from '@/components/AttribuerTrousseau'
import { BoutonEtiquettesAvery } from '@/components/EtiquettesAvery'
import { formatCurrency, formatDate } from '@/lib/utils'

/**
 * Fiche d'une clé ou d'un trousseau.
 *
 * Le même écran sert les deux, parce que ce sont le même genre d'objet et que
 * les distinguer en deux pages aurait dupliqué l'historique, les étiquettes et
 * la remise. Ce qui change est l'onglet proposé : une clé a des lots et des
 * ouvrants, un trousseau a une composition.
 */

interface Lot {
  id: number
  quantity: number
  unit_price: number | null
  acquired_on: string | null
  supplier: string | null
  reference: string | null
}

export default function CleDetailPage() {
  const { objectId } = useParams<{ objectId: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const [onglet, setOnglet] = useState('apercu')
  const [formLot, setFormLot] = useState(false)
  const [remise, setRemise] = useState(false)
  const [lot, setLot] = useState({
    quantity: 1,
    unitPrice: '',
    acquiredOn: new Date().toISOString().slice(0, 10),
    supplier: '',
    reference: '',
  })

  const { data: cle, isLoading } = useQuery<any>({
    queryKey: ['cle', Number(objectId)],
    queryFn: async () => (await api.get(`/cles/${objectId}`)).data.data,
    enabled: Boolean(objectId),
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['cle', Number(objectId)] })
    queryClient.invalidateQueries({ queryKey: ['cles'] })
  }

  const ajouterLot = useMutation({
    mutationFn: async () =>
      api.post(`/cles/${objectId}/lots`, {
        quantity: lot.quantity,
        unitPrice: lot.unitPrice === '' ? null : Number(lot.unitPrice),
        acquiredOn: lot.acquiredOn,
        supplier: lot.supplier,
        reference: lot.reference,
      }),
    onSuccess: () => {
      toast.success('Lot enregistré')
      setFormLot(false)
      setLot({
        quantity: 1,
        unitPrice: '',
        acquiredOn: new Date().toISOString().slice(0, 10),
        supplier: '',
        reference: '',
      })
      rafraichir()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const restituer = useMutation({
    mutationFn: async (etat: string) =>
      api.post(`/cles/${objectId}/restituer`, { etatRetour: etat }),
    onSuccess: () => {
      toast.success('Restitution enregistrée')
      queryClient.invalidateQueries({ queryKey: ['cle-historique', Number(objectId)] })
      rafraichir()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? 'Restitution impossible'),
  })

  const supprimerLot = async (id: number) => {
    const ok = await confirm({
      title: 'Supprimer ce lot ?',
      message: 'La quantité et la valeur du stock seront recalculées.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return

    try {
      await api.delete(`/cles/lots/${id}`)
      toast.success('Lot supprimé')
      rafraichir()
    } catch {
      toast.error('Suppression impossible')
    }
  }

  if (isLoading) return <LoadingScreen message="Chargement…" />
  if (!cle) {
    return (
      <Card className="p-6 text-center text-gray-600 dark:text-gray-300">Matériel introuvable.</Card>
    )
  }

  const estLot = cle.material_type === 'lot'
  const stock = cle.stock ?? { total: 0, enTrousseaux: 0, attribueesSeules: 0, disponibles: 0 }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/cles"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Clés et badges
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <KeyRound className="h-6 w-6 flex-shrink-0 text-primary-600" />
            <span className="truncate">{cle.name}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            {cle.reference && (
              <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                {cle.reference}
              </span>
            )}
            <span>{cle.subcategory_name || cle.category_name}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BoutonEtiquettesAvery
            materiels={[{ id: cle.id, name: cle.name, reference: cle.reference }]}
          />
          <Link to={`/objects/${cle.id}`}>
            <Button variant="outline">
              <ExternalLink className="mr-2 h-4 w-4" />
              Fiche matériel
            </Button>
          </Link>
        </div>
      </div>

      {/* Détention : l'information la plus demandée, donc la plus haute. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {estLot ? 'Stock' : 'Détention'}
            </div>
            {estLot ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="info">
                  <span className="flex items-center gap-1">
                    <Package className="h-3.5 w-3.5" />
                    {stock.total} au total
                  </span>
                </Badge>
                <Badge variant="success">{stock.disponibles} au coffre</Badge>
                {stock.enTrousseaux > 0 && (
                  <Badge variant="default">{stock.enTrousseaux} en trousseaux</Badge>
                )}
                {stock.attribueesSeules > 0 && (
                  <Badge variant="warning">{stock.attribueesSeules} prêtées</Badge>
                )}
              </div>
            ) : cle.detenteur ? (
              <div className="mt-1 font-medium text-gray-900 dark:text-gray-100">
                {cle.detenteur.holder_type === 'user'
                  ? [cle.detenteur.holder_first_name, cle.detenteur.holder_last_name]
                      .filter(Boolean)
                      .join(' ')
                  : cle.detenteur.holder_type === 'service'
                    ? cle.detenteur.holder_service_name
                    : cle.detenteur.holder_type === 'ouvrant'
                      ? [cle.detenteur.holder_site_name, cle.detenteur.holder_ouvrant_name]
                          .filter(Boolean)
                          .join(' — ')
                      : cle.detenteur.holder_label}
                <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-300">
                  depuis le {formatDate(cle.detenteur.remise_on)}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-gray-700 dark:text-gray-200">Non attribué</div>
            )}
          </div>

          <Can fieldWrite>
            <div className="flex items-center gap-2">
              {(estLot ? stock.attribueesSeules > 0 : Boolean(cle.detenteur)) && (
                <Button variant="outline" onClick={() => restituer.mutate('bon')}>
                  <Undo2 className="mr-2 h-4 w-4" />
                  Restituer
                </Button>
              )}
              {(!estLot ? !cle.detenteur : stock.disponibles > 0) && (
                <Button onClick={() => setRemise(true)}>Remettre</Button>
              )}
            </div>
          </Can>
        </div>
      </Card>

      <Tabs value={onglet} onChange={setOnglet}>
        <Tab value="apercu" label={estLot ? 'Ouvrants' : 'Composition'} icon={<DoorOpen className="h-4 w-4" />} />
        {estLot && <Tab value="lots" label="Lots" icon={<Package className="h-4 w-4" />} />}
        <Tab value="historique" label="Historique" icon={<History className="h-4 w-4" />} />
      </Tabs>

      {onglet === 'apercu' &&
        (estLot ? (
          <Card className="p-4">
            {cle.ouvre?.length > 0 ? (
              <ul className="space-y-2">
                {cle.ouvre.map((o: any) => (
                  <li key={o.id} className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                    <DoorOpen className="h-4 w-4 flex-shrink-0 text-gray-500" />
                    {o.est_passe ? (
                      <>
                        <span>{o.site_name}</span>
                        <Badge variant="info" size="sm">
                          passe général
                        </Badge>
                      </>
                    ) : (
                      <span>{o.ouvrant_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-gray-600 dark:text-gray-300">
                Cette clé n'est rattachée à aucun lieu. Renseignez-le pour savoir ce qu'elle ouvre.
              </p>
            )}
          </Card>
        ) : (
          <Card className="p-4">
            {cle.composition?.length > 0 ? (
              <ul className="space-y-2">
                {cle.composition.map((composant: any) => (
                  <li
                    key={composant.id}
                    className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <Link
                      to={`/cles/${composant.object_id}`}
                      className="font-medium text-gray-900 hover:text-primary-600 dark:text-gray-100"
                    >
                      {composant.name}
                    </Link>
                    {composant.ouvre?.length > 0 && (
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        Ouvre :{' '}
                        {composant.ouvre
                          .map((o: any) =>
                            o.est_passe
                              ? `${o.site_name} (passe)`
                              : o.piece_name
                                ? `${[o.piece_site_name, o.piece_name].filter(Boolean).join(' — ')} (pièce)`
                                : [o.ouvrant_site_name, o.ouvrant_name].filter(Boolean).join(' — ')
                          )
                          .join(' · ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-gray-600 dark:text-gray-300">
                Ce trousseau est vide.
              </p>
            )}
          </Card>
        ))}

      {onglet === 'lots' && estLot && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-gray-700 dark:text-gray-200">
              Valeur du stock :{' '}
              <span className="font-semibold">{formatCurrency(cle.valeur?.valeur ?? 0)}</span>
              {cle.valeur?.coutMoyen > 0 && (
                <span className="ml-2 text-gray-600 dark:text-gray-300">
                  (coût moyen {formatCurrency(cle.valeur.coutMoyen)})
                </span>
              )}
            </div>
            <Can manage>
              <Button size="sm" onClick={() => setFormLot(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Ajouter un lot
              </Button>
            </Can>
          </div>

          {cle.lots?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Quantité</th>
                    <th className="py-2 pr-3 font-medium">Prix unitaire</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Fournisseur</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cle.lots.map((l: Lot) => (
                    <tr key={l.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                        {l.acquired_on ? formatDate(l.acquired_on) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">{l.quantity}</td>
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                        {l.unit_price === null ? (
                          <span className="text-gray-500">inconnu</span>
                        ) : (
                          formatCurrency(Number(l.unit_price))
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                        {l.unit_price === null
                          ? '—'
                          : formatCurrency(Number(l.unit_price) * l.quantity)}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {l.supplier || '—'}
                      </td>
                      <td className="py-2 text-right">
                        <Can manage>
                          <button
                            onClick={() => supprimerLot(l.id)}
                            className="touch-target rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                            title="Supprimer ce lot"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-gray-600 dark:text-gray-300">
              Aucun lot enregistré. Ajoutez-en un pour dire combien d'exemplaires existent et ce
              qu'ils ont coûté.
            </p>
          )}
        </Card>
      )}

      {onglet === 'historique' && (
        <Card className="p-4">
          <HistoriqueCle objectId={cle.id} />
        </Card>
      )}

      {formLot && (
        <Modal isOpen onClose={() => setFormLot(false)} title="Ajouter un lot">
          <ModalBody>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Chaque lot garde son prix : une refabrication plus chère ne réévalue pas les clés
                déjà fabriquées.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Quantité"
                  type="number"
                  min={1}
                  value={lot.quantity}
                  onChange={(e) => setLot({ ...lot, quantity: Math.max(1, Number(e.target.value) || 1) })}
                />
                <Input
                  label="Prix unitaire (€)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={lot.unitPrice}
                  onChange={(e) => setLot({ ...lot, unitPrice: e.target.value })}
                  hint="Laisser vide si le prix d'origine est inconnu"
                />
              </div>
              <Input
                label="Date d'acquisition"
                type="date"
                value={lot.acquiredOn}
                onChange={(e) => setLot({ ...lot, acquiredOn: e.target.value })}
              />
              <Input
                label="Fournisseur"
                value={lot.supplier}
                onChange={(e) => setLot({ ...lot, supplier: e.target.value })}
              />
              <Input
                label="Référence du bon ou de la facture"
                value={lot.reference}
                onChange={(e) => setLot({ ...lot, reference: e.target.value })}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormLot(false)}>
              Annuler
            </Button>
            <Button onClick={() => ajouterLot.mutate()} disabled={ajouterLot.isPending}>
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {remise && (
        <AttribuerTrousseau
          objectId={cle.id}
          estLot={estLot}
          disponibles={stock.disponibles}
          onClose={() => setRemise(false)}
        />
      )}
    </div>
  )
}
