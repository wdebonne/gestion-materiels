import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, FileSpreadsheet, Link2, Search, Undo2, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, CardHeader, CardTitle, LoadingInline, Modal, ModalBody, ModalFooter } from '@/components/ui'
import api from '@/lib/api'
import { comptaApi, depuis, jourFr, montant, type DroitsCompta, type Immobilisation } from '@/lib/comptabilite'
import { cn } from '@/lib/utils'

const CLASSE_CHAMP =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100'

const ETATS = [
  { valeur: 'a_ranger', libelle: 'À ranger' },
  { valeur: 'rangee', libelle: 'Rangées' },
  { valeur: 'ignoree', libelle: 'Ignorées' },
  { valeur: '', libelle: 'Toutes' },
]

const message = (e: any, repli: string) => e?.response?.data?.message ?? repli

/** Déposer l'export des immobilisations de Ciril, colonnes vérifiées avant d'écrire. */
function ImportCiril() {
  const queryClient = useQueryClient()
  const [fichier, setFichier] = useState<File | null>(null)
  const [analyse, setAnalyse] = useState<any>(null)
  const [correspondance, setCorrespondance] = useState<Record<string, number | ''>>({})
  const [resultat, setResultat] = useState<any>(null)

  const analyser = useMutation({
    mutationFn: comptaApi.analyser,
    onSuccess: (a) => {
      setAnalyse(a)
      setCorrespondance(a.correspondance ?? {})
    },
    onError: (e) => {
      setAnalyse(null)
      toast.error(message(e, 'Fichier illisible'))
    },
  })

  const importer = useMutation({
    mutationFn: () =>
      comptaApi.importer(
        fichier!,
        Object.fromEntries(Object.entries(correspondance).filter(([, i]) => i !== '')) as Record<string, number>
      ),
    onSuccess: (r) => {
      setResultat(r)
      setFichier(null)
      setAnalyse(null)
      toast.success(`${r.creees} nouvelle(s) immobilisation(s), ${r.misesAJour} mise(s) à jour`)
      queryClient.invalidateQueries({ queryKey: ['comptabilite'] })
    },
    onError: (e) => toast.error(message(e, 'Import impossible')),
  })

  const choisir = (f: File | null) => {
    setFichier(f)
    setResultat(null)
    setAnalyse(null)
    if (f) analyser.mutate(f)
  }

  const manquants = (analyse?.champs ?? [])
    .filter((c: any) => c.obligatoire && (correspondance[c.champ] === undefined || correspondance[c.champ] === ''))
    .map((c: any) => c.libelle)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" aria-hidden /> Importer l’export de Ciril
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Exportez la liste des immobilisations depuis Ciril Finance (CSV ou Excel) et déposez-la ici. Vous pouvez redéposer
          le même fichier : les biens déjà connus sont mis à jour, jamais dupliqués, et leur rangement est conservé.
        </p>
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-5 text-center dark:border-gray-600">
          <input
            id="compta-fichier"
            type="file"
            accept=".csv,.txt,.xlsx"
            className="sr-only"
            onChange={(e) => choisir(e.target.files?.[0] ?? null)}
          />
          <label htmlFor="compta-fichier" className="cursor-pointer text-sm text-gray-700 dark:text-gray-200">
            <FileSpreadsheet className="mx-auto mb-2 h-9 w-9 text-gray-500" aria-hidden />
            {fichier ? fichier.name : 'Cliquez pour choisir le fichier exporté de Ciril'}
            <span className="mt-1 block text-xs text-gray-500">CSV (séparateur ; ou ,) ou XLSX — 20 Mo au plus</span>
          </label>
        </div>

        {analyser.isPending && <LoadingInline />}

        {analyse && (
          <div className="space-y-3">
            <p className="text-sm text-gray-800 dark:text-gray-100">
              <strong>{analyse.lignes}</strong> ligne{analyse.lignes > 1 ? 's' : ''}, dont <strong>{analyse.nouvelles}</strong> nouvelle
              {analyse.nouvelles > 1 ? 's' : ''}. Vérifiez les colonnes reconnues :
            </p>
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-2 dark:border-gray-700">
              {analyse.champs.map((c: any) => (
                <div key={c.champ} className="flex items-center gap-2">
                  <label htmlFor={`compta-col-${c.champ}`} className="w-40 shrink-0 text-sm text-gray-700 dark:text-gray-200">
                    {c.libelle}
                    {c.obligatoire && <span className="text-red-600"> *</span>}
                  </label>
                  <select
                    id={`compta-col-${c.champ}`}
                    className={CLASSE_CHAMP}
                    value={correspondance[c.champ] ?? ''}
                    onChange={(e) =>
                      setCorrespondance((p) => ({ ...p, [c.champ]: e.target.value === '' ? '' : Number(e.target.value) }))
                    }
                  >
                    <option value="">— ignorer —</option>
                    {analyse.entetes.map((entete: string, i: number) => (
                      <option key={i} value={i}>
                        {entete || `Colonne ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {analyse.apercu?.[0] && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Première ligne : <strong>{analyse.apercu[0].numero || '—'}</strong> — {analyse.apercu[0].libelle || '—'}
                {analyse.apercu[0].valeur_acquisition !== null ? ` — ${montant(analyse.apercu[0].valeur_acquisition)}` : ''}
              </p>
            )}
            {manquants.length > 0 && (
              <p className="text-sm text-red-700 dark:text-red-300">Colonne obligatoire à choisir : {manquants.join(', ')}.</p>
            )}
            <Button onClick={() => importer.mutate()} disabled={importer.isPending || manquants.length > 0} className="w-full">
              {importer.isPending ? 'Import en cours…' : `Importer ${analyse.lignes} ligne${analyse.lignes > 1 ? 's' : ''}`}
            </Button>
          </div>
        )}

        {resultat && (
          <div className="space-y-2" role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
              <CheckCircle className="h-4 w-4" aria-hidden />
              {resultat.creees} nouvelle(s), {resultat.misesAJour} mise(s) à jour, {resultat.inchangees} inchangée(s)
            </p>
            {resultat.erreurs?.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/30">
                <p className="mb-1 flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300">
                  <AlertCircle className="h-4 w-4" aria-hidden /> {resultat.erreurs.length} ligne(s) écartée(s)
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-700 dark:text-red-300">
                  {resultat.erreurs.map((e: any) => (
                    <li key={e.ligne}>
                      Ligne {e.ligne} : {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Choisir un objet déjà saisi dans l'inventaire, pour lui donner ce numéro. */
function FenetreRattacher({ immo, onFermer }: { immo: Immobilisation | null; onFermer: () => void }) {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  useEffect(() => setQ(immo?.libelle ?? ''), [immo])

  const { data: objets = [], isFetching } = useQuery({
    queryKey: ['comptabilite', 'objets-a-rattacher', q],
    queryFn: () => comptaApi.objetsARattacher(q),
    enabled: Boolean(immo) && q.trim().length >= 2,
  })

  const rattacher = useMutation({
    mutationFn: (objectId: number) => comptaApi.rattacher(immo!.id, objectId),
    onSuccess: () => {
      toast.success('Objet rattaché')
      queryClient.invalidateQueries({ queryKey: ['comptabilite'] })
      onFermer()
    },
    onError: (e) => toast.error(message(e, 'Rattachement impossible')),
  })

  return (
    <Modal isOpen={Boolean(immo)} onClose={onFermer} title="Rattacher à un objet existant" size="lg">
      <ModalBody className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Immobilisation n° <strong>{immo?.numero}</strong> — {immo?.libelle}. Cherchez l’objet déjà saisi dans l’inventaire :
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
          <input
            aria-label="Rechercher un objet"
            className={cn(CLASSE_CHAMP, 'pl-9')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, n° d’inventaire, n° de série…"
          />
        </div>
        {isFetching && <LoadingInline />}
        <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700">
          {objets.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium text-gray-900 dark:text-gray-100">{o.nom}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {[o.categorie, o.inventaireInterne, o.localisation].filter(Boolean).join(' — ')}
                  {o.numeroComptable && <span className="text-amber-700 dark:text-amber-300"> — déjà lié au n° {o.numeroComptable}</span>}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => rattacher.mutate(o.id)} disabled={rattacher.isPending}>
                Rattacher
              </Button>
            </li>
          ))}
          {!isFetching && q.trim().length >= 2 && objets.length === 0 && (
            <li className="py-3 text-sm text-gray-500">Aucun objet ne correspond.</li>
          )}
        </ul>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onFermer}>
          Fermer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/**
 * Les immobilisations importées, et leur rangement dans les catégories.
 * Sans la case « Ranger », la liste se consulte : on voit ce qui attend et
 * depuis quand, sans pouvoir le faire à la place de l'inventaire.
 */
export default function OngletARanger({ droits }: { droits: DroitsCompta }) {
  const queryClient = useQueryClient()
  const [etat, setEtat] = useState('a_ranger')
  const [recherche, setRecherche] = useState('')
  const [page, setPage] = useState(1)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [categorieId, setCategorieId] = useState('')
  const [sousCategorieId, setSousCategorieId] = useState('')
  const [exemplaires, setExemplaires] = useState(1)
  const [aRattacher, setARattacher] = useState<Immobilisation | null>(null)

  useEffect(() => {
    setSelection(new Set())
    setPage(1)
  }, [etat, recherche])

  const { data, isLoading } = useQuery({
    queryKey: ['comptabilite', 'immobilisations', etat, recherche, page],
    queryFn: () => comptaApi.immobilisations({ etat, recherche, page, limite: 50 }),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'simple'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return res.data.categories ?? res.data.data ?? []
    },
    enabled: droits.ranger,
  })
  const { data: sousCategories = [] } = useQuery({
    queryKey: ['subcategories', categorieId],
    queryFn: async () => {
      const res = await api.get(`/categories/${categorieId}/subcategories`)
      return res.data.subcategories ?? res.data.data ?? []
    },
    enabled: droits.ranger && Boolean(categorieId),
  })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ['comptabilite'] })

  const ranger = useMutation({
    mutationFn: () =>
      comptaApi.ranger({
        ids: [...selection],
        categoryId: sousCategorieId ? null : Number(categorieId),
        subcategoryId: sousCategorieId ? Number(sousCategorieId) : null,
        exemplaires,
      }),
    onSuccess: ({ data: r }) => {
      toast.success(`${r.objets.length} objet(s) créé(s)`)
      setSelection(new Set())
      setExemplaires(1)
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Rangement impossible')),
  })

  const ignorer = useMutation({
    mutationFn: comptaApi.ignorer,
    onSuccess: () => {
      toast.success('Immobilisation ignorée')
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Impossible')),
  })
  const retablir = useMutation({
    mutationFn: comptaApi.retablir,
    onSuccess: () => {
      toast.success('Immobilisation remise à ranger')
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Impossible')),
  })

  const liste = data?.immobilisations ?? []
  const selectionnables = useMemo(() => liste.filter((i) => i.etat === 'a_ranger'), [liste])
  const toutCoche = selectionnables.length > 0 && selectionnables.every((i) => selection.has(i.id))
  const basculer = (id: number) =>
    setSelection((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limite)) : 1

  return (
    <div className="space-y-6">
      {droits.importer && <ImportCiril />}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Immobilisations</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filtrer par état" className="flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
              {ETATS.map((e) => (
                <button
                  key={e.valeur}
                  type="button"
                  aria-pressed={etat === e.valeur}
                  onClick={() => setEtat(e.valeur)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm',
                    etat === e.valeur
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  )}
                >
                  {e.libelle}
                </button>
              ))}
            </div>
            <input
              aria-label="Rechercher une immobilisation"
              placeholder="N°, désignation, fournisseur…"
              className={cn(CLASSE_CHAMP, 'w-56')}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {!droits.ranger && etat === 'a_ranger' && (data?.total ?? 0) > 0 && (
            <p className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
              Le rangement dans les catégories est fait par l’inventaire. Vous voyez ici ce qui attend, et depuis quand.
            </p>
          )}

          {droits.ranger && selection.size > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3 dark:border-primary-800 dark:bg-primary-900/20">
              <div className="text-sm font-medium text-primary-900 dark:text-primary-100">
                {selection.size} sélectionnée{selection.size > 1 ? 's' : ''} →
              </div>
              <div>
                <label htmlFor="ranger-categorie" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Catégorie
                </label>
                <select
                  id="ranger-categorie"
                  className={CLASSE_CHAMP}
                  value={categorieId}
                  onChange={(e) => {
                    setCategorieId(e.target.value)
                    setSousCategorieId('')
                  }}
                >
                  <option value="">— choisir —</option>
                  {(Array.isArray(categories) ? categories : []).map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {categorieId && (sousCategories as any[]).length > 0 && (
                <div>
                  <label htmlFor="ranger-sous-categorie" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Sous-catégorie
                  </label>
                  <select
                    id="ranger-sous-categorie"
                    className={CLASSE_CHAMP}
                    value={sousCategorieId}
                    onChange={(e) => setSousCategorieId(e.target.value)}
                  >
                    <option value="">— la catégorie elle-même —</option>
                    {(sousCategories as any[]).map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="ranger-exemplaires" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Objets par ligne
                </label>
                <input
                  id="ranger-exemplaires"
                  type="number"
                  min={1}
                  max={500}
                  className={cn(CLASSE_CHAMP, 'w-24')}
                  value={exemplaires}
                  onChange={(e) => setExemplaires(Math.max(1, Number(e.target.value) || 1))}
                  title="Plus d’un seulement si Ciril n’a créé qu’un numéro pour plusieurs objets"
                />
              </div>
              <Button onClick={() => ranger.mutate()} disabled={!categorieId || ranger.isPending}>
                {ranger.isPending ? 'Création…' : 'Créer dans l’inventaire'}
              </Button>
            </div>
          )}

          {isLoading ? (
            <LoadingInline />
          ) : liste.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {etat === 'a_ranger' ? 'Rien à ranger : tout ce qui vient de Ciril a trouvé sa place.' : 'Aucune immobilisation.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    {droits.ranger && (
                      <th className="w-8 py-2">
                        <input
                          type="checkbox"
                          aria-label="Tout sélectionner"
                          checked={toutCoche}
                          disabled={selectionnables.length === 0}
                          onChange={() => setSelection(toutCoche ? new Set() : new Set(selectionnables.map((i) => i.id)))}
                        />
                      </th>
                    )}
                    <th className="py-2 pr-3">N°</th>
                    <th className="py-2 pr-3">Désignation</th>
                    <th className="py-2 pr-3">Acquis le</th>
                    <th className="py-2 pr-3 text-right">Valeur</th>
                    <th className="py-2 pr-3">Fournisseur / facture</th>
                    <th className="py-2 pr-3">État</th>
                    {droits.ranger && <th className="py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {liste.map((i) => (
                    <tr key={i.id} className={cn(selection.has(i.id) && 'bg-primary-50/60 dark:bg-primary-900/20')}>
                      {droits.ranger && (
                        <td className="py-2">
                          {i.etat === 'a_ranger' && (
                            <input
                              type="checkbox"
                              aria-label={`Sélectionner ${i.numero}`}
                              checked={selection.has(i.id)}
                              onChange={() => basculer(i.id)}
                            />
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap py-2 pr-3 font-mono text-gray-900 dark:text-gray-100">{i.numero}</td>
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">{i.libelle}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-gray-600 dark:text-gray-300">{jourFr(i.dateAcquisition)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-600 dark:text-gray-300">{montant(i.valeurAcquisition)}</td>
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {[i.fournisseur, i.numeroFacture].filter(Boolean).join(' — ') || '—'}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {i.etat === 'a_ranger' ? (
                          <span className="text-amber-800 dark:text-amber-200">
                            En attente — importée {depuis(joursDepuis(i.importeeLe))}
                          </span>
                        ) : i.etat === 'rangee' ? (
                          <span>
                            {i.nbObjets} objet{i.nbObjets > 1 ? 's' : ''}
                            {i.rangeePar ? ` — ${i.rangeePar}` : ''}
                          </span>
                        ) : (
                          'Ignorée'
                        )}
                      </td>
                      {droits.ranger && (
                        <td className="whitespace-nowrap py-2 text-right">
                          {i.etat === 'a_ranger' && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setARattacher(i)} title="Rattacher à un objet déjà saisi">
                                <Link2 className="mr-1 h-4 w-4" aria-hidden /> Rattacher
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => ignorer.mutate(i.id)} title="Pas du matériel à inventorier">
                                <EyeOff className="mr-1 h-4 w-4" aria-hidden /> Ignorer
                              </Button>
                            </>
                          )}
                          {i.etat === 'ignoree' && (
                            <Button size="sm" variant="ghost" onClick={() => retablir.mutate(i.id)}>
                              <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Remettre à ranger
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
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
      </Card>

      <FenetreRattacher immo={aRattacher} onFermer={() => setARattacher(null)} />
    </div>
  )
}

/** Jours écoulés depuis un instant local « AAAA-MM-JJ HH:MM:SS ». */
function joursDepuis(instant: string | null): number | null {
  const m = instant?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const debut = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date()
  const fin = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.max(0, Math.round((fin - debut) / 86400000))
}
