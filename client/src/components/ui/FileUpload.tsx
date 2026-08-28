import { useState, useRef } from 'react'
import { Upload, X, FileText, Image as ImageIcon, Eye, Download, Trash2, Camera } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { resizeImage, isResizableImage, formatFileSize } from '@/lib/imageResize'

export interface UploadedFile {
  url: string
  filename: string
  originalName: string
  mimetype: string
  size: number
}

interface FileUploadProps {
  value?: UploadedFile[]
  onChange: (files: UploadedFile[]) => void
  label?: string
  hint?: string
  accept?: string
  maxSize?: number // en MB
  maxFiles?: number
  className?: string
}

export default function FileUpload({
  value = [],
  onChange,
  label,
  hint,
  accept = 'image/*,.pdf',
  maxSize = 10,
  maxFiles = 5,
  className = ''
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewModal, setPreviewModal] = useState<UploadedFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const isImage = (mimetype: string) => mimetype.startsWith('image/')
  const isPdf = (mimetype: string) => mimetype === 'application/pdf'

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    // Vérifier le nombre max de fichiers
    if (value.length + files.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} fichiers autorisés`)
      return
    }

    const filesToUpload: File[] = []
    
    for (let i = 0; i < files.length; i++) {
      const brut = files[i]

      // Vérifier le type avant tout traitement
      const isValidType = brut.type.startsWith('image/') || brut.type === 'application/pdf'
      if (!isValidType) {
        toast.error(`${brut.name} : type de fichier non autorisé. Utilisez une image ou un PDF.`)
        continue
      }

      // Réduire AVANT de contrôler la taille : une photo de téléphone dépasse
      // souvent 10 Mo à la prise de vue, et tient sous 1 Mo une fois réduite.
      let file = brut
      if (isResizableImage(brut)) {
        try {
          file = await resizeImage(brut)
        } catch {
          file = brut
        }
      }

      if (file.size > maxSize * 1024 * 1024) {
        toast.error(
          `${brut.name} est trop volumineux (${formatFileSize(file.size)}, maximum ${maxSize} Mo).`
        )
        continue
      }

      filesToUpload.push(file)
    }

    if (filesToUpload.length === 0) return

    setUploading(true)
    try {
      const uploadedFiles: UploadedFile[] = []

      for (const file of filesToUpload) {
        const formData = new FormData()
        formData.append('file', file)

        const response = await api.post('/upload/file', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })

        if (response.data.success) {
          uploadedFiles.push({
            url: response.data.url,
            filename: response.data.filename,
            originalName: response.data.originalName,
            mimetype: response.data.mimetype,
            size: response.data.size
          })
        }
      }

      if (uploadedFiles.length > 0) {
        onChange([...value, ...uploadedFiles])
        toast.success(`${uploadedFiles.length} fichier(s) uploadé(s)`)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Erreur lors de l\'upload')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }

  const handleRemove = (index: number) => {
    const newFiles = [...value]
    newFiles.splice(index, 1)
    onChange(newFiles)
  }

  const getFileIcon = (mimetype: string) => {
    if (isImage(mimetype)) {
      return <ImageIcon className="w-5 h-5 text-blue-500" />
    }
    if (isPdf(mimetype)) {
      return <FileText className="w-5 h-5 text-red-500" />
    }
    return <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
  }

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          {label}
        </label>
      )}

      {/* Zone de dépôt */}
      {value.length < maxFiles && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
            multiple
          />
          
          {uploading ? (
            <div className="flex flex-col items-center py-2">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Envoi en cours…</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 py-2">
              <Upload className="w-6 h-6 text-gray-600 dark:text-gray-400" />
              <div className="text-left">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium text-primary-600">Choisir un fichier</span>
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Images et PDF (max {maxFiles} fichiers)
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/*
        Prise de vue directe.
        Le glisser-déposer n'existe pas sur un téléphone : sans ce bouton,
        photographier un ticket ou une panne obligeait à passer par
        l'application photo puis à revenir chercher le fichier.
      */}
      {value.length < maxFiles && (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Camera className="w-5 h-5" />
            Prendre une photo
          </button>
        </>
      )}

      {/* Liste des fichiers uploadés */}
      {value.length > 0 && (
        <div className="mt-3 space-y-2">
          {value.map((file, index) => (
            <div
              key={file.filename}
              className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 group"
            >
              {/* Aperçu miniature pour les images */}
              {isImage(file.mimetype) ? (
                <img
                  src={file.url}
                  alt={file.originalName}
                  className="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-700">
                  {getFileIcon(file.mimetype)}
                </div>
              )}

              {/* Infos du fichier */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate" title={file.originalName}>
                  {file.originalName}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {formatFileSize(file.size)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPreviewModal(file)
                  }}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors touch-target"
                  title="Visualiser" aria-label="Visualiser"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <a
                  href={file.url}
                  download={file.originalName}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors touch-target"
                  title="Télécharger" aria-label="Télécharger"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button aria-label="Supprimer"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(index)
                  }}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors touch-target"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hint && value.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{hint}</p>
      )}

      {/* Modal de prévisualisation */}
      {previewModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewModal(null)}
        >
          <div 
            className="relative max-w-4xl max-h-[90vh] w-full bg-white dark:bg-gray-800 rounded-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
              <div className="flex items-center gap-2 min-w-0">
                {getFileIcon(previewModal.mimetype)}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {previewModal.originalName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewModal.url}
                  download={previewModal.originalName}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                  title="Télécharger" aria-label="Télécharger"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button
                  onClick={() => setPreviewModal(null)}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Contenu */}
            <div className="p-4 max-h-[calc(90vh-60px)] overflow-auto">
              {isImage(previewModal.mimetype) ? (
                <img
                  src={previewModal.url}
                  alt={previewModal.originalName}
                  className="max-w-full h-auto mx-auto"
                />
              ) : isPdf(previewModal.mimetype) ? (
                <iframe
                  src={previewModal.url}
                  className="w-full h-[75vh] border-0"
                  title={previewModal.originalName}
                />
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">Prévisualisation non disponible</p>
                  <a
                    href={previewModal.url}
                    download={previewModal.originalName}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    <Download className="w-4 h-4" />
                    Télécharger le fichier
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
