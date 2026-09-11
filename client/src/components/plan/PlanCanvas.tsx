import { type CSSProperties, type ReactNode } from 'react'
import { Layers, MapPin } from 'lucide-react'
import { getImageUrl, typeElement } from '@/lib/espacesVerts'
import { centroide, formaterSurface, parseZonePoints } from './geometrie'
import type { PointPlan, SelectionPlan } from './types'

/**
 * Le plan et ce qui est posé dessus, dessinés une seule fois.
 *
 * Le même plan était rendu à quatre endroits — l'onglet interactif, l'export
 * PDF, la vue d'une archive, la comparaison de deux versions — avec des tailles
 * de pastille, des icônes et des épaisseurs de trait qui avaient divergé au fil
 * des retouches. Une zone tracée à l'écran ne ressemblait pas à celle du PDF,
 * et toute nouveauté était à écrire quatre fois : trois l'étaient, la quatrième
 * était oubliée.
 *
 * Ce composant ne **décide** de rien : il reçoit ce qu'il y a à montrer et le
 * montre. L'édition — glisser un repère, retoucher un sommet — se superpose par
 * `children`, dans le même repère en pourcentages.
 *
 * Les types attendus sont décrits par ce dont le dessin a besoin, et non
 * importés de la fiche d'espace vert : le PDF et les archives manipulent des
 * lignes issues d'un instantané JSON, qui n'ont jamais tous les champs.
 */

export interface ElementSurPlan {
  id: number
  label?: string
  code?: string
  element_type?: string
  pos_x?: number | null
  pos_y?: number | null
  area_m2?: number | null
  zone_points?: string | null
}

export interface GroupeSurPlan {
  id: number
  name?: string
  group_type?: string
  color?: string
  pos_x?: number | null
  pos_y?: number | null
  area_m2?: number | null
  zone_points?: string | null
}

export interface AnnotationSurPlan {
  id: number
  label?: string
  color?: string
  icon?: string
  pos_x: number
  pos_y: number
}

/** Ce que l'on choisit d'afficher. Tout est visible par défaut. */
export interface CalquesPlan {
  elements: boolean
  groupes: boolean
  annotations: boolean
  zones: boolean
  etiquettes: boolean
}

const CALQUES_PAR_DEFAUT: CalquesPlan = {
  elements: true,
  groupes: true,
  annotations: true,
  zones: true,
  etiquettes: true,
}

interface PlanCanvasProps {
  planImage: string
  elements?: ElementSurPlan[]
  groups?: GroupeSurPlan[]
  annotations?: AnnotationSurPlan[]
  /** Ce que dit un type de groupe : la commune peut en créer. */
  typeGroupe: (valeur?: string | null) => { label: string; icon: string; color: string }
  selection?: SelectionPlan | null
  calques?: Partial<CalquesPlan>
  /**
   * Zoom courant, pour que les étiquettes gardent leur taille à l'écran.
   * Sans contre-échelle, un libellé de 7 px reste illisible quel que soit le
   * grossissement — c'est le plan qui grandit, pas le texte.
   */
  zoom?: number
  /** Marqueurs réduits : vignette d'archive, aperçu PDF. */
  compact?: boolean
  /** Identifiants masqués, sous la forme `element:12`, `group:3`, `annotation:7`. */
  masques?: Set<string>
  onSelect?: (selection: SelectionPlan | null) => void
  onMarqueurPointerDown?: (selection: SelectionPlan, e: React.PointerEvent) => void
  onZonePointerDown?: (selection: SelectionPlan, e: React.PointerEvent) => void
  /** Rapport hauteur/largeur de l'image, dès qu'elle est chargée. */
  onImageLoad?: (ratio: number) => void
  /** Superposé au plan, dans le même repère : la couche d'édition. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const clef = (type: SelectionPlan['type'], id: number) => `${type}:${id}`

/**
 * Où poser le marqueur de cet objet — et `null` s'il n'est pas sur le plan.
 *
 * Une zone tracée **est** une présence sur le plan, même sans point : une
 * pelouse de deux mille mètres carrés n'a pas de « position », elle a un
 * contour. Ne regarder que `pos_x` la faisait disparaître du plan et
 * réapparaître dans la liste « à poser », alors qu'elle venait d'y être dessinée.
 */
export function positionSurPlan(o: {
  pos_x?: number | null
  pos_y?: number | null
  zone_points?: string | null
}): PointPlan | null {
  if (o.pos_x !== null && o.pos_x !== undefined && o.pos_y !== null && o.pos_y !== undefined) {
    return { x: Number(o.pos_x), y: Number(o.pos_y) }
  }
  const points = parseZonePoints(o.zone_points)
  return points.length >= 3 ? centroide(points) : null
}

export default function PlanCanvas({
  planImage,
  elements = [],
  groups = [],
  annotations = [],
  typeGroupe,
  selection = null,
  calques,
  zoom = 1,
  compact = false,
  masques,
  onSelect,
  onMarqueurPointerDown,
  onZonePointerDown,
  onImageLoad,
  children,
  className = '',
  style,
}: PlanCanvasProps) {
  const vus = { ...CALQUES_PAR_DEFAUT, ...calques }
  const visible = (type: SelectionPlan['type'], id: number) => !masques?.has(clef(type, id))

  // Chaque objet est accompagné de l'endroit où le montrer : sa position, ou le
  // centre de sa zone. Ceux qui n'ont ni l'une ni l'autre ne sont pas sur le plan.
  const elementsPoses = elements
    .filter((el) => visible('element', el.id))
    .map((el) => ({ el, ou: positionSurPlan(el) }))
    .filter((o): o is { el: ElementSurPlan; ou: PointPlan } => o.ou !== null)
  const groupesPoses = groups
    .filter((g) => visible('group', g.id))
    .map((g) => ({ g, ou: positionSurPlan(g) }))
    .filter((o): o is { g: GroupeSurPlan; ou: PointPlan } => o.ou !== null)
  const annotationsVues = annotations.filter((a) => visible('annotation', a.id))

  const estSelectionne = (type: SelectionPlan['type'], id: number) =>
    selection?.type === type && selection.id === id

  /**
   * Pose un marqueur sur le plan, insensible au zoom.
   *
   * La contre-échelle porte sur **l'ancre**, et non sur la pastille et
   * l'étiquette séparément. C'est tout le sujet : `scale()` change ce qu'on
   * voit, jamais la place occupée. La pastille rapetissée gardait donc sa
   * hauteur de boîte, l'étiquette posée juste en dessous (`top-full`) partait
   * de cette hauteur-là, et l'écart se retrouvait multiplié par le zoom au
   * moment où le plan était agrandi — deux pixels d'intention devenaient
   * quatre-vingt-dix à 300 %, et le nom flottait loin sous son repère, parfois
   * plus près du repère voisin.
   *
   * En mettant l'échelle sur l'ancre, la pastille, l'écart et l'étiquette
   * rapetissent ensemble : à l'écran, le marqueur garde sa taille et son nom
   * reste collé dessous, quel que soit le grossissement.
   *
   * `translate(-50%, -50%)` résout sur la boîte **non transformée**, si bien
   * que le centre de l'ancre retombe exactement sur le point visé quelle que
   * soit l'échelle.
   */
  const ancre = (x: number, y: number, zIndex: number): CSSProperties => ({
    left: `${x}%`,
    top: `${y}%`,
    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
    transformOrigin: 'center',
    zIndex,
  })

  const taillePastille = compact ? 'w-5 h-5' : 'w-7 h-7'
  const tailleGroupe = compact ? 'w-6 h-6' : 'w-8 h-8'
  const tailleRepere = compact ? 'w-4 h-4' : 'w-6 h-6'

  return (
    <div className={`relative ${className}`} style={style}>
      <img
        src={getImageUrl(planImage)}
        alt="Plan de l'espace vert"
        className="w-full block select-none"
        draggable={false}
        crossOrigin="anonymous"
        onLoad={(e) => {
          const img = e.currentTarget
          if (img.naturalWidth > 0) onImageLoad?.(img.naturalHeight / img.naturalWidth)
        }}
      />

      {/*
        Les polygones vivent dans un repère de 0 à 100 sur chaque axe, étiré à la
        forme de l'image : les points enregistrés sont littéralement les
        pourcentages, sans conversion à faire ni à oublier.
      */}
      {vus.zones && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 1 }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {elementsPoses.map(({ el }) => {
            const points = parseZonePoints(el.zone_points)
            if (points.length < 3) return null
            const couleur = typeElement(el.element_type).color
            const choisi = estSelectionne('element', el.id)
            return (
              <polygon
                key={`zone-el-${el.id}`}
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={couleur}
                fillOpacity={choisi ? 0.35 : 0.2}
                stroke={couleur}
                strokeWidth={choisi ? 3 : 2}
                strokeOpacity={0.8}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={onSelect ? 'pointer-events-auto cursor-pointer' : ''}
                onPointerDown={(e) => onZonePointerDown?.({ type: 'element', id: el.id }, e)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect?.({ type: 'element', id: el.id })
                }}
              >
                <title>
                  {el.label}
                  {el.area_m2 ? ` — ${formaterSurface(Number(el.area_m2))}` : ''}
                </title>
              </polygon>
            )
          })}

          {groupesPoses.map(({ g }) => {
            const points = parseZonePoints(g.zone_points)
            if (points.length < 3) return null
            const couleur = g.color || typeGroupe(g.group_type).color
            const choisi = estSelectionne('group', g.id)
            return (
              <polygon
                key={`zone-gr-${g.id}`}
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={couleur}
                fillOpacity={choisi ? 0.3 : 0.15}
                stroke={couleur}
                strokeWidth={choisi ? 3 : 2}
                strokeOpacity={0.8}
                strokeDasharray="6 3"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={onSelect ? 'pointer-events-auto cursor-pointer' : ''}
                onPointerDown={(e) => onZonePointerDown?.({ type: 'group', id: g.id }, e)}
                onClick={(e) => {
                  // Le clic sur une zone de groupe ne faisait que stopper la
                  // propagation : elle ne se sélectionnait pas, alors qu'une
                  // zone d'élément le faisait. Deux gestes identiques, deux
                  // réponses différentes.
                  e.stopPropagation()
                  onSelect?.({ type: 'group', id: g.id })
                }}
              >
                <title>
                  {g.name}
                  {g.area_m2 ? ` — ${formaterSurface(Number(g.area_m2))}` : ''}
                </title>
              </polygon>
            )
          })}
        </svg>
      )}

      {vus.elements &&
        elementsPoses.map(({ el, ou }) => {
          const info = typeElement(el.element_type)
          const choisi = estSelectionne('element', el.id)
          return (
            <div
              key={`el-${el.id}`}
              className="absolute"
              style={ancre(ou.x, ou.y, choisi ? 40 : 10)}
            >
              <div
                className={`${taillePastille} rounded-full border-2 border-white shadow-lg flex items-center justify-center transition-transform ${
                  onSelect ? 'cursor-pointer' : ''
                } ${choisi ? 'scale-125 ring-2 ring-blue-400' : 'hover:scale-110'}`}
                style={{ backgroundColor: info.color }}
                title={el.label || el.code}
                onPointerDown={(e) => onMarqueurPointerDown?.({ type: 'element', id: el.id }, e)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect?.(choisi ? null : { type: 'element', id: el.id })
                }}
              >
                {/* L'emoji du type plutôt que deux lettres du code : sur un plan,
                    on reconnaît un arbre bien avant de lire « AR ». */}
                <span className={compact ? 'text-[9px]' : 'text-xs'}>{info.icon}</span>
              </div>
              {vus.etiquettes && (el.code || el.label) && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pointer-events-none">
                  <span className="inline-block px-1 py-px rounded bg-white/85 dark:bg-gray-900/85 text-[10px] text-gray-700 dark:text-gray-200 shadow-sm whitespace-nowrap">
                    {el.code || el.label}
                    {/* La surface rejoint le libellé : au centre de la zone,
                        elle se posait sous le marqueur et se lisait à moitié. */}
                    {el.area_m2 ? ` · ${formaterSurface(Number(el.area_m2))}` : ''}
                  </span>
                </div>
              )}
            </div>
          )
        })}

      {vus.groupes &&
        groupesPoses.map(({ g, ou }) => (
          <MarqueurGroupe
            key={`gr-${g.id}`}
            groupe={g}
            couleur={g.color || typeGroupe(g.group_type).color}
            taille={tailleGroupe}
            selectionne={estSelectionne('group', g.id)}
            ancrage={ancre(ou.x, ou.y, estSelectionne('group', g.id) ? 40 : 15)}
            etiquettes={vus.etiquettes}
            onSelect={onSelect}
            onPointerDown={onMarqueurPointerDown}
          />
        ))}

      {vus.annotations &&
        annotationsVues.map((a) => {
          const choisi = estSelectionne('annotation', a.id)
          return (
            <div
              key={`an-${a.id}`}
              className="absolute"
              style={ancre(Number(a.pos_x), Number(a.pos_y), choisi ? 40 : 20)}
            >
              <div
                className={`${tailleRepere} rounded-full border-2 border-white shadow-lg flex items-center justify-center transition-transform ${
                  onSelect ? 'cursor-pointer' : ''
                } ${choisi ? 'scale-125 ring-2 ring-blue-400' : 'hover:scale-110'}`}
                style={{ backgroundColor: a.color || '#22c55e' }}
                title={a.label}
                onPointerDown={(e) => onMarqueurPointerDown?.({ type: 'annotation', id: a.id }, e)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect?.(choisi ? null : { type: 'annotation', id: a.id })
                }}
              >
                {a.icon && a.icon !== 'circle' ? (
                  <span className="text-[10px]">{a.icon}</span>
                ) : (
                  <MapPin className="h-3 w-3 text-white" />
                )}
              </div>
              {vus.etiquettes && a.label && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pointer-events-none">
                  <span className="inline-block px-1 py-px rounded bg-white/85 dark:bg-gray-900/85 text-[10px] text-gray-700 dark:text-gray-200 shadow-sm whitespace-nowrap">
                    {a.label}
                  </span>
                </div>
              )}
            </div>
          )
        })}

      {children}
    </div>
  )
}

function MarqueurGroupe({
  groupe,
  couleur,
  taille,
  selectionne,
  ancrage,
  etiquettes,
  onSelect,
  onPointerDown,
}: {
  groupe: GroupeSurPlan
  couleur: string
  taille: string
  selectionne: boolean
  /** Style d'ancrage calculé par le plan : position, centrage et contre-échelle. */
  ancrage: CSSProperties
  etiquettes: boolean
  onSelect?: (s: SelectionPlan | null) => void
  onPointerDown?: (s: SelectionPlan, e: React.PointerEvent) => void
}) {
  return (
    <div className="absolute" style={ancrage}>
      <div
        className={`${taille} rounded-lg border-2 border-white shadow-lg flex items-center justify-center transition-transform ${
          onSelect ? 'cursor-pointer' : ''
        } ${selectionne ? 'scale-125 ring-2 ring-blue-400' : 'hover:scale-110'}`}
        style={{ backgroundColor: couleur }}
        title={groupe.name}
        onPointerDown={(e) => onPointerDown?.({ type: 'group', id: groupe.id }, e)}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(selectionne ? null : { type: 'group', id: groupe.id })
        }}
      >
        <Layers className="h-3 w-3 text-white" />
      </div>
      {etiquettes && groupe.name && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pointer-events-none">
          <span className="inline-block px-1 py-px rounded bg-white/85 dark:bg-gray-900/85 text-[10px] text-gray-700 dark:text-gray-200 shadow-sm whitespace-nowrap">
            {groupe.name}
            {groupe.area_m2 ? ` · ${formaterSurface(Number(groupe.area_m2))}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
