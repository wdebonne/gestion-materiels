import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui'
import api from '@/lib/api'
import { getStatusLabel } from '@/lib/utils'
import toast from 'react-hot-toast'

/** Statuts d'un matériel, dans l'ordre où ils apparaissent ailleurs. */
const STATUTS = ['active', 'inactive', 'maintenance', 'out_of_service']

const CLASSE_CHAMP =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100'

export default function ImportExportPage() {
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<any>(null)

  /**
   * Reconnaissance des colonnes avant d'écrire quoi que ce soit.
   *
   * L'import était positionnel strict : le fichier devait suivre le modèle au
   * caractère près, et l'export de l'application — qui commence par une colonne
   * `ID` — ne pouvait pas être réimporté. Les colonnes sont maintenant
   * reconnues par leur intitulé, et cet écran laisse corriger une
   * reconnaissance ratée avant l'import.
   */
  const [analyse, setAnalyse] = useState<any>(null)
  const [correspondance, setCorrespondance] = useState<Record<string, number | ''>>({})
  const [exportFormat, setExportFormat] = useState('xlsx')

  // Le serveur acceptait ces trois filtres depuis toujours ; aucun écran ne les
  // proposait, donc l'export sortait forcément le parc entier.
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [status, setStatus] = useState('')

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return res.data.categories ?? res.data.data ?? []
    },
  })

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', categoryId],
    queryFn: async () => {
      const res = await api.get(`/categories/${categoryId}/subcategories`)
      return res.data.subcategories ?? res.data.data ?? []
    },
    enabled: Boolean(categoryId),
  })

  /** Paramètres communs au décompte et à l'export, pour qu'ils ne divergent pas. */
  const filtres = () => {
    const params = new URLSearchParams()
    if (categoryId) params.append('categoryId', categoryId)
    if (subcategoryId) params.append('subcategoryId', subcategoryId)
    if (status) params.append('status', status)
    return params
  }

  // Annonce ce que le fichier contiendra : sans ce décompte, on télécharge un
  // classeur vide sans comprendre pourquoi.
  const { data: nombreMateriels, isFetching: comptageEnCours } = useQuery({
    queryKey: ['export-count', categoryId, subcategoryId, status],
    queryFn: async () => {
      const params = filtres()
      params.append('limit', '1')
      const res = await api.get(`/objects?${params.toString()}`)
      return Number(res.data.pagination?.total ?? 0)
    },
  })

  // Reconnaissance des colonnes
  const analyseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/import-export/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data.data
    },
    onSuccess: (data) => {
      setAnalyse(data)
      setCorrespondance(data.correspondance ?? {})
    },
    onError: () => {
      setAnalyse(null)
      toast.error('Fichier illisible')
    },
  })

  const choisirFichier = (file: File | null) => {
    setImportFile(file)
    setImportResult(null)
    setAnalyse(null)
    setCorrespondance({})
    if (file) analyseMutation.mutate(file)
  }

  /** Champs obligatoires qu'aucune colonne ne renseigne, d'après le choix courant. */
  const manquants = (analyse?.champs ?? [])
    .filter((c: any) => c.obligatoire && !correspondance[c.champ])
    .map((c: any) => c.libelle)

  // Import
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      // La correspondance validée à l'écran prime sur la reconnaissance
      // automatique : c'est ce qui rend l'erreur corrigeable.
      const retenue = Object.fromEntries(
        Object.entries(correspondance).filter(([, index]) => index !== '' && index !== undefined)
      )
      formData.append('mapping', JSON.stringify(retenue))
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
      const params = filtres()
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <FileSpreadsheet className="w-7 h-7 text-primary-600" />
          Import / Export
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Importer ou exporter vos matériels en masse</p>
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
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Importez vos matériels depuis un fichier CSV ou Excel (.xlsx).
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Télécharger le template
              </Button>

              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => choisirFichier(e.target.files?.[0] || null)}
                  className="hidden"
                  id="import-file"
                />
                <label htmlFor="import-file" className="cursor-pointer">
                  <FileSpreadsheet className="w-10 h-10 text-gray-600 dark:text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {importFile ? importFile.name : 'Cliquez pour sélectionner un fichier'}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">CSV, XLSX (max 10 Mo)</p>
                </label>
              </div>

              {analyseMutation.isPending && (
                <p className="text-sm text-gray-600 dark:text-gray-300">Lecture du fichier…</p>
              )}

              {analyse && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {analyse.lignes} ligne{analyse.lignes > 1 ? 's' : ''} à importer
                    </span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {analyse.origine === 'entetes'
                        ? 'colonnes reconnues d\'après leurs intitulés'
                        : 'aucun intitulé reconnu — les colonnes sont prises dans l\'ordre du modèle'}
                    </span>
                  </div>

                  <div className="space-y-1.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    {analyse.champs.map((c: any) => (
                      <div key={c.champ} className="flex items-center gap-3">
                        <label
                          htmlFor={`colonne-${c.champ}`}
                          className="w-40 flex-shrink-0 text-sm text-gray-700 dark:text-gray-200"
                        >
                          {c.libelle}
                          {c.obligatoire && <span className="text-red-600"> *</span>}
                        </label>
                        <select
                          id={`colonne-${c.champ}`}
                          value={correspondance[c.champ] ?? ''}
                          onChange={(e) =>
                            setCorrespondance((p) => ({
                              ...p,
                              [c.champ]: e.target.value === '' ? '' : Number(e.target.value),
                            }))
                          }
                          className={CLASSE_CHAMP}
                        >
                          <option value="">— ignorer —</option>
                          {analyse.entetes.map((entete: string, i: number) => (
                            <option key={i} value={i + 1}>
                              {entete || `Colonne ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {analyse.apercu?.length > 0 && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Première ligne lue : <strong>{analyse.apercu[0].name ?? '—'}</strong>
                      {analyse.apercu[0].category ? ` — catégorie ${analyse.apercu[0].category}` : ''}
                    </p>
                  )}

                  {manquants.length > 0 && (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Colonne obligatoire à choisir : {manquants.join(', ')}.
                    </p>
                  )}
                </div>
              )}

              {importFile && !analyseMutation.isPending && (
                <Button
                  onClick={() => importMutation.mutate(importFile)}
                  disabled={importMutation.isPending || manquants.length > 0}
                  className="w-full"
                >
                  {importMutation.isPending
                    ? 'Import en cours…'
                    : analyse
                      ? `Importer ${analyse.lignes} ligne${analyse.lignes > 1 ? 's' : ''}`
                      : 'Lancer l\'import'}
                </Button>
              )}

              {importResult && (
                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{importResult.imported} matériel(s) importé(s)</span>
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300 flex items-center gap-1 mb-2">
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
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Exporter vos matériels en fichier Excel ou CSV. Sans filtre, tout le parc est exporté.
              </p>

              <div>
                <label htmlFor="export-categorie" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Catégorie
                </label>
                <select
                  id="export-categorie"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value)
                    // La sous-catégorie retenue n'appartient plus à la nouvelle
                    // catégorie : la garder produirait un export vide.
                    setSubcategoryId('')
                  }}
                  className={CLASSE_CHAMP}
                >
                  <option value="">Toutes les catégories</option>
                  {(Array.isArray(categories) ? categories : []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {categoryId && (
                <div>
                  <label htmlFor="export-sous-categorie" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Sous-catégorie
                  </label>
                  <select
                    id="export-sous-categorie"
                    value={subcategoryId}
                    onChange={(e) => setSubcategoryId(e.target.value)}
                    className={CLASSE_CHAMP}
                  >
                    <option value="">Toutes les sous-catégories</option>
                    {(Array.isArray(subcategories) ? subcategories : []).map((sc: any) => (
                      <option key={sc.id} value={sc.id}>{sc.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="export-statut" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Statut
                </label>
                <select
                  id="export-statut"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={CLASSE_CHAMP}
                >
                  <option value="">Tous les statuts</option>
                  {STATUTS.map((v) => (
                    <option key={v} value={v}>{getStatusLabel(v)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="export-format" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Format
                </label>
                <select
                  id="export-format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className={CLASSE_CHAMP}
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
                {comptageEnCours
                  ? 'Décompte en cours…'
                  : nombreMateriels === undefined
                    ? ''
                    : nombreMateriels === 0
                      ? 'Aucun matériel ne correspond à ces filtres.'
                      : `${nombreMateriels} matériel${nombreMateriels > 1 ? 's' : ''} seront exportés.`}
              </p>

              <Button onClick={handleExport} className="w-full" disabled={nombreMateriels === 0}>
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
