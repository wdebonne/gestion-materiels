import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  BarChart3, TrendingUp, TrendingDown, Calendar, 
  Download, Fuel, Wrench, ClipboardCheck, ChevronDown, ChevronUp,
  X, Search, RefreshCw, ArrowRightLeft, FileText, Paperclip,
  Building, Car, FolderOpen, Settings2, Eye, EyeOff
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, Button, Badge, 
  LoadingInline, Alert, Input, Tabs, Tab
} from '@/components/ui'
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
  dataTypes: ('fuel' | 'maintenance' | 'technical_control')[]
  maintenanceTypes: string[]
  fuelTypes: string[]
  compareEnabled: boolean
  compareStartDate: string
  compareEndDate: string
  groupBy: 'month' | 'week' | 'year'
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
  selected: ('fuel' | 'maintenance' | 'technical_control')[]
  onChange: (types: ('fuel' | 'maintenance' | 'technical_control')[]) => void
}) {
  const types = [
    { id: 'fuel' as const, label: 'Carburant', icon: Fuel, color: 'amber' },
    { id: 'maintenance' as const, label: 'Entretiens', icon: Wrench, color: 'blue' },
    { id: 'technical_control' as const, label: 'Contrôle technique', icon: ClipboardCheck, color: 'green' },
  ]

  const colorClasses: Record<string, string> = {
    amber: 'border-amber-300 bg-amber-50 text-amber-700',
    blue: 'border-blue-300 bg-blue-50 text-blue-700',
    green: 'border-green-300 bg-green-50 text-green-700',
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

// Composant graphique simple (barres)
function SimpleBarChart({
  data,
  dataKey = 'cost',
  labelKey = 'period',
  color = '#3b82f6',
  formatValue = formatCurrency,
  height = 200
}: {
  data: any[]
  dataKey?: string
  labelKey?: string
  color?: string
  formatValue?: (value: number) => string
  height?: number
}) {
  if (!data.length) return null

  const maxValue = Math.max(...data.map(d => d[dataKey] || 0))
  
  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end justify-between gap-1 h-full">
        {data.map((item, index) => {
          const value = item[dataKey] || 0
          const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0
          
          return (
            <div 
              key={index} 
              className="flex-1 flex flex-col items-center group"
              style={{ maxWidth: `${100 / data.length}%` }}
            >
              <div 
                className="w-full relative rounded-t transition-all hover:opacity-80"
                style={{ 
                  height: `${Math.max(percentage, 2)}%`,
                  backgroundColor: color,
                  minHeight: '4px'
                }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                  {formatValue(value)}
                </div>
              </div>
              <span className="text-xs text-gray-500 mt-1 truncate w-full text-center">
                {item[labelKey]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Composant graphique donut simple
function SimpleDonutChart({
  data,
  colors = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'],
  size = 150
}: {
  data: { label: string; value: number; color?: string }[]
  colors?: string[]
  size?: number
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return null

  let cumulativePercent = 0
  const segments = data.map((item, index) => {
    const percent = (item.value / total) * 100
    const startPercent = cumulativePercent
    cumulativePercent += percent
    return {
      ...item,
      percent,
      startPercent,
      color: item.color || colors[index % colors.length]
    }
  })

  const strokeWidth = 30
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="transform -rotate-90">
        {segments.map((segment, index) => {
          const offset = (segment.startPercent / 100) * circumference
          const length = (segment.percent / 100) * circumference
          
          return (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              className="transition-all"
            />
          )
        })}
      </svg>
      <div className="flex flex-col gap-1">
        {segments.map((segment, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-gray-600">{segment.label}</span>
            <span className="font-medium text-gray-900">
              {formatCurrency(segment.value)}
            </span>
            <span className="text-gray-400">({segment.percent.toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
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
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
              <SortHeader label="Objet" keyName="objectName" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
              <SortHeader label="Type" keyName="fuelType" />
              <SortHeader label="Quantité" keyName="quantity" />
              <SortHeader label="Prix unitaire" keyName="unitPrice" />
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
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
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
              <SortHeader label="Objet" keyName="objectName" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
              <SortHeader label="Type" keyName="type" />
              <SortHeader label="Coût" keyName="cost" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prestataire</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prochaine</th>
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
            <SortHeader label="Objet" keyName="objectName" />
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
            <SortHeader label="Résultat" keyName="result" />
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
  const defaultDates = getDefaultDates()
  const [filters, setFilters] = useState<TrackingFilters>({
    ...defaultDates,
    categoryIds: [],
    subcategoryIds: [],
    objectIds: [],
    dataTypes: ['fuel', 'maintenance', 'technical_control'],
    maintenanceTypes: [],
    fuelTypes: [],
    compareEnabled: false,
    ...getComparisonDates(defaultDates.startDate, defaultDates.endDate),
    groupBy: 'month'
  })
  const [showFilters, setShowFilters] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'fuel' | 'maintenance' | 'control'>('overview')
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
    if (filters.compareEnabled) {
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

  // Mettre à jour les dates de comparaison quand les dates principales changent
  useEffect(() => {
    if (!filters.compareEnabled) {
      const compDates = getComparisonDates(filters.startDate, filters.endDate)
      setFilters(f => ({ ...f, ...compDates }))
    }
  }, [filters.startDate, filters.endDate, filters.compareEnabled])

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
            Analysez les dépenses carburant, entretiens et contrôles techniques
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
        <Card>
          <CardBody className="space-y-4">
            {/* Filtres de base */}
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
                  <Calendar className="w-4 h-4 inline-block mr-1" />
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
                    Comparer avec période précédente
                  </span>
                </label>
              </div>
            </div>

            {/* Période de comparaison */}
            {filters.compareEnabled && permissions?.canCompare && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-blue-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-1">
                    Comparaison - Date de début
                  </label>
                  <Input
                    type="date"
                    value={filters.compareStartDate}
                    onChange={(e) => setFilters(f => ({ ...f, compareStartDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-1">
                    Comparaison - Date de fin
                  </label>
                  <Input
                    type="date"
                    value={filters.compareEndDate}
                    onChange={(e) => setFilters(f => ({ ...f, compareEndDate: e.target.value }))}
                  />
                </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
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
                    {filters.dataTypes.includes('fuel') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Fuel className="w-4 h-4 inline-block mr-1" />
                          Types de carburant
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {filterOptions.fuelTypes.map((type: string) => (
                            <label key={type} className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={filters.fuelTypes.includes(type)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilters(f => ({ ...f, fuelTypes: [...f.fuelTypes, type] }))
                                  } else {
                                    setFilters(f => ({ ...f, fuelTypes: f.fuelTypes.filter(t => t !== type) }))
                                  }
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-primary-600"
                              />
                              <span className="text-sm text-gray-700">{type}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {filters.dataTypes.includes('maintenance') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Wrench className="w-4 h-4 inline-block mr-1" />
                          Types d'entretien
                        </label>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                          {filterOptions.maintenanceTypes.map((type: string) => (
                            <label key={type} className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={filters.maintenanceTypes.includes(type)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilters(f => ({ ...f, maintenanceTypes: [...f.maintenanceTypes, type] }))
                                  } else {
                                    setFilters(f => ({ ...f, maintenanceTypes: f.maintenanceTypes.filter(t => t !== type) }))
                                  }
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-primary-600"
                              />
                              <span className="text-sm text-gray-700">{type}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Bouton réinitialiser */}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                icon={<X className="w-4 h-4" />}
                onClick={() => setFilters({
                  ...getDefaultDates(),
                  categoryIds: [],
                  subcategoryIds: [],
                  objectIds: [],
                  dataTypes: ['fuel', 'maintenance', 'technical_control'],
                  maintenanceTypes: [],
                  fuelTypes: [],
                  compareEnabled: false,
                  ...getComparisonDates(defaultDates.startDate, defaultDates.endDate),
                  groupBy: 'month'
                })}
              >
                Réinitialiser les filtres
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Cartes statistiques */}
      {loadingData ? (
        <div className="py-12"><LoadingInline /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Coût total"
              value={formatCurrency(summary.totalCost)}
              icon={TrendingUp}
              color="purple"
              comparison={comparison?.percentageChange?.totalCost ? parseFloat(comparison.percentageChange.totalCost) : null}
              trend={comparison?.difference?.totalCost > 0 ? 'up' : comparison?.difference?.totalCost < 0 ? 'down' : 'neutral'}
            />
            {filters.dataTypes.includes('fuel') && (
              <StatCard
                title="Carburant"
                value={formatCurrency(summary.totalFuelCost)}
                icon={Fuel}
                color="amber"
                comparison={comparison?.percentageChange?.totalFuelCost ? parseFloat(comparison.percentageChange.totalFuelCost) : null}
                trend={comparison?.difference?.totalFuelCost > 0 ? 'up' : comparison?.difference?.totalFuelCost < 0 ? 'down' : 'neutral'}
              />
            )}
            {filters.dataTypes.includes('maintenance') && (
              <StatCard
                title="Entretiens"
                value={formatCurrency(summary.totalMaintenanceCost)}
                icon={Wrench}
                color="blue"
                comparison={comparison?.percentageChange?.totalMaintenanceCost ? parseFloat(comparison.percentageChange.totalMaintenanceCost) : null}
                trend={comparison?.difference?.totalMaintenanceCost > 0 ? 'up' : comparison?.difference?.totalMaintenanceCost < 0 ? 'down' : 'neutral'}
              />
            )}
            {filters.dataTypes.includes('technical_control') && (
              <StatCard
                title="Contrôles techniques"
                value={formatCurrency(summary.totalControlCost)}
                icon={ClipboardCheck}
                color="green"
                comparison={comparison?.percentageChange?.totalControlCost ? parseFloat(comparison.percentageChange.totalControlCost) : null}
                trend={comparison?.difference?.totalControlCost > 0 ? 'up' : comparison?.difference?.totalControlCost < 0 ? 'down' : 'neutral'}
              />
            )}
          </div>

          {/* Cartes secondaires */}
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
              </Tabs>
            </CardHeader>
            <CardBody>
              {activeTab === 'overview' && (
                <div className="space-y-8">
                  {/* Graphiques */}
                  {loadingCharts ? (
                    <div className="py-12"><LoadingInline /></div>
                  ) : (
                    <>
                      {/* Evolution des coûts */}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Évolution des coûts</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {filters.dataTypes.includes('fuel') && chartsData?.fuelByPeriod?.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-600 mb-2">Carburant</h4>
                              <SimpleBarChart 
                                data={chartsData.fuelByPeriod} 
                                color="#f59e0b"
                              />
                            </div>
                          )}
                          {filters.dataTypes.includes('maintenance') && chartsData?.maintenanceByPeriod?.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-600 mb-2">Entretiens</h4>
                              <SimpleBarChart 
                                data={chartsData.maintenanceByPeriod} 
                                color="#3b82f6"
                              />
                            </div>
                          )}
                          {filters.dataTypes.includes('technical_control') && chartsData?.controlByPeriod?.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-600 mb-2">Contrôles techniques</h4>
                              <SimpleBarChart 
                                data={chartsData.controlByPeriod} 
                                color="#10b981"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Répartition des coûts */}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Répartition des coûts</h3>
                        <div className="flex justify-center">
                          <SimpleDonutChart
                            data={[
                              { label: 'Carburant', value: summary.totalFuelCost, color: '#f59e0b' },
                              { label: 'Entretiens', value: summary.totalMaintenanceCost, color: '#3b82f6' },
                              { label: 'Contrôles', value: summary.totalControlCost, color: '#10b981' },
                            ].filter(d => d.value > 0)}
                            size={180}
                          />
                        </div>
                      </div>

                      {/* Top objets coûteux */}
                      {chartsData?.costByObject?.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 - Objets les plus coûteux</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Objet</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Carburant</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entretiens</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Contrôles</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chartsData.costByObject.map((item: any) => (
                                  <tr key={item.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        {item.image && (
                                          <img src={item.image} alt="" className="w-8 h-8 rounded object-cover" />
                                        )}
                                        <div>
                                          <div className="text-sm font-medium text-gray-900">{item.name}</div>
                                          {item.reference && (
                                            <div className="text-xs text-gray-500">{item.reference}</div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{item.categoryName}</td>
                                    <td className="px-4 py-3 text-sm text-right text-amber-600">{formatCurrency(item.fuelCost)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-blue-600">{formatCurrency(item.maintenanceCost)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-green-600">{formatCurrency(item.controlCost)}</td>
                                    <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{formatCurrency(item.totalCost)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Coûts par catégorie */}
                      {chartsData?.costByCategory?.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Coûts par catégorie</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {chartsData.costByCategory.map((item: any) => (
                              <Card key={item.id}>
                                <CardBody className="p-4">
                                  <div className="flex items-center gap-3 mb-3">
                                    {item.image ? (
                                      <img src={item.image} alt="" className="w-10 h-10 rounded object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
                                        <FolderOpen className="w-5 h-5 text-gray-400" />
                                      </div>
                                    )}
                                    <div>
                                      <div className="font-medium text-gray-900">{item.name}</div>
                                      <div className="text-lg font-bold text-gray-900">{formatCurrency(item.totalCost)}</div>
                                    </div>
                                  </div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">Carburant</span>
                                      <span className="text-amber-600">{formatCurrency(item.fuelCost)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">Entretiens</span>
                                      <span className="text-blue-600">{formatCurrency(item.maintenanceCost)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">Contrôles</span>
                                      <span className="text-green-600">{formatCurrency(item.controlCost)}</span>
                                    </div>
                                  </div>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Type de carburant */}
                      {filters.dataTypes.includes('fuel') && chartsData?.fuelByType?.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Répartition par type de carburant</h3>
                          <div className="flex justify-center">
                            <SimpleDonutChart
                              data={chartsData.fuelByType.map((f: any) => ({
                                label: f.type,
                                value: f.cost
                              }))}
                              colors={['#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6']}
                              size={180}
                            />
                          </div>
                        </div>
                      )}

                      {/* Type d'entretien */}
                      {filters.dataTypes.includes('maintenance') && chartsData?.maintenanceByType?.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Coûts par type d'entretien</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Nombre</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Coût total</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Coût moyen</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chartsData.maintenanceByType.map((item: any, index: number) => (
                                  <tr key={index} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                      <Badge variant="info">{item.type}</Badge>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right text-gray-500">{item.count}</td>
                                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(item.cost)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-gray-500">
                                      {formatCurrency(item.count > 0 ? item.cost / item.count : 0)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
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
          onClose={() => setShowPDFExport(false)}
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
