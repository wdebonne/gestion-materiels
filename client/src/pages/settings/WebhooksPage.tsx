import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Webhook, 
  Plus, 
  Pencil, 
  Trash2, 
  Play, 
  CheckCircle, 
  XCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Clock
} from 'lucide-react'
import { 
  Card, 
  CardBody, 
  Input, 
  Button, 
  Alert,
  Badge,
  Modal,
  ModalBody,
  ModalFooter
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface WebhookData {
  id: number
  name: string
  url: string
  events: string
  headers: string
  secret: string | null
  is_active: number
  last_triggered_at: string | null
  last_status: number | null
  last_response: string | null
  created_at: string
  updated_at: string
}

interface WebhookFormData {
  name: string
  url: string
  events: string[]
  headers: Record<string, string>
  secret: string
  is_active: boolean
}

// Événements disponibles
const AVAILABLE_EVENTS = [
  { value: '*', label: 'Tous les événements' },
  { value: 'object.created', label: 'Objet créé' },
  { value: 'object.updated', label: 'Objet modifié' },
  { value: 'object.deleted', label: 'Objet supprimé' },
  { value: 'category.created', label: 'Catégorie créée' },
  { value: 'category.updated', label: 'Catégorie modifiée' },
  { value: 'category.deleted', label: 'Catégorie supprimée' },
  { value: 'alert.created', label: 'Alerte créée' },
  { value: 'maintenance.created', label: 'Maintenance ajoutée' },
  { value: 'fuel.created', label: 'Plein de carburant ajouté' },
  { value: 'backup.created', label: 'Sauvegarde créée' },
  { value: 'user.created', label: 'Utilisateur créé' },
  { value: 'user.login', label: 'Connexion utilisateur' },
  { value: 'manifestation.received', label: 'Demande de manifestation reçue' },
  { value: 'manifestation.created', label: 'Manifestation créée' },
  { value: 'manifestation.updated', label: 'Manifestation modifiée' },
  { value: 'manifestation.status_changed', label: 'Statut de manifestation modifié' },
  { value: 'manifestation.materials_updated', label: 'Quantités de matériel mises à jour' },
  { value: 'manifestation.approval_requested', label: 'Approbation demandée à un service' },
  { value: 'manifestation.approval_decided', label: 'Décision rendue par un service' },
  { value: 'manifestation.dates_changed', label: 'Dates de manifestation modifiées' }
]

const initialFormData: WebhookFormData = {
  name: '',
  url: '',
  events: [],
  headers: {},
  secret: '',
  is_active: true
}

export default function WebhooksPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState<WebhookData | null>(null)
  const [formData, setFormData] = useState<WebhookFormData>(initialFormData)
  const [showSecret, setShowSecret] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string; status?: number; duration?: number } | null>(null)
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<WebhookData | null>(null)

  // Récupérer les webhooks
  const { data: webhooks = [], isLoading } = useQuery<WebhookData[]>({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const response = await api.get('/webhooks')
      return response.data.webhooks
    }
  })

  // Mutation pour créer/modifier un webhook
  const saveMutation = useMutation({
    mutationFn: async (data: WebhookFormData) => {
      if (editingWebhook) {
        return api.put(`/webhooks/${editingWebhook.id}`, data)
      }
      return api.post('/webhooks', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success(editingWebhook ? 'Webhook modifié' : 'Webhook créé')
      handleCloseModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  // Mutation pour supprimer un webhook
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/webhooks/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook supprimé')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour tester un webhook
  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      setTestingId(id)
      const response = await api.post(`/webhooks/${id}/test`)
      return { id, ...response.data }
    },
    onSuccess: (data) => {
      setTestResult({
        id: data.id,
        success: data.success,
        message: data.message,
        status: data.status,
        duration: data.duration
      })
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
    onError: (err: any, id) => {
      setTestResult({
        id,
        success: false,
        message: err.response?.data?.message || 'Erreur lors du test'
      })
    },
    onSettled: () => {
      setTestingId(null)
    }
  })

  // Mutation pour activer/désactiver un webhook
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      return api.put(`/webhooks/${id}`, { is_active })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur')
    }
  })

  const handleOpenCreate = () => {
    setEditingWebhook(null)
    setFormData(initialFormData)
    setShowSecret(false)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (webhook: WebhookData) => {
    setEditingWebhook(webhook)
    let events: string[] = []
    let headers: Record<string, string> = {}
    
    try {
      events = webhook.events ? JSON.parse(webhook.events) : []
    } catch {
      events = []
    }
    
    try {
      headers = webhook.headers ? JSON.parse(webhook.headers) : {}
    } catch {
      headers = {}
    }
    
    setFormData({
      name: webhook.name,
      url: webhook.url,
      events,
      headers,
      secret: '', // Ne pas afficher le secret existant
      is_active: webhook.is_active === 1
    })
    setShowSecret(false)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingWebhook(null)
    setFormData(initialFormData)
    setNewHeaderKey('')
    setNewHeaderValue('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const handleDelete = (webhook: WebhookData) => {
    setDeleteConfirm(webhook)
  }

  const handleAddHeader = () => {
    if (newHeaderKey && newHeaderValue) {
      setFormData({
        ...formData,
        headers: { ...formData.headers, [newHeaderKey]: newHeaderValue }
      })
      setNewHeaderKey('')
      setNewHeaderValue('')
    }
  }

  const handleRemoveHeader = (key: string) => {
    const { [key]: _, ...rest } = formData.headers
    setFormData({ ...formData, headers: rest })
  }

  const handleEventToggle = (eventValue: string) => {
    if (eventValue === '*') {
      // Si on clique sur "Tous les événements"
      if (formData.events.includes('*')) {
        setFormData({ ...formData, events: [] })
      } else {
        setFormData({ ...formData, events: ['*'] })
      }
    } else {
      // Retirer "*" si on sélectionne un événement spécifique
      let newEvents = formData.events.filter(e => e !== '*')
      
      if (newEvents.includes(eventValue)) {
        newEvents = newEvents.filter(e => e !== eventValue)
      } else {
        newEvents.push(eventValue)
      }
      
      setFormData({ ...formData, events: newEvents })
    }
  }

  const generateSecret = () => {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const secret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
    setFormData({ ...formData, secret })
    setShowSecret(true)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copié dans le presse-papiers')
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Jamais'
    return new Date(dateString).toLocaleString('fr-FR')
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4"></div>
        <div className="h-64 bg-gray-200 rounded"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-gray-500 mt-1">
            Configurez des webhooks pour recevoir des notifications en temps réel
          </p>
        </div>
        <Button onClick={handleOpenCreate} icon={<Plus className="w-4 h-4" />}>
          Nouveau webhook
        </Button>
      </div>

      {/* Message d'information */}
      <Alert type="info">
        Les webhooks permettent d'envoyer des notifications HTTP à des services externes lorsque certains événements se produisent dans l'application.
      </Alert>

      {/* Liste des webhooks */}
      {webhooks.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Webhook className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun webhook configuré</h3>
            <p className="text-gray-500 mb-4">
              Créez votre premier webhook pour commencer à recevoir des notifications.
            </p>
            <Button onClick={handleOpenCreate} icon={<Plus className="w-4 h-4" />}>
              Créer un webhook
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => {
            let events: string[] = []
            try {
              events = webhook.events ? JSON.parse(webhook.events) : []
            } catch {
              events = []
            }
            
            const isTestResult = testResult?.id === webhook.id

            return (
              <Card key={webhook.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {webhook.name}
                        </h3>
                        <Badge variant={webhook.is_active ? 'success' : 'default'}>
                          {webhook.is_active ? 'Actif' : 'Inactif'}
                        </Badge>
                        {webhook.last_status !== null && (
                          <Badge variant={webhook.last_status >= 200 && webhook.last_status < 300 ? 'success' : 'danger'}>
                            {webhook.last_status === 0 ? 'Erreur' : `HTTP ${webhook.last_status}`}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <code className="bg-gray-100 px-2 py-1 rounded text-xs break-all">
                          {webhook.url}
                        </code>
                        <button
                          onClick={() => copyToClipboard(webhook.url)}
                          className="text-gray-600 hover:text-gray-600"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="flex flex-wrap gap-1 mb-3">
                        {events.length === 0 ? (
                          <span className="text-sm text-gray-500">Aucun événement sélectionné</span>
                        ) : events.includes('*') ? (
                          <Badge variant="info">Tous les événements</Badge>
                        ) : (
                          events.slice(0, 5).map(event => (
                            <Badge key={event} variant="default" className="text-xs">
                              {event}
                            </Badge>
                          ))
                        )}
                        {events.length > 5 && !events.includes('*') && (
                          <Badge variant="default" className="text-xs">
                            +{events.length - 5} autres
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Dernier appel: {formatDate(webhook.last_triggered_at)}
                        </span>
                        {webhook.secret && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-3 h-3" />
                            Signature activée
                          </span>
                        )}
                      </div>

                      {/* Résultat du test */}
                      {isTestResult && (
                        <div className={`mt-3 p-3 rounded-lg ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                          <div className="flex items-center gap-2">
                            {testResult.success ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600" />
                            )}
                            <span className={testResult.success ? 'text-green-700' : 'text-red-700'}>
                              {testResult.message}
                              {testResult.status !== undefined && ` (HTTP ${testResult.status})`}
                              {testResult.duration !== undefined && ` - ${testResult.duration}ms`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate(webhook.id)}
                        disabled={testingId === webhook.id}
                        icon={testingId === webhook.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      >
                        Tester
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(webhook)}
                        icon={<Pencil className="w-4 h-4" />}
                      >
                        Modifier
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: webhook.id, is_active: !webhook.is_active })}
                      >
                        {webhook.is_active ? 'Désactiver' : 'Activer'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(webhook)}
                        icon={<Trash2 className="w-4 h-4" />}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de création/modification */}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} size="lg" title={editingWebhook ? 'Modifier le webhook' : 'Nouveau webhook'}>
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-6">
            {/* Informations de base */}
            <div className="space-y-4">
              <Input
                label="Nom du webhook"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Mon webhook"
                required
              />
              <Input
                label="URL de destination"
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/webhook"
                hint="L'URL vers laquelle les événements seront envoyés"
                required
              />
            </div>

            {/* Événements */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Événements à écouter
              </label>
              <div className="border rounded-lg p-4 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_EVENTS.map((event) => (
                    <label key={event.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                      <input
                        type="checkbox"
                        checked={formData.events.includes(event.value) || (event.value !== '*' && formData.events.includes('*'))}
                        onChange={() => handleEventToggle(event.value)}
                        disabled={event.value !== '*' && formData.events.includes('*')}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">{event.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Sélectionnez les événements qui déclencheront ce webhook
              </p>
            </div>

            {/* Secret pour signature */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Secret de signature (optionnel)
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    value={formData.secret}
                    onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                    placeholder={editingWebhook ? '••••••••••••' : 'Entrez ou générez un secret'}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="hover:text-gray-600"
                      >
                        {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    }
                  />
                </div>
                <Button type="button" variant="outline" onClick={generateSecret}>
                  Générer
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Le secret sera utilisé pour signer les requêtes avec HMAC-SHA256 (header X-Webhook-Signature)
              </p>
            </div>

            {/* Headers personnalisés */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Headers personnalisés (optionnel)
              </label>
              
              {Object.entries(formData.headers).length > 0 && (
                <div className="space-y-2 mb-3">
                  {Object.entries(formData.headers).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                      <code className="text-sm text-gray-700 flex-1">
                        {key}: {value}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleRemoveHeader(key)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <Input
                  placeholder="Nom du header"
                  value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Valeur"
                  value={newHeaderValue}
                  onChange={(e) => setNewHeaderValue(e.target.value)}
                  className="flex-1"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleAddHeader}
                  disabled={!newHeaderKey || !newHeaderValue}
                >
                  Ajouter
                </Button>
              </div>
            </div>

            {/* Statut actif */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-5 h-5"
              />
              <div>
                <span className="font-medium text-gray-900">Webhook actif</span>
                <p className="text-sm text-gray-500">Les événements seront envoyés uniquement si le webhook est actif</p>
              </div>
            </label>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={handleCloseModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveMutation.isPending}>
              {editingWebhook ? 'Enregistrer' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer le webhook"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer le webhook <strong>{deleteConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-gray-500 mt-2">
            URL : <code className="bg-gray-100 px-1 rounded text-xs">{deleteConfirm?.url}</code>
          </p>
          <p className="text-sm text-red-600 mt-2">
            Cette action est irréversible.
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
            <Trash2 className="w-4 h-4 mr-2" />
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
