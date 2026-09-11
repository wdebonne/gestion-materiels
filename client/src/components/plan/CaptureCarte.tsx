import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { Map as CarteLeaflet } from 'leaflet'
import { Camera, Crop, Crosshair, Info, Search } from 'lucide-react'
import { Modal, ModalBody, ModalFooter, Button, Spinner } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import 'leaflet/dist/leaflet.css'
import type { ContourPropose } from './types'

/**
 * Fabriquer le plan d'un espace vert en cadrant une carte.
 *
 * Avant cet écran, obtenir un plan annotable demandait de sortir de
 * l'application : trouver une vue aérienne ailleurs, la capturer à l'écran, la
 * recadrer, l'envoyer en pièce jointe, puis la calibrer en traçant un segment
 * sur une longueur qu'on croyait connaître. Cinq étapes, dont deux qu'un
 * jardinier n'a aucune raison de savoir faire, et un calibrage approximatif qui
 * se répercutait sur toutes les surfaces et tous les coûts.
 *
 * Ici, il n'y a qu'un geste : cadrer le parc, puis « Utiliser cette vue ».
 * L'échelle n'est pas demandée — elle se déduit du zoom et de la latitude, que
 * la carte connaît exactement.
 */

export interface FondCarte {
  cle: string
  libelle: string
  /** Deux ou trois lettres, pour la barre du plan où la place est comptée. */
  court: string
  description: string
  modele: string
  attribution: string
  zoomMax: number
}

/** Ce que le serveur accepte d'assembler. Publié par lui, jamais recopié ici. */
interface LimitesCapture {
  coteMin: number
  coteMax: number
  tuilesMax: number
  zoomMin: number
  tailleTuile: number
}

/**
 * Ce qu'une capture regarde : centre, zoom, dimensions, fond.
 *
 * Mémorisé sur l'espace vert, c'est lui qui permet ensuite de changer de fond
 * à cadre identique, ou de recadrer en retraduisant ce qui est posé.
 */
export interface CadragePlan {
  lat: number
  lng: number
  zoom: number
  largeur: number
  hauteur: number
  fond?: string
}

export interface ResultatCapture {
  /** L'espace vert mis à jour — `null` à la création, où il n'existe pas encore. */
  espace: any | null
  /** Le plan produit : de quoi remplir une fiche qui n'est pas encore enregistrée. */
  plan: { url: string; metresParPourcent: number; ratio: number }
  largeurMetres: number
  trous: number
  /** Le cadrage retenu, pour aller chercher les contours sur la même vue. */
  cadrage: CadragePlan
}

interface Props {
  /**
   * L'espace vert auquel rattacher le plan.
   *
   * Absent à la création : l'espace n'existe pas encore, le plan est fabriqué
   * puis rendu à l'appelant, qui l'enregistrera avec le reste de la fiche.
   */
  espaceId?: number
  nom: string
  /** Position connue de l'espace vert : la carte s'y ouvre directement. */
  latitude?: number | null
  longitude?: number | null
  adresse?: string | null
  /** Un plan est déjà en place : le remplacer se dit avant, pas après. */
  planExistant?: boolean
  /**
   * Le cadrage du plan actuel, quand il vient déjà de la carte.
   *
   * La fenêtre s'ouvre dessus plutôt que sur la position de l'espace vert :
   * recadrer, c'est partir de ce qu'on voit pour le resserrer, pas retrouver
   * l'endroit à la main.
   */
  cadrageActuel?: CadragePlan | null
  /** Emprise de ce qui est posé, en pourcentages du plan actuel. */
  empriseContenu?: { minX: number; minY: number; maxX: number; maxY: number } | null
  onFermer: () => void
  onCapture: (resultat: ResultatCapture) => void
}

/**
 * Web Mercator, le strict nécessaire côté navigateur.
 *
 * Le serveur porte la même chose et fait foi ; ces quelques lignes servent à
 * dire ce que le cadre représente pendant qu'on le déplace, et à retrouver sur
 * la carte l'emprise de ce qui est déjà posé sur le plan. Les recopier vaut
 * mieux qu'un aller-retour réseau à chaque mouvement de souris.
 */
const TAILLE_TUILE = 256
const RESOLUTION_EQUATEUR = 156543.03392804097

const metresParPixel = (lat: number, zoom: number) =>
  (RESOLUTION_EQUATEUR * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom

const pixelX = (lng: number, zoom: number) => ((lng + 180) / 360) * TAILLE_TUILE * 2 ** zoom

const pixelY = (lat: number, zoom: number) => {
  const phi = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * TAILLE_TUILE * 2 ** zoom
}

const lngDepuisPixel = (px: number, zoom: number) => (px / (TAILLE_TUILE * 2 ** zoom)) * 360 - 180

const latDepuisPixel = (py: number, zoom: number) => {
  const n = Math.PI - (2 * Math.PI * py) / (TAILLE_TUILE * 2 ** zoom)
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

/**
 * Où se trouve, sur le globe, une portion du plan exprimée en pourcentages.
 *
 * C'est ce qui permet au bouton « Cadrer sur ce qui est posé » de viser le
 * massif plutôt que le quartier : l'emprise est connue en pourcentages de
 * l'image, le cadrage dit à quoi ces pourcentages correspondent.
 */
function empriseSurLaCarte(
  boite: { minX: number; minY: number; maxX: number; maxY: number },
  cadrage: CadragePlan
): [[number, number], [number, number]] {
  const gauche = pixelX(cadrage.lng, cadrage.zoom) - cadrage.largeur / 2
  const haut = pixelY(cadrage.lat, cadrage.zoom) - cadrage.hauteur / 2
  const x = (pourcent: number) => gauche + (pourcent / 100) * cadrage.largeur
  const y = (pourcent: number) => haut + (pourcent / 100) * cadrage.hauteur
  return [
    [latDepuisPixel(y(boite.maxY), cadrage.zoom), lngDepuisPixel(x(boite.minX), cadrage.zoom)],
    [latDepuisPixel(y(boite.minY), cadrage.zoom), lngDepuisPixel(x(boite.maxX), cadrage.zoom)],
  ]
}

/**
 * Les fonds proposés par le serveur, et ses limites d'assemblage.
 *
 * Exporté pour que la barre du plan et cette fenêtre partagent **la même**
 * requête, et non seulement la même clé de cache. Les deux écrans l'ont d'abord
 * écrite chacun de leur côté sous `['plan-fonds']` : l'un rendait le tableau
 * des fonds, l'autre l'objet entier. React Query ne garde qu'une valeur par
 * clé, celle du premier arrivé — et la fenêtre de recadrage annonçait
 * « aucun fond de carte n'est disponible sur ce serveur » sur un serveur qui
 * en proposait trois.
 */
export function useFondsPlan() {
  return useQuery<{ fonds: FondCarte[]; limites: LimitesCapture }>({
    queryKey: ['plan-fonds'],
    queryFn: () => api.get('/green-spaces/plan/fonds').then(r => r.data.data),
    staleTime: Infinity,
  })
}

/** Là où la carte s'ouvre quand l'espace vert n'a pas de position. */
const CENTRE_DEFAUT: [number, number] = [46.6, 2.5]
const ZOOM_DEFAUT_SANS_POSITION = 6
const ZOOM_DEFAUT = 18

export default function CaptureCarte({
  espaceId, nom, latitude, longitude, adresse, planExistant,
  cadrageActuel, empriseContenu, onFermer, onCapture,
}: Props) {
  /*
    `Number(null)` vaut 0, et `Number('')` aussi.

    Tester la seule finitude déclarait donc « position connue » pour un espace
    vert qui n'en a pas, et la carte s'ouvrait au zoom 18 sur le point (0, 0) —
    au large du golfe de Guinée, là où aucun fournisseur n'a d'imagerie. On
    voyait un carré gris et une trentaine de 404 dans la console, pour un champ
    simplement vide.
  */
  const coordonnee = (valeur: unknown): number | null => {
    if (valeur === null || valeur === undefined || valeur === '') return null
    const nombre = Number(valeur)
    return Number.isFinite(nombre) ? nombre : null
  }

  const lat = coordonnee(latitude)
  const lng = coordonnee(longitude)
  const positionConnue = lat !== null && lng !== null

  // Le cadrage en cours prime sur la position de l'espace vert : on recadre ce
  // qu'on regarde, on ne recommence pas de zéro.
  const centreInitial: [number, number] = cadrageActuel
    ? [cadrageActuel.lat, cadrageActuel.lng]
    : lat !== null && lng !== null
    ? [lat, lng]
    : CENTRE_DEFAUT
  const zoomInitial = cadrageActuel
    ? cadrageActuel.zoom
    : positionConnue
    ? ZOOM_DEFAUT
    : ZOOM_DEFAUT_SANS_POSITION

  const carteRef = useRef<CarteLeaflet | null>(null)
  const [cleFond, setCleFond] = useState(cadrageActuel?.fond ?? 'photo')
  const [zoom, setZoom] = useState(zoomInitial)
  const [centre, setCentre] = useState<[number, number]>(centreInitial)
  const [taille, setTaille] = useState({ largeur: 0, hauteur: 0 })
  const [recherche, setRecherche] = useState('')
  /** Ce que le serveur refuse de couper, quand il refuse. */
  const [ampute, setAmpute] = useState<string[] | null>(null)

  const { data: reglages, isLoading: fondsEnCours } = useFondsPlan()

  const fonds = reglages?.fonds ?? []
  const limites = reglages?.limites ?? null
  const fond = fonds.find(f => f.cle === cleFond) ?? fonds[0] ?? null

  /**
   * Ce que le serveur va assembler.
   *
   * Le terrain cadré est toujours exactement celui qu'on voit ; seule sa
   * finesse varie. Descendre d'un niveau de zoom double les pixels sur le même
   * terrain — le plan s'imprime et se zoome ensuite, et une image au ras de
   * l'écran devient illisible dès qu'on l'agrandit.
   *
   * La finesse la plus haute que le serveur accepte est retenue, sans rien
   * demander à personne. La première version prenait le doublement dès que le
   * fond le permettait : sur un écran large, cela réclamait près de 2800 pixels
   * et le serveur refusait la capture, après le clic, pour une raison que
   * l'utilisateur n'avait aucun moyen de relier à la largeur de sa fenêtre.
   */
  const cadrage = useMemo(() => {
    if (!fond || !limites || taille.largeur === 0) return null

    const tient = (largeur: number, hauteur: number) => {
      if (largeur > limites.coteMax || hauteur > limites.coteMax) return false
      if (largeur < limites.coteMin || hauteur < limites.coteMin) return false
      const tuiles =
        (Math.ceil(largeur / limites.tailleTuile) + 1) * (Math.ceil(hauteur / limites.tailleTuile) + 1)
      return tuiles <= limites.tuilesMax
    }

    // Du plus net au plus grossier : +1 double les pixels, -1 les divise.
    for (const decalage of [1, 0, -1]) {
      const zoomVise = zoom + decalage
      if (zoomVise > fond.zoomMax || zoomVise < limites.zoomMin) continue
      const facteur = 2 ** decalage
      const largeur = Math.round(taille.largeur * facteur)
      const hauteur = Math.round(taille.hauteur * facteur)
      if (tient(largeur, hauteur)) {
        return { lat: centre[0], lng: centre[1], zoom: zoomVise, largeur, hauteur }
      }
    }
    return null
  }, [fond, limites, centre, zoom, taille])

  /** Largeur réelle de ce qui est cadré, la seule mesure qui parle à tout le monde. */
  const largeurMetres = useMemo(
    () => (cadrage ? metresParPixel(cadrage.lat, cadrage.zoom) * cadrage.largeur : null),
    [cadrage]
  )

  const capture = useMutation({
    mutationFn: async () => {
      if (!cadrage || !fond) throw new Error('La carte n’est pas prête')
      setAmpute(null)
      // Sans espace vert, la capture ne touche à aucune ligne : elle rend
      // simplement l'image et son échelle, que la fiche enregistrera.
      const url = espaceId ? `/green-spaces/${espaceId}/plan/capture` : '/green-spaces/plan/capture'
      const reponse = await api.post(url, { ...cadrage, fond: fond.cle })
      return reponse.data.data
    },
    onSuccess: (data: any) => {
      toast.success(
        data.deplaces > 0
          ? `Plan recadré — ${data.deplaces} objet${data.deplaces > 1 ? 's' : ''} replacé${data.deplaces > 1 ? 's' : ''}`
          : 'Plan créé et calibré depuis la carte'
      )
      onCapture({
        espace: data.espace ?? null,
        plan: {
          url: data.capture.url,
          metresParPourcent: data.capture.metresParPourcent,
          ratio: data.capture.ratio,
        },
        largeurMetres: data.capture.largeurMetres,
        trous: data.capture.trous,
        cadrage: cadrage!,
      })
    },
    onError: (erreur: any) => {
      // Le serveur refuse un cadrage qui couperait un contour : rogner lui
      // laisserait une forme plausible et une surface fausse. La liste de ce
      // qui dépasse vaut mieux qu'un message générique.
      const dehors = erreur?.response?.data?.data?.ampute
      if (Array.isArray(dehors) && dehors.length > 0) setAmpute(dehors)
    },
  })

  /**
   * Recherche d'adresse.
   *
   * Le chemin normal est la position déjà enregistrée sur l'espace vert. Mais
   * un rond-point créé à la va-vite n'en a pas, et « Modifiez l'espace vert pour
   * ajouter latitude et longitude » est un cul-de-sac pour qui veut juste son
   * plan. La recherche n'est lancée qu'à la validation, jamais à la frappe :
   * le service de Nominatim est gratuit et demande qu'on l'économise.
   */
  const chercher = useMutation({
    mutationFn: async (texte: string) => {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(texte)
      const reponse = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!reponse.ok) throw new Error('La recherche d’adresse n’a pas répondu')
      const resultats = await reponse.json()
      if (!Array.isArray(resultats) || resultats.length === 0) throw new Error('Adresse introuvable')
      return { lat: Number(resultats[0].lat), lng: Number(resultats[0].lon) }
    },
    onSuccess: ({ lat, lng }) => carteRef.current?.setView([lat, lng], ZOOM_DEFAUT),
    onError: (erreur: any) => toast.error(erreur?.message ?? 'Adresse introuvable'),
  })

  return (
    <Modal
      isOpen
      onClose={onFermer}
      title={cadrageActuel ? `Recadrer le plan de « ${nom} »` : `Plan de « ${nom} » depuis la carte`}
      size="full"
    >
      <ModalBody>
        {fondsEnCours ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !fond ? (
          <p className="py-16 text-center text-gray-500 dark:text-gray-400">
            Aucun fond de carte n’est disponible sur ce serveur.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Choix du fond : trois boutons nommés, pas une liste déroulante. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
                {fonds.map(f => (
                  <button
                    key={f.cle}
                    type="button"
                    onClick={() => setCleFond(f.cle)}
                    aria-pressed={f.cle === fond.cle}
                    title={f.description}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors min-h-[38px] ${
                      f.cle === fond.cle
                        ? 'bg-green-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {f.libelle}
                  </button>
                ))}
              </div>

              <form
                className="flex items-center gap-1.5 flex-1 min-w-[220px]"
                onSubmit={(e) => { e.preventDefault(); if (recherche.trim()) chercher.mutate(recherche.trim()) }}
              >
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder={adresse || 'Chercher une adresse, une commune…'}
                    aria-label="Chercher une adresse"
                    className="w-full min-h-[38px] rounded-lg border border-gray-300 bg-white pl-8 pr-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <Button type="submit" size="sm" variant="secondary" loading={chercher.isPending}>
                  Aller
                </Button>
                {/*
                  Le geste central du recadrage : le plan couvre six cents
                  mètres de ville pour un massif de six cents mètres carrés, et
                  c'est sur le massif qu'il faut cadrer. La carte se cale sur
                  l'emprise de ce qui est posé, avec un peu d'air autour.
                */}
                {cadrageActuel && empriseContenu && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={<Crop className="h-4 w-4" />}
                    onClick={() =>
                      carteRef.current?.fitBounds(empriseSurLaCarte(empriseContenu, cadrageActuel), {
                        padding: [40, 40],
                      })
                    }
                    title="Cadrer la carte sur ce qui est posé sur le plan"
                  >
                    Cadrer sur le posé
                  </Button>
                )}
                {positionConnue && !cadrageActuel && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={<Crosshair className="h-4 w-4" />}
                    onClick={() => carteRef.current?.setView(centreInitial, ZOOM_DEFAUT)}
                    title="Revenir sur l’espace vert"
                  >
                    Recentrer
                  </Button>
                )}
              </form>
            </div>

            {/*
              Le cadre EST la carte : ce qu'on voit est exactement ce qui sera
              capturé. Un rectangle de sélection à dessiner par-dessus aurait
              ajouté un geste à comprendre, pour le même résultat.
            */}
            <div className="relative rounded-xl overflow-hidden border-2 border-green-600 dark:border-green-500">
              <MapContainer
                center={centreInitial}
                zoom={positionConnue ? ZOOM_DEFAUT : ZOOM_DEFAUT_SANS_POSITION}
                maxZoom={fond.zoomMax}
                scrollWheelZoom
                style={{ height: 'min(58vh, 520px)', width: '100%' }}
                ref={(instance) => { carteRef.current = instance }}
              >
                <TileLayer url={fond.modele} attribution={fond.attribution} maxZoom={fond.zoomMax} />
                <SuiviCadre onChange={(c, z, t) => { setCentre(c); setZoom(z); setTaille(t) }} />
              </MapContainer>

              {/*
                Mire centrale. Dessinée en blanc cerné de noir plutôt qu'en
                blanc translucide : sur une photo aérienne claire — un parking,
                un toit, une allée de gravier — un simple anneau blanc
                disparaissait complètement, et on ne savait plus ce qu'on
                centrait.

                Le `z-[750]` n'est pas décoratif : les calques internes de
                Leaflet portent des z-index de 200 à 700, si bien qu'un
                survol posé sans z-index passe **sous** les tuiles et ne
                s'affiche jamais. 750 le met au-dessus de la carte, et sous les
                commandes de zoom (1000).
              */}
              <div className="pointer-events-none absolute inset-0 z-[750] flex items-center justify-center">
                <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
                  <g fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round">
                    <circle cx="23" cy="23" r="9" />
                    <path d="M23 2v8M23 36v8M2 23h8M36 23h8" />
                  </g>
                  <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                    <circle cx="23" cy="23" r="9" />
                    <path d="M23 2v8M23 36v8M2 23h8M36 23h8" />
                  </g>
                </svg>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <Info className="h-4 w-4 flex-shrink-0" />
                {largeurMetres !== null ? (
                  <span>
                    Le cadre représente <strong>{Math.round(largeurMetres)} m</strong> de large.
                    L’échelle sera calculée toute seule : rien à mesurer.
                  </span>
                ) : (
                  <span>Déplacez la carte pour cadrer l’espace vert.</span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{fond.attribution}</p>
            </div>

            {/*
              Le message a d'abord dit de « vérifier que les repères retombent
              au bon endroit ». Ce n'est plus vrai depuis que le cadrage est
              mémorisé : le serveur retraduit les coordonnées d'un cadre à
              l'autre, et ce qui est posé reste sur le même terrain. Laisser
              l'ancien avertissement ferait douter d'un travail juste.
            */}
            {planExistant && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-900/30 dark:text-blue-100">
                {cadrageActuel
                  ? 'Le plan actuel sera remplacé. Les repères et les zones déjà posés sont replacés automatiquement au même endroit sur le terrain, et leurs surfaces ne changent pas.'
                  : 'Le plan actuel sera remplacé, ainsi que son calibrage. Ce plan n’ayant pas été fabriqué depuis la carte, les repères et les zones déjà posés gardent leurs coordonnées en pourcentages : vérifiez qu’ils retombent au bon endroit.'}
              </p>
            )}

            {ampute && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                <p className="font-medium">Ce cadrage couperait ce qui est déjà posé.</p>
                <p className="mt-1">
                  Un contour rogné garderait une forme plausible avec une surface fausse — donc une
                  quantité fausse, et un coût faux. Élargissez le cadre, ou retirez ces objets du
                  plan avant de recadrer :
                </p>
                <ul className="mt-1.5 list-inside list-disc">
                  {ampute.slice(0, 8).map((nom, i) => <li key={i}>{nom}</li>)}
                  {ampute.length > 8 && <li>… et {ampute.length - 8} autre(s)</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onFermer} disabled={capture.isPending}>Annuler</Button>
        <Button
          icon={<Camera className="h-4 w-4" />}
          onClick={() => capture.mutate()}
          disabled={!cadrage || capture.isPending}
          loading={capture.isPending}
        >
          {capture.isPending
            ? 'Assemblage de la carte…'
            : cadrageActuel
            ? 'Utiliser ce cadrage'
            : 'Utiliser cette vue comme plan'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/**
 * Tient le cadrage à jour pendant qu'on déplace la carte.
 *
 * La taille est relue à chaque mouvement et non une fois au montage : la
 * fenêtre se redimensionne, et une capture demandée aux anciennes dimensions
 * ne correspondrait plus à ce qui est affiché.
 */
function SuiviCadre({
  onChange,
}: {
  onChange: (centre: [number, number], zoom: number, taille: { largeur: number; hauteur: number }) => void
}) {
  const carte = useMap()

  const rapporter = () => {
    const centre = carte.getCenter()
    const taille = carte.getSize()
    onChange([centre.lat, centre.lng], carte.getZoom(), { largeur: taille.x, hauteur: taille.y })
  }

  useMapEvents({ moveend: rapporter, zoomend: rapporter, resize: rapporter })

  // Le premier rapport ne vient d'aucun événement : sans lui, le bouton de
  // capture resterait désactivé tant qu'on n'a pas bougé la carte.
  useEffect(() => {
    // La carte se dimensionne après l'ouverture de la fenêtre modale ; sans ce
    // recalcul, Leaflet garde une taille nulle et n'affiche aucune tuile.
    carte.invalidateSize()
    rapporter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

/**
 * L'adresse la plus proche d'un point, selon OpenStreetMap.
 *
 * Rend une chaîne vide plutôt qu'une erreur : une adresse absente n'empêche
 * rien, et un rond-point ou une berge n'en a souvent aucune. Appelée une fois
 * par capture, jamais en boucle — Nominatim est gratuit et demande qu'on
 * l'économise.
 */
export async function adresseDuPoint(lat: number, lng: number): Promise<string> {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18'
      + `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`
    const reponse = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!reponse.ok) return ''
    const lu = await reponse.json()
    const a = lu?.address
    if (!a) return String(lu?.display_name ?? '')

    // Une adresse française lisible plutôt que le `display_name` complet, qui
    // empile le département, la région et le pays.
    const voie = [a.house_number, a.road].filter(Boolean).join(' ')
    const commune = a.village ?? a.town ?? a.city ?? a.municipality ?? ''
    return [voie, a.postcode, commune].filter(Boolean).join(', ')
  } catch {
    return ''
  }
}

/**
 * Interroge OpenStreetMap sur ce que le cadre capturé contient.
 *
 * Ne prend pas d'espace vert : la question ne porte que sur un rectangle du
 * globe, et elle se pose aussi bien à la création, avant qu'aucune fiche
 * n'existe.
 */
export async function chercherContours(
  cadrage: ResultatCapture['cadrage']
): Promise<{ etat: 'ok'; contours: ContourPropose[] } | { etat: 'indisponible' }> {
  try {
    const reponse = await api.post('/green-spaces/plan/contour', cadrage)
    return reponse.data.data
  } catch {
    return { etat: 'indisponible' }
  }
}
