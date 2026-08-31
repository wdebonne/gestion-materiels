import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { 
  Plus, Search, ChevronRight, ArrowLeft, Edit2, Trash2, 
  FolderOpen, LayoutGrid, Package, Settings2
} from 'lucide-react'
import { 
  Button, Input, Modal, ModalBody, ModalFooter, ImageCard, 
  LoadingInline, Alert, TextArea, Card, CardBody, ImageUpload
} from '@/components/ui'
import api, { Category, Subcategory, GestionObject as ObjectType } from '@/lib/api'
import { usePaginatedObjects } from '@/lib/usePaginatedObjects'
import { useAuthStore } from '@/stores/auth.store'
import ChoixPrestation, { BadgePrestation } from '@/components/ChoixPrestation'
import ChoixTypeMateriel from '@/components/ChoixTypeMateriel'
import ChoixPretable from '@/components/ChoixPretable'
import CoutUnitaire from '@/components/CoutUnitaire'
import toast from 'react-hot-toast'
import { BoutonEtiquettesQr } from '@/components/QrLabelsModal'

export default function CategoryDetailPage() {
  const { categorySlug: slug } = useParams<{ categorySlug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isSupervisor = user?.role === 'admin' || user?.role === 'supervisor'
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null)
  const [editingObject, setEditingObject] = useState<ObjectType | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    image: '',
    isPrestation: null as boolean | null,
    availableForManifestations: null as boolean | null
  })
  const [objectFormData, setObjectFormData] = useState({
    name: '',
    description: '',
    image: '',
    reference: '',
    serialNumber: '',
    status: 'available',
    location: '',
    isPrestation: null as boolean | null,
    materialType: 'unique' as 'unique' | 'lot',
    quantityTotal: 0,
    unitCost: 0,
    availableForManifestations: null as boolean | null
  })
  const [deleteConfirm, setDeleteConfirm] = useState<Subcategory | null>(null)
  const [deleteObjectConfirm, setDeleteObjectConfirm] = useState<ObjectType | null>(null)
  const [isObjectModalOpen, setIsObjectModalOpen] = useState(false)
  const [editCategory, setEditCategory] = useState(false)
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
    image: '',
    isPrestation: false,
    availableForManifestations: true
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

  // Récupérer les objets (si pas de sous-catégories), page par page
  const {
    objets: objects,
    total: totalObjets,
    resteAPager,
    chargerSuite,
    chargementSuite,
    isLoading: objectsLoading,
  } = usePaginatedObjects({
    categoryId: category?.id,
    search,
    enabled: !!category?.id && !category?.hasSubcategories,
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
        image: subcategory.image || '',
        isPrestation: subcategory.isPrestation ?? null,
        availableForManifestations: subcategory.availableForManifestations ?? null
      })
    } else {
      setEditingSubcategory(null)
      setFormData({ name: '', image: '', isPrestation: null, availableForManifestations: null })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingSubcategory(null)
    setFormData({ name: '', image: '', isPrestation: null, availableForManifestations: null })
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
        status: object.status || 'available',
        location: object.location || '',
        isPrestation: object.isPrestation ?? null,
        materialType: object.materialType ?? 'unique',
        quantityTotal: object.quantityTotal ?? 0,
        unitCost: object.unitCost ?? 0,
        availableForManifestations: object.availableForManifestations ?? null
      })
    } else {
      setEditingObject(null)
      setObjectFormData({
        name: '',
        description: '',
        image: '',
        reference: '',
        serialNumber: '',
        status: 'available',
        location: '',
        isPrestation: null,
        materialType: 'unique',
        quantityTotal: 0,
        unitCost: 0,
        availableForManifestations: null
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
      status: 'available',
      location: '',
      isPrestation: null,
      materialType: 'unique',
      quantityTotal: 0,
      unitCost: 0,
      availableForManifestations: null
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
        image: category.image || '',
        isPrestation: Boolean(category.isPrestation),
        availableForManifestations: category.availableForManifestations !== false
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

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/categories" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          Catégories
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 dark:text-gray-100 font-medium">{category.name}</span>
      </nav>

      {/* En-tête de la catégorie */}
      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {/* Image */}
            <div className="w-32 h-32 bg-gray-100 dark:bg-gray-700 rounded-xl flex-shrink-0 overflow-hidden">
              {category.image ? (
                <img 
                  src={category.image} 
                  alt={category.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
                  <LayoutGrid className="w-12 h-12" />
                </div>
              )}
            </div>

            {/* Infos */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{category.name}</h1>
                  {category.description && (
                    <p className="text-gray-500 dark:text-gray-400 mt-1">{category.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
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
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => navigate(`/categories/${category.slug}/fields`)}
                    title="Configurer les champs affichés pour cette catégorie (applicable à toutes les sous-catégories sauf configuration spécifique)"
                  >
                    <Settings2 className="w-4 h-4 mr-1" />
                    <span className="hidden sm:inline">Champs</span>
                  </Button>
                  {isSupervisor && (
                  <Button variant="outline" size="sm" onClick={handleCategoryEdit}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  )}
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
        {/* Étiquetage d'un lot de matériels : la génération existait côté
            serveur sans aucun écran pour l'appeler. */}
        {!category.hasSubcategories && (
          <BoutonEtiquettesQr materiels={objects} titre={category.name} />
        )}
        {isSupervisor && (
        <>
        {category.hasSubcategories ? (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
            Nouvelle sous-catégorie
          </Button>
        ) : (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => openObjectModal()}>
            Nouveau matériel
          </Button>
        )}
        </>
        )}
      </div>

      {/* Liste des sous-catégories OU objets */}
      {category.hasSubcategories ? (
        <>
          {subcategoriesLoading ? (
        <LoadingInline message="Chargement des sous-catégories..." />
      ) : subcategories.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-8 h-8 text-gray-600 dark:text-gray-300" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Aucune sous-catégorie</h3>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
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
                image={subcategory.image}
                icon={<FolderOpen className="w-full h-full" />}
                count={subcategory.objectCount}
                onClick={() => navigate(`/categories/${slug}/${subcategory.slug}`)}
              />

              {/* Une prestation ne se manipule pas comme du matériel : le dire
                  dès la liste évite d'aller l'ouvrir pour le découvrir. */}
              {(subcategory.isPrestation ?? category?.isPrestation) ? (
                <BadgePrestation className="absolute top-2 left-2 shadow-sm" />
              ) : null}
              
              {/* Actions au survol - superviseurs et admins uniquement */}
              {isSupervisor && (
              <div className="absolute top-2 right-2 flex gap-1 hover-reveal">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openModal(subcategory)
                  }}
                  className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <Edit2 className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </button>
                {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(subcategory)
                  }}
                  className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:bg-red-50"
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
        </>
      ) : (
        <>
          {/* Liste des objets */}
          {objectsLoading ? (
            <LoadingInline message="Chargement des matériels..." />
          ) : objects.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package className="w-8 h-8 text-gray-600 dark:text-gray-300" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Aucun matériel</h3>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
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
                  
                  {/* Actions au survol - superviseurs et admins uniquement */}
                  {isSupervisor && (
                  <div className="absolute top-2 right-2 flex gap-1 hover-reveal">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openObjectModal(object)
                      }}
                      className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <Edit2 className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </button>
                    {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteObjectConfirm(object)
                      }}
                      className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:bg-red-50"
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

          {resteAPager && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => chargerSuite()}
                loading={chargementSuite}
              >
                Afficher plus de matériels ({objects.length} sur {totalObjets})
              </Button>
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

            <ImageUpload
              label="Image"
              value={formData.image}
              onChange={(url) => setFormData({ ...formData, image: url })}
            />

            {/*
              C'est ici que se règle l'organisation visée : « Technique ›
              Prestation » à côté de « Technique › Mobilier ». Le service tient
              ses prestations là où il tient déjà son matériel, et le routage
              d'approbation suit la catégorie sans rien de plus.
            */}
            <ChoixPrestation
              valeur={formData.isPrestation}
              onChange={(isPrestation) => setFormData({ ...formData, isPrestation })}
              heriteDe={{ prestation: Boolean(category?.isPrestation), source: 'la catégorie' }}
              label="Que contient cette sous-catégorie ?"
              aide="Une prestation — raccordement électrique, débit de boissons, personnel — n’a ni stock ni exemplaire : elle ne bloque jamais une autre manifestation."
            />

            <ChoixPretable
              valeur={formData.availableForManifestations}
              onChange={(availableForManifestations) =>
                setFormData({ ...formData, availableForManifestations })
              }
              heriteDe={{ pretable: category?.availableForManifestations !== false, source: 'la catégorie' }}
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

            <ChoixPrestation
              valeur={categoryFormData.isPrestation}
              onChange={(isPrestation) =>
                setCategoryFormData({ ...categoryFormData, isPrestation: Boolean(isPrestation) })
              }
              sansHeritage
              label="Que contient cette catégorie ?"
              aide="Le ton donné à toute la catégorie. Chaque sous-catégorie peut ensuite l’affiner — une catégorie de service porte souvent les deux."
            />

            <ChoixPretable
              valeur={categoryFormData.availableForManifestations}
              onChange={(availableForManifestations) =>
                setCategoryFormData({
                  ...categoryFormData,
                  availableForManifestations: availableForManifestations !== false,
                })
              }
              sansHeritage
              label="Catégorie disponible pour les manifestations"
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
          <p className="text-gray-600 dark:text-gray-300">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Localisation"
                value={objectFormData.location}
                onChange={(e) => setObjectFormData({ ...objectFormData, location: e.target.value })}
                placeholder="Ex: Garage municipal"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Statut</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

            {!(objectFormData.isPrestation ?? category?.isPrestation) && (
              <ChoixTypeMateriel
                type={objectFormData.materialType}
                quantite={objectFormData.quantityTotal}
                onChangeType={(materialType) => setObjectFormData({ ...objectFormData, materialType })}
                onChangeQuantite={(quantityTotal) => setObjectFormData({ ...objectFormData, quantityTotal })}
              />
            )}

            <ChoixPrestation
              valeur={objectFormData.isPrestation}
              onChange={(isPrestation) => setObjectFormData({ ...objectFormData, isPrestation })}
              heriteDe={{ prestation: Boolean(category?.isPrestation), source: 'sa catégorie' }}
              aide="Une prestation ne se stocke pas et n’immobilise rien : elle est demandée, puis réalisée."
            />

            <ChoixPretable
              valeur={objectFormData.availableForManifestations}
              onChange={(availableForManifestations) =>
                setObjectFormData({ ...objectFormData, availableForManifestations })
              }
              heriteDe={{ pretable: category?.availableForManifestations !== false, source: 'sa catégorie' }}
            />

            <CoutUnitaire
              valeur={objectFormData.unitCost}
              nature={
                (objectFormData.isPrestation ?? category?.isPrestation)
                  ? 'prestation'
                  : objectFormData.materialType === 'lot'
                    ? 'lot'
                    : 'unique'
              }
              onChange={(unitCost) => setObjectFormData({ ...objectFormData, unitCost })}
            />

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
          <p className="text-gray-600 dark:text-gray-300">
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
