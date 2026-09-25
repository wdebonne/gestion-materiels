import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import api, { User } from '@/lib/api'

/**
 * « Se souvenir de moi ».
 *
 * La case existait dans le formulaire sans état ni gestionnaire, et la session
 * était de toute façon écrite en `localStorage` : l'application se souvenait de
 * tout le monde, tout le temps. Sur le PC partagé de l'atelier, l'agent suivant
 * héritait de la session du précédent.
 *
 * Cochée, la session survit à la fermeture du navigateur — c'est le cas courant
 * du téléphone personnel. Décochée, elle passe en `sessionStorage` et disparaît
 * avec l'onglet.
 */
const CLE_SOUVENIR = 'auth-remember-me'

export function seSouvenirDeMoi(): boolean {
  try {
    // Par défaut oui : la majorité des agents sont sur leur propre téléphone.
    return localStorage.getItem(CLE_SOUVENIR) !== 'false'
  } catch {
    return false
  }
}

export function definirSouvenir(valeur: boolean): void {
  try {
    localStorage.setItem(CLE_SOUVENIR, valeur ? 'true' : 'false')
  } catch {
    // Navigation privée ou stockage refusé : on reste sur la session courante.
  }
}

/**
 * Route l'écriture vers l'un ou l'autre stockage selon la préférence, et retire
 * l'entrée de celui qu'on n'utilise pas — sinon une session « à ne pas retenir »
 * resterait derrière dans `localStorage`.
 */
const stockageSelonPreference: StateStorage = {
  getItem: (nom) => {
    try {
      return sessionStorage.getItem(nom) ?? localStorage.getItem(nom)
    } catch {
      return null
    }
  },
  setItem: (nom, valeur) => {
    try {
      if (seSouvenirDeMoi()) {
        localStorage.setItem(nom, valeur)
        sessionStorage.removeItem(nom)
      } else {
        sessionStorage.setItem(nom, valeur)
        localStorage.removeItem(nom)
      }
    } catch {
      // Rien à faire : la session reste valide en mémoire jusqu'au rechargement.
    }
  },
  removeItem: (nom) => {
    try {
      localStorage.removeItem(nom)
      sessionStorage.removeItem(nom)
    } catch {
      // idem
    }
  },
}

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
  /**
   * Mot de passe plus ancien que la durée configurée. Signalé, jamais bloquant :
   * refuser l'accès à un agent en extérieur parce que son mot de passe a
   * 91 jours coûte plus qu'il ne protège.
   */
  passwordExpired: boolean

  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
  setAuth: (user: User, token: string, refreshToken: string) => void
  setTokens: (token: string, refreshToken: string) => void
  updateUser: (user: Partial<User>) => void
  setSessionExpired: (expired: boolean) => void
  setPasswordExpired: (expired: boolean) => void
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
      passwordExpired: false,

      login: async (email: string, password: string) => {
        const response = await api.post('/auth/login', { email, password })
        const { user, accessToken, refreshToken } = response.data

        // Second facteur réclamé : le serveur n'a remis aucun jeton, seulement
        // un défi à faire signer par l'appareil. Poursuivre écrirait une session
        // authentifiée sans jeton, dont chaque requête repartirait en 401.
        // Cette action n'a pas d'écran : c'est `LoginPage` qui mène la
        // cérémonie, et elle appelle l'API directement.
        if (response.data.secondFacteur) {
          throw new Error('Une passkey est requise : passez par l’écran de connexion.')
        }

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
        // Le service worker garde 24 h de réponses `/api/` (NetworkFirst).
        // Sur la tablette partagée d'un service technique, l'agent suivant
        // les voyait hors réseau : effacer l'état d'authentification ne
        // suffit pas, il faut vider le cache avec.
        if (typeof caches !== 'undefined') {
          caches
            .keys()
            .then((noms) =>
              Promise.all(noms.filter((nom) => nom.includes('api-cache')).map((nom) => caches.delete(nom)))
            )
            .catch(() => {})
        }

        // Le jeton est joint explicitement : l'état est effacé juste après, et
        // l'intercepteur de requête lirait alors un jeton déjà nul. La requête
        // partait sans en-tête d'autorisation, le serveur répondait 401, et la
        // déconnexion n'était jamais journalisée ni le cookie effacé.
        const jeton = get().token
        if (jeton) {
          api
            .post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${jeton}` } })
            .catch(() => {})
        }

        // Pas d'effacement manuel du stockage : le `set` qui suit déclenche une
        // écriture de persistance qui remplace l'entrée par des valeurs nulles,
        // et `setItem` nettoie au passage le stockage non retenu.
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
          // Seul un 401 dit que la session est finie — et l'intercepteur a déjà
          // tenté le rafraîchissement avant de le laisser passer. Un 429 du
          // limiteur, un serveur qui redémarre ou une zone blanche au moment
          // d'un rechargement ne disent rien de la session : les traiter comme
          // une déconnexion renvoyait l'agent à l'écran de connexion sans un mot.
          const status = (error as { response?: { status?: number } })?.response?.status
          if (status !== 401 && get().user) {
            set({ isAuthenticated: true, isLoading: false })
            return
          }
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
      },

      setPasswordExpired: (expired: boolean) => {
        set({ passwordExpired: expired })
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => stockageSelonPreference),
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
