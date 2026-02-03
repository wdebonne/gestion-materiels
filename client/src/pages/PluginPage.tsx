import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Puzzle, AlertCircle } from 'lucide-react'
import { Card, CardBody, Spinner } from '@/components/ui'
import api from '@/lib/api'
import DynamicPluginPage from '@/components/DynamicPluginPage'

export default function PluginPage() {
  const { pluginSlug, pageName = 'index' } = useParams<{ pluginSlug: string; pageName?: string }>()

  // Vérifier que le plugin existe et est actif
  const { data: plugin, isLoading, error } = useQuery({
    queryKey: ['plugin', pluginSlug],
    queryFn: async () => {
      const response = await api.get(`/plugins/${pluginSlug}`)
      return response.data.plugin
    },
    enabled: !!pluginSlug
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !plugin) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Plugin non trouvé</h2>
          <p className="text-gray-500">
            Le plugin "{pluginSlug}" n'existe pas ou n'est pas accessible.
          </p>
        </CardBody>
      </Card>
    )
  }

  if (!plugin.isActive) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <Puzzle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Plugin désactivé</h2>
          <p className="text-gray-500">
            Le plugin "{plugin.name}" est actuellement désactivé.
          </p>
        </CardBody>
      </Card>
    )
  }

  // Rendu de la page dynamique du plugin
  return <DynamicPluginPage pluginSlug={pluginSlug!} pageName={pageName} />
}
