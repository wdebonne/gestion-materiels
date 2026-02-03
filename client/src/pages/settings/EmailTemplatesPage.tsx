import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Edit2, Eye, Code, Save } from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, Input, TextArea,
  Modal, ModalBody, ModalFooter, Badge, LoadingInline, Alert, Tabs
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

interface EmailTemplate {
  id: number
  slug: string
  name: string
  subject: string
  bodyHtml: string
  bodyText: string
  variables: string[]
  isActive: boolean
}

export default function EmailTemplatesPage() {
  const queryClient = useQueryClient()
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null)
  const [activeTab, setActiveTab] = useState('html')
  
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    bodyHtml: '',
    bodyText: '',
    isActive: true
  })

  // Récupérer les templates
  const { data, isLoading } = useQuery({
    queryKey: ['email-templates'],
    queryFn: async () => {
      const response = await api.get('/email-templates')
      return response.data
    }
  })

  // Mutation pour modifier
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put(`/email-templates/${editingTemplate?.id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] })
      toast.success('Template enregistré')
      setEditingTemplate(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde')
    }
  })

  const openEdit = (template: EmailTemplate) => {
    setEditingTemplate(template)
    setFormData({
      name: template.name,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      isActive: template.isActive
    })
    setActiveTab('html')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(formData)
  }

  const getTemplateDescription = (slug: string) => {
    switch (slug) {
      case 'welcome':
        return 'Email envoyé lors de la création d\'un nouveau compte utilisateur'
      case 'password-reset':
        return 'Email contenant le lien de réinitialisation du mot de passe'
      case 'alert':
        return 'Notification envoyée pour les alertes (contrôle technique, maintenance, etc.)'
      default:
        return ''
    }
  }

  const templates = data?.templates || []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Templates d'emails</h1>
        <p className="text-gray-500 mt-1">Personnalisez les emails envoyés par l'application</p>
      </div>

      {/* Info sur les variables */}
      <Alert type="info" title="Variables disponibles">
        <p className="mb-2">
          Vous pouvez utiliser des variables dans vos templates avec la syntaxe <code className="bg-blue-100 px-1 rounded">{'{{variable}}'}</code>
        </p>
        <p className="text-xs">
          Variables communes : <code>{'{{siteName}}'}</code>, <code>{'{{siteUrl}}'}</code>, <code>{'{{userName}}'}</code>, <code>{'{{userEmail}}'}</code>
        </p>
      </Alert>

      {/* Liste des templates */}
      {isLoading ? (
        <LoadingInline message="Chargement des templates..." />
      ) : templates.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Mail className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Aucun template d'email</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4">
          {templates.map((template: EmailTemplate) => (
            <Card key={template.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary-100 rounded-lg">
                        <Mail className="w-5 h-5 text-primary-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{template.name}</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {getTemplateDescription(template.slug)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm">
                        <span className="text-gray-500">Sujet :</span>{' '}
                        <span className="font-medium">{template.subject}</span>
                      </p>
                    </div>

                    {template.variables && template.variables.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-xs text-gray-500">Variables :</span>
                        {template.variables.map((variable) => (
                          <code 
                            key={variable}
                            className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                          >
                            {`{{${variable}}}`}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={template.isActive ? 'success' : 'default'}>
                      {template.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewTemplate(template)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(template)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Modal d'édition */}
      <Modal
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        title={`Modifier : ${editingTemplate?.name}`}
        size="xl"
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Nom du template"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />

            <Input
              label="Sujet de l'email"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              hint="Vous pouvez utiliser des variables comme {{siteName}}"
              required
            />

            <div>
              <Tabs
                tabs={[
                  { id: 'html', label: 'HTML' },
                  { id: 'text', label: 'Texte brut' }
                ]}
                activeTab={activeTab}
                onChange={setActiveTab}
              />
              
              <div className="mt-4">
                {activeTab === 'html' ? (
                  <TextArea
                    label="Contenu HTML"
                    value={formData.bodyHtml}
                    onChange={(e) => setFormData({ ...formData, bodyHtml: e.target.value })}
                    rows={12}
                    className="font-mono text-sm"
                  />
                ) : (
                  <TextArea
                    label="Contenu texte"
                    value={formData.bodyText}
                    onChange={(e) => setFormData({ ...formData, bodyText: e.target.value })}
                    rows={12}
                    className="font-mono text-sm"
                    hint="Version texte pour les clients email qui ne supportent pas HTML"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">
                Template actif
              </label>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setEditingTemplate(null)}>
              Annuler
            </Button>
            <Button type="submit" icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending}>
              Enregistrer
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Modal de prévisualisation */}
      <Modal
        isOpen={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        title={`Aperçu : ${previewTemplate?.name}`}
        size="xl"
      >
        <ModalBody>
          <div className="space-y-4">
            <div className="p-3 bg-gray-100 rounded-lg">
              <p className="text-sm">
                <span className="text-gray-500 font-medium">Sujet :</span>{' '}
                {previewTemplate?.subject}
              </p>
            </div>
            
            <Tabs
              tabs={[
                { id: 'html', label: 'HTML' },
                { id: 'text', label: 'Texte' },
                { id: 'source', label: 'Source' }
              ]}
              activeTab={activeTab}
              onChange={setActiveTab}
            />

            <div className="border rounded-lg overflow-hidden">
              {activeTab === 'html' ? (
                <div 
                  className="p-4 bg-white min-h-[300px]"
                  dangerouslySetInnerHTML={{ __html: previewTemplate?.bodyHtml || '' }}
                />
              ) : activeTab === 'text' ? (
                <pre className="p-4 bg-gray-50 text-sm whitespace-pre-wrap min-h-[300px]">
                  {previewTemplate?.bodyText}
                </pre>
              ) : (
                <pre className="p-4 bg-gray-900 text-green-400 text-xs overflow-x-auto min-h-[300px]">
                  {previewTemplate?.bodyHtml}
                </pre>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPreviewTemplate(null)}>
            Fermer
          </Button>
          <Button onClick={() => {
            setPreviewTemplate(null)
            if (previewTemplate) openEdit(previewTemplate)
          }}>
            <Edit2 className="w-4 h-4 mr-2" />
            Modifier
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
