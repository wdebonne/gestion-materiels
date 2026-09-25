import { ComparaisonTemps, RapportTemps, TachePlanning } from '@/lib/api'
import { formaterDuree, jourEnFrancais } from '@/lib/duree'
import {
  MARGE,
  ENCRE,
  signe,
  creer,
  bandeau,
  section,
  paragraphe,
  placePour,
  tableau,
  poserCapture,
  telecharger,
} from '@/lib/pdf/document'

/**
 * Les deux PDF du module : le planning d'une période, et le rapport d'activité.
 *
 * Ils ne servent pas la même chose. Le **planning** se pose sur une table
 * d'atelier ou s'affiche au mur : on y lit qui fait quoi et quand, et il
 * s'imprime en paysage parce qu'une semaine a sept colonnes. Le **rapport** se
 * projette ou se distribue en réunion : il répond à « où est passé le temps »,
 * et se lit en portrait comme une note.
 *
 * Deux précautions valent d'être expliquées.
 *
 * **Le thème clair est forcé le temps de la capture.** `html2canvas` photographie
 * le DOM tel qu'il est : en thème sombre, il rendait un graphique clair sur le
 * fond blanc imposé au PDF — donc des libellés gris pâle illisibles — ou, pire,
 * un aplat noir qui vide une cartouche d'encre. On retire la classe `dark` le
 * temps de photographier, on laisse React redessiner les couleurs claires de la
 * palette, puis on la remet. La personne ne voit qu'un bref changement.
 *
 * **Le PDF dit toujours quelle mesure il compte.** « 37 h » ne veut pas dire la
 * même chose selon qu'on additionne les contributions de tout le monde ou les
 * heures d'une seule personne. Sur un écran, le sélecteur est sous les yeux ;
 * sur une feuille passée de main en main, il n'y a plus que ce qui est écrit.
 */

// ============================================================ le planning

export interface OptionsPlanningPdf {
  grille: HTMLElement | null
  taches: TachePlanning[]
  periode: string
  /** Qui l'on regarde, ou « Tout le monde ». */
  perimetre: string
  /** Le temps de chaque journée, tel que l'écran l'affiche. */
  minutesParJour: Map<string, number>
}

/**
 * Le planning d'une période : la grille telle qu'à l'écran, puis le détail.
 *
 * En paysage, parce qu'une semaine a sept colonnes et qu'un portrait les
 * écraserait. La grille montre la forme de la semaine ; le tableau qui suit
 * dit ce que les blocs trop courts n'ont pas pu écrire, et reste lisible une
 * fois photocopié.
 */
export async function exporterPlanningPdf(options: OptionsPlanningPdf) {
  const doc = creer('l')
  const total = [...options.minutesParJour.values()].reduce((somme, m) => somme + m, 0)

  bandeau(
    doc,
    'Planning',
    options.periode,
    `${options.perimetre} — ${formaterDuree(total)} sur la période`
  )

  await poserCapture(doc, options.grille)

  // ------------------------------------------------------------- le détail

  if (options.taches.length === 0) {
    paragraphe(doc, 'Aucune heure saisie sur cette période.', true)
    telecharger(doc, `planning_${new Date().toISOString().slice(0, 10)}.pdf`)
    return
  }

  section(doc, 'Détail des tâches')

  const parJour = new Map<string, TachePlanning[]>()
  for (const tache of [...options.taches].sort(comparerTaches)) {
    if (!parJour.has(tache.jour)) parJour.set(tache.jour, [])
    parJour.get(tache.jour)!.push(tache)
  }

  for (const [jour, duJour] of [...parJour.entries()].sort()) {
    placePour(doc, 20)
    doc.pdf.setFont('helvetica', 'bold')
    doc.pdf.setFontSize(10)
    doc.pdf.setTextColor(...ENCRE)
    const minutes = options.minutesParJour.get(jour) ?? 0
    doc.pdf.text(
      `${majuscule(jourEnFrancais(jour))}${minutes > 0 ? ` — ${formaterDuree(minutes)}` : ''}`,
      MARGE,
      doc.y
    )
    doc.y += 6

    tableau(
      doc,
      [
        { titre: 'Horaire', poids: 1.6 },
        { titre: 'Catégorie', poids: 2.2 },
        { titre: 'Ce qui a été fait', poids: 3.4 },
        { titre: 'Manifestation', poids: 2 },
        { titre: 'Avec', poids: 2.4 },
        { titre: 'Durée', poids: 1, aDroite: true },
        { titre: 'Mobilisé', poids: 1, aDroite: true },
      ],
      duJour.map((tache) => ({
        couleur: tache.categorie?.couleur,
        cellules: [
          // Sans espaces autour du trait : « 13:30 – 15:00 » ne tenait pas dans
          // la colonne et l’heure de fin était coupée.
          tache.heureDebut && tache.heureFin ? `${tache.heureDebut}-${tache.heureFin}` : 'Sans horaire',
          tache.categorie?.nom ?? 'Sans catégorie',
          tache.description ?? '',
          tache.manifestation?.titre ?? '',
          tache.participants
            .map((p) => `${p.personne?.nom ?? p.libelle} (${formaterDuree(p.minutes)})`)
            .join(', '),
          formaterDuree(tache.minutes),
          tache.participants.length > 0 ? formaterDuree(tache.minutesMobilisees) : '',
        ],
      }))
    )
  }

  telecharger(doc, `planning_${new Date().toISOString().slice(0, 10)}.pdf`)
}

function comparerTaches(a: TachePlanning, b: TachePlanning): number {
  if (a.jour !== b.jour) return a.jour < b.jour ? -1 : 1
  return (a.heureDebut ?? '').localeCompare(b.heureDebut ?? '')
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

// =========================================================== le rapport

export interface OptionsRapportPdf {
  rapport: RapportTemps
  comparaison: ComparaisonTemps | null
  /**
   * Le camembert **seul**, sans le tableau qui l'accompagne à l'écran.
   *
   * Photographier le tableau aussi alourdissait le document et rendait ses
   * chiffres flous à l'impression, alors qu'ils sont ce qu'on vient y lire.
   * Ils sont donc réécrits en texte : nets, sélectionnables, et cherchables.
   */
  repartition: HTMLElement | null
  /** Les parts telles que l'écran les montre, regroupement « Autres » compris. */
  parts: { id: number | null; libelle: string; couleur?: string; minutes: number; part: number | null }[]
  /** La carte des écarts, quand une comparaison est demandée. */
  ecarts: HTMLElement | null
  /** La carte d'évolution. */
  evolution: HTMLElement | null
  perimetre: string
  /** Le nom de l'axe affiché : catégorie, personne, manifestation. */
  axe: string
}

/**
 * Le rapport d'activité, en portrait, prêt à distribuer en réunion.
 *
 * L'ordre suit celui de l'écran, pour que personne n'ait à retrouver ses repères
 * en passant de la projection au papier : les totaux, la répartition, l'écart
 * avec la période comparée, puis l'évolution.
 */
export async function exporterRapportPdf(options: OptionsRapportPdf) {
  const { rapport, comparaison } = options
  const doc = creer('p')

  const mesure =
    rapport.mesure === 'mobilise'
      ? 'Temps total mobilisé'
      : "Temps d'une personne"

  bandeau(doc, "Rapport d'activité", rapport.periode.libelle, `${options.perimetre} — ${mesure}`)

  // Ce que le sélecteur explique à l'écran doit rester écrit sur le papier :
  // sans cette phrase, « 37 h » se lit de deux façons différentes.
  paragraphe(
    doc,
    rapport.mesure === 'mobilise'
      ? "Chaque contributeur d'une tâche est compté : deux agents une heure sur la même tâche font deux heures de travail mobilisé."
      : "Seul le temps de la personne retenue est compté, qu'elle ait mené la tâche ou seulement prêté main-forte.",
    true
  )

  // ------------------------------------------------------------ les totaux

  section(doc, 'Vue d’ensemble')

  const lignesTotaux: { cellules: string[]; grasse?: boolean }[] = [
    { cellules: [mesure, formaterDuree(rapport.total.minutes)], grasse: true },
    { cellules: ['Tâches saisies', String(rapport.total.taches)] },
    { cellules: ['Personnes ayant contribué', String(rapport.total.personnes)] },
    {
      cellules: [
        'Catégorie dominante',
        rapport.parCategorie[0]
          ? `${rapport.parCategorie[0].libelle} (${formaterDuree(rapport.parCategorie[0].minutes)})`
          : '—',
      ],
    },
  ]

  if (comparaison) {
    const { minutes, pourcentage } = comparaison.ecart
    lignesTotaux.push({
      cellules: [
        `Écart avec ${comparaison.reference.periode.libelle}`,
        minutes === 0
          ? 'Identique'
          : `${signe(minutes)}${formaterDuree(Math.abs(minutes))}` +
            (pourcentage == null ? ' (nouveau)' : ` (${pourcentage > 0 ? '+' : ''}${pourcentage} %)`),
      ],
    })
  }

  tableau(doc, [{ titre: '', poids: 3 }, { titre: '', poids: 1.4, aDroite: true }], lignesTotaux)

  // ------------------------------------------------------- la répartition

  section(doc, `Répartition par ${options.axe}`)
  await poserCapture(doc, options.repartition)

  tableau(
    doc,
    [
      { titre: majuscule(options.axe), poids: 3 },
      { titre: 'Durée', poids: 1.2, aDroite: true },
      { titre: 'Part', poids: 1, aDroite: true },
    ],
    [
      ...options.parts.map((part) => ({
        couleur: part.couleur,
        cellules: [
          part.libelle,
          formaterDuree(part.minutes),
          part.part == null ? '—' : `${Math.round(part.part * 1000) / 10} %`,
        ],
      })),
      {
        cellules: [
          'Total',
          formaterDuree(rapport.total.minutes),
          rapport.total.minutes > 0 ? '100 %' : '—',
        ],
        grasse: true,
      },
    ]
  )

  // ------------------------------------------------------------- l'écart

  if (comparaison) {
    section(doc, 'Écart par catégorie')
    paragraphe(
      doc,
      `${rapport.periode.libelle} comparé à ${comparaison.reference.periode.libelle}.`,
      true
    )

    tableau(
      doc,
      [
        { titre: 'Catégorie', poids: 3 },
        { titre: 'Période', poids: 1.2, aDroite: true },
        { titre: 'Comparée', poids: 1.2, aDroite: true },
        { titre: 'Écart', poids: 1.2, aDroite: true },
      ],
      comparaison.parCategorie
        .filter((c) => c.minutes > 0 || c.minutesReference > 0)
        .map((c) => ({
          couleur: c.couleur,
          cellules: [
            c.libelle,
            formaterDuree(c.minutes),
            formaterDuree(c.minutesReference),
            c.ecart === 0
              ? '='
              : `${signe(c.ecart)}${formaterDuree(Math.abs(c.ecart))}`,
          ],
        }))
    )

    await poserCapture(doc, options.ecarts)
  }

  // ---------------------------------------------------------- l'évolution

  if (rapport.parPeriode.length > 1) {
    section(doc, 'Évolution')
    await poserCapture(doc, options.evolution)
  }

  telecharger(doc, `rapport_heures_${rapport.periode.debut}.pdf`)
}
