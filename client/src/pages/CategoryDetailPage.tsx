import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  Plus, Search, ChevronRight, ArrowLeft, Edit2, Trash2, 
  FolderOpen, LayoutGrid, Package
} from 'lucide-react'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, ImageCard, 
  LoadingInline, Alert, TextArea, Card, CardBody, ImageUpload
} from '@/components/ui'
import api, { Category, Subcategory, Object as ObjectType } from '@/lib/api'
import toast from 'react-hot-toast'

export default function CategoryDetailPage() {
  const { categorySlug: slug } = useParams<{ categorySlug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null)
  const [editingObject, setEditingObject] = useState<ObjectType | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image: ''
  })
  const [objectFormData, setObjectFormData] = useState({
    name: '',
    description: '',
    image: '',
    reference: '',
    serialNumber: '',
    status: 'active',
    location: ''
  })
  const [deleteConfirm, setDeleteConfirm] = useState<Subcategory | null>(null)
  const [deleteObjectConfirm, setDeleteObjectConfirm] = useState<ObjectType | null>(null)
  const [isObjectModalOpen, setIsObjectModalOpen] = useState(false)
  const [editCategory, setEditCategory] = useState(false)
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
    image: ''
  })

  // Récupérer la catégorie
  const { data: category, isLoading, error } = useQuery({
    queryKey: ['category', slug],
    queryFn: async () => {
      const response = await api.get(`/categories/${slug}`)
      return response.data.category as Category
    },
    enabled: !!slug
  })

  // Récupérer les sous-catégories
  const { data: subcategoriesData, isLoading: subcategoriesLoading } = useQuery({
    queryKey: ['subcategories', category?.id, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      const response = await api.get(`/categories/${category?.id}/subcategories?${params}`)
      return response.data
    },
    enabled: !!category?.id && category?.hasSubcategories
  })

  // Récupérer les objets (si pas de sous-catégories)
  const { data: objectsData, isLoading: objectsLoading } = useQuery({
    queryKey: ['objects', 'category', category?.id, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.append('categoryId', String(category?.id))
      if (search) params.append('search', search)
      const response = await api.get(`/objects?${params}`)
      return response.data
    },
    enabled: !!category?.id && !category?.hasSubcategories
  })

  // Mutation pour créer/modifier une sous-catégorie
  const saveSubcategoryMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingSubcategory) {
        return api.put(`/subcategories/${editingSubcategory.id}`, data)
      }
      return api.post(`/categories/${category?.id}/subcategories`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcategories', category?.id] })
      queryClient.invalidateQueries({ queryKey: ['category', slug] })
      toast.success(editingSubcategory ? 'Sous-catégorie modifiée' : 'Sous-catégorie créée')
      closeModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Une erreur est survenue')
    }
  })

  // Mutation pour supprimer une sous-catégorie
  const deleteSubcategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/subcategories/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcategories', category?.id] })
      queryClient.invalidateQueries({ queryKey: ['category', slug] })
      toast.success('Sous-catégorie supprimée')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Impossible de supprimer')
    }
  })

  // Mutation pour créer/modifier un objet
  const saveObjectMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingObject) {
        return api.put(`/objects/${editingObject.id}`, data)
      }
      return api.post('/objects', { ...data, categoryId: category?.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['objects', 'category', category?.id] })
      queryClient.invalidateQueries({ queryKey: ['category', slug] })
      toast.success(editingObject ? 'Matériel modifié' : 'Matériel créé')
      closeObjectModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Une erreur est survenue')
    }
  })

  // Mutation pour supprimer un objet
  const deleteObjectMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/objects/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['objects', 'category', category?.id] })
      queryClient.invalidateQueries({ queryKey: ['category', slug] })
      toast.success('Matériel supprimé')
      setDeleteObjectConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Impossible de supprimer')
    }
  })

  // Mutation pour modifier la catégorie
  const updateCategoryMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put(`/categories/${category?.id}`, data)
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['category', slug] })
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Catégorie modifiée')
      setEditCategory(false)
      // Si le slug a changé, rediriger
      if (response.data.slug !== slug) {
        navigate(`/categories/${response.data.slug}`, { replace: true })
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Une erreur est survenue')
    }
  })

  const openModal = (subcategory?: Subcategory) => {
    if (subcategory) {
      setEditingSubcategory(subcategory)
      setFormData({
        name: subcategory.name,
        description: subcategory.description || '',
        image: subcategory.image || ''
      })
    } else {
      setEditingSubcategory(null)
      setFormData({ name: '', description: '', image: '' })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingSubcategory(null)
    setFormData({ name: '', description: '', image: '' })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveSubcategoryMutation.mutate(formData)
  }

  // Fonctions pour les objets
  const openObjectModal = (object?: ObjectType) => {
    if (object) {
      setEditingObject(object)
      setObjectFormData({
        name: object.name,
        description: object.description || '',
        image: object.image || '',
        reference: object.reference || '',
        serialNumber: object.serialNumber || '',
        status: object.status || 'active',
        location: object.location || ''
      })
    } else {
      setEditingObject(null)
      setObjectFormData({
        name: '',
        description: '',
        image: '',
        reference: '',
        serialNumber: '',
        status: 'active',
        location: ''
      })
    }
    setIsObjectModalOpen(true)
  }

  const closeObjectModal = () => {
    setIsObjectModalOpen(false)
    setEditingObject(null)
    setObjectFormData({
      name: '',
      description: '',
      image: '',
      reference: '',
      serialNumber: '',
      status: 'active',
      location: ''
    })
  }

  const handleObjectSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveObjectMutation.mutate(objectFormData)
  }

  const handleCategoryEdit = () => {
    if (category) {
      setCategoryFormData({
        name: category.name,
        description: category.description || '',
        image: category.image || ''
      })
      setEditCategory(true)
    }
  }

  const handleCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateCategoryMutation.mutate(categoryFormData)
  }

  if (isLoading) {
    return <LoadingInline message="Chargement de la catégorie..." />
  }

  if (error || !category) {
    return (
      <div className="text-center py-12">
        <Alert type="error">Catégorie non trouvée</Alert>
        <Button className="mt-4" onClick={() => navigate('/categories')}>
          Retour aux catégories
        </Button>
      </div>
    )
  }

  const subcategories = subcategoriesData?.subcategories || []
  const objects = objectsData?.objects || []

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/categories" className="text-gray-500 hover:text-gray-700">
          Catégories
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 font-medium">{category.name}</span>
      </nav>

      {/* En-tête de la catégorie */}
      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {/* Image */}
            <div className="w-32 h-32 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden">
              {category.image ? (
                <img 
                  src={category.image} 
                  alt={category.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <LayoutGrid className="w-12 h-12" />
                </div>
              )}
            </div>

            {/* Infos */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{category.name}</h1>
                  {category.description && (
                    <p className="text-gray-500 mt-1">{category.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                    {category.hasSubcategories ? (
                      <span>{subcategories.length} sous-catégorie(s)</span>
                    ) : (
                      <span>{objects.length} matériel(s)</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => navigate('/categories')}>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCategoryEdit}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Actions et recherche */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1 max-w-md">
          <Input
            placeholder={category.hasSubcategories ? "Rechercher une sous-catégorie..." : "Rechercher un matériel..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="w-5 h-5" />}
          />
        </div>
        {category.hasSubcategories ? (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
            Nouvelle sous-catégorie
          </Button>
        ) : (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => openObjectModal()}>
            Nouveau matériel
          </Button>
        )}
      </div>

      {/* Liste des sous-catégories OU objets */}
      {category.hasSubcategories ? (
        <>
          {subcategoriesLoading ? (
        <LoadingInline message="Chargement des sous-catégories..." />
      ) : subcategories.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">Aucune sous-catégorie</h3>
          <p className="text-gray-500 mt-1">
            {search ? 'Aucun résultat pour cette recherche' : 'Commencez par créer une sous-catégorie'}
          </p>
          {!search && (
            <Button className="mt-4" onClick={() => openModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Créer une sous-catégorie
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {subcategories.map((subcategory: Subcategory) => (
            <div key={subcategory.id} className="relative group">
              <ImageCard
                title={subcategory.name}
                description={subcategory.description}
                image={subcategory.image}
                icon={<FolderOpen className="w-full h-full" />}
                count={subcategory.objectCount}
                onClick={() => navigate(`/categories/${slug}/${subcategory.slug}`)}
              />
              
              {/* Actions au survol */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openModal(subcategory)
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50"
                >
                  <Edit2 className="w-4 h-4 text-gray-600" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(subcategory)
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      ) : (
        <>
          {/* Liste des objets */}
          {objectsLoading ? (
            <LoadingInline message="Chargement des matériels..." />
          ) : objects.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">Aucun matériel</h3>
              <p className="text-gray-500 mt-1">
                {search ? 'Aucun résultat pour cette recherche' : 'Commencez par ajouter un matériel'}
              </p>
              {!search && (
                <Button className="mt-4" onClick={() => openObjectModal()}>
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter un matériel
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {objects.map((object: ObjectType) => (
                <div key={object.id} className="relative group">
                  <ImageCard
                    title={object.name}
                    description={object.description}
                    image={object.image}
                    icon={<Package className="w-full h-full" />}
                    onClick={() => navigate(`/objects/${object.id}`)}
                  />
                  
                  {/* Actions au survol */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openObjectModal(object)
                      }}
                      className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50"
                    >
                      <Edit2 className="w-4 h-4 text-gray-600" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteObjectConfirm(object)
                      }}
                      className="p-2 bg-white rounded-lg shadow-md hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal création/édition sous-catégorie */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSubcategory ? 'Modifier la sous-catégorie' : 'Nouvelle sous-catégorie'}
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Utilitaires"
              required
              autoFocus
            />

            <TextArea
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description de la sous-catégorie..."
              rows={3}
            />

            <ImageUpload
              label="Image"
              value={formData.image}
              onChange={(url) => setFormData({ ...formData, image: url })}
            />
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveSubcategoryMutation.isPending}>
              {editingSubcategory ? 'Modifier' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal édition catégorie */}
      <Modal
        isOpen={editCategory}
        onClose={() => setEditCategory(false)}
        title="Modifier la catégorie"
      >
        <form onSubmit={handleCategorySubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom"
              value={categoryFormData.name}
              onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
              required
            />

            <TextArea
              label="Description"
              value={categoryFormData.description}
              onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
              rows={3}
            />

            <ImageUpload
              label="Image"
              value={categoryFormData.image}
              onChange={(url) => setCategoryFormData({ ...categoryFormData, image: url })}
            />
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setEditCategory(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={updateCategoryMutation.isPending}>
              Modifier
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer la sous-catégorie"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deleteConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-red-600 mt-2">
            Cette action supprimera également tous les objets associés.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteSubcategoryMutation.isPending}
            onClick={() => deleteConfirm && deleteSubcategoryMutation.mutate(deleteConfirm.id)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal création/édition objet */}
      <Modal
        isOpen={isObjectModalOpen}
        onClose={closeObjectModal}
        title={editingObject ? 'Modifier le matériel' : 'Nouveau matériel'}
        size="lg"
      >
        <form onSubmit={handleObjectSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom"
              value={objectFormData.name}
              onChange={(e) => setObjectFormData({ ...objectFormData, name: e.target.value })}
              placeholder="Ex: Peugeot Partner"
              required
              autoFocus
            />

            <TextArea
              label="Description"
              value={objectFormData.description}
              onChange={(e) => setObjectFormData({ ...objectFormData, description: e.target.value })}
              placeholder="Description du matériel..."
              rows={3}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Référence"
                value={objectFormData.reference}
                onChange={(e) => setObjectFormData({ ...objectFormData, reference: e.target.value })}
                placeholder="Ex: REF-001"
              />
              <Input
                label="Numéro de série"
                value={objectFormData.serialNumber}
                onChange={(e) => setObjectFormData({ ...objectFormData, serialNumber: e.target.value })}
                placeholder="Ex: SN-123456"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Localisation"
                value={objectFormData.location}
                onChange={(e) => setObjectFormData({ ...objectFormData, location: e.target.value })}
                placeholder="Ex: Garage municipal"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={objectFormData.status}
                  onChange={(e) => setObjectFormData({ ...objectFormData, status: e.target.value })}
                >
                  <option value="available">Disponible</option>
                  <option value="in_use">En utilisation</option>
                  <option value="maintenance">En maintenance</option>
                  <option value="out_of_service">Hors service</option>
                </select>
              </div>
            </div>

            <ImageUpload
              label="Image"
              value={objectFormData.image}
              onChange={(url) => setObjectFormData({ ...objectFormData, image: url })}
            />
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={closeObjectModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveObjectMutation.isPending}>
              {editingObject ? 'Modifier' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal confirmation suppression objet */}
      <Modal
        isOpen={!!deleteObjectConfirm}
        onClose={() => setDeleteObjectConfirm(null)}
        title="Supprimer le matériel"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deleteObjectConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-red-600 mt-2">
            Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteObjectConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteObjectMutation.isPending}
            onClick={() => deleteObjectConfirm && deleteObjectMutation.mutate(deleteObjectConfirm.id)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
