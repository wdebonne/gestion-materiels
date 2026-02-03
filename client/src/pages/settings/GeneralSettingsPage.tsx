import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Globe, Image as ImageIcon } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Input, Button, ImageUpload } from '@/components/ui'
import { useSettingsStore } from '@/stores/settings.store'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function GeneralSettingsPage() {
  const queryClient = useQueryClient()
  const { fetchSettings } = useSettingsStore()
  
  const [formData, setFormData] = useState({
    siteName: '',
    siteUrl: '',
    logo: '',
    favicon: '',
    version: '1.0.0'
  })

  // Récupérer les paramètres
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get('/settings')
      return response.data.settings
    }
  })

  // Mettre à jour le formulaire quand les settings sont chargés
  useEffect(() => {
    if (settings) {
      setFormData({
        siteName: settings.site_name || settings.siteName || '',
        siteUrl: settings.site_url || settings.siteUrl || '',
        logo: settings.site_logo || settings.logo || '',
        favicon: settings.site_favicon || settings.favicon || '',
        version: settings.site_version || settings.version || '1.0.0'
      })
    }
  }, [settings])

  // Mutation pour sauvegarder
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put('/settings', { settings: data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      fetchSettings() // Mettre à jour le store global
      toast.success('Paramètres enregistrés')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la sauvegarde')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Convertir les noms camelCase en snake_case pour la BDD
    saveMutation.mutate({
      site_name: formData.siteName,
      site_url: formData.siteUrl,
      site_logo: formData.logo,
      site_favicon: formData.favicon,
      site_version: formData.version
    })
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
        <h1 className="text-2xl font-bold text-gray-900">Paramètres généraux</h1>
        <p className="text-gray-500 mt-1">Configurez les informations de base de l'application</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informations du site */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Informations du site
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="Nom du site"
              value={formData.siteName}
              onChange={(e) => setFormData({ ...formData, siteName: e.target.value })}
              placeholder="Gestion Matériels"
              hint="Ce nom sera affiché dans l'en-tête et les emails"
            />

            <Input
              label="URL du site"
              value={formData.siteUrl}
              onChange={(e) => setFormData({ ...formData, siteUrl: e.target.value })}
              placeholder="https://materiels.maville.fr"
              hint="L'URL complète de l'application (utilisée dans les emails)"
            />

            <Input
              label="Version"
              value={formData.version}
              onChange={(e) => setFormData({ ...formData, version: e.target.value })}
              placeholder="1.0.0"
              hint="Numéro de version de l'application"
            />
          </CardBody>
        </Card>

        {/* Images */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5" />
              Images
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-6">
            {/* Logo */}
            <ImageUpload
              label="Logo du site"
              value={formData.logo}
              onChange={(url) => setFormData({ ...formData, logo: url })}
              hint="Recommandé: PNG transparent, 200x60px"
            />

            {/* Favicon */}
            <ImageUpload
              label="Favicon"
              value={formData.favicon}
              onChange={(url) => setFormData({ ...formData, favicon: url })}
              hint="Recommandé: PNG ou ICO, 32x32px"
            />
          </CardBody>
        </Card>

        {/* Bouton de sauvegarde */}
        <div className="flex justify-end">
          <Button 
            type="submit"
            icon={<Save className="w-4 h-4" />}
            loading={saveMutation.isPending}
          >
            Enregistrer les paramètres
          </Button>
        </div>
      </form>
    </div>
  )
}
