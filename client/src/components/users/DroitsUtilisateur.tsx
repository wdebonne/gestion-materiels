import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Building2, LayoutGrid, LifeBuoy, ListChecks, X } from 'lucide-react'
import { Button, LoadingInline, ModalBody, ModalFooter, Select } from '@/components/ui'
import {
  droitsApi,
  siteApi,
  NIVEAUX_TICKET,
  type CategorieDroits,
  type ModuleVisible,
  type NiveauTicket,
  type RattachementSite,
} from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Les droits d'une personne, dans l'onglet voisin de ses informations.
 *
 * « Un demandeur n'a pas besoin de voir les manifestations ni les clés, juste
 * les tickets ; soit il voit tous les tickets de ses bâtiments, soit juste les
 * siens ; les techniciens n'ont besoin que des leurs ; l'informatique n'a pas à
 * voir la maintenance, et inversement. » Tout cela se règle ici, et l'écran ne
 * montre que ce qui a un sens pour la personne :
 *
 *   - la section **Demandes** n'apparaît que si le module Tickets lui est
 *     visible ;
 *   - la colonne **Clôture seul** n'apparaît que pour un niveau d'intervenant ;
 *   - l'exception de **matériel**, que si la catégorie en propose ;
 *   - les **champs du formulaire**, que si la personne peut demander quelque
 *     chose.
 *
 * Tout s'enregistre d'un bloc (`PUT /users/:id/droits`) : une personne n'est
 * jamais à moitié réglée.
 */

type Acces = boolean | null

const PROFILS: { cle: string; libelle: string; aide: string; modules: (slug: string) => Acces }[] = [
  {
    cle: 'demandeur',
    libelle: 'Demandeur',
    aide: 'Les demandes, rien d’autre',
    modules: (slug) => slug === 'tickets',
  },
  {
    cle: 'technicien',
    libelle: 'Technicien',
    aide: 'Les demandes et le planning',
    modules: (slug) => slug === 'tickets' || slug === 'plannings',
  },
  {
    cle: 'role',
    libelle: 'Selon le rôle',
    aide: 'Retirer tous les réglages individuels',
    modules: () => null,
  },
]

const MODES_SITE = [
  { value: '', label: 'Selon la catégorie' },
  { value: 'requis', label: 'Toujours demandé' },
  { value: 'auto', label: 'Seulement s’il a plusieurs bâtiments' },
  { value: 'masque', label: 'Non demandé — son bâtiment par défaut' },
]

const MODES_MATERIEL = [
  { value: '', label: 'Selon la catégorie' },
  { value: 'requis', label: 'Obligatoire' },
  { value: 'optionnel', label: 'Facultatif' },
  { value: 'aucun', label: 'Jamais demandé' },
]

export default function DroitsUtilisateur({
  userId,
  onFerme,
}: {
  userId: number
  onFerme: () => void
}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'droits', userId],
    queryFn: async () => (await droitsApi.lire(userId)).data,
  })
  const { data: tousLesSites } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await siteApi.liste()).data,
  })

  const [modules, setModules] = useState<ModuleVisible[]>([])
  const [categories, setCategories] = useState<CategorieDroits[]>([])
  const [sites, setSites] = useState<RattachementSite[]>([])
  const [siteMode, setSiteMode] = useState('')
  const [materielMode, setMaterielMode] = useState('')

  // L'état vient du serveur, puis vit localement le temps de l'onglet.
  useEffect(() => {
    if (!data) return
    setModules(data.modules)
    setCategories(data.tickets.categories)
    setSites(data.tickets.sites)
    setSiteMode(data.tickets.formulaire.siteMode ?? '')
    setMaterielMode(data.tickets.formulaire.materielMode ?? '')
  }, [data])

  const effectif = (m: ModuleVisible) =>
    data?.personne.role === 'admin' ? true : m.individuel ?? m.parRole
  const ticketsVisibles = modules.some((m) => m.slug === 'tickets' && effectif(m))
  // Le même calcul que le menu (`Layout`) : seuls les tickets, et l'application
  // se réduit à ses demandes.
  const demandeurSeul =
    data?.personne.role !== 'admin' &&
    data?.personne.role !== 'service' &&
    modules.filter(effectif).map((m) => m.slug).join() === 'tickets'
  const attribuees = categories.filter((c) => c.niveau)
  const peutDemander = attribuees.length > 0
  const intervientQuelquePart = attribuees.some((c) => c.niveau !== 'demandeur')

  const enregistrer = useMutation({
    mutationFn: () =>
      droitsApi.enregistrer(userId, {
        modules: modules.map((m) => ({ pluginId: m.pluginId, acces: m.individuel })),
        categories: attribuees.map((c) => ({
          categorieId: c.categorieId,
          niveau: c.niveau!,
          peutCloturer: c.peutCloturer,
          materielAutorise: c.materielAutorise,
        })),
        // Chaque ligne dit si elle est son bureau : le serveur sait alors qu'on
        // règle le drapeau, et ne garde pas l'ancien.
        sites: sites.map((s) => ({ ...s, parDefaut: Boolean(s.parDefaut) })),
        formulaire: { siteMode: siteMode || null, materielMode: materielMode || null },
      }),
    onSuccess: ({ data: retour }) => {
      toast.success('Droits enregistrés')
      queryClient.setQueryData(['users', 'droits', userId], retour)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      if (retour.avertissements.length === 0) onFerme()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const majCategorie = (id: number, champs: Partial<CategorieDroits>) =>
    setCategories((liste) => liste.map((c) => (c.categorieId === id ? { ...c, ...champs } : c)))
  const majSite = (id: number, champs: Partial<RattachementSite>) =>
    setSites((liste) => liste.map((s) => (s.siteId === id ? { ...s, ...champs } : s)))

  const sitesProposes = useMemo(
    () => (tousLesSites?.sites ?? []).filter((s: any) => !sites.some((r) => r.siteId === s.id)),
    [tousLesSites, sites]
  )

  if (isLoading || !data) {
    return (
      <ModalBody>
        <LoadingInline />
      </ModalBody>
    )
  }

  return (
    <>
      <ModalBody className="space-y-6">
        {data.avertissements.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            {data.avertissements.map((a) => (
              <p key={a} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}
              </p>
            ))}
          </div>
        )}

        {/* ------------------------------------------------------ modules */}
        <section>
          <Titre icone={<LayoutGrid className="h-4 w-4" />}>Ce qu’il voit dans le menu</Titre>
          {data.personne.role === 'admin' ? (
            <p className="mt-1 text-sm text-gray-500">Un administrateur voit tous les modules.</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                {PROFILS.map((p) => (
                  <Button
                    key={p.cle}
                    type="button"
                    size="sm"
                    variant="outline"
                    title={p.aide}
                    onClick={() => setModules((liste) => liste.map((m) => ({ ...m, individuel: p.modules(m.slug) })))}
                  >
                    {p.libelle}
                  </Button>
                ))}
              </div>
              {demandeurSeul && (
                <p className="mt-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                  Seuls les tickets lui restent : l’application se réduit à « Mes demandes » et à sa fiche — ni
                  tableau de bord, ni catégories, ni alertes, ni scanner.
                </p>
              )}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {modules.map((m) => (
                  <label
                    key={m.pluginId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                  >
                    <span className={cn('text-gray-800 dark:text-gray-200', !effectif(m) && 'text-gray-400 line-through')}>
                      {m.nom}
                    </span>
                    <select
                      value={m.individuel === null ? '' : m.individuel ? 'oui' : 'non'}
                      onChange={(e) =>
                        setModules((liste) =>
                          liste.map((x) =>
                            x.pluginId === m.pluginId
                              ? { ...x, individuel: e.target.value === '' ? null : e.target.value === 'oui' }
                              : x
                          )
                        )
                      }
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    >
                      <option value="">Selon le rôle ({m.parRole ? 'visible' : 'masqué'})</option>
                      <option value="oui">Visible</option>
                      <option value="non">Masqué</option>
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
        </section>

        {ticketsVisibles && (
          <>
            {/* -------------------------------------------- les demandes */}
            <section>
              <Titre icone={<LifeBuoy className="h-4 w-4" />}>Ses catégories de demandes</Titre>
              <p className="mt-1 text-xs text-gray-500">
                Le niveau dit ce qu’il fait de la catégorie. Un demandeur voit ses demandes ; un intervenant
                « ses tickets » ne voit que ce qu’on lui confie ; « toute la catégorie » voit et traite tout ; le
                superviseur valide en plus les clôtures des agents qui ne clôturent pas seuls.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500">
                      <th className="py-1 pr-3">Catégorie</th>
                      <th className="py-1 pr-3">Niveau</th>
                      {intervientQuelquePart && <th className="py-1 pr-3">Clôture seul</th>}
                      {attribuees.some((c) => c.proposeMateriel) && <th className="py-1">Matériel</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {categories.map((c) => {
                      const intervient = c.niveau === 'intervenant' || c.niveau === 'intervenant_categorie'
                      return (
                        <tr key={c.categorieId}>
                          <td className="py-2 pr-3 text-gray-800 dark:text-gray-200">{c.nom}</td>
                          <td className="py-2 pr-3">
                            <select
                              value={c.niveau ?? ''}
                              onChange={(e) =>
                                majCategorie(c.categorieId, {
                                  niveau: (e.target.value || null) as NiveauTicket | null,
                                })
                              }
                              title={NIVEAUX_TICKET.find((n) => n.valeur === c.niveau)?.aide}
                              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            >
                              <option value="">— Aucun accès —</option>
                              {NIVEAUX_TICKET.map((n) => (
                                <option key={n.valeur} value={n.valeur}>
                                  {n.libelle}
                                </option>
                              ))}
                            </select>
                          </td>
                          {intervientQuelquePart && (
                            <td className="py-2 pr-3">
                              {intervient ? (
                                <label className="inline-flex items-center gap-1.5" title="Décoché : ses clôtures passent « À valider »">
                                  <input
                                    type="checkbox"
                                    checked={c.peutCloturer}
                                    onChange={(e) => majCategorie(c.categorieId, { peutCloturer: e.target.checked })}
                                    className="rounded border-gray-300"
                                  />
                                  {!c.peutCloturer && !c.aUnSuperviseur && (
                                    <span className="text-xs text-amber-600">aucun superviseur</span>
                                  )}
                                </label>
                              ) : c.niveau === 'superviseur' ? (
                                <span className="text-xs text-gray-400">toujours</span>
                              ) : null}
                            </td>
                          )}
                          {attribuees.some((x) => x.proposeMateriel) && (
                            <td className="py-2">
                              {c.niveau && c.proposeMateriel && (
                                <select
                                  value={c.materielAutorise === null ? '' : c.materielAutorise ? 'oui' : 'non'}
                                  onChange={(e) =>
                                    majCategorie(c.categorieId, {
                                      materielAutorise: e.target.value === '' ? null : e.target.value === 'oui',
                                    })
                                  }
                                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                >
                                  <option value="">Selon la catégorie</option>
                                  <option value="oui">Peut désigner son matériel</option>
                                  <option value="non">Ne désigne pas de matériel</option>
                                </select>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ------------------------------------------- les bâtiments */}
            <section>
              <Titre icone={<Building2 className="h-4 w-4" />}>Ses bâtiments</Titre>
              <p className="mt-1 text-xs text-gray-500">
                « Voit les demandes » lui montre toutes celles de ce bâtiment, dans les catégories partagées.
                Décoché, il ne voit que les siennes. « Son bureau » est son bâtiment par défaut : il pré-remplit
                ses demandes, et une demande qui ne demande pas de lieu — l’informatique — le porte d’office.
              </p>
              {sites.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {sites.map((s) => (
                    <li
                      key={s.siteId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                    >
                      <span className="min-w-[8rem] flex-1 font-medium text-gray-800 dark:text-gray-200">{s.nom}</span>
                      <Case libelle="Responsable" coche={s.estResponsable} onChange={(v) => majSite(s.siteId, { estResponsable: v })} />
                      <Case libelle="Voit les demandes" coche={s.peutVoirTickets} onChange={(v) => majSite(s.siteId, { peutVoirTickets: v })} />
                      <Case libelle="Prévenu" coche={s.notifie} onChange={(v) => majSite(s.siteId, { notifie: v })} />
                      {/* Un seul bâtiment : c'est forcément son bureau. */}
                      {sites.length === 1 ? (
                        <span className="text-xs text-primary-700 dark:text-primary-300">Son bureau</span>
                      ) : (
                        <label
                          className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300"
                          title="Le bâtiment où il a son bureau : il pré-remplit ses demandes, et une demande informatique le porte d'office"
                        >
                          <input
                            type="radio"
                            name={`bureau-${userId}`}
                            checked={Boolean(s.parDefaut)}
                            onChange={() =>
                              setSites((liste) => liste.map((x) => ({ ...x, parDefaut: x.siteId === s.siteId })))
                            }
                          />
                          Son bureau
                        </label>
                      )}
                      <button
                        type="button"
                        aria-label={`Retirer ${s.nom}`}
                        onClick={() => setSites((liste) => liste.filter((x) => x.siteId !== s.siteId))}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sitesProposes.length > 0 && (
                <div className="mt-2 max-w-sm">
                  <Select
                    value=""
                    placeholder="Rattacher un bâtiment…"
                    onChange={(e: any) => {
                      const site = sitesProposes.find((x: any) => String(x.id) === e.target.value)
                      if (!site) return
                      setSites((liste) => [
                        ...liste,
                        {
                          siteId: site.id,
                          nom: site.nom,
                          estResponsable: false,
                          peutVoirTickets: false,
                          notifie: false,
                          parDefaut: false,
                        },
                      ])
                    }}
                    options={sitesProposes.map((x: any) => ({ value: String(x.id), label: x.nom }))}
                  />
                </div>
              )}
            </section>

            {/* ------------------------------------------ le formulaire */}
            {peutDemander && (
              <section>
                <Titre icone={<ListChecks className="h-4 w-4" />}>Son formulaire de demande</Titre>
                <p className="mt-1 text-xs text-gray-500">
                  Certains choisissent le bâtiment et le matériel, d’autres l’un des deux seulement. Une catégorie
                  qui exige un bâtiment le demande toujours.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select label="Bâtiment" value={siteMode} onChange={(e: any) => setSiteMode(e.target.value)} options={MODES_SITE} />
                  <Select
                    label="Matériel"
                    value={materielMode}
                    onChange={(e: any) => setMaterielMode(e.target.value)}
                    options={MODES_MATERIEL}
                    hint={
                      data.tickets.materiels.length === 0
                        ? 'Aucun matériel ne lui est attribué : le champ ne s’affichera pas.'
                        : `${data.tickets.materiels.length} matériel(s) attribué(s)`
                    }
                  />
                </div>
              </section>
            )}
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onFerme}>
          Fermer
        </Button>
        <Button type="button" onClick={() => enregistrer.mutate()} loading={enregistrer.isPending}>
          Enregistrer les droits
        </Button>
      </ModalFooter>
    </>
  )
}

function Titre({ icone, children }: { icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      {icone} {children}
    </h3>
  )
}

function Case({ libelle, coche, onChange }: { libelle: string; coche: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300"
      />
      {libelle}
    </label>
  )
}
