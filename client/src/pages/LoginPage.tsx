import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, Fingerprint } from 'lucide-react'
import { useAuthStore, seSouvenirDeMoi, definirSouvenir } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { Button, Input, Alert } from '@/components/ui'
import { getErrorMessage } from '@/lib/errors'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  connexionParPasskey,
  lireEtatPasskeys,
  messageErreurPasskey,
  passkeysSupportees,
  repondreSecondFacteur,
  type DemandeSecondFacteur,
  type EtatPasskeys,
} from '@/lib/passkeys'

export default function LoginPage() {
  const { setAuth, setPasswordExpired } = useAuthStore()
  const { settings, fetchPublicSettings } = useSettingsStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [souvenir, setSouvenir] = useState(seSouvenirDeMoi)
  const [etatPasskeys, setEtatPasskeys] = useState<EtatPasskeys | null>(null)
  /**
   * Second facteur réclamé : le mot de passe est bon, la passkey manque encore.
   * Conservé en état pour que « Réessayer » ne repasse pas par le mot de passe —
   * le défi reste valable tant que l'agent ne l'a pas laissé expirer.
   */
  const [demandePasskey, setDemandePasskey] = useState<DemandeSecondFacteur | null>(null)

  // Le magasin des réglages n'était rempli que par `Layout`, la coquille
  // authentifiée : avant la connexion il restait vide, et la commune ne
  // voyait ici ni son nom, ni son logo, ni sa version.
  useEffect(() => {
    fetchPublicSettings()
  }, [fetchPublicSettings])

  // Le bouton « passkey » ne s'affiche que si l'administrateur a ouvert cette
  // porte. La route est tolérante à l'échec : sans réponse, l'écran reste le
  // formulaire email + mot de passe, qui fonctionne toujours.
  useEffect(() => {
    lireEtatPasskeys().then(setEtatPasskeys)
  }, [])

  /**
   * Fin commune à toutes les portes : mot de passe seul, passkey seule, ou les
   * deux. La redirection est assurée par PublicRoute, qui reprend la main dès
   * que `isAuthenticated` passe à true et renvoie vers la page initialement
   * demandée (ex. la fiche d'un matériel ouverte via un QR code).
   */
  const ouvrirLaSession = (donnees: any) => {
    const { user, accessToken, refreshToken } = donnees
    definirSouvenir(souvenir)
    setPasswordExpired(donnees.passwordExpired === true)
    setAuth(user, accessToken, refreshToken)
    toast.success(`Bienvenue, ${user.firstName} !`)
  }

  /** Présente la passkey réclamée après un mot de passe validé. */
  const presenterSecondFacteur = async (demande: DemandeSecondFacteur) => {
    setError('')
    setLoading(true)
    try {
      ouvrirLaSession(await repondreSecondFacteur(demande))
    } catch (err: any) {
      setError(messageErreurPasskey(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', { email, password })

      // Le mot de passe seul ne suffit pas sur cette installation : le serveur
      // n'a remis aucun jeton, seulement un défi à faire signer par l'appareil.
      if (response.data.secondFacteur) {
        setDemandePasskey(response.data.secondFacteur)
        await presenterSecondFacteur(response.data.secondFacteur)
        return
      }

      ouvrirLaSession(response.data)
    } catch (err: any) {
      setError(err.response?.status === 401 ? 'Identifiants incorrects' : getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  /** Connexion sans mot de passe : c'est l'appareil qui désigne le compte. */
  const connecterParPasskey = async () => {
    setError('')
    setLoading(true)
    try {
      ouvrirLaSession(await connexionParPasskey())
    } catch (err: any) {
      setError(messageErreurPasskey(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo et titre */}
        <div className="text-center mb-8">
          {/*
            Le magasin des réglages expose `site_logo`, `site_name` et
            `site_version` ; cet écran lisait `logo`, `siteName` et `version`.
            L'index `[key: string]: any` de l'interface empêchait TypeScript de
            le dire, et les quatre lectures rendaient `undefined` : la commune
            qui avait posé son nom et son logo ne les voyait nulle part sur
            l'écran de connexion, et la version y était figée à « 1.0.0 ».
          */}
          {settings.site_logo ? (
            <img 
              src={settings.site_logo} 
              alt={settings.site_name} 
              className="h-16 mx-auto mb-4"
            />
          ) : (
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-white">
                {settings.site_name?.charAt(0) || 'G'}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-white">
            {settings.site_name || 'Gestion Matériels'}
          </h1>
          <p className="text-primary-200 mt-2">
            Connectez-vous à votre compte
          </p>
        </div>

        {/*
          Second facteur : le mot de passe est passé, la passkey manque encore.
          L'écran remplace le formulaire plutôt que de s'ajouter dessous — il n'y
          a plus rien à saisir, seulement un appareil à déverrouiller.
        */}
        {demandePasskey ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 space-y-5">
            {error && <Alert type="error">{error}</Alert>}

            <div className="text-center">
              <Fingerprint className="mx-auto h-10 w-10 text-primary-600" />
              <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
                Confirmez avec votre passkey
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Votre mot de passe est correct. Il reste à déverrouiller votre appareil :
                empreinte, visage, code, ou clé de sécurité.
              </p>
            </div>

            <Button
              type="button"
              className="w-full"
              size="lg"
              loading={loading}
              icon={<Fingerprint className="w-5 h-5" />}
              onClick={() => presenterSecondFacteur(demandePasskey)}
            >
              Réessayer
            </Button>

            <button
              type="button"
              onClick={() => {
                setDemandePasskey(null)
                setError('')
                setPassword('')
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Revenir à la saisie du mot de passe
            </button>
          </div>
        ) : (
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

            {/*
              Connexion sans mot de passe. Le bouton n'apparaît que si
              l'administrateur a ouvert cette porte et que le navigateur sait
              la franchir : proposer une passkey à un appareil qui ne peut pas
              en produire ne ferait qu'ajouter un échec au moment d'entrer.
            */}
            {etatPasskeys?.connexionSansMotDePasse && passkeysSupportees() && (
              <>
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs uppercase tracking-wide text-gray-400">ou</span>
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  size="lg"
                  disabled={loading}
                  icon={<Fingerprint className="w-5 h-5" />}
                  onClick={connecterParPasskey}
                >
                  Se connecter avec une passkey
                </Button>

                <p className="text-center text-xs text-gray-500 dark:text-gray-400 -mt-2">
                  Aucun identifiant à saisir : votre appareil reconnaît votre compte.
                </p>
              </>
            )}
          </form>
        </div>
        )}

        {/* Footer */}
        <p className="text-center text-primary-200 text-sm mt-6">
          {settings.site_name || 'Gestion Matériels'} — version {settings.site_version || '1.0.0'}
        </p>
      </div>
    </div>
  )
}
