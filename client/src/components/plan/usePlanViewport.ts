import { useCallback, useEffect, useRef, useState } from 'react'
import { borner } from './geometrie'
import type { PointPlan } from './types'

/**
 * Se déplacer dans un plan, et savoir où l'on a cliqué.
 *
 * Deux défauts se répondaient. Le zoom s'ancrait en haut à gauche
 * (`transform-origin: top left`), donc grossir chassait de l'écran le massif
 * qu'on regardait, et il fallait rattraper aux barres de défilement. Et la
 * conversion d'un clic en pourcentage divisait **une seconde fois** par le zoom
 * un rapport qui en tenait déjà compte : à 200 %, un clic au centre du plan
 * s'enregistrait au quart. Tout ce qu'on posait après avoir zoomé tombait à côté.
 *
 * Les deux venaient du même endroit : la conversion écran ⇄ pourcentage n'était
 * écrite nulle part, seulement recopiée. Elle est ici, une fois, et c'est la
 * seule porte d'entrée.
 */

/** Bornes du zoom : sous 25 % un plan n'est plus lisible, au-delà de 600 % il est flou. */
const ZOOM_MIN = 0.25
const ZOOM_MAX = 6

export interface PlanViewport {
  /** À poser sur le cadre qui rogne — c'est lui qui capte molette et glisser. */
  cadreRef: React.RefObject<HTMLDivElement>
  /** À poser sur le contenu transformé, qui porte l'image et les marqueurs. */
  contenuRef: React.RefObject<HTMLDivElement>
  zoom: number
  /** Style à appliquer au contenu : translation puis échelle, origine en haut à gauche. */
  styleContenu: React.CSSProperties
  /** L'utilisateur est-il en train de faire glisser le plan ? */
  enDeplacement: boolean
  /** Coordonnées d'un évènement souris, en pourcentages du plan, toujours bornées. */
  versPourcent: (e: { clientX: number; clientY: number }) => PointPlan
  /** Le même calcul sans bornage — pour mesurer un déplacement, pas une position. */
  deltaEnPourcent: (dxPixels: number, dyPixels: number) => PointPlan
  zoomer: (facteur: number) => void
  /** Zoom ancré sur un point de l'écran : ce qui est sous le curseur y reste. */
  zoomerVers: (facteur: number, clientX: number, clientY: number) => void
  definirZoom: (valeur: number) => void
  /** Ramène le plan entier dans le cadre. */
  ajuster: () => void
  /** Retour à 100 %, sans décalage. */
  reinitialiser: () => void
  /** À brancher sur le cadre pour démarrer un panoramique. */
  commencerDeplacement: (e: React.PointerEvent) => void
  /** Hauteur du contenu à l'échelle 1, pour dimensionner le cadre. */
  largeurBase: number
}

export function usePlanViewport(): PlanViewport {
  const cadreRef = useRef<HTMLDivElement>(null)
  const contenuRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [decalage, setDecalage] = useState({ x: 0, y: 0 })
  const [enDeplacement, setEnDeplacement] = useState(false)
  const [largeurBase, setLargeurBase] = useState(0)

  // Le contenu est dimensionné en pixels plutôt qu'en pourcentage du cadre :
  // une largeur relative se recalculerait à chaque translation, et le plan
  // glisserait sous le curseur au lieu de le suivre.
  useEffect(() => {
    const cadre = cadreRef.current
    if (!cadre) return
    const mesurer = () => setLargeurBase(cadre.clientWidth)
    mesurer()
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(cadre)
    return () => observateur.disconnect()
  }, [])

  /**
   * Empêche le plan de partir hors du cadre.
   *
   * Sans garde-fou, un glisser un peu vif laisse un écran vide et l'utilisateur
   * ne sait plus dans quelle direction revenir. On garde toujours un quart du
   * plan visible.
   */
  const brider = useCallback((suivant: { x: number; y: number }, echelle: number) => {
    const cadre = cadreRef.current
    const contenu = contenuRef.current
    if (!cadre || !contenu) return suivant
    const largeur = contenu.offsetWidth * echelle
    const hauteur = contenu.offsetHeight * echelle
    const margeX = cadre.clientWidth - largeur / 4
    const margeY = cadre.clientHeight - hauteur / 4
    return {
      x: Math.min(margeX, Math.max(-largeur + cadre.clientWidth / 4, suivant.x)),
      y: Math.min(margeY, Math.max(-hauteur + cadre.clientHeight / 4, suivant.y)),
    }
  }, [])

  const zoomerVers = useCallback(
    (facteur: number, clientX: number, clientY: number) => {
      const cadre = cadreRef.current
      if (!cadre) return
      setZoom((actuel) => {
        const suivant = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, actuel * facteur))
        if (suivant === actuel) return actuel
        const rect = cadre.getBoundingClientRect()
        const cx = clientX - rect.left
        const cy = clientY - rect.top
        setDecalage((d) => {
          // Le point du plan sous le curseur, en coordonnées non transformées :
          // c'est lui qu'on veut retrouver au même endroit après le zoom.
          const ux = (cx - d.x) / actuel
          const uy = (cy - d.y) / actuel
          return brider({ x: cx - ux * suivant, y: cy - uy * suivant }, suivant)
        })
        return suivant
      })
    },
    [brider]
  )

  const zoomer = useCallback(
    (facteur: number) => {
      const cadre = cadreRef.current
      if (!cadre) return
      // Sans curseur — les boutons de la barre —, on ancre au centre du cadre :
      // c'est ce que l'utilisateur regarde.
      const rect = cadre.getBoundingClientRect()
      zoomerVers(facteur, rect.left + rect.width / 2, rect.top + rect.height / 2)
    },
    [zoomerVers]
  )

  const definirZoom = useCallback(
    (valeur: number) => {
      const cible = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, valeur))
      setZoom((actuel) => {
        if (actuel === cible) return actuel
        zoomer(cible / actuel)
        return actuel
      })
    },
    [zoomer]
  )

  const reinitialiser = useCallback(() => {
    setZoom(1)
    setDecalage({ x: 0, y: 0 })
  }, [])

  const ajuster = useCallback(() => {
    const cadre = cadreRef.current
    const contenu = contenuRef.current
    if (!cadre || !contenu) return
    const hauteur = contenu.offsetHeight
    if (!hauteur) return
    // Le contenu occupe déjà toute la largeur : seule la hauteur peut déborder.
    const echelle = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cadre.clientHeight / hauteur))
    setZoom(echelle)
    setDecalage({ x: (cadre.clientWidth - contenu.offsetWidth * echelle) / 2, y: 0 })
  }, [])

  // La molette est écoutée à la main, en non-passif : React pose ses écouteurs
  // en passif et `preventDefault()` y est ignoré — la page entière défilerait
  // pendant qu'on zoome.
  useEffect(() => {
    const cadre = cadreRef.current
    if (!cadre) return
    const surMolette = (e: WheelEvent) => {
      e.preventDefault()
      // Un cran de molette vaut ~10 % : assez pour avancer, assez peu pour
      // s'arrêter où l'on veut.
      const facteur = Math.exp(-e.deltaY * 0.0015)
      zoomerVers(facteur, e.clientX, e.clientY)
    }
    cadre.addEventListener('wheel', surMolette, { passive: false })
    return () => cadre.removeEventListener('wheel', surMolette)
  }, [zoomerVers])

  const commencerDeplacement = useCallback(
    (e: React.PointerEvent) => {
      const cadre = cadreRef.current
      if (!cadre) return
      const departX = e.clientX
      const departY = e.clientY
      const origine = decalage
      setEnDeplacement(true)

      const surDeplacement = (ev: PointerEvent) => {
        setDecalage(
          brider({ x: origine.x + (ev.clientX - departX), y: origine.y + (ev.clientY - departY) }, zoom)
        )
      }
      const surFin = () => {
        setEnDeplacement(false)
        window.removeEventListener('pointermove', surDeplacement)
        window.removeEventListener('pointerup', surFin)
        window.removeEventListener('pointercancel', surFin)
      }
      // Les écouteurs sont posés sur la fenêtre : un glisser qui sort du cadre
      // doit continuer, et surtout se terminer proprement s'il est relâché
      // au-dessus d'un autre élément.
      window.addEventListener('pointermove', surDeplacement)
      window.addEventListener('pointerup', surFin)
      window.addEventListener('pointercancel', surFin)
    },
    [brider, decalage, zoom]
  )

  /**
   * Coordonnées d'un clic, en pourcentages du plan.
   *
   * `getBoundingClientRect()` rend la boîte **après** transformation : sa
   * largeur vaut déjà largeur naturelle × zoom, et le rapport ci-dessous est
   * donc la bonne fraction. C'est la division supplémentaire par le zoom qui
   * posait tout au quart de la distance visée.
   */
  const versPourcent = useCallback((e: { clientX: number; clientY: number }): PointPlan => {
    const contenu = contenuRef.current
    if (!contenu) return { x: 0, y: 0 }
    const rect = contenu.getBoundingClientRect()
    if (!rect.width || !rect.height) return { x: 0, y: 0 }
    return {
      x: borner(((e.clientX - rect.left) / rect.width) * 100),
      y: borner(((e.clientY - rect.top) / rect.height) * 100),
    }
  }, [])

  /**
   * Un déplacement en pixels traduit en pourcentages.
   *
   * Sans bornage, contrairement à `versPourcent` : un écart de −3 % est une
   * information juste, alors qu'une position de −3 % n'existe pas.
   */
  const deltaEnPourcent = useCallback((dxPixels: number, dyPixels: number): PointPlan => {
    const contenu = contenuRef.current
    if (!contenu) return { x: 0, y: 0 }
    const rect = contenu.getBoundingClientRect()
    if (!rect.width || !rect.height) return { x: 0, y: 0 }
    return { x: (dxPixels / rect.width) * 100, y: (dyPixels / rect.height) * 100 }
  }, [])

  return {
    cadreRef,
    contenuRef,
    zoom,
    styleContenu: {
      transform: `translate(${decalage.x}px, ${decalage.y}px) scale(${zoom})`,
      transformOrigin: '0 0',
      width: largeurBase || '100%',
    },
    enDeplacement,
    versPourcent,
    deltaEnPourcent,
    zoomer,
    zoomerVers,
    definirZoom,
    ajuster,
    reinitialiser,
    commencerDeplacement,
    largeurBase,
  }
}
