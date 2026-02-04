import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  Plus, Search, ChevronRight, ArrowLeft, Edit2, Trash2, 
  Package, Settings2
} from 'lucide-react'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, ImageCard, 
  LoadingInline, Alert, TextArea, Card, CardBody, Select, ImageUpload
} from '@/components/ui'
import api, { Subcategory, EquipmentObject } from '@/lib/api'
import toast from 'react-hot-toast'

export default function SubcategoryDetailPage() {
  const { categorySlug, subcategorySlug } = useParams<{ categorySlug: string; subcategorySlug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingObject, setEditingObject] = useState<EquipmentObject | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image: '',
    status: 'active'
  })
  const [deleteConfirm, setDeleteConfirm] = useState<EquipmentObject | null>(null)

  // Récupérer la catégorie parente
  const { data: category } = useQuery({
    queryKey: ['category', categorySlug],
    queryFn: async () => {
      const response = await api.get(`/categories/${categorySlug}`)
      return response.data.category
    },
    enabled: !!categorySlug
  })

  // Récupérer la sous-catégorie
  const { data: subcategory, isLoading, error } = useQuery({
    queryKey: ['subcategory', subcategorySlug],
    queryFn: async () => {
      const response = await api.get(`/subcategories/by-slug/${subcategorySlug}`)
      return response.data as Subcategory
    },
    enabled: !!subcategorySlug
  })

  // Récupérer les objets de la sous-catégorie
  const { data: objectsData, isLoading: objectsLoading } = useQuery({
    queryKey: ['objects', subcategory?.id, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      params.append('subcategoryId', String(subcategory?.id))
      const response = await api.get(`/objects?${params}`)
      return response.data
    },
    enabled: !!subcategory?.id
  })

  // Mutation pour créer/modifier un objet
  const saveObjectMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingObject) {
        return api.put(`/objects/${editingObject.id}`, data)
      }
      return api.post('/objects', { ...data, subcategoryId: subcategory?.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['objects', subcategory?.id] })
      queryClient.invalidateQueries({ queryKey: ['subcategory', subcategorySlug] })
      toast.success(editingObject ? 'Matériel modifié' : 'Matériel créé')
      closeModal()
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
      queryClient.invalidateQueries({ queryKey: ['objects', subcategory?.id] })
      queryClient.invalidateQueries({ queryKey: ['subcategory', subcategorySlug] })
      toast.success('Matériel supprimé')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Impossible de supprimer')
    }
  })

  const openModal = (obj?: EquipmentObject) => {
    if (obj) {
      setEditingObject(obj)
      setFormData({
        name: obj.name,
        description: obj.description || '',
        image: obj.image || '',
        status: obj.status || 'active'
      })
    } else {
      setEditingObject(null)
      setFormData({ name: '', description: '', image: '', status: 'active' })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingObject(null)
    setFormData({ name: '', description: '', image: '', status: 'active' })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveObjectMutation.mutate(formData)
  }

  if (isLoading) {
    return <LoadingInline message="Chargement..." />
  }

  if (error || !subcategory) {
    return (
      <div className="text-center py-12">
        <Alert type="error">Sous-catégorie non trouvée</Alert>
        <Button className="mt-4" onClick={() => navigate('/categories')}>
          Retour aux catégories
        </Button>
      </div>
    )
  }

  const objects = objectsData?.objects || []

  const statusOptions = [
    { value: 'active', label: 'Actif' },
    { value: 'maintenance', label: 'En maintenance' },
    { value: 'inactive', label: 'Inactif' },
    { value: 'retired', label: 'Retiré' }
  ]

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm flex-wrap">
        <Link to="/categories" className="text-gray-500 hover:text-gray-700">
          Catégories
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <Link to={`/categories/${categorySlug}`} className="text-gray-500 hover:text-gray-700">
          {category?.name}
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 font-medium">{subcategory.name}</span>
      </nav>

      {/* En-tête */}
      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {/* Image */}
            <div className="w-32 h-32 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden">
              {subcategory.image ? (
                <img 
                  src={subcategory.image} 
                  alt={subcategory.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <Package className="w-12 h-12" />
                </div>
              )}
            </div>

            {/* Infos */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{subcategory.name}</h1>
                  {subcategory.description && (
                    <p className="text-gray-500 mt-1">{subcategory.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                    <span>{objects.length} matériel(s)</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/categories/${categorySlug}`)}>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => navigate(`/categories/${categorySlug}/${subcategorySlug}/fields`)}
                    title="Configurer les champs"
                  >
                    <Settings2 className="w-4 h-4" />
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
            placeholder="Rechercher un matériel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="w-5 h-5" />}
          />
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
          Nouveau matériel
        </Button>
      </div>

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
            <Button className="mt-4" onClick={() => openModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Ajouter un matériel
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {objects.map((obj: EquipmentObject) => (
            <div key={obj.id} className="relative group">
              <ImageCard
                title={obj.name}
                description={obj.description}
                image={obj.image}
                icon={<Package className="w-full h-full" />}
                onClick={() => navigate(`/objects/${obj.id}`)}
              />
              
              {/* Badge de statut */}
              <div className={`absolute top-2 left-2 px-2 py-0.5 text-xs font-medium rounded-full ${
                obj.status === 'active' ? 'bg-green-100 text-green-700' :
                obj.status === 'maintenance' ? 'bg-yellow-100 text-yellow-700' :
                obj.status === 'inactive' ? 'bg-gray-100 text-gray-700' :
                'bg-red-100 text-red-700'
              }`}>
                {statusOptions.find(s => s.value === obj.status)?.label || 'Actif'}
              </div>

              {/* Actions au survol */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openModal(obj)
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50"
                >
                  <Edit2 className="w-4 h-4 text-gray-600" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(obj)
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

      {/* Modal création/édition objet */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingObject ? 'Modifier le matériel' : 'Nouveau matériel'}
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Renault Master"
              required
              autoFocus
            />

            <TextArea
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description du matériel..."
              rows={3}
            />

            <Select
              label="Statut"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              options={statusOptions}
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
            <Button type="submit" loading={saveObjectMutation.isPending}>
              {editingObject ? 'Modifier' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer le matériel"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deleteConfirm?.name}</strong> ?
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
            loading={deleteObjectMutation.isPending}
            onClick={() => deleteConfirm && deleteObjectMutation.mutate(deleteConfirm.id)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
