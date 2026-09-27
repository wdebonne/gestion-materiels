import { EMPLACEMENTS_COULEUR, PALETTE } from '@/lib/paletteCategories'

/**
 * Ce que l'écran du rapport et son PDF partagent : la forme des données, les
 * durées lisibles, le regroupement « autres » et les teintes.
 *
 * Un seul endroit, parce que la pastille d'une ligne du PDF doit être celle de
 * sa barre à l'écran. Deux calculs séparés finiraient par diverger, et une
 * catégorie changerait de couleur entre la projection et le papier.
 */

export interface LigneRepartition {
  cle: string
  libelle: string
  total: number
  part: number
}

export interface DelaisRapport {
  mesurees: number
  medianeMinutes: number | null
  moyenneMinutes: number | null
  dansLesDelais: number
  horsDelais: number
}

export interface RapportDemandes {
  periode: { debut: string; fin: string }
  ouvertes: number
  closes: number
  enCours: number
  enRetard: number
  priseEnCharge: DelaisRapport
  resolution: DelaisRapport
  parCategorie: LigneRepartition[]
  parBatiment: LigneRepartition[]
  parTechnicien: LigneRepartition[]
  parService: LigneRepartition[]
  parDemandeur: LigneRepartition[]
  tempsPasseMinutes: number
  tempsParCategorie: LigneRepartition[]
}

/** Barres horizontales ou camembert : le choix vaut pour l'écran et le PDF. */
export type FormeGraphique = 'barres' | 'camembert'

/**
 * Les répartitions, dans l'ordre de l'écran.
 *
 * `parIdentite` : la couleur désigne une entité qui garde la sienne d'un écran
 * à l'autre. Seule la catégorie en a une ; les autres comparent une grandeur,
 * et une seule teinte leur suffit — sauf en camembert, où des parts de même
 * couleur ne se distingueraient plus.
 */
export const REPARTITIONS = [
  { id: 'categorie', titre: 'Par catégorie', champ: 'parCategorie', colonne: 'Catégorie', parIdentite: true },
  { id: 'batiment', titre: 'Par bâtiment', champ: 'parBatiment', colonne: 'Bâtiment', parIdentite: false },
  { id: 'service', titre: 'Par service', champ: 'parService', colonne: 'Service', parIdentite: false },
  { id: 'demandeur', titre: 'Par demandeur', champ: 'parDemandeur', colonne: 'Demandeur', parIdentite: false },
  { id: 'technicien', titre: 'Par technicien', champ: 'parTechnicien', colonne: 'Technicien', parIdentite: false },
] as const

export type IdRepartition = (typeof REPARTITIONS)[number]['id']

/** Des minutes en durée lisible. « 2 h 30 », jamais « 150 ». */
export function formaterDuree(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes} min`
  const heures = Math.floor(minutes / 60)
  const reste = minutes % 60
  if (heures < 24) return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, '0')}`
  const jours = Math.floor(heures / 24)
  return `${jours} j ${heures % 24} h`
}

export const CLE_AUTRES = '__autres__'

/**
 * Les huit premières lignes, puis le reste en une seule.
 *
 * Au-delà de huit, deux barres ou deux parts partageraient une teinte : le
 * reste est regroupé plutôt que recolorié au hasard. Les libellés restent
 * exacts, et le tableau qui accompagne le graphique garde le détail.
 */
export function regrouper(lignes: LigneRepartition[], visibles = 8): LigneRepartition[] {
  const affichees = lignes.slice(0, visibles)
  const reste = lignes.slice(visibles)
  if (reste.length === 0) return affichees
  return [
    ...affichees,
    {
      cle: CLE_AUTRES,
      libelle: `${reste.length} autre(s)`,
      total: reste.reduce((t, l) => t + l.total, 0),
      part: reste.reduce((t, l) => t + l.part, 0),
    },
  ]
}

/** La teinte d'un rang, dans l'ordre fixe de la palette. */
export function teinteDuRang(rang: number, sombre: boolean): string {
  const emplacement = EMPLACEMENTS_COULEUR[rang % EMPLACEMENTS_COULEUR.length]
  return sombre ? PALETTE[emplacement].sombre : PALETTE[emplacement].clair
}

/**
 * La teinte d'une ligne, décidée au même endroit pour le graphique et pour le
 * tableau. Le regroupement « autres » est neutre : il ne désigne pas une
 * entité, il en cache plusieurs.
 */
export function teintePour(
  ligne: { cle: string },
  rang: number,
  sombre: boolean,
  multicolore: boolean
): string {
  if (ligne.cle === CLE_AUTRES) return sombre ? '#64748b' : '#94a3b8'
  if (multicolore) return teinteDuRang(rang, sombre)
  return sombre ? PALETTE.bleu.sombre : PALETTE.bleu.clair
}

/** « 2026-09-01 » en « 1 septembre 2026 ». */
export function dateEnFrancais(iso: string): string {
  const [a, m, j] = iso.split('-').map(Number)
  if (!a || !m || !j) return iso
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
