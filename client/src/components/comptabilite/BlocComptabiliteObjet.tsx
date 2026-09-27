import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Landmark, LogOut, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui'
import Can from '@/components/Can'
import { jourFr, montant, sortieObjetApi, type Sortie } from '@/lib/comptabilite'
import FenetreSortie from './FenetreSortie'
import { EtapesSortie } from './OngletSorties'

interface ObjetComptable {
  id: number
  name: string
  status: string
  materialType?: string
  quantityTotal?: number
  immobilisation?: {
    numero: string
    libelle: string | null
    valeur: number | null
    dateAcquisition: string | null
    fournisseur: string | null
    numeroFacture: string | null
  } | null
  sortie?: Sortie | null
}

const message = (e: any, repli: string) => e?.response?.data?.message ?? repli

/**
 * Sur la fiche d'un objet : son numéro comptable, et sa sortie d'inventaire.
 *
 * Un objet sorti affiche un bandeau avec les trois étapes — déclarée, envoyée
 * à la compta, intégrée dans Ciril —, et se remet en service tant que la
 * sortie n'est pas partie. Un objet en service propose « Sortir de
 * l'inventaire » à qui peut le modifier.
 */
export default function BlocComptabiliteObjet({ objet }: { objet: ObjetComptable }) {
  const queryClient = useQueryClient()
  const [ouverte, setOuverte] = useState(false)
  const invalider = () => {
    queryClient.invalidateQueries({ queryKey: ['object', String(objet.id)] })
    queryClient.invalidateQueries({ queryKey: ['object'] })
    queryClient.invalidateQueries({ queryKey: ['comptabilite'] })
  }

  const sortir = useMutation({
    mutationFn: (saisie: Parameters<typeof sortieObjetApi.sortir>[1]) => sortieObjetApi.sortir(objet.id, saisie),
    onSuccess: () => {
      toast.success(objet.immobilisation ? 'Objet sorti : la compta sera prévenue au prochain envoi' : 'Objet sorti de l’inventaire')
      setOuverte(false)
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Sortie impossible')),
  })
  const annuler = useMutation({
    mutationFn: () => sortieObjetApi.annuler(objet.id),
    onSuccess: () => {
      toast.success('L’objet revient à l’inventaire')
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Annulation impossible')),
  })

  const { immobilisation, sortie } = objet
  const lot = objet.materialType === 'lot' && (objet.quantityTotal ?? 0) > 1

  return (
    <>
      {sortie && (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium text-red-900 dark:text-red-100">
                Sorti de l’inventaire le {jourFr(sortie.date)} — {sortie.motifLibelle.toLowerCase()}
                {sortie.quantite > 1 ? ` (${sortie.quantite} unités)` : ''}
              </p>
              {sortie.commentaire && <p className="text-sm italic text-red-800 dark:text-red-200">« {sortie.commentaire} »</p>}
              <EtapesSortie
                declareeLe={sortie.declareeLe}
                declareePar={sortie.declareePar}
                envoyeeLe={sortie.envoyeeLe}
                integreeLe={sortie.integreeLe}
                integreePar={sortie.integreePar}
                horsCompta={!immobilisation}
              />
            </div>
            {!sortie.exportId && (
              <Can manage>
                <Button size="sm" variant="outline" onClick={() => annuler.mutate()} disabled={annuler.isPending}>
                  <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Annuler la sortie
                </Button>
              </Can>
            )}
          </div>
        </div>
      )}

      {(immobilisation || !sortie) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-soft dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3 text-sm">
            <Landmark className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden />
            {immobilisation ? (
              <div>
                <span className="text-gray-600 dark:text-gray-300">Immobilisation n° </span>
                <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{immobilisation.numero}</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {' '}— {[immobilisation.libelle, montant(immobilisation.valeur), immobilisation.dateAcquisition ? `acquis le ${jourFr(immobilisation.dateAcquisition)}` : null]
                    .filter(Boolean)
                    .join(' — ')}
                </span>
              </div>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">Pas de numéro comptable</span>
            )}
          </div>
          {!sortie && (
            <Can manage>
              <Button size="sm" variant="outline" onClick={() => setOuverte(true)}>
                <LogOut className="mr-1 h-4 w-4" aria-hidden /> Sortir de l’inventaire
              </Button>
            </Can>
          )}
        </div>
      )}

      <FenetreSortie
        ouverte={ouverte}
        nomObjet={objet.name}
        numeroComptable={immobilisation?.numero ?? null}
        quantiteMax={lot ? objet.quantityTotal : undefined}
        enCours={sortir.isPending}
        onFermer={() => setOuverte(false)}
        onValider={(saisie) => sortir.mutate(saisie)}
      />
    </>
  )
}
