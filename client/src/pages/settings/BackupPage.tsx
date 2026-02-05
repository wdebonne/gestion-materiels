import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  Download, Upload, Trash2, Clock, HardDrive, 
  RefreshCw, CheckCircle, AlertTriangle, FileArchive, UploadCloud, Mail, Settings,
  Database, Image, Puzzle, FolderArchive, Server, RotateCcw
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
  createdAt: string
  type: 'manual' | 'auto'
}

export default function BackupPage() {
  const [deleteConfirm, setDeleteConfirm] = useState<Backup | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState<Backup | null>(null)
  const [uploadConfirm, setUploadConfirm] = useState<File | null>(null)
  const [emailModal, setEmailModal] = useState<Backup | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
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
        toast.success('Sauvegarde créée et envoyée par email')
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
    onSuccess: () => {
      toast.success('Sauvegarde envoyée par email avec succès')
      setEmailModal(null)
      setEmailAddress('')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'envoi')
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

  const backups = data?.backups || []
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary-700">
            <FolderArchive className="w-6 h-6" />
            Sauvegarde Totale du Site
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <p className="text-gray-600">
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

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                size="lg"
                onClick={() => createBackupMutation.mutate()}
                loading={createBackupMutation.isPending}
                className="flex-1"
              >
                <Download className="w-5 h-5 mr-2" />
                Créer une sauvegarde complète (ZIP)
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Restaurer depuis un fichier ZIP
              </Button>
            </div>

            {lastBackup && (
              <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Dernière sauvegarde : {formatDate(lastBackup.createdAt)} ({formatFileSize(lastBackup.size)})
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Actions rapides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardBody>
            <div className="flex items-center gap-4">
              <div className="p-4 bg-green-100 rounded-xl">
                <Download className="w-8 h-8 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Sauvegarde rapide</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Créer une sauvegarde complète immédiatement
                </p>
              </div>
              <Button
                onClick={() => createBackupMutation.mutate()}
                loading={createBackupMutation.isPending}
              >
                Sauvegarder
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-4">
              <div className="p-4 bg-blue-100 rounded-xl">
                <Clock className="w-8 h-8 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Dernière sauvegarde</h3>
                {lastBackup ? (
                  <p className="text-sm text-gray-500 mt-1">
                    {formatDate(lastBackup.createdAt)} ({formatFileSize(lastBackup.size)})
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">Aucune sauvegarde</p>
                )}
              </div>
              <Badge variant={lastBackup ? 'success' : 'warning'}>
                {lastBackup ? 'OK' : 'À faire'}
              </Badge>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Restauration globale depuis fichier externe */}
      <Card className="border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <RotateCcw className="w-6 h-6" />
            Restauration Globale
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <p className="text-gray-600">
              Restaurez l'intégralité de votre site à partir d'un fichier de sauvegarde ZIP. Cette opération remplacera :
            </p>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-orange-200">
                <Database className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-gray-700">Base de données</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-orange-200">
                <Image className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-gray-700">Images & Fichiers</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-orange-200">
                <Puzzle className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-gray-700">Plugins</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-orange-200">
                <Server className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-gray-700">Configuration</span>
              </div>
            </div>

            <Alert type="warning">
              <strong>⚠️ Attention :</strong> La restauration remplacera toutes les données actuelles par celles contenues dans le fichier de sauvegarde. Cette action est irréversible.
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
              className="w-full sm:w-auto"
            >
              <UploadCloud className="w-4 h-4 mr-2" />
              Sélectionner un fichier ZIP de sauvegarde
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Configuration envoi automatique par email */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Envoi automatique par email
          </CardTitle>
        </CardHeader>
        <CardBody>
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
              <div className="pt-2">
                <Input
                  label="Adresse email de destination"
                  type="email"
                  placeholder="exemple@email.com"
                  value={autoEmailAddress}
                  onChange={(e) => setAutoEmailAddress(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  ⚠️ Les sauvegardes de plus de 25 MB ne pourront pas être envoyées par email.
                </p>
              </div>
            )}
            
            {autoSendEmail && autoEmailAddress && (
              <Alert type="success">
                Les prochaines sauvegardes seront automatiquement envoyées à <strong>{autoEmailAddress}</strong>
              </Alert>
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
                          <FileArchive className="w-5 h-5 text-gray-400" />
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
                        {formatFileSize(backup.size)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(backup.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDownload(backup)}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                            title="Télécharger"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEmailModal(backup)
                              setEmailAddress('')
                            }}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                            title="Envoyer par email"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRestoreConfirm(backup)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Restaurer"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(backup)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Supprimer"
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
        title="Restauration Globale du Site"
        size="md"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-yellow-600 mb-4">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-medium">Attention - Restauration Complète !</span>
          </div>
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir restaurer la sauvegarde <strong>{restoreConfirm?.filename}</strong> ?
          </p>
          
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-sm font-medium text-yellow-800 mb-2">Cette restauration va remplacer :</p>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li className="flex items-center gap-2">
                <Database className="w-4 h-4" /> Base de données complète
              </li>
              <li className="flex items-center gap-2">
                <Image className="w-4 h-4" /> Toutes les images et fichiers uploadés
              </li>
              <li className="flex items-center gap-2">
                <Puzzle className="w-4 h-4" /> Tous les plugins installés
              </li>
              <li className="flex items-center gap-2">
                <Server className="w-4 h-4" /> Configuration et paramètres
              </li>
            </ul>
          </div>
          
          <p className="text-sm text-red-600 mt-4 font-medium">
            ⚠️ Cette action est irréversible. Toutes les données actuelles seront remplacées.
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
            Restaurer tout le site
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
            Êtes-vous sûr de vouloir supprimer la sauvegarde <strong>{deleteConfirm?.filename}</strong> ?
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
        title="Restauration Globale du Site"
        size="md"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-orange-600 mb-4">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-medium">Attention - Restauration Complète !</span>
          </div>
          <p className="text-gray-600">
            Vous êtes sur le point de restaurer le fichier <strong>{uploadConfirm?.name}</strong>
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Taille : {uploadConfirm && formatFileSize(uploadConfirm.size)}
          </p>
          
          <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-sm font-medium text-orange-800 mb-2">Cette restauration va remplacer :</p>
            <ul className="text-sm text-orange-700 space-y-1">
              <li className="flex items-center gap-2">
                <Database className="w-4 h-4" /> Base de données complète
              </li>
              <li className="flex items-center gap-2">
                <Image className="w-4 h-4" /> Toutes les images et fichiers uploadés
              </li>
              <li className="flex items-center gap-2">
                <Puzzle className="w-4 h-4" /> Tous les plugins installés
              </li>
              <li className="flex items-center gap-2">
                <Server className="w-4 h-4" /> Configuration et paramètres
              </li>
            </ul>
          </div>
          
          <p className="text-sm text-red-600 mt-4 font-medium">
            ⚠️ Cette action est irréversible. Assurez-vous d'avoir une sauvegarde des données actuelles si nécessaire.
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
            Restaurer tout le site
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
        title="Envoyer la sauvegarde par email"
        size="sm"
      >
        <ModalBody>
          <div className="flex items-center gap-3 text-green-600 mb-4">
            <Mail className="w-6 h-6" />
            <span className="font-medium">Envoi par email</span>
          </div>
          <p className="text-gray-600 mb-4">
            Envoyer la sauvegarde <strong>{emailModal?.filename}</strong> par email.
          </p>
          {emailModal && emailModal.size > 25 * 1024 * 1024 && (
            <Alert type="warning" className="mb-4">
              Le fichier dépasse 25 MB et ne pourra pas être envoyé par email. Veuillez le télécharger directement.
            </Alert>
          )}
          <Input
            label="Adresse email"
            type="email"
            placeholder="exemple@email.com"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
          />
          <p className="text-sm text-gray-500 mt-2">
            La sauvegarde sera envoyée en pièce jointe.
          </p>
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
            disabled={!emailAddress || (emailModal && emailModal.size > 25 * 1024 * 1024)}
            onClick={() => emailModal && sendEmailMutation.mutate({ id: emailModal.id, email: emailAddress })}
          >
            <Mail className="w-4 h-4 mr-2" />
            Envoyer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
