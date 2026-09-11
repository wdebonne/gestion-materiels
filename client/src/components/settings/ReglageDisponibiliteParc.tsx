import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Check, X, CornerDownRight, Search } from 'lucide-react'
import { Card, CardBody, Alert, Badge, Spinner, Input } from '@/components/ui'
import type {
  ApiReglageParc,
  CategorieReglee,
  Disponibilite,
  ObjetRegle,
  ObjetRegleTrouve,
  SousCategorieReglee,
} from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Quelle part du parc un module accepte.
 *
 * L'écran est né pour le prêt en manifestation — une catégorie ne se prête pas
 * d'un bloc, un réfrigérateur part en brocante quand le grill de la même
 * catégorie reste. Les espaces verts ont posé la même question mot pour mot : on
 * y plante du gazon et de l'enrobé, pas les prestations de la police municipale.
 *
 * Le recopier aurait fait diverger deux écrans qui disent la même chose. Seuls
 * changent la **colonne** réglée, les mots affichés, et les quatre appels.
 *
 * Trois niveaux, le plus précis l'emporte. Une sous-catégorie et un matériel ont
 * **trois** états — oui, non, hérite — et non deux : sans le troisième, ouvrir
 * une catégorie obligerait à recocher chacun de ses matériels, et personne ne le
 * ferait.
 */
export interface ReglageParc {
  /** Colonne qui porte le choix fait à chaque niveau. */
  colonne: string
  /** Clé du résultat effectif, une fois la résolution faite. */
  effectif: string
  /** Préfixe des clés react-query, propre au module. */
  clef: string
  /** Ce que veut dire « oui » ici : « Prêtable », « Implantable »… */
  libelleOui: string
  /** Ce que veut dire « non » : « Exclu ». */
  libelleNon: string
  intro: ReactNode
  explication: ReactNode
  /** Ce que devient un matériel rattaché à aucune catégorie. */
  sansCategorie: ReactNode
  /** Ce qu'il se passe tant qu'aucune catégorie n'existe. */
  aucuneCategorie: ReactNode
  api: ApiReglageParc
}

/** Comparaison souple, celle des autres écrans de recherche de l'application. */
const contient = (texte: string | null | undefined, terme: string): boolean =>
  (texte || '').toLowerCase().includes(terme.toLowerCase())

/** Bouton à trois états, ou à deux pour une catégorie qui ne peut pas hériter. */
function ChoixDisponibilite({ valeur, heritable, herite, onChange, disabled, reglage }: {
  valeur: Disponibilite
  /** Une catégorie ne peut pas hériter : elle n'a que deux états. */
  heritable: boolean
  /** Ce qui s'appliquerait si l'on héritait, pour que « Hérite » soit lisible. */
  herite?: boolean
  onChange: (valeur: Disponibilite) => void
  disabled?: boolean
  reglage: ReglageParc
}) {
  const bouton = (cible: Disponibilite, libelle: string, actifClasse: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(cible)}
      className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
        valeur === cible
          ? actifClasse
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {libelle}
    </button>
  )

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
      {bouton(1, reglage.libelleOui, 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400')}
      {bouton(0, reglage.libelleNon, 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400')}
      {heritable &&
        bouton(
          null,
          herite === undefined
            ? 'Hérite'
            : `Hérite (${herite ? reglage.libelleOui.toLowerCase() : reglage.libelleNon.toLowerCase()})`,
          'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100'
        )}
    </div>
  )
}

export default function ReglageDisponibiliteParc({ reglage }: { reglage: ReglageParc }) {
  const queryClient = useQueryClient()
  const [ouvertes, setOuvertes] = useState<Set<number>>(new Set())
  const [saisie, setSaisie] = useState('')
  const [terme, setTerme] = useState('')

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe stabilisée.
  useEffect(() => {
    const minuteur = setTimeout(() => setTerme(saisie.trim()), 300)
    return () => clearTimeout(minuteur)
  }, [saisie])

  const enRecherche = terme.length > 0

  const { data: arbre = [], isLoading } = useQuery({
    queryKey: [`${reglage.clef}-tree`],
    queryFn: async () => (await reglage.api.getTree()).data.data,
  })

  // Le matériel est chargé catégorie par catégorie au dépliage : chercher un
  // nom dans tout le parc demande donc au serveur, lui seul voit l'ensemble.
  const { data: trouves = [], isFetching: rechercheEnCours } = useQuery({
    queryKey: [`${reglage.clef}-search`, terme],
    queryFn: async () => (await reglage.api.rechercher(terme)).data.data,
    enabled: enRecherche,
  })

  const mutation = useMutation({
    mutationFn: ({ niveau, id, available }: {
      niveau: 'category' | 'subcategory' | 'object'
      id: number
      available: Disponibilite
    }) => reglage.api.regler(niveau, id, available),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: [`${reglage.clef}-tree`] })
      // Le résultat effectif d'un matériel dépend des niveaux au-dessus :
      // changer une catégorie change ce qu'affichent ses matériels.
      queryClient.invalidateQueries({ queryKey: [`${reglage.clef}-objects`] })
      queryClient.invalidateQueries({ queryKey: [`${reglage.clef}-search`] })
      if (variables.niveau === 'category') toast.success('Catégorie mise à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const basculer = (id: number) => {
    const suivant = new Set(ouvertes)
    if (suivant.has(id)) suivant.delete(id)
    else suivant.add(id)
    setOuvertes(suivant)
  }

  /**
   * Les branches à montrer pendant une recherche.
   *
   * Une catégorie apparaît si son nom correspond, ou si elle porte une
   * sous-catégorie ou un matériel qui correspond — sinon on cacherait le chemin
   * menant au résultat. Quand c'est le nom de la catégorie qui correspond, on
   * la rend entière : l'utilisateur a demandé cette catégorie, pas un extrait.
   */
  const branches = useMemo(() => {
    if (!enRecherche) {
      return arbre.map((categorie) => ({
        categorie,
        sousCategories: categorie.subcategories,
        objets: undefined as ObjetRegle[] | undefined,
      }))
    }

    const parCategorie = new Map<number, ObjetRegleTrouve[]>()
    for (const objet of trouves) {
      if (objet.category_id === null) continue
      const liste = parCategorie.get(objet.category_id)
      if (liste) liste.push(objet)
      else parCategorie.set(objet.category_id, [objet])
    }

    return arbre.flatMap((categorie) => {
      const nomCorrespond = contient(categorie.name, terme)
      const sousCategories = nomCorrespond
        ? categorie.subcategories
        : categorie.subcategories.filter((sc) => contient(sc.name, terme))
      const objets = parCategorie.get(categorie.id) || []

      if (!nomCorrespond && sousCategories.length === 0 && objets.length === 0) return []
      // Le nom de la catégorie correspond : ses matériels sont chargés comme
      // d'habitude, tous, plutôt que réduits aux seuls noms qui correspondent.
      return [{ categorie, sousCategories, objets: nomCorrespond ? undefined : objets }]
    })
  }, [arbre, trouves, terme, enRecherche])

  /** Un matériel sans catégorie n'a pas de branche : il en reçoit une à part. */
  const orphelins = useMemo(
    () => (enRecherche ? trouves.filter((objet) => objet.category_id === null) : []),
    [trouves, enRecherche]
  )

  const aucunResultat = enRecherche && !rechercheEnCours && branches.length === 0 && orphelins.length === 0

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">{reglage.intro}</p>

      <Alert type="info">
        <span className="text-sm">{reglage.explication}</span>
      </Alert>

      <div className="max-w-md">
        <Input
          placeholder="Rechercher une catégorie ou un matériel..."
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          icon={<Search className="w-5 h-5" />}
        />
        {enRecherche && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Nom, référence ou numéro de série. Les branches concernées s'ouvrent seules.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : arbre.length === 0 ? (
        <Alert type="warning">
          <span className="text-sm">{reglage.aucuneCategorie}</span>
        </Alert>
      ) : aucunResultat ? (
        <Alert type="info">
          <span className="text-sm">
            Aucune catégorie ni matériel ne correspond à « {terme} ».
          </span>
        </Alert>
      ) : (
        <div className="space-y-2">
          {branches.map(({ categorie, sousCategories, objets }) => (
            <LigneCategorie
              key={categorie.id}
              reglage={reglage}
              categorie={categorie}
              sousCategories={sousCategories}
              objetsTrouves={objets}
              ouverte={enRecherche || ouvertes.has(categorie.id)}
              // Pendant une recherche, la branche reste ouverte : la refermer
              // masquerait le résultat qui l'a fait apparaître.
              onBasculer={enRecherche ? undefined : () => basculer(categorie.id)}
              onRegler={(niveau, id, available) => mutation.mutate({ niveau, id, available })}
              enCours={mutation.isPending}
            />
          ))}

          {orphelins.length > 0 && (
            <SansCategorie
              reglage={reglage}
              objets={orphelins}
              onRegler={(id, available) => mutation.mutate({ niveau: 'object', id, available })}
              enCours={mutation.isPending}
            />
          )}
        </div>
      )}
    </div>
  )
}

function LigneCategorie({ reglage, categorie, sousCategories, objetsTrouves, ouverte, onBasculer, onRegler, enCours }: {
  reglage: ReglageParc
  categorie: CategorieReglee
  /** Les sous-catégories à afficher : toutes, ou celles que la recherche retient. */
  sousCategories: SousCategorieReglee[]
  /** Pendant une recherche, les matériels retenus ; sinon on charge la catégorie. */
  objetsTrouves?: ObjetRegle[]
  ouverte: boolean
  /** Absent pendant une recherche : la branche ne se replie pas. */
  onBasculer?: () => void
  onRegler: (niveau: 'category' | 'subcategory' | 'object', id: number, v: Disponibilite) => void
  enCours: boolean
}) {
  const categorieOuverte = categorie[reglage.colonne] === 1
  const listeFournie = objetsTrouves !== undefined

  const { data: charges = [], isLoading } = useQuery({
    queryKey: [`${reglage.clef}-objects`, categorie.id],
    queryFn: async () => (await reglage.api.getObjects(categorie.id)).data.data,
    enabled: ouverte && !listeFournie,
  })

  const objets = listeFournie ? objetsTrouves : charges

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onBasculer} disabled={!onBasculer}
            className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default">
            {onBasculer && (
              ouverte ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium text-gray-900 dark:text-gray-100">{categorie.name}</span>
            <Badge variant="default">{categorie.objets_directs} matériel(s)</Badge>
          </button>

          <ChoixDisponibilite
            reglage={reglage}
            valeur={categorie[reglage.colonne]}
            heritable={false}
            disabled={enCours}
            onChange={(v) => onRegler('category', categorie.id, v)}
          />
        </div>

        {ouverte && (
          <div className="pl-6 space-y-3 border-l-2 border-gray-100 dark:border-gray-700">
            {sousCategories.length > 0 && (
              <div className="space-y-1">
                {sousCategories.map((sc) => (
                  <div key={sc.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                      <CornerDownRight className="w-3 h-3 text-gray-400" />
                      {sc.name}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {sc.objets} matériel(s)
                      </span>
                    </span>
                    <ChoixDisponibilite
                      reglage={reglage}
                      valeur={sc[reglage.colonne]}
                      heritable
                      herite={categorieOuverte}
                      disabled={enCours}
                      onChange={(v) => onRegler('subcategory', sc.id, v)}
                    />
                  </div>
                ))}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : objets.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {listeFournie
                  ? 'Aucun matériel de cette catégorie ne correspond.'
                  : 'Aucun matériel dans cette catégorie.'}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Exceptions matériel par matériel :
                </p>
                {objets.map((objet) => (
                  <LigneObjet
                    key={objet.id}
                    reglage={reglage}
                    objet={objet}
                    onRegler={(v) => onRegler('object', objet.id, v)}
                    enCours={enCours}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Les matériels rattachés à aucune catégorie.
 *
 * L'arbre ne les montre nulle part, faute de branche où les ranger. Sans cette
 * carte, chercher un tel matériel par son nom ne rendrait rien alors qu'il
 * existe — et reste ouvert par défaut.
 */
function SansCategorie({ reglage, objets, onRegler, enCours }: {
  reglage: ReglageParc
  objets: ObjetRegleTrouve[]
  onRegler: (id: number, v: Disponibilite) => void
  enCours: boolean
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">Sans catégorie</span>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{reglage.sansCategorie}</p>
        </div>
        <div className="space-y-1">
          {objets.map((objet) => (
            <LigneObjet
              key={objet.id}
              reglage={reglage}
              objet={objet}
              onRegler={(v) => onRegler(objet.id, v)}
              enCours={enCours}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function LigneObjet({ reglage, objet, onRegler, enCours }: {
  reglage: ReglageParc
  objet: ObjetRegle
  onRegler: (v: Disponibilite) => void
  enCours: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 min-w-0">
        {objet[reglage.effectif] ? (
          <Check className="w-3 h-3 text-green-600 shrink-0" />
        ) : (
          <X className="w-3 h-3 text-red-500 shrink-0" />
        )}
        <span className="truncate">{objet.name}</span>
        {objet.reference && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{objet.reference}</span>
        )}
        {objet.subcategory_name && (
          <Badge variant="default">{objet.subcategory_name}</Badge>
        )}
      </span>
      <ChoixDisponibilite
        reglage={reglage}
        valeur={objet[reglage.colonne]}
        heritable
        disabled={enCours}
        onChange={onRegler}
      />
    </div>
  )
}
