import { useQuery } from '@tanstack/react-query'
import { Building2, CalendarDays, CalendarRange, LifeBuoy } from 'lucide-react'
import api, { batimentsApi, exploitationApi, manifestationApi, ticketApi } from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { CarteModule, Compteurs, Lignes, aujourdHui, type Compteur, type Ligne, type Ton } from './briques'

/**
 * Les cartes des modules : ce que chacun attend du compte.
 *
 * Chaque carte interroge la route de son module, qui applique déjà le bon
 * périmètre. Un compteur recalculé ici pour tout le monde réécrirait ces
 * droits, et finirait par montrer à quelqu'un un nombre qu'il ne peut pas
 * ouvrir. Qu'une carte s'affiche ou non — module actif, bâtiments suivis — se
 * décide dans `useAccueil` (`lib/accueil.ts`).
 */

// ------------------------------------------------------------------ les tickets

export function CarteTickets() {
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

export function CarteBatiments() {
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

export function CarteManifestations() {
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
          lien: `/manifestations?fiche=${m.id}`,
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

export function CarteReservations() {
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
