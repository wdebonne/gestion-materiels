import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import api from '@/lib/api'

interface ManifestationPDFExportProps {
  manifestation: any
  onClose: () => void
}

const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  validee: 'Validée',
  refusee: 'Refusée',
  livree: 'Livrée',
  recuperee: 'Récupérée',
  archivee: 'Archivée',
}

export default function ManifestationPDFExport({ manifestation, onClose }: ManifestationPDFExportProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [includeItems, setIncludeItems] = useState(true)

  const generatePDF = async () => {
    setIsGenerating(true)
    try {
      // Charger le détail complet
      const res = await api.get(`/manifestations/${manifestation.id}`)
      const detail = res.data

      const doc = new jsPDF()
      let y = 15

      // === HEADER ===
      doc.setFillColor(37, 99, 235) // blue-600
      doc.rect(0, 0, 210, 40, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('Fiche Manifestation', 15, 20)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, 15, 30)

      y = 50

      // === INFOS GÉNÉRALES ===
      doc.setTextColor(30, 41, 59) // slate-800
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('Informations générales', 15, y)
      y += 8

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')

      const info = [
        ['Nom', detail.name],
        ['Statut', STATUS_LABELS[detail.status] || detail.status],
        ['Dates', `${formatDate(detail.start_date)} → ${formatDate(detail.end_date)}`],
        ['Contact', detail.contact || '-'],
        ['Lieu', detail.location || '-'],
        ['Description', detail.description || '-'],
      ]

      for (const [label, value] of info) {
        doc.setFont('helvetica', 'bold')
        doc.text(`${label} :`, 15, y)
        doc.setFont('helvetica', 'normal')
        
        if (value && value.length > 70) {
          const lines = doc.splitTextToSize(value, 140)
          doc.text(lines, 55, y)
          y += lines.length * 5
        } else {
          doc.text(value || '-', 55, y)
          y += 6
        }
      }

      y += 5

      // === ARTICLES ===
      if (includeItems && detail.items && detail.items.length > 0) {
        if (y > 240) { doc.addPage(); y = 20 }

        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(30, 41, 59)
        doc.text(`Articles (${detail.items.length})`, 15, y)
        y += 8

        // En-tête du tableau
        doc.setFillColor(243, 244, 246) // gray-100
        doc.rect(15, y - 4, 180, 8, 'F')
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(75, 85, 99) // gray-600
        doc.text('Article', 17, y)
        doc.text('Commandé', 110, y, { align: 'center' })
        doc.text('Livré', 140, y, { align: 'center' })
        doc.text('Récupéré', 170, y, { align: 'center' })
        y += 8

        doc.setFont('helvetica', 'normal')
        doc.setTextColor(30, 41, 59)

        for (const item of detail.items) {
          if (y > 275) { doc.addPage(); y = 20 }

          const name = item.object_name || `Objet #${item.object_id}`
          doc.text(name.substring(0, 45), 17, y)
          doc.text(String(item.quantity), 110, y, { align: 'center' })
          doc.text(String(item.quantity_delivered), 140, y, { align: 'center' })
          doc.text(String(item.quantity_returned), 170, y, { align: 'center' })

          // Ligne séparatrice
          doc.setDrawColor(229, 231, 235)
          doc.line(15, y + 3, 195, y + 3)
          y += 8
        }

        y += 5
      }

      // === HISTORIQUE ===
      if (includeHistory && detail.history && detail.history.length > 0) {
        if (y > 220) { doc.addPage(); y = 20 }

        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(30, 41, 59)
        doc.text('Historique', 15, y)
        y += 8

        doc.setFontSize(9)

        for (const h of detail.history) {
          if (y > 275) { doc.addPage(); y = 20 }

          const date = new Date(h.created_at).toLocaleString('fr-FR')
          const user = h.first_name ? `${h.first_name} ${h.last_name}` : h.email || 'Système'
          const fromLabel = STATUS_LABELS[h.from_status] || h.from_status || ''
          const toLabel = STATUS_LABELS[h.to_status] || h.to_status || ''

          doc.setFont('helvetica', 'bold')
          doc.text(h.action, 17, y)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(107, 114, 128)
          doc.text(`${date} - Par ${user}`, 80, y)
          y += 5

          if (fromLabel && toLabel) {
            doc.setTextColor(75, 85, 99)
            doc.text(`${fromLabel} → ${toLabel}`, 17, y)
            y += 5
          }

          if (h.comment) {
            doc.setTextColor(107, 114, 128)
            const commentLines = doc.splitTextToSize(`"${h.comment}"`, 170)
            doc.text(commentLines, 17, y)
            y += commentLines.length * 5
          }

          doc.setTextColor(30, 41, 59)
          doc.setDrawColor(229, 231, 235)
          doc.line(15, y + 2, 195, y + 2)
          y += 6
        }
      }

      // === PIED DE PAGE ===
      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(156, 163, 175)
        doc.text(
          `Page ${i}/${pageCount} — Gestion des Matériels — Manifestation: ${detail.name}`,
          105, 290, { align: 'center' }
        )
      }

      // Sauvegarder
      const safeName = detail.name.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ -]/g, '_')
      doc.save(`Manifestation_${safeName}_${new Date().toISOString().split('T')[0]}.pdf`)

      toast.success('PDF généré avec succès')
      onClose()
    } catch (error) {
      toast.error('Erreur lors de la génération du PDF')
      console.error(error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Exporter en PDF">
      <ModalBody>
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800">{manifestation.name}</p>
            <p className="text-xs text-blue-600 mt-1">
              {STATUS_LABELS[manifestation.status]} — {formatDate(manifestation.start_date)} → {formatDate(manifestation.end_date)}
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeItems}
                onChange={(e) => setIncludeItems(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Inclure les articles
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(e) => setIncludeHistory(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Inclure l'historique des étapes
            </label>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button
          onClick={generatePDF}
          loading={isGenerating}
          icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        >
          Générer le PDF
        </Button>
      </ModalFooter>
    </Modal>
  )
}
