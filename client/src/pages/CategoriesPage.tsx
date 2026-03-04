import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, LayoutGrid, Edit2, Trash2 } from 'lucide-react'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, ImageCard, 
  LoadingInline, Alert, TextArea, ImageUpload 
} from '@/components/ui'
import api, { Category } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import toast from 'react-hot-toast'

export default function CategoriesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isSupervisor = user?.role === 'admin' || user?.role === 'supervisor'
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image: '',
    hasSubcategories: false
  })
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)

  // Récupérer les catégories
  const { data, isLoading, error } = useQuery({
    queryKey: ['categories', search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      const response = await api.get(`/categories?${params}`)
      return response.data
    }
  })

  // Mutation pour créer/modifier
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingCategory) {
        return api.put(`/categories/${editingCategory.id}`, data)
      }
      return api.post('/categories', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success(editingCategory ? 'Catégorie modifiée' : 'Catégorie créée')
      closeModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Une erreur est survenue')
    }
  })

  // Mutation pour supprimer
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/categories/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Catégorie supprimée')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Impossible de supprimer cette catégorie')
    }
  })

  const openModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category)
      setFormData({
        name: category.name,
        description: category.description || '',
        image: category.image || '',
        hasSubcategories: category.hasSubcategories || false
      })
    } else {
      setEditingCategory(null)
      setFormData({ name: '', description: '', image: '', hasSubcategories: false })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingCategory(null)
    setFormData({ name: '', description: '', image: '', hasSubcategories: false })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const categories = data?.categories || []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catégories</h1>
          <p className="text-gray-500 mt-1">Gérez les catégories de matériels</p>
        </div>
        {isSupervisor && (
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
          Nouvelle catégorie
        </Button>
        )}
      </div>

      {/* Recherche */}
      <div className="flex gap-4">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Rechercher une catégorie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="w-5 h-5" />}
          />
        </div>
      </div>

      {/* Liste des catégories */}
      {isLoading ? (
        <LoadingInline message="Chargement des catégories..." />
      ) : error ? (
        <Alert type="error">
          Erreur lors du chargement des catégories
        </Alert>
      ) : categories.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <LayoutGrid className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">Aucune catégorie</h3>
          <p className="text-gray-500 mt-1">
            {search ? 'Aucun résultat pour cette recherche' : 'Commencez par créer une catégorie'}
          </p>
          {!search && (
            <Button className="mt-4" onClick={() => openModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Créer une catégorie
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {categories.map((category: Category) => (
            <div key={category.id} className="relative group">
              <ImageCard
                title={category.name}
                description={category.description}
                image={category.image}
                icon={<LayoutGrid className="w-full h-full" />}
                count={category.subcategoryCount}
                onClick={() => navigate(`/categories/${category.slug}`)}
              />
              
              {/* Actions au survol - superviseurs et admins uniquement */}
              {isSupervisor && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openModal(category)
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50"
                >
                  <Edit2 className="w-4 h-4 text-gray-600" />
                </button>
                {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(category)
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
                )}
              </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal création/édition */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingCategory ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Véhicules"
              required
              autoFocus
            />

            <TextArea
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description de la catégorie..."
              rows={3}
            />

            <ImageUpload
              label="Image de la catégorie"
              value={formData.image}
              onChange={(url) => setFormData({ ...formData, image: url })}
              hint="Image pour illustrer la catégorie"
            />

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="hasSubcategories"
                checked={formData.hasSubcategories}
                onChange={(e) => setFormData({ ...formData, hasSubcategories: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="hasSubcategories" className="text-sm text-gray-700">
                Cette catégorie contient des sous-catégories
              </label>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveMutation.isPending}>
              {editingCategory ? 'Modifier' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal de confirmation de suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer la catégorie"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer la catégorie <strong>{deleteConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-red-600 mt-2">
            Cette action supprimera également toutes les sous-catégories et objets associés.
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
    </div>
  )
}
