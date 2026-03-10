import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TreePine, Plus, Search, MapPin, Trash2, Edit3,
  FileText, X,
  Download, Image, Tag, Ruler, CloudSun,
  Landmark, Move, ZoomIn, ZoomOut
} from 'lucide-react'
import api from '@/lib/api'
import { formatDate } from '@/lib/utils'

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

// ======================== COMPOSANT PRINCIPAL ========================

export default function EspacesVertsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedSpace, setSelectedSpace] = useState<GreenSpace | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingSpace, setEditingSpace] = useState<GreenSpace | null>(null)
  const [activeTab, setActiveTab] = useState<'elements' | 'plan' | 'saisons' | 'documents' | 'carte'>('elements')

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Liste (gauche) */}
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
                      <img src={`/uploads/${space.image}`} alt="" className="w-14 h-14 rounded-lg object-cover" />
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

        {/* Détail (droite) */}
        <div className="lg:col-span-2">
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

function SpaceDetailView({ space, activeTab, setActiveTab, onEdit, onDelete, queryClient }: {
  space: GreenSpace
  activeTab: string
  setActiveTab: (tab: any) => void
  onEdit: () => void
  onDelete: () => void
  queryClient: any
}) {
  const typeInfo = SPACE_TYPES.find(t => t.value === space.space_type)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="relative">
        {space.image ? (
          <img src={`/uploads/${space.image}`} alt="" className="w-full h-48 object-cover" />
        ) : (
          <div className="w-full h-32 bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center">
            <span className="text-6xl">{typeInfo?.icon || '🌳'}</span>
          </div>
        )}
        <div className="absolute top-3 right-3 flex gap-2">
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
                        <img src={`/uploads/${el.image || el.object_image}`} alt="" className="w-12 h-12 rounded-lg object-cover" />
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

// ======================== ONGLET PLAN ANNOTÉ ========================

function PlanAnnotationTab({ space, queryClient }: { space: GreenSpace, queryClient: any }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [addingAnnotation, setAddingAnnotation] = useState(false)
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null)
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null)

  const annotations = space.annotations || []
  const elements = space.elements || []

  const addAnnotationMutation = useMutation({
    mutationFn: (data: any) => api.post(`/green-spaces/${space.id}/annotations`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['green-space', space.id] })
      setAddingAnnotation(false)
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
    if (!addingAnnotation || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width * 100) / zoom
    const y = ((e.clientY - rect.top) / rect.height * 100) / zoom

    const label = prompt('Libellé de l\'annotation :')
    if (!label) return

    addAnnotationMutation.mutate({ pos_x: x, pos_y: y, label, icon: 'circle', color: '#22c55e' })
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
          onClick={() => setAddingAnnotation(!addingAnnotation)}
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
          className={`relative ${addingAnnotation ? 'cursor-crosshair' : 'cursor-default'}`}
          onClick={handlePlanClick}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.2s' }}
        >
          <img src={`/uploads/${space.plan_image}`} alt="Plan" className="w-full" />

          {/* Annotations des éléments positionnés */}
          {elements.filter(el => el.pos_x != null && el.pos_y != null).map(el => {
            const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
            const isHovered = hoveredElementId === el.id
            return (
              <div
                key={`el-${el.id}`}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                style={{ left: `${el.pos_x}%`, top: `${el.pos_y}%` }}
                onMouseEnter={() => setHoveredElementId(el.id)}
                onMouseLeave={() => setHoveredElementId(null)}
              >
                <div
                  className={`w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xs cursor-pointer transition-transform ${isHovered ? 'scale-150' : ''}`}
                  style={{ backgroundColor: typeInfo?.color || '#22c55e' }}
                  title={`${el.code || el.label}`}
                >
                  <span className="text-white text-[8px] font-bold">{el.code ? el.code.substring(0, 2) : ''}</span>
                </div>
                {isHovered && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-2 z-50 whitespace-nowrap">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">{el.label}</p>
                    {el.code && <p className="text-xs text-gray-500 font-mono">{el.code}</p>}
                    {el.species && <p className="text-xs text-green-600 italic">{el.species}</p>}
                    <p className="text-xs text-gray-400">{typeInfo?.label} • {CONDITION_STATES.find(c => c.value === el.condition_state)?.label}</p>
                  </div>
                )}
              </div>
            )
          })}

          {/* Annotations manuelles */}
          {annotations.map(ann => (
            <div
              key={`ann-${ann.id}`}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
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
              </div>
            </div>
          ))}
        </div>
      </div>

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
                        href={`/uploads/${doc.file_path}`}
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image principale</label>
              <input
                type="text"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="nom-du-fichier.jpg"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image du plan</label>
              <input
                type="text"
                value={form.plan_image}
                onChange={(e) => setForm({ ...form, plan_image: e.target.value })}
                placeholder="plan-espace.jpg"
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
                        setForm({ ...form, object_id: obj.id.toString() })
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image</label>
              <input
                type="text"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="nom-fichier.jpg"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
