import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, Shield, Server, Key, Fingerprint, Globe, Lock,
  CheckCircle, XCircle, Eye, EyeOff, Settings, AlertTriangle,
  ToggleLeft, ToggleRight, Zap
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert, Tabs, Tab } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

// ==================== COMPOSANT PRINCIPAL ====================

export default function AuthSettingsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('general')

  // Récupérer toute la configuration
  const { data: providers, isLoading } = useQuery({
    queryKey: ['auth-settings'],
    queryFn: async () => {
      const response = await api.get('/settings/auth')
      return response.data.providers
    }
  })

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4 dark:bg-gray-700"></div>
        <div className="h-64 bg-gray-200 rounded dark:bg-gray-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Shield className="w-7 h-7 text-primary-600" />
          Authentification
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Configurez les méthodes d'authentification : locale, SSO (SAML/OIDC), LDAP et Passkey
        </p>
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tab value="general" label="Général" icon={<Settings className="w-4 h-4" />} />
        <Tab value="ldap" label="LDAP" icon={<Server className="w-4 h-4" />} />
        <Tab value="saml" label="SAML SSO" icon={<Globe className="w-4 h-4" />} />
        <Tab value="oidc" label="OpenID Connect" icon={<Key className="w-4 h-4" />} />
        <Tab value="passkey" label="Passkey" icon={<Fingerprint className="w-4 h-4" />} />
      </Tabs>

      <div className="mt-6">
        {activeTab === 'general' && <GeneralAuthSection config={providers?.general} queryClient={queryClient} />}
        {activeTab === 'ldap' && <LdapSection config={providers?.ldap} queryClient={queryClient} />}
        {activeTab === 'saml' && <SamlSection config={providers?.saml} queryClient={queryClient} />}
        {activeTab === 'oidc' && <OidcSection config={providers?.oidc} queryClient={queryClient} />}
        {activeTab === 'passkey' && <PasskeySection config={providers?.passkey} queryClient={queryClient} />}
      </div>
    </div>
  )
}

// ==================== TOGGLE SWITCH ====================

function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-3 group"
    >
      {enabled ? (
        <ToggleRight className="w-8 h-8 text-green-500" />
      ) : (
        <ToggleLeft className="w-8 h-8 text-gray-400" />
      )}
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100">
        {label}
      </span>
    </button>
  )
}

// ==================== STATUS BADGE ====================

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
      active
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
    }`}>
      {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {active ? 'Activé' : 'Désactivé'}
    </span>
  )
}

// ==================== SECTION GÉNÉRALE ====================

function GeneralAuthSection({ config, queryClient }: { config: any; queryClient: any }) {
  const [formData, setFormData] = useState({
    allow_local_login: true,
    allow_registration: false,
    enforce_2fa: false,
    session_timeout_minutes: 480,
    max_login_attempts: 5,
    lockout_duration_minutes: 15,
    password_min_length: 8,
    password_require_uppercase: true,
    password_require_lowercase: true,
    password_require_number: true,
    password_require_special: false,
    password_expiry_days: 0
  })

  useEffect(() => {
    if (config?.config) {
      setFormData({ ...formData, ...config.config })
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.put('/settings/auth/general', { is_active: true, config: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success('Paramètres généraux enregistrés')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Politique de connexion
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={formData.allow_local_login}
            onChange={(v) => setFormData({ ...formData, allow_local_login: v })}
            label="Autoriser la connexion locale (email / mot de passe)"
          />
          <ToggleSwitch
            enabled={formData.allow_registration}
            onChange={(v) => setFormData({ ...formData, allow_registration: v })}
            label="Autoriser l'inscription publique"
          />
          <ToggleSwitch
            enabled={formData.enforce_2fa}
            onChange={(v) => setFormData({ ...formData, enforce_2fa: v })}
            label="Exiger l'authentification à deux facteurs (2FA)"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <Input
              label="Timeout session (minutes)"
              type="number"
              value={String(formData.session_timeout_minutes)}
              onChange={(e) => setFormData({ ...formData, session_timeout_minutes: parseInt(e.target.value) || 480 })}
              hint="0 = pas d'expiration"
            />
            <Input
              label="Tentatives max avant blocage"
              type="number"
              value={String(formData.max_login_attempts)}
              onChange={(e) => setFormData({ ...formData, max_login_attempts: parseInt(e.target.value) || 5 })}
            />
            <Input
              label="Durée du blocage (minutes)"
              type="number"
              value={String(formData.lockout_duration_minutes)}
              onChange={(e) => setFormData({ ...formData, lockout_duration_minutes: parseInt(e.target.value) || 15 })}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Politique de mot de passe
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Longueur minimale"
              type="number"
              value={String(formData.password_min_length)}
              onChange={(e) => setFormData({ ...formData, password_min_length: parseInt(e.target.value) || 8 })}
              hint="Minimum recommandé : 8 caractères"
            />
            <Input
              label="Expiration (jours)"
              type="number"
              value={String(formData.password_expiry_days)}
              onChange={(e) => setFormData({ ...formData, password_expiry_days: parseInt(e.target.value) || 0 })}
              hint="0 = jamais"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              enabled={formData.password_require_uppercase}
              onChange={(v) => setFormData({ ...formData, password_require_uppercase: v })}
              label="Exiger au moins une majuscule"
            />
            <ToggleSwitch
              enabled={formData.password_require_lowercase}
              onChange={(v) => setFormData({ ...formData, password_require_lowercase: v })}
              label="Exiger au moins une minuscule"
            />
            <ToggleSwitch
              enabled={formData.password_require_number}
              onChange={(v) => setFormData({ ...formData, password_require_number: v })}
              label="Exiger au moins un chiffre"
            />
            <ToggleSwitch
              enabled={formData.password_require_special}
              onChange={(v) => setFormData({ ...formData, password_require_special: v })}
              label="Exiger un caractère spécial (!@#$...)"
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}

// ==================== SECTION LDAP ====================

function LdapSection({ config, queryClient }: { config: any; queryClient: any }) {
  const [showPassword, setShowPassword] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [formData, setFormData] = useState({
    server_url: '',
    bind_dn: '',
    bind_password: '',
    search_base: '',
    search_filter: '(uid={{username}})',
    tls: false,
    port: 389,
    username_attribute: 'uid',
    email_attribute: 'mail',
    first_name_attribute: 'givenName',
    last_name_attribute: 'sn',
    group_search_base: '',
    group_search_filter: '(member={{dn}})',
    admin_group: '',
    supervisor_group: '',
    auto_create_user: true,
    default_role: 'user'
  })

  useEffect(() => {
    if (config) {
      setIsActive(config.is_active)
      if (config.config) setFormData({ ...formData, ...config.config })
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.put('/settings/auth/ldap', { is_active: isActive, config: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success('Configuration LDAP enregistrée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const testMutation = useMutation({
    mutationFn: async () => api.post('/settings/auth/ldap/test'),
    onSuccess: (res: any) => {
      setTestResult({ success: true, message: res.data.message })
    },
    onError: (err: any) => {
      setTestResult({ success: false, message: err.response?.data?.message || 'Erreur de connexion' })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              LDAP / Active Directory
            </CardTitle>
            <StatusBadge active={isActive} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={isActive}
            onChange={setIsActive}
            label="Activer l'authentification LDAP"
          />

          <Alert type="info">
            <div className="text-sm">
              Connectez votre annuaire LDAP ou Active Directory pour permettre aux utilisateurs de se connecter avec leurs identifiants réseau.
            </div>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="URL du serveur"
              value={formData.server_url}
              onChange={(e) => setFormData({ ...formData, server_url: e.target.value })}
              placeholder="ldap://ldap.example.com"
              hint="ldap:// ou ldaps:// pour TLS"
            />
            <Input
              label="Port"
              type="number"
              value={String(formData.port)}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 389 })}
              hint="389 (LDAP) ou 636 (LDAPS)"
            />
          </div>

          <ToggleSwitch
            enabled={formData.tls}
            onChange={(v) => setFormData({ ...formData, tls: v })}
            label="Utiliser STARTTLS"
          />

          <Input
            label="Bind DN"
            value={formData.bind_dn}
            onChange={(e) => setFormData({ ...formData, bind_dn: e.target.value })}
            placeholder="cn=admin,dc=example,dc=com"
            hint="DN du compte de service pour les recherches"
          />
          <Input
            label="Mot de passe Bind"
            type={showPassword ? 'text' : 'password'}
            value={formData.bind_password}
            onChange={(e) => setFormData({ ...formData, bind_password: e.target.value })}
            placeholder={config?.config?.bind_password ? '••••••••' : 'Mot de passe'}
            hint={config?.config?.bind_password ? 'Laisser vide pour conserver le mot de passe actuel' : ''}
            rightIcon={
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="hover:text-gray-600">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            }
          />

          <Input
            label="Base de recherche (Search Base)"
            value={formData.search_base}
            onChange={(e) => setFormData({ ...formData, search_base: e.target.value })}
            placeholder="dc=example,dc=com"
            hint="Base DN pour rechercher les utilisateurs"
          />
          <Input
            label="Filtre de recherche"
            value={formData.search_filter}
            onChange={(e) => setFormData({ ...formData, search_filter: e.target.value })}
            placeholder="(uid={{username}})"
            hint="{{username}} sera remplacé par le login saisi"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Mapping des attributs
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Attribut identifiant"
              value={formData.username_attribute}
              onChange={(e) => setFormData({ ...formData, username_attribute: e.target.value })}
              placeholder="uid"
              hint="sAMAccountName pour AD"
            />
            <Input
              label="Attribut email"
              value={formData.email_attribute}
              onChange={(e) => setFormData({ ...formData, email_attribute: e.target.value })}
              placeholder="mail"
            />
            <Input
              label="Attribut prénom"
              value={formData.first_name_attribute}
              onChange={(e) => setFormData({ ...formData, first_name_attribute: e.target.value })}
              placeholder="givenName"
            />
            <Input
              label="Attribut nom"
              value={formData.last_name_attribute}
              onChange={(e) => setFormData({ ...formData, last_name_attribute: e.target.value })}
              placeholder="sn"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Mapping des groupes & rôles
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            label="Base de recherche des groupes"
            value={formData.group_search_base}
            onChange={(e) => setFormData({ ...formData, group_search_base: e.target.value })}
            placeholder="ou=groups,dc=example,dc=com"
            hint="Laisser vide pour ne pas utiliser les groupes"
          />
          <Input
            label="Filtre de recherche des groupes"
            value={formData.group_search_filter}
            onChange={(e) => setFormData({ ...formData, group_search_filter: e.target.value })}
            placeholder="(member={{dn}})"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Groupe admin"
              value={formData.admin_group}
              onChange={(e) => setFormData({ ...formData, admin_group: e.target.value })}
              placeholder="cn=admins,ou=groups,dc=example,dc=com"
              hint="Les membres seront créés avec le rôle admin"
            />
            <Input
              label="Groupe superviseur"
              value={formData.supervisor_group}
              onChange={(e) => setFormData({ ...formData, supervisor_group: e.target.value })}
              placeholder="cn=supervisors,ou=groups,dc=example,dc=com"
              hint="Les membres seront créés avec le rôle superviseur"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              enabled={formData.auto_create_user}
              onChange={(v) => setFormData({ ...formData, auto_create_user: v })}
              label="Créer automatiquement les utilisateurs"
            />
            <Select
              label="Rôle par défaut"
              value={formData.default_role}
              onChange={(e) => setFormData({ ...formData, default_role: e.target.value })}
              options={[
                { value: 'user', label: 'Utilisateur' },
                { value: 'supervisor', label: 'Superviseur' },
                { value: 'admin', label: 'Administrateur' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          loading={testMutation.isPending}
          icon={<Zap className="w-4 h-4" />}
        >
          Tester la connexion
        </Button>
        <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
          Enregistrer
        </Button>
      </div>

      {testResult && (
        <Alert type={testResult.success ? 'success' : 'error'}>
          <div className="flex items-center gap-2">
            {testResult.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {testResult.message}
          </div>
        </Alert>
      )}
    </form>
  )
}

// ==================== SECTION SAML SSO ====================

function SamlSection({ config, queryClient }: { config: any; queryClient: any }) {
  const [isActive, setIsActive] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [formData, setFormData] = useState({
    entry_point: '',
    issuer: '',
    cert: '',
    callback_url: '',
    signature_algorithm: 'sha256',
    want_assertions_signed: true,
    auto_create_user: true,
    default_role: 'user',
    attribute_mapping: {
      email: 'email',
      first_name: 'givenName',
      last_name: 'surname'
    }
  })

  useEffect(() => {
    if (config) {
      setIsActive(config.is_active)
      if (config.config) {
        setFormData({
          ...formData,
          ...config.config,
          attribute_mapping: { ...formData.attribute_mapping, ...config.config.attribute_mapping }
        })
      }
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.put('/settings/auth/saml', { is_active: isActive, config: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success('Configuration SAML enregistrée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const testMutation = useMutation({
    mutationFn: async () => api.post('/settings/auth/saml/test'),
    onSuccess: (res: any) => setTestResult({ success: true, message: res.data.message }),
    onError: (err: any) => setTestResult({ success: false, message: err.response?.data?.message || 'Erreur' })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              SAML 2.0 Single Sign-On
            </CardTitle>
            <StatusBadge active={isActive} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={isActive}
            onChange={setIsActive}
            label="Activer l'authentification SAML"
          />

          <Alert type="info">
            <div className="text-sm">
              Compatible avec Azure AD, Google Workspace, Okta, OneLogin, Keycloak et tout fournisseur SAML 2.0.
            </div>
          </Alert>

          <Input
            label="Point d'entrée SSO (Entry Point URL)"
            value={formData.entry_point}
            onChange={(e) => setFormData({ ...formData, entry_point: e.target.value })}
            placeholder="https://login.microsoftonline.com/.../saml2"
            hint="URL de connexion SSO du fournisseur d'identité (IdP)"
          />
          <Input
            label="Issuer / Entity ID"
            value={formData.issuer}
            onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
            placeholder="https://votre-app.example.com"
            hint="Identifiant unique de votre application (SP Entity ID)"
          />
          <Input
            label="URL de rappel (Callback URL / ACS)"
            value={formData.callback_url}
            onChange={(e) => setFormData({ ...formData, callback_url: e.target.value })}
            placeholder="https://votre-app.example.com/api/auth/saml/callback"
            hint="URL à configurer dans votre IdP"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Certificat IdP (X.509)
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm font-mono dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
              rows={4}
              value={formData.cert}
              onChange={(e) => setFormData({ ...formData, cert: e.target.value })}
              placeholder="MIICmzCCAYMCBgF..."
            />
            <p className="mt-1 text-xs text-gray-500">Certificat public du fournisseur d'identité (sans BEGIN/END CERTIFICATE)</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Algorithme de signature"
              value={formData.signature_algorithm}
              onChange={(e) => setFormData({ ...formData, signature_algorithm: e.target.value })}
              options={[
                { value: 'sha1', label: 'SHA-1 (legacy)' },
                { value: 'sha256', label: 'SHA-256 (recommandé)' },
                { value: 'sha512', label: 'SHA-512' }
              ]}
            />
            <div className="flex items-end pb-2">
              <ToggleSwitch
                enabled={formData.want_assertions_signed}
                onChange={(v) => setFormData({ ...formData, want_assertions_signed: v })}
                label="Exiger les assertions signées"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Mapping des attributs SAML
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Attribut email"
              value={formData.attribute_mapping.email}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, email: e.target.value }
              })}
              placeholder="email"
            />
            <Input
              label="Attribut prénom"
              value={formData.attribute_mapping.first_name}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, first_name: e.target.value }
              })}
              placeholder="givenName"
            />
            <Input
              label="Attribut nom"
              value={formData.attribute_mapping.last_name}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, last_name: e.target.value }
              })}
              placeholder="surname"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              enabled={formData.auto_create_user}
              onChange={(v) => setFormData({ ...formData, auto_create_user: v })}
              label="Créer automatiquement les utilisateurs"
            />
            <Select
              label="Rôle par défaut"
              value={formData.default_role}
              onChange={(e) => setFormData({ ...formData, default_role: e.target.value })}
              options={[
                { value: 'user', label: 'Utilisateur' },
                { value: 'supervisor', label: 'Superviseur' },
                { value: 'admin', label: 'Administrateur' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          loading={testMutation.isPending}
          icon={<Zap className="w-4 h-4" />}
        >
          Vérifier la configuration
        </Button>
        <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
          Enregistrer
        </Button>
      </div>

      {testResult && (
        <Alert type={testResult.success ? 'success' : 'error'}>
          <div className="flex items-center gap-2">
            {testResult.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {testResult.message}
          </div>
        </Alert>
      )}
    </form>
  )
}

// ==================== SECTION OPENID CONNECT ====================

function OidcSection({ config, queryClient }: { config: any; queryClient: any }) {
  const [showSecret, setShowSecret] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [formData, setFormData] = useState({
    discovery_url: '',
    client_id: '',
    client_secret: '',
    redirect_uri: '',
    scope: 'openid profile email',
    response_type: 'code',
    auto_create_user: true,
    default_role: 'user',
    attribute_mapping: {
      email: 'email',
      first_name: 'given_name',
      last_name: 'family_name'
    }
  })

  useEffect(() => {
    if (config) {
      setIsActive(config.is_active)
      if (config.config) {
        setFormData({
          ...formData,
          ...config.config,
          attribute_mapping: { ...formData.attribute_mapping, ...config.config.attribute_mapping }
        })
      }
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.put('/settings/auth/oidc', { is_active: isActive, config: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success('Configuration OpenID Connect enregistrée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const testMutation = useMutation({
    mutationFn: async () => api.post('/settings/auth/oidc/test'),
    onSuccess: (res: any) => setTestResult({ success: true, message: res.data.message }),
    onError: (err: any) => setTestResult({ success: false, message: err.response?.data?.message || 'Erreur' })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              OpenID Connect (OIDC)
            </CardTitle>
            <StatusBadge active={isActive} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={isActive}
            onChange={setIsActive}
            label="Activer l'authentification OpenID Connect"
          />

          <Alert type="info">
            <div className="text-sm">
              Compatible avec Azure AD, Google, Keycloak, Auth0, Okta et tout fournisseur compatible OpenID Connect.
            </div>
          </Alert>

          <Input
            label="URL de découverte (Discovery URL)"
            value={formData.discovery_url}
            onChange={(e) => setFormData({ ...formData, discovery_url: e.target.value })}
            placeholder="https://login.microsoftonline.com/.../v2.0/.well-known/openid-configuration"
            hint="URL .well-known/openid-configuration de votre IdP"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Client ID"
              value={formData.client_id}
              onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
              placeholder="votre-client-id"
              hint="Identifiant de l'application dans l'IdP"
            />
            <Input
              label="Client Secret"
              type={showSecret ? 'text' : 'password'}
              value={formData.client_secret}
              onChange={(e) => setFormData({ ...formData, client_secret: e.target.value })}
              placeholder={config?.config?.client_secret ? '••••••••' : 'Secret'}
              hint={config?.config?.client_secret ? 'Laisser vide pour conserver le secret actuel' : ''}
              rightIcon={
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="hover:text-gray-600">
                  {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              }
            />
          </div>
          <Input
            label="URI de redirection (Redirect URI)"
            value={formData.redirect_uri}
            onChange={(e) => setFormData({ ...formData, redirect_uri: e.target.value })}
            placeholder="https://votre-app.example.com/api/auth/oidc/callback"
            hint="URL à enregistrer dans votre IdP"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Scopes"
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
              placeholder="openid profile email"
              hint="Espaces séparant les scopes"
            />
            <Select
              label="Type de réponse"
              value={formData.response_type}
              onChange={(e) => setFormData({ ...formData, response_type: e.target.value })}
              options={[
                { value: 'code', label: 'Authorization Code (recommandé)' },
                { value: 'id_token', label: 'Implicit (ID Token)' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Mapping des claims OIDC
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Claim email"
              value={formData.attribute_mapping.email}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, email: e.target.value }
              })}
              placeholder="email"
            />
            <Input
              label="Claim prénom"
              value={formData.attribute_mapping.first_name}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, first_name: e.target.value }
              })}
              placeholder="given_name"
            />
            <Input
              label="Claim nom"
              value={formData.attribute_mapping.last_name}
              onChange={(e) => setFormData({
                ...formData,
                attribute_mapping: { ...formData.attribute_mapping, last_name: e.target.value }
              })}
              placeholder="family_name"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              enabled={formData.auto_create_user}
              onChange={(v) => setFormData({ ...formData, auto_create_user: v })}
              label="Créer automatiquement les utilisateurs"
            />
            <Select
              label="Rôle par défaut"
              value={formData.default_role}
              onChange={(e) => setFormData({ ...formData, default_role: e.target.value })}
              options={[
                { value: 'user', label: 'Utilisateur' },
                { value: 'supervisor', label: 'Superviseur' },
                { value: 'admin', label: 'Administrateur' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          loading={testMutation.isPending}
          icon={<Zap className="w-4 h-4" />}
        >
          Vérifier la configuration
        </Button>
        <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
          Enregistrer
        </Button>
      </div>

      {testResult && (
        <Alert type={testResult.success ? 'success' : 'error'}>
          <div className="flex items-center gap-2">
            {testResult.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {testResult.message}
          </div>
        </Alert>
      )}
    </form>
  )
}

// ==================== SECTION PASSKEY (WebAuthn) ====================

function PasskeySection({ config, queryClient }: { config: any; queryClient: any }) {
  const [isActive, setIsActive] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [formData, setFormData] = useState({
    rp_name: 'Gestion Matériels',
    rp_id: '',
    origin: '',
    attestation: 'none',
    authenticator_selection: {
      authenticator_attachment: 'platform',
      resident_key: 'preferred',
      user_verification: 'preferred'
    },
    timeout: 60000,
    allow_as_primary: false,
    allow_as_2fa: true
  })

  useEffect(() => {
    if (config) {
      setIsActive(config.is_active)
      if (config.config) {
        setFormData({
          ...formData,
          ...config.config,
          authenticator_selection: {
            ...formData.authenticator_selection,
            ...config.config.authenticator_selection
          }
        })
      }
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.put('/settings/auth/passkey', { is_active: isActive, config: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success('Configuration Passkey enregistrée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const testMutation = useMutation({
    mutationFn: async () => api.post('/settings/auth/passkey/test'),
    onSuccess: (res: any) => setTestResult({ success: true, message: res.data.message }),
    onError: (err: any) => setTestResult({ success: false, message: err.response?.data?.message || 'Erreur' })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="w-5 h-5" />
              Passkey (WebAuthn / FIDO2)
            </CardTitle>
            <StatusBadge active={isActive} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={isActive}
            onChange={setIsActive}
            label="Activer l'authentification Passkey"
          />

          <Alert type="info">
            <div className="text-sm">
              Les Passkeys permettent une authentification sans mot de passe via empreinte digitale, reconnaissance faciale ou clé de sécurité USB (YubiKey, etc.).
              Compatible Windows Hello, Touch ID, Face ID, Android biometrics.
            </div>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Nom de l'application (RP Name)"
              value={formData.rp_name}
              onChange={(e) => setFormData({ ...formData, rp_name: e.target.value })}
              placeholder="Gestion Matériels"
              hint="Nom affiché dans les invites biométriques"
            />
            <Input
              label="Identifiant RP (RP ID)"
              value={formData.rp_id}
              onChange={(e) => setFormData({ ...formData, rp_id: e.target.value })}
              placeholder="votre-domaine.example.com"
              hint="Domaine de votre application (sans protocole)"
            />
          </div>
          <Input
            label="Origine"
            value={formData.origin}
            onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
            placeholder="https://votre-domaine.example.com"
            hint="URL complète de votre application (avec https://)"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Options d'authentification
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Type d'attestation"
              value={formData.attestation}
              onChange={(e) => setFormData({ ...formData, attestation: e.target.value })}
              options={[
                { value: 'none', label: 'None (recommandé)' },
                { value: 'indirect', label: 'Indirect' },
                { value: 'direct', label: 'Direct' }
              ]}
            />
            <Input
              label="Timeout (millisecondes)"
              type="number"
              value={String(formData.timeout)}
              onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 60000 })}
              hint="Délai max pour la validation biométrique"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              label="Type d'authentificateur"
              value={formData.authenticator_selection.authenticator_attachment}
              onChange={(e) => setFormData({
                ...formData,
                authenticator_selection: {
                  ...formData.authenticator_selection,
                  authenticator_attachment: e.target.value
                }
              })}
              options={[
                { value: 'platform', label: 'Plateforme (biométrie intégrée)' },
                { value: 'cross-platform', label: 'Multi-plateforme (clé USB)' }
              ]}
            />
            <Select
              label="Clé résidente"
              value={formData.authenticator_selection.resident_key}
              onChange={(e) => setFormData({
                ...formData,
                authenticator_selection: {
                  ...formData.authenticator_selection,
                  resident_key: e.target.value
                }
              })}
              options={[
                { value: 'discouraged', label: 'Découragée' },
                { value: 'preferred', label: 'Préférée' },
                { value: 'required', label: 'Requise' }
              ]}
            />
            <Select
              label="Vérification utilisateur"
              value={formData.authenticator_selection.user_verification}
              onChange={(e) => setFormData({
                ...formData,
                authenticator_selection: {
                  ...formData.authenticator_selection,
                  user_verification: e.target.value
                }
              })}
              options={[
                { value: 'discouraged', label: 'Découragée' },
                { value: 'preferred', label: 'Préférée' },
                { value: 'required', label: 'Requise' }
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Mode d'utilisation
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <ToggleSwitch
            enabled={formData.allow_as_primary}
            onChange={(v) => setFormData({ ...formData, allow_as_primary: v })}
            label="Autoriser comme méthode d'authentification principale (sans mot de passe)"
          />
          <ToggleSwitch
            enabled={formData.allow_as_2fa}
            onChange={(v) => setFormData({ ...formData, allow_as_2fa: v })}
            label="Autoriser comme second facteur (2FA)"
          />

          {formData.allow_as_primary && (
            <Alert type="warning">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                En mode principal, les utilisateurs pourront se connecter uniquement avec leur Passkey, sans saisir de mot de passe.
                Assurez-vous que tous les utilisateurs ont enregistré au moins un Passkey.
              </div>
            </Alert>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          loading={testMutation.isPending}
          icon={<Zap className="w-4 h-4" />}
        >
          Vérifier la configuration
        </Button>
        <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
          Enregistrer
        </Button>
      </div>

      {testResult && (
        <Alert type={testResult.success ? 'success' : 'error'}>
          <div className="flex items-center gap-2">
            {testResult.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {testResult.message}
          </div>
        </Alert>
      )}
    </form>
  )
}
