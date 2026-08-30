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

/** En-tête d'authentification Basic. */
function entetes(config: ConfigurationNextcloud): Record<string, string> {
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
    .filter(Boolean)
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
    headers: entetes(config),
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
    return { success: false, error: "Nextcloud n'est pas configuré (Paramètres › Nextcloud)" };
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
      headers: { ...entetes(config), 'Content-Type': typeMime },
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
function messageLisible(erreur: any): string {
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
    return { success: false, error: "Nextcloud n'est pas configuré (Paramètres › Nextcloud)" };
  }

  try {
    const reponse = await fetch(construireUrl(config.url, chemin), {
      method: 'GET',
      headers: entetes(config),
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

/**
 * Liste les fichiers d'un dossier, par `PROPFIND`.
 *
 * Sert à proposer les modèles présents plutôt qu'à faire recopier un chemin à la
 * main, où la moindre faute de frappe ne se verrait qu'à la première génération
 * ratée. La réponse est du XML : on n'en extrait que les chemins, sans
 * bibliothèque, car c'est tout ce dont l'écran a besoin.
 */
export async function listerDossier(
  chemin: string,
  configuration?: ConfigurationNextcloud | null
): Promise<{ success: boolean; fichiers?: string[]; error?: string }> {
  const config = configuration ?? (await lireConfiguration());
  if (!config) {
    return { success: false, error: "Nextcloud n'est pas configuré (Paramètres › Nextcloud)" };
  }

  try {
    const reponse = await fetch(construireUrl(config.url, chemin), {
      method: 'PROPFIND',
      headers: { ...entetes(config), Depth: '1', 'Content-Type': 'application/xml' },
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (reponse.status === 404) {
      return { success: false, error: `Dossier introuvable sur Nextcloud : ${chemin}` };
    }
    if (reponse.status === 401) return { success: false, error: IDENTIFIANTS_REFUSES };
    if (!reponse.ok) return { success: false, error: `HTTP ${reponse.status}` };

    const xml = await reponse.text();
    const fichiers = [...xml.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)]
      .map((m) => decodeURIComponent(m[1]))
      // Le dossier lui-même figure dans sa propre réponse, et les
      // sous-dossiers finissent par une barre.
      .filter((h) => !h.endsWith('/'))
      .map((h) => h.split('/').pop() ?? '')
      .filter((nom) => nom.toLowerCase().endsWith('.docx'));

    return { success: true, fichiers: [...new Set(fichiers)].sort((a, b) => a.localeCompare(b, 'fr')) };
  } catch (erreur: any) {
    return { success: false, error: messageLisible(erreur) };
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
  try {
    await fetch(construireUrl(config.url, chemin), {
      method: 'DELETE',
      headers: entetes(config),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });
  } catch {
    /* sans conséquence */
  }

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
