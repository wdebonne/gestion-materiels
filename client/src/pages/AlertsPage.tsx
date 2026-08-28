import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { 
  Bell, Check, AlertTriangle, Fuel, Wrench, ClipboardCheck,
  Filter, CheckCheck, Trash2, Settings, Save
} from 'lucide-react'
import { 
  Button, Card, CardBody, CardHeader, CardTitle, Badge, 
  LoadingInline, Select, Modal, ModalBody, ModalFooter, Input
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/utils'
import HelpSheet from '@/components/HelpSheet'

interface Alert {
  id: number
  title: string
  message: string
  type: 'technical_control' | 'maintenance' | 'fuel' | 'custom'
  priority: 'low' | 'medium' | 'high'
  status: 'active' | 'acknowledged' | 'resolved'
  dueDate?: string
  objectId?: number
  objectName?: string
  pluginReference?: string
  pluginReferenceId?: number
  createdAt: string
}

interface AlertSettings {
  technical_control: { days: number; priority: 'low' | 'medium' | 'high' }
  maintenance: { days: number; priority: 'low' | 'medium' | 'high' }
  fuel: { days: number; priority: 'low' | 'medium' | 'high' }
  custom: { days: number; priority: 'low' | 'medium' | 'high' }
}

export default function AlertsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isSupervisor = user?.role === 'admin' || user?.role === 'supervisor'
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [deleteConfirm, setDeleteConfirm] = useState<Alert | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    technical_control: { days: 30, priority: 'medium' },
    maintenance: { days: 14, priority: 'low' },
    fuel: { days: 7, priority: 'low' },
    custom: { days: 7, priority: 'low' }
  })

  // Récupérer les paramètres d'alertes
  const { data: settingsData } = useQuery({
    queryKey: ['alert-settings'],
    queryFn: async () => {
      try {
        const response = await api.get('/alerts/settings')
        return response.data.settings
      } catch {
        return null
      }
    }
  })

  // Mettre à jour les settings locaux quand les données sont chargées
  useEffect(() => {
    if (settingsData) {
      setAlertSettings(settingsData)
    }
  }, [settingsData])

  // Mutation pour sauvegarder les paramètres
  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: AlertSettings) => {
      return api.put('/alerts/settings', { settings })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-settings'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Paramètres d\'alertes enregistrés et alertes mises à jour')
      setShowSettings(false)
    },
    onError: () => {
      toast.error('Erreur lors de la sauvegarde')
    }
  })

  // Récupérer les alertes
  const { data, isLoading } = useQuery({
    queryKey: ['alerts', statusFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (typeFilter !== 'all') params.append('type', typeFilter)
      const response = await api.get(`/alerts?${params}`)
      return response.data
    }
  })

  // Mutation pour marquer comme lu
  const acknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.put(`/alerts/${id}/read`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alerte marquée comme lue')
    }
  })

  // Mutation pour résoudre
  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.put(`/alerts/${id}/dismiss`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alerte résolue')
    }
  })

  // Mutation pour supprimer
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/alerts/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alerte supprimée')
      setDeleteConfirm(null)
    }
  })

  // Mutation pour tout marquer comme lu
  const acknowledgeAllMutation = useMutation({
    mutationFn: async () => {
      return api.put('/alerts/read-all')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Toutes les alertes ont été marquées comme lues')
    }
  })

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'technical_control':
        return <ClipboardCheck className="w-5 h-5" />
      case 'maintenance':
        return <Wrench className="w-5 h-5" />
      case 'fuel':
        return <Fuel className="w-5 h-5" />
      default:
        return <AlertTriangle className="w-5 h-5" />
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'technical_control':
        return 'bg-blue-100 text-blue-600'
      case 'maintenance':
        return 'bg-orange-100 text-orange-600'
      case 'fuel':
        return 'bg-green-100 text-green-600'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'technical_control':
        return 'Contrôle technique'
      case 'maintenance':
        return 'Entretien'
      case 'fuel':
        return 'Carburant'
      default:
        return 'Autre'
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="danger">Urgente</Badge>
      case 'medium':
        return <Badge variant="warning">Moyenne</Badge>
      default:
        return <Badge variant="default">Basse</Badge>
    }
  }

  const getPriorityCardStyle = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-50 border-red-200'
      case 'medium':
        return 'bg-orange-50 border-orange-200'
      case 'low':
      default:
        return 'bg-blue-50 border-blue-200'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="danger">Active</Badge>
      case 'acknowledged':
        return <Badge variant="warning">Lue</Badge>
      case 'resolved':
        return <Badge variant="success">Résolue</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  const alerts = data?.alerts || []
  const activeCount = alerts.filter((a: Alert) => a.status === 'active').length

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Alertes</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {activeCount > 0 
                ? `${activeCount} alerte(s) active(s)`
                : 'Aucune alerte active'
              }
            </p>
          </div>
          <HelpSheet
            titre="Les alertes"
            points={[
              "Les alertes sont créées automatiquement chaque heure par l'application.",
              "Elles signalent les contrôles techniques qui expirent et les entretiens à prévoir.",
              "Un entretien n'apparaît ici que si sa date de prochain passage a été renseignée.",
              "« Marquer comme lu » n'efface rien : l'alerte reste consultable.",
              "Les seuils de déclenchement se règlent dans les paramètres, par un responsable.",
            ]}
          />
        </div>
        {activeCount > 0 && (
          <Button 
            variant="outline"
            icon={<CheckCheck className="w-4 h-4" />}
            onClick={() => acknowledgeAllMutation.mutate()}
            loading={acknowledgeAllMutation.isPending}
          >
            Tout marquer comme lu
          </Button>
        )}
        {isSupervisor && (
          <Button 
            variant="secondary"
            icon={<Settings className="w-4 h-4" />}
            onClick={() => setShowSettings(true)}
          >
            Paramètres
          </Button>
        )}
      </div>

      {/* Filtres */}
      <Card>
        <CardBody>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Filtres :</span>
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tous les statuts' },
                { value: 'active', label: 'Actives' },
                { value: 'acknowledged', label: 'Lues' },
                { value: 'resolved', label: 'Résolues' }
              ]}
            />
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tous les types' },
                { value: 'technical_control', label: 'Contrôle technique' },
                { value: 'maintenance', label: 'Entretien' },
                { value: 'fuel', label: 'Carburant' },
                { value: 'custom', label: 'Autre' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      {/* Liste des alertes */}
      {isLoading ? (
        <LoadingInline message="Chargement des alertes..." />
      ) : alerts.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-gray-600 dark:text-gray-300" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Aucune alerte</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {statusFilter !== 'all' || typeFilter !== 'all' 
                ? 'Aucune alerte ne correspond aux filtres sélectionnés'
                : 'Vous n\'avez aucune alerte pour le moment'
              }
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert: Alert) => (
            <Card 
              key={alert.id}
              className={`${getPriorityCardStyle(alert.priority)} ${alert.status === 'active' ? 'border-l-4 border-l-red-500' : ''}`}
            >
              <CardBody>
                <div className="flex items-start gap-4">
                  {/* Icône du type */}
                  <div className={`p-3 rounded-xl ${getTypeColor(alert.type)}`}>
                    {getTypeIcon(alert.type)}
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{alert.title}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{alert.message}</p>
                        
                        {/* Métadonnées */}
                        <div className="flex flex-wrap items-center gap-3 mt-3">
                          {getPriorityBadge(alert.priority)}
                          {getStatusBadge(alert.status)}
                          <span className="text-xs text-gray-600 dark:text-gray-300">
                            {getTypeLabel(alert.type)}
                          </span>
                          {alert.dueDate && (
                            <span className={`text-xs ${
                              new Date(alert.dueDate) < new Date() 
                                ? 'text-red-600' 
                                : 'text-gray-500'
                            }`}>
                              Échéance : {formatDate(alert.dueDate)}
                            </span>
                          )}
                        </div>

                        {/* Lien vers l'objet ou l'espace vert */}
                        {alert.pluginReference === 'green-space-maintenance' ? (
                          <button
                            onClick={() => navigate('/espaces-verts')}
                            className="text-sm text-green-600 hover:text-green-700 mt-2"
                          >
                            🌿 Voir l'espace vert →
                          </button>
                        ) : alert.objectId ? (
                          <button
                            onClick={() => navigate(`/objects/${alert.objectId}`)}
                            className="text-sm text-primary-600 hover:text-primary-700 mt-2"
                          >
                            Voir {alert.objectName || 'le matériel'} →
                          </button>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {alert.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            loading={acknowledgeMutation.isPending}
                            title="Marquer comme lu" aria-label="Marquer comme lu"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                        {alert.status !== 'resolved' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resolveMutation.mutate(alert.id)}
                            loading={resolveMutation.isPending}
                            title="Résoudre" aria-label="Résoudre"
                          >
                            <CheckCheck className="w-4 h-4" />
                          </Button>
                        )}
                        {isSupervisor && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirm(alert)}
                            title="Supprimer" aria-label="Supprimer"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Date de création */}
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-4 text-right">
                  Créée le {formatDate(alert.createdAt)}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer l'alerte"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600 dark:text-gray-300">
            Êtes-vous sûr de vouloir supprimer cette alerte ?
          </p>
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

      {/* Modal paramètres des alertes */}
      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Paramètres des alertes"
        size="lg"
      >
        <ModalBody className="space-y-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Configurez le délai d'affichage des alertes avant l'échéance et leur niveau de priorité pour chaque type.
          </p>

          {/* Contrôle technique */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Contrôle technique</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Jours avant l'échéance"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={alertSettings.technical_control.days}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  technical_control: { ...alertSettings.technical_control, days: parseInt(e.target.value) || 30 }
                })}
              />
              <Select
                label="Priorité par défaut"
                value={alertSettings.technical_control.priority}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  technical_control: { ...alertSettings.technical_control, priority: e.target.value as 'low' | 'medium' | 'high' }
                })}
                options={[
                  { value: 'low', label: 'Basse' },
                  { value: 'medium', label: 'Moyenne' },
                  { value: 'high', label: 'Élevée' }
                ]}
              />
            </div>
          </div>

          {/* Maintenance */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                <Wrench className="w-5 h-5" />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Entretien / Maintenance</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Jours avant l'échéance"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={alertSettings.maintenance.days}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  maintenance: { ...alertSettings.maintenance, days: parseInt(e.target.value) || 14 }
                })}
              />
              <Select
                label="Priorité par défaut"
                value={alertSettings.maintenance.priority}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  maintenance: { ...alertSettings.maintenance, priority: e.target.value as 'low' | 'medium' | 'high' }
                })}
                options={[
                  { value: 'low', label: 'Basse' },
                  { value: 'medium', label: 'Moyenne' },
                  { value: 'high', label: 'Élevée' }
                ]}
              />
            </div>
          </div>

          {/* Carburant */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/40 text-green-600">
                <Fuel className="w-5 h-5" />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Carburant</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Jours avant l'échéance"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={alertSettings.fuel.days}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  fuel: { ...alertSettings.fuel, days: parseInt(e.target.value) || 7 }
                })}
              />
              <Select
                label="Priorité par défaut"
                value={alertSettings.fuel.priority}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  fuel: { ...alertSettings.fuel, priority: e.target.value as 'low' | 'medium' | 'high' }
                })}
                options={[
                  { value: 'low', label: 'Basse' },
                  { value: 'medium', label: 'Moyenne' },
                  { value: 'high', label: 'Élevée' }
                ]}
              />
            </div>
          </div>

          {/* Autre */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Autres alertes</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Jours avant l'échéance"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={alertSettings.custom.days}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  custom: { ...alertSettings.custom, days: parseInt(e.target.value) || 7 }
                })}
              />
              <Select
                label="Priorité par défaut"
                value={alertSettings.custom.priority}
                onChange={(e) => setAlertSettings({
                  ...alertSettings,
                  custom: { ...alertSettings.custom, priority: e.target.value as 'low' | 'medium' | 'high' }
                })}
                options={[
                  { value: 'low', label: 'Basse' },
                  { value: 'medium', label: 'Moyenne' },
                  { value: 'high', label: 'Élevée' }
                ]}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowSettings(false)}>
            Annuler
          </Button>
          <Button 
            icon={<Save className="w-4 h-4" />}
            loading={saveSettingsMutation.isPending}
            onClick={() => saveSettingsMutation.mutate(alertSettings)}
          >
            Enregistrer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
