import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { 
  LayoutGrid, 
  Package, 
  AlertTriangle, 
  Calendar as CalendarIcon,
  Fuel,
  Wrench,
  ClipboardCheck,
  Euro,
  Clock
} from 'lucide-react'
import { StatCard, Card, CardBody, CardHeader, CardTitle, ImageCard, LoadingInline, Alert } from '@/components/ui'
import api from '@/lib/api'
import { formatDate } from '@/lib/utils'

export default function DashboardPage() {
  const navigate = useNavigate()

  // Récupérer les statistiques
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const response = await api.get('/dashboard/stats')
      return response.data
    }
  })

  // Récupérer les alertes récentes
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', { limit: 5 }],
    queryFn: async () => {
      const response = await api.get('/alerts?limit=5&status=active')
      return response.data.alerts
    }
  })

  // Récupérer les événements à venir
  const { data: upcomingEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['calendar-upcoming'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const response = await api.get(`/calendar?startDate=${today}&endDate=${nextWeek}`)
      return response.data.events?.slice(0, 5) || []
    }
  })

  // Récupérer les catégories
  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await api.get('/categories')
      return response.data.categories?.slice(0, 4) || []
    }
  })

  // Récupérer les dernières activités
  const { data: recentObjects, isLoading: objectsLoading } = useQuery({
    queryKey: ['recent-objects'],
    queryFn: async () => {
      const response = await api.get('/objects?limit=5&sort=updatedAt')
      return response.data.objects || []
    }
  })

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        <p className="text-gray-500 mt-1">Vue d'ensemble de votre gestion de matériels</p>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Catégories"
          value={stats?.categoriesCount || 0}
          icon={<LayoutGrid className="w-6 h-6" />}
          color="blue"
        />
        <StatCard
          title="Matériels"
          value={stats?.objectsCount || 0}
          icon={<Package className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          title="Valeur du parc"
          value={`${(stats?.totalValue || 0).toLocaleString('fr-FR')} €`}
          icon={<Euro className="w-6 h-6" />}
          color="emerald"
        />
        <StatCard
          title="Alertes actives"
          value={stats?.activeAlertsCount || 0}
          icon={<AlertTriangle className="w-6 h-6" />}
          color="yellow"
        />
        <StatCard
          title="Événements ce mois"
          value={stats?.eventsThisMonth || 0}
          icon={<CalendarIcon className="w-6 h-6" />}
          color="purple"
        />
      </div>

      {/* Grille principale */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Catégories */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Catégories</CardTitle>
              <button 
                onClick={() => navigate('/categories')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Voir tout →
              </button>
            </CardHeader>
            <CardBody>
              {categoriesLoading ? (
                <LoadingInline />
              ) : categories?.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucune catégorie créée
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {categories?.map((category: any) => (
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
        </div>

        {/* Alertes */}
        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Alertes récentes</CardTitle>
              <button 
                onClick={() => navigate('/alerts')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Voir tout →
              </button>
            </CardHeader>
            <CardBody className="p-0">
              {alertsLoading ? (
                <div className="p-4"><LoadingInline /></div>
              ) : alerts?.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucune alerte active
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {alerts?.map((alert: any) => (
                    <div key={alert.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${
                          alert.type === 'technical_control' ? 'bg-blue-100 text-blue-600' :
                          alert.type === 'maintenance' ? 'bg-orange-100 text-orange-600' :
                          alert.type === 'fuel' ? 'bg-green-100 text-green-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {alert.type === 'technical_control' ? <ClipboardCheck className="w-4 h-4" /> :
                           alert.type === 'maintenance' ? <Wrench className="w-4 h-4" /> :
                           alert.type === 'fuel' ? <Fuel className="w-4 h-4" /> :
                           <AlertTriangle className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {alert.title}
                          </p>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {alert.objectName}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDate(alert.dueDate)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Deuxième ligne */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Événements à venir */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Événements à venir</CardTitle>
            <button 
              onClick={() => navigate('/calendar')}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Voir calendrier →
            </button>
          </CardHeader>
          <CardBody className="p-0">
            {eventsLoading ? (
              <div className="p-4"><LoadingInline /></div>
            ) : upcomingEvents?.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                Aucun événement cette semaine
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {upcomingEvents?.map((event: any) => (
                  <div key={event.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center gap-3">
                    <div className="flex-shrink-0 w-12 text-center">
                      <div className="text-2xl font-bold text-gray-900">
                        {new Date(event.startDate).getDate()}
                      </div>
                      <div className="text-xs text-gray-500 uppercase">
                        {new Date(event.startDate).toLocaleDateString('fr-FR', { month: 'short' })}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {event.title}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {event.description}
                      </p>
                    </div>
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: event.color || '#3B82F6' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Matériels récemment modifiés */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {objectsLoading ? (
              <div className="p-4"><LoadingInline /></div>
            ) : recentObjects?.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                Aucune activité récente
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentObjects?.map((obj: any) => (
                  <div 
                    key={obj.id} 
                    className="p-4 hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-3"
                    onClick={() => navigate(`/objects/${obj.id}`)}
                  >
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      {obj.image ? (
                        <img src={obj.image} alt={obj.name} className="w-full h-full object-cover rounded-lg" />
                      ) : (
                        <Package className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {obj.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {obj.categoryName}
                      </p>
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(obj.updatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Stats des plugins */}
      <Card>
        <CardHeader>
          <CardTitle>Statistiques des modules</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-4 p-4 bg-green-50 rounded-xl">
              <div className="p-3 bg-green-100 rounded-lg">
                <Fuel className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-green-700">Carburant ce mois</p>
                <p className="text-2xl font-bold text-green-900">
                  {stats?.fuelThisMonth?.toFixed(0) || 0} L
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl">
              <div className="p-3 bg-blue-100 rounded-lg">
                <ClipboardCheck className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-blue-700">Contrôles à venir</p>
                <p className="text-2xl font-bold text-blue-900">
                  {stats?.upcomingControls || 0}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-xl">
              <div className="p-3 bg-orange-100 rounded-lg">
                <Wrench className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-orange-700">Entretiens à prévoir</p>
                <p className="text-2xl font-bold text-orange-900">
                  {stats?.upcomingMaintenance || 0}
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
