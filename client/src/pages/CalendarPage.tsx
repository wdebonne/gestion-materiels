import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select, LoadingInline } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface CalendarEvent {
  id: number
  title: string
  description?: string
  startDate: string
  endDate?: string
  allDay: boolean
  color?: string
  objectId?: number
  objectName?: string
}

export default function CalendarPage() {
  const queryClient = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<CalendarEvent | null>(null)
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    end: new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).toISOString()
  })

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    allDay: true,
    color: '#3B82F6',
    objectId: ''
  })

  // Récupérer les événements
  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['calendar-events', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.start.split('T')[0],
        endDate: dateRange.end.split('T')[0]
      })
      const response = await api.get(`/calendar?${params}`)
      return response.data.events || []
    }
  })

  // Récupérer les objets pour le select
  const { data: objectsData } = useQuery({
    queryKey: ['objects-all'],
    queryFn: async () => {
      const response = await api.get('/objects?limit=1000')
      return response.data.objects || []
    }
  })

  // Mutation pour créer/modifier
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        ...data,
        startDate: data.allDay 
          ? data.startDate 
          : `${data.startDate}T${data.startTime || '00:00'}`,
        endDate: data.endDate 
          ? (data.allDay ? data.endDate : `${data.endDate}T${data.endTime || '23:59'}`)
          : null,
        objectId: data.objectId ? parseInt(data.objectId) : null
      }
      delete payload.startTime
      delete payload.endTime

      if (editingEvent) {
        return api.put(`/calendar/${editingEvent.id}`, payload)
      }
      return api.post('/calendar', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      toast.success(editingEvent ? 'Événement modifié' : 'Événement créé')
      closeModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Une erreur est survenue')
    }
  })

  // Mutation pour supprimer
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/calendar/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      toast.success('Événement supprimé')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression')
    }
  })

  const openModal = (event?: CalendarEvent, date?: string) => {
    if (event) {
      setEditingEvent(event)
      const startParts = event.startDate.split('T')
      const endParts = event.endDate?.split('T')
      
      setFormData({
        title: event.title,
        description: event.description || '',
        startDate: startParts[0],
        startTime: startParts[1]?.substring(0, 5) || '',
        endDate: endParts?.[0] || '',
        endTime: endParts?.[1]?.substring(0, 5) || '',
        allDay: event.allDay,
        color: event.color || '#3B82F6',
        objectId: event.objectId?.toString() || ''
      })
    } else {
      setEditingEvent(null)
      setFormData({
        title: '',
        description: '',
        startDate: date || new Date().toISOString().split('T')[0],
        startTime: '09:00',
        endDate: '',
        endTime: '10:00',
        allDay: true,
        color: '#3B82F6',
        objectId: ''
      })
    }
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingEvent(null)
    setFormData({
      title: '',
      description: '',
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
      allDay: true,
      color: '#3B82F6',
      objectId: ''
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const handleDateClick = (info: any) => {
    openModal(undefined, info.dateStr)
  }

  const handleEventClick = (info: any) => {
    const event = eventsData?.find((e: CalendarEvent) => e.id === parseInt(info.event.id))
    if (event) {
      openModal(event)
    }
  }

  const handleDatesSet = (info: any) => {
    setDateRange({
      start: info.start.toISOString(),
      end: info.end.toISOString()
    })
  }

  // Convertir les événements pour FullCalendar
  const calendarEvents = eventsData?.map((event: CalendarEvent) => ({
    id: String(event.id),
    title: event.title,
    start: event.startDate,
    end: event.endDate,
    allDay: event.allDay,
    backgroundColor: event.color || '#3B82F6',
    borderColor: event.color || '#3B82F6',
    extendedProps: {
      description: event.description,
      objectName: event.objectName
    }
  })) || []

  const colorOptions = [
    { value: '#3B82F6', label: 'Bleu' },
    { value: '#10B981', label: 'Vert' },
    { value: '#F59E0B', label: 'Orange' },
    { value: '#EF4444', label: 'Rouge' },
    { value: '#8B5CF6', label: 'Violet' },
    { value: '#EC4899', label: 'Rose' },
    { value: '#6B7280', label: 'Gris' }
  ]

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendrier</h1>
          <p className="text-gray-500 mt-1">Gérez vos événements et échéances</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
          Nouvel événement
        </Button>
      </div>

      {/* Calendrier */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {isLoading ? (
          <LoadingInline message="Chargement du calendrier..." />
        ) : (
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            locale={frLocale}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay'
            }}
            events={calendarEvents}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            datesSet={handleDatesSet}
            editable={false}
            selectable={true}
            selectMirror={true}
            dayMaxEvents={true}
            weekends={true}
            height="auto"
            eventDisplay="block"
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              meridiem: false,
              hour12: false
            }}
          />
        )}
      </div>

      {/* Modal création/édition */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingEvent ? 'Modifier l\'événement' : 'Nouvel événement'}
        size="lg"
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Titre"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Titre de l'événement"
              required
              autoFocus
            />

            <TextArea
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description (optionnel)"
              rows={3}
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allDay"
                checked={formData.allDay}
                onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="allDay" className="text-sm text-gray-700">
                Journée entière
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date de début"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
              {!formData.allDay && (
                <Input
                  label="Heure de début"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date de fin"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              />
              {!formData.allDay && (
                <Input
                  label="Heure de fin"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Couleur
                </label>
                <div className="flex gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${
                        formData.color === color.value 
                          ? 'border-gray-900 scale-110' 
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <Select
                label="Lier à un matériel"
                value={formData.objectId}
                onChange={(e) => setFormData({ ...formData, objectId: e.target.value })}
                options={[
                  { value: '', label: 'Aucun' },
                  ...(objectsData?.map((obj: any) => ({
                    value: String(obj.id),
                    label: obj.name
                  })) || [])
                ]}
              />
            </div>
          </ModalBody>

          <ModalFooter>
            {editingEvent && (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setIsModalOpen(false)
                  setDeleteConfirm(editingEvent)
                }}
                className="mr-auto"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={closeModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveMutation.isPending}>
              {editingEvent ? 'Modifier' : 'Créer'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer l'événement"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer l'événement <strong>{deleteConfirm?.title}</strong> ?
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
