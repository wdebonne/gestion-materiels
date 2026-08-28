import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Plus, Check, RotateCcw, X, Search } from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalFooter, Card, CardBody, LoadingInline } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/utils'
import Can from '@/components/Can'
import { usePermissions } from '@/lib/permissions'

const statusLabels: Record<string, string> = {
  pending: 'Demande à valider',
  reserved: 'Réservé',
  borrowed: 'En prêt',
  returned: 'Retourné',
  cancelled: 'Annulé',
  overdue: 'En retard'
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  reserved: 'bg-blue-100 text-blue-800',
  borrowed: 'bg-yellow-100 text-yellow-800',
  returned: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  overdue: 'bg-red-100 text-red-800'
}

export default function ReservationsPage() {
  const queryClient = useQueryClient()
  const { canManage: isSupervisor } = usePermissions()
  const [showModal, setShowModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    objectId: '',
    userId: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    reason: ''
  })

  // Charger les réservations
  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ['reservations', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.append('status', statusFilter)
      const res = await api.get(`/reservations?${params.toString()}`)
      return res.data.data
    }
  })

  // Charger les objets pour le formulaire
  const { data: objects = [] } = useQuery({
    queryKey: ['all-objects-for-reservation'],
    queryFn: async () => {
      const res = await api.get('/objects?limit=1000')
      return res.data.data || res.data
    },
    enabled: showModal
  })

  // Charger les utilisateurs pour le formulaire
  const { data: users = [] } = useQuery({
    queryKey: ['all-users-for-reservation'],
    queryFn: async () => {
      const res = await api.get('/users')
      return res.data.data || res.data
    },
    enabled: showModal && isSupervisor
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/reservations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      setShowModal(false)
      setFormData({ objectId: '', userId: '', startDate: new Date().toISOString().split('T')[0], endDate: '', reason: '' })
      toast.success('Réservation créée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la création')
    }
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.put(`/reservations/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      toast.success('Statut mis à jour')
    },
    onError: () => toast.error('Erreur lors de la mise à jour')
  })

  const filtered = reservations.filter((r: any) => {
    if (!search) return true
    const s = search.toLowerCase()
    return r.object_name?.toLowerCase().includes(s) ||
      r.borrower_first_name?.toLowerCase().includes(s) ||
      r.borrower_last_name?.toLowerCase().includes(s) ||
      r.reason?.toLowerCase().includes(s)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <CalendarClock className="w-7 h-7 text-primary-600" />
            Réservations & Prêts
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gérer les emprunts et réservations de matériel</p>
        </div>
        <Can fieldWrite>
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {isSupervisor ? 'Nouvelle réservation' : 'Demander du matériel'}
          </Button>
        </Can>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="">Tous les statuts</option>
          <option value="pending">Demande à valider</option>
          <option value="reserved">Réservé</option>
          <option value="borrowed">En prêt</option>
          <option value="returned">Retourné</option>
          <option value="overdue">En retard</option>
          <option value="cancelled">Annulé</option>
        </select>
      </div>

      {/* Liste */}
      {isLoading ? (
        <LoadingInline />
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">Aucune réservation trouvée</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r: any) => (
            <Card key={r.id}>
              <CardBody>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{r.object_name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Emprunteur : {r.borrower_first_name} {r.borrower_last_name}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Du {formatDate(r.start_date)} au {formatDate(r.end_date)}
                    </p>
                    {r.reason && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{r.reason}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[r.status]}`}>
                      {statusLabels[r.status]}
                    </span>
                    {isSupervisor && r.status === 'pending' && (
                      <Button size="sm" onClick={() => statusMutation.mutate({ id: r.id, status: 'reserved' })}>
                        <Check className="w-3 h-3 mr-1" /> Valider
                      </Button>
                    )}
                    {isSupervisor && r.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: r.id, status: 'cancelled' })}>
                        <X className="w-3 h-3 mr-1" /> Refuser
                      </Button>
                    )}
                    {isSupervisor && r.status === 'reserved' && (
                      <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: r.id, status: 'borrowed' })}>
                        <Check className="w-3 h-3 mr-1" /> En prêt
                      </Button>
                    )}
                    {isSupervisor && (r.status === 'borrowed' || r.status === 'overdue') && (
                      <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: r.id, status: 'returned' })}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Retourné
                      </Button>
                    )}
                    {isSupervisor && r.status === 'reserved' && (
                      <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: r.id, status: 'cancelled' })}>
                        <X className="w-3 h-3 mr-1" /> Annuler
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de création */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nouvelle réservation">
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Matériel</label>
              <select
                value={formData.objectId}
                onChange={(e) => setFormData({ ...formData, objectId: e.target.value })}
                required
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              >
                <option value="">Sélectionner un matériel</option>
                {(Array.isArray(objects) ? objects : []).map((o: any) => (
                  <option key={o.id} value={o.id}>{o.name}{o.reference ? ` (${o.reference})` : ''}</option>
                ))}
              </select>
            </div>
            {isSupervisor ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Emprunteur</label>
                <select
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  required
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">Sélectionner un utilisateur</option>
                  {(Array.isArray(users) ? users : []).map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName || u.first_name} {u.lastName || u.last_name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                La demande sera enregistrée à votre nom et transmise à votre responsable
                pour validation.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Date de début"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
              <Input
                label="Date de fin"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                required
              />
            </div>
            <Input
              label="Motif"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Motif de l'emprunt"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowModal(false)}>Annuler</Button>
          <Button
            onClick={() => createMutation.mutate({
              objectId: Number(formData.objectId),
              userId: Number(formData.userId),
              startDate: formData.startDate,
              endDate: formData.endDate,
              reason: formData.reason
            })}
            disabled={!formData.objectId || !formData.userId || !formData.startDate || !formData.endDate || createMutation.isPending}
          >
            {createMutation.isPending ? 'Création...' : 'Créer'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
