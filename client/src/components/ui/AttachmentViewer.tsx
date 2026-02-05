import { useState } from 'react'
import { Paperclip, FileText, Image as ImageIcon, Eye, Download, X } from 'lucide-react'
import type { UploadedFile } from './FileUpload'

interface AttachmentViewerProps {
  attachments: UploadedFile[]
  compact?: boolean
}

export default function AttachmentViewer({ attachments, compact = false }: AttachmentViewerProps) {
  const [previewModal, setPreviewModal] = useState<UploadedFile | null>(null)

  if (!attachments || attachments.length === 0) return null

  const isImage = (mimetype: string) => mimetype?.startsWith('image/')
  const isPdf = (mimetype: string) => mimetype === 'application/pdf'

  const getFileIcon = (mimetype: string) => {
    if (isImage(mimetype)) {
      return <ImageIcon className="w-4 h-4 text-blue-500" />
    }
    if (isPdf(mimetype)) {
      return <FileText className="w-4 h-4 text-red-500" />
    }
    return <FileText className="w-4 h-4 text-gray-500" />
  }

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPreviewModal(attachments[0])}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors"
          title={`${attachments.length} pièce(s) jointe(s)`}
        >
          <Paperclip className="w-3 h-3" />
          {attachments.length}
        </button>

        {/* Modal de prévisualisation */}
        {previewModal && (
          <PreviewModal
            file={previewModal}
            files={attachments}
            onClose={() => setPreviewModal(null)}
            onNavigate={setPreviewModal}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((file, index) => (
          <button
            key={file.filename || index}
            type="button"
            onClick={() => setPreviewModal(file)}
            className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-sm text-gray-700 transition-colors"
            title={file.originalName}
          >
            {getFileIcon(file.mimetype)}
            <span className="max-w-[100px] truncate">{file.originalName}</span>
          </button>
        ))}
      </div>

      {/* Modal de prévisualisation */}
      {previewModal && (
        <PreviewModal
          file={previewModal}
          files={attachments}
          onClose={() => setPreviewModal(null)}
          onNavigate={setPreviewModal}
        />
      )}
    </>
  )
}

function PreviewModal({ 
  file, 
  files, 
  onClose, 
  onNavigate 
}: { 
  file: UploadedFile
  files: UploadedFile[]
  onClose: () => void
  onNavigate: (file: UploadedFile) => void
}) {
  const isImage = (mimetype: string) => mimetype?.startsWith('image/')
  const isPdf = (mimetype: string) => mimetype === 'application/pdf'

  const getFileIcon = (mimetype: string) => {
    if (isImage(mimetype)) {
      return <ImageIcon className="w-5 h-5 text-blue-500" />
    }
    if (isPdf(mimetype)) {
      return <FileText className="w-5 h-5 text-red-500" />
    }
    return <FileText className="w-5 h-5 text-gray-500" />
  }

  const currentIndex = files.findIndex(f => f.filename === file.filename)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < files.length - 1

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl max-h-[90vh] w-full bg-white rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b bg-gray-50">
          <div className="flex items-center gap-2 min-w-0">
            {getFileIcon(file.mimetype)}
            <span className="text-sm font-medium text-gray-700 truncate">
              {file.originalName}
            </span>
            {files.length > 1 && (
              <span className="text-xs text-gray-400">
                ({currentIndex + 1}/{files.length})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Navigation */}
            {files.length > 1 && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={() => hasPrev && onNavigate(files[currentIndex - 1])}
                  disabled={!hasPrev}
                  className={`p-1.5 rounded transition-colors ${
                    hasPrev 
                      ? 'text-gray-600 hover:bg-gray-100' 
                      : 'text-gray-300 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => hasNext && onNavigate(files[currentIndex + 1])}
                  disabled={!hasNext}
                  className={`p-1.5 rounded transition-colors ${
                    hasNext 
                      ? 'text-gray-600 hover:bg-gray-100' 
                      : 'text-gray-300 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
            <a
              href={file.url}
              download={file.originalName}
              className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
              title="Télécharger"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Contenu */}
        <div className="p-4 max-h-[calc(90vh-60px)] overflow-auto">
          {isImage(file.mimetype) ? (
            <img
              src={file.url}
              alt={file.originalName}
              className="max-w-full h-auto mx-auto"
            />
          ) : isPdf(file.mimetype) ? (
            <iframe
              src={file.url}
              className="w-full h-[75vh] border-0"
              title={file.originalName}
            />
          ) : (
            <div className="text-center py-8">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Prévisualisation non disponible</p>
              <a
                href={file.url}
                download={file.originalName}
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
  )
}
