import type { CalibragePlan, EchellePlan, PointPlan } from './types'

/**
 * La géométrie du plan annoté, écrite une seule fois.
 *
 * Les surfaces se lisaient jusqu'ici dans un champ que quelqu'un remplissait de
 * mémoire, et le polygone dessiné à côté ne disait rien. Dès qu'un plan est
 * calibré, c'est le dessin qui donne la surface — et une surface corrigée à la
 * main reste corrigée : voir `area_source` sur l'élément.
 */

/** Ramène un pourcentage dans les limites du plan : un clic ne sort jamais. */
export function borner(valeur: number): number {
  if (!Number.isFinite(valeur)) return 0
  return Math.min(100, Math.max(0, valeur))
}

/**
 * Lit les points d'une zone stockés en JSON.
 *
 * Tolérant à dessein : la colonne a été remplie sans validation pendant des
 * mois, et un plan qui refuse de s'afficher est pire qu'une zone manquante.
 */
export function parseZonePoints(zp: string | null | undefined | PointPlan[]): PointPlan[] {
  if (!zp) return []
  try {
    const parsed = typeof zp === 'string' ? JSON.parse(zp) : zp
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
  } catch {
    return []
  }
}

/**
 * Aire du polygone en « pourcents carrés », par la formule du lacet.
 *
 * Valeur absolue : le sens de parcours dépend de l'ordre des clics, et une
 * surface négative ne veut rien dire pour un massif.
 */
export function aireShoelace(points: PointPlan[]): number {
  if (points.length < 3) return 0
  let somme = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    somme += a.x * b.y - b.x * a.y
  }
  return Math.abs(somme) / 2
}

/** Surface réelle du polygone, en m², `null` tant que le plan n'est pas calibré. */
export function aireEnM2(points: PointPlan[], echelle: EchellePlan | null): number | null {
  if (!echelle || !echelle.metresParPourcent || points.length < 3) return null
  // Un pourcent de largeur vaut `metresParPourcent` ; un pourcent de hauteur
  // vaut la même chose multipliée par le ratio de l'image.
  const aire = aireShoelace(points) * echelle.metresParPourcent ** 2 * echelle.ratio
  return Number.isFinite(aire) ? aire : null
}

/** Longueur réelle d'un segment du plan, en mètres. */
export function longueurEnM(a: PointPlan, b: PointPlan, echelle: EchellePlan | null): number | null {
  if (!echelle || !echelle.metresParPourcent) return null
  return longueurEnPourcent(a, b, echelle.ratio) * echelle.metresParPourcent
}

/** Longueur d'un segment exprimée en pourcents de largeur, hauteur redressée. */
function longueurEnPourcent(a: PointPlan, b: PointPlan, ratio: number): number {
  const dx = b.x - a.x
  const dy = (b.y - a.y) * ratio
  return Math.hypot(dx, dy)
}

/**
 * Déduit l'échelle du segment tracé sur une longueur connue.
 *
 * Rend `null` si le segment est trop court pour être fiable : deux clics au même
 * endroit donneraient une échelle infinie, et toutes les surfaces avec.
 */
export function echelleDepuisCalibrage(
  calibrage: CalibragePlan,
  ratio: number
): EchellePlan | null {
  const longueur = longueurEnPourcent(calibrage.a, calibrage.b, ratio)
  if (longueur < 0.5 || !(calibrage.metres > 0)) return null
  return { metresParPourcent: calibrage.metres / longueur, ratio }
}

/** Insère un sommet au milieu du segment qui suit `index`. */
export function insererSommet(points: PointPlan[], index: number): PointPlan[] {
  const a = points[index]
  const b = points[(index + 1) % points.length]
  if (!a || !b) return points
  const milieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return [...points.slice(0, index + 1), milieu, ...points.slice(index + 1)]
}

/** Retire un sommet, sauf s'il ne resterait plus de polygone. */
export function retirerSommet(points: PointPlan[], index: number): PointPlan[] {
  if (points.length <= 3) return points
  return points.filter((_, i) => i !== index)
}

/** Déplace la zone entière, en la gardant dans les limites du plan. */
export function deplacerZone(points: PointPlan[], dx: number, dy: number): PointPlan[] {
  // Le décalage est rogné avant d'être appliqué : borner chaque point
  // séparément déformerait le polygone contre le bord au lieu de l'arrêter.
  const minX = Math.min(...points.map((p) => p.x))
  const maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  const dxRogne = Math.min(100 - maxX, Math.max(-minX, dx))
  const dyRogne = Math.min(100 - maxY, Math.max(-minY, dy))
  return points.map((p) => ({ x: p.x + dxRogne, y: p.y + dyRogne }))
}

/** Centre de gravité du polygone — où poser l'étiquette d'une zone. */
export function centroide(points: PointPlan[]): PointPlan | null {
  if (points.length === 0) return null
  if (points.length < 3) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    }
  }
  let aire = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const croix = a.x * b.y - b.x * a.y
    aire += croix
    cx += (a.x + b.x) * croix
    cy += (a.y + b.y) * croix
  }
  // Polygone dégénéré (tous les points alignés) : la moyenne fait l'affaire.
  if (Math.abs(aire) < 1e-9) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    }
  }
  return { x: cx / (3 * aire), y: cy / (3 * aire) }
}

/** Le point est-il dans le polygone ? (lancer de rayon) */
export function pointDansPolygone(point: PointPlan, points: PointPlan[]): boolean {
  if (points.length < 3) return false
  let dedans = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    const traverse = a.y > point.y !== b.y > point.y
    if (traverse && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      dedans = !dedans
    }
  }
  return dedans
}

/** Une surface telle qu'on l'écrit sur un plan : « 1 240 m² », « 12,4 m² ». */
export function formaterSurface(m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || !Number.isFinite(m2)) return ''
  const decimales = m2 < 100 ? 1 : 0
  return `${m2.toLocaleString('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} m²`
}
