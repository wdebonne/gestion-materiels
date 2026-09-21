/**
 * Les couleurs des catégories de temps, dans les deux thèmes.
 *
 * ⚠️ Doit rester le miroir exact de `src/config/paletteCategories.ts`, qui
 * décide de l'emplacement attribué à une catégorie à sa création. La base ne
 * retient qu'un nom d'emplacement — « bleu », « aqua » — et c'est ici qu'il
 * devient une couleur. Les faire diverger donnerait une catégorie sans couleur,
 * qui retomberait silencieusement sur la première.
 *
 * **Le thème sombre n'est pas une inversion du thème clair.** Ce sont les mêmes
 * huit teintes, mais re-graduées pour une surface sombre, et validées comme un
 * jeu. Ne remplacez jamais une de ces valeurs à l'œil : cet ordre est ce qui
 * garantit que deux parts voisines d'un camembert restent distinguables, y
 * compris pour un daltonien. Vérifié sur les surfaces réelles de
 * l'application — `#ffffff` en clair, `#1f2937` en sombre — avec un écart
 * minimal entre voisins de 9,1 (clair) et 8,4 (sombre) en vision déficiente,
 * pour une cible de 8.
 *
 * Trois teintes claires et une sombre passent sous 3:1 de contraste : c'est
 * pourquoi un graphique porte **toujours** ses libellés en clair et un tableau
 * à côté de lui. L'identité d'une part ne repose jamais sur sa couleur seule.
 */

export const EMPLACEMENTS_COULEUR = [
  'bleu',
  'orange',
  'aqua',
  'jaune',
  'magenta',
  'vert',
  'violet',
  'rouge',
] as const

export type EmplacementCouleur = (typeof EMPLACEMENTS_COULEUR)[number]

interface Teinte {
  clair: string
  sombre: string
  libelle: string
}

export const PALETTE: Record<EmplacementCouleur, Teinte> = {
  bleu: { clair: '#2a78d6', sombre: '#3987e5', libelle: 'Bleu' },
  orange: { clair: '#eb6834', sombre: '#d95926', libelle: 'Orange' },
  aqua: { clair: '#1baf7a', sombre: '#199e70', libelle: 'Turquoise' },
  jaune: { clair: '#eda100', sombre: '#c98500', libelle: 'Jaune' },
  magenta: { clair: '#e87ba4', sombre: '#d55181', libelle: 'Rose' },
  vert: { clair: '#008300', sombre: '#008300', libelle: 'Vert' },
  violet: { clair: '#4a3aa7', sombre: '#9085e9', libelle: 'Violet' },
  rouge: { clair: '#e34948', sombre: '#e66767', libelle: 'Rouge' },
}

/** Le gris des parts qui n'ont pas de catégorie, ou du regroupement « Autres ». */
const NEUTRE = { clair: '#94a3b8', sombre: '#64748b' }

export function estEmplacementCouleur(valeur: unknown): valeur is EmplacementCouleur {
  return typeof valeur === 'string'
    && (EMPLACEMENTS_COULEUR as readonly string[]).includes(valeur)
}

/**
 * La couleur d'une catégorie, dans le thème en cours.
 *
 * `couleur` absente ou inconnue rend le gris neutre : c'est le cas de « Sans
 * catégorie » et de la part « Autres », qui ne doivent justement pas ressembler
 * à une catégorie.
 */
export function couleurDe(couleur: string | null | undefined, sombre: boolean): string {
  if (!estEmplacementCouleur(couleur)) return sombre ? NEUTRE.sombre : NEUTRE.clair
  return sombre ? PALETTE[couleur].sombre : PALETTE[couleur].clair
}

/**
 * L'encre à poser sur une de ces couleurs : du noir, ou du blanc.
 *
 * Écrire en blanc sur les huit teintes indifféremment donne un jaune illisible
 * et un rose à la limite : le titre d'une tâche s'y devine au lieu de se lire.
 * Le choix se calcule, il ne se devine pas — on compare le contraste réel du
 * noir et du blanc sur le fond, au sens de la luminance relative WCAG, et on
 * garde le meilleur des deux.
 *
 * Cela vaut pour du texte posé **sur** une pastille colorée (un bloc du
 * planning). Un libellé posé à côté d'une pastille garde, lui, l'encre
 * ordinaire de l'interface.
 */
export function encreSur(fond: string): string {
  const luminance = luminanceRelative(fond)
  if (luminance == null) return '#ffffff'

  const surBlanc = 1.05 / (luminance + 0.05)
  const surNoir = (luminance + 0.05) / 0.05
  return surNoir >= surBlanc ? '#0b0b0b' : '#ffffff'
}

/** Luminance relative WCAG d'une couleur `#rrggbb`, ou `null` si illisible. */
function luminanceRelative(hex: string): number | null {
  const propre = hex.replace('#', '')
  if (propre.length !== 6) return null

  const canal = (paire: string) => {
    const valeur = parseInt(paire, 16) / 255
    return valeur <= 0.03928 ? valeur / 12.92 : ((valeur + 0.055) / 1.055) ** 2.4
  }

  const r = canal(propre.slice(0, 2))
  const g = canal(propre.slice(2, 4))
  const b = canal(propre.slice(4, 6))
  if ([r, g, b].some(Number.isNaN)) return null

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
