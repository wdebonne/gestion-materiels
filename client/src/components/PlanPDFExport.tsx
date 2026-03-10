import { useState, useRef, useEffect } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

interface PlanPDFExportProps {
  space: any
  onClose: () => void
}

const ELEMENT_TYPES = [
  { value: 'arbre', label: 'Arbre', icon: '🌳', color: '#16a34a' },
  { value: 'arbuste', label: 'Arbuste', icon: '🌿', color: '#22c55e' },
  { value: 'fleur', label: 'Massif floral', icon: '🌺', color: '#ec4899' },
  { value: 'pelouse', label: 'Pelouse', icon: '🟢', color: '#86efac' },
  { value: 'haie', label: 'Haie', icon: '🌲', color: '#15803d' },
  { value: 'mobilier_urbain', label: 'Mobilier urbain', icon: '🪑', color: '#78716c' },
  { value: 'banc', label: 'Banc', icon: '🪑', color: '#a16207' },
  { value: 'poubelle', label: 'Poubelle / Corbeille', icon: '🗑️', color: '#6b7280' },
  { value: 'bac_fleurs', label: 'Bac à fleurs', icon: '🌷', color: '#f472b6' },
  { value: 'eclairage', label: 'Éclairage', icon: '💡', color: '#eab308' },
  { value: 'fontaine', label: 'Fontaine / Bassin', icon: '⛲', color: '#3b82f6' },
  { value: 'cloture', label: 'Clôture / Barrière', icon: '🚧', color: '#d97706' },
  { value: 'jeux', label: 'Jeux enfants', icon: '🎠', color: '#8b5cf6' },
  { value: 'allee', label: 'Allée / Chemin', icon: '🛤️', color: '#a3a3a3' },
  { value: 'panneau', label: 'Panneau / Signalétique', icon: '🪧', color: '#0ea5e9' },
  { value: 'arrosage', label: 'Système d\'arrosage', icon: '💧', color: '#06b6d4' },
  { value: 'statue', label: 'Statue / Œuvre d\'art', icon: '🗿', color: '#737373' },
  { value: 'autre', label: 'Autre', icon: '📌', color: '#6b7280' },
]

const GROUP_TYPES = [
  { value: 'massif', label: 'Massif', color: '#ec4899' },
  { value: 'bosquet', label: 'Bosquet', color: '#16a34a' },
  { value: 'rocaille', label: 'Rocaille', color: '#78716c' },
  { value: 'plate_bande', label: 'Plate-bande', color: '#f59e0b' },
  { value: 'verger', label: 'Verger', color: '#22c55e' },
  { value: 'zone_ombre', label: 'Zone ombragée', color: '#6366f1' },
  { value: 'zone_humide', label: 'Zone humide', color: '#06b6d4' },
  { value: 'autre', label: 'Autre', color: '#8b5cf6' },
]

const CONDITION_STATES = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'bon', label: 'Bon état' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'mauvais', label: 'Mauvais' },
  { value: 'remplacer', label: 'À remplacer' },
]

function getImageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/uploads/')) return path
  if (path.startsWith('/')) return path
  return `/uploads/${path}`
}

function parseZonePoints(zp: string | null | undefined): { x: number; y: number }[] {
  if (!zp) return []
  try {
    const parsed = typeof zp === 'string' ? JSON.parse(zp) : zp
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export default function PlanPDFExport({ space, onClose }: PlanPDFExportProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [includeElements, setIncludeElements] = useState(true)
  const [includeGroups, setIncludeGroups] = useState(true)
  const [includeAnnotations, setIncludeAnnotations] = useState(true)
  const [includeLegend, setIncludeLegend] = useState(true)
  const [includeDetails, setIncludeDetails] = useState(true)
  const renderRef = useRef<HTMLDivElement>(null)

  const elements = space.elements || []
  const groups = space.groups || []
  const annotations = space.annotations || []

  const placedElements = elements.filter((el: any) => el.pos_x != null && el.pos_y != null)
  const placedGroups = groups.filter((g: any) => g.pos_x != null && g.pos_y != null)

  const generatePDF = async () => {
    setIsGenerating(true)
    try {
      const pdf = new jsPDF('l', 'mm', 'a4') // paysage pour le plan
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 10

      // === EN-TÊTE ===
      pdf.setFillColor(22, 163, 106) // green-600
      pdf.rect(0, 0, pageWidth, 28, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(18)
      pdf.setFont('helvetica', 'bold')
      pdf.text(`Plan annoté — ${space.name}`, margin, 12)
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`${space.address || 'Adresse non renseignée'} | Type : ${space.space_type} | Surface : ${space.area_m2 || '?'} m²`, margin, 19)
      pdf.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, margin, 25)

      let yPos = 32

      // === CAPTURE DU PLAN ===
      if (renderRef.current) {
        try {
          const canvas = await html2canvas(renderRef.current, {
            useCORS: true,
            allowTaint: true,
            scale: 2,
            backgroundColor: '#ffffff',
          })

          const imgData = canvas.toDataURL('image/png')
          const imgWidth = pageWidth - 2 * margin
          const imgHeight = (canvas.height / canvas.width) * imgWidth

          // Si l'image est trop haute, la limiter
          const maxImgHeight = pageHeight - yPos - margin - (includeLegend ? 30 : 5)
          const finalImgHeight = Math.min(imgHeight, maxImgHeight)
          const finalImgWidth = (finalImgHeight / imgHeight) * imgWidth

          const imgX = margin + (imgWidth - finalImgWidth) / 2
          pdf.addImage(imgData, 'PNG', imgX, yPos, finalImgWidth, finalImgHeight)
          yPos += finalImgHeight + 3
        } catch (error) {
          console.error('Erreur capture plan:', error)
          // Fallback: texte
          pdf.setTextColor(150, 150, 150)
          pdf.setFontSize(12)
          pdf.text('(Le plan n\'a pas pu être capturé)', margin, yPos + 20)
          yPos += 30
        }
      }

      // === LÉGENDE ===
      if (includeLegend) {
        const usedTypes = ELEMENT_TYPES.filter(t => placedElements.some((el: any) => el.element_type === t.value))
        const usedGroupTypes = placedGroups.map((g: any) => {
          const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
          return { name: g.name, color: g.color || typeInfo?.color || '#8b5cf6' }
        })

        if (usedTypes.length > 0 || usedGroupTypes.length > 0) {
          // Vérifier si on doit passer à une nouvelle page
          if (yPos + 20 > pageHeight - margin) {
            pdf.addPage()
            yPos = margin
          }

          pdf.setFontSize(10)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(30, 41, 59)
          pdf.text('Légende', margin, yPos + 4)
          yPos += 8

          let xPos = margin
          const maxX = pageWidth - margin

          for (const t of usedTypes) {
            const textWidth = pdf.getTextWidth(`  ${t.label}`) + 8
            if (xPos + textWidth > maxX) {
              xPos = margin
              yPos += 6
            }

            // Parse color
            const r = parseInt(t.color.slice(1, 3), 16)
            const g = parseInt(t.color.slice(3, 5), 16)
            const b = parseInt(t.color.slice(5, 7), 16)
            pdf.setFillColor(r, g, b)
            pdf.circle(xPos + 2, yPos, 2, 'F')
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(75, 85, 99)
            pdf.text(t.label, xPos + 6, yPos + 1)
            xPos += textWidth
          }

          for (const g of usedGroupTypes) {
            const textWidth = pdf.getTextWidth(`  ${g.name}`) + 10
            if (xPos + textWidth > maxX) {
              xPos = margin
              yPos += 6
            }

            const r = parseInt(g.color.slice(1, 3), 16)
            const gv = parseInt(g.color.slice(3, 5), 16)
            const b = parseInt(g.color.slice(5, 7), 16)
            pdf.setFillColor(r, gv, b)
            pdf.rect(xPos, yPos - 2, 4, 4, 'F')
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(75, 85, 99)
            pdf.text(g.name, xPos + 6, yPos + 1)
            xPos += textWidth
          }

          yPos += 6
        }
      }

      // === TABLEAU DÉTAIL DES ÉLÉMENTS ===
      if (includeDetails && (placedElements.length > 0 || placedGroups.length > 0 || annotations.length > 0)) {
        pdf.addPage('a4', 'l') // Nouvelle page paysage pour recto-verso
        const dPageW = pdf.internal.pageSize.getWidth()
        const dMargin = 12
        let dy = dMargin

        // En-tête details
        pdf.setFillColor(22, 163, 106)
        pdf.rect(0, 0, dPageW, 20, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFontSize(14)
        pdf.setFont('helvetica', 'bold')
        pdf.text(`Détail du plan — ${space.name}`, dMargin, 13)
        dy = 28

        const checkPage = (needed: number) => {
          if (dy + needed > pdf.internal.pageSize.getHeight() - dMargin) {
            pdf.addPage('a4', 'l')
            dy = dMargin
          }
        }

        // Éléments positionnés
        if (includeElements && placedElements.length > 0) {
          pdf.setFontSize(12)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(30, 41, 59)
          pdf.text(`Éléments positionnés (${placedElements.length})`, dMargin, dy)
          dy += 7

          // En-tête tableau
          pdf.setFillColor(243, 244, 246)
          pdf.rect(dMargin, dy - 4, dPageW - 2 * dMargin, 7, 'F')
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(75, 85, 99)
          pdf.text('Code', dMargin + 2, dy)
          pdf.text('Libellé', dMargin + 35, dy)
          pdf.text('Type', dMargin + 110, dy)
          pdf.text('Espèce', dMargin + 160, dy)
          pdf.text('État', dMargin + 215, dy)
          pdf.text('Surface', dMargin + 250, dy)
          dy += 6

          for (const el of placedElements) {
            checkPage(7)
            const typeInfo = ELEMENT_TYPES.find((t: any) => t.value === el.element_type)
            const condLabel = CONDITION_STATES.find((c: any) => c.value === el.condition_state)?.label || ''
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(30, 41, 59)
            pdf.text((el.code || '-').substring(0, 15), dMargin + 2, dy)
            pdf.text((el.label || '').substring(0, 40), dMargin + 35, dy)
            pdf.text((typeInfo?.label || '').substring(0, 25), dMargin + 110, dy)
            pdf.text((el.species || '-').substring(0, 25), dMargin + 160, dy)
            pdf.text(condLabel.substring(0, 15), dMargin + 215, dy)
            pdf.text(el.area_m2 ? `${el.area_m2} m²` : '-', dMargin + 250, dy)

            pdf.setDrawColor(229, 231, 235)
            pdf.line(dMargin, dy + 2, dPageW - dMargin, dy + 2)
            dy += 6
          }
          dy += 5
        }

        // Groupes
        if (includeGroups && placedGroups.length > 0) {
          checkPage(20)
          pdf.setFontSize(12)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(30, 41, 59)
          pdf.text(`Groupes de composition (${placedGroups.length})`, dMargin, dy)
          dy += 7

          for (const g of placedGroups) {
            checkPage(15)
            const typeInfo = GROUP_TYPES.find((t: any) => t.value === g.group_type)
            const groupElements = elements.filter((el: any) => el.group_id === g.id)
            pdf.setFontSize(9)
            pdf.setFont('helvetica', 'bold')
            pdf.setTextColor(30, 41, 59)

            const r = parseInt((g.color || typeInfo?.color || '#8b5cf6').slice(1, 3), 16)
            const gv = parseInt((g.color || typeInfo?.color || '#8b5cf6').slice(3, 5), 16)
            const b = parseInt((g.color || typeInfo?.color || '#8b5cf6').slice(5, 7), 16)
            pdf.setFillColor(r, gv, b)
            pdf.rect(dMargin, dy - 3, 4, 4, 'F')
            pdf.text(`${g.name} — ${typeInfo?.label || g.group_type}`, dMargin + 7, dy)
            dy += 5

            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(107, 114, 128)
            if (g.area_m2) {
              pdf.text(`Surface : ${g.area_m2} m²`, dMargin + 7, dy)
              dy += 4
            }
            if (groupElements.length > 0) {
              pdf.text(`Éléments : ${groupElements.map((el: any) => el.label).join(', ')}`, dMargin + 7, dy)
              dy += 4
            }
            if (g.description) {
              const descLines = pdf.splitTextToSize(g.description, dPageW - 2 * dMargin - 7)
              pdf.text(descLines, dMargin + 7, dy)
              dy += descLines.length * 4
            }
            dy += 3
          }
          dy += 5
        }

        // Annotations
        if (includeAnnotations && annotations.length > 0) {
          checkPage(15)
          pdf.setFontSize(12)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(30, 41, 59)
          pdf.text(`Annotations (${annotations.length})`, dMargin, dy)
          dy += 7

          for (const ann of annotations) {
            checkPage(8)
            pdf.setFontSize(8)
            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(30, 41, 59)
            pdf.text(`• ${ann.label}`, dMargin + 2, dy)
            pdf.setTextColor(156, 163, 175)
            pdf.text(`(${ann.pos_x.toFixed(1)}%, ${ann.pos_y.toFixed(1)}%)`, dMargin + 80, dy)
            dy += 5
          }
        }

        // Pied de page sur toutes les pages
        const pageCount = pdf.getNumberOfPages()
        for (let i = 1; i <= pageCount; i++) {
          pdf.setPage(i)
          pdf.setFontSize(7)
          pdf.setTextColor(156, 163, 175)
          const ph = pdf.internal.pageSize.getHeight()
          const pw = pdf.internal.pageSize.getWidth()
          pdf.text(
            `Page ${i}/${pageCount} — Gestion des Matériels — Espaces Verts : ${space.name}`,
            pw / 2, ph - 5, { align: 'center' }
          )
        }
      }

      const safeName = space.name.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ _-]/g, '_')
      pdf.save(`Plan_${safeName}_${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success('PDF généré avec succès')
      onClose()
    } catch (error) {
      console.error('Erreur génération PDF:', error)
      toast.error('Erreur lors de la génération du PDF')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 w-[900px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Download className="h-5 w-5 text-green-600" />
            Exporter le plan annoté en PDF
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Info */}
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">{space.name}</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              {placedElements.length} éléments • {placedGroups.length} groupes • {annotations.length} annotations
            </p>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={includeElements} onChange={e => setIncludeElements(e.target.checked)} className="rounded text-green-600" />
              Éléments positionnés
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={includeGroups} onChange={e => setIncludeGroups(e.target.checked)} className="rounded text-green-600" />
              Groupes de composition
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={includeAnnotations} onChange={e => setIncludeAnnotations(e.target.checked)} className="rounded text-green-600" />
              Annotations
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={includeLegend} onChange={e => setIncludeLegend(e.target.checked)} className="rounded text-green-600" />
              Légende
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={includeDetails} onChange={e => setIncludeDetails(e.target.checked)} className="rounded text-green-600" />
              Tableau détaillé (page 2)
            </label>
          </div>

          {/* Aperçu du plan rendu en off-screen */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white" style={{ maxHeight: '400px', overflow: 'auto' }}>
            <div ref={renderRef} style={{ position: 'relative', display: 'inline-block', width: '100%', backgroundColor: '#ffffff' }}>
              <img
                src={getImageUrl(space.plan_image)}
                alt="Plan"
                style={{ width: '100%', display: 'block' }}
                crossOrigin="anonymous"
              />
              {/* SVG zones */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                {includeElements && elements.filter((el: any) => el.zone_points).map((el: any) => {
                  const pts = parseZonePoints(el.zone_points)
                  if (pts.length < 3) return null
                  const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
                  const color = typeInfo?.color || '#22c55e'
                  const pointsStr = pts.map((p: any) => `${p.x},${p.y}`).join(' ')
                  return (
                    <polygon key={`z-el-${el.id}`} points={pointsStr} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={0.5} strokeOpacity={0.7} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  )
                })}
                {includeGroups && groups.filter((g: any) => g.zone_points).map((g: any) => {
                  const pts = parseZonePoints(g.zone_points)
                  if (pts.length < 3) return null
                  const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
                  const color = g.color || typeInfo?.color || '#8b5cf6'
                  const pointsStr = pts.map((p: any) => `${p.x},${p.y}`).join(' ')
                  return (
                    <polygon key={`z-grp-${g.id}`} points={pointsStr} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={0.5} strokeOpacity={0.8} strokeLinejoin="round" strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                  )
                })}
              </svg>
              {/* Markers éléments */}
              {includeElements && placedElements.map((el: any) => {
                const typeInfo = ELEMENT_TYPES.find(t => t.value === el.element_type)
                return (
                  <div key={`el-${el.id}`} style={{
                    position: 'absolute', left: `${el.pos_x}%`, top: `${el.pos_y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', border: '2px solid white',
                      backgroundColor: typeInfo?.color || '#22c55e',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    }}>
                      <span style={{ color: 'white', fontSize: 7, fontWeight: 'bold' }}>{el.code ? el.code.substring(0, 2) : ''}</span>
                    </div>
                    {/* Label */}
                    <div style={{
                      position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                      marginTop: 2, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3,
                      padding: '1px 4px', fontSize: 7, whiteSpace: 'nowrap', color: '#1e293b',
                      border: '1px solid #e5e7eb', fontWeight: 600,
                    }}>
                      {el.code || el.label}
                    </div>
                  </div>
                )
              })}
              {/* Markers groupes */}
              {includeGroups && placedGroups.map((g: any) => {
                const typeInfo = GROUP_TYPES.find(t => t.value === g.group_type)
                return (
                  <div key={`grp-${g.id}`} style={{
                    position: 'absolute', left: `${g.pos_x}%`, top: `${g.pos_y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 4, border: '2px solid white',
                      backgroundColor: g.color || typeInfo?.color || '#8b5cf6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                      fontSize: 10, color: 'white',
                    }}>◆</div>
                    <div style={{
                      position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                      marginTop: 2, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3,
                      padding: '1px 4px', fontSize: 7, whiteSpace: 'nowrap', color: '#1e293b',
                      border: '1px solid #e5e7eb', fontWeight: 600,
                    }}>
                      {g.name}
                    </div>
                  </div>
                )
              })}
              {/* Markers annotations */}
              {includeAnnotations && annotations.map((ann: any) => (
                <div key={`ann-${ann.id}`} style={{
                  position: 'absolute', left: `${ann.pos_x}%`, top: `${ann.pos_y}%`,
                  transform: 'translate(-50%, -50%)',
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', border: '2px solid white',
                    backgroundColor: ann.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    fontSize: 8, color: 'white',
                  }}>📍</div>
                  <div style={{
                    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                    marginTop: 2, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3,
                    padding: '1px 4px', fontSize: 7, whiteSpace: 'nowrap', color: '#1e293b',
                    border: '1px solid #e5e7eb',
                  }}>
                    {ann.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            Annuler
          </button>
          <button
            onClick={generatePDF}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isGenerating ? 'Génération...' : 'Générer le PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
