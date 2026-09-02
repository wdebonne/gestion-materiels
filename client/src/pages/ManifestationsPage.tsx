import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  PartyPopper, Plus, Search, Package, Archive, FileDown, Truck, RotateCcw,
  Check, X, Edit, Trash2, Eye, ChevronDown, ChevronUp, ChevronsUpDown, Filter, Calendar, MapPin, Tag
} from 'lucide-react'
import {
  Button, Input, Select, Modal, ModalBody, ModalFooter,
  Card, CardBody, CardHeader, CardTitle, Badge, Alert, Tabs, Tab
} from '@/components/ui'
import { useAuthStore } from '@/stores/auth.store'
import ManifestationPDFExport from '@/components/ManifestationPDFExport'
import ManifestationSuivi from '@/components/ManifestationSuivi'
import ManifestationDocuments from '@/components/ManifestationDocuments'
import ManifestationObjetsParc, { type ObjetChoisi } from '@/components/ManifestationObjetsParc'
import { objetManifestationApi, documentManifestationApi, suiviApi,
  type CoutManifestation,
  type LigneCout,
} from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import api from '@/lib/api'
import {
  manifestationApi,
  type ArticleCatalogue,
  type EtatSortie,
  type LigneSortie,
  type Manifestation,
  type ManifestationStockItem as StockItem,
  type ManifestationMaterial as ManifMaterial,
  type ServiceBref
} from '@/lib/api'
import toast from 'react-hot-toast'

// ==================== CONSTANTES ====================

const statusLabels: Record<string, string> = {
  pending: 'À confirmer',
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
  cancelled: 'Annulée'
}

const statusColors: Record<string, string> = {
  // L'orange distingue au premier coup d'œil une demande reçue d'un formulaire,
  // qui attend une décision, d'un brouillon que la collectivité a elle-même
  // commencé.
  pending: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  validated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  delivered: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  recovered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  archived: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
}

const statusActions: Record<string, { next: string; label: string; icon: any; color: string }[]> = {
  pending: [
    { next: 'validated', label: 'Confirmer', icon: Check, color: 'text-blue-600' },
    { next: 'draft', label: 'Reprendre en brouillon', icon: Edit, color: 'text-gray-600' },
    { next: 'cancelled', label: 'Refuser', icon: X, color: 'text-red-600' }
  ],
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
  delivery_address: '', delivery_date: '', recovery_date: '',
  notes_interior: '', notes_exterior: '', materials: [] as ManifMaterial[],
  objects: [] as ObjetChoisi[]
}

const emptyStockForm = { name: '', description: '', category: '', quantity_total: 0, unit: 'unité', etat: 'bon', lieu: '', stock_type: '', price: 0, category_id: null as number | null, subcategory_id: null as number | null, is_prestation: false
}

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

  const { data: stock = [] } = useQuery({
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

  /**
   * Ce qui bouge le stock bouge aussi le catalogue et les sorties.
   *
   * Les trois lisent les mêmes engagements : n'en rafraîchir qu'un afficherait deux vérités
   * différentes du même écran — un article rendu disponible d'un côté, encore promis de l'autre.
   */
  const rafraichirCatalogue = () => {
    queryClient.invalidateQueries({ queryKey: ['manifestation-stock'] })
    queryClient.invalidateQueries({ queryKey: ['manifestation-catalogue'] })
    queryClient.invalidateQueries({ queryKey: ['manifestation-sorties'] })
  }

  const createManifMutation = useMutation({
    mutationFn: (data: any) => editingManif
      ? manifestationApi.update(editingManif.id, data)
      : manifestationApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stats'] })
      rafraichirCatalogue()
      setShowManifModal(false)
      setEditingManif(null)
      setManifForm(emptyForm)
      toast.success(editingManif ? 'Manifestation modifiée' : 'Manifestation créée')

      // Avertissement, jamais refus : la demande est enregistrée telle qu'elle a
      // été formulée, et le manque est dit pour être arbitré.
      const conflits = res.data.conflits ?? []
      if (conflits.length > 0) {
        toast(
          `Stock insuffisant sur la période : ${conflits
            .map(c => `${c.stock_name} (${c.manquant} manquant${c.manquant > 1 ? 's' : ''})`)
            .join(', ')}`,
          { icon: '⚠️', duration: 8000 }
        )
      }

      // Un conflit sur du matériel unique est toujours réel : deux
      // manifestations ne peuvent pas se partager le même camion.
      const conflitsObjets = res.data.conflits_objets ?? []
      if (conflitsObjets.length > 0) {
        toast(
          `Matériel déjà retenu : ${[...new Set(conflitsObjets.map(c => c.object_name))].join(', ')}`,
          { icon: '⚠️', duration: 8000 }
        )
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      manifestationApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-stats'] })
      rafraichirCatalogue()
      toast.success('Statut mis à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const updateMaterialsMutation = useMutation({
    mutationFn: ({ id, materials }: { id: number; materials: any[] }) =>
      manifestationApi.updateMaterials(id, materials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestations'] })
      rafraichirCatalogue()
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
      rafraichirCatalogue()
      queryClient.invalidateQueries({ queryKey: ['manifestation-stock-categories'] })
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
      rafraichirCatalogue()
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
      recovery_date: m.recovery_date?.split('T')[0] || '',
      notes_interior: m.notes_interior || '', notes_exterior: m.notes_exterior || '',
      materials: m.materials?.map(mat => ({
        stock_id: mat.stock_id, quantity_requested: mat.quantity_requested,
        quantity_delivered: mat.quantity_delivered, quantity_recovered: mat.quantity_recovered,
        // Les pertes déjà constatées suivent la ligne : les réenvoyer à zéro
        // effacerait la trace d'une casse dont le stock, lui, garde la marque.
        quantity_lost: mat.quantity_lost ?? 0, loss_reason: mat.loss_reason ?? null,
        unit_value: mat.unit_value, notes: mat.notes || '',
        stock_name: mat.stock_name, unit: mat.unit
      })) || [],
      // La quantité fait partie de la demande : un lot de 50 chaises rouvert à
      // 1 se réenregistrerait à 1.
      objects: m.objects?.map(o => ({
        object_id: o.object_id, object_name: o.object_name, reference: o.reference,
        notes: o.notes, quantity: o.quantity ?? 1
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
      is_prestation: Boolean(s.is_prestation),
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
          {isSupervisor && activeTab === 'manifestations' && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setEditingManif(null); setManifForm(emptyForm); setShowManifModal(true) }}>
              Nouvelle manifestation
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card><CardBody className="text-center py-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">En cours</div>
          </CardBody></Card>
          <Card
            className={stats.pending > 0 ? 'cursor-pointer ring-1 ring-orange-300 dark:ring-orange-700' : 'cursor-pointer'}
            onClick={() => setStatusFilter('pending')}
          >
            <CardBody className="text-center py-3">
              <div className="text-2xl font-bold text-orange-600">{stats.pending ?? 0}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">À confirmer</div>
            </CardBody>
          </Card>
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
            <div className="text-xs text-gray-500 dark:text-gray-400">Articles prêtables</div>
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
          isSupervisor={isSupervisor} stockLegacy={stock}
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
                <Input label="Date de récupération" type="date" value={manifForm.recovery_date}
                  onChange={e => setManifForm({ ...manifForm, recovery_date: e.target.value })} />
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

            {/* Matériel unique : un véhicule ne se demande pas en quantité. */}
            <ManifestationObjetsParc
              choisis={manifForm.objects}
              onChange={(objects) => setManifForm({ ...manifForm, objects })}
              dateDebut={manifForm.delivery_date || manifForm.date_start}
              dateFin={manifForm.recovery_date || manifForm.date_end || manifForm.date_start}
              exclure={editingManif?.id}
            />
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
            {/*
              Une prestation — raccordement au réseau, débit de boissons,
              personnel pour une cérémonie — se demande et se réalise, elle ne se
              stocke pas. C'est le premier choix à faire : il commande la moitié
              des champs qui suivent.
            */}
            <label className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={Boolean(stockForm.is_prestation)}
                onChange={e => setStockForm({ ...stockForm, is_prestation: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <strong>C'est une prestation, pas du matériel</strong>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Un raccordement électrique, un débit de boissons, du personnel pour une cérémonie.
                  Elle n'a ni stock ni disponibilité : elle est demandée, puis réalisée. Sa catégorie
                  décide du service qui devra l'approuver.
                </span>
              </span>
            </label>

            <Input label="Nom *" value={stockForm.name}
              onChange={e => setStockForm({ ...stockForm, name: e.target.value })}
              placeholder={stockForm.is_prestation ? 'Ex: Raccordement électrique' : 'Ex: Tables pliantes'} />
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

            {/* Une prestation n'a pas de stock : ces champs n'auraient rien à dire. */}
            {!stockForm.is_prestation && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Quantité totale *" type="number"
                  inputMode="numeric" value={String(stockForm.quantity_total)}
                  onChange={e => setStockForm({ ...stockForm, quantity_total: parseInt(e.target.value) || 0 })} />
                <Input label="Prix unitaire (€)" type="number"
                  inputMode="numeric" value={String(stockForm.price)}
                  onChange={e => setStockForm({ ...stockForm, price: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00" />
              </div>
            )}

            {/* Champs personnalisés — état, lieu et type ne concernent que du matériel. */}
            {!stockForm.is_prestation && (
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
            )}

            {/* Filtrer par catégorie/sous-catégorie du matériel principal */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Lier à une catégorie de matériel</CardTitle></CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {stockForm.is_prestation
                    ? "La catégorie décide du service qui approuvera cette prestation : « Technique » pour un raccordement, « Urbanisme » pour un débit de boissons."
                    : 'Associer cet article à une catégorie ou sous-catégorie existante pour filtrer le matériel disponible.'}
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

            {editingStock && <AliasArticle stockId={editingStock.id} nom={editingStock.name} />}
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* `min-w-0` avec `flex-1` : sans lui, la liste déroulante voisine, large de tout son
            contenu, prend la moitié de la barre et laisse au champ de recherche de quoi afficher
            trois mots. */}
        <div className="flex-1 min-w-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
            placeholder="Rechercher une manifestation..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="sm:w-56 sm:shrink-0">
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            options={[
              { value: '', label: 'Tous les statuts' },
              ...Object.entries(statusLabels).filter(([k]) => k !== 'archived').map(([value, label]) => ({ value, label }))
            ]} />
        </div>
        <Button variant="outline" icon={<Filter className="w-4 h-4" />}
          className="sm:shrink-0"
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

// ==================== ONGLET STOCK MATÉRIEL ====================

/**
 * Ce que la collectivité peut prêter, et où c'est passé.
 *
 * L'onglet n'interrogeait que `manifestation_stock`. Une collectivité qui tient son matériel
 * prêtable et ses prestations dans le parc — « Technique › Prestations › Raccordement
 * électrique » — voyait donc un écran vide alors que tout était saisi. Il lit désormais le
 * catalogue : les deux sources réunies, chaque ligne disant d'où elle vient.
 *
 * Trois vues, parce que ce sont trois questions et non trois affichages de la même :
 * - **Stock** : ce dont je dispose aujourd'hui ;
 * - **Stock à date** : ce dont je disposerai le 14 juillet, ou sur toute une période ;
 * - **Sorties** : où est le matériel — chez qui, jusqu'à quand, et ce qui part.
 */

type VueCatalogue = 'stock' | 'date' | 'sorties'

const vuesCatalogue: { value: VueCatalogue; label: string; icon: any; aide: string }[] = [
  { value: 'stock', label: 'Stock', icon: Package, aide: 'Ce dont vous disposez aujourd’hui.' },
  { value: 'date', label: 'Stock à date', icon: Calendar, aide: 'Ce qu’il restera sur la période choisie, engagements déduits.' },
  { value: 'sorties', label: 'Sorties', icon: Truck, aide: 'Où est le matériel, et ce qui part sur la période.' },
]

/** Valeur réservée au filtre : les articles qu'aucun service n'a pris en charge. */
const SANS_SERVICE = '__sans_service__'

/** Aujourd'hui, au format des champs date. */
const jourCourant = () => new Date().toISOString().split('T')[0]

const etatsSortie: Record<EtatSortie, { label: string; variant: 'warning' | 'info' | 'success' }> = {
  dehors: { label: 'Dehors', variant: 'warning' },
  prevue: { label: 'À sortir', variant: 'info' },
  rendu: { label: 'Rendu', variant: 'success' },
}

const naturesArticle: Record<string, string> = {
  prestation: 'Prestation',
  lot: 'Quantité',
  unique: 'Exemplaire',
}

const alignements = { left: 'text-left', center: 'text-center', right: 'text-right' }

/**
 * Tri d'une liste sur la colonne choisie.
 *
 * Les colonnes chiffrées se comparent en nombres, les autres avec l'ordre alphabétique
 * français : `localeCompare` sur des nombres classerait 100 avant 20, et un tri par octets
 * renverrait « Éclairage » derrière « Véhicules ».
 */
function useTri<T>(
  lignes: T[],
  colonnes: Record<string, (ligne: T) => string | number | null>,
  defaut: string
) {
  const [cle, setCle] = useState(defaut)
  const [sens, setSens] = useState<'asc' | 'desc'>('asc')

  const triees = useMemo(() => {
    const valeur = colonnes[cle] ?? colonnes[defaut]
    const signe = sens === 'asc' ? 1 : -1
    return [...lignes].sort((a, b) => {
      const va = valeur(a)
      const vb = valeur(b)
      if (typeof va === 'number' || typeof vb === 'number') {
        // Une prestation n'a pas de quantité : elle se range en bout de liste plutôt que de se
        // faire passer pour un stock épuisé.
        return signe * (Number(va ?? -1) - Number(vb ?? -1))
      }
      return signe * String(va ?? '').localeCompare(String(vb ?? ''), 'fr')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, cle, sens])

  // Recliquer sur la colonne déjà triée inverse le sens ; en changer repart du croissant, sinon
  // on hérite d'un sens qu'on n'a pas demandé.
  const basculer = (nouvelle: string) => {
    if (nouvelle === cle) setSens(sens === 'asc' ? 'desc' : 'asc')
    else { setCle(nouvelle); setSens('asc') }
  }

  return { triees, cle, sens, basculer }
}

type Tri = { cle: string; sens: 'asc' | 'desc'; basculer: (cle: string) => void }

/** En-tête de colonne qui trie, et qui montre sur quoi et dans quel sens. */
function EnTeteTri({ cle, label, tri, align = 'left' }: {
  cle: string; label: string; tri: Tri; align?: keyof typeof alignements
}) {
  const actif = tri.cle === cle
  return (
    <th className={`pb-2 font-medium text-gray-500 dark:text-gray-400 ${alignements[align]}`}>
      <button type="button" onClick={() => tri.basculer(cle)}
        aria-label={`Trier par ${label}`}
        className={`inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 ${actif ? 'text-gray-800 dark:text-gray-200' : ''}`}>
        {label}
        {actif
          ? (tri.sens === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  )
}

/** Une quantité, ou un tiret quand la notion n'a pas de sens — une prestation ne se compte pas. */
function Quantite({ valeur }: { valeur: number | null }) {
  if (valeur === null || valeur === undefined) {
    return <span className="text-gray-400" title="Une prestation n’a ni stock ni disponibilité">—</span>
  }
  return <span>{valeur}</span>
}

function StockTab({ isSupervisor, stockLegacy, onEdit, onDelete }: {
  isSupervisor: boolean
  stockLegacy: StockItem[]
  onEdit: (article: StockItem) => void
  onDelete: (id: number, name: string) => void
}) {
  const [vue, setVue] = useState<VueCatalogue>('stock')
  const [dateDebut, setDateDebut] = useState(jourCourant)
  const [dateFin, setDateFin] = useState(jourCourant)
  const [recherche, setRecherche] = useState('')
  const [nature, setNature] = useState('')
  const [service, setService] = useState('')

  // La vue « Stock » répond sur le jour même ; les deux autres sur la période saisie. Une fin
  // laissée vide vaut le jour de début : on interroge alors une date, pas une période ouverte.
  const debut = vue === 'stock' ? jourCourant() : (dateDebut || jourCourant())
  const fin = vue === 'stock' ? jourCourant() : (dateFin || dateDebut || jourCourant())

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['manifestation-catalogue', debut, fin],
    queryFn: async () => {
      const res = await manifestationApi.getCatalogue({ date_from: debut, date_to: fin })
      return res.data.data
    }
  })

  const { data: sorties = [], isLoading: chargementSorties } = useQuery({
    queryKey: ['manifestation-sorties', debut, fin],
    queryFn: async () => {
      const res = await manifestationApi.getSorties({ date_from: debut, date_to: fin })
      return res.data.data
    },
    enabled: vue === 'sorties'
  })

  /**
   * Seuls les services qui prêtent réellement quelque chose.
   *
   * Proposer « Véhicules » à une collectivité qui n'en prête aucun fait chercher dans une liste
   * vide ; « Technique » doit y figurer, lui, ne serait-ce que pour sa prestation de
   * raccordement électrique. La liste se déduit donc du catalogue, jamais de la table des
   * services.
   */
  const services = useMemo(() => {
    const parId = new Map<number, ServiceBref>()
    for (const article of articles) {
      for (const s of article.services) parId.set(s.id, s)
    }
    return [...parId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [articles])

  // Beaucoup d'articles ne sont rattachés à aucune catégorie, donc à aucun service : sans cette
  // entrée, le filtre par service les rendrait introuvables.
  const sansService = useMemo(
    () => articles.some((a: ArticleCatalogue) => a.services.length === 0),
    [articles]
  )

  const correspondService = (liste: ServiceBref[]) => {
    if (!service) return true
    if (service === SANS_SERVICE) return liste.length === 0
    return liste.some(s => s.slug === service)
  }

  const correspondNature = (prestation: boolean) => {
    if (nature === 'materiel') return !prestation
    if (nature === 'prestation') return prestation
    return true
  }

  const terme = recherche.trim().toLowerCase()

  const articlesFiltres = useMemo(
    () => articles.filter((a: ArticleCatalogue) =>
      correspondNature(a.is_prestation)
      && correspondService(a.services)
      && (!terme || `${a.name} ${a.category}`.toLowerCase().includes(terme))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [articles, nature, service, terme]
  )

  const sortiesFiltrees = useMemo(
    () => sorties.filter((l: LigneSortie) =>
      correspondNature(l.is_prestation)
      && correspondService(l.services)
      // La recherche porte aussi sur la manifestation : « où est le matériel de la brocante ? ».
      && (!terme || `${l.name} ${l.manifestation}`.toLowerCase().includes(terme))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorties, nature, service, terme]
  )

  const triCatalogue = useTri<ArticleCatalogue>(articlesFiltres, {
    name: a => a.name,
    source: a => a.source,
    category: a => a.category,
    service: a => a.services.map(s => s.name).join(', '),
    quantity_total: a => a.quantity_total,
    quantity_out: a => a.quantity_out,
    quantity_engaged: a => a.quantity_engaged,
    quantity_available: a => a.quantity_available,
  }, 'name')

  const triSorties = useTri<LigneSortie>(sortiesFiltrees, {
    name: l => l.name,
    manifestation: l => l.manifestation,
    service: l => l.services.map(s => s.name).join(', '),
    debut: l => l.debut,
    quantite_demandee: l => l.quantite_demandee,
    quantite_sortie: l => l.quantite_sortie,
    quantite_dehors: l => l.quantite_dehors,
    etat: l => l.etat,
  }, 'name')

  const filtresActifs = Boolean(nature || service || recherche)
  const chargement = vue === 'sorties' ? chargementSorties : isLoading
  const formatD = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : ''

  return (
    <div className="space-y-4">
      {/* Trois vues, trois questions — et non trois affichages de la même. */}
      <div className="flex flex-wrap items-center gap-2">
        {vuesCatalogue.map(v => {
          const Icone = v.icon
          const actif = vue === v.value
          return (
            <button key={v.value} type="button" onClick={() => setVue(v.value)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                actif
                  ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}>
              <Icone className="w-4 h-4" />
              {v.label}
            </button>
          )
        })}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {vuesCatalogue.find(v => v.value === vue)?.aide}
        </span>
      </div>

      {/* Recherche et filtres */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
            placeholder={vue === 'sorties' ? 'Rechercher un article ou une manifestation...' : 'Rechercher un article...'}
            value={recherche} onChange={e => setRecherche(e.target.value)} />
        </div>
        <div className="sm:w-56 sm:shrink-0">
          <Select value={nature} onChange={(e: any) => setNature(e.target.value)}
            options={[
              { value: '', label: 'Matériel et prestations' },
              { value: 'materiel', label: 'Matériel seulement' },
              { value: 'prestation', label: 'Prestations seulement' },
            ]} />
        </div>
        <div className="sm:w-56 sm:shrink-0">
          <Select value={service} onChange={(e: any) => setService(e.target.value)}
            options={[
              { value: '', label: 'Tous les services' },
              ...services.map(s => ({ value: s.slug, label: s.name })),
              ...(sansService ? [{ value: SANS_SERVICE, label: 'Sans service' }] : []),
            ]} />
        </div>
      </div>

      {/* Période : les vues datées ; la vue « Stock » répond toujours sur aujourd'hui. */}
      {vue !== 'stock' && (
        <div className="flex flex-wrap items-end gap-3">
          {/* Le champ occupe toute la largeur de son conteneur : c'est lui qu'on borne, sinon
              chaque date prend une ligne pour elle seule. */}
          <div className="w-44">
            <Input type="date" label={vue === 'sorties' ? 'Sorties du' : 'Disponibilité du'}
              value={dateDebut} onChange={e => setDateDebut(e.target.value)} />
          </div>
          <div className="w-44">
            <Input type="date" label="au" value={dateFin}
              onChange={e => setDateFin(e.target.value)} />
          </div>
          <Button size="sm" variant="ghost"
            onClick={() => { setDateDebut(jourCourant()); setDateFin(jourCourant()) }}>
            Aujourd’hui
          </Button>
          <span className="text-xs text-gray-500 dark:text-gray-400 pb-2">
            {debut === fin ? `Le ${formatD(debut)}` : `Du ${formatD(debut)} au ${formatD(fin)}`}
          </span>
        </div>
      )}

      {filtresActifs && (
        <Button size="sm" variant="ghost" onClick={() => { setNature(''); setService(''); setRecherche('') }}>
          <X className="w-3 h-3 mr-1" /> Réinitialiser les filtres
        </Button>
      )}

      {chargement ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Chargement...</div>
      ) : vue === 'sorties' ? (
        triSorties.triees.length === 0 ? (
          <Card><CardBody className="text-center py-12 text-gray-500 dark:text-gray-400">
            {sorties.length === 0
              ? 'Aucun matériel dehors sur cette période'
              : 'Aucune sortie ne correspond aux filtres'}
          </CardBody></Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700 text-left">
                  <EnTeteTri cle="name" label="Article" tri={triSorties} />
                  <EnTeteTri cle="service" label="Service" tri={triSorties} />
                  <EnTeteTri cle="manifestation" label="Manifestation" tri={triSorties} />
                  <EnTeteTri cle="debut" label="Période" tri={triSorties} />
                  <EnTeteTri cle="quantite_demandee" label="Demandé" tri={triSorties} align="center" />
                  <EnTeteTri cle="quantite_sortie" label="Sorti" tri={triSorties} align="center" />
                  <EnTeteTri cle="quantite_dehors" label="Dehors" tri={triSorties} align="center" />
                  <EnTeteTri cle="etat" label="État" tri={triSorties} align="center" />
                </tr>
              </thead>
              <tbody>
                {triSorties.triees.map((l: LigneSortie) => (
                  <tr key={`${l.ref}-${l.manifestation_id}`} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{l.name}</span>
                        {l.is_prestation && <Badge variant="info" size="sm">Prestation</Badge>}
                      </div>
                      {l.category && <div className="text-xs text-gray-500 dark:text-gray-400">📁 {l.category}</div>}
                    </td>
                    <td className="py-2 text-xs text-gray-600 dark:text-gray-300">
                      {l.services.length > 0 ? l.services.map(s => s.name).join(', ') : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-2">
                      <span className="text-gray-900 dark:text-gray-100">{l.manifestation}</span>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{statusLabels[l.status] || l.status}</div>
                    </td>
                    <td className="py-2 text-xs text-gray-600 dark:text-gray-300">
                      {formatD(l.debut)}{l.fin !== l.debut ? ` → ${formatD(l.fin)}` : ''}
                    </td>
                    <td className="py-2 text-center">{l.quantite_demandee}</td>
                    <td className="py-2 text-center">{l.quantite_sortie}</td>
                    <td className="py-2 text-center font-semibold text-yellow-600">{l.quantite_dehors}</td>
                    <td className="py-2 text-center">
                      <Badge variant={etatsSortie[l.etat].variant} size="sm">{etatsSortie[l.etat].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : triCatalogue.triees.length === 0 ? (
        <Card><CardBody className="text-center py-12 text-gray-500 dark:text-gray-400">
          {articles.length === 0
            ? 'Aucun article prêtable. Le matériel se déclare depuis le parc : ouvrez une catégorie au prêt dans Réglages › Manifestations.'
            : 'Aucun article ne correspond aux filtres'}
        </CardBody></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 text-left">
                <EnTeteTri cle="name" label="Article" tri={triCatalogue} />
                <EnTeteTri cle="source" label="Origine" tri={triCatalogue} />
                <EnTeteTri cle="category" label="Catégorie" tri={triCatalogue} />
                <EnTeteTri cle="service" label="Service" tri={triCatalogue} />
                <EnTeteTri cle="quantity_total" label="Total" tri={triCatalogue} align="center" />
                <EnTeteTri cle="quantity_out" label="Dehors" tri={triCatalogue} align="center" />
                <EnTeteTri cle="quantity_engaged" label="Promis" tri={triCatalogue} align="center" />
                <EnTeteTri cle="quantity_available" label="Disponible" tri={triCatalogue} align="center" />
                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400 text-center">Fiche</th>
              </tr>
            </thead>
            <tbody>
              {triCatalogue.triees.map((a: ArticleCatalogue) => {
                // Seul un article de l'ancien catalogue se modifie ici : celui du parc a sa
                // fiche, où il porte sa référence, son état et son historique.
                const legacy = a.source === 'stock'
                  ? stockLegacy.find((s: StockItem) => s.id === a.id)
                  : undefined
                return (
                  <tr key={a.ref} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{a.name}</span>
                        {a.is_prestation
                          ? <Badge variant="info" size="sm">Prestation</Badge>
                          : <Badge variant="default" size="sm">{naturesArticle[a.nature] || a.nature}</Badge>}
                      </div>
                    </td>
                    <td className="py-2">
                      <Badge variant={a.source === 'parc' ? 'success' : 'default'} size="sm">
                        {a.source === 'parc' ? 'Parc' : 'Stock'}
                      </Badge>
                    </td>
                    <td className="py-2 text-gray-700 dark:text-gray-300">
                      {a.category || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-2 text-xs text-gray-600 dark:text-gray-300">
                      {a.services.length > 0 ? a.services.map(s => s.name).join(', ') : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-2 text-center">
                      <Quantite valeur={a.quantity_total} />
                      {a.unit && a.quantity_total !== null ? <span className="text-xs text-gray-500 ml-1">{a.unit}</span> : null}
                    </td>
                    <td className="py-2 text-center text-yellow-600"><Quantite valeur={a.is_prestation ? null : a.quantity_out} /></td>
                    <td className="py-2 text-center text-blue-600"><Quantite valeur={a.is_prestation ? null : a.quantity_engaged} /></td>
                    <td className="py-2 text-center">
                      {a.quantity_available === null ? (
                        <span className="text-gray-400" title="Une prestation se réalise, elle ne se stocke pas">—</span>
                      ) : (
                        <span className={a.quantity_available <= 0
                          ? 'text-red-600 font-bold'
                          : (a.quantity_total && a.quantity_available < a.quantity_total * 0.2)
                            ? 'text-yellow-600 font-semibold'
                            : 'text-green-600 font-semibold'}>
                          {a.quantity_available}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      <div className="flex justify-center gap-1">
                        {a.source === 'parc' ? (
                          <Link to={`/objects/${a.id}`} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Voir la fiche" aria-label="Voir la fiche">
                            <Eye className="w-4 h-4 text-gray-500" />
                          </Link>
                        ) : isSupervisor && legacy ? (
                          <>
                            <button onClick={() => onEdit(legacy)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Modifier" aria-label="Modifier">
                              <Edit className="w-4 h-4 text-blue-600" />
                            </button>
                            <button onClick={() => onDelete(a.id, a.name)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target" title="Supprimer" aria-label="Supprimer">
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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

/** Un événement de l'historique d'une manifestation. */
interface EvenementHistorique {
  id: number
  action: string
  from_status?: string | null
  to_status?: string | null
  comment?: string | null
  created_at: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

/**
 * Timeline horodatée des actions.
 *
 * La table `manifestation_history` existait depuis le début sans être ni écrite
 * ni lue : la « timeline complète de toutes les actions » annoncée dans le
 * README et la feuille de route n'existait nulle part. Un prêt de matériel pour
 * un événement municipal engage la collectivité — savoir qui a validé, qui a
 * livré et quand est le minimum.
 */
function HistoriqueManifestation({ manifestationId }: { manifestationId: number }) {
  const { data: evenements = [], isLoading } = useQuery({
    queryKey: ['manifestation-history', manifestationId],
    queryFn: async () => {
      const res = await api.get(`/manifestations/${manifestationId}/history`)
      return (res.data.data ?? []) as EvenementHistorique[]
    },
  })

  if (isLoading) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">Chargement de l'historique…</p>
  }

  if (evenements.length === 0) {
    // Les manifestations créées avant la mise en place de l'historique n'en ont
    // pas : on le dit plutôt que d'afficher un bloc vide.
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Aucune action enregistrée pour cette manifestation.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {evenements.map((e) => {
        const auteur = e.first_name || e.last_name
          ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()
          : e.email || 'Système'
        const depuis = e.from_status ? statusLabels[e.from_status] ?? e.from_status : null
        const vers = e.to_status ? statusLabels[e.to_status] ?? e.to_status : null

        return (
          <li key={e.id} className="border-l-2 border-primary-500 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <strong className="text-gray-900 dark:text-gray-100">{e.action}</strong>
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {new Date(e.created_at).toLocaleString('fr-FR')} — {auteur}
              </span>
            </div>
            {depuis && vers && (
              <p className="text-gray-700 dark:text-gray-300">{depuis} → {vers}</p>
            )}
            {e.comment && (
              <p className="text-gray-600 dark:text-gray-300 italic">« {e.comment} »</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Fiche d'une manifestation, en onglets.
 *
 * Elle portait infos, contact, notes, matériel, matériel unique, approbations,
 * échanges, copies et historique à la suite — et devait encore recevoir les
 * prestations et les pièces jointes. Trois écrans de défilement pour trouver la
 * date de livraison.
 *
 * Cinq onglets avec un compteur : ce qu'on cherche est atteignable en un clic.
 * Rien n'a été retiré. Les compteurs partagent les clés de requête des
 * composants qu'ils annoncent, si bien qu'ils n'ajoutent aucun appel au serveur.
 */
function ManifDetailModal({ manif: m, onClose }: { manif: Manifestation; onClose: () => void }) {
  // Le serveur refuse de toute façon ; masquer les cases évite de laisser croire
  // qu'un simple lecteur peut constater un retour.
  const { canManage } = usePermissions()
  const [onglet, setOnglet] = useState('resume')
  const [exportPDF, setExportPDF] = useState(false)

  // Mêmes clés que `ManifestationDocuments` et `ManifestationSuivi` : le cache
  // est partagé, ces lectures ne déclenchent pas de second appel.
  const { data: documents = [] } = useQuery({
    queryKey: ['manifestation-documents', m.id],
    queryFn: async () => (await documentManifestationApi.lister(m.id)).data.data,
  })
  const { data: approbations = [] } = useQuery({
    queryKey: ['manifestation-approvals', m.id],
    queryFn: async () => (await suiviApi.getApprovals(m.id)).data.data,
  })

  const materiels = (m.materials ?? []).filter(mat => !mat.is_prestation)
  const prestations = (m.materials ?? []).filter(mat => mat.is_prestation)
  const objets = m.objects ?? []
  const enAttente = approbations.filter(a => a.kind === 'approbation' && a.status === 'pending').length

  return (
    <Modal isOpen onClose={onClose} title={m.title} size="xl">
      <ModalBody>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[m.status]}`}>
              {statusLabels[m.status]}
            </span>
            <span className="text-gray-500 dark:text-gray-400">Créée par {m.created_by_name}</span>
            {enAttente > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                {enAttente} approbation(s) en attente
              </span>
            )}
          </div>

          <Tabs value={onglet} onChange={setOnglet}>
            <Tab value="resume" label="Résumé" />
            <Tab value="materiel" label="Matériel" count={materiels.length + prestations.length + objets.length} />
            <Tab value="documents" label="Documents" count={documents.length} />
            <Tab value="suivi" label="Suivi" count={approbations.length} />
            <Tab value="historique" label="Historique" />
          </Tabs>

          {onglet === 'resume' && <OngletResume manif={m} />}

          {onglet === 'materiel' && (
            <div className="space-y-4">
              <MaterielARattacher brut={m.intake_unmatched} />
              <TableauMateriel lignes={materiels} />
              <TableauPrestations lignes={prestations} />
              <SuiviObjetsParc manifestationId={m.id} modifiable={canManage} />
              {materiels.length === 0 && prestations.length === 0 && objets.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  Aucun matériel ni prestation demandé pour cette manifestation.
                </p>
              )}
            </div>
          )}

          {onglet === 'documents' && <ManifestationDocuments manifestation={m} />}

          {/* Approbations, échanges et copies : le suivi partagé entre services. */}
          {onglet === 'suivi' && <ManifestationSuivi manifestationId={m.id} />}

          {onglet === 'historique' && (
            <Card>
              <CardBody>
                <HistoriqueManifestation manifestationId={m.id} />
              </CardBody>
            </Card>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Fermer</Button>
        <Button onClick={() => setExportPDF(true)}>
          <FileDown className="w-4 h-4 mr-2" />
          Exporter en PDF
        </Button>
      </ModalFooter>

      {exportPDF && (
        <ManifestationPDFExport manifestation={m} onClose={() => setExportPDF(false)} />
      )}
    </Modal>
  )
}

/** Ce qu'on vient vérifier en premier : quand, où, avec qui. */
function OngletResume({ manif: m }: { manif: Manifestation }) {
  const formatD = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : '-'

  return (
    <div className="space-y-4">
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
            <div><span className="text-gray-500 dark:text-gray-400">Récupération:</span> {formatD(m.recovery_date)}</div>
            <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">Adresse:</span> {m.delivery_address || '-'}</div>
          </div>
        </CardBody>
      </Card>

      <CoutManifestationCard cout={m.cout} />

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
    </div>
  )
}

function TableauMateriel({ lignes }: { lignes: ManifMaterial[] }) {
  if (lignes.length === 0) return null

  const total = (champ: keyof ManifMaterial) =>
    lignes.reduce((s, mat) => s + (Number(mat[champ]) || 0), 0)
  const valeur = lignes.reduce((s, mat) => s + (mat.unit_value * mat.quantity_requested), 0)

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Matériel demandé</CardTitle></CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 text-xs">
                <th className="pb-1">Matériel</th>
                <th className="pb-1 text-center">Demandé</th>
                <th className="pb-1 text-center">Livré</th>
                <th className="pb-1 text-center">Récupéré</th>
                <th className="pb-1 text-center">Perdu</th>
                <th className="pb-1 text-right">Val. TTC</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((mat, i) => (
                <tr key={i} className="border-b dark:border-gray-700">
                  <td className="py-1.5">{mat.stock_name} <span className="text-gray-600 dark:text-gray-300">({mat.stock_category})</span></td>
                  <td className="py-1.5 text-center">{mat.quantity_requested} {mat.unit}</td>
                  <td className="py-1.5 text-center">{mat.quantity_delivered}</td>
                  <td className="py-1.5 text-center">{mat.quantity_recovered}</td>
                  <td className={`py-1.5 text-center ${mat.quantity_lost ? 'text-red-600 font-semibold' : ''}`}
                    title={mat.loss_reason || undefined}>
                    {mat.quantity_lost || 0}
                  </td>
                  <td className="py-1.5 text-right">{(mat.unit_value * mat.quantity_requested).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 dark:border-gray-600">
                <td className="pt-2">Total</td>
                <td className="pt-2 text-center">{total('quantity_requested')}</td>
                <td className="pt-2 text-center">{total('quantity_delivered')}</td>
                <td className="pt-2 text-center">{total('quantity_recovered')}</td>
                <td className="pt-2 text-center">{total('quantity_lost')}</td>
                <td className="pt-2 text-right">{valeur.toFixed(2)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Prestations demandées.
 *
 * Ni disponibilité ni casse : une prestation est demandée, puis réalisée. Les
 * colonnes du matériel n'auraient rien à y afficher.
 */
function TableauPrestations({ lignes }: { lignes: ManifMaterial[] }) {
  if (lignes.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Prestations demandées</CardTitle></CardHeader>
      <CardBody>
        <div className="space-y-2">
          {lignes.map((prestation, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {prestation.stock_name}
                {prestation.quantity_requested > 1 && (
                  <span className="text-gray-600 dark:text-gray-300"> × {prestation.quantity_requested}</span>
                )}
                {prestation.stock_category && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">({prestation.stock_category})</span>
                )}
              </span>
              <Badge variant={prestation.quantity_delivered > 0 ? 'success' : 'default'}>
                {prestation.quantity_delivered > 0 ? 'Réalisée' : 'À réaliser'}
              </Badge>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Autres noms sous lesquels une demande peut désigner cet article.
 *
 * Le formulaire dit « tables », le stock dit « Table 180 cm ». Sans alias,
 * chaque demande reçue laisserait la ligne à rattacher à la main, demande après
 * demande — alors que le rapprochement est toujours le même.
 *
 * N'apparaît qu'à la modification : un alias a besoin d'un article existant.
 */
function AliasArticle({ stockId, nom }: { stockId: number; nom: string }) {
  const queryClient = useQueryClient()
  const [saisie, setSaisie] = useState('')

  const { data: alias = [] } = useQuery({
    queryKey: ['stock-aliases', stockId],
    queryFn: async () => (await manifestationApi.getAliases(stockId)).data.data
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['stock-aliases', stockId] })

  const ajout = useMutation({
    mutationFn: (valeur: string) => manifestationApi.addAlias(stockId, valeur),
    onSuccess: () => { rafraichir(); setSaisie('') },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  const retrait = useMutation({
    mutationFn: (aliasId: number) => manifestationApi.deleteAlias(aliasId),
    onSuccess: rafraichir,
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Autres noms reconnus</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Une demande reçue par formulaire qui parle de l'un de ces noms sera rattachée
          automatiquement à « {nom} ».
        </p>

        {alias.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {alias.map(a => (
              <span key={a.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                {a.alias}
                <button type="button" onClick={() => retrait.mutate(a.id)}
                  aria-label={`Retirer l'alias ${a.alias}`}
                  className="hover:text-red-600">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input value={saisie} size="sm" placeholder="tables, table pliante…"
            onChange={e => setSaisie(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && saisie.trim()) {
                e.preventDefault()
                ajout.mutate(saisie.trim())
              }
            }} />
          <Button size="sm" variant="outline" loading={ajout.isPending}
            disabled={!saisie.trim()} onClick={() => ajout.mutate(saisie.trim())}>
            Ajouter
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Suivi du matériel unique d'une manifestation.
 *
 * Un véhicule ne se compte pas : il est sorti ou non, revenu ou non, et son état
 * au retour se constate — intact, abîmé, perdu. Trois cases plutôt que quatre
 * champs de quantité, parce que « 0,5 camion livré » n'a aucun sens.
 */
function SuiviObjetsParc({ manifestationId, modifiable }: {
  manifestationId: number
  modifiable: boolean
}) {
  const queryClient = useQueryClient()

  const { data: objets = [] } = useQuery({
    queryKey: ['manifestation-objects', manifestationId],
    queryFn: async () => (await objetManifestationApi.lister(manifestationId)).data.data
  })

  const suivi = useMutation({
    mutationFn: ({ itemId, ...data }: { itemId: number } & Record<string, any>) =>
      objetManifestationApi.suivre(manifestationId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manifestation-objects', manifestationId] })
      queryClient.invalidateQueries({ queryKey: ['manifestation-history', manifestationId] })
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur')
  })

  if (objets.length === 0) return null

  const LIBELLES_ETAT: Record<string, string> = {
    intact: 'Intact',
    abime: 'Abîmé',
    perdu: 'Perdu'
  }

  // Un service peut tenir ses prestations dans le parc, à côté de son matériel.
  // Les mêler ici ferait proposer « État au retour : abîmé » sur un débit de
  // boissons — les deux natures ne se suivent pas de la même façon.
  const exemplaires = objets.filter(o => o.nature === 'unique' || (!o.nature && !o.is_prestation))
  const prestations = objets.filter(o => o.nature === 'prestation' || (!o.nature && o.is_prestation))
  const lots = objets.filter(o => o.nature === 'lot')

  return (
    <>
    {prestations.length > 0 && (
      <Card>
        <CardHeader><CardTitle className="text-sm">Prestations demandées</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {prestations.map(prestation => (
            <div key={prestation.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div className="min-w-0">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {prestation.object_name}
                </span>
                {prestation.quantity > 1 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                    × {prestation.quantity}
                  </span>
                )}
                {prestation.category_name && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                    {prestation.category_name}
                  </span>
                )}
              </div>
              {/* Une prestation se lit « réalisée », pas « livrée puis revenue » :
                  il n'y a rien à rapporter ni à constater au retour. */}
              {modifiable ? (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={prestation.quantity_delivered > 0}
                    onChange={e => suivi.mutate({ itemId: prestation.id, delivered: e.target.checked })} />
                  Réalisée
                </label>
              ) : (
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {prestation.quantity_delivered > 0 ? 'Réalisée' : 'À réaliser'}
                </span>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    )}

    {lots.length > 0 && (
      <Card>
        <CardHeader><CardTitle className="text-sm">Lots du parc</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {lots.map(lot => (
            <div key={lot.id} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {lot.object_name}
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                    {lot.quantity} demandée(s) sur {lot.quantity_total ?? 0} détenue(s)
                  </span>
                </span>
                {/* Ce qui manque au retour est la casse ou le vol : le dire ici
                    évite d'aller le chercher dans l'historique. */}
                {lot.quantity_delivered > lot.quantity_returned && lot.quantity_returned > 0 && (
                  <Badge variant="danger">
                    {lot.quantity_delivered - lot.quantity_returned} non revenue(s)
                  </Badge>
                )}
              </div>

              {modifiable ? (
                <div className="flex flex-wrap items-center gap-4 mt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    Livrées
                    <input type="number" min={0} max={lot.quantity}
                      value={lot.quantity_delivered}
                      onChange={e => suivi.mutate({ itemId: lot.id, delivered_quantity: e.target.value })}
                      className="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    Revenues
                    <input type="number" min={0} max={lot.quantity}
                      value={lot.quantity_returned}
                      onChange={e => suivi.mutate({ itemId: lot.id, returned_quantity: e.target.value })}
                      className="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900" />
                  </label>
                </div>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {lot.quantity_delivered} livrée(s) · {lot.quantity_returned} revenue(s)
                </p>
              )}

              {lot.notes && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">{lot.notes}</p>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    )}

    {exemplaires.length > 0 && (
    <Card>
      <CardHeader><CardTitle className="text-sm">Matériel unique du parc</CardTitle></CardHeader>
      <CardBody className="space-y-2">
        {exemplaires.map(objet => (
          <div key={objet.id} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{objet.object_name}</span>
                {objet.reference && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{objet.reference}</span>
                )}
                {objet.serial_number && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">n° {objet.serial_number}</span>
                )}
              </div>
              {objet.return_state && (
                <Badge variant={objet.return_state === 'intact' ? 'success' : 'danger'}>
                  {LIBELLES_ETAT[objet.return_state]}
                </Badge>
              )}
            </div>

            {modifiable ? (
              <div className="flex flex-wrap items-center gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={objet.quantity_delivered > 0}
                    onChange={e => suivi.mutate({ itemId: objet.id, delivered: e.target.checked })} />
                  Sorti
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={objet.quantity_returned > 0}
                    onChange={e => suivi.mutate({ itemId: objet.id, returned: e.target.checked })} />
                  Revenu
                </label>
                {objet.quantity_returned > 0 && (
                  <div className="w-40">
                    <Select value={objet.return_state ?? ''}
                      onChange={e => suivi.mutate({ itemId: objet.id, return_state: e.target.value })}
                      options={[
                        { value: '', label: '— État au retour —' },
                        { value: 'intact', label: 'Intact' },
                        { value: 'abime', label: 'Abîmé' },
                        { value: 'perdu', label: 'Perdu' }
                      ]} />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {objet.quantity_delivered > 0 ? 'Sorti' : 'Non sorti'}
                {' · '}
                {objet.quantity_returned > 0 ? 'revenu' : 'non revenu'}
              </p>
            )}

            {objet.notes && (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">{objet.notes}</p>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
    )}
    </>
  )
}

/**
 * Matériel demandé par un formulaire qu'aucun article du stock n'a permis de
 * rattacher.
 *
 * Ces lignes seraient invisibles autrement : la demande arriverait amputée sans
 * que personne le sache, et le manque se découvrirait le jour de la livraison.
 * Le rattachement se fait à la main, en modifiant la manifestation — ou une fois
 * pour toutes en ajoutant un alias à l'article concerné.
 */
function MaterielARattacher({ brut }: { brut?: string | null }) {
  if (!brut) return null

  let lignes: Array<{ libelle: string; quantite: number }> = []
  try {
    lignes = JSON.parse(brut)
  } catch {
    return null
  }
  if (lignes.length === 0) return null

  return (
    <Alert type="warning">
      <div className="text-sm">
        <strong>Matériel demandé non rattaché au stock :</strong>
        <ul className="mt-1 list-disc list-inside">
          {lignes.map((l, i) => (
            <li key={i}>{l.quantite} × {l.libelle}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs">
          Ajoutez-le à la main, ou enregistrez un alias sur l'article correspondant
          pour que les prochaines demandes le trouvent seules.
        </p>
      </div>
    </Alert>
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
      quantity_recovered: m.quantity_recovered,
      quantity_lost: m.quantity_lost ?? 0,
      loss_reason: m.loss_reason ?? ''
    })) || []
  )

  const update = (idx: number, field: string, value: number | string) => {
    const updated = [...materials]
    updated[idx] = { ...updated[idx], [field]: value }
    setMaterials(updated)
  }

  /**
   * Écart entre ce qui est sorti et ce qui est revenu ou déclaré perdu.
   *
   * C'est le chiffre qui trahit une saisie incomplète : 12 chaises livrées, 11
   * récupérées et rien de déclaré perdu, c'est une chaise que personne ne
   * cherche.
   */
  const manquant = (m: typeof materials[number]) =>
    m.quantity_delivered - m.quantity_recovered - m.quantity_lost

  const aDesEcarts = materials.some(m => manquant(m) > 0)

  return (
    <Modal isOpen onClose={onClose} title={`Matériel — ${manif.title}`} size="lg">
      <ModalBody>
        <Alert type="info">
          <span className="text-sm">
            {manif.status === 'validated'
              ? "Saisissez ce qui part réellement. Si seules 8 tables sur 10 sont nécessaires, corrigez la quantité demandée."
              : "Saisissez ce qui revient. Ce qui est déclaré cassé, perdu ou volé est retiré du stock physique et reste tracé."}
          </span>
        </Alert>

        <div className="mt-4 space-y-3">
          {materials.map((m, i) => (
            <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{m.stock_name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{m.unit}</span>
              </div>

              <div className="flex flex-wrap items-start gap-3">
                <div className="w-28">
                  <Input label="Demandé" type="number" min="0"
                    inputMode="numeric" size="sm" value={String(m.quantity_requested)}
                    onChange={e => update(i, 'quantity_requested', parseInt(e.target.value) || 0)} />
                </div>
                <div className="w-28">
                  <Input label="Livré" type="number" min="0"
                    inputMode="numeric" size="sm" value={String(m.quantity_delivered)}
                    onChange={e => update(i, 'quantity_delivered', parseInt(e.target.value) || 0)} />
                </div>
                <div className="w-28">
                  <Input label="Récupéré" type="number" min="0"
                    inputMode="numeric" size="sm" value={String(m.quantity_recovered)}
                    onChange={e => update(i, 'quantity_recovered', parseInt(e.target.value) || 0)} />
                </div>
                <div className="w-28">
                  <Input label="Perdu / cassé" type="number" min="0"
                    inputMode="numeric" size="sm" value={String(m.quantity_lost)}
                    onChange={e => update(i, 'quantity_lost', parseInt(e.target.value) || 0)} />
                </div>
                {m.quantity_lost > 0 && (
                  <div className="flex-1 min-w-[12rem]">
                    <Input label="Motif" size="sm" value={m.loss_reason}
                      placeholder="Cassée au transport, volée…"
                      onChange={e => update(i, 'loss_reason', e.target.value)} />
                  </div>
                )}
              </div>

              {manquant(m) > 0 && (
                <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-500">
                  {manquant(m)} {m.unit} ni récupéré(s) ni déclaré(s) perdu(s).
                </p>
              )}
            </div>
          ))}
        </div>

        {aDesEcarts && (
          <Alert type="warning" className="mt-4">
            <span className="text-sm">
              Des articles sortis ne sont ni revenus ni déclarés perdus. Tant qu'ils
              ne le sont pas, le stock les considère comme encore dehors.
            </span>
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button loading={loading} onClick={() => onSave(materials)}>Enregistrer</Button>
      </ModalFooter>
    </Modal>
  )
}

/** Montant en euros, à la française : « 1 250,50 € ». */
const enEuros = (valeur: number): string =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(valeur ?? 0)

/**
 * Ce que la manifestation coûte.
 *
 * Deux natures, séparées à dessein : ce qu'on **déploie** — trois agents, un
 * raccordement — et ce qui ne **revient pas** — dix chaises prêtées, neuf
 * rendues. Les additionner sans les distinguer donnerait un total juste et une
 * lecture fausse : on ne négocie pas une casse comme on budgète une vacation.
 *
 * Tant que la manifestation n'est pas récupérée, ce qui est sorti n'est pas
 * perdu : il est montré à part, sans entrer dans le total. Compter la
 * différence dès la livraison afficherait 1 500 € de casse le jour où l'on sort
 * trente chaises.
 */
function CoutManifestationCard({ cout }: { cout?: CoutManifestation }) {
  if (!cout) return null

  const rien =
    cout.prestations.length === 0 &&
    cout.pertes.length === 0 &&
    cout.en_attente_de_retour.length === 0
  if (rien) return null

  const Section = ({ titre, lignes, ton }: { titre: string; lignes: LigneCout[]; ton: string }) =>
    lignes.length === 0 ? null : (
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{titre}</p>
        <div className="space-y-1">
          {lignes.map((ligne, i) => (
            <div key={`${ligne.libelle}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-gray-900 dark:text-gray-100">
                {ligne.libelle}
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{ligne.motif}</span>
              </span>
              <strong className={ton}>{enEuros(ligne.total)}</strong>
            </div>
          ))}
        </div>
      </div>
    )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Coût de la manifestation</CardTitle>
        <strong className="text-lg text-gray-900 dark:text-gray-100">{enEuros(cout.total)}</strong>
      </CardHeader>
      <CardBody className="space-y-3">
        <Section titre="Prestations déployées" lignes={cout.prestations} ton="text-gray-900 dark:text-gray-100" />
        <Section titre="Casse et matériel non revenu" lignes={cout.pertes} ton="text-red-600 dark:text-red-400" />

        {cout.en_attente_de_retour.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Sorti, pas encore revenu — non compté
            </p>
            <div className="space-y-1">
              {cout.en_attente_de_retour.map((ligne, i) => (
                <div key={`${ligne.libelle}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-300">
                    {ligne.libelle}
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{ligne.motif}</span>
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">{enEuros(ligne.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(cout.total_prestations > 0 || cout.total_pertes > 0) && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-600 dark:text-gray-300">
              Prestations : <strong>{enEuros(cout.total_prestations)}</strong>
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Pertes : <strong>{enEuros(cout.total_pertes)}</strong>
            </span>
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {cout.definitif
            ? 'Décompte définitif : la manifestation est récupérée, ce qui n’est pas revenu ne reviendra plus.'
            : 'Décompte provisoire : ce qui est sorti ne sera compté comme perdu qu’une fois la manifestation récupérée.'}
        </p>
      </CardBody>
    </Card>
  )
}
