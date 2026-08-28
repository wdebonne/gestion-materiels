import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { Modal, ModalBody, ModalFooter, Button, Input, Alert } from '@/components/ui'
import { getErrorMessage } from '@/lib/errors'
import api from '@/lib/api'

/**
 * Avant : une session expirée déclenchait `window.location.href = '/login'`,
 * ce qui rechargeait la page et effaçait sans prévenir tout formulaire en cours.
 *
 * Maintenant : l'écran reste en place, on se reconnecte par-dessus, et la
 * saisie est toujours là une fois la modale fermée.
 */
export default function SessionExpiredModal() {
  const navigate = useNavigate()
  const { sessionExpired, user, setAuth, logout } = useAuthStore()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!sessionExpired) return null

  const handleReconnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', {
        email: user?.email,
        password,
      })
      const { user: freshUser, accessToken, refreshToken } = response.data

      setAuth(freshUser, accessToken, refreshToken)
      setPassword('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <Modal isOpen onClose={() => {}} size="sm" showCloseButton={false}>
      <form onSubmit={handleReconnect}>
        <ModalBody className="pt-6">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Votre session a expiré
              </h2>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                Saisissez votre mot de passe pour continuer.{' '}
                <strong>Votre saisie en cours n'est pas perdue.</strong>
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {error && <Alert type="error">{error}</Alert>}

            <Input
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              icon={<Lock className="w-5 h-5" />}
              hint={user?.email ? `Compte : ${user.email}` : undefined}
              autoFocus
              required
            />
          </div>
        </ModalBody>

        <ModalFooter className="dark:bg-gray-900/40 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={handleLogout}>
            Se déconnecter
          </Button>
          <Button type="submit" loading={loading}>
            Reprendre
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
