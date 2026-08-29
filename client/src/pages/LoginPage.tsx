import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuthStore, seSouvenirDeMoi, definirSouvenir } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { Button, Input, Alert } from '@/components/ui'
import { getErrorMessage } from '@/lib/errors'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const { setAuth, setPasswordExpired } = useAuthStore()
  const { settings } = useSettingsStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [souvenir, setSouvenir] = useState(seSouvenirDeMoi)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', { email, password })
      const { user, accessToken, refreshToken } = response.data

      // La redirection est assurée par PublicRoute, qui reprend la main dès que
      // `isAuthenticated` passe à true et renvoie vers la page initialement
      // demandée (ex. la fiche d'un matériel ouverte via un QR code).
      definirSouvenir(souvenir)
      setPasswordExpired(response.data.passwordExpired === true)
      setAuth(user, accessToken, refreshToken)
      toast.success(`Bienvenue, ${user.firstName} !`)
    } catch (err: any) {
      setError(err.response?.status === 401 ? 'Identifiants incorrects' : getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo et titre */}
        <div className="text-center mb-8">
          {settings.logo ? (
            <img 
              src={settings.logo} 
              alt={settings.siteName} 
              className="h-16 mx-auto mb-4"
            />
          ) : (
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-white">
                {settings.siteName?.charAt(0) || 'G'}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-white">
            {settings.siteName || 'Gestion Matériels'}
          </h1>
          <p className="text-primary-200 mt-2">
            Connectez-vous à votre compte
          </p>
        </div>

        {/* Formulaire */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert type="error">
                {error}
              </Alert>
            )}

            <Input
              label="Adresse email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              icon={<Mail className="w-5 h-5" />}
              required
              autoFocus
            />

            <Input
              label="Mot de passe"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              icon={<Lock className="w-5 h-5" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              }
              required
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer touch-target">
                <input
                  type="checkbox"
                  checked={souvenir}
                  onChange={(e) => setSouvenir(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600 dark:text-gray-300">Rester connecté</span>
              </label>

              <Link
                to="/forgot-password"
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Mot de passe oublié ?
              </Link>
            </div>

            {!souvenir && (
              <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2">
                La session se fermera à la fermeture du navigateur — à garder décoché sur un poste partagé.
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={loading}
            >
              Se connecter
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-primary-200 text-sm mt-6">
          {settings.siteName} - Version {settings.version || '1.0.0'}
        </p>
      </div>
    </div>
  )
}
