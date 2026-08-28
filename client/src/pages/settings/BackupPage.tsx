import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  Download, Upload, Trash2, HardDrive, 
  RefreshCw, CheckCircle, AlertTriangle, FileArchive, UploadCloud, Mail, 
  Database, Image, Puzzle, FolderArchive, Server, RotateCcw, Link2, Copy, ExternalLink
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, 
  Modal, ModalBody, ModalFooter, Badge, LoadingInline, Alert, Input
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate, formatFileSize } from '@/lib/utils'

interface Backup {
  id: number
  filename: string
  size: number
  fileSize?: number
  createdAt: string
  type: 'manual' | 'auto'
  backupType?: 'manual' | 'auto'
}

const MAX_EMAIL_SIZE = 25 * 1024 * 1024 // 25 MB

export default function BackupPage() {
  const [deleteConfirm, setDeleteConfirm] = useState<Backup | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState<Backup | null>(null)
  const [uploadConfirm, setUploadConfirm] = useState<File | null>(null)
  const [emailModal, setEmailModal] = useState<Backup | null>(null)
  const [linkModal, setLinkModal] = useState<Backup | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
  const [generatedLink, setGeneratedLink] = useState<{ link: string; expiresAt: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Options d'envoi automatique par email
  const [autoSendEmail, setAutoSendEmail] = useState(false)
  const [autoEmailAddress, setAutoEmailAddress] = useState('')
  
  // Charger les préférences depuis le localStorage
  useEffect(() => {
    const savedAutoSend = localStorage.getItem('backup_auto_send_email')
    const savedEmail = localStorage.getItem('backup_auto_email_address')
    if (savedAutoSend === 'true') setAutoSendEmail(true)
    if (savedEmail) setAutoEmailAddress(savedEmail)
  }, [])
  
  // Sauvegarder les préférences dans le localStorage
  useEffect(() => {
    localStorage.setItem('backup_auto_send_email', autoSendEmail.toString())
    localStorage.setItem('backup_auto_email_address', autoEmailAddress)
  }, [autoSendEmail, autoEmailAddress])

  // Récupérer les sauvegardes
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const response = await api.get('/backup')
      return response.data
    }
  })

  // Mutation pour créer une sauvegarde
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      return api.post('/backup', {
        sendEmail: autoSendEmail && autoEmailAddress,
        emailAddress: autoEmailAddress
      })
    },
    onSuccess: (response) => {
      refetch()
      const data = response.data
      if (data.emailSent) {
        if (data.downloadLink) {
          toast.success('Sauvegarde créée, lien de téléchargement envoyé par email')
        } else {
          toast.success('Sauvegarde créée et envoyée par email')
        }
      } else if (data.emailError) {
        toast.success('Sauvegarde créée')
        toast.error(`Erreur email: ${data.emailError}`)
      } else {
        toast.success('Sauvegarde créée avec succès')
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la création de la sauvegarde')
    }
  })

  // Mutation pour restaurer
  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.post('/backup/restore', { backupId: id })
    },
    onSuccess: () => {
      toast.success('Base de données restaurée avec succès. Rechargement de la page...')
      setTimeout(() => window.location.reload(), 2000)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la restauration')
    }
  })

  // Mutation pour supprimer
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/backup/${id}`)
    },
    onSuccess: () => {
      refetch()
      toast.success('Sauvegarde supprimée')
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour uploader une sauvegarde externe
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('backup', file)
      return api.post('/backup/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
    },
    onSuccess: () => {
      toast.success('Sauvegarde externe restaurée avec succès. Rechargement de la page...')
      setUploadConfirm(null)
      setTimeout(() => window.location.reload(), 2000)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la restauration')
      setUploadConfirm(null)
    }
  })

  // Mutation pour envoyer par email
  const sendEmailMutation = useMutation({
    mutationFn: async ({ id, email }: { id: number; email: string }) => {
      return api.post(`/backup/${id}/send-email`, { email })
    },
    onSuccess: (response) => {
      const data = response.data
      if (data.usedLink) {
        toast.success('Lien de téléchargement envoyé par email')
      } else {
        toast.success('Sauvegarde envoyée par email avec succès')
      }
      setEmailModal(null)
      setEmailAddress('')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'envoi')
    }
  })

  // Mutation pour générer un lien de téléchargement
  const generateLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.post(`/backup/${id}/generate-link`, { expiresInDays: 7 })
    },
    onSuccess: (response) => {
      const data = response.data
      setGeneratedLink({
        link: data.downloadLink,
        expiresAt: data.expiresAt
      })
      toast.success('Lien de téléchargement généré')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la génération du lien')
    }
  })

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.zip')) {
        toast.error('Le fichier doit être au format ZIP')
        return
      }
      setUploadConfirm(file)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (backup: Backup) => {
    try {
      const response = await api.get(`/backup/${backup.id}/download`, {
        responseType: 'blob'
      })
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', backup.filename)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      toast.error('Erreur lors du téléchargement')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Lien copié dans le presse-papiers')
  }

  const getBackupSize = (backup: Backup): number => {
    return backup.size || backup.fileSize || 0
  }

  const backups: Backup[] = (data?.backups || []).map((b: any) => ({
    ...b,
    size: b.size || b.fileSize,
    type: b.type || b.backupType
  }))
  const lastBackup = backups[0]

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sauvegardes</h1>
        <p className="text-gray-500 mt-1">Gérez les sauvegardes complètes du site (base de données, fichiers, images et plugins)</p>
      </div>

      {/* Sauvegarde Totale - Card principale */}
      <Card className="border-2 border-primary-200 bg-gradient-to-br from-primary-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-primary-700">
            <FolderArchive className="w-6 h-6" />
            Créer une sauvegarde
          </CardTitle>
        </CardHeader>
        <CardBody className="pt-2">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Créez une sauvegarde complète de votre site incluant tous les éléments essentiels :
            </p>
            
            {/* Éléments inclus dans la sauvegarde */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200">
                <Database className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Base de données</p>
                  <p className="text-xs text-gray-500">Toutes les données</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200">
                <Image className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Images & Fichiers</p>
                  <p className="text-xs text-gray-500">Dossier uploads</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200">
                <Puzzle className="w-5 h-5 text-purple-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Plugins</p>
                  <p className="text-xs text-gray-500">Extensions installées</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200">
                <Server className="w-5 h-5 text-orange-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Configuration</p>
                  <p className="text-xs text-gray-500">Paramètres système</p>
                </div>
              </div>
            </div>

            <Button
              size="lg"
              onClick={() => createBackupMutation.mutate()}
              loading={createBackupMutation.isPending}
              className="w-full sm:w-auto"
            >
              <Download className="w-5 h-5 mr-2" />
              Créer une sauvegarde complète
            </Button>

            {lastBackup && (
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>
                  Dernière sauvegarde : <strong>{formatDate(lastBackup.createdAt)}</strong> ({formatFileSize(getBackupSize(lastBackup))})
                </span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Restauration */}
      <Card className="border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <RotateCcw className="w-6 h-6" />
            Restauration
          </CardTitle>
        </CardHeader>
        <CardBody className="pt-2">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Restaurez l'intégralité de votre site à partir d'un fichier de sauvegarde ZIP :
            </p>

            <Alert type="warning">
              <strong>Attention :</strong> La restauration remplacera toutes les données actuelles. Cette action est irréversible.
            </Alert>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="w-4 h-4 mr-2" />
              Sélectionner un fichier ZIP
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Configuration envoi automatique par email */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Envoi automatique par email
          </CardTitle>
        </CardHeader>
        <CardBody className="pt-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-gray-900">Envoyer par email après création</h4>
                <p className="text-sm text-gray-500">
                  Envoie automatiquement chaque nouvelle sauvegarde à l'adresse email configurée
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSendEmail}
                  onChange={(e) => setAutoSendEmail(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            
            {autoSendEmail && (
              <div className="pt-2 space-y-3">
                <Input
                  label="Adresse email de destination"
                  type="email"
                  placeholder="exemple@email.com"
                  value={autoEmailAddress}
                  onChange={(e) => setAutoEmailAddress(e.target.value)}
                />
                <Alert type="info">
                  <strong>Note :</strong> Les sauvegardes de plus de 25 MB seront envoyées sous forme de lien de téléchargement temporaire (valide 7 jours).
                </Alert>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Info */}
      <Alert type="info" title="Sauvegardes automatiques">
        Une sauvegarde automatique est créée chaque nuit à 2h00. Les sauvegardes de plus de 30 jours sont automatiquement supprimées.
      </Alert>

      {/* Liste des sauvegardes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Historique des sauvegardes
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-6"><LoadingInline /></div>
          ) : backups.length === 0 ? (
            <div className="text-center py-12">
              <FileArchive className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Aucune sauvegarde disponible</p>
              <Button 
                className="mt-4"
                onClick={() => createBackupMutation.mutate()}
                loading={createBackupMutation.isPending}
              >
                Créer la première sauvegarde
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fichier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Taille</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {backups.map((backup: Backup) => (
                    <tr key={backup.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <FileArchive className="w-5 h-5 text-gray-600" />
                          <span className="font-medium text-gray-900 font-mono text-sm">
                            {backup.filename}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={backup.type === 'auto' ? 'info' : 'default'}>
                          {backup.type === 'auto' ? 'Automatique' : 'Manuelle'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          <span>{formatFileSize(getBackupSize(backup))}</span>
                          {getBackupSize(backup) > MAX_EMAIL_SIZE && (
                            <span className="text-xs text-orange-500" title="Ce fichier sera envoyé sous forme de lien">
                              📎
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(backup.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownload(backup)}
                            className="p-2 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title="Télécharger" aria-label="Télécharger"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setLinkModal(backup)
                              setGeneratedLink(null)
                            }}
                            className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Générer un lien de téléchargement" aria-label="Générer un lien de téléchargement"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEmailModal(backup)
                              setEmailAddress('')
                            }}
                            className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Envoyer par email" aria-label="Envoyer par email"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRestoreConfirm(backup)}
                            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Restaurer" aria-label="Restaurer"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(backup)}
                            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Supprimer" aria-label="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Modal confirmation restauration */}
      <Modal
        isOpen={!!restoreConfirm}
        onClose={() => setRestoreConfirm(null)}
        title="Restauration du site"
        size="md"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-orange-600 mb-4">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-medium">Attention - Restauration complète</span>
          </div>
          <p className="text-gray-600">
            Restaurer la sauvegarde <strong>{restoreConfirm?.filename}</strong> ?
          </p>
          
          <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-sm font-medium text-orange-800 mb-2">Éléments qui seront remplacés :</p>
            <ul className="text-sm text-orange-700 space-y-1">
              <li className="flex items-center gap-2"><Database className="w-4 h-4" /> Base de données</li>
              <li className="flex items-center gap-2"><Image className="w-4 h-4" /> Images et fichiers</li>
              <li className="flex items-center gap-2"><Puzzle className="w-4 h-4" /> Plugins</li>
              <li className="flex items-center gap-2"><Server className="w-4 h-4" /> Configuration</li>
            </ul>
          </div>
          
          <p className="text-sm text-red-600 mt-4 font-medium">
            ⚠️ Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRestoreConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={restoreMutation.isPending}
            onClick={() => restoreConfirm && restoreMutation.mutate(restoreConfirm.id)}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Restaurer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer la sauvegarde"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600">
            Supprimer la sauvegarde <strong>{deleteConfirm?.filename}</strong> ?
          </p>
          <p className="text-sm text-red-600 mt-2">
            Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={deleteMutation.isPending}
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal confirmation upload/restauration externe */}
      <Modal
        isOpen={!!uploadConfirm}
        onClose={() => setUploadConfirm(null)}
        title="Restauration depuis fichier"
        size="md"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-orange-600 mb-4">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-medium">Attention - Restauration complète</span>
          </div>
          <p className="text-gray-600">
            Restaurer depuis le fichier <strong>{uploadConfirm?.name}</strong> ?
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Taille : {uploadConfirm && formatFileSize(uploadConfirm.size)}
          </p>
          
          <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-sm font-medium text-orange-800 mb-2">Éléments qui seront remplacés :</p>
            <ul className="text-sm text-orange-700 space-y-1">
              <li className="flex items-center gap-2"><Database className="w-4 h-4" /> Base de données</li>
              <li className="flex items-center gap-2"><Image className="w-4 h-4" /> Images et fichiers</li>
              <li className="flex items-center gap-2"><Puzzle className="w-4 h-4" /> Plugins</li>
              <li className="flex items-center gap-2"><Server className="w-4 h-4" /> Configuration</li>
            </ul>
          </div>
          
          <p className="text-sm text-red-600 mt-4 font-medium">
            ⚠️ Cette action est irréversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setUploadConfirm(null)}>
            Annuler
          </Button>
          <Button 
            variant="danger" 
            loading={uploadMutation.isPending}
            onClick={() => uploadConfirm && uploadMutation.mutate(uploadConfirm)}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Restaurer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal envoi par email */}
      <Modal
        isOpen={!!emailModal}
        onClose={() => {
          setEmailModal(null)
          setEmailAddress('')
        }}
        title="Envoyer par email"
        size="sm"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-green-600 mb-4">
            <Mail className="w-6 h-6" />
            <span className="font-medium">Envoi par email</span>
          </div>
          <p className="text-gray-600 mb-4">
            Envoyer <strong>{emailModal?.filename}</strong>
          </p>
          
          {emailModal && getBackupSize(emailModal) > MAX_EMAIL_SIZE && (
            <Alert type="info" className="mb-4">
              Ce fichier dépasse 25 MB. Un lien de téléchargement temporaire (7 jours) sera envoyé à la place.
            </Alert>
          )}
          
          <Input
            label="Adresse email"
            type="email"
            placeholder="exemple@email.com"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => {
            setEmailModal(null)
            setEmailAddress('')
          }}>
            Annuler
          </Button>
          <Button 
            loading={sendEmailMutation.isPending}
            disabled={!emailAddress}
            onClick={() => emailModal && sendEmailMutation.mutate({ id: emailModal.id, email: emailAddress })}
          >
            <Mail className="w-4 h-4 mr-2" />
            Envoyer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal génération de lien */}
      <Modal
        isOpen={!!linkModal}
        onClose={() => {
          setLinkModal(null)
          setGeneratedLink(null)
        }}
        title="Lien de téléchargement"
        size="md"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-purple-600 mb-4">
            <Link2 className="w-6 h-6" />
            <span className="font-medium">Générer un lien de téléchargement</span>
          </div>
          
          <p className="text-gray-600 mb-4">
            Fichier : <strong>{linkModal?.filename}</strong>
            <br />
            <span className="text-sm text-gray-500">Taille : {linkModal && formatFileSize(getBackupSize(linkModal))}</span>
          </p>
          
          {!generatedLink ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-4">
                Générez un lien de téléchargement temporaire valide 7 jours.
                Ce lien peut être partagé sans nécessiter de connexion.
              </p>
              <Button 
                onClick={() => linkModal && generateLinkMutation.mutate(linkModal.id)}
                loading={generateLinkMutation.isPending}
              >
                <Link2 className="w-4 h-4 mr-2" />
                Générer le lien
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert type="success">
                Lien généré avec succès !
              </Alert>
              
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Lien de téléchargement :</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedLink.link}
                    className="flex-1 text-sm font-mono bg-white border border-gray-300 rounded px-3 py-2"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyToClipboard(generatedLink.link)}
                    title="Copier" aria-label="Copier"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(generatedLink.link, '_blank')}
                    title="Ouvrir" aria-label="Ouvrir"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-orange-600 mt-2">
                  ⏰ Expire le : {new Date(generatedLink.expiresAt).toLocaleString('fr-FR')}
                </p>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => {
            setLinkModal(null)
            setGeneratedLink(null)
          }}>
            Fermer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
