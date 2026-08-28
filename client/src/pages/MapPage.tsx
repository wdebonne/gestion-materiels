import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Layers } from 'lucide-react'
import { MapContainer, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import { Card, CardBody, LoadingInline } from '@/components/ui'
import api from '@/lib/api'
import { Link } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const statusColors: Record<string, string> = {
  active: '#22c55e',
  inactive: '#94a3b8',
  maintenance: '#f59e0b',
  out_of_service: '#ef4444'
}

export default function MapPage() {
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: objects = [], isLoading } = useQuery({
    queryKey: ['map-objects'],
    queryFn: async () => {
      const res = await api.get('/objects?limit=1000')
      return (res.data.data || res.data).filter((o: any) => o.location && o.location.trim())
    }
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-for-map'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return res.data.data || res.data
    }
  })

  const filtered = useMemo(() => {
    return objects.filter((o: any) => {
      if (categoryFilter && String(o.categoryId || o.category_id) !== categoryFilter) return false
      if (statusFilter && o.status !== statusFilter) return false
      return true
    })
  }, [objects, categoryFilter, statusFilter])

  // Pour la carte, on utilise des coordonnées par défaut (France)
  // Les objets avec localisation textuelle sont affichés dans une liste
  const defaultCenter: [number, number] = [49.38, 0.95] // Pavilly, Normandie
  const defaultZoom = 13

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <MapPin className="w-7 h-7 text-primary-600" />
            Cartographie
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Localisation des matériels</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="">Toutes les catégories</option>
          {categories.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="">Tous les statuts</option>
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
          <option value="maintenance">En maintenance</option>
          <option value="out_of_service">Hors service</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Carte */}
          <div className="lg:col-span-2">
            <Card>
              <CardBody className="p-0 overflow-hidden rounded-lg">
                <div style={{ height: '500px' }}>
                <MapContainer center={defaultCenter} zoom={defaultZoom} style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {/* Note: Pour positionner les marqueurs sur la carte, il faudrait géocoder les adresses.
                      Pour l'instant, la carte montre la zone par défaut et les matériels sont listés à côté. */}
                </MapContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Liste des matériels avec localisation */}
          <div>
            <Card>
              <CardBody>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Matériels localisés ({filtered.length})
                </h3>
                <div className="space-y-2 max-h-[440px] overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                      Aucun matériel avec localisation
                    </p>
                  ) : (
                    filtered.map((obj: any) => (
                      <Link
                        key={obj.id}
                        to={`/objects/${obj.id}`}
                        className="block p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-1 w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: statusColors[obj.status] || '#94a3b8' }} />
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{obj.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" />
                              {obj.location}
                            </p>
                            {obj.reference && <p className="text-xs text-gray-600 dark:text-gray-300">{obj.reference}</p>}
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Légende */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-500 dark:text-gray-400 font-medium">Légende :</span>
            {Object.entries({ 'Actif': '#22c55e', 'Inactif': '#94a3b8', 'Maintenance': '#f59e0b', 'Hors service': '#ef4444' }).map(([label, color]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-gray-600 dark:text-gray-300">{label}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
