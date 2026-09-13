import { useState, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
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
  Filter, Search, X
} from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalFooter, TextArea, Select, Autocomplete, LoadingInline, Badge } from '@/components/ui'
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

/**
 * Ce que les carnets externes ont donné au dernier passage.
 *
 * Une liste, et non plus un couple Outlook/CalDAV figé : il n'y a plus « un »
 * agenda externe mais autant que la commune en branche — le carnet du service
 * technique, celui des espaces verts, celui du régisseur des salles.
 */
interface AgendaExterne {
  id: number
  name: string
  kind: 'caldav' | 'outlook'
  direction: 'import' | 'export' | 'deux_sens'
  enabled: boolean
  lastSync: string | null
  lastError: string | null
  color: string
}

interface SyncStatus {
  agendas: AgendaExterne[]
  enErreur: number
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
  const [showMiniCalendar, setShowMiniCalendar] = useState(() => window.innerWidth >= 1024)
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
        return { agendas: [], enErreur: 0 }
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
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 sm:px-6 py-2 sm:py-3 min-h-[44px]">
        {/* Ligne 1 : Navigation + titre */}
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Navigation du calendrier */}
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            {/* Toggle mini-calendrier mobile */}
            <button
              onClick={() => setShowMiniCalendar(!showMiniCalendar)}
              className="lg:hidden h-11 w-11 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
              title="Mini-calendrier" aria-label="Mini-calendrier"
            >
              <CalendarIcon className="w-4 h-4" />
            </button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={goToToday}
              className="font-medium text-xs sm:text-sm whitespace-nowrap"
            >
              Aujourd'hui
            </Button>
            <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <button aria-label="Année précédente"
                onClick={goToPrevYear}
                className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border-r border-gray-300 dark:border-gray-600 hidden sm:block touch-target"
                title="Année précédente"
              >
                <ChevronLeft className="w-4 h-4" />
                <ChevronLeft className="w-4 h-4 -ml-3" />
              </button>
              <button aria-label="Mois précédent"
                onClick={goToPrevMonth}
                className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 sm:border-r border-gray-300 dark:border-gray-600 touch-target"
                title="Mois précédent"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 sm:px-4 py-1.5 sm:py-2 font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base text-center capitalize whitespace-nowrap min-h-[44px]">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </span>
              <button aria-label="Mois suivant"
                onClick={goToNextMonth}
                className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 sm:border-l border-gray-300 dark:border-gray-600 touch-target"
                title="Mois suivant"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button aria-label="Année suivante"
                onClick={goToNextYear}
                className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 hidden sm:block touch-target"
                title="Année suivante"
              >
                <ChevronRight className="w-4 h-4" />
                <ChevronRight className="w-4 h-4 -ml-3" />
              </button>
            </div>
          </div>

          {/* Actions (toujours visibles) */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Synchronisation */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              loading={isSyncing}
              title="Synchroniser le calendrier" aria-label="Synchroniser le calendrier"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Paramètres sync */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSyncSettings(true)}
              title="Paramètres de synchronisation" aria-label="Paramètres de synchronisation"
              className="hidden sm:flex"
            >
              {/* Un carnet en panne se voit sans ouvrir les réglages. */}
              {(syncStatus?.enErreur ?? 0) > 0 ? (
                <CloudOff className="w-4 h-4 text-red-600" />
              ) : (syncStatus?.agendas ?? []).some((a) => a.enabled) ? (
                <Cloud className="w-4 h-4 text-green-600" />
              ) : (
                <CloudOff className="w-4 h-4 text-gray-600 dark:text-gray-300" />
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

        {/* Ligne 2 : Vue + Recherche/Filtres */}
        <div className="flex items-center justify-between gap-2 mt-2">
          {/* Sélecteur de vue */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 sm:p-1 rounded-lg overflow-x-auto touch-target">
            {viewOptions.map((view) => {
              const Icon = view.icon
              return (
                <button
                  key={view.value}
                  onClick={() => changeView(view.value as typeof currentView)}
                  className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                    currentView === view.value
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">{view.label}</span>
                </button>
              )
            })}
          </div>

          {/* Recherche + Filtres */}
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 rounded-lg text-sm w-36 lg:w-48 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target"
                >
                  <X className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                </button>
              )}
            </div>

            {/* Filtres */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters || filterEventType ? 'bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : ''}
            >
              <Filter className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Barre de filtres */}
        {showFilters && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            {/* Recherche mobile (visible uniquement sur mobile) */}
            <div className="relative sm:hidden w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-target"
                >
                  <X className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                </button>
              )}
            </div>
            <Select
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
              options={eventTypes}
              className="w-full sm:w-48"
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
        {/* Overlay mobile pour fermer le panneau */}
        {showMiniCalendar && (
          <div 
            className="fixed inset-0 bg-black/20 z-20 lg:hidden" 
            onClick={() => setShowMiniCalendar(false)} 
          />
        )}

        {/* Panneau latéral */}
        <div className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex-shrink-0
          ${showMiniCalendar ? 'w-72' : 'w-0'}
          ${showMiniCalendar ? 'fixed inset-y-0 left-0 z-30 lg:relative lg:z-auto shadow-xl lg:shadow-none mt-[var(--toolbar-height,0px)] lg:mt-0' : ''}
          overflow-hidden`}>
          <div className="p-4 space-y-4 w-72">
            {/* Mini calendrier */}
            <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm capitalize">
                  {format(currentDate, 'MMMM yyyy', { locale: fr })}
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={goToPrevMonth}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded touch-target"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={goToNextMonth}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded touch-target"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* En-têtes jours */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
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
                        // Fermer le panneau sur mobile après sélection
                        if (window.innerWidth < 1024) {
                          setShowMiniCalendar(false)
                        }
                      }}
                      className={`
                        relative aspect-square flex items-center justify-center text-sm rounded-lg transition-all
                        ${!isCurrentMonth ? 'text-gray-600 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}
                        ${isSelected ? 'bg-primary-600 text-white' : ''}
                        ${isTodayDate && !isSelected ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-200 font-bold' : ''}
                        ${!isSelected && isCurrentMonth ? 'hover:bg-gray-200 dark:hover:bg-gray-700' : ''}
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
                <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2 text-sm capitalize">
                  {format(selectedDate, 'EEEE d MMMM', { locale: fr })}
                </h3>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                    Aucun événement ce jour
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {selectedDayEvents.map((event: CalendarEvent) => (
                      <button
                        key={event.id}
                        onClick={() => openModal(event)}
                        className="w-full text-left h-11 w-11 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div 
                            className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                            style={{ backgroundColor: event.color || '#3B82F6' }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                              {event.title}
                            </p>
                            {!event.allDay && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
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
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2 text-sm">Synchronisation</h3>
              <div className="space-y-2">
                {(syncStatus?.agendas ?? []).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Aucun agenda branché</p>
                )}
                {(syncStatus?.agendas ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-gray-600 dark:text-gray-300">{a.name}</span>
                    {a.lastError ? (
                      <Badge variant="danger" size="sm">En erreur</Badge>
                    ) : a.enabled ? (
                      <Badge variant="success" size="sm">Actif</Badge>
                    ) : (
                      <Badge variant="default" size="sm">Désactivé</Badge>
                    )}
                  </div>
                ))}
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
          className={`absolute top-4 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-r-lg p-1.5 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
            showMiniCalendar ? 'hidden lg:block' : ''
          }`}
          style={{ left: showMiniCalendar ? '288px' : '0' }}
        >
          {showMiniCalendar ? (
            <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          )}
        </button>

        {/* Calendrier principal */}
        <div className="flex-1 bg-white dark:bg-gray-800 p-1 sm:p-2 md:p-4 overflow-auto min-w-0 touch-target">
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
              dayMaxEvents={window.innerWidth < 640 ? 2 : 3}
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
              dayHeaderFormat={{ weekday: window.innerWidth < 640 ? 'narrow' : 'short' }}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">Journée entière</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                  Couleur
                </label>
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map((color) => (
                    <button aria-label={color.label}
                      key={color.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        formData.color === color.value 
                          ? 'border-gray-900 dark:border-white scale-110 ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-800' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <Autocomplete
                label="Lier à un matériel"
                value={formData.objectId}
                onChange={(value) => setFormData({ ...formData, objectId: value })}
                placeholder="Aucun"
                emptyMessage="Aucun matériel trouvé"
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
          <p className="text-gray-600 dark:text-gray-300">
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

/**
 * Ce que les carnets externes ont donné, et de quoi les faire passer.
 *
 * Ne configure plus rien : il n'y a plus « un » agenda externe mais autant que
 * la commune en branche, chacun avec ses identifiants et son aiguillage. Les
 * régler tient d'un écran d'administration, pas d'une fenêtre ouverte au-dessus
 * du calendrier — et les dupliquer ici ferait deux endroits où la même chose se
 * modifie.
 *
 * La **vue du calendrier ne change pas** : elle montre tout ce que le compte a
 * le droit de voir. L'aiguillage décide de ce qui sort vers les carnets, jamais
 * de ce qui s'affiche ici.
 */
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
  const agendas = syncStatus?.agendas ?? []

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agendas externes" size="md">
      <ModalBody>
        {agendas.length === 0 ? (
          <div className="py-8 text-center">
            <CloudOff className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Aucun agenda externe n’est branché.
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500 dark:text-gray-400">
              Un agenda externe reçoit les échéances que vous lui désignez — les entretiens d’une
              catégorie, les chantiers des espaces verts — et peut en retour afficher ici ses
              propres rendez-vous.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {agendas.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <span
                  className="mt-1 h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: a.enabled ? a.color : '#cbd5e1' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {a.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {a.kind === 'caldav' ? 'CalDAV' : 'Outlook'} ·{' '}
                    {a.direction === 'export'
                      ? 'envoi'
                      : a.direction === 'import'
                        ? 'réception'
                        : 'les deux sens'}
                    {a.lastSync ? ` · dernier passage le ${format(new Date(a.lastSync), 'd MMMM yyyy', { locale: fr })}` : ' · jamais passé'}
                  </p>
                  {a.lastError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{a.lastError}</p>
                  )}
                </div>
                {!a.enabled && (
                  <Badge variant="default" size="sm">
                    Désactivé
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Le calendrier ci-dessous continue d’afficher tout ce que vos droits vous permettent de
          voir. Ce qui part vers un agenda externe se règle séparément, carnet par carnet.
        </p>
      </ModalBody>

      <ModalFooter>
        <Link
          to="/settings/agendas"
          onClick={onClose}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <Settings className="h-4 w-4" />
          Configurer les agendas
        </Link>
        <div className="flex-1" />
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
        <Button onClick={onSync} disabled={agendas.length === 0}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Synchroniser maintenant
        </Button>
      </ModalFooter>
    </Modal>
  )
}
