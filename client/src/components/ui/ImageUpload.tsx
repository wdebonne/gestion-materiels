import { useState, useRef } from 'react'
import { Upload, X, Link, Camera } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { resizeImage, isResizableImage, formatFileSize } from '@/lib/imageResize'

interface ImageUploadProps {
  value?: string
  onChange: (url: string) => void
  label?: string
  hint?: string
  accept?: string
  maxSize?: number // en MB
  className?: string
}

export default function ImageUpload({
  value,
  onChange,
  label,
  hint,
  accept = 'image/*',
  maxSize = 5,
  className = ''
}: ImageUploadProps) {
  const [mode, setMode] = useState<'upload' | 'url'>('upload')
  const [urlInput, setUrlInput] = useState(value || '')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (brut: File) => {
    // Vérifier le type avant tout traitement
    if (!brut.type.startsWith('image/')) {
      toast.error('Seules les images sont acceptées')
      return
    }

    // Réduire AVANT de contrôler la taille : une photo de téléphone dépasse
    // souvent le plafond à la prise de vue et tient largement dessous une
    // fois redimensionnée.
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
        `L'image est trop volumineuse (${formatFileSize(file.size)}, maximum ${maxSize} Mo).`
      )
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('image', file)

      const response = await api.post('/upload/image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        onChange(response.data.url)
        toast.success('Image uploadée avec succès')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Erreur lors de l\'upload')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      onChange(urlInput.trim())
      toast.success('URL enregistrée')
    }
  }

  const handleRemove = () => {
    onChange('')
    setUrlInput('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          {label}
        </label>
      )}

      {/* Toggle mode */}
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            mode === 'upload'
              ? 'bg-primary-100 text-primary-700 font-medium'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            mode === 'url'
              ? 'bg-primary-100 text-primary-700 font-medium'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <Link className="w-4 h-4" />
          URL
        </button>
      </div>

      {/* Mode Upload */}
      {mode === 'upload' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileChange}
            className="hidden"
          />
          
          {uploading ? (
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Upload en cours...</span>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-600 dark:text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-medium text-primary-600">Choisir une image</span>
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                PNG, JPG ou GIF
              </p>
            </>
          )}
        </div>
      )}

      {/*
        Prise de vue directe : sur un téléphone, le glisser-déposer n'existe
        pas et « choisir un fichier » oblige à sortir de l'application.
      */}
      {mode === 'upload' && (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
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

      {/* Mode URL */}
      {mode === 'url' && (
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <button
            type="button"
            onClick={handleUrlSubmit}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Appliquer
          </button>
        </div>
      )}

      {/* Aperçu */}
      {value && (
        <div className="mt-4 relative inline-block">
          <div className="relative group">
            <img
              src={value}
              alt="Aperçu"
              className="h-20 w-auto rounded-lg border border-gray-200 dark:border-gray-700 object-contain bg-gray-50 dark:bg-gray-900/40"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
              }}
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover-reveal hover:bg-red-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-[200px] truncate">
            {value}
          </p>
        </div>
      )}

      {hint && !value && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{hint}</p>
      )}
    </div>
  )
}
