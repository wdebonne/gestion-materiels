import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PartyPopper, Plus, Search, Package, Archive, FileDown, Truck, RotateCcw,
  Check, X, Edit, Trash2, Eye, ChevronDown, ChevronUp, Filter, Calendar, MapPin, Tag
} from 'lucide-react'
import {
  Button, Input, Select, Modal, ModalBody, ModalFooter,
  Card, CardBody, CardHeader, CardTitle, Badge, Alert, Tabs, Tab, TextArea
} from '@/components/ui'
import { useAuthStore } from '@/stores/auth.store'
import api from '@/lib/api'
import {
  manifestationApi,
  type Manifestation,
  type ManifestationStockItem as StockItem,
  type ManifestationMaterial as ManifMaterial
} from '@/lib/api'
import toast from 'react-hot-toast'

// ==================== CONSTANTES ====================

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
  cancelled: 'Annulée'
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  validated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  delivered: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  recovered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  archived: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
}

const statusActions: Record<string, { next: string; label: string; icon: any; color: string }[]> = {
  draft: [
    { next: 'validated', label: 'Valider', icon: Check, color: 'text-blue-600' },
    { next: 'cancelled', label: 'Annuler', icon: X, color: 'text-red-600' }
  ],
  validated: [
    { next: 'delivered', label: 'Marquer livrée', icon: Truck, color: 'text-yellow-600' },
    { next: 'cancelled', label: 'Annuler', icon: X, color: 'text-red-600' }
  ],
  delivered: [
    { next: 'recovered', label: 'Matériel récupéré', icon: RotateCcw, color: 'text-green-600' }
  ],
  recovered: [
    { next: 'archived', label: 'Archiver', icon: Archive, color: 'text-purple-600' }
  ],
  cancelled: [
    { next: 'draft', label: 'Remettre en brouillon', icon: Edit, color: 'text-gray-600' }
  ],
  archived: []
}

const emptyForm = {
  title: '', date_start: new Date().toISOString().split('T')[0], date_end: '',
  start_time: '', end_time: '', expected_people: 0,
  contact_name: '', contact_phone: '', contact_email: '',
  delivery_address: '', delivery_date: '',
  notes_interior: '', notes_exterior: '', materials: [] as ManifMaterial[]
}

const emptyStockForm = { name: '', description: '', category: '', quantity_total: 0, unit: 'unité', etat: 'bon', lieu: '', stock_type: '', price: 0, category_id: null as number | null, subcategory_id: null as number | null }

const etatOptions = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'bon', label: 'Bon état' },
  { value: 'usage', label: 'Usé' },
  { value: 'a_reparer', label: 'À réparer' },
  { value: 'hors_service', label: 'Hors service' }
]

const etatColors: Record<string, string> = {
  neuf: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  bon: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  usage: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  a_reparer: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  hors_service: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
}

// ==================== COMPOSANT PRINCIPAL ====================

export default function ManifestationsPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isSupervisor = user?.role === 'admin' || user?.role === 'supervisor'
  const [activeTab, setActiveTab] = useState('manifestations')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showArchived, _setShowArchived] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Modales
  const [showManifModal, setShowManifModal] = useState(false)
  const [showStockModal, setShowStockModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<Manifestation | null>(null)
  const [showDeliveryModal, setShowDeliveryModal] = useState<Manifestation | null>(null)
  const [editingManif, setEditingManif] = useState<Manifestation | null>(null)
  const [editingStock, setEditingStock] = useState<StockItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: number; name: string } | null>(null)

  // Formulaires
  const [manifForm, setManifForm] = useState(emptyForm)
  const [stockForm, setStockForm] = useState(emptyStockForm)
  const [showFilters, setShowFilters] = useState(false)

  // ==================== QUERIES ====================

  const { data: manifestations = [], isLoading } = useQuery({
    queryKey: ['manifestations', statusFilter, search, showArchived, dateFrom, dateTo],
    queryFn: async () => {
      const res = await manifestationApi.getAll({
        status: statusFilter || undefined,
        search: search || undefined,
        archived: showArchived || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      })
      return res.data.data
    }
  })

  const { data: stock = [], isLoading: stockLoading } = useQuery({
    queryKey: ['manifestation-stock'],
    queryFn: async () => {
      const res = await manifestationApi.getStock()
      return res.data.data
    }
  })

  const { data: stockCategories = [] } = useQuery({
    queryKey: ['manifestation-stock-categories'],
    queryFn: async () => {
      const res = await manifestationApi.getStockCategories()
      return res.data.data
    }
  })

  const { data: stockEtats = [] } = useQuery({
    queryKey: ['manifestation-stock-etats'],
    queryFn: async () => {
      const res = await manifestationApi.getStockEtats()
      return res.data.data
    }
  })

  const { data: stockLieux = [] } = useQuery({
    queryKey: ['manifestation-stock-lieux'],
    queryFn: async () => {
      const res = await manifestationApi.getStockLieux()
      return res.data.data
    }
  })

  const { data: stockTypes = [] } = useQuery({
    queryKey: ['manifestation-stock-types'],
    queryFn: async () => {
      const res = await manifestationApi.getStockTypes()
      return res.data.data
    }
  })

  const { data: objectCategories = [] } = useQuery({
    queryKey: ['categories-list'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return res.data.categories || res.data.data || []
    }
  })

  const [selectedCatForSub, setSelectedCatForSub] = useState<number | null>(null)

  const { data: objectSubcategories = [] } = useQuery({
    queryKey: ['subcategories-list', selectedCatForSub],
    queryFn: async () => {
      if (!selectedCatForSub) return []
      const res = await api.get(`/categories/${selectedCatForSub}/subcategories`)
      return res.data.subcategories || res.data.data || []
    },
    enabled: !!selectedCatForSub
  })

  const { data: stats } = useQuery({
    queryKey: ['manifestation-stats'],
    queryFn: async () => {
      const res = await manifestationApi.getStats()
      return res.data.data
    }
  })

  // ==================== MUTATIONS ====================

  const createManifMutation = useMutation({
    mutationFn: (data: any) => editingManif
      ? manifestationApi.update(editingManif.id, data)
      : manifestationApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stats'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
      setShowManifModal(false)
      setEditingManif(null)
      setManifForm(emptyForm)
      toast.success(editingManif ? 'Manifestation modifiée' : 'Manifestation créée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      manifestationApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stats'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
      toast.success('Statut mis à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const updateMaterialsMutation = useMutation({
    mutationFn: ({ id, materials }: { id: number; materials: any[] }) =>
      manifestationApi.updateMaterials(id, materials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
      setShowDeliveryModal(null)
      toast.success('Matériel mis à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const deleteManifMutation = useMutation({
    mutationFn: (id: number) => manifestationApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stats'] })
      setDeleteConfirm(null)
      toast.success('Manifestation supprimée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const createStockMutation = useMutation({
    mutationFn: (data: any) => editingStock
      ? manifestationApi.updateStock(editingStock.id, data)
      : manifestationApi.createStock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock-categories'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock-etats'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock-lieux'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock-types'] })
      setShowStockModal(false)
      setEditingStock(null)
      setStockForm(emptyStockForm)
      toast.success(editingStock ? 'Article modifié' : 'Article créé')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const deleteStockMutation = useMutation({
    mutationFn: (id: number) => manifestationApi.deleteStock(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
      setDeleteConfirm(null)
      toast.success('Article supprimé')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  // ==================== HANDLERS ====================

  const openEditManif = (m: Manifestation) => {
    setEditingManif(m)
    setManifForm({
      title: m.title, date_start: m.date_start?.split('T')[0] || '',
      date_end: m.date_end?.split('T')[0] || '', start_time: m.start_time || '',
      end_time: m.end_time || '', expected_people: m.expected_people || 0,
      contact_name: m.contact_name || '', contact_phone: m.contact_phone || '',
      contact_email: m.contact_email || '', delivery_address: m.delivery_address || '',
      delivery_date: m.delivery_date?.split('T')[0] || '',
      notes_interior: m.notes_interior || '', notes_exterior: m.notes_exterior || '',
      materials: m.materials?.map(mat => ({
        stock_id: mat.stock_id, quantity_requested: mat.quantity_requested,
        quantity_delivered: mat.quantity_delivered, quantity_recovered: mat.quantity_recovered,
        unit_value: mat.unit_value, notes: mat.notes || '',
        stock_name: mat.stock_name, unit: mat.unit
      })) || []
    })
    setShowManifModal(true)
  }

  const openEditStock = (s: StockItem) => {
    setEditingStock(s)
    setStockForm({
      name: s.name, description: s.description || '', category: s.category || '',
      quantity_total: s.quantity_total, unit: s.unit || 'unité',
      etat: s.etat || 'bon', lieu: s.lieu || '', stock_type: s.stock_type || '',
      price: s.price || 0, category_id: s.category_id || null, subcategory_id: s.subcategory_id || null
    })
    if (s.category_id) setSelectedCatForSub(s.category_id)
    setShowStockModal(true)
  }

  const addMaterial = () => {
    if (stock.length === 0) return
    setManifForm({
      ...manifForm,
      materials: [...manifForm.materials, {
        stock_id: stock[0].id, quantity_requested: 1, quantity_delivered: 0,
        quantity_recovered: 0, unit_value: 0, notes: ''
      }]
    })
  }

  const removeMaterial = (idx: number) => {
    setManifForm({
      ...manifForm,
      materials: manifForm.materials.filter((_, i) => i !== idx)
    })
  }

  const updateMaterial = (idx: number, field: string, value: any) => {
    const updated = [...manifForm.materials]
    updated[idx] = { ...updated[idx], [field]: value }
    setManifForm({ ...manifForm, materials: updated })
  }

  const handleExportPDF = async () => {
    try {
      const p = new URLSearchParams()
      if (statusFilter) p.append('status', statusFilter)
      if (showArchived) p.append('archived', 'true')
      if (dateFrom) p.append('date_from', dateFrom)
      if (dateTo) p.append('date_to', dateTo)

      // Générer le contenu côté client et imprimer
      window.print()
    } catch {
      toast.error('Erreur lors de l\'export')
    }
  }

  // ==================== RENDU ====================

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <PartyPopper className="w-7 h-7 text-primary-600" />
            Manifestations
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Gestion des manifestations et prêt de matériel
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<FileDown className="w-4 h-4" />} onClick={handleExportPDF}>
            Export PDF
          </Button>
          {isSupervisor && activeTab === 'stock' && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setEditingStock(null); setStockForm(emptyStockForm); setShowStockModal(true) }}>
              Ajouter au stock
            </Button>
          )}
          {isSupervisor && activeTab === 'manifestations' && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setEditingManif(null); setManifForm(emptyForm); setShowManifModal(true) }}>
              Nouvelle manifestation
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">En cours</div>
          </CardBody></Card>
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-blue-600">{stats.upcoming}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">À venir</div>
          </CardBody></Card>
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-yellow-600">{stats.delivered}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Livré</div>
          </CardBody></Card>
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-purple-600">{stats.archived}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Archivées</div>
          </CardBody></Card>
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-green-600">{stats.stockItems}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Articles stock</div>
          </CardBody></Card>
        </div>
      )}

      {/* Onglets */}
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tab value="manifestations" label="Manifestations" icon={<PartyPopper className="w-4 h-4" />} />
        <Tab value="stock" label="Stock matériel" icon={<Package className="w-4 h-4" />} />
        <Tab value="archives" label="Archives" icon={<Archive className="w-4 h-4" />} />
      </Tabs>

      {/* Contenu des onglets */}
      {activeTab === 'manifestations' && (
        <ManifestationsTab
          manifestations={manifestations} isLoading={isLoading} isSupervisor={isSupervisor}
          search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          showFilters={showFilters} setShowFilters={setShowFilters}
          dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
          onEdit={openEditManif} onView={setShowDetailModal} onDelivery={setShowDeliveryModal}
          onStatusChange={(id: number, status: string) => statusMutation.mutate({ id, status })}
          onDelete={(id: number, name: string) => setDeleteConfirm({ type: 'manif', id, name })}
        />
      )}

      {activeTab === 'stock' && (
        <StockTab
          stock={stock} isLoading={stockLoading} isSupervisor={isSupervisor}
          categories={stockCategories} etats={stockEtats} lieux={stockLieux} types={stockTypes}
          onEdit={openEditStock}
          onDelete={(id: number, name: string) => setDeleteConfirm({ type: 'stock', id, name })}
        />
      )}

      {activeTab === 'archives' && (
        <ArchivesTab />
      )}

      {/* ==================== MODALES ==================== */}

      {/* Modale création/édition manifestation */}
      <Modal
        isOpen={showManifModal}
        onClose={() => { setShowManifModal(false); setEditingManif(null) }}
        title={editingManif ? 'Modifier la manifestation' : 'Nouvelle manifestation'}
        size="xl"
      >
        <ModalBody>
          <div className="space-y-6">
            {/* Titre */}
            <Input label="Titre de la manifestation *" value={manifForm.title}
              onChange={e => setManifForm({ ...manifForm, title: e.target.value })} placeholder="Ex: Fête de la musique" />

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Date début *" type="date" value={manifForm.date_start}
                onChange={e => setManifForm({ ...manifForm, date_start: e.target.value })} />
              <Input label="Date fin" type="date" value={manifForm.date_end}
                onChange={e => setManifForm({ ...manifForm, date_end: e.target.value })} />
            </div>

            {/* Contact livraison */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Contact livraison</CardTitle></CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input label="Nom du contact" value={manifForm.contact_name}
                    onChange={e => setManifForm({ ...manifForm, contact_name: e.target.value })} />
                  <Input
                type="tel" label="Téléphone" value={manifForm.contact_phone}
                    onChange={e => setManifForm({ ...manifForm, contact_phone: e.target.value })} />
                </div>
                <Input label="Email" type="email" value={manifForm.contact_email}
                  onChange={e => setManifForm({ ...manifForm, contact_email: e.target.value })} />
                <Input label="Adresse de livraison" value={manifForm.delivery_address}
                  onChange={e => setManifForm({ ...manifForm, delivery_address: e.target.value })} />
                <Input label="Date de livraison" type="date" value={manifForm.delivery_date}
                  onChange={e => setManifForm({ ...manifForm, delivery_date: e.target.value })} />
              </CardBody>
            </Card>

            {/* Matériel demandé */}
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-sm">Matériel demandé</CardTitle>
                  <Button size="sm" variant="outline" icon={<Plus className="w-3 h-3" />} onClick={addMaterial}>
                    Ajouter
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                {/* Filtres de sélection de matériel */}
                <MaterialFilter stock={stock} stockCategories={stockCategories} stockTypes={stockTypes}
                  materials={manifForm.materials}
                  onAdd={(stockId: number) => {
                    setManifForm({
                      ...manifForm,
                      materials: [...manifForm.materials, {
                        stock_id: stockId, quantity_requested: 1, quantity_delivered: 0,
                        quantity_recovered: 0, unit_value: 0, notes: ''
                      }]
                    })
                  }}
                />

                {manifForm.materials.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Aucun matériel ajouté</p>
                ) : (
                  <div className="space-y-3 mt-3">
                    {manifForm.materials.map((mat, idx) => {
                      const stockItem = stock.find((s: StockItem) => s.id === mat.stock_id)
                      return (
                      <div key={idx} className="flex items-end gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex-1">
                          <Select label="Article" value={String(mat.stock_id)}
                            onChange={e => updateMaterial(idx, 'stock_id', parseInt(e.target.value))}
                            options={stock.map((s: StockItem) => ({ value: s.id, label: `${s.name} (dispo: ${s.quantity_available} ${s.unit})` }))} />
                          {stockItem && (
                            <div className="flex gap-2 mt-1 flex-wrap">
                              {stockItem.etat && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${etatColors[stockItem.etat] || 'bg-gray-100 text-gray-600'}`}>{etatOptions.find(e => e.value === stockItem.etat)?.label || stockItem.etat}</span>}
                              {stockItem.lieu && <span className="text-[10px] text-gray-500 dark:text-gray-400"><MapPin className="w-2.5 h-2.5 inline mr-0.5" />{stockItem.lieu}</span>}
                              {stockItem.stock_type && <span className="text-[10px] text-gray-500 dark:text-gray-400"><Tag className="w-2.5 h-2.5 inline mr-0.5" />{stockItem.stock_type}</span>}
                            </div>
                          )}
                        </div>
                        <div className="w-24">
                          <Input label="Qté" type="number"
                inputMode="numeric" value={String(mat.quantity_requested)}
                            onChange={e => updateMaterial(idx, 'quantity_requested', parseInt(e.target.value) || 0)} />
                        </div>
                        <div className="w-28">
                          <Input label="Val. unit. TTC" type="number"
                inputMode="numeric" value={String(mat.unit_value)}
                            onChange={e => updateMaterial(idx, 'unit_value', parseFloat(e.target.value) || 0)} />
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => removeMaterial(idx)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    )})}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => { setShowManifModal(false); setEditingManif(null) }}>Annuler</Button>
          <Button loading={createManifMutation.isPending}
            onClick={() => createManifMutation.mutate(manifForm)}>
            {editingManif ? 'Modifier' : 'Créer'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modale création/édition stock */}
      <Modal isOpen={showStockModal} onClose={() => { setShowStockModal(false); setEditingStock(null) }}
        title={editingStock ? 'Modifier l\'article' : 'Nouvel article de stock'} size="xl">
        <ModalBody>
          <div className="space-y-4">
            <Input label="Nom *" value={stockForm.name}
              onChange={e => setStockForm({ ...stockForm, name: e.target.value })} placeholder="Ex: Tables pliantes" />
            <Input label="Description" value={stockForm.description}
              onChange={e => setStockForm({ ...stockForm, description: e.target.value })} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Catégorie (stock)" value={stockForm.category}
                onChange={e => setStockForm({ ...stockForm, category: e.target.value })} placeholder="Ex: Mobilier"
                list="stock-categories" />
              <Input label="Unité" value={stockForm.unit}
                onChange={e => setStockForm({ ...stockForm, unit: e.target.value })} placeholder="unité" />
            </div>
            <datalist id="stock-categories">
              {stockCategories.map((c: string) => <option key={c} value={c} />)}
            </datalist>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Quantité totale *" type="number"
                inputMode="numeric" value={String(stockForm.quantity_total)}
                onChange={e => setStockForm({ ...stockForm, quantity_total: parseInt(e.target.value) || 0 })} />
              <Input label="Prix unitaire (€)" type="number"
                inputMode="numeric" value={String(stockForm.price)}
                onChange={e => setStockForm({ ...stockForm, price: parseFloat(e.target.value) || 0 })}
                placeholder="0.00" />
            </div>

            {/* Champs personnalisés */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Propriétés de l'article</CardTitle></CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select label="État" value={stockForm.etat || 'bon'}
                    onChange={e => setStockForm({ ...stockForm, etat: e.target.value })}
                    options={etatOptions} />
                  <Input label="Lieu de stockage" value={stockForm.lieu || ''}
                    onChange={e => setStockForm({ ...stockForm, lieu: e.target.value })}
                    placeholder="Ex: Entrepôt A, Salle 12" list="stock-lieux" />
                </div>
                <datalist id="stock-lieux">
                  {stockLieux.map((l: string) => <option key={l} value={l} />)}
                </datalist>
                <div className="grid grid-cols-1 gap-4">
                  <Input label="Type" value={stockForm.stock_type || ''}
                    onChange={e => setStockForm({ ...stockForm, stock_type: e.target.value })}
                    placeholder="Ex: Sonorisation, Éclairage, Décoration" list="stock-types" />
                </div>
                <datalist id="stock-types">
                  {stockTypes.map((t: string) => <option key={t} value={t} />)}
                </datalist>
              </CardBody>
            </Card>

            {/* Filtrer par catégorie/sous-catégorie du matériel principal */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Lier à une catégorie de matériel</CardTitle></CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Associer cet article à une catégorie ou sous-catégorie existante pour filtrer le matériel disponible.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select label="Catégorie" value={String(stockForm.category_id || '')}
                    onChange={e => {
                      const val = e.target.value ? parseInt(e.target.value) : null
                      setStockForm({ ...stockForm, category_id: val, subcategory_id: null })
                      setSelectedCatForSub(val)
                    }}
                    options={[{ value: '', label: '— Aucune —' }, ...objectCategories.map((c: any) => ({ value: c.id, label: c.name }))]} />
                  {selectedCatForSub && objectSubcategories.length > 0 && (
                    <Select label="Sous-catégorie" value={String(stockForm.subcategory_id || '')}
                      onChange={e => setStockForm({ ...stockForm, subcategory_id: e.target.value ? parseInt(e.target.value) : null })}
                      options={[{ value: '', label: '— Aucune —' }, ...objectSubcategories.map((sc: any) => ({ value: sc.id, label: sc.name }))]} />
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => { setShowStockModal(false); setEditingStock(null) }}>Annuler</Button>
          <Button loading={createStockMutation.isPending}
            onClick={() => createStockMutation.mutate(stockForm)}>
            {editingStock ? 'Modifier' : 'Créer'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modale détail */}
      {showDetailModal && (
        <ManifDetailModal manif={showDetailModal} onClose={() => setShowDetailModal(null)} />
      )}

      {/* Modale gestion livraison / récupération */}
      {showDeliveryModal && (
        <DeliveryModal
          manif={showDeliveryModal}
          onClose={() => setShowDeliveryModal(null)}
          onSave={(materials) => updateMaterialsMutation.mutate({ id: showDeliveryModal.id, materials })}
          loading={updateMaterialsMutation.isPending}
        />
      )}

      {/* Modale de confirmation de suppression */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Confirmer la suppression">
        <ModalBody>
          <p className="text-gray-700 dark:text-gray-300">
            Voulez-vous vraiment supprimer <strong>{deleteConfirm?.name}</strong> ?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Annuler</Button>
          <Button variant="danger"
            loading={deleteManifMutation.isPending || deleteStockMutation.isPending}
            onClick={() => {
              if (deleteConfirm?.type === 'manif') deleteManifMutation.mutate(deleteConfirm.id)
              else if (deleteConfirm?.type === 'stock') deleteStockMutation.mutate(deleteConfirm.id)
            }}>
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

// ==================== FILTRE MATÉRIEL ====================

function MaterialFilter({ stock, stockCategories, stockTypes, materials, onAdd }: {
  stock: StockItem[]; stockCategories: string[]; stockTypes: string[]
  materials: ManifMaterial[]; onAdd: (stockId: number) => void
}) {
  const [filterCat, setFilterCat] = useState('')
  const [filterType, setFilterType] = useState('')

  const alreadySelected = new Set(materials.map(m => m.stock_id))
  const filtered = stock.filter((s: StockItem) => {
    if (alreadySelected.has(s.id)) return false
    if (filterCat && s.category !== filterCat) return false
    if (filterType && s.stock_type !== filterType) return false
    return true
  })

  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 space-y-2">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Filtrer le matériel disponible</p>
      <div className="flex flex-wrap gap-2">
        {stockCategories.length > 0 && (
          <Select value={filterCat} onChange={(e: any) => setFilterCat(e.target.value)}
            options={[{ value: '', label: 'Toutes catégories' }, ...stockCategories.map(c => ({ value: c, label: c }))]} />
        )}
        {stockTypes.length > 0 && (
          <Select value={filterType} onChange={(e: any) => setFilterType(e.target.value)}
            options={[{ value: '', label: 'Tous types' }, ...stockTypes.map(t => ({ value: t, label: t }))]} />
        )}
      </div>
      {(filterCat || filterType) && filtered.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {filtered.slice(0, 20).map(s => (
            <button key={s.id} onClick={() => onAdd(s.id)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border border-gray-300 dark:border-gray-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 transition-colors">
              <Plus className="w-3 h-3" />
              {s.name} <span className="text-gray-600 dark:text-gray-300">({s.quantity_available} {s.unit})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== ONGLET MANIFESTATIONS ====================

function ManifestationsTab({
  manifestations, isLoading, isSupervisor, search, setSearch,
  statusFilter, setStatusFilter, showFilters, setShowFilters,
  dateFrom, setDateFrom, dateTo, setDateTo,
  onEdit, onView, onDelivery, onStatusChange, onDelete
}: any) {
  return (
    <div className="space-y-4">
      {/* Barre de recherche et filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
            placeholder="Rechercher une manifestation..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          options={[
            { value: '', label: 'Tous les statuts' },
            ...Object.entries(statusLabels).filter(([k]) => k !== 'archived').map(([value, label]) => ({ value, label }))
          ]} />
        <Button variant="outline" size="sm" icon={<Filter className="w-4 h-4" />}
          onClick={() => setShowFilters(!showFilters)}>
          Filtres
        </Button>
      </div>

      {showFilters && (
        <Card><CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Date début" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <Input label="Date fin" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </CardBody></Card>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Chargement...</div>
      ) : manifestations.length === 0 ? (
        <Card><CardBody className="text-center py-12 text-gray-500 dark:text-gray-400">
          Aucune manifestation trouvée
        </CardBody></Card>
      ) : (
        <div className="space-y-3">
          {manifestations.map((m: Manifestation) => (
            <ManifCard key={m.id} manif={m} isSupervisor={isSupervisor}
              onEdit={onEdit} onView={onView} onDelivery={onDelivery}
              onStatusChange={onStatusChange} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== CARTE MANIFESTATION ====================

function ManifCard({ manif: m, isSupervisor, onEdit, onView, onDelivery, onStatusChange, onDelete }: any) {
  const [expanded, setExpanded] = useState(false)
  const formatD = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : ''

  const totalRequested = m.materials?.reduce((s: number, mat: ManifMaterial) => s + mat.quantity_requested, 0) || 0
  const totalDelivered = m.materials?.reduce((s: number, mat: ManifMaterial) => s + mat.quantity_delivered, 0) || 0
  const totalRecovered = m.materials?.reduce((s: number, mat: ManifMaterial) => s + mat.quantity_recovered, 0) || 0

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardBody className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{m.title}</h3>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[m.status]}`}>
                {statusLabels[m.status]}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatD(m.date_start)}{m.date_end ? ` → ${formatD(m.date_end)}` : ''}
              </span>
              {m.contact_name && <span>Contact: {m.contact_name}</span>}
              {m.expected_people > 0 && <span>{m.expected_people} pers.</span>}
            </div>
            {m.materials?.length > 0 && (
              <div className="flex gap-4 mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>Demandé: <strong>{totalRequested}</strong></span>
                <span>Livré: <strong className="text-yellow-600">{totalDelivered}</strong></span>
                <span>Récupéré: <strong className="text-green-600">{totalRecovered}</strong></span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => onView(m)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Voir détails" aria-label="Voir détails">
              <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
            {isSupervisor && m.status !== 'archived' && (
              <>
                {(m.status === 'delivered' || m.status === 'validated') && (
                  <button onClick={() => onDelivery(m)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Gérer matériel" aria-label="Gérer matériel">
                    <Truck className="w-4 h-4 text-yellow-600" />
                  </button>
                )}
                {m.status !== 'delivered' && m.status !== 'recovered' && (
                  <button onClick={() => onEdit(m)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Modifier" aria-label="Modifier">
                    <Edit className="w-4 h-4 text-blue-600" />
                  </button>
                )}
                {statusActions[m.status]?.map((action: any) => (
                  <button aria-label={action.label} key={action.next} onClick={() => onStatusChange(m.id, action.next)}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title={action.label}>
                    <action.icon className={`w-4 h-4 ${action.color}`} />
                  </button>
                ))}
                {m.status === 'draft' && (
                  <button onClick={() => onDelete(m.id, m.title)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Supprimer" aria-label="Supprimer">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </>
            )}
            <button onClick={() => setExpanded(!expanded)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Matériaux détaillés */}
        {expanded && m.materials?.length > 0 && (
          <div className="mt-3 pt-3 border-t dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 text-xs">
                  <th className="pb-1">Matériel</th>
                  <th className="pb-1 text-center">Demandé</th>
                  <th className="pb-1 text-center">Livré</th>
                  <th className="pb-1 text-center">Récupéré</th>
                  <th className="pb-1 text-right">Val. TTC</th>
                </tr>
              </thead>
              <tbody>
                {m.materials.map((mat: ManifMaterial, i: number) => (
                  <tr key={i} className="border-t dark:border-gray-700">
                    <td className="py-1">{mat.stock_name}</td>
                    <td className="py-1 text-center">{mat.quantity_requested} {mat.unit}</td>
                    <td className="py-1 text-center">{mat.quantity_delivered}</td>
                    <td className="py-1 text-center">{mat.quantity_recovered}</td>
                    <td className="py-1 text-right">{mat.unit_value ? `${(mat.unit_value * mat.quantity_requested).toFixed(2)} €` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ==================== ONGLET STOCK ====================

function StockTab({ stock, isLoading, isSupervisor, categories, etats, lieux, types, onEdit, onDelete }: any) {
  const [catFilter, setCatFilter] = useState('')
  const [etatFilter, setEtatFilter] = useState('')
  const [lieuFilter, setLieuFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [searchStock, setSearchStock] = useState('')

  const filtered = stock.filter((s: StockItem) => {
    if (catFilter && s.category !== catFilter) return false
    if (etatFilter && s.etat !== etatFilter) return false
    if (lieuFilter && s.lieu !== lieuFilter) return false
    if (typeFilter && s.stock_type !== typeFilter) return false
    if (searchStock && !s.name.toLowerCase().includes(searchStock.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
            placeholder="Rechercher un article..." value={searchStock} onChange={e => setSearchStock(e.target.value)} />
        </div>
        {categories.length > 0 && (
          <Select value={catFilter} onChange={(e: any) => setCatFilter(e.target.value)}
            options={[{ value: '', label: 'Toutes catégories' }, ...categories.map((c: string) => ({ value: c, label: c }))]} />
        )}
      </div>

      {/* Filtres avancés */}
      <div className="flex flex-wrap gap-2">
        {etats.length > 0 && (
          <Select value={etatFilter} onChange={(e: any) => setEtatFilter(e.target.value)}
            options={[{ value: '', label: 'Tous états' }, ...etatOptions.map(e => ({ value: e.value, label: e.label }))]} />
        )}
        {lieux.length > 0 && (
          <Select value={lieuFilter} onChange={(e: any) => setLieuFilter(e.target.value)}
            options={[{ value: '', label: 'Tous lieux' }, ...lieux.map((l: string) => ({ value: l, label: l }))]} />
        )}
        {types.length > 0 && (
          <Select value={typeFilter} onChange={(e: any) => setTypeFilter(e.target.value)}
            options={[{ value: '', label: 'Tous types' }, ...types.map((t: string) => ({ value: t, label: t }))]} />
        )}
        {(etatFilter || lieuFilter || typeFilter) && (
          <Button size="sm" variant="ghost" onClick={() => { setEtatFilter(''); setLieuFilter(''); setTypeFilter('') }}>
            <X className="w-3 h-3 mr-1" /> Réinitialiser
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Chargement...</div>
      ) : filtered.length === 0 ? (
        <Card><CardBody className="text-center py-12 text-gray-500 dark:text-gray-400">
          Aucun article en stock
        </CardBody></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 text-left">
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Article</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Catégorie</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">État</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Lieu</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Type</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">Total</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-right">Prix unit.</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">Disponible</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">En prêt</th>
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">Réservé (futur)</th>
                {isSupervisor && <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: StockItem) => {
                const etatLabel = etatOptions.find(e => e.value === s.etat)?.label || s.etat
                return (
                <tr key={s.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{s.name}</div>
                    {s.description && <div className="text-xs text-gray-500 dark:text-gray-400">{s.description}</div>}
                    {s.category_name && <div className="text-xs text-gray-600 dark:text-gray-300">📁 {s.category_name}{s.subcategory_name ? ` / ${s.subcategory_name}` : ''}</div>}
                  </td>
                  <td className="py-2">
                    {s.category && <Badge variant="default">{s.category}</Badge>}
                  </td>
                  <td className="py-2">
                    {s.etat && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${etatColors[s.etat] || 'bg-gray-100 text-gray-800'}`}>
                      {etatLabel}
                    </span>}
                  </td>
                  <td className="py-2">
                    {s.lieu && <span className="inline-flex items-center text-xs text-gray-600 dark:text-gray-400"><MapPin className="w-3 h-3 mr-1" />{s.lieu}</span>}
                  </td>
                  <td className="py-2">
                    {s.stock_type && <Badge variant="default">{s.stock_type}</Badge>}
                  </td>
                  <td className="py-2 text-center">{s.quantity_total} {s.unit}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-gray-300">{s.price ? `${Number(s.price).toFixed(2)} €` : '—'}</td>
                  <td className="py-2 text-center">
                    <span className={s.quantity_available <= 0 ? 'text-red-600 font-bold' : s.quantity_available < s.quantity_total * 0.2 ? 'text-yellow-600 font-semibold' : 'text-green-600 font-semibold'}>
                      {s.quantity_available}
                    </span>
                  </td>
                  <td className="py-2 text-center text-yellow-600">{s.quantity_lent}</td>
                  <td className="py-2 text-center text-blue-600">{s.quantity_reserved_future}</td>
                  {isSupervisor && (
                    <td className="py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => onEdit(s)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Modifier" aria-label="Modifier">
                          <Edit className="w-4 h-4 text-blue-600" />
                        </button>
                        <button aria-label="Supprimer" onClick={() => onDelete(s.id, s.name)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Supprimer">
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ==================== ONGLET ARCHIVES ====================

function ArchivesTab() {
  const { data: archived = [], isLoading } = useQuery({
    queryKey: ['manifestations', 'archived'],
    queryFn: async () => {
      const res = await manifestationApi.getAll({ archived: true })
      return res.data.data
    }
  })

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Chargement...</div>
  if (archived.length === 0) return <Card><CardBody className="text-center py-12 text-gray-500 dark:text-gray-400">Aucune manifestation archivée</CardBody></Card>

  return (
    <div className="space-y-3">
      {archived.map((m: Manifestation) => {
        const formatD = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : ''
        const totalValue = m.materials?.reduce((s: number, mat: ManifMaterial) => s + (mat.unit_value * mat.quantity_requested), 0) || 0
        return (
          <Card key={m.id} className="opacity-75">
            <CardBody className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300">{m.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatD(m.date_start)}{m.date_end ? ` → ${formatD(m.date_end)}` : ''} • {m.contact_name}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                    {m.materials?.length || 0} articles • Valeur: {totalValue.toFixed(2)} € • Archivée le {formatD(m.archived_at)}
                  </p>
                </div>
                <Badge variant="default">Archivée</Badge>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

// ==================== MODALE DÉTAIL ====================

function ManifDetailModal({ manif: m, onClose }: { manif: Manifestation; onClose: () => void }) {
  const formatD = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : '-'
  const totalValue = m.materials?.reduce((s, mat) => s + (mat.unit_value * mat.quantity_requested), 0) || 0

  return (
    <Modal isOpen onClose={onClose} title={m.title} size="xl">
      <ModalBody>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[m.status]}`}>
              {statusLabels[m.status]}
            </span>
            <span className="text-gray-500 dark:text-gray-400">Créée par {m.created_by_name}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><span className="text-gray-500 dark:text-gray-400 block">Date début</span><strong>{formatD(m.date_start)}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400 block">Date fin</span><strong>{formatD(m.date_end)}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400 block">Horaires</span><strong>{m.start_time || '-'} → {m.end_time || '-'}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400 block">Personnes</span><strong>{m.expected_people || '-'}</strong></div>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Contact livraison</CardTitle></CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><span className="text-gray-500 dark:text-gray-400">Nom:</span> {m.contact_name || '-'}</div>
                <div><span className="text-gray-500 dark:text-gray-400">Tél:</span> {m.contact_phone || '-'}</div>
                <div><span className="text-gray-500 dark:text-gray-400">Email:</span> {m.contact_email || '-'}</div>
                <div><span className="text-gray-500 dark:text-gray-400">Livraison:</span> {formatD(m.delivery_date)}</div>
                <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">Adresse:</span> {m.delivery_address || '-'}</div>
              </div>
            </CardBody>
          </Card>

          {(m.notes_interior || m.notes_exterior) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {m.notes_interior && (
                <Card><CardHeader><CardTitle className="text-sm">Intérieur</CardTitle></CardHeader>
                  <CardBody><p className="whitespace-pre-wrap">{m.notes_interior}</p></CardBody>
                </Card>
              )}
              {m.notes_exterior && (
                <Card><CardHeader><CardTitle className="text-sm">Extérieur</CardTitle></CardHeader>
                  <CardBody><p className="whitespace-pre-wrap">{m.notes_exterior}</p></CardBody>
                </Card>
              )}
            </div>
          )}

          {m.materials?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Liste du matériel</CardTitle></CardHeader>
              <CardBody>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 text-xs">
                      <th className="pb-1">Matériel</th>
                      <th className="pb-1 text-center">Demandé</th>
                      <th className="pb-1 text-center">Livré</th>
                      <th className="pb-1 text-center">Récupéré</th>
                      <th className="pb-1 text-right">Val. TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.materials.map((mat, i) => (
                      <tr key={i} className="border-b dark:border-gray-700">
                        <td className="py-1.5">{mat.stock_name} <span className="text-gray-600 dark:text-gray-300">({mat.stock_category})</span></td>
                        <td className="py-1.5 text-center">{mat.quantity_requested} {mat.unit}</td>
                        <td className="py-1.5 text-center">{mat.quantity_delivered}</td>
                        <td className="py-1.5 text-center">{mat.quantity_recovered}</td>
                        <td className="py-1.5 text-right">{(mat.unit_value * mat.quantity_requested).toFixed(2)} €</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold border-t-2 dark:border-gray-600">
                      <td className="pt-2">Total</td>
                      <td className="pt-2 text-center">{m.materials.reduce((s, mat) => s + mat.quantity_requested, 0)}</td>
                      <td className="pt-2 text-center">{m.materials.reduce((s, mat) => s + mat.quantity_delivered, 0)}</td>
                      <td className="pt-2 text-center">{m.materials.reduce((s, mat) => s + mat.quantity_recovered, 0)}</td>
                      <td className="pt-2 text-right">{totalValue.toFixed(2)} €</td>
                    </tr>
                  </tfoot>
                </table>
              </CardBody>
            </Card>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Fermer</Button>
      </ModalFooter>
    </Modal>
  )
}

// ==================== MODALE LIVRAISON / RÉCUPÉRATION ====================

function DeliveryModal({ manif, onClose, onSave, loading }: {
  manif: Manifestation; onClose: () => void
  onSave: (materials: any[]) => void; loading: boolean
}) {
  const [materials, setMaterials] = useState(
    manif.materials?.map(m => ({
      id: m.id, stock_name: m.stock_name, unit: m.unit,
      quantity_requested: m.quantity_requested,
      quantity_delivered: m.quantity_delivered,
      quantity_recovered: m.quantity_recovered
    })) || []
  )

  const update = (idx: number, field: string, value: number) => {
    const updated = [...materials]
    updated[idx] = { ...updated[idx], [field]: value }
    setMaterials(updated)
  }

  return (
    <Modal isOpen onClose={onClose} title={`Matériel — ${manif.title}`} size="lg">
      <ModalBody>
        <Alert type="info">
          <span className="text-sm">
            {manif.status === 'validated'
              ? 'Saisissez les quantités livrées pour chaque article.'
              : 'Saisissez les quantités récupérées. Le stock sera mis à jour automatiquement.'}
          </span>
        </Alert>
        <div className="mt-4 space-y-3">
          {materials.map((m, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex-1">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{m.stock_name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(demandé: {m.quantity_requested} {m.unit})</span>
              </div>
              <div className="w-28">
                <Input label="Livré" type="number"
                inputMode="numeric" size="sm" value={String(m.quantity_delivered)}
                  onChange={e => update(i, 'quantity_delivered', parseInt(e.target.value) || 0)} />
              </div>
              <div className="w-28">
                <Input label="Récupéré" type="number"
                inputMode="numeric" size="sm" value={String(m.quantity_recovered)}
                  onChange={e => update(i, 'quantity_recovered', parseInt(e.target.value) || 0)} />
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button loading={loading} onClick={() => onSave(materials)}>Enregistrer</Button>
      </ModalFooter>
    </Modal>
  )
}
