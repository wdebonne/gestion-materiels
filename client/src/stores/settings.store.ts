import { create } from 'zustand'
import api from '@/lib/api'

interface Settings {
  site_name: string
  site_version: string
  site_url: string
  site_logo: string
  site_favicon: string
  default_image: string
  items_per_page: number
  date_format: string
  currency: string
  currency_symbol: string
  reminder_days_before: number
  auto_backup: boolean
  backup_frequency: string
  maintenance_mode: boolean
  [key: string]: any
}

interface SettingsState {
  settings: Settings
  isLoading: boolean
  error: string | null
  
  // Actions
  fetchSettings: () => Promise<void>
  updateSettings: (settings: Partial<Settings>) => Promise<void>
}

const defaultSettings: Settings = {
  site_name: 'Gestion Matériels',
  site_version: '1.0.0',
  site_url: 'http://localhost:3000',
  site_logo: '',
  site_favicon: '',
  default_image: '',
  items_per_page: 20,
  date_format: 'DD/MM/YYYY',
  currency: 'EUR',
  currency_symbol: '€',
  reminder_days_before: 30,
  auto_backup: false,
  backup_frequency: 'weekly',
  maintenance_mode: false
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: defaultSettings,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await api.get('/settings')
      set({ settings: { ...defaultSettings, ...response.data.settings }, isLoading: false })
    } catch (error: any) {
      set({ error: error.message, isLoading: false })
    }
  },

  updateSettings: async (settings: Partial<Settings>) => {
    set({ isLoading: true, error: null })
    try {
      await api.put('/settings', { settings })
      set((state) => ({
        settings: { ...state.settings, ...settings },
        isLoading: false
      }))
    } catch (error: any) {
      set({ error: error.message, isLoading: false })
      throw error
    }
  }
}))
