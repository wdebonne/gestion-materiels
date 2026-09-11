import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { FileDown, Layers, MapPin, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardBody, LoadingInline } from '@/components/ui'
import CarteMobilier from '@/components/carto/CarteMobilier'
import FiltresMobilierPanneau from '@/components/carto/FiltresMobilier'
import FicheMobilier from '@/components/carto/FicheMobilier'
import PoserMobilier, { type PositionPose } from '@/components/carto/PoserMobilier'
import ExportMobilierPDF from '@/components/carto/ExportMobilierPDF'
import {
  mobilierUrbainApi,
  type FiltresMobilier,
  type MobilierUrbain,
  type ModelePosable,
} from '@/lib/api'
import { alerteDe, etat, familleExemplaire, jour, nomComplet, statut } from '@/lib/mobilierUrbain'
import { useGeolocation } from '@/lib/useGeolocation'

/**
 * Cartographie du domaine public.
 *
 * L'écran d'avant affichait une carte vide et, à côté, la liste des matériels
 * dont le champ « Lieu » n'était pas vide — avec un commentaire dans le code
 * expliquant qu'il faudrait un jour géocoder les adresses. Il ne répondait donc
 * à aucune des trois questions qu'une commune se pose sur sa voirie : **où**
 * est ce mobilier, **dans quel état**, et **qu'a-t-on fait dessus**.
 *
 * La bascule n'est pas graphique, elle est dans le modèle : la carte ne montre
 * plus des **matériels du parc**, elle montre des **exemplaires posés**. Un
 * banc acheté en série reste une ligne au catalogue, et devient vingt-trois
 * points ici — chacun avec sa rue, son état et son historique. C'est ce qui
 * permet de dire « le banc 23 a été repeint » sans avoir créé vingt-trois
 * fiches identiques dans le parc.
 *
 * Cette page n'est qu'un chef d'orchestre : la carte, les filtres, la fiche, la
 * pose et l'export sont autant de composants qui ignorent tout les uns des
 * autres. Elle tient l'état partagé — ce qui est filtré, ce qui est
 * sélectionné, ce qui est en cours de pose — et rien d'autre.
 */

/** Le fond choisi survit à la navigation : personne n'aime le reprendre. */
const CLEF_FOND = 'carto.fond'

export default function MapPage() {
  const queryClient = useQueryClient()
  const [parametres, setParametres] = useSearchParams()
  const carteRef = useRef<HTMLDivElement>(null)
  const { getPosition, loading: localisation } = useGeolocation()

  const [filtres, setFiltres] = useState<FiltresMobilier>(() => {
    // Un lien « voir les bancs sur la carte » doit ouvrir sur les bancs : le
    // filtre par modèle se lit de l'adresse, et c'est ce qui relie la fiche
    // d'un matériel du parc à ses exemplaires.
    const objet = parametres.get('materiel')
    return objet ? { object_id: objet } : {}
  })
  const [recherche, setRecherche] = useState(filtres.q ?? '')
  const [cleFond, setCleFond] = useState(() => localStorage.getItem(CLEF_FOND) ?? 'photo')
  const [selection, setSelection] = useState<MobilierUrbain | null>(null)
  const [maPosition, setMaPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    null
  )
  const [exportOuvert, setExportOuvert] = useState(false)
  const [deplacement, setDeplacement] = useState<MobilierUrbain | null>(null)
  const [pose, setPose] = useState<{
    modele: ModelePosable | null
    position: PositionPose | null
    pointage: boolean
  } | null>(null)

  /**
   * La frappe ne part pas au serveur lettre par lettre.
   *
   * Sur un inventaire de mille points, chaque frappe relancerait une requête et
   * un redessin complet de la carte : la liste clignote, et les marqueurs
   * sautent sous le doigt.
   */
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setFiltres((actuels) => (actuels.q === recherche ? actuels : { ...actuels, q: recherche }))
    }, 300)
    return () => clearTimeout(minuteur)
  }, [recherche])

  useEffect(() => {
    localStorage.setItem(CLEF_FOND, cleFond)
  }, [cleFond])

  const { data: fonds = [] } = useQuery({
    queryKey: ['carto-fonds'],
    queryFn: async () => (await mobilierUrbainApi.fonds()).data.data,
    staleTime: Infinity,
  })

  const { data: facettes } = useQuery({
    queryKey: ['mobilier-facettes'],
    queryFn: async () => (await mobilierUrbainApi.facettes()).data.data,
  })

  const { data: stats } = useQuery({
    queryKey: ['mobilier-stats'],
    queryFn: async () => (await mobilierUrbainApi.stats()).data.data,
  })

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['mobilier', filtres],
    queryFn: async () => (await mobilierUrbainApi.lister(filtres)).data.data,
  })

  /**
   * Un lien qui désigne un exemplaire l'ouvre.
   *
   * C'est ce qui relie la fiche d'un matériel du parc à un point précis : « le
   * banc 23 » cliqué depuis l'onglet « Sur la voie publique » doit arriver sur
   * sa fiche, pas sur une carte où il reste à le retrouver. Le paramètre est
   * consommé une fois, sinon rouvrir la fiche qu'on vient de fermer serait
   * impossible.
   */
  const cible = parametres.get('mobilier')
  useEffect(() => {
    if (!cible) return
    const trouve = items.find((item) => String(item.id) === cible)
    if (!trouve) return
    setSelection(trouve)
    const suivants = new URLSearchParams(parametres)
    suivants.delete('mobilier')
    setParametres(suivants, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible, items])

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['mobilier'] })
    queryClient.invalidateQueries({ queryKey: ['mobilier-facettes'] })
    queryClient.invalidateQueries({ queryKey: ['mobilier-stats'] })
    queryClient.invalidateQueries({ queryKey: ['mobilier-catalogue'] })
  }

  /** Déplacer : le prochain clic sur la carte devient la nouvelle position. */
  const deplacer = useMutation({
    mutationFn: ({ item, lat, lng }: { item: MobilierUrbain; lat: number; lng: number }) =>
      mobilierUrbainApi.modifier(item.id, {
        latitude: lat,
        longitude: lng,
        position_source: 'carte',
        position_accuracy: null,
      }),
    onSuccess: (reponse) => {
      toast.success('Position mise à jour')
      setSelection(reponse.data.data)
      queryClient.invalidateQueries({ queryKey: ['mobilier', reponse.data.data.id] })
      rafraichir()
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Déplacement impossible'),
  })

  const relever = async () => {
    try {
      const position = await getPosition()
      setMaPosition(position)
      return position
    } catch (erreur: any) {
      toast.error(erreur?.message ?? 'Position indisponible')
      return null
    }
  }

  /** Un clic sur la carte : soit il pose, soit il déplace, soit il ne fait rien. */
  const clicCarte = (lat: number, lng: number) => {
    if (deplacement) {
      deplacer.mutate({ item: deplacement, lat, lng })
      setDeplacement(null)
      return
    }
    if (pose?.pointage) {
      setPose({ ...pose, position: { lat, lng, source: 'carte' }, pointage: false })
    }
  }

  const modePose = Boolean(pose?.pointage || deplacement)

  // Le point provisoire est ce qu'on est en train de poser : il n'existe pas
  // encore en base, mais on doit le voir pour juger s'il tombe au bon endroit.
  const pointProvisoire = pose?.position
    ? { lat: pose.position.lat, lng: pose.position.lng }
    : null

  const modeleFiltre = useMemo(
    () => facettes?.modeles.find((m) => String(m.id) === filtres.object_id),
    [facettes, filtres.object_id]
  )

  return (
    <div className="space-y-4">
      {/* Titre et actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <MapPin className="h-7 w-7 text-primary-600" />
            Cartographie
          </h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Le mobilier de la voie publique, exemplaire par exemplaire
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExportOuvert(true)}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <FileDown className="h-4 w-4" />
            Exporter en PDF
          </button>
          <button
            type="button"
            onClick={() => setPose({ modele: null, position: null, pointage: false })}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Poser un matériel
          </button>
        </div>
      </div>

      {/* Ce que porte la commune, en six nombres */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Chiffre valeur={stats.total} libelle="Mobiliers posés" />
          <Chiffre valeur={stats.modeles} libelle="Modèles différents" />
          <Chiffre valeur={stats.rues} libelle="Rues concernées" />
          <Chiffre valeur={stats.en_service} libelle="En service" ton="vert" />
          <Chiffre valeur={stats.a_revoir} libelle="À reprendre" ton="orange" />
          <Chiffre valeur={stats.en_retard} libelle="Entretien en retard" ton="rouge" />
        </div>
      )}

      {/* Filtres */}
      <Card>
        <CardBody>
          <FiltresMobilierPanneau
            filtres={{ ...filtres, q: recherche }}
            onChange={(nouveaux) => {
              setRecherche(nouveaux.q ?? '')
              setFiltres(nouveaux)
              // L'adresse suit le filtre par modèle : la page reste partageable.
              const suivants = new URLSearchParams(parametres)
              if (nouveaux.object_id) suivants.set('materiel', nouveaux.object_id)
              else suivants.delete('materiel')
              setParametres(suivants, { replace: true })
            }}
            facettes={facettes}
            maPosition={maPosition}
            onRelever={relever}
            resultats={items.length}
          />
        </CardBody>
      </Card>

      {/* Bandeau de pose ou de déplacement : la carte attend un clic, et le dit. */}
      {modePose && (
        <div className="flex items-center gap-3 rounded-lg border border-primary-300 bg-primary-50 px-4 py-3 text-sm dark:border-primary-700 dark:bg-primary-900/30">
          <MapPin className="h-5 w-5 flex-shrink-0 text-primary-600 dark:text-primary-400" />
          <p className="flex-1 text-primary-900 dark:text-primary-100">
            {deplacement
              ? `Cliquez sur la nouvelle position de « ${nomComplet(deplacement)} ».`
              : `Cliquez sur la carte pour poser « ${pose?.modele?.name} ».`}
          </p>
          <button
            type="button"
            onClick={() => {
              if (deplacement) setDeplacement(null)
              else setPose(pose ? { ...pose, pointage: false } : null)
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-800/50"
          >
            <X className="h-4 w-4" />
            Annuler
          </button>
        </div>
      )}

      {/* Carte et panneau latéral */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardBody className="overflow-hidden rounded-lg p-0">
              <CarteMobilier
                items={items}
                fonds={fonds}
                cleFond={cleFond}
                onFond={setCleFond}
                selectionId={selection?.id ?? null}
                onSelection={(item) => setSelection(item)}
                modePose={modePose}
                onPointPose={clicCarte}
                pointProvisoire={pointProvisoire}
                maPosition={maPosition}
                onRelever={relever}
                captureRef={carteRef}
                hauteur="62vh"
              />
            </CardBody>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            {selection ? (
              <div className="h-full max-h-[calc(62vh+2rem)] overflow-hidden">
                <FicheMobilier
                  itemId={selection.id}
                  apercu={selection}
                  onFermer={() => setSelection(null)}
                  onDeplacer={(item) => {
                    setDeplacement(item)
                    setSelection(null)
                  }}
                  onSupprime={rafraichir}
                />
              </div>
            ) : (
              <CardBody className="p-0">
                <ListeMobilier
                  items={items}
                  isLoading={isLoading}
                  onSelection={setSelection}
                  filtre={modeleFiltre?.nom}
                  localisationEnCours={localisation}
                />
              </CardBody>
            )}
          </Card>
        </div>
      </div>

      {/* La pose : une fenêtre, sauf pendant le pointage où la carte reprend la main. */}
      {pose && !pose.pointage && (
        <PoserMobilier
          modele={pose.modele}
          position={pose.position}
          onModele={(modele) => setPose({ ...pose, modele, position: null })}
          onPosition={(position) => setPose({ ...pose, position })}
          onPointerSurCarte={() => setPose({ ...pose, pointage: true })}
          onFermer={() => setPose(null)}
          onPose={(item, encore) => {
            rafraichir()
            if (encore && pose.modele) {
              // On enchaîne : même modèle, compteur avancé d'un cran, et la
              // carte redemande un point. Vingt-trois bancs se posent ainsi.
              setPose({
                modele: { ...pose.modele, poses: pose.modele.poses + 1 },
                position: null,
                pointage: false,
              })
            } else {
              setPose(null)
              setSelection(item)
            }
          }}
        />
      )}

      {exportOuvert && (
        <ExportMobilierPDF
          filtres={filtres}
          carteRef={carteRef}
          onFermer={() => setExportOuvert(false)}
        />
      )}
    </div>
  )
}

function Chiffre({
  valeur,
  libelle,
  ton = 'neutre',
}: {
  valeur: number
  libelle: string
  ton?: 'neutre' | 'vert' | 'orange' | 'rouge'
}) {
  const couleurs = {
    neutre: 'text-gray-900 dark:text-gray-100',
    vert: 'text-green-600 dark:text-green-400',
    orange: 'text-orange-600 dark:text-orange-400',
    rouge: 'text-red-600 dark:text-red-400',
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800">
      <p className={`text-xl font-bold ${couleurs[ton]}`}>{valeur}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{libelle}</p>
    </div>
  )
}

/**
 * La liste de ce que la carte affiche.
 *
 * Elle n'est pas un doublon de la carte : un point se pointe mal du doigt sur
 * un téléphone, et une liste se parcourt. Surtout, elle trie par distance quand
 * « autour de moi » est actif — ce qui fait d'elle la vraie feuille de tournée.
 */
function ListeMobilier({
  items,
  isLoading,
  onSelection,
  filtre,
  localisationEnCours,
}: {
  items: MobilierUrbain[]
  isLoading: boolean
  onSelection: (item: MobilierUrbain) => void
  filtre?: string
  localisationEnCours?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
        <Layers className="h-4 w-4 text-gray-500" />
        <h3 className="flex-1 font-semibold text-gray-900 dark:text-gray-100">
          {filtre ? filtre : 'Mobilier affiché'}
          <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">
            ({items.length})
          </span>
        </h3>
        {localisationEnCours && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        )}
      </div>

      {isLoading ? (
        <div className="py-10">
          <LoadingInline />
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <MapPin className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Rien ici avec ces critères.
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            « Poser un matériel » ajoute un premier exemplaire depuis le catalogue du parc.
          </p>
        </div>
      ) : (
        <ul className="max-h-[calc(62vh-3.5rem)] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700">
          {items.map((item) => {
            const famille = familleExemplaire(item)
            const alerte = alerteDe(item)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelection(item)}
                  className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-base"
                    style={{ background: `${famille.couleur}22` }}
                  >
                    {famille.icone}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {nomComplet(item)}
                      </span>
                      {alerte && (
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ background: alerte.couleur }}
                          title={alerte.motif}
                        />
                      )}
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                      {item.street || item.address || 'Sans adresse'}
                      {item.distance_m !== undefined ? ` · à ${item.distance_m} m` : ''}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statut(item.status).pastille}`}
                      >
                        {statut(item.status).libelle}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${etat(item.condition_state).pastille}`}
                      >
                        {etat(item.condition_state).libelle}
                      </span>
                      {item.next_intervention_date && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                          à revoir le {jour(item.next_intervention_date)}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
