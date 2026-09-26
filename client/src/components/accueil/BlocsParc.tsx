import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  Calendar as CalendarIcon,
  ClipboardCheck,
  Clock,
  Euro,
  Fuel,
  LayoutGrid,
  Package,
  Wrench,
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, ImageCard, LoadingInline, StatCard } from '@/components/ui'
import api from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { LienEntete } from './briques'

/**
 * Les blocs du parc matériel : chiffres, catégories, alertes, calendrier,
 * activité, véhicules.
 *
 * Chacun lit ses propres données : un bloc masqué ne coûte plus de requête.
 * `Chiffres du parc` et `Véhicules` partagent la clé `dashboard-stats`, donc un
 * seul appel quand les deux sont affichés.
 */

function useStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data,
  })
}

export function BlocParc() {
  const { data: stats } = useStats()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard title="Catégories" value={stats?.categoriesCount || 0} icon={<LayoutGrid className="w-6 h-6" />} color="blue" />
      <StatCard title="Matériels" value={stats?.objectsCount || 0} icon={<Package className="w-6 h-6" />} color="green" />
      <StatCard
        title="Valeur du parc"
        value={`${Number(stats?.totalValue || 0).toLocaleString('fr-FR')} €`}
        icon={<Euro className="w-6 h-6" />}
        color="emerald"
      />
      <StatCard title="Alertes actives" value={stats?.activeAlertsCount || 0} icon={<AlertTriangle className="w-6 h-6" />} color="yellow" />
      <StatCard title="Événements ce mois" value={stats?.eventsThisMonth || 0} icon={<CalendarIcon className="w-6 h-6" />} color="purple" />
    </div>
  )
}

export function BlocCategories() {
  const navigate = useNavigate()
  const { data: categories, isLoading } = useQuery({
    // Même clé que les autres listes complètes : découper ici, et non dans le
    // cache, sinon les pages qui attendent toutes les catégories n'en reçoivent
    // que quatre.
    queryKey: ['categories', 'simple'],
    queryFn: async () => (await api.get('/categories')).data.categories || [],
  })

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Catégories</CardTitle>
        <LienEntete vers="/categories">Voir tout →</LienEntete>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <LoadingInline />
        ) : categories?.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">Aucune catégorie créée</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {categories?.slice(0, 4).map((category: any) => (
              <ImageCard
                key={category.id}
                title={category.name}
                image={category.image}
                icon={<LayoutGrid className="w-full h-full" />}
                count={category.objectCount}
                onClick={() => navigate(`/categories/${category.slug}`)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Où mène une alerte. Une échéance de bâtiment n'a pas de matériel : sans ce
 * lien, la ligne restait muette, sans nom ni destination.
 */
function lienAlerte(alert: any): string | null {
  if (alert.pluginReference === 'green-space-maintenance') return '/espaces-verts'
  if (alert.pluginReference === 'batiment-suivi') return `/batiments?suivi=${alert.pluginReferenceId}`
  if (alert.pluginReference === 'batiment-contrat') return `/batiments?contrat=${alert.pluginReferenceId}`
  if (alert.objectId) return `/objects/${alert.objectId}`
  return null
}

export function BlocAlertes() {
  const navigate = useNavigate()
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['alerts', { limit: 5 }],
    queryFn: async () => (await api.get('/alerts?limit=5&status=active')).data.alerts,
  })

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Alertes récentes</CardTitle>
        <LienEntete vers="/alerts">Voir tout →</LienEntete>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="p-4"><LoadingInline /></div>
        ) : alerts?.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">Aucune alerte active</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {alerts?.map((alert: any) => {
              const lien = lienAlerte(alert)
              return (
                <div
                  key={alert.id}
                  className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors${lien ? ' cursor-pointer' : ''}`}
                  onClick={lien ? () => navigate(lien) : undefined}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      alert.type === 'technical_control' ? 'bg-blue-100 text-blue-600' :
                      alert.type === 'maintenance' ? 'bg-orange-100 text-orange-600' :
                      alert.type === 'fuel' ? 'bg-green-100 text-green-600' :
                      alert.type === 'batiment' ? 'bg-purple-100 text-purple-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {alert.type === 'technical_control' ? <ClipboardCheck className="w-4 h-4" /> :
                       alert.type === 'maintenance' ? <Wrench className="w-4 h-4" /> :
                       alert.type === 'fuel' ? <Fuel className="w-4 h-4" /> :
                       alert.type === 'batiment' ? <Building2 className="w-4 h-4" /> :
                       <AlertTriangle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{alert.title}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {alert.objectName || alert.batiments?.map((b: any) => b.nom).join(', ')}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{formatDate(alert.dueDate)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function BlocEvenements() {
  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar-upcoming'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const response = await api.get(`/calendar?startDate=${today}&endDate=${nextWeek}`)
      return response.data.events?.slice(0, 5) || []
    },
  })

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Événements à venir</CardTitle>
        <LienEntete vers="/calendar">Voir calendrier →</LienEntete>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="p-4"><LoadingInline /></div>
        ) : events?.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">Aucun événement cette semaine</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {events?.map((event: any) => (
              <div key={event.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-3">
                <div className="flex-shrink-0 w-12 text-center">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{new Date(event.startDate).getDate()}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                    {new Date(event.startDate).toLocaleDateString('fr-FR', { month: 'short' })}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{event.title}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{event.description}</p>
                </div>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: event.color || '#3B82F6' }} />
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function BlocActivite() {
  const navigate = useNavigate()
  const { data: objets, isLoading } = useQuery({
    queryKey: ['recent-objects'],
    queryFn: async () => (await api.get('/objects?limit=5&sort=updatedAt')).data.objects || [],
  })

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Activité récente</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <div className="p-4"><LoadingInline /></div>
        ) : objets?.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">Aucune activité récente</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {objets?.map((obj: any) => (
              <div
                key={obj.id}
                className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer flex items-center gap-3"
                onClick={() => navigate(`/objects/${obj.id}`)}
              >
                <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                  {obj.image ? (
                    <img src={obj.image} alt={obj.name} className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <Package className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{obj.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{obj.categoryName}</p>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(obj.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function BlocVehicules() {
  const { data: stats } = useStats()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Véhicules et entretiens</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-900/30 rounded-xl">
            <div className="p-3 bg-green-100 dark:bg-green-900/40 rounded-lg">
              <Fuel className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-green-700 dark:text-green-300">Carburant ce mois</p>
              <p className="text-2xl font-bold text-green-900 dark:text-green-200">{Number(stats?.fuelThisMonth || 0).toFixed(0)} L</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
              <ClipboardCheck className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-blue-700 dark:text-blue-300">Contrôles à venir</p>
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-200">{stats?.upcomingControls || 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-orange-50 dark:bg-orange-900/30 rounded-xl">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Wrench className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-orange-700 dark:text-orange-300">Entretiens à prévoir</p>
              <p className="text-2xl font-bold text-orange-900 dark:text-orange-200">{stats?.upcomingMaintenance || 0}</p>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
