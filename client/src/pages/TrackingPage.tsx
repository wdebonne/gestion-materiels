import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  BarChart3, TrendingUp, TrendingDown, Calendar, 
  Download, Fuel, Wrench, ClipboardCheck, ChevronDown, ChevronUp,
  X, Search, RefreshCw, ArrowRightLeft, FileText, Paperclip,
  Building, Car, FolderOpen, Settings2, Eye, EyeOff, Layers, TreePine
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, Button, Badge, 
  LoadingInline, Alert, Input, Tabs, Tab
} from '@/components/ui'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart
} from 'recharts'
import api from '@/lib/api'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
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
  dataTypes: ('fuel' | 'maintenance' | 'technical_control' | 'green_space')[]
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

// Fonction pour obtenir les dates par défaut (année en cours)
const getDefaultDates = () => {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return {
    startDate: startOfYear.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
  }
}

// Fonction pour obtenir les dates de comparaison (année précédente)
const getComparisonDates = (startDate: string, endDate: string) => {
  const start = new Date(startDate)
  const end = new Date(endDate)
  start.setFullYear(start.getFullYear() - 1)
  end.setFullYear(end.getFullYear() - 1)
  return {
    compareStartDate: start.toISOString().split('T')[0],
    compareEndDate: end.toISOString().split('T')[0],
  }
}

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
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  }

  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
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
                <span className="text-xs text-gray-400">vs période précédente</span>
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
      <label className="block text-sm font-medium text-gray-700 mb-1">
        <Icon className="w-4 h-4 inline-block mr-1" />
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 border rounded-lg text-left text-sm",
          selected.length > 0 
            ? "border-primary-300 bg-primary-50" 
            : "border-gray-300 bg-white"
        )}
      >
        <span className={selected.length > 0 ? "text-gray-900" : "text-gray-500"}>
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
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
            {searchable && (
              <div className="p-2 border-b sticky top-0 bg-white">
                <Input
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<Search className="w-4 h-4" />}
                  className="!py-1.5"
                />
              </div>
            )}
            
            <div className="p-2 border-b flex gap-2">
              <button
                type="button"
                onClick={() => onChange(options.map(o => o.id))}
                className="text-xs text-primary-600 hover:text-primary-800"
              >
                Tout sélectionner
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-gray-600 hover:text-gray-800"
              >
                Tout désélectionner
              </button>
            </div>

            <div className="py-1">
              {Object.entries(groupedOptions).map(([group, items]) => (
                <div key={group}>
                  {group && (
                    <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50">
                      {group}
                    </div>
                  )}
                  {items.map(option => (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
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
                        className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      />
                      {option.image && (
                        <img src={option.image} alt="" className="w-6 h-6 rounded object-cover" />
                      )}
                      <span className="text-sm text-gray-700 flex-1">{option.name}</span>
                      {option.reference && (
                        <span className="text-xs text-gray-400">{option.reference}</span>
                      )}
                    </label>
                  ))}
                </div>
              ))}
              {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">
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

// Composant de sélection des types de données
function DataTypeFilter({
  selected,
  onChange
}: {
  selected: ('fuel' | 'maintenance' | 'technical_control' | 'green_space')[]
  onChange: (types: ('fuel' | 'maintenance' | 'technical_control' | 'green_space')[]) => void
}) {
  const types = [
    { id: 'fuel' as const, label: 'Carburant', icon: Fuel, color: 'amber' },
    { id: 'maintenance' as const, label: 'Entretiens', icon: Wrench, color: 'blue' },
    { id: 'technical_control' as const, label: 'Contrôle technique', icon: ClipboardCheck, color: 'green' },
    { id: 'green_space' as const, label: 'Espaces verts', icon: TreePine, color: 'emerald' },
  ]

  const colorClasses: Record<string, string> = {
    amber: 'border-amber-300 bg-amber-50 text-amber-700',
    blue: 'border-blue-300 bg-blue-50 text-blue-700',
    green: 'border-green-300 bg-green-50 text-green-700',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Types de données
      </label>
      <div className="flex flex-wrap gap-2">
        {types.map(type => (
          <button
            key={type.id}
            type="button"
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
              "flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all",
              selected.includes(type.id)
                ? colorClasses[type.color]
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            )}
          >
            <type.icon className="w-4 h-4" />
            {type.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Tooltip personnalisé pour les graphiques
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="font-medium text-gray-900 mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600">{entry.name}:</span>
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
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
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
          <thead className="bg-gray-50">
            <tr>
              <SortHeader label="Date" keyName="date" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Objet</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <SortHeader label="Quantité" keyName="quantity" />
              <SortHeader label="Prix unit." keyName="unitPrice" />
              <SortHeader label="Total" keyName="totalPrice" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pièces</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedData.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                  {new Date(item.date).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.objectImage && (
                      <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900">{item.objectName}</div>
                      {item.objectReference && (
                        <div className="text-xs text-gray-500">{item.objectReference}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.categoryName}</td>
                <td className="px-4 py-3">
                  <Badge variant="warning">{item.fuelType}</Badge>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{formatNumber(item.quantity)} L</td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatCurrency(item.unitPrice)}/L</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(item.totalPrice)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.station || '-'}</td>
                <td className="px-4 py-3 text-center">
                  {item.attachments?.length > 0 && (
                    <button
                      onClick={() => onViewAttachments?.(item.attachments)}
                      className="p-1 text-gray-400 hover:text-primary-600"
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
            <div className="text-sm text-gray-500">
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
          <thead className="bg-gray-50">
            <tr>
              <SortHeader label="Date" keyName="date" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Objet</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <SortHeader label="Coût" keyName="cost" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prestataire</th>
              <SortHeader label="Prochaine" keyName="nextDate" />
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pièces</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedData.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                  {new Date(item.date).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.objectImage && (
                      <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900">{item.objectName}</div>
                      {item.objectReference && (
                        <div className="text-xs text-gray-500">{item.objectReference}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.categoryName}</td>
                <td className="px-4 py-3">
                  <Badge variant="info">{item.type}</Badge>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(item.cost)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.provider || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {item.nextDate ? new Date(item.nextDate).toLocaleDateString('fr-FR') : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  {item.attachments?.length > 0 && (
                    <button
                      onClick={() => onViewAttachments?.(item.attachments)}
                      className="p-1 text-gray-400 hover:text-primary-600"
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
            <div className="text-sm text-gray-500">
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
        <thead className="bg-gray-50">
          <tr>
            <SortHeader label="Date" keyName="date" />
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Objet</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Résultat</th>
            <SortHeader label="Coût" keyName="cost" />
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Centre</th>
            <SortHeader label="Expiration" keyName="expiryDate" />
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pièces</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {paginatedData.map((item: any) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                {new Date(item.date).toLocaleDateString('fr-FR')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {item.objectImage && (
                    <img src={item.objectImage} alt="" className="w-8 h-8 rounded object-cover" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-gray-900">{item.objectName}</div>
                    {item.objectReference && (
                      <div className="text-xs text-gray-500">{item.objectReference}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{item.categoryName}</td>
              <td className="px-4 py-3">
                <Badge variant={item.result === 'Favorable' ? 'success' : 'warning'}>
                  {item.result || '-'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(item.cost)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{item.centerName || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('fr-FR') : '-'}
              </td>
              <td className="px-4 py-3 text-center">
                {item.attachments?.length > 0 && (
                  <button
                    onClick={() => onViewAttachments?.(item.attachments)}
                    className="p-1 text-gray-400 hover:text-primary-600"
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
          <div className="text-sm text-gray-500">
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

export default function TrackingPage() {
  const currentYear = new Date().getFullYear()
  const defaultDates = getDefaultDates()
  const chartRef = useRef<HTMLDivElement>(null)
  
  const [filters, setFilters] = useState<TrackingFilters>({
    ...defaultDates,
    categoryIds: [],
    subcategoryIds: [],
    objectIds: [],
    dataTypes: ['fuel', 'maintenance', 'technical_control', 'green_space'],
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
  const [activeTab, setActiveTab] = useState<'overview' | 'comparison' | 'fuel' | 'maintenance' | 'control'>('overview')
  const [showPDFExport, setShowPDFExport] = useState(false)
  const [viewingAttachments, setViewingAttachments] = useState<any[] | null>(null)

  // Récupérer les permissions
  const { data: permissions } = useQuery({
    queryKey: ['tracking-permissions'],
    queryFn: async () => {
      const response = await api.get('/tracking/permissions')
      return response.data
    }
  })

  // Récupérer les options de filtrage
  const { data: filterOptions, isLoading: loadingFilters } = useQuery({
    queryKey: ['tracking-filters'],
    queryFn: async () => {
      const response = await api.get('/tracking/filters')
      return response.data
    }
  })

  // Construire les paramètres de requête
  const queryParams = useMemo(() => {
    const params: any = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      dataTypes: filters.dataTypes.join(','),
    }
    if (filters.categoryIds.length) params.categoryIds = filters.categoryIds.join(',')
    if (filters.subcategoryIds.length) params.subcategoryIds = filters.subcategoryIds.join(',')
    if (filters.objectIds.length) params.objectIds = filters.objectIds.join(',')
    if (filters.maintenanceTypes.length) params.maintenanceTypes = filters.maintenanceTypes.join(',')
    if (filters.fuelTypes.length) params.fuelTypes = filters.fuelTypes.join(',')
    if (filters.compareEnabled && filters.compareMode === 'period') {
      params.compareStartDate = filters.compareStartDate
      params.compareEndDate = filters.compareEndDate
    }
    return params
  }, [filters])

  // Récupérer les données de suivi
  const { data: trackingData, isLoading: loadingData, refetch } = useQuery({
    queryKey: ['tracking-data', queryParams],
    queryFn: async () => {
      const response = await api.get('/tracking/data', { params: queryParams })
      return response.data
    },
    enabled: permissions?.canView
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
    enabled: permissions?.canView
  })

  // Récupérer les données de comparaison annuelle/mensuelle
  const { data: yearlyData } = useQuery({
    queryKey: ['tracking-yearly', filters.year1, filters.year2, filters.month1, filters.month2, filters.compareMode, filters.dataTypes, filters.categoryIds, filters.subcategoryIds, filters.objectIds],
    queryFn: async () => {
      const params: any = {
        year1: filters.year1,
        year2: filters.year2,
        dataTypes: filters.dataTypes.join(','),
      }
      // Pour le mode mensuel, ajouter les mois
      if (filters.compareMode === 'monthly') {
        params.month1 = filters.month1
        params.month2 = filters.month2
      }
      if (filters.categoryIds.length) params.categoryIds = filters.categoryIds.join(',')
      if (filters.subcategoryIds.length) params.subcategoryIds = filters.subcategoryIds.join(',')
      if (filters.objectIds.length) params.objectIds = filters.objectIds.join(',')
      
      const response = await api.get('/tracking/yearly-comparison', { params })
      return response.data
    },
    enabled: permissions?.canView && permissions?.canCompare && filters.compareEnabled && (filters.compareMode === 'yearly' || filters.compareMode === 'monthly')
  })

  // Mettre à jour les dates de comparaison quand les dates principales changent
  useEffect(() => {
    if (!filters.compareEnabled) {
      const compDates = getComparisonDates(filters.startDate, filters.endDate)
      setFilters(f => ({ ...f, ...compDates }))
    }
  }, [filters.startDate, filters.endDate, filters.compareEnabled])

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
    if (!yearlyData?.monthly) return []
    
    return MONTHS_SHORT.map((month, index) => {
      const year1Data = yearlyData.monthly.year1?.find((d: any) => d.month === index + 1) || {}
      const year2Data = yearlyData.monthly.year2?.find((d: any) => d.month === index + 1) || {}
      
      return {
        month,
        [`${filters.year1}`]: year1Data.total || 0,
        [`${filters.year2}`]: year2Data.total || 0,
        [`fuel_${filters.year1}`]: year1Data.fuel || 0,
        [`fuel_${filters.year2}`]: year2Data.fuel || 0,
        [`maintenance_${filters.year1}`]: year1Data.maintenance || 0,
        [`maintenance_${filters.year2}`]: year2Data.maintenance || 0,
        [`control_${filters.year1}`]: year1Data.control || 0,
        [`control_${filters.year2}`]: year2Data.control || 0,
      }
    })
  }, [yearlyData, filters.year1, filters.year2])

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
    totalCost: 0,
    fuelEntryCount: 0,
    maintenanceCount: 0,
    controlCount: 0,
  }

  const comparison = trackingData?.comparison

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suivi des coûts</h1>
          <p className="text-gray-500 mt-1">
            Analysez et comparez les dépenses carburant, entretiens et contrôles techniques
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date de fin
                </label>
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <BarChart3 className="w-4 h-4 inline-block mr-1" />
                  Grouper par
                </label>
                <select
                  value={filters.groupBy}
                  onChange={(e) => setFilters(f => ({ ...f, groupBy: e.target.value as any }))}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                  <option value="year">Année</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.compareEnabled}
                    onChange={(e) => setFilters(f => ({ ...f, compareEnabled: e.target.checked }))}
                    className="w-5 h-5 rounded border-gray-300 text-primary-600"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    <ArrowRightLeft className="w-4 h-4 inline-block mr-1" />
                    Comparer
                  </span>
                </label>
              </div>
            </div>

            {/* Section de comparaison unifiée */}
            {filters.compareEnabled && permissions?.canCompare && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200 space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-800">Mode de comparaison</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFilters(f => ({ ...f, compareMode: 'period' }))}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        filters.compareMode === 'period'
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 border border-gray-300 hover:border-blue-300"
                      )}
                    >
                      <Calendar className="w-4 h-4 inline-block mr-1" />
                      Périodes personnalisées
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilters(f => ({ ...f, compareMode: 'yearly' }))}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        filters.compareMode === 'yearly'
                          ? "bg-purple-600 text-white"
                          : "bg-white text-gray-600 border border-gray-300 hover:border-purple-300"
                      )}
                    >
                      <BarChart3 className="w-4 h-4 inline-block mr-1" />
                      Années
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilters(f => ({ ...f, compareMode: 'monthly' }))}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        filters.compareMode === 'monthly'
                          ? "bg-green-600 text-white"
                          : "bg-white text-gray-600 border border-gray-300 hover:border-green-300"
                      )}
                    >
                      <Calendar className="w-4 h-4 inline-block mr-1" />
                      Mois spécifiques
                    </button>
                  </div>
                </div>

                {/* Périodes personnalisées */}
                {filters.compareMode === 'period' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        Période de comparaison - Début
                      </label>
                      <Input
                        type="date"
                        value={filters.compareStartDate}
                        onChange={(e) => setFilters(f => ({ ...f, compareStartDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
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
                    <div>
                      <label className="block text-sm font-medium text-purple-700 mb-1">
                        Année 1
                      </label>
                      <select
                        value={filters.year1}
                        onChange={(e) => setFilters(f => ({ ...f, year1: parseInt(e.target.value) }))}
                        className="block w-full rounded-lg border border-purple-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
                      >
                        {availableYears.map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-purple-700 mb-1">
                        Année 2
                      </label>
                      <select
                        value={filters.year2}
                        onChange={(e) => setFilters(f => ({ ...f, year2: parseInt(e.target.value) }))}
                        className="block w-full rounded-lg border border-purple-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
                      >
                        {availableYears.map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Comparaison par mois spécifiques */}
                {filters.compareMode === 'monthly' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-green-700">
                        Mois 1
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={filters.month1}
                          onChange={(e) => setFilters(f => ({ ...f, month1: parseInt(e.target.value) }))}
                          className="block w-full rounded-lg border border-green-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none"
                        >
                          {MONTHS_SHORT.map((month, index) => (
                            <option key={index} value={index + 1}>{month}</option>
                          ))}
                        </select>
                        <select
                          value={filters.year1}
                          onChange={(e) => setFilters(f => ({ ...f, year1: parseInt(e.target.value) }))}
                          className="block w-full rounded-lg border border-green-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none"
                        >
                          {availableYears.map(year => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-green-700">
                        Mois 2
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={filters.month2}
                          onChange={(e) => setFilters(f => ({ ...f, month2: parseInt(e.target.value) }))}
                          className="block w-full rounded-lg border border-green-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none"
                        >
                          {MONTHS_SHORT.map((month, index) => (
                            <option key={index} value={index + 1}>{month}</option>
                          ))}
                        </select>
                        <select
                          value={filters.year2}
                          onChange={(e) => setFilters(f => ({ ...f, year2: parseInt(e.target.value) }))}
                          className="block w-full rounded-lg border border-green-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 focus:outline-none"
                        >
                          {availableYears.map(year => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Types de données */}
            <DataTypeFilter
              selected={filters.dataTypes}
              onChange={(types) => setFilters(f => ({ ...f, dataTypes: types }))}
            />

            {/* Bouton pour afficher les filtres avancés */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-800"
            >
              <Settings2 className="w-4 h-4" />
              {showAdvanced ? 'Masquer les filtres avancés' : 'Afficher les filtres avancés'}
              <ChevronDown className={cn("w-4 h-4 transition-transform", showAdvanced && "rotate-180")} />
            </button>

            {/* Filtres avancés */}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg overflow-visible relative z-10">
                {!loadingFilters && filterOptions && (
                  <>
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
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Chargement */}
      {(loadingData || loadingCharts) && (
        <Card>
          <CardBody className="py-12 text-center">
            <LoadingInline />
            <p className="mt-2 text-gray-500">Chargement des données...</p>
          </CardBody>
        </Card>
      )}

      {/* Contenu */}
      {!loadingData && !loadingCharts && summary.totalCost === 0 && !trackingData?.fuel?.length && !trackingData?.maintenance?.length && !trackingData?.technicalControl?.length && (
        <Card>
          <CardBody className="py-16 text-center">
            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">Aucune donnée pour cette période</h3>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              Modifiez les dates ou les filtres pour afficher des données de suivi. Vérifiez que des entrées de carburant, d'entretien ou de contrôle technique existent pour la période sélectionnée.
            </p>
          </CardBody>
        </Card>
      )}

      {!loadingData && !loadingCharts && (summary.totalCost > 0 || trackingData?.fuel?.length || trackingData?.maintenance?.length || trackingData?.technicalControl?.length) && (
        <>
          {/* Cartes statistiques */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Coût total"
              value={formatCurrency(summary.totalCost)}
              icon={BarChart3}
              color="purple"
              comparison={comparison?.percentageChange?.totalCost}
              trend={comparison?.difference?.totalCost > 0 ? 'up' : comparison?.difference?.totalCost < 0 ? 'down' : 'neutral'}
            />
            {filters.dataTypes.includes('fuel') && (
              <StatCard
                title="Carburant"
                value={formatCurrency(summary.totalFuelCost)}
                icon={Fuel}
                color="amber"
                comparison={comparison?.percentageChange?.totalFuelCost}
                trend={comparison?.difference?.totalFuelCost > 0 ? 'up' : comparison?.difference?.totalFuelCost < 0 ? 'down' : 'neutral'}
              />
            )}
            {filters.dataTypes.includes('maintenance') && (
              <StatCard
                title="Entretiens"
                value={formatCurrency(summary.totalMaintenanceCost)}
                icon={Wrench}
                color="blue"
                comparison={comparison?.percentageChange?.totalMaintenanceCost}
                trend={comparison?.difference?.totalMaintenanceCost > 0 ? 'up' : comparison?.difference?.totalMaintenanceCost < 0 ? 'down' : 'neutral'}
              />
            )}
            {filters.dataTypes.includes('technical_control') && (
              <StatCard
                title="Contrôles techniques"
                value={formatCurrency(summary.totalControlCost)}
                icon={ClipboardCheck}
                color="green"
                comparison={comparison?.percentageChange?.totalControlCost}
                trend={comparison?.difference?.totalControlCost > 0 ? 'up' : comparison?.difference?.totalControlCost < 0 ? 'down' : 'neutral'}
              />
            )}
            {filters.dataTypes.includes('green_space') && (
              <StatCard
                title="Espaces verts"
                value={formatCurrency(summary.totalGreenSpaceCost || 0)}
                icon={TreePine}
                color="emerald"
              />
            )}
          </div>

          {/* Cartes secondaires carburant */}
          {filters.dataTypes.includes('fuel') && (
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
                {filters.dataTypes.includes('fuel') && (
                  <Tab 
                    value="fuel"
                    label={`Carburant (${trackingData?.fuel?.length || 0})`}
                    icon={<Fuel className="w-4 h-4" />}
                  />
                )}
                {filters.dataTypes.includes('maintenance') && (
                  <Tab 
                    value="maintenance"
                    label={`Entretiens (${trackingData?.maintenance?.length || 0})`}
                    icon={<Wrench className="w-4 h-4" />}
                  />
                )}
                {filters.dataTypes.includes('technical_control') && (
                  <Tab 
                    value="control"
                    label={`Contrôles (${trackingData?.technicalControl?.length || 0})`}
                    icon={<ClipboardCheck className="w-4 h-4" />}
                  />
                )}
                {filters.dataTypes.includes('green_space') && (
                  <Tab 
                    value="green_space"
                    label={`Espaces verts (${trackingData?.greenSpace?.length || 0})`}
                    icon={<TreePine className="w-4 h-4" />}
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
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Évolution des coûts</h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={chartsData.costByPeriod}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="#6b7280" angle={-45} textAnchor="end" height={60} />
                            <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {filters.dataTypes.includes('fuel') && (
                              <Bar dataKey="fuelCost" name="Carburant" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            )}
                            {filters.dataTypes.includes('maintenance') && (
                              <Bar dataKey="maintenanceCost" name="Entretiens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            )}
                            {filters.dataTypes.includes('technical_control') && (
                              <Bar dataKey="controlCost" name="Contrôles" fill="#10b981" radius={[4, 4, 0, 0]} />
                            )}
                            <Line type="monotone" dataKey="totalCost" name="Total" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Coûts par objet */}
                  {chartsData?.costByObject?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Coûts par objet (Top 10)</h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.costByObject.slice(0, 10)} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} />
                            <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 9 }} stroke="#6b7280" />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {filters.dataTypes.includes('fuel') && (
                              <Bar dataKey="fuelCost" name="Carburant" fill="#f59e0b" stackId="a" />
                            )}
                            {filters.dataTypes.includes('maintenance') && (
                              <Bar dataKey="maintenanceCost" name="Entretiens" fill="#3b82f6" stackId="a" />
                            )}
                            {filters.dataTypes.includes('technical_control') && (
                              <Bar dataKey="controlCost" name="Contrôles" fill="#10b981" stackId="a" />
                            )}
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
                        <Card className="border-2 border-blue-200">
                          <CardBody className="p-4">
                            <h4 className="font-semibold text-blue-700 mb-3">
                              Période actuelle
                              <span className="block text-xs font-normal text-gray-500 mt-1">
                                {new Date(filters.startDate).toLocaleDateString('fr-FR')} - {new Date(filters.endDate).toLocaleDateString('fr-FR')}
                              </span>
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Coût total</span>
                                <span className="font-bold text-lg">{formatCurrency(summary.totalCost)}</span>
                              </div>
                              {filters.dataTypes.includes('fuel') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Carburant</span>
                                  <span className="font-medium text-amber-600">{formatCurrency(summary.totalFuelCost)}</span>
                                </div>
                              )}
                              {filters.dataTypes.includes('maintenance') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Entretiens</span>
                                  <span className="font-medium text-blue-600">{formatCurrency(summary.totalMaintenanceCost)}</span>
                                </div>
                              )}
                              {filters.dataTypes.includes('technical_control') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Contrôles</span>
                                  <span className="font-medium text-green-600">{formatCurrency(summary.totalControlCost)}</span>
                                </div>
                              )}
                            </div>
                          </CardBody>
                        </Card>

                        <Card className="border-2 border-indigo-200">
                          <CardBody className="p-4">
                            <h4 className="font-semibold text-indigo-700 mb-3">
                              Période de comparaison
                              <span className="block text-xs font-normal text-gray-500 mt-1">
                                {new Date(filters.compareStartDate).toLocaleDateString('fr-FR')} - {new Date(filters.compareEndDate).toLocaleDateString('fr-FR')}
                              </span>
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Coût total</span>
                                <span className="font-bold text-lg">{formatCurrency(comparison.summary?.totalCost || 0)}</span>
                              </div>
                              {filters.dataTypes.includes('fuel') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Carburant</span>
                                  <span className="font-medium text-amber-600">{formatCurrency(comparison.summary?.totalFuelCost || 0)}</span>
                                </div>
                              )}
                              {filters.dataTypes.includes('maintenance') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Entretiens</span>
                                  <span className="font-medium text-blue-600">{formatCurrency(comparison.summary?.totalMaintenanceCost || 0)}</span>
                                </div>
                              )}
                              {filters.dataTypes.includes('technical_control') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Contrôles</span>
                                  <span className="font-medium text-green-600">{formatCurrency(comparison.summary?.totalControlCost || 0)}</span>
                                </div>
                              )}
                            </div>
                          </CardBody>
                        </Card>
                      </div>

                      {/* Différence pour périodes */}
                      <Card className={cn(
                        "border-2",
                        comparison.difference?.totalCost > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
                      )}>
                        <CardBody className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-semibold text-gray-900">Différence entre périodes</h4>
                              <p className="text-sm text-gray-500">
                                {comparison.difference?.totalCost > 0 
                                  ? `Augmentation de ${comparison.percentageChange?.totalCost || 0}%` 
                                  : `Réduction de ${Math.abs(parseFloat(comparison.percentageChange?.totalCost) || 0).toFixed(1)}%`
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
                          <Card className="border-2 border-purple-200">
                            <CardBody className="p-4">
                              <h4 className="font-semibold text-purple-700 mb-3">
                                {filters.compareMode === 'monthly' 
                                  ? `${MONTHS_SHORT[filters.month1 - 1]} ${filters.year1}`
                                  : `Année ${filters.year1}`
                                }
                              </h4>
                              <div className="space-y-2">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Coût total</span>
                                  <span className="font-bold text-lg">{formatCurrency(yearlyData.summary.year1.total)}</span>
                                </div>
                                {filters.dataTypes.includes('fuel') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Carburant</span>
                                    <span className="font-medium text-amber-600">{formatCurrency(yearlyData.summary.year1.fuel)}</span>
                                  </div>
                                )}
                                {filters.dataTypes.includes('maintenance') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Entretiens</span>
                                    <span className="font-medium text-blue-600">{formatCurrency(yearlyData.summary.year1.maintenance)}</span>
                                  </div>
                                )}
                                {filters.dataTypes.includes('technical_control') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Contrôles</span>
                                    <span className="font-medium text-green-600">{formatCurrency(yearlyData.summary.year1.control)}</span>
                                  </div>
                                )}
                              </div>
                            </CardBody>
                          </Card>

                          <Card className="border-2 border-indigo-200">
                            <CardBody className="p-4">
                              <h4 className="font-semibold text-indigo-700 mb-3">
                                {filters.compareMode === 'monthly' 
                                  ? `${MONTHS_SHORT[filters.month2 - 1]} ${filters.year2}`
                                  : `Année ${filters.year2}`
                                }
                              </h4>
                              <div className="space-y-2">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Coût total</span>
                                  <span className="font-bold text-lg">{formatCurrency(yearlyData.summary.year2.total)}</span>
                                </div>
                                {filters.dataTypes.includes('fuel') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Carburant</span>
                                    <span className="font-medium text-amber-600">{formatCurrency(yearlyData.summary.year2.fuel)}</span>
                                  </div>
                                )}
                                {filters.dataTypes.includes('maintenance') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Entretiens</span>
                                    <span className="font-medium text-blue-600">{formatCurrency(yearlyData.summary.year2.maintenance)}</span>
                                  </div>
                                )}
                                {filters.dataTypes.includes('technical_control') && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Contrôles</span>
                                    <span className="font-medium text-green-600">{formatCurrency(yearlyData.summary.year2.control)}</span>
                                  </div>
                                )}
                              </div>
                            </CardBody>
                          </Card>
                        </div>
                      )}

                      {/* Différence */}
                      {yearlyData?.difference && (
                        <Card className={cn(
                          "border-2",
                          yearlyData.difference.total > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
                        )}>
                          <CardBody className="p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-semibold text-gray-900">
                                  Différence {filters.compareMode === 'monthly' 
                                    ? `${MONTHS_SHORT[filters.month1 - 1]} ${filters.year1} vs ${MONTHS_SHORT[filters.month2 - 1]} ${filters.year2}`
                                    : `${filters.year1} vs ${filters.year2}`
                                  }
                                </h4>
                                <p className="text-sm text-gray-500">
                                  {yearlyData.difference.total > 0 
                                    ? `Augmentation de ${yearlyData.difference.percentage?.toFixed(1)}%` 
                                    : `Réduction de ${Math.abs(yearlyData.difference.percentage || 0).toFixed(1)}%`
                                  }
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
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">
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

                      {/* Graphiques par type (uniquement pour mode yearly) */}
                      {filters.compareMode === 'yearly' && filters.dataTypes.includes('fuel') && comparisonChartData.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">
                            <Fuel className="w-5 h-5 inline-block mr-2 text-amber-500" />
                            Carburant : {filters.year1} vs {filters.year2}
                          </h3>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={comparisonChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#6b7280" />
                                <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey={`fuel_${filters.year1}`} name={`${filters.year1}`} stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b' }} />
                                <Line type="monotone" dataKey={`fuel_${filters.year2}`} name={`${filters.year2}`} stroke="#d97706" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: '#d97706' }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {filters.compareMode === 'yearly' && filters.dataTypes.includes('maintenance') && comparisonChartData.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">
                            <Wrench className="w-5 h-5 inline-block mr-2 text-blue-500" />
                            Entretiens : {filters.year1} vs {filters.year2}
                          </h3>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={comparisonChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#6b7280" />
                                <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" tickFormatter={formatAxisValue} width={50} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey={`maintenance_${filters.year1}`} name={`${filters.year1}`} stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                                <Line type="monotone" dataKey={`maintenance_${filters.year2}`} name={`${filters.year2}`} stroke="#1d4ed8" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: '#1d4ed8' }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Message si aucune comparaison n'est configurée */}
                  {!comparison && !yearlyData && (
                    <div className="text-center py-12">
                      <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">Sélectionnez un mode de comparaison et configurez les paramètres pour voir les résultats.</p>
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
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Espace vert</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Intervenant</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Durée</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Coût</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prochain</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {trackingData.greenSpace.map((g: any) => (
                        <tr key={g.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{g.spaceName}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{g.type}{g.title ? ` - ${g.title}` : ''}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{g.date ? new Date(g.date).toLocaleDateString('fr-FR') : '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{g.performer || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{g.duration ? `${g.duration} min` : '-'}</td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(g.cost)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{g.nextDate ? new Date(g.nextDate).toLocaleDateString('fr-FR') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Modal d'export PDF */}
      {showPDFExport && (
        <TrackingPDFExport
          filters={filters}
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
          <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                <Paperclip className="w-5 h-5 inline-block mr-2" />
                Pièces jointes ({viewingAttachments.length})
              </h3>
              <button onClick={() => setViewingAttachments(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              {viewingAttachments.map((attachment: any, index: number) => (
                <a
                  key={index}
                  href={attachment.url || attachment}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50"
                >
                  <FileText className="w-8 h-8 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {attachment.name || `Fichier ${index + 1}`}
                    </div>
                    {attachment.size && (
                      <div className="text-xs text-gray-500">{attachment.size}</div>
                    )}
                  </div>
                  <Download className="w-4 h-4 text-gray-400" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
