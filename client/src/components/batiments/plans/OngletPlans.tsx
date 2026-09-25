import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ImagePlus, Layers, PenLine, Pencil, Plus, Ruler, Search, Trash2 } from 'lucide-react'
import { plansApi, type Etage, type PieceSurPlan } from '@/lib/api'
import { Alert, Badge, Button, Card, CardBody, Input, LoadingInline, Modal, ModalBody, ModalFooter, Select, useConfirm } from '@/components/ui'
import { echelleDepuisCalibrage, formaterSurface } from '@/components/plan/geometrie'
import type { PointPlan } from '@/components/plan/types'
import { cn } from '@/lib/utils'
import { invaliderBatiments } from '../cache'
import PlanEtage, { type ModePlan } from './PlanEtage'
import FichePiece from './FichePiece'
import ImporterPlan from './ImporterPlan'
import { NATURES_PIECE } from './couleurs'

/**
 * Les étages d'un bâtiment, leurs plans, et les pièces qu'on y dessine.
 *
 * L'écran répond à trois questions, dans l'ordre où on les pose : **où est**
 * telle salle, tel vidéoprojecteur (la recherche surligne la pièce et bascule
 * sur son étage) ; **qu'y a-t-il** dans cette pièce, et **qui peut y entrer**
 * (un clic ouvre sa fiche). Le gestionnaire du bâtiment, en plus, importe les
 * plans, dessine les pièces et y pose le matériel.
 */
export default function OngletPlans({ siteId, gere }: { siteId: number; gere: boolean }) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [etageId, setEtageId] = useState<number | null>(null)
  const [selection, setSelection] = useState<number | null>(null)
  const [mode, setMode] = useState<ModePlan>('voir')
  const [redessin, setRedessin] = useState<number | null>(null)
  const [trace, setTrace] = useState<PointPlan[] | null>(null)
  const [etalonnage, setEtalonnage] = useState<{ a: PointPlan; b: PointPlan } | null>(null)
  const [import_, setImport] = useState(false)
  const [editionEtage, setEditionEtage] = useState<Etage | 'nouveau' | null>(null)
  const [recherche, setRecherche] = useState('')
  const [versionPlan, setVersionPlan] = useState(0)
  const [planUrl, setPlanUrl] = useState<string | null>(null)
  const [planErreur, setPlanErreur] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['batiments', 'etages', siteId],
    queryFn: async () => (await plansApi.etages(siteId)).data,
  })
  const etages = data?.etages ?? []
  const pieces = data?.pieces ?? []

  // L'étage affiché : celui choisi, sinon le plus bas qui a un plan, sinon le premier.
  useEffect(() => {
    if (etages.length === 0) return setEtageId(null)
    if (etageId && etages.some((e) => e.id === etageId)) return
    setEtageId((etages.find((e) => e.plan) ?? etages[0]).id)
  }, [etages, etageId])
  const etage = etages.find((e) => e.id === etageId) ?? null

  // Le plan se lit en blob, comme un document privé ; l'URL est rendue à chaque changement.
  useEffect(() => {
    setPlanUrl(null)
    setPlanErreur(false)
    if (!etage?.plan) return
    let url: string | null = null
    let abandonne = false
    plansApi
      .plan(etage.id)
      .then(({ data: image }) => {
        if (abandonne) return
        url = URL.createObjectURL(image)
        setPlanUrl(url)
      })
      .catch(() => !abandonne && setPlanErreur(true))
    return () => {
      abandonne = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [etage?.id, etage?.plan?.largeur, etage?.plan?.hauteur, etage?.plan?.mime, versionPlan]) // eslint-disable-line react-hooks/exhaustive-deps

  // La recherche : par nom de pièce, et par le matériel qu'elles contiennent.
  const terme = recherche.trim().toLowerCase()
  const { data: materiels = [] } = useQuery({
    queryKey: ['batiments', 'materiels', siteId],
    queryFn: async () => (await plansApi.materielsDuBatiment(siteId)).data.materiels,
    enabled: terme.length >= 2,
  })
  const trouvees = useMemo(() => {
    const ids = new Set<number>()
    if (terme.length < 2) return ids
    for (const p of pieces) if (`${p.nom} ${p.code ?? ''}`.toLowerCase().includes(terme)) ids.add(p.id)
    for (const m of materiels) if (`${m.nom} ${m.reference ?? ''}`.toLowerCase().includes(terme)) ids.add(m.pieceId)
    return ids
  }, [terme, pieces, materiels])

  const piecesDeLEtage = pieces.filter((p) => p.etageId === etageId && p.zone.length >= 3)
  const nonPlacees = pieces.filter((p) => p.actif && (p.etageId === null || p.zone.length < 3))

  const rafraichir = () => invaliderBatiments(queryClient)

  const choisirPiece = (p: PieceSurPlan) => {
    if (p.etageId && p.zone.length >= 3) setEtageId(p.etageId)
    setSelection(p.id)
  }

  const commencerRedessin = (pieceId: number) => {
    setRedessin(pieceId)
    setMode('dessin')
  }

  const abandonner = () => {
    setMode('voir')
    setRedessin(null)
  }

  const enregistrerZone = useMutation({
    mutationFn: async ({ pieceId, points }: { pieceId: number; points: PointPlan[] | null }) =>
      (await plansApi.zone(pieceId, { etageId: points ? etageId : etage?.id ?? null, points })).data,
    onSuccess: (r, v) => {
      toast.success(v.points ? `Contour enregistré${r.surfaceM2 ? ` — ${formaterSurface(r.surfaceM2)}` : ''}` : 'Contour effacé')
      rafraichir()
      setSelection(v.pieceId)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "Le contour n'a pas été enregistré"),
  })

  const surTraceFini = (points: PointPlan[]) => {
    setMode('voir')
    if (redessin) {
      enregistrerZone.mutate({ pieceId: redessin, points })
      setRedessin(null)
    } else {
      setTrace(points)
    }
  }

  const supprimerEtage = async () => {
    if (!etage) return
    const ok = await confirmer({
      title: `Supprimer l'étage « ${etage.nom} » ?`,
      message: 'Son plan est effacé. Ses pièces restent, avec leur matériel et leurs clés, mais ne sont plus dessinées.',
      confirmLabel: "Supprimer l'étage",
      variant: 'danger',
    })
    if (!ok) return
    try {
      await plansApi.supprimerEtage(etage.id)
      toast.success('Étage supprimé')
      setEtageId(null)
      setSelection(null)
      rafraichir()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? "La suppression n'a pas abouti")
    }
  }

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      {/* Les étages */}
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-5 w-5 text-gray-400" />
        {[...etages]
          .sort((a, b) => b.niveau - a.niveau)
          .map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEtageId(e.id)
                setSelection(null)
                abandonner()
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                e.id === etageId
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
              )}
            >
              {e.nom}
              {!e.plan && <span className="ml-1 opacity-70">(sans plan)</span>}
            </button>
          ))}
        {gere && (
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setEditionEtage('nouveau')}>
            Étage
          </Button>
        )}
      </div>

      {etages.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucun étage n'est décrit pour ce bâtiment.
            {gere ? ' Ajoutez-en un — « Rez-de-chaussée », « 1er étage » —, puis importez son plan.' : ''}
          </span>
        </Alert>
      ) : (
        <>
          {/* La barre d'outils */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="lg:w-80">
              <Input
                size="sm"
                placeholder="Trouver une pièce ou un matériel…"
                icon={<Search className="h-4 w-4" />}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
            {gere && etage && (
              <div className="flex flex-wrap gap-2 lg:ml-auto">
                <Button
                  size="sm"
                  icon={<PenLine className="h-4 w-4" />}
                  disabled={!etage.plan || mode !== 'voir'}
                  onClick={() => {
                    setRedessin(null)
                    setMode('dessin')
                  }}
                >
                  Dessiner une pièce
                </Button>
                <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => setImport(true)}>
                  {etage.plan ? 'Remplacer le plan' : 'Importer un plan'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Ruler className="h-4 w-4" />}
                  disabled={!etage.plan || mode !== 'voir'}
                  onClick={() => setMode('etalonnage')}
                  title="Tracer une longueur connue pour obtenir les surfaces"
                >
                  {etage.echelle ? 'Réétalonner' : 'Étalonner'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditionEtage(etage)} aria-label="Renommer l'étage" title="Renommer l'étage">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={supprimerEtage} aria-label="Supprimer l'étage" title="Supprimer l'étage">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {terme.length >= 2 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {trouvees.size === 0 ? (
                <span className="text-gray-500 dark:text-gray-400">Aucune pièce ne correspond.</span>
              ) : (
                pieces
                  .filter((p) => trouvees.has(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => choisirPiece(p)}
                      className="rounded-full bg-yellow-100 px-3 py-1 text-yellow-900 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-100"
                    >
                      {p.nom}
                      {p.etageId ? ` · ${etages.find((e) => e.id === p.etageId)?.nom ?? ''}` : ' · non placée'}
                    </button>
                  ))
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
            <div className="min-w-0">
              {!etage?.plan ? (
                <Card>
                  <CardBody className="py-16 text-center">
                    <ImagePlus className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm text-gray-600 dark:text-gray-300">Pas encore de plan pour cet étage.</p>
                    {gere && (
                      <Button className="mt-4" size="sm" onClick={() => setImport(true)}>
                        Importer un plan (PDF ou image)
                      </Button>
                    )}
                  </CardBody>
                </Card>
              ) : planErreur ? (
                <Alert type="error">
                  <span className="text-sm">Le plan n'a pas pu être chargé.</span>
                </Alert>
              ) : !planUrl ? (
                <LoadingInline />
              ) : (
                <PlanEtage
                  imageUrl={planUrl}
                  pieces={piecesDeLEtage}
                  selection={selection}
                  surbrillance={trouvees}
                  mode={mode}
                  onSelect={setSelection}
                  onTraceFini={surTraceFini}
                  onEtalonnage={(a, b) => {
                    setMode('voir')
                    setEtalonnage({ a, b })
                  }}
                  onAnnuler={abandonner}
                />
              )}
              {etage?.plan && !etage.echelle && gere && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Étalonnez le plan — une porte de 0,90 m, un mur coté — pour que les surfaces des pièces se calculent.
                </p>
              )}
            </div>

            <Card>
              <CardBody>
                {selection ? (
                  <FichePiece
                    key={selection}
                    pieceId={selection}
                    gere={gere}
                    onFermer={() => setSelection(null)}
                    onRedessiner={() => commencerRedessin(selection)}
                    onEffacerZone={() => enregistrerZone.mutate({ pieceId: selection, points: null })}
                  />
                ) : (
                  <ListePieces
                    piecesDeLEtage={piecesDeLEtage}
                    nonPlacees={nonPlacees}
                    onChoisir={choisirPiece}
                    gere={gere}
                    peutDessiner={!!etage?.plan}
                    onDessiner={commencerRedessin}
                  />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {import_ && etage && (
        <ImporterPlan
          etage={etage}
          onFermer={() => setImport(false)}
          onImporte={() => {
            setImport(false)
            setVersionPlan((v) => v + 1)
            rafraichir()
          }}
        />
      )}

      {editionEtage && (
        <EditionEtage
          siteId={siteId}
          etage={editionEtage === 'nouveau' ? null : editionEtage}
          onFermer={() => setEditionEtage(null)}
          onEnregistre={(id) => {
            setEditionEtage(null)
            setEtageId(id)
            rafraichir()
          }}
        />
      )}

      {trace && etage && (
        <ZoneDessinee
          etage={etage}
          points={trace}
          pieces={pieces}
          onFermer={() => setTrace(null)}
          onEnregistre={(pieceId) => {
            setTrace(null)
            setSelection(pieceId)
            rafraichir()
          }}
        />
      )}

      {etalonnage && etage && (
        <Etalonnage etage={etage} segment={etalonnage} onFermer={() => setEtalonnage(null)} onEnregistre={rafraichir} />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ la liste

function ListePieces({
  piecesDeLEtage,
  nonPlacees,
  onChoisir,
  gere,
  peutDessiner,
  onDessiner,
}: {
  piecesDeLEtage: PieceSurPlan[]
  nonPlacees: PieceSurPlan[]
  onChoisir: (p: PieceSurPlan) => void
  gere: boolean
  peutDessiner: boolean
  onDessiner: (pieceId: number) => void
}) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Pièces de cet étage</h3>
        {piecesDeLEtage.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucune pièce dessinée ici.{gere && peutDessiner ? ' « Dessiner une pièce » pour commencer.' : ''}
          </p>
        ) : (
          <ul className="space-y-1">
            {piecesDeLEtage.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onChoisir(p)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="truncate text-gray-900 dark:text-gray-100">{p.nom}</span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {[p.surfaceM2 ? formaterSurface(p.surfaceM2) : null, p.materiels ? `${p.materiels} mat.` : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {nonPlacees.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            Pièces pas encore dessinées <Badge size="sm">{nonPlacees.length}</Badge>
          </h3>
          <ul className="space-y-1">
            {nonPlacees.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onChoisir(p)}
                  className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {p.nom}
                </button>
                {gere && peutDessiner && (
                  <Button size="sm" variant="ghost" onClick={() => onDessiner(p.id)} title="La dessiner sur ce plan" aria-label={`Dessiner ${p.nom}`}>
                    <PenLine className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ les fenêtres

function EditionEtage({
  siteId,
  etage,
  onFermer,
  onEnregistre,
}: {
  siteId: number
  etage: Etage | null
  onFermer: () => void
  onEnregistre: (id: number) => void
}) {
  const [nom, setNom] = useState(etage?.nom ?? '')
  const [niveau, setNiveau] = useState(String(etage?.niveau ?? 0))

  const enregistrer = useMutation({
    mutationFn: async () => {
      const valeurs = { nom: nom.trim(), niveau: Number(niveau) }
      if (etage) {
        await plansApi.modifierEtage(etage.id, valeurs)
        return etage.id
      }
      return (await plansApi.creerEtage(siteId, valeurs)).data.id
    },
    onSuccess: (id) => {
      toast.success(etage ? 'Étage modifié' : 'Étage ajouté')
      onEnregistre(id)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'enregistrement n'a pas abouti"),
  })

  return (
    <Modal isOpen onClose={onFermer} title={etage ? `Modifier « ${etage.nom} »` : 'Nouvel étage'} size="sm">
      <ModalBody className="space-y-4">
        <Input label="Nom" autoFocus placeholder="Rez-de-chaussée, 1er étage, Sous-sol…" value={nom} onChange={(e) => setNom(e.target.value)} />
        <Input
          label="Niveau"
          type="number"
          hint="0 pour le rez-de-chaussée, 1 pour le premier, -1 pour le sous-sol : il range les étages."
          value={niveau}
          onChange={(e) => setNiveau(e.target.value)}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending} disabled={!nom.trim()}>
          Enregistrer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Le contour vient d'être fermé : une pièce nouvelle, ou une pièce qui existe déjà. */
function ZoneDessinee({
  etage,
  points,
  pieces,
  onFermer,
  onEnregistre,
}: {
  etage: Etage
  points: PointPlan[]
  pieces: PieceSurPlan[]
  onFermer: () => void
  onEnregistre: (pieceId: number) => void
}) {
  const sansZone = pieces.filter((p) => p.zone.length < 3)
  const [choix, setChoix] = useState<'nouvelle' | 'existante'>('nouvelle')
  const [nom, setNom] = useState('')
  const [nature, setNature] = useState('Salle')
  const [autreNature, setAutreNature] = useState('')
  const [pieceId, setPieceId] = useState<number | null>(sansZone[0]?.id ?? pieces[0]?.id ?? null)

  const enregistrer = useMutation({
    mutationFn: async () => {
      if (choix === 'nouvelle') {
        const typeLieu = nature === 'autre' ? autreNature.trim() || null : nature
        return (await plansApi.creerPiece(etage.id, { nom: nom.trim(), typeLieu, points })).data.id
      }
      await plansApi.zone(pieceId!, { etageId: etage.id, points })
      return pieceId!
    },
    onSuccess: (id) => {
      toast.success('Pièce dessinée sur le plan')
      onEnregistre(id)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "La pièce n'a pas été enregistrée"),
  })

  return (
    <Modal isOpen onClose={onFermer} title="Cette zone est…" size="md">
      <ModalBody className="space-y-4">
        <div className="flex gap-4 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            <input type="radio" checked={choix === 'nouvelle'} onChange={() => setChoix('nouvelle')} />
            Une nouvelle pièce
          </label>
          <label className={cn('flex items-center gap-2', pieces.length === 0 && 'opacity-50')}>
            <input type="radio" checked={choix === 'existante'} disabled={pieces.length === 0} onChange={() => setChoix('existante')} />
            Une pièce qui existe déjà
          </label>
        </div>

        {choix === 'nouvelle' ? (
          <>
            <Input label="Nom" autoFocus placeholder="Salle 12, Bureau du directeur…" value={nom} onChange={(e) => setNom(e.target.value)} />
            <Select
              label="Nature"
              value={nature}
              onChange={(e) => setNature(e.target.value)}
              options={[...NATURES_PIECE.map((n) => ({ value: n, label: n })), { value: 'autre', label: 'Autre…' }]}
            />
            {nature === 'autre' && <Input label="Nature" value={autreNature} onChange={(e) => setAutreNature(e.target.value)} />}
          </>
        ) : (
          <Select
            label="Pièce"
            value={pieceId ?? ''}
            onChange={(e) => setPieceId(Number(e.target.value))}
            options={[
              ...sansZone.map((p) => ({ value: p.id, label: `${p.nom} (pas encore dessinée)` })),
              ...pieces.filter((p) => p.zone.length >= 3).map((p) => ({ value: p.id, label: `${p.nom} (sera redessinée)` })),
            ]}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Abandonner le tracé
        </Button>
        <Button
          onClick={() => enregistrer.mutate()}
          loading={enregistrer.isPending}
          disabled={choix === 'nouvelle' ? !nom.trim() : !pieceId}
        >
          Enregistrer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Deux points tracés sur une longueur connue : on demande combien elle mesure. */
function Etalonnage({
  etage,
  segment,
  onFermer,
  onEnregistre,
}: {
  etage: Etage
  segment: { a: PointPlan; b: PointPlan }
  onFermer: () => void
  onEnregistre: () => void
}) {
  const [metres, setMetres] = useState('')
  const ratio = etage.plan?.ratio ?? null
  const valeur = Number(metres.replace(',', '.'))
  const echelle = ratio && valeur > 0 ? echelleDepuisCalibrage({ ...segment, metres: valeur }, ratio) : null

  const enregistrer = useMutation({
    mutationFn: () =>
      plansApi.modifierEtage(etage.id, {
        echelle: { metresParPourcent: echelle!.metresParPourcent, points: { ...segment, metres: valeur } },
      }),
    onSuccess: () => {
      toast.success('Plan étalonné : les surfaces des pièces sont recalculées')
      onEnregistre()
      onFermer()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'étalonnage n'a pas abouti"),
  })

  return (
    <Modal isOpen onClose={onFermer} title="Longueur réelle" size="sm">
      <ModalBody className="space-y-3">
        {!ratio ? (
          <Alert type="warning">
            <span className="text-sm">Les dimensions du plan sont inconnues : réimportez-le pour pouvoir l'étalonner.</span>
          </Alert>
        ) : (
          <Input
            label="Le segment tracé mesure (en mètres)"
            autoFocus
            inputMode="decimal"
            placeholder="0,90"
            value={metres}
            onChange={(e) => setMetres(e.target.value)}
            hint={valeur > 0 && !echelle ? 'Segment trop court pour être fiable : tracez une longueur plus grande.' : undefined}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending} disabled={!echelle}>
          Étalonner
        </Button>
      </ModalFooter>
    </Modal>
  )
}
