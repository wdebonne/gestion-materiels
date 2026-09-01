import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { 
  ChevronRight, ArrowLeft, Edit2, Package, Fuel, Wrench, 
  ClipboardCheck, Plus, Save, X, Trash2, Pencil,
  Image as ImageIcon, Settings2, Search, ArrowUpDown, Clock, Star, Boxes
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import QRCodeDisplay from '@/components/QRCodeDisplay'
import ObjectTimeline from '@/components/ObjectTimeline'
import Can from '@/components/Can'
import { useFavoritesStore } from '@/stores/favorites.store'
import { useValidation, schemaPlein, schemaEntretien, schemaControle } from '@/lib/validation'
import {
  CarteCompteurs,
  ChampsCompteurs,
  compteurPrincipal,
  formaterCompteur,
  relevesInitiaux,
  relevesPourEnvoi,
  signalerReport,
  type Compteur,
  type Releves,
} from '@/components/Compteurs'
import { libelleOnglet, natureParDefaut, vocabulaire, type NatureEcriture, type NatureEnergie } from '@/lib/energie'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select,
  LoadingInline, Alert, Card, CardBody, CardHeader, CardTitle, Tabs, Badge,
  FileUpload, AttachmentViewer, ReferenceSelect
} from '@/components/ui'
import type { UploadedFile } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate, formatCurrency } from '@/lib/utils'

export default function ObjectDetailPage() {
  const { objectId: id } = useParams<{ objectId: string }>()
  const [parametres, setParametres] = useSearchParams()
  const { enregistrerConsultation, basculerFavori, estFavori } = useFavoritesStore()
  const validationPlein = useValidation<typeof fuelData>(schemaPlein)
  const validationEntretien = useValidation<typeof maintenanceData>(schemaEntretien)
  const validationControle = useValidation<typeof controlData>(schemaControle)
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
  const [stationEditData, setStationEditData] = useState<{ id?: number; name: string; address: string; kind: NatureEcriture } | null>(null)
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
    /** Un relevé par compteur déclaré sur la branche du matériel. */
    readings: Releves
    energyKind: NatureEcriture
    station: string
    notes: string
    attachments: UploadedFile[]
  }>({
    date: new Date().toISOString().split('T')[0],
    fuelType: '',
    quantity: '',
    cost: '',
    readings: {},
    energyKind: 'fuel',
    station: '',
    notes: '',
    attachments: []
  })

  const [maintenanceData, setMaintenanceData] = useState<{
    date: string
    type: string
    description: string
    cost: string
    readings: Releves
    nextDate: string
    provider: string
    notes: string
    attachments: UploadedFile[]
  }>({
    date: new Date().toISOString().split('T')[0],
    type: '',
    description: '',
    cost: '',
    readings: {},
    nextDate: '',
    provider: '',
    notes: '',
    attachments: []
  })

  // Données pour le formulaire de plugin personnalisé
  const [customMaintenanceData, setCustomMaintenanceData] = useState<{
    date: string
    type: string
    description: string
    cost: string
    readings: Releves
    nextDate: string
    provider: string
    notes: string
  }>({
    date: new Date().toISOString().split('T')[0],
    type: '',
    description: '',
    cost: '',
    readings: {},
    nextDate: '',
    provider: '',
    notes: ''
  })

  const [controlData, setControlData] = useState<{
    date: string
    expirationDate: string
    result: string
    readings: Releves
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
      readings: {},
      center: '',
      cost: '',
      notes: '',
      attachments: []
    }
  })

  // Pré-remplir avec la valeur en fiche : au dépôt, le compteur a rarement
  // bougé de plus de quelques kilomètres, et corriger est plus rapide que
  // ressaisir six chiffres avec des gants.
  const openFuelModal = () => {
    setFuelData(prev => ({
      ...prev,
      readings: relevesInitiaux(compteurs),
      energyKind: natureParDefaut(natureEnergie),
    }))
    setFuelModal(true)
  }

  const openMaintenanceModal = () => {
    setMaintenanceData(prev => ({ ...prev, readings: relevesInitiaux(compteurs) }))
    setMaintenanceModal(true)
  }

  const openControlModal = () => {
    const today = new Date()
    const expDate = new Date(today)
    expDate.setFullYear(expDate.getFullYear() + 2)
    setControlData({
      date: today.toISOString().split('T')[0],
      expirationDate: expDate.toISOString().split('T')[0],
      result: 'passed',
      readings: relevesInitiaux(compteurs),
      center: '',
      cost: '',
      notes: '',
      attachments: []
    })
    setControlModal(true)
  }

  /**
   * Relevés d'un formulaire, prêts pour l'API.
   *
   * `mileage` reste transmis pour le compteur principal : le module Suivi, les
   * exports et le modèle d'e-mail de rappel lisent encore cette colonne.
   *
   * Le report sur la fiche n'est plus fait ici. Il l'était par un `PUT` lancé
   * après coup depuis la page, ce qui laissait sans effet tout ce qui n'y
   * passait pas — saisie hors réseau rejouée plus tard, import de fichier,
   * jeton d'API — et exigeait au passage le droit de modifier la fiche entière.
   * Le serveur s'en charge à l'écriture, et renvoie ce qu'il a retenu.
   */
  const relevesAEnvoyer = (readings: Releves) => ({
    readings: relevesPourEnvoi(readings),
    mileage: compteurPrincipal(compteurs, readings),
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
        reference?: string;
        serialNumber?: string;
        purchaseDate?: string;
        purchasePrice?: number;
        supplier?: string;
        warranty?: string;
        notes?: string;
        specifications?: Record<string, any>;
        customFields?: Record<string, any>;
        /** Compteurs déclarés sur la branche, avec leur valeur du moment. */
        counters?: Compteur[];
        /** Ce que le matériel consomme, lu sur son champ d'énergie. */
        energy?: { kind: NatureEnergie; label: string | null };
        createdAt?: string;
        updatedAt?: string;
        category?: any; 
        subcategory?: any;
        fuelRecords?: any[];
        maintenanceRecords?: any[];
        technicalControls?: any[];
        activePlugins?: Array<{ id: number; slug: string; name: string; icon: string }>;
        /** Exemplaire identifié, lot avec quantité, ou prestation. */
        nature?: 'unique' | 'lot' | 'prestation';
        materialType?: 'unique' | 'lot';
        quantityTotal?: number;
        /** Renseignés pour un lot seulement. */
        quantityLent?: number;
        quantityReservedFuture?: number;
        quantityAvailable?: number;
      }
    },
    enabled: !!id
  })

  // Mémoriser la consultation : alimente « Consultés récemment » dans la
  // recherche globale et le raccourci « Faire un plein » de l'accueil.
  useEffect(() => {
    if (!object) return
    enregistrerConsultation({
      id: object.id,
      name: object.name,
      reference: object.reference,
      categoryName: object.category?.name,
    })
  }, [object, enregistrerConsultation])

  // Arrivée depuis le raccourci d'accueil : ouvrir directement la saisie.
  useEffect(() => {
    if (!object || parametres.get('action') !== 'plein') return
    openFuelModal()
    // On retire le paramètre pour que revenir en arrière ne rouvre pas la modale.
    setParametres({}, { replace: true })
  }, [object])

  // Points de ravitaillement. La liste suit la nature de l'écriture en cours :
  // proposer « Total » pour brancher une voiture n'aiderait personne.
  const natureListePoints = fuelEditModal?.energyKind ?? fuelData.energyKind
  const { data: fuelStations = [], refetch: refetchStations } = useQuery({
    queryKey: ['fuelStations', natureListePoints],
    queryFn: async () => {
      const response = await api.get(`/objects/fuel-stations/list?kind=${natureListePoints}`)
      return response.data.stations as Array<{ id: number; name: string; address?: string; kind?: NatureEcriture }>
    }
  })

  // L'écran d'administration du référentiel, lui, les gère ensemble : filtrer
  // ici cacherait à l'administrateur les bornes qu'il vient de créer, selon le
  // matériel depuis lequel il a ouvert la modale.
  const { data: tousLesPoints = [], refetch: refetchTousLesPoints } = useQuery({
    queryKey: ['fuelStations', 'tous'],
    queryFn: async () => {
      const response = await api.get('/objects/fuel-stations/list')
      return response.data.stations as Array<{ id: number; name: string; address?: string; kind?: NatureEcriture }>
    },
    enabled: stationsModal
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
        fieldOptions?: string[];
        isVisible: boolean;
        isSystem: boolean;
      }>
    },
    enabled: !!id
  })

  /**
   * Compteurs déclarés sur la branche du matériel.
   *
   * Vide pour une tondeuse sans heures moteur, une table, un lot de chaises :
   * aucun champ de relevé n'apparaît alors dans les formulaires de saisie.
   */
  const compteurs: Compteur[] = object?.counters ?? []

  /** Ce que consomme ce matériel : du carburant, de l'électricité, ou les deux. */
  const natureEnergie: NatureEnergie = object?.energy?.kind ?? 'fuel'

  // Le formulaire de plein s'ouvre sur ce que consomme le matériel ; un hybride
  // peut basculer dans la modale.
  const motsEnergie = vocabulaire(fuelData.energyKind)

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
    mutationFn: async (data: typeof fuelData) => {
      const { readings, ...reste } = data
      return api.post(`/objects/${id}/fuel`, { ...reste, ...relevesAEnvoyer(readings) })
    },
    onSuccess: (reponse) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success(reponse.data?.message || 'Plein ajouté')
      signalerReport(reponse.data?.compteurs)
      setFuelModal(false)
      setFuelData({
        date: new Date().toISOString().split('T')[0],
        fuelType: '',
        quantity: '',
        cost: '',
        readings: {},
        energyKind: natureParDefaut(natureEnergie),
        station: '',
        notes: '',
        attachments: []
      })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  })

  const updateFuelMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number, data: any }) => {
      const { readings, ...reste } = data
      return api.put(`/objects/${id}/fuel/${entryId}`, { ...reste, ...relevesAEnvoyer(readings || {}) })
    },
    onSuccess: (reponse) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success(reponse.data?.message || 'Plein modifié')
      signalerReport(reponse.data?.compteurs)
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
    mutationFn: async (data: { name: string; address?: string; kind?: NatureEcriture }) => {
      return api.post('/objects/fuel-stations', data)
    },
    onSuccess: (reponse) => {
      refetchStations()
      refetchTousLesPoints()
      toast.success(reponse.data?.message || 'Station ajoutée')
      setStationEditData(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout')
    }
  })

  const updateStationMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; address?: string; kind?: NatureEcriture } }) => {
      return api.put(`/objects/fuel-stations/${id}`, data)
    },
    onSuccess: () => {
      refetchStations()
      refetchTousLesPoints()
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
      refetchTousLesPoints()
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
    onSuccess: (reponse) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Entretien ajouté')
      signalerReport(reponse.data?.compteurs)
      setMaintenanceModal(false)
      setMaintenanceData({ date: new Date().toISOString().split('T')[0], type: '', description: '', cost: '', readings: {}, nextDate: '', provider: '', notes: '', attachments: [] })
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
    mutationFn: async (data: typeof controlData) => {
      // Mapper les champs client vers les champs attendus par le serveur
      const mappedData = {
        controlDate: data.date,
        expiryDate: data.expirationDate,
        result: data.result,
        centerName: data.center,
        cost: data.cost ? parseFloat(data.cost) : null,
        notes: data.notes,
        attachments: data.attachments,
        ...relevesAEnvoyer(data.readings)
      }
      return api.post(`/objects/${id}/technical-control`, mappedData)
    },
    onSuccess: (reponse) => {
      queryClient.invalidateQueries({ queryKey: ['object', id] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Contrôle technique ajouté')
      signalerReport(reponse.data?.compteurs)
      setControlModal(false)
      const today = new Date()
      const expDate = new Date(today)
      expDate.setFullYear(expDate.getFullYear() + 2)
      setControlData({
        date: today.toISOString().split('T')[0],
        expirationDate: expDate.toISOString().split('T')[0],
        result: 'passed',
        readings: {},
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
        centerName: data.center,
        cost: data.cost,
        notes: data.notes,
        attachments: data.attachments,
        readings: data.readings,
        mileage: data.mileage
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
      baseTabs.push({ id: 'fuel', label: libelleOnglet(natureEnergie), count: object?.fuelRecords?.length || 0 } as any)
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
    
    // Onglet Timeline (toujours visible)
    baseTabs.push({ id: 'timeline', label: 'Historique' } as any)
    
    return baseTabs
  }

  const tabs = buildTabs()

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm flex-wrap">
        <Link to="/categories" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          Catégories
        </Link>
        {object.category && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link to={`/categories/${object.category.slug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              {object.category.name}
            </Link>
          </>
        )}
        {object.subcategory && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link 
              to={`/categories/${object.category?.slug}/${object.subcategory.slug}`} 
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {object.subcategory.name}
            </Link>
          </>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 dark:text-gray-100 font-medium">{object.name}</span>
      </nav>

      {/* En-tête */}
      <Card>
        <CardBody className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
            {/* Image */}
            <div className="w-28 h-28 sm:w-40 sm:h-40 bg-gray-100 dark:bg-gray-700 rounded-xl flex-shrink-0 overflow-hidden mx-auto sm:mx-0">
              {isEditing ? (
                <div className="w-full h-full p-2 sm:p-4">
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
                <div className="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
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
                          <h4 className="font-medium text-gray-700 dark:text-gray-200">Champs personnalisés</h4>
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
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{object.name}</h1>
                        <Badge variant={
                          object.status === 'active' ? 'success' :
                          object.status === 'maintenance' ? 'warning' :
                          object.status === 'inactive' ? 'default' : 'danger'
                        }>
                          {statusOptions.find(s => s.value === object.status)?.label || 'Actif'}
                        </Badge>
                      </div>
                      {object.description && (
                        <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm sm:text-base">{object.description}</p>
                      )}
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-2">
                        Créé le {object.createdAt ? formatDate(object.createdAt) : '-'}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
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
                      <QRCodeDisplay objectId={Number(id)} objectName={object?.name || ''} />
                      {/* Épingler : ce matériel remonte alors en tête de la
                          recherche et alimente le raccourci d'accueil. */}
                      <Button
                        variant={estFavori(object.id) ? 'primary' : 'outline'}
                        size="sm"
                        onClick={() =>
                          basculerFavori({
                            id: object.id,
                            name: object.name,
                            reference: object.reference,
                            categoryName: object.category?.name,
                          })
                        }
                        title={estFavori(object.id) ? 'Retirer de mes matériels' : 'Ajouter à mes matériels'}
                        aria-label={estFavori(object.id) ? 'Retirer de mes matériels' : 'Ajouter à mes matériels'}
                        aria-pressed={estFavori(object.id)}
                      >
                        <Star className={estFavori(object.id) ? 'w-4 h-4 fill-current' : 'w-4 h-4'} />
                      </Button>
                      <Can manage>
                        <Button variant="outline" size="sm" onClick={handleEditStart} title="Modifier la fiche" aria-label="Modifier la fiche">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </Can>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Onglets */}
      <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Contenu des onglets */}
      {activeTab === 'details' && object.nature === 'lot' && (
        <StockDuLot objet={object} />
      )}

      {/* Compteurs : relevables ici sans passer par « Modifier la fiche », qui
          demande d'être superviseur et donne au passage le droit de tout changer. */}
      {activeTab === 'details' && (
        <CarteCompteurs objectId={object.id} compteurs={compteurs} />
      )}

      {activeTab === 'details' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Informations détaillées</CardTitle>
            <Can admin>
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
                aria-label="Configurer les champs"
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            </Can>
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
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900 dark:text-gray-100">{object.category?.name || '-'}</p>
                          </div>
                        )
                      case 'subcategory':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900 dark:text-gray-100">{object.subcategory?.name || '-'}</p>
                          </div>
                        )
                      case 'updatedAt':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900 dark:text-gray-100">{object.updatedAt ? formatDate(object.updatedAt) : '-'}</p>
                          </div>
                        )
                      case 'id':
                        return (
                          <div key={field.fieldName}>
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{field.fieldLabel}</h4>
                            <p className="text-gray-900 dark:text-gray-100 font-mono text-sm">#{object.id}</p>
                          </div>
                        )
                      default:
                        return null
                    }
                  }
                  // Champs personnalisés
                  const value = object.customFields?.[field.fieldName]
                  // Un compteur se lit avec son unité et ses séparateurs de
                  // milliers : « 84 320 km » plutôt que « 84320 ».
                  const compteur = compteurs.find(c => c.fieldName === field.fieldName)
                  return (
                    <div key={field.fieldName}>
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{field.fieldLabel}</h4>
                      <p className="text-gray-900 dark:text-gray-100">
                        {value !== undefined && value !== null && value !== ''
                          ? compteur
                            ? formaterCompteur(Number(value), compteur.unit)
                            : (field.fieldType === 'date' ? formatDate(String(value)) : String(value))
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
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Catégorie</h4>
                    <p className="text-gray-900 dark:text-gray-100">{object.category?.name || '-'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Sous-catégorie</h4>
                    <p className="text-gray-900 dark:text-gray-100">{object.subcategory?.name || '-'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Dernière modification</h4>
                    <p className="text-gray-900 dark:text-gray-100">{object.updatedAt ? formatDate(object.updatedAt) : '-'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Identifiant</h4>
                    <p className="text-gray-900 dark:text-gray-100 font-mono text-sm">#{object.id}</p>
                  </div>
                </>
              )}
            </div>

            {/* Champs personnalisés non configurés (rétrocompatibilité) */}
            {!fieldsConfig && object.customFields && Object.keys(object.customFields).length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Champs personnalisés</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(object.customFields).map(([key, value]) => (
                    <div key={key}>
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{key}</h4>
                      <p className="text-gray-900 dark:text-gray-100">{String(value)}</p>
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
              {natureEnergie === 'both' ? 'Historique énergie' : vocabulaire(natureParDefaut(natureEnergie)).titreHistorique}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer..."
                  value={fuelFilter}
                  onChange={(e) => setFuelFilter(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white dark:bg-gray-800"
                />
              </div>
              <button aria-label={fuelSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
                onClick={() => setFuelSortDesc(!fuelSortDesc)}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors touch-target"
                title={fuelSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => setStationsModal(true)} title="Gérer les stations">
                  <Settings2 className="w-4 h-4" />
                </Button>
              )}
              <Can fieldWrite>
                <Button size="sm" onClick={openFuelModal}>
                  <Plus className="w-4 h-4 mr-1" />
                  {natureEnergie === 'both' ? 'Ajouter' : vocabulaire(natureParDefaut(natureEnergie)).ajouter}
                </Button>
              </Can>
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
                  <thead className="bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantité</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prix unitaire</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Coût total</th>
                      {compteurs.map((compteur) => (
                        <th key={compteur.fieldName} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{compteur.fieldLabel}</th>
                      ))}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {natureEnergie === 'both' ? 'Point' : vocabulaire(natureParDefaut(natureEnergie)).labelPoint}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pièces jointes</th>
                      {isAdmin && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {sortedFuel.map((record: any) => (
                      <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatDate(record.date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{record.fuelType || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{record.quantity} {vocabulaire(record.energyKind).unite}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{record.unitPrice ? `${parseFloat(record.unitPrice).toFixed(3)} ${vocabulaire(record.energyKind).suffixePrixUnitaire}` : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatCurrency(record.cost)}</td>
                        {compteurs.map((compteur) => (
                          <td key={compteur.fieldName} className="px-6 py-4 whitespace-nowrap text-sm">
                            {record.readings?.[compteur.fieldName] !== undefined
                              ? formaterCompteur(record.readings[compteur.fieldName], compteur.unit)
                              : '-'}
                          </td>
                        ))}
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{record.station || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.attachments && record.attachments.length > 0 ? (
                            <AttachmentViewer attachments={record.attachments} compact />
                          ) : (
                            <span className="text-gray-600 dark:text-gray-300">-</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button aria-label="Modifier"
                                onClick={() => setFuelEditModal({
                                  id: record.id,
                                  date: record.date,
                                  fuelType: record.fuelType || '',
                                  energyKind: record.energyKind || 'fuel',
                                  quantity: record.quantity || '',
                                  cost: record.cost || '',
                                  readings: Object.fromEntries(
                                    compteurs.map(c => [c.fieldName, record.readings?.[c.fieldName] !== undefined ? String(record.readings[c.fieldName]) : ''])
                                  ),
                                  station: record.station || '',
                                  notes: record.notes || '',
                                  attachments: record.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded touch-target"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button aria-label="Supprimer"
                                onClick={() => setFuelDeleteConfirm(record.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded touch-target"
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
                    <p className="text-gray-500 dark:text-gray-400">Aucun résultat pour "{fuelFilter}"</p>
                  </div>
                )
              })()
            ) : (
              <div className="text-center py-12">
                <Fuel className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  {natureEnergie === 'both' ? 'Aucun plein ni recharge enregistré' : vocabulaire(natureParDefaut(natureEnergie)).historiqueVide}
                </p>
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
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white dark:bg-gray-800"
                />
              </div>
              <button aria-label={maintenanceSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
                onClick={() => setMaintenanceSortDesc(!maintenanceSortDesc)}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors touch-target"
                title={maintenanceSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => setMaintenanceSettingsModal(true)} title="Gérer les types et prestataires">
                  <Settings2 className="w-4 h-4" />
                </Button>
              )}
              <Can fieldWrite>
                <Button size="sm" onClick={openMaintenanceModal}>
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter un entretien
                </Button>
              </Can>
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
                  <thead className="bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Coût</th>
                      {compteurs.map((compteur) => (
                        <th key={compteur.fieldName} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{compteur.fieldLabel}</th>
                      ))}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prestataire</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prochain</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pièces jointes</th>
                      {isAdmin && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {sortedMaintenance.map((record: any) => (
                      <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatDate(record.date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{record.type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{formatCurrency(record.cost)}</td>
                        {compteurs.map((compteur) => (
                          <td key={compteur.fieldName} className="px-6 py-4 whitespace-nowrap text-sm">
                            {record.readings?.[compteur.fieldName] !== undefined
                              ? formaterCompteur(record.readings[compteur.fieldName], compteur.unit)
                              : '-'}
                          </td>
                        ))}
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{record.provider || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.nextDate ? (
                            <span className="text-orange-600">{formatDate(record.nextDate)}</span>
                          ) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {record.attachments && record.attachments.length > 0 ? (
                            <AttachmentViewer attachments={record.attachments} compact />
                          ) : (
                            <span className="text-gray-600 dark:text-gray-300">-</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button aria-label="Modifier"
                                onClick={() => setMaintenanceEditModal({
                                  id: record.id,
                                  date: record.date,
                                  type: record.type || '',
                                  description: record.description || '',
                                  cost: record.cost || '',
                                  readings: Object.fromEntries(
                                    compteurs.map(c => [c.fieldName, record.readings?.[c.fieldName] !== undefined ? String(record.readings[c.fieldName]) : ''])
                                  ),
                                  nextDate: record.nextDate || '',
                                  provider: record.provider || '',
                                  notes: record.notes || '',
                                  attachments: record.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded touch-target"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button aria-label="Supprimer"
                                onClick={() => setMaintenanceDeleteConfirm(record.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded touch-target"
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
                    <p className="text-gray-500 dark:text-gray-400">Aucun résultat pour "{maintenanceFilter}"</p>
                  </div>
                )
              })()
            ) : (
              <div className="text-center py-12">
                <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Aucun entretien enregistré</p>
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
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 bg-white dark:bg-gray-800"
                />
              </div>
              <button aria-label={controlSortDesc ? 'Plus récent en premier' : 'Plus ancien en premier'}
                onClick={() => setControlSortDesc(!controlSortDesc)}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors touch-target"
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
              <Can fieldWrite>
                <Button size="sm" onClick={openControlModal}>
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter un contrôle
                </Button>
              </Can>
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
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Résultat</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Centre</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Kilométrage</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Coût</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expiration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pièces jointes</th>
                      {(user?.role === 'admin' || user?.role === 'supervisor') && (
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {sortedControl.map((control: any) => (
                      <tr key={control.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {formatDate(control.date)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge variant={control.result === 'passed' ? 'success' : control.result === 'failed' ? 'danger' : 'warning'}>
                            {control.result === 'passed' ? 'Favorable' : 
                             control.result === 'failed' ? 'Défavorable' : 'Contre-visite'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {control.centerName || '-'}
                        </td>
                        {compteurs.map((compteur) => (
                          <td key={compteur.fieldName} className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {control.readings?.[compteur.fieldName] !== undefined
                              ? formaterCompteur(control.readings[compteur.fieldName], compteur.unit)
                              : '-'}
                          </td>
                        ))}
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-right font-medium">
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
                            <span className="text-gray-600 dark:text-gray-300">-</span>
                          )}
                        </td>
                        {(user?.role === 'admin' || user?.role === 'supervisor') && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                            <div className="flex items-center justify-end gap-1">
                              <button aria-label="Modifier"
                                onClick={() => setControlEditModal({
                                  id: control.id,
                                  date: control.date?.split('T')[0] || '',
                                  expirationDate: control.expiryDate?.split('T')[0] || '',
                                  result: control.result || 'passed',
                                  readings: Object.fromEntries(
                                    compteurs.map(c => [c.fieldName, control.readings?.[c.fieldName] !== undefined ? String(control.readings[c.fieldName]) : ''])
                                  ),
                                  center: control.centerName || '',
                                  cost: control.cost?.toString() || '',
                                  notes: control.notes || '',
                                  attachments: control.attachments || []
                                })}
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded touch-target"
                                title="Modifier"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button aria-label="Supprimer"
                                onClick={() => setControlDeleteConfirm(control.id)}
                                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded touch-target"
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
                    <p className="text-gray-500 dark:text-gray-400">Aucun résultat pour "{controlFilter}"</p>
                  </div>
                )
              })()
            ) : (
              <div className="text-center py-12">
                <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Aucun contrôle technique enregistré</p>
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
                  readings: relevesInitiaux(compteurs),
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
                <p className="text-gray-500 dark:text-gray-400">Aucun entretien enregistré</p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
                  Les données de maintenance seront affichées ici
                </p>
              </div>
            </CardBody>
          </Card>
        )
      })()}

      {/* Modal Carburant / Recharge */}
      <Modal isOpen={fuelModal} onClose={() => setFuelModal(false)} title={motsEnergie.ajouter}>
        <form onSubmit={(e) => {
          e.preventDefault()
          if (!validationPlein.valider(fuelData)) return
          addFuelMutation.mutate(fuelData)
        }}>
          <ModalBody className="space-y-4">
            {/* Un hybride rechargeable fait les deux : il choisit ici, et tout
                le formulaire suit — unités, prix, point de ravitaillement. */}
            {natureEnergie === 'both' && (
              <Select
                label="Nature"
                value={fuelData.energyKind}
                onChange={(e) => setFuelData({ ...fuelData, energyKind: e.target.value as NatureEcriture, station: '' })}
                options={[
                  { value: 'fuel', label: 'Plein de carburant' },
                  { value: 'electric', label: 'Recharge électrique' }
                ]}
              />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={fuelData.date}
                onChange={(e) => { setFuelData({ ...fuelData, date: e.target.value }); validationPlein.effacer('date') }}
                error={validationPlein.erreurs.date}
                required
              />
              <Input
                label={motsEnergie.labelQuantite}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={fuelData.quantity}
                onChange={(e) => { setFuelData({ ...fuelData, quantity: e.target.value }); validationPlein.effacer('quantity') }}
                error={validationPlein.erreurs.quantity}
                required
              />
            </div>
            <Input
              label="Coût (€)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={fuelData.cost}
              onChange={(e) => { setFuelData({ ...fuelData, cost: e.target.value }); validationPlein.effacer('cost') }}
              error={validationPlein.erreurs.cost}
              hint={`Montant total payé. Le prix ${motsEnergie.suffixePrixUnitaire} est calculé tout seul.`}
            />
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={fuelData.readings}
              onChange={(readings) => setFuelData({ ...fuelData, readings })}
            />
            <ReferenceSelect
              label={motsEnergie.labelPoint}
              value={fuelData.station}
              onChange={(valeur) => setFuelData({ ...fuelData, station: valeur })}
              options={fuelStations}
              nomSingulier={motsEnergie.pointSingulier}
              placeholder={motsEnergie.pointPlaceholder}
              onCreate={async (nom) => { await addStationMutation.mutateAsync({ name: nom, kind: motsEnergie.kind }) }}
            />
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

      {/* Modal Édition Carburant / Recharge */}
      <Modal
        isOpen={!!fuelEditModal}
        onClose={() => setFuelEditModal(null)}
        title={fuelEditModal?.energyKind === 'electric' ? 'Modifier la recharge' : 'Modifier le plein'}
      >
        {fuelEditModal && (
          <form onSubmit={(e) => {
            e.preventDefault();
            updateFuelMutation.mutate({
              entryId: fuelEditModal.id,
              data: {
                date: fuelEditModal.date,
                fuelType: fuelEditModal.fuelType,
                energyKind: fuelEditModal.energyKind,
                quantity: fuelEditModal.quantity,
                cost: fuelEditModal.cost,
                readings: fuelEditModal.readings,
                station: fuelEditModal.station,
                notes: fuelEditModal.notes,
                attachments: fuelEditModal.attachments || []
              }
            });
          }}>
            <ModalBody className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Date"
                  type="date"
                  value={fuelEditModal.date}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, date: e.target.value })}
                  required
                />
                <Input
                  label={fuelEditModal.energyKind === 'electric' ? "Type d'énergie" : 'Type de carburant'}
                  value={fuelEditModal.fuelType}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, fuelType: e.target.value })}
                  placeholder={fuelEditModal.energyKind === 'electric' ? 'Ex: Électrique' : 'Ex: Diesel, SP95...'}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={vocabulaire(fuelEditModal.energyKind).labelQuantite}
                  type="number"
                inputMode="decimal"
                  step="0.01"
                  value={fuelEditModal.quantity}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, quantity: e.target.value })}
                  required
                />
                <Input
                  label="Coût total (€)"
                  type="number"
                inputMode="decimal"
                  step="0.01"
                  value={fuelEditModal.cost}
                  onChange={(e) => setFuelEditModal({ ...fuelEditModal, cost: e.target.value })}
                />
              </div>
              <ChampsCompteurs
                compteurs={compteurs}
                valeurs={fuelEditModal.readings || {}}
                onChange={(readings) => setFuelEditModal({ ...fuelEditModal, readings })}
              />
              <ReferenceSelect
                label={vocabulaire(fuelEditModal.energyKind).labelPoint}
                value={fuelEditModal.station}
                onChange={(valeur) => setFuelEditModal({ ...fuelEditModal, station: valeur })}
                options={fuelStations}
                nomSingulier={vocabulaire(fuelEditModal.energyKind).pointSingulier}
                placeholder={vocabulaire(fuelEditModal.energyKind).pointPlaceholder}
                onCreate={async (nom) => { await addStationMutation.mutateAsync({ name: nom, kind: vocabulaire(fuelEditModal.energyKind).kind }) }}
              />
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
          <p className="text-gray-600 dark:text-gray-300">
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
      <Modal isOpen={stationsModal} onClose={() => setStationsModal(false)} title="Gérer les stations et les bornes">
        <ModalBody className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStationEditData({ name: '', address: '', kind: motsEnergie.kind })}>
              <Plus className="w-4 h-4 mr-1" />
              Ajouter
            </Button>
          </div>

          {tousLesPoints.length > 0 ? (
            <div className="divide-y divide-gray-200 dark:divide-gray-700 border rounded-lg">
              {tousLesPoints.map((station) => (
                <div key={station.id} className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      {station.name}
                      <Badge variant={station.kind === 'electric' ? 'info' : 'default'} size="sm">
                        {station.kind === 'electric' ? 'Borne' : 'Station'}
                      </Badge>
                    </p>
                    {station.address && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{station.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button aria-label="Modifier"
                      onClick={() => setStationEditData({ id: station.id, name: station.name, address: station.address || '', kind: station.kind === 'electric' ? 'electric' : 'fuel' })}
                      className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded touch-target"
                      title="Modifier"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button aria-label="Supprimer"
                      onClick={() => setStationDeleteConfirm(station.id)}
                      className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded touch-target"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p>Aucune station ni borne enregistrée</p>
              <p className="text-sm mt-1">Ajoutez-les pour les retrouver facilement lors de vos pleins et recharges</p>
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
        title={stationEditData?.id ? 'Modifier le point de ravitaillement' : 'Ajouter un point de ravitaillement'}
      >
        {stationEditData && (
          <form onSubmit={(e) => {
            e.preventDefault()
            const donnees = { name: stationEditData.name, address: stationEditData.address, kind: stationEditData.kind }
            if (stationEditData.id) {
              updateStationMutation.mutate({ id: stationEditData.id, data: donnees })
            } else {
              addStationMutation.mutate(donnees)
            }
          }}>
            <ModalBody className="space-y-4">
              {/* Sans ce choix, tout point créé ici serait une station-service,
                  et une borne saisie par erreur resterait introuvable dans la
                  liste des recharges. */}
              <Select
                label="Nature"
                value={stationEditData.kind}
                onChange={(e) => setStationEditData({ ...stationEditData, kind: e.target.value as NatureEcriture })}
                options={[
                  { value: 'fuel', label: 'Station-service' },
                  { value: 'electric', label: 'Borne de recharge' }
                ]}
              />
              <Input
                label={stationEditData.kind === 'electric' ? 'Nom de la borne' : 'Nom de la station'}
                value={stationEditData.name}
                onChange={(e) => setStationEditData({ ...stationEditData, name: e.target.value })}
                placeholder={stationEditData.kind === 'electric' ? 'Ex: Borne mairie' : 'Ex: Total Barentin'}
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
          <p className="text-gray-600 dark:text-gray-300">
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
          e.preventDefault()
          if (!validationEntretien.valider(maintenanceData)) return
          addMaintenanceMutation.mutate({
            maintenanceDate: maintenanceData.date,
            maintenanceType: maintenanceData.type,
            notes: maintenanceData.description || maintenanceData.notes,
            cost: maintenanceData.cost,
            nextDate: maintenanceData.nextDate,
            provider: maintenanceData.provider,
            attachments: maintenanceData.attachments,
            ...relevesAEnvoyer(maintenanceData.readings)
          }); 
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={maintenanceData.date}
                onChange={(e) => { setMaintenanceData({ ...maintenanceData, date: e.target.value }); validationEntretien.effacer('date') }}
                error={validationEntretien.erreurs.date}
                required
              />
              <ReferenceSelect
                label="Type d'entretien"
                erreur={validationEntretien.erreurs.type}
                value={maintenanceData.type}
                onChange={(valeur) => { setMaintenanceData({ ...maintenanceData, type: valeur }); validationEntretien.effacer('type') }}
                options={maintenanceTypes}
                nomSingulier="un type"
                placeholder="Choisir un type"
                required
                onCreate={async (nom) => { await addMaintenanceTypeMutation.mutateAsync({ name: nom }) }}
              />
            </div>
            <TextArea
              label="Description"
              value={maintenanceData.description}
              onChange={(e) => setMaintenanceData({ ...maintenanceData, description: e.target.value })}
              rows={2}
            />
            <Input
              label="Coût (€)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={maintenanceData.cost}
              onChange={(e) => { setMaintenanceData({ ...maintenanceData, cost: e.target.value }); validationEntretien.effacer('cost') }}
              error={validationEntretien.erreurs.cost}
            />
            {/* Relevés : rien du tout pour une tondeuse ou une table dont la
                branche ne déclare aucun compteur. */}
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={maintenanceData.readings}
              onChange={(readings) => setMaintenanceData({ ...maintenanceData, readings })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReferenceSelect
                label="Prestataire"
                value={maintenanceData.provider}
                onChange={(valeur) => setMaintenanceData({ ...maintenanceData, provider: valeur })}
                options={maintenanceProviders}
                nomSingulier="un prestataire"
                placeholder="Choisir un prestataire"
                onCreate={async (nom) => { await addMaintenanceProviderMutation.mutateAsync({ name: nom }) }}
              />
              <Input
                label="Prochain entretien"
                type="date"
                value={maintenanceData.nextDate}
                onChange={(e) => setMaintenanceData({ ...maintenanceData, nextDate: e.target.value })}
                hint="C'est cette date qui déclenche le rappel"
              />
            </div>
            {!maintenanceData.nextDate && (
              <Alert type="warning">
                Sans date de prochain entretien, <strong>aucun rappel ne sera envoyé</strong> pour
                ce matériel. Renseignez-la si un passage est à prévoir.
              </Alert>
            )}
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
                nextDate: maintenanceEditModal.nextDate,
                provider: maintenanceEditModal.provider,
                attachments: maintenanceEditModal.attachments || [],
                ...relevesAEnvoyer(maintenanceEditModal.readings || {})
              }
            })
          }
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={maintenanceEditModal?.date || ''}
                onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, date: e.target.value })}
                required
              />
              <ReferenceSelect
                label="Type d'entretien"
                value={maintenanceEditModal?.type || ''}
                onChange={(valeur) => setMaintenanceEditModal({ ...maintenanceEditModal, type: valeur })}
                options={maintenanceTypes}
                nomSingulier="un type"
                placeholder="Choisir un type"
                required
                onCreate={async (nom) => { await addMaintenanceTypeMutation.mutateAsync({ name: nom }) }}
              />
            </div>
            <TextArea
              label="Description"
              value={maintenanceEditModal?.description || ''}
              onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, description: e.target.value })}
              rows={2}
            />
            <Input
              label="Coût (€)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={maintenanceEditModal?.cost || ''}
              onChange={(e) => setMaintenanceEditModal({ ...maintenanceEditModal, cost: e.target.value })}
            />
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={maintenanceEditModal?.readings || {}}
              onChange={(readings) => setMaintenanceEditModal({ ...maintenanceEditModal, readings })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReferenceSelect
                label="Prestataire"
                value={maintenanceEditModal?.provider || ''}
                onChange={(valeur) => setMaintenanceEditModal({ ...maintenanceEditModal, provider: valeur })}
                options={maintenanceProviders}
                nomSingulier="un prestataire"
                placeholder="Choisir un prestataire"
                onCreate={async (nom) => { await addMaintenanceProviderMutation.mutateAsync({ name: nom }) }}
              />
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
          <p className="text-gray-600 dark:text-gray-300">Êtes-vous sûr de vouloir supprimer cet entretien ? Cette action est irréversible.</p>
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
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Types d'entretien</h4>
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
              <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
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
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Aucun type d'entretien configuré</p>
              ) : (
                maintenanceTypes.map((type) => (
                  <div key={type.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900/40 rounded">
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
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded touch-target"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMaintenanceTypeDeleteConfirm(type.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded touch-target"
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
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Prestataires</h4>
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
              <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg space-y-2">
                <Input
                  placeholder="Nom du prestataire"
                  value={maintenanceProviderEditData.name}
                  onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, name: e.target.value })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Aucun prestataire configuré</p>
              ) : (
                maintenanceProviders.map((provider) => (
                  <div key={provider.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900/40 rounded">
                    {maintenanceProviderEditData?.id === provider.id ? (
                      <div className="flex-1 space-y-2">
                        <Input
                          value={maintenanceProviderEditData.name}
                          onChange={(e) => setMaintenanceProviderEditData({ ...maintenanceProviderEditData, name: e.target.value })}
                          placeholder="Nom"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {[provider.address, provider.phone].filter(Boolean).join(' • ')}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setMaintenanceProviderEditData({ id: provider.id, name: provider.name, address: provider.address || '', phone: provider.phone || '' })}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded touch-target"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMaintenanceProviderDeleteConfirm(provider.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded touch-target"
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
        <form onSubmit={(e) => {
          e.preventDefault()
          if (!validationControle.valider(controlData)) return
          addControlMutation.mutate(controlData)
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  validationControle.effacer('date')
                  validationControle.effacer('expirationDate')
                }}
                error={validationControle.erreurs.date}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReferenceSelect
                label="Centre de contrôle"
                value={controlData.center}
                onChange={(valeur) => setControlData({ ...controlData, center: valeur })}
                options={controlCenters}
                nomSingulier="un centre"
                placeholder="Choisir un centre"
                onCreate={async (nom) => { await addControlCenterMutation.mutateAsync({ name: nom }) }}
              />
              <Input
                label="Coût (€)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={controlData.cost}
                onChange={(e) => setControlData({ ...controlData, cost: e.target.value })}
              />
            </div>
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={controlData.readings}
              onChange={(readings) => setControlData({ ...controlData, readings })}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Coût (€)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={customMaintenanceData.cost}
                onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, cost: e.target.value })}
              />
              <Input
                label="Prestataire"
                value={customMaintenanceData.provider}
                onChange={(e) => setCustomMaintenanceData({ ...customMaintenanceData, provider: e.target.value })}
              />
            </div>
            {/* Les relevés viennent des compteurs de la branche, et non plus du
                drapeau `track_mileage` du plugin : celui-ci valait pour tous les
                matériels à la fois, tondeuses et tables comprises. */}
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={customMaintenanceData.readings}
              onChange={(readings) => setCustomMaintenanceData({ ...customMaintenanceData, readings })}
            />
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
            (e.target as HTMLFormElement).reset()
          }} className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
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
              <p className="text-gray-500 dark:text-gray-400 text-sm">Aucun centre de contrôle enregistré</p>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">
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
                        <button aria-label="Modifier"
                          onClick={() => setControlCenterEditData(center)}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded touch-target"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button aria-label="Supprimer"
                          onClick={() => setControlCenterDeleteConfirm(center.id)}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded touch-target"
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
                ...relevesAEnvoyer(controlEditModal.readings || {}),
                center: controlEditModal.center,
                cost: controlEditModal.cost ? parseFloat(controlEditModal.cost) : null,
                notes: controlEditModal.notes,
                attachments: controlEditModal.attachments || []
              }
            })
          }
        }}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReferenceSelect
                label="Centre de contrôle"
                value={controlEditModal?.center || ''}
                onChange={(valeur) => setControlEditModal({ ...controlEditModal, center: valeur })}
                options={controlCenters}
                nomSingulier="un centre"
                placeholder="Choisir un centre"
                onCreate={async (nom) => { await addControlCenterMutation.mutateAsync({ name: nom }) }}
              />
              <Input
                label="Coût (€)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={controlEditModal?.cost || ''}
                onChange={(e) => setControlEditModal({ ...controlEditModal, cost: e.target.value })}
              />
            </div>
            <ChampsCompteurs
              compteurs={compteurs}
              valeurs={controlEditModal?.readings || {}}
              onChange={(readings) => setControlEditModal({ ...controlEditModal, readings })}
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

      {/* Onglet Timeline / Historique */}
      {activeTab === 'timeline' && object && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Historique complet
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ObjectTimeline objectId={Number(id)} />
          </CardBody>
        </Card>
      )}

      {/* Modal Confirmation suppression contrôle technique */}
      <Modal
        isOpen={!!controlDeleteConfirm}
        onClose={() => setControlDeleteConfirm(null)}
        title="Confirmer la suppression"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600 dark:text-gray-300">
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

/**
 * Stock d'un lot, lu sur sa fiche de parc.
 *
 * C'est ce que le catalogue séparé des manifestations imposait d'aller chercher
 * ailleurs : on tenait ses chaises à deux endroits selon qu'on les regardait
 * comme du parc ou comme du prêt. Les manifestations s'imputent désormais
 * directement sur la quantité du matériel.
 *
 * Trois nombres, et le mot juste pour chacun :
 *
 * - **détenu** ce que la collectivité possède ;
 * - **dehors** ce qui est physiquement sorti en ce moment ;
 * - **promis** ce qui est engagé pour plus tard, demandes à confirmer comprises.
 *
 * Ne pas les confondre est la raison d'être de la séparation : une manifestation
 * livrée comptée dans les deux ferait disparaître son matériel deux fois.
 */
function StockDuLot({ objet }: { objet: any }) {
  const detenu = objet.quantityTotal ?? 0
  const dehors = objet.quantityLent ?? 0
  const promis = objet.quantityReservedFuture ?? 0
  const disponible = objet.quantityAvailable ?? detenu

  const chiffres = [
    { libelle: 'Détenu', valeur: detenu, ton: 'text-gray-900 dark:text-gray-100' },
    { libelle: 'Dehors en ce moment', valeur: dehors, ton: 'text-amber-600 dark:text-amber-400' },
    { libelle: 'Promis plus tard', valeur: promis, ton: 'text-blue-600 dark:text-blue-400' },
    {
      libelle: 'Disponible',
      valeur: disponible,
      ton: disponible < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
    },
  ]

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="w-5 h-5" /> Stock
        </CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {chiffres.map((chiffre) => (
            <div key={chiffre.libelle}>
              <p className={`text-2xl font-semibold ${chiffre.ton}`}>{chiffre.valeur}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{chiffre.libelle}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
          Les manifestations s’imputent directement sur cette quantité. « Promis » comprend les
          demandes reçues et pas encore confirmées : c’est ce qui permet de répondre à
          « en aurai-je assez le 14 juillet ? » avant de s’engager.
        </p>
      </CardBody>
    </Card>
  )
}
