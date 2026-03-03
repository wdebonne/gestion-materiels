import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Mail, Server, Lock, Send, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function SmtpSettingsPage() {
  const queryClient = useQueryClient()
  const [showPassword, setShowPassword] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  
  const [formData, setFormData] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'tls',
    smtpUser: '',
    smtpPassword: '',
    smtpFrom: '',
    smtpFromName: ''
  })

  // Récupérer les paramètres SMTP
  const { data: settings, isLoading } = useQuery({
    queryKey: ['smtp-settings'],
    queryFn: async () => {
      const response = await api.get('/settings/smtp')
      return response.data
    }
  })

  // Mettre à jour le formulaire quand les settings sont chargés
  useEffect(() => {
    if (settings) {
      setFormData({
        smtpHost: settings.smtpHost || '',
        smtpPort: settings.smtpPort || '587',
        smtpSecure: settings.smtpSecure || 'tls',
        smtpUser: settings.smtpUser || '',
        smtpPassword: '', // Ne pas afficher le mot de passe existant
        smtpFrom: settings.smtpFrom || '',
        smtpFromName: settings.smtpFromName || ''
      })
    }
  }, [settings])

  // Mutation pour sauvegarder
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      // Ne pas envoyer le mot de passe s'il est vide (garder l'existant)
      const payload = { ...data }
      if (!payload.smtpPassword) {
        delete payload.smtpPassword
      }
      return api.put('/settings/smtp', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-settings'] })
      toast.success('Configuration SMTP enregistrée')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde')
    }
  })

  // Mutation pour tester
  const testMutation = useMutation({
    mutationFn: async (email: string) => {
      return api.post('/settings/smtp/test', { email })
    },
    onSuccess: () => {
      setTestResult({ success: true, message: 'Email de test envoyé avec succès !' })
    },
    onError: (err: any) => {
      setTestResult({ 
        success: false, 
        message: err.response?.data?.message || 'Échec de l\'envoi de l\'email de test'
      })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const handleTest = () => {
    if (!testEmail) {
      toast.error('Veuillez entrer une adresse email de test')
      return
    }
    setTestResult(null)
    testMutation.mutate(testEmail)
  }

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-1/4"></div>
      <div className="h-64 bg-gray-200 rounded"></div>
    </div>
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuration SMTP</h1>
        <p className="text-gray-500 mt-1">Configurez l'envoi d'emails pour les notifications et alertes</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Serveur SMTP */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              Serveur SMTP
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Hôte SMTP"
                value={formData.smtpHost}
                onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                placeholder="smtp.example.com"
                hint="Adresse du serveur SMTP"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Port"
                  value={formData.smtpPort}
                  onChange={(e) => setFormData({ ...formData, smtpPort: e.target.value })}
                  placeholder="587"
                />
                <Select
                  label="Sécurité"
                  value={formData.smtpSecure}
                  onChange={(e) => setFormData({ ...formData, smtpSecure: e.target.value })}
                  options={[
                    { value: 'none', label: 'Aucune' },
                    { value: 'tls', label: 'TLS/STARTTLS' },
                    { value: 'ssl', label: 'SSL' }
                  ]}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Authentification */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Authentification
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="Nom d'utilisateur"
              value={formData.smtpUser}
              onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
              placeholder="user@example.com"
              hint="Généralement votre adresse email"
            />
            <Input
              label="Mot de passe"
              type={showPassword ? 'text' : 'password'}
              value={formData.smtpPassword}
              onChange={(e) => setFormData({ ...formData, smtpPassword: e.target.value })}
              placeholder={settings?.smtpPassword ? '••••••••' : 'Mot de passe'}
              hint={settings?.smtpPassword ? 'Laisser vide pour conserver le mot de passe actuel' : ''}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              }
            />
          </CardBody>
        </Card>

        {/* Expéditeur */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Expéditeur
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Email de l'expéditeur"
                type="email"
                value={formData.smtpFrom}
                onChange={(e) => setFormData({ ...formData, smtpFrom: e.target.value })}
                placeholder="noreply@example.com"
                hint="Adresse email qui apparaîtra comme expéditeur"
              />
              <Input
                label="Nom de l'expéditeur"
                value={formData.smtpFromName}
                onChange={(e) => setFormData({ ...formData, smtpFromName: e.target.value })}
                placeholder="Gestion Matériels"
                hint="Nom qui apparaîtra dans les emails"
              />
            </div>
          </CardBody>
        </Card>

        {/* Bouton de sauvegarde */}
        <div className="flex justify-end">
          <Button 
            type="submit"
            icon={<Save className="w-4 h-4" />}
            loading={saveMutation.isPending}
          >
            Enregistrer la configuration
          </Button>
        </div>
      </form>

      {/* Test SMTP */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Tester la configuration
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-500">
            Envoyez un email de test pour vérifier que la configuration SMTP fonctionne correctement.
          </p>
          
          {testResult && (
            <Alert type={testResult.success ? 'success' : 'error'}>
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                {testResult.message}
              </div>
            </Alert>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="votre@email.com"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              loading={testMutation.isPending}
              icon={<Send className="w-4 h-4" />}
            >
              Envoyer un test
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
