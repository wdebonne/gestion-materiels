import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  ArrowLeft, Plus, Trash2, GripVertical, Eye, EyeOff, 
  Save, RotateCcw, ChevronRight, Settings2, Edit2
} from 'lucide-react'
import { 
  Button, Card, CardBody, CardHeader, CardTitle, Input, Select,
  Modal, ModalBody, ModalFooter, Alert, LoadingInline, Badge
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface CustomField {
  id: number | null
  fieldName: string
  fieldLabel: string
  fieldType: string
  fieldOptions: any
  isRequired: boolean
  isVisible: boolean
  isSystem: boolean
  sortOrder: number
  applicableSubcategories?: number[] | null
}

const FIELD_TYPES = [
  { value: 'text', label: 'Texte' },
  { value: 'number', label: 'Nombre' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Liste déroulante' },
  { value: 'textarea', label: 'Zone de texte' },
  { value: 'checkbox', label: 'Case à cocher' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Téléphone' },
  { value: 'url', label: 'URL' }
]

const SYSTEM_FIELD_LABELS: Record<string, string> = {
  category: 'Catégorie',
  subcategory: 'Sous-catégorie',
  updatedAt: 'Dernière modification',
  id: 'Identifiant'
}

export default function CustomFieldsPage() {
  const { categorySlug, subcategorySlug } = useParams<{ categorySlug: string; subcategorySlug?: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [fields, setFields] = useState<CustomField[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [newField, setNewField] = useState({
    fieldName: '',
    fieldLabel: '',
    fieldType: 'text',
    fieldOptions: '',
    isRequired: false,
    applicableSubcategories: [] as number[]
  })
  const [hasChanges, setHasChanges] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [editField, setEditField] = useState<{ index: number; field: CustomField } | null>(null)

  // Récupérer la catégorie
  const { data: category, isLoading: categoryLoading } = useQuery({
    queryKey: ['category', categorySlug],
    queryFn: async () => {
      const response = await api.get(`/categories/${categorySlug}`)
      return response.data.category
    },
    enabled: !!categorySlug
  })

  // Récupérer la sous-catégorie si présente
  const { data: subcategory, isLoading: subcategoryLoading } = useQuery({
    queryKey: ['subcategory', categorySlug, subcategorySlug],
    queryFn: async () => {
      const response = await api.get(`/categories/${categorySlug}/${subcategorySlug}`)
      return response.data.subcategory
    },
    enabled: !!categorySlug && !!subcategorySlug
  })

  // Récupérer les sous-catégories de la catégorie (pour le sélecteur d'application)
  // On charge toujours les sous-catégories pour permettre la restriction (catégorie OU sous-catégorie)
  const { data: subcategoriesData } = useQuery({
    queryKey: ['subcategories', category?.id],
    queryFn: async () => {
      const response = await api.get(`/categories/${category?.id}/subcategories`)
      return response.data.subcategories as Array<{ id: number; name: string; slug: string }>
    },
    // Charger dès qu'on a la catégorie (niveau catégorie OU sous-catégorie)
    enabled: !!category?.id
  })

  // Récupérer la configuration des champs
  const { data: fieldsConfig, isLoading: fieldsLoading, refetch: refetchFields } = useQuery({
    queryKey: ['customFieldsConfig', subcategory?.id, category?.id],
    queryFn: async () => {
      if (subcategory?.id) {
        const response = await api.get(`/custom-fields/config/subcategory/${subcategory.id}`)
        return response.data
      } else if (category?.id) {
        const response = await api.get(`/custom-fields/config/category/${category.id}`)
        return response.data
      }
      return { fields: [] }
    },
    enabled: !!category?.id
  })

  // Initialiser les champs depuis la config
  useEffect(() => {
    if (fieldsConfig?.fields) {
      // S'assurer que les champs système sont présents
      const systemFields = ['category', 'subcategory', 'updatedAt', 'id']
      const existingFieldNames = fieldsConfig.fields.map((f: CustomField) => f.fieldName)
      
      let allFields = [...fieldsConfig.fields]
      
      // Ajouter les champs système manquants
      systemFields.forEach((name, index) => {
        if (!existingFieldNames.includes(name)) {
          allFields.push({
            id: null,
            fieldName: name,
            fieldLabel: SYSTEM_FIELD_LABELS[name],
            fieldType: 'system',
            fieldOptions: null,
            isRequired: false,
            isVisible: true,
            isSystem: true,
            sortOrder: index
          })
        }
      })
      
      // Trier par sortOrder
      allFields.sort((a, b) => a.sortOrder - b.sortOrder)
      
      setFields(allFields)
      setHasChanges(false)
    }
  }, [fieldsConfig])

  // Mutation pour sauvegarder la configuration
  const saveMutation = useMutation({
    mutationFn: async (fieldsData: CustomField[]) => {
      return api.post('/custom-fields/config', {
        categoryId: subcategory ? null : category?.id,
        subcategoryId: subcategory?.id || null,
        fields: fieldsData.map((f, index) => ({
          ...f,
          sortOrder: index
        }))
      })
    },
    onSuccess: async () => {
      toast.success('Configuration sauvegardée')
      setHasChanges(false)
      // Invalider le cache puis rafraîchir les données
      await queryClient.invalidateQueries({ queryKey: ['customFieldsConfig'] })
      await refetchFields()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  // Mutation pour réinitialiser
  const resetMutation = useMutation({
    mutationFn: async () => {
      if (subcategory?.id) {
        return api.put(`/custom-fields/reset/subcategory/${subcategory.id}`)
      }
      return api.put(`/custom-fields/reset/category/${category.id}`)
    },
    onSuccess: () => {
      toast.success('Configuration réinitialisée')
      refetchFields()
      setResetConfirm(false)
      setHasChanges(false)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur')
    }
  })

  const handleToggleVisibility = (index: number) => {
    const newFields = [...fields]
    newFields[index].isVisible = !newFields[index].isVisible
    setFields(newFields)
    setHasChanges(true)
  }

  const handleRemoveField = (index: number) => {
    if (fields[index].isSystem) {
      toast.error('Impossible de supprimer un champ système')
      return
    }
    const newFields = fields.filter((_, i) => i !== index)
    setFields(newFields)
    setHasChanges(true)
  }

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const newFields = [...fields]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newFields.length) return
    
    [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]]
    setFields(newFields)
    setHasChanges(true)
  }

  const handleEditField = () => {
    if (!editField) return
    
    const newFields = [...fields]
    newFields[editField.index] = {
      ...editField.field,
      fieldOptions: editField.field.fieldType === 'select' && typeof editField.field.fieldOptions === 'string'
        ? (editField.field.fieldOptions as string).split(',').map((s: string) => s.trim())
        : editField.field.fieldOptions
    }
    setFields(newFields)
    setEditField(null)
    setHasChanges(true)
    toast.success('Champ modifié')
  }

  const handleAddField = () => {
    if (!newField.fieldName || !newField.fieldLabel) {
      toast.error('Nom et libellé requis')
      return
    }

    // Vérifier si le nom existe déjà
    if (fields.some(f => f.fieldName === newField.fieldName)) {
      toast.error('Un champ avec ce nom existe déjà')
      return
    }

    const field: CustomField = {
      id: null,
      fieldName: newField.fieldName.toLowerCase().replace(/\s+/g, '_'),
      fieldLabel: newField.fieldLabel,
      fieldType: newField.fieldType,
      fieldOptions: newField.fieldType === 'select' && newField.fieldOptions 
        ? newField.fieldOptions.split(',').map(s => s.trim()) 
        : null,
      isRequired: newField.isRequired,
      isVisible: true,
      isSystem: false,
      sortOrder: fields.length,
      applicableSubcategories: newField.applicableSubcategories.length > 0 ? newField.applicableSubcategories : null
    }

    setFields([...fields, field])
    setNewField({ fieldName: '', fieldLabel: '', fieldType: 'text', fieldOptions: '', isRequired: false, applicableSubcategories: [] })
    setShowAddModal(false)
    setHasChanges(true)
  }

  const handleSave = () => {
    saveMutation.mutate(fields)
  }

  if (categoryLoading || subcategoryLoading || fieldsLoading) {
    return <LoadingInline message="Chargement..." />
  }

  if (!category) {
    return (
      <div className="text-center py-12">
        <Alert type="error">Catégorie non trouvée</Alert>
        <Button className="mt-4" onClick={() => navigate('/categories')}>
          Retour aux catégories
        </Button>
      </div>
    )
  }

  const targetName = subcategory ? subcategory.name : category.name

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm flex-wrap">
        <Link to="/categories" className="text-gray-500 hover:text-gray-700">
          Catégories
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <Link to={`/categories/${category.slug}`} className="text-gray-500 hover:text-gray-700">
          {category.name}
        </Link>
        {subcategory && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link to={`/categories/${category.slug}/${subcategory.slug}`} className="text-gray-500 hover:text-gray-700">
              {subcategory.name}
            </Link>
          </>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 font-medium">Configuration des champs</span>
      </nav>

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-primary-600" />
              Configuration des champs
              {subcategory ? (
                <Badge variant={fieldsConfig?.inherited ? 'default' : 'success'} size="sm">
                  {fieldsConfig?.inherited ? 'Sous-catégorie (héritée)' : 'Sous-catégorie'}
                </Badge>
              ) : (
                <Badge variant="info" size="sm">Catégorie</Badge>
              )}
            </h1>
            <p className="text-gray-500 mt-1">
              Personnalisez les informations affichées pour : <strong>{targetName}</strong>
              {subcategory && !fieldsConfig?.inherited && (
                <span className="text-green-600 ml-2">
                  (configuration spécifique à cette sous-catégorie)
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setResetConfirm(true)}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Réinitialiser
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges}
            loading={saveMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            Sauvegarder
          </Button>
        </div>
      </div>

      {fieldsConfig?.inherited && subcategory && (
        <Alert type="info">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium">Configuration héritée de la catégorie "{category.name}"</p>
              <p className="text-sm mt-1">
                Cette sous-catégorie utilise les mêmes champs que la catégorie parente. 
                Créez une configuration spécifique pour afficher des champs différents pour "{subcategory.name}".
              </p>
            </div>
            <Button 
              size="sm" 
              onClick={() => {
                // Marquer qu'on veut créer une config spécifique
                setHasChanges(true)
                toast.success('Modifiez les champs puis cliquez sur Sauvegarder pour créer une configuration spécifique')
              }}
              className="whitespace-nowrap"
            >
              <Plus className="w-4 h-4 mr-1" />
              Créer config. spécifique
            </Button>
          </div>
        </Alert>
      )}

      {/* Liste des champs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Champs affichés dans "Informations détaillées"</CardTitle>
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Ajouter un champ
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          <div className="divide-y divide-gray-200">
            {fields.map((field, index) => (
              <div 
                key={field.fieldName}
                className={`flex items-center gap-4 p-4 ${!field.isVisible ? 'bg-gray-50 opacity-60' : ''}`}
              >
                {/* Poignée de tri */}
                <div className="flex flex-col gap-1">
                  <button 
                    onClick={() => handleMoveField(index, 'up')}
                    disabled={index === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <GripVertical className="w-4 h-4 rotate-180" />
                  </button>
                  <button 
                    onClick={() => handleMoveField(index, 'down')}
                    disabled={index === fields.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <GripVertical className="w-4 h-4" />
                  </button>
                </div>

                {/* Info du champ */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{field.fieldLabel}</span>
                    {field.isSystem && (
                      <Badge variant="default" size="sm">Système</Badge>
                    )}
                    {!field.isSystem && (
                      <Badge variant="info" size="sm">Personnalisé</Badge>
                    )}
                    {/* Afficher les sous-catégories applicables */}
                    {!field.isSystem && field.applicableSubcategories && field.applicableSubcategories.length > 0 && subcategoriesData && (
                      <Badge variant="warning" size="sm" title="Ce champ s'applique uniquement à certaines sous-catégories">
                        {field.applicableSubcategories.length === 1 
                          ? subcategoriesData.find(s => s.id === field.applicableSubcategories![0])?.name || 'Sous-cat.'
                          : `${field.applicableSubcategories.length} sous-cat.`
                        }
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-gray-500">
                    {field.isSystem ? 'Champ système' : `Type: ${FIELD_TYPES.find(t => t.value === field.fieldType)?.label || field.fieldType}`}
                    {field.fieldName && !field.isSystem && ` • Nom: ${field.fieldName}`}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleToggleVisibility(index)}
                    title={field.isVisible ? 'Masquer' : 'Afficher'}
                  >
                    {field.isVisible ? (
                      <Eye className="w-4 h-4 text-green-600" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-400" />
                    )}
                  </Button>
                  {!field.isSystem && (
                    <>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setEditField({ 
                          index, 
                          field: { 
                            ...field, 
                            fieldOptions: Array.isArray(field.fieldOptions) 
                              ? field.fieldOptions.join(', ') 
                              : field.fieldOptions 
                          } 
                        })}
                        title="Modifier"
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleRemoveField(index)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Prévisualisation */}
      <Card>
        <CardHeader>
          <CardTitle>Prévisualisation</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {fields.filter(f => f.isVisible).map((field) => (
              <div key={field.fieldName}>
                <h4 className="text-sm font-medium text-gray-500 mb-1">{field.fieldLabel}</h4>
                <p className="text-gray-900">
                  {field.isSystem ? (
                    field.fieldName === 'category' ? category.name :
                    field.fieldName === 'subcategory' ? (subcategory?.name || '-') :
                    field.fieldName === 'updatedAt' ? 'Date exemple' :
                    field.fieldName === 'id' ? '#123' : '-'
                  ) : (
                    <span className="text-gray-400 italic">Valeur personnalisée</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Modal ajout de champ */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Ajouter un champ personnalisé">
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Nom technique (sans espaces)"
              value={newField.fieldName}
              onChange={(e) => setNewField({ ...newField, fieldName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
              placeholder="ex: marque, numero_immatriculation"
              required
            />
            <Input
              label="Libellé affiché"
              value={newField.fieldLabel}
              onChange={(e) => setNewField({ ...newField, fieldLabel: e.target.value })}
              placeholder="ex: Marque, Numéro d'immatriculation"
              required
            />
            <Select
              label="Type de champ"
              value={newField.fieldType}
              onChange={(e) => setNewField({ ...newField, fieldType: e.target.value })}
              options={FIELD_TYPES}
            />
            {newField.fieldType === 'select' && (
              <Input
                label="Options (séparées par des virgules)"
                value={newField.fieldOptions}
                onChange={(e) => setNewField({ ...newField, fieldOptions: e.target.value })}
                placeholder="ex: Diesel, Essence, Électrique, Hybride"
              />
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newField.isRequired}
                onChange={(e) => setNewField({ ...newField, isRequired: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">Champ obligatoire</span>
            </label>
            
            {/* Sélecteur de sous-catégories applicables */}
            {subcategoriesData && subcategoriesData.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Appliquer uniquement à certaines sous-catégories
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Laissez vide pour appliquer à toutes les sous-catégories
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {subcategoriesData.map((sub) => (
                    <label key={sub.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                      <input
                        type="checkbox"
                        checked={newField.applicableSubcategories.includes(sub.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewField({ 
                              ...newField, 
                              applicableSubcategories: [...newField.applicableSubcategories, sub.id]
                            })
                          } else {
                            setNewField({ 
                              ...newField, 
                              applicableSubcategories: newField.applicableSubcategories.filter(id => id !== sub.id)
                            })
                          }
                        }}
                        className="rounded border-gray-300 text-primary-600"
                      />
                      <span className="text-sm text-gray-700">{sub.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowAddModal(false)}>
            Annuler
          </Button>
          <Button onClick={handleAddField}>
            Ajouter
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal de confirmation de réinitialisation */}
      <Modal isOpen={resetConfirm} onClose={() => setResetConfirm(false)} title="Réinitialiser la configuration">
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir réinitialiser la configuration des champs ?
            {subcategory ? (
              <span className="block mt-2">
                La sous-catégorie héritera à nouveau de la configuration de la catégorie parente.
              </span>
            ) : (
              <span className="block mt-2">
                Tous les champs personnalisés seront supprimés et les champs système seront rétablis.
              </span>
            )}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setResetConfirm(false)}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => resetMutation.mutate()} loading={resetMutation.isPending}>
            Réinitialiser
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal d'édition de champ */}
      <Modal isOpen={!!editField} onClose={() => setEditField(null)} title="Modifier le champ">
        <ModalBody>
          {editField && (
            <div className="space-y-4">
              <Input
                label="Nom technique"
                value={editField.field.fieldName}
                onChange={(e) => setEditField({ 
                  ...editField, 
                  field: { ...editField.field, fieldName: e.target.value.toLowerCase().replace(/\s+/g, '_') }
                })}
                placeholder="ex: marque, numero_immatriculation"
              />
              <Input
                label="Libellé affiché"
                value={editField.field.fieldLabel}
                onChange={(e) => setEditField({ 
                  ...editField, 
                  field: { ...editField.field, fieldLabel: e.target.value }
                })}
                placeholder="ex: Marque, Numéro d'immatriculation"
              />
              <Select
                label="Type de champ"
                value={editField.field.fieldType}
                onChange={(e) => setEditField({ 
                  ...editField, 
                  field: { ...editField.field, fieldType: e.target.value }
                })}
                options={FIELD_TYPES}
              />
              {editField.field.fieldType === 'select' && (
                <Input
                  label="Options (séparées par des virgules)"
                  value={typeof editField.field.fieldOptions === 'string' ? editField.field.fieldOptions : (editField.field.fieldOptions || []).join(', ')}
                  onChange={(e) => setEditField({ 
                    ...editField, 
                    field: { ...editField.field, fieldOptions: e.target.value }
                  })}
                  placeholder="ex: Diesel, Essence, Électrique, Hybride"
                />
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editField.field.isRequired}
                  onChange={(e) => setEditField({ 
                    ...editField, 
                    field: { ...editField.field, isRequired: e.target.checked }
                  })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Champ obligatoire</span>
              </label>
              
              {/* Sélecteur de sous-catégories applicables */}
              {subcategoriesData && subcategoriesData.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Appliquer uniquement à certaines sous-catégories
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Laissez vide pour appliquer à toutes les sous-catégories
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {subcategoriesData.map((sub) => (
                      <label key={sub.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={(editField.field.applicableSubcategories || []).includes(sub.id)}
                          onChange={(e) => {
                            const currentSubs = editField.field.applicableSubcategories || []
                            if (e.target.checked) {
                              setEditField({ 
                                ...editField, 
                                field: { 
                                  ...editField.field, 
                                  applicableSubcategories: [...currentSubs, sub.id]
                                }
                              })
                            } else {
                              setEditField({ 
                                ...editField, 
                                field: { 
                                  ...editField.field, 
                                  applicableSubcategories: currentSubs.filter(id => id !== sub.id)
                                }
                              })
                            }
                          }}
                          className="rounded border-gray-300 text-primary-600"
                        />
                        <span className="text-sm text-gray-700">{sub.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setEditField(null)}>
            Annuler
          </Button>
          <Button onClick={handleEditField}>
            Enregistrer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
