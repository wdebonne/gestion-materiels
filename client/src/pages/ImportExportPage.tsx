import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function ImportExportPage() {
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<any>(null)
  const [exportFormat, setExportFormat] = useState('xlsx')

  // Import
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/import-export/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return res.data
    },
    onSuccess: (data: any) => {
      setImportResult(data.data)
      setImportFile(null)
      if (data.data.imported > 0) {
        toast.success(`${data.data.imported} matériel(s) importé(s)`)
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'import')
    }
  })

  // Export
  const handleExport = async () => {
    try {
      const params = new URLSearchParams()
      params.append('format', exportFormat)

      const response = await api.get(`/import-export/export?${params.toString()}`, {
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `materiels_${Date.now()}.${exportFormat}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Export téléchargé')
    } catch {
      toast.error('Erreur lors de l\'export')
    }
  }

  // Template
  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/import-export/template', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'template_import_materiels.xlsx')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Erreur lors du téléchargement du template')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileSpreadsheet className="w-7 h-7 text-primary-600" />
          Import / Export
        </h1>
        <p className="text-gray-500 mt-1">Importer ou exporter vos matériels en masse</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" /> Importer des matériels
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Importez vos matériels depuis un fichier CSV ou Excel (.xlsx).
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Télécharger le template
              </Button>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] || null)
                    setImportResult(null)
                  }}
                  className="hidden"
                  id="import-file"
                />
                <label htmlFor="import-file" className="cursor-pointer">
                  <FileSpreadsheet className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    {importFile ? importFile.name : 'Cliquez pour sélectionner un fichier'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">CSV, XLSX (max 10 Mo)</p>
                </label>
              </div>

              {importFile && (
                <Button
                  onClick={() => importMutation.mutate(importFile)}
                  disabled={importMutation.isPending}
                  className="w-full"
                >
                  {importMutation.isPending ? 'Import en cours...' : 'Lancer l\'import'}
                </Button>
              )}

              {importResult && (
                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{importResult.imported} matériel(s) importé(s)</span>
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-red-700 flex items-center gap-1 mb-2">
                        <AlertCircle className="w-4 h-4" /> {importResult.errors.length} erreur(s)
                      </p>
                      <ul className="text-xs text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                        {importResult.errors.map((err: string, i: number) => (
                          <li key={i}>• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Export */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" /> Exporter les matériels
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Exporter vos matériels en fichier Excel ou CSV.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Format</label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </div>
              <Button onClick={handleExport} className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Exporter
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
