import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { PALETTE, estEmplacementCouleur } from '@/lib/paletteCategories'

/**
 * Les briques communes des PDF de l’application : page A4, bandeau de tête,
 * sections, tableaux à pastilles, captures de graphiques en thème clair, pied
 * de page numéroté.
 *
 * Nées avec les PDF des plannings (`components/plannings/exportPdf.ts`), elles
 * servent aussi aux statistiques des bâtiments : un seul endroit décide de la
 * marge, des couleurs et de la façon de photographier un graphique.
 */

export const MARGE = 14
export const BLEU: [number, number, number] = [2, 132, 199] // primary-600
export const ENCRE: [number, number, number] = [17, 24, 39]
export const ENCRE_PALE: [number, number, number] = [107, 114, 128]
export const RAYURE: [number, number, number] = [243, 244, 246]

/**
 * Le signe moins, écrit avec un trait d'union.
 *
 * Les polices intégrées de jsPDF sont encodées en WinAnsi, qui ne connaît pas
 * le signe moins typographique « − » (U+2212) employé à l'écran : il ressortait
 * en guillemet suivi d'un espace, et « − 6 h » se lisait « " 6 h ». Une baisse
 * d'heures devenait indéchiffrable, ce qui est fâcheux dans un document dont
 * c'est justement le propos.
 */
export function signe(valeur: number): string {
  return valeur > 0 ? '+' : '-'
}

export interface Document {
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
export const ECHELLE_CAPTURE = 1.5

export function creer(orientation: 'p' | 'l'): Document {
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
  return {
    pdf,
    largeur: pdf.internal.pageSize.getWidth(),
    hauteur: pdf.internal.pageSize.getHeight(),
    y: MARGE,
  }
}

/** Le bandeau de tête, sur la première page. */
export function bandeau(doc: Document, titre: string, periode: string, sousTitre: string) {
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
export function section(doc: Document, titre: string) {
  // On réserve la place du titre **et** d’un début de contenu : sinon le titre
  // restait seul en bas de page et son tableau commençait à la suivante.
  placePour(doc, 42)
  doc.pdf.setTextColor(...ENCRE)
  doc.pdf.setFont('helvetica', 'bold')
  doc.pdf.setFontSize(12)
  doc.pdf.text(titre, MARGE, doc.y)
  doc.y += 6
}

export function paragraphe(doc: Document, texte: string, pale = false) {
  const lignes = doc.pdf.splitTextToSize(texte, doc.largeur - 2 * MARGE)
  placePour(doc, lignes.length * 4.5)
  doc.pdf.setTextColor(...(pale ? ENCRE_PALE : ENCRE))
  doc.pdf.setFont('helvetica', 'normal')
  doc.pdf.setFontSize(9.5)
  doc.pdf.text(lignes, MARGE, doc.y)
  doc.y += lignes.length * 4.5 + 2
}

/** Ouvre une page si la hauteur demandée ne tient plus. */
export function placePour(doc: Document, hauteur: number): boolean {
  if (doc.y + hauteur <= doc.hauteur - 18) return false
  doc.pdf.addPage()
  doc.y = MARGE
  return true
}

export interface Colonne {
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
export function tableau(
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
export function enRvb(couleur: string): [number, number, number] {
  const hex = /^#[0-9a-f]{6}$/i.test(couleur)
    ? couleur
    : estEmplacementCouleur(couleur)
      ? PALETTE[couleur].clair
      : '#94a3b8'
  const propre = hex.replace('#', '')
  return [
    parseInt(propre.slice(0, 2), 16),
    parseInt(propre.slice(2, 4), 16),
    parseInt(propre.slice(4, 6), 16),
  ]
}

/** La pagination et la provenance, sur chaque page, à la toute fin. */
export function piedDePage(doc: Document) {
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
export async function photographier(element: HTMLElement): Promise<HTMLCanvasElement> {
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
export async function poserCapture(doc: Document, element: HTMLElement | null) {
  if (!element) return
  const canvas = await photographier(element)
  const largeur = doc.largeur - 2 * MARGE
  const hauteur = (canvas.height * largeur) / canvas.width

  placePour(doc, hauteur)
  const hauteurPosee = Math.min(hauteur, doc.hauteur - doc.y - 18)
  doc.pdf.addImage(canvas.toDataURL('image/png'), 'PNG', MARGE, doc.y, largeur, hauteurPosee)
  doc.y += hauteurPosee + 6
}

export function telecharger(doc: Document, nom: string) {
  piedDePage(doc)
  doc.pdf.save(nom)
}
