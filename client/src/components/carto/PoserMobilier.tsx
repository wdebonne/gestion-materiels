import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Crosshair,
  MapPin,
  Package,
  Pencil,
  Search,
  Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal, ModalBody, ModalFooter, Button, Spinner } from '@/components/ui'
import { mobilierUrbainApi, type ModelePosable, type MobilierUrbain } from '@/lib/api'
import { ETATS, STATUTS, familleDe } from '@/lib/mobilierUrbain'
import { releverAdresse } from '@/lib/geocodage'
import { useGeolocation, formatCoord } from '@/lib/useGeolocation'
import { getImageUrl } from '@/lib/espacesVerts'

/**
 * Poser un exemplaire sur la voie publique.
 *
 * Trois questions, dans l'ordre où le terrain les pose : **quoi**, **où**,
 * puis tout le reste. L'inverse — un formulaire complet où la position est un
 * champ parmi vingt — est ce qui fait qu'un relevé n'est jamais fait : devant
 * un candélabre, sous la pluie, personne ne remplit vingt champs.
 *
 * Le « quoi » vient du catalogue du parc, et de lui seul. C'est tout l'objet du
 * module : un modèle « Banc » au catalogue, et des exemplaires ici. La fenêtre
 * annonce donc, pour chaque modèle, **combien sont déjà posés** — et le numéro
 * que prendra celui-ci. Voir « 23 posés » répond du même coup à la question qui
 * fait créer vingt-trois fiches identiques : « l'ai-je déjà créé ? ».
 *
 * Le « où » a deux chemins, également légitimes : le doigt sur la carte, au
 * bureau, et le GPS de l'appareil, sur le trottoir. Aucun des deux n'est un
 * repli de l'autre.
 */

export interface PositionPose {
  lat: number
  lng: number
  source: 'carte' | 'gps' | 'saisie'
  accuracy?: number | null
}

interface Props {
  modele: ModelePosable | null
  position: PositionPose | null
  onModele: (modele: ModelePosable | null) => void
  onPosition: (position: PositionPose | null) => void
  /** Rend la main à la carte : le prochain clic vaudra la position. */
  onPointerSurCarte: () => void
  onFermer: () => void
  /** `encore` : on enchaîne sur un autre exemplaire du même modèle. */
  onPose: (item: MobilierUrbain, encore: boolean) => void
}

const CHAMP =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
const LIBELLE = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

export default function PoserMobilier({
  modele,
  position,
  onModele,
  onPosition,
  onPointerSurCarte,
  onFermer,
  onPose,
}: Props) {
  const etape: 'modele' | 'position' | 'details' = !modele
    ? 'modele'
    : !position
      ? 'position'
      : 'details'

  return (
    <Modal
      isOpen
      onClose={onFermer}
      title={
        etape === 'modele'
          ? 'Que posez-vous ?'
          : etape === 'position'
            ? `Où poser « ${modele?.name} » ?`
            : `Poser « ${modele?.name} »`
      }
      size="lg"
    >
      {etape === 'modele' && <ChoixModele onChoisir={onModele} />}
      {etape === 'position' && (
        <ChoixPosition
          modele={modele!}
          onRetour={() => onModele(null)}
          onPosition={onPosition}
          onPointerSurCarte={onPointerSurCarte}
        />
      )}
      {etape === 'details' && (
        <Details
          modele={modele!}
          position={position!}
          onRetour={() => onPosition(null)}
          onFermer={onFermer}
          onPose={onPose}
        />
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- 1. le quoi

function ChoixModele({ onChoisir }: { onChoisir: (modele: ModelePosable) => void }) {
  const [recherche, setRecherche] = useState('')

  const { data: modeles = [], isLoading } = useQuery({
    queryKey: ['mobilier-catalogue'],
    queryFn: async () => (await mobilierUrbainApi.catalogue()).data.data,
  })

  // Le filtrage est local : le catalogue de pose d'une commune tient en
  // quelques centaines de lignes, et une requête par frappe ferait clignoter
  // une liste qu'on parcourt des yeux.
  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return modeles
    return modeles.filter((m) =>
      [m.name, m.reference, m.category_name, m.subcategory_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(terme)
    )
  }, [modeles, recherche])

  // Groupés par catégorie : c'est la façon dont le parc est rangé, et celle
  // dont on cherche — « dans l'éclairage public, lequel ? ».
  const groupes = useMemo(() => {
    const parCategorie = new Map<string, ModelePosable[]>()
    for (const m of filtres) {
      const cle = m.category_name ?? 'Sans catégorie'
      if (!parCategorie.has(cle)) parCategorie.set(cle, [])
      parCategorie.get(cle)!.push(m)
    }
    return [...parCategorie.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [filtres])

  return (
    <ModalBody>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          autoFocus
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Candélabre, banc, corbeille…"
          className={`${CHAMP} pl-9`}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : modeles.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          Aucun matériel du parc n’est ouvert à la pose sur la voie publique.
          <br />
          <span className="text-xs">
            Un administrateur règle cela dans Paramètres → Cartographie.
          </span>
        </p>
      ) : filtres.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          Aucun matériel ne correspond à « {recherche} ».
        </p>
      ) : (
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {groupes.map(([categorie, lignes]) => (
            <div key={categorie}>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {categorie}
              </h4>
              <div className="space-y-1.5">
                {lignes.map((m) => {
                  const famille = familleDe(m.name, m.subcategory_name, m.category_name)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onChoisir(m)}
                      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-2.5 text-left transition-colors hover:border-primary-400 hover:bg-primary-50 dark:border-gray-700 dark:hover:border-primary-500 dark:hover:bg-primary-900/20"
                    >
                      <span
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-lg"
                        style={{ background: `${famille.couleur}22` }}
                      >
                        {famille.icone}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {m.name}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {[m.reference, m.subcategory_name].filter(Boolean).join(' · ') ||
                            famille.libelle}
                        </span>
                      </span>
                      {/* Le décompte est la réponse à « l'ai-je déjà créé ? ». */}
                      <span className="flex-shrink-0 text-right">
                        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {m.poses}
                        </span>
                        <span className="block text-[10px] uppercase text-gray-500 dark:text-gray-400">
                          posé{m.poses > 1 ? 's' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalBody>
  )
}

// ------------------------------------------------------------------ 2. le où

function ChoixPosition({
  modele,
  onRetour,
  onPosition,
  onPointerSurCarte,
}: {
  modele: ModelePosable
  onRetour: () => void
  onPosition: (position: PositionPose) => void
  onPointerSurCarte: () => void
}) {
  const { getPosition, loading, error, supported } = useGeolocation()
  const [saisie, setSaisie] = useState(false)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  const relever = async () => {
    try {
      const pos = await getPosition()
      onPosition({ lat: pos.lat, lng: pos.lng, source: 'gps', accuracy: pos.accuracy })
    } catch {
      // Le message est déjà porté par `error`.
    }
  }

  const valider = () => {
    const a = Number(lat)
    const b = Number(lng)
    if (!Number.isFinite(a) || !Number.isFinite(b) || lat === '' || lng === '') {
      toast.error('Coordonnées incomplètes')
      return
    }
    onPosition({ lat: a, lng: b, source: 'saisie' })
  }

  return (
    <>
      <ModalBody>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Ce sera le <strong className="text-gray-900 dark:text-gray-100">n° {modele.poses + 1}</strong>{' '}
          de ce modèle.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={relever}
            disabled={loading || !supported}
            className="flex min-h-[110px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-sky-500 px-4 py-4 text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-900/30"
          >
            {loading ? (
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
            ) : (
              <Crosshair className="h-7 w-7" />
            )}
            <span className="text-sm font-semibold">
              {loading ? 'Recherche du signal…' : 'Utiliser ma position'}
            </span>
            <span className="text-xs opacity-75">Je suis devant</span>
          </button>

          <button
            type="button"
            onClick={onPointerSurCarte}
            className="flex min-h-[110px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary-500 px-4 py-4 text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
          >
            <MapPin className="h-7 w-7" />
            <span className="text-sm font-semibold">Pointer sur la carte</span>
            <span className="text-xs opacity-75">Je le situe de mémoire</span>
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!supported && !error && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Cet appareil ne sait pas donner sa position : pointez sur la carte.
          </p>
        )}

        {!saisie ? (
          <button
            type="button"
            onClick={() => setSaisie(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <Pencil className="h-4 w-4" />
            Saisir les coordonnées à la main
          </button>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className={LIBELLE}>Latitude</label>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="49.570000"
                className={CHAMP}
              />
            </div>
            <div>
              <label className={LIBELLE}>Longitude</label>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="0.958000"
                className={CHAMP}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={valider} className="w-full">
                Utiliser
              </Button>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onRetour}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Changer de matériel
        </Button>
      </ModalFooter>
    </>
  )
}

// ------------------------------------------------------------- 3. le reste

function Details({
  modele,
  position,
  onRetour,
  onFermer,
  onPose,
}: {
  modele: ModelePosable
  position: PositionPose
  onRetour: () => void
  onFermer: () => void
  onPose: (item: MobilierUrbain, encore: boolean) => void
}) {
  const queryClient = useQueryClient()
  const numero = modele.poses + 1
  const [form, setForm] = useState({
    label: `${modele.name} ${numero}`,
    code: '',
    address: '',
    street: '',
    sector: '',
    status: 'en_service',
    condition_state: 'neuf',
    installed_on: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const [adresseEnCours, setAdresseEnCours] = useState(true)

  /**
   * L'adresse, la rue et le quartier se lisent du point.
   *
   * C'est exactement ce que personne ne tape sur un téléphone, et exactement ce
   * dont l'export « par rue » a besoin. Proposé et modifiable : OpenStreetMap
   * peut nommer la voie d'en face, et c'est l'agent qui sait.
   */
  useEffect(() => {
    let vivant = true
    setAdresseEnCours(true)
    releverAdresse(position.lat, position.lng)
      .then((adresse) => {
        if (!vivant) return
        setForm((f) => ({
          ...f,
          address: f.address || adresse.complete,
          street: f.street || adresse.rue,
          sector: f.sector || adresse.secteur,
        }))
      })
      .finally(() => {
        if (vivant) setAdresseEnCours(false)
      })
    return () => {
      vivant = false
    }
  }, [position.lat, position.lng])

  const poser = useMutation({
    mutationFn: async (encore: boolean) => {
      const reponse = await mobilierUrbainApi.poser({
        object_id: modele.id,
        latitude: position.lat,
        longitude: position.lng,
        position_source: position.source,
        position_accuracy: position.accuracy ?? null,
        ...form,
      })
      return { item: reponse.data.data, encore }
    },
    onSuccess: ({ item, encore }) => {
      toast.success(`${item.label} posé`)
      queryClient.invalidateQueries({ queryKey: ['mobilier'] })
      queryClient.invalidateQueries({ queryKey: ['mobilier-catalogue'] })
      queryClient.invalidateQueries({ queryKey: ['mobilier-facettes'] })
      queryClient.invalidateQueries({ queryKey: ['mobilier-stats'] })
      onPose(item, encore)
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'La pose a échoué'),
  })

  const champ = (clef: keyof typeof form) => ({
    value: form[clef],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [clef]: e.target.value }),
  })

  return (
    <>
      <ModalBody>
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
          {modele.image ? (
            <img
              src={getImageUrl(modele.image)}
              alt=""
              className="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white dark:bg-gray-700">
              <Package className="h-5 w-5 text-gray-400" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {modele.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <MapPin className="mr-1 inline h-3 w-3" />
              {formatCoord(position.lat)}, {formatCoord(position.lng)}
              {position.source === 'gps' && position.accuracy
                ? ` · relevé à ±${Math.round(position.accuracy)} m`
                : ''}
            </p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
            n° {numero}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LIBELLE}>Nom sur la carte</label>
            <input type="text" {...champ('label')} className={CHAMP} />
          </div>

          <div>
            <label className={LIBELLE}>Numéro d’inventaire de la commune</label>
            <input
              type="text"
              {...champ('code')}
              placeholder="Gravé sur le mobilier — facultatif"
              className={CHAMP}
            />
          </div>

          <div>
            <label className={LIBELLE}>Date de pose</label>
            <input type="date" {...champ('installed_on')} className={CHAMP} />
          </div>

          <div className="sm:col-span-2">
            <label className={LIBELLE}>
              Adresse
              {adresseEnCours && (
                <span className="ml-1.5 inline-flex items-center gap-1 font-normal text-gray-400">
                  <Sparkles className="h-3 w-3" />
                  lecture de la carte…
                </span>
              )}
            </label>
            <input type="text" {...champ('address')} className={CHAMP} />
          </div>

          <div>
            <label className={LIBELLE}>Rue</label>
            <input type="text" {...champ('street')} className={CHAMP} />
          </div>

          <div>
            <label className={LIBELLE}>Zone / secteur</label>
            <input
              type="text"
              {...champ('sector')}
              placeholder="Quartier, tournée…"
              className={CHAMP}
            />
          </div>

          <div>
            <label className={LIBELLE}>Statut</label>
            <select {...champ('status')} className={CHAMP}>
              {STATUTS.map((s) => (
                <option key={s.valeur} value={s.valeur}>
                  {s.libelle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LIBELLE}>État</label>
            <select {...champ('condition_state')} className={CHAMP}>
              {ETATS.map((e) => (
                <option key={e.valeur} value={e.valeur}>
                  {e.libelle}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={LIBELLE}>Notes</label>
            <textarea rows={2} {...champ('notes')} className={CHAMP} />
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onRetour} disabled={poser.isPending}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Changer la position
        </Button>
        <div className="flex-1" />
        <Button variant="secondary" onClick={onFermer} disabled={poser.isPending}>
          Annuler
        </Button>
        {/* Vingt-trois bancs se posent d'affilée : revenir au catalogue entre
            chaque serait vingt-trois fois le même aller-retour. */}
        <Button
          variant="secondary"
          onClick={() => poser.mutate(true)}
          disabled={poser.isPending}
          title="Poser celui-ci, puis enchaîner sur un autre du même modèle"
        >
          Poser et continuer
        </Button>
        <Button onClick={() => poser.mutate(false)} disabled={poser.isPending}>
          {poser.isPending ? 'Pose…' : 'Poser'}
        </Button>
      </ModalFooter>
    </>
  )
}
