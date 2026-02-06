import { useState } from 'react'
import { 
  Download, FileText, X, Loader2, Calendar
} from 'lucide-react'
import { 
  Button, Input, Badge, Alert
} from '@/components/ui'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import toast from 'react-hot-toast'

interface TrackingPDFExportProps {
  filters: any
  data: any
  chartsData?: any
  summary: any
  comparison: any
  onClose: () => void
}

export default function TrackingPDFExport({
  filters,
  data,
  summary,
  comparison,
  onClose
}: TrackingPDFExportProps) {
  const [reportTitle, setReportTitle] = useState('Rapport de suivi des coûts')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeDetails, setIncludeDetails] = useState(true)
  const [includeComparison, setIncludeComparison] = useState(filters.compareEnabled)
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [showAttachmentSelector, setShowAttachmentSelector] = useState(false)

  // Collecter toutes les pièces jointes
  const allAttachments: { id: string; name: string; url: string; type: string; source: string }[] = []
  
  data?.fuel?.forEach((item: any, index: number) => {
    item.attachments?.forEach((att: any, attIndex: number) => {
      allAttachments.push({
        id: `fuel-${index}-${attIndex}`,
        name: att.name || `Carburant - ${item.objectName} - ${new Date(item.date).toLocaleDateString('fr-FR')}`,
        url: att.url || att,
        type: 'fuel',
        source: item.objectName
      })
    })
  })

  data?.maintenance?.forEach((item: any, index: number) => {
    item.attachments?.forEach((att: any, attIndex: number) => {
      allAttachments.push({
        id: `maintenance-${index}-${attIndex}`,
        name: att.name || `Entretien - ${item.objectName} - ${new Date(item.date).toLocaleDateString('fr-FR')}`,
        url: att.url || att,
        type: 'maintenance',
        source: item.objectName
      })
    })
    if (item.document) {
      allAttachments.push({
        id: `maintenance-doc-${index}`,
        name: `Document entretien - ${item.objectName}`,
        url: item.document,
        type: 'maintenance',
        source: item.objectName
      })
    }
  })

  data?.technicalControl?.forEach((item: any, index: number) => {
    item.attachments?.forEach((att: any, attIndex: number) => {
      allAttachments.push({
        id: `control-${index}-${attIndex}`,
        name: att.name || `Contrôle - ${item.objectName} - ${new Date(item.date).toLocaleDateString('fr-FR')}`,
        url: att.url || att,
        type: 'technical_control',
        source: item.objectName
      })
    })
    if (item.document) {
      allAttachments.push({
        id: `control-doc-${index}`,
        name: `Document contrôle - ${item.objectName}`,
        url: item.document,
        type: 'technical_control',
        source: item.objectName
      })
    }
  })

  const handleGeneratePDF = async () => {
    setIsGenerating(true)
    try {
      // Créer le contenu HTML du rapport
      const reportContent = generateReportHTML()
      
      // Ouvrir une nouvelle fenêtre pour l'impression
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error('Veuillez autoriser les popups pour générer le PDF')
        return
      }

      printWindow.document.write(reportContent)
      printWindow.document.close()

      // Attendre le chargement puis lancer l'impression
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print()
          // printWindow.close() // Décommenter pour fermer après impression
        }, 500)
      }

      toast.success('Rapport généré avec succès')
    } catch (error) {
      console.error('Erreur génération PDF:', error)
      toast.error('Erreur lors de la génération du rapport')
    } finally {
      setIsGenerating(false)
    }
  }

  const generateReportHTML = () => {
    const periodLabel = `Du ${new Date(filters.startDate).toLocaleDateString('fr-FR')} au ${new Date(filters.endDate).toLocaleDateString('fr-FR')}`
    
    let html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${reportTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      color: #1f2937;
      line-height: 1.6;
      padding: 20px;
    }
    .header { 
      text-align: center; 
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e5e7eb;
    }
    .header h1 { 
      font-size: 24px; 
      color: #111827;
      margin-bottom: 8px;
    }
    .header .period { 
      font-size: 14px; 
      color: #6b7280;
    }
    .header .generated { 
      font-size: 12px; 
      color: #9ca3af;
      margin-top: 4px;
    }
    .section { 
      margin-bottom: 30px;
      page-break-inside: avoid;
    }
    .section-title { 
      font-size: 18px; 
      font-weight: 600;
      color: #111827;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .summary-card .label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-card .value {
      font-size: 20px;
      font-weight: 700;
      color: #111827;
      margin-top: 4px;
    }
    .summary-card.fuel { border-left: 4px solid #f59e0b; }
    .summary-card.maintenance { border-left: 4px solid #3b82f6; }
    .summary-card.control { border-left: 4px solid #10b981; }
    .summary-card.total { border-left: 4px solid #8b5cf6; }
    .comparison {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 15px;
      margin-top: 15px;
    }
    .comparison-title {
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 10px;
    }
    .comparison-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #dbeafe;
    }
    .comparison-row:last-child { border-bottom: none; }
    .trend-up { color: #dc2626; }
    .trend-down { color: #16a34a; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 10px;
    }
    th {
      background: #f3f4f6;
      padding: 10px 8px;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #d1d5db;
    }
    td {
      padding: 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:nth-child(even) { background: #f9fafb; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
    }
    .badge-fuel { background: #fef3c7; color: #92400e; }
    .badge-maintenance { background: #dbeafe; color: #1e40af; }
    .badge-control { background: #d1fae5; color: #065f46; }
    .badge-success { background: #d1fae5; color: #065f46; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
    }
    .attachments-list {
      margin-top: 10px;
    }
    .attachment-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .attachment-icon {
      width: 32px;
      height: 32px;
      background: #e5e7eb;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    @media print {
      body { padding: 0; }
      .section { page-break-inside: avoid; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${reportTitle}</h1>
    <div class="period">${periodLabel}</div>
    <div class="generated">Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</div>
  </div>
`

    // Section résumé
    if (includeSummary) {
      html += `
  <div class="section">
    <h2 class="section-title">📊 Résumé</h2>
    <div class="summary-grid">
      <div class="summary-card total">
        <div class="label">Coût total</div>
        <div class="value">${formatCurrency(summary.totalCost)}</div>
      </div>
      ${filters.dataTypes.includes('fuel') ? `
      <div class="summary-card fuel">
        <div class="label">Carburant</div>
        <div class="value">${formatCurrency(summary.totalFuelCost)}</div>
      </div>
      ` : ''}
      ${filters.dataTypes.includes('maintenance') ? `
      <div class="summary-card maintenance">
        <div class="label">Entretiens</div>
        <div class="value">${formatCurrency(summary.totalMaintenanceCost)}</div>
      </div>
      ` : ''}
      ${filters.dataTypes.includes('technical_control') ? `
      <div class="summary-card control">
        <div class="label">Contrôles techniques</div>
        <div class="value">${formatCurrency(summary.totalControlCost)}</div>
      </div>
      ` : ''}
    </div>
    ${filters.dataTypes.includes('fuel') ? `
    <p style="color: #6b7280; font-size: 13px;">
      <strong>Carburant :</strong> ${formatNumber(summary.totalFuelQuantity)} litres en ${summary.fuelEntryCount} plein(s) 
      (moyenne : ${formatCurrency(summary.fuelEntryCount > 0 ? summary.totalFuelCost / summary.fuelEntryCount : 0)}/plein)
    </p>
    ` : ''}
  </div>
`
    }

    // Section comparaison
    if (includeComparison && comparison) {
      html += `
  <div class="section">
    <h2 class="section-title">📈 Comparaison de périodes</h2>
    <div class="comparison">
      <div class="comparison-title">
        Comparaison avec la période du ${new Date(comparison.period.start).toLocaleDateString('fr-FR')} 
        au ${new Date(comparison.period.end).toLocaleDateString('fr-FR')}
      </div>
      <div class="comparison-row">
        <span>Coût total période de comparaison</span>
        <span>${formatCurrency(comparison.summary.totalCost)}</span>
      </div>
      <div class="comparison-row">
        <span>Différence</span>
        <span class="${comparison.difference.totalCost > 0 ? 'trend-up' : 'trend-down'}">
          ${comparison.difference.totalCost > 0 ? '+' : ''}${formatCurrency(comparison.difference.totalCost)}
          ${comparison.percentageChange.totalCost ? ` (${comparison.percentageChange.totalCost > 0 ? '+' : ''}${comparison.percentageChange.totalCost}%)` : ''}
        </span>
      </div>
      ${filters.dataTypes.includes('fuel') && comparison.summary.totalFuelCost > 0 ? `
      <div class="comparison-row">
        <span>Évolution carburant</span>
        <span class="${comparison.difference.totalFuelCost > 0 ? 'trend-up' : 'trend-down'}">
          ${comparison.difference.totalFuelCost > 0 ? '+' : ''}${formatCurrency(comparison.difference.totalFuelCost)}
        </span>
      </div>
      ` : ''}
      ${filters.dataTypes.includes('maintenance') && comparison.summary.totalMaintenanceCost > 0 ? `
      <div class="comparison-row">
        <span>Évolution entretiens</span>
        <span class="${comparison.difference.totalMaintenanceCost > 0 ? 'trend-up' : 'trend-down'}">
          ${comparison.difference.totalMaintenanceCost > 0 ? '+' : ''}${formatCurrency(comparison.difference.totalMaintenanceCost)}
        </span>
      </div>
      ` : ''}
    </div>
  </div>
`
    }

    // Section détails carburant
    if (includeDetails && filters.dataTypes.includes('fuel') && data?.fuel?.length > 0) {
      html += `
  <div class="section">
    <h2 class="section-title">⛽ Détails carburant (${data.fuel.length} entrée(s))</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Objet</th>
          <th>Type</th>
          <th class="text-right">Quantité</th>
          <th class="text-right">Prix unitaire</th>
          <th class="text-right">Total</th>
          <th>Station</th>
        </tr>
      </thead>
      <tbody>
        ${data.fuel.map((item: any) => `
        <tr>
          <td>${new Date(item.date).toLocaleDateString('fr-FR')}</td>
          <td>${item.objectName}${item.objectReference ? ` <small style="color:#9ca3af">(${item.objectReference})</small>` : ''}</td>
          <td><span class="badge badge-fuel">${item.fuelType}</span></td>
          <td class="text-right">${formatNumber(item.quantity)} L</td>
          <td class="text-right">${formatCurrency(item.unitPrice)}/L</td>
          <td class="text-right"><strong>${formatCurrency(item.totalPrice)}</strong></td>
          <td>${item.station || '-'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
`
    }

    // Section détails entretiens
    if (includeDetails && filters.dataTypes.includes('maintenance') && data?.maintenance?.length > 0) {
      html += `
  <div class="section">
    <h2 class="section-title">🔧 Détails entretiens (${data.maintenance.length} entrée(s))</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Objet</th>
          <th>Type</th>
          <th class="text-right">Coût</th>
          <th>Prestataire</th>
          <th>Prochaine date</th>
        </tr>
      </thead>
      <tbody>
        ${data.maintenance.map((item: any) => `
        <tr>
          <td>${new Date(item.date).toLocaleDateString('fr-FR')}</td>
          <td>${item.objectName}${item.objectReference ? ` <small style="color:#9ca3af">(${item.objectReference})</small>` : ''}</td>
          <td><span class="badge badge-maintenance">${item.type}</span></td>
          <td class="text-right"><strong>${formatCurrency(item.cost)}</strong></td>
          <td>${item.provider || '-'}</td>
          <td>${item.nextDate ? new Date(item.nextDate).toLocaleDateString('fr-FR') : '-'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
`
    }

    // Section détails contrôles techniques
    if (includeDetails && filters.dataTypes.includes('technical_control') && data?.technicalControl?.length > 0) {
      html += `
  <div class="section">
    <h2 class="section-title">📋 Détails contrôles techniques (${data.technicalControl.length} entrée(s))</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Objet</th>
          <th>Résultat</th>
          <th class="text-right">Coût</th>
          <th>Centre</th>
          <th>Expiration</th>
        </tr>
      </thead>
      <tbody>
        ${data.technicalControl.map((item: any) => `
        <tr>
          <td>${new Date(item.date).toLocaleDateString('fr-FR')}</td>
          <td>${item.objectName}${item.objectReference ? ` <small style="color:#9ca3af">(${item.objectReference})</small>` : ''}</td>
          <td><span class="badge ${item.result === 'Favorable' ? 'badge-success' : 'badge-warning'}">${item.result || '-'}</span></td>
          <td class="text-right"><strong>${formatCurrency(item.cost)}</strong></td>
          <td>${item.centerName || '-'}</td>
          <td>${item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('fr-FR') : '-'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
`
    }

    // Section pièces jointes
    if (includeAttachments && selectedAttachments.length > 0) {
      const attachmentsToInclude = allAttachments.filter(a => selectedAttachments.includes(a.id))
      html += `
  <div class="section">
    <h2 class="section-title">📎 Pièces jointes (${attachmentsToInclude.length})</h2>
    <div class="attachments-list">
      ${attachmentsToInclude.map(att => `
      <div class="attachment-item">
        <div class="attachment-icon">📄</div>
        <div>
          <div style="font-weight:500">${att.name}</div>
          <div style="font-size:11px;color:#6b7280">Source: ${att.source}</div>
        </div>
      </div>
      `).join('')}
    </div>
    <p style="font-size:12px;color:#6b7280;margin-top:10px;">
      <em>Note : Les pièces jointes sont accessibles dans l'application.</em>
    </p>
  </div>
`
    }

    // Footer
    html += `
  <div class="footer">
    <p>Rapport généré automatiquement par Gestion Matériels</p>
  </div>
</body>
</html>
`
    return html
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <FileText className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Exporter le rapport</h2>
              <p className="text-sm text-gray-500">Générer un PDF du rapport de suivi</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Titre du rapport */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Titre du rapport
            </label>
            <Input
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Rapport de suivi des coûts"
            />
          </div>

          {/* Période */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="w-4 h-4" />
              <span>Période : </span>
              <strong>
                {new Date(filters.startDate).toLocaleDateString('fr-FR')} - {new Date(filters.endDate).toLocaleDateString('fr-FR')}
              </strong>
            </div>
            {filters.compareEnabled && (
              <div className="flex items-center gap-2 text-sm text-blue-600 mt-2">
                <span>Comparaison : </span>
                <strong>
                  {new Date(filters.compareStartDate).toLocaleDateString('fr-FR')} - {new Date(filters.compareEndDate).toLocaleDateString('fr-FR')}
                </strong>
              </div>
            )}
          </div>

          {/* Options d'inclusion */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Contenu à inclure
            </label>
            
            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => setIncludeSummary(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-primary-600"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Résumé</div>
                <div className="text-sm text-gray-500">Cartes de synthèse des coûts totaux</div>
              </div>
            </label>

            {filters.compareEnabled && (
              <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeComparison}
                  onChange={(e) => setIncludeComparison(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-primary-600"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Comparaison de périodes</div>
                  <div className="text-sm text-gray-500">Différences et évolutions par rapport à la période précédente</div>
                </div>
              </label>
            )}

            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDetails}
                onChange={(e) => setIncludeDetails(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-primary-600"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Tableaux détaillés</div>
                <div className="text-sm text-gray-500">
                  Liste complète des entrées 
                  ({filters.dataTypes.includes('fuel') ? `${data?.fuel?.length || 0} carburant` : ''})
                  {filters.dataTypes.includes('maintenance') ? `, ${data?.maintenance?.length || 0} entretiens` : ''}
                  {filters.dataTypes.includes('technical_control') ? `, ${data?.technicalControl?.length || 0} contrôles` : ''}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAttachments}
                onChange={(e) => {
                  setIncludeAttachments(e.target.checked)
                  if (e.target.checked) setShowAttachmentSelector(true)
                }}
                className="w-5 h-5 rounded border-gray-300 text-primary-600"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">
                  Pièces jointes
                  {selectedAttachments.length > 0 && (
                    <Badge variant="info" className="ml-2">{selectedAttachments.length} sélectionnée(s)</Badge>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  Références aux documents joints ({allAttachments.length} disponible(s))
                </div>
              </div>
              {includeAttachments && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowAttachmentSelector(!showAttachmentSelector)
                  }}
                >
                  Sélectionner
                </Button>
              )}
            </label>

            {/* Sélecteur de pièces jointes */}
            {includeAttachments && showAttachmentSelector && allAttachments.length > 0 && (
              <div className="ml-8 p-4 bg-gray-50 rounded-lg space-y-2 max-h-48 overflow-y-auto">
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSelectedAttachments(allAttachments.map(a => a.id))}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    Tout sélectionner
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAttachments([])}
                    className="text-xs text-gray-600 hover:text-gray-800"
                  >
                    Tout désélectionner
                  </button>
                </div>
                {allAttachments.map(att => (
                  <label key={att.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAttachments.includes(att.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAttachments([...selectedAttachments, att.id])
                        } else {
                          setSelectedAttachments(selectedAttachments.filter(id => id !== att.id))
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600"
                    />
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      att.type === 'fuel' ? "bg-amber-400" :
                      att.type === 'maintenance' ? "bg-blue-400" : "bg-green-400"
                    )} />
                    <span className="text-sm text-gray-700 flex-1 truncate">{att.name}</span>
                  </label>
                ))}
              </div>
            )}

            {includeAttachments && allAttachments.length === 0 && (
              <Alert type="info" className="ml-8">
                Aucune pièce jointe disponible pour cette sélection.
              </Alert>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            onClick={handleGeneratePDF}
            disabled={isGenerating}
          >
            {isGenerating ? 'Génération...' : 'Générer le PDF'}
          </Button>
        </div>
      </div>
    </div>
  )
}
