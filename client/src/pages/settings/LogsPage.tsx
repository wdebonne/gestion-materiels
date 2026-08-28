import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  FileText, Search, Download, Trash2, RefreshCw,
  AlertTriangle, AlertCircle, Info, CheckCircle, Bug, Settings,
  User, Globe, Clock, ChevronLeft, ChevronRight,
  Database, Shield, Mail, Puzzle, Server, Activity, X
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, 
  Modal, ModalBody, ModalFooter, Badge, LoadingInline, Input
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

// Types
type LogLevel = 'info' | 'warning' | 'error' | 'debug' | 'success'
type LogCategory = 'auth' | 'system' | 'user' | 'backup' | 'plugin' | 'database' | 'email' | 'api' | 'security' | 'other'

interface LogEntry {
  id: number
  level: LogLevel
  category: LogCategory
  message: string
  details?: string
  userId?: number
  userEmail?: string
  ipAddress?: string
  userAgent?: string
  requestPath?: string
  requestMethod?: string
  createdAt: string
}

interface LogSettings {
  retentionDays: number
  enabledLevels: LogLevel[]
  enabledCategories: LogCategory[]
  autoCleanup: boolean
  logApiRequests: boolean
  logAuthAttempts: boolean
  logSystemEvents: boolean
  maxLogsPerExport: number
}

interface LogStats {
  totalLogs: number
  byLevel: Record<LogLevel, number>
  byCategory: Record<LogCategory, number>
  last24h: number
  last7d: number
  last30d: number
}

// Configuration des niveaux et catégories
const LOG_LEVELS: { value: LogLevel; label: string; color: string; icon: React.ElementType }[] = [
  { value: 'info', label: 'Information', color: 'blue', icon: Info },
  { value: 'success', label: 'Succès', color: 'green', icon: CheckCircle },
  { value: 'warning', label: 'Avertissement', color: 'yellow', icon: AlertTriangle },
  { value: 'error', label: 'Erreur', color: 'red', icon: AlertCircle },
  { value: 'debug', label: 'Debug', color: 'gray', icon: Bug },
]

const LOG_CATEGORIES: { value: LogCategory; label: string; icon: React.ElementType }[] = [
  { value: 'auth', label: 'Authentification', icon: Shield },
  { value: 'system', label: 'Système', icon: Server },
  { value: 'user', label: 'Utilisateur', icon: User },
  { value: 'backup', label: 'Sauvegarde', icon: Database },
  { value: 'plugin', label: 'Plugin', icon: Puzzle },
  { value: 'database', label: 'Base de données', icon: Database },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'api', label: 'API', icon: Globe },
  { value: 'security', label: 'Sécurité', icon: Shield },
  { value: 'other', label: 'Autre', icon: Activity },
]

export default function LogsPage() {
  // États des filtres
  const [search, setSearch] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>([])
  const [selectedCategories, setSelectedCategories] = useState<LogCategory[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  // États des modals
  const [showSettings, setShowSettings] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLogDetails, setShowLogDetails] = useState<LogEntry | null>(null)
  const [deleteAll, setDeleteAll] = useState(false)
  
  // États des paramètres
  const [settings, setSettings] = useState<LogSettings | null>(null)

  // Construire les paramètres de requête
  const buildQueryParams = () => {
    const params = new URLSearchParams()
    if (search) params.append('search', search)
    if (selectedLevels.length > 0) params.append('level', selectedLevels.join(','))
    if (selectedCategories.length > 0) params.append('category', selectedCategories.join(','))
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    params.append('limit', pageSize.toString())
    params.append('offset', ((page - 1) * pageSize).toString())
    return params.toString()
  }

  // Récupérer les logs
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['logs', search, selectedLevels, selectedCategories, startDate, endDate, page, pageSize],
    queryFn: async () => {
      const response = await api.get(`/logs?${buildQueryParams()}`)
      return response.data
    }
  })

  // Récupérer les statistiques
  const { data: statsData, refetch: refetchStats } = useQuery({
    queryKey: ['logs-stats'],
    queryFn: async () => {
      const response = await api.get('/logs/stats')
      return response.data
    }
  })

  // Récupérer les paramètres
  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['logs-settings'],
    queryFn: async () => {
      const response = await api.get('/logs/settings')
      return response.data
    }
  })

  useEffect(() => {
    if (settingsData?.settings) {
      setSettings(settingsData.settings)
    }
  }, [settingsData])

  // Mutation pour sauvegarder les paramètres
  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: LogSettings) => {
      return api.put('/logs/settings', { settings: newSettings })
    },
    onSuccess: () => {
      toast.success('Paramètres sauvegardés')
      refetchSettings()
      setShowSettings(false)
    },
    onError: () => {
      toast.error('Erreur lors de la sauvegarde')
    }
  })

  // Mutation pour supprimer des logs
  const deleteMutation = useMutation({
    mutationFn: async () => {
      return api.delete('/logs', { 
        data: {
          deleteAll,
          level: selectedLevels.length > 0 ? selectedLevels : undefined,
          category: selectedCategories.length > 0 ? selectedCategories : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined
        }
      })
    },
    onSuccess: (response) => {
      toast.success(`${response.data.deletedCount} logs supprimés`)
      setShowDeleteConfirm(false)
      setDeleteAll(false)
      refetchLogs()
      refetchStats()
    },
    onError: () => {
      toast.error('Erreur lors de la suppression')
    }
  })

  // Mutation pour le nettoyage automatique
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      return api.post('/logs/cleanup')
    },
    onSuccess: (response) => {
      toast.success(`${response.data.deletedCount} logs nettoyés`)
      refetchLogs()
      refetchStats()
    },
    onError: () => {
      toast.error('Erreur lors du nettoyage')
    }
  })

  // Exporter les logs
  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const params = new URLSearchParams()
      params.append('format', format)
      if (selectedLevels.length > 0) params.append('level', selectedLevels.join(','))
      if (selectedCategories.length > 0) params.append('category', selectedCategories.join(','))
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)
      if (search) params.append('search', search)

      const response = await api.get(`/logs/export?${params.toString()}`, {
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `logs_export_${new Date().toISOString().split('T')[0]}.${format}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      toast.success('Export réussi')
    } catch {
      toast.error('Erreur lors de l\'export')
    }
  }

  // Réinitialiser les filtres
  const resetFilters = () => {
    setSearch('')
    setSelectedLevels([])
    setSelectedCategories([])
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  // Obtenir la couleur du badge selon le niveau
  const getLevelBadge = (level: LogLevel) => {
    const config = LOG_LEVELS.find(l => l.value === level)
    if (!config) return <Badge>{level}</Badge>
    
    const Icon = config.icon
    const colorMap: Record<string, string> = {
      blue: 'bg-blue-100 text-blue-800',
      green: 'bg-green-100 text-green-800',
      yellow: 'bg-yellow-100 text-yellow-800',
      red: 'bg-red-100 text-red-800',
      gray: 'bg-gray-100 text-gray-800',
    }
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${colorMap[config.color]}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    )
  }

  // Obtenir l'icône de la catégorie
  const getCategoryBadge = (category: LogCategory) => {
    const config = LOG_CATEGORIES.find(c => c.value === category)
    if (!config) return <Badge>{category}</Badge>
    
    const Icon = config.icon
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    )
  }

  // Formater la date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const logs: LogEntry[] = logsData?.logs || []
  const total = logsData?.total || 0
  const totalPages = Math.ceil(total / pageSize)
  const stats: LogStats | undefined = statsData?.stats

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal des logs</h1>
          <p className="text-gray-500 mt-1">Consultez et gérez les journaux d'activité du système</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => { refetchLogs(); refetchStats(); }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Actualiser
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="w-4 h-4 mr-2" />
            Paramètres
          </Button>
        </div>
      </div>

      {/* Statistiques */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalLogs.toLocaleString()}</div>
              <div className="text-sm text-gray-500">Total logs</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-blue-600">{stats.last24h.toLocaleString()}</div>
              <div className="text-sm text-gray-500">24 dernières heures</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-green-600">{stats.last7d.toLocaleString()}</div>
              <div className="text-sm text-gray-500">7 derniers jours</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-red-600">{stats.byLevel?.error || 0}</div>
              <div className="text-sm text-gray-500">Erreurs</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.byLevel?.warning || 0}</div>
              <div className="text-sm text-gray-500">Avertissements</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-4">
              <div className="text-2xl font-bold text-purple-600">{stats.last30d.toLocaleString()}</div>
              <div className="text-sm text-gray-500">30 derniers jours</div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Filtres */}
      <Card>
        <CardBody>
          <div className="space-y-4">
            {/* Barre de recherche */}
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  type="text"
                  placeholder="Rechercher dans les logs..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Filtres avancés */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Filtres de niveau */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Niveaux</label>
                <div className="flex flex-wrap gap-2">
                  {LOG_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => {
                        setSelectedLevels(prev => 
                          prev.includes(level.value) 
                            ? prev.filter(l => l !== level.value)
                            : [...prev, level.value]
                        )
                        setPage(1)
                      }}
                      className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                        selectedLevels.includes(level.value)
                          ? 'bg-primary-100 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtres de catégorie */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Catégories</label>
                <div className="flex flex-wrap gap-2">
                  {LOG_CATEGORIES.slice(0, 5).map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => {
                        setSelectedCategories(prev => 
                          prev.includes(cat.value) 
                            ? prev.filter(c => c !== cat.value)
                            : [...prev, cat.value]
                        )
                        setPage(1)
                      }}
                      className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                        selectedCategories.includes(cat.value)
                          ? 'bg-primary-100 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date de début */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date de début</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                />
              </div>

              {/* Date de fin */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date de fin</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-gray-200">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  <X className="w-4 h-4 mr-1" />
                  Réinitialiser
                </Button>
                <span className="text-sm text-gray-500 py-2">
                  {total.toLocaleString()} log(s) trouvé(s)
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
                  <Download className="w-4 h-4 mr-1" />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('json')}>
                  <Download className="w-4 h-4 mr-1" />
                  Export JSON
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Supprimer
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Liste des logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Logs récents
          </CardTitle>
        </CardHeader>
        <CardBody>
          {logsLoading ? (
            <div className="flex justify-center py-8">
              <LoadingInline />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Aucun log trouvé avec les filtres actuels
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Niveau</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Catégorie</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utilisateur</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-gray-600" />
                          {formatDate(log.createdAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getLevelBadge(log.level)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getCategoryBadge(log.category)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-md truncate">
                        {log.message}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {log.userEmail || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowLogDetails(log)}
                        >
                          Détails
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Afficher</span>
                <select
                  value={pageSize.toString()}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
                <span className="text-sm text-gray-500">par page</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-gray-600">
                  Page {page} sur {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Modal des détails */}
      <Modal isOpen={!!showLogDetails} onClose={() => setShowLogDetails(null)} title="Détails du log">
        {showLogDetails && (
          <ModalBody>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Date</label>
                  <p className="mt-1 text-sm text-gray-900">{formatDate(showLogDetails.createdAt)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">ID</label>
                  <p className="mt-1 text-sm text-gray-900">#{showLogDetails.id}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Niveau</label>
                  <div className="mt-1">{getLevelBadge(showLogDetails.level)}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Catégorie</label>
                  <div className="mt-1">{getCategoryBadge(showLogDetails.category)}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500">Message</label>
                <p className="mt-1 text-sm text-gray-900">{showLogDetails.message}</p>
              </div>

              {showLogDetails.details && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">Détails</label>
                  <pre className="mt-1 text-sm text-gray-900 bg-gray-50 p-3 rounded-lg overflow-x-auto">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(showLogDetails.details), null, 2)
                      } catch {
                        return showLogDetails.details
                      }
                    })()}
                  </pre>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {showLogDetails.userEmail && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Utilisateur</label>
                    <p className="mt-1 text-sm text-gray-900">{showLogDetails.userEmail}</p>
                  </div>
                )}
                {showLogDetails.ipAddress && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Adresse IP</label>
                    <p className="mt-1 text-sm text-gray-900">{showLogDetails.ipAddress}</p>
                  </div>
                )}
                {showLogDetails.requestMethod && showLogDetails.requestPath && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-500">Requête</label>
                    <p className="mt-1 text-sm text-gray-900 font-mono">
                      {showLogDetails.requestMethod} {showLogDetails.requestPath}
                    </p>
                  </div>
                )}
                {showLogDetails.userAgent && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-500">User Agent</label>
                    <p className="mt-1 text-sm text-gray-900 break-all">{showLogDetails.userAgent}</p>
                  </div>
                )}
              </div>
            </div>
          </ModalBody>
        )}
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowLogDetails(null)}>
            Fermer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal des paramètres */}
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Paramètres des logs">
        {settings && (
          <>
            <ModalBody>
              <div className="space-y-6">
                {/* Rétention */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Durée de rétention des logs (jours)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={settings.retentionDays}
                    onChange={(e) => setSettings({ ...settings, retentionDays: parseInt(e.target.value) || 90 })}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Les logs plus anciens seront automatiquement supprimés
                  </p>
                </div>

                {/* Nettoyage automatique */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Nettoyage automatique</label>
                    <p className="text-sm text-gray-500">Supprimer automatiquement les vieux logs</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoCleanup}
                      onChange={(e) => setSettings({ ...settings, autoCleanup: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                {/* Niveaux activés */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Niveaux de logs activés</label>
                  <div className="flex flex-wrap gap-2">
                    {LOG_LEVELS.map((level) => (
                      <button
                        key={level.value}
                        onClick={() => {
                          const newLevels = settings.enabledLevels.includes(level.value)
                            ? settings.enabledLevels.filter(l => l !== level.value)
                            : [...settings.enabledLevels, level.value]
                          setSettings({ ...settings, enabledLevels: newLevels })
                        }}
                        className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                          settings.enabledLevels.includes(level.value)
                            ? 'bg-primary-100 border-primary-300 text-primary-700'
                            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Catégories activées */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Catégories de logs activées</label>
                  <div className="flex flex-wrap gap-2">
                    {LOG_CATEGORIES.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => {
                          const newCategories = settings.enabledCategories.includes(cat.value)
                            ? settings.enabledCategories.filter(c => c !== cat.value)
                            : [...settings.enabledCategories, cat.value]
                          setSettings({ ...settings, enabledCategories: newCategories })
                        }}
                        className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                          settings.enabledCategories.includes(cat.value)
                            ? 'bg-primary-100 border-primary-300 text-primary-700'
                            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Limite d'export */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre max de logs par export
                  </label>
                  <Input
                    type="number"
                    min="1000"
                    max="100000"
                    value={settings.maxLogsPerExport}
                    onChange={(e) => setSettings({ ...settings, maxLogsPerExport: parseInt(e.target.value) || 50000 })}
                  />
                </div>

                {/* Options supplémentaires */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Logger les requêtes API</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.logApiRequests}
                        onChange={(e) => setSettings({ ...settings, logApiRequests: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Logger les tentatives d'authentification</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.logAuthAttempts}
                        onChange={(e) => setSettings({ ...settings, logAuthAttempts: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Logger les événements système</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.logSystemEvents}
                        onChange={(e) => setSettings({ ...settings, logSystemEvents: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>
                </div>

                {/* Nettoyage manuel */}
                <div className="pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => cleanupMutation.mutate()}
                    disabled={cleanupMutation.isPending}
                  >
                    {cleanupMutation.isPending ? <LoadingInline /> : (
                      <>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Nettoyer les vieux logs maintenant
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="outline" onClick={() => setShowSettings(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => saveSettingsMutation.mutate(settings)}
                disabled={saveSettingsMutation.isPending}
              >
                {saveSettingsMutation.isPending ? <LoadingInline /> : 'Sauvegarder'}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Modal de confirmation de suppression */}
      <Modal isOpen={showDeleteConfirm} onClose={() => { setShowDeleteConfirm(false); setDeleteAll(false); }} title="Supprimer des logs">
        <ModalBody>
          <div className="rounded-lg border p-4 flex gap-3 bg-yellow-50 border-yellow-200 mb-4">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-yellow-600" />
            <span className="text-yellow-700">Cette action est irréversible. Les logs supprimés ne pourront pas être récupérés.</span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="deleteAll"
                checked={deleteAll}
                onChange={(e) => setDeleteAll(e.target.checked)}
                className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
              />
              <label htmlFor="deleteAll" className="text-sm font-medium text-gray-700">
                Supprimer TOUS les logs
              </label>
            </div>

            {!deleteAll && (
              <div className="text-sm text-gray-600">
                <p>Seront supprimés les logs correspondant aux filtres actuels :</p>
                <ul className="mt-2 list-disc list-inside">
                  {selectedLevels.length > 0 && (
                    <li>Niveaux : {selectedLevels.join(', ')}</li>
                  )}
                  {selectedCategories.length > 0 && (
                    <li>Catégories : {selectedCategories.join(', ')}</li>
                  )}
                  {startDate && <li>À partir du : {startDate}</li>}
                  {endDate && <li>Jusqu'au : {endDate}</li>}
                  {!selectedLevels.length && !selectedCategories.length && !startDate && !endDate && (
                    <li className="text-yellow-600">Aucun filtre sélectionné - tous les logs seront supprimés</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => { setShowDeleteConfirm(false); setDeleteAll(false); }}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <LoadingInline /> : 'Supprimer'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
