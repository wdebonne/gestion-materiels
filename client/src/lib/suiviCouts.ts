import { Fuel, Wrench, ClipboardCheck, TreePine, Building2, PartyPopper } from 'lucide-react'

/**
 * Les sources du Suivi des coûts, décrites une fois pour l'écran et pour
 * l'export PDF : libellé, couleur, et les noms que chacune porte dans les
 * réponses de `/api/tracking` (voir `CLES` dans `suiviCouts.service.ts`).
 */

export type SourceSuivi = 'fuel' | 'maintenance' | 'technical_control' | 'green_space' | 'buildings' | 'events'

export interface DescriptionSource {
  id: SourceSuivi
  libelle: string
  icone: React.ElementType
  /** Couleur des graphiques. */
  couleur: string
  /** Couleur des cartes (`StatCard`). */
  teinte: string
  /** Bouton du filtre, quand la source est cochée. */
  classesActif: string
  /** Couleur du texte des montants, dans les cartes de comparaison. */
  classesTexte: string
  /** Remplissage des cartes du PDF, puis couleur du texte. */
  pdf: { fond: [number, number, number]; texte: [number, number, number] }
  /** Clé du résumé (`totalFuelCost`), d'un point de série (`fuelCost`), de la comparaison annuelle (`fuel`), du compte (`fuelEntryCount`). */
  total: string
  serie: string
  annuel: string
  nombre: string
  /** Les sources du parc sont les seules que filtrent catégories et objets. */
  parc: boolean
}

export const SOURCES_SUIVI: DescriptionSource[] = [
  {
    id: 'fuel', libelle: 'Carburant', icone: Fuel, couleur: '#f59e0b', teinte: 'amber',
    classesActif: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    classesTexte: 'text-amber-600 dark:text-amber-400',
    pdf: { fond: [254, 243, 199], texte: [146, 64, 14] },
    total: 'totalFuelCost', serie: 'fuelCost', annuel: 'fuel', nombre: 'fuelEntryCount', parc: true,
  },
  {
    id: 'maintenance', libelle: 'Entretiens', icone: Wrench, couleur: '#3b82f6', teinte: 'blue',
    classesActif: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
    classesTexte: 'text-blue-600 dark:text-blue-400',
    pdf: { fond: [219, 234, 254], texte: [30, 64, 175] },
    total: 'totalMaintenanceCost', serie: 'maintenanceCost', annuel: 'maintenance', nombre: 'maintenanceCount', parc: true,
  },
  {
    id: 'technical_control', libelle: 'Contrôles techniques', icone: ClipboardCheck, couleur: '#10b981', teinte: 'green',
    classesActif: 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-200',
    classesTexte: 'text-green-600 dark:text-green-400',
    pdf: { fond: [209, 250, 229], texte: [6, 95, 70] },
    total: 'totalControlCost', serie: 'controlCost', annuel: 'control', nombre: 'controlCount', parc: true,
  },
  {
    id: 'green_space', libelle: 'Espaces verts', icone: TreePine, couleur: '#65a30d', teinte: 'lime',
    classesActif: 'border-lime-300 bg-lime-50 text-lime-700 dark:border-lime-700 dark:bg-lime-900/30 dark:text-lime-200',
    classesTexte: 'text-lime-700 dark:text-lime-400',
    pdf: { fond: [236, 252, 203], texte: [63, 98, 18] },
    total: 'totalGreenSpaceCost', serie: 'greenSpaceCost', annuel: 'greenSpace', nombre: 'greenSpaceCount', parc: false,
  },
  {
    id: 'buildings', libelle: 'Bâtiments', icone: Building2, couleur: '#78716c', teinte: 'stone',
    classesActif: 'border-stone-400 bg-stone-100 text-stone-800 dark:border-stone-500 dark:bg-stone-800/60 dark:text-stone-100',
    classesTexte: 'text-stone-600 dark:text-stone-300',
    pdf: { fond: [231, 229, 228], texte: [68, 64, 60] },
    total: 'totalBuildingCost', serie: 'buildingCost', annuel: 'buildings', nombre: 'buildingCount', parc: false,
  },
  {
    id: 'events', libelle: 'Manifestations', icone: PartyPopper, couleur: '#ec4899', teinte: 'pink',
    classesActif: 'border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-700 dark:bg-pink-900/30 dark:text-pink-200',
    classesTexte: 'text-pink-600 dark:text-pink-400',
    pdf: { fond: [252, 231, 243], texte: [157, 23, 77] },
    total: 'totalEventCost', serie: 'eventCost', annuel: 'events', nombre: 'eventCount', parc: false,
  },
]

export const TOUTES_LES_SOURCES: SourceSuivi[] = SOURCES_SUIVI.map((s) => s.id)

export const sourceSuivi = (id: SourceSuivi) => SOURCES_SUIVI.find((s) => s.id === id)!

/** Les catégories de dépense d'un bâtiment, dans l'ordre des colonnes. */
export const CATEGORIES_BATIMENT: { id: 'energie' | 'contrats' | 'interventions' | 'controles'; libelle: string; couleur: string }[] = [
  { id: 'energie', libelle: 'Énergie', couleur: '#f97316' },
  { id: 'contrats', libelle: 'Contrats', couleur: '#6366f1' },
  { id: 'interventions', libelle: 'Interventions', couleur: '#0ea5e9' },
  { id: 'controles', libelle: 'Contrôles', couleur: '#14b8a6' },
]

/**
 * Un jour ISO `YYYY-MM-DD` en date française, sans passer par `new Date()` :
 * `new Date('2026-03-18')` est minuit UTC, donc la veille à l'ouest de
 * Greenwich. Accepte aussi un horodatage complet (colonne `DATE` de MySQL).
 */
export function jourFr(valeur: string | null | undefined): string {
  if (!valeur) return '-'
  if (/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
    const [a, m, j] = valeur.split('-')
    return `${j}/${m}/${a}`
  }
  const date = new Date(valeur)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR')
}

/** Aujourd'hui en `YYYY-MM-DD`, selon l'horloge de l'écran et non en UTC. */
export function jourLocal(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const j = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${j}`
}
