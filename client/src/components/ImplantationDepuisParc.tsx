import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, Minus, Package, Boxes, AlertTriangle, Sprout } from 'lucide-react'
import api from '@/lib/api'
import { ELEMENT_TYPES, deviner, euros } from '@/lib/espacesVerts'

/**
 * Garnir un espace vert avec du matériel du parc.
 *
 * Les éléments se saisissaient à la main, dans une fenêtre qui ignorait le
 * parc : on retapait « Rosier Pierre de Ronsard », son espèce, son image et son
 * prix, alors que tout cela est déjà sur sa fiche. Deux saisies pour une chose,
 * et la seconde, faite un jour de plantation, ne ressemblait jamais tout à fait
 * à la première : « rosier », « Rosier PdR » et « rosiers rouges » devenaient
 * trois lignes, donc trois coûts, et plus aucun total ne voulait dire quelque
 * chose.
 *
 * On part donc du parc, où le matériel est déjà tenu comme il faut : des
 * **lots** — rosiers, bulbes, graminées, comptés à l'unité — et du **mobilier**,
 * à l'exemplaire ou en lot. Poser, c'est choisir dans ce catalogue, dire
 * combien, et éventuellement dans quelle jardinière.
 *
 * **Le prix est figé au moment de la pose.** Repris du parc, ou corrigé ici si
 * la facture du pépiniériste disait autre chose. Le tarif du parc montera l'an
 * prochain — il le doit, c'est le prix auquel on rachètera — sans rien changer
 * à ce que ce massif-ci a coûté. C'est toute la différence entre « ce que je
 * possède vaut » et « ce que j'ai dépensé ».
 */

interface MaterielParc {
  id: number
  name: string
  reference: string | null
  image: string | null
  nature: 'lot' | 'unique' | 'prestation'
  prix_unitaire: number | null
  quantity_total: number | null
  category_id: number | null
  category_name: string | null
  subcategory_name: string | null
  implante: number
  implante_espaces: number
}

/** Une ligne prête à être posée : ce qu'on a choisi, et à quelles conditions. */
interface LigneAPoser {
  object_id: number
  nom: string
  image: string | null
  nature: 'lot' | 'unique'
  prix_parc: number | null
  /** Texte et non nombre : un champ vidé doit pouvoir rester vide. */
  prix: string
  quantite: number
  element_type: string
  group_id: string
}

const aujourdHui = () => new Date().toISOString().slice(0, 10)

export default function ImplantationDepuisParc({
  spaceId,
  groups,
  groupeInitial,
  onClose,
  onSaved,
}: {
  spaceId: number
  groups: Array<{ id: number; name: string; group_type?: string }>
  /** Jardinière depuis laquelle on a ouvert la fenêtre, s'il y en a une. */
  groupeInitial?: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [recherche, setRecherche] = useState('')
  const [categorie, setCategorie] = useState('')
  const [nature, setNature] = useState('')
  const [lignes, setLignes] = useState<LigneAPoser[]>([])
  const [groupeCommun, setGroupeCommun] = useState(groupeInitial ? String(groupeInitial) : '')
  const [nouveauGroupe, setNouveauGroupe] = useState('')
  const [datePose, setDatePose] = useState(aujourdHui())
  const [refuses, setRefuses] = useState<Array<{ object_id: any; motif: string }>>([])

  const { data: catalogue = [], isFetching } = useQuery<MaterielParc[]>({
    queryKey: ['gs-parc-catalogue', recherche, categorie, nature],
    queryFn: () =>
      api
        .get('/green-spaces/parc/catalogue', {
          params: {
            q: recherche || undefined,
            category_id: categorie || undefined,
            nature: nature || undefined,
          },
        })
        .then((r) => r.data.data),
  })

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['categories-pour-implantation'],
    queryFn: () => api.get('/categories').then((r) => r.data.data ?? r.data),
  })

  const choisis = useMemo(() => new Set(lignes.map((l) => l.object_id)), [lignes])

  const total = lignes.reduce(
    (somme, ligne) => somme + ligne.quantite * (parseFloat(ligne.prix) || 0),
    0
  )
  const sansPrix = lignes.filter((ligne) => !(parseFloat(ligne.prix) > 0)).length

  const ajouter = (materiel: MaterielParc) => {
    if (choisis.has(materiel.id) || materiel.nature === 'prestation') return
    // Tout ce qui n'est pas un lot se pose à l'exemplaire : le serveur y ramène
    // la quantité de toute façon, l'écran doit dire la même chose.
    const nature: 'lot' | 'unique' = materiel.nature === 'lot' ? 'lot' : 'unique'
    setLignes((precedentes) => [
      ...precedentes,
      {
        object_id: materiel.id,
        nom: materiel.name,
        image: materiel.image,
        nature,
        prix_parc: materiel.prix_unitaire,
        prix: materiel.prix_unitaire != null ? String(materiel.prix_unitaire) : '',
        quantite: 1,
        element_type: deviner(
          materiel.subcategory_name,
          materiel.category_name,
          materiel.name
        ),
        group_id: '',
      },
    ])
  }

  const modifier = (objectId: number, champs: Partial<LigneAPoser>) =>
    setLignes((precedentes) =>
      precedentes.map((ligne) => (ligne.object_id === objectId ? { ...ligne, ...champs } : ligne))
    )

  const retirer = (objectId: number) =>
    setLignes((precedentes) => precedentes.filter((ligne) => ligne.object_id !== objectId))

  const mutation = useMutation({
    meta: { successMessage: 'Matériel implanté' },
    mutationFn: async () => {
      // Une jardinière peut se créer au moment où l'on plante : y penser la
      // veille, dans un autre écran, personne ne le fait.
      let groupId: number | null = groupeCommun ? Number(groupeCommun) : null
      if (nouveauGroupe.trim()) {
        const cree = await api.post(`/green-spaces/${spaceId}/groups`, {
          name: nouveauGroupe.trim(),
          group_type: 'jardiniere',
        })
        groupId = cree.data.data.id
      }

      const reponse = await api.post(`/green-spaces/${spaceId}/implantations`, {
        group_id: groupId,
        lignes: lignes.map((ligne) => ({
          object_id: ligne.object_id,
          quantity: ligne.quantite,
          // Une chaîne vide veut dire « pas de prix connu » : l'envoyer telle
          // quelle laisse le serveur reprendre celui du parc, ce qui n'est pas
          // la même chose que de figer zéro.
          unit_price: ligne.prix === '' ? undefined : parseFloat(ligne.prix),
          element_type: ligne.element_type,
          group_id: ligne.group_id ? Number(ligne.group_id) : groupId,
          planting_date: datePose || undefined,
          condition_state: 'neuf',
        })),
      })
      return reponse.data
    },
    onSuccess: (donnees: any) => {
      // Une pose partielle est enregistrée : on ne referme que si tout est
      // passé, sinon la liste des refus n'aurait jamais le temps d'être lue.
      // Ce qui *est* passé doit apparaître derrière tout de suite, sans quoi on
      // repose deux fois les mêmes rosiers en croyant que rien n'a été écrit.
      if (donnees?.refuses?.length) {
        queryClient.invalidateQueries({ queryKey: ['green-space', spaceId] })
        queryClient.invalidateQueries({ queryKey: ['green-space-couts', spaceId] })
        queryClient.invalidateQueries({ queryKey: ['gs-parc-catalogue'] })
        setRefuses(donnees.refuses)
        setLignes((precedentes) =>
          precedentes.filter((ligne) =>
            donnees.refuses.some((r: any) => Number(r.object_id) === ligne.object_id)
          )
        )
        return
      }
      onSaved()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Implanter du matériel du parc
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Le prix est figé à la pose : mettre à jour le parc plus tard ne changera pas ce coût.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="h-11 w-11 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-gray-200 dark:divide-gray-700">
            {/* ── Le parc ── */}
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder="Rechercher dans le parc..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[44px]"
                  />
                </div>
                <select
                  value={nature}
                  onChange={(e) => setNature(e.target.value)}
                  aria-label="Nature du matériel"
                  className="text-sm px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[44px]"
                >
                  <option value="">Tout</option>
                  <option value="lot">Lots</option>
                  <option value="unique">Exemplaires</option>
                </select>
              </div>

              <select
                value={categorie}
                onChange={(e) => setCategorie(e.target.value)}
                aria-label="Catégorie du parc"
                className="w-full text-sm px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[44px]"
              >
                <option value="">Toutes les catégories</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {isFetching && catalogue.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                  Lecture du parc...
                </p>
              ) : catalogue.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Aucun matériel du parc ne correspond</p>
                  <p className="text-xs mt-1">
                    Les fleurs et le mobilier se déclarent dans le parc, en lot ou à l'exemplaire.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
                  {catalogue.map((materiel) => (
                    <button
                      key={materiel.id}
                      onClick={() => ajouter(materiel)}
                      disabled={choisis.has(materiel.id)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                        choisis.has(materiel.id)
                          ? 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 opacity-60'
                          : 'border-gray-200 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">
                          {materiel.nature === 'lot' ? (
                            <Boxes className="h-4 w-4" />
                          ) : (
                            <Package className="h-4 w-4" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {materiel.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {materiel.category_name}
                            {materiel.subcategory_name ? ` › ${materiel.subcategory_name}` : ''}
                            {materiel.nature === 'lot' && materiel.quantity_total
                              ? ` • ${materiel.quantity_total} au parc`
                              : ''}
                            {materiel.implante > 0
                              ? ` • ${materiel.implante} déjà en place`
                              : ''}
                          </p>
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {materiel.prix_unitaire != null ? euros(materiel.prix_unitaire) : '— €'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Ce qu'on pose ── */}
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Dans le groupe
                  </label>
                  <select
                    value={groupeCommun}
                    onChange={(e) => {
                      setGroupeCommun(e.target.value)
                      setNouveauGroupe('')
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm min-h-[44px]"
                  >
                    <option value="">Aucun groupe</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Date de pose
                  </label>
                  <input
                    type="date"
                    value={datePose}
                    onChange={(e) => setDatePose(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <input
                  type="text"
                  value={nouveauGroupe}
                  onChange={(e) => {
                    setNouveauGroupe(e.target.value)
                    if (e.target.value) setGroupeCommun('')
                  }}
                  placeholder="…ou créer une jardinière : son nom"
                  className="w-full px-3 py-2 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm min-h-[44px]"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Plusieurs variétés dans une même jardinière se posent en une fois : leur coût se
                  lit ensuite groupe par groupe.
                </p>
              </div>

              {lignes.length === 0 ? (
                <div className="text-center py-10 text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                  <Sprout className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Choisissez du matériel dans le parc</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                  {lignes.map((ligne) => {
                    const prix = parseFloat(ligne.prix) || 0
                    return (
                      <div
                        key={ligne.object_id}
                        className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {ligne.nom}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {ligne.nature === 'lot' ? 'Lot' : 'Exemplaire'}
                              {ligne.prix_parc != null
                                ? ` • parc : ${euros(ligne.prix_parc)}`
                                : ' • aucun prix au parc'}
                            </p>
                          </div>
                          <button
                            onClick={() => retirer(ligne.object_id)}
                            aria-label={`Retirer ${ligne.nom}`}
                            className="p-1 text-gray-500 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                          <div>
                            <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Quantité
                            </label>
                            {ligne.nature === 'lot' ? (
                              <div className="flex items-center">
                                <button
                                  onClick={() =>
                                    modifier(ligne.object_id, {
                                      quantite: Math.max(1, ligne.quantite - 1),
                                    })
                                  }
                                  aria-label="Un de moins"
                                  className="h-9 w-8 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-l-lg text-gray-600 dark:text-gray-300"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  value={ligne.quantite}
                                  onChange={(e) =>
                                    modifier(ligne.object_id, {
                                      quantite: Math.max(1, parseInt(e.target.value) || 1),
                                    })
                                  }
                                  className="h-9 w-full text-center border-y border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                                />
                                <button
                                  onClick={() =>
                                    modifier(ligne.object_id, { quantite: ligne.quantite + 1 })
                                  }
                                  aria-label="Un de plus"
                                  className="h-9 w-8 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-r-lg text-gray-600 dark:text-gray-300"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              // Un exemplaire identifié se pose une fois : ce
                              // banc-là, pas trois. Le champ dirait le contraire.
                              <p className="h-9 flex items-center text-sm text-gray-500 dark:text-gray-400">
                                1 exemplaire
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Prix unitaire
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={ligne.prix}
                              onChange={(e) => modifier(ligne.object_id, { prix: e.target.value })}
                              placeholder="—"
                              className="h-9 w-full px-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Type
                            </label>
                            <select
                              value={ligne.element_type}
                              onChange={(e) =>
                                modifier(ligne.object_id, { element_type: e.target.value })
                              }
                              className="h-9 w-full px-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                            >
                              {ELEMENT_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.icon} {t.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="text-right">
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">Coût</p>
                            <p className="h-9 flex items-center justify-end text-sm font-semibold text-gray-900 dark:text-white">
                              {prix > 0 ? euros(ligne.quantite * prix) : '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {refuses.length > 0 && (
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <p className="text-xs font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Ces lignes n'ont pas été posées
                  </p>
                  <ul className="mt-1 text-xs text-orange-700 dark:text-orange-400 list-disc pl-4">
                    {refuses.map((refus, index) => (
                      <li key={index}>{refus.motif}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">Coût de cette pose : </span>
            <span className="font-bold text-gray-900 dark:text-white">{euros(total)}</span>
            {sansPrix > 0 && (
              // Un total ne doit jamais se lire comme complet quand il ne l'est
              // pas : c'est ainsi qu'on présente un budget faux.
              <span className="text-xs text-orange-600 dark:text-orange-400 ml-2">
                {sansPrix} ligne{sansPrix > 1 ? 's' : ''} sans prix
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 min-h-[44px]"
            >
              Annuler
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={lignes.length === 0 || mutation.isPending}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
            >
              {mutation.isPending
                ? 'Implantation...'
                : `Implanter ${lignes.length || ''} ligne${lignes.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
