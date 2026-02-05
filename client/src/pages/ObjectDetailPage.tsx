import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  ChevronRight, ArrowLeft, Edit2, Package, Fuel, Wrench, 
  ClipboardCheck, Plus, Save, X, Trash2, Pencil,
  Image as ImageIcon, Settings2, Search, ArrowUpDown, Paperclip
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select,
  LoadingInline, Alert, Card, CardBody, CardHeader, CardTitle, Tabs, Badge,
  FileUpload, AttachmentViewer
} from '@/components/ui'
import type { UploadedFile } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate, formatCurrency } from '@/lib/utils'

export default function ObjectDetailPage() {
  const { objectId: id } = useParams<{ objectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [activeTab, setActiveTab] = useState('details')
  const [isEditing, setIsEditing] = useState(false)
  const [editFormData, setEditFormData] = useState<any>(null)
  
  // Filtres pour les tableaux
  const [fuelFilter, setFuelFilter] = useState('')
  const [maintenanceFilter, setMaintenanceFilter] = useState('')
  const [controlFilter, setControlFilter] = useState('')
  
  // Ordre de tri pour les tableaux (true = plus récent en premier, false = plus ancien en premier)
  const [fuelSortDesc, setFuelSortDesc] = useState(true)
  const [maintenanceSortDesc, setMaintenanceSortDesc] = useState(true)
  const [controlSortDesc, setControlSortDesc] = useState(true)
  
  // Modals pour les plugins
  const [fuelModal, setFuelModal] = useState(false)
  const [fuelEditModal, setFuelEditModal] = useState<any>(null) // Pour édition carburant
  const [fuelDeleteConfirm, setFuelDeleteConfirm] = useState<number | null>(null) // Pour suppression carburant
  const [stationsModal, setStationsModal] = useState(false) // Pour gestion des stations
  const [stationEditData, setStationEditData] = useState<{ id?: number; name: string; address: string } | null>(null)
  const [stationDeleteConfirm, setStationDeleteConfirm] = useState<number | null>(null)
  const [maintenanceModal, setMaintenanceModal] = useState(false)
  const [maintenanceEditModal, setMaintenanceEditModal] = useState<any>(null) // Pour édition maintenance
  const [maintenanceDeleteConfirm, setMaintenanceDeleteConfirm] = useState<number | null>(null) // Pour suppression maintenance
  const [maintenanceSettingsModal, setMaintenanceSettingsModal] = useState(false) // Pour gestion types et prestataires
  const [maintenanceTypeEditData, setMaintenanceTypeEditData] = useState<{ id?: number; name: string } | null>(null)
  const [maintenanceTypeDeleteConfirm, setMaintenanceTypeDeleteConfirm] = useState<number | null>(null)
  const [maintenanceProviderEditData, setMaintenanceProviderEditData] = useState<{ id?: number; name: string; address: string; phone: string } | null>(null)
  const [maintenanceProviderDeleteConfirm, setMaintenanceProviderDeleteConfirm] = useState<number | null>(null)
  const [controlModal, setControlModal] = useState(false)
  const [controlEditModal, setControlEditModal] = useState<any>(null) // Pour édition contrôle technique
  const [controlDeleteConfirm, setControlDeleteConfirm] = useState<number | null>(null) // Pour suppression contrôle technique
  const [controlCentersModal, setControlCentersModal] = useState(false) // Pour gestion des centres de contrôle
  const [controlCenterEditData, setControlCenterEditData] = useState<{ id?: number; name: string; address?: string; phone?: string } | null>(null)
  const [controlCenterDeleteConfirm, setControlCenterDeleteConfirm] = useState<number | null>(null)
  const [customPluginModal, setCustomPluginModal] = useState<any>(null) // Pour les plugins personnalisés

  // Données des formulaires de plugins
  const [fuelData, setFuelData] = useState<{
    date: string
    fuelType: string
    quantity: string
    cost: string
    mileage: string
    station: string
    notes: string
    attachments: UploadedFile[]
  }>({
    date: new Date().toISOString().split('T')[0],
    fuelType: '',
    quantity: '',
    cost: '',
    mileage: '',
    station: '',
    notes: '',
    attachments: []
  })

  const [maintenanceData, setMaintenanceData] = useState<{
    date: string
    type: string
    description: string
    cost: string
    mileage: string
    nextDate: string
    provider: string
    notes: string
    attachments: UploadedFile[]
  }>({
    date: new Date().toISOString().split('T')[0],
    type: '',
    description: '',
    cost: '',
    mileage: '',
    nextDate: '',
    provider: '',
    notes: '',
    attachments: []
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

  const [controlData, setControlData] = useState<{
    date: string
    expirationDate: string
    result: string
    mileage: string
    center: string
    cost: string
    notes: string
    attachments: UploadedFile[]
  }>(() => {
    const today = new Date()
    const expDate = new Date(today)
    expDate.setFullYear(expDate.getFullYear() + 2)
    return {
      date: today.toISOString().split('T')[0],
      expirationDate: expDate.toISOString().split('T')[0],
      result: 'passed',
      mileage: '',
      center: '',
      cost: '',
      notes: '',
      attachments: []
    }
  })

  // Fonction pour obtenir le kilométrage actuel depuis les champs personnalisés
  const getCurrentMileage = (): string => {
    const mileage = object?.customFields?.kilometrage
    return mileage ? String(mileage) : ''
  }

  // Fonction pour ouvrir le modal carburant avec le kilométrage pré-rempli
  const openFuelModal = () => {
    setFuelData(prev => ({ ...prev, mileage: getCurrentMileage() }))
    setFuelModal(true)
  }

  // Fonction pour ouvrir le modal maintenance avec le kilométrage pré-rempli
  const openMaintenanceModal = () => {
    setMaintenanceData(prev => ({ ...prev, mileage: getCurrentMileage() }))
    setMaintenanceModal(true)
  }

  // Fonction pour ouvrir le modal contrôle technique avec le kilométrage pré-rempli
  const openControlModal = () => {
    const today = new Date()
    const expDate = new Date(today)
    expDate.setFullYear(expDate.getFullYear() + 2)
    setControlData({
      date: today.toISOString().split('T')[0],
      expirationDate: expDate.toISOString().split('T')[0],
      result: 'passed',
      mileage: getCurrentMileage(),
      center: '',
      cost: '',
      notes: ''
    })
    setControlModal(true)
  }

  // Fonction pour mettre à jour le kilométrage dans les champs personnalisés
  const updateMileageIfHigher = async (newMileage: number | string | null, currentObject: any) => {
    if (!newMileage || !currentObject) return
    const mileageNum = typeof newMileage === 'string' ? parseInt(newMileage) : newMileage
    if (isNaN(mileageNum)) return
    
    const currentMileage = currentObject?.customFields?.kilometrage ? parseInt(currentObject.customFields.kilometrage) : 0
    
    if (mileageNum > currentMileage) {
      try {
        await api.put(`/objects/${id}`, {
          customFields: {
            ...currentObject?.customFields,
            kilometrage: mileageNum
          }
        })
        queryClient.invalidateQueries({ queryKey: ['object', id] })
      } catch (error) {
        console.error('Erreur mise à jour kilométrage:', error)
      }
    }
  }

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

  // Récupérer les stations de carburant
  const { data: fuelStations = [], refetch: refetchStations } = useQuery({
    queryKey: ['fuelStations'],
    queryFn: async () => {
      const response = await api.get('/objects/fuel-stations/list')
      return response.data.stations as Array<{ id: number; name: string; address?: string }>
    }
  })

  // Récupérer les types d'entretien
  const { data: maintenanceTypes = [], refetch: refetchMaintenanceTypes } = useQuery({
    queryKey: ['maintenanceTypes'],
    queryFn: async () => {
      const response = await api.get('/objects/maintenance-types/list')
      return response.data.types as Array<{ id: number; name: string }>
    }
  })

  // Récupérer les prestataires d'entretien
  const { data: maintenanceProviders = [], refetch: refetchMaintenanceProviders } = useQuery({
    queryKey: ['maintenanceProviders'],
    queryFn: async () => {
      const response = await api.get('/objects/maintenance-providers/list')
      return response.data.providers as Array<{ id: number; name: string; address?: string; phone?: string }>
    }
  })

  // Récupérer les centres de contrôle technique
  const { data: controlCenters = [], refetch: refetchControlCenters } = useQuery({
    queryKey: ['controlCenters'],
    queryFn: async () => {
      const response = await api.get('/objects/control-centers/list')
      return response.data.centers as Array<{ id: number; name: string; address?: string; phone?: string }>
    }
  })

  // Récupérer la configuration des champs personnalisés
  const { data: fieldsConfig } = useQuery({
    queryKey: ['customFieldsForObject', id],
    queryFn: async () => {
      const response = await api.get(`/custom-fields/for-object/${id}`)
      return response.data.fields as Array<{
        fieldName: string;
        fieldLabel: string;
        fieldType: string;
        isVisible: boolean;
        isSystem: boolean;
      }>
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Plein ajouté')
      setFuelModal(false)
      // Mettre à jour le kilométrage si supérieur
      updateMileageIfHigher(variables.mileage, object)
      setFuelData({ date: new Date().toISOString().split('T')[0], fuelType: '', quantity: '', cost: '', mileage: '', station: '', notes: '', attachments: [] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const updateFuelMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number, data: any }) => {
      return api.put(`/objects/${id}/fuel/${entryId}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Plein modifié')
      setFuelEditModal(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification')
    }
  })

  const deleteFuelMutation = useMutation({
    mutationFn: async (entryId: number) => {
      return api.delete(`/objects/${id}/fuel/${entryId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Plein supprimé')
      setFuelDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression')
    }
  })

  // Mutations pour les stations
  const addStationMutation = useMutation({
    mutationFn: async (data: { name: string; address?: string }) => {
      return api.post('/objects/fuel-stations', data)
    },
    onSuccess: () => {
      refetchStations()
      toast.success('Station ajoutée')
      setStationEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout')
    }
  })

  const updateStationMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; address?: string } }) => {
      return api.put(`/objects/fuel-stations/${id}`, data)
    },
    onSuccess: () => {
      refetchStations()
      toast.success('Station modifiée')
      setStationEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la modification')
    }
  })

  const deleteStationMutation = useMutation({
    mutationFn: async (stationId: number) => {
      return api.delete(`/objects/fuel-stations/${stationId}`)
    },
    onSuccess: () => {
      refetchStations()
      toast.success('Station supprimée')
      setStationDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  const addMaintenanceMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post(`/objects/${id}/maintenance`, data)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Entretien ajouté')
      setMaintenanceModal(false)
      // Mettre à jour le kilométrage si supérieur
      updateMileageIfHigher(variables.mileage, object)
      setMaintenanceData({ date: new Date().toISOString().split('T')[0], type: '', description: '', cost: '', mileage: '', nextDate: '', provider: '', notes: '', attachments: [] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const updateMaintenanceMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number, data: any }) => {
      return api.put(`/objects/${id}/maintenance/${entryId}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Entretien modifié')
      setMaintenanceEditModal(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification')
    }
  })

  const deleteMaintenanceMutation = useMutation({
    mutationFn: async (entryId: number) => {
      return api.delete(`/objects/${id}/maintenance/${entryId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Entretien supprimé')
      setMaintenanceDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression')
    }
  })

  // Mutations pour les types d'entretien
  const addMaintenanceTypeMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      return api.post('/objects/maintenance-types', data)
    },
    onSuccess: () => {
      refetchMaintenanceTypes()
      toast.success('Type d\'entretien ajouté')
      setMaintenanceTypeEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout')
    }
  })

  const updateMaintenanceTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string } }) => {
      return api.put(`/objects/maintenance-types/${id}`, data)
    },
    onSuccess: () => {
      refetchMaintenanceTypes()
      toast.success('Type d\'entretien modifié')
      setMaintenanceTypeEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la modification')
    }
  })

  const deleteMaintenanceTypeMutation = useMutation({
    mutationFn: async (typeId: number) => {
      return api.delete(`/objects/maintenance-types/${typeId}`)
    },
    onSuccess: () => {
      refetchMaintenanceTypes()
      toast.success('Type d\'entretien supprimé')
      setMaintenanceTypeDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  // Mutations pour les prestataires
  const addMaintenanceProviderMutation = useMutation({
    mutationFn: async (data: { name: string; address?: string; phone?: string }) => {
      return api.post('/objects/maintenance-providers', data)
    },
    onSuccess: () => {
      refetchMaintenanceProviders()
      toast.success('Prestataire ajouté')
      setMaintenanceProviderEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout')
    }
  })

  const updateMaintenanceProviderMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; address?: string; phone?: string } }) => {
      return api.put(`/objects/maintenance-providers/${id}`, data)
    },
    onSuccess: () => {
      refetchMaintenanceProviders()
      toast.success('Prestataire modifié')
      setMaintenanceProviderEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la modification')
    }
  })

  const deleteMaintenanceProviderMutation = useMutation({
    mutationFn: async (providerId: number) => {
      return api.delete(`/objects/maintenance-providers/${providerId}`)
    },
    onSuccess: () => {
      refetchMaintenanceProviders()
      toast.success('Prestataire supprimé')
      setMaintenanceProviderDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  const addControlMutation = useMutation({
    mutationFn: async (data: any) => {
      // Mapper les champs client vers les champs attendus par le serveur
      const mappedData = {
        controlDate: data.date,
        expiryDate: data.expirationDate,
        result: data.result,
        mileage: data.mileage ? parseInt(data.mileage) : null,
        centerName: data.center,
        cost: data.cost ? parseFloat(data.cost) : null,
        notes: data.notes,
        attachments: data.attachments
      }
      return api.post(`/objects/${id}/technical-control`, mappedData)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Contrôle technique ajouté')
      setControlModal(false)
      // Mettre à jour le kilométrage si supérieur
      updateMileageIfHigher(variables.mileage, object)
      const today = new Date()
      const expDate = new Date(today)
      expDate.setFullYear(expDate.getFullYear() + 2)
      setControlData({ 
        date: today.toISOString().split('T')[0], 
        expirationDate: expDate.toISOString().split('T')[0], 
        result: 'passed', 
        mileage: '', 
        center: '', 
        cost: '', 
        notes: '',
        attachments: []
      })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const updateControlMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number; data: any }) => {
      // Mapper les champs client vers les champs attendus par le serveur
      const mappedData = {
        controlDate: data.date,
        expiryDate: data.expirationDate,
        result: data.result,
        mileage: data.mileage,
        centerName: data.center,
        cost: data.cost,
        notes: data.notes,
        attachments: data.attachments
      }
      return api.put(`/objects/${id}/technical-control/${entryId}`, mappedData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Contrôle technique modifié')
      setControlEditModal(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification')
    }
  })

  const deleteControlMutation = useMutation({
    mutationFn: async (entryId: number) => {
      return api.delete(`/objects/${id}/technical-control/${entryId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Contrôle technique supprimé')
      setControlDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression')
    }
  })

  // Mutations pour les centres de contrôle
  const addControlCenterMutation = useMutation({
    mutationFn: async (data: { name: string; address?: string; phone?: string }) => {
      return api.post('/objects/control-centers', data)
    },
    onSuccess: () => {
      refetchControlCenters()
      toast.success('Centre de contrôle ajouté')
      setControlCenterEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout')
    }
  })

  const updateControlCenterMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; address?: string; phone?: string } }) => {
      return api.put(`/objects/control-centers/${id}`, data)
    },
    onSuccess: () => {
      refetchControlCenters()
      toast.success('Centre de contrôle modifié')
      setControlCenterEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la modification')
    }
  })

  const deleteControlCenterMutation = useMutation({
    mutationFn: async (centerId: number) => {
      return api.delete(`/objects/control-centers/${centerId}`)
    },
    onSuccess: () => {
      refetchControlCenters()
      toast.success('Centre de contrôle supprimé')
      setControlCenterDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
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
                      {/* Champs personnalisés en mode édition */}
                      {fieldsConfig && fieldsConfig.filter(f => !f.isSystem && f.isVisible).length > 0 && (
                        <div className="pt-4 border-t space-y-4">
                          <h4 className="font-medium text-gray-700">Champs personnalisés</h4>
                          {fieldsConfig.filter(f => !f.isSystem && f.isVisible).map((field) => {
                            const value = editFormData?.customFields?.[field.fieldName] || ''
                            const handleFieldChange = (newValue: string) => {
                              setEditFormData({
                                ...editFormData,
                                customFields: {
                                  ...editFormData?.customFields,
                                  [field.fieldName]: newValue
                                }
                              })
                            }
                            
                            if (field.fieldType === 'textarea') {
                              return (
                                <TextArea
                                  key={field.fieldName}
                                  label={field.fieldLabel}
                                  value={value}
                                  onChange={(e) => handleFieldChange(e.target.value)}
                                  rows={2}
                                />
                              )
                            }
                            if (field.fieldType === 'select' && field.fieldOptions) {
                              return (
                                <Select
                                  key={field.fieldName}
                                  label={field.fieldLabel}
                                  value={value}
                                  onChange={(e) => handleFieldChange(e.target.value)}
                                  options={[
                                    { value: '', label: 'Sélectionner...' },
                                    ...field.fieldOptions.map((opt: string) => ({ value: opt, label: opt }))
                                  ]}
                                />
                              )
                            }
                            return (
                              <Input
                                key={field.fieldName}
                                label={field.fieldLabel}
                                type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'}
                                value={value}
                                onChange={(e) => handleFieldChange(e.target.value)}
                              />
                            )
                          })}
                        </div>
                      )}
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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Informations détaillées</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const basePath = object.subcategory 
                  ? `/categories/${object.category?.slug}/${object.subcategory.slug}`
                  : `/categories/${object.category?.slug}`
                navigate(`${basePath}/fields`)
              }}
              title="Configurer les champs"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Afficher les champs selon la configuration */}
              {fieldsConfig ? (
                fieldsConfig.filter(f => f.isVisible).map((field) => {
                  // Champs système
                  if (field.isSystem) {
                    switch (field.fieldName) {
                      case 'category':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900">{object.category?.name || '-'}</p>
                          </div>
                        )
                      case 'subcategory':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900">{object.subcategory?.name || '-'}</p>
                          </div>
                        )
                      case 'updatedAt':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900">{object.updatedAt ? formatDate(object.updatedAt) : '-'}</p>
                          </div>
                        )
                      case 'id':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900 font-mono text-sm">#{object.id}</p>
                          </div>
                        )
                      default:
                        return null
                    }
                  }
                  // Champs personnalisés
                  const value = object.customFields?.[field.fieldName]
                  return (
                    <div key={field.fieldName}>
                      <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                      <p className="text-gray-900">
                        {value !== undefined && value !== null && value !== '' 
                          ? (field.fieldType === 'date' ? formatDate(String(value)) : String(value))
                          : '-'
                        }
                      </p>
                    </div>
                  )
                })
              ) : (
                // Affichage par défaut si pas de configuration
                <>
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
                </>
              )}
            </div>

            {/* Champs personnalisés non configurés (rétrocompatibilité) */}
            {!fieldsConfig && object.customFields && Object.keys(object.customFields).length > 0 && (
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
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
            <CardTitle className="flex items-center gap-2">
              <Fuel className="w-5 h-5 text-green-600" />
              Historique carburant
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer..."
                  value={fuelFilter}
                  onChange={(e) => setFuelFilter(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white"
                />
              </div>
              <button
                onClick={() => setFuelSortDesc(!fuelSortDesc)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title={fuelSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => setStationsModal(true)} title="Gérer les stations">
                  <Settings2 className="w-4 h-4" />
                </Button>
              )}
              <Button size="sm" onClick={openFuelModal}>
                <Plus className="w-4 h-4 mr-1" />
                Ajouter un plein
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {object.fuelRecords && object.fuelRecords.length > 0 ? (
              (() => {
                const filteredFuel = object.fuelRecords.filter((record: any) => {
                  if (!fuelFilter) return true
                  const search = fuelFilter.toLowerCase()
                  const dateFormatted = record.date ? formatDate(record.date).toLowerCase() : ''
                  return (
                    dateFormatted.includes(search) ||
                    record.date?.toLowerCase().includes(search) ||
                    record.fuelType?.toLowerCase().includes(search) ||
                    record.station?.toLowerCase().includes(search) ||
                    record.quantity?.toString().includes(search) ||
                    record.cost?.toString().includes(search) ||
                    record.mileage?.toString().includes(search)
                  )
                })
                // Trier par date
                const sortedFuel = [...filteredFuel].sort((a: any, b: any) => {
                  const dateA = new Date(a.date).getTime()
                  const dateB = new Date(b.date).getTime()
                  return fuelSortDesc ? dateB - dateA : dateA - dateB
                })
                return sortedFuel.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantité</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prix/L</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Coût total</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kilométrage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pièces jointes</th>
                      {isAdmin && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedFuel.map((record: any) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatDate(record.date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{record.fuelType || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{record.quantity} L</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{record.unitPrice ? `${parseFloat(record.unitPrice).toFixed(3)} €/L` : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatCurrency(record.cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{record.mileage ? `${record.mileage} km` : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{record.station || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.attachments && record.attachments.length > 0 ? (
                            <AttachmentViewer attachments={record.attachments} compact />
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setFuelEditModal({
                                  id: record.id,
                                  date: record.date,
                                  fuelType: record.fuelType || '',
                                  quantity: record.quantity || '',
                                  cost: record.cost || '',
                                  mileage: record.mileage || '',
                                  station: record.station || '',
                                  notes: record.notes || '',
                                  attachments: record.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setFuelDeleteConfirm(record.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                ) : (
                  <div className="text-center py-12">
                    <Fuel className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucun résultat pour "{fuelFilter}"</p>
                  </div>
                )
              })()
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
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-orange-600" />
              Historique des entretiens
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer..."
                  value={maintenanceFilter}
                  onChange={(e) => setMaintenanceFilter(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white"
                />
              </div>
              <button
                onClick={() => setMaintenanceSortDesc(!maintenanceSortDesc)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title={maintenanceSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => setMaintenanceSettingsModal(true)} title="Gérer les types et prestataires">
                  <Settings2 className="w-4 h-4" />
                </Button>
              )}
              <Button size="sm" onClick={openMaintenanceModal}>
                <Plus className="w-4 h-4 mr-1" />
                Ajouter un entretien
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {object.maintenanceRecords && object.maintenanceRecords.length > 0 ? (
              (() => {
                const filteredMaintenance = object.maintenanceRecords.filter((record: any) => {
                  if (!maintenanceFilter) return true
                  const search = maintenanceFilter.toLowerCase()
                  const dateFormatted = record.date ? formatDate(record.date).toLowerCase() : ''
                  return (
                    dateFormatted.includes(search) ||
                    record.date?.toLowerCase().includes(search) ||
                    record.type?.toLowerCase().includes(search) ||
                    record.provider?.toLowerCase().includes(search) ||
                    record.description?.toLowerCase().includes(search) ||
                    record.cost?.toString().includes(search) ||
                    record.mileage?.toString().includes(search)
                  )
                })
                // Trier par date
                const sortedMaintenance = [...filteredMaintenance].sort((a: any, b: any) => {
                  const dateA = new Date(a.date).getTime()
                  const dateB = new Date(b.date).getTime()
                  return maintenanceSortDesc ? dateB - dateA : dateA - dateB
                })
                return sortedMaintenance.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Coût</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kilométrage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prestataire</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prochain</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pièces jointes</th>
                      {isAdmin && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedMaintenance.map((record: any) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatDate(record.date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{record.type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatCurrency(record.cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{record.mileage ? `${record.mileage} km` : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{record.provider || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.nextDate ? (
                            <span className="text-orange-600">{formatDate(record.nextDate)}</span>
                          ) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.attachments && record.attachments.length > 0 ? (
                            <AttachmentViewer attachments={record.attachments} compact />
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setMaintenanceEditModal({
                                  id: record.id,
                                  date: record.date,
                                  type: record.type || '',
                                  description: record.description || '',
                                  cost: record.cost || '',
                                  mileage: record.mileage || '',
                                  nextDate: record.nextDate || '',
                                  provider: record.provider || '',
                                  notes: record.notes || '',
                                  attachments: record.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setMaintenanceDeleteConfirm(record.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                ) : (
                  <div className="text-center py-12">
                    <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucun résultat pour "{maintenanceFilter}"</p>
                  </div>
                )
              })()
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
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600" />
              Contrôles techniques
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer..."
                  value={controlFilter}
                  onChange={(e) => setControlFilter(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white"
                />
              </div>
              <button
                onClick={() => setControlSortDesc(!controlSortDesc)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title={controlSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {(user?.role === 'admin' || user?.role === 'supervisor') && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setControlCentersModal(true)}
                  title="Gérer les centres de contrôle"
                >
                  <Settings2 className="w-4 h-4" />
                </Button>
              )}
              <Button size="sm" onClick={openControlModal}>
                <Plus className="w-4 h-4 mr-1" />
                Ajouter un contrôle
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {object.technicalControls && object.technicalControls.length > 0 ? (
              (() => {
                const filteredControl = object.technicalControls.filter((control: any) => {
                  if (!controlFilter) return true
                  const search = controlFilter.toLowerCase()
                  const resultText = control.result === 'passed' ? 'favorable' : control.result === 'failed' ? 'défavorable' : 'contre-visite'
                  const dateFormatted = control.date ? formatDate(control.date).toLowerCase() : ''
                  const expiryFormatted = control.expiryDate ? formatDate(control.expiryDate).toLowerCase() : ''
                  return (
                    dateFormatted.includes(search) ||
                    expiryFormatted.includes(search) ||
                    control.date?.toLowerCase().includes(search) ||
                    control.centerName?.toLowerCase().includes(search) ||
                    control.expiryDate?.toLowerCase().includes(search) ||
                    resultText.includes(search) ||
                    control.cost?.toString().includes(search) ||
                    control.mileage?.toString().includes(search)
                  )
                })
                // Trier par date
                const sortedControl = [...filteredControl].sort((a: any, b: any) => {
                  const dateA = new Date(a.date).getTime()
                  const dateB = new Date(b.date).getTime()
                  return controlSortDesc ? dateB - dateA : dateA - dateB
                })
                return sortedControl.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Résultat</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Centre</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kilométrage</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Coût</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expiration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pièces jointes</th>
                      {(user?.role === 'admin' || user?.role === 'supervisor') && (
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedControl.map((control: any) => (
                      <tr key={control.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(control.date)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge variant={control.result === 'passed' ? 'success' : control.result === 'failed' ? 'danger' : 'warning'}>
                            {control.result === 'passed' ? 'Favorable' : 
                             control.result === 'failed' ? 'Défavorable' : 'Contre-visite'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {control.centerName || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {control.mileage ? `${control.mileage} km` : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                          {formatCurrency(control.cost)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {control.expiryDate ? (
                            <span className={new Date(control.expiryDate) < new Date() ? 'text-red-600' : 'text-green-600'}>
                              {formatDate(control.expiryDate)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {control.attachments && control.attachments.length > 0 ? (
                            <AttachmentViewer attachments={control.attachments} compact />
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        {(user?.role === 'admin' || user?.role === 'supervisor') && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setControlEditModal({
                                  id: control.id,
                                  date: control.date?.split('T')[0] || '',
                                  expirationDate: control.expiryDate?.split('T')[0] || '',
                                  result: control.result || 'passed',
                                  mileage: control.mileage?.toString() || '',
                                  center: control.centerName || '',
                                  cost: control.cost?.toString() || '',
                                  notes: control.notes || '',
                                  attachments: control.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                title="Modifier"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setControlDeleteConfirm(control.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                ) : (
                  <div className="text-center py-12">
                    <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucun résultat pour "{controlFilter}"</p>
                  </div>
                )
              })()
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
            <div className="relative">
              <Input
                label="Station"
                value={fuelData.station}
                onChange={(e) => setFuelData({ ...fuelData, station: e.target.value })}
                list="fuel-stations-list"
                placeholder="Sélectionner ou saisir une station"
              />
              <datalist id="fuel-stations-list">
                {fuelStations.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            <TextArea
              label="Notes"
              value={fuelData.notes}
              onChange={(e) => setFuelData({ ...fuelData, notes: e.target.value })}
              rows={2}
            />
            <FileUpload
              label="Pièces jointes"
              value={fuelData.attachments}
              onChange={(files) => setFuelData({ ...fuelData, attachments: files })}
              hint="Joindre des tickets, factures ou photos (PDF, images)"
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

      {/* Modal Édition Carburant */}
      <Modal isOpen={!!fuelEditModal} onClose={() => setFuelEditModal(null)} title="Modifier le plein">
        {fuelEditModal && (
          <form onSubmit={(e) => { 
            e.preventDefault(); 
            updateFuelMutation.mutate({ 
              entryId: fuelEditModal.id, 
              data: {
                date: fuelEditModal.date,
                fuelType: fuelEditModal.fuelType,
                quantity: fuelEditModal.quantity,
                cost: fuelEditModal.cost,
                mileage: fuelEditModal.mileage,
                station: fuelEditModal.station,
                notes: fuelEditModal.notes,
                attachments: fuelEditModal.attachments || []
              }
            }); 
          }}>
            <ModalBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Date"
                  type="date"
                  value={fuelEditModal.date}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, date: e.target.value })}
                  required
                />
                <Input
                  label="Type de carburant"
                  value={fuelEditModal.fuelType}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, fuelType: e.target.value })}
                  placeholder="Ex: Diesel, SP95..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Quantité (L)"
                  type="number"
                  step="0.01"
                  value={fuelEditModal.quantity}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, quantity: e.target.value })}
                  required
                />
                <Input
                  label="Coût total (€)"
                  type="number"
                  step="0.01"
                  value={fuelEditModal.cost}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, cost: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Kilométrage"
                  type="number"
                  value={fuelEditModal.mileage}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, mileage: e.target.value })}
                />
                <div className="relative">
                  <Input
                    label="Station"
                    value={fuelEditModal.station}
                    onChange={(e) => setFuelEditModal({ ...fuelEditModal, station: e.target.value })}
                    list="fuel-stations-edit-list"
                    placeholder="Sélectionner ou saisir une station"
                  />
                  <datalist id="fuel-stations-edit-list">
                    {fuelStations.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                </div>
              </div>
              <TextArea
                label="Notes"
                value={fuelEditModal.notes}
                onChange={(e) => setFuelEditModal({ ...fuelEditModal, notes: e.target.value })}
                rows={2}
              />
              <FileUpload
                label="Pièces jointes"
                value={fuelEditModal.attachments || []}
                onChange={(files) => setFuelEditModal({ ...fuelEditModal, attachments: files })}
                hint="Joindre des tickets, factures ou photos (PDF, images)"
              />
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setFuelEditModal(null)}>
                Annuler
              </Button>
              <Button type="submit" loading={updateFuelMutation.isPending}>
                Enregistrer
              </Button>
            </ModalFooter>
          </form>
        )}
      </Modal>

      {/* Modal Confirmation Suppression Carburant */}
      <Modal isOpen={!!fuelDeleteConfirm} onClose={() => setFuelDeleteConfirm(null)} title="Confirmer la suppression">
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer cette entrée carburant ? Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setFuelDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteFuelMutation.isPending}
            onClick={() => fuelDeleteConfirm && deleteFuelMutation.mutate(fuelDeleteConfirm)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Gestion des Stations */}
      <Modal isOpen={stationsModal} onClose={() => setStationsModal(false)} title="Gérer les stations">
        <ModalBody className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStationEditData({ name: '', address: '' })}>
              <Plus className="w-4 h-4 mr-1" />
              Ajouter une station
            </Button>
          </div>
          
          {fuelStations.length > 0 ? (
            <div className="divide-y divide-gray-200 border rounded-lg">
              {fuelStations.map((station) => (
                <div key={station.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-900">{station.name}</p>
                    {station.address && (
                      <p className="text-sm text-gray-500">{station.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStationEditData({ id: station.id, name: station.name, address: station.address || '' })}
                      className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                      title="Modifier"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setStationDeleteConfirm(station.id)}
                      className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>Aucune station enregistrée</p>
              <p className="text-sm mt-1">Ajoutez des stations pour les retrouver facilement lors de vos pleins</p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setStationsModal(false)}>
            Fermer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Ajout/Edition Station */}
      <Modal 
        isOpen={!!stationEditData} 
        onClose={() => setStationEditData(null)} 
        title={stationEditData?.id ? 'Modifier la station' : 'Ajouter une station'}
      >
        {stationEditData && (
          <form onSubmit={(e) => {
            e.preventDefault()
            if (stationEditData.id) {
              updateStationMutation.mutate({ id: stationEditData.id, data: { name: stationEditData.name, address: stationEditData.address } })
            } else {
              addStationMutation.mutate({ name: stationEditData.name, address: stationEditData.address })
            }
          }}>
            <ModalBody className="space-y-4">
              <Input
                label="Nom de la station"
                value={stationEditData.name}
                onChange={(e) => setStationEditData({ ...stationEditData, name: e.target.value })}
                placeholder="Ex: Total Barentin"
                required
              />
              <Input
                label="Adresse (optionnel)"
                value={stationEditData.address}
                onChange={(e) => setStationEditData({ ...stationEditData, address: e.target.value })}
                placeholder="Ex: 123 rue de la Gare, 76360 Barentin"
              />
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setStationEditData(null)}>
                Annuler
              </Button>
              <Button type="submit" loading={addStationMutation.isPending || updateStationMutation.isPending}>
                {stationEditData.id ? 'Enregistrer' : 'Ajouter'}
              </Button>
            </ModalFooter>
          </form>
        )}
      </Modal>

      {/* Modal Confirmation Suppression Station */}
      <Modal isOpen={!!stationDeleteConfirm} onClose={() => setStationDeleteConfirm(null)} title="Supprimer la station">
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer cette station ? Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setStationDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteStationMutation.isPending}
            onClick={() => stationDeleteConfirm && deleteStationMutation.mutate(stationDeleteConfirm)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Entretien */}
      <Modal isOpen={maintenanceModal} onClose={() => setMaintenanceModal(false)} title="Ajouter un entretien">
        <form onSubmit={(e) => { 
          e.preventDefault(); 
          addMaintenanceMutation.mutate({
            maintenanceDate: maintenanceData.date,
            maintenanceType: maintenanceData.type,
            notes: maintenanceData.description || maintenanceData.notes,
            cost: maintenanceData.cost,
            mileage: maintenanceData.mileage,
            nextDate: maintenanceData.nextDate,
            provider: maintenanceData.provider,
            attachments: maintenanceData.attachments
          }); 
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={maintenanceData.date}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, date: e.target.value })}
                required
              />
              <div className="relative">
                <Input
                  label="Type d'entretien"
                  value={maintenanceData.type}
                  onChange={(e) => setMaintenanceData({ ...maintenanceData, type: e.target.value })}
                  list="maintenance-types-list"
                  required
                />
                <datalist id="maintenance-types-list">
                  {maintenanceTypes.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
              </div>
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
              <div className="relative">
                <Input
                  label="Prestataire"
                  value={maintenanceData.provider}
                  onChange={(e) => setMaintenanceData({ ...maintenanceData, provider: e.target.value })}
                  list="maintenance-providers-list"
                />
                <datalist id="maintenance-providers-list">
                  {maintenanceProviders.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </div>
              <Input
                label="Prochain entretien"
                type="date"
                value={maintenanceData.nextDate}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, nextDate: e.target.value })}
              />
            </div>
            <FileUpload
              label="Pièces jointes"
              value={maintenanceData.attachments}
              onChange={(files) => setMaintenanceData({ ...maintenanceData, attachments: files })}
              hint="Joindre des factures, bons de commande ou photos (PDF, images)"
            />
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

      {/* Modal Édition Entretien */}
      <Modal isOpen={!!maintenanceEditModal} onClose={() => setMaintenanceEditModal(null)} title="Modifier l'entretien">
        <form onSubmit={(e) => {
          e.preventDefault()
          if (maintenanceEditModal) {
            updateMaintenanceMutation.mutate({
              entryId: maintenanceEditModal.id,
              data: {
                maintenanceDate: maintenanceEditModal.date,
                maintenanceType: maintenanceEditModal.type,
                notes: maintenanceEditModal.description || maintenanceEditModal.notes,
                cost: maintenanceEditModal.cost,
                mileage: maintenanceEditModal.mileage,
                nextDate: maintenanceEditModal.nextDate,
                provider: maintenanceEditModal.provider,
                attachments: maintenanceEditModal.attachments || []
              }
            })
          }
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={maintenanceEditModal?.date || ''}
                onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, date: e.target.value })}
                required
              />
              <div className="relative">
                <Input
                  label="Type d'entretien"
                  value={maintenanceEditModal?.type || ''}
                  onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, type: e.target.value })}
                  list="maintenance-types-list-edit"
                  required
                />
                <datalist id="maintenance-types-list-edit">
                  {maintenanceTypes.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
              </div>
            </div>
            <TextArea
              label="Description"
              value={maintenanceEditModal?.description || ''}
              onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, description: e.target.value })}
              rows={2}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={maintenanceEditModal?.cost || ''}
                onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, cost: e.target.value })}
              />
              <Input
                label="Kilométrage"
                type="number"
                value={maintenanceEditModal?.mileage || ''}
                onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, mileage: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <Input
                  label="Prestataire"
                  value={maintenanceEditModal?.provider || ''}
                  onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, provider: e.target.value })}
                  list="maintenance-providers-list-edit"
                />
                <datalist id="maintenance-providers-list-edit">
                  {maintenanceProviders.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </div>
              <Input
                label="Prochain entretien"
                type="date"
                value={maintenanceEditModal?.nextDate || ''}
                onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, nextDate: e.target.value })}
              />
            </div>
            <FileUpload
              label="Pièces jointes"
              value={maintenanceEditModal?.attachments || []}
              onChange={(files) => setMaintenanceEditModal({ ...maintenanceEditModal, attachments: files })}
              hint="Joindre des factures, bons de commande ou photos (PDF, images)"
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setMaintenanceEditModal(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={updateMaintenanceMutation.isPending}>
              Modifier
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal Confirmation suppression entretien */}
      <Modal isOpen={!!maintenanceDeleteConfirm} onClose={() => setMaintenanceDeleteConfirm(null)} title="Confirmer la suppression">
        <ModalBody>
          <p className="text-gray-600">Êtes-vous sûr de vouloir supprimer cet entretien ? Cette action est irréversible.</p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setMaintenanceDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteMaintenanceMutation.isPending}
            onClick={() => maintenanceDeleteConfirm && deleteMaintenanceMutation.mutate(maintenanceDeleteConfirm)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Gestion Types et Prestataires d'entretien */}
      <Modal isOpen={maintenanceSettingsModal} onClose={() => setMaintenanceSettingsModal(false)} title="Gérer les types et prestataires" size="lg">
        <ModalBody className="space-y-6">
          {/* Types d'entretien */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-gray-900">Types d'entretien</h4>
              <Button 
                size="sm" 
                variant="secondary"
                onClick={() => setMaintenanceTypeEditData({ name: '' })}
              >
                <Plus className="w-4 h-4 mr-1" />
                Ajouter
              </Button>
            </div>
            
            {maintenanceTypeEditData && !maintenanceTypeEditData.id && (
              <div className="mb-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nom du type d'entretien"
                    value={maintenanceTypeEditData.name}
                    onChange={(e) => setMaintenanceTypeEditData({ ...maintenanceTypeEditData, name: e.target.value })}
                    className="flex-1"
                  />
                  <Button size="sm" onClick={() => addMaintenanceTypeMutation.mutate({ name: maintenanceTypeEditData.name })} loading={addMaintenanceTypeMutation.isPending}>
                    Ajouter
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMaintenanceTypeEditData(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {maintenanceTypes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">Aucun type d'entretien configuré</p>
              ) : (
                maintenanceTypes.map((type) => (
                  <div key={type.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    {maintenanceTypeEditData?.id === type.id ? (
                      <div className="flex gap-2 flex-1">
                        <Input
                          value={maintenanceTypeEditData.name}
                          onChange={(e) => setMaintenanceTypeEditData({ ...maintenanceTypeEditData, name: e.target.value })}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={() => updateMaintenanceTypeMutation.mutate({ id: type.id, data: { name: maintenanceTypeEditData.name } })} loading={updateMaintenanceTypeMutation.isPending}>
                          Enregistrer
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setMaintenanceTypeEditData(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : maintenanceTypeDeleteConfirm === type.id ? (
                      <div className="flex items-center justify-between flex-1">
                        <span className="text-sm text-red-600">Confirmer la suppression ?</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="danger" onClick={() => deleteMaintenanceTypeMutation.mutate(type.id)} loading={deleteMaintenanceTypeMutation.isPending}>
                            Oui
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setMaintenanceTypeDeleteConfirm(null)}>
                            Non
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-medium">{type.name}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setMaintenanceTypeEditData({ id: type.id, name: type.name })}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMaintenanceTypeDeleteConfirm(type.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <hr />

          {/* Prestataires */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-gray-900">Prestataires</h4>
              <Button 
                size="sm" 
                variant="secondary"
                onClick={() => setMaintenanceProviderEditData({ name: '', address: '', phone: '' })}
              >
                <Plus className="w-4 h-4 mr-1" />
                Ajouter
              </Button>
            </div>
            
            {maintenanceProviderEditData && !maintenanceProviderEditData.id && (
              <div className="mb-3 p-3 bg-gray-50 rounded-lg space-y-2">
                <Input
                  placeholder="Nom du prestataire"
                  value={maintenanceProviderEditData.name}
                  onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, name: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Adresse (optionnel)"
                    value={maintenanceProviderEditData.address}
                    onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, address: e.target.value })}
                  />
                  <Input
                    placeholder="Téléphone (optionnel)"
                    value={maintenanceProviderEditData.phone}
                    onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, phone: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setMaintenanceProviderEditData(null)}>
                    Annuler
                  </Button>
                  <Button size="sm" onClick={() => addMaintenanceProviderMutation.mutate(maintenanceProviderEditData)} loading={addMaintenanceProviderMutation.isPending}>
                    Ajouter
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {maintenanceProviders.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">Aucun prestataire configuré</p>
              ) : (
                maintenanceProviders.map((provider) => (
                  <div key={provider.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    {maintenanceProviderEditData?.id === provider.id ? (
                      <div className="flex-1 space-y-2">
                        <Input
                          value={maintenanceProviderEditData.name}
                          onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, name: e.target.value })}
                          placeholder="Nom"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Adresse"
                            value={maintenanceProviderEditData.address}
                            onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, address: e.target.value })}
                          />
                          <Input
                            placeholder="Téléphone"
                            value={maintenanceProviderEditData.phone}
                            onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, phone: e.target.value })}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setMaintenanceProviderEditData(null)}>
                            Annuler
                          </Button>
                          <Button size="sm" onClick={() => updateMaintenanceProviderMutation.mutate({ id: provider.id, data: maintenanceProviderEditData })} loading={updateMaintenanceProviderMutation.isPending}>
                            Enregistrer
                          </Button>
                        </div>
                      </div>
                    ) : maintenanceProviderDeleteConfirm === provider.id ? (
                      <div className="flex items-center justify-between flex-1">
                        <span className="text-sm text-red-600">Confirmer la suppression ?</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="danger" onClick={() => deleteMaintenanceProviderMutation.mutate(provider.id)} loading={deleteMaintenanceProviderMutation.isPending}>
                            Oui
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setMaintenanceProviderDeleteConfirm(null)}>
                            Non
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="text-sm font-medium">{provider.name}</span>
                          {(provider.address || provider.phone) && (
                            <p className="text-xs text-gray-500">
                              {[provider.address, provider.phone].filter(Boolean).join(' • ')}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setMaintenanceProviderEditData({ id: provider.id, name: provider.name, address: provider.address || '', phone: provider.phone || '' })}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMaintenanceProviderDeleteConfirm(provider.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setMaintenanceSettingsModal(false)}>
            Fermer
          </Button>
        </ModalFooter>
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
                onChange={(e) => {
                  const newDate = e.target.value
                  // Calculer automatiquement la date d'expiration à +2 ans
                  let expirationDate = controlData.expirationDate
                  if (newDate) {
                    const expDate = new Date(newDate)
                    expDate.setFullYear(expDate.getFullYear() + 2)
                    expirationDate = expDate.toISOString().split('T')[0]
                  }
                  setControlData({ ...controlData, date: newDate, expirationDate })
                }}
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
              <div className="relative">
                <Input
                  label="Centre de contrôle"
                  value={controlData.center}
                  onChange={(e) => setControlData({ ...controlData, center: e.target.value })}
                  list="controlCenters-list"
                />
                <datalist id="controlCenters-list">
                  {controlCenters.map((center) => (
                    <option key={center.id} value={center.name} />
                  ))}
                </datalist>
              </div>
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
            <FileUpload
              label="Pièces jointes"
              value={controlData.attachments}
              onChange={(files) => setControlData({ ...controlData, attachments: files })}
              hint="Joindre le procès-verbal de contrôle technique (PDF, images)"
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

      {/* Modal Paramètres Centres de contrôle */}
      <Modal 
        isOpen={controlCentersModal} 
        onClose={() => {
          setControlCentersModal(false)
          setControlCenterEditData(null)
          setControlCenterDeleteConfirm(null)
        }} 
        title="Gestion des centres de contrôle"
        size="lg"
      >
        <ModalBody>
          {/* Formulaire d'ajout/modification de centre */}
          <form onSubmit={(e) => {
            e.preventDefault()
            const formData = new FormData(e.target as HTMLFormElement)
            const data = {
              name: formData.get('centerName') as string,
              address: formData.get('centerAddress') as string || undefined,
              phone: formData.get('centerPhone') as string || undefined
            }
            
            if (controlCenterEditData?.id) {
              updateControlCenterMutation.mutate({ id: controlCenterEditData.id, data })
            } else {
              addControlCenterMutation.mutate(data)
            }
            ;(e.target as HTMLFormElement).reset()
          }} className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-3">
              {controlCenterEditData?.id ? 'Modifier le centre' : 'Ajouter un centre de contrôle'}
            </h4>
            <div className="space-y-3">
              <Input
                name="centerName"
                placeholder="Nom du centre"
                defaultValue={controlCenterEditData?.name || ''}
                required
              />
              <Input
                name="centerAddress"
                placeholder="Adresse (optionnel)"
                defaultValue={controlCenterEditData?.address || ''}
              />
              <Input
                name="centerPhone"
                placeholder="Téléphone (optionnel)"
                defaultValue={controlCenterEditData?.phone || ''}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={addControlCenterMutation.isPending || updateControlCenterMutation.isPending}>
                  {controlCenterEditData?.id ? 'Modifier' : 'Ajouter'}
                </Button>
                {controlCenterEditData?.id && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setControlCenterEditData(null)}>
                    Annuler
                  </Button>
                )}
              </div>
            </div>
          </form>

          {/* Liste des centres de contrôle */}
          <div>
            <h4 className="font-medium mb-3">Centres de contrôle existants</h4>
            {controlCenters.length === 0 ? (
              <p className="text-gray-500 text-sm">Aucun centre de contrôle enregistré</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {controlCenters.map((center) => (
                  <div 
                    key={center.id} 
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      controlCenterDeleteConfirm === center.id ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div>
                      <p className="font-medium">{center.name}</p>
                      {(center.address || center.phone) && (
                        <p className="text-xs text-gray-500">
                          {[center.address, center.phone].filter(Boolean).join(' - ')}
                        </p>
                      )}
                    </div>
                    {controlCenterDeleteConfirm === center.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600">Confirmer ?</span>
                        <Button 
                          size="sm" 
                          variant="danger"
                          onClick={() => deleteControlCenterMutation.mutate(center.id)}
                          loading={deleteControlCenterMutation.isPending}
                        >
                          Oui
                        </Button>
                        <Button 
                          size="sm" 
                          variant="secondary"
                          onClick={() => setControlCenterDeleteConfirm(null)}
                        >
                          Non
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setControlCenterEditData(center)}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setControlCenterDeleteConfirm(center.id)}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => {
            setControlCentersModal(false)
            setControlCenterEditData(null)
            setControlCenterDeleteConfirm(null)
          }}>
            Fermer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal Édition contrôle technique */}
      <Modal
        isOpen={!!controlEditModal}
        onClose={() => setControlEditModal(null)}
        title="Modifier le contrôle technique"
      >
        <form onSubmit={(e) => {
          e.preventDefault()
          if (controlEditModal) {
            updateControlMutation.mutate({
              entryId: controlEditModal.id,
              data: {
                date: controlEditModal.date,
                expirationDate: controlEditModal.expirationDate,
                result: controlEditModal.result,
                mileage: controlEditModal.mileage ? parseInt(controlEditModal.mileage) : null,
                center: controlEditModal.center,
                cost: controlEditModal.cost ? parseFloat(controlEditModal.cost) : null,
                notes: controlEditModal.notes,
                attachments: controlEditModal.attachments || []
              }
            })
          }
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date du contrôle"
                type="date"
                value={controlEditModal?.date || ''}
                onChange={(e) => {
                  const newDate = e.target.value
                  // Calculer automatiquement la date d'expiration à +2 ans
                  let expirationDate = controlEditModal?.expirationDate || ''
                  if (newDate) {
                    const expDate = new Date(newDate)
                    expDate.setFullYear(expDate.getFullYear() + 2)
                    expirationDate = expDate.toISOString().split('T')[0]
                  }
                  setControlEditModal({ ...controlEditModal, date: newDate, expirationDate })
                }}
                required
              />
              <Input
                label="Date d'expiration"
                type="date"
                value={controlEditModal?.expirationDate || ''}
                onChange={(e) => setControlEditModal({ ...controlEditModal, expirationDate: e.target.value })}
                required
              />
            </div>
            <Select
              label="Résultat"
              value={controlEditModal?.result || 'passed'}
              onChange={(e) => setControlEditModal({ ...controlEditModal, result: e.target.value })}
              options={[
                { value: 'passed', label: 'Favorable' },
                { value: 'minor', label: 'Contre-visite mineure' },
                { value: 'failed', label: 'Défavorable' }
              ]}
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <Input
                  label="Centre de contrôle"
                  value={controlEditModal?.center || ''}
                  onChange={(e) => setControlEditModal({ ...controlEditModal, center: e.target.value })}
                  list="controlCenters-edit-list"
                />
                <datalist id="controlCenters-edit-list">
                  {controlCenters.map((center) => (
                    <option key={center.id} value={center.name} />
                  ))}
                </datalist>
              </div>
              <Input
                label="Coût (€)"
                type="number"
                step="0.01"
                value={controlEditModal?.cost || ''}
                onChange={(e) => setControlEditModal({ ...controlEditModal, cost: e.target.value })}
              />
            </div>
            <Input
              label="Kilométrage"
              type="number"
              value={controlEditModal?.mileage || ''}
              onChange={(e) => setControlEditModal({ ...controlEditModal, mileage: e.target.value })}
            />
            <TextArea
              label="Notes"
              value={controlEditModal?.notes || ''}
              onChange={(e) => setControlEditModal({ ...controlEditModal, notes: e.target.value })}
              rows={2}
            />
            <FileUpload
              label="Pièces jointes"
              value={controlEditModal?.attachments || []}
              onChange={(files) => setControlEditModal({ ...controlEditModal, attachments: files })}
              hint="Joindre le procès-verbal de contrôle technique (PDF, images)"
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setControlEditModal(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={updateControlMutation.isPending}>
              Enregistrer
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal Confirmation suppression contrôle technique */}
      <Modal
        isOpen={!!controlDeleteConfirm}
        onClose={() => setControlDeleteConfirm(null)}
        title="Confirmer la suppression"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer ce contrôle technique ? Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setControlDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteControlMutation.isPending}
            onClick={() => controlDeleteConfirm && deleteControlMutation.mutate(controlDeleteConfirm)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
