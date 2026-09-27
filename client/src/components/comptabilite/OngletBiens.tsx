import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, CardHeader, CardTitle, LoadingInline, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { comptaApi, jourFr, montant, type Bien, type DroitsCompta } from '@/lib/comptabilite'
import { getStatusLabel } from '@/lib/utils'
import { cn } from '@/lib/utils'
import FenetreSortie from './FenetreSortie'
import { EtapesSortie } from './OngletSorties'

const CLASSE_CHAMP =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100'

const message = (e: any, repli: string) => e?.response?.data?.message ?? repli

/** La fiche d'un bien, en lecture seule : la compta n'a pas accès aux catégories. */
function FicheBien({ id, onFermer }: { id: number | null; onFermer: () => void }) {
  const { data: bien, isLoading } = useQuery({
    queryKey: ['comptabilite', 'bien', id],
    queryFn: () => comptaApi.bien(id!),
    enabled: id !== null,
  })
  const ligne = (libelle: string, valeur: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{libelle}</dt>
      <dd className="text-right text-gray-900 dark:text-gray-100">{valeur || '—'}</dd>
    </div>
  )
  return (
    <Modal isOpen={id !== null} onClose={onFermer} title={bien?.nom ?? 'Bien immobilisé'} size="lg">
      <ModalBody>
        {isLoading || !bien ? (
          <LoadingInline />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Dans l’inventaire</h3>
              <dl className="divide-y divide-gray-100 dark:divide-gray-700">
                {ligne('Catégorie', [bien.categorie, bien.sousCategorie].filter(Boolean).join(' › '))}
                {ligne('Statut', getStatusLabel(bien.statut))}
                {ligne('Localisation', bien.localisation)}
                {ligne('N° d’inventaire', bien.inventaireInterne)}
                {ligne('N° de série', bien.numeroSerie)}
              </dl>
            </section>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Dans Ciril</h3>
              <dl className="divide-y divide-gray-100 dark:divide-gray-700">
                {ligne('N° d’immobilisation', <span className="font-mono">{bien.immobilisation.numero}</span>)}
                {ligne('Désignation', bien.immobilisation.libelle)}
                {ligne('Acquis le', jourFr(bien.immobilisation.dateAcquisition))}
                {ligne('Valeur', montant(bien.immobilisation.valeur))}
                {ligne('Fournisseur', bien.immobilisation.fournisseur)}
                {ligne('Facture', bien.immobilisation.numeroFacture)}
              </dl>
            </section>
            {bien.sortie && (
              <section className="sm:col-span-2">
                <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Sorti le {jourFr(bien.sortie.date)} — {bien.sortie.motifLibelle.toLowerCase()}
                </h3>
                {bien.sortie.commentaire && <p className="mb-1 text-sm italic text-gray-600 dark:text-gray-300">« {bien.sortie.commentaire} »</p>}
                <EtapesSortie
                  declareeLe={bien.sortie.declareeLe}
                  declareePar={bien.sortie.declareePar}
                  envoyeeLe={bien.sortie.envoyeeLe}
                  integreeLe={bien.sortie.integreeLe}
                  integreePar={bien.sortie.integreePar}
                />
              </section>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onFermer}>
          Fermer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export default function OngletBiens({ droits }: { droits: DroitsCompta }) {
  const queryClient = useQueryClient()
  const [recherche, setRecherche] = useState('')
  const [sortis, setSortis] = useState('')
  const [page, setPage] = useState(1)
  const [fiche, setFiche] = useState<number | null>(null)
  const [aSortir, setASortir] = useState<Bien | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['comptabilite', 'biens', recherche, sortis, page],
    queryFn: () => comptaApi.biens({ recherche, sortis, page }),
  })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ['comptabilite'] })
  const sortir = useMutation({
    mutationFn: (saisie: Parameters<typeof comptaApi.sortirBien>[1]) => comptaApi.sortirBien(aSortir!.id, saisie),
    onSuccess: () => {
      toast.success('Bien sorti de l’inventaire')
      setASortir(null)
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Sortie impossible')),
  })
  const annuler = useMutation({
    mutationFn: comptaApi.annulerSortieBien,
    onSuccess: () => {
      toast.success('Sortie annulée')
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Annulation impossible')),
  })

  const biens = data?.biens ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Biens immobilisés dans l’inventaire</CardTitle>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filtrer les biens" className={cn(CLASSE_CHAMP, 'w-44')} value={sortis} onChange={(e) => { setSortis(e.target.value); setPage(1) }}>
            <option value="">Tous</option>
            <option value="non">En service</option>
            <option value="oui">Sortis</option>
          </select>
          <input
            aria-label="Rechercher un bien"
            placeholder="N° comptable, nom, lieu…"
            className={cn(CLASSE_CHAMP, 'w-56')}
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <LoadingInline />
        ) : biens.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Aucun bien immobilisé ne correspond.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-3">N° comptable</th>
                  <th className="py-2 pr-3">Objet</th>
                  <th className="py-2 pr-3">Catégorie</th>
                  <th className="py-2 pr-3">Localisation</th>
                  <th className="py-2 pr-3 text-right">Valeur</th>
                  <th className="py-2 pr-3">État</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {biens.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-gray-900 dark:text-gray-100">{b.immobilisation.numero}</td>
                    <td className="py-2 pr-3">
                      <button type="button" className="text-left text-primary-700 hover:underline dark:text-primary-300" onClick={() => setFiche(b.id)}>
                        {b.nom}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{[b.categorie, b.sousCategorie].filter(Boolean).join(' › ') || '—'}</td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{b.localisation ?? '—'}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-600 dark:text-gray-300">{montant(b.immobilisation.valeur)}</td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                      {b.sortie ? (
                        <span className="text-red-700 dark:text-red-300">
                          Sorti le {jourFr(b.sortie.date)} ({b.sortie.motifLibelle.toLowerCase()})
                          {b.sortie.integreeLe ? ' — intégré' : b.sortie.envoyeeLe ? ' — envoyé' : ' — à envoyer'}
                        </span>
                      ) : (
                        getStatusLabel(b.statut)
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {droits.sortir && !b.sortie && (
                        <Button size="sm" variant="ghost" onClick={() => setASortir(b)}>
                          <LogOut className="mr-1 h-4 w-4" aria-hidden /> Sortir
                        </Button>
                      )}
                      {droits.sortir && b.sortie && !b.sortie.envoyeeLe && (
                        <Button size="sm" variant="ghost" onClick={() => annuler.mutate(b.id)}>
                          <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Annuler la sortie
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Précédente
            </Button>
            <span className="text-gray-600 dark:text-gray-300">
              Page {page} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Suivante
            </Button>
          </div>
        )}
      </CardBody>

      <FicheBien id={fiche} onFermer={() => setFiche(null)} />
      <FenetreSortie
        ouverte={aSortir !== null}
        nomObjet={aSortir?.nom ?? ''}
        numeroComptable={aSortir?.immobilisation.numero ?? null}
        enCours={sortir.isPending}
        onFermer={() => setASortir(null)}
        onValider={(saisie) => sortir.mutate(saisie)}
      />
    </Card>
  )
}
