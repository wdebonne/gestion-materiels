import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Building2,
  Check,
  Info,
  Search,
  Tags,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import api, {
  siteApi,
  ticketReferentielApi,
  NIVEAUX_TICKET,
  type NiveauTicket,
  type CategorieDemande,
  type CompteRattache,
  type RattachementSite,
} from '@/lib/api'
import {
  Badge,
  Button,
  Card,
  CardBody,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
} from '@/components/ui'

/**
 * Qui a droit à quoi.
 *
 * Cet écran est la contrepartie d'une décision : **rien n'est attribué par
 * défaut**. Un compte sans catégorie ne peut ouvrir aucune demande, et un
 * compte sans bâtiment n'en voit aucun. C'est ce qu'on veut — chacun n'a pas
 * les mêmes besoins, et proposer à un agent d'accueil les catégories de la
 * voirie lui fait ranger sa demande au hasard.
 *
 * Mais une règle fermée n'est tenable que si l'oubli se voit. D'où la bannière
 * en tête : **elle nomme les comptes qui n'ont rien**. Sans elle, la personne
 * ouvre le formulaire, ne trouve aucune catégorie, et n'appelle pas toujours
 * pour le dire.
 *
 * ## Les trois droits d'un bâtiment
 *
 * Une école a plusieurs responsables, et ils n'ont pas les mêmes besoins :
 *
 *   **Responsable** — signale *pour le bâtiment* (un bureau abîmé, une fuite),
 *   et pas seulement pour le matériel qui lui est attribué
 *   **Voit** — lit les demandes du bâtiment, ce qui donne à un collègue qui
 *   arrive une vue de ce qui est fait et de ce qui est en cours
 *   **Reçoit** — un courriel à chaque demande, en plus du technicien et du
 *   service de la catégorie
 *
 * Les trois sont indépendants : la directrice coche les trois, l'élu regarde
 * sans vouloir être dérangé, le responsable des écoles est responsable de
 * l'école et simple occupant de la mairie où est son bureau.
 *
 * ## L'attribution en masse ajoute, elle ne retire jamais
 *
 * Paramétrer une commune compte par compte demande trois cents passages, ce qui
 * revient à ne jamais finir. Sélectionner douze personnes et leur donner
 * « Informatique » n'efface donc pas ce que certaines avaient déjà, et ne défait
 * aucun droit réglé finement.
 */

export default function Rattachements() {
  const queryClient = useQueryClient()
  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState<number[]>([])
  const [fiche, setFiche] = useState<CompteRattache | null>(null)
  const [enMasse, setEnMasse] = useState(false)
  const [masquerConfigures, setMasquerConfigures] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'rattachements'],
    queryFn: async () => (await ticketReferentielApi.tableauRattachements()).data,
  })

  const comptes = data?.comptes ?? []
  const sansRien = comptes.filter((c) => c.inactif && c.seConnecte)

  const affiches = useMemo(() => {
    const motif = recherche.trim().toLowerCase()
    return comptes
      .filter((c) => (masquerConfigures ? c.inactif : true))
      .filter((c) => !motif || c.nom.toLowerCase().includes(motif) || (c.email ?? '').toLowerCase().includes(motif))
  }, [comptes, recherche, masquerConfigures])

  const basculer = (id: number) =>
    setSelection((actuelle) =>
      actuelle.includes(id) ? actuelle.filter((x) => x !== id) : [...actuelle, id]
    )

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      {/*
        L'oubli doit se voir. C'est la condition qui rend tenable d'avoir fermé
        l'accès par défaut.
      */}
      {sansRien.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardBody className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {sansRien.length} compte(s) ne peuvent ouvrir aucune demande
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Sans catégorie attribuée, le formulaire leur est vide et ils n'appelleront pas
                toujours pour le dire : {sansRien.slice(0, 6).map((c) => c.nom).join(', ')}
                {sansRien.length > 6 ? `, et ${sansRien.length - 6} autre(s)` : ''}.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setSelection(sansRien.map((c) => c.id))
                  setEnMasse(true)
                }}
              >
                Les paramétrer d'un coup
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
            <span>
              Rien n'est attribué par défaut. Une personne ouvre une demande dans les{' '}
              <strong>catégories</strong> qu'on lui donne, sur le <strong>matériel</strong> qui lui
              est attribué, et — si elle est <strong>responsable</strong> — pour son bâtiment.
            </span>
          </p>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex-1 min-w-0 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher une personne…"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
              <input
                type="checkbox"
                checked={masquerConfigures}
                onChange={(e) => setMasquerConfigures(e.target.checked)}
                className="rounded border-gray-300"
              />
              Seulement ceux sans rien
            </label>
            <Button
              disabled={selection.length === 0}
              onClick={() => setEnMasse(true)}
              icon={<Users className="w-4 h-4" />}
            >
              Attribuer à {selection.length || '…'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={affiches.length > 0 && selection.length === affiches.length}
                    onChange={(e) => setSelection(e.target.checked ? affiches.map((c) => c.id) : [])}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="pb-2 font-medium">Personne</th>
                <th className="pb-2 font-medium text-center">Catégories</th>
                <th className="pb-2 font-medium text-center">Bâtiments</th>
                <th className="pb-2 font-medium text-center">Responsable</th>
                <th className="pb-2 font-medium text-center">Voit</th>
                <th className="pb-2 font-medium text-center">Reçoit</th>
                <th className="pb-2 font-medium text-center">Matériel</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {affiches.map((compte) => (
                <tr key={compte.id} className={compte.inactif && compte.seConnecte ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${compte.nom}`}
                      checked={selection.includes(compte.id)}
                      onChange={() => basculer(compte.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="py-2">
                    <span className="text-gray-900 dark:text-white">{compte.nom}</span>
                    {!compte.seConnecte && (
                      <Badge variant="default" className="ml-2 text-xs">
                        sans compte
                      </Badge>
                    )}
                    {compte.email && (
                      <span className="block text-xs text-gray-400">{compte.email}</span>
                    )}
                  </td>
                  <Compteur valeur={compte.categories} alerte={compte.categories === 0 && compte.seConnecte} />
                  <Compteur valeur={compte.sites} />
                  <Compteur valeur={compte.responsableDe} />
                  <Compteur valeur={compte.voitPour} />
                  <Compteur valeur={compte.notifiePour} />
                  <Compteur valeur={compte.materiels} />
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setFiche(compte)}>
                      Régler
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {affiches.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">Aucun compte ne correspond.</p>
          )}
        </CardBody>
      </Card>

      {fiche && (
        <FicheRattachement
          compte={fiche}
          onFerme={() => setFiche(null)}
          onEnregistre={() => queryClient.invalidateQueries({ queryKey: ['tickets', 'rattachements'] })}
        />
      )}

      {enMasse && (
        <AttributionEnMasse
          userIds={selection}
          onFerme={() => setEnMasse(false)}
          onEnregistre={() => {
            setSelection([])
            queryClient.invalidateQueries({ queryKey: ['tickets', 'rattachements'] })
          }}
        />
      )}
    </div>
  )
}

/** Un compteur de colonne : le zéro qui compte est signalé, les autres sont discrets. */
function Compteur({ valeur, alerte }: { valeur: number; alerte?: boolean }) {
  return (
    <td className="py-2 text-center tabular-nums">
      {valeur === 0 ? (
        <span className={alerte ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-300 dark:text-gray-600'}>
          {alerte ? 'aucune' : '—'}
        </span>
      ) : (
        <span className="text-gray-700 dark:text-gray-300">{valeur}</span>
      )}
    </td>
  )
}

/** Le détail d'une personne : ses catégories, ses bâtiments, son matériel. */
function FicheRattachement({
  compte,
  onFerme,
  onEnregistre,
}: {
  compte: CompteRattache
  onFerme: () => void
  onEnregistre: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'rattachements', compte.id],
    queryFn: async () => (await ticketReferentielApi.rattachements(compte.id)).data,
  })
  const { data: categories } = useQuery({
    queryKey: ['tickets', 'categories'],
    queryFn: async () => (await ticketReferentielApi.categories()).data,
  })
  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await siteApi.liste()).data,
  })
  const { data: parc } = useQuery({
    queryKey: ['objects', 'annuaire'],
    queryFn: async () => (await api.get('/objects?limit=500')).data,
  })

  type LigneCategorie = {
    categorieId: number
    niveau: NiveauTicket
    peutCloturer: boolean
    materielAutorise: boolean | null
  }
  const [lignesCategories, setLignesCategories] = useState<LigneCategorie[] | null>(null)
  const [rattachements, setRattachements] = useState<RattachementSite[] | null>(null)
  const [materiels, setMateriels] = useState<Array<{ objectId: number; nom: string }> | null>(null)

  // L'état vient du serveur, puis vit localement le temps de la modale. Chaque
  // ligne garde son niveau et son exception de matériel : les renvoyer tels
  // quels est ce qui évite de les remettre à zéro en enregistrant autre chose.
  const mesLignes = lignesCategories ?? data?.categories ?? []
  const ligneDe = (id: number) => mesLignes.find((l) => l.categorieId === id)
  const mesSites = rattachements ?? data?.sites ?? []
  const mesMateriels = materiels ?? data?.materiels ?? []

  const racines = (categories?.categories ?? []).filter((c: CategorieDemande) => c.parentId === null)
  const listeParc = parc?.data ?? parc?.objects ?? []

  const enregistrer = useMutation({
    mutationFn: () =>
      ticketReferentielApi.definirRattachements(compte.id, {
        categories: mesLignes,
        sites: mesSites,
        materiels: mesMateriels.map((m) => ({ objectId: m.objectId })),
      }),
    onSuccess: () => {
      toast.success('Rattachements enregistrés')
      onEnregistre()
      onFerme()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  function basculerSite(siteId: number, nom: string, champ: keyof RattachementSite) {
    const courant = [...mesSites]
    const index = courant.findIndex((s) => s.siteId === siteId)

    if (index === -1) {
      courant.push({
        siteId,
        nom,
        estResponsable: champ === 'estResponsable',
        peutVoirTickets: champ === 'peutVoirTickets',
        notifie: champ === 'notifie',
        gereLieu: champ === 'gereLieu',
      })
    } else {
      const ligne = { ...courant[index], [champ]: !courant[index][champ] } as RattachementSite
      // Décocher les trois droits retire le rattachement ? Non : un simple
      // occupant *doit* rester rattaché, c'est ce qui pré-remplit son bâtiment.
      // On retire depuis la croix, explicitement.
      courant[index] = ligne
    }
    setRattachements(courant)
  }

  return (
    <Modal isOpen onClose={onFerme} title={compte.nom} size="xl">
      <ModalBody className="space-y-6">
        {isLoading ? (
          <LoadingInline />
        ) : (
          <>
            {/* ------------------------------------------------ catégories */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <Tags className="w-4 h-4" /> Ses catégories de demandes
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Sans aucune catégorie, cette personne ne peut ouvrir aucune demande. Le niveau dit ce
                qu'elle en fait : la demander, y intervenir, ou la superviser.
              </p>
              <div className="mt-2 space-y-2">
                {racines.map((c: CategorieDemande) => {
                  const ligne = ligneDe(c.id)
                  const active = Boolean(ligne)
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() =>
                          setLignesCategories(
                            active
                              ? mesLignes.filter((l) => l.categorieId !== c.id)
                              : [...mesLignes, { categorieId: c.id, niveau: 'demandeur', peutCloturer: true, materielAutorise: null }]
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                          active
                            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                            : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {active && <Check className="w-3.5 h-3.5" />}
                        {c.nom}
                      </button>
                      {ligne && (
                        <select
                          value={ligne.niveau}
                          onChange={(e) =>
                            setLignesCategories(
                              mesLignes.map((l) =>
                                l.categorieId === c.id ? { ...l, niveau: e.target.value as NiveauTicket } : l
                              )
                            )
                          }
                          title={NIVEAUX_TICKET.find((n) => n.valeur === ligne.niveau)?.aide}
                          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-white"
                        >
                          {NIVEAUX_TICKET.map((n) => (
                            <option key={n.valeur} value={n.valeur}>
                              {n.libelle}
                            </option>
                          ))}
                        </select>
                      )}
                      {/* L'autonomie ne concerne que qui intervient : un
                          superviseur valide son propre travail. */}
                      {ligne && (ligne.niveau === 'intervenant' || ligne.niveau === 'intervenant_categorie') && (
                        <label
                          className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"
                          title="Décoché : ses clôtures passent « À valider » chez un superviseur de la catégorie"
                        >
                          <input
                            type="checkbox"
                            checked={ligne.peutCloturer}
                            onChange={(e) =>
                              setLignesCategories(
                                mesLignes.map((l) =>
                                  l.categorieId === c.id ? { ...l, peutCloturer: e.target.checked } : l
                                )
                              )
                            }
                            className="rounded border-gray-300"
                          />
                          Clôture seul
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* ------------------------------------------------- bâtiments */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <Building2 className="w-4 h-4" /> Ses bâtiments
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Rattachée sans rien cocher, la personne voit simplement son bâtiment pré-rempli
                quand elle signale une panne sur son matériel.
              </p>

              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-1 text-left font-medium">Bâtiment</th>
                    <th className="pb-1 text-center font-medium" title="Peut signaler pour le bâtiment">
                      Responsable
                    </th>
                    <th className="pb-1 text-center font-medium" title="Lit les demandes du bâtiment">
                      Voit
                    </th>
                    <th className="pb-1 text-center font-medium" title="Reçoit un courriel à chaque demande">
                      Reçoit
                    </th>
                    <th
                      className="pb-1 text-center font-medium"
                      title="Gère le bâtiment dans Paramètres › Organisation : ses salles, ses portes, ses rattachements"
                    >
                      Gère
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(sites?.sites ?? []).map((site) => {
                    const lien = mesSites.find((s) => s.siteId === site.id)
                    const rattache = Boolean(lien)
                    return (
                      <tr key={site.id} className={rattache ? '' : 'opacity-60'}>
                        <td className="py-1.5">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={rattache}
                              onChange={() =>
                                setRattachements(
                                  rattache
                                    ? mesSites.filter((s) => s.siteId !== site.id)
                                    : [
                                        ...mesSites,
                                        {
                                          siteId: site.id,
                                          nom: site.nom,
                                          estResponsable: false,
                                          peutVoirTickets: false,
                                          notifie: false,
                                        },
                                      ]
                                )
                              }
                              className="rounded border-gray-300"
                            />
                            {site.nom}
                          </label>
                        </td>
                        {(['estResponsable', 'peutVoirTickets', 'notifie', 'gereLieu'] as const).map((champ) => (
                          <td key={champ} className="py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={!rattache}
                              checked={Boolean(lien?.[champ])}
                              onChange={() => basculerSite(site.id, site.nom, champ)}
                              className="rounded border-gray-300 disabled:opacity-40"
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>

            {/* -------------------------------------------------- matériel */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <Wrench className="w-4 h-4" /> Son matériel
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Son téléphone, son ordinateur : c'est ce que le formulaire lui proposera quand elle
                signalera une panne, plutôt que tout le parc de la commune.
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {mesMateriels.map((m) => (
                  <span
                    key={m.objectId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-sm text-gray-800 dark:text-gray-200"
                  >
                    {m.nom}
                    <button
                      onClick={() => setMateriels(mesMateriels.filter((x) => x.objectId !== m.objectId))}
                      className="text-gray-400 hover:text-red-600"
                      aria-label={`Retirer ${m.nom}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>

              <Select
                className="mt-2"
                value=""
                onChange={(e: any) => {
                  const id = Number(e.target.value)
                  if (!id || mesMateriels.some((m) => m.objectId === id)) return
                  const objet = listeParc.find((o: any) => Number(o.id) === id)
                  setMateriels([...mesMateriels, { objectId: id, nom: objet?.name ?? `#${id}` }])
                }}
                options={[
                  { value: '', label: 'Ajouter un matériel…' },
                  ...listeParc
                    .filter((o: any) => !mesMateriels.some((m) => m.objectId === Number(o.id)))
                    .map((o: any) => ({
                      value: String(o.id),
                      label: o.reference ? `${o.name} (${o.reference})` : o.name,
                    })),
                ]}
              />
            </section>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Annuler
        </Button>
        <Button disabled={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
          {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Les mêmes rattachements pour plusieurs comptes. Ajoute, ne retire jamais. */
function AttributionEnMasse({
  userIds,
  onFerme,
  onEnregistre,
}: {
  userIds: number[]
  onFerme: () => void
  onEnregistre: () => void
}) {
  const [categorieIds, setCategorieIds] = useState<number[]>([])
  const [siteId, setSiteId] = useState('')
  const [estResponsable, setEstResponsable] = useState(false)
  const [peutVoirTickets, setPeutVoirTickets] = useState(false)
  const [notifie, setNotifie] = useState(false)

  const { data: categories } = useQuery({
    queryKey: ['tickets', 'categories'],
    queryFn: async () => (await ticketReferentielApi.categories()).data,
  })
  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await siteApi.liste()).data,
  })

  const racines = (categories?.categories ?? []).filter((c: CategorieDemande) => c.parentId === null)

  const appliquer = useMutation({
    mutationFn: () =>
      ticketReferentielApi.attribuerEnMasse({
        userIds,
        categorieIds,
        sites: siteId
          ? [{ siteId: Number(siteId), estResponsable, peutVoirTickets, notifie }]
          : [],
      }),
    onSuccess: ({ data }) => {
      toast.success(`${data.comptes} compte(s) mis à jour`)
      onEnregistre()
      onFerme()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Attribution impossible'),
  })

  return (
    <Modal isOpen onClose={onFerme} title={`Attribuer à ${userIds.length} compte(s)`} size="lg">
      <ModalBody className="space-y-5">
        <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
          <span>
            Ce geste <strong>ajoute</strong> : il n'efface aucune catégorie déjà donnée, et ne
            retire aucun droit réglé finement sur un bâtiment.
          </span>
        </p>

        <section>
          <p className="text-sm font-medium text-gray-900 dark:text-white">Catégories à ajouter</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {racines.map((c: CategorieDemande) => {
              const active = categorieIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setCategorieIds(active ? categorieIds.filter((x) => x !== c.id) : [...categorieIds, c.id])
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                    active
                      ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5" />}
                  {c.nom}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <Select
            label="Bâtiment à rattacher (facultatif)"
            value={siteId}
            onChange={(e: any) => setSiteId(e.target.value)}
            options={[
              { value: '', label: 'Aucun' },
              ...(sites?.sites ?? []).map((s) => ({ value: String(s.id), label: s.nom })),
            ]}
          />
          {siteId && (
            <div className="flex flex-wrap gap-4 pl-1 text-sm text-gray-700 dark:text-gray-300">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={estResponsable}
                  onChange={(e) => setEstResponsable(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Responsable
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={peutVoirTickets}
                  onChange={(e) => setPeutVoirTickets(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Voit les demandes
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notifie}
                  onChange={(e) => setNotifie(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Reçoit les courriels
              </label>
            </div>
          )}
        </section>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Annuler
        </Button>
        <Button
          disabled={(categorieIds.length === 0 && !siteId) || appliquer.isPending}
          onClick={() => appliquer.mutate()}
        >
          {appliquer.isPending ? 'Application…' : 'Appliquer'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
