import { db } from '../database';

/**
 * Politique de mot de passe et de connexion.
 *
 * L'écran Paramètres > Authentification permettait de régler la longueur
 * minimale, la complexité, l'expiration, le blocage après N tentatives et le
 * délai d'expiration de session. Rien de tout cela n'était appliqué : la
 * configuration était écrite dans `auth_config` et relue par personne. Un
 * administrateur qui réglait « blocage après 5 tentatives » croyait disposer
 * d'un contrôle qui n'existait pas.
 */

export interface PolitiqueAuth {
  allow_local_login: boolean;
  allow_registration: boolean;
  enforce_2fa: boolean;
  session_timeout_minutes: number;
  max_login_attempts: number;
  lockout_duration_minutes: number;
  password_min_length: number;
  password_require_uppercase: boolean;
  password_require_lowercase: boolean;
  password_require_number: boolean;
  password_require_special: boolean;
  password_expiry_days: number;
}

/** Valeurs identiques à celles de `DEFAULT_CONFIGS.general` côté route. */
export const POLITIQUE_PAR_DEFAUT: PolitiqueAuth = {
  allow_local_login: true,
  allow_registration: false,
  enforce_2fa: false,
  session_timeout_minutes: 480,
  max_login_attempts: 5,
  lockout_duration_minutes: 15,
  password_min_length: 8,
  password_require_uppercase: true,
  password_require_lowercase: true,
  password_require_number: true,
  password_require_special: false,
  password_expiry_days: 0,
};

/**
 * La politique est lue à chaque tentative de connexion et à chaque changement
 * de mot de passe. Un cache court évite une requête par frappe sans rendre une
 * modification invisible pendant longtemps.
 */
const DUREE_CACHE_MS = 30_000;
let cache: { valeur: PolitiqueAuth; expire: number } | null = null;

/** Vide le cache. Appelé quand l'administrateur enregistre la configuration. */
export function invaliderPolitique(): void {
  cache = null;
}

function nombre(valeur: unknown, defaut: number): number {
  const n = typeof valeur === 'string' ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : defaut;
}

function booleen(valeur: unknown, defaut: boolean): boolean {
  if (typeof valeur === 'boolean') return valeur;
  if (valeur === 1 || valeur === '1' || valeur === 'true') return true;
  if (valeur === 0 || valeur === '0' || valeur === 'false') return false;
  return defaut;
}

/**
 * Ramène une configuration stockée à une politique exploitable.
 *
 * Une valeur absente, d'un type inattendu ou négative retombe sur la valeur par
 * défaut plutôt que de désactiver silencieusement un contrôle.
 */
export function normaliserPolitique(brut: unknown): PolitiqueAuth {
  let valeurs: any = brut;
  if (typeof brut === 'string') {
    try {
      valeurs = JSON.parse(brut);
    } catch {
      return { ...POLITIQUE_PAR_DEFAUT };
    }
  }
  if (!valeurs || typeof valeurs !== 'object') return { ...POLITIQUE_PAR_DEFAUT };

  const d = POLITIQUE_PAR_DEFAUT;
  return {
    allow_local_login: booleen(valeurs.allow_local_login, d.allow_local_login),
    allow_registration: booleen(valeurs.allow_registration, d.allow_registration),
    enforce_2fa: booleen(valeurs.enforce_2fa, d.enforce_2fa),
    session_timeout_minutes: nombre(valeurs.session_timeout_minutes, d.session_timeout_minutes),
    max_login_attempts: nombre(valeurs.max_login_attempts, d.max_login_attempts),
    lockout_duration_minutes: nombre(valeurs.lockout_duration_minutes, d.lockout_duration_minutes),
    password_min_length: nombre(valeurs.password_min_length, d.password_min_length),
    password_require_uppercase: booleen(valeurs.password_require_uppercase, d.password_require_uppercase),
    password_require_lowercase: booleen(valeurs.password_require_lowercase, d.password_require_lowercase),
    password_require_number: booleen(valeurs.password_require_number, d.password_require_number),
    password_require_special: booleen(valeurs.password_require_special, d.password_require_special),
    password_expiry_days: nombre(valeurs.password_expiry_days, d.password_expiry_days),
  };
}

/** Politique en vigueur. Retombe sur les valeurs par défaut si rien n'est configuré. */
export async function lirePolitique(): Promise<PolitiqueAuth> {
  if (cache && cache.expire > Date.now()) return cache.valeur;

  let valeur = { ...POLITIQUE_PAR_DEFAUT };
  try {
    const ligne = await db.queryOne(
      "SELECT config FROM auth_config WHERE provider = 'general'"
    );
    if (ligne?.config) valeur = normaliserPolitique(ligne.config);
  } catch {
    // Table absente au tout premier démarrage : les valeurs par défaut
    // s'appliquent, ce qui est plus sûr que de ne rien exiger.
  }

  cache = { valeur, expire: Date.now() + DUREE_CACHE_MS };
  return valeur;
}

const CARACTERES_SPECIAUX = /[^A-Za-z0-9]/;

/**
 * Vérifie un mot de passe contre la politique.
 *
 * Rend la liste complète des manquements plutôt que le premier : redemander un
 * mot de passe trois fois de suite parce qu'on ne signale qu'une exigence à la
 * fois est le meilleur moyen d'obtenir « Motdepasse1! » collé sur un écran.
 */
export function verifierMotDePasse(
  motDePasse: string,
  politique: PolitiqueAuth
): { valide: boolean; manquements: string[]; message: string } {
  const manquements: string[] = [];

  if (motDePasse.length < politique.password_min_length) {
    manquements.push(`au moins ${politique.password_min_length} caractères`);
  }
  if (politique.password_require_uppercase && !/[A-Z]/.test(motDePasse)) {
    manquements.push('une majuscule');
  }
  if (politique.password_require_lowercase && !/[a-z]/.test(motDePasse)) {
    manquements.push('une minuscule');
  }
  if (politique.password_require_number && !/[0-9]/.test(motDePasse)) {
    manquements.push('un chiffre');
  }
  if (politique.password_require_special && !CARACTERES_SPECIAUX.test(motDePasse)) {
    manquements.push('un caractère spécial');
  }

  return {
    valide: manquements.length === 0,
    manquements,
    message: manquements.length === 0
      ? ''
      : `Le mot de passe doit contenir ${manquements.join(', ')}.`,
  };
}

/** Description de la politique, pour l'afficher avant la saisie. */
export function decrirePolitique(politique: PolitiqueAuth): string {
  const exigences = [`${politique.password_min_length} caractères minimum`];
  if (politique.password_require_uppercase) exigences.push('une majuscule');
  if (politique.password_require_lowercase) exigences.push('une minuscule');
  if (politique.password_require_number) exigences.push('un chiffre');
  if (politique.password_require_special) exigences.push('un caractère spécial');
  return exigences.join(', ');
}

/**
 * Nombre de jours depuis le dernier changement de mot de passe, `null` si la
 * date est inconnue — c'est le cas des comptes créés avant l'ajout de la colonne.
 */
export function ancienneteMotDePasse(changeLe: string | null | undefined): number | null {
  if (!changeLe) return null;
  const date = new Date(changeLe);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/**
 * Mot de passe expiré selon la politique.
 *
 * `password_expiry_days: 0` désactive l'expiration, ce qui est la valeur par
 * défaut. Un compte dont la date de changement est inconnue n'est jamais
 * déclaré expiré : on ne bloque pas quelqu'un sur une donnée absente.
 */
export function motDePasseExpire(
  changeLe: string | null | undefined,
  politique: PolitiqueAuth
): boolean {
  if (politique.password_expiry_days <= 0) return false;
  const anciennete = ancienneteMotDePasse(changeLe);
  return anciennete !== null && anciennete >= politique.password_expiry_days;
}
