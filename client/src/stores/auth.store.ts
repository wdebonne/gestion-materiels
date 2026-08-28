import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api, { User } from '@/lib/api'

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  /**
   * Session expirée mais page conservée : on n'efface pas l'utilisateur et on
   * ne recharge pas la page, pour que le formulaire en cours de saisie survive
   * à la reconnexion.
   */
  sessionExpired: boolean

  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
  setAuth: (user: User, token: string, refreshToken: string) => void
  setTokens: (token: string, refreshToken: string) => void
  updateUser: (user: Partial<User>) => void
  setSessionExpired: (expired: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      sessionExpired: false,

      login: async (email: string, password: string) => {
        const response = await api.post('/auth/login', { email, password })
        const { user, accessToken, refreshToken } = response.data

        set({
          user,
          token: accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
          sessionExpired: false
        })
      },

      logout: () => {
        api.post('/auth/logout').catch(() => {})
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          sessionExpired: false
        })
      },

      checkAuth: async () => {
        const token = get().token
        if (!token) {
          set({ isLoading: false })
          return
        }

        try {
          const response = await api.get('/auth/me')
          set({
            user: response.data.user,
            isAuthenticated: true,
            isLoading: false
          })
        } catch (error) {
          set({
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false
          })
        }
      },

      setTokens: (token: string, refreshToken: string) => {
        set({ token, refreshToken })
      },

      setAuth: (user: User, token: string, refreshToken: string) => {
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
          sessionExpired: false
        })
      },

      updateUser: (userData: Partial<User>) => {
        const currentUser = get().user
        if (currentUser) {
          set({ user: { ...currentUser, ...userData } })
        }
      },

      setSessionExpired: (expired: boolean) => {
        set({ sessionExpired: expired })
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.checkAuth()
        }
      }
    }
  )
)
