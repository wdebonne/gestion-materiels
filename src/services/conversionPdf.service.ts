import { randomUUID } from 'crypto';
import {
  ConfigurationNextcloud,
  NON_CONFIGURE,
  deposerFichier,
  entetesAuth,
  identifiantFichier,
  lireConfiguration,
  lireFichier,
  racineInstance,
  supprimerDistant,
} from './webdav.service';

/**
 * Conversion d'un `.docx` en PDF, par le serveur bureautique du Nextcloud.
 *
 * Un arrêté qui part en `.docx` s'ouvre différemment selon le traitement de
 * texte du destinataire, et se laisse modifier sans que rien ne le montre. Le
 * PDF corrige les deux — mais convertir demande un moteur bureautique, et
 * LibreOffice en dépendance a déjà été écarté pour ce projet (voir l'en-tête de
 * `modeleDocx.service`). Le Nextcloud branché en porte un : il est déjà
 * installé, déjà authentifié, et n'ajoute aucune machine à administrer.
 *
 * **Plusieurs chemins, essayés dans l'ordre.** Aucun connecteur bureautique
 * n'enregistre de fournisseur de conversion auprès de Nextcloud : l'API
 * générique (`/ocs/v2.php/apps/files/api/v1/convert`) répond, mais échoue faute
 * de fournisseur — sauf si Nextcloud Office est installé à côté. Ce sont donc
 * les routes propres aux connecteurs qui travaillent, en parlant directement au
 * serveur de documents.
 *
 * Encore faut-il frapper à la bonne porte. Euro-Office est un fork d'ONLYOFFICE
 * Docs, mais son connecteur Nextcloud est une **application distincte** :
 * `eurooffice`, et non `onlyoffice`. Les routes sont les mêmes à l'identifiant
 * près, si bien qu'essayer l'une puis l'autre ne coûte qu'un 404 — et évite de
 * parier sur la variante installée. La sonde de l'écran des paramètres dit
 * laquelle a répondu.
 *
 * **Le document doit d'abord monter sur Nextcloud.** Tous ces chemins désignent
 * le fichier par son `fileid`, jamais par un flux. Le `.docx` est donc déposé
 * dans un dossier de travail, converti, puis retiré — y compris quand la
 * conversion échoue, sans quoi les témoins s'accumuleraient dans un dossier que
 * personne ne pense à ouvrir.
 */

const TYPE_MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TYPE_MIME_PDF = 'application/pdf';

/**
 * Une conversion est plus longue qu'un dépôt.
 *
 * Le serveur de documents rend la main en quelques secondes sur un arrêté d'une
 * page, mais il lui arrive de démarrer à froid. Les trente secondes de
 * `webdav.service` suffisent à déposer un fichier, pas à le convertir.
 */
const DELAI_MAX_MS = 120_000;

export interface ResultatConversion {
  success: boolean;
  pdf?: Buffer;
  /** Chemin qui a abouti, tel que l'écran des paramètres l'affiche. */
  methode?: string;
  error?: string;
}

/** Réponse d'un chemin de conversion, avant qu'on sache s'il faut essayer le suivant. */
interface Tentative {
  success: boolean;
  pdf?: Buffer;
  error?: string;
}

/**
 * Un PDF commence par `%PDF-`, et rien d'autre ne commence ainsi.
 *
 * Le connecteur répond en JSON quand il refuse, sous un code HTTP 200 : se fier
 * au statut, ou même au `Content-Type`, ferait enregistrer un message d'erreur
 * sous le nom d'un arrêté municipal.
 */
function estPdf(contenu: Buffer): boolean {
  return contenu.length > 5 && contenu.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Tire une phrase de la réponse du connecteur, qui refuse en JSON ou en HTML. */
function messageDuRefus(contenu: Buffer): string {
  const texte = contenu.subarray(0, 2000).toString('utf8').trim();

  try {
    const json = JSON.parse(texte);
    const message = json?.error ?? json?.message ?? json?.ocs?.meta?.message;
    if (message) return String(message);
  } catch {
    /* pas du JSON : la réponse est une page d'erreur */
  }

  return texte ? 'réponse inattendue du serveur' : 'réponse vide';
}

/**
 * Les connecteurs bureautiques connus, dans l'ordre où on les essaie.
 *
 * Deux applications Nextcloud pour un même code : le fork Euro-Office a son
 * propre connecteur, et l'identifiant d'application est tout ce qui les
 * distingue côté route. Un troisième fork s'ajouterait ici, et nulle part
 * ailleurs.
 */
const CONNECTEURS = [
  { app: 'eurooffice', libelle: 'Euro-Office' },
  { app: 'onlyoffice', libelle: 'ONLYOFFICE' },
];

/**
 * La route d'un connecteur bureautique.
 *
 * `downloadas` passe la main au serveur de documents et rend les octets du PDF.
 * Ce n'est pas une route OCS, mais une requête en `Basic` sans cookie passe le
 * contrôle CSRF de Nextcloud : c'est précisément le cas d'un mot de passe
 * d'application, le seul que cette application connaisse.
 */
async function parConnecteur(
  config: ConfigurationNextcloud,
  fileId: number,
  connecteur: { app: string; libelle: string }
): Promise<Tentative> {
  const parametres = new URLSearchParams({ fileId: String(fileId), toExtension: 'pdf' });
  const racine = racineInstance(config.url);
  const url = `${racine}/index.php/apps/${connecteur.app}/downloadas?${parametres}`;

  const reponse = await fetch(url, {
    method: 'GET',
    headers: entetesAuth(config),
    signal: AbortSignal.timeout(DELAI_MAX_MS),
  });

  if (reponse.status === 404) {
    return {
      success: false,
      error: `route absente — application « ${connecteur.app} » non installée`,
    };
  }
  if (reponse.status === 401 || reponse.status === 403) {
    return { success: false, error: `accès refusé (HTTP ${reponse.status})` };
  }
  if (!reponse.ok) return { success: false, error: `HTTP ${reponse.status}` };

  const contenu = Buffer.from(await reponse.arrayBuffer());
  if (!estPdf(contenu)) return { success: false, error: messageDuRefus(contenu) };

  return { success: true, pdf: contenu };
}

/**
 * Le second recours — l'API de conversion de Nextcloud.
 *
 * Elle écrit le PDF dans le compte plutôt que de le rendre : il faut donc le
 * relire, puis l'effacer. Elle n'aboutit que si une application a déclaré
 * savoir convertir du `.docx` — ce que fait Nextcloud Office, et aucun des
 * connecteurs ci-dessus. D'où sa place en dernier : sur une instance qui n'a
 * que son serveur de documents, elle répond « le fichier n'a pas pu être
 * converti », faute de fournisseur et non faute de moteur.
 */
async function parApiNextcloud(
  config: ConfigurationNextcloud,
  fileId: number,
  dossier: string
): Promise<Tentative> {
  const destination = `/${dossier}/${randomUUID()}.pdf`;
  const url = `${racineInstance(config.url)}/ocs/v2.php/apps/files/api/v1/convert`;

  const reponse = await fetch(url, {
    method: 'POST',
    headers: {
      ...entetesAuth(config),
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId, targetMimeType: TYPE_MIME_PDF, destination }),
    signal: AbortSignal.timeout(DELAI_MAX_MS),
  });

  const texte = await reponse.text();
  let enveloppe: any;
  try {
    enveloppe = JSON.parse(texte);
  } catch {
    return { success: false, error: `réponse illisible (HTTP ${reponse.status})` };
  }

  const produit = enveloppe?.ocs?.data?.path;
  if (!reponse.ok || !produit) {
    return { success: false, error: enveloppe?.ocs?.meta?.message || `HTTP ${reponse.status}` };
  }

  const lecture = await lireFichier(produit, config);
  // Le PDF produit est un intermédiaire, pas une pièce à garder sur le Nextcloud.
  await supprimerDistant(produit, config);

  if (!lecture.success || !lecture.contenu) {
    return { success: false, error: lecture.error ?? 'PDF produit illisible' };
  }
  if (!estPdf(lecture.contenu)) {
    return { success: false, error: "le fichier produit n'a pas l'allure d'un PDF" };
  }

  return { success: true, pdf: lecture.contenu };
}

/** Les chemins de conversion, dans l'ordre où ils sont tentés. */
const CHEMINS: Array<{
  nom: string;
  tenter: (
    config: ConfigurationNextcloud,
    fileId: number,
    dossier: string
  ) => Promise<Tentative>;
}> = [
  ...CONNECTEURS.map((connecteur) => ({
    nom: `connecteur ${connecteur.libelle}`,
    tenter: (config: ConfigurationNextcloud, fileId: number) =>
      parConnecteur(config, fileId, connecteur),
  })),
  { nom: 'API de conversion Nextcloud', tenter: parApiNextcloud },
];

/**
 * Convertit un `.docx` en PDF, ou dit pourquoi elle n'a pas pu.
 *
 * Ne lève jamais : l'appelant produit les documents d'une manifestation, et un
 * serveur bureautique en panne ne doit pas emporter la manifestation avec lui.
 */
export async function convertirEnPdf(docx: Buffer): Promise<ResultatConversion> {
  const config = await lireConfiguration();
  if (!config) return { success: false, error: NON_CONFIGURE };

  // Le point initial range le dossier hors de vue dans l'écran des fichiers :
  // ce qui y transite ne regarde pas les services qui consultent le Nextcloud.
  const dossier = `${config.folder || 'Manifestations'}/.conversion`;
  const chemin = `${dossier}/${randomUUID()}.docx`;

  const depot = await deposerFichier(chemin, docx, TYPE_MIME_DOCX, config);
  if (!depot.success) {
    return { success: false, error: `dépôt du document à convertir refusé — ${depot.error}` };
  }

  try {
    const identifiant = await identifiantFichier(chemin, config);
    if (!identifiant.success || identifiant.fileId === undefined) {
      return { success: false, error: identifiant.error ?? 'identifiant du fichier introuvable' };
    }

    const refus: string[] = [];
    for (const { nom, tenter } of CHEMINS) {
      try {
        const essai = await tenter(config, identifiant.fileId, dossier);
        if (essai.success && essai.pdf) return { success: true, pdf: essai.pdf, methode: nom };
        refus.push(`${nom} : ${essai.error}`);
      } catch (erreur: any) {
        // Un chemin qui casse ne doit pas empêcher d'essayer le suivant.
        refus.push(`${nom} : ${erreur?.message ?? 'appel interrompu'}`);
      }
    }

    return { success: false, error: `aucune conversion n'a abouti — ${refus.join(' ; ')}` };
  } finally {
    // Le témoin part dans tous les cas : un échec en laisserait autant qu'il y
    // a eu de tentatives.
    await supprimerDistant(chemin, config);
  }
}
