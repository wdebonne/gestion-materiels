import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { Map as CarteLeaflet } from 'leaflet'
import { Crosshair, Layers, Maximize2 } from 'lucide-react'
import type { FondCarto, Implantation } from '@/lib/api'
import { alerteDe, familleExemplaire, nomComplet, precision } from '@/lib/mobilierUrbain'
import 'leaflet/dist/leaflet.css'

/**
 * La carte du mobilier de voie publique.
 *
 * Elle fait trois choses, et refuse d'en faire une quatrième.
 *
 * **Elle montre où sont les choses**, en les rendant distinguables. Une commune
 * pose des centaines de points ; tous du même bleu, la carte ne répond à aucune
 * question. Chaque marqueur porte donc la couleur et le pictogramme de sa
 * famille — devinée du catalogue, sans référentiel à garnir — et une pastille
 * rouge quand quelque chose cloche.
 *
 * **Elle accepte un clic comme une position.** C'est le geste de pose au
 * bureau, l'exact pendant du relevé GPS sur le terrain.
 *
 * **Elle dit ce qu'elle affiche** à celui qui la contient, pour que la liste à
 * côté et l'export PDF parlent de la même chose qu'elle.
 *
 * Ce qu'elle ne fait pas : décider quoi afficher. Les filtres, la sélection et
 * la pose appartiennent à la page ; la carte les reçoit et les rend.
 */

export interface Props {
  items: Implantation[]
  fonds: FondCarto[]
  cleFond: string
  onFond: (cle: string) => void
  /** La clé de l'implantation choisie : `voirie-12`, `espace_vert-45`. */
  selectionCle?: string | null
  onSelection?: (item: Implantation) => void
  /** En pose, le prochain clic vaut une position — et le curseur le dit. */
  modePose?: boolean
  onPointPose?: (lat: number, lng: number) => void
  /** Le point en cours de pose, affiché avant d'être enregistré. */
  pointProvisoire?: { lat: number; lng: number } | null
  /** La position de l'appareil, quand elle a été relevée. */
  maPosition?: { lat: number; lng: number; accuracy: number } | null
  onRelever?: () => void
  hauteur?: string
  /** Pour la capture de l'export PDF : le conteneur exact à photographier. */
  captureRef?: React.RefObject<HTMLDivElement>
}

/** Là où la carte s'ouvre quand rien n'est posé : la France entière. */
const CENTRE_DEFAUT: [number, number] = [46.6, 2.5]
const ZOOM_SANS_RIEN = 6

/**
 * Le marqueur d'un exemplaire.
 *
 * Dessiné en HTML plutôt qu'en image : la couleur et le pictogramme changent
 * pour chaque famille, et servir une image par combinaison ferait une
 * cinquantaine de fichiers à maintenir pour un dessin de vingt lignes.
 *
 * L'ancre est en bas de la pointe — un marqueur désigne le sol sous lui, pas
 * son propre centre — et la pastille d'alerte déborde volontairement du cercle
 * pour rester lisible à côté d'un voisin.
 */
function icone(item: Implantation, selectionne: boolean): L.DivIcon {
  const famille = familleExemplaire(item)
  const alerte = alerteDe(item)
  const opacite = item.status === 'depose' ? 0.45 : 1
  const bordure = selectionne ? '#111827' : '#ffffff'
  const epaisseur = selectionne ? 3 : 2

  /*
    Une position approchée se voit.

    Un élément de parc sans plan capturé ni relevé de terrain retombe sur le
    marqueur de son parc : il est « quelque part par là », à cent mètres près.
    Le dessiner comme les autres enverrait quelqu'un chercher un banc à
    l'endroit exact du point. Le trait pointillé dit « approximatif » sans
    avoir à cliquer.
  */
  const sure = precision(item.precision_position).sure
  const trait = sure ? 'solid' : 'dashed'

  const pastille = alerte
    ? `<span style="position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:9999px;
         background:${alerte.couleur};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>`
    : ''

  const html = `
    <div style="position:relative;width:30px;height:38px;opacity:${opacite}">
      <div style="position:absolute;left:0;top:0;width:30px;height:30px;border-radius:9999px;
                  background:${famille.couleur};border:${epaisseur}px ${trait} ${bordure};
                  box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;
                  justify-content:center;font-size:15px;line-height:1">${famille.icone}</div>
      <div style="position:absolute;left:11px;top:27px;width:0;height:0;
                  border-left:4px solid transparent;border-right:4px solid transparent;
                  border-top:9px solid ${bordure}"></div>
      ${pastille}
    </div>`

  return L.divIcon({
    html,
    className: 'mobilier-marqueur',
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    tooltipAnchor: [0, -34],
  })
}

/** Le point qu'on est en train de poser, avant qu'il n'existe en base. */
const ICONE_PROVISOIRE = L.divIcon({
  html: `<div style="width:26px;height:26px;border-radius:9999px;background:#2563eb;
           border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25);
           animation:pulseMobilier 1.6s ease-out infinite"></div>
         <style>@keyframes pulseMobilier{0%{box-shadow:0 0 0 4px rgba(37,99,235,.35)}
           70%{box-shadow:0 0 0 16px rgba(37,99,235,0)}100%{box-shadow:0 0 0 4px rgba(37,99,235,0)}}</style>`,
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

/** Là où se tient celui qui relève. Un rond bleu, pas un marqueur : il bouge. */
const ICONE_APPAREIL = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#0ea5e9;
           border:3px solid #fff;box-shadow:0 0 0 3px rgba(14,165,233,.35)"></div>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

/** Retient l'instance Leaflet et capte les clics de pose. */
function Pilote({
  onCarte,
  modePose,
  onPointPose,
}: {
  onCarte: (carte: CarteLeaflet) => void
  modePose?: boolean
  onPointPose?: (lat: number, lng: number) => void
}) {
  const carte = useMap()

  useEffect(() => {
    onCarte(carte)
    // Une carte montée dans un conteneur qui grandit après coup — un panneau
    // latéral qui se replie — garde une taille nulle et n'affiche aucune tuile.
    setTimeout(() => carte.invalidateSize(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMapEvents({
    click: (evenement) => {
      if (modePose && onPointPose) onPointPose(evenement.latlng.lat, evenement.latlng.lng)
    },
  })

  return null
}

/**
 * Cadre la carte sur ce qui est posé, une fois.
 *
 * Une seule fois : chaque pose et chaque modification rechargent la liste, et
 * recadrer à chaque fois annulerait le zoom qu'on venait de faire pour
 * travailler. Le bouton de la barre sert à y revenir volontairement.
 */
function CadrageInitial({ points }: { points: Array<[number, number]> }) {
  const carte = useMap()
  const dejaFait = useRef(false)

  useEffect(() => {
    if (dejaFait.current || points.length === 0) return
    dejaFait.current = true
    carte.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 18 })
  }, [points, carte])

  return null
}

export default function CarteMobilier({
  items,
  fonds,
  cleFond,
  onFond,
  selectionCle,
  onSelection,
  modePose,
  onPointPose,
  pointProvisoire,
  maPosition,
  onRelever,
  hauteur = '60vh',
  captureRef,
}: Props) {
  const carteRef = useRef<CarteLeaflet | null>(null)
  const fond = fonds.find((f) => f.cle === cleFond) ?? fonds[0] ?? null

  /*
    Ce que la carte peut réellement montrer.

    Une implantation sans position existe — un élément saisi dans un parc dont
    le plan n'a jamais été capturé — mais elle n'a pas de point. La lister est
    honnête, la placer au hasard ne l'est pas. Elle reste donc dans le panneau
    latéral, et sort d'ici.
  */
  const places = useMemo(
    () => items.filter((i) => i.latitude !== null && i.longitude !== null),
    [items]
  )
  const points = useMemo(
    () => places.map((i) => [Number(i.latitude), Number(i.longitude)] as [number, number]),
    [places]
  )

  // Un point posé hors du cadre visible n'existe pas pour celui qui regarde :
  // la sélection venue de la liste amène la carte à lui.
  useEffect(() => {
    if (!selectionCle || !carteRef.current) return
    const cible = places.find((i) => i.cle === selectionCle)
    if (!cible) return
    carteRef.current.setView(
      [Number(cible.latitude), Number(cible.longitude)],
      Math.max(carteRef.current.getZoom(), 18),
      { animate: true }
    )
  }, [selectionCle, places])

  const centre = useMemo<[number, number]>(() => {
    if (points.length > 0) return points[0]
    if (maPosition) return [maPosition.lat, maPosition.lng]
    return CENTRE_DEFAUT
  }, [points, maPosition])

  const cadrerSurLePose = () => {
    if (!carteRef.current || points.length === 0) return
    carteRef.current.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 18 })
  }

  return (
    /*
      `isolate` n'est pas décoratif.

      Leaflet pose ses contrôles à `z-index: 1000` et ses calques à 400. Sans
      contexte d'empilement autour de la carte, ces valeurs vivent dans celui de
      la page et passent **devant** les fenêtres modales, qui montent à 50 : la
      fenêtre « Que posez-vous ? » s'ouvrait derrière la carte, à moitié cachée.
      `isolation: isolate` enferme toute la numérotation de Leaflet ici, et la
      carte redevient un simple bloc de la page.
    */
    <div className="relative isolate" style={{ height: hauteur }}>
      {/* Barre d'outils, posée sur la carte : la place au-dessus se paie en
          hauteur de carte, et c'est justement ce qui manque sur un téléphone. */}
      <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
        {fonds.length > 1 && (
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-800">
            {fonds.map((f) => (
              <button
                key={f.cle}
                type="button"
                title={f.description}
                onClick={() => onFond(f.cle)}
                className={`px-2.5 py-2 text-xs font-medium transition-colors ${
                  f.cle === fond?.cle
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {f.court}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={cadrerSurLePose}
          disabled={points.length === 0}
          title="Cadrer sur le mobilier affiché"
          aria-label="Cadrer sur le mobilier affiché"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <Maximize2 className="h-4 w-4" />
        </button>

        {onRelever && (
          <button
            type="button"
            onClick={onRelever}
            title="Me localiser"
            aria-label="Me localiser"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500 bg-white text-sky-600 shadow-sm hover:bg-sky-50 dark:border-sky-500 dark:bg-gray-800 dark:text-sky-400 dark:hover:bg-sky-900/30"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={captureRef} className="h-full w-full overflow-hidden rounded-lg">
        <MapContainer
          center={centre}
          zoom={points.length > 0 ? 15 : ZOOM_SANS_RIEN}
          style={{ height: '100%', width: '100%', cursor: modePose ? 'crosshair' : '' }}
          scrollWheelZoom
        >
          <Pilote
            onCarte={(carte) => {
              carteRef.current = carte
            }}
            modePose={modePose}
            onPointPose={onPointPose}
          />
          <CadrageInitial points={points} />

          {fond && (
            <TileLayer
              key={fond.cle}
              url={fond.modele}
              attribution={fond.attribution}
              maxZoom={fond.zoomMax}
              maxNativeZoom={fond.zoomMax}
            />
          )}

          {places.map((item) => (
            <Marker
              key={item.cle}
              position={[Number(item.latitude), Number(item.longitude)]}
              icon={icone(item, item.cle === selectionCle)}
              eventHandlers={{ click: () => onSelection?.(item) }}
            >
              <Tooltip direction="top" opacity={0.95}>
                <span className="font-medium">{nomComplet(item)}</span>
                <span className="block text-xs">{item.street || item.lieu}</span>
              </Tooltip>
            </Marker>
          ))}

          {pointProvisoire && (
            <Marker
              position={[pointProvisoire.lat, pointProvisoire.lng]}
              icon={ICONE_PROVISOIRE}
              zIndexOffset={1000}
            />
          )}

          {maPosition && (
            <Marker position={[maPosition.lat, maPosition.lng]} icon={ICONE_APPAREIL}>
              <Tooltip direction="top">Vous êtes ici (±{Math.round(maPosition.accuracy)} m)</Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* La légende ne liste que ce qui est réellement affiché : une légende de
          seize familles pour une carte qui n'en montre trois est du bruit. */}
      <LegendeFamilles items={places} />

      {fonds.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-lg bg-white/90 px-3 py-1.5 text-xs text-gray-600 shadow dark:bg-gray-800/90 dark:text-gray-300">
            <Layers className="mr-1 inline h-3 w-3" />
            Aucun fond de carte n’est disponible sur ce serveur.
          </span>
        </div>
      )}
    </div>
  )
}

/** Les familles présentes sur la carte, et elles seules. */
function LegendeFamilles({ items }: { items: Implantation[] }) {
  const familles = useMemo(() => {
    const vues = new Map<string, { icone: string; libelle: string; couleur: string; n: number }>()
    for (const item of items) {
      const f = familleExemplaire(item)
      const deja = vues.get(f.valeur)
      if (deja) deja.n += 1
      else vues.set(f.valeur, { icone: f.icone, libelle: f.libelle, couleur: f.couleur, n: 1 })
    }
    return [...vues.values()].sort((a, b) => b.n - a.n)
  }, [items])

  if (familles.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-[calc(100%-5rem)]">
      <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/90 px-3 py-2 text-xs shadow backdrop-blur dark:bg-gray-800/90">
        {familles.map((f) => (
          <span key={f.libelle} className="flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
              style={{ background: f.couleur }}
            >
              {f.icone}
            </span>
            {f.libelle}
            <span className="text-gray-500 dark:text-gray-400">({f.n})</span>
          </span>
        ))}
      </div>
    </div>
  )
}
