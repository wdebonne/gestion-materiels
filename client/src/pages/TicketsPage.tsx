import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LifeBuoy,
  Search,
  Plus,
  Filter,
  Building2,
  User,
  Wrench,
  AlertTriangle,
  EyeOff,
  ChevronRight,
  Inbox,
} from 'lucide-react'
import { ticketApi, ticketReferentielApi, type CategorieDemande, type Ticket } from '@/lib/api'
import { Badge, Button, Card, CardBody, LoadingInline, Select } from '@/components/ui'
import NouveauTicket from '@/components/tickets/NouveauTicket'

/**
 * La file des demandes.
 *
 * La mise en page reprend celle de GestSup, que les agents connaissent : les
 * états en colonne de gauche avec leur compteur, les catégories en dessous, et
 * la liste à droite. Ce n'est pas de la nostalgie — c'est ce qui permet de
 * basculer d'un outil à l'autre sans réapprendre où l'on clique, et c'était
 * une demande explicite.
 *
 * **Les filtres vivent dans l'URL.** `?statut=2&categorie=5` se copie dans un
 * message : « regarde les demandes en commande ». Un état gardé en mémoire ne
 * se partage pas, et se perd au rafraîchissement.
 *
 * **Les lignes grisées ne sont pas un bogue.** Une demande visible seulement au
 * titre du bâtiment se lit en voisinage : de quoi constater que le rideau cassé
 * est déjà signalé, sans ouvrir la correspondance d'un collègue. L'icône dit
 * pourquoi, plutôt que de laisser croire à une erreur d'affichage.
 */

/** Traduit une couleur de référentiel en classes Tailwind, sans les concaténer. */
const PASTILLES: Record<string, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  purple: 'bg-purple-500',
  green: 'bg-green-500',
  gray: 'bg-gray-400',
  sky: 'bg-sky-500',
  stone: 'bg-stone-500',
  indigo: 'bg-indigo-500',
}

function Pastille({ couleur }: { couleur: string | null }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${PASTILLES[couleur ?? 'gray'] ?? PASTILLES.gray}`} />
}

/** « il y a 3 jours », sans dépendance de plus. */
function depuis(iso: string): string {
  const ecart = Date.now() - new Date(iso.replace(' ', 'T')).getTime()
  const minutes = Math.floor(ecart / 60000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const heures = Math.floor(minutes / 60)
  if (heures < 24) return `il y a ${heures} h`
  const jours = Math.floor(heures / 24)
  if (jours < 31) return `il y a ${jours} j`
  const mois = Math.floor(jours / 30)
  return `il y a ${mois} mois`
}

export default function TicketsPage() {
  const [parametres, setParametres] = useSearchParams()
  const [recherche, setRecherche] = useState(parametres.get('recherche') ?? '')
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [creation, setCreation] = useState(false)

  const statutId = parametres.get('statut') ? Number(parametres.get('statut')) : null
  const categorieId = parametres.get('categorie') ? Number(parametres.get('categorie')) : null
  const siteId = parametres.get('batiment') ? Number(parametres.get('batiment')) : null

  const { data: formulaire } = useQuery({
    queryKey: ['tickets', 'formulaire'],
    queryFn: async () => (await ticketApi.formulaire()).data,
  })

  const { data: referentiel } = useQuery({
    queryKey: ['tickets', 'categories'],
    queryFn: async () => (await ticketReferentielApi.categories()).data,
  })

  /**
   * Les filtres envoyés au serveur, dérivés de l'URL.
   *
   * Rien de plus : ce que chacun voit est décidé par le serveur
   * (`ticketScope.ts`), pas par un filtre d'écran qu'on pourrait retirer.
   */
  const filtres = useMemo(
    () => ({ statutId, categorieId, siteId, recherche: recherche.trim() || null }),
    [statutId, categorieId, siteId, recherche]
  )

  const { data: compteurs } = useQuery({
    queryKey: ['tickets', 'compteurs', categorieId, siteId, recherche],
    queryFn: async () =>
      (await ticketApi.compteurs({ categorieId, siteId, recherche: recherche.trim() || null })).data,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'liste', filtres],
    queryFn: async () => (await ticketApi.liste(filtres)).data,
  })

  function poser(cle: string, valeur: string | null) {
    const suivants = new URLSearchParams(parametres)
    if (valeur === null) suivants.delete(cle)
    else suivants.set(cle, valeur)
    setParametres(suivants, { replace: true })
  }

  const racines = (referentiel?.categories ?? []).filter((c: CategorieDemande) => c.parentId === null)
  const enfantsDe = (id: number) => (referentiel?.categories ?? []).filter((c: CategorieDemande) => c.parentId === id)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <LifeBuoy className="w-7 h-7 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tickets</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Signaler, suivre et clore les demandes internes
            </p>
          </div>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreation(true)}>
          Nouvelle demande
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* ------------------------------------------------ colonne de gauche */}
        <aside className="lg:col-span-1 space-y-4">
          <Card>
            <CardBody className="p-3">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                États
              </p>
              <button
                onClick={() => poser('statut', null)}
                className={`w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm transition ${
                  statutId === null
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Inbox className="w-4 h-4" /> Toutes
                </span>
                <span className="text-xs text-gray-500">{compteurs?.total ?? 0}</span>
              </button>

              {(compteurs?.parStatut ?? []).map((s) => (
                <button
                  key={s.statutId}
                  onClick={() => poser('statut', String(s.statutId))}
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm transition ${
                    statutId === s.statutId
                      ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Pastille couleur={s.couleur} />
                    <span className="truncate">{s.nom}</span>
                  </span>
                  {/* Un compteur à zéro reste affiché : une colonne dont les
                      lignes apparaissent et disparaissent est illisible. */}
                  <span className="text-xs text-gray-500 shrink-0">{s.total}</span>
                </button>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-3">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Catégories
              </p>
              <button
                onClick={() => poser('categorie', null)}
                className={`w-full text-left px-2 py-2 rounded-lg text-sm ${
                  categorieId === null
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                Toutes les catégories
              </button>
              {racines.map((c) => (
                <div key={c.id}>
                  <button
                    onClick={() => poser('categorie', String(c.id))}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm ${
                      categorieId === c.id
                        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <Pastille couleur={c.couleur} />
                    <span className="truncate">{c.nom}</span>
                  </button>
                  {enfantsDe(c.id).map((sc) => (
                    <button
                      key={sc.id}
                      onClick={() => poser('categorie', String(sc.id))}
                      className={`w-full flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-lg text-sm ${
                        categorieId === sc.id
                          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      <ChevronRight className="w-3 h-3 shrink-0" />
                      <span className="truncate">{sc.nom}</span>
                    </button>
                  ))}
                </div>
              ))}
            </CardBody>
          </Card>
        </aside>

        {/* ------------------------------------------------------- la liste */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher un titre, une description ou un numéro..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <Button
              variant="outline"
              icon={<Filter className="w-4 h-4" />}
              onClick={() => setFiltresOuverts(!filtresOuverts)}
            >
              Filtres
            </Button>
          </div>

          {filtresOuverts && (
            <Card>
              <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Bâtiment"
                  value={siteId ?? ''}
                  onChange={(e: any) => poser('batiment', e.target.value || null)}
                  options={[
                    { value: '', label: 'Tous les bâtiments' },
                    ...(formulaire?.sites ?? []).map((s) => ({ value: String(s.id), label: s.nom })),
                  ]}
                />
              </CardBody>
            </Card>
          )}

          {isLoading ? (
            <LoadingInline />
          ) : (data?.tickets ?? []).length === 0 ? (
            <Card>
              <CardBody className="py-12 text-center">
                <LifeBuoy className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">
                  {statutId || categorieId || recherche
                    ? 'Aucune demande ne correspond aux filtres sélectionnés'
                    : "Aucune demande pour l'instant"}
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-2">
              {(data?.tickets ?? []).map((t: Ticket) => (
                <LigneTicket key={t.id} ticket={t} />
              ))}
            </div>
          )}

          {data && data.total > (data.tickets?.length ?? 0) && (
            <p className="text-center text-sm text-gray-500">
              {data.tickets.length} demande(s) affichée(s) sur {data.total}
            </p>
          )}
        </div>
      </div>

      {creation && (
        <NouveauTicket
          onFerme={() => setCreation(false)}
        />
      )}
    </div>
  )
}

/** Une ligne de la file. Grisée quand on ne la voit qu'au titre du bâtiment. */
function LigneTicket({ ticket }: { ticket: Ticket }) {
  const contenu = (
    <Card
      className={`transition hover:shadow-medium ${
        ticket.accesComplet ? '' : 'opacity-70'
      } ${ticket.enRetard ? 'border-l-4 border-l-red-500' : ''}`}
    >
      <CardBody className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-gray-400">{ticket.reference}</span>
              <Pastille couleur={ticket.statut.couleur} />
              <span className="text-xs text-gray-500">{ticket.statut.nom}</span>
              {ticket.categorie && (
                <Badge variant="default" className="text-xs">
                  {ticket.categorie.nom}
                  {ticket.sousCategorie ? ` › ${ticket.sousCategorie.nom}` : ''}
                </Badge>
              )}
              {ticket.enRetard && (
                <span className="inline-flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="w-3 h-3" /> en retard
                </span>
              )}
              {!ticket.accesComplet && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-gray-400"
                  title="Visible au titre de votre bâtiment : le détail est réservé aux intervenants"
                >
                  <EyeOff className="w-3 h-3" /> voisinage
                </span>
              )}
            </div>

            <p className="mt-1 font-medium text-gray-900 dark:text-white truncate">{ticket.titre}</p>

            <div className="mt-1 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
              {ticket.demandeur && (
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" /> {ticket.demandeur.nom}
                </span>
              )}
              {ticket.site && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {ticket.site.nom}
                </span>
              )}
              {ticket.materiel && (
                <span className="inline-flex items-center gap-1">
                  <Wrench className="w-3 h-3" /> {ticket.materiel.nom}
                </span>
              )}
              <span>{depuis(ticket.misAJourLe)}</span>
            </div>
          </div>

          <div className="text-right shrink-0">
            {ticket.technicien ? (
              <p className="text-xs text-gray-600 dark:text-gray-300">{ticket.technicien.nom}</p>
            ) : (
              <p className="text-xs text-gray-400 italic">non affectée</p>
            )}
            {ticket.service && <p className="text-xs text-gray-400">{ticket.service.nom}</p>}
          </div>
        </div>
      </CardBody>
    </Card>
  )

  // Une demande en voisinage n'a pas de fiche à ouvrir : le lien mènerait à un
  // écran qui refuse. Mieux vaut ne pas proposer le geste.
  return ticket.accesComplet ? (
    <Link to={`/tickets/${ticket.id}`} className="block">
      {contenu}
    </Link>
  ) : (
    <div>{contenu}</div>
  )
}
