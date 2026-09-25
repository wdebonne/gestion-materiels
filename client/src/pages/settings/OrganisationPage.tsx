import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Building2,
  DoorOpen,
  Network,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  organisationApi,
  siteApi,
  type MembreSite,
  type Salle,
} from '@/lib/api'
import api from '@/lib/api'
import { CLE_GESTION, useGestion } from '@/lib/gestion'
import { usePermissions } from '@/lib/permissions'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  LoadingInline,
  Select,
  Tab,
  Tabs,
} from '@/components/ui'
import ReferentielLieux from '@/components/ReferentielLieux'
import ServicesPage from './ServicesPage'

/**
 * L'organisation de la commune : ses bâtiments, ses salles, ses services.
 *
 * Ces référentiels servaient déjà partout — demandes, clés, manifestations,
 * prêt de salles — mais se réglaient chacun dans le module qui les avait vus
 * naître : les bâtiments dans Tickets, leur arbre dans Clés, les services dans
 * Manifestations. On les cherchait au mauvais endroit une fois sur deux.
 *
 * ## Et qui les gère
 *
 * C'est l'autre moitié de l'écran. On y confie la gestion **sans toucher au
 * rôle** : le régisseur des salles gère toute l'organisation sans devenir
 * superviseur, la directrice gère son école, le chef des sports tient la liste
 * de son service. Chacun ne voit ici que ce qu'il gère — et le serveur, lui,
 * refuse le reste (`gestionOrganisation.service.ts`).
 */

const ONGLETS = {
  batiments: { description: 'Les bâtiments, leurs salles et leurs portes, et qui y est rattaché.' },
  salles: { description: 'Toutes les salles, tous bâtiments confondus — celles que le formulaire propose.' },
  services: { description: 'Les services, leurs membres et leur périmètre.' },
  gestionnaires: { description: 'Qui gère quoi — et ce que personne ne gère.' },
} as const

type Onglet = keyof typeof ONGLETS

export default function OrganisationPage() {
  const gestion = useGestion()
  const { canAdmin } = usePermissions()
  const [parametres, setParametres] = useSearchParams()

  // Un onglet n'apparaît qu'à qui peut s'en servir : le responsable d'un
  // service n'a rien à faire dans l'onglet des bâtiments.
  const visibles: Onglet[] = [
    ...(gestion.gereLieux || gestion.sitesGeres.length > 0 ? (['batiments', 'salles'] as Onglet[]) : []),
    ...(gestion.gereServices || gestion.servicesGeres.length > 0 ? (['services'] as Onglet[]) : []),
    ...(canAdmin ? (['gestionnaires'] as Onglet[]) : []),
  ]

  const demande = parametres.get('onglet')
  const actif: Onglet | undefined =
    demande && visibles.includes(demande as Onglet) ? (demande as Onglet) : visibles[0]

  const changer = (onglet: string) =>
    setParametres(onglet === visibles[0] ? {} : { onglet }, { replace: true })

  if (gestion.chargement) return <LoadingInline />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Network className="w-7 h-7 text-primary-600" />
          Organisation
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {actif ? ONGLETS[actif].description : ''}
        </p>
      </div>

      {!actif ? (
        <Alert type="info">
          <span className="text-sm">
            Vous ne gérez aucun bâtiment ni aucun service. Un administrateur peut vous en confier
            la gestion.
          </span>
        </Alert>
      ) : (
        <>
          <Tabs value={actif} onChange={changer}>
            {visibles.includes('batiments') && (
              <Tab value="batiments" label="Bâtiments" icon={<Building2 className="w-4 h-4" />} />
            )}
            {visibles.includes('salles') && (
              <Tab value="salles" label="Salles" icon={<DoorOpen className="w-4 h-4" />} />
            )}
            {visibles.includes('services') && (
              <Tab value="services" label="Services" icon={<Users className="w-4 h-4" />} />
            )}
            {visibles.includes('gestionnaires') && (
              <Tab value="gestionnaires" label="Gestionnaires" icon={<ShieldCheck className="w-4 h-4" />} />
            )}
          </Tabs>

          <div className="mt-6">
            {actif === 'batiments' && (
              <ReferentielLieux
                seulementGeres={!gestion.gereLieux}
                panneauSite={(siteId) =>
                  gestion.peutGererSite(siteId) ? <PersonnesDuSite siteId={siteId} /> : null
                }
              />
            )}
            {actif === 'salles' && <ListeSalles />}
            {actif === 'services' && <ServicesPage />}
            {actif === 'gestionnaires' && <Gestionnaires />}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------- les personnes d'un bâtiment

/** Les quatre droits d'un rattachement, dans l'ordre où l'écran les présente. */
const DROITS: Array<{ cle: keyof Pick<MembreSite, 'estResponsable' | 'peutVoirTickets' | 'notifie' | 'gereLieu'>; libelle: string; aide: string }> = [
  { cle: 'estResponsable', libelle: 'Responsable', aide: 'Signale pour le bâtiment, pas seulement pour son matériel' },
  { cle: 'peutVoirTickets', libelle: 'Voit', aide: 'Lit les demandes du bâtiment' },
  { cle: 'notifie', libelle: 'Reçoit', aide: 'Un courriel à chaque demande du bâtiment' },
  { cle: 'gereLieu', libelle: 'Gère', aide: 'Ses salles, ses portes et ces rattachements' },
]

function PersonnesDuSite({ siteId }: { siteId: number }) {
  const queryClient = useQueryClient()
  const [ajout, setAjout] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['organisation', 'membres', siteId],
    queryFn: async () => (await siteApi.membres(siteId)).data,
  })
  const { data: personnes = [] } = useQuery({
    queryKey: ['organisation', 'personnes'],
    queryFn: async () => (await organisationApi.personnes()).data.personnes,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['organisation', 'membres', siteId] })
    queryClient.invalidateQueries({ queryKey: CLE_GESTION })
  }
  const surErreur = (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible')

  const regler = useMutation({
    mutationFn: ({ userId, droits }: { userId: number; droits: Partial<MembreSite> }) =>
      siteApi.reglerMembre(siteId, userId, droits),
    onSuccess: rafraichir,
    onError: surErreur,
  })
  const retirer = useMutation({
    mutationFn: (userId: number) => siteApi.retirerMembre(siteId, userId),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  if (isLoading || !data) return <LoadingInline />
  const membres = data.membres
  const libres = personnes.filter((p) => !membres.some((m) => m.userId === p.userId))

  return (
    <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Users className="h-3.5 w-3.5" />
        Personnes rattachées
      </p>

      {membres.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Personne n'est rattaché à ce bâtiment.</p>
      )}

      {membres.map((m) => (
        <div
          key={m.userId}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white p-2 dark:bg-gray-800"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
            {m.nom}
            {m.email && <span className="ml-2 text-xs text-gray-500">{m.email}</span>}
          </span>
          {DROITS.map(({ cle, libelle, aide }) => {
            // Faire un gestionnaire revient au gestionnaire global : celui du
            // bâtiment se donnerait sinon des pairs. Le serveur refuse de même.
            const verrouille = cle === 'gereLieu' && !data.peutAccorderGestion
            return (
              <label
                key={cle}
                title={verrouille ? 'Seul un gestionnaire de toute l’organisation désigne les gestionnaires' : aide}
                className={`inline-flex items-center gap-1 text-xs ${
                  verrouille ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={m[cle]}
                  disabled={verrouille || regler.isPending}
                  onChange={(e) => regler.mutate({ userId: m.userId, droits: { [cle]: e.target.checked } })}
                />
                {libelle}
              </label>
            )
          })}
          {(data.peutAccorderGestion || !m.gereLieu) && (
            <button
              onClick={() => retirer.mutate(m.userId)}
              className="p-1 text-gray-400 hover:text-red-600"
              aria-label={`Retirer ${m.nom}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Select
          value={ajout}
          onChange={(e) => setAjout(e.target.value)}
          options={[
            { value: '', label: '— Rattacher une personne —' },
            ...libres.map((p) => ({ value: p.userId, label: p.nom + (p.email ? ` (${p.email})` : '') })),
          ]}
        />
        <Button
          size="sm"
          variant="outline"
          icon={<UserPlus className="w-4 h-4" />}
          disabled={!ajout}
          loading={regler.isPending}
          onClick={() =>
            regler.mutate(
              { userId: Number(ajout), droits: {} },
              { onSuccess: () => setAjout('') }
            )
          }
        >
          Rattacher
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ les salles

/** `null` = suit le bâtiment ; le `<select>` rend des chaînes. */
const versChoix = (v: boolean | null) => (v === null ? '' : v ? '1' : '0')
const depuisChoix = (v: string) => (v === '' ? '' : v === '1')

/**
 * Toutes les salles, en un tableau.
 *
 * L'arbre des bâtiments dit *où* est une salle ; ce tableau répond à la
 * question qu'on se pose le plus souvent — « quelles salles a-t-on, combien
 * de places, lesquelles se prêtent ? » — sans déplier douze bâtiments.
 * Ce sont aussi celles que le formulaire externe propose
 * (`/api/lieux/public/salles`), dès qu'elles se prêtent.
 */
function ListeSalles() {
  const queryClient = useQueryClient()
  const gestion = useGestion()
  const [nouvelle, setNouvelle] = useState({ siteId: '', nom: '' })

  const { data: salles = [], isLoading } = useQuery({
    queryKey: ['organisation', 'salles'],
    queryFn: async () => (await organisationApi.salles(true)).data.salles,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ['sites', 'tous'],
    queryFn: async () => (await siteApi.liste(true)).data.sites,
  })
  const sitesGerables = useMemo(
    () => sites.filter((s) => s.actif && gestion.peutGererSite(s.id)),
    [sites, gestion]
  )

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['organisation', 'salles'] })
    queryClient.invalidateQueries({ queryKey: ['cles-referentiel'] })
    queryClient.invalidateQueries({ queryKey: ['lieux-arbre'] })
  }
  const surErreur = (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible')

  const modifier = useMutation({
    mutationFn: ({ id, champs }: { id: number; champs: Record<string, unknown> }) =>
      api.put(`/sites/pieces/${id}`, champs),
    onSuccess: rafraichir,
    onError: surErreur,
  })
  const creer = useMutation({
    mutationFn: () =>
      api.post('/sites/pieces', { siteId: Number(nouvelle.siteId), nom: nouvelle.nom.trim(), typeLieu: 'Salle' }),
    onSuccess: () => {
      setNouvelle({ siteId: nouvelle.siteId, nom: '' })
      rafraichir()
      toast.success('Salle ajoutée')
    },
    onError: surErreur,
  })

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      <Alert type="info">
        <span className="text-sm">
          Une salle est une pièce de nature « Salle ». Celles qui se prêtent sont proposées au
          formulaire de réservation, par l'adresse <code className="text-xs">/api/lieux/public/salles</code>.
        </span>
      </Alert>

      {sitesGerables.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-56">
              <Select
                label="Bâtiment"
                value={nouvelle.siteId}
                onChange={(e) => setNouvelle({ ...nouvelle, siteId: e.target.value })}
                options={[
                  { value: '', label: '— Choisir —' },
                  ...sitesGerables.map((s) => ({ value: s.id, label: s.nom })),
                ]}
              />
            </div>
            <div className="flex-1">
              <Input
                label="Nouvelle salle"
                value={nouvelle.nom}
                placeholder="Salle du conseil, Salle du CCAS…"
                onChange={(e) => setNouvelle({ ...nouvelle, nom: e.target.value })}
              />
            </div>
            <Button
              icon={<Plus className="w-4 h-4" />}
              disabled={!nouvelle.siteId || !nouvelle.nom.trim()}
              loading={creer.isPending}
              onClick={() => creer.mutate()}
            >
              Ajouter
            </Button>
          </CardBody>
        </Card>
      )}

      {salles.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gray-600 dark:text-gray-300">
          Aucune salle. Ajoutez-en une ici, ou donnez la nature « Salle » à une pièce existante.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Salle</th>
                <th className="px-3 py-2">Bâtiment</th>
                <th className="px-3 py-2 w-28">Places</th>
                <th className="px-3 py-2 w-44">Se prête</th>
                <th className="px-3 py-2 w-20">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {salles.map((s) => (
                <LigneSalle key={s.id} salle={s} onModifier={(champs) => modifier.mutate({ id: s.id, champs })} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function LigneSalle({ salle, onModifier }: { salle: Salle; onModifier: (champs: Record<string, unknown>) => void }) {
  const lecture = !salle.modifiable
  return (
    <tr className={salle.actif ? '' : 'opacity-60'}>
      <td className="px-3 py-2">
        {lecture ? (
          <span className="text-gray-900 dark:text-gray-100">{salle.nom}</span>
        ) : (
          <input
            defaultValue={salle.nom}
            onBlur={(e) => e.target.value.trim() && e.target.value !== salle.nom && onModifier({ nom: e.target.value.trim() })}
            className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 outline-none text-gray-900 dark:text-white"
          />
        )}
      </td>
      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{salle.siteNom}</td>
      <td className="px-3 py-2">
        {lecture ? (
          salle.capacite ?? '—'
        ) : (
          <input
            type="number"
            min={0}
            defaultValue={salle.capacite ?? ''}
            onBlur={(e) => {
              const valeur = e.target.value === '' ? null : Number(e.target.value)
              if (valeur !== salle.capacite) onModifier({ capacite: valeur ?? '' })
            }}
            className="w-20 bg-transparent border-b border-gray-200 focus:border-primary-500 outline-none text-gray-900 dark:text-white dark:border-gray-600"
          />
        )}
      </td>
      <td className="px-3 py-2">
        {lecture ? (
          salle.pretableEffectif ? <Badge variant="success" size="sm">Oui</Badge> : 'Non'
        ) : (
          <select
            value={versChoix(salle.pretable)}
            onChange={(e) => onModifier({ pretable: depuisChoix(e.target.value) })}
            className="rounded border-gray-300 bg-transparent text-sm dark:border-gray-600 dark:bg-gray-800"
            title={salle.pretable === null ? `Suit le bâtiment : ${salle.pretableEffectif ? 'oui' : 'non'}` : undefined}
          >
            <option value="">
              Comme le bâtiment{salle.pretable === null ? ` (${salle.pretableEffectif ? 'oui' : 'non'})` : ''}
            </option>
            <option value="1">Oui</option>
            <option value="0">Non</option>
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="rounded border-gray-300"
          checked={salle.actif}
          disabled={lecture}
          onChange={(e) => onModifier({ actif: e.target.checked })}
        />
      </td>
    </tr>
  )
}

// ------------------------------------------------------------ les gestionnaires

/**
 * Qui gère quoi — l'écran de l'administrateur.
 *
 * Les gestionnaires globaux se désignent ici. Ceux d'un bâtiment se cochent
 * sur le bâtiment (« Gère »), et le responsable d'un service dans le service
 * (l'étoile) : chacun à côté de ce qu'il gère. Ce tableau-ci les rassemble,
 * et surtout **nomme ce que personne ne tient** — un service sans responsable
 * ne peut rien approuver, et une manifestation qui l'attend reste bloquée.
 */
function Gestionnaires() {
  const queryClient = useQueryClient()
  const [ajout, setAjout] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['organisation', 'gestionnaires'],
    queryFn: async () => (await organisationApi.gestionnaires()).data,
  })
  const { data: personnes = [] } = useQuery({
    queryKey: ['organisation', 'personnes'],
    queryFn: async () => (await organisationApi.personnes()).data.personnes,
  })

  const definir = useMutation({
    mutationFn: ({ userId, gere }: { userId: number; gere: boolean }) =>
      organisationApi.definirGestionnaire(userId, gere),
    onSuccess: () => {
      setAjout('')
      queryClient.invalidateQueries({ queryKey: ['organisation'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible'),
  })

  if (isLoading || !data) return <LoadingInline />

  const libres = personnes.filter((p) => !data.globaux.some((g) => g.userId === p.userId))
  const servicesSansResponsable = data.services.filter((s) => s.actif && s.responsables.length === 0)
  const noms = (liste: Array<{ nom: string }>) => liste.map((p) => p.nom).join(', ')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Gestionnaires de toute l'organisation</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Ils créent et modifient tous les bâtiments, salles et services, et désignent les
            gestionnaires d'un bâtiment et les responsables d'un service — sans devenir
            superviseur. Les superviseurs gèrent déjà les bâtiments et les salles.
          </p>
          {data.globaux.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Aucun pour l'instant.</p>
          )}
          {data.globaux.map((g) => (
            <div key={g.userId} className="flex items-center gap-2 rounded bg-gray-50 p-2 dark:bg-gray-800">
              <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                {g.nom}
                {g.email && <span className="ml-2 text-xs text-gray-500">{g.email}</span>}
              </span>
              <button
                onClick={() => definir.mutate({ userId: g.userId, gere: false })}
                className="p-1 text-gray-400 hover:text-red-600"
                aria-label={`Retirer ${g.nom}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Select
              value={ajout}
              onChange={(e) => setAjout(e.target.value)}
              options={[
                { value: '', label: '— Désigner une personne —' },
                ...libres.map((p) => ({ value: p.userId, label: p.nom + (p.email ? ` (${p.email})` : '') })),
              ]}
            />
            <Button
              size="sm"
              variant="outline"
              icon={<UserPlus className="w-4 h-4" />}
              disabled={!ajout}
              loading={definir.isPending}
              onClick={() => definir.mutate({ userId: Number(ajout), gere: true })}
            >
              Désigner
            </Button>
          </div>
        </CardBody>
      </Card>

      {servicesSansResponsable.length > 0 && (
        <Alert type="warning">
          <span className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Sans responsable, ces services ne peuvent rien approuver :{' '}
              <strong>{noms(servicesSansResponsable)}</strong>.
            </span>
          </span>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Par bâtiment</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1">
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Se coche sur le bâtiment, onglet Bâtiments, colonne « Gère ».
            </p>
            {data.batiments.filter((b) => b.actif).map((b) => (
              <div key={b.siteId} className="flex gap-2 text-sm">
                <span className="w-40 shrink-0 truncate text-gray-900 dark:text-gray-100">{b.nom}</span>
                <span className="truncate text-gray-600 dark:text-gray-300">
                  {b.gestionnaires.length ? noms(b.gestionnaires) : <em className="text-gray-400">gestion globale</em>}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Par service</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1">
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Le responsable se désigne dans le service (l'étoile) : il approuve, délègue et tient
              la liste des membres.
            </p>
            {data.services.filter((s) => s.actif).map((s) => (
              <div key={s.serviceId} className="flex gap-2 text-sm">
                <span className="w-40 shrink-0 truncate text-gray-900 dark:text-gray-100">{s.nom}</span>
                <span className="truncate text-gray-600 dark:text-gray-300">
                  {s.responsables.length ? noms(s.responsables) : <em className="text-amber-600">aucun responsable</em>}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
