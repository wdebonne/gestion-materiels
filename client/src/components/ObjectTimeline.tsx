import { useQuery } from '@tanstack/react-query'
import { Clock, Fuel, Wrench, ClipboardCheck, Package, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import { formatDate, formatCurrency } from '@/lib/utils'

interface TimelineProps {
  objectId: number
}

interface TimelineEvent {
  id: string
  date: string
  type: 'fuel' | 'maintenance' | 'control' | 'alert' | 'creation'
  title: string
  description?: string
  cost?: number
  icon: any
  color: string
}

const typeConfig = {
  fuel: { icon: Fuel, color: 'bg-amber-500', label: 'Carburant' },
  maintenance: { icon: Wrench, color: 'bg-blue-500', label: 'Maintenance' },
  control: { icon: ClipboardCheck, color: 'bg-purple-500', label: 'Contrôle technique' },
  alert: { icon: AlertTriangle, color: 'bg-red-500', label: 'Alerte' },
  creation: { icon: Package, color: 'bg-green-500', label: 'Création' },
}

export default function ObjectTimeline({ objectId }: TimelineProps) {
  // Charger les données de carburant
  const { data: fuelEntries = [] } = useQuery({
    queryKey: ['timeline-fuel', objectId],
    queryFn: async () => {
      const res = await api.get(`/objects/${objectId}/fuel`)
      return (res.data.data || res.data || []).map((e: any) => ({
        id: `fuel-${e.id}`,
        date: e.entry_date || e.entryDate,
        type: 'fuel' as const,
        title: `Plein ${e.fuel_type || e.fuelType || ''}`,
        description: `${e.quantity}L${e.station ? ` - ${e.station}` : ''}`,
        cost: e.total_price || e.totalPrice
      }))
    }
  })

  // Charger les maintenances
  const { data: maintenances = [] } = useQuery({
    queryKey: ['timeline-maintenance', objectId],
    queryFn: async () => {
      const res = await api.get(`/objects/${objectId}/maintenances`)
      return (res.data.data || res.data || []).map((e: any) => ({
        id: `maint-${e.id}`,
        date: e.maintenance_date || e.maintenanceDate,
        type: 'maintenance' as const,
        title: e.maintenance_type || e.maintenanceType || 'Maintenance',
        description: e.provider || '',
        cost: e.cost
      }))
    }
  })

  // Charger les contrôles techniques
  const { data: controls = [] } = useQuery({
    queryKey: ['timeline-control', objectId],
    queryFn: async () => {
      const res = await api.get(`/objects/${objectId}/technical-controls`)
      return (res.data.data || res.data || []).map((e: any) => ({
        id: `ctrl-${e.id}`,
        date: e.control_date || e.controlDate,
        type: 'control' as const,
        title: `Contrôle technique${e.result ? ` - ${e.result}` : ''}`,
        description: e.center_name || e.centerName || '',
        cost: e.cost
      }))
    }
  })

  // Fusionner et trier par date
  const allEvents: TimelineEvent[] = [
    ...fuelEntries,
    ...maintenances,
    ...controls
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (allEvents.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 dark:text-gray-300">
        <Clock className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p>Aucun événement enregistré</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Ligne verticale */}
      <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

      <div className="space-y-4">
        {allEvents.map((event) => {
          const config = typeConfig[event.type]
          const Icon = config.icon

          return (
            <div key={event.id} className="relative flex gap-4 pl-3">
              {/* Point sur la timeline */}
              <div className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full ${config.color} flex-shrink-0`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>

              {/* Contenu */}
              <div className="flex-1 pb-4">
                <div className="bg-white dark:bg-gray-800 border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase">{config.label}</span>
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm">{event.title}</h4>
                      {event.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{event.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600 dark:text-gray-300">{formatDate(event.date)}</p>
                      {event.cost != null && event.cost > 0 && (
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{formatCurrency(event.cost)}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
