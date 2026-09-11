/**
 * Le vocabulaire du mobilier de voie publique, écrit une seule fois.
 *
 * Trois écrans le partagent — la carte, la fiche d'un exemplaire et l'export
 * PDF — et un quatrième s'y ajoutera le jour où la fiche d'un matériel du parc
 * listera ses poses. Les recopier ferait diverger des écrans qui décrivent la
 * même chose : un statut ajouté ici manquerait là, et le point s'afficherait
 * gris sans qu'on comprenne pourquoi.
 *
 * Les libellés doublent ceux du serveur (`mobilierUrbain.service.ts`), qui fait
 * foi et les publie sur `/mobilier-urbain/referentiels`. Ce qui est ici en
 * plus, et que le serveur n'a aucune raison de porter, ce sont les **couleurs
 * et les pictogrammes** : de la mise en forme, pas de la donnée.
 */

export interface Terme {
  valeur: string
  libelle: string
  couleur: string
  /** Classes Tailwind d'une pastille, pour les listes et les fiches. */
  pastille: string
}

/**
 * L'état de service, qui décide de ce qui se voit sur la carte.
 *
 * « Déposé » n'est pas « supprimé » : un candélabre retiré sort de la carte et
 * reste dans l'historique. La question « qu'y avait-il à cet angle avant ? »
 * garde une réponse.
 */
export const STATUTS: Terme[] = [
  {
    valeur: 'en_service',
    libelle: 'En service',
    couleur: '#16a34a',
    pastille: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  {
    valeur: 'maintenance',
    libelle: 'En intervention',
    couleur: '#f59e0b',
    pastille: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  {
    valeur: 'hors_service',
    libelle: 'Hors service',
    couleur: '#ef4444',
    pastille: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  {
    valeur: 'depose',
    libelle: 'Déposé',
    couleur: '#94a3b8',
    pastille: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
]

/**
 * L'état physique, qui décide de ce qu'on va programmer.
 *
 * La même liste que les espaces verts, « à remplacer » compris : la carte
 * montre les deux, et deux vocabulaires voisins mais différents donneraient un
 * filtre « mauvais état » ne ramenant que la moitié du parc, sans le dire.
 */
export const ETATS: Terme[] = [
  {
    valeur: 'neuf',
    libelle: 'Neuf',
    couleur: '#3b82f6',
    pastille: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  {
    valeur: 'bon',
    libelle: 'Bon état',
    couleur: '#16a34a',
    pastille: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  {
    valeur: 'moyen',
    libelle: 'Moyen',
    couleur: '#eab308',
    pastille: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  {
    valeur: 'mauvais',
    libelle: 'Mauvais',
    couleur: '#f97316',
    pastille: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  },
  {
    valeur: 'remplacer',
    libelle: 'À remplacer',
    couleur: '#dc2626',
    pastille: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
]

/**
 * D'où vient l'implantation : le trottoir ou le parc.
 *
 * Ce n'est pas un détail d'affichage. C'est ce qui décide où l'on va quand on
 * ouvre une ligne — la fiche de la carte pour la voirie, celle de l'espace
 * vert pour un parc, qui seule connaît le plan, les surfaces et les saisons.
 */
export const SOURCES: Array<{ valeur: string; libelle: string; court: string; icone: string }> = [
  { valeur: 'voirie', libelle: 'Voie publique', court: 'Voirie', icone: '🛣️' },
  { valeur: 'espace_vert', libelle: 'Espaces verts', court: 'Parcs', icone: '🌳' },
]

export const source = (valeur?: string | null) =>
  SOURCES.find((s) => s.valeur === valeur) ?? SOURCES[0]

/**
 * À quel point on sait où se trouve une implantation.
 *
 * Une carte qui affiche tout au même titre ment. Un élément de parc sans plan
 * capturé ni relevé de terrain se retrouve sur le marqueur de son parc : il
 * est « quelque part par là », à cent mètres près, et l'écran doit le dire —
 * sinon quelqu'un partira chercher un banc à l'endroit exact du point.
 */
export const PRECISIONS: Record<string, { libelle: string; court: string; sure: boolean }> = {
  exacte: { libelle: 'Position relevée', court: 'Exacte', sure: true },
  plan: { libelle: 'Position lue sur le plan du parc', court: 'Plan', sure: true },
  espace: {
    libelle: 'Position approchée : quelque part dans cet espace vert',
    court: 'Approchée',
    sure: false,
  },
  inconnue: { libelle: 'Position inconnue', court: 'Inconnue', sure: false },
}

export const precision = (valeur?: string | null) =>
  PRECISIONS[valeur ?? ''] ?? PRECISIONS.inconnue

/** D'où vient le point posé sur la carte. */
export const SOURCES_POSITION: Array<{ valeur: string; libelle: string; court: string }> = [
  { valeur: 'carte', libelle: 'Pointé sur la carte', court: 'Carte' },
  { valeur: 'gps', libelle: 'Relevé sur le terrain', court: 'GPS' },
  { valeur: 'saisie', libelle: 'Coordonnées saisies', court: 'Saisie' },
]

/** Ce qu'on fait à un mobilier, et qui n'arrive qu'à lui. */
export const TYPES_INTERVENTION: Array<{ valeur: string; libelle: string; icone: string }> = [
  { valeur: 'pose', libelle: 'Pose', icone: '📍' },
  { valeur: 'controle', libelle: 'Contrôle', icone: '🔍' },
  { valeur: 'nettoyage', libelle: 'Nettoyage', icone: '🧽' },
  { valeur: 'entretien', libelle: 'Entretien', icone: '🔧' },
  { valeur: 'peinture', libelle: 'Peinture', icone: '🎨' },
  { valeur: 'reparation', libelle: 'Réparation', icone: '🛠️' },
  { valeur: 'remplacement', libelle: 'Remplacement de pièce', icone: '♻️' },
  { valeur: 'deplacement', libelle: 'Déplacement', icone: '↔️' },
  { valeur: 'depose', libelle: 'Dépose', icone: '📦' },
  { valeur: 'degradation', libelle: 'Dégradation constatée', icone: '⚠️' },
  { valeur: 'autre', libelle: 'Autre', icone: '📝' },
]

/** Ce que dit une valeur, ou le dernier repli plutôt que du vide. */
const trouver = <T extends { valeur: string }>(liste: T[], valeur?: string | null): T =>
  liste.find((t) => t.valeur === valeur) ?? liste[liste.length - 1]

export const statut = (valeur?: string | null): Terme => trouver(STATUTS, valeur)
export const etat = (valeur?: string | null): Terme => trouver(ETATS, valeur)
export const typeIntervention = (valeur?: string | null) => trouver(TYPES_INTERVENTION, valeur)
export const sourcePosition = (valeur?: string | null) => trouver(SOURCES_POSITION, valeur)

// ------------------------------------------------------------------- familles

/**
 * La famille d'un mobilier : ce qui le rend reconnaissable d'un coup d'œil.
 *
 * Une carte communale porte des centaines de points. Tous de la même couleur,
 * elle ne dit rien : « où sont mes candélabres » demande alors de cliquer un
 * par un. Colorer par **statut** ne résout pas le problème non plus — la
 * plupart des points sont en service, et la carte redevient monochrome.
 *
 * La famille est donc devinée d'après ce que le parc sait déjà — le nom du
 * modèle, sa catégorie, sa sous-catégorie. Aucune saisie supplémentaire, aucun
 * référentiel à garnir avant de pouvoir poser le premier banc. C'est une
 * lecture du catalogue, pas une donnée de plus à tenir à jour.
 */
export interface Famille {
  valeur: string
  libelle: string
  icone: string
  couleur: string
}

export const FAMILLES: Famille[] = [
  // Les végétaux d'abord : depuis que la carte montre aussi les espaces verts,
  // ils y sont majoritaires, et les voir tous en « Autre mobilier » rendrait
  // la carte d'une commune illisible là où elle est la plus dense.
  { valeur: 'arbre', libelle: 'Arbre', icone: '🌳', couleur: '#15803d' },
  { valeur: 'arbuste', libelle: 'Arbuste / haie', icone: '🌲', couleur: '#22c55e' },
  { valeur: 'fleur', libelle: 'Fleurs / massif', icone: '🌸', couleur: '#f472b6' },
  { valeur: 'pelouse', libelle: 'Pelouse / couvre-sol', icone: '🟩', couleur: '#86efac' },
  { valeur: 'revetement', libelle: 'Revêtement / allée', icone: '🛤️', couleur: '#a3a3a3' },
  { valeur: 'eclairage', libelle: 'Éclairage public', icone: '💡', couleur: '#eab308' },
  { valeur: 'banc', libelle: 'Banc / assise', icone: '🪑', couleur: '#a16207' },
  { valeur: 'corbeille', libelle: 'Corbeille / conteneur', icone: '🗑️', couleur: '#0891b2' },
  { valeur: 'signalisation', libelle: 'Signalisation', icone: '🪧', couleur: '#0ea5e9' },
  { valeur: 'passage_pieton', libelle: 'Passage piéton', icone: '🚸', couleur: '#f472b6' },
  { valeur: 'abri', libelle: 'Abribus / abri', icone: '🚏', couleur: '#8b5cf6' },
  { valeur: 'potelet', libelle: 'Potelet / borne', icone: '🚧', couleur: '#d97706' },
  { valeur: 'barriere', libelle: 'Barrière / garde-corps', icone: '🛡️', couleur: '#dc2626' },
  { valeur: 'jardiniere', libelle: 'Jardinière / bac', icone: '🌷', couleur: '#ec4899' },
  { valeur: 'velo', libelle: 'Stationnement vélo', icone: '🚲', couleur: '#059669' },
  { valeur: 'jeux', libelle: 'Jeux / sport', icone: '🎠', couleur: '#7c3aed' },
  { valeur: 'eau', libelle: 'Eau / fontaine', icone: '⛲', couleur: '#3b82f6' },
  { valeur: 'reseau', libelle: 'Réseau / coffret', icone: '🔌', couleur: '#64748b' },
  { valeur: 'proprete', libelle: 'Propreté / sanitaire', icone: '🚻', couleur: '#14b8a6' },
  { valeur: 'patrimoine', libelle: 'Patrimoine / œuvre', icone: '🗿', couleur: '#78716c' },
  { valeur: 'autre', libelle: 'Autre mobilier', icone: '📌', couleur: '#6b7280' },
]

/**
 * Mots qui trahissent la famille d'un mobilier.
 *
 * L'ordre compte, et il est têtu : « borne de recharge » contient « borne » et
 * doit rester un équipement de réseau ; « corbeille à papier » contient
 * « papier » et reste une corbeille. Les cas précis passent avant les
 * génériques.
 */
const INDICES: Array<[RegExp, string]> = [
  [/passage +pi[ée]ton|pass(age)? +clout|zebra|cloutage/i, 'passage_pieton'],
  [/cand[ée]labre|lampadaire|luminaire|[ée]clairage|mât +d.[ée]clairage|projecteur/i, 'eclairage'],
  [/abri ?bus|abri.?voyageur|abri\b|kiosque|pr[ée]au/i, 'abri'],
  [/arceau|range.?v[ée]lo|stationnement +v[ée]lo|v[ée]lo\b|cyclo/i, 'velo'],
  [/corbeille|poubelle|conteneur|container|d[ée]chet|cendrier|canisite|colonne +[àa] +verre/i, 'corbeille'],
  [/banc\b|banquette|assise|chaise +urbaine|gradin/i, 'banc'],
  [/jardini[èe]re|bac +[àa] +fleur|vasque|pot\b|pot[ée]e/i, 'jardiniere'],
  [/potelet|borne +escamotable|borne +anti|bollard|butoir|chasse.?roue/i, 'potelet'],
  [/barri[èe]re|garde.?corps|cl[oô]ture|lisse|main +courante|s[ée]paratif/i, 'barriere'],
  [/panneau|signal|miroir|radar|balise|plaque +de +rue|totem|mobilier +d.affichage|sucette/i, 'signalisation'],
  [/fontaine|bassin|point +d.eau|borne +fontaine|brumisateur|abreuvoir/i, 'eau'],
  [/jeux|jeu\b|toboggan|balan[cç]oire|agr[èe]s|city.?stade|skate|tourniquet/i, 'jeux'],
  [/sanitaire|toilette|wc\b|urinoir|douche|fontaine +[àa] +eau +potable/i, 'proprete'],
  [/coffret|armoire|regard|avaloir|grille +d.eau|bouche +[àa] +cl[ée]|tampon|borne +de +recharge|prise +guirlande/i, 'reseau'],
  [/statue|sculpture|œuvre|oeuvre|monument|st[èe]le|fresque|calvaire/i, 'patrimoine'],
  // Le végétal en dernier : ses mots sont les plus courants et les plus
  // ambigus — « bac à fleurs » est un bac, « borne fontaine » une fontaine.
  // Ce qui n'a pas été reconnu plus haut peut l'être ici sans risque.
  [/gazon|pelouse|engazon|couvre.?sol|prairie/i, 'pelouse'],
  [/enrob[ée]|bitume|gravillon|[ée]corce|paillage|sabl[eé]|stabilis[ée]|dallage|pav[ée]/i, 'revetement'],
  [/haie|charmille|troène|laurier|arbuste|buisson/i, 'arbuste'],
  [/arbre|sujet|essence|tilleul|platane|[ée]rable|ch[êe]ne|cerisier|bouleau/i, 'arbre'],
  [
    /fleur|floral|massif|bulbe|viv(a|)ce|annuelle|plante|rosier|gramin[ée]e|g[ée]ranium|p[ée]tunia|tulipe|impatiens/i,
    'fleur',
  ],
]

/**
 * Famille devinée d'après ce que le parc sait déjà du modèle.
 *
 * Reste une proposition d'affichage, jamais une donnée enregistrée : corriger
 * le nom du matériel au catalogue corrige la carte, sans aucune reprise.
 */
export function familleDe(...libelles: Array<string | null | undefined>): Famille {
  const texte = libelles.filter(Boolean).join(' ')
  for (const [motif, valeur] of INDICES) {
    if (motif.test(texte)) {
      return FAMILLES.find((f) => f.valeur === valeur) ?? FAMILLES[FAMILLES.length - 1]
    }
  }
  return FAMILLES[FAMILLES.length - 1]
}

/** La famille d'un exemplaire, lue depuis son modèle. */
export const familleExemplaire = (item: any): Famille =>
  familleDe(item?.object_name, item?.subcategory_name, item?.category_name, item?.label)

// -------------------------------------------------------------------- lecture

/** Ce qui doit alerter sur un exemplaire, ou `null` si tout va bien. */
export function alerteDe(item: any): { motif: string; couleur: string } | null {
  if (item?.status === 'hors_service') return { motif: 'Hors service', couleur: '#ef4444' }
  const echeance = item?.next_intervention_date
  if (echeance && String(echeance).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    return { motif: 'Entretien en retard', couleur: '#f97316' }
  }
  if (item?.condition_state === 'mauvais') return { motif: 'Mauvais état', couleur: '#f97316' }
  return null
}

/** Le nom qu'on lit sur la carte : « Banc 23 », et son code s'il en a un. */
export function nomComplet(item: any): string {
  const base = item?.label || `${item?.object_name ?? 'Mobilier'} ${item?.numero ?? ''}`.trim()
  return item?.code ? `${base} (${item.code})` : base
}

/** Une date courte, ou un tiret — un tableau ne doit pas afficher « null ». */
export const jour = (valeur?: string | null): string =>
  valeur ? new Date(String(valeur)).toLocaleDateString('fr-FR') : '—'

/** Coordonnée affichée : 6 décimales suffisent (précision ~10 cm). */
export const coord = (valeur: unknown): string => Number(valeur).toFixed(6)
