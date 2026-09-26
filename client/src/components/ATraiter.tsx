import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Building2, CalendarDays, CalendarRange, LifeBuoy } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import api, { batimentsApi, exploitationApi, manifestationApi, ticketApi } from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import { useMenuPlugins } from '@/lib/modules'
import { usePermissions } from '@/lib/permissions'
import { cn, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

/**
 * « À traiter » : ce que chaque module attend du compte, en tête d'accueil.
 *
 * Le tableau de bord ne parlait que du parc — catégories, pleins, contrôles
 * techniques — alors que les tickets, les bâtiments et les manifestations ont
 * chacun leur file. Une carte par module actif, et seulement celles-là : le
 * menu et l'accueil lisent la même liste (`useMenuPlugins`).
 *
 * Chaque carte interroge la route de son module, qui applique déjà le bon
 * périmètre. Un compteur recalculé ici pour tout le monde réécrirait ces
 * droits, et finirait par montrer à quelqu'un un nombre qu'il ne peut pas
 * ouvrir.
 */
export default function ATraiter() {
  const { data: modules, isSuccess } = useMenuPlugins()
  const { consulteDesBatiments } = useGestion()
  const actif = (slug: string) => !!modules?.some((m) => m.slug === slug)

  const cartes = [
    actif('tickets') && <CarteTickets key="tickets" />,
    // Même règle que le menu : un bâtiment qu'on ne suit pas n'a rien à signaler.
    actif('batiments') && consulteDesBatiments && <CarteBatiments key="batiments" />,
    actif('manifestations') && <CarteManifestations key="manifestations" />,
    actif('reservations') && <CarteReservations key="reservations" />,
  ].filter(Boolean)

  if (!isSuccess || cartes.length === 0) return null

  return (
    <section aria-labelledby="a-traiter" className="space-y-3">
      <h2 id="a-traiter" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        À traiter
      </h2>
      <div className={cn('grid grid-cols-1 gap-4', cartes.length > 1 && 'lg:grid-cols-2')}>{cartes}</div>
    </section>
  )
}

// ------------------------------------------------------------------ les briques

function aujourdHui(decalageJours = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + decalageJours)
  // La date locale : `toISOString` basculerait au lendemain passé minuit en été.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CarteModule({
  titre,
  icone,
  lien,
  chargement,
  children,
}: {
  titre: string
  icone: ReactNode
  lien: string
  chargement?: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">{icone}</span>
          {titre}
        </CardTitle>
        <button
          onClick={() => navigate(lien)}
          className="inline-flex min-h-[44px] items-center px-2 -mx-2 rounded-lg text-sm text-primary-600 hover:bg-primary-50 hover:text-primary-700 font-medium dark:hover:bg-primary-900/30"
        >
          Ouvrir →
        </button>
      </CardHeader>
      <CardBody className="space-y-4">{chargement ? <LoadingInline /> : children}</CardBody>
    </Card>
  )
}

type Ton = 'danger' | 'attention' | 'info'

const TONS: Record<Ton, string> = {
  danger: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  attention: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
}

interface Compteur {
  libelle: string
  valeur: number
  ton: Ton
  lien: string
}

/** Des compteurs cliquables ; à zéro, grisés, pour que ce qui compte ressorte. */
function Compteurs({ compteurs }: { compteurs: Compteur[] }) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {compteurs.map((c) => (
        <button
          key={c.libelle}
          onClick={() => navigate(c.lien)}
          className={cn(
            'min-h-[64px] rounded-lg px-3 py-2 text-left transition-opacity hover:opacity-80',
            c.valeur > 0 ? TONS[c.ton] : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          )}
        >
          <span className="block text-2xl font-bold leading-tight">{c.valeur}</span>
          <span className="block text-xs">{c.libelle}</span>
        </button>
      ))}
    </div>
  )
}

interface Ligne {
  cle: string | number
  titre: string
  detail?: string | null
  marque?: { texte: string; ton: Ton } | null
  lien: string
}

function Lignes({ lignes, vide }: { lignes: Ligne[]; vide: string }) {
  const navigate = useNavigate()
  if (lignes.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{vide}</p>
  }
  return (
    <ul className="-mx-2 divide-y divide-gray-100 dark:divide-gray-700">
      {lignes.map((l) => (
        <li key={l.cle}>
          <button
            onClick={() => navigate(l.lien)}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{l.titre}</span>
              {l.detail && <span className="block truncate text-sm text-gray-500 dark:text-gray-400">{l.detail}</span>}
            </span>
            {l.marque && (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', TONS[l.marque.ton])}>
                {l.marque.texte}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ les tickets

function CarteTickets() {
  const moi = useAuthStore((s) => s.user?.id)

  // Même clé que la page Tickets : l'aller-retour ne recharge rien.
  const { data: droits, isLoading: droitsEnCours } = useQuery({
    queryKey: ['tickets', 'permissions'],
    queryFn: async () => (await ticketApi.permissions()).data,
  })
  // Ce qu'on m'a confié, et où en sont mes demandes : les deux files sont
  // lues, car un ticket peut être confié à quelqu'un qui n'a pas (ou plus) de
  // niveau d'intervenant — le taire le laisserait sans suite.
  const { data: confies, isLoading: confiesEnCours } = useQuery({
    queryKey: ['tickets', 'tableau-de-bord', 'confies', moi],
    queryFn: async () => (await ticketApi.liste({ technicienId: moi, ouverts: true, limite: 50 })).data,
    enabled: !!moi,
  })
  const { data: demandes, isLoading: demandesEnCours } = useQuery({
    queryKey: ['tickets', 'tableau-de-bord', 'demandes', moi],
    queryFn: async () => (await ticketApi.liste({ demandeurId: moi, ouverts: true, limite: 50 })).data,
    enabled: !!moi,
  })

  const intervenant = !!droits?.estIntervenant || (confies?.total ?? 0) > 0
  const file = intervenant ? confies : demandes
  const tickets = file?.tickets ?? []
  const enRetard = tickets.filter((t) => t.enRetard).length
  // Les retards d'abord : c'est ce qu'on vient chercher.
  const premiers = [...tickets].sort((a, b) => Number(b.enRetard) - Number(a.enRetard)).slice(0, 3)

  const compteurs: Compteur[] = intervenant
    ? [
        { libelle: 'Qui me sont confiés', valeur: confies?.total ?? 0, ton: 'info', lien: '/tickets?moi=1' },
        { libelle: 'Hors délai', valeur: enRetard, ton: 'danger', lien: '/tickets?moi=1' },
        { libelle: 'Mes demandes en cours', valeur: demandes?.total ?? 0, ton: 'info', lien: '/tickets' },
      ]
    : [{ libelle: 'Demandes en cours', valeur: demandes?.total ?? 0, ton: 'info', lien: '/tickets' }]
  if (droits?.estSuperviseur) {
    compteurs.push({ libelle: 'Clôtures à valider', valeur: droits.aValider, ton: 'attention', lien: '/tickets?avalider=1' })
  }

  return (
    <CarteModule
      titre={intervenant ? 'Tickets' : 'Mes demandes'}
      icone={<LifeBuoy className="h-5 w-5" />}
      lien={intervenant ? '/tickets?moi=1' : '/tickets'}
      chargement={droitsEnCours || confiesEnCours || demandesEnCours}
    >
      <Compteurs compteurs={compteurs} />
      <Lignes
        vide={intervenant ? 'Aucun ticket ouvert ne vous est confié.' : 'Aucune demande en cours.'}
        lignes={premiers.map((t) => ({
          cle: t.id,
          titre: t.titre,
          detail: [t.reference, t.site?.nom, t.statut.nom].filter(Boolean).join(' · '),
          marque: t.enRetard ? { texte: 'Hors délai', ton: 'danger' } : null,
          lien: `/tickets/${t.id}`,
        }))}
      />
    </CarteModule>
  )
}

// ---------------------------------------------------------------- les bâtiments

function CarteBatiments() {
  const { data, isLoading } = useQuery({
    queryKey: ['batiments', 'liste'],
    queryFn: async () => (await batimentsApi.liste()).data,
  })
  // Sous `['batiments', …]` : un contrat modifié invalide aussi ce résumé.
  const { data: contrats } = useQuery({
    queryKey: ['batiments', 'contrats', 'tableau-de-bord'],
    queryFn: async () => (await exploitationApi.contrats()).data.contrats,
  })

  const batiments = data?.batiments ?? []
  const total = (cle: 'en_retard' | 'non_conforme' | 'bientot') =>
    batiments.reduce((n, b) => n + (b.compteurs[cle] ?? 0), 0)
  // Un responsable dépose, il ne valide pas : la file ne compte que les bâtiments gérés.
  const geres = batiments.filter((b) => b.gere)
  const aValider = geres.reduce((n, b) => n + (b.compteurs.aValider ?? 0), 0)

  const aDecider = (contrats ?? []).filter(
    (c) => c.actif && (c.etat.statut === 'a_resilier' || c.etat.statut === 'se_termine')
  )

  const compteurs: Compteur[] = [
    { libelle: 'Contrôles en retard', valeur: total('en_retard'), ton: 'danger', lien: '/batiments' },
    { libelle: 'Non conformes', valeur: total('non_conforme'), ton: 'danger', lien: '/batiments' },
    { libelle: 'À prévoir', valeur: total('bientot'), ton: 'attention', lien: '/batiments' },
  ]
  if (geres.length > 0) {
    compteurs.push({ libelle: 'Documents à valider', valeur: aValider, ton: 'attention', lien: '/batiments/a-valider' })
  }
  if (contrats) {
    compteurs.push({ libelle: 'Contrats à décider', valeur: aDecider.length, ton: 'attention', lien: '/batiments' })
  }

  const enDefaut = batiments
    .map((b) => ({ b, n: (b.compteurs.en_retard ?? 0) + (b.compteurs.non_conforme ?? 0) }))
    .filter(({ n }) => n > 0)
    .sort((x, y) => y.n - x.n)

  const lignes: Ligne[] = [
    ...enDefaut.slice(0, 3).map(({ b, n }) => ({
      cle: `b${b.id}`,
      titre: b.nom,
      detail: b.adresse,
      marque: { texte: `${n} à reprendre`, ton: 'danger' as Ton },
      lien: `/batiments/${b.id}?onglet=controles`,
    })),
    ...aDecider.slice(0, 2).map((c) => ({
      cle: `c${c.id}`,
      titre: c.objet,
      detail: [c.entreprise?.nom, c.sites.map((s) => s.nom).join(', ')].filter(Boolean).join(' · '),
      marque: {
        texte: c.etat.statut === 'a_resilier' ? `Préavis ${formatDate(c.etat.dateCle)}` : `Fin ${formatDate(c.etat.dateCle)}`,
        ton: 'attention' as Ton,
      },
      lien: `/batiments?contrat=${c.id}`,
    })),
  ]

  return (
    <CarteModule titre="Bâtiments" icone={<Building2 className="h-5 w-5" />} lien="/batiments" chargement={isLoading}>
      <Compteurs compteurs={compteurs} />
      <Lignes vide="Tous les contrôles suivis sont à jour." lignes={lignes} />
    </CarteModule>
  )
}

// ----------------------------------------------------------- les manifestations

const STATUTS_MANIFESTATION: Record<string, string> = {
  pending: 'À confirmer',
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
}

function CarteManifestations() {
  const jour = aujourdHui()
  const { data, isLoading } = useQuery({
    queryKey: ['manifestations', 'tableau-de-bord', jour],
    queryFn: async () => (await manifestationApi.getAll({ date_from: jour })).data.data,
  })

  const aVenir = (data ?? [])
    .filter((m) => m.status !== 'cancelled')
    .sort((a, b) => a.date_start.localeCompare(b.date_start))
  const dansLaSemaine = aujourdHui(7)

  return (
    <CarteModule
      titre="Manifestations"
      icone={<CalendarDays className="h-5 w-5" />}
      lien="/manifestations"
      chargement={isLoading}
    >
      <Compteurs
        compteurs={[
          {
            libelle: 'À confirmer',
            valeur: aVenir.filter((m) => m.status === 'pending').length,
            ton: 'attention',
            lien: '/manifestations',
          },
          {
            libelle: 'Dans les 7 jours',
            valeur: aVenir.filter((m) => m.date_start.slice(0, 10) <= dansLaSemaine).length,
            ton: 'info',
            lien: '/manifestations',
          },
          { libelle: 'À venir', valeur: aVenir.length, ton: 'info', lien: '/manifestations' },
        ]}
      />
      <Lignes
        vide="Aucune manifestation à venir."
        lignes={aVenir.slice(0, 3).map((m) => ({
          cle: m.id,
          titre: m.title,
          detail: [formatDate(m.date_start), m.delivery_address].filter(Boolean).join(' · '),
          marque:
            m.status === 'pending'
              ? { texte: STATUTS_MANIFESTATION.pending, ton: 'attention' }
              : { texte: STATUTS_MANIFESTATION[m.status] ?? m.status, ton: 'info' },
          lien: '/manifestations',
        }))}
      />
    </CarteModule>
  )
}

// --------------------------------------------------------------- les réservations

interface Reservation {
  id: number
  status: string
  start_date: string
  end_date: string
  object_name: string | null
  borrower_first_name: string | null
  borrower_last_name: string | null
}

function CarteReservations() {
  const { canManage } = usePermissions()
  const jour = aujourdHui()

  // Celles qui ne sont pas terminées ; les retards à part, leur fin étant passée.
  const { data: enCours, isLoading } = useQuery({
    queryKey: ['reservations', 'tableau-de-bord', jour],
    queryFn: async () =>
      (await api.get<{ data: Reservation[] }>(`/reservations?startDate=${jour}`)).data.data,
  })
  const { data: retards } = useQuery({
    queryKey: ['reservations', 'tableau-de-bord', 'overdue'],
    queryFn: async () => (await api.get<{ data: Reservation[] }>('/reservations?status=overdue')).data.data,
  })

  const liste = enCours ?? []
  const prochaines = liste
    .filter((r) => r.status === 'pending' || r.status === 'reserved')
    .sort((a, b) => a.start_date.localeCompare(b.start_date))

  const compteurs: Compteur[] = [
    { libelle: 'Retours en retard', valeur: retards?.length ?? 0, ton: 'danger', lien: '/reservations' },
    { libelle: 'Sorties en cours', valeur: liste.filter((r) => r.status === 'borrowed').length, ton: 'info', lien: '/reservations' },
  ]
  // Seul qui gère le matériel approuve : ailleurs, le compteur promettrait un geste impossible.
  if (canManage) {
    compteurs.unshift({
      libelle: 'À approuver',
      valeur: liste.filter((r) => r.status === 'pending').length,
      ton: 'attention',
      lien: '/reservations',
    })
  }

  return (
    <CarteModule
      titre="Réservations"
      icone={<CalendarRange className="h-5 w-5" />}
      lien="/reservations"
      chargement={isLoading}
    >
      <Compteurs compteurs={compteurs} />
      <Lignes
        vide="Aucune réservation à venir."
        lignes={prochaines.slice(0, 3).map((r) => ({
          cle: r.id,
          titre: r.object_name ?? 'Matériel',
          detail: [
            `${formatDate(r.start_date)} → ${formatDate(r.end_date)}`,
            [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(' '),
          ]
            .filter(Boolean)
            .join(' · '),
          marque: r.status === 'pending' ? { texte: 'À approuver', ton: 'attention' } : null,
          lien: '/reservations',
        }))}
      />
    </CarteModule>
  )
}
