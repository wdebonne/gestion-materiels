import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle, XCircle } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import { Button, Input, Alert } from '@/components/ui'
import api from '@/lib/api'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const { settings } = useSettingsStore()
  
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)

  // Vérifier la validité du token
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setTokenValid(false)
        return
      }

      try {
        await api.get(`/auth/verify-reset-token?token=${token}`)
        setTokenValid(true)
      } catch {
        setTokenValid(false)
      }
    }

    verifyToken()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }

    setLoading(true)

    try {
      await api.post('/auth/reset-password', { token, password })
      setSuccess(true)
    } catch (err: any) {
      const message = err.response?.data?.error || 'Une erreur est survenue'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // Token invalide ou expiré
  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Lien invalide ou expiré
            </h2>
            <p className="text-gray-600 mb-6">
              Ce lien de réinitialisation n'est plus valide. Veuillez faire une nouvelle demande.
            </p>
            <Link to="/forgot-password">
              <Button className="w-full">
                Nouvelle demande
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Chargement de la vérification du token
  if (tokenValid === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-600 mt-4">Vérification du lien...</p>
          </div>
        </div>
      </div>
    )
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
            Nouveau mot de passe
          </h1>
          <p className="text-primary-200 mt-2">
            Choisissez un nouveau mot de passe sécurisé
          </p>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {success ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Mot de passe modifié !
              </h2>
              <p className="text-gray-600 mb-6">
                Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.
              </p>
              <Link to="/login">
                <Button className="w-full">
                  Se connecter
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <Alert type="error">
                  {error}
                </Alert>
              )}

              <Input
                label="Nouveau mot de passe"
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
                hint="Minimum 8 caractères"
                required
                autoFocus
              />

              <Input
                label="Confirmer le mot de passe"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                icon={<Lock className="w-5 h-5" />}
                required
              />

              <Button
                type="submit"
                className="w-full"
                size="lg"
                loading={loading}
              >
                Réinitialiser le mot de passe
              </Button>

              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour à la connexion
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
