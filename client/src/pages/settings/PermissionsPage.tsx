import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Shield, Users, User,  
  Eye, Edit2, Trash2, Save, Search, FolderOpen,
  BarChart3, Download, ArrowRightLeft, Plug
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, Badge, 
  LoadingInline, Alert, Tabs, Tab, Input, Select
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

// Onglet pour les permissions des modules
function ModulePermissionsTab() {
  const queryClient = useQueryClient()
  const [supervisorPerms, setSupervisorPerms] = useState<Record<string, any>>({})
  const [userPerms, setUserPerms] = useState<Record<string, any>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Récupérer les modules disponibles
  const { data: modulesData } = useQuery({
    queryKey: ['permission-modules'],
    queryFn: async () => {
      const response = await api.get('/permissions/modules')
      return response.data
    }
  })

  // Récupérer toutes les permissions de modules
  const { data: allPermsData, isLoading } = useQuery({
    queryKey: ['module-permissions-all'],
    queryFn: async () => {
      const response = await api.get('/permissions/modules/all-groups')
      return response.data
    }
  })

  // Initialiser les permissions
  useEffect(() => {
    if (allPermsData?.permissions && modulesData?.modules) {
      const supPerms: Record<string, any> = {}
      const usrPerms: Record<string, any> = {}
      
      modulesData.modules.forEach((mod: any) => {
        supPerms[mod.name] = allPermsData.permissions[mod.name]?.supervisor || {
          canView: false, canExport: false, canCompare: false
        }
        usrPerms[mod.name] = allPermsData.permissions[mod.name]?.user || {
          canView: false, canExport: false, canCompare: false
        }
      })
      
      setSupervisorPerms(supPerms)
      setUserPerms(usrPerms)
      setHasChanges(false)
    }
  }, [allPermsData, modulesData])

  // Mutation pour sauvegarder
  const saveMutation = useMutation({
    mutationFn: async () => {
      const promises: Promise<any>[] = []
      
      modulesData?.modules?.forEach((mod: any) => {
        promises.push(
          api.put(`/permissions/modules/${mod.name}/group/supervisor`, supervisorPerms[mod.name])
        )
        promises.push(
          api.put(`/permissions/modules/${mod.name}/group/user`, userPerms[mod.name])
        )
      })
      
      return Promise.all(promises)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['module-permissions-all'] })
      queryClient.invalidateQueries({ queryKey: ['tracking-permissions'] })
      toast.success('Permissions des modules sauvegardées')
      setHasChanges(false)
    },
    onError: () => {
      toast.error('Erreur lors de la sauvegarde')
    }
  })

  const handleChange = (role: 'supervisor' | 'user', moduleName: string, field: string, value: boolean) => {
    if (role === 'supervisor') {
      setSupervisorPerms(prev => ({
        ...prev,
        [moduleName]: { ...prev[moduleName], [field]: value }
      }))
    } else {
      setUserPerms(prev => ({
        ...prev,
        [moduleName]: { ...prev[moduleName], [field]: value }
      }))
    }
    setHasChanges(true)
  }

  const modules = modulesData?.modules || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">Permissions des modules</h3>
            <p className="text-sm text-gray-500">
              Définissez les accès aux modules spéciaux comme le Suivi des coûts
            </p>
          </div>
        </div>
        {hasChanges && (
          <Button 
            icon={<Save className="w-4 h-4" />} 
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
          >
            Sauvegarder
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-8"><LoadingInline /></div>
      ) : modules.length === 0 ? (
        <Alert type="info">Aucun module avec permissions configurables</Alert>
      ) : (
        <div className="space-y-6">
          {modules.map((mod: any) => (
            <Card key={mod.name}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <CardTitle>{mod.label}</CardTitle>
                    <p className="text-sm text-gray-500">{mod.description}</p>
                  </div>
                </div>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Groupe
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Eye className="w-4 h-4" />
                            <span>Voir</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Download className="w-4 h-4" />
                            <span>Exporter</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <ArrowRightLeft className="w-4 h-4" />
                            <span>Comparer</span>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-amber-600" />
                            <span className="font-medium text-gray-900">Superviseurs</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={supervisorPerms[mod.name]?.canView || false}
                            onChange={(e) => handleChange('supervisor', mod.name, 'canView', e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={supervisorPerms[mod.name]?.canExport || false}
                            onChange={(e) => handleChange('supervisor', mod.name, 'canExport', e.target.checked)}
                            disabled={!supervisorPerms[mod.name]?.canView}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={supervisorPerms[mod.name]?.canCompare || false}
                            onChange={(e) => handleChange('supervisor', mod.name, 'canCompare', e.target.checked)}
                            disabled={!supervisorPerms[mod.name]?.canView}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                          />
                        </td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            <span className="font-medium text-gray-900">Utilisateurs</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={userPerms[mod.name]?.canView || false}
                            onChange={(e) => handleChange('user', mod.name, 'canView', e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={userPerms[mod.name]?.canExport || false}
                            onChange={(e) => handleChange('user', mod.name, 'canExport', e.target.checked)}
                            disabled={!userPerms[mod.name]?.canView}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={userPerms[mod.name]?.canCompare || false}
                            onChange={(e) => handleChange('user', mod.name, 'canCompare', e.target.checked)}
                            disabled={!userPerms[mod.name]?.canView}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// Onglet pour les permissions des plugins
function PluginPermissionsTab() {
  const queryClient = useQueryClient()
  const [activeSubTab, setActiveSubTab] = useState<'roles' | 'individual'>('roles')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userPluginPerms, setUserPluginPerms] = useState<Record<number, boolean>>({})
  const [hasUserChanges, setHasUserChanges] = useState(false)

  // Récupérer les plugins avec leurs permissions par rôle
  const { data: pluginPermsData, isLoading } = useQuery({
    queryKey: ['plugin-permissions'],
    queryFn: async () => {
      const response = await api.get('/permissions/plugins')
      return response.data
    }
  })

  // Récupérer la liste des utilisateurs non-admin
  const { data: usersData } = useQuery({
    queryKey: ['users-for-plugins'],
    queryFn: async () => {
      const response = await api.get('/users')
      return response.data
    },
    enabled: activeSubTab === 'individual'
  })

  // Récupérer les permissions plugin d'un utilisateur
  const { data: userPermsData } = useQuery({
    queryKey: ['user-plugin-permissions', selectedUserId],
    queryFn: async () => {
      const response = await api.get(`/permissions/plugins/user/${selectedUserId}`)
      return response.data
    },
    enabled: !!selectedUserId
  })

  useEffect(() => {
    if (userPermsData?.permissions) {
      setUserPluginPerms(userPermsData.permissions)
      setHasUserChanges(false)
    }
  }, [userPermsData])

  // Mutation pour changer permission par rôle
  const toggleRoleMutation = useMutation({
    mutationFn: async ({ pluginId, role, canAccess }: { pluginId: number; role: string; canAccess: boolean }) => {
      return api.put(`/permissions/plugins/${pluginId}/role/${role}`, { canAccess })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugin-permissions'] })
      queryClient.invalidateQueries({ queryKey: ['menuPlugins'] })
      toast.success('Permission mise à jour')
    },
    onError: () => toast.error('Erreur lors de la mise à jour')
  })

  // Mutation pour sauvegarder les permissions individuelles
  const saveUserPermsMutation = useMutation({
    mutationFn: async () => {
      const plugins = pluginPermsData?.plugins || []
      const promises = plugins.map((p: any) => {
        if (userPluginPerms[p.id] !== undefined) {
          return api.put(`/permissions/plugins/${p.id}/user/${selectedUserId}`, {
            canAccess: userPluginPerms[p.id]
          })
        }
        // Pas de config individuelle → supprimer l'override éventuel
        return api.put(`/permissions/plugins/${p.id}/user/${selectedUserId}`, { remove: true })
      })
      return Promise.all(promises)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-plugin-permissions', selectedUserId] })
      queryClient.invalidateQueries({ queryKey: ['menuPlugins'] })
      toast.success('Permissions individuelles sauvegardées')
      setHasUserChanges(false)
    },
    onError: () => toast.error('Erreur lors de la sauvegarde')
  })

  const plugins = pluginPermsData?.plugins || []
  const nonAdminUsers = (usersData?.users || []).filter((u: any) => u.role !== 'admin')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-100">
          <Plug className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100">Permissions des plugins</h3>
          <p className="text-sm text-gray-500">
            Contrôlez quels rôles et utilisateurs ont accès à chaque plugin
          </p>
        </div>
      </div>

      <Alert type="info">
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li><strong>Administrateurs</strong> ont toujours accès à tous les plugins</li>
          <li><strong>Par rôle</strong> : définit l'accès par défaut pour superviseurs et utilisateurs</li>
          <li><strong>Individuel</strong> : permet d'overrider la permission du rôle pour un utilisateur précis</li>
          <li>Un plugin sans configuration de permission est <strong>accessible par défaut</strong></li>
        </ul>
      </Alert>

      {/* Sous-onglets */}
      <div className="flex gap-2 border-b dark:border-gray-700 pb-2">
        <button
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${activeSubTab === 'roles' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          onClick={() => setActiveSubTab('roles')}
        >
          <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> Par rôle</div>
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${activeSubTab === 'individual' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          onClick={() => setActiveSubTab('individual')}
        >
          <div className="flex items-center gap-2"><User className="w-4 h-4" /> Par utilisateur</div>
        </button>
      </div>

      {isLoading ? (
        <div className="py-8"><LoadingInline /></div>
      ) : plugins.length === 0 ? (
        <Alert type="info">Aucun plugin configuré</Alert>
      ) : activeSubTab === 'roles' ? (
        /* ===== Permissions par rôle ===== */
        <Card>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plugin</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actif</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      <div className="flex items-center justify-center gap-1">
                        <Shield className="w-4 h-4 text-amber-600" />
                        <span>Superviseurs</span>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      <div className="flex items-center justify-center gap-1">
                        <Users className="w-4 h-4 text-blue-600" />
                        <span>Utilisateurs</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {plugins.map((p: any) => (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={p.pluginType === 'menu' ? 'primary' : 'default'}>
                          {p.pluginType === 'menu' ? 'Menu' : 'Objet'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={p.isActive ? 'success' : 'default'}>
                          {p.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={p.permissions.supervisor}
                          onChange={(e) => toggleRoleMutation.mutate({
                            pluginId: p.id, role: 'supervisor', canAccess: e.target.checked
                          })}
                          className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={p.permissions.user}
                          onChange={(e) => toggleRoleMutation.mutate({
                            pluginId: p.id, role: 'user', canAccess: e.target.checked
                          })}
                          className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : (
        /* ===== Permissions individuelles ===== */
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Select
              label="Sélectionner un utilisateur"
              value={String(selectedUserId || '')}
              onChange={(e) => {
                setSelectedUserId(e.target.value ? parseInt(e.target.value) : null)
                setHasUserChanges(false)
              }}
              options={[
                { value: '', label: '— Choisir un utilisateur —' },
                ...nonAdminUsers.map((u: any) => ({
                  value: u.id,
                  label: `${u.first_name || ''} ${u.last_name || ''} (${u.email}) — ${u.role}`
                }))
              ]}
            />
            {hasUserChanges && (
              <Button
                icon={<Save className="w-4 h-4" />}
                onClick={() => saveUserPermsMutation.mutate()}
                loading={saveUserPermsMutation.isPending}
              >
                Sauvegarder
              </Button>
            )}
          </div>

          {selectedUserId && (
            <Card>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plugin</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Perm. rôle</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          <div className="flex items-center justify-center gap-1">
                            <Eye className="w-4 h-4" />
                            <span>Accès individuel</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Résultat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {plugins.filter((p: any) => p.isActive).map((p: any) => {
                        const selectedUser = nonAdminUsers.find((u: any) => u.id === selectedUserId)
                        const rolePerm = selectedUser?.role === 'supervisor' ? p.permissions.supervisor : p.permissions.user
                        const hasOverride = userPluginPerms[p.id] !== undefined
                        const effectiveAccess = hasOverride ? userPluginPerms[p.id] : rolePerm

                        return (
                          <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant={rolePerm ? 'success' : 'danger'}>
                                {rolePerm ? 'Autorisé' : 'Refusé'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <select
                                value={hasOverride ? (userPluginPerms[p.id] ? '1' : '0') : ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === '') {
                                    // Retirer l'override
                                    const next = { ...userPluginPerms }
                                    delete next[p.id]
                                    setUserPluginPerms(next)
                                  } else {
                                    setUserPluginPerms({ ...userPluginPerms, [p.id]: val === '1' })
                                  }
                                  setHasUserChanges(true)
                                }}
                                className="px-2 py-1 text-sm border border-gray-300 rounded dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
                              >
                                <option value="">— Hérité du rôle —</option>
                                <option value="1">✅ Autoriser</option>
                                <option value="0">❌ Refuser</option>
                              </select>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant={effectiveAccess ? 'success' : 'danger'}>
                                {effectiveAccess ? '✓ Accès' : '✗ Bloqué'}
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
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
          Gérez les droits d'accès des groupes et utilisateurs aux catégories et modules
        </p>
      </div>

      {/* Explication */}
      <Alert type="info">
        <div className="space-y-2">
          <p className="font-medium">Comment fonctionnent les permissions ?</p>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li><strong>Administrateurs</strong> : Accès complet à toutes les catégories et modules (non configurable)</li>
            <li><strong>Superviseurs</strong> : Permissions définies dans l'onglet "Superviseurs"</li>
            <li><strong>Utilisateurs</strong> : Permissions définies dans l'onglet "Utilisateurs"</li>
            <li><strong>Permissions individuelles</strong> : S'ajoutent aux permissions du groupe de l'utilisateur</li>
            <li><strong>Modules</strong> : Permissions spécifiques pour les modules comme le Suivi des coûts</li>
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
            <Tab value="modules" label="Modules" icon={<BarChart3 className="w-4 h-4" />} />
            <Tab value="plugins" label="Plugins" icon={<Plug className="w-4 h-4" />} />
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
            {activeTab === 'modules' && (
              <ModulePermissionsTab />
            )}
            {activeTab === 'plugins' && (
              <PluginPermissionsTab />
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
