import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { usePlanViewport } from '@/components/plan/usePlanViewport'
import { centroide, formaterSurface } from '@/components/plan/geometrie'
import type { PointPlan } from '@/components/plan/types'
import type { PieceSurPlan } from '@/lib/api'
import { cn } from '@/lib/utils'
import { couleurDePiece } from './couleurs'

/**
 * Le plan d'un étage, et les pièces dessinées dessus.
 *
 * Construit sur les mêmes briques que le plan des espaces verts —
 * `usePlanViewport` pour le zoom et le déplacement, `geometrie` pour les
 * polygones —, mais pas sur son éditeur, taillé pour des massifs et des
 * repères. Ici, trois gestes :
 *
 *   **voir**         cliquer une pièce l'ouvre ; glisser déplace le plan
 *   **dessin**       chaque clic pose un sommet ; on ferme en recliquant le
 *                    premier, par double-clic ou par Entrée ; Échap abandonne,
 *                    Retour arrière retire le dernier point
 *   **étalonnage**   deux clics sur une longueur connue — une porte, un mur coté
 *
 * Un glisser n'est jamais pris pour un clic : au-delà de cinq pixels, c'est un
 * déplacement du plan, et aucun sommet n'est posé.
 */

export type ModePlan = 'voir' | 'dessin' | 'etalonnage'

/** Distance, en pourcents, sous laquelle un clic près du premier sommet ferme le contour. */
const FERMETURE = 1.5
const SEUIL_GLISSER = 5

export default function PlanEtage({
  imageUrl,
  pieces,
  selection,
  surbrillance,
  mode,
  onSelect,
  onTraceFini,
  onEtalonnage,
  onAnnuler,
}: {
  imageUrl: string
  pieces: PieceSurPlan[]
  selection: number | null
  surbrillance: Set<number>
  mode: ModePlan
  onSelect: (pieceId: number | null) => void
  onTraceFini: (points: PointPlan[]) => void
  onEtalonnage: (a: PointPlan, b: PointPlan) => void
  onAnnuler: () => void
}) {
  const vue = usePlanViewport()
  const [trace, setTrace] = useState<PointPlan[]>([])
  const [curseur, setCurseur] = useState<PointPlan | null>(null)
  const depart = useRef<{ x: number; y: number } | null>(null)

  // Changer de geste repart d'un tracé vide.
  useEffect(() => {
    setTrace([])
    setCurseur(null)
  }, [mode])

  const terminer = useCallback(
    (points: PointPlan[]) => {
      if (points.length < 3) return
      onTraceFini(points)
      setTrace([])
    },
    [onTraceFini]
  )

  // Le clavier ne sert qu'en tracé : Entrée ferme, Échap abandonne, Retour arrière recule.
  useEffect(() => {
    if (mode === 'voir') return
    const surTouche = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      if (e.key === 'Escape') {
        setTrace([])
        onAnnuler()
      } else if (e.key === 'Enter' && mode === 'dessin') {
        terminer(trace)
      } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        setTrace((t) => t.slice(0, -1))
      }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [mode, trace, terminer, onAnnuler])

  const surPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    depart.current = { x: e.clientX, y: e.clientY }
    vue.commencerDeplacement(e)
  }

  /** Un clic, et non la fin d'un glisser. */
  const estUnClic = (e: React.MouseEvent) => {
    const d = depart.current
    return !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < SEUIL_GLISSER
  }

  const surClicFond = (e: React.MouseEvent) => {
    if (!estUnClic(e)) return
    const point = vue.versPourcent(e)
    if (mode === 'voir') {
      onSelect(null)
    } else if (mode === 'dessin') {
      const premier = trace[0]
      if (premier && trace.length >= 3 && Math.hypot(point.x - premier.x, point.y - premier.y) < FERMETURE) {
        terminer(trace)
      } else {
        setTrace((t) => [...t, point])
      }
    } else if (mode === 'etalonnage') {
      if (trace.length === 0) setTrace([point])
      else {
        onEtalonnage(trace[0], point)
        setTrace([])
      }
    }
  }

  const surDoubleClic = (e: React.MouseEvent) => {
    if (mode !== 'dessin') return
    e.preventDefault()
    // Le double-clic a déjà posé deux sommets au même endroit : on retire le doublon.
    terminer(trace.slice(0, -1))
  }

  /**
   * Le plan entier dans le cadre, sur ses deux dimensions.
   *
   * `ajuster()` du viewport partagé ne cadre que sur la hauteur — il suppose le
   * plan déjà à pleine largeur — et agrandissait donc un plan en paysage bien
   * au-delà du cadre : on ne voyait qu'un coin de l'école, et les coins à
   * cliquer tombaient dehors.
   */
  const toutVoir = () => vue.cadrerSur({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0.02)

  const zoom = vue.zoom
  const enTrace = mode !== 'voir'

  return (
    <div className="relative">
      <div
        ref={vue.cadreRef}
        className={cn(
          'relative h-[70vh] min-h-[360px] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900',
          enTrace ? 'cursor-crosshair' : vue.enDeplacement ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onPointerDown={surPointerDown}
        onPointerMove={(e) => enTrace && setCurseur(vue.versPourcent(e))}
        onPointerLeave={() => setCurseur(null)}
        onClick={surClicFond}
        onDoubleClick={surDoubleClic}
      >
        <div ref={vue.contenuRef} className="absolute left-0 top-0" style={vue.styleContenu}>
          <img
            src={imageUrl}
            alt="Plan de l'étage"
            className="block w-full select-none"
            draggable={false}
            onLoad={toutVoir}
          />

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {pieces
              .filter((p) => p.zone.length >= 3)
              .map((p) => {
                const couleur = couleurDePiece(p.typeLieu)
                const choisie = selection === p.id
                const trouvee = surbrillance.has(p.id)
                return (
                  <polygon
                    key={p.id}
                    points={p.zone.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                    fill={trouvee ? '#facc15' : couleur}
                    fillOpacity={choisie ? 0.45 : trouvee ? 0.4 : 0.22}
                    stroke={trouvee ? '#ca8a04' : couleur}
                    strokeWidth={choisie || trouvee ? 3 : 1.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className={mode === 'voir' ? 'pointer-events-auto cursor-pointer' : ''}
                    onClick={(e) => {
                      if (mode !== 'voir' || !estUnClic(e)) return
                      e.stopPropagation()
                      onSelect(p.id)
                    }}
                  >
                    <title>
                      {p.nom}
                      {p.surfaceM2 ? ` — ${formaterSurface(p.surfaceM2)}` : ''}
                    </title>
                  </polygon>
                )
              })}

            {/* Le tracé en cours, et le segment qui suit le curseur. */}
            {trace.length > 0 && (
              <polyline
                points={[...trace, ...(curseur ? [curseur] : [])].map((pt) => `${pt.x},${pt.y}`).join(' ')}
                fill={mode === 'dessin' ? 'rgba(37,99,235,0.12)' : 'none'}
                stroke="#2563eb"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* Les sommets posés, insensibles au zoom. */}
          {trace.map((pt, i) => (
            <div
              key={i}
              className={cn(
                'pointer-events-none absolute rounded-full border-2 border-white shadow',
                i === 0 && trace.length >= 3 ? 'h-4 w-4 bg-green-500' : 'h-3 w-3 bg-blue-600'
              )}
              style={{ left: `${pt.x}%`, top: `${pt.y}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
            />
          ))}

          {/* Les noms des pièces, au centre de leur zone, de taille constante. */}
          {mode === 'voir' &&
            pieces
              .filter((p) => p.zone.length >= 3)
              .map((p) => {
                const centre = centroide(p.zone)
                if (!centre) return null
                return (
                  <div
                    key={`n-${p.id}`}
                    className="pointer-events-none absolute whitespace-nowrap rounded bg-white/85 px-1.5 py-0.5 text-xs font-medium text-gray-800 shadow-sm dark:bg-gray-800/85 dark:text-gray-100"
                    style={{ left: `${centre.x}%`, top: `${centre.y}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
                  >
                    {p.nom}
                    {p.materiels > 0 && <span className="ml-1 text-primary-600">· {p.materiels}</span>}
                  </div>
                )
              })}
        </div>
      </div>

      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-white/90 p-1 shadow dark:bg-gray-800/90">
        <button type="button" className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => vue.zoomer(1.25)} aria-label="Zoomer">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => vue.zoomer(0.8)} aria-label="Dézoomer">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={toutVoir} aria-label="Voir tout le plan">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {enTrace && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-md rounded-lg bg-blue-600/95 px-3 py-2 text-sm text-white shadow">
          {mode === 'dessin'
            ? trace.length < 3
              ? 'Cliquez les angles de la pièce, un par un.'
              : 'Recliquez le premier point (vert), double-cliquez ou appuyez sur Entrée pour fermer.'
            : trace.length === 0
              ? "Cliquez le début d'une longueur connue (une porte, un mur coté)."
              : 'Cliquez la fin de cette longueur.'}
          <span className="block text-xs text-blue-100">Échap pour abandonner · Retour arrière pour reculer</span>
        </div>
      )}
    </div>
  )
}
