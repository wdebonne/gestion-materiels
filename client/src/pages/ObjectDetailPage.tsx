import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  ChevronRight, ArrowLeft, Edit2, Package, Fuel, Wrench, 
  ClipboardCheck, Plus, Save, X,
  Image as ImageIcon
} from 'lucide-react'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select,
  LoadingInline, Alert, Card, CardBody, CardHeader, CardTitle, Tabs, Badge
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate, formatCurrency } from '@/lib/utils'

export default function ObjectDetailPage() {
  const { objectId: id } = useParams<{ objectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('details')
  const [isEditing, setIsEditing] = useState(false)
  const [editFormData, setEditFormData] = useState<any>(null)
  
  // Modals pour les plugins
  const [fuelModal, setFuelModal] = useState(false)
  const [maintenanceModal, setMaintenanceModal] = useState(false)
  const [controlModal, setControlModal] = useState(false)
  const [customPluginModal, setCustomPluginModal] = useState<any>(null) // Pour les plugins personnalisés

  // Données des formulaires de plugins
  const [fuelData, setFuelData] = useState({
    date: new Date().toISOString().split('T')[0],
    quantity: '',
    cost: '',
    mileage: '',
    station: '',
    notes: ''
  })

  const [maintenanceData, setMaintenanceData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: '',
    description: '',
    cost: '',
    mileage: '',
    nextDate: '',
    provider: '',
    notes: ''
  })

  // Données pour le formulaire de plugin personnalisé
  const [customMaintenanceData, setCustomMaintenanceData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: '',
    description: '',
    cost: '',
    mileage: '',
    nextDate: '',
    provider: '',
    notes: ''
  })

  const [controlData, setControlData] = useState({
    date: new Date().toISOString().split('T')[0],
    expirationDate: '',
    result: 'passed',
    mileage: '',
    center: '',
    cost: '',
    notes: ''
  })

  // Récupérer l'objet
  const { data: object, isLoading, error } = useQuery({
    queryKey: ['object', id],
    queryFn: async () => {
      const response = await api.get(`/objects/${id}`)
      return response.data.object as {
        id: number;
        name: string;
        slug: string;
        description?: string;
        image?: string;
        status: string;
        serialNumber?: string;
        purchaseDate?: string;
        purchasePrice?: number;
        supplier?: string;
        warranty?: string;
        notes?: string;
        specifications?: Record<string, any>;
        customFields?: Record<string, any>;
        createdAt?: string;
        updatedAt?: string;
        category?: any; 
        subcategory?: any;
        fuelRecords?: any[];
        maintenanceRecords?: any[];
        technicalControls?: any[];
        activePlugins?: Array<{ id: number; slug: string; name: string; icon: string }>;
      }
    },
    enabled: !!id
  })

  // Mutation pour modifier l'objet
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put(`/objects/${id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      toast.success('Matériel mis à jour')
      setIsEditing(false)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la mise à jour')
    }
  })

  // Mutations pour les plugins
  const addFuelMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post(`/objects/${id}/fuel`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      toast.success('Plein ajouté')
      setFuelModal(false)
      setFuelData({ date: new Date().toISOString().split('T')[0], quantity: '', cost: '', mileage: '', station: '', notes: '' })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const addMaintenanceMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post(`/objects/${id}/maintenance`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      toast.success('Entretien ajouté')
      setMaintenanceModal(false)
      setMaintenanceData({ date: new Date().toISOString().split('T')[0], type: '', description: '', cost: '', mileage: '', nextDate: '', provider: '', notes: '' })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const addControlMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post(`/objects/${id}/technical-control`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      toast.success('Contrôle technique ajouté')
      setControlModal(false)
      setControlData({ date: new Date().toISOString().split('T')[0], expirationDate: '', result: 'passed', mileage: '', center: '', cost: '', notes: '' })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const handleEditStart = () => {
    if (object) {
      setEditFormData({
        name: object.name,
        description: object.description || '',
        image: object.image || '',
        status: object.status || 'active',
        customFields: object.customFields || {}
      })
      setIsEditing(true)
    }
  }

  const handleEditSave = () => {
    updateMutation.mutate(editFormData)
  }

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditFormData(null)
  }

  if (isLoading) {
    return <LoadingInline message="Chargement du matériel..." />
  }

  if (error || !object) {
    return (
      <div className="text-center py-12">
        <Alert type="error">Matériel non trouvé</Alert>
        <Button className="mt-4" onClick={() => navigate('/categories')}>
          Retour aux catégories
        </Button>
      </div>
    )
  }

  const statusOptions = [
    { value: 'active', label: 'Actif' },
    { value: 'maintenance', label: 'En maintenance' },
    { value: 'inactive', label: 'Inactif' },
    { value: 'retired', label: 'Retiré' }
  ]

  // Vérifier si un plugin est actif pour cet objet
  const isPluginActive = (slug: string) => {
    return object?.activePlugins?.some((p: { slug: string }) => p.slug === slug) ?? false
  }

  // Construire les onglets dynamiquement en fonction des plugins actifs
  const buildTabs = () => {
    const baseTabs = [{ id: 'details', label: 'Détails' }]
    
    // Plugins système avec leurs onglets spécifiques
    if (isPluginActive('fuel')) {
      baseTabs.push({ id: 'fuel', label: 'Carburant', count: object?.fuelRecords?.length || 0 } as any)
    }
    if (isPluginActive('maintenance')) {
      baseTabs.push({ id: 'maintenance', label: 'Entretiens', count: object?.maintenanceRecords?.length || 0 } as any)
    }
    if (isPluginActive('technical-control')) {
      baseTabs.push({ id: 'control', label: 'Contrôle technique', count: object?.technicalControls?.length || 0 } as any)
    }
    
    // Plugins personnalisés (non système) - type maintenance
    object?.activePlugins?.forEach((plugin: any) => {
      if (plugin.slug !== 'fuel' && plugin.slug !== 'maintenance' && plugin.slug !== 'technical-control' && plugin.slug !== 'calendar') {
        // Plugin personnalisé de type maintenance
        if (plugin.slug.includes('maintenance')) {
          baseTabs.push({ 
            id: `plugin-${plugin.slug}`, 
            label: plugin.name, 
            count: 0 
          } as any)
        }
      }
    })
    
    return baseTabs
  }

  const tabs = buildTabs()

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm flex-wrap">
        <Link to="/categories" className="text-gray-500 hover:text-gray-700">
          Catégories
        </Link>
        {object.category && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link to={`/categories/${object.category.slug}`} className="text-gray-500 hover:text-gray-700">
              {object.category.name}
            </Link>
          </>
        )}
        {object.subcategory && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link 
              to={`/categories/${object.category?.slug}/${object.subcategory.slug}`} 
              className="text-gray-500 hover:text-gray-700"
            >
              {object.subcategory.name}
            </Link>
          </>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 font-medium">{object.name}</span>
      </nav>

      {/* En-tête */}
      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Image */}
            <div className="w-40 h-40 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden">
              {isEditing ? (
                <div className="w-full h-full p-4">
                  <Input
                    placeholder="URL image"
                    value={editFormData?.image || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, image: e.target.value })}
                    icon={<ImageIcon className="w-4 h-4" />}
                  />
                </div>
              ) : object.image ? (
                <img 
                  src={object.image} 
                  alt={object.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <Package className="w-16 h-16" />
                </div>
              )}
            </div>

            {/* Infos */}
            <div className="flex-1">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-4">
                      <Input
                        label="Nom"
                        value={editFormData?.name || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                        required
                      />
                      <TextArea
                        label="Description"
                        value={editFormData?.description || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                        rows={3}
                      />
                      <Select
                        label="Statut"
                        value={editFormData?.status || 'active'}
                        onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                        options={statusOptions}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900">{object.name}</h1>
                        <Badge variant={
                          object.status === 'active' ? 'success' :
                          object.status === 'maintenance' ? 'warning' :
                          object.status === 'inactive' ? 'default' : 'danger'
                        }>
                          {statusOptions.find(s => s.value === object.status)?.label || 'Actif'}
                        </Badge>
                      </div>
                      {object.description && (
                        <p className="text-gray-500 mt-2">{object.description}</p>
                      )}
                      <p className="text-sm text-gray-400 mt-2">
                        Créé le {object.createdAt ? formatDate(object.createdAt) : '-'}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={handleEditCancel}>
                        <X className="w-4 h-4" />
                      </Button>
                      <Button size="sm" onClick={handleEditSave} loading={updateMutation.isPending}>
                        <Save className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleEditStart}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Onglets */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Contenu des onglets */}
      {activeTab === 'details' && (
        <Card>
          <CardHeader>
            <CardTitle>Informations détaillées</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-1">Catégorie</h4>
                <p className="text-gray-900">{object.category?.name || '-'}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-1">Sous-catégorie</h4>
                <p className="text-gray-900">{object.subcategory?.name || '-'}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-1">Dernière modification</h4>
                <p className="text-gray-900">{object.updatedAt ? formatDate(object.updatedAt) : '-'}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-1">Identifiant</h4>
                <p className="text-gray-900 font-mono text-sm">#{object.id}</p>
              </div>
            </div>

            {/* Champs personnalisés */}
            {object.customFields && Object.keys(object.customFields).length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-4">Champs personnalisés</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(object.customFields).map(([key, value]) => (
                    <div key={key}>
                      <h4 className="text-sm font-medium text-gray-500 mb-1">{key}</h4>
                      <p className="text-gray-900">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === 'fuel' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Fuel className="w-5 h-5 text-green-600" />
              Historique carburant
            </CardTitle>
            <Button size="sm" onClick={() => setFuelModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Ajouter un plein
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            {object.fuelRecords && object.fuelRecords.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantité</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Coût</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kilométrage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {object.fuelRecords.map((record: any) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatDate(record.date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{record.quantity} L</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatCurrency(record.cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{record.mileage ? `${record.mileage} km` : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{record.station || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <Fuel className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Aucun enregistrement de carburant</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === 'maintenance' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-orange-600" />
              Historique des entretiens
            </CardTitle>
            <Button size="sm" onClick={() => setMaintenanceModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Ajouter un entretien
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            {object.maintenanceRecords && object.maintenanceRecords.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {object.maintenanceRecords.map((record: any) => (
                  <div key={record.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{record.type}</p>
                        <p className="text-sm text-gray-500 mt-1">{record.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                          <span>{formatDate(record.date)}</span>
                          {record.mileage && <span>{record.mileage} km</span>}
                          {record.provider && <span>{record.provider}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">{formatCurrency(record.cost)}</p>
                        {record.nextDate && (
                          <p className="text-xs text-orange-600 mt-1">
                            Prochain: {formatDate(record.nextDate)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Aucun entretien enregistré</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === 'control' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600" />
              Contrôles techniques
            </CardTitle>
            <Button size="sm" onClick={() => setControlModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Ajouter un contrôle
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            {object.technicalControls && object.technicalControls.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {object.technicalControls.map((control: any) => (
                  <div key={control.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant={control.result === 'passed' ? 'success' : control.result === 'failed' ? 'danger' : 'warning'}>
                            {control.result === 'passed' ? 'Favorable' : 
                             control.result === 'failed' ? 'Défavorable' : 'Contre-visite'}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {formatDate(control.date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                          {control.center && <span>{control.center}</span>}
                          {control.mileage && <span>{control.mileage} km</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">{formatCurrency(control.cost)}</p>
                        {control.expirationDate && (
                          <p className={`text-xs mt-1 ${
                            new Date(control.expirationDate) < new Date() 
                              ? 'text-red-600' 
                              : 'text-green-600'
                          }`}>
                            Expire le {formatDate(control.expirationDate)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Aucun contrôle technique enregistré</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Onglets des plugins personnalisés (type maintenance) */}
      {activeTab.startsWith('plugin-') && activeTab.includes('maintenance') && (() => {
        const currentPlugin = object?.activePlugins?.find((p: any) => `plugin-${p.slug}` === activeTab)
        return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-purple-600" />
                {currentPlugin?.name || 'Maintenance'}
              </CardTitle>
              <Button size="sm" onClick={() => {
                setCustomMaintenanceData({
                  date: new Date().toISOString().split('T')[0],
                  type: '',
                  description: '',
                  cost: '',
                  mileage: '',
                  nextDate: '',
                  provider: '',
                  notes: ''
                })
                setCustomPluginModal(currentPlugin)
              }}>
                <Plus className="w-4 h-4 mr-1" />
                Ajouter un entretien
              </Button>
            </CardHeader>
            <CardBody className="p-0">
              <div className="text-center py-12">
                <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Aucun entretien enregistré</p>
                <p className="text-xs text-gray-400 mt-2">
                  Les données de maintenance seront affichées ici
                </p>
              </div>
            </CardBody>
          </Card>
        )
      })()}

      {/* Modal Carburant */}
      <Modal isOpen={fuelModal} onClose={() => setFuelModal(false)} title="Ajouter un plein">
        <form onSubmit={(e) => { e.preventDefault(); addFuelMutation.mutate(fuelData); }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={fuelData.date}
                onChange={(e) => setFuelData({ ...fuelData, date: e.target.value })}
                required
              />
              <Input
                label="Quantité (L)"
                type="number"
                step="0.01"
                value={fuelData.quantity}
                onChange={(e) => setFuelData({ ...fuelData, quantity: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={fuelData.cost}
                onChange={(e) => setFuelData({ ...fuelData, cost: e.target.value })}
              />
              <Input
                label="Kilométrage"
                type="number"
                value={fuelData.mileage}
                onChange={(e) => setFuelData({ ...fuelData, mileage: e.target.value })}
              />
            </div>
            <Input
              label="Station"
              value={fuelData.station}
              onChange={(e) => setFuelData({ ...fuelData, station: e.target.value })}
            />
            <TextArea
              label="Notes"
              value={fuelData.notes}
              onChange={(e) => setFuelData({ ...fuelData, notes: e.target.value })}
              rows={2}
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setFuelModal(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={addFuelMutation.isPending}>
              Ajouter
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal Entretien */}
      <Modal isOpen={maintenanceModal} onClose={() => setMaintenanceModal(false)} title="Ajouter un entretien">
        <form onSubmit={(e) => { e.preventDefault(); addMaintenanceMutation.mutate(maintenanceData); }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={maintenanceData.date}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, date: e.target.value })}
                required
              />
              <Input
                label="Type d'entretien"
                value={maintenanceData.type}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, type: e.target.value })}
                placeholder="Ex: Vidange"
                required
              />
            </div>
            <TextArea
              label="Description"
              value={maintenanceData.description}
              onChange={(e) => setMaintenanceData({ ...maintenanceData, description: e.target.value })}
              rows={2}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={maintenanceData.cost}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, cost: e.target.value })}
              />
              <Input
                label="Kilométrage"
                type="number"
                value={maintenanceData.mileage}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, mileage: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Prestataire"
                value={maintenanceData.provider}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, provider: e.target.value })}
              />
              <Input
                label="Prochain entretien"
                type="date"
                value={maintenanceData.nextDate}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, nextDate: e.target.value })}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setMaintenanceModal(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={addMaintenanceMutation.isPending}>
              Ajouter
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal Contrôle technique */}
      <Modal isOpen={controlModal} onClose={() => setControlModal(false)} title="Ajouter un contrôle technique">
        <form onSubmit={(e) => { e.preventDefault(); addControlMutation.mutate(controlData); }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date du contrôle"
                type="date"
                value={controlData.date}
                onChange={(e) => setControlData({ ...controlData, date: e.target.value })}
                required
              />
              <Input
                label="Date d'expiration"
                type="date"
                value={controlData.expirationDate}
                onChange={(e) => setControlData({ ...controlData, expirationDate: e.target.value })}
                required
              />
            </div>
            <Select
              label="Résultat"
              value={controlData.result}
              onChange={(e) => setControlData({ ...controlData, result: e.target.value })}
              options={[
                { value: 'passed', label: 'Favorable' },
                { value: 'minor', label: 'Contre-visite mineure' },
                { value: 'failed', label: 'Défavorable' }
              ]}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Centre de contrôle"
                value={controlData.center}
                onChange={(e) => setControlData({ ...controlData, center: e.target.value })}
              />
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={controlData.cost}
                onChange={(e) => setControlData({ ...controlData, cost: e.target.value })}
              />
            </div>
            <Input
              label="Kilométrage"
              type="number"
              value={controlData.mileage}
              onChange={(e) => setControlData({ ...controlData, mileage: e.target.value })}
            />
            <TextArea
              label="Notes"
              value={controlData.notes}
              onChange={(e) => setControlData({ ...controlData, notes: e.target.value })}
              rows={2}
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setControlModal(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={addControlMutation.isPending}>
              Ajouter
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal Entretien pour plugins personnalisés */}
      <Modal 
        isOpen={!!customPluginModal} 
        onClose={() => setCustomPluginModal(null)} 
        title={`Ajouter un entretien - ${customPluginModal?.name || ''}`}
      >
        <form onSubmit={(e) => { 
          e.preventDefault()
          // Pour l'instant, afficher un toast de succès
          toast.success('Entretien enregistré (fonctionnalité en cours de développement)')
          setCustomPluginModal(null)
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={customMaintenanceData.date}
                onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, date: e.target.value })}
                required
              />
              {/* Type d'entretien avec liste déroulante si configuré */}
              {customPluginModal?.config?.maintenance_types ? (
                <Select
                  label="Type d'entretien"
                  value={customMaintenanceData.type}
                  onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, type: e.target.value })}
                  options={[
                    { value: '', label: 'Sélectionner...' },
                    ...customPluginModal.config.maintenance_types.map((type: string) => ({
                      value: type,
                      label: type
                    }))
                  ]}
                  required
                />
              ) : (
                <Input
                  label="Type d'entretien"
                  value={customMaintenanceData.type}
                  onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, type: e.target.value })}
                  placeholder="Ex: Vidange"
                  required
                />
              )}
            </div>
            <TextArea
              label="Description"
              value={customMaintenanceData.description}
              onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, description: e.target.value })}
              rows={2}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={customMaintenanceData.cost}
                onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, cost: e.target.value })}
              />
              {/* Afficher le kilométrage uniquement si track_mileage est true dans la config */}
              {customPluginModal?.config?.track_mileage && (
                <Input
                  label="Kilométrage"
                  type="number"
                  value={customMaintenanceData.mileage}
                  onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, mileage: e.target.value })}
                />
              )}
              {!customPluginModal?.config?.track_mileage && (
                <Input
                  label="Prestataire"
                  value={customMaintenanceData.provider}
                  onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, provider: e.target.value })}
                />
              )}
            </div>
            {customPluginModal?.config?.track_mileage && (
              <Input
                label="Prestataire"
                value={customMaintenanceData.provider}
                onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, provider: e.target.value })}
              />
            )}
            <Input
              label="Prochain entretien"
              type="date"
              value={customMaintenanceData.nextDate}
              onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, nextDate: e.target.value })}
            />
            <TextArea
              label="Notes"
              value={customMaintenanceData.notes}
              onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, notes: e.target.value })}
              rows={2}
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setCustomPluginModal(null)}>
              Annuler
            </Button>
            <Button type="submit">
              Ajouter
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  )
}
