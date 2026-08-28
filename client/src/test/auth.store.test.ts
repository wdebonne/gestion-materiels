import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Contrat du magasin d'authentification.
 *
 * La page profil lisait `useAuthStore.getState().accessToken` — un champ qui
 * n'existe pas, le vrai s'appelant `token` — puis le passait à `setAuth` avec un
 * `!` pour forcer le type. Le magasin se retrouvait avec `token: undefined`,
 * l'intercepteur n'envoyait plus d'en-tête d'autorisation, et changer sa photo
 * ou son nom déconnectait l'utilisateur.
 *
 * Ces tests figent le nom du champ et le fait que mettre à jour l'utilisateur
 * ne touche pas aux jetons.
 */

const utilisateur = {
  id: 1,
  email: 'agent@exemple.fr',
  firstName: 'Jean',
  lastName: 'Dupont',
  role: 'agent',
} as any

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    sessionExpired: false,
  })
})

describe('Champs du magasin', () => {
  it('nomme le jeton d’accès `token`, et n’expose pas `accessToken`', () => {
    useAuthStore.getState().setAuth(utilisateur, 'jeton-acces', 'jeton-rafraichissement')
    const etat = useAuthStore.getState() as unknown as Record<string, unknown>

    expect(etat.token).toBe('jeton-acces')
    // C'est la lecture de ce nom-là qui écrasait le jeton.
    expect(etat.accessToken).toBeUndefined()
  })
})

describe('Mise à jour de l’utilisateur', () => {
  it('conserve les jetons et la session', () => {
    useAuthStore.getState().setAuth(utilisateur, 'jeton-acces', 'jeton-rafraichissement')
    useAuthStore.getState().updateUser({ firstName: 'Jeanne' })

    const etat = useAuthStore.getState()
    expect(etat.user?.firstName).toBe('Jeanne')
    expect(etat.token).toBe('jeton-acces')
    expect(etat.refreshToken).toBe('jeton-rafraichissement')
    expect(etat.isAuthenticated).toBe(true)
  })

  it('ne modifie que les champs fournis', () => {
    useAuthStore.getState().setAuth(utilisateur, 'jeton-acces', 'jeton-rafraichissement')
    useAuthStore.getState().updateUser({ avatar: undefined })

    const etat = useAuthStore.getState()
    expect(etat.user?.email).toBe('agent@exemple.fr')
    expect(etat.user?.role).toBe('agent')
    expect(etat.token).toBe('jeton-acces')
  })

  it('ne fait rien sans utilisateur connecté', () => {
    useAuthStore.getState().updateUser({ firstName: 'Personne' })
    expect(useAuthStore.getState().user).toBeNull()
  })
})
