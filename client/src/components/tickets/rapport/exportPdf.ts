import {
  MARGE,
  ENCRE,
  ENCRE_PALE,
  RAYURE,
  creer,
  bandeau,
  section,
  paragraphe,
  placePour,
  tableau,
  enRvb,
  telecharger,
  type Document,
} from '@/lib/pdf/document'
import {
  REPARTITIONS,
  CLE_AUTRES,
  dateEnFrancais,
  formaterDuree,
  regrouper,
  teintePour,
  type DelaisRapport,
  type FormeGraphique,
  type IdRepartition,
  type LigneRepartition,
  type RapportDemandes,
} from './commun'

/**
 * Le rapport des demandes, en PDF.
 *
 * ## Trois longueurs, pour trois usages
 *
 * - **Court** : une feuille qu'on glisse dans un parapheur. Les chiffres clés,
 *   les délais, et les cinq premières lignes de chaque répartition, sans
 *   graphique — un graphique réduit à un timbre-poste n'apprend rien.
 * - **Normal** : le compte rendu de réunion. Chaque répartition a son
 *   graphique et ses quinze premières lignes, à la suite.
 * - **Complet** : le dossier. La synthèse en première page, puis **une page
 *   par répartition**, graphique en grand et tableau intégral — c'est la
 *   version qu'on annote, et qu'on sépare pour la donner à chaque service.
 *
 * ## Les graphiques sont dessinés, pas photographiés
 *
 * Les autres PDF de l'application photographient l'écran. Ici, on peut choisir
 * des sections que l'écran n'affiche pas sous cette forme, et un camembert
 * alors que l'écran montre des barres : on les trace donc directement en
 * vecteurs. Ils restent nets à toutes les tailles, le document pèse quelques
 * dizaines de kilo-octets, et le thème sombre de l'écran n'entre pas en jeu.
 */

export type FormatRapport = 'court' | 'normal' | 'complet'

export type SectionRapport = 'chiffres' | 'delais' | IdRepartition | 'temps'

export interface OptionsExportRapport {
  format: FormatRapport
  forme: FormeGraphique
  sections: SectionRapport[]
}

/** Combien de lignes le tableau d'une répartition garde, selon la longueur. */
const LIGNES_PAR_FORMAT: Record<FormatRapport, number> = {
  court: 5,
  normal: 15,
  complet: Infinity,
}

const LIBELLE_FORMAT: Record<FormatRapport, string> = {
  court: 'Rapport condensé',
  normal: 'Rapport',
  complet: 'Rapport complet',
}

export function exporterRapportTicketsPdf(rapport: RapportDemandes, options: OptionsExportRapport) {
  const { format, forme } = options
  const retenue = (s: SectionRapport) => options.sections.includes(s)
  const doc = creer('p')

  bandeau(
    doc,
    'Rapport des demandes',
    `Du ${dateEnFrancais(rapport.periode.debut)} au ${dateEnFrancais(rapport.periode.fin)}`,
    `${LIBELLE_FORMAT[format]} — ${rapport.ouvertes} demande(s) ouvertes sur la période, dans le périmètre de l'auteur`
  )

  // ---------------------------------------------------------- la synthèse

  if (retenue('chiffres')) {
    section(doc, 'Chiffres clés')
    chiffresCles(doc, rapport)
  }

  if (retenue('delais')) {
    section(doc, 'Délais')
    delais(doc, rapport)
  }

  // ------------------------------------------------------ les répartitions

  // En complet, chaque répartition ouvre sa page — sauf si rien ne la précède,
  // pour ne pas laisser la première page vide sous son bandeau.
  let dejaEcrit = retenue('chiffres') || retenue('delais')

  for (const repartition of REPARTITIONS) {
    if (!retenue(repartition.id)) continue
    const lignes = rapport[repartition.champ] as LigneRepartition[]

    const hauteurGraphique = format === 'complet' ? 110 : 62
    // Sans graphique, la couleur ne rattache une ligne à rien : seule la
    // catégorie garde la sienne, qui est son identité.
    const multicolore = format !== 'court' && forme === 'camembert' ? true : repartition.parIdentite

    if (format === 'complet' && dejaEcrit) {
      nouvellePage(doc)
    } else {
      // Le titre, le graphique et le début du tableau vont ensemble : sinon le
      // titre restait seul en bas de page, ou le tableau n'y laissait que son
      // en-tête et une ligne.
      const graphique = format === 'court' || lignes.length === 0 ? 0 : hauteurDuGraphique(lignes, forme, hauteurGraphique)
      placePour(doc, 8 + graphique + 12 + Math.min(lignes.length, 5) * 5.5)
    }
    dejaEcrit = true

    section(doc, repartition.titre)

    if (lignes.length === 0) {
      paragraphe(doc, 'Aucune demande sur la période.', true)
      continue
    }

    if (format !== 'court') {
      if (forme === 'camembert') camembert(doc, lignes, hauteurGraphique)
      else barres(doc, lignes, hauteurGraphique, multicolore)
    }

    tableauRepartition(doc, lignes, repartition.colonne, LIGNES_PAR_FORMAT[format], multicolore)
  }

  // ------------------------------------------------------- le temps passé

  if (retenue('temps')) {
    if (format === 'complet' && dejaEcrit) nouvellePage(doc)
    section(doc, 'Temps passé')
    paragraphe(
      doc,
      `${formaterDuree(rapport.tempsPasseMinutes)} déclarées dans les plannings et rattachées à ces demandes, renforts compris.`
    )
    if (rapport.tempsParCategorie.length > 0) {
      tableau(
        doc,
        [
          { titre: 'Catégorie', poids: 3 },
          { titre: 'Temps', poids: 1.2, aDroite: true },
          { titre: 'Part', poids: 1, aDroite: true },
        ],
        rapport.tempsParCategorie
          .slice(0, LIGNES_PAR_FORMAT[format])
          .map((l, rang) => ({
            couleur: teintePour(l, rang, false, true),
            cellules: [l.libelle, formaterDuree(l.total), `${l.part} %`],
          }))
      )
    } else {
      paragraphe(doc, "Aucune heure n'a été rattachée à une demande sur la période.", true)
    }
  }

  telecharger(doc, `rapport_demandes_${rapport.periode.debut}_${rapport.periode.fin}.pdf`)
}

function nouvellePage(doc: Document) {
  doc.pdf.addPage()
  doc.y = MARGE + 4
}

// ================================================================ synthèse

/** Quatre cartouches côte à côte : les nombres seuls, écrits en grand. */
function chiffresCles(doc: Document, r: RapportDemandes) {
  const cartouches = [
    { libelle: 'Ouvertes sur la période', valeur: r.ouvertes },
    { libelle: 'Closes', valeur: r.closes },
    { libelle: 'Encore en cours', valeur: r.enCours },
    { libelle: 'Délai dépassé', valeur: r.enRetard },
  ]
  const ecart = 4
  const largeur = (doc.largeur - 2 * MARGE - ecart * (cartouches.length - 1)) / cartouches.length
  const hauteur = 20

  placePour(doc, hauteur + 4)
  cartouches.forEach((c, i) => {
    const x = MARGE + i * (largeur + ecart)
    doc.pdf.setFillColor(...RAYURE)
    doc.pdf.roundedRect(x, doc.y, largeur, hauteur, 2, 2, 'F')

    doc.pdf.setFont('helvetica', 'normal')
    doc.pdf.setFontSize(8)
    doc.pdf.setTextColor(...ENCRE_PALE)
    doc.pdf.text(c.libelle, x + 3, doc.y + 6)

    doc.pdf.setFont('helvetica', 'bold')
    doc.pdf.setFontSize(18)
    doc.pdf.setTextColor(...ENCRE)
    doc.pdf.text(String(c.valeur), x + 3, doc.y + 16)
  })
  doc.y += hauteur + 8
}

/**
 * Médiane et moyenne côte à côte, comme à l'écran — et la phrase qui explique
 * leur écart, parce que sur une feuille personne n'est là pour la dire.
 */
function delais(doc: Document, r: RapportDemandes) {
  const ligne = (titre: string, d: DelaisRapport) => ({
    cellules: [
      titre,
      formaterDuree(d.medianeMinutes),
      formaterDuree(d.moyenneMinutes),
      String(d.mesurees),
      d.dansLesDelais + d.horsDelais > 0 ? `${d.dansLesDelais} / ${d.dansLesDelais + d.horsDelais}` : '—',
    ],
  })

  tableau(
    doc,
    [
      { titre: '', poids: 2.4 },
      { titre: 'Médiane', poids: 1.2, aDroite: true },
      { titre: 'Moyenne', poids: 1.2, aDroite: true },
      { titre: 'Mesurées', poids: 1, aDroite: true },
      { titre: 'Échéance tenue', poids: 1.4, aDroite: true },
    ],
    [ligne('Prise en charge', r.priseEnCharge), ligne('Résolution', r.resolution)]
  )

  const parlant = (d: DelaisRapport) =>
    d.medianeMinutes !== null && d.moyenneMinutes !== null && d.moyenneMinutes > d.medianeMinutes * 2
  if (parlant(r.priseEnCharge) || parlant(r.resolution)) {
    paragraphe(
      doc,
      'La moyenne dépasse nettement la médiane : quelques dossiers bloqués pèsent sur le total. Ce sont eux qu’il faut regarder, pas l’ensemble.',
      true
    )
  }
}

// ============================================================ répartitions

function tableauRepartition(
  doc: Document,
  lignes: LigneRepartition[],
  colonne: string,
  maximum: number,
  multicolore: boolean
) {
  // Les pastilles suivent le graphique : les huit premières lignes ont leur
  // teinte, les suivantes le gris du regroupement « autres ».
  const gardees = lignes.slice(0, maximum)
  const reste = lignes.slice(gardees.length)

  // Au moins cinq lignes sous leur en-tête, ou le tout à la page suivante.
  placePour(doc, 12 + Math.min(gardees.length + (reste.length > 0 ? 1 : 0), 5) * 5.5)

  const corps = gardees.map((l, rang) => ({
    couleur: multicolore
      ? teintePour(rang < 8 ? l : { cle: CLE_AUTRES }, rang, false, true)
      : undefined,
    cellules: [l.libelle, String(l.total), `${l.part} %`],
  }))

  if (reste.length > 0) {
    corps.push({
      couleur: undefined,
      cellules: [
        `${reste.length} autre(s)`,
        String(reste.reduce((t, l) => t + l.total, 0)),
        `${reste.reduce((t, l) => t + l.part, 0)} %`,
      ],
    })
  }

  tableau(
    doc,
    [
      { titre: colonne, poids: 4 },
      { titre: 'Demandes', poids: 1.2, aDroite: true },
      { titre: 'Part', poids: 1, aDroite: true },
    ],
    corps
  )
}

/** Tronque un libellé à une largeur donnée, points de suspension compris. */
function tronquer(doc: Document, texte: string, largeur: number): string {
  if (doc.pdf.getTextWidth(texte) <= largeur) return texte
  let court = texte
  while (court.length > 1 && doc.pdf.getTextWidth(`${court}…`) > largeur) court = court.slice(0, -1)
  return `${court.trimEnd()}…`
}

/** La hauteur qu'un graphique occupera, marges comprises. */
function hauteurDuGraphique(lignes: LigneRepartition[], forme: FormeGraphique, hauteurMax: number): number {
  const n = regrouper(lignes).length
  if (forme === 'camembert') return Math.max(Math.min(hauteurMax, 90), n * 6.5) + 6
  return n * Math.min(10, hauteurMax / n) + 6
}

/** Des barres horizontales, libellés à gauche et valeur au bout. */
function barres(doc: Document, lignes: LigneRepartition[], hauteurMax: number, multicolore: boolean) {
  const donnees = regrouper(lignes)
  const pas = Math.min(10, hauteurMax / donnees.length)
  const epaisseur = Math.min(5, pas * 0.6)
  const hauteur = donnees.length * pas + 4

  placePour(doc, hauteur)

  const largeurLibelle = 52
  const x0 = MARGE + largeurLibelle
  const largeurUtile = doc.largeur - 2 * MARGE - largeurLibelle - 14
  const max = Math.max(...donnees.map((d) => d.total), 1)

  doc.pdf.setFontSize(8)
  donnees.forEach((ligne, rang) => {
    const y = doc.y + rang * pas
    const milieu = y + epaisseur / 2

    doc.pdf.setFont('helvetica', 'normal')
    doc.pdf.setTextColor(...ENCRE_PALE)
    doc.pdf.text(tronquer(doc, ligne.libelle, largeurLibelle - 4), x0 - 3, milieu + 1.1, { align: 'right' })

    const largeur = Math.max(0.6, (ligne.total / max) * largeurUtile)
    doc.pdf.setFillColor(...enRvb(teintePour(ligne, rang, false, multicolore)))
    doc.pdf.roundedRect(x0, y, largeur, epaisseur, 0.8, 0.8, 'F')

    doc.pdf.setFont('helvetica', 'bold')
    doc.pdf.setTextColor(...ENCRE)
    doc.pdf.text(String(ligne.total), x0 + largeur + 2, milieu + 1.1)
  })

  doc.y += hauteur + 2
}

/**
 * Un camembert, et sa légende à droite.
 *
 * jsPDF ne trace pas d'arc rempli : chaque part est un polygone qui suit le
 * cercle par pas de deux degrés — invisible à l'œil, même imprimé en grand.
 * Un liseré blanc sépare les parts, pour que deux teintes voisines restent
 * distinctes une fois photocopiées en noir et blanc.
 */
function camembert(doc: Document, lignes: LigneRepartition[], hauteurMax: number) {
  const donnees = regrouper(lignes)
  const diametre = Math.min(hauteurMax, 90)
  const rayon = diametre / 2
  const pasLegende = 6.5
  const hauteur = Math.max(diametre, donnees.length * pasLegende)

  placePour(doc, hauteur + 4)

  const cx = MARGE + 6 + rayon
  const cy = doc.y + rayon
  const somme = donnees.reduce((t, d) => t + d.total, 0) || 1

  doc.pdf.setDrawColor(255, 255, 255)
  doc.pdf.setLineWidth(0.5)

  if (donnees.length === 1) {
    doc.pdf.setFillColor(...enRvb(teintePour(donnees[0], 0, false, true)))
    doc.pdf.circle(cx, cy, rayon, 'F')
  } else {
    let angle = -Math.PI / 2
    donnees.forEach((ligne, rang) => {
      const ouverture = (ligne.total / somme) * Math.PI * 2
      if (ouverture <= 0) return
      const pas = Math.max(2, Math.ceil((ouverture * 180) / Math.PI / 2))
      const points: [number, number][] = [[cx, cy]]
      for (let i = 0; i <= pas; i += 1) {
        const a = angle + (ouverture * i) / pas
        points.push([cx + rayon * Math.cos(a), cy + rayon * Math.sin(a)])
      }
      // `lines` attend des segments relatifs, à partir du premier point.
      const segments = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]])
      doc.pdf.setFillColor(...enRvb(teintePour(ligne, rang, false, true)))
      doc.pdf.lines(segments, cx, cy, [1, 1], 'FD', true)
      angle += ouverture
    })
  }

  // La légende : pastille, libellé, nombre et part.
  const xl = cx + rayon + 12
  const largeurLegende = doc.largeur - MARGE - xl
  const y0 = doc.y + Math.max(0, (diametre - donnees.length * pasLegende) / 2) + 3
  doc.pdf.setFontSize(8.5)
  donnees.forEach((ligne, rang) => {
    const y = y0 + rang * pasLegende
    doc.pdf.setFillColor(...enRvb(teintePour(ligne, rang, false, true)))
    doc.pdf.circle(xl + 1.4, y - 1, 1.4, 'F')

    doc.pdf.setFont('helvetica', 'normal')
    doc.pdf.setTextColor(...ENCRE)
    doc.pdf.text(tronquer(doc, ligne.libelle, largeurLegende - 30), xl + 5, y)

    doc.pdf.setFont('helvetica', 'bold')
    doc.pdf.text(String(ligne.total), doc.largeur - MARGE - 14, y, { align: 'right' })
    doc.pdf.setFont('helvetica', 'normal')
    doc.pdf.setTextColor(...ENCRE_PALE)
    doc.pdf.text(`${ligne.part} %`, doc.largeur - MARGE, y, { align: 'right' })
  })

  doc.y += hauteur + 6
}
