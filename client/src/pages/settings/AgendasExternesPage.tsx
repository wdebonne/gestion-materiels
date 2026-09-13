import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Alert, Button, Card, CardBody, LoadingInline, useConfirm } from '@/components/ui'
import { agendaExterneApi, type AgendaExterne, type ApercuAgenda } from '@/lib/api'
import api from '@/lib/api'

/**
 * Qui reçoit quoi.
 *
 * Brancher l'agenda de l'application sur un carnet CalDAV y déversait tout : les
 * entretiens de véhicules, les contrôles techniques, les échéances du matériel
 * de manifestation et les tontes des espaces verts. Le carnet du service
 * technique devenait illisible, et la seule réaction possible était de couper la
 * synchronisation — donc de ne plus rien voir du tout.
 *
 * Cet écran découpe. Autant de carnets que la commune en a besoin, et pour
 * chacun deux questions : **quelles natures** d'échéances, et **quelles
 * catégories** de matériel. Ce sont les deux axes selon lesquels une commune
 * découpe réellement son travail.
 *
 * Ce qu'il ne touche pas : **la vue du calendrier**. Elle continue de montrer
 * tout ce que les droits du compte permettent de voir. L'aiguillage décide de ce
 * qui **sort**, jamais de ce qui s'affiche — confondre les deux ferait
 * disparaître de l'écran des échéances qu'on a seulement choisi de ne pas
 * exporter.
 */

const CHAMP =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
const LIBELLE = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

/** Un carnet tout neuf, dans l'état le moins surprenant : il n'envoie rien tant qu'on ne l'a pas activé. */
const NOUVEAU: Partial<AgendaExterne> = {
  name: '',
  kind: 'caldav',
  direction: 'export',
  server_url: '',
  username: '',
  password: '',
  calendar_path: '',
  client_id: '',
  client_secret: '',
  tenant_id: '',
  natures: [],
  category_ids: [],
  include_uncategorized: true,
  color: '#10b981',
  enabled: false,
}

export default function AgendasExternesPage() {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [edition, setEdition] = useState<Partial<AgendaExterne> | null>(null)

  const { data: agendas = [], isLoading } = useQuery({
    queryKey: ['agendas-externes'],
    queryFn: async () => (await agendaExterneApi.lister()).data.data,
  })

  const { data: vocabulaire } = useQuery({
    queryKey: ['agendas-vocabulaire'],
    queryFn: async () => (await agendaExterneApi.vocabulaire()).data.data,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-pour-agendas'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return (res.data.categories ?? res.data.data ?? []) as Array<{ id: number; name: string }>
    },
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['agendas-externes'] })
    queryClient.invalidateQueries({ queryKey: ['calendar-sync-status'] })
  }

  const enregistrer = useMutation({
    mutationFn: (corps: Partial<AgendaExterne>) =>
      corps.id ? agendaExterneApi.modifier(corps.id, corps) : agendaExterneApi.creer(corps),
    onSuccess: () => {
      toast.success('Agenda enregistré')
      rafraichir()
      setEdition(null)
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => agendaExterneApi.supprimer(id),
    onSuccess: () => {
      toast.success('Agenda retiré')
      rafraichir()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Suppression impossible'),
  })

  const demanderSuppression = async (agenda: AgendaExterne) => {
    const ok = await confirmer({
      title: `Retirer « ${agenda.name} » ?`,
      message:
        'Ce qui a déjà été déposé dans ce carnet y reste : l’application ne vide pas l’agenda de quelqu’un parce qu’on débranche la liaison. Les événements qu’il faisait apparaître ici, eux, disparaissent du calendrier.',
      confirmLabel: 'Retirer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate(agenda.id)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <CalendarClock className="h-7 w-7 text-primary-600" />
          Agendas externes
        </h1>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Qui reçoit quoi : chaque carnet ne reçoit que ce que vous lui désignez.
        </p>
      </div>

      <Alert type="info">
        Le calendrier de l’application ne change pas : il affiche toutes les échéances que vos
        droits vous permettent de voir. Ce qui se règle ici, c’est ce qui <strong>sort</strong> vers
        un agenda extérieur — le carnet du service technique n’a pas besoin des tontes de pelouse,
        ni celui des espaces verts des contrôles techniques des camions.
      </Alert>

      {isLoading ? (
        <Card>
          <CardBody>
            <LoadingInline />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {agendas.map((agenda) => (
            <LigneAgenda
              key={agenda.id}
              agenda={agenda}
              categories={categories}
              natures={vocabulaire?.natures ?? []}
              onModifier={() => setEdition(agenda)}
              onSupprimer={() => demanderSuppression(agenda)}
              onSynchronise={rafraichir}
            />
          ))}

          {agendas.length === 0 && (
            <Card>
              <CardBody className="py-10 text-center">
                <Plug className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Aucun agenda externe n’est branché.
                </p>
                <p className="mx-auto mt-1 max-w-lg text-xs text-gray-500 dark:text-gray-400">
                  Un carnet peut recevoir les échéances de l’application — un service, une famille
                  de matériel — et, en retour, faire apparaître ses propres rendez-vous dans le
                  calendrier.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {!edition && (
        <Button onClick={() => setEdition({ ...NOUVEAU })}>
          <Plus className="mr-1.5 h-4 w-4" />
          Ajouter un agenda
        </Button>
      )}

      {edition && (
        <Formulaire
          valeur={edition}
          natures={vocabulaire?.natures ?? []}
          directions={vocabulaire?.directions ?? []}
          categories={categories}
          onChange={setEdition}
          onAnnuler={() => setEdition(null)}
          onEnregistrer={() => enregistrer.mutate(edition)}
          enCours={enregistrer.isPending}
        />
      )}
    </div>
  )
}

/** Un carnet dans la liste, avec de quoi le tester et le faire passer. */
function LigneAgenda({
  agenda,
  categories,
  natures,
  onModifier,
  onSupprimer,
  onSynchronise,
}: {
  agenda: AgendaExterne
  categories: Array<{ id: number; name: string }>
  natures: Array<{ valeur: string; libelle: string }>
  onModifier: () => void
  onSupprimer: () => void
  onSynchronise: () => void
}) {
  const [apercu, setApercu] = useState<ApercuAgenda | null>(null)

  const tester = useMutation({
    mutationFn: () => agendaExterneApi.tester(agenda.id),
    onSuccess: () => toast.success('Connexion réussie'),
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Connexion impossible'),
  })

  const synchroniser = useMutation({
    mutationFn: () => agendaExterneApi.synchroniser(agenda.id),
    onSuccess: (reponse) => {
      const r = reponse.data.data
      if (r.erreur) toast.error(r.erreur)
      else
        toast.success(
          `${r.envoyes} envoyé${r.envoyes > 1 ? 's' : ''}, ${r.retires} retiré${r.retires > 1 ? 's' : ''}, ${r.importes} reçu${r.importes > 1 ? 's' : ''}`
        )
      onSynchronise()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Synchronisation impossible'),
  })

  const voirApercu = useMutation({
    mutationFn: () => agendaExterneApi.apercu(agenda.id),
    onSuccess: (reponse) => setApercu(reponse.data.data),
    onError: () => toast.error('Aperçu indisponible'),
  })

  /** Ce que le carnet reçoit, en une phrase : « tout » est une réponse. */
  const resume = useMemo(() => {
    const cotéNatures =
      agenda.natures.length === 0
        ? 'toutes les natures'
        : agenda.natures
            .map((v) => natures.find((n) => n.valeur === v)?.libelle ?? v)
            .join(', ')
    const cotéCategories =
      agenda.category_ids.length === 0
        ? 'toutes les catégories'
        : agenda.category_ids
            .map((id) => categories.find((c) => c.id === id)?.name ?? `#${id}`)
            .join(', ')
    return `${cotéNatures} · ${cotéCategories}`
  }, [agenda, natures, categories])

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <span
            className="mt-1 h-3 w-3 flex-shrink-0 rounded-full"
            style={{ background: agenda.enabled ? agenda.color : '#cbd5e1' }}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
              {agenda.name}
              {!agenda.enabled && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  Désactivé
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {agenda.kind === 'caldav' ? 'CalDAV' : 'Outlook'} ·{' '}
              {agenda.direction === 'export'
                ? 'envoi vers le carnet'
                : agenda.direction === 'import'
                  ? 'réception depuis le carnet'
                  : 'les deux sens'}
              {agenda.last_sync
                ? ` · dernier passage le ${new Date(agenda.last_sync).toLocaleString('fr-FR')}`
                : ' · jamais passé'}
            </p>
            {agenda.direction !== 'import' && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Reçoit : {resume}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => tester.mutate()} disabled={tester.isPending}>
              <Plug className="mr-1 h-4 w-4" />
              Tester
            </Button>
            {agenda.direction !== 'import' && (
              <Button variant="secondary" onClick={() => voirApercu.mutate()} disabled={voirApercu.isPending}>
                Aperçu
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => synchroniser.mutate()}
              disabled={synchroniser.isPending}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${synchroniser.isPending ? 'animate-spin' : ''}`} />
              Synchroniser
            </Button>
            <Button variant="secondary" onClick={onModifier}>
              Modifier
            </Button>
            <Button variant="ghost" onClick={onSupprimer}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {agenda.last_error && (
          <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {agenda.last_error}
          </p>
        )}

        {/* L'aperçu répond avant d'envoyer : un aiguillage se règle autrement à
            l'aveugle, et l'on ne découvre son effet qu'une fois le carnet de
            quelqu'un d'autre rempli. */}
        {apercu && (
          <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {apercu.total} événement{apercu.total > 1 ? 's' : ''} partirai
              {apercu.total > 1 ? 'ent' : 't'} vers ce carnet
            </p>
            {apercu.parNature.length > 0 && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {apercu.parNature.map((n) => `${n.libelle} : ${n.cnt}`).join(' · ')}
              </p>
            )}
            {apercu.exemples.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {apercu.exemples.map((e, i) => (
                  <li key={i} className="truncate">
                    {String(e.start_date).slice(0, 10)} — {e.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Le formulaire d'un carnet : la connexion, puis l'aiguillage. */
function Formulaire({
  valeur,
  natures,
  directions,
  categories,
  onChange,
  onAnnuler,
  onEnregistrer,
  enCours,
}: {
  valeur: Partial<AgendaExterne>
  natures: Array<{ valeur: string; libelle: string; description: string }>
  directions: Array<{ valeur: string; libelle: string; description: string }>
  categories: Array<{ id: number; name: string }>
  onChange: (valeur: Partial<AgendaExterne>) => void
  onAnnuler: () => void
  onEnregistrer: () => void
  enCours: boolean
}) {
  const poser = (partiel: Partial<AgendaExterne>) => onChange({ ...valeur, ...partiel })

  const basculer = <T,>(liste: T[] | undefined, element: T): T[] => {
    const actuelle = liste ?? []
    return actuelle.includes(element)
      ? actuelle.filter((v) => v !== element)
      : [...actuelle, element]
  }

  const envoie = valeur.direction !== 'import'

  return (
    <Card>
      <CardBody className="space-y-5">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {valeur.id ? `Modifier « ${valeur.name} »` : 'Nouvel agenda externe'}
        </h3>

        {/* --- La connexion --- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LIBELLE}>Nom</label>
            <input
              type="text"
              value={valeur.name ?? ''}
              onChange={(e) => poser({ name: e.target.value })}
              placeholder="Carnet du service technique"
              className={CHAMP}
            />
          </div>
          <div>
            <label className={LIBELLE}>Type de serveur</label>
            <select
              value={valeur.kind ?? 'caldav'}
              onChange={(e) => poser({ kind: e.target.value as AgendaExterne['kind'] })}
              className={CHAMP}
            >
              <option value="caldav">CalDAV (Nextcloud, Zimbra, iCloud…)</option>
              <option value="outlook">Outlook / Microsoft 365</option>
            </select>
          </div>
        </div>

        {valeur.kind === 'outlook' ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={LIBELLE}>Client ID</label>
                <input
                  type="text"
                  value={valeur.client_id ?? ''}
                  onChange={(e) => poser({ client_id: e.target.value })}
                  className={CHAMP}
                />
              </div>
              <div>
                <label className={LIBELLE}>Client secret</label>
                <input
                  type="password"
                  value={valeur.client_secret ?? ''}
                  onChange={(e) => poser({ client_secret: e.target.value })}
                  className={CHAMP}
                />
              </div>
              <div>
                <label className={LIBELLE}>Tenant ID</label>
                <input
                  type="text"
                  value={valeur.tenant_id ?? ''}
                  onChange={(e) => poser({ tenant_id: e.target.value })}
                  className={CHAMP}
                />
              </div>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Outlook ne sait, pour l’instant, que <strong>recevoir</strong> : y écrire demande le
              consentement délégué de Microsoft Graph, que cette configuration ne porte pas.
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LIBELLE}>Adresse du serveur</label>
              <input
                type="text"
                value={valeur.server_url ?? ''}
                onChange={(e) => poser({ server_url: e.target.value })}
                placeholder="https://nuage.macommune.fr/remote.php/dav"
                className={CHAMP}
              />
            </div>
            <div>
              <label className={LIBELLE}>Identifiant</label>
              <input
                type="text"
                value={valeur.username ?? ''}
                onChange={(e) => poser({ username: e.target.value })}
                className={CHAMP}
              />
            </div>
            <div>
              <label className={LIBELLE}>Mot de passe</label>
              <input
                type="password"
                value={valeur.password ?? ''}
                onChange={(e) => poser({ password: e.target.value })}
                placeholder={valeur.id ? '••••••••' : ''}
                className={CHAMP}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LIBELLE}>Chemin du calendrier</label>
              <input
                type="text"
                value={valeur.calendar_path ?? ''}
                onChange={(e) => poser({ calendar_path: e.target.value })}
                placeholder="calendars/technique/entretiens"
                className={CHAMP}
              />
            </div>
          </div>
        )}

        {/* --- Le sens --- */}
        <div>
          <label className={LIBELLE}>Sens de la synchronisation</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {directions.map((d) => (
              <button
                key={d.valeur}
                type="button"
                onClick={() => poser({ direction: d.valeur as AgendaExterne['direction'] })}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  valeur.direction === d.valeur
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                    : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  {d.libelle}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {d.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* --- L'aiguillage, qui ne concerne que l'envoi --- */}
        {envoie && (
          <div className="space-y-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Ce que ce carnet reçoit
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Ne rien cocher veut dire « tout ». C’est le réglage de départ, celui qui convient
                quand il n’y a qu’un seul carnet.
              </p>
            </div>

            <div>
              <label className={LIBELLE}>Natures</label>
              <div className="flex flex-wrap gap-2">
                {natures.map((n) => (
                  <button
                    key={n.valeur}
                    type="button"
                    title={n.description}
                    onClick={() => poser({ natures: basculer(valeur.natures, n.valeur) })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      (valeur.natures ?? []).includes(n.valeur)
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                    }`}
                  >
                    {(valeur.natures ?? []).includes(n.valeur) && (
                      <Check className="mr-1 inline h-3 w-3" />
                    )}
                    {n.libelle}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={LIBELLE}>Catégories de matériel</label>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => poser({ category_ids: basculer(valeur.category_ids, c.id) })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      (valeur.category_ids ?? []).includes(c.id)
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                    }`}
                  >
                    {(valeur.category_ids ?? []).includes(c.id) && (
                      <Check className="mr-1 inline h-3 w-3" />
                    )}
                    {c.name}
                  </button>
                ))}
              </div>

              {/* Une tonte de parc ou un rendez-vous saisi à la main ne désigne
                  aucun matériel : sans cette case, filtrer par catégorie les
                  ferait disparaître sans que rien ne le dise. */}
              {(valeur.category_ids ?? []).length > 0 && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={valeur.include_uncategorized !== false}
                    onChange={(e) => poser({ include_uncategorized: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  />
                  Inclure ce qui ne désigne aucun matériel (espaces verts, rendez-vous saisis à la
                  main)
                </label>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={valeur.enabled !== false}
              onChange={(e) => poser({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600"
            />
            Actif
          </label>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700 dark:text-gray-200">Couleur</label>
            <input
              type="color"
              value={valeur.color ?? '#10b981'}
              onChange={(e) => poser({ color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onAnnuler} disabled={enCours}>
            Annuler
          </Button>
          <Button onClick={onEnregistrer} disabled={enCours}>
            Enregistrer
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
