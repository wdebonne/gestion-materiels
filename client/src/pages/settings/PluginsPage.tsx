import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Puzzle, Settings, ToggleLeft, ToggleRight, Save, Download, Upload, Trash2, AlertTriangle, FolderTree, ChevronDown, ChevronRight, Check, FileArchive, Database, Layout } from 'lucide-react'
import { 
  Card, CardBody, Button, Input,
  Modal, ModalBody, ModalFooter, Badge, LoadingInline, Alert
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface Plugin {
  id: number
  slug: string
  name: string
  description: string
  version: string
  isActive: boolean
  isSystem?: boolean
  pluginType?: 'menu' | 'object'
  route?: string
  settings: Record<string, any>
  associations?: PluginAssociation[]
}

interface PluginAssociation {
  id?: number
  categoryId: number | null
  categoryName?: string
  subcategoryId: number | null
  subcategoryName?: string
}

interface Category {
  id: number
  name: string
  slug: string
  hasSubcategories: boolean
  subcategories?: Subcategory[]
}

interface Subcategory {
  id: number
  name: string
  slug: string
  categoryId: number
}

export default function PluginsPage() {
  const queryClient = useQueryClient()
  const [settingsModal, setSettingsModal] = useState<Plugin | null>(null)
  const [pluginSettings, setPluginSettings] = useState<Record<string, any>>({})
  const [pluginAssociations, setPluginAssociations] = useState<PluginAssociation[]>([])
  const [pluginType, setPluginType] = useState<'menu' | 'object'>('object')
  const [pluginRoute, setPluginRoute] = useState<string>('')
  const [expandedCategories, setExpandedCategories] = useState<number[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<Plugin | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // Récupérer les plugins
  const { data, isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: async () => {
      const response = await api.get('/plugins')
      return response.data
    }
  })

  // Récupérer toutes les catégories avec leurs sous-catégories
  const { data: categoriesData } = useQuery({
    queryKey: ['categories-all-with-subcategories'],
    queryFn: async () => {
      const response = await api.get('/categories/all-with-subcategories')
      return response.data
    }
  })

  // Mutation pour activer/désactiver
  const toggleMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      return api.put(`/plugins/${id}/toggle`)
    },
    onSuccess: () => {
      // Invalider toutes les queries qui dépendent des plugins
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      queryClient.invalidateQueries({ queryKey: ['object'] })
      queryClient.invalidateQueries({ queryKey: ['objects'] })
      toast.success('Plugin mis à jour')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  // Mutation pour sauvegarder les settings
  const saveSettingsMutation = useMutation({
    mutationFn: async ({ id, settings }: { id: number; settings: Record<string, any> }) => {
      return api.put(`/plugins/${id}/settings`, { settings })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      toast.success('Paramètres enregistrés')
      setSettingsModal(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde')
    }
  })

  // Mutation pour sauvegarder les associations
  const saveAssociationsMutation = useMutation({
    mutationFn: async ({ id, associations }: { id: number; associations: PluginAssociation[] }) => {
      return api.put(`/plugins/${id}/associations`, { associations })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      toast.success('Associations sauvegardées')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde des associations')
    }
  })

  // Mutation pour sauvegarder le type de plugin
  const saveTypeMutation = useMutation({
    mutationFn: async ({ id, type, route }: { id: number; type: 'menu' | 'object'; route: string }) => {
      return api.put(`/plugins/${id}/type`, { type, route })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      queryClient.invalidateQueries({ queryKey: ['menuPlugins'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde du type')
    }
  })

  // Mutation pour supprimer un plugin
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/plugins/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      toast.success('Plugin supprimé')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Impossible de supprimer ce plugin')
    }
  })

  // Mutation pour importer un plugin JSON
  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post('/plugins/import-json', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      toast.success('Plugin importé avec succès')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'import')
    }
  })

  // Mutation pour importer un plugin ZIP avancé
  const importZipMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('plugin', file)
      return api.post('/plugins/import-zip', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      queryClient.invalidateQueries({ queryKey: ['menuPlugins'] })
      const plugin = response.data.plugin
      toast.success(
        `Plugin "${plugin.name}" importé avec succès!\n` +
        `${plugin.tablesCreated} table(s), ${plugin.pagesCreated} page(s), ${plugin.endpointsCreated} endpoint(s)`,
        { duration: 5000 }
      )
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'import du plugin')
    }
  })

  // Gérer l'import de fichier ZIP
  const handleZipImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.zip')) {
        toast.error('Seuls les fichiers ZIP sont acceptés')
        return
      }
      importZipMutation.mutate(file)
    }
    e.target.value = ''
  }

  const openSettings = async (plugin: Plugin) => {
    // Récupérer les détails du plugin avec ses associations
    try {
      const response = await api.get(`/plugins/${plugin.id}`)
      const pluginData = response.data.plugin
      setSettingsModal(pluginData)
      setPluginSettings(pluginData.config || {})
      setPluginAssociations(pluginData.associations || [])
      setPluginType(pluginData.pluginType || 'object')
      setPluginRoute(pluginData.route || pluginData.slug || '')
      setExpandedCategories([])
    } catch (error) {
      setSettingsModal(plugin)
      setPluginSettings(plugin.settings || {})
      setPluginAssociations([])
      setPluginType(plugin.pluginType || 'object')
      setPluginRoute(plugin.route || plugin.slug || '')
    }
  }

  const handleSaveSettings = async () => {
    if (settingsModal) {
      // Sauvegarder les paramètres
      await saveSettingsMutation.mutateAsync({ id: settingsModal.id, settings: pluginSettings })
      // Sauvegarder les associations
      await saveAssociationsMutation.mutateAsync({ id: settingsModal.id, associations: pluginAssociations })
      // Sauvegarder le type
      await saveTypeMutation.mutateAsync({ id: settingsModal.id, type: pluginType, route: pluginRoute })
    }
  }

  // Vérifier si une catégorie est sélectionnée (toutes ses sous-catégories ou la catégorie elle-même)
  const isCategorySelected = (categoryId: number) => {
    return pluginAssociations.some(a => a.categoryId === categoryId && a.subcategoryId === null)
  }

  // Vérifier si une sous-catégorie est sélectionnée
  const isSubcategorySelected = (subcategoryId: number) => {
    return pluginAssociations.some(a => a.subcategoryId === subcategoryId)
  }

  // Vérifier si toutes les sous-catégories d'une catégorie sont sélectionnées
  const areAllSubcategoriesSelected = (category: Category) => {
    if (!category.subcategories || category.subcategories.length === 0) return false
    return category.subcategories.every(sub => isSubcategorySelected(sub.id))
  }

  // Vérifier si certaines (mais pas toutes) sous-catégories sont sélectionnées
  const areSomeSubcategoriesSelected = (category: Category) => {
    if (!category.subcategories || category.subcategories.length === 0) return false
    const selectedCount = category.subcategories.filter(sub => isSubcategorySelected(sub.id)).length
    return selectedCount > 0 && selectedCount < category.subcategories.length
  }

  // Toggle une catégorie entière
  const toggleCategory = (category: Category) => {
    if (category.hasSubcategories && category.subcategories && category.subcategories.length > 0) {
      // Si la catégorie a des sous-catégories, on gère toutes les sous-catégories
      if (areAllSubcategoriesSelected(category) || isCategorySelected(category.id)) {
        // Désélectionner toutes les sous-catégories et la catégorie
        setPluginAssociations(prev => prev.filter(a => 
          a.categoryId !== category.id && 
          !category.subcategories?.some(sub => sub.id === a.subcategoryId)
        ))
      } else {
        // Sélectionner toutes les sous-catégories
        const newAssociations = pluginAssociations.filter(a => 
          a.categoryId !== category.id && 
          !category.subcategories?.some(sub => sub.id === a.subcategoryId)
        )
        category.subcategories.forEach(sub => {
          newAssociations.push({ categoryId: category.id, subcategoryId: sub.id })
        })
        setPluginAssociations(newAssociations)
      }
    } else {
      // Catégorie sans sous-catégories
      if (isCategorySelected(category.id)) {
        setPluginAssociations(prev => prev.filter(a => a.categoryId !== category.id))
      } else {
        setPluginAssociations(prev => [...prev, { categoryId: category.id, subcategoryId: null }])
      }
    }
  }

  // Toggle une sous-catégorie
  const toggleSubcategory = (categoryId: number, subcategoryId: number) => {
    if (isSubcategorySelected(subcategoryId)) {
      setPluginAssociations(prev => prev.filter(a => a.subcategoryId !== subcategoryId))
    } else {
      // Retirer l'association de catégorie complète si elle existe
      const newAssociations = pluginAssociations.filter(a => 
        !(a.categoryId === categoryId && a.subcategoryId === null)
      )
      setPluginAssociations([...newAssociations, { categoryId, subcategoryId }])
    }
  }

  // Toggle expansion d'une catégorie
  const toggleExpanded = (categoryId: number) => {
    setExpandedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  // Exporter un plugin
  const handleExport = async (plugin: Plugin) => {
    try {
      const response = await api.get(`/plugins/${plugin.id}/export`)
      const data = response.data
      
      // Créer un fichier JSON à télécharger
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${plugin.slug}-export.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success('Plugin exporté')
    } catch (error: any) {
      toast.error('Erreur lors de l\'export')
    }
  }

  // Importer un plugin depuis un fichier JSON
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)
        if (!data.manifest) {
          toast.error('Format de fichier invalide : le champ "manifest" est requis')
          return
        }
        importMutation.mutate(data)
      } catch (error: any) {
        console.error('Erreur parsing JSON:', error)
        toast.error(`Erreur de syntaxe JSON : ${error.message || 'fichier mal formaté'}`)
      }
    }
    reader.readAsText(file)
    
    // Réinitialiser l'input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const getPluginIcon = (slug: string) => {
    switch (slug) {
      case 'fuel':
        return '⛽'
      case 'technical-control':
        return '🔧'
      case 'maintenance':
        return '🛠️'
      default:
        return '📦'
    }
  }

  const getPluginSettingsFields = (slug: string) => {
    switch (slug) {
      case 'fuel':
        return [
          { key: 'defaultFuelType', label: 'Type de carburant par défaut', type: 'select', options: ['Diesel', 'SP95', 'SP98', 'E10', 'E85', 'GPL'] },
          { key: 'trackMileage', label: 'Suivre le kilométrage', type: 'boolean' },
          { key: 'enableConsumptionStats', label: 'Activer les statistiques de consommation', type: 'boolean' }
        ]
      case 'technical-control':
        return [
          { key: 'reminderDays', label: 'Rappel X jours avant expiration', type: 'number' },
          { key: 'validityYears', label: 'Durée de validité (années)', type: 'number' },
          { key: 'sendEmailReminder', label: 'Envoyer rappel par email', type: 'boolean' }
        ]
      case 'maintenance':
        return [
          { key: 'defaultIntervalKm', label: 'Intervalle par défaut (km)', type: 'number' },
          { key: 'defaultIntervalMonths', label: 'Intervalle par défaut (mois)', type: 'number' },
          { key: 'sendEmailReminder', label: 'Envoyer rappel par email', type: 'boolean' },
          { key: 'reminderDays', label: 'Rappel X jours avant', type: 'number' }
        ]
      default:
        return []
    }
  }

  const plugins = data?.plugins || []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plugins</h1>
          <p className="text-gray-500 mt-1">Gérez les modules complémentaires de l'application</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            accept=".json"
            className="hidden"
          />
          <input
            type="file"
            ref={zipInputRef}
            onChange={handleZipImport}
            accept=".zip"
            className="hidden"
          />
          <Button
            variant="outline"
            icon={<Upload className="w-4 h-4" />}
            onClick={() => fileInputRef.current?.click()}
            loading={importMutation.isPending}
          >
            Importer JSON
          </Button>
          <Button
            variant="primary"
            icon={<FileArchive className="w-4 h-4" />}
            onClick={() => zipInputRef.current?.click()}
            loading={importZipMutation.isPending}
          >
            Importer Plugin ZIP
          </Button>
        </div>
      </div>

      {/* Info */}
      <Alert type="info">
        Les plugins ajoutent des fonctionnalités supplémentaires pour la gestion de vos matériels.
        Activez ou désactivez-les selon vos besoins.
      </Alert>

      {/* Liste des plugins */}
      {isLoading ? (
        <LoadingInline message="Chargement des plugins..." />
      ) : plugins.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Puzzle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Aucun plugin disponible</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin: Plugin) => {
            const config = plugin.settings || {}
            const hasDatabase = config.database?.tables?.length > 0
            const hasPages = config.pages?.length > 0
            
            return (
            <Card key={plugin.id} className={!plugin.isActive ? 'opacity-60' : ''}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">{getPluginIcon(plugin.slug)}</div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{plugin.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">{plugin.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-400">v{plugin.version}</span>
                        {hasDatabase && (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                            <Database className="w-3 h-3" />
                            {config.database.tables.length}
                          </span>
                        )}
                        {hasPages && (
                          <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                            <Layout className="w-3 h-3" />
                            {config.pages.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Badge variant={plugin.isActive ? 'success' : 'default'}>
                      {plugin.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                    <Badge variant={plugin.pluginType === 'menu' ? 'info' : 'default'} className="text-xs">
                      {plugin.pluginType === 'menu' ? 'Menu' : 'Objet'}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {plugin.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openSettings(plugin)}
                        title="Paramètres"
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleExport(plugin)}
                      title="Exporter"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    {!plugin.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(plugin)}
                        title="Supprimer"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <button
                      onClick={() => toggleMutation.mutate({ id: plugin.id })}
                      disabled={toggleMutation.isPending}
                      className="text-gray-500 hover:text-primary-600 transition-colors"
                      title={plugin.isActive ? 'Désactiver' : 'Activer'}
                    >
                      {plugin.isActive ? (
                        <ToggleRight className="w-8 h-8 text-primary-600" />
                      ) : (
                        <ToggleLeft className="w-8 h-8" />
                      )}
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )})}
        </div>
      )}

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer le plugin"
        size="sm"
      >
        <ModalBody>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-gray-600">
                Êtes-vous sûr de vouloir supprimer le plugin <strong>{deleteConfirm?.name}</strong> ?
              </p>
              <p className="text-sm text-red-600 mt-2">
                Cette action est irréversible.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteMutation.isPending}
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal paramètres du plugin */}
      <Modal
        isOpen={!!settingsModal}
        onClose={() => setSettingsModal(null)}
        title={`Paramètres : ${settingsModal?.name}`}
        size="lg"
      >
        <ModalBody className="space-y-6">
          {/* Type de plugin */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <Puzzle className="w-4 h-4" />
              Type d'affichage
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pluginType"
                    value="object"
                    checked={pluginType === 'object'}
                    onChange={(e) => setPluginType(e.target.value as 'menu' | 'object')}
                    className="w-4 h-4 text-primary-600"
                  />
                  <span className="text-sm text-gray-700">Onglet dans les objets</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pluginType"
                    value="menu"
                    checked={pluginType === 'menu'}
                    onChange={(e) => setPluginType(e.target.value as 'menu' | 'object')}
                    className="w-4 h-4 text-primary-600"
                  />
                  <span className="text-sm text-gray-700">Entrée dans le menu</span>
                </label>
              </div>
              {pluginType === 'menu' && (
                <Input
                  label="Route URL"
                  value={pluginRoute}
                  onChange={(e) => setPluginRoute(e.target.value)}
                  placeholder="ex: calendar"
                  hint="La route sera accessible à l'adresse /{route}"
                />
              )}
            </div>
          </div>

          {/* Paramètres spécifiques au plugin */}
          {settingsModal && getPluginSettingsFields(settingsModal.slug).length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Configuration
              </h3>
              {getPluginSettingsFields(settingsModal.slug).map((field) => (
                <div key={field.key}>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={field.key}
                        checked={pluginSettings[field.key] || false}
                        onChange={(e) => setPluginSettings({ ...pluginSettings, [field.key]: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor={field.key} className="text-sm text-gray-700">
                        {field.label}
                      </label>
                    </div>
                  ) : field.type === 'select' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {field.label}
                      </label>
                      <select
                        value={pluginSettings[field.key] || ''}
                        onChange={(e) => setPluginSettings({ ...pluginSettings, [field.key]: e.target.value })}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                      >
                        <option value="">Sélectionner...</option>
                        {field.options?.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  ) : field.type === 'number' ? (
                    <Input
                      type="number"
                      label={field.label}
                      value={pluginSettings[field.key] || ''}
                      onChange={(e) => setPluginSettings({ ...pluginSettings, [field.key]: parseInt(e.target.value) })}
                    />
                  ) : (
                    <Input
                      label={field.label}
                      value={pluginSettings[field.key] || ''}
                      onChange={(e) => setPluginSettings({ ...pluginSettings, [field.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Section Catégories/Sous-catégories associées - uniquement pour les plugins de type "object" */}
          {pluginType === 'object' && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <FolderTree className="w-4 h-4" />
              Catégories et sous-catégories associées
            </h3>
            <p className="text-xs text-gray-500">
              Sélectionnez les catégories ou sous-catégories où ce plugin sera disponible. 
              Si aucune sélection n'est faite, le plugin sera disponible pour tous les objets.
            </p>

            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
              {categoriesData?.categories?.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {categoriesData.categories.map((category: Category) => (
                    <div key={category.id} className="bg-white">
                      {/* Catégorie */}
                      <div 
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        onClick={() => category.hasSubcategories && category.subcategories?.length ? toggleExpanded(category.id) : toggleCategory(category)}
                      >
                        {category.hasSubcategories && category.subcategories && category.subcategories.length > 0 ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(category.id); }}
                            className="p-0.5 hover:bg-gray-200 rounded"
                          >
                            {expandedCategories.includes(category.id) ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        ) : (
                          <div className="w-5" />
                        )}
                        
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleCategory(category); }}
                          className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                            isCategorySelected(category.id) || areAllSubcategoriesSelected(category)
                              ? 'bg-primary-600 border-primary-600 text-white'
                              : areSomeSubcategoriesSelected(category)
                              ? 'bg-primary-200 border-primary-400'
                              : 'border-gray-300 hover:border-primary-400'
                          }`}
                        >
                          {(isCategorySelected(category.id) || areAllSubcategoriesSelected(category)) && (
                            <Check className="w-3 h-3" />
                          )}
                          {areSomeSubcategoriesSelected(category) && !areAllSubcategoriesSelected(category) && (
                            <div className="w-2 h-2 bg-primary-600 rounded-sm" />
                          )}
                        </button>
                        
                        <span className="text-sm font-medium text-gray-900">{category.name}</span>
                        {category.hasSubcategories && category.subcategories && (
                          <span className="text-xs text-gray-400">
                            ({category.subcategories.length} sous-catégories)
                          </span>
                        )}
                      </div>

                      {/* Sous-catégories */}
                      {expandedCategories.includes(category.id) && category.subcategories && category.subcategories.length > 0 && (
                        <div className="pl-10 pb-2 bg-gray-50">
                          {category.subcategories.map((subcategory: Subcategory) => (
                            <div
                              key={subcategory.id}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 cursor-pointer rounded"
                              onClick={() => toggleSubcategory(category.id, subcategory.id)}
                            >
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSubcategory(category.id, subcategory.id); }}
                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                  isSubcategorySelected(subcategory.id)
                                    ? 'bg-primary-600 border-primary-600 text-white'
                                    : 'border-gray-300 hover:border-primary-400'
                                }`}
                              >
                                {isSubcategorySelected(subcategory.id) && (
                                  <Check className="w-3 h-3" />
                                )}
                              </button>
                              <span className="text-sm text-gray-700">{subcategory.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500 text-sm">
                  Aucune catégorie disponible
                </div>
              )}
            </div>

            {/* Résumé des sélections */}
            {pluginAssociations.length > 0 && (
              <div className="bg-primary-50 rounded-lg p-3">
                <p className="text-xs font-medium text-primary-700 mb-2">
                  Associations sélectionnées ({pluginAssociations.length}) :
                </p>
                <div className="flex flex-wrap gap-1">
                  {pluginAssociations.map((assoc, idx) => {
                    const category = categoriesData?.categories?.find((c: Category) => c.id === assoc.categoryId)
                    const subcategory = category?.subcategories?.find((s: Subcategory) => s.id === assoc.subcategoryId)
                    return (
                      <Badge key={idx} variant="info" className="text-xs">
                        {subcategory ? `${category?.name} > ${subcategory.name}` : category?.name}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSettingsModal(null)}>
            Annuler
          </Button>
          <Button 
            onClick={handleSaveSettings}
            icon={<Save className="w-4 h-4" />}
            loading={saveSettingsMutation.isPending || saveAssociationsMutation.isPending}
          >
            Enregistrer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
