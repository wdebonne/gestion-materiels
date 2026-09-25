/**
 * Un plan reçu en PDF, rendu en image par le navigateur.
 *
 * Le serveur n'a pas de moteur de rendu PDF, et n'en aura pas pour ça : c'est
 * le navigateur qui dessine la page choisie, puis envoie une image — la même
 * que celle d'un plan scanné. pdf.js n'est chargé qu'ici, à la demande : il
 * pèse près d'un mégaoctet, et la plupart des écrans n'en ont jamais besoin.
 *
 * `isEvalSupported: false` ferme la porte par laquelle un PDF piégé exécutait
 * du code dans les anciennes versions de pdf.js : un plan vient souvent d'un
 * prestataire, pas de la collectivité.
 */

/** Largeur visée du rendu : assez pour lire le nom d'une salle en zoomant, pas plus. */
const LARGEUR_CIBLE = 3000

export interface PageRendue {
  image: Blob
  largeur: number
  hauteur: number
  pages: number
}

async function chargerPdf(fichier: File) {
  const pdfjs = await import('pdfjs-dist')
  const { default: urlTravailleur } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = urlTravailleur
  const donnees = new Uint8Array(await fichier.arrayBuffer())
  return pdfjs.getDocument({ data: donnees, isEvalSupported: false }).promise
}

/** Le nombre de pages, pour proposer le choix quand il y en a plusieurs. */
export async function nombreDePages(fichier: File): Promise<number> {
  const pdf = await chargerPdf(fichier)
  const n = pdf.numPages
  await pdf.destroy()
  return n
}

/** Rend une page en PNG, à une largeur lisible. */
export async function pdfEnImage(fichier: File, numeroPage = 1): Promise<PageRendue> {
  const pdf = await chargerPdf(fichier)
  try {
    const page = await pdf.getPage(Math.min(Math.max(1, numeroPage), pdf.numPages))
    const brute = page.getViewport({ scale: 1 })
    const echelle = Math.min(4, LARGEUR_CIBLE / brute.width)
    const vue = page.getViewport({ scale: echelle })

    const toile = document.createElement('canvas')
    toile.width = Math.round(vue.width)
    toile.height = Math.round(vue.height)
    const contexte = toile.getContext('2d')
    if (!contexte) throw new Error('Rendu impossible dans ce navigateur')
    // Fond blanc : un PDF sans fond donnerait un PNG transparent, illisible en mode sombre.
    contexte.fillStyle = '#ffffff'
    contexte.fillRect(0, 0, toile.width, toile.height)
    await page.render({ canvasContext: contexte, viewport: vue }).promise

    const image = await new Promise<Blob>((resoudre, rejeter) =>
      toile.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Conversion impossible'))), 'image/png')
    )
    return { image, largeur: toile.width, hauteur: toile.height, pages: pdf.numPages }
  } finally {
    await pdf.destroy()
  }
}

/** Les dimensions d'une image choisie telle quelle. */
export function dimensionsImage(fichier: Blob): Promise<{ largeur: number; hauteur: number }> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => {
      resoudre({ largeur: img.naturalWidth, hauteur: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rejeter(new Error('Image illisible'))
    }
    img.src = url
  })
}
