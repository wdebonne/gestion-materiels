import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Key, 
  Plus, 
  Trash2, 
  Copy, 
  RefreshCw,
  CheckCircle, 
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  AlertTriangle
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

interface ApiToken {
  id: number
  name: string
  token_prefix: string
  permissions: string
  is_active: number
  expires_at: string | null
  last_used_at: string | null
  created_by_name: string
  created_at: string
  updated_at: string
}

interface TokenFormData {
  name: string
  permissions: string[]
  expires_at: string
}

const AVAILABLE_PERMISSIONS = [
  { value: 'read', label: 'Lecture', description: 'Consulter les données (GET)' },
  { value: 'write', label: 'Écriture', description: 'Créer et modifier les données (POST/PUT)' },
  { value: 'delete', label: 'Suppression', description: 'Supprimer les données (DELETE)' },
]

const initialFormData: TokenFormData = {
  name: '',
  permissions: ['read'],
  expires_at: ''
}

export default function ApiTokensPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState<TokenFormData>(initialFormData)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<ApiToken | null>(null)
  const [regenerateConfirm, setRegenerateConfirm] = useState<ApiToken | null>(null)
  const [regeneratedToken, setRegeneratedToken] = useState<string | null>(null)

  // Récupérer les tokens
  const { data: tokens = [], isLoading } = useQuery<ApiToken[]>({
    queryKey: ['api-tokens'],
    queryFn: async () => {
      const response = await api.get('/api-tokens')
      return response.data.tokens
    }
  })

  // Créer un token
  const createMutation = useMutation({
    mutationFn: async (data: TokenFormData) => {
      const response = await api.post('/api-tokens', {
        name: data.name,
        permissions: data.permissions,
        expires_at: data.expires_at || null
      })
      return response.data
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      setNewToken(data.token.raw_token)
      setShowToken(true)
      setFormData(initialFormData)
      toast.success('Token créé avec succès')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erreur lors de la création')
    }
  })

  // Activer/Désactiver un token
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const response = await api.put(`/api-tokens/${id}`, { is_active })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      toast.success('Token mis à jour')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erreur lors de la mise à jour')
    }
  })

  // Supprimer un token
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api-tokens/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      setDeleteConfirm(null)
      toast.success('Token supprimé')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  // Régénérer un token
  const regenerateMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post(`/api-tokens/${id}/regenerate`)
      return response.data
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      setRegenerateConfirm(null)
      setRegeneratedToken(data.raw_token)
      toast.success('Token régénéré')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erreur lors de la régénération')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  const togglePermission = (perm: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm]
    }))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Token copié dans le presse-papier')
  }

  const parsePermissions = (permsStr: string): string[] => {
    try {
      return JSON.parse(permsStr)
    } catch {
      return ['read']
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false
    return new Date(expiresAt) < new Date()
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tokens API</h1>
          <p className="text-sm text-gray-500 mt-1">
            Créez des tokens pour connecter vos applications externes à l'API.
          </p>
        </div>
        <Button onClick={() => { setIsModalOpen(true); setNewToken(null); setFormData(initialFormData) }}>
          <Plus className="w-4 h-4 mr-2" />
          Nouveau token
        </Button>
      </div>

      {/* Info d'utilisation */}
      <Alert type="info">
        Pour utiliser un token, ajoutez l'en-tête <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">X-API-Token: votre_token</code> à vos requêtes HTTP. Chaque application a son propre token indépendant.
      </Alert>

      {/* Liste des tokens */}
      {tokens.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-8 text-gray-500">
              <Key className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucun token API</p>
              <p className="text-sm mt-1">Créez un token pour commencer à utiliser l'API depuis vos applications.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {tokens.map((token: ApiToken) => {
            const perms = parsePermissions(token.permissions)
            const expired = isExpired(token.expires_at)

            return (
              <Card key={token.id}>
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Key className="w-5 h-5 text-gray-600 flex-shrink-0" />
                        <h3 className="text-lg font-semibold text-gray-900 truncate">{token.name}</h3>
                        {token.is_active && !expired ? (
                          <Badge variant="success">Actif</Badge>
                        ) : expired ? (
                          <Badge variant="danger">Expiré</Badge>
                        ) : (
                          <Badge variant="default">Inactif</Badge>
                        )}
                      </div>

                      <div className="ml-8 space-y-1.5">
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span>Préfixe : <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{token.token_prefix}...</code></span>
                          <span>Créé par : {token.created_by_name}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">Permissions :</span>
                          {perms.map(p => (
                            <Badge key={p} variant={p === 'delete' ? 'danger' : p === 'write' ? 'warning' : 'info'}>
                              {p === 'read' ? 'Lecture' : p === 'write' ? 'Écriture' : 'Suppression'}
                            </Badge>
                          ))}
                        </div>

                        <div className="flex items-center gap-4 text-xs text-gray-600">
                          <span>Créé le {formatDate(token.created_at)}</span>
                          {token.last_used_at && <span>Dernière utilisation : {formatDate(token.last_used_at)}</span>}
                          {token.expires_at && <span>Expire le {formatDate(token.expires_at)}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: token.id, is_active: !token.is_active })}
                        title={token.is_active ? 'Désactiver' : 'Activer'}
                      >
                        {token.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRegenerateConfirm(token)}
                        title="Régénérer le token" aria-label="Régénérer le token"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteConfirm(token)}
                        title="Supprimer" aria-label="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de création */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setNewToken(null) }}
        title={newToken ? 'Token créé' : 'Nouveau token API'}
        size="lg"
      >
        {newToken ? (
          <>
            <ModalBody>
              <Alert type="warning">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Copiez ce token maintenant !</p>
                    <p className="text-sm mt-1">Il ne sera plus jamais affiché. Si vous le perdez, vous devrez en régénérer un nouveau.</p>
                  </div>
                </div>
              </Alert>

              <div className="mt-4 relative">
                <div className="flex items-center gap-2 bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm break-all">
                  {showToken ? newToken : '•'.repeat(64)}
                  <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                    <button
                      onClick={() => setShowToken(!showToken)}
                      className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => copyToClipboard(newToken)}
                      className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-2">Exemple d'utilisation :</p>
                <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">
{`curl -H "X-API-Token: ${newToken.substring(0, 16)}..." \\
     https://votre-serveur/api/objects`}
                </pre>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => { setIsModalOpen(false); setNewToken(null); setShowToken(false) }}>
                J'ai copié le token
              </Button>
            </ModalFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <ModalBody>
              <div className="space-y-4">
                <Input
                  label="Nom de l'application"
                  placeholder="Ex: Mon application mobile, Script de sync, etc."
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
                  <div className="space-y-2">
                    {AVAILABLE_PERMISSIONS.map(perm => (
                      <label
                        key={perm.value}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          formData.permissions.includes(perm.value)
                            ? 'border-primary-300 bg-primary-50'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.permissions.includes(perm.value)}
                          onChange={() => togglePermission(perm.value)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div>
                          <span className="font-medium text-gray-900">{perm.label}</span>
                          <p className="text-xs text-gray-500">{perm.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <Input
                  label="Date d'expiration (optionnel)"
                  type="datetime-local"
                  value={formData.expires_at}
                  onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))}
                />
                <p className="text-xs text-gray-500 -mt-2">Laissez vide pour un token sans expiration.</p>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setIsModalOpen(false)} type="button">
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={!formData.name.trim() || formData.permissions.length === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Création...</>
                ) : (
                  <><Key className="w-4 h-4 mr-2" /> Créer le token</>
                )}
              </Button>
            </ModalFooter>
          </form>
        )}
      </Modal>

      {/* Modal token régénéré */}
      <Modal
        isOpen={!!regeneratedToken}
        onClose={() => setRegeneratedToken(null)}
        title="Token régénéré"
      >
        <ModalBody>
          <Alert type="warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Copiez ce nouveau token maintenant !</p>
                <p className="text-sm mt-1">L'ancien token ne fonctionnera plus.</p>
              </div>
            </div>
          </Alert>

          <div className="mt-4">
            <div className="flex items-center gap-2 bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm break-all">
              {regeneratedToken}
              <button
                onClick={() => copyToClipboard(regeneratedToken!)}
                className="p-1.5 hover:bg-gray-700 rounded transition-colors ml-auto flex-shrink-0"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => setRegeneratedToken(null)}>
            J'ai copié le token
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal de confirmation de suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer le token"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer le token <strong>{deleteConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-red-600 mt-2">
            Toutes les applications utilisant ce token perdront immédiatement l'accès.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal de confirmation de régénération */}
      <Modal
        isOpen={!!regenerateConfirm}
        onClose={() => setRegenerateConfirm(null)}
        title="Régénérer le token"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir régénérer le token <strong>{regenerateConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-orange-600 mt-2">
            L'ancien token sera immédiatement invalidé. L'application devra utiliser le nouveau token.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRegenerateConfirm(null)}>
            Annuler
          </Button>
          <Button
            onClick={() => regenerateConfirm && regenerateMutation.mutate(regenerateConfirm.id)}
            disabled={regenerateMutation.isPending}
          >
            {regenerateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Régénérer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
