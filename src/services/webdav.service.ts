import { db } from '../database';
import { logService } from './log.service';

/**
 * Dépôt de fichiers sur un serveur WebDAV — un Nextcloud, en pratique.
 *
 * Rien dans l'application n'écrivait vers un stockage distant : `upload.service`
 * range sur le disque local, et les sauvegardes restent dans `./backups`. Le
 * suivi des manifestations se partage pourtant par fichier, sur un Nextcloud que
 * plusieurs services consultent.
 *
 * Ce client fait le strict nécessaire : créer les dossiers manquants, déposer un
 * fichier, vérifier une configuration. Une bibliothèque WebDAV complète
 * apporterait le verrouillage, les propriétés étendues et la synchronisation —
 * dont aucun n'est utile ici, puisque le sens est unique.
 *
 * Deux principes repris de `webhook.service.ts` :
 *
 * - **un délai maximal réel** (`AbortSignal.timeout`), parce qu'un serveur qui
 *   accepte la connexion sans jamais répondre bloquerait indéfiniment ;
 * - **l'échec ne remonte jamais jusqu'à l'action qui l'a déclenché** : un
 *   Nextcloud injoignable ne doit pas empêcher de valider une manifestation.
 */

const DELAI_MAX_MS = 30_000;

/** Dit une seule fois ce qu'il faut vérifier quand le serveur refuse l'accès. */
const IDENTIFIANTS_REFUSES =
  "Identifiants refusés — vérifiez l'identifiant et le mot de passe d'application";

/** Renvoie vers l'écran qui règle la connexion, plutôt que vers le symptôme. */
export const NON_CONFIGURE = "Nextcloud n'est pas configuré (Paramètres › Nextcloud)";

export interface ConfigurationNextcloud {
  /** Racine WebDAV, par exemple `https://cloud.ville.fr/remote.php/dav/files/mairie`. */
  url: string;
  username: string;
  /** Mot de passe d'application, jamais le mot de passe du compte. */
  password: string;
  /** Dossier de destination sous la racine, par exemple `Manifestations`. */
  folder?: string;
}

/** Configuration enregistrée, `null` si elle est absente ou incomplète. */
export async function lireConfiguration(): Promise<ConfigurationNextcloud | null> {
  try {
    const reglage = await db.queryOne(
      "SELECT setting_value FROM settings WHERE setting_key = 'nextcloud_config'"
    );
    if (!reglage?.setting_value) return null;

    const config = JSON.parse(reglage.setting_value) as ConfigurationNextcloud;
    if (!config.url || !config.username || !config.password) return null;

    return config;
  } catch (erreur: any) {
    console.error('Configuration Nextcloud illisible :', erreur?.message ?? erreur);
    return null;
  }
}

/**
 * Complète une adresse d'instance en racine WebDAV.
 *
 * `https://cloud.ville.fr/remote.php/dav/files/mairie` ne s'affiche nulle part
 * dans Nextcloud : ce qu'on a sous les yeux, et donc ce qu'on recopie, c'est
 * l'adresse du site — parfois même celle de l'écran des fichiers, avec son
 * `/apps/files/?dir=…`. Refuser aurait demandé d'expliquer une syntaxe que
 * personne n'a à connaître ; on complète.
 */
export function normaliserUrl(url: string, username: string): string {
  const saisie = url.trim();
  if (!saisie) return '';

  let adresse: URL;
  try {
    adresse = new URL(/^https?:\/\//i.test(saisie) ? saisie : `https://${saisie}`);
  } catch {
    return saisie.replace(/\/+$/, '');
  }

  const chemin = adresse.pathname.replace(/\/+$/, '');

  // Déjà une racine WebDAV — y compris un `remote.php/webdav` d'ancienne
  // génération : on ne la réécrit pas.
  if (/\/remote\.php\//i.test(chemin)) return `${adresse.origin}${chemin}`;

  // L'adresse recopiée du navigateur porte l'écran consulté, qui n'a rien à
  // faire dans une racine WebDAV.
  const base = chemin.replace(/\/(index\.php|apps|login|settings)(\/.*)?$/i, '');
  const compte = username.trim();

  return compte
    ? `${adresse.origin}${base}/remote.php/dav/files/${encodeURIComponent(compte)}`
    : `${adresse.origin}${base}`;
}

/**
 * Fait le chemin inverse : d'une racine WebDAV à la racine de l'instance.
 *
 * Tout ce qui ne passe pas par WebDAV — l'API OCS, les routes d'application —
 * s'adresse à `https://cloud.ville.fr`, quand la configuration ne connaît que
 * `https://cloud.ville.fr/remote.php/dav/files/mairie`. Un Nextcloud installé
 * dans un sous-répertoire garde le sien : c'est `remote.php` qui marque la
 * frontière, et non le premier segment du chemin.
 */
export function racineInstance(url: string): string {
  const base = (url ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';

  let adresse: URL;
  try {
    adresse = new URL(base);
  } catch {
    return base;
  }

  const chemin = adresse.pathname.replace(/\/remote\.php(\/.*)?$/i, '').replace(/\/+$/, '');
  return `${adresse.origin}${chemin}`;
}

/** Nettoie un chemin saisi ou reçu : ni barres vides, ni remontée. */
export function normaliserChemin(chemin?: string | null): string {
  return (chemin ?? '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

/** Enregistre la configuration, en créant le réglage s'il n'existe pas. */
export async function enregistrerConfiguration(config: ConfigurationNextcloud): Promise<void> {
  const maintenant = new Date().toISOString();
  const existant = await db.queryOne(
    "SELECT id FROM settings WHERE setting_key = 'nextcloud_config'"
  );

  if (existant) {
    await db.execute(
      'UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?',
      [JSON.stringify(config), maintenant, 'nextcloud_config']
    );
    return;
  }

  await db.execute(
    `INSERT INTO settings (setting_key, setting_value, setting_type, description, created_at, updated_at)
     VALUES (?, ?, 'json', ?, ?, ?)`,
    [
      'nextcloud_config',
      JSON.stringify(config),
      'Connexion WebDAV au Nextcloud de la commune',
      maintenant,
      maintenant,
    ]
  );
}

/** En-tête d'authentification Basic. */
export function entetesAuth(config: ConfigurationNextcloud): Record<string, string> {
  const jeton = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return { Authorization: `Basic ${jeton}` };
}

/**
 * Assemble une URL de dépôt sans double barre ni segment mal encodé.
 *
 * Un nom de manifestation se retrouve dans le nom de fichier : « Fête de la
 * musique 2026.xlsx » doit arriver tel quel, pas en `F%C3%AAte`… ni couper le
 * chemin en deux si le dossier a été saisi avec une barre finale.
 */
export function construireUrl(base: string, ...segments: string[]): string {
  const racine = base.replace(/\/+$/, '');
  const suite = segments
    .filter(Boolean)
    .flatMap((s) => s.split('/'))
    // `..` remonte d'un cran : `fetch` normalise le chemin avant de l'envoyer,
    // si bien qu'un chemin d'exploration sortirait du dossier du compte.
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => encodeURIComponent(s));

  return [racine, ...suite].join('/');
}

/**
 * Crée un dossier s'il n'existe pas.
 *
 * `405 Method Not Allowed` signifie « il existe déjà » : c'est la réponse
 * normale de Nextcloud, pas une erreur.
 */
async function creerDossier(config: ConfigurationNextcloud, chemin: string): Promise<void> {
  const reponse = await fetch(construireUrl(config.url, chemin), {
    method: 'MKCOL',
    headers: entetesAuth(config),
    signal: AbortSignal.timeout(DELAI_MAX_MS),
  });

  if (reponse.ok || reponse.status === 405) return;

  // Le premier appel au serveur est un MKCOL : c'est donc ici que se voit un
  // mot de passe erroné, et « HTTP 401 » n'aiderait personne à le comprendre.
  if (reponse.status === 401) throw new Error(IDENTIFIANTS_REFUSES);

  throw new Error(`Création du dossier « ${chemin} » refusée (HTTP ${reponse.status})`);
}

export interface ResultatDepot {
  success: boolean;
  url?: string;
  status?: number;
  error?: string;
}

/**
 * Dépose un fichier, en créant les dossiers manquants au passage.
 *
 * Les dossiers sont créés un niveau à la fois : WebDAV ne crée pas les parents,
 * et un `MKCOL` sur `a/b/c` échoue si `a/b` n'existe pas.
 */
export async function deposerFichier(
  chemin: string,
  contenu: Buffer,
  typeMime = 'application/octet-stream',
  configuration?: ConfigurationNextcloud | null
): Promise<ResultatDepot> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) {
    return { success: false, error: NON_CONFIGURE };
  }

  const morceaux = chemin.split('/').filter(Boolean);
  const dossiers = morceaux.slice(0, -1);

  try {
    let courant = '';
    for (const dossier of dossiers) {
      courant = courant ? `${courant}/${dossier}` : dossier;
      await creerDossier(config, courant);
    }

    const url = construireUrl(config.url, chemin);
    const reponse = await fetch(url, {
      method: 'PUT',
      headers: { ...entetesAuth(config), 'Content-Type': typeMime },
      body: new Uint8Array(contenu),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (!reponse.ok) {
      const detail = reponse.status === 401 ? IDENTIFIANTS_REFUSES : `HTTP ${reponse.status}`;
      return { success: false, status: reponse.status, error: detail };
    }

    return { success: true, url, status: reponse.status };
  } catch (erreur: any) {
    return { success: false, error: messageLisible(erreur) };
  }
}

/**
 * Traduit une erreur réseau en phrase exploitable.
 *
 * `fetch` échoue avec un laconique « fetch failed » et range la vraie cause dans
 * `error.cause` : un administrateur qui lit « fetch failed » ne sait pas s'il
 * s'est trompé d'adresse, si le serveur est éteint, ou si le certificat est
 * refusé — et n'a aucune piste pour corriger.
 */
export function messageLisible(erreur: any): string {
  if (erreur?.name === 'TimeoutError') {
    return `Pas de réponse après ${DELAI_MAX_MS / 1000} secondes`;
  }

  const cause = erreur?.cause;
  switch (cause?.code) {
    case 'ECONNREFUSED':
      return "Connexion refusée — vérifiez l'adresse et le port";
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Nom de domaine introuvable${cause.hostname ? ` (${cause.hostname})` : ''}`;
    case 'ETIMEDOUT':
      return 'Le serveur ne répond pas';
    case 'CERT_HAS_EXPIRED':
      return 'Certificat HTTPS expiré';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'Certificat HTTPS auto-signé, refusé';
    default:
      break;
  }

  if (erreur instanceof TypeError && /fetch failed/i.test(erreur.message)) {
    return `Serveur injoignable${cause?.message ? ` — ${cause.message}` : ''}`;
  }

  return erreur?.message ?? 'Erreur inconnue';
}

export interface ResultatLecture {
  success: boolean;
  contenu?: Buffer;
  error?: string;
}

/**
 * Lit un fichier sur le serveur WebDAV.
 *
 * Sert aux modèles de document : les tenir dans Nextcloud permet de les corriger
 * à un seul endroit, sans repasser par l'application ni redéposer un fichier à
 * chaque virgule changée. Le modèle est relu à chaque génération, si bien qu'une
 * correction faite le matin s'applique l'après-midi.
 */
export async function lireFichier(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<ResultatLecture> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) {
    return { success: false, error: NON_CONFIGURE };
  }

  try {
    const reponse = await fetch(construireUrl(config.url, chemin), {
      method: 'GET',
      headers: entetesAuth(config),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (reponse.status === 404) {
      return { success: false, error: `Fichier introuvable sur Nextcloud : ${chemin}` };
    }
    if (reponse.status === 401) return { success: false, error: IDENTIFIANTS_REFUSES };
    if (!reponse.ok) return { success: false, error: `HTTP ${reponse.status}` };

    return { success: true, contenu: Buffer.from(await reponse.arrayBuffer()) };
  } catch (erreur: any) {
    return { success: false, error: messageLisible(erreur) };
  }
}

/** Une ligne de l'explorateur : un fichier, ou un dossier où descendre. */
export interface EntreeDistante {
  nom: string;
  /** Chemin relatif à la racine WebDAV, sans barre initiale. */
  chemin: string;
  dossier: boolean;
  /** Taille en octets, absente sur un dossier. */
  taille?: number;
  /** Dernière modification, en ISO. */
  modifie?: string;
  typeMime?: string;
}

/**
 * Lit la valeur d'une balise, quel que soit son préfixe de domaine.
 *
 * Les serveurs ne s'accordent pas : `d:`, `D:` ou `lp1:` selon l'implémentation
 * et selon la propriété. Une comparaison sur `d:href` marcherait chez les uns et
 * rendrait un dossier vide chez les autres.
 */
function valeurBalise(bloc: string, nom: string): string | undefined {
  const trouve = bloc.match(new RegExp(`<[a-z0-9]*:?${nom}[^>]*>([^<]*)<`, 'i'));
  return trouve?.[1]?.trim() || undefined;
}

/** Ramène un `href` absolu au chemin relatif à la racine du compte. */
function relativiser(href: string, racine: string): string {
  const brut = /^https?:\/\//i.test(href) ? new URL(href).pathname : href;

  // Le serveur encode le `href` ; « Fête de la musique » y figure en
  // `F%C3%AAte%20de%20la%20musique`, et c'est le nom lisible qui s'affiche.
  const chemin = decodeURIComponent(brut);

  return (chemin.startsWith(racine) ? chemin.slice(racine.length) : chemin)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Extrait les entrées d'une réponse `PROPFIND`.
 *
 * Sans bibliothèque XML : on ne lit que quatre propriétés, toutes textuelles, et
 * la seule structure qui compte est le découpage en `<response>`.
 */
export function analyserPropfind(xml: string, base: string, dossier: string): EntreeDistante[] {
  const racine = decodeURIComponent(new URL(base).pathname).replace(/\/+$/, '');

  return xml
    .split(/<[a-z0-9]*:?response[\s>]/i)
    .slice(1)
    .map((bloc): EntreeDistante | null => {
      const href = valeurBalise(bloc, 'href');
      if (!href) return null;

      const chemin = relativiser(href, racine);
      // Le dossier interrogé figure en tête de sa propre réponse.
      if (!chemin || chemin === dossier) return null;

      const taille = valeurBalise(bloc, 'getcontentlength');
      const modifie = valeurBalise(bloc, 'getlastmodified');
      const date = modifie ? new Date(modifie) : null;

      return {
        nom: chemin.split('/').pop() ?? chemin,
        chemin,
        dossier: /<[a-z0-9]*:?collection\s*\/?>/i.test(bloc),
        taille: taille ? Number(taille) : undefined,
        modifie: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
        typeMime: valeurBalise(bloc, 'getcontenttype'),
      };
    })
    .filter((entree): entree is EntreeDistante => entree !== null)
    .sort((a, b) => (a.dossier === b.dossier ? a.nom.localeCompare(b.nom, 'fr') : a.dossier ? -1 : 1));
}

/**
 * Contenu d'un dossier, par `PROPFIND`.
 *
 * Un chemin se recopie à la main dans les profils d'export comme dans les
 * modèles de document, et la faute de frappe ne se voyait qu'à la première
 * génération ratée — voire jamais, le dépôt étant silencieux par construction.
 * Parcourir l'arborescence permet de désigner un dossier au lieu de l'épeler.
 */
export async function explorerDossier(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<{ success: boolean; chemin?: string; entrees?: EntreeDistante[]; error?: string }> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) return { success: false, error: NON_CONFIGURE };

  const dossier = normaliserChemin(chemin);

  try {
    const reponse = await fetch(construireUrl(config.url, dossier), {
      method: 'PROPFIND',
      headers: { ...entetesAuth(config), Depth: '1', 'Content-Type': 'application/xml' },
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (reponse.status === 404) {
      return { success: false, error: `Dossier introuvable sur Nextcloud : ${dossier || '/'}` };
    }
    if (reponse.status === 401) return { success: false, error: IDENTIFIANTS_REFUSES };
    if (!reponse.ok) return { success: false, error: `HTTP ${reponse.status}` };

    return { success: true, chemin: dossier, entrees: analyserPropfind(await reponse.text(), config.url, dossier) };
  } catch (erreur: any) {
    return { success: false, error: messageLisible(erreur) };
  }
}

/**
 * Identifiant interne d'un fichier, celui que Nextcloud appelle `fileid`.
 *
 * WebDAV désigne un fichier par son chemin, mais tout le reste de Nextcloud le
 * désigne par ce nombre : la conversion en PDF, en particulier, ne sait pas
 * travailler autrement. Le corps de la requête est explicite parce qu'un
 * `PROPFIND` sans corps ne rend que les propriétés du domaine `DAV:`, où
 * `fileid` ne figure pas.
 */
export async function identifiantFichier(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<{ success: boolean; fileId?: number; error?: string }> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) return { success: false, error: NON_CONFIGURE };

  const demande =
    '<?xml version="1.0"?>' +
    '<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">' +
    '<d:prop><oc:fileid/></d:prop></d:propfind>';

  try {
    const reponse = await fetch(construireUrl(config.url, normaliserChemin(chemin)), {
      method: 'PROPFIND',
      headers: { ...entetesAuth(config), Depth: '0', 'Content-Type': 'application/xml' },
      body: demande,
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (reponse.status === 404) {
      return { success: false, error: `Fichier introuvable sur Nextcloud : ${chemin}` };
    }
    if (reponse.status === 401) return { success: false, error: IDENTIFIANTS_REFUSES };
    if (!reponse.ok) return { success: false, error: `HTTP ${reponse.status}` };

    const brut = valeurBalise(await reponse.text(), 'fileid');
    const fileId = Number(brut);
    if (!brut || !Number.isInteger(fileId)) {
      return { success: false, error: "Nextcloud n'a pas renvoyé l'identifiant du fichier" };
    }

    return { success: true, fileId };
  } catch (erreur: any) {
    return { success: false, error: messageLisible(erreur) };
  }
}

/**
 * Modèles `.docx` d'un dossier.
 *
 * Sert à proposer les modèles présents plutôt qu'à faire recopier un chemin à la
 * main, où la moindre faute de frappe ne se verrait qu'à la première génération
 * ratée.
 */
export async function listerDossier(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<{ success: boolean; fichiers?: string[]; error?: string }> {
  const resultat = await explorerDossier(chemin, configuration);
  if (!resultat.success) return { success: false, error: resultat.error };

  return {
    success: true,
    fichiers: (resultat.entrees ?? [])
      .filter((entree) => !entree.dossier && entree.nom.toLowerCase().endsWith('.docx'))
      .map((entree) => entree.nom),
  };
}

/**
 * Retire un fichier distant, sans jamais faire échouer l'appelant.
 *
 * Le retrait est toujours accessoire ici : un fichier témoin oublié se voit et
 * se corrige, alors qu'une exception remonterait jusqu'à l'action qui l'a
 * déclenchée — ce que ce module s'interdit.
 */
export async function supprimerDistant(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<void> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) return;

  try {
    await fetch(construireUrl(config.url, chemin), {
      method: 'DELETE',
      headers: entetesAuth(config),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });
  } catch {
    /* sans conséquence */
  }
}

/**
 * Vérifie qu'une configuration permet réellement de déposer.
 *
 * Une vérification qui se contenterait de valider la forme des champs — comme le
 * font les écrans SSO de ce projet, qui ne prouvent rien — laisserait un
 * administrateur croire que tout est branché. On dépose donc un fichier témoin,
 * puis on le retire.
 */
export async function verifierConfiguration(
  config: ConfigurationNextcloud
): Promise<{ success: boolean; message: string }> {
  const dossier = config.folder || 'Manifestations';
  const nom = `.verification-${Date.now()}.txt`;
  const chemin = `${dossier}/${nom}`;

  const depot = await deposerFichier(
    chemin,
    Buffer.from('Vérification de la configuration Nextcloud.\n', 'utf8'),
    'text/plain',
    config
  );

  if (!depot.success) {
    return { success: false, message: depot.error ?? 'Dépôt refusé' };
  }

  // Le retrait est accessoire : si la suppression échoue, la configuration est
  // valide quand même. Un fichier témoin oublié vaut mieux qu'un faux négatif.
  await supprimerDistant(chemin, config);

  return { success: true, message: `Dépôt réussi dans « ${dossier} »` };
}

/**
 * Dépose sans faire attendre l'appelant ni risquer de le faire échouer.
 *
 * C'est la forme à utiliser depuis une route : personne ne doit patienter
 * pendant qu'un Nextcloud répond, et un serveur injoignable ne doit surtout pas
 * faire échouer la validation d'une manifestation.
 */
export function deposerSansAttendre(
  chemin: string,
  contenu: Buffer,
  typeMime: string,
  auRetour?: (resultat: ResultatDepot) => Promise<void>
): void {
  void deposerFichier(chemin, contenu, typeMime)
    .then(async (resultat) => {
      if (!resultat.success) {
        await logService.warning('api', `Dépôt Nextcloud échoué : ${resultat.error}`, { chemin });
      }
      if (auRetour) await auRetour(resultat);
    })
    .catch((erreur) => {
      console.error('Dépôt Nextcloud interrompu :', erreur?.message ?? erreur);
    });
}
