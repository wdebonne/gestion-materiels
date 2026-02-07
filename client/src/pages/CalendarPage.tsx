import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { 
  Plus, Trash2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  List, Grid3X3, Clock, RefreshCw, Settings, Cloud, CloudOff,
  Filter, Search, X, ExternalLink
} from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select, LoadingInline, Badge } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, startOfWeek, endOfWeek, addYears, subYears } from 'date-fns'
import { fr } from 'date-fns/locale'

interface CalendarEvent {
  id: number
  title: string
  description?: string
  startDate: string
  start?: string
  endDate?: string
  end?: string
  allDay: boolean
  color?: string
  objectId?: number
  objectName?: string
  eventType?: string
  source?: 'local' | 'outlook' | 'caldav'
  externalId?: string
}

interface SyncStatus {
  outlook: { connected: boolean; lastSync?: string; email?: string }
  caldav: { connected: boolean; lastSync?: string; server?: string }
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default function CalendarPage() {
  const queryClient = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<CalendarEvent | null>(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [currentView, setCurrentView] = useState<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'>('dayGridMonth')
  const [showMiniCalendar, setShowMiniCalendar] = useState(true)
  const [showSyncSettings, setShowSyncSettings] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterEventType, setFilterEventType] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  const [dateRange, setDateRange] = useState({
    start: startOfMonth(subMonths(new Date(), 1)).toISOString(),
    end: endOfMonth(addMonths(new Date(), 2)).toISOString()
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
    objectId: '',
    eventType: 'other'
  })

  // Récupérer les événements
  const { data: eventsData, isLoading, refetch } = useQuery({
    queryKey: ['calendar-events', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.start.split('T')[0],
        endDate: dateRange.end.split('T')[0]
      })
      const response = await api.get(`/calendar?${params}`)
      return response.data.events || []
    },
    staleTime: 30000, // Considérer les données comme fraîches pendant 30 secondes
    refetchOnMount: true
  })

  // Récupérer le statut de synchronisation
  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ['calendar-sync-status'],
    queryFn: async () => {
      try {
        const response = await api.get('/calendar/sync/status')
        return response.data
      } catch {
        return {
          outlook: { connected: false },
          caldav: { connected: false }
        }
      }
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

  // Événements du jour sélectionné
  const selectedDayEvents = useMemo(() => {
    if (!selectedDate || !eventsData) return []
    return eventsData.filter((event: CalendarEvent) => {
      const eventDate = new Date(event.startDate || event.start || '')
      return isSameDay(eventDate, selectedDate)
    })
  }, [selectedDate, eventsData])

  // Événements filtrés
  const filteredEvents = useMemo(() => {
    if (!eventsData) return []
    let filtered = eventsData
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((e: CalendarEvent) => 
        e.title.toLowerCase().includes(query) ||
        e.description?.toLowerCase().includes(query) ||
        e.objectName?.toLowerCase().includes(query)
      )
    }
    
    if (filterEventType) {
      filtered = filtered.filter((e: CalendarEvent) => e.eventType === filterEventType)
    }
    
    return filtered
  }, [eventsData, searchQuery, filterEventType])

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

  // Synchronisation manuelle
  const handleSync = async () => {
    setIsSyncing(true)
    try {
      await api.post('/calendar/sync')
      await refetch()
      toast.success('Calendrier synchronisé')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur de synchronisation')
    } finally {
      setIsSyncing(false)
    }
  }

  const openModal = (event?: CalendarEvent, date?: string) => {
    if (event) {
      // Ne pas permettre l'édition des événements externes
      if (event.source && event.source !== 'local') {
        toast.error('Les événements synchronisés ne peuvent pas être modifiés ici')
        return
      }
      setEditingEvent(event)
      const eventStart = event.startDate || event.start || ''
      const eventEnd = event.endDate || event.end
      const startParts = eventStart.split('T')
      const endParts = eventEnd?.split('T')
      
      setFormData({
        title: event.title,
        description: event.description || '',
        startDate: startParts[0],
        startTime: startParts[1]?.substring(0, 5) || '',
        endDate: endParts?.[0] || '',
        endTime: endParts?.[1]?.substring(0, 5) || '',
        allDay: event.allDay,
        color: event.color || '#3B82F6',
        objectId: event.objectId?.toString() || '',
        eventType: event.eventType || 'other'
      })
    } else {
      setEditingEvent(null)
      setFormData({
        title: '',
        description: '',
        startDate: date || format(new Date(), 'yyyy-MM-dd'),
        startTime: '09:00',
        endDate: '',
        endTime: '10:00',
        allDay: true,
        color: '#3B82F6',
        objectId: '',
        eventType: 'other'
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
      objectId: '',
      eventType: 'other'
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const handleDateClick = (info: any) => {
    setSelectedDate(new Date(info.dateStr))
  }

  const handleEventClick = (info: any) => {
    const event = eventsData?.find((e: CalendarEvent) => e.id === parseInt(info.event.id))
    if (event) {
      openModal(event)
    }
  }

  const handleDatesSet = (info: any) => {
    // Ne mettre à jour que si la plage a vraiment changé pour éviter les re-renders inutiles
    const newStart = info.start.toISOString()
    const newEnd = info.end.toISOString()
    
    setDateRange(prev => {
      if (prev.start !== newStart || prev.end !== newEnd) {
        return { start: newStart, end: newEnd }
      }
      return prev
    })
    
    if (!isInitialized) {
      setIsInitialized(true)
    }
  }

  // Navigation du calendrier
  const navigateToDate = (date: Date) => {
    setCurrentDate(date)
    const calendarApi = calendarRef.current?.getApi()
    if (calendarApi) {
      calendarApi.gotoDate(date)
    }
  }

  const goToToday = () => {
    const today = new Date()
    navigateToDate(today)
    setSelectedDate(today)
  }

  const goToPrevMonth = () => navigateToDate(subMonths(currentDate, 1))
  const goToNextMonth = () => navigateToDate(addMonths(currentDate, 1))
  const goToPrevYear = () => navigateToDate(subYears(currentDate, 1))
  const goToNextYear = () => navigateToDate(addYears(currentDate, 1))

  const changeView = (view: typeof currentView) => {
    setCurrentView(view)
    const calendarApi = calendarRef.current?.getApi()
    if (calendarApi) {
      calendarApi.changeView(view)
    }
  }

  // Générer les jours du mini-calendrier
  const miniCalendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [currentDate])

  // Compter les événements par jour pour le mini-calendrier
  const eventsByDay = useMemo(() => {
    const map = new Map<string, number>()
    eventsData?.forEach((event: CalendarEvent) => {
      const dateStr = (event.startDate || event.start || '').split('T')[0]
      map.set(dateStr, (map.get(dateStr) || 0) + 1)
    })
    return map
  }, [eventsData])

  // Convertir les événements pour FullCalendar
  const calendarEvents = filteredEvents?.map((event: CalendarEvent) => ({
    id: String(event.id),
    title: event.title,
    start: event.startDate || event.start,
    end: event.endDate || event.end,
    allDay: event.allDay,
    backgroundColor: event.color || '#3B82F6',
    borderColor: event.color || '#3B82F6',
    classNames: event.source && event.source !== 'local' ? ['external-event'] : [],
    extendedProps: {
      description: event.description,
      objectName: event.objectName,
      source: event.source
    }
  })) || []

  const colorOptions = [
    { value: '#3B82F6', label: 'Bleu' },
    { value: '#10B981', label: 'Vert' },
    { value: '#F59E0B', label: 'Orange' },
    { value: '#EF4444', label: 'Rouge' },
    { value: '#8B5CF6', label: 'Violet' },
    { value: '#EC4899', label: 'Rose' },
    { value: '#06B6D4', label: 'Cyan' },
    { value: '#6B7280', label: 'Gris' }
  ]

  const eventTypes = [
    { value: '', label: 'Tous les types' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'meeting', label: 'Réunion' },
    { value: 'deadline', label: 'Échéance' },
    { value: 'reminder', label: 'Rappel' },
    { value: 'other', label: 'Autre' }
  ]

  const viewOptions = [
    { value: 'dayGridMonth', label: 'Mois', icon: Grid3X3 },
    { value: 'timeGridWeek', label: 'Semaine', icon: CalendarIcon },
    { value: 'timeGridDay', label: 'Jour', icon: Clock },
    { value: 'listWeek', label: 'Liste', icon: List }
  ]

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Barre d'outils supérieure */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Navigation du calendrier */}
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={goToToday}
              className="font-medium"
            >
              Aujourd'hui
            </Button>
            <div className="flex items-center border rounded-lg overflow-hidden">
              <button
                onClick={goToPrevYear}
                className="p-2 hover:bg-gray-100 text-gray-500 border-r"
                title="Année précédente"
              >
                <ChevronLeft className="w-4 h-4" />
                <ChevronLeft className="w-4 h-4 -ml-3" />
              </button>
              <button
                onClick={goToPrevMonth}
                className="p-2 hover:bg-gray-100 text-gray-600 border-r"
                title="Mois précédent"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-4 py-2 font-semibold text-gray-900 min-w-[180px] text-center capitalize">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </span>
              <button
                onClick={goToNextMonth}
                className="p-2 hover:bg-gray-100 text-gray-600 border-l"
                title="Mois suivant"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={goToNextYear}
                className="p-2 hover:bg-gray-100 text-gray-500 border-l"
                title="Année suivante"
              >
                <ChevronRight className="w-4 h-4" />
                <ChevronRight className="w-4 h-4 -ml-3" />
              </button>
            </div>
          </div>

          {/* Sélecteur de vue */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
            {viewOptions.map((view) => {
              const Icon = view.icon
              return (
                <button
                  key={view.value}
                  onClick={() => changeView(view.value as typeof currentView)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    currentView === view.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{view.label}</span>
                </button>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Recherche */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>

            {/* Filtres */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters || filterEventType ? 'bg-primary-50 text-primary-700' : ''}
            >
              <Filter className="w-4 h-4" />
            </Button>

            {/* Synchronisation */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              loading={isSyncing}
              title="Synchroniser le calendrier"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Paramètres sync */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSyncSettings(true)}
              title="Paramètres de synchronisation"
            >
              {syncStatus?.outlook?.connected || syncStatus?.caldav?.connected ? (
                <Cloud className="w-4 h-4 text-green-600" />
              ) : (
                <CloudOff className="w-4 h-4 text-gray-400" />
              )}
            </Button>

            {/* Nouveau événement */}
            <Button 
              size="sm"
              icon={<Plus className="w-4 h-4" />} 
              onClick={() => openModal()}
            >
              <span className="hidden sm:inline">Nouvel événement</span>
            </Button>
          </div>
        </div>

        {/* Barre de filtres */}
        {showFilters && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t">
            <Select
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
              options={eventTypes}
              className="w-48"
            />
            {filterEventType && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilterEventType('')}
              >
                <X className="w-4 h-4 mr-1" />
                Effacer les filtres
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Contenu principal */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Panneau latéral */}
        <div className={`bg-white border-r border-gray-200 transition-all duration-300 ${showMiniCalendar ? 'w-72' : 'w-0'} overflow-hidden flex-shrink-0`}>
          <div className="p-4 space-y-4 w-72">
            {/* Mini calendrier */}
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700 text-sm capitalize">
                  {format(currentDate, 'MMMM yyyy', { locale: fr })}
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={goToPrevMonth}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={goToNextMonth}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* En-têtes jours */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Jours */}
              <div className="grid grid-cols-7 gap-1">
                {miniCalendarDays.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const eventCount = eventsByDay.get(dateStr) || 0
                  const isCurrentMonth = isSameMonth(day, currentDate)
                  const isSelected = selectedDate && isSameDay(day, selectedDate)
                  const isTodayDate = isToday(day)
                  
                  return (
                    <button
                      key={dateStr}
                      onClick={() => {
                        setSelectedDate(day)
                        navigateToDate(day)
                      }}
                      className={`
                        relative aspect-square flex items-center justify-center text-sm rounded-lg transition-all
                        ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                        ${isSelected ? 'bg-primary-600 text-white' : ''}
                        ${isTodayDate && !isSelected ? 'bg-primary-100 text-primary-700 font-bold' : ''}
                        ${!isSelected && isCurrentMonth ? 'hover:bg-gray-200' : ''}
                      `}
                    >
                      {format(day, 'd')}
                      {eventCount > 0 && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-primary-500'
                        }`} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Événements du jour sélectionné */}
            {selectedDate && (
              <div>
                <h3 className="font-semibold text-gray-700 mb-2 text-sm capitalize">
                  {format(selectedDate, 'EEEE d MMMM', { locale: fr })}
                </h3>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    Aucun événement ce jour
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {selectedDayEvents.map((event: CalendarEvent) => (
                      <button
                        key={event.id}
                        onClick={() => openModal(event)}
                        className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div 
                            className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                            style={{ backgroundColor: event.color || '#3B82F6' }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 truncate">
                              {event.title}
                            </p>
                            {!event.allDay && (
                              <p className="text-xs text-gray-500">
                                {format(new Date(event.startDate || event.start || ''), 'HH:mm')}
                              </p>
                            )}
                            {event.objectName && (
                              <p className="text-xs text-primary-600 truncate">
                                {event.objectName}
                              </p>
                            )}
                            {event.source && event.source !== 'local' && (
                              <Badge variant="info" size="sm" className="mt-1">
                                {event.source === 'outlook' ? 'Outlook' : 'CalDAV'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openModal(undefined, format(selectedDate, 'yyyy-MM-dd'))}
                  className="w-full mt-2"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter un événement
                </Button>
              </div>
            )}

            {/* Statut de synchronisation */}
            <div className="border-t pt-4">
              <h3 className="font-semibold text-gray-700 mb-2 text-sm">Synchronisation</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Outlook</span>
                  {syncStatus?.outlook?.connected ? (
                    <Badge variant="success" size="sm">Connecté</Badge>
                  ) : (
                    <Badge variant="default" size="sm">Non connecté</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">CalDAV</span>
                  {syncStatus?.caldav?.connected ? (
                    <Badge variant="success" size="sm">Connecté</Badge>
                  ) : (
                    <Badge variant="default" size="sm">Non connecté</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSyncSettings(true)}
                  className="w-full mt-2"
                >
                  <Settings className="w-4 h-4 mr-1" />
                  Configurer
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Toggle panneau latéral */}
        <button
          onClick={() => setShowMiniCalendar(!showMiniCalendar)}
          className="absolute top-4 z-10 bg-white border rounded-r-lg p-1 shadow-sm hover:bg-gray-50 transition-all"
          style={{ left: showMiniCalendar ? '288px' : '0' }}
        >
          {showMiniCalendar ? (
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-600" />
          )}
        </button>

        {/* Calendrier principal */}
        <div className="flex-1 bg-white p-4 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <LoadingInline message="Chargement du calendrier..." />
            </div>
          ) : (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView={currentView}
              locale={frLocale}
              headerToolbar={false}
              events={calendarEvents}
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              datesSet={handleDatesSet}
              editable={false}
              selectable={true}
              selectMirror={true}
              dayMaxEvents={3}
              weekends={true}
              height="100%"
              eventDisplay="block"
              nowIndicator={true}
              eventTimeFormat={{
                hour: '2-digit',
                minute: '2-digit',
                meridiem: false,
                hour12: false
              }}
              dayHeaderFormat={{ weekday: 'short' }}
              moreLinkText={(num) => `+${num} autres`}
              moreLinkClick="popover"
            />
          )}
        </div>
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

            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Type d'événement"
                value={formData.eventType}
                onChange={(e) => setFormData({ ...formData, eventType: e.target.value })}
                options={eventTypes.filter(t => t.value !== '')}
              />
              
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.allDay}
                    onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Journée entière</span>
                </label>
              </div>
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
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        formData.color === color.value 
                          ? 'border-gray-900 scale-110 ring-2 ring-offset-2 ring-gray-400' 
                          : 'border-transparent hover:scale-105'
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

      {/* Modal paramètres de synchronisation */}
      <CalendarSyncSettings 
        isOpen={showSyncSettings}
        onClose={() => setShowSyncSettings(false)}
        syncStatus={syncStatus}
        onSync={handleSync}
      />
    </div>
  )
}

// Composant pour les paramètres de synchronisation
function CalendarSyncSettings({ 
  isOpen, 
  onClose, 
  syncStatus,
  onSync 
}: { 
  isOpen: boolean
  onClose: () => void
  syncStatus?: SyncStatus
  onSync: () => void
}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'outlook' | 'caldav'>('outlook')
  const [outlookConfig, setOutlookConfig] = useState({
    clientId: '',
    clientSecret: '',
    tenantId: '',
    enabled: false
  })
  const [caldavConfig, setCaldavConfig] = useState({
    serverUrl: '',
    username: '',
    password: '',
    calendarPath: '',
    enabled: false
  })

  // Charger la configuration existante
  useEffect(() => {
    if (isOpen) {
      api.get('/calendar/sync/config').then((res) => {
        if (res.data.outlook) {
          setOutlookConfig(prev => ({ ...prev, ...res.data.outlook }))
        }
        if (res.data.caldav) {
          setCaldavConfig(prev => ({ ...prev, ...res.data.caldav }))
        }
      }).catch(() => {})
    }
  }, [isOpen])

  const saveOutlookConfig = async () => {
    try {
      await api.post('/calendar/sync/outlook/config', outlookConfig)
      toast.success('Configuration Outlook enregistrée')
      queryClient.invalidateQueries({ queryKey: ['calendar-sync-status'] })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde')
    }
  }

  const saveCaldavConfig = async () => {
    try {
      await api.post('/calendar/sync/caldav/config', caldavConfig)
      toast.success('Configuration CalDAV enregistrée')
      queryClient.invalidateQueries({ queryKey: ['calendar-sync-status'] })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde')
    }
  }

  const testConnection = async (type: 'outlook' | 'caldav') => {
    try {
      await api.post(`/calendar/sync/${type}/test`)
      toast.success('Connexion réussie !')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur de connexion')
    }
  }

  const disconnectService = async (type: 'outlook' | 'caldav') => {
    try {
      await api.delete(`/calendar/sync/${type}`)
      toast.success('Déconnecté')
      queryClient.invalidateQueries({ queryKey: ['calendar-sync-status'] })
      if (type === 'outlook') {
        setOutlookConfig(prev => ({ ...prev, enabled: false }))
      } else {
        setCaldavConfig(prev => ({ ...prev, enabled: false }))
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Synchronisation du calendrier"
      size="lg"
    >
      <ModalBody className="space-y-4">
        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('outlook')}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'outlook'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.57-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V12zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z"/>
            </svg>
            Microsoft Outlook
            {syncStatus?.outlook?.connected && (
              <Badge variant="success" size="sm">Connecté</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('caldav')}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'caldav'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <CalendarIcon className="w-5 h-5" />
            CalDAV
            {syncStatus?.caldav?.connected && (
              <Badge variant="success" size="sm">Connecté</Badge>
            )}
          </button>
        </div>

        {/* Outlook Configuration */}
        {activeTab === 'outlook' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-800 mb-2">Configuration Microsoft Outlook</h4>
              <p className="text-sm text-blue-700">
                Pour synchroniser avec Outlook, vous devez créer une application dans le portail Azure AD.{' '}
                <a 
                  href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center gap-1"
                >
                  Accéder au portail Azure <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            <Input
              label="Client ID (Application ID)"
              value={outlookConfig.clientId}
              onChange={(e) => setOutlookConfig({ ...outlookConfig, clientId: e.target.value })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />

            <Input
              label="Client Secret"
              type="password"
              value={outlookConfig.clientSecret}
              onChange={(e) => setOutlookConfig({ ...outlookConfig, clientSecret: e.target.value })}
              placeholder="Votre secret client"
            />

            <Input
              label="Tenant ID"
              value={outlookConfig.tenantId}
              onChange={(e) => setOutlookConfig({ ...outlookConfig, tenantId: e.target.value })}
              placeholder="common ou votre ID de tenant"
            />

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={outlookConfig.enabled}
                onChange={(e) => setOutlookConfig({ ...outlookConfig, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Activer la synchronisation Outlook</span>
            </label>

            <div className="flex gap-2 pt-2">
              <Button onClick={saveOutlookConfig}>
                Enregistrer
              </Button>
              <Button variant="secondary" onClick={() => testConnection('outlook')}>
                Tester la connexion
              </Button>
              {syncStatus?.outlook?.connected && (
                <Button variant="danger" onClick={() => disconnectService('outlook')}>
                  Déconnecter
                </Button>
              )}
            </div>
          </div>
        )}

        {/* CalDAV Configuration */}
        {activeTab === 'caldav' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-medium text-green-800 mb-2">Configuration CalDAV</h4>
              <p className="text-sm text-green-700">
                CalDAV est compatible avec de nombreux services : Nextcloud, Synology, iCloud, Google Calendar, etc.
              </p>
            </div>

            <Input
              label="URL du serveur CalDAV"
              value={caldavConfig.serverUrl}
              onChange={(e) => setCaldavConfig({ ...caldavConfig, serverUrl: e.target.value })}
              placeholder="https://example.com/remote.php/dav"
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Nom d'utilisateur"
                value={caldavConfig.username}
                onChange={(e) => setCaldavConfig({ ...caldavConfig, username: e.target.value })}
                placeholder="utilisateur"
              />

              <Input
                label="Mot de passe"
                type="password"
                value={caldavConfig.password}
                onChange={(e) => setCaldavConfig({ ...caldavConfig, password: e.target.value })}
                placeholder="Mot de passe ou token"
              />
            </div>

            <Input
              label="Chemin du calendrier (optionnel)"
              value={caldavConfig.calendarPath}
              onChange={(e) => setCaldavConfig({ ...caldavConfig, calendarPath: e.target.value })}
              placeholder="/calendars/users/user/calendar"
            />

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={caldavConfig.enabled}
                onChange={(e) => setCaldavConfig({ ...caldavConfig, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Activer la synchronisation CalDAV</span>
            </label>

            <div className="flex gap-2 pt-2">
              <Button onClick={saveCaldavConfig}>
                Enregistrer
              </Button>
              <Button variant="secondary" onClick={() => testConnection('caldav')}>
                Tester la connexion
              </Button>
              {syncStatus?.caldav?.connected && (
                <Button variant="danger" onClick={() => disconnectService('caldav')}>
                  Déconnecter
                </Button>
              )}
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
        <Button onClick={onSync}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Synchroniser maintenant
        </Button>
      </ModalFooter>
    </Modal>
  )
}
