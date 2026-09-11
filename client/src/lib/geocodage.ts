/**
 * Ce qu'OpenStreetMap sait d'un point du globe.
 *
 * Écrit ici plutôt que dans la fenêtre de capture d'un plan d'espace vert, qui
 * l'abritait jusqu'ici : la cartographie du mobilier urbain pose exactement la
 * même question — « quelle est l'adresse de ce point ? » — et n'a aucune raison
 * d'importer une fenêtre modale de sept cents lignes pour obtenir une chaîne
 * de caractères.
 */

/** Ce qu'une adresse relevée apprend, au-delà de sa forme lisible. */
export interface AdresseRelevee {
  /** L'adresse complète, telle qu'on l'écrit sur une fiche. */
  complete: string
  /** La seule voie : « rue de la Gare ». C'est par elle qu'une commune tourne. */
  rue: string
  /** Le quartier ou le lieu-dit, quand OpenStreetMap en connaît un. */
  secteur: string
}

/**
 * L'adresse la plus proche d'un point.
 *
 * Rend des chaînes vides plutôt qu'une erreur : une adresse absente n'empêche
 * rien, et un rond-point ou une berge n'en a souvent aucune. Appelée une fois
 * par pose, jamais en boucle — Nominatim est gratuit et demande qu'on
 * l'économise.
 */
export async function releverAdresse(lat: number, lng: number): Promise<AdresseRelevee> {
  const vide: AdresseRelevee = { complete: '', rue: '', secteur: '' }
  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18' +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`
    const reponse = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!reponse.ok) return vide
    const lu = await reponse.json()
    const a = lu?.address
    if (!a) return { ...vide, complete: String(lu?.display_name ?? '') }

    // Une adresse française lisible plutôt que le `display_name` complet, qui
    // empile le département, la région et le pays.
    const voie = [a.house_number, a.road].filter(Boolean).join(' ')
    const commune = a.village ?? a.town ?? a.city ?? a.municipality ?? ''
    return {
      complete: [voie, a.postcode, commune].filter(Boolean).join(', '),
      rue: String(a.road ?? a.pedestrian ?? a.footway ?? ''),
      secteur: String(a.suburb ?? a.neighbourhood ?? a.quarter ?? a.hamlet ?? ''),
    }
  } catch {
    return vide
  }
}

/**
 * L'adresse la plus proche d'un point, en une seule chaîne.
 *
 * La forme qu'attendait la capture de plan. Conservée telle quelle pour ne pas
 * faire porter une reprise d'écran à un simple déménagement de fonction.
 */
export async function adresseDuPoint(lat: number, lng: number): Promise<string> {
  return (await releverAdresse(lat, lng)).complete
}
