import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Shield, Users, User,  
  Eye, Edit2, Trash2, Save, Search, FolderOpen 
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, Badge, 
  LoadingInline, Alert, Tabs, Tab, Input
} from '@/components/ui'
import api, { User as UserType, Category } from '@/lib/api'
import toast from 'react-hot-toast'

interface Permission {
  categoryId: number
  categoryName: string
  canView: boolean
  canEdit: boolean
  canDelete: boolean
}

interface GroupPermissions {
  [categoryId: number]: {
    canView: boolean
    canEdit: boolean
    canDelete: boolean
  }
}

interface UserWithPermissions extends UserType {
  permissions: Permission[]
}

// Composant pour une ligne de catégorie avec permissions
function CategoryPermissionRow({ 
  category, 
  permissions, 
  onChange,
  disabled = false
}: { 
  category: Category
  permissions: { canView: boolean; canEdit: boolean; canDelete: boolean }
  onChange: (categoryId: number, field: string, value: boolean) => void
  disabled?: boolean
}) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {category.image ? (
            <img src={category.image} alt="" className="w-8 h-8 rounded object-cover" />
          ) : (
            <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <span className="font-medium text-gray-900">{category.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          checked={permissions.canView}
          onChange={(e) => onChange(category.id, 'canView', e.target.checked)}
          disabled={disabled}
          className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          checked={permissions.canEdit}
          onChange={(e) => onChange(category.id, 'canEdit', e.target.checked)}
          disabled={disabled || !permissions.canView}
          className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          checked={permissions.canDelete}
          onChange={(e) => onChange(category.id, 'canDelete', e.target.checked)}
          disabled={disabled || !permissions.canView}
          className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
        />
      </td>
    </tr>
  )
}

// Onglet pour les permissions de groupe
function GroupPermissionsTab({ role, title, icon: Icon }: { role: string; title: string; icon: React.ElementType }) {
  const queryClient = useQueryClient()
  const [permissions, setPermissions] = useState<GroupPermissions>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Récupérer les catégories
  const { data: categoriesData, isLoading: loadingCategories } = useQuery({
    queryKey: ['categories-all'],
    queryFn: async () => {
      const response = await api.get('/categories/all')
      return response.data
    }
  })

  // Récupérer les permissions du groupe
  const { data: groupPermissions, isLoading: loadingPermissions } = useQuery({
    queryKey: ['group-permissions', role],
    queryFn: async () => {
      const response = await api.get(`/permissions/group/${role}`)
      return response.data
    }
  })

  // Initialiser les permissions quand les données arrivent
  useEffect(() => {
    if (groupPermissions?.permissions && categoriesData?.categories) {
      const perms: GroupPermissions = {}
      categoriesData.categories.forEach((cat: Category) => {
        const existingPerm = groupPermissions.permissions.find((p: any) => p.categoryId === cat.id)
        perms[cat.id] = existingPerm || { canView: true, canEdit: false, canDelete: false }
      })
      setPermissions(perms)
      setHasChanges(false)
    }
  }, [groupPermissions, categoriesData])

  // Mutation pour sauvegarder
  const saveMutation = useMutation({
    mutationFn: async (data: { role: string; permissions: any[] }) => {
      return api.put(`/permissions/group/${role}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-permissions', role] })
      toast.success('Permissions sauvegardées')
      setHasChanges(false)
    },
    onError: () => {
      toast.error('Erreur lors de la sauvegarde')
    }
  })

  const handleChange = (categoryId: number, field: string, value: boolean) => {
    setPermissions(prev => {
      const updated = { ...prev }
      if (!updated[categoryId]) {
        updated[categoryId] = { canView: false, canEdit: false, canDelete: false }
      }
      updated[categoryId] = { ...updated[categoryId], [field]: value }
      
      // Si on désactive la vue, désactiver aussi édition et suppression
      if (field === 'canView' && !value) {
        updated[categoryId].canEdit = false
        updated[categoryId].canDelete = false
      }
      
      return updated
    })
    setHasChanges(true)
  }

  const handleSelectAll = (field: 'canView' | 'canEdit' | 'canDelete', value: boolean) => {
    setPermissions(prev => {
      const updated = { ...prev }
      Object.keys(updated).forEach(catId => {
        const id = parseInt(catId)
        if (field === 'canView') {
          updated[id].canView = value
          if (!value) {
            updated[id].canEdit = false
            updated[id].canDelete = false
          }
        } else if (updated[id].canView) {
          updated[id][field] = value
        }
      })
      return updated
    })
    setHasChanges(true)
  }

  const handleSave = () => {
    const permissionsArray = Object.entries(permissions).map(([categoryId, perms]) => ({
      categoryId: parseInt(categoryId),
      ...perms
    }))
    saveMutation.mutate({ role, permissions: permissionsArray })
  }

  const categories = categoriesData?.categories || []
  const isLoading = loadingCategories || loadingPermissions

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${role === 'supervisor' ? 'bg-amber-100' : 'bg-blue-100'}`}>
            <Icon className={`w-5 h-5 ${role === 'supervisor' ? 'text-amber-600' : 'text-blue-600'}`} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">
              {role === 'supervisor' 
                ? 'Définissez les catégories visibles par les superviseurs'
                : 'Définissez les catégories visibles par les utilisateurs standards'
              }
            </p>
          </div>
        </div>
        {hasChanges && (
          <Button 
            icon={<Save className="w-4 h-4" />} 
            onClick={handleSave}
            loading={saveMutation.isPending}
          >
            Sauvegarder
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-8"><LoadingInline /></div>
      ) : categories.length === 0 ? (
        <Alert type="info">Aucune catégorie disponible</Alert>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Catégorie
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  <div className="flex items-center justify-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span>Voir</span>
                    <input
                      type="checkbox"
                      onChange={(e) => handleSelectAll('canView', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      title="Tout sélectionner"
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  <div className="flex items-center justify-center gap-2">
                    <Edit2 className="w-4 h-4" />
                    <span>Modifier</span>
                    <input
                      type="checkbox"
                      onChange={(e) => handleSelectAll('canEdit', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      title="Tout sélectionner"
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  <div className="flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span>Supprimer</span>
                    <input
                      type="checkbox"
                      onChange={(e) => handleSelectAll('canDelete', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      title="Tout sélectionner"
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {categories.map((category: Category) => (
                <CategoryPermissionRow
                  key={category.id}
                  category={category}
                  permissions={permissions[category.id] || { canView: true, canEdit: false, canDelete: false }}
                  onChange={handleChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Onglet pour les permissions utilisateur individuelles
function UserPermissionsTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserWithPermissions | null>(null)
  const [permissions, setPermissions] = useState<{ [categoryId: number]: { canView: boolean; canEdit: boolean; canDelete: boolean } }>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Récupérer les utilisateurs (seulement user et supervisor)
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['users-permissions', search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      params.append('roles', 'user,supervisor')
      const response = await api.get(`/users?${params}`)
      return response.data
    }
  })

  // Récupérer les catégories
  const { data: categoriesData } = useQuery({
    queryKey: ['categories-all'],
    queryFn: async () => {
      const response = await api.get('/categories/all')
      return response.data
    }
  })

  // Récupérer les permissions d'un utilisateur
  const { data: userPermissions } = useQuery({
    queryKey: ['user-permissions', selectedUser?.id],
    queryFn: async () => {
      if (!selectedUser) return null
      const response = await api.get(`/users/${selectedUser.id}`)
      return response.data
    },
    enabled: !!selectedUser
  })

  // Initialiser les permissions quand un utilisateur est sélectionné
  useEffect(() => {
    if (userPermissions?.user?.permissions && categoriesData?.categories) {
      const perms: { [key: number]: { canView: boolean; canEdit: boolean; canDelete: boolean } } = {}
      categoriesData.categories.forEach((cat: Category) => {
        const existingPerm = userPermissions.user.permissions.find((p: any) => p.category_id === cat.id)
        perms[cat.id] = existingPerm 
          ? { canView: !!existingPerm.can_view, canEdit: !!existingPerm.can_edit, canDelete: !!existingPerm.can_delete }
          : { canView: false, canEdit: false, canDelete: false }
      })
      setPermissions(perms)
      setHasChanges(false)
    }
  }, [userPermissions, categoriesData])

  // Mutation pour sauvegarder
  const saveMutation = useMutation({
    mutationFn: async (data: { permissions: any[] }) => {
      return api.put(`/users/${selectedUser?.id}/permissions`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-permissions', selectedUser?.id] })
      toast.success('Permissions sauvegardées')
      setHasChanges(false)
    },
    onError: () => {
      toast.error('Erreur lors de la sauvegarde')
    }
  })

  const handleChange = (categoryId: number, field: string, value: boolean) => {
    setPermissions(prev => {
      const updated = { ...prev }
      if (!updated[categoryId]) {
        updated[categoryId] = { canView: false, canEdit: false, canDelete: false }
      }
      updated[categoryId] = { ...updated[categoryId], [field]: value }
      
      if (field === 'canView' && !value) {
        updated[categoryId].canEdit = false
        updated[categoryId].canDelete = false
      }
      
      return updated
    })
    setHasChanges(true)
  }

  const handleSave = () => {
    const permissionsArray = Object.entries(permissions)
      .filter(([_, perms]) => perms.canView) // Seulement les catégories avec vue activée
      .map(([categoryId, perms]) => ({
        categoryId: parseInt(categoryId),
        ...perms
      }))
    saveMutation.mutate({ permissions: permissionsArray })
  }

  const handleSelectUser = (user: UserType) => {
    setSelectedUser(user as UserWithPermissions)
    setHasChanges(false)
  }

  const users = usersData?.users?.filter((u: UserType) => u.role !== 'admin') || []
  const categories = categoriesData?.categories || []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-purple-100">
          <User className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h3 className="font-medium text-gray-900">Permissions individuelles</h3>
          <p className="text-sm text-gray-500">
            Définissez des permissions spécifiques pour chaque utilisateur
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Liste des utilisateurs */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Utilisateurs</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <div className="p-3 border-b">
                <Input
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<Search className="w-4 h-4" />}
                  size="sm"
                />
              </div>
              {loadingUsers ? (
                <div className="p-4"><LoadingInline /></div>
              ) : users.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  Aucun utilisateur trouvé
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  {users.map((user: UserType) => (
                    <button
                      key={user.id}
                      onClick={() => handleSelectUser(user)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b last:border-b-0 ${
                        selectedUser?.id === user.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                      }`}
                    >
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-medium text-gray-600">
                          {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                      <Badge variant={user.role === 'supervisor' ? 'warning' : 'default'} size="sm">
                        {user.role === 'supervisor' ? 'Super.' : 'User'}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Permissions de l'utilisateur */}
        <div className="lg:col-span-2">
          {selectedUser ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-primary-700">
                        {selectedUser.firstName?.charAt(0)}{selectedUser.lastName?.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <CardTitle>{selectedUser.firstName} {selectedUser.lastName}</CardTitle>
                      <p className="text-sm text-gray-500">{selectedUser.email}</p>
                    </div>
                  </div>
                  {hasChanges && (
                    <Button 
                      icon={<Save className="w-4 h-4" />} 
                      onClick={handleSave}
                      loading={saveMutation.isPending}
                      size="sm"
                    >
                      Sauvegarder
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <Alert type="info" className="m-4">
                  <span className="text-sm">
                    Les permissions individuelles s'ajoutent aux permissions du groupe 
                    ({selectedUser.role === 'supervisor' ? 'Superviseurs' : 'Utilisateurs'}).
                    Cochez les catégories que cet utilisateur peut voir en plus.
                  </span>
                </Alert>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Catégorie
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Eye className="w-4 h-4" />
                            <span>Voir</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Edit2 className="w-4 h-4" />
                            <span>Modifier</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Trash2 className="w-4 h-4" />
                            <span>Supprimer</span>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {categories.map((category: Category) => (
                        <CategoryPermissionRow
                          key={category.id}
                          category={category}
                          permissions={permissions[category.id] || { canView: false, canEdit: false, canDelete: false }}
                          onChange={handleChange}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <div className="text-center py-12">
                  <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Sélectionnez un utilisateur pour gérer ses permissions</p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PermissionsPage() {
  const [activeTab, setActiveTab] = useState('supervisors')

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Droits & Permissions</h1>
        <p className="text-gray-500 mt-1">
          Gérez les droits d'accès des groupes et utilisateurs aux catégories
        </p>
      </div>

      {/* Explication */}
      <Alert type="info">
        <div className="space-y-2">
          <p className="font-medium">Comment fonctionnent les permissions ?</p>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li><strong>Administrateurs</strong> : Accès complet à toutes les catégories (non configurable)</li>
            <li><strong>Superviseurs</strong> : Permissions définies dans l'onglet "Superviseurs"</li>
            <li><strong>Utilisateurs</strong> : Permissions définies dans l'onglet "Utilisateurs"</li>
            <li><strong>Permissions individuelles</strong> : S'ajoutent aux permissions du groupe de l'utilisateur</li>
          </ul>
        </div>
      </Alert>

      {/* Onglets */}
      <Card>
        <CardBody>
          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tab value="supervisors" label="Superviseurs" icon={<Shield className="w-4 h-4" />} />
            <Tab value="users" label="Utilisateurs" icon={<Users className="w-4 h-4" />} />
            <Tab value="individual" label="Permissions individuelles" icon={<User className="w-4 h-4" />} />
          </Tabs>

          <div className="mt-6">
            {activeTab === 'supervisors' && (
              <GroupPermissionsTab role="supervisor" title="Groupe Superviseurs" icon={Shield} />
            )}
            {activeTab === 'users' && (
              <GroupPermissionsTab role="user" title="Groupe Utilisateurs" icon={Users} />
            )}
            {activeTab === 'individual' && (
              <UserPermissionsTab />
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
