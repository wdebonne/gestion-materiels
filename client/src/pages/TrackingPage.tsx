import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useFenetreModale } from '@/components/ui/useFenetreModale'
import {
  BarChart3, TrendingUp, TrendingDown, Calendar,
  Download, Fuel, Wrench, ClipboardCheck, ChevronDown, ChevronUp,
  X, Search, RefreshCw, ArrowRightLeft, FileText, Paperclip,
  Building, Building2, Car, FolderOpen, Settings2, Eye, EyeOff, Layers, TreePine, PartyPopper
} from 'lucide-react'
import {
  Card, CardBody, CardHeader, Button, Badge,
  LoadingInline, Alert, Input, Tabs, Tab
} from '@/components/ui'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart, PieChart, Pie, Cell
} from 'recharts'
import api from '@/lib/api'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import {
  CATEGORIES_BATIMENT, SOURCES_SUIVI, TOUTES_LES_SOURCES, jourFr, jourLocal,
  type DescriptionSource, type SourceSuivi
} from '@/lib/suiviCouts'
import TrackingPDFExport from '@/components/TrackingPDFExport'

interface FilterOption {
  id: number
  name: string
  image?: string
  categoryId?: number
  categoryName?: string
  subcategoryId?: number
  subcategoryName?: string
  reference?: string
}

interface TrackingFilters {
  startDate: string
  endDate: string
  categoryIds: number[]
  subcategoryIds: number[]
  objectIds: number[]
  siteIds: number[]
  dataTypes: SourceSuivi[]
  maintenanceTypes: string[]
  fuelTypes: string[]
  compareEnabled: boolean
  compareStartDate: string
  compareEndDate: string
  groupBy: 'month' | 'week' | 'year'
  compareMode: 'period' | 'yearly' | 'monthly'
  year1: number
  year2: number
  month1: number
  month2: number
}

// Mois en français (abréviations)
const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']

// Formateur intelligent pour les axes Y des graphiques
const formatAxisValue = (value: number): string => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M€`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k€`
  }
  return `${value}€`
}

// Fonction pour obtenir les dates par défaut (année en cours). En heure
// locale : `toISOString()` donnait la veille, passé minuit, en hiver.
const getDefaultDates = () => {
  const now = new Date()
  return {
    startDate: `${now.getFullYear()}-01-01`,
    endDate: jourLocal(now),
  }
}

// Fonction pour obtenir les dates de comparaison (année précédente). Le
// 29 février retombe sur le 28.
const unAnPlusTot = (jour: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return jour
  const [a, m, j] = jour.split('-').map(Number)
  const dernier = new Date(a - 1, m, 0).getDate()
  return `${a - 1}-${String(m).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`
}
const getComparisonDates = (startDate: string, endDate: string) => ({
  compareStartDate: unAnPlusTot(startDate),
  compareEndDate: unAnPlusTot(endDate),
})

// Composant pour afficher une carte de statistique
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color, 
  comparison,
  trend 
}: { 
  title: string
  value: string | number
  icon: React.ElementType
  color: string
  comparison?: string | number | null
  trend?: 'up' | 'down' | 'neutral'
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    lime: 'bg-lime-50 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
    stone: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    pink: 'bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-300',
  }

  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
            {comparison !== undefined && comparison !== null && (
              <div className="flex items-center gap-1 mt-2">
                {trend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-red-500" />
                ) : trend === 'down' ? (
                  <TrendingDown className="w-4 h-4 text-green-500" />
                ) : null}
                <span className={cn(
                  "text-sm font-medium",
                  trend === 'up' ? "text-red-600" : trend === 'down' ? "text-green-600" : "text-gray-500"
                )}>
                  {typeof comparison === 'number' 
                    ? `${comparison > 0 ? '+' : ''}${comparison.toFixed(1)}%` 
                    : comparison}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-300">vs période précédente</span>
              </div>
            )}
          </div>
          <div className={cn("p-3 rounded-lg", colorClasses[color])}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// Composant de filtre multi-sélection
function MultiSelectFilter({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  placeholder = "Sélectionner...",
  searchable = true,
  groupBy
}: {
  label: string
  icon: React.ElementType
  options: FilterOption[]
  selected: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  searchable?: boolean
  groupBy?: 'category'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filteredOptions = useMemo(() => {
    let result = options
    if (search) {
      const searchLower = search.toLowerCase()
      result = options.filter(o => 
        o.name.toLowerCase().includes(searchLower) ||
        o.reference?.toLowerCase().includes(searchLower) ||
        o.categoryName?.toLowerCase().includes(searchLower)
      )
    }
    return result
  }, [options, search])

  const groupedOptions = useMemo(() => {
    if (groupBy === 'category') {
      const groups: Record<string, FilterOption[]> = {}
      filteredOptions.forEach(o => {
        const key = o.categoryName || 'Sans catégorie'
        if (!groups[key]) groups[key] = []
        groups[key].push(o)
      })
      return groups
    }
    return { '': filteredOptions }
  }, [filteredOptions, groupBy])

  const selectedNames = options.filter(o => selected.includes(o.id)).map(o => o.name)

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        <Icon className="w-4 h-4 inline-block mr-1" />
        {label}
      </label>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 border rounded-lg text-left text-sm min-h-[44px]",
          selected.length > 0
            ? "border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/30"
            : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
        )}
      >
        <span className={selected.length > 0 ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}>
          {selected.length > 0 
            ? selected.length === 1 
              ? selectedNames[0] 
              : `${selected.length} sélectionné(s)`
            : placeholder
          }
        </span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-auto">
            {searchable && (
              <div className="p-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
                <Input
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<Search className="w-4 h-4" />}
                  className="!py-1.5"
                />
              </div>
            )}

            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(options.map(o => o.id))}
                className="text-xs text-primary-600 hover:text-primary-800"
              >
                Tout sélectionner
              </button>
              <span className="text-gray-600 dark:text-gray-300">|</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800"
              >
                Tout désélectionner
              </button>
            </div>

            <div className="py-1">
              {Object.entries(groupedOptions).map(([group, items]) => (
                <div key={group}>
                  {group && (
                    <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                      {group}
                    </div>
                  )}
                  {items.map(option => (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer min-h-[44px]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(option.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onChange([...selected, option.id])
                          } else {
                            onChange(selected.filter(id => id !== option.id))
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600"
                      />
                      {option.image && (
                        <img src={option.image} alt="" className="w-6 h-6 rounded object-cover" />
                      )}
                      <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{option.name}</span>
                      {option.reference && (
                        <span className="text-xs text-gray-600 dark:text-gray-300">{option.reference}</span>
                      )}
                    </label>
                  ))}
                </div>
              ))}
              {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                  Aucun résultat
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Composant de sélection des types de données : seules les sources ouvertes à
// ce compte se proposent — pas de bouton « Bâtiments » à qui ne les suit pas.
function DataTypeFilter({
  disponibles,
  selected,
  onChange
}: {
  disponibles: SourceSuivi[]
  selected: SourceSuivi[]
  onChange: (types: SourceSuivi[]) => void
}) {
  const types = SOURCES_SUIVI.filter(s => disponibles.includes(s.id))

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">
          Types de dépenses
        </span>
        {selected.length < types.length && (
          <button
            type="button"
            onClick={() => onChange(types.map(t => t.id))}
            className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Tout cocher
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {types.map(type => (
          <button
            key={type.id}
            type="button"
            aria-pressed={selected.includes(type.id)}
            onClick={() => {
              if (selected.includes(type.id)) {
                if (selected.length > 1) {
                  onChange(selected.filter(t => t !== type.id))
                }
              } else {
                onChange([...selected, type.id])
              }
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all min-h-[44px]",
              selected.includes(type.id)
                ? type.classesActif
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
            )}
          >
            <type.icone className="w-4 h-4" />
            {type.libelle}
          </button>
        ))}
      </div>
    </div>
  )
}

// Tooltip personnalisé pour les graphiques. Une série par période porte son
// libellé long (« Semaine 12 (16 – 22 mars 2026) ») : on le préfère au court.
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">{payload[0]?.payload?.labelLong || label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600 dark:text-gray-300">{entry.name}:</span>
            <span className="font-medium">{formatCurrency(entry.value)}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

// Tableau des données détaillées
function DataTable({
  data,
  type,
  onViewAttachments
}: {
  data: any[]
  type: 'fuel' | 'maintenance' | 'technical_control'
  onViewAttachments?: (attachments: any[]) => void
}) {
  const [sortKey, setSortKey] = useState<string>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      const direction = sortDirection === 'asc' ? 1 : -1
      
      if (typeof aVal === 'string') {
        return aVal.localeCompare(bVal) * direction
      }
      return ((aVal || 0) - (bVal || 0)) * direction
    })
  }, [data, sortKey, sortDirection])

  const paginatedData = sortedData.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.ceil(data.length / pageSize)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  const SortHeader = ({ label, keyName }: { label: string; keyName: string }) => (
    <th 
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
      onClick={() => handleSort(keyName)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === keyName && (
          sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        )}
      </div>
    </th>
  )

  if (type === 'fuel') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <SortHeader label="Date" keyName="date" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Objet</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <SortHeader label="Quantité" keyName="quantity" />
              <SortHeader label="Prix unit." keyName="unitPrice" />
              <SortHeader label="Total" keyName="totalPrice" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Station</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pièces</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {paginatedData.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {jourFr(item.date)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.objectImage && (
                      <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.objectName}</div>
                      {item.objectReference && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.objectReference}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.categoryName}</td>
                <td className="px-4 py-3">
                  <Badge variant="warning">{item.fuelType}</Badge>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{formatNumber(item.quantity)} L</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatCurrency(item.unitPrice)}/L</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(item.totalPrice)}</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.station || '-'}</td>
                <td className="px-4 py-3 text-center">
                  {item.attachments?.length > 0 && (
                    <button
                      onClick={() => onViewAttachments?.(item.attachments)}
                      className="p-1 text-gray-600 dark:text-gray-300 hover:text-primary-600 touch-target"
                      title={`${item.attachments.length} pièce(s) jointe(s)`}
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Affichage {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.length)} sur {data.length}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Précédent
              </Button>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                Suivant
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (type === 'maintenance') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <SortHeader label="Date" keyName="date" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Objet</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <SortHeader label="Coût" keyName="cost" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prestataire</th>
              <SortHeader label="Prochaine" keyName="nextDate" />
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pièces</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {paginatedData.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {jourFr(item.date)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.objectImage && (
                      <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.objectName}</div>
                      {item.objectReference && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.objectReference}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.categoryName}</td>
                <td className="px-4 py-3">
                  <Badge variant="info">{item.type}</Badge>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(item.cost)}</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.provider || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {jourFr(item.nextDate)}
                </td>
                <td className="px-4 py-3 text-center">
                  {item.attachments?.length > 0 && (
                    <button
                      onClick={() => onViewAttachments?.(item.attachments)}
                      className="p-1 text-gray-600 dark:text-gray-300 hover:text-primary-600 touch-target"
                      title={`${item.attachments.length} pièce(s) jointe(s)`}
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Affichage {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.length)} sur {data.length}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Précédent
              </Button>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                Suivant
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // technical_control
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-900/40">
          <tr>
            <SortHeader label="Date" keyName="date" />
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Objet</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Résultat</th>
            <SortHeader label="Coût" keyName="cost" />
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Centre</th>
            <SortHeader label="Expiration" keyName="expiryDate" />
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pièces</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {paginatedData.map((item: any) => (
            <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                {jourFr(item.date)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {item.objectImage && (
                    <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.objectName}</div>
                    {item.objectReference && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{item.objectReference}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.categoryName}</td>
              <td className="px-4 py-3">
                <Badge variant={item.result === 'Favorable' ? 'success' : 'warning'}>
                  {item.result || '-'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(item.cost)}</td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.centerName || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                {jourFr(item.expiryDate)}
              </td>
              <td className="px-4 py-3 text-center">
                {item.attachments?.length > 0 && (
                  <button
                    onClick={() => onViewAttachments?.(item.attachments)}
                    className="p-1 text-gray-600 dark:text-gray-300 hover:text-primary-600 touch-target"
                    title={`${item.attachments.length} pièce(s) jointe(s)`}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Affichage {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.length)} sur {data.length}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              Précédent
            </Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * « 2026 a coûté 23,3 % de moins que 2025 » : la première période comparée à
 * la seconde, qui sert de référence — le sens de l'écart que rend l'API.
 */
function phraseEcartAnnuel(yearlyData: any, filters: TrackingFilters): string {
  const mensuel = filters.compareMode === 'monthly'
  const premiere = mensuel ? `${MONTHS_SHORT[filters.month1 - 1]} ${filters.year1}` : `${filters.year1}`
  const seconde = mensuel ? `${MONTHS_SHORT[filters.month2 - 1]} ${filters.year2}` : `${filters.year2}`
  const ecart = yearlyData.difference.total
  const pourcentage = yearlyData.difference.percentage
  if (!ecart) return `${premiere} a coûté autant que ${seconde}`
  if (pourcentage === null || pourcentage === undefined) return `Rien n'a été dépensé en ${seconde} : pas de pourcentage`
  const valeur = Math.abs(pourcentage).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  return `${premiere} a coûté ${valeur} % de ${ecart > 0 ? 'plus' : 'moins'} que ${seconde}`
}

const STATUTS_MANIFESTATION: Record<string, string> = {
  pending: 'En attente',
  approbation: 'En approbation',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
}

/** Les lignes « source : montant » d'une carte de comparaison. */
function LignesParSource({
  sources,
  montant,
}: {
  sources: DescriptionSource[]
  montant: (s: DescriptionSource) => number
}) {
  return (
    <>
      {sources.map(s => (
        <div key={s.id} className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">{s.libelle}</span>
          <span className={cn('font-medium', s.classesTexte)}>{formatCurrency(montant(s) || 0)}</span>
        </div>
      ))}
    </>
  )
}

/** Ce que coûtent les bâtiments, un par un. */
function TableBatiments({ lignes, avecComparaison }: { lignes: any[]; avecComparaison: boolean }) {
  const somme = (cle: string) => lignes.reduce((t, b) => t + (b[cle] || 0), 0)
  const entete = 'px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <th className={cn(entete, 'text-left')}>Bâtiment</th>
              {CATEGORIES_BATIMENT.map(c => (
                <th key={c.id} className={cn(entete, 'text-right')}>{c.libelle}</th>
              ))}
              <th className={cn(entete, 'text-right')}>Total</th>
              <th className={cn(entete, 'text-right')}>€ / m²</th>
              {avecComparaison && <th className={cn(entete, 'text-right')}>Période comparée</th>}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {lignes.map((b: any) => (
              <tr key={b.siteId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm font-medium">
                  <Link to={`/batiments/${b.siteId}`} className="text-primary-600 dark:text-primary-400 hover:underline">
                    {b.name}
                  </Link>
                  {b.surfaceM2 ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">{formatNumber(b.surfaceM2, 0)} m²</div>
                  ) : null}
                </td>
                {CATEGORIES_BATIMENT.map(c => (
                  <td key={c.id} className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {b[c.id] ? formatCurrency(b[c.id]) : '-'}
                  </td>
                ))}
                <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {formatCurrency(b.totalCost)}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {b.costPerM2 !== null && b.costPerM2 !== undefined ? formatCurrency(b.costPerM2) : '-'}
                </td>
                {avecComparaison && (
                  <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {formatCurrency(b.compareCost || 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Total</td>
              {CATEGORIES_BATIMENT.map(c => (
                <td key={c.id} className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {formatCurrency(somme(c.id))}
                </td>
              ))}
              <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                {formatCurrency(somme('totalCost'))}
              </td>
              <td />
              {avecComparaison && (
                <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {formatCurrency(somme('compareCost'))}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Une facture d'énergie est répartie au jour sur la période qu'elle couvre ; un contrat compte au prorata de son
        montant annuel, partagé entre ses bâtiments. Le détail par fluide et les achats de matériel se trouvent dans
        Bâtiments › Coûts et statistiques.
      </p>
    </div>
  )
}

/** Ce que coûtent les manifestations de la période. */
function TableManifestations({ lignes }: { lignes: any[] }) {
  const entete = 'px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <th className={cn(entete, 'text-left')}>Manifestation</th>
              <th className={cn(entete, 'text-left')}>Date</th>
              <th className={cn(entete, 'text-left')}>Statut</th>
              <th className={cn(entete, 'text-right')}>Prestations</th>
              <th className={cn(entete, 'text-right')}>Pertes</th>
              <th className={cn(entete, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {lignes.map((e: any) => (
              <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{e.title}</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {jourFr(e.date)}{e.dateEnd && e.dateEnd !== e.date ? ` → ${jourFr(e.dateEnd)}` : ''}
                </td>
                <td className="px-4 py-3 text-sm">
                  <Badge variant={e.definitif ? 'success' : 'default'}>{STATUTS_MANIFESTATION[e.status] || e.status}</Badge>
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {formatCurrency(e.prestations)}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {e.definitif ? formatCurrency(e.pertes) : <span title="Le matériel n'est pas encore revenu">à venir</span>}
                </td>
                <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {formatCurrency(e.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Les prestations comptent dès la demande ; ce qui n'est pas revenu ne devient une perte qu'une fois la
        manifestation récupérée. Les brouillons et les manifestations annulées ou refusées ne comptent pas.
      </p>
    </div>
  )
}

export default function TrackingPage() {
  const currentYear = new Date().getFullYear()
  const defaultDates = getDefaultDates()
  const chartRef = useRef<HTMLDivElement>(null)

  const [filters, setFilters] = useState<TrackingFilters>({
    ...defaultDates,
    categoryIds: [],
    subcategoryIds: [],
    objectIds: [],
    siteIds: [],
    dataTypes: TOUTES_LES_SOURCES,
    maintenanceTypes: [],
    fuelTypes: [],
    compareEnabled: false,
    ...getComparisonDates(defaultDates.startDate, defaultDates.endDate),
    groupBy: 'month',
    compareMode: 'yearly',
    year1: currentYear,
    year2: currentYear - 1,
    month1: 1,
    month2: 1
  })
  const [showFilters, setShowFilters] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'comparison' | 'fuel' | 'maintenance' | 'control' | 'green_space' | 'buildings' | 'events'>('overview')
  const [showPDFExport, setShowPDFExport] = useState(false)
  const [viewingAttachments, setViewingAttachments] = useState<any[] | null>(null)
  const fenetrePieces = useFenetreModale(viewingAttachments !== null, () => setViewingAttachments(null))

  // Récupérer les permissions
  const { data: permissions } = useQuery({
    queryKey: ['tracking-permissions'],
    queryFn: async () => {
      const response = await api.get('/tracking/permissions')
      return response.data
    }
  })

  // Récupérer les options de filtrage, et les sources ouvertes à ce compte
  const { data: filterOptions, isLoading: loadingFilters } = useQuery({
    queryKey: ['tracking-filters'],
    queryFn: async () => {
      const response = await api.get('/tracking/filters')
      return response.data
    },
    enabled: !!permissions?.canView
  })

  // Une source dont le module est fermé à ce compte ne se propose pas.
  const disponibles: SourceSuivi[] = filterOptions?.sources ?? TOUTES_LES_SOURCES
  const actives = useMemo(() => {
    const retenues = filters.dataTypes.filter(s => disponibles.includes(s))
    return retenues.length ? retenues : disponibles
  }, [filters.dataTypes, disponibles])
  const sourcesActives = useMemo(() => SOURCES_SUIVI.filter(s => actives.includes(s.id)), [actives])
  const actif = (id: SourceSuivi) => actives.includes(id)
  const parcActif = sourcesActives.some(s => s.parc)

  // Construire les paramètres de requête
  const queryParams = useMemo(() => {
    const params: any = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      dataTypes: actives.join(','),
    }
    if (filters.categoryIds.length) params.categoryIds = filters.categoryIds.join(',')
    if (filters.subcategoryIds.length) params.subcategoryIds = filters.subcategoryIds.join(',')
    if (filters.objectIds.length) params.objectIds = filters.objectIds.join(',')
    if (filters.siteIds.length && actives.includes('buildings')) params.siteIds = filters.siteIds.join(',')
    if (filters.maintenanceTypes.length) params.maintenanceTypes = filters.maintenanceTypes.join(',')
    if (filters.fuelTypes.length) params.fuelTypes = filters.fuelTypes.join(',')
    if (filters.compareEnabled && filters.compareMode === 'period') {
      params.compareStartDate = filters.compareStartDate
      params.compareEndDate = filters.compareEndDate
    }
    return params
  }, [filters, actives])

  // Attendre les sources ouvertes évite une première requête pour rien.
  const pret = !!permissions?.canView && !!filterOptions

  // Récupérer les données de suivi
  const { data: trackingData, isLoading: loadingData, refetch } = useQuery({
    queryKey: ['tracking-data', queryParams],
    queryFn: async () => {
      const response = await api.get('/tracking/data', { params: queryParams })
      return response.data
    },
    enabled: pret
  })

  // Récupérer les données des graphiques
  const { data: chartsData, isLoading: loadingCharts } = useQuery({
    queryKey: ['tracking-charts', queryParams, filters.groupBy],
    queryFn: async () => {
      const response = await api.get('/tracking/charts', {
        params: { ...queryParams, groupBy: filters.groupBy }
      })
      return response.data
    },
    enabled: pret
  })

  // Récupérer les données de comparaison annuelle/mensuelle
  const { data: yearlyData } = useQuery({
    queryKey: ['tracking-yearly', filters.year1, filters.year2, filters.month1, filters.month2, filters.compareMode, actives, filters.categoryIds, filters.subcategoryIds, filters.objectIds, filters.siteIds],
    queryFn: async () => {
      const params: any = {
        year1: filters.year1,
        year2: filters.year2,
        dataTypes: actives.join(','),
      }
      // Pour le mode mensuel, ajouter les mois
      if (filters.compareMode === 'monthly') {
        params.month1 = filters.month1
        params.month2 = filters.month2
      }
      if (filters.categoryIds.length) params.categoryIds = filters.categoryIds.join(',')
      if (filters.subcategoryIds.length) params.subcategoryIds = filters.subcategoryIds.join(',')
      if (filters.objectIds.length) params.objectIds = filters.objectIds.join(',')
      if (filters.siteIds.length && actives.includes('buildings')) params.siteIds = filters.siteIds.join(',')

      const response = await api.get('/tracking/yearly-comparison', { params })
      return response.data
    },
    enabled: pret && permissions?.canCompare && filters.compareEnabled && (filters.compareMode === 'yearly' || filters.compareMode === 'monthly')
  })

  // Mettre à jour les dates de comparaison quand les dates principales changent
  useEffect(() => {
    if (!filters.compareEnabled) {
      const compDates = getComparisonDates(filters.startDate, filters.endDate)
      setFilters(f => ({ ...f, ...compDates }))
    }
  }, [filters.startDate, filters.endDate, filters.compareEnabled])

  // Un onglet dont la source vient d'être décochée ne reste pas ouvert, vide.
  useEffect(() => {
    const sourceDeLOnglet: Record<string, SourceSuivi> = {
      fuel: 'fuel', maintenance: 'maintenance', control: 'technical_control',
      green_space: 'green_space', buildings: 'buildings', events: 'events',
    }
    const source = sourceDeLOnglet[activeTab]
    if (source && !actives.includes(source)) setActiveTab('overview')
    if (activeTab === 'comparison' && !filters.compareEnabled) setActiveTab('overview')
  }, [actives, activeTab, filters.compareEnabled])

  // Générer les années disponibles (5 dernières années)
  const availableYears = useMemo(() => {
    const years = []
    for (let i = 0; i <= 5; i++) {
      years.push(currentYear - i)
    }
    return years
  }, [currentYear])

  // Préparer les données pour les graphiques comparatifs
  const comparisonChartData = useMemo(() => {
    if (!yearlyData?.monthly?.year1?.length) return []

    return MONTHS_SHORT.map((month, index) => {
      const year1Data = yearlyData.monthly.year1?.find((d: any) => d.month === index + 1) || {}
      const year2Data = yearlyData.monthly.year2?.find((d: any) => d.month === index + 1) || {}
      const point: Record<string, string | number> = {
        month,
        [`${filters.year1}`]: year1Data.total || 0,
        [`${filters.year2}`]: year2Data.total || 0,
      }
      for (const s of SOURCES_SUIVI) {
        point[`${s.annuel}_${filters.year1}`] = year1Data[s.annuel] || 0
        point[`${s.annuel}_${filters.year2}`] = year2Data[s.annuel] || 0
      }
      return point
    })
  }, [yearlyData, filters.year1, filters.year2])

  // Répartition du total par source, pour le camembert
  const repartition = useMemo(() => {
    const resume = trackingData?.summary
    if (!resume) return []
    return sourcesActives
      .map(s => ({ name: s.libelle, value: resume[s.total] || 0, color: s.couleur }))
      .filter(r => r.value > 0)
  }, [trackingData, sourcesActives])

  // Obtenir le label de l'onglet de comparaison
  const getComparisonTabLabel = () => {
    if (!filters.compareEnabled) return 'Comparaison'
    if (filters.compareMode === 'period') {
      return `Comparaison périodes`
    }
    if (filters.compareMode === 'monthly') {
      return `${MONTHS_SHORT[filters.month1 - 1]} ${filters.year1} vs ${MONTHS_SHORT[filters.month2 - 1]} ${filters.year2}`
    }
    return `${filters.year1} vs ${filters.year2}`
  }

  if (!permissions?.canView) {
    return (
      <div className="p-6">
        <Alert type="warning">
          Vous n'avez pas les droits pour accéder au module de Suivi.
          Contactez votre administrateur pour obtenir les permissions nécessaires.
        </Alert>
      </div>
    )
  }

  const summary = trackingData?.summary || {
    totalFuelCost: 0,
    totalFuelQuantity: 0,
    totalMaintenanceCost: 0,
    totalControlCost: 0,
    totalGreenSpaceCost: 0,
    totalBuildingCost: 0,
    totalEventCost: 0,
    totalCost: 0,
    fuelEntryCount: 0,
    maintenanceCount: 0,
    controlCount: 0,
  }

  const comparison = trackingData?.comparison
  const tendance = (ecart: number | undefined) => (ecart && ecart > 0 ? 'up' : ecart && ecart < 0 ? 'down' : 'neutral') as 'up' | 'down' | 'neutral'
  const chargement = !pret || loadingData || loadingCharts
  const listes = ['fuel', 'maintenance', 'technicalControl', 'greenSpace', 'buildings', 'events']
  const aucuneDonnee = summary.totalCost === 0 && !listes.some(cle => trackingData?.[cle]?.length)
  const sites: FilterOption[] = filterOptions?.sites ?? []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Suivi des coûts</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Analysez et comparez ce que coûtent le parc, les espaces verts, les bâtiments et les manifestations
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => refetch()}
          >
            Actualiser
          </Button>
          <Button
            variant="outline"
            icon={showFilters ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? 'Masquer filtres' : 'Afficher filtres'}
          </Button>
          {permissions?.canExport && (
            <Button
              icon={<Download className="w-4 h-4" />}
              onClick={() => setShowPDFExport(true)}
              disabled={chargement}
            >
              Exporter PDF
            </Button>
          )}
        </div>
      </div>

      {/* Filtres */}
      {showFilters && (
        <Card className="overflow-visible">
          <CardBody className="space-y-4 overflow-visible">
            {/* Période */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  <Calendar className="w-4 h-4 inline-block mr-1" />
                  Date de début
                </label>
                <Input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Date de fin
                </label>
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  <BarChart3 className="w-4 h-4 inline-block mr-1" />
                  Grouper par
                </label>
                <select
                  value={filters.groupBy}
                  onChange={(e) => setFilters(f => ({ ...f, groupBy: e.target.value as any }))}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none appearance-none cursor-pointer min-h-[44px]"
                >
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                  <option value="year">Année</option>
                </select>
              </div>
              {permissions?.canCompare && (
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={filters.compareEnabled}
                      onChange={(e) => setFilters(f => ({ ...f, compareEnabled: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      <ArrowRightLeft className="w-4 h-4 inline-block mr-1" />
                      Comparer
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Section de comparaison unifiée */}
            {filters.compareEnabled && permissions?.canCompare && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/40 rounded-lg border border-blue-200 dark:border-blue-800 space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">Mode de comparaison</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'period', libelle: 'Périodes personnalisées', icone: Calendar, actif: 'bg-blue-600 text-white' },
                      { id: 'yearly', libelle: 'Années', icone: BarChart3, actif: 'bg-purple-600 text-white' },
                      { id: 'monthly', libelle: 'Mois spécifiques', icone: Calendar, actif: 'bg-green-600 text-white' },
                    ] as const).map(mode => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={filters.compareMode === mode.id}
                        onClick={() => setFilters(f => ({ ...f, compareMode: mode.id }))}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-sm font-medium transition-all min-h-[44px]",
                          filters.compareMode === mode.id
                            ? mode.actif
                            : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-blue-300"
                        )}
                      >
                        <mode.icone className="w-4 h-4 inline-block mr-1" />
                        {mode.libelle}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Périodes personnalisées */}
                {filters.compareMode === 'period' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
                        Période de comparaison - Début
                      </label>
                      <Input
                        type="date"
                        value={filters.compareStartDate}
                        onChange={(e) => setFilters(f => ({ ...f, compareStartDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
                        Période de comparaison - Fin
                      </label>
                      <Input
                        type="date"
                        value={filters.compareEndDate}
                        onChange={(e) => setFilters(f => ({ ...f, compareEndDate: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                {/* Comparaison par années */}
                {filters.compareMode === 'yearly' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {([['year1', 'Année 1'], ['year2', 'Année 2']] as const).map(([cle, libelle]) => (
                      <div key={cle}>
                        <label className="block text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">
                          {libelle}
                        </label>
                        <select
                          value={filters[cle]}
                          onChange={(e) => setFilters(f => ({ ...f, [cle]: parseInt(e.target.value) }))}
                          className="block w-full rounded-lg border border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none min-h-[44px]"
                        >
                          {availableYears.map(year => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comparaison par mois spécifiques */}
                {filters.compareMode === 'monthly' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {([['month1', 'year1', 'Mois 1'], ['month2', 'year2', 'Mois 2']] as const).map(([cleMois, cleAnnee, libelle]) => (
                      <div key={cleMois} className="space-y-2">
                        <label className="block text-sm font-medium text-green-700 dark:text-green-300">
                          {libelle}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            aria-label={`${libelle} : mois`}
                            value={filters[cleMois]}
                            onChange={(e) => setFilters(f => ({ ...f, [cleMois]: parseInt(e.target.value) }))}
                            className="block w-full rounded-lg border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none min-h-[44px]"
                          >
                            {MONTHS_SHORT.map((month, index) => (
                              <option key={index} value={index + 1}>{month}</option>
                            ))}
                          </select>
                          <select
                            aria-label={`${libelle} : année`}
                            value={filters[cleAnnee]}
                            onChange={(e) => setFilters(f => ({ ...f, [cleAnnee]: parseInt(e.target.value) }))}
                            className="block w-full rounded-lg border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none min-h-[44px]"
                          >
                            {availableYears.map(year => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Types de données */}
            <DataTypeFilter
              disponibles={disponibles}
              selected={actives}
              onChange={(types) => setFilters(f => ({ ...f, dataTypes: types }))}
            />

            {/* Bouton pour afficher les filtres avancés */}
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-800 min-h-[44px]"
            >
              <Settings2 className="w-4 h-4" />
              {showAdvanced ? 'Masquer les filtres avancés' : 'Afficher les filtres avancés'}
              <ChevronDown className={cn("w-4 h-4 transition-transform", showAdvanced && "rotate-180")} />
            </button>

            {/* Filtres avancés */}
            {showAdvanced && (
              <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg overflow-visible relative z-10">
                {!loadingFilters && filterOptions && parcActif && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Parc de matériel : ces filtres ne s'appliquent qu'au carburant, aux entretiens et aux contrôles techniques.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <MultiSelectFilter
                        label="Catégories"
                        icon={FolderOpen}
                        options={filterOptions.categories}
                        selected={filters.categoryIds}
                        onChange={(ids) => setFilters(f => ({
                          ...f,
                          categoryIds: ids,
                          subcategoryIds: [],
                          objectIds: []
                        }))}
                        placeholder="Toutes les catégories"
                      />
                      <MultiSelectFilter
                        label="Sous-catégories"
                        icon={Building}
                        options={filterOptions.subcategories.filter((s: any) =>
                          filters.categoryIds.length === 0 || filters.categoryIds.includes(s.categoryId)
                        )}
                        selected={filters.subcategoryIds}
                        onChange={(ids) => setFilters(f => ({
                          ...f,
                          subcategoryIds: ids,
                          objectIds: []
                        }))}
                        placeholder="Toutes les sous-catégories"
                      />
                      <MultiSelectFilter
                        label="Objets"
                        icon={Car}
                        options={filterOptions.objects.filter((o: any) => {
                          if (filters.subcategoryIds.length > 0) {
                            return filters.subcategoryIds.includes(o.subcategoryId)
                          }
                          if (filters.categoryIds.length > 0) {
                            return filters.categoryIds.includes(o.categoryId)
                          }
                          return true
                        })}
                        selected={filters.objectIds}
                        onChange={(ids) => setFilters(f => ({ ...f, objectIds: ids }))}
                        placeholder="Tous les objets"
                        groupBy="category"
                      />
                    </div>
                  </div>
                )}
                {actif('buildings') && sites.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <MultiSelectFilter
                      label="Bâtiments"
                      icon={Building2}
                      options={sites}
                      selected={filters.siteIds}
                      onChange={(ids) => setFilters(f => ({ ...f, siteIds: ids }))}
                      placeholder="Tous les bâtiments suivis"
                    />
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Chargement */}
      {chargement && (
        <Card>
          <CardBody className="py-12 text-center">
            <LoadingInline />
            <p className="mt-2 text-gray-500 dark:text-gray-400">Chargement des données...</p>
          </CardBody>
        </Card>
      )}

      {/* Contenu */}
      {!chargement && aucuneDonnee && (
        <Card>
          <CardBody className="py-16 text-center">
            <BarChart3 className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">Aucune donnée pour cette période</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md mx-auto">
              Modifiez les dates ou les filtres pour afficher des données de suivi. Vérifiez que des dépenses
              ({sourcesActives.map(s => s.libelle.toLowerCase()).join(', ')}) existent pour la période sélectionnée.
            </p>
          </CardBody>
        </Card>
      )}

      {!chargement && !aucuneDonnee && (
        <>
          {/* Cartes statistiques */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Coût total"
              value={formatCurrency(summary.totalCost)}
              icon={BarChart3}
              color="purple"
              comparison={comparison?.percentageChange?.totalCost}
              trend={tendance(comparison?.difference?.totalCost)}
            />
            {sourcesActives.map(s => (
              <StatCard
                key={s.id}
                title={s.libelle}
                value={formatCurrency(summary[s.total] || 0)}
                icon={s.icone}
                color={s.teinte}
                comparison={comparison?.percentageChange?.[s.total]}
                trend={tendance(comparison?.difference?.[s.total])}
              />
            ))}
          </div>

          {/* Cartes secondaires carburant */}
          {actif('fuel') && summary.fuelEntryCount > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                title="Quantité de carburant"
                value={`${formatNumber(summary.totalFuelQuantity)} L`}
                icon={Fuel}
                color="amber"
              />
              <StatCard
                title="Nombre de pleins"
                value={summary.fuelEntryCount}
                icon={Fuel}
                color="amber"
              />
              <StatCard
                title="Coût moyen / plein"
                value={formatCurrency(summary.fuelEntryCount > 0 ? summary.totalFuelCost / summary.fuelEntryCount : 0)}
                icon={Fuel}
                color="amber"
              />
            </div>
          )}

          {/* Onglets */}
          <Card>
            <CardHeader>
              <Tabs value={activeTab} onChange={(id) => setActiveTab(id as typeof activeTab)}>
                <Tab
                  value="overview"
                  label="Vue d'ensemble"
                  icon={<BarChart3 className="w-4 h-4" />}
                />
                {filters.compareEnabled && permissions?.canCompare && (
                  <Tab
                    value="comparison"
                    label={getComparisonTabLabel()}
                    icon={<Layers className="w-4 h-4" />}
                  />
                )}
                {actif('fuel') && (
                  <Tab
                    value="fuel"
                    label={`Carburant (${trackingData?.fuel?.length || 0})`}
                    icon={<Fuel className="w-4 h-4" />}
                  />
                )}
                {actif('maintenance') && (
                  <Tab
                    value="maintenance"
                    label={`Entretiens (${trackingData?.maintenance?.length || 0})`}
                    icon={<Wrench className="w-4 h-4" />}
                  />
                )}
                {actif('technical_control') && (
                  <Tab
                    value="control"
                    label={`Contrôles (${trackingData?.technicalControl?.length || 0})`}
                    icon={<ClipboardCheck className="w-4 h-4" />}
                  />
                )}
                {actif('green_space') && (
                  <Tab
                    value="green_space"
                    label={`Espaces verts (${trackingData?.greenSpace?.length || 0})`}
                    icon={<TreePine className="w-4 h-4" />}
                  />
                )}
                {actif('buildings') && (
                  <Tab
                    value="buildings"
                    label={`Bâtiments (${trackingData?.buildings?.length || 0})`}
                    icon={<Building2 className="w-4 h-4" />}
                  />
                )}
                {actif('events') && (
                  <Tab
                    value="events"
                    label={`Manifestations (${trackingData?.events?.length || 0})`}
                    icon={<PartyPopper className="w-4 h-4" />}
                  />
                )}
              </Tabs>
            </CardHeader>
            <CardBody>
              {activeTab === 'overview' && (
                <div className="space-y-8" ref={chartRef}>
                  {/* Graphique évolution */}
                  {chartsData?.costByPeriod?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Évolution des coûts</h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={chartsData.costByPeriod}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#6b7280" angle={-45} textAnchor="end" height={60} />
                            <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {sourcesActives.map((s, i) => (
                              <Bar
                                key={s.id}
                                dataKey={s.serie}
                                name={s.libelle}
                                fill={s.couleur}
                                stackId="couts"
                                radius={i === sourcesActives.length - 1 ? [4, 4, 0, 0] : undefined}
                              />
                            ))}
                            <Line type="monotone" dataKey="totalCost" name="Total" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Répartition par source */}
                  {repartition.length > 1 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Répartition des coûts</h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={repartition} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                              {repartition.map(r => (
                                <Cell key={r.name} fill={r.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Coûts par objet */}
                  {parcActif && chartsData?.costByObject?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Coûts par objet (Top 10)</h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.costByObject.slice(0, 10)} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} />
                            <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 9 }} stroke="#6b7280" />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {sourcesActives.filter(s => s.parc).map(s => (
                              <Bar key={s.id} dataKey={s.serie} name={s.libelle} fill={s.couleur} stackId="a" />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Coûts par bâtiment */}
                  {actif('buildings') && chartsData?.costByBuilding?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Coûts par bâtiment (Top 10)</h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.costByBuilding} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} />
                            <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 9 }} stroke="#6b7280" />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {CATEGORIES_BATIMENT.map(c => (
                              <Bar key={c.id} dataKey={c.id} name={c.libelle} fill={c.couleur} stackId="b" />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'comparison' && filters.compareEnabled && permissions?.canCompare && (
                <div className="space-y-8" ref={chartRef}>
                  {/* Mode périodes personnalisées */}
                  {filters.compareMode === 'period' && comparison && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="border-2 border-blue-200 dark:border-blue-800">
                          <CardBody className="p-4">
                            <h4 className="font-semibold text-blue-700 dark:text-blue-300 mb-3">
                              Période actuelle
                              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                                {jourFr(filters.startDate)} - {jourFr(filters.endDate)}
                              </span>
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-300">Coût total</span>
                                <span className="font-bold text-lg">{formatCurrency(summary.totalCost)}</span>
                              </div>
                              <LignesParSource sources={sourcesActives} montant={s => summary[s.total]} />
                            </div>
                          </CardBody>
                        </Card>

                        <Card className="border-2 border-indigo-200 dark:border-indigo-800">
                          <CardBody className="p-4">
                            <h4 className="font-semibold text-indigo-700 dark:text-indigo-300 mb-3">
                              Période de comparaison
                              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                                {jourFr(filters.compareStartDate)} - {jourFr(filters.compareEndDate)}
                              </span>
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-300">Coût total</span>
                                <span className="font-bold text-lg">{formatCurrency(comparison.summary?.totalCost || 0)}</span>
                              </div>
                              <LignesParSource sources={sourcesActives} montant={s => comparison.summary?.[s.total]} />
                            </div>
                          </CardBody>
                        </Card>
                      </div>

                      {/* Différence pour périodes */}
                      <Card className={cn(
                        "border-2",
                        comparison.difference?.totalCost > 0
                          ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                          : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
                      )}>
                        <CardBody className="p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="font-semibold text-gray-900 dark:text-gray-100">Différence entre périodes</h4>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {comparison.percentageChange?.totalCost === null || comparison.percentageChange?.totalCost === undefined
                                  ? 'Rien à comparer sur la période de référence'
                                  : comparison.difference?.totalCost > 0
                                    ? `Augmentation de ${comparison.percentageChange.totalCost}%`
                                    : `Réduction de ${Math.abs(comparison.percentageChange.totalCost).toFixed(1)}%`
                                }
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {comparison.difference?.totalCost > 0 ? (
                                <TrendingUp className="w-8 h-8 text-red-500" />
                              ) : (
                                <TrendingDown className="w-8 h-8 text-green-500" />
                              )}
                              <span className={cn(
                                "text-2xl font-bold",
                                comparison.difference?.totalCost > 0 ? "text-red-600" : "text-green-600"
                              )}>
                                {comparison.difference?.totalCost > 0 ? '+' : ''}{formatCurrency(comparison.difference?.totalCost || 0)}
                              </span>
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    </>
                  )}

                  {/* Mode années ou mois spécifiques */}
                  {(filters.compareMode === 'yearly' || filters.compareMode === 'monthly') && (
                    <>
                      {/* Résumé comparatif */}
                      {yearlyData?.summary && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {([
                            ['year1', filters.month1, filters.year1, 'border-purple-200 dark:border-purple-800', 'text-purple-700 dark:text-purple-300'],
                            ['year2', filters.month2, filters.year2, 'border-indigo-200 dark:border-indigo-800', 'text-indigo-700 dark:text-indigo-300'],
                          ] as const).map(([cle, mois, annee, bordure, titre]) => (
                            <Card key={cle} className={cn('border-2', bordure)}>
                              <CardBody className="p-4">
                                <h4 className={cn('font-semibold mb-3', titre)}>
                                  {filters.compareMode === 'monthly'
                                    ? `${MONTHS_SHORT[mois - 1]} ${annee}`
                                    : `Année ${annee}`
                                  }
                                </h4>
                                <div className="space-y-2">
                                  <div className="flex justify-between">
                                    <span className="text-gray-600 dark:text-gray-300">Coût total</span>
                                    <span className="font-bold text-lg">{formatCurrency(yearlyData.summary[cle].total)}</span>
                                  </div>
                                  <LignesParSource sources={sourcesActives} montant={s => yearlyData.summary[cle][s.annuel]} />
                                </div>
                              </CardBody>
                            </Card>
                          ))}
                        </div>
                      )}

                      {/* Différence */}
                      {yearlyData?.difference && (
                        <Card className={cn(
                          "border-2",
                          yearlyData.difference.total > 0
                            ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                            : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
                        )}>
                          <CardBody className="p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                                  Différence {filters.compareMode === 'monthly'
                                    ? `${MONTHS_SHORT[filters.month1 - 1]} ${filters.year1} vs ${MONTHS_SHORT[filters.month2 - 1]} ${filters.year2}`
                                    : `${filters.year1} vs ${filters.year2}`
                                  }
                                </h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  {phraseEcartAnnuel(yearlyData, filters)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {yearlyData.difference.total > 0 ? (
                                  <TrendingUp className="w-8 h-8 text-red-500" />
                                ) : (
                                  <TrendingDown className="w-8 h-8 text-green-500" />
                                )}
                                <span className={cn(
                                  "text-2xl font-bold",
                                  yearlyData.difference.total > 0 ? "text-red-600" : "text-green-600"
                                )}>
                                  {yearlyData.difference.total > 0 ? '+' : ''}{formatCurrency(yearlyData.difference.total)}
                                </span>
                              </div>
                            </div>
                          </CardBody>
                        </Card>
                      )}

                      {/* Graphique comparatif mois par mois (uniquement pour mode yearly) */}
                      {filters.compareMode === 'yearly' && comparisonChartData.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                            Comparaison mensuelle : {filters.year1} vs {filters.year2}
                          </h3>
                          <div className="h-96">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparisonChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#6b7280" />
                                <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Bar dataKey={`${filters.year1}`} name={`Total ${filters.year1}`} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                <Bar dataKey={`${filters.year2}`} name={`Total ${filters.year2}`} fill="#6366f1" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Graphiques par source (uniquement pour mode yearly) */}
                      {filters.compareMode === 'yearly' && comparisonChartData.length > 0 && sourcesActives.map(s => (
                        <div key={s.id}>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                            <s.icone className="w-5 h-5 inline-block mr-2" style={{ color: s.couleur }} />
                            {s.libelle} : {filters.year1} vs {filters.year2}
                          </h3>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={comparisonChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#6b7280" />
                                <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey={`${s.annuel}_${filters.year1}`} name={`${filters.year1}`} stroke={s.couleur} strokeWidth={2} dot={{ fill: s.couleur }} />
                                <Line type="monotone" dataKey={`${s.annuel}_${filters.year2}`} name={`${filters.year2}`} stroke={s.couleur} strokeOpacity={0.6} strokeWidth={2} strokeDasharray="5 5" dot={{ fill: s.couleur }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Message si aucune comparaison n'est configurée */}
                  {!comparison && !yearlyData && (
                    <div className="text-center py-12">
                      <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">Sélectionnez un mode de comparaison et configurez les paramètres pour voir les résultats.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'fuel' && trackingData?.fuel && (
                <DataTable
                  data={trackingData.fuel}
                  type="fuel"
                  onViewAttachments={setViewingAttachments}
                />
              )}

              {activeTab === 'maintenance' && trackingData?.maintenance && (
                <DataTable
                  data={trackingData.maintenance}
                  type="maintenance"
                  onViewAttachments={setViewingAttachments}
                />
              )}

              {activeTab === 'control' && trackingData?.technicalControl && (
                <DataTable
                  data={trackingData.technicalControl}
                  type="technical_control"
                  onViewAttachments={setViewingAttachments}
                />
              )}

              {activeTab === 'green_space' && trackingData?.greenSpace && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900/40">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Espace vert</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Intervenant</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Durée</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Coût</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prochain</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {trackingData.greenSpace.map((g: any) => (
                        <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{g.spaceName}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{g.type}{g.title ? ` - ${g.title}` : ''}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{jourFr(g.date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{g.performer || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{g.duration ? `${g.duration} min` : '-'}</td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(g.cost)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{jourFr(g.nextDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'buildings' && trackingData?.buildings && (
                <TableBatiments
                  lignes={trackingData.buildings}
                  avecComparaison={!!comparison && filters.compareMode === 'period'}
                />
              )}

              {activeTab === 'events' && trackingData?.events && (
                <TableManifestations lignes={trackingData.events} />
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Modal d'export PDF */}
      {showPDFExport && (
        <TrackingPDFExport
          filters={{ ...filters, dataTypes: actives }}
          data={trackingData}
          chartsData={chartsData}
          summary={summary}
          comparison={comparison}
          yearlyComparison={yearlyData}
          onClose={() => setShowPDFExport(false)}
          chartRef={chartRef}
        />
      )}

      {/* Modal des pièces jointes */}
      {viewingAttachments && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setViewingAttachments(null)} />
          <div
            ref={fenetrePieces.ref}
            {...fenetrePieces.proprietes}
            aria-labelledby={fenetrePieces.idTitre}
            className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto outline-none"
          >
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b px-4 py-3 flex items-center justify-between">
              <h3 id={fenetrePieces.idTitre} className="font-semibold text-gray-900 dark:text-gray-100">
                <Paperclip className="w-5 h-5 inline-block mr-2" />
                Pièces jointes ({viewingAttachments.length})
              </h3>
              <button onClick={() => setViewingAttachments(null)} aria-label="Fermer" title="Fermer" className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {viewingAttachments.map((attachment: any, index: number) => (
                <a
                  key={index}
                  href={attachment.url || attachment}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <FileText className="w-8 h-8 text-gray-600 dark:text-gray-300" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {attachment.name || `Fichier ${index + 1}`}
                    </div>
                    {attachment.size && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{attachment.size}</div>
                    )}
                  </div>
                  <Download className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
