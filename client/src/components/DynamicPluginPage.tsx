import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Upload, Download, Trash2, Eye, Search, Filter, Plus, Edit, 
  RefreshCw, ChevronDown, ChevronUp, Image as ImageIcon,
  File, Folder, Calendar, Clock, User
} from 'lucide-react'
import { 
  Card, CardBody, Button, Input, Select, Modal, ModalBody, ModalFooter,
  Spinner
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate, formatFileSize } from '@/lib/utils'

// Types pour les composants de page
interface PageComponent {
  type: string
  [key: string]: any
}

interface PluginPage {
  title: string
  layout?: string
  components: PageComponent[]
}

// Map des icônes
const iconMap: Record<string, any> = {
  Upload, Download, Trash2, Eye, Search, Filter, Plus, Edit,
  RefreshCw, Image: ImageIcon, File, Folder, Calendar, Clock, User
}

// Composant Header
function HeaderComponent({ component, onAction }: { component: any; onAction: (action: string) => void }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{component.title}</h1>
        {component.subtitle && (
          <p className="text-gray-500 mt-1">{component.subtitle}</p>
        )}
      </div>
      {component.actions && (
        <div className="flex gap-2">
          {component.actions.map((action: any, idx: number) => {
            const Icon = iconMap[action.icon]
            return (
              <Button
                key={idx}
                variant={action.variant || 'primary'}
                icon={Icon ? <Icon className="w-4 h-4" /> : undefined}
                onClick={() => onAction(action.action)}
              >
                {action.label}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Composant Filters
function FiltersComponent({ 
  component, 
  values, 
  onChange,
  categories = []
}: { 
  component: any
  values: Record<string, any>
  onChange: (name: string, value: any) => void
  categories?: any[]
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {component.fields?.map((field: any, idx: number) => (
          <div key={idx} className="flex-1 min-w-[200px]">
            {field.type === 'text' && (
              <Input
                label={field.label}
                placeholder={field.placeholder}
                value={values[field.name] || ''}
                onChange={(e) => onChange(field.name, e.target.value)}
                icon={field.name === 'search' ? <Search className="w-4 h-4" /> : undefined}
              />
            )}
            {field.type === 'select' && (
              <Select
                label={field.label}
                value={values[field.name] || ''}
                onChange={(e) => onChange(field.name, e.target.value)}
                options={
                  field.source === 'categories' 
                    ? [{ value: '', label: 'Toutes' }, ...categories.map((c: any) => ({ value: c.id, label: c.name }))]
                    : field.options || []
                }
              />
            )}
          </div>
        ))}
        <Button variant="outline" icon={<Filter className="w-4 h-4" />}>
          Filtrer
        </Button>
      </div>
    </div>
  )
}

// Composant DataGrid (grille d'images/fichiers)
function DataGridComponent({
  component,
  data,
  loading,
  onAction
}: {
  component: any
  data: any[]
  loading: boolean
  onAction: (action: string, item: any) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Aucun élément trouvé</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {data.map((item: any, idx: number) => (
        <Card key={item.id || idx} className="group hover:shadow-lg transition-shadow">
          <CardBody className="p-2">
            {/* Preview */}
            <div className="aspect-square bg-gray-100 rounded-lg mb-2 overflow-hidden relative">
              {item.mime_type?.startsWith('image/') ? (
                <img 
                  src={`/uploads/${item.filename}`} 
                  alt={item.original_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <File className="w-12 h-12 text-gray-400" />
                </div>
              )}
              
              {/* Actions overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                {component.actions?.map((action: any, actionIdx: number) => {
                  const Icon = iconMap[action.icon]
                  return (
                    <button
                      key={actionIdx}
                      onClick={() => onAction(action.action, item)}
                      className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                      title={action.tooltip}
                    >
                      {Icon && <Icon className="w-4 h-4" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Info */}
            <p className="text-sm font-medium text-gray-900 truncate" title={item.original_name}>
              {item.original_name}
            </p>
            <p className="text-xs text-gray-500">
              {formatFileSize(item.size)}
            </p>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

// Composant DataTable
function DataTableComponent({
  component,
  data,
  loading,
  onAction
}: {
  component: any
  data: any[]
  loading: boolean
  onAction: (action: string, item: any) => void
}) {
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const sortedData = useMemo(() => {
    if (!sortField || !data) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortField, sortDir])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const formatValue = (value: any, format?: string) => {
    if (value === null || value === undefined) return '-'
    switch (format) {
      case 'date':
        return formatDate(value)
      case 'filesize':
        return formatFileSize(value)
      case 'boolean':
        return value ? 'Oui' : 'Non'
      default:
        return value
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              {component.columns?.map((col: any, idx: number) => (
                <th 
                  key={idx}
                  className={`px-4 py-3 text-left text-sm font-medium text-gray-700 ${col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                  style={{ width: col.width }}
                  onClick={() => col.sortable && handleSort(col.field)}
                >
                  <div className="flex items-center gap-1">
                    {col.label || col.field}
                    {col.sortable && sortField === col.field && (
                      sortDir === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
              ))}
              {component.actions && (
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedData?.length === 0 ? (
              <tr>
                <td colSpan={(component.columns?.length || 0) + 1} className="px-4 py-8 text-center text-gray-500">
                  Aucun élément trouvé
                </td>
              </tr>
            ) : (
              sortedData?.map((item: any, idx: number) => (
                <tr key={item.id || idx} className="hover:bg-gray-50">
                  {component.columns?.map((col: any, colIdx: number) => (
                    <td key={colIdx} className="px-4 py-3 text-sm text-gray-900">
                      {col.type === 'image' ? (
                        <img 
                          src={`/uploads/${item.filename}`} 
                          alt="" 
                          className="w-10 h-10 rounded object-cover"
                        />
                      ) : (
                        formatValue(item[col.field], col.format)
                      )}
                    </td>
                  ))}
                  {component.actions && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {component.actions.map((action: any, actionIdx: number) => {
                          const Icon = iconMap[action.icon]
                          return (
                            <button
                              key={actionIdx}
                              onClick={() => onAction(action.action, item)}
                              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                              title={action.tooltip}
                            >
                              {Icon && <Icon className="w-4 h-4" />}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Composant Stats
function StatsComponent({ component, data }: { component: any; data?: any }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {component.items?.map((stat: any, idx: number) => {
        const Icon = iconMap[stat.icon]
        const value = stat.source ? data?.[stat.source] : stat.value
        return (
          <Card key={idx}>
            <CardBody className="flex items-center gap-4">
              {Icon && (
                <div className={`p-3 rounded-lg ${stat.color || 'bg-primary-100 text-primary-600'}`}>
                  <Icon className="w-6 h-6" />
                </div>
              )}
              <div>
                <p className="text-2xl font-bold text-gray-900">{value || 0}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

// Composant Form
function FormComponent({
  component,
  values,
  onChange,
  onSubmit,
  loading,
  categories = []
}: {
  component: any
  values: Record<string, any>
  onChange: (name: string, value: any) => void
  onSubmit: () => void
  loading?: boolean
  categories?: any[]
}) {
  return (
    <div className="space-y-4">
      {component.fields?.map((field: any, idx: number) => (
        <div key={idx}>
          {field.type === 'text' && (
            <Input
              label={field.label}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(e) => onChange(field.name, e.target.value)}
              required={field.required}
            />
          )}
          {field.type === 'textarea' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
              <textarea
                value={values[field.name] || ''}
                onChange={(e) => onChange(field.name, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                rows={field.rows || 3}
                placeholder={field.placeholder}
              />
            </div>
          )}
          {field.type === 'select' && (
            <Select
              label={field.label}
              value={values[field.name] || ''}
              onChange={(e) => onChange(field.name, e.target.value)}
              options={
                field.source === 'categories'
                  ? [{ value: '', label: 'Aucune' }, ...categories.map((c: any) => ({ value: c.id, label: c.name }))]
                  : field.options || []
              }
              required={field.required}
            />
          )}
          {field.type === 'file' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
              <input
                type="file"
                accept={field.accept}
                onChange={(e) => onChange(field.name, e.target.files?.[0])}
                className="w-full"
              />
            </div>
          )}
        </div>
      ))}
      <div className="flex justify-end gap-2 mt-6">
        <Button onClick={onSubmit} loading={loading}>
          {component.submitLabel || 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}

// Props du composant principal
interface DynamicPluginPageProps {
  pluginSlug: string
  pageName?: string
}

// Composant principal
export default function DynamicPluginPage({ pluginSlug, pageName = 'index' }: DynamicPluginPageProps) {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Record<string, any>>({})
  const [uploadModal, setUploadModal] = useState(false)
  const [previewModal, setPreviewModal] = useState<any>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null)
  const [formValues, setFormValues] = useState<Record<string, any>>({})

  // Charger la configuration de la page
  const { data: pageData, isLoading: pageLoading } = useQuery({
    queryKey: ['plugin-page', pluginSlug, pageName],
    queryFn: async () => {
      const response = await api.get(`/plugins/${pluginSlug}/pages/${pageName}`)
      return response.data
    }
  })

  // Charger les catégories pour les selects
  const { data: categoriesData } = useQuery({
    queryKey: ['categories-simple'],
    queryFn: async () => {
      const response = await api.get('/categories')
      return response.data.categories || []
    }
  })

  // Charger les données du plugin
  const { data: pluginData, isLoading: dataLoading, refetch } = useQuery({
    queryKey: ['plugin-data', pluginSlug, filters],
    queryFn: async () => {
      // Trouver le premier dataGrid ou dataTable pour récupérer la source
      const dataComponent = pageData?.page?.components?.find(
        (c: any) => c.type === 'dataGrid' || c.type === 'dataTable'
      )
      if (!dataComponent?.source) return []

      // Construire l'URL avec les filtres
      let url = dataComponent.source
      if (!url.startsWith('/api/')) {
        url = `/plugins/${pluginSlug}/data${url.startsWith('/') ? url : '/' + url}`
      }

      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, String(value))
      })
      if (params.toString()) url += `?${params.toString()}`

      const response = await api.get(url)
      return response.data.data || response.data || []
    },
    enabled: !!pageData?.page
  })

  // Mutation pour supprimer
  const deleteMutation = useMutation({
    mutationFn: async (item: any) => {
      return api.delete(`/plugins/${pluginSlug}/data/${item.id}`)
    },
    onSuccess: () => {
      toast.success('Élément supprimé')
      queryClient.invalidateQueries({ queryKey: ['plugin-data', pluginSlug] })
      setDeleteConfirm(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  // Gérer les actions
  const handleAction = (action: string, item?: any) => {
    switch (action) {
      case 'upload':
        setUploadModal(true)
        break
      case 'preview':
        setPreviewModal(item)
        break
      case 'download':
        if (item?.filename) {
          window.open(`/uploads/${item.filename}`, '_blank')
        }
        break
      case 'delete':
        setDeleteConfirm(item)
        break
      case 'edit':
        // TODO: Ouvrir modal d'édition
        break
      case 'refresh':
        refetch()
        break
    }
  }

  // Gérer les changements de filtres
  const handleFilterChange = (name: string, value: any) => {
    setFilters(prev => ({ ...prev, [name]: value }))
  }

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!pageData?.page) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <p className="text-gray-500">Page non trouvée</p>
        </CardBody>
      </Card>
    )
  }

  const page = pageData.page as PluginPage

  return (
    <div className="space-y-6">
      {/* Rendu des composants de la page */}
      {page.components.map((component, idx) => {
        switch (component.type) {
          case 'header':
            return <HeaderComponent key={idx} component={component} onAction={handleAction} />
          
          case 'filters':
            return (
              <FiltersComponent 
                key={idx} 
                component={component} 
                values={filters} 
                onChange={handleFilterChange}
                categories={categoriesData}
              />
            )
          
          case 'dataGrid':
            return (
              <DataGridComponent
                key={idx}
                component={component}
                data={pluginData}
                loading={dataLoading}
                onAction={handleAction}
              />
            )
          
          case 'dataTable':
            return (
              <DataTableComponent
                key={idx}
                component={component}
                data={pluginData}
                loading={dataLoading}
                onAction={handleAction}
              />
            )
          
          case 'stats':
            return <StatsComponent key={idx} component={component} data={pluginData} />
          
          case 'form':
            return (
              <FormComponent
                key={idx}
                component={component}
                values={formValues}
                onChange={(name, value) => setFormValues(prev => ({ ...prev, [name]: value }))}
                onSubmit={() => {}}
                categories={categoriesData}
              />
            )
          
          default:
            return null
        }
      })}

      {/* Modal Upload */}
      <Modal
        isOpen={uploadModal}
        onClose={() => setUploadModal(false)}
        title="Importer un fichier"
      >
        <ModalBody>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">Glissez-déposez vos fichiers ici</p>
              <p className="text-sm text-gray-500">ou</p>
              <input
                type="file"
                multiple
                className="mt-4"
                onChange={(e) => {
                  // TODO: Gérer l'upload
                  console.log('Files:', e.target.files)
                }}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setUploadModal(false)}>
            Annuler
          </Button>
          <Button>
            Importer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Preview */}
      <Modal
        isOpen={!!previewModal}
        onClose={() => setPreviewModal(null)}
        title={previewModal?.original_name || 'Aperçu'}
        size="lg"
      >
        <ModalBody>
          {previewModal?.mime_type?.startsWith('image/') ? (
            <img 
              src={`/uploads/${previewModal.filename}`} 
              alt={previewModal.original_name}
              className="max-w-full max-h-[70vh] mx-auto"
            />
          ) : (
            <div className="text-center py-12">
              <File className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">{previewModal?.original_name}</p>
              <p className="text-sm text-gray-500 mt-2">
                {formatFileSize(previewModal?.size)}
              </p>
            </div>
          )}
        </ModalBody>
      </Modal>

      {/* Modal Confirm Delete */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Confirmer la suppression"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer "{deleteConfirm?.original_name || deleteConfirm?.name}" ?
          </p>
          <p className="text-sm text-red-500 mt-2">Cette action est irréversible.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            onClick={() => deleteMutation.mutate(deleteConfirm)}
            loading={deleteMutation.isPending}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
