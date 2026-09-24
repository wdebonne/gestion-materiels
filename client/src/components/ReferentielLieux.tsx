import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, DoorOpen, LayoutGrid, Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import api, { siteApi } from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import toast from 'react-hot-toast'
import {
  Badge,
  Button,
  Card,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  TextArea,
  useConfirm,
} from '@/components/ui'

/**
 * Référentiel des lieux : un bâtiment, ses pièces, ses ouvrants.
 *
 * Trois niveaux depuis la migration 037, et toujours pas une arborescence
 * libre. La profondeur reste fixe et chaque étage a un nom, ce que défendait
 * réellement la version à deux niveaux : sans cela, chacun invente sa
 * profondeur et la même porte finit saisie à deux endroits.
 *
 * Le niveau du milieu manquait à deux usages. Une clé ne pouvait pas être un
 * *passe partiel* — celui qui ouvre la salle des mariages et ses accès, et rien
 * d'autre. Et on ne prête pas une porte : « la salle des mariages est-elle libre
 * le 28 ? » n'avait aucun objet à désigner.
 *
 * **Un ouvrant peut rester accroché au bâtiment.** La barrière principale et le
 * portail du stade ne sont dans aucune salle. Ils s'affichent sous le bâtiment,
 * après les pièces, et les forcer dans une pièce fictive « Extérieur » ferait
 * inventer à chaque commune sa propre convention.
 *
 * La suppression d'un lieu encore employé est refusée par le serveur plutôt que
 * cascadée : effacer ce qu'une clé ouvre la réduirait à un bout de métal sans
 * usage connu — précisément la donnée qu'on tient ici.
 *
 * **Les boutons suivent la gestion, bâtiment par bâtiment** (`useGestion`) : le
 * gestionnaire de l'école modifie l'école, ses salles et ses portes, et voit la
 * mairie sans pouvoir y toucher. Créer ou supprimer un bâtiment reste au
 * gestionnaire de toute l'organisation.
 */

interface Ouvrant {
  id: number
  site_id: number
  piece_id: number | null
  name: string
  code: string | null
  description: string | null
}

interface Piece {
  id: number
  site_id: number
  name: string
  code: string | null
  description: string | null
  type_lieu: string | null
  capacite: number | null
  pretable: number | null
  pretable_effectif: boolean
  ouvrants: Ouvrant[]
}

interface Site {
  id: number
  name: string
  code: string | null
  address: string | null
  pretable: number | null
  pretable_effectif: boolean
  is_active?: number
  pieces: Piece[]
  /** Les ouvrants rattachés à aucune pièce. */
  ouvrants: Ouvrant[]
}

/** Le formulaire rend des chaînes ; `''` porte « hérite », et non « non ». */
type TroisEtats = '' | '0' | '1'

const versTroisEtats = (valeur: number | null): TroisEtats =>
  valeur === null || valeur === undefined ? '' : valeur ? '1' : '0'

interface FormSite {
  id?: number
  name: string
  code: string
  address: string
  pretable: TroisEtats
  /** Absent à la création : un bâtiment naît actif. */
  actif?: boolean
}

interface FormPiece {
  id?: number
  siteId: number
  name: string
  code: string
  description: string
  typeLieu: string
  capacite: string
  pretable: TroisEtats
}

interface FormOuvrant {
  id?: number
  siteId: number
  pieceId: string
  name: string
  code: string
  description: string
}

/**
 * Les natures de pièce proposées.
 *
 * Une liste de suggestions, pas une énumération fermée : la colonne est libre en
 * base, et figer les valeurs obligerait à une migration le jour où une commune
 * veut « chapiteau ». Le champ reste donc saisissable.
 */
const TYPES_DE_LIEU = ['Salle', 'Hall', 'Cour', 'Terrain', 'Préau', 'Bureau', 'Local', 'Cuisine']

/** Une salle est une pièce de type « Salle », quelle que soit la casse saisie. */
const estSalle = (piece: Piece) => (piece.type_lieu ?? '').trim().toLowerCase() === 'salle'

interface ReferentielLieuxProps {
  /** Ne montrer que les bâtiments que l'on gère — pour un gestionnaire local. */
  seulementGeres?: boolean
  /** Contenu ajouté sous un bâtiment déplié — les personnes, dans Organisation. */
  panneauSite?: (siteId: number) => ReactNode
}

export default function ReferentielLieux({ seulementGeres = false, panneauSite }: ReferentielLieuxProps = {}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const gestion = useGestion()

  const [siteOuvert, setSiteOuvert] = useState<number | null>(null)
  const [piecesOuvertes, setPiecesOuvertes] = useState<Set<number>>(new Set())
  const [formSite, setFormSite] = useState<FormSite | null>(null)
  const [formPiece, setFormPiece] = useState<FormPiece | null>(null)
  const [formOuvrant, setFormOuvrant] = useState<FormOuvrant | null>(null)

  const { data: tousLesSites = [], isLoading } = useQuery<Site[]>({
    queryKey: ['cles-referentiel'],
    queryFn: async () => (await api.get('/cles/referentiel')).data.data,
  })
  const sites = seulementGeres
    ? tousLesSites.filter((s) => gestion.peutGererSite(s.id))
    : tousLesSites

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['cles-referentiel'] })
    // L'arbre partagé sert aussi aux demandes et aux manifestations : le laisser
    // périmé ferait proposer une salle qu'on vient de retirer.
    queryClient.invalidateQueries({ queryKey: ['lieux-arbre'] })
    queryClient.invalidateQueries({ queryKey: ['sites'] })
    queryClient.invalidateQueries({ queryKey: ['organisation'] })
  }

  const basculerPiece = (id: number) =>
    setPiecesOuvertes((ouvertes) => {
      const suivant = new Set(ouvertes)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })

  const enregistrerSite = useMutation({
    mutationFn: async (valeurs: FormSite) => {
      const corps = {
        name: valeurs.name,
        code: valeurs.code,
        address: valeurs.address,
        pretable: valeurs.pretable,
      }
      if (valeurs.id) {
        await api.put(`/cles/sites/${valeurs.id}`, corps)
        // L'activité passe par `/api/sites`, qui la tient depuis la migration 032.
        if (valeurs.actif !== undefined) await siteApi.modifier(valeurs.id, { actif: valeurs.actif })
        return
      }
      return api.post('/cles/sites', corps)
    },
    onSuccess: () => {
      setFormSite(null)
      rafraichir()
    },
    meta: { successMessage: 'Bâtiment enregistré' },
  })

  const enregistrerPiece = useMutation({
    mutationFn: async (valeurs: FormPiece) => {
      const corps = {
        siteId: valeurs.siteId,
        nom: valeurs.name,
        code: valeurs.code,
        description: valeurs.description,
        typeLieu: valeurs.typeLieu,
        capacite: valeurs.capacite,
        pretable: valeurs.pretable,
      }
      if (valeurs.id) return api.put(`/sites/pieces/${valeurs.id}`, corps)
      return api.post('/sites/pieces', corps)
    },
    onSuccess: () => {
      setFormPiece(null)
      rafraichir()
    },
    meta: { successMessage: 'Pièce enregistrée' },
  })

  const enregistrerOuvrant = useMutation({
    mutationFn: async (valeurs: FormOuvrant) => {
      const corps = {
        siteId: valeurs.siteId,
        // Vide = rattaché au bâtiment : c'est le cas de la barrière.
        pieceId: valeurs.pieceId ? Number(valeurs.pieceId) : null,
        name: valeurs.name,
        code: valeurs.code,
        description: valeurs.description,
      }
      if (valeurs.id) return api.put(`/cles/ouvrants/${valeurs.id}`, corps)
      return api.post('/cles/ouvrants', corps)
    },
    onSuccess: () => {
      setFormOuvrant(null)
      rafraichir()
    },
    meta: { successMessage: 'Ouvrant enregistré' },
  })

  /**
   * Le refus du serveur porte le nombre de clés ou de demandes concernées : il
   * est remonté tel quel plutôt que remplacé par un message générique, parce que
   * « 3 clés ouvrent encore ce site » dit quoi faire, là où « suppression
   * impossible » laisse chercher.
   */
  const supprimer = async (genre: 'sites' | 'pieces' | 'ouvrants', id: number, nom: string) => {
    const messages: Record<typeof genre, string> = {
      sites: 'Les pièces et les portes de ce bâtiment seront supprimées avec lui.',
      pieces: 'Ses portes seront rendues au bâtiment, et non supprimées.',
      ouvrants: 'Cette porte sera retirée du référentiel.',
    }

    const ok = await confirm({
      title: `Supprimer ${nom} ?`,
      message: messages[genre],
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return

    try {
      // Les pièces sont servies par le référentiel partagé `/api/sites`, où
      // vivent aussi les occupations ; les bâtiments et les portes sont restés
      // sous `/api/cles`, où ils sont nés.
      await api.delete(genre === 'pieces' ? `/sites/pieces/${id}` : `/cles/${genre}/${id}`)
      toast.success('Supprimé')
      rafraichir()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? 'Suppression impossible')
    }
  }

  if (isLoading) return <LoadingInline />

  /**
   * Les boutons d'une ligne, identiques aux trois niveaux. `peutSupprimer`
   * n'est distinct que pour le bâtiment : son gestionnaire le modifie, mais ne
   * le supprime pas.
   */
  const actions = (
    modifier: () => void,
    effacer: () => void,
    quoi: string,
    peutModifier: boolean,
    peutSupprimer = peutModifier
  ) =>
    peutModifier || peutSupprimer ? (
      <div className="flex flex-shrink-0 items-center gap-1">
        {peutModifier && (
          <button
            onClick={modifier}
            className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={`Modifier ${quoi}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {peutSupprimer && (
          <button
            onClick={effacer}
            className="touch-target rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            title={`Supprimer ${quoi}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    ) : null

  const ligneOuvrant = (ouvrant: Ouvrant, site: Site) => (
    <div
      key={ouvrant.id}
      className="flex items-center gap-3 rounded-lg bg-white p-3 dark:bg-gray-800"
    >
      <DoorOpen className="h-4 w-4 flex-shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {ouvrant.name}
          {ouvrant.code && (
            <span className="ml-2 font-mono text-xs text-gray-500">{ouvrant.code}</span>
          )}
        </div>
        {ouvrant.description && (
          <div className="truncate text-xs text-gray-600 dark:text-gray-300">
            {ouvrant.description}
          </div>
        )}
      </div>
      {actions(
        () =>
          setFormOuvrant({
            id: ouvrant.id,
            siteId: site.id,
            pieceId: ouvrant.piece_id ? String(ouvrant.piece_id) : '',
            name: ouvrant.name,
            code: ouvrant.code ?? '',
            description: ouvrant.description ?? '',
          }),
        () => supprimer('ouvrants', ouvrant.id, ouvrant.name),
        'la porte',
        gestion.peutGererSite(site.id)
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {gestion.gereLieux && (
          <Button
            onClick={() => setFormSite({ name: '', code: '', address: '', pretable: '0' })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nouveau bâtiment
          </Button>
        )}
      </div>

      {sites.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-700 dark:text-gray-200">Aucun bâtiment enregistré.</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Commencez par créer un bâtiment — la mairie, une école, un local technique — puis
            décrivez ses pièces, et les portes que vos clés ouvrent.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => {
            const nbSalles = (site.pieces ?? []).filter(estSalle).length
            const nbAutres = (site.pieces?.length ?? 0) - nbSalles
            const gere = gestion.peutGererSite(site.id)
            const inactif = site.is_active !== undefined && !Number(site.is_active)
            const nbOuvrants =
              (site.ouvrants?.length ?? 0) +
              (site.pieces ?? []).reduce((total, p) => total + (p.ouvrants?.length ?? 0), 0)

            return (
              <Card key={site.id} className="overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button
                    onClick={() => setSiteOuvert(siteOuvert === site.id ? null : site.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronRight
                      className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                        siteOuvert === site.id ? 'rotate-90' : ''
                      }`}
                    />
                    <Building2 className="h-5 w-5 flex-shrink-0 text-primary-600" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate font-medium text-gray-900 dark:text-gray-100">
                        <span className="truncate">{site.name}</span>
                        {site.code && (
                          <span className="font-mono text-xs text-gray-500">{site.code}</span>
                        )}
                        {site.pretable_effectif && (
                          <Badge variant="success" size="sm">
                            Prêtable
                          </Badge>
                        )}
                        {inactif && (
                          <Badge variant="default" size="sm">
                            Inactif
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-sm text-gray-600 dark:text-gray-300">
                        {nbSalles} salle{nbSalles > 1 ? 's' : ''}
                        {nbAutres > 0 ? ` · ${nbAutres} autre${nbAutres > 1 ? 's' : ''} pièce${nbAutres > 1 ? 's' : ''}` : ''}
                        {' · '}{nbOuvrants} ouvrant
                        {nbOuvrants > 1 ? 's' : ''}
                        {site.address ? ` · ${site.address}` : ''}
                      </div>
                    </div>
                  </button>

                  {actions(
                    () =>
                      setFormSite({
                        id: site.id,
                        name: site.name,
                        code: site.code ?? '',
                        address: site.address ?? '',
                        pretable: site.pretable ? '1' : '0',
                        actif: !inactif,
                      }),
                    () => supprimer('sites', site.id, site.name),
                    'le bâtiment',
                    gere,
                    gestion.gereLieux
                  )}
                </div>

                {siteOuvert === site.id && (
                  <div className="space-y-3 border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                    {/* ---------------------------------------------- pièces */}
                    {(site.pieces ?? []).map((piece) => (
                      <div
                        key={piece.id}
                        className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                      >
                        <div className="flex items-center gap-3 p-3">
                          <button
                            onClick={() => basculerPiece(piece.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <ChevronRight
                              className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                                piecesOuvertes.has(piece.id) ? 'rotate-90' : ''
                              }`}
                            />
                            <LayoutGrid className="h-4 w-4 flex-shrink-0 text-primary-500" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                <span className="truncate">{piece.name}</span>
                                {piece.code && (
                                  <span className="font-mono text-xs text-gray-500">
                                    {piece.code}
                                  </span>
                                )}
                                {piece.pretable_effectif && (
                                  <Badge variant="success" size="sm">
                                    Prêtable
                                  </Badge>
                                )}
                              </div>
                              <div className="truncate text-xs text-gray-600 dark:text-gray-300">
                                {[
                                  piece.type_lieu,
                                  piece.capacite ? `${piece.capacite} personnes` : null,
                                  `${piece.ouvrants?.length ?? 0} ouvrant${
                                    (piece.ouvrants?.length ?? 0) > 1 ? 's' : ''
                                  }`,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </div>
                          </button>

                          {actions(
                            () =>
                              setFormPiece({
                                id: piece.id,
                                siteId: site.id,
                                name: piece.name,
                                code: piece.code ?? '',
                                description: piece.description ?? '',
                                typeLieu: piece.type_lieu ?? '',
                                capacite: piece.capacite ? String(piece.capacite) : '',
                                pretable: versTroisEtats(piece.pretable),
                              }),
                            () => supprimer('pieces', piece.id, piece.name),
                            estSalle(piece) ? 'la salle' : 'la pièce',
                            gere
                          )}
                        </div>

                        {piecesOuvertes.has(piece.id) && (
                          <div className="space-y-2 border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                            {(piece.ouvrants ?? []).map((ouvrant) => ligneOuvrant(ouvrant, site))}
                            {gere && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setFormOuvrant({
                                    siteId: site.id,
                                    pieceId: String(piece.id),
                                    name: '',
                                    code: '',
                                    description: '',
                                  })
                                }
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Ajouter une porte à cette pièce
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {gere && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFormPiece({
                            siteId: site.id,
                            name: '',
                            code: '',
                            description: '',
                            // La commune raisonne en salles : c'est le cas courant.
                            typeLieu: 'Salle',
                            capacite: '',
                            pretable: '',
                          })
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Ajouter une salle ou une pièce
                      </Button>
                    )}

                    {/* ------------------------- ouvrants sans pièce */}
                    {(site.ouvrants?.length ?? 0) > 0 && (
                      <div className="space-y-2 pt-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Rattachés au bâtiment
                        </p>
                        {site.ouvrants.map((ouvrant) => ligneOuvrant(ouvrant, site))}
                      </div>
                    )}

                    {gere && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFormOuvrant({
                            siteId: site.id,
                            pieceId: '',
                            name: '',
                            code: '',
                            description: '',
                          })
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Ajouter une porte au bâtiment
                      </Button>
                    )}

                    {panneauSite?.(site.id)}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ================================ FORMULAIRES ================================ */}

      {formSite && (
        <Modal
          isOpen
          onClose={() => setFormSite(null)}
          title={formSite.id ? 'Modifier le bâtiment' : 'Nouveau bâtiment'}
        >
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Nom"
                value={formSite.name}
                onChange={(e) => setFormSite({ ...formSite, name: e.target.value })}
                placeholder="Mairie, École Jules Ferry…"
              />
              <Input
                label="Code"
                value={formSite.code}
                onChange={(e) => setFormSite({ ...formSite, code: e.target.value })}
                placeholder="MAI, EJF…"
                hint="Facultatif. Utile pour composer les numéros d'inventaire."
              />
              <Input
                label="Adresse"
                value={formSite.address}
                onChange={(e) => setFormSite({ ...formSite, address: e.target.value })}
              />
              <Select
                label="Bâtiment entier prêtable"
                value={formSite.pretable}
                onChange={(e) =>
                  setFormSite({ ...formSite, pretable: e.target.value as TroisEtats })
                }
                options={[
                  { value: '0', label: 'Non' },
                  { value: '1', label: 'Oui — on peut le réserver en entier' },
                ]}
                hint="Une salle des fêtes se prête d'un bloc pour un loto. Un centre technique, jamais."
              />
              {formSite.actif !== undefined && (
                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-gray-300"
                    checked={formSite.actif}
                    onChange={(e) => setFormSite({ ...formSite, actif: e.target.checked })}
                  />
                  <span>
                    <strong>Actif</strong> — un bâtiment désactivé disparaît des formulaires sans
                    toucher à l'historique. C'est ce qu'on fait d'un bâtiment encore cité par une
                    demande ou une clé, qui ne peut plus être supprimé.
                  </span>
                </label>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormSite(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrerSite.mutate(formSite)}
              disabled={!formSite.name.trim() || enregistrerSite.isPending}
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {formPiece && (
        <Modal
          isOpen
          onClose={() => setFormPiece(null)}
          title={
            formPiece.id
              ? formPiece.typeLieu.trim().toLowerCase() === 'salle' ? 'Modifier la salle' : 'Modifier la pièce'
              : formPiece.typeLieu.trim().toLowerCase() === 'salle' ? 'Nouvelle salle' : 'Nouvelle pièce'
          }
        >
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Nom"
                value={formPiece.name}
                onChange={(e) => setFormPiece({ ...formPiece, name: e.target.value })}
                placeholder="Salle du conseil, Salle des mariages, Hall…"
              />
              <Input
                label="Nature"
                value={formPiece.typeLieu}
                onChange={(e) => setFormPiece({ ...formPiece, typeLieu: e.target.value })}
                list="natures-de-lieu"
                placeholder="Salle, Hall, Cour…"
                hint="Facultatif. Sert à filtrer la liste des lieux."
              />
              <datalist id="natures-de-lieu">
                {TYPES_DE_LIEU.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Input
                label="Capacité"
                type="number"
                min={0}
                value={formPiece.capacite}
                onChange={(e) => setFormPiece({ ...formPiece, capacite: e.target.value })}
                hint="Nombre de personnes. Laissez vide si vous ne la connaissez pas : la pièce restera proposée."
              />
              <Input
                label="Code"
                value={formPiece.code}
                onChange={(e) => setFormPiece({ ...formPiece, code: e.target.value })}
                hint="Facultatif."
              />
              <Select
                label="Prêtable pour une manifestation"
                value={formPiece.pretable}
                onChange={(e) =>
                  setFormPiece({ ...formPiece, pretable: e.target.value as TroisEtats })
                }
                options={[
                  { value: '', label: 'Comme le bâtiment' },
                  { value: '1', label: 'Oui' },
                  { value: '0', label: 'Non' },
                ]}
                hint="« Comme le bâtiment » évite de recocher chaque pièce quand tout un bâtiment s'ouvre."
              />
              <TextArea
                label="Description"
                value={formPiece.description}
                onChange={(e) => setFormPiece({ ...formPiece, description: e.target.value })}
                rows={3}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormPiece(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrerPiece.mutate(formPiece)}
              disabled={!formPiece.name.trim() || enregistrerPiece.isPending}
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {formOuvrant && (
        <Modal
          isOpen
          onClose={() => setFormOuvrant(null)}
          title={formOuvrant.id ? 'Modifier la porte' : 'Nouvelle porte'}
        >
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Nom"
                value={formOuvrant.name}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, name: e.target.value })}
                placeholder="Porte principale, Porte de service…"
              />
              <Select
                label="Pièce"
                value={formOuvrant.pieceId}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, pieceId: e.target.value })}
                options={[
                  { value: '', label: 'Aucune — rattachée au bâtiment' },
                  ...(sites
                    .find((s) => s.id === formOuvrant.siteId)
                    ?.pieces?.map((p) => ({ value: String(p.id), label: p.name })) ?? []),
                ]}
                hint="La barrière principale et le portail du stade ne sont dans aucune pièce."
              />
              <Input
                label="Code"
                value={formOuvrant.code}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, code: e.target.value })}
                hint="Facultatif. Le repère gravé sur le cylindre, par exemple."
              />
              <TextArea
                label="Description"
                value={formOuvrant.description}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, description: e.target.value })}
                rows={3}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormOuvrant(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrerOuvrant.mutate(formOuvrant)}
              disabled={!formOuvrant.name.trim() || enregistrerOuvrant.isPending}
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
