import fs from 'fs';
import path from 'path';

/**
 * Normalisation des images reçues.
 *
 * Deux problèmes concrets du terrain :
 *
 *  1. **Photos couchées.** Un téléphone enregistre l'orientation dans les
 *     métadonnées EXIF plutôt qu'en tournant les pixels. Sans `rotate()`, la
 *     photo d'un compteur ou d'un ticket s'affiche à 90°.
 *  2. **Fichiers énormes.** Le client réduit déjà avant l'envoi, mais rien ne
 *     garantit qu'il l'ait fait : un import direct par l'API, un vieux cache,
 *     ou un navigateur sans `createImageBitmap` passent à travers.
 *
 * L'échec de la normalisation n'est jamais bloquant : mieux vaut un fichier
 * non optimisé qu'une saisie perdue.
 */

const LARGEUR_MAX = 2000;
const QUALITE_JPEG = 82;

/** Formats que l'on sait recompresser sans perte de sens (SVG exclu : vectoriel). */
const FORMATS = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export function isNormalizableImage(mimetype: string): boolean {
  return FORMATS.has(mimetype);
}

/**
 * Réécrit l'image sur place : orientation corrigée, largeur plafonnée,
 * recompression JPEG. Renvoie la nouvelle taille en octets, ou `null` si
 * la normalisation n'a pas eu lieu.
 */
export async function normalizeImage(filePath: string, mimetype: string): Promise<number | null> {
  if (!isNormalizableImage(mimetype)) return null;

  let sharp: typeof import('sharp');
  try {
    // Import paresseux : si le module natif est absent ou mal compilé, on
    // laisse simplement passer le fichier d'origine.
    sharp = require('sharp');
  } catch {
    console.warn('sharp indisponible : image conservée telle quelle');
    return null;
  }

  // On ne peut pas lire et écrire le même fichier avec sharp : passage par un
  // fichier temporaire, puis remplacement atomique.
  const temporaire = filePath + '.tmp';

  try {
    await sharp(filePath)
      .rotate() // applique l'orientation EXIF
      .resize({ width: LARGEUR_MAX, withoutEnlargement: true })
      .jpeg({ quality: QUALITE_JPEG, mozjpeg: true })
      .toFile(temporaire);

    const avant = fs.statSync(filePath).size;
    const apres = fs.statSync(temporaire).size;

    // Une recompression qui alourdit le fichier n'a pas d'intérêt.
    if (apres >= avant) {
      fs.unlinkSync(temporaire);
      return null;
    }

    fs.renameSync(temporaire, filePath);
    return apres;
  } catch (error) {
    console.error('Normalisation image échouée pour', path.basename(filePath), error);
    try {
      if (fs.existsSync(temporaire)) fs.unlinkSync(temporaire);
    } catch {
      /* rien à faire de plus */
    }
    return null;
  }
}
