import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { ComparaisonTemps, RapportTemps, TachePlanning } from '@/lib/api'
import { PALETTE, estEmplacementCouleur } from '@/lib/paletteCategories'
import { formaterDuree, jourEnFrancais } from '@/lib/duree'

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

const MARGE = 14
const BLEU: [number, number, number] = [2, 132, 199] // primary-600
const ENCRE: [number, number, number] = [17, 24, 39]
const ENCRE_PALE: [number, number, number] = [107, 114, 128]
const RAYURE: [number, number, number] = [243, 244, 246]

/**
 * Le signe moins, écrit avec un trait d'union.
 *
 * Les polices intégrées de jsPDF sont encodées en WinAnsi, qui ne connaît pas
 * le signe moins typographique « − » (U+2212) employé à l'écran : il ressortait
 * en guillemet suivi d'un espace, et « − 6 h » se lisait « " 6 h ». Une baisse
 * d'heures devenait indéchiffrable, ce qui est fâcheux dans un document dont
 * c'est justement le propos.
 */
function signe(valeur: number): string {
  return valeur > 0 ? '+' : '-'
}

interface Document {
  pdf: jsPDF
  largeur: number
  hauteur: number
  y: number
}

/**
 * L'échelle des captures.
 *
 * À 2, un rapport pèse dix-huit mégaoctets et ne passe plus par courriel — or
 * c'est ainsi qu'un compte rendu de réunion circule. À 1,5, les graphiques
 * restent nets à l'impression et le document tient en quelques centaines de
 * kilo-octets. Ce qui doit rester parfaitement lisible, ce sont les chiffres,
 * et ils sont écrits en texte, pas photographiés.
 */
const ECHELLE_CAPTURE = 1.5

function creer(orientation: 'p' | 'l'): Document {
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
  return {
    pdf,
    largeur: pdf.internal.pageSize.getWidth(),
    hauteur: pdf.internal.pageSize.getHeight(),
    y: MARGE,
  }
}

/** Le bandeau de tête, sur la première page. */
function bandeau(doc: Document, titre: string, periode: string, sousTitre: string) {
  const { pdf, largeur } = doc
  pdf.setFillColor(...BLEU)
  pdf.rect(0, 0, largeur, 30, 'F')

  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text(titre, MARGE, 13)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text(periode, MARGE, 21)

  pdf.setFontSize(9)
  pdf.text(sousTitre, MARGE, 27)

  doc.y = 40
}

/** Un titre de section. */
function section(doc: Document, titre: string) {
  // On réserve la place du titre **et** d’un début de contenu : sinon le titre
  // restait seul en bas de page et son tableau commençait à la suivante.
  placePour(doc, 42)
  doc.pdf.setTextColor(...ENCRE)
  doc.pdf.setFont('helvetica', 'bold')
  doc.pdf.setFontSize(12)
  doc.pdf.text(titre, MARGE, doc.y)
  doc.y += 6
}

function paragraphe(doc: Document, texte: string, pale = false) {
  const lignes = doc.pdf.splitTextToSize(texte, doc.largeur - 2 * MARGE)
  placePour(doc, lignes.length * 4.5)
  doc.pdf.setTextColor(...(pale ? ENCRE_PALE : ENCRE))
  doc.pdf.setFont('helvetica', 'normal')
  doc.pdf.setFontSize(9.5)
  doc.pdf.text(lignes, MARGE, doc.y)
  doc.y += lignes.length * 4.5 + 2
}

/** Ouvre une page si la hauteur demandée ne tient plus. */
function placePour(doc: Document, hauteur: number): boolean {
  if (doc.y + hauteur <= doc.hauteur - 18) return false
  doc.pdf.addPage()
  doc.y = MARGE
  return true
}

interface Colonne {
  titre: string
  /** Largeur relative ; la somme est ramenée à la largeur utile. */
  poids: number
  aDroite?: boolean
}

/**
 * Un tableau simple, à en-tête gris et lignes alternées.
 *
 * Une ligne peut porter une pastille de couleur : c'est ce qui rattache une
 * ligne du tableau à sa part du camembert, et le seul moyen de s'y retrouver
 * une fois le document imprimé en noir et blanc — où la pastille devient un
 * gris distinct, tandis que deux teintes voisines se confondraient.
 */
function tableau(
  doc: Document,
  colonnes: Colonne[],
  lignes: { cellules: string[]; couleur?: string; grasse?: boolean }[]
) {
  const utile = doc.largeur - 2 * MARGE
  const totalPoids = colonnes.reduce((somme, c) => somme + c.poids, 0)
  const largeurs = colonnes.map((c) => (c.poids / totalPoids) * utile)

  const enTete = () => {
    doc.pdf.setFillColor(...RAYURE)
    doc.pdf.rect(MARGE, doc.y - 4, utile, 7, 'F')
    doc.pdf.setTextColor(...ENCRE)
    doc.pdf.setFont('helvetica', 'bold')
    doc.pdf.setFontSize(8.5)
    let x = MARGE + 2
    colonnes.forEach((colonne, index) => {
      // Tronqué comme une cellule : deux titres longs dans des colonnes
      // voisines se chevauchaient, et les deux devenaient illisibles.
      const titre = doc.pdf.splitTextToSize(colonne.titre, largeurs[index] - 5)[0] ?? ''
      const aligne = colonne.aDroite ? { align: 'right' as const } : undefined
      doc.pdf.text(titre, colonne.aDroite ? x + largeurs[index] - 4 : x, doc.y, aligne)
      x += largeurs[index]
    })
    doc.y += 6
  }

  placePour(doc, 16)
  enTete()

  for (const ligne of lignes) {
    if (placePour(doc, 8)) enTete()

    doc.pdf.setFont('helvetica', ligne.grasse ? 'bold' : 'normal')
    doc.pdf.setFontSize(8.5)
    doc.pdf.setTextColor(...ENCRE)

    let x = MARGE + 2
    ligne.cellules.forEach((cellule, index) => {
      let texte = cellule
      let decalage = 0

      // La pastille précède la première cellule, qui porte le libellé.
      if (index === 0 && ligne.couleur) {
        const [r, v, b] = enRvb(ligne.couleur)
        doc.pdf.setFillColor(r, v, b)
        doc.pdf.circle(x + 1.3, doc.y - 1, 1.3, 'F')
        decalage = 4.5
      }

      const largeurTexte = largeurs[index] - 5 - decalage
      texte = doc.pdf.splitTextToSize(texte, Math.max(10, largeurTexte))[0] ?? ''

      if (colonnes[index].aDroite) {
        doc.pdf.text(texte, x + largeurs[index] - 4, doc.y, { align: 'right' })
      } else {
        doc.pdf.text(texte, x + decalage, doc.y)
      }
      x += largeurs[index]
    })

    doc.y += 5.5
  }

  doc.y += 4
}

/** Un emplacement de palette en composantes, pour jsPDF. */
function enRvb(couleur: string): [number, number, number] {
  const hex = estEmplacementCouleur(couleur) ? PALETTE[couleur].clair : '#94a3b8'
  const propre = hex.replace('#', '')
  return [
    parseInt(propre.slice(0, 2), 16),
    parseInt(propre.slice(2, 4), 16),
    parseInt(propre.slice(4, 6), 16),
  ]
}

/** La pagination et la provenance, sur chaque page, à la toute fin. */
function piedDePage(doc: Document) {
  const total = doc.pdf.getNumberOfPages()
  const genere = `Gestion Matériels — généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`

  for (let page = 1; page <= total; page += 1) {
    doc.pdf.setPage(page)
    doc.pdf.setFont('helvetica', 'normal')
    doc.pdf.setFontSize(8)
    doc.pdf.setTextColor(...ENCRE_PALE)
    doc.pdf.text(genere, MARGE, doc.hauteur - 8)
    doc.pdf.text(`${page} / ${total}`, doc.largeur - MARGE, doc.hauteur - 8, { align: 'right' })
  }
}

/**
 * Photographie un élément de la page, en thème clair.
 *
 * Retirer la classe `dark` ne suffit pas : les couleurs de Recharts sont des
 * attributs SVG calculés en JavaScript, et React doit redessiner. On laisse donc
 * passer deux images avant de photographier, et on rend le thème d'origine
 * quoi qu'il arrive — une capture qui échoue ne doit pas laisser l'application
 * en clair chez quelqu'un qui l'avait mise en sombre.
 */
async function photographier(element: HTMLElement): Promise<HTMLCanvasElement> {
  const racine = document.documentElement
  const etaitSombre = racine.classList.contains('dark')

  if (etaitSombre) {
    racine.classList.remove('dark')
    await new Promise((resoudre) => requestAnimationFrame(() => requestAnimationFrame(resoudre)))
    await new Promise((resoudre) => setTimeout(resoudre, 250))
  }

  try {
    return await html2canvas(element, {
      scale: ECHELLE_CAPTURE,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    })
  } finally {
    if (etaitSombre) racine.classList.add('dark')
  }
}

/** Pose une capture, en l'ajustant à la largeur utile. */
async function poserCapture(doc: Document, element: HTMLElement | null) {
  if (!element) return
  const canvas = await photographier(element)
  const largeur = doc.largeur - 2 * MARGE
  const hauteur = (canvas.height * largeur) / canvas.width

  placePour(doc, hauteur)
  const hauteurPosee = Math.min(hauteur, doc.hauteur - doc.y - 18)
  doc.pdf.addImage(canvas.toDataURL('image/png'), 'PNG', MARGE, doc.y, largeur, hauteurPosee)
  doc.y += hauteurPosee + 6
}

function telecharger(doc: Document, nom: string) {
  piedDePage(doc)
  doc.pdf.save(nom)
}

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
