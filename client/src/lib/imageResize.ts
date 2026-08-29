/**
 * Réduction d'image avant envoi.
 *
 * Une photo prise avec un téléphone récent pèse couramment 8 à 15 Mo. Le
 * plafond de l'application étant à 10 Mo, l'agent voyait « le fichier est trop
 * volumineux » sans autre explication — et sans moyen d'y remédier depuis le
 * terrain. On réduit donc côté navigateur, avant même de tenter l'envoi.
 *
 * Bénéfice secondaire : une photo de ~400 Ko part en 4G faible, là où 12 Mo
 * expirent.
 */

export interface ResizeOptions {
  /** Plus grande dimension conservée, en pixels. */
  maxDim?: number
  /** Qualité JPEG, entre 0 et 1. */
  quality?: number
}

const DEFAUTS: Required<ResizeOptions> = {
  maxDim: 1920,
  quality: 0.8,
}

/** `true` si le fichier est une image que l'on sait recompresser. */
export function isResizableImage(file: File): boolean {
  return /^image\/(jpeg|png|webp)$/.test(file.type)
}

/**
 * Renvoie une version réduite du fichier, ou le fichier d'origine si la
 * réduction est impossible ou contre-productive (image déjà petite, format
 * non géré, navigateur sans `createImageBitmap`).
 */
export async function resizeImage(file: File, options: ResizeOptions = {}): Promise<File> {
  const { maxDim, quality } = { ...DEFAUTS, ...options }

  if (!isResizableImage(file) || typeof createImageBitmap !== 'function') {
    return file
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Image corrompue ou format refusé par le navigateur : on laisse le
    // serveur trancher plutôt que de bloquer la saisie.
    return file
  }

  try {
    const facteur = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))

    // Déjà dans les clous et raisonnablement légère : ne rien faire.
    if (facteur === 1 && file.size <= 2 * 1024 * 1024) {
      return file
    }

    const largeur = Math.round(bitmap.width * facteur)
    const hauteur = Math.round(bitmap.height * facteur)

    const canvas = document.createElement('canvas')
    canvas.width = largeur
    canvas.height = hauteur

    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    ctx.drawImage(bitmap, 0, 0, largeur, hauteur)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )

    // Si la « réduction » alourdit le fichier (petit PNG à plat, par exemple),
    // on garde l'original.
    if (!blob || blob.size >= file.size) return file

    const nom = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg'
    return new File([blob], nom, { type: 'image/jpeg', lastModified: Date.now() })
  } finally {
    bitmap.close()
  }
}

/** Taille lisible par un humain, pour les messages d'information. */
export function formatFileSize(octets: number): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
}
