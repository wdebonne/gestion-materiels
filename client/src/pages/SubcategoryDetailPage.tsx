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
import api, { Subcategory, GestionObject as EquipmentObject } from '@/lib/api'
import { usePaginatedObjects } from '@/lib/usePaginatedObjects'
import ChoixPrestation, { BadgePrestation } from '@/components/ChoixPrestation'
import ChoixTypeMateriel, { BadgeLot } from '@/components/ChoixTypeMateriel'
import ChoixPretable from '@/components/ChoixPretable'
import CoutUnitaire from '@/components/CoutUnitaire'
import toast from 'react-hot-toast'
import Can from '@/components/Can'
import { BoutonEtiquettesQr } from '@/components/QrLabelsModal'

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
    status: 'active',
    isPrestation: null as boolean | null,
    materialType: 'unique' as 'unique' | 'lot',
    quantityTotal: 0,
    unitCost: 0,
    availableForManifestations: null as boolean | null
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

  /**
   * Récupérer la sous-catégorie, **dans sa catégorie**.
   *
   * Le slug n'est unique que dans une catégorie : « Technique › Prestations » et
   * « Urbanisme › Prestations » en portent le même. Chercher par le seul slug
   * rendait la première venue, et les deux écrans montraient le même matériel.
   * La clé de cache porte les deux slugs pour la même raison.
   */
  const { data: subcategory, isLoading, error } = useQuery({
    queryKey: ['subcategory', categorySlug, subcategorySlug],
    queryFn: async () => {
      const response = await api.get(`/categories/${categorySlug}/${subcategorySlug}`)
      return response.data.subcategory as Subcategory
    },
    enabled: !!categorySlug && !!subcategorySlug
  })

  // Récupérer les objets de la sous-catégorie, page par page
  const {
    objets: objects,
    total: totalObjets,
    resteAPager,
    chargerSuite,
    chargementSuite,
    isLoading: objectsLoading,
  } = usePaginatedObjects({
    subcategoryId: subcategory?.id,
    search,
    enabled: !!subcategory?.id,
  })

  /**
   * Cette branche du parc contient-elle des prestations ?
   *
   * Le plus précis l'emporte : la sous-catégorie si elle a tranché, sinon la
   * catégorie. Sert de valeur héritée dans le formulaire et décide de ce que
   * l'écran a encore du sens à proposer.
   */
  const estBranchePrestation = Boolean(subcategory?.isPrestation ?? category?.isPrestation)

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
      queryClient.invalidateQueries({ queryKey: ['subcategory', categorySlug, subcategorySlug] })
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
      queryClient.invalidateQueries({ queryKey: ['subcategory', categorySlug, subcategorySlug] })
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
        status: obj.status || 'active',
        isPrestation: obj.isPrestation ?? null,
        materialType: obj.materialType ?? 'unique',
        quantityTotal: obj.quantityTotal ?? 0,
        unitCost: obj.unitCost ?? 0,
        availableForManifestations: obj.availableForManifestations ?? null
      })
    } else {
      setEditingObject(null)
      setFormData({ name: '', description: '', image: '', status: 'active', isPrestation: null, materialType: 'unique', quantityTotal: 0, unitCost: 0, availableForManifestations: null })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingObject(null)
    setFormData({ name: '', description: '', image: '', status: 'active', isPrestation: null, materialType: 'unique', quantityTotal: 0, unitCost: 0, availableForManifestations: null })
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
        <Link to="/categories" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          Catégories
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <Link to={`/categories/${categorySlug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          {category?.name}
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 dark:text-gray-100 font-medium">{subcategory.name}</span>
      </nav>

      {/* En-tête */}
      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {/* Image */}
            <div className="w-32 h-32 bg-gray-100 dark:bg-gray-700 rounded-xl flex-shrink-0 overflow-hidden">
              {subcategory.image ? (
                <img 
                  src={subcategory.image} 
                  alt={subcategory.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
                  <Package className="w-12 h-12" />
                </div>
              )}
            </div>

            {/* Infos */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{subcategory.name}</h1>
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
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
                    title="Configurer les champs spécifiques à cette sous-catégorie (ex: champs différents pour tronçonneuses vs tondeuses)"
                  >
                    <Settings2 className="w-4 h-4 mr-1" />
                    <span className="hidden sm:inline">Champs</span>
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
        {/* Étiquetage d'un lot de matériels : la génération existait côté
            serveur sans aucun écran pour l'appeler. */}
        {/* Une étiquette QR se colle sur un objet. Un raccordement électrique
            n'a rien où la coller : le bouton disparaît plutôt que d'imprimer
            une planche que personne ne saura quoi en faire. */}
        {!estBranchePrestation && (
          <BoutonEtiquettesQr materiels={objects} titre={subcategory?.name} />
        )}
        <Can manage>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
            Nouveau matériel
          </Button>
        </Can>
      </div>

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

              {(obj.prestation ?? estBranchePrestation) ? (
                <BadgePrestation className="absolute bottom-2 left-2 shadow-sm" />
              ) : obj.nature === 'lot' ? (
                <BadgeLot quantite={obj.quantityTotal} className="absolute bottom-2 left-2 shadow-sm" />
              ) : null}

              {/* Actions au survol */}
              <Can manage>
                <div className="hover-reveal absolute top-2 right-2 flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openModal(obj)
                    }}
                    aria-label={`Modifier ${obj.name}`}
                    title="Modifier"
                    className="p-2 bg-white dark:bg-gray-700 rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    <Edit2 className="w-4 h-4 text-gray-600 dark:text-gray-200" />
                  </button>
                  <Can admin>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(obj)
                      }}
                      aria-label={`Supprimer ${obj.name}`}
                      title="Supprimer"
                      className="p-2 bg-white dark:bg-gray-700 rounded-lg shadow-md hover:bg-red-50 dark:hover:bg-red-900/40"
                    >
                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </button>
                  </Can>
                </div>
              </Can>
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

            {/* Un lot n'a ni carburant ni contrôle technique — ces suivis
                portent sur un exemplaire — mais garde ses entretiens. La
                question ne se pose pas pour une prestation, qui n'a rien à
                stocker. */}
            {!(formData.isPrestation ?? estBranchePrestation) && (
              <ChoixTypeMateriel
                type={formData.materialType}
                quantite={formData.quantityTotal}
                onChangeType={(materialType) => setFormData({ ...formData, materialType })}
                onChangeQuantite={(quantityTotal) => setFormData({ ...formData, quantityTotal })}
              />
            )}

            {/*
              L'exception au réglage de la branche. La sous-catégorie suffit dans
              la plupart des cas — « Urbanisme › Prestation » — mais un article
              isolé doit pouvoir démentir sa branche sans qu'on ait à lui en
              créer une pour lui seul.
            */}
            <ChoixPrestation
              valeur={formData.isPrestation}
              onChange={(isPrestation) => setFormData({ ...formData, isPrestation })}
              heriteDe={{ prestation: estBranchePrestation, source: 'sa sous-catégorie' }}
              aide="Une prestation ne se stocke pas et n’immobilise rien : elle est demandée, puis réalisée."
            />

            {/* La question se pose ici, au moment où l'on crée le matériel :
                on sait alors si le réfrigérateur part pour la brocante et si le
                grill reste à la cuisine. La régler ailleurs, plus tard, c'est ne
                jamais la régler. */}
            <ChoixPretable
              valeur={formData.availableForManifestations}
              onChange={(availableForManifestations) =>
                setFormData({ ...formData, availableForManifestations })
              }
              heriteDe={{ pretable: true, source: 'sa sous-catégorie' }}
            />

            <CoutUnitaire
              valeur={formData.unitCost}
              nature={
                (formData.isPrestation ?? estBranchePrestation)
                  ? 'prestation'
                  : formData.materialType === 'lot'
                    ? 'lot'
                    : 'unique'
              }
              onChange={(unitCost) => setFormData({ ...formData, unitCost })}
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
          <p className="text-gray-600 dark:text-gray-300">
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
