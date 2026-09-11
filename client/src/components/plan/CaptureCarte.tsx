import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { Map as CarteLeaflet } from 'leaflet'
import { Camera, Crosshair, Info, Search } from 'lucide-react'
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

interface FondCarte {
  cle: string
  libelle: string
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

export interface ResultatCapture {
  /** L'espace vert mis à jour, plan et échelle compris. */
  espace: any
  largeurMetres: number
  trous: number
  /** Le cadrage retenu, pour aller chercher les contours sur la même vue. */
  cadrage: { lat: number; lng: number; zoom: number; largeur: number; hauteur: number }
}

interface Props {
  espaceId: number
  nom: string
  /** Position connue de l'espace vert : la carte s'y ouvre directement. */
  latitude?: number | null
  longitude?: number | null
  adresse?: string | null
  /** Un plan est déjà en place : le remplacer se dit avant, pas après. */
  planExistant?: boolean
  onFermer: () => void
  onCapture: (resultat: ResultatCapture) => void
}

/** Là où la carte s'ouvre quand l'espace vert n'a pas de position. */
const CENTRE_DEFAUT: [number, number] = [46.6, 2.5]
const ZOOM_DEFAUT_SANS_POSITION = 6
const ZOOM_DEFAUT = 18

export default function CaptureCarte({
  espaceId, nom, latitude, longitude, adresse, planExistant, onFermer, onCapture,
}: Props) {
  const positionConnue = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
  const centreInitial: [number, number] = positionConnue
    ? [Number(latitude), Number(longitude)]
    : CENTRE_DEFAUT

  const carteRef = useRef<CarteLeaflet | null>(null)
  const [cleFond, setCleFond] = useState('photo')
  const [zoom, setZoom] = useState(positionConnue ? ZOOM_DEFAUT : ZOOM_DEFAUT_SANS_POSITION)
  const [centre, setCentre] = useState<[number, number]>(centreInitial)
  const [taille, setTaille] = useState({ largeur: 0, hauteur: 0 })
  const [recherche, setRecherche] = useState('')

  const { data: reglages, isLoading: fondsEnCours } = useQuery<{ fonds: FondCarte[]; limites: LimitesCapture }>({
    queryKey: ['plan-fonds'],
    queryFn: () => api.get('/green-spaces/plan/fonds').then(r => r.data.data),
    staleTime: Infinity,
  })

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
  const largeurMetres = useMemo(() => {
    if (!cadrage) return null
    const mpp = (156543.03392804097 * Math.cos((cadrage.lat * Math.PI) / 180)) / 2 ** cadrage.zoom
    return mpp * cadrage.largeur
  }, [cadrage])

  const capture = useMutation({
    mutationFn: async () => {
      if (!cadrage || !fond) throw new Error('La carte n’est pas prête')
      const reponse = await api.post(`/green-spaces/${espaceId}/plan/capture`, { ...cadrage, fond: fond.cle })
      return reponse.data.data
    },
    onSuccess: (data: any) => {
      toast.success('Plan créé et calibré depuis la carte')
      onCapture({
        espace: data.espace,
        largeurMetres: data.capture.largeurMetres,
        trous: data.capture.trous,
        cadrage: cadrage!,
      })
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
    <Modal isOpen onClose={onFermer} title={`Plan de « ${nom} » depuis la carte`} size="full">
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
                {positionConnue && (
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

            {planExistant && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Un plan existe déjà pour cet espace vert. Il sera remplacé, ainsi que son
                calibrage. Les repères et les zones déjà posés restent en place — ils sont
                enregistrés en pourcentages du plan — mais vérifiez qu’ils retombent au bon
                endroit sur le nouveau fond.
              </p>
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
          {capture.isPending ? 'Assemblage de la carte…' : 'Utiliser cette vue comme plan'}
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

/** Interroge OpenStreetMap sur ce que le cadre capturé contient. */
export async function chercherContours(
  espaceId: number,
  cadrage: ResultatCapture['cadrage']
): Promise<{ etat: 'ok'; contours: ContourPropose[] } | { etat: 'indisponible' }> {
  try {
    const reponse = await api.post(`/green-spaces/${espaceId}/plan/contour`, cadrage)
    return reponse.data.data
  } catch {
    return { etat: 'indisponible' }
  }
}
