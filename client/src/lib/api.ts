import axios from 'axios'
import { useAuthStore } from '@/stores/auth.store'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Intercepteur pour ajouter le token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Intercepteur pour gérer les erreurs
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Si erreur 401 et pas déjà tenté de refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const refreshToken = useAuthStore.getState().refreshToken
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken })
          const { accessToken, refreshToken: newRefreshToken } = response.data
          
          useAuthStore.getState().setTokens(accessToken, newRefreshToken)
          originalRequest.headers.Authorization = `Bearer ${accessToken}`
          
          return api(originalRequest)
        } catch (refreshError) {
          useAuthStore.getState().logout()
          window.location.href = '/login'
          return Promise.reject(refreshError)
        }
      } else {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  }
)

export default api

// Types
export interface User {
  id: number
  email: string
  firstName?: string
  lastName?: string
  role: 'admin' | 'supervisor' | 'user'
  avatar?: string
  isActive: boolean
  createdAt: string
  lastLogin?: string
}

export interface Category {
  id: number
  name: string
  slug: string
  description?: string
  image?: string
  hasSubcategories: boolean
  sortOrder: number
  objectCount?: number
  subcategoryCount?: number
  createdAt: string
  updatedAt: string
}

export interface Subcategory {
  id: number
  categoryId: number
  name: string
  slug: string
  image?: string
  sortOrder: number
  objectCount?: number
  createdAt: string
  updatedAt: string
}

export interface GestionObject {
  id: number
  categoryId?: number
  categoryName?: string
  categorySlug?: string
  subcategoryId?: number
  subcategoryName?: string
  subcategorySlug?: string
  name: string
  description?: string
  image?: string
  reference?: string
  serialNumber?: string
  purchaseDate?: string
  purchasePrice?: number
  status: 'active' | 'inactive' | 'maintenance' | 'out_of_service'
  location?: string
  notes?: string
  customFields?: Record<string, any>
  createdAt: string
  updatedAt: string
  plugins?: Plugin[]
  pluginData?: Record<string, any[]>
  alerts?: Alert[]
}

export interface Plugin {
  id: number
  name: string
  slug: string
  version: string
  description?: string
  author?: string
  icon?: string
  isActive: boolean
  isSystem: boolean
  config: Record<string, any>
  associations?: PluginAssociation[]
  createdAt: string
  updatedAt: string
}

export interface PluginAssociation {
  id: number
  categoryId?: number
  categoryName?: string
  subcategoryId?: number
  subcategoryName?: string
}

export interface CalendarEvent {
  id: number
  title: string
  description?: string
  eventType: string
  start: string
  end?: string
  allDay: boolean
  objectId?: number
  objectName?: string
  pluginReference?: string
  pluginReferenceId?: number
  color: string
  reminderBefore?: number
  createdAt: string
}

export interface Alert {
  id: number
  title: string
  message?: string
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  objectId?: number
  objectName?: string
  pluginReference?: string
  pluginReferenceId?: number
  isRead: boolean
  isDismissed: boolean
  dueDate?: string
  createdAt: string
}

export interface EmailTemplate {
  id: number
  name: string
  subject: string
  body: string
  variables: string[]
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface SmtpConfig {
  id?: number
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromEmail: string
  fromName: string
  isActive: boolean
}

export interface Backup {
  id: number
  filename: string
  fileSize: number
  backupType: 'manual' | 'auto'
  status: string
  notes?: string
  createdAt: string
}

export interface FuelEntry {
  id: number
  objectId: number
  fuelType: string
  quantity: number
  unitPrice?: number
  totalPrice?: number
  mileage?: number
  station?: string
  entryDate: string
  notes?: string
  createdAt: string
}

export interface TechnicalControl {
  id: number
  objectId: number
  controlDate: string
  expiryDate: string
  mileage?: number
  result?: string
  centerName?: string
  cost?: number
  document?: string
  notes?: string
  createdAt: string
}

export interface Maintenance {
  id: number
  objectId: number
  maintenanceType: string
  maintenanceDate: string
  nextDate?: string
  mileage?: number
  nextMileage?: number
  cost?: number
  provider?: string
  document?: string
  notes?: string
  addToCalendar: boolean
  createdAt: string
}

// ======================== MANIFESTATIONS ========================

export interface ManifestationStockItem {
  id: number
  name: string
  description: string
  category: string
  quantity_total: number
  unit: string
  etat: string
  lieu: string
  stock_type: string
  price: number
  category_id: number | null
  subcategory_id: number | null
  category_name?: string
  category_slug?: string
  subcategory_name?: string
  quantity_available: number
  quantity_lent: number
  quantity_reserved_future: number
  created_at: string
  updated_at: string
}

export interface ManifestationMaterial {
  id?: number
  stock_id: number
  stock_name?: string
  unit?: string
  stock_category?: string
  quantity_requested: number
  quantity_delivered: number
  quantity_recovered: number
  unit_value: number
  notes: string
  stock_total?: number
}

export interface Manifestation {
  id: number
  title: string
  date_start: string
  date_end: string
  start_time: string
  end_time: string
  expected_people: number
  contact_name: string
  contact_phone: string
  contact_email: string
  delivery_address: string
  delivery_date: string
  notes_interior: string
  notes_exterior: string
  status: string
  created_by: number
  created_by_name: string
  archived_at: string
  created_at: string
  updated_at: string
  materials: ManifestationMaterial[]
}

export interface ManifestationStats {
  total: number
  upcoming: number
  delivered: number
  archived: number
  stockItems: number
}

export interface ManifestationFilters {
  status?: string
  search?: string
  archived?: boolean
  date_from?: string
  date_to?: string
}

export interface ManifestationFormData {
  title: string
  date_start: string
  date_end?: string
  start_time?: string
  end_time?: string
  expected_people?: number
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  delivery_address?: string
  delivery_date?: string
  notes_interior?: string
  notes_exterior?: string
  materials?: Omit<ManifestationMaterial, 'id' | 'stock_name' | 'unit' | 'stock_category' | 'stock_total'>[]
}

export interface StockFormData {
  name: string
  description?: string
  category?: string
  quantity_total: number
  unit?: string
  etat?: string
  lieu?: string
  stock_type?: string
  price?: number
  category_id?: number | null
  subcategory_id?: number | null
}

// --- API Manifestations ---

export const manifestationApi = {
  // Manifestations CRUD
  getAll: (filters?: ManifestationFilters) => {
    const p = new URLSearchParams()
    if (filters?.status) p.append('status', filters.status)
    if (filters?.search) p.append('search', filters.search)
    if (filters?.archived) p.append('archived', 'true')
    if (filters?.date_from) p.append('date_from', filters.date_from)
    if (filters?.date_to) p.append('date_to', filters.date_to)
    return api.get<{ success: boolean; data: Manifestation[] }>(`/manifestations?${p.toString()}`)
  },
  getById: (id: number) =>
    api.get<{ success: boolean; data: Manifestation }>(`/manifestations/${id}`),
  create: (data: ManifestationFormData) =>
    api.post<{ success: boolean; data: Manifestation }>('/manifestations', data),
  update: (id: number, data: ManifestationFormData) =>
    api.put<{ success: boolean; data: Manifestation }>(`/manifestations/${id}`, data),
  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/${id}`),
  updateStatus: (id: number, status: string) =>
    api.put<{ success: boolean }>(`/manifestations/${id}/status`, { status }),
  updateMaterials: (id: number, materials: Partial<ManifestationMaterial>[]) =>
    api.put<{ success: boolean }>(`/manifestations/${id}/materials`, { materials }),

  // Stats
  getStats: () =>
    api.get<{ success: boolean; data: ManifestationStats }>('/manifestations/stats/summary'),

  // Stock
  getStock: () =>
    api.get<{ success: boolean; data: ManifestationStockItem[] }>('/manifestations/stock'),
  getStockCategories: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/categories'),
  getStockEtats: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/etats'),
  getStockLieux: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/lieux'),
  getStockTypes: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/types'),
  getStockAvailability: (date?: string) => {
    const p = date ? `?date=${date}` : ''
    return api.get<{ success: boolean; data: ManifestationStockItem[] }>(`/manifestations/stock/availability${p}`)
  },
  createStock: (data: StockFormData) =>
    api.post<{ success: boolean; data: ManifestationStockItem }>('/manifestations/stock', data),
  updateStock: (id: number, data: StockFormData) =>
    api.put<{ success: boolean; data: ManifestationStockItem }>(`/manifestations/stock/${id}`, data),
  deleteStock: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/stock/${id}`),
}
