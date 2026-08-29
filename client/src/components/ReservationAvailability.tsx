import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, CalendarX, Clock, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { formatDate } from '@/lib/utils'

/**
 * Disponibilité d'un matériel sur la période demandée.
 *
 * `GET /reservations/availability/:objectId` existait depuis toujours et
 * n'était appelé par aucun écran : un créneau déjà pris n'apparaissait qu'en
 * erreur 409, après avoir rempli et envoyé le formulaire. L'agent découvrait le
 * conflit une fois son travail perdu, sans savoir quand le matériel serait
 * libre.
 *
 * Les statuts bloquants affichés ici sont exactement ceux que la création
 * considère comme tels. Les demandes en attente sont montrées à part : elles ne
 * bloquent pas, mais deux agents qui demandent le même créneau sans le savoir
 * aboutissent à une demande validée et une autre qui reste en attente.
 */

interface Reservation {
  id: number
  start_date: string
  end_date: string
  first_name?: string
  last_name?: string
  reason?: string
}

interface Props {
  objectId: string
  startDate: string
  endDate: string
  /** Remonte le verdict pour que le bouton d'envoi puisse être désactivé. */
  onDisponibilite?: (disponible: boolean) => void
}

function nomEmprunteur(r: Reservation): string {
  const nom = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return nom || 'un collègue'
}

function Creneau({ r }: { r: Reservation }) {
  return (
    <li>
      Du {formatDate(r.start_date)} au {formatDate(r.end_date)} — {nomEmprunteur(r)}
    </li>
  )
}

export default function ReservationAvailability({ objectId, startDate, endDate, onDisponibilite }: Props) {
  const periodeComplete = Boolean(startDate && endDate)

  const { data, isFetching } = useQuery({
    queryKey: ['reservation-availability', objectId, periodeComplete ? startDate : '', periodeComplete ? endDate : ''],
    queryFn: async () => {
      const params = periodeComplete ? `?startDate=${startDate}&endDate=${endDate}` : ''
      const res = await api.get(`/reservations/availability/${objectId}${params}`)
      return res.data.data as { isAvailable: boolean; reservations: Reservation[]; pending: Reservation[] }
    },
    enabled: Boolean(objectId),
  })

  const conflits = data?.reservations ?? []
  const enAttente = data?.pending ?? []
  // Tant que la période n'est pas complète, rien n'est vérifié : on ne bloque
  // pas l'envoi sur une absence de réponse.
  const disponible = !periodeComplete || conflits.length === 0

  useEffect(() => {
    onDisponibilite?.(disponible)
  }, [disponible, onDisponibilite])

  if (!objectId) return null

  if (isFetching && !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Vérification de la disponibilité…
      </p>
    )
  }

  if (periodeComplete && conflits.length > 0) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/25">
        <p className="flex items-center gap-2 font-medium text-red-900 dark:text-red-200">
          <CalendarX className="h-4 w-4 flex-shrink-0" />
          Ce matériel est déjà réservé sur cette période
        </p>
        <ul className="mt-2 space-y-1 text-sm text-red-800 dark:text-red-300">
          {conflits.map((r) => <Creneau key={r.id} r={r} />)}
        </ul>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">Choisissez d'autres dates ou un autre matériel.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {periodeComplete && (
        <p className="flex items-center gap-2 text-sm font-medium text-green-800 dark:text-green-300">
          <CalendarCheck className="h-4 w-4 flex-shrink-0" />
          Disponible sur cette période
        </p>
      )}

      {!periodeComplete && conflits.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-gray-700/40">
          <p className="font-medium text-gray-800 dark:text-gray-200">Déjà réservé</p>
          <ul className="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
            {conflits.map((r) => <Creneau key={r.id} r={r} />)}
          </ul>
        </div>
      )}

      {enAttente.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <Clock className="h-4 w-4 flex-shrink-0" />
            {enAttente.length === 1 ? 'Une demande est en attente de validation' : `${enAttente.length} demandes sont en attente de validation`}
          </p>
          <ul className="mt-1 space-y-1 text-amber-800 dark:text-amber-300">
            {enAttente.map((r) => <Creneau key={r.id} r={r} />)}
          </ul>
        </div>
      )}
    </div>
  )
}
