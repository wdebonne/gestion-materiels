import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import api from '@/lib/api'

/**
 * Fiche PDF d'une manifestation.
 *
 * Ce composant existait sans être importé nulle part, et il était écrit contre
 * une forme de données qui n'a jamais existé : `name` au lieu de `title`,
 * `items` au lieu de `materials`, `res.data` au lieu de `res.data.data`, des
 * statuts en français là où l'API en utilise d'autres. Chaque champ serait
 * ressorti vide, et la génération se serait arrêtée sur `detail.name.replace`.
 *
 * Les noms suivent désormais ceux que l'API renvoie réellement.
 */

interface ManifestationPDFExportProps {
  manifestation: { id: number; title?: string }
  onClose: () => void
}

/** Statuts tels que le serveur les stocke. */
const LIBELLES_STATUT: Record<string, string> = {
  pending: 'À confirmer',
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
  cancelled: 'Annulée',
}

const BLEU: [number, number, number] = [37, 99, 235]
const ARDOISE: [number, number, number] = [30, 41, 59]
const GRIS: [number, number, number] = [107, 114, 128]
const GRIS_CLAIR: [number, number, number] = [229, 231, 235]

export default function ManifestationPDFExport({ manifestation, onClose }: ManifestationPDFExportProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [includeItems, setIncludeItems] = useState(true)

  const generatePDF = async () => {
    setIsGenerating(true)
    try {
      const res = await api.get(`/manifestations/${manifestation.id}`)
      const detail = res.data.data

      if (!detail) {
        toast.error('Manifestation introuvable')
        return
      }

      const doc = new jsPDF()
      let y = 15

      // === EN-TÊTE ===
      doc.setFillColor(...BLEU)
      doc.rect(0, 0, 210, 40, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('Fiche manifestation', 15, 20)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`,
        15,
        30
      )

      y = 50

      // === INFORMATIONS GÉNÉRALES ===
      doc.setTextColor(...ARDOISE)
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('Informations générales', 15, y)
      y += 8

      doc.setFontSize(10)

      const horaires = [detail.start_time, detail.end_time].filter(Boolean).join(' → ')
      const contact = [detail.contact_name, detail.contact_phone, detail.contact_email]
        .filter(Boolean)
        .join(' · ')

      const info: Array<[string, string]> = [
        ['Titre', detail.title || '-'],
        ['Statut', LIBELLES_STATUT[detail.status] || detail.status || '-'],
        ['Dates', `${formatDate(detail.date_start)}${detail.date_end ? ` → ${formatDate(detail.date_end)}` : ''}`],
        ['Horaires', horaires || '-'],
        ['Personnes attendues', detail.expected_people ? String(detail.expected_people) : '-'],
        ['Contact', contact || '-'],
        ['Livraison', detail.delivery_date ? formatDate(detail.delivery_date) : '-'],
        ['Adresse', detail.delivery_address || '-'],
        ['Notes intérieur', detail.notes_interior || '-'],
        ['Notes extérieur', detail.notes_exterior || '-'],
      ]

      for (const [label, value] of info) {
        if (y > 275) { doc.addPage(); y = 20 }
        doc.setFont('helvetica', 'bold')
        doc.text(`${label} :`, 15, y)
        doc.setFont('helvetica', 'normal')

        const lignes = doc.splitTextToSize(value, 135)
        doc.text(lignes, 60, y)
        y += Math.max(6, lignes.length * 5)
      }

      y += 5

      // === MATÉRIEL ===
      const materials: any[] = detail.materials ?? []
      if (includeItems && materials.length > 0) {
        if (y > 235) { doc.addPage(); y = 20 }

        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...ARDOISE)
        doc.text(`Matériel (${materials.length})`, 15, y)
        y += 8

        doc.setFillColor(243, 244, 246)
        doc.rect(15, y - 4, 180, 8, 'F')
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(75, 85, 99)
        doc.text('Article', 17, y)
        doc.text('Demandé', 108, y, { align: 'center' })
        doc.text('Livré', 133, y, { align: 'center' })
        doc.text('Récupéré', 158, y, { align: 'center' })
        // La casse et le vol ont diminué le stock : la fiche sert d'archive en
        // cas de litige, elle doit les porter.
        doc.text('Perdu', 185, y, { align: 'center' })
        y += 8

        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...ARDOISE)

        for (const mat of materials) {
          if (y > 275) { doc.addPage(); y = 20 }

          const nom = mat.stock_name || `Article #${mat.stock_id}`
          doc.text(String(nom).substring(0, 42), 17, y)
          doc.text(String(mat.quantity_requested ?? 0), 108, y, { align: 'center' })
          doc.text(String(mat.quantity_delivered ?? 0), 133, y, { align: 'center' })
          doc.text(String(mat.quantity_recovered ?? 0), 158, y, { align: 'center' })
          doc.text(String(mat.quantity_lost ?? 0), 185, y, { align: 'center' })

          doc.setDrawColor(...GRIS_CLAIR)
          doc.line(15, y + 3, 195, y + 3)
          y += 8
        }

        // Totaux : ce que la collectivité a prêté et ce qui est revenu.
        const total = (champ: string) => materials.reduce((s, m) => s + (Number(m[champ]) || 0), 0)
        if (y > 275) { doc.addPage(); y = 20 }
        doc.setFont('helvetica', 'bold')
        doc.text('Total', 17, y)
        doc.text(String(total('quantity_requested')), 108, y, { align: 'center' })
        doc.text(String(total('quantity_delivered')), 133, y, { align: 'center' })
        doc.text(String(total('quantity_recovered')), 158, y, { align: 'center' })
        doc.text(String(total('quantity_lost')), 185, y, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        y += 12
      }

      // === HISTORIQUE ===
      const history: any[] = detail.history ?? []
      if (includeHistory && history.length > 0) {
        if (y > 230) { doc.addPage(); y = 20 }

        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...ARDOISE)
        doc.text(`Historique (${history.length})`, 15, y)
        y += 8

        doc.setFontSize(9)

        for (const h of history) {
          if (y > 270) { doc.addPage(); y = 20 }

          const date = h.created_at ? new Date(h.created_at).toLocaleString('fr-FR') : ''
          const auteur = h.first_name || h.last_name
            ? `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim()
            : h.email || 'Système'
          const depuis = LIBELLES_STATUT[h.from_status] || h.from_status || ''
          const vers = LIBELLES_STATUT[h.to_status] || h.to_status || ''

          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...ARDOISE)
          doc.text(String(h.action), 17, y)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(...GRIS)
          doc.text(`${date} — ${auteur}`, 85, y)
          y += 5

          if (depuis && vers) {
            doc.setTextColor(75, 85, 99)
            doc.text(`${depuis} → ${vers}`, 17, y)
            y += 5
          }

          if (h.comment) {
            doc.setTextColor(...GRIS)
            const lignes = doc.splitTextToSize(`« ${h.comment} »`, 170)
            doc.text(lignes, 17, y)
            y += lignes.length * 5
          }

          doc.setDrawColor(...GRIS_CLAIR)
          doc.line(15, y + 2, 195, y + 2)
          y += 6
        }
      }

      // === PIED DE PAGE ===
      const titre = detail.title || 'Manifestation'
      const pages = doc.getNumberOfPages()
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(156, 163, 175)
        doc.text(`Page ${i}/${pages} — Gestion des matériels — ${titre}`, 105, 290, { align: 'center' })
      }

      const nomFichier = titre.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ -]/g, '_')
      doc.save(`Manifestation_${nomFichier}_${new Date().toISOString().split('T')[0]}.pdf`)

      toast.success('PDF généré')
      onClose()
    } catch (error) {
      toast.error('Erreur lors de la génération du PDF')
      console.error(error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Exporter la fiche en PDF">
      <ModalBody>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Les informations générales sont toujours incluses.
          </p>
          <label className="touch-target flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeItems}
              onChange={(e) => setIncludeItems(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Liste du matériel</span>
          </label>
          <label className="touch-target flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(e) => setIncludeHistory(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Historique des actions</span>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button onClick={generatePDF} disabled={isGenerating}>
          {isGenerating
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <Download className="w-4 h-4 mr-2" />}
          {isGenerating ? 'Génération…' : 'Générer le PDF'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
