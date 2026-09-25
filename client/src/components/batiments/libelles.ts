import type {
  CategorieStat,
  Energie,
  NatureIntervention,
  NatureRubrique,
  ResultatControle,
  StatutContrat,
  StatutDocumentBatiment,
  StatutSuivi,
} from '@/lib/api'

/**
 * Les mots du module Bâtiments, écrits une fois.
 *
 * L'écran d'un bâtiment, la file de validation, les réglages et — demain — le
 * portail des entreprises disent tous « à jour », « en retard », « avec
 * réserves ». Les écrire à chaque endroit les ferait diverger d'un accent.
 */

export const NATURES: Record<NatureRubrique, string> = {
  controle: 'Contrôle',
  rapport: 'Rapport',
  facture: 'Facture',
  contrat: 'Contrat',
  autre: 'Autre',
}

export const RESULTATS: Record<ResultatControle, string> = {
  conforme: 'Conforme',
  reserves: 'Avec réserves',
  non_conforme: 'Non conforme',
}

export const STATUTS_DOCUMENT: Record<StatutDocumentBatiment, string> = {
  a_valider: 'À valider',
  valide: 'Validé',
  refuse: 'Refusé',
}

export const STATUTS_SUIVI: Record<StatutSuivi, { libelle: string; variante: 'danger' | 'warning' | 'success' | 'default' }> = {
  en_retard: { libelle: 'En retard', variante: 'danger' },
  non_conforme: { libelle: 'Réserves à lever', variante: 'warning' },
  bientot: { libelle: 'À prévoir', variante: 'warning' },
  a_jour: { libelle: 'À jour', variante: 'success' },
  jamais: { libelle: 'À planifier', variante: 'default' },
}

/**
 * Les périodicités proposées d'emblée. Une valeur hors liste reste possible :
 * le formulaire propose alors « autre », en mois.
 */
export const PERIODICITES: { value: number; label: string }[] = [
  { value: 3, label: 'Tous les 3 mois' },
  { value: 6, label: 'Tous les 6 mois' },
  { value: 12, label: 'Tous les ans' },
  { value: 24, label: 'Tous les 2 ans' },
  { value: 36, label: 'Tous les 3 ans' },
  { value: 60, label: 'Tous les 5 ans' },
  { value: 120, label: 'Tous les 10 ans' },
]

/** Les délais de rappel proposés d'emblée, en jours. */
export const RAPPELS: { value: number; label: string }[] = [
  { value: 7, label: '1 semaine avant' },
  { value: 15, label: '15 jours avant' },
  { value: 30, label: '1 mois avant' },
  { value: 60, label: '2 mois avant' },
  { value: 90, label: '3 mois avant' },
  { value: 180, label: '6 mois avant' },
]

export function libellePeriodicite(mois: number | null): string {
  if (!mois) return 'Sans échéance'
  const connue = PERIODICITES.find((p) => p.value === mois)
  if (connue) return connue.label
  if (mois % 12 === 0) return `Tous les ${mois / 12} ans`
  return `Tous les ${mois} mois`
}

export function libelleRappel(jours: number): string {
  const connu = RAPPELS.find((r) => r.value === jours)
  return connu ? connu.label : `${jours} jours avant`
}

/** « 01/10/2026 », depuis un jour `AAAA-MM-JJ` ; sans conversion de fuseau. */
export function jourFr(jour: string | null | undefined): string {
  if (!jour) return '—'
  const [a, m, j] = jour.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

/**
 * Le même calcul que `decalerMois` côté serveur, pour annoncer l'échéance avant
 * d'enregistrer : borné à la fin du mois, jamais débordant sur le suivant.
 */
export function ajouterMois(jour: string, mois: number): string {
  const [a, m, j] = jour.split('-').map(Number)
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1))
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate()
  cible.setUTCDate(Math.min(j, dernier))
  return cible.toISOString().slice(0, 10)
}

/** « dans 7 jours », « il y a 3 jours », « aujourd'hui ». */
export function delaiRelatif(jours: number | null): string {
  if (jours === null) return ''
  if (jours === 0) return "aujourd'hui"
  if (jours === 1) return 'demain'
  if (jours > 0) return `dans ${jours} jours`
  if (jours === -1) return 'hier'
  return `il y a ${-jours} jours`
}

export function tailleLisible(octets: number | null): string {
  if (!octets) return ''
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

// ------------------------------------------------ énergie, contrats, interventions

/** Le libellé, l'unité proposée, et une couleur tenue d'un graphique à l'autre. */
export const ENERGIES: Record<Energie, { libelle: string; unite: string; couleur: string }> = {
  electricite: { libelle: 'Électricité', unite: 'kWh', couleur: '#f59e0b' },
  gaz: { libelle: 'Gaz', unite: 'kWh', couleur: '#3b82f6' },
  eau: { libelle: 'Eau', unite: 'm3', couleur: '#06b6d4' },
  fioul: { libelle: 'Fioul', unite: 'L', couleur: '#78716c' },
  chaleur: { libelle: 'Réseau de chaleur', unite: 'kWh', couleur: '#ef4444' },
  autre: { libelle: 'Autre', unite: '', couleur: '#8b5cf6' },
}

export const NATURES_INTERVENTION: Record<NatureIntervention, string> = {
  entretien: 'Entretien',
  depannage: 'Dépannage',
  travaux: 'Travaux',
  controle: 'Contrôle',
  nettoyage: 'Nettoyage',
  autre: 'Autre',
}

export const STATUTS_CONTRAT: Record<StatutContrat, { libelle: string; variante: 'danger' | 'warning' | 'success' | 'default' }> = {
  a_resilier: { libelle: 'Préavis proche', variante: 'warning' },
  se_termine: { libelle: 'Se termine bientôt', variante: 'warning' },
  echu: { libelle: 'Échu', variante: 'danger' },
  actif: { libelle: 'En cours', variante: 'success' },
  sans_fin: { libelle: 'Sans date de fin', variante: 'default' },
  inactif: { libelle: 'Désactivé', variante: 'default' },
}

/** Les catégories de dépenses des statistiques, avec leur couleur. */
export const CATEGORIES_STAT: Record<CategorieStat, { libelle: string; couleur: string }> = {
  energie: { libelle: 'Énergie', couleur: '#f59e0b' },
  contrats: { libelle: 'Contrats', couleur: '#6366f1' },
  interventions: { libelle: 'Interventions', couleur: '#10b981' },
  controles: { libelle: 'Contrôles', couleur: '#ef4444' },
  achats: { libelle: 'Achats', couleur: '#0ea5e9' },
}

const FORMAT_EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** « 1 234,50 € » ; un tiret pour un montant inconnu. */
export function euros(montant: number | null | undefined): string {
  return montant === null || montant === undefined ? '—' : FORMAT_EUROS.format(montant)
}

/** « 12 345,6 kWh ». */
export function quantite(valeur: number | null | undefined, unite?: string | null): string {
  if (valeur === null || valeur === undefined) return '—'
  return `${FORMAT_NOMBRE.format(valeur)}${unite ? ` ${unite === 'm3' ? 'm³' : unite}` : ''}`
}

/** L'évolution d'une année sur l'autre, en pourcentage ; `null` sans point de comparaison. */
export function evolution(actuel: number, precedent: number): number | null {
  if (!precedent) return null
  return Math.round(((actuel - precedent) / Math.abs(precedent)) * 1000) / 10
}

/** Un nombre saisi à la française (« 1 234,5 ») ; vide = `null`. */
export function lireNombre(saisie: string): number | null {
  const propre = saisie.replace(/\s/g, '').replace(',', '.')
  if (!propre) return null
  const n = Number(propre)
  return Number.isFinite(n) ? n : null
}

/** Les formats acceptés au dépôt — les mêmes que le serveur, sans SVG. */
export const FORMATS_ACCEPTES = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.odt,.ods'
