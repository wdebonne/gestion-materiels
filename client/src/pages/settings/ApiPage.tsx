import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  Code2, ExternalLink, Copy, CheckCircle, 
  Server, FileJson, Shield, Globe
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Badge } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface ApiTag {
  name: string
  description: string
}

interface ApiInfo {
  version: string
  title: string
  totalEndpoints: number
  methodCounts: Record<string, number>
  tagCounts: Record<string, number>
  tags: ApiTag[]
  swaggerUrl: string
  specUrl: string
}

const methodColors: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800',
  POST: 'bg-green-100 text-green-800',
  PUT: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
  PATCH: 'bg-purple-100 text-purple-800',
}

export default function ApiPage() {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const { data: apiInfo, isLoading } = useQuery<ApiInfo>({
    queryKey: ['api-info'],
    queryFn: async () => {
      const response = await api.get('/api-info')
      return response.data.data
    },
  })

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success('Copié dans le presse-papiers')
    setTimeout(() => setCopiedField(null), 2000)
  }

  const baseUrl = window.location.origin

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Code2 className="w-7 h-7 text-primary-600" />
          API
        </h1>
        <p className="text-gray-500 mt-1">
          Documentation et informations sur l'API REST de l'application
        </p>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg">
              <Server className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Endpoints</p>
              <p className="text-2xl font-bold text-gray-900">{apiInfo?.totalEndpoints || 0}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Globe className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Version API</p>
              <p className="text-2xl font-bold text-gray-900">v{apiInfo?.version || '?'}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <FileJson className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Format</p>
              <p className="text-2xl font-bold text-gray-900">REST</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-lg">
              <Shield className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Auth</p>
              <p className="text-2xl font-bold text-gray-900">JWT</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Swagger UI Link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-green-600" />
            Documentation Swagger
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-gray-600">
            Accédez à la documentation interactive Swagger UI pour explorer et tester tous les endpoints de l'API.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={`${baseUrl}/api-docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Ouvrir Swagger UI
            </a>
            <button
              onClick={() => copyToClipboard(`${baseUrl}/api-docs`, 'swagger')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              {copiedField === 'swagger' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              Copier le lien
            </button>
          </div>
        </CardBody>
      </Card>

      {/* URLs utiles */}
      <Card>
        <CardHeader>
          <CardTitle>URLs de l'API</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            {[
              { label: 'Base URL', value: `${baseUrl}/api`, field: 'base' },
              { label: 'Swagger UI', value: `${baseUrl}/api-docs`, field: 'docs' },
              { label: 'OpenAPI Spec (JSON)', value: `${baseUrl}/api/swagger.json`, field: 'spec' },
            ].map(item => (
              <div key={item.field} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-700">{item.label}</p>
                  <p className="text-sm text-gray-500 font-mono break-all">{item.value}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(item.value, item.field)}
                  className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Copier"
                >
                  {copiedField === item.field ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Méthodes HTTP */}
      {apiInfo?.methodCounts && (
        <Card>
          <CardHeader>
            <CardTitle>Répartition par méthode HTTP</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-3">
              {Object.entries(apiInfo.methodCounts)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([method, count]) => (
                  <div key={method} className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${methodColors[method] || 'bg-gray-100 text-gray-800'}`}>
                      {method}
                    </span>
                    <span className="text-gray-600 font-medium">{count as number} endpoints</span>
                  </div>
                ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Modules API */}
      {apiInfo?.tags && apiInfo.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Modules API</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {apiInfo.tags.map((tag: ApiTag) => (
                <div key={tag.name} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary-500" />
                    <div>
                      <p className="font-medium text-gray-900">{tag.name}</p>
                      <p className="text-sm text-gray-500">{tag.description}</p>
                    </div>
                  </div>
                  <Badge variant="info">
                    {apiInfo.tagCounts[tag.name] || 0}
                  </Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Authentification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600" />
            Authentification
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-gray-600">
            L'API utilise l'authentification JWT (JSON Web Token). La plupart des endpoints nécessitent un token valide.
          </p>
          <div className="bg-gray-900 rounded-lg p-4 text-sm font-mono text-gray-100 overflow-x-auto">
            <p className="text-gray-400"># 1. Obtenir un token</p>
            <p className="text-green-400">POST /api/auth/login</p>
            <p className="text-gray-300">{'{'} "email": "user@example.com", "password": "..." {'}'}</p>
            <p className="mt-3 text-gray-400"># 2. Utiliser le token dans les requêtes</p>
            <p className="text-blue-400">GET /api/objects</p>
            <p className="text-gray-300">Authorization: Bearer {'<'}votre_token{'>'}</p>
            <p className="mt-3 text-gray-400"># 3. Rafraîchir le token</p>
            <p className="text-green-400">POST /api/auth/refresh</p>
            <p className="text-gray-300">{'{'} "refreshToken": "..." {'}'}</p>
          </div>
        </CardBody>
      </Card>

      {/* Rate Limiting */}
      <Card>
        <CardHeader>
          <CardTitle>Rate Limiting</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-gray-600 mb-4">
            L'API applique des limites de requêtes pour protéger le serveur. Voici les limites principales :
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Route</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Limite</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="py-2 px-3 font-mono text-gray-600">/api/*</td>
                  <td className="py-2 px-3"><Badge variant="info">Global</Badge></td>
                  <td className="py-2 px-3 text-gray-500">Limite globale sur toutes les routes</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono text-gray-600">/api/auth/*</td>
                  <td className="py-2 px-3"><Badge variant="warning">Strict</Badge></td>
                  <td className="py-2 px-3 text-gray-500">Limite stricte sur l'authentification</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono text-gray-600">/api/upload/*</td>
                  <td className="py-2 px-3"><Badge variant="warning">Strict</Badge></td>
                  <td className="py-2 px-3 text-gray-500">Limite sur les uploads de fichiers</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono text-gray-600">/api/backup/*</td>
                  <td className="py-2 px-3"><Badge variant="warning">Strict</Badge></td>
                  <td className="py-2 px-3 text-gray-500">Limite sur les exports/sauvegardes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
