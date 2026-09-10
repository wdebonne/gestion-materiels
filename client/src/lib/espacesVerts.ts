/**
 * Le vocabulaire des espaces verts, écrit une seule fois.
 *
 * Ces listes servaient à la fois à la fiche d'un espace et à la fenêtre
 * d'implantation depuis le parc. Les recopier ferait diverger deux écrans qui
 * décrivent la même chose : un type ajouté ici manquerait là, et l'élément posé
 * s'y rangerait sous « Autre » sans qu'on comprenne pourquoi.
 */

export interface TypeElement {
  value: string
  label: string
  icon: string
  color: string
}

export const ELEMENT_TYPES: TypeElement[] = [
  { value: 'arbre', label: 'Arbre', icon: '🌳', color: '#16a34a' },
  { value: 'arbuste', label: 'Arbuste', icon: '🌿', color: '#22c55e' },
  { value: 'fleur', label: 'Massif floral', icon: '🌺', color: '#ec4899' },
  { value: 'pelouse', label: 'Pelouse', icon: '🟢', color: '#86efac' },
  { value: 'haie', label: 'Haie', icon: '🌲', color: '#15803d' },
  { value: 'mobilier_urbain', label: 'Mobilier urbain', icon: '🪑', color: '#78716c' },
  { value: 'banc', label: 'Banc', icon: '🪑', color: '#a16207' },
  { value: 'poubelle', label: 'Poubelle / Corbeille', icon: '🗑️', color: '#6b7280' },
  { value: 'bac_fleurs', label: 'Bac à fleurs', icon: '🌷', color: '#f472b6' },
  { value: 'eclairage', label: 'Éclairage', icon: '💡', color: '#eab308' },
  { value: 'fontaine', label: 'Fontaine / Bassin', icon: '⛲', color: '#3b82f6' },
  { value: 'cloture', label: 'Clôture / Barrière', icon: '🚧', color: '#d97706' },
  { value: 'jeux', label: 'Jeux enfants', icon: '🎠', color: '#8b5cf6' },
  { value: 'allee', label: 'Allée / Chemin', icon: '🛤️', color: '#a3a3a3' },
  { value: 'panneau', label: 'Panneau / Signalétique', icon: '🪧', color: '#0ea5e9' },
  { value: 'arrosage', label: "Système d'arrosage", icon: '💧', color: '#06b6d4' },
  { value: 'statue', label: 'Statue / Œuvre d\'art', icon: '🗿', color: '#737373' },
  { value: 'autre', label: 'Autre', icon: '📌', color: '#6b7280' },
]

export const CONDITION_STATES = [
  { value: 'neuf', label: 'Neuf', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  { value: 'bon', label: 'Bon état', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  { value: 'moyen', label: 'Moyen', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  { value: 'mauvais', label: 'Mauvais', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  { value: 'remplacer', label: 'À remplacer', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
]

/** Ce que dit un type d'élément, ou le repli « Autre » plutôt que du vide. */
export const typeElement = (valeur?: string | null): TypeElement =>
  ELEMENT_TYPES.find((t) => t.value === valeur) ?? ELEMENT_TYPES[ELEMENT_TYPES.length - 1]

/**
 * Mots qui trahissent la nature d'un matériel, dans le nom de sa branche.
 *
 * L'ordre compte : « bac à fleurs » contient « fleur », et doit rester un bac.
 */
const INDICES: Array<[RegExp, string]> = [
  [/jardini|bac\b|vasque|potée/i, 'bac_fleurs'],
  [/corbeille|poubelle|dechet|déchet/i, 'poubelle'],
  [/banc|assise/i, 'banc'],
  [/haie/i, 'haie'],
  [/arbuste/i, 'arbuste'],
  [/arbre|sujet|essence/i, 'arbre'],
  [/gazon|pelouse|engazon/i, 'pelouse'],
  [/fleur|floral|bulbe|viv(a|)ce|annuelle|plante|rosier|graminée|graminee/i, 'fleur'],
  [/éclairage|eclairage|lampadaire|luminaire|borne lumineuse/i, 'eclairage'],
  [/fontaine|bassin|point d.eau/i, 'fontaine'],
  [/cl[oô]ture|barri[eè]re|garde-corps/i, 'cloture'],
  [/jeux|jeu\b|toboggan|balan[cç]oire/i, 'jeux'],
  [/panneau|signal/i, 'panneau'],
  [/arrosage|goutte|irrigation/i, 'arrosage'],
  [/statue|sculpture|œuvre|oeuvre/i, 'statue'],
  [/mobilier/i, 'mobilier_urbain'],
]

/**
 * Type d'élément deviné d'après la fiche du parc.
 *
 * Poser trente lignes en choisissant trente fois « Massif floral » dans une
 * liste de dix-huit entrées, personne ne le fait : au bout de trois, tout finit
 * en « Autre » et le suivi par type ne veut plus rien dire. La proposition part
 * de ce que le parc sait déjà — la catégorie, la sous-catégorie, le nom — et
 * reste modifiable ligne à ligne : c'est une avance, pas une décision.
 */
export function deviner(...libelles: Array<string | null | undefined>): string {
  const texte = libelles.filter(Boolean).join(' ')
  for (const [motif, type] of INDICES) {
    if (motif.test(texte)) return type
  }
  return 'autre'
}

/** Un montant en euros, à la française, sans centimes inutiles. */
export const euros = (montant: number | null | undefined): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: Number.isInteger(Number(montant ?? 0)) ? 0 : 2,
  }).format(Number(montant ?? 0))
