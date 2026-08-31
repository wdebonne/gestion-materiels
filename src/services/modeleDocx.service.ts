import JSZip from 'jszip';
import { TemplateHandler } from 'easy-template-x';

/**
 * Modèles `.docx` à champs, remplis depuis les données d'une manifestation.
 *
 * **Pourquoi cette bibliothèque.** Carbone, cité en exemple, n'est pas
 * distribuable sous licence MIT comme cette application, et demande LibreOffice
 * à côté. `easy-template-x` est en MIT, fonctionne en JavaScript seul — et
 * surtout **n'exécute aucun code venu du modèle**, ce qui compte quand les
 * modèles sont déposés dans un Nextcloud partagé : un fichier Word ne doit pas
 * pouvoir faire tourner quoi que ce soit sur le serveur.
 *
 * **La syntaxe.** `{nom_manifestation}` pour une valeur, `{#materiels}…{/materiels}`
 * pour une liste — dans un tableau Word, le bloc peut tenir sur une ligne, qui
 * sera répétée. C'est ce qu'une secrétaire de mairie peut écrire dans Word sans
 * qu'on lui explique un langage.
 */

/** Emplacements d'un `.docx` où du texte visible peut se trouver. */
const PARTIES_TEXTE = /^word\/(document|header\d*|footer\d*)\.xml$/;

/**
 * Champs écrits dans un modèle.
 *
 * `easy-template-x` n'expose pas la liste de ses balises : on lit le XML
 * nous-mêmes. Word découpe volontiers `{nom}` sur plusieurs `<w:t>` — une
 * correction orthographique suffit à couper une balise en deux — donc le texte
 * d'un paragraphe est recollé avant d'y chercher les accolades. Sans ce
 * recollage, un modèle parfaitement valide paraîtrait ne contenir aucun champ.
 */
export async function detecterChamps(contenu: Buffer): Promise<string[]> {
  const archive = await JSZip.loadAsync(contenu);
  const champs = new Set<string>();

  for (const nom of Object.keys(archive.files)) {
    if (!PARTIES_TEXTE.test(nom)) continue;

    const xml = await archive.files[nom].async('string');

    // Chaque paragraphe est traité à part : une balise ne traverse jamais un
    // paragraphe, et les recoller tous ferait apparaître des champs fantômes
    // formés par la fin de l'un et le début du suivant.
    for (const paragraphe of xml.split(/<\/w:p>/)) {
      const texte = [...paragraphe.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join('');

      for (const trouve of texte.matchAll(/\{([^{}]+)\}/g)) {
        const brut = trouve[1].trim();
        if (!brut) continue;

        // `{#liste}` et `{/liste}` ouvrent et ferment une répétition : c'est le
        // même champ, nommé une seule fois. `{@brut}` insère du XML tel quel.
        const nomChamp = brut.replace(/^[#/@]/, '').trim();
        if (nomChamp) champs.add(decodeEntitesXml(nomChamp));
      }
    }
  }

  return [...champs].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Word encode les caractères réservés dans le XML.
 *
 * Un champ nommé `{déclaration & arrêté}` arrive en `déclaration &amp; arrêté` :
 * le rendre tel quel obligerait à recopier l'entité dans l'écran de
 * correspondance, où personne ne la reconnaîtrait.
 */
function decodeEntitesXml(texte: string): string {
  return texte
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Un fichier qui n'est pas un `.docx` doit le dire avant qu'on tente de le remplir. */
export async function estDocxValide(contenu: Buffer): Promise<boolean> {
  try {
    const archive = await JSZip.loadAsync(contenu);
    return archive.file('word/document.xml') !== null;
  } catch {
    return false;
  }
}

/**
 * Remplit un modèle et rend le document produit.
 *
 * Un champ absent des données rend une chaîne vide plutôt que de laisser la
 * balise apparente : un arrêté portant `{date_livraison}` en toutes lettres
 * serait signé tel quel par quelqu'un qui ne l'a pas relu.
 */
export async function remplirModele(
  modele: Buffer,
  donnees: Record<string, unknown>
): Promise<Buffer> {
  const handler = new TemplateHandler();
  const rempli = await handler.process(modele, donnees as any);
  return Buffer.from(rempli);
}

/**
 * Complète les données avec les champs que le modèle attend et qu'elles n'ont pas.
 *
 * `easy-template-x` laisse la balise en place quand la clé manque. Une valeur
 * vide explicite vaut mieux qu'un `{montant}` imprimé au milieu d'un arrêté
 * municipal.
 */
export function completerDonneesManquantes(
  donnees: Record<string, unknown>,
  champsAttendus: string[]
): Record<string, unknown> {
  const completes = { ...donnees };
  for (const champ of champsAttendus) {
    if (completes[champ] === undefined || completes[champ] === null) completes[champ] = '';
  }
  return completes;
}
