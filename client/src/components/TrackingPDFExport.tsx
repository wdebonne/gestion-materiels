import { useState } from 'react'
import { 
  Download, FileText, X, Loader2, Calendar
} from 'lucide-react'
import { 
  Button, Input, Badge, Alert
} from '@/components/ui'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

interface TrackingPDFExportProps {
  filters: any
  data: any
  chartsData?: any
  summary: any
  comparison: any
  yearlyComparison?: any
  onClose: () => void
  chartRef?: React.RefObject<HTMLDivElement>
}

export default function TrackingPDFExport({
  filters,
  data,
  summary,
  comparison,
  onClose,
  chartRef
}: TrackingPDFExportProps) {
  const [reportTitle, setReportTitle] = useState('Rapport de suivi des coûts')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeDetails, setIncludeDetails] = useState(true)
  const [includeComparison, setIncludeComparison] = useState(filters.compareEnabled)
  const [includeCharts, setIncludeCharts] = useState(true)
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [showAttachmentSelector, setShowAttachmentSelector] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')

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
    setProgress(0)
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 15
      let yPos = margin

      // Fonction helper pour ajouter du texte avec retour à la ligne automatique
      const addText = (text: string, x: number, y: number, options: any = {}) => {
        const { fontSize = 10, fontStyle = 'normal', color = [0, 0, 0], maxWidth = pageWidth - 2 * margin } = options
        pdf.setFontSize(fontSize)
        pdf.setTextColor(color[0], color[1], color[2])
        if (fontStyle === 'bold') {
          pdf.setFont('helvetica', 'bold')
        } else {
          pdf.setFont('helvetica', 'normal')
        }
        const lines = pdf.splitTextToSize(text, maxWidth)
        pdf.text(lines, x, y)
        return y + (lines.length * fontSize * 0.4)
      }

      // Fonction pour vérifier si on doit ajouter une nouvelle page
      const checkNewPage = (neededHeight: number) => {
        if (yPos + neededHeight > pageHeight - margin) {
          pdf.addPage()
          yPos = margin
          return true
        }
        return false
      }

      setProgressText('Génération de l\'en-tête...')
      setProgress(10)

      // En-tête
      pdf.setFillColor(59, 130, 246)
      pdf.rect(0, 0, pageWidth, 35, 'F')
      
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(20)
      pdf.setFont('helvetica', 'bold')
      pdf.text(reportTitle, margin, 15)
      
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      const periodLabel = `Période : ${new Date(filters.startDate).toLocaleDateString('fr-FR')} - ${new Date(filters.endDate).toLocaleDateString('fr-FR')}`
      pdf.text(periodLabel, margin, 23)
      
      pdf.setFontSize(9)
      pdf.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, margin, 30)
      
      yPos = 45

      // Section résumé
      if (includeSummary) {
        setProgressText('Ajout du résumé...')
        setProgress(20)

        pdf.setTextColor(0, 0, 0)
        yPos = addText('[#] RESUME', margin, yPos, { fontSize: 14, fontStyle: 'bold' })
        yPos += 5

        // Dessiner les cartes de résumé
        const cardWidth = (pageWidth - 3 * margin) / 2
        const cardHeight = 25

        // Carte Coût Total
        pdf.setFillColor(243, 244, 246)
        pdf.roundedRect(margin, yPos, cardWidth, cardHeight, 3, 3, 'F')
        pdf.setTextColor(107, 114, 128)
        pdf.setFontSize(9)
        pdf.text('Coût total', margin + 5, yPos + 8)
        pdf.setTextColor(17, 24, 39)
        pdf.setFontSize(14)
        pdf.setFont('helvetica', 'bold')
        pdf.text(formatCurrency(summary.totalCost), margin + 5, yPos + 18)

        // Carte Carburant
        if (filters.dataTypes.includes('fuel')) {
          pdf.setFillColor(254, 243, 199)
          pdf.roundedRect(margin + cardWidth + margin/2, yPos, cardWidth, cardHeight, 3, 3, 'F')
          pdf.setTextColor(146, 64, 14)
          pdf.setFontSize(9)
          pdf.setFont('helvetica', 'normal')
          pdf.text('Carburant', margin + cardWidth + margin/2 + 5, yPos + 8)
          pdf.setFontSize(14)
          pdf.setFont('helvetica', 'bold')
          pdf.text(formatCurrency(summary.totalFuelCost), margin + cardWidth + margin/2 + 5, yPos + 18)
        }

        yPos += cardHeight + 5

        // Carte Entretiens
        if (filters.dataTypes.includes('maintenance')) {
          pdf.setFillColor(219, 234, 254)
          pdf.roundedRect(margin, yPos, cardWidth, cardHeight, 3, 3, 'F')
          pdf.setTextColor(30, 64, 175)
          pdf.setFontSize(9)
          pdf.setFont('helvetica', 'normal')
          pdf.text('Entretiens', margin + 5, yPos + 8)
          pdf.setFontSize(14)
          pdf.setFont('helvetica', 'bold')
          pdf.text(formatCurrency(summary.totalMaintenanceCost), margin + 5, yPos + 18)
        }

        // Carte Contrôles
        if (filters.dataTypes.includes('technical_control')) {
          pdf.setFillColor(209, 250, 229)
          pdf.roundedRect(margin + cardWidth + margin/2, yPos, cardWidth, cardHeight, 3, 3, 'F')
          pdf.setTextColor(6, 95, 70)
          pdf.setFontSize(9)
          pdf.setFont('helvetica', 'normal')
          pdf.text('Contrôles techniques', margin + cardWidth + margin/2 + 5, yPos + 8)
          pdf.setFontSize(14)
          pdf.setFont('helvetica', 'bold')
          pdf.text(formatCurrency(summary.totalControlCost), margin + cardWidth + margin/2 + 5, yPos + 18)
        }

        yPos += cardHeight + 10

        // Stats carburant supplémentaires
        if (filters.dataTypes.includes('fuel')) {
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(10)
          pdf.setTextColor(75, 85, 99)
          yPos = addText(
            `> Carburant : ${formatNumber(summary.totalFuelQuantity)} litres en ${summary.fuelEntryCount} plein(s) (moyenne : ${formatCurrency(summary.fuelEntryCount > 0 ? summary.totalFuelCost / summary.fuelEntryCount : 0)}/plein)`,
            margin, yPos
          )
          yPos += 5
        }
      }

      // Section comparaison
      if (includeComparison && comparison) {
        setProgressText('Ajout de la comparaison...')
        setProgress(35)

        checkNewPage(50)
        
        yPos = addText('[~] COMPARAISON DE PERIODES', margin, yPos, { fontSize: 14, fontStyle: 'bold' })
        yPos += 5

        pdf.setFillColor(239, 246, 255)
        pdf.roundedRect(margin, yPos, pageWidth - 2 * margin, 35, 3, 3, 'F')
        
        pdf.setTextColor(30, 64, 175)
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'bold')
        pdf.text(
          `Comparaison avec : ${new Date(comparison.period.start).toLocaleDateString('fr-FR')} - ${new Date(comparison.period.end).toLocaleDateString('fr-FR')}`,
          margin + 5, yPos + 8
        )

        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        const diff = comparison.difference.totalCost
        const diffColor = diff > 0 ? [220, 38, 38] : [22, 163, 74]
        pdf.setTextColor(diffColor[0], diffColor[1], diffColor[2])
        pdf.text(
          `Différence : ${diff > 0 ? '+' : ''}${formatCurrency(diff)} (${comparison.percentageChange.totalCost > 0 ? '+' : ''}${comparison.percentageChange.totalCost?.toFixed(1) || 0}%)`,
          margin + 5, yPos + 18
        )

        pdf.setTextColor(75, 85, 99)
        pdf.text(`Coût période de comparaison : ${formatCurrency(comparison.summary.totalCost)}`, margin + 5, yPos + 28)

        yPos += 45
      }

      // Section graphiques (capture du DOM si disponible)
      if (includeCharts && chartRef?.current) {
        setProgressText('Capture des graphiques...')
        setProgress(50)

        try {
          const canvas = await html2canvas(chartRef.current, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
          })

          checkNewPage(100)
          
          yPos = addText('[=] GRAPHIQUES', margin, yPos, { fontSize: 14, fontStyle: 'bold' })
          yPos += 5

          const imgData = canvas.toDataURL('image/png')
          const imgWidth = pageWidth - 2 * margin
          const imgHeight = (canvas.height * imgWidth) / canvas.width
          
          // Si l'image est trop grande, la redimensionner ou l'ajouter sur une nouvelle page
          if (imgHeight > pageHeight - yPos - margin) {
            pdf.addPage()
            yPos = margin
          }

          pdf.addImage(imgData, 'PNG', margin, yPos, imgWidth, Math.min(imgHeight, pageHeight - yPos - margin))
          yPos += Math.min(imgHeight, pageHeight - yPos - margin) + 10
        } catch (err) {
          console.error('Erreur capture graphiques:', err)
        }
      }

      // Section détails
      if (includeDetails) {
        setProgressText('Ajout des détails...')
        setProgress(70)

        // Détails carburant
        if (filters.dataTypes.includes('fuel') && data?.fuel?.length > 0) {
          checkNewPage(40)
          
          yPos = addText(`[>] DETAILS CARBURANT (${data.fuel.length} entree(s))`, margin, yPos, { fontSize: 12, fontStyle: 'bold' })
          yPos += 5

          // En-têtes du tableau
          const colWidths = [22, 45, 25, 25, 25, 38]
          const headers = ['Date', 'Objet', 'Type', 'Quantité', 'Total', 'Station']
          
          pdf.setFillColor(243, 244, 246)
          pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(55, 65, 81)
          
          let xPos = margin + 2
          headers.forEach((header, i) => {
            pdf.text(header, xPos, yPos + 5)
            xPos += colWidths[i]
          })
          yPos += 10

          // Données (limiter à 20 lignes par page)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.setTextColor(0, 0, 0)

          for (let i = 0; i < Math.min(data.fuel.length, 50); i++) {
            const item = data.fuel[i]
            if (checkNewPage(8)) {
              // Réafficher les en-têtes
              pdf.setFillColor(243, 244, 246)
              pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
              pdf.setFontSize(8)
              pdf.setFont('helvetica', 'bold')
              pdf.setTextColor(55, 65, 81)
              xPos = margin + 2
              headers.forEach((header, idx) => {
                pdf.text(header, xPos, yPos + 5)
                xPos += colWidths[idx]
              })
              yPos += 10
              pdf.setFont('helvetica', 'normal')
              pdf.setTextColor(0, 0, 0)
            }

            xPos = margin + 2
            pdf.text(new Date(item.date).toLocaleDateString('fr-FR'), xPos, yPos + 4)
            xPos += colWidths[0]
            pdf.text((item.objectName || '').substring(0, 25), xPos, yPos + 4)
            xPos += colWidths[1]
            pdf.text((item.fuelType || '').substring(0, 12), xPos, yPos + 4)
            xPos += colWidths[2]
            pdf.text(`${formatNumber(item.quantity)} L`, xPos, yPos + 4)
            xPos += colWidths[3]
            pdf.text(formatCurrency(item.totalPrice), xPos, yPos + 4)
            xPos += colWidths[4]
            pdf.text((item.station || '-').substring(0, 20), xPos, yPos + 4)

            // Ligne de séparation
            pdf.setDrawColor(229, 231, 235)
            pdf.line(margin, yPos + 6, pageWidth - margin, yPos + 6)
            yPos += 8
          }

          if (data.fuel.length > 50) {
            pdf.setTextColor(107, 114, 128)
            pdf.setFontSize(8)
            pdf.text(`... et ${data.fuel.length - 50} autres entrées`, margin, yPos + 4)
            yPos += 10
          }

          yPos += 10
        }

        // Détails entretiens
        if (filters.dataTypes.includes('maintenance') && data?.maintenance?.length > 0) {
          setProgress(80)
          checkNewPage(40)
          
          yPos = addText(`[*] DETAILS ENTRETIENS (${data.maintenance.length} entree(s))`, margin, yPos, { fontSize: 12, fontStyle: 'bold' })
          yPos += 5

          const colWidths = [22, 45, 35, 30, 48]
          const headers = ['Date', 'Objet', 'Type', 'Coût', 'Prestataire']
          
          pdf.setFillColor(243, 244, 246)
          pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(55, 65, 81)
          
          let xPos = margin + 2
          headers.forEach((header, i) => {
            pdf.text(header, xPos, yPos + 5)
            xPos += colWidths[i]
          })
          yPos += 10

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.setTextColor(0, 0, 0)

          for (let i = 0; i < Math.min(data.maintenance.length, 50); i++) {
            const item = data.maintenance[i]
            if (checkNewPage(8)) {
              pdf.setFillColor(243, 244, 246)
              pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
              pdf.setFontSize(8)
              pdf.setFont('helvetica', 'bold')
              pdf.setTextColor(55, 65, 81)
              xPos = margin + 2
              headers.forEach((header, idx) => {
                pdf.text(header, xPos, yPos + 5)
                xPos += colWidths[idx]
              })
              yPos += 10
              pdf.setFont('helvetica', 'normal')
              pdf.setTextColor(0, 0, 0)
            }

            xPos = margin + 2
            pdf.text(new Date(item.date).toLocaleDateString('fr-FR'), xPos, yPos + 4)
            xPos += colWidths[0]
            pdf.text((item.objectName || '').substring(0, 25), xPos, yPos + 4)
            xPos += colWidths[1]
            pdf.text((item.type || '').substring(0, 18), xPos, yPos + 4)
            xPos += colWidths[2]
            pdf.text(formatCurrency(item.cost), xPos, yPos + 4)
            xPos += colWidths[3]
            pdf.text((item.provider || '-').substring(0, 25), xPos, yPos + 4)

            pdf.setDrawColor(229, 231, 235)
            pdf.line(margin, yPos + 6, pageWidth - margin, yPos + 6)
            yPos += 8
          }

          if (data.maintenance.length > 50) {
            pdf.setTextColor(107, 114, 128)
            pdf.setFontSize(8)
            pdf.text(`... et ${data.maintenance.length - 50} autres entrées`, margin, yPos + 4)
            yPos += 10
          }

          yPos += 10
        }

        // Détails contrôles techniques
        if (filters.dataTypes.includes('technical_control') && data?.technicalControl?.length > 0) {
          setProgress(90)
          checkNewPage(40)
          
          yPos = addText(`[!] DETAILS CONTROLES TECHNIQUES (${data.technicalControl.length} entree(s))`, margin, yPos, { fontSize: 12, fontStyle: 'bold' })
          yPos += 5

          const colWidths = [22, 45, 30, 30, 53]
          const headers = ['Date', 'Objet', 'Résultat', 'Coût', 'Expiration']
          
          pdf.setFillColor(243, 244, 246)
          pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(55, 65, 81)
          
          let xPos = margin + 2
          headers.forEach((header, i) => {
            pdf.text(header, xPos, yPos + 5)
            xPos += colWidths[i]
          })
          yPos += 10

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.setTextColor(0, 0, 0)

          for (let i = 0; i < Math.min(data.technicalControl.length, 50); i++) {
            const item = data.technicalControl[i]
            if (checkNewPage(8)) {
              pdf.setFillColor(243, 244, 246)
              pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F')
              pdf.setFontSize(8)
              pdf.setFont('helvetica', 'bold')
              pdf.setTextColor(55, 65, 81)
              xPos = margin + 2
              headers.forEach((header, idx) => {
                pdf.text(header, xPos, yPos + 5)
                xPos += colWidths[idx]
              })
              yPos += 10
              pdf.setFont('helvetica', 'normal')
              pdf.setTextColor(0, 0, 0)
            }

            xPos = margin + 2
            pdf.text(new Date(item.date).toLocaleDateString('fr-FR'), xPos, yPos + 4)
            xPos += colWidths[0]
            pdf.text((item.objectName || '').substring(0, 25), xPos, yPos + 4)
            xPos += colWidths[1]
            pdf.text((item.result || '-').substring(0, 15), xPos, yPos + 4)
            xPos += colWidths[2]
            pdf.text(formatCurrency(item.cost), xPos, yPos + 4)
            xPos += colWidths[3]
            pdf.text(item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('fr-FR') : '-', xPos, yPos + 4)

            pdf.setDrawColor(229, 231, 235)
            pdf.line(margin, yPos + 6, pageWidth - margin, yPos + 6)
            yPos += 8
          }

          yPos += 10
        }
      }

      // Section pièces jointes
      if (includeAttachments && selectedAttachments.length > 0) {
        checkNewPage(30)
        
        yPos = addText(`[@] PIECES JOINTES (${selectedAttachments.length})`, margin, yPos, { fontSize: 12, fontStyle: 'bold' })
        yPos += 5

        const attachmentsToInclude = allAttachments.filter(a => selectedAttachments.includes(a.id))
        
        attachmentsToInclude.forEach(att => {
          checkNewPage(12)
          pdf.setFontSize(9)
          pdf.setTextColor(0, 0, 0)
          pdf.text(`• ${att.name}`, margin + 5, yPos + 4)
          pdf.setTextColor(107, 114, 128)
          pdf.setFontSize(8)
          pdf.text(`Source: ${att.source}`, margin + 10, yPos + 10)
          yPos += 14
        })

        pdf.setFontSize(8)
        pdf.setTextColor(107, 114, 128)
        yPos = addText('Note : Les pièces jointes sont accessibles dans l\'application.', margin, yPos + 5)
      }

      // Pied de page sur la dernière page
      pdf.setFontSize(8)
      pdf.setTextColor(156, 163, 175)
      pdf.text('Rapport généré automatiquement par Gestion Matériels', margin, pageHeight - 10)
      pdf.text(`Page ${pdf.getNumberOfPages()}`, pageWidth - margin - 20, pageHeight - 10)

      setProgressText('Téléchargement du PDF...')
      setProgress(100)

      // Télécharger le PDF
      const fileName = `${reportTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(fileName)

      toast.success('PDF généré avec succès !')
      onClose()
    } catch (error) {
      console.error('Erreur génération PDF:', error)
      toast.error('Erreur lors de la génération du PDF')
    } finally {
      setIsGenerating(false)
      setProgress(0)
      setProgressText('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <FileText className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Exporter en PDF</h2>
              <p className="text-sm text-gray-500">Générer un fichier PDF du rapport</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" disabled={isGenerating}>
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
              disabled={isGenerating}
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
                disabled={isGenerating}
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Résumé</div>
                <div className="text-sm text-gray-500">Cartes de synthèse des coûts totaux</div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCharts}
                onChange={(e) => setIncludeCharts(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-primary-600"
                disabled={isGenerating}
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Graphiques</div>
                <div className="text-sm text-gray-500">Capture des graphiques comparatifs</div>
              </div>
            </label>

            {filters.compareEnabled && (
              <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeComparison}
                  onChange={(e) => setIncludeComparison(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-primary-600"
                  disabled={isGenerating}
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Comparaison</div>
                  <div className="text-sm text-gray-500">Tableau comparatif avec la période précédente</div>
                </div>
              </label>
            )}

            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDetails}
                onChange={(e) => setIncludeDetails(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-primary-600"
                disabled={isGenerating}
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Détails</div>
                <div className="text-sm text-gray-500">Tableaux détaillés des opérations</div>
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
                disabled={isGenerating}
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
              {includeAttachments && allAttachments.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowAttachmentSelector(!showAttachmentSelector)
                  }}
                  disabled={isGenerating}
                >
                  Sélectionner
                </Button>
              )}
            </label>

            {showAttachmentSelector && includeAttachments && allAttachments.length > 0 && (
              <div className="ml-8 p-3 bg-gray-50 rounded-lg space-y-2 max-h-48 overflow-auto">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Pièces jointes disponibles</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => setSelectedAttachments(allAttachments.map(a => a.id))}
                    >
                      Tout sélectionner
                    </button>
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:underline"
                      onClick={() => setSelectedAttachments([])}
                    >
                      Tout désélectionner
                    </button>
                  </div>
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
                    <div className={cn("w-2 h-2 rounded-full",
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

          {/* Barre de progression */}
          {isGenerating && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{progressText}</span>
                <span className="font-medium text-primary-600">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isGenerating}>
            Annuler
          </Button>
          <Button
            icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            onClick={handleGeneratePDF}
            disabled={isGenerating}
          >
            {isGenerating ? 'Génération...' : 'Télécharger le PDF'}
          </Button>
        </div>
      </div>
    </div>
  )
}
