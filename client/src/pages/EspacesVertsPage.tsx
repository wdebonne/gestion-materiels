import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TreePine, Plus, Search, MapPin, Trash2, Edit3,
  FileText, X,
  Download, Image, Tag, Ruler, CloudSun,
  Landmark, Move, ZoomIn, ZoomOut, Maximize2, Minimize2, GripVertical, Layers, ChevronDown, ChevronRight, Pentagon
} from 'lucide-react'
import api from '@/lib/api'
import { formatDate } from '@/lib/utils'
import ImageUpload from '@/components/ui/ImageUpload'

/** Normalise un chemin d'image : évite le doublon /uploads//uploads/... */
function getImageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/uploads/')) return path
  if (path.startsWith('/')) return path
  return `/uploads/${path}`
}

// ======================== TYPES ========================

interface GreenSpace {
  id: number
  name: string
  description: string
  address: string
  latitude: number | null
  longitude: number | null
  area_m2: number
  space_type: string
  soil_type: string
  status: string
  image: string
  plan_image: string
  custom_fields: string
  element_count?: number
  created_at: string
  elements?: GreenSpaceElement[]
  annotations?: Annotation[]
  seasons?: Season[]
  documents?: GreenSpaceDocument[]
  groups?: CompositionGroup[]
}

interface GreenSpaceElement {
  id: number
  green_space_id: number
  object_id: number | null
  label: string
  code: string
  element_type: string
  description: string
  image: string
  pos_x: number | null
  pos_y: number | null
  quantity: number
  purchase_price: number | null
  maintenance_notes: string
  species: string
  planting_date: string | null
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  condition_state: string
  custom_fields: string
  object_name?: string
  object_image?: string
  category_name?: string
  subcategory_name?: string
  reference?: string
  group_id?: number | null
  area_m2?: number | null
  zone_points?: string | null
}

interface Annotation {
  id: number
  green_space_id: number
  element_id: number | null
  pos_x: number
  pos_y: number
  label: string
  icon: string
  color: string
}

interface Season {
  id: number
  season: string
  year: number
  notes: string
  actions_done: string
  actions_planned: string
  photos: string
}

interface GreenSpaceDocument {
  id: number
  name: string
  doc_type: string
  file_path: string
  expiry_date: string | null
  notes: string
  created_at: string
}

interface CompositionGroup {
  id: number
  green_space_id: number
  name: string
  group_type: string
  description: string
  color: string
  icon: string
  pos_x: number | null
  pos_y: number | null
  area_m2?: number | null
  zone_points?: string | null
}

// ======================== CONSTANTES ========================

const SPACE_TYPES = [
  { value: 'parc', label: 'Parc', icon: '🌳' },
  { value: 'jardin', label: 'Jardin public', icon: '🌺' },
  { value: 'square', label: 'Square', icon: '🏛️' },
  { value: 'aire_jeux', label: 'Aire de jeux', icon: '🎠' },
  { value: 'espace_naturel', label: 'Espace naturel', icon: '🌿' },
  { value: 'rond_point', label: 'Rond-point', icon: '🔄' },
  { value: 'allee', label: 'Allée / Promenade', icon: '🚶' },
  { value: 'berge', label: 'Berge / Bord de rivière', icon: '🌊' },
  { value: 'cimetiere', label: 'Cimetière végétalisé', icon: '⚱️' },
  { value: 'terrain_sport', label: 'Terrain de sport', icon: '⚽' },
  { value: 'autre', label: 'Autre', icon: '📍' },
]

const ELEMENT_TYPES = [
  { value: 'arbre', label: 'Arbre', icon: '🌳', color: '#16a34a' },
  { value: 'arbuste', label: 'Arbuste', icon: '🌿', color: '#22c55e' },
  { value: 'fleur', label: 'Massif floral', icon: '🌺', color: '#ec4899' },
  { value: 'pelouse', label: 'Pelouse', icon: '🟢', color: '#86efac' },
  { value: 'haie', label: 'Haie', icon: '🌲', color: '#15803d' },
  { value: 'mobilier_urbain', label: 'Mobilier urbain', icon: '🪑', color: '#78716c' },
  { value: 'banc', label: 'Banc', icon: '🪑', color: '#a16207' },
  { value: 'poubelle', label: 'Poubelle / Corbeille', icon: '🗑️', color: '#6b7280' },
  { value: 'bac_fleurs', label: 'Bac à fleurs', icon: '🌷', color: '#f472b6' },
  { value: 'eclairage', label: 'Éclairage', icon: '💡', color: '#eab308' },
  { value: 'fontaine', label: 'Fontaine / Bassin', icon: '⛲', color: '#3b82f6' },
  { value: 'cloture', label: 'Clôture / Barrière', icon: '🚧', color: '#d97706' },
  { value: 'jeux', label: 'Jeux enfants', icon: '🎠', color: '#8b5cf6' },
  { value: 'allee', label: 'Allée / Chemin', icon: '🛤️', color: '#a3a3a3' },
  { value: 'panneau', label: 'Panneau / Signalétique', icon: '🪧', color: '#0ea5e9' },
  { value: 'arrosage', label: 'Système d\'arrosage', icon: '💧', color: '#06b6d4' },
  { value: 'statue', label: 'Statue / Œuvre d\'art', icon: '🗿', color: '#737373' },
  { value: 'autre', label: 'Autre', icon: '📌', color: '#6b7280' },
]

const CONDITION_STATES = [
  { value: 'neuf', label: 'Neuf', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  { value: 'bon', label: 'Bon état', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  { value: 'moyen', label: 'Moyen', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  { value: 'mauvais', label: 'Mauvais', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  { value: 'remplacer', label: 'À remplacer', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
]

const SEASONS_LIST = [
  { value: 'printemps', label: 'Printemps', icon: '🌸', color: 'bg-pink-50 border-pink-200 dark:bg-pink-950 dark:border-pink-800' },
  { value: 'ete', label: 'Été', icon: '☀️', color: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800' },
  { value: 'automne', label: 'Automne', icon: '🍂', color: 'bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800' },
  { value: 'hiver', label: 'Hiver', icon: '❄️', color: 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800' },
]

const DOC_TYPES = [
  { value: 'plan', label: 'Plan / Cadastre' },
  { value: 'permis', label: 'Permis / Autorisation' },
  { value: 'diagnostic', label: 'Diagnostic phytosanitaire' },
  { value: 'conformite', label: 'Certificat de conformité' },
  { value: 'securite', label: 'Rapport de sécurité' },
  { value: 'accessibilite', label: 'Accessibilité PMR' },
  { value: 'contrat', label: 'Contrat d\'entretien' },
  { value: 'facture', label: 'Facture' },
  { value: 'photo', label: 'Photo / Relevé' },
  { value: 'autre', label: 'Autre' },
]

const GROUP_TYPES = [
  { value: 'massif', label: 'Massif floral', icon: '🌺', color: '#ec4899' },
  { value: 'haie', label: 'Haie composée', icon: '🌲', color: '#15803d' },
  { value: 'bosquet', label: 'Bosquet', icon: '🌳', color: '#16a34a' },
  { value: 'rocaille', label: 'Rocaille', icon: '🪨', color: '#78716c' },
  { value: 'jardiniere', label: 'Jardinière', icon: '🌷', color: '#f472b6' },
  { value: 'plate_bande', label: 'Plate-bande', icon: '🌸', color: '#a855f7' },
  { value: 'mixed_border', label: 'Mixed-border', icon: '🌼', color: '#f59e0b' },
  { value: 'autre', label: 'Autre', icon: '📍', color: '#6b7280' },
]

// ======================== COMPOSANT PRINCIPAL ========================

export default function EspacesVertsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedSpace, setSelectedSpace] = useState<GreenSpace | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingSpace, setEditingSpace] = useState<GreenSpace | null>(null)
  const [activeTab, setActiveTab] = useState<'elements' | 'plan' | 'saisons' | 'documents' | 'carte'>('elements')
  const [expanded, setExpanded] = useState(false)

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['green-spaces-stats'],
    queryFn: () => api.get('/green-spaces/stats').then(r => r.data.data)
  })

  // Liste des espaces verts
  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ['green-spaces', search, typeFilter],
    queryFn: () => api.get('/green-spaces', { params: { search: search || undefined, space_type: typeFilter || undefined } }).then(r => r.data.data)
  })

  // Détail de l'espace sélectionné
  const { data: spaceDetail } = useQuery({
    queryKey: ['green-space', selectedSpace?.id],
    queryFn: () => api.get(`/green-spaces/${selectedSpace!.id}`).then(r => r.data.data),
    enabled: !!selectedSpace
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-spaces'] })
      queryClient.invalidateQueries({ queryKey: ['green-spaces-stats'] })
      setSelectedSpace(null)
    }
  })

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TreePine className="h-7 w-7 text-green-600" />
            Espaces Verts
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Gestion des espaces verts, parcs et aménagements urbains
          </p>
        </div>
        <button
          onClick={() => { setEditingSpace(null); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nouvel espace vert
        </button>
      </div>

      {/* Statistiques */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                <TreePine className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Espaces verts</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg">
                <Tag className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalElements}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Éléments référencés</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-100 dark:bg-teal-900 rounded-lg">
                <Ruler className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats.totalSuperficie >= 10000
                    ? `${(stats.totalSuperficie / 10000).toFixed(1)} ha`
                    : `${stats.totalSuperficie.toLocaleString()} m²`}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Superficie totale</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barre de recherche et filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un espace vert..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">Tous les types</option>
          {SPACE_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
          ))}
        </select>
      </div>

      {/* Contenu principal */}
      <div className={`grid gap-6 ${expanded ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
        {/* Liste (gauche) */}
        {!expanded && (
        <div className="lg:col-span-1 space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-8 w-8 border-2 border-green-600 border-t-transparent rounded-full" />
            </div>
          ) : spaces.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <TreePine className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Aucun espace vert trouvé</p>
            </div>
          ) : (
            spaces.map((space: GreenSpace) => {
              const typeInfo = SPACE_TYPES.find(t => t.value === space.space_type)
              const isSelected = selectedSpace?.id === space.id
              return (
                <div
                  key={space.id}
                  onClick={() => setSelectedSpace(space)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-green-50 border-green-300 dark:bg-green-950 dark:border-green-700 ring-2 ring-green-500'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {space.image ? (
                      <img src={getImageUrl(space.image)} alt="" className="w-14 h-14 rounded-lg object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center text-2xl">
                        {typeInfo?.icon || '🌳'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">{space.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {typeInfo?.label || space.space_type} • {space.area_m2 > 0 ? `${space.area_m2.toLocaleString()} m²` : 'Superficie N/A'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          space.status === 'actif' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                          space.status === 'en_travaux' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                          'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {space.status === 'actif' ? 'Actif' : space.status === 'en_travaux' ? 'En travaux' : space.status}
                        </span>
                        {(space.element_count ?? 0) > 0 && (
                          <span className="text-xs text-gray-400">{space.element_count} élém.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        )}

        {/* Détail (droite) */}
        <div className={expanded ? '' : 'lg:col-span-2'}>
          {!selectedSpace ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
              <TreePine className="h-16 w-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Sélectionnez un espace vert pour voir ses détails</p>
            </div>
          ) : spaceDetail ? (
            <SpaceDetailView
              space={spaceDetail}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onEdit={() => { setEditingSpace(spaceDetail); setShowForm(true) }}
              onDelete={() => {
                if (confirm('Supprimer cet espace vert et tous ses éléments ?')) {
                  deleteMutation.mutate(spaceDetail.id)
                }
              }}
              queryClient={queryClient}
              expanded={expanded}
              onToggleExpand={() => setExpanded(e => !e)}
            />
          ) : (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-8 w-8 border-2 border-green-600 border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* Modal formulaire */}
      {showForm && (
        <SpaceFormModal
          space={editingSpace}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            queryClient.invalidateQueries({ queryKey: ['green-spaces'] })
            queryClient.invalidateQueries({ queryKey: ['green-spaces-stats'] })
            if (editingSpace) {
              queryClient.invalidateQueries({ queryKey: ['green-space', editingSpace.id] })
            }
          }}
        />
      )}
    </div>
  )
}

// ======================== VUE DÉTAIL ========================

function SpaceDetailView({ space, activeTab, setActiveTab, onEdit, onDelete, queryClient, expanded, onToggleExpand }: {
  space: GreenSpace
  activeTab: string
  setActiveTab: (tab: any) => void
  onEdit: () => void
  onDelete: () => void
  queryClient: any
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  const typeInfo = SPACE_TYPES.find(t => t.value === space.space_type)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="relative">
        {space.image ? (
          <img src={getImageUrl(space.image)} alt="" className="w-full h-48 object-cover" />
        ) : (
          <div className="w-full h-32 bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center">
            <span className="text-6xl">{typeInfo?.icon || '🌳'}</span>
          </div>
        )}
        <div className="absolute top-3 right-3 flex gap-2">
          {onToggleExpand && (
            <button onClick={onToggleExpand} className="p-2 bg-white/90 dark:bg-gray-800/90 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-colors" title={expanded ? 'Réduire' : 'Agrandir'}>
              {expanded ? <Minimize2 className="h-4 w-4 text-gray-600 dark:text-gray-300" /> : <Maximize2 className="h-4 w-4 text-gray-600 dark:text-gray-300" />}
            </button>
          )}
          <button onClick={onEdit} className="p-2 bg-white/90 dark:bg-gray-800/90 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-colors">
            <Edit3 className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
          <button onClick={onDelete} className="p-2 bg-white/90 dark:bg-gray-800/90 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/50 transition-colors">
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      </div>

      {/* Infos générales */}
      <div className="p-5 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{space.name}</h2>
        {space.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{space.description}</p>
        )}
        <div className="flex flex-wrap gap-3 mt-3 text-sm">
          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <MapPin className="h-4 w-4" /> {space.address || 'Adresse non renseignée'}
          </span>
          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <Ruler className="h-4 w-4" /> {space.area_m2 > 0 ? `${space.area_m2.toLocaleString()} m²` : 'N/A'}
          </span>
          {space.soil_type && (
            <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
              <Landmark className="h-4 w-4" /> Sol : {space.soil_type}
            </span>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex overflow-x-auto">
          {[
            { key: 'elements', label: 'Éléments', icon: Tag, count: space.elements?.length },
            { key: 'plan', label: 'Plan annoté', icon: Move },
            { key: 'carte', label: 'Carte', icon: MapPin },
            { key: 'saisons', label: 'Saisons', icon: CloudSun, count: space.seasons?.length },
            { key: 'documents', label: 'Documents', icon: FileText, count: space.documents?.length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-600 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Contenu des onglets */}
      <div className="p-5">
        {activeTab === 'elements' && (
          <ElementsTab space={space} queryClient={queryClient} />
        )}
        {activeTab === 'plan' && (
          <PlanAnnotationTab space={space} queryClient={queryClient} />
        )}
        {activeTab === 'carte' && (
          <MapTab space={space} />
        )}
        {activeTab === 'saisons' && (
          <SeasonsTab space={space} queryClient={queryClient} />
        )}
        {activeTab === 'documents' && (
          <DocumentsTab space={space} queryClient={queryClient} />
        )}
      </div>
    </div>
  )
}

// ======================== ONGLET ÉLÉMENTS ========================

function ElementsTab({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const [showForm, setShowForm] = useState(false)
  const [editingElement, setEditingElement] = useState<GreenSpaceElement | null>(null)
  const [searchElements, setSearchElements] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const elements = (space.elements || []).filter(el => {
    const matchSearch = !searchElements ||
      el.label.toLowerCase().includes(searchElements.toLowerCase()) ||
      el.code.toLowerCase().includes(searchElements.toLowerCase()) ||
      (el.object_name || '').toLowerCase().includes(searchElements.toLowerCase())
    const matchType = !typeFilter || el.element_type === typeFilter
    return matchSearch && matchType
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/elements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      queryClient.invalidateQueries({ queryKey: ['green-spaces-stats'] })
    }
  })

  // Group by type
  const grouped = elements.reduce((acc: Record<string, GreenSpaceElement[]>, el) => {
    const type = el.element_type || 'autre'
    if (!acc[type]) acc[type] = []
    acc[type].push(el)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher un élément..."
              value={searchElements}
              onChange={(e) => setSearchElements(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">Tous les types</option>
            {ELEMENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { setEditingElement(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {elements.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Tag className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun élément dans cet espace vert</p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, items]) => {
          const typeInfo = ELEMENT_TYPES.find(t => t.value === type)
          return (
            <div key={type}>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <span>{typeInfo?.icon || '📌'}</span>
                {typeInfo?.label || type} ({items.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map(el => (
                  <div key={el.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:border-green-300 dark:hover:border-green-700 transition-colors">
                    <div className="flex items-start gap-3">
                      {el.image || el.object_image ? (
                        <img src={getImageUrl(el.image || el.object_image)} alt="" className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl" style={{ backgroundColor: (typeInfo?.color || '#6b7280') + '20' }}>
                          {typeInfo?.icon || '📌'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{el.label}</span>
                          {el.code && (
                            <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs font-mono text-gray-600 dark:text-gray-300">
                              {el.code}
                            </span>
                          )}
                        </div>
                        {el.species && <p className="text-xs text-gray-500 dark:text-gray-400 italic">{el.species}</p>}
                        {el.object_name && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            ↳ {el.category_name}{el.subcategory_name ? ` > ${el.subcategory_name}` : ''} • {el.object_name}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {el.condition_state && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${CONDITION_STATES.find(c => c.value === el.condition_state)?.color || ''}`}>
                              {CONDITION_STATES.find(c => c.value === el.condition_state)?.label || el.condition_state}
                            </span>
                          )}
                          {el.quantity > 1 && <span className="text-xs text-gray-400">×{el.quantity}</span>}
                          {el.purchase_price && <span className="text-xs text-gray-400">{el.purchase_price}€</span>}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingElement(el); setShowForm(true) }} className="p-1 text-gray-400 hover:text-green-600">
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Supprimer cet élément ?')) deleteMutation.mutate(el.id) }}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}

      {/* Groupes de composition */}
      <GroupsSection space={space} queryClient={queryClient} />

      {/* Modal d'ajout/édition d'élément */}
      {showForm && (
        <ElementFormModal
          spaceId={space.id}
          element={editingElement}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
            queryClient.invalidateQueries({ queryKey: ['green-spaces-stats'] })
          }}
        />
      )}
    </div>
  )
}

// ======================== GROUPES DE COMPOSITION ========================

function GroupsSection({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState<CompositionGroup | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [assigningGroup, setAssigningGroup] = useState<CompositionGroup | null>(null)
  const [selectedElementIds, setSelectedElementIds] = useState<number[]>([])

  // Form state
  const [gName, setGName] = useState('')
  const [gType, setGType] = useState('massif')
  const [gDesc, setGDesc] = useState('')
  const [gColor, setGColor] = useState('#ec4899')
  const [gArea, setGArea] = useState('')

  const groups = space.groups || []
  const elements = space.elements || []

  const createGroupMutation = useMutation({
    mutationFn: (data: any) => api.post(`/green-spaces/${space.id}/groups`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      resetForm()
    }
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => api.put(`/green-spaces/groups/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      resetForm()
    }
  })

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
  })

  const assignElementsMutation = useMutation({
    mutationFn: ({ groupId, element_ids }: { groupId: number; element_ids: number[] }) =>
      api.put(`/green-spaces/groups/${groupId}/elements`, { element_ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setAssigningGroup(null)
    }
  })

  const resetForm = () => {
    setShowGroupForm(false)
    setEditingGroup(null)
    setGName('')
    setGType('massif')
    setGDesc('')
    setGColor('#ec4899')
    setGArea('')
  }

  const openEditForm = (g: CompositionGroup) => {
    setEditingGroup(g)
    setGName(g.name)
    setGType(g.group_type)
    setGDesc(g.description || '')
    setGColor(g.color || '#ec4899')
    setGArea(g.area_m2?.toString() || '')
    setShowGroupForm(true)
  }

  const openAssign = (g: CompositionGroup) => {
    setAssigningGroup(g)
    setSelectedElementIds(elements.filter(el => el.group_id === g.id).map(el => el.id))
  }

  const handleSaveGroup = () => {
    const data = { name: gName, group_type: gType, description: gDesc, color: gColor, icon: GROUP_TYPES.find(t => t.value === gType)?.icon || 'layers', area_m2: gArea ? parseFloat(gArea) : null }
    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, ...data, pos_x: editingGroup.pos_x, pos_y: editingGroup.pos_y })
    } else {
      createGroupMutation.mutate(data)
    }
  }

  const toggleExpanded = (id: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleElement = (eid: number) => {
    setSelectedElementIds(prev => prev.includes(eid) ? prev.filter(x => x !== eid) : [...prev, eid])
  }

  if (groups.length === 0 && !showGroupForm) {
    return (
      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Layers className="h-4 w-4" /> Groupes de composition
          </h4>
          <button
            onClick={() => { resetForm(); setShowGroupForm(true) }}
            className="flex items-center gap-1 text-xs px-2 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            <Plus className="h-3 w-3" /> Nouveau groupe
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Créez des groupes pour composer vos massifs, haies, bosquets... et les placer sur le plan.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Layers className="h-4 w-4" /> Groupes de composition ({groups.length})
        </h4>
        <button
          onClick={() => { resetForm(); setShowGroupForm(true) }}
          className="flex items-center gap-1 text-xs px-2 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          <Plus className="h-3 w-3" /> Nouveau groupe
        </button>
      </div>

      {groups.map(g => {
        const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
        const groupElements = elements.filter(el => el.group_id === g.id)
        const isExpanded = expandedGroups.has(g.id)
        return (
          <div key={g.id} className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            <div
              className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => toggleExpanded(g.id)}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: g.color || typeInfo?.color }} />
              <span className="text-sm">{typeInfo?.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">{g.name}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {typeInfo?.label} • {groupElements.length} élément{groupElements.length > 1 ? 's' : ''}
                  {g.area_m2 ? ` • ${g.area_m2} m²` : ''}
                  {g.pos_x != null ? ' • 📍 Placé' : ''}
                </span>
              </div>
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                <button onClick={() => openAssign(g)} className="p-1 text-gray-400 hover:text-purple-600" title="Gérer les éléments">
                  <Tag className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => openEditForm(g)} className="p-1 text-gray-400 hover:text-green-600" title="Modifier">
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => { if (confirm('Supprimer ce groupe ?')) deleteGroupMutation.mutate(g.id) }} className="p-1 text-gray-400 hover:text-red-600" title="Supprimer">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="p-3 space-y-1 border-t border-gray-200 dark:border-gray-600">
                {g.description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{g.description}</p>}
                {groupElements.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun élément dans ce groupe. Cliquez sur <Tag className="h-3 w-3 inline" /> pour en assigner.</p>
                ) : (
                  groupElements.map(el => {
                    const elType = ELEMENT_TYPES.find(t => t.value === el.element_type)
                    return (
                      <div key={el.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-gray-800 text-sm">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: elType?.color }} />
                        <span className="text-gray-900 dark:text-white truncate">{el.label}</span>
                        {el.species && <span className="text-xs text-gray-400 italic truncate">{el.species}</span>}
                        {el.code && <span className="text-xs font-mono text-gray-400">{el.code}</span>}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Modal formulaire groupe */}
      {showGroupForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => resetForm()}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 w-96 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Layers className="h-5 w-5 text-purple-600" />
              {editingGroup ? 'Modifier le groupe' : 'Nouveau groupe'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nom *</label>
                <input
                  type="text"
                  value={gName}
                  onChange={e => setGName(e.target.value)}
                  placeholder="Ex: Massif central, Haie nord..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <select
                    value={gType}
                    onChange={e => { setGType(e.target.value); setGColor(GROUP_TYPES.find(t => t.value === e.target.value)?.color || '#8b5cf6') }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {GROUP_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Couleur</label>
                  <input
                    type="color"
                    value={gColor}
                    onChange={e => setGColor(e.target.value)}
                    className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={gDesc}
                  onChange={e => setGDesc(e.target.value)}
                  rows={2}
                  placeholder="Composition, période de floraison..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Superficie (m²)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={gArea}
                  onChange={e => setGArea(e.target.value)}
                  placeholder="ex: 150"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm} className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                Annuler
              </button>
              <button
                onClick={handleSaveGroup}
                disabled={!gName.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {editingGroup ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal assignation éléments */}
      {assigningGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAssigningGroup(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 w-96 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: assigningGroup.color }} />
                Éléments de « {assigningGroup.name} »
              </h3>
              <p className="text-xs text-gray-500 mt-1">Cochez les éléments à inclure dans ce groupe.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {elements.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Aucun élément dans cet espace vert.</p>
              ) : (
                elements.map(el => {
                  const elType = ELEMENT_TYPES.find(t => t.value === el.element_type)
                  const isChecked = selectedElementIds.includes(el.id)
                  const inOtherGroup = el.group_id && el.group_id !== assigningGroup.id
                  const otherGroupName = inOtherGroup ? groups.find(g => g.id === el.group_id)?.name : null
                  return (
                    <label
                      key={el.id}
                      className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                        isChecked ? 'bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleElement(el.id)}
                        className="rounded text-purple-600"
                      />
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: elType?.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">{el.label}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {elType?.label}{el.species ? ` • ${el.species}` : ''}
                          {otherGroupName ? ` (dans: ${otherGroupName})` : ''}
                        </p>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setAssigningGroup(null)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                Annuler
              </button>
              <button
                onClick={() => assignElementsMutation.mutate({ groupId: assigningGroup.id, element_ids: selectedElementIds })}
                disabled={assignElementsMutation.isPending}
                className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Enregistrer ({selectedElementIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ======================== ONGLET PLAN ANNOTÉ ========================

function PlanAnnotationTab({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [addingAnnotation, setAddingAnnotation] = useState(false)
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null)
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null)
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null)
  const [freeLabel, setFreeLabel] = useState('')
  const [dragging, setDragging] = useState<{ type: 'element' | 'annotation' | 'group'; id: number } | null>(null)

  // Zone drawing state
  const [drawingZone, setDrawingZone] = useState<{ type: 'element' | 'group'; id: number } | null>(null)
  const [zonePoints, setZonePoints] = useState<{ x: number; y: number }[]>([])

  const annotations = space.annotations || []
  const elements = space.elements || []
  const groups = space.groups || []
  const unplacedElements = elements.filter(el => el.pos_x == null || el.pos_y == null)
  const unplacedGroups = groups.filter(g => g.pos_x == null || g.pos_y == null)

  const addAnnotationMutation = useMutation({
    mutationFn: (data: any) => api.post(`/green-spaces/${space.id}/annotations`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setAddingAnnotation(false)
      setClickPos(null)
      setFreeLabel('')
    }
  })

  const updateElementPosMutation = useMutation({
    mutationFn: ({ elementId, pos_x, pos_y }: { elementId: number; pos_x: number; pos_y: number }) =>
      api.put(`/green-spaces/elements/${elementId}`, { pos_x, pos_y }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setAddingAnnotation(false)
      setClickPos(null)
    }
  })

  const updateAnnotationPosMutation = useMutation({
    mutationFn: ({ annotationId, pos_x, pos_y, label, icon, color }: { annotationId: number; pos_x: number; pos_y: number; label: string; icon: string; color: string }) =>
      api.put(`/green-spaces/annotations/${annotationId}`, { pos_x, pos_y, label, icon, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setDragging(null)
    }
  })

  const updateGroupPosMutation = useMutation({
    mutationFn: ({ groupId, pos_x, pos_y }: { groupId: number; pos_x: number; pos_y: number }) => {
      const g = groups.find(gr => gr.id === groupId)
      return api.put(`/green-spaces/groups/${groupId}`, {
        name: g?.name, group_type: g?.group_type, description: g?.description, color: g?.color, icon: g?.icon, pos_x, pos_y
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setAddingAnnotation(false)
      setClickPos(null)
      setDragging(null)
    }
  })

  const saveElementZoneMutation = useMutation({
    mutationFn: ({ elementId, zone_points }: { elementId: number; zone_points: { x: number; y: number }[] }) =>
      api.put(`/green-spaces/elements/${elementId}`, { zone_points }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setDrawingZone(null)
      setZonePoints([])
    }
  })

  const saveGroupZoneMutation = useMutation({
    mutationFn: ({ groupId, zone_points }: { groupId: number; zone_points: { x: number; y: number }[] }) => {
      const g = groups.find(gr => gr.id === groupId)
      return api.put(`/green-spaces/groups/${groupId}`, {
        name: g?.name, group_type: g?.group_type, description: g?.description, color: g?.color, icon: g?.icon,
        pos_x: g?.pos_x, pos_y: g?.pos_y, zone_points
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setDrawingZone(null)
      setZonePoints([])
    }
  })

  const deleteAnnotationMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/annotations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setSelectedAnnotation(null)
    }
  })

  const handlePlanClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width * 100) / zoom
    const y = ((e.clientY - rect.top) / rect.height * 100) / zoom

    // Mode dessin de zone : ajout d'un point au polygone
    if (drawingZone) {
      setZonePoints(prev => [...prev, { x, y }])
      return
    }

    // Si on est en train de déplacer un repère
    if (dragging) {
      if (dragging.type === 'element') {
        updateElementPosMutation.mutate({ elementId: dragging.id, pos_x: x, pos_y: y })
      } else if (dragging.type === 'group') {
        updateGroupPosMutation.mutate({ groupId: dragging.id, pos_x: x, pos_y: y })
      } else {
        const ann = annotations.find(a => a.id === dragging.id)
        if (ann) {
          updateAnnotationPosMutation.mutate({ annotationId: ann.id, pos_x: x, pos_y: y, label: ann.label, icon: ann.icon, color: ann.color })
        }
      }
      return
    }

    if (!addingAnnotation) return
    setClickPos({ x, y })
    setFreeLabel('')
  }

  const handlePlaceElement = (el: GreenSpaceElement) => {
    if (!clickPos) return
    updateElementPosMutation.mutate({ elementId: el.id, pos_x: clickPos.x, pos_y: clickPos.y })
  }

  const handlePlaceGroup = (g: CompositionGroup) => {
    if (!clickPos) return
    updateGroupPosMutation.mutate({ groupId: g.id, pos_x: clickPos.x, pos_y: clickPos.y })
  }

  const handleAddFreeAnnotation = () => {
    if (!clickPos || !freeLabel.trim()) return
    addAnnotationMutation.mutate({ pos_x: clickPos.x, pos_y: clickPos.y, label: freeLabel.trim(), icon: 'circle', color: '#22c55e' })
  }

  const startDrawingZone = (type: 'element' | 'group', id: number) => {
    setDrawingZone({ type, id })
    setZonePoints([])
    setAddingAnnotation(false)
    setDragging(null)
    setClickPos(null)
  }

  const finishDrawingZone = () => {
    if (!drawingZone || zonePoints.length < 3) return
    if (drawingZone.type === 'element') {
      saveElementZoneMutation.mutate({ elementId: drawingZone.id, zone_points: zonePoints })
    } else {
      saveGroupZoneMutation.mutate({ groupId: drawingZone.id, zone_points: zonePoints })
    }
  }

  const cancelDrawingZone = () => {
    setDrawingZone(null)
    setZonePoints([])
  }

  const removeLastZonePoint = () => {
    setZonePoints(prev => prev.slice(0, -1))
  }

  /** Parse zone_points from JSON string */
  const parseZonePoints = (zp: string | null | undefined): { x: number; y: number }[] => {
    if (!zp) return []
    try {
      const parsed = typeof zp === 'string' ? JSON.parse(zp) : zp
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }

  const clearZone = (type: 'element' | 'group', id: number) => {
    if (type === 'element') {
      saveElementZoneMutation.mutate({ elementId: id, zone_points: [] })
    } else {
      saveGroupZoneMutation.mutate({ groupId: id, zone_points: [] })
    }
  }

  if (!space.plan_image) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <Image className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Aucun plan n'a été chargé pour cet espace vert.</p>
        <p className="text-sm mt-2">Ajoutez une image de plan dans les paramètres de l'espace vert pour pouvoir annoter les emplacements.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Barre de dessin de zone en cours */}
      {drawingZone && (
        <div className="flex items-center justify-between p-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg">
          <p className="text-sm text-purple-700 dark:text-purple-300 flex items-center gap-2">
            <Pentagon className="h-4 w-4" />
            Dessin de zone : {zonePoints.length} point{zonePoints.length > 1 ? 's' : ''} — Cliquez pour ajouter des points (min. 3)
          </p>
          <div className="flex items-center gap-2">
            {zonePoints.length > 0 && (
              <button
                onClick={removeLastZonePoint}
                className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200"
              >
                Annuler dernier
              </button>
            )}
            <button
              onClick={finishDrawingZone}
              disabled={zonePoints.length < 3}
              className="text-sm px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              Valider ({zonePoints.length}/3+)
            </button>
            <button
              onClick={cancelDrawingZone}
              className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200 flex items-center gap-1"
            >
              <X className="h-4 w-4" /> Annuler
            </button>
          </div>
        </div>
      )}

      {/* Barre de déplacement en cours */}
      {dragging && (
        <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
          <p className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <Move className="h-4 w-4" />
            Cliquez sur le plan pour déplacer le repère
          </p>
          <button
            onClick={() => setDragging(null)}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center gap-1"
          >
            <X className="h-4 w-4" /> Annuler
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
            className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-500">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(3, z + 0.25))}
            className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs px-2"
          >
            Reset
          </button>
        </div>
        <button
          onClick={() => { setAddingAnnotation(!addingAnnotation); setDragging(null) }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            addingAnnotation
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <MapPin className="h-4 w-4" />
          {addingAnnotation ? 'Cliquez sur le plan...' : 'Ajouter un repère'}
        </button>
      </div>

      {/* Plan avec annotations */}
      <div className="relative overflow-auto border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-100 dark:bg-gray-900" style={{ maxHeight: '600px' }}>
        <div
          ref={canvasRef}
          className={`relative ${addingAnnotation || dragging || drawingZone ? 'cursor-crosshair' : 'cursor-default'}`}
          onClick={handlePlanClick}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.2s' }}
        >
          <img src={getImageUrl(space.plan_image)} alt="Plan" className="w-full" />

          {/* SVG overlay pour les zones (polygones) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            {/* Zones des éléments */}
            {elements.filter(el => el.zone_points).map(el => {
              const pts = parseZonePoints(el.zone_points)
              if (pts.length < 3) return null
              const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
              const color = typeInfo?.color || '#22c55e'
              const pointsStr = pts.map(p => `${p.x}%,${p.y}%`).join(' ')
              return (
                <polygon
                  key={`zone-el-${el.id}`}
                  points={pointsStr}
                  fill={color}
                  fillOpacity={0.25}
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.7}
                  strokeLinejoin="round"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setHoveredElementId(el.id) }}
                >
                  <title>{el.label}{el.area_m2 ? ` (${el.area_m2} m²)` : ''}</title>
                </polygon>
              )
            })}
            {/* Zones des groupes */}
            {groups.filter(g => g.zone_points).map(g => {
              const pts = parseZonePoints(g.zone_points)
              if (pts.length < 3) return null
              const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
              const color = g.color || typeInfo?.color || '#8b5cf6'
              const pointsStr = pts.map(p => `${p.x}%,${p.y}%`).join(' ')
              return (
                <polygon
                  key={`zone-grp-${g.id}`}
                  points={pointsStr}
                  fill={color}
                  fillOpacity={0.2}
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.8}
                  strokeLinejoin="round"
                  strokeDasharray="6 3"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>{g.name}{g.area_m2 ? ` (${g.area_m2} m²)` : ''}</title>
                </polygon>
              )
            })}
            {/* Zone en cours de dessin */}
            {drawingZone && zonePoints.length > 0 && (
              <>
                {zonePoints.length >= 3 && (
                  <polygon
                    points={zonePoints.map(p => `${p.x}%,${p.y}%`).join(' ')}
                    fill="#8b5cf6"
                    fillOpacity={0.15}
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    strokeLinejoin="round"
                  />
                )}
                {zonePoints.length >= 2 && zonePoints.length < 3 && (
                  <polyline
                    points={zonePoints.map(p => `${p.x}%,${p.y}%`).join(' ')}
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    strokeLinejoin="round"
                  />
                )}
                {zonePoints.map((pt, i) => (
                  <circle
                    key={i}
                    cx={`${pt.x}%`}
                    cy={`${pt.y}%`}
                    r={4}
                    fill="#8b5cf6"
                    stroke="white"
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
          </svg>

          {/* Annotations des éléments positionnés */}
          {elements.filter(el => el.pos_x != null && el.pos_y != null).map(el => {
            const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
            const isHovered = hoveredElementId === el.id
            const isDraggingThis = dragging?.type === 'element' && dragging.id === el.id
            return (
              <div
                key={`el-${el.id}`}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 group ${isDraggingThis ? 'opacity-50' : ''}`}
                style={{ left: `${el.pos_x}%`, top: `${el.pos_y}%` }}
                onMouseEnter={() => setHoveredElementId(el.id)}
                onMouseLeave={() => setHoveredElementId(null)}
              >
                <div
                  className={`w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xs cursor-pointer transition-transform ${isHovered ? 'scale-150' : ''}`}
                  style={{ backgroundColor: typeInfo?.color || '#22c55e' }}
                  title={`${el.code || el.label}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-white text-[8px] font-bold">{el.code ? el.code.substring(0, 2) : ''}</span>
                </div>
                {isHovered && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-2 z-50 whitespace-nowrap">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">{el.label}</p>
                    {el.code && <p className="text-xs text-gray-500 font-mono">{el.code}</p>}
                    {el.species && <p className="text-xs text-green-600 italic">{el.species}</p>}
                    <p className="text-xs text-gray-400">{typeInfo?.label} • {CONDITION_STATES.find(c => c.value === el.condition_state)?.label}</p>
                    {el.area_m2 && <p className="text-xs text-gray-400">{el.area_m2} m²</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDragging({ type: 'element', id: el.id }) }}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        <GripVertical className="h-3 w-3" /> Déplacer
                      </button>
                      {parseZonePoints(el.zone_points).length > 0 ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearZone('element', el.id) }}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                        >
                          <X className="h-3 w-3" /> Zone
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); startDrawingZone('element', el.id) }}
                          className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400"
                        >
                          <Pentagon className="h-3 w-3" /> Zone
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Annotations manuelles */}
          {annotations.map(ann => {
            const isDraggingThis = dragging?.type === 'annotation' && dragging.id === ann.id
            return (
              <div
                key={`ann-${ann.id}`}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group ${isDraggingThis ? 'opacity-50' : ''}`}
                style={{ left: `${ann.pos_x}%`, top: `${ann.pos_y}%` }}
                onClick={(e) => { e.stopPropagation(); setSelectedAnnotation(ann) }}
              >
                <div
                  className="w-5 h-5 rounded-full border-2 border-white shadow-md flex items-center justify-center"
                  style={{ backgroundColor: ann.color }}
                >
                  <MapPin className="h-3 w-3 text-white" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white rounded px-2 py-0.5 text-xs whitespace-nowrap">
                  {ann.label}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDragging({ type: 'annotation', id: ann.id }) }}
                    className="ml-2 inline-flex items-center text-blue-300 hover:text-blue-100"
                    title="Déplacer"
                  >
                    <GripVertical className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Groupes de composition positionnés */}
          {groups.filter(g => g.pos_x != null && g.pos_y != null).map(g => {
            const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
            const groupElements = elements.filter(el => el.group_id === g.id)
            const isDraggingThis = dragging?.type === 'group' && dragging.id === g.id
            return (
              <div
                key={`grp-${g.id}`}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 group ${isDraggingThis ? 'opacity-50' : ''}`}
                style={{ left: `${g.pos_x}%`, top: `${g.pos_y}%` }}
              >
                <div
                  className="w-8 h-8 rounded-lg border-2 border-white shadow-lg flex items-center justify-center text-sm cursor-pointer hover:scale-125 transition-transform"
                  style={{ backgroundColor: g.color || typeInfo?.color || '#8b5cf6' }}
                  title={g.name}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Layers className="h-4 w-4 text-white" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-2 z-50 whitespace-nowrap min-w-[120px]">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{g.name}</p>
                  <p className="text-xs text-gray-500">{typeInfo?.label} • {groupElements.length} élém.</p>
                  {g.area_m2 && <p className="text-xs text-gray-400">{g.area_m2} m²</p>}
                  {groupElements.slice(0, 4).map(el => (
                    <p key={el.id} className="text-xs text-gray-400 truncate">• {el.label}</p>
                  ))}
                  {groupElements.length > 4 && <p className="text-xs text-gray-400">+ {groupElements.length - 4} autres</p>}
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDragging({ type: 'group', id: g.id }) }}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                    >
                      <GripVertical className="h-3 w-3" /> Déplacer
                    </button>
                    {parseZonePoints(g.zone_points).length > 0 ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); clearZone('group', g.id) }}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                      >
                        <X className="h-3 w-3" /> Zone
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); startDrawingZone('group', g.id) }}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400"
                      >
                        <Pentagon className="h-3 w-3" /> Zone
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {clickPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setClickPos(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 w-80 max-h-[28rem] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <MapPin className="h-4 w-4 text-green-600" />
                Placer sur le plan
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Position : {clickPos.x.toFixed(1)}%, {clickPos.y.toFixed(1)}%
              </p>
            </div>

            {unplacedGroups.length > 0 && (
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 px-1 mb-1 flex items-center gap-1"><Layers className="h-3 w-3" /> Groupes</p>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {unplacedGroups.map(g => {
                    const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
                    const cnt = elements.filter(el => el.group_id === g.id).length
                    return (
                      <button
                        key={g.id}
                        onClick={() => handlePlaceGroup(g)}
                        disabled={updateGroupPosMutation.isPending}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/30 text-left transition-colors"
                      >
                        <span className="w-3 h-3 rounded flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: g.color || typeInfo?.color }}>
                          <Layers className="h-2 w-2 text-white" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-white truncate">{g.name}</p>
                          <p className="text-xs text-gray-500 truncate">{typeInfo?.label} • {cnt} élém.</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {unplacedElements.length > 0 && (
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 px-1 mb-1">Éléments liés</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {unplacedElements.map(el => {
                    const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
                    return (
                      <button
                        key={el.id}
                        onClick={() => handlePlaceElement(el)}
                        disabled={updateElementPosMutation.isPending}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left transition-colors"
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: typeInfo?.color || '#22c55e' }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-white truncate">{el.label}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {el.code && <span className="font-mono mr-1">{el.code}</span>}
                            {typeInfo?.label}{el.species ? ` • ${el.species}` : ''}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="p-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 px-1 mb-1">Annotation libre</p>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={freeLabel}
                  onChange={e => setFreeLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddFreeAnnotation()}
                  placeholder="Libellé..."
                  className="flex-1 text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  autoFocus
                />
                <button
                  onClick={handleAddFreeAnnotation}
                  disabled={!freeLabel.trim() || addAnnotationMutation.isPending}
                  className="px-2 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  OK
                </button>
              </div>
            </div>

            <div className="p-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setClickPos(null)}
                className="w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-1"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Détail annotation sélectionnée */}
      {selectedAnnotation && (
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedAnnotation.label}</p>
            <p className="text-xs text-gray-500">Position : {selectedAnnotation.pos_x.toFixed(1)}%, {selectedAnnotation.pos_y.toFixed(1)}%</p>
          </div>
          <button
            onClick={() => deleteAnnotationMutation.mutate(selectedAnnotation.id)}
            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Légende */}
      <div className="flex flex-wrap gap-2 text-xs">
        {ELEMENT_TYPES.filter(t => elements.some(el => el.element_type === t.value && el.pos_x != null)).map(t => (
          <span key={t.value} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
            {t.label}
          </span>
        ))}
        {groups.filter(g => g.pos_x != null).map(g => {
          const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
          return (
            <span key={`grp-${g.id}`} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
              <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: g.color || typeInfo?.color }} />
              {g.name}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ======================== ONGLET CARTE (Google Maps) ========================

function MapTab({ space }: { space: GreenSpace }) {
  const hasCoords = space.latitude && space.longitude

  if (!hasCoords) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <MapPin className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Aucune coordonnée GPS renseignée.</p>
        <p className="text-sm mt-2">Modifiez l'espace vert pour ajouter latitude et longitude.</p>
      </div>
    )
  }

  const lat = space.latitude!
  const lng = space.longitude!
  const query = encodeURIComponent(space.address || `${lat},${lng}`)

  return (
    <div className="space-y-4">
      {/* Vue carte */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📍 Localisation sur la carte</h4>
        <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          <iframe
            title="Google Maps"
            width="100%"
            height="350"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${query}&zoom=17&maptype=satellite`}
          />
        </div>
      </div>

      {/* Vue Street View */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">🚶 Street View</h4>
        <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          <iframe
            title="Google Street View"
            width="100%"
            height="350"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.google.com/maps/embed/v1/streetview?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&location=${lat},${lng}&heading=0&pitch=0&fov=90`}
          />
        </div>
      </div>

      <div className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Coordonnées : {lat}, {lng}
        {space.address && ` • ${space.address}`}
      </div>
    </div>
  )
}

// ======================== ONGLET SAISONS ========================

function SeasonsTab({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ season: 'printemps', year: new Date().getFullYear(), notes: '', actions_done: '', actions_planned: '' })

  const addMutation = useMutation({
    mutationFn: (data: any) => api.post(`/green-spaces/${space.id}/seasons`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setShowForm(false)
      setForm({ season: 'printemps', year: new Date().getFullYear(), notes: '', actions_done: '', actions_planned: '' })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/seasons/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
  })

  const seasons = space.seasons || []

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Suivi saisonnier</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {/* Formulaire d'ajout */}
      {showForm && (
        <div className="p-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Saison</label>
              <select
                value={form.season}
                onChange={(e) => setForm({ ...form, season: e.target.value })}
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {SEASONS_LIST.map(s => (
                  <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Année</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: parseInt(e.target.value) })}
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Actions réalisées</label>
            <textarea
              value={form.actions_done}
              onChange={(e) => setForm({ ...form, actions_done: e.target.value })}
              placeholder="Taille des haies, tonte, plantation..."
              rows={2}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Actions planifiées</label>
            <textarea
              value={form.actions_planned}
              onChange={(e) => setForm({ ...form, actions_planned: e.target.value })}
              placeholder="Élagage prévu, remplacement de plants..."
              rows={2}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              Annuler
            </button>
            <button
              onClick={() => addMutation.mutate(form)}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Liste des saisons */}
      {seasons.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <CloudSun className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun suivi saisonnier</p>
        </div>
      ) : (
        <div className="space-y-3">
          {seasons.map((s: Season) => {
            const seasonInfo = SEASONS_LIST.find(sl => sl.value === s.season)
            return (
              <div key={s.id} className={`p-4 rounded-lg border ${seasonInfo?.color || 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'}`}>
                <div className="flex justify-between items-start">
                  <h5 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <span>{seasonInfo?.icon}</span>
                    {seasonInfo?.label || s.season} {s.year}
                  </h5>
                  <button
                    onClick={() => { if (confirm('Supprimer cette entrée ?')) deleteMutation.mutate(s.id) }}
                    className="p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {s.actions_done && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">✅ Réalisé :</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.actions_done}</p>
                  </div>
                )}
                {s.actions_planned && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400">📋 Planifié :</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.actions_planned}</p>
                  </div>
                )}
                {s.notes && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 italic">{s.notes}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ======================== ONGLET DOCUMENTS ========================

function DocumentsTab({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', doc_type: 'autre', file_path: '', expiry_date: '', notes: '' })

  const addMutation = useMutation({
    mutationFn: (data: any) => api.post(`/green-spaces/${space.id}/documents`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setShowForm(false)
      setForm({ name: '', doc_type: 'autre', file_path: '', expiry_date: '', notes: '' })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/green-spaces/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
  })

  const documents = space.documents || []

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Documents & obligations légales
        </h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {showForm && (
        <div className="p-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nom du document *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={form.doc_type}
                onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {DOC_TYPES.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Fichier (chemin)</label>
              <input
                type="text"
                value={form.file_path}
                onChange={(e) => setForm({ ...form, file_path: e.target.value })}
                placeholder="ex: document.pdf"
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Date d'expiration</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400">Annuler</button>
            <button
              onClick={() => { if (form.name) addMutation.mutate(form) }}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun document</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc: GreenSpaceDocument) => {
            const docType = DOC_TYPES.find(d => d.value === doc.doc_type)
            const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date()
            const isExpiringSoon = doc.expiry_date && !isExpired && new Date(doc.expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            return (
              <div key={doc.id} className={`p-3 rounded-lg border ${
                isExpired ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30' :
                isExpiringSoon ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30' :
                'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <FileText className={`h-5 w-5 mt-0.5 ${isExpired ? 'text-red-500' : 'text-gray-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {docType?.label || doc.doc_type}
                        {doc.expiry_date && (
                          <span className={isExpired ? ' text-red-600 font-medium' : isExpiringSoon ? ' text-yellow-600 font-medium' : ''}>
                            {' '}• {isExpired ? 'Expiré le' : 'Expire le'} {formatDate(doc.expiry_date)}
                          </span>
                        )}
                      </p>
                      {doc.notes && <p className="text-xs text-gray-400 mt-1">{doc.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {doc.file_path && (
                      <a
                        href={getImageUrl(doc.file_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-gray-400 hover:text-blue-600"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => { if (confirm('Supprimer ce document ?')) deleteMutation.mutate(doc.id) }}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ======================== MODAL FORMULAIRE ESPACE VERT ========================

function SpaceFormModal({ space, onClose, onSaved }: { space: GreenSpace | null, onClose: () => void, onSaved: () => void }) {
  const [form, setForm] = useState({
    name: space?.name || '',
    description: space?.description || '',
    address: space?.address || '',
    latitude: space?.latitude?.toString() || '',
    longitude: space?.longitude?.toString() || '',
    area_m2: space?.area_m2?.toString() || '',
    space_type: space?.space_type || 'parc',
    soil_type: space?.soil_type || '',
    status: space?.status || 'actif',
    image: space?.image || '',
    plan_image: space?.plan_image || '',
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      space ? api.put(`/green-spaces/${space.id}`, data) : api.post('/green-spaces', data),
    onSuccess: () => onSaved()
  })

  const handleSubmit = () => {
    if (!form.name.trim()) return
    mutation.mutate({
      ...form,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      area_m2: form.area_m2 ? parseFloat(form.area_m2) : 0,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {space ? 'Modifier l\'espace vert' : 'Nouvel espace vert'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nom *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={form.space_type}
                onChange={(e) => setForm({ ...form, space_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {SPACE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Statut</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="actif">Actif</option>
                <option value="en_travaux">En travaux</option>
                <option value="ferme">Fermé au public</option>
                <option value="projet">En projet</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Adresse</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Latitude</label>
              <input
                type="text"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                placeholder="ex: 48.8566"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Longitude</label>
              <input
                type="text"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                placeholder="ex: 2.3522"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Superficie (m²)</label>
              <input
                type="number"
                value={form.area_m2}
                onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type de sol</label>
              <input
                type="text"
                value={form.soil_type}
                onChange={(e) => setForm({ ...form, soil_type: e.target.value })}
                placeholder="Terre végétale, gravier, béton..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <ImageUpload
                label="Image principale"
                value={form.image}
                onChange={(url) => setForm({ ...form, image: url })}
              />
            </div>
            <div>
              <ImageUpload
                label="Image du plan"
                value={form.plan_image}
                onChange={(url) => setForm({ ...form, plan_image: url })}
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim() || mutation.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Enregistrement...' : (space ? 'Modifier' : 'Créer')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ======================== MODAL FORMULAIRE ÉLÉMENT ========================

function ElementFormModal({ spaceId, element, onClose, onSaved }: {
  spaceId: number, element: GreenSpaceElement | null, onClose: () => void, onSaved: () => void
}) {
  const [form, setForm] = useState({
    label: element?.label || '',
    code: element?.code || '',
    element_type: element?.element_type || 'arbre',
    description: element?.description || '',
    image: element?.image || '',
    pos_x: element?.pos_x?.toString() || '',
    pos_y: element?.pos_y?.toString() || '',
    quantity: element?.quantity?.toString() || '1',
    purchase_price: element?.purchase_price?.toString() || '',
    maintenance_notes: element?.maintenance_notes || '',
    species: element?.species || '',
    planting_date: element?.planting_date || '',
    last_maintenance_date: element?.last_maintenance_date || '',
    next_maintenance_date: element?.next_maintenance_date || '',
    condition_state: element?.condition_state || 'bon',
    object_id: element?.object_id?.toString() || '',
    area_m2: element?.area_m2?.toString() || '',
  })
  const [objectSearch, setObjectSearch] = useState('')
  const [showObjectResults, setShowObjectResults] = useState(false)

  const { data: objectResults = [] } = useQuery({
    queryKey: ['green-space-search-objects', objectSearch],
    queryFn: () => api.get('/green-spaces/search/objects', { params: { q: objectSearch } }).then(r => r.data.data),
    enabled: objectSearch.length >= 2
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      element
        ? api.put(`/green-spaces/elements/${element.id}`, data)
        : api.post(`/green-spaces/${spaceId}/elements`, data),
    onSuccess: () => onSaved()
  })

  const handleSubmit = () => {
    if (!form.label.trim()) return
    mutation.mutate({
      ...form,
      pos_x: form.pos_x ? parseFloat(form.pos_x) : null,
      pos_y: form.pos_y ? parseFloat(form.pos_y) : null,
      quantity: parseInt(form.quantity) || 1,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      object_id: form.object_id ? parseInt(form.object_id) : null,
      area_m2: form.area_m2 ? parseFloat(form.area_m2) : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {element ? 'Modifier l\'élément' : 'Ajouter un élément'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Libellé *</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="ex: Chêne centenaire, Banc n°3..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Code / Identifiant</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="ex: A-001, B-012..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={form.element_type}
                onChange={(e) => setForm({ ...form, element_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {ELEMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">État</label>
              <select
                value={form.condition_state}
                onChange={(e) => setForm({ ...form, condition_state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {CONDITION_STATES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Lier un objet du parc */}
            <div className="col-span-2 relative">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lier un objet du parc (optionnel)</label>
              <input
                type="text"
                value={objectSearch}
                onChange={(e) => { setObjectSearch(e.target.value); setShowObjectResults(true) }}
                onFocus={() => setShowObjectResults(true)}
                placeholder="Rechercher un objet par nom ou référence..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              {showObjectResults && objectResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {objectResults.map((obj: any) => (
                    <button
                      key={obj.id}
                      onClick={() => {
                        // Pré-remplir les champs depuis l'objet lié
                        const customFields = obj.custom_fields ? (typeof obj.custom_fields === 'string' ? JSON.parse(obj.custom_fields) : obj.custom_fields) : {}
                        const updates: any = { object_id: obj.id.toString() }
                        if (obj.image && !form.image) updates.image = obj.image
                        if (obj.purchase_price && !form.purchase_price) updates.purchase_price = obj.purchase_price.toString()
                        if (obj.description && !form.description) updates.description = obj.description
                        if (obj.purchase_date && !form.planting_date) updates.planting_date = obj.purchase_date
                        // Mapper le statut de l'objet vers l'état de l'élément
                        if (obj.status && form.condition_state === 'bon') {
                          const statusMap: Record<string, string> = { active: 'bon', good: 'bon', warning: 'moyen', poor: 'mauvais', broken: 'mauvais', inactive: 'mauvais' }
                          if (statusMap[obj.status]) updates.condition_state = statusMap[obj.status]
                        }
                        // Remplir depuis les champs personnalisés
                        if (customFields.espece && !form.species) updates.species = customFields.espece
                        if (customFields.variete && !form.species) updates.species = customFields.variete
                        if (customFields.species && !form.species) updates.species = customFields.species
                        if (customFields['espece_variete'] && !form.species) updates.species = customFields['espece_variete']
                        if (customFields.type && form.element_type === 'arbre') {
                          const typeMap: Record<string, string> = { arbre: 'arbre', arbuste: 'arbuste', haie: 'haie', fleur: 'fleur', pelouse: 'pelouse', mobilier: 'mobilier', eclairage: 'eclairage', cloture: 'cloture' }
                          if (typeMap[customFields.type.toLowerCase()]) updates.element_type = typeMap[customFields.type.toLowerCase()]
                        }
                        if (!form.label) updates.label = obj.name
                        if (obj.reference && !form.code) updates.code = obj.reference
                        setForm({ ...form, ...updates })
                        setObjectSearch(`${obj.name} (${obj.reference || 'N/A'})`)
                        setShowObjectResults(false)
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-sm"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{obj.name}</span>
                      <span className="text-gray-500 dark:text-gray-400 ml-2">{obj.category_name}{obj.subcategory_name ? ` > ${obj.subcategory_name}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.object_id && (
                <button
                  onClick={() => { setForm({ ...form, object_id: '' }); setObjectSearch('') }}
                  className="absolute right-2 top-8 text-gray-400 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Espèce / Variété</label>
              <input
                type="text"
                value={form.species}
                onChange={(e) => setForm({ ...form, species: e.target.value })}
                placeholder="ex: Quercus robur, Tulipa gesneriana..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantité</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Superficie (m²)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.area_m2}
                onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
                placeholder="ex: 25.5"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prix d'achat (€)</label>
              <input
                type="number"
                step="0.01"
                value={form.purchase_price}
                onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date de plantation</label>
              <input
                type="date"
                value={form.planting_date}
                onChange={(e) => setForm({ ...form, planting_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dernier entretien</label>
              <input
                type="date"
                value={form.last_maintenance_date}
                onChange={(e) => setForm({ ...form, last_maintenance_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prochain entretien</label>
              <input
                type="date"
                value={form.next_maintenance_date}
                onChange={(e) => setForm({ ...form, next_maintenance_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <ImageUpload
                label="Image"
                value={form.image}
                onChange={(url) => setForm({ ...form, image: url })}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Position sur le plan (X%, Y%)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={form.pos_x}
                  onChange={(e) => setForm({ ...form, pos_x: e.target.value })}
                  placeholder="X (%)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <input
                  type="number"
                  step="0.1"
                  value={form.pos_y}
                  onChange={(e) => setForm({ ...form, pos_y: e.target.value })}
                  placeholder="Y (%)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes d'entretien</label>
              <textarea
                value={form.maintenance_notes}
                onChange={(e) => setForm({ ...form, maintenance_notes: e.target.value })}
                placeholder="Arrosage hebdomadaire, taille annuelle..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.label.trim() || mutation.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Enregistrement...' : (element ? 'Modifier' : 'Ajouter')}
          </button>
        </div>
      </div>
    </div>
  )
}
