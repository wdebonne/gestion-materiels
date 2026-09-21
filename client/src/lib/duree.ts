/**
 * Les jours et les durées, côté client.
 *
 * ⚠️ Doit rester d'accord avec `src/utils/periodes.ts`, qui fait autorité : le
 * serveur calcule les minutes qu'il enregistre, et le client ne fait que les
 * annoncer avant l'envoi. Les faire diverger afficherait « 2 h 30 » à la
 * personne et enregistrerait autre chose.
 *
 * Le découpage en semaines et en mois, lui, n'est **pas** repris ici : les
 * bornes d'un rapport sont résolues par le serveur et renvoyées avec lui. La
 * règle de la semaine ISO ne doit vivre qu'à un seul endroit, sinon le pied de
 * page d'un export finira par contredire l'écran qui l'a demandé.
 */

const MINUTES_PAR_JOUR = 1440
const FORMAT_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Aujourd'hui, tel que le voit la personne devant l'écran. */
export function jourCourant(maintenant: Date = new Date()): string {
  const annee = String(maintenant.getFullYear()).padStart(4, '0')
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0')
  const quantieme = String(maintenant.getDate()).padStart(2, '0')
  return `${annee}-${mois}-${quantieme}`
}

/**
 * Les minutes entre deux heures.
 *
 * Une fin antérieure au début désigne une tâche qui se termine le lendemain.
 * Deux heures identiques lèvent une erreur, comme sur le serveur : l'écran doit
 * alors cesser d'annoncer une durée, pas en inventer une.
 */
export function minutesEntre(heureDebut: string, heureFin: string): number {
  if (!FORMAT_HEURE.test(heureDebut) || !FORMAT_HEURE.test(heureFin)) {
    throw new Error('Heure attendue au format HH:MM.')
  }

  const enMinutes = (heure: string) => {
    const [h, m] = heure.split(':').map(Number)
    return h * 60 + m
  }

  const debut = enMinutes(heureDebut)
  const fin = enMinutes(heureFin)
  if (debut === fin) throw new Error("L'heure de fin doit différer de l'heure de début.")

  return fin > debut ? fin - debut : MINUTES_PAR_JOUR - debut + fin
}

/** Une durée telle qu'on la lit : « 2 h 30 », « 45 min », « 8 h ». */
export function formaterDuree(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const heures = Math.floor(total / 60)
  const reste = total % 60

  if (heures === 0) return `${reste} min`
  if (reste === 0) return `${heures} h`
  return `${heures} h ${String(reste).padStart(2, '0')}`
}

/** Une durée en heures décimales, pour un axe de graphique : 150 → 2,5. */
export function enHeures(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/**
 * Un jour ISO écrit en français.
 *
 * `timeZone: 'UTC'` est indispensable : la date est construite en UTC, et sans
 * lui le navigateur la reprojetterait en heure locale, ce qui affiche la veille
 * pour tout fuseau négatif.
 */
export function jourEnFrancais(jour: string, options?: Intl.DateTimeFormatOptions): string {
  const [a, m, j] = jour.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    ...(options ?? { weekday: 'long', day: 'numeric', month: 'long' }),
  })
}

/** Le jour situé `nombre` jours plus loin. */
export function decalerJours(jour: string, nombre: number): string {
  const [a, m, j] = jour.split('-').map(Number)
  const date = new Date(Date.UTC(a, m - 1, j))
  date.setUTCDate(date.getUTCDate() + nombre)
  return date.toISOString().slice(0, 10)
}

/** L'heure obtenue en avançant de `minutes`, pour les puces de durée rapide. */
export function ajouterMinutes(heure: string, minutes: number): string {
  const [h, m] = heure.split(':').map(Number)
  const total = (h * 60 + m + minutes) % MINUTES_PAR_JOUR
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
