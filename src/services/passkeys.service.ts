import type { Request } from 'express';

import { db } from '../database';

/**
 * Passkeys (WebAuthn / FIDO2).
 *
 * L'écran Paramètres > Authentification proposait d'activer les passkeys, de
 * choisir le type d'authentificateur, le mode principal ou second facteur.
 * Personne ne relisait cette configuration : la connexion restait en bcrypt
 * local, et l'écran portait un bandeau l'avouant. Ce service est ce qui la lit.
 *
 * Il ne fait pas la cryptographie — `@simplewebauthn/server` s'en charge dans
 * `passkey.routes.ts`. Il tient ce que la bibliothèque ne peut pas connaître :
 * la configuration de la commune, l'identité du site sous laquelle les clés
 * sont enregistrées, les défis en cours et les clés publiques en base.
 */

/**
 * `any` — « indifférent » à l'écran — laisse le navigateur proposer aussi bien
 * la biométrie intégrée qu'une clé USB. Sans cette valeur, choisir `platform`
 * interdisait d'enregistrer la YubiKey rangée dans le coffre, et
 * `cross-platform` interdisait Windows Hello : il fallait trancher pour toute
 * la commune, alors que les deux usages coexistent.
 */
export type TypeAuthentificateur = 'platform' | 'cross-platform' | 'any';
export type ExigenceCle = 'discouraged' | 'preferred' | 'required';

export interface ConfigPasskey {
  /** Nom affiché dans l'invite biométrique du système. */
  rp_name: string;
  /** Domaine sous lequel les clés sont enregistrées. Vide : déduit de la requête. */
  rp_id: string;
  /** Origines acceptées, séparées par des virgules. Vide : déduite de la requête. */
  origin: string;
  /**
   * `indirect` a disparu : la bibliothèque de vérification ne le connaît pas,
   * et une valeur enregistrée avant cette version retombe donc sur `none`.
   * Elle n'apportait rien ici — l'attestation ne sert qu'à qui veut n'accepter
   * que des modèles d'authentificateurs homologués, ce qu'une commune ne fait
   * pas.
   */
  attestation: 'none' | 'direct';
  authenticator_selection: {
    authenticator_attachment: TypeAuthentificateur;
    resident_key: ExigenceCle;
    user_verification: ExigenceCle;
  };
  timeout: number;
  /** Se connecter avec la seule passkey, sans mot de passe. */
  allow_as_primary: boolean;
  /** Exiger la passkey après le mot de passe, pour qui en a enregistré une. */
  allow_as_2fa: boolean;
}

/** Valeurs identiques à celles de `DEFAULT_CONFIGS.passkey` côté route. */
export const CONFIG_PASSKEY_PAR_DEFAUT: ConfigPasskey = {
  rp_name: 'Gestion Matériels',
  rp_id: '',
  origin: '',
  attestation: 'none',
  authenticator_selection: {
    authenticator_attachment: 'any',
    resident_key: 'preferred',
    user_verification: 'preferred',
  },
  timeout: 60000,
  allow_as_primary: false,
  allow_as_2fa: true,
};

/** Configuration effective : celle du fournisseur, plus son interrupteur. */
export interface EtatPasskey extends ConfigPasskey {
  /** Le fournisseur est activé dans l'écran d'administration. */
  actif: boolean;
}

function booleen(valeur: unknown, defaut: boolean): boolean {
  if (typeof valeur === 'boolean') return valeur;
  if (valeur === 1 || valeur === '1' || valeur === 'true') return true;
  if (valeur === 0 || valeur === '0' || valeur === 'false') return false;
  return defaut;
}

function parmi<T extends string>(valeur: unknown, admises: readonly T[], defaut: T): T {
  return admises.includes(valeur as T) ? (valeur as T) : defaut;
}

function texte(valeur: unknown, defaut: string): string {
  return typeof valeur === 'string' ? valeur.trim() : defaut;
}

/**
 * Ramène une configuration stockée à un état exploitable.
 *
 * Une valeur absente ou d'un type inattendu retombe sur la valeur par défaut.
 * Le délai est borné : un `timeout` à zéro fermerait l'invite biométrique avant
 * que l'agent ait posé son doigt, et un quart d'heure laisserait un défi ouvert
 * bien plus longtemps qu'il n'est utile.
 */
export function normaliserConfigPasskey(brut: unknown, actif = false): EtatPasskey {
  let valeurs: any = brut;
  if (typeof brut === 'string') {
    try {
      valeurs = JSON.parse(brut);
    } catch {
      return { ...CONFIG_PASSKEY_PAR_DEFAUT, actif };
    }
  }
  if (!valeurs || typeof valeurs !== 'object') return { ...CONFIG_PASSKEY_PAR_DEFAUT, actif };

  const d = CONFIG_PASSKEY_PAR_DEFAUT;
  const selection = (valeurs.authenticator_selection ?? {}) as Record<string, unknown>;
  const delai = Number(valeurs.timeout);

  return {
    actif,
    rp_name: texte(valeurs.rp_name, d.rp_name) || d.rp_name,
    rp_id: texte(valeurs.rp_id, d.rp_id),
    origin: texte(valeurs.origin, d.origin),
    attestation: parmi(valeurs.attestation, ['none', 'direct'] as const, d.attestation),
    authenticator_selection: {
      authenticator_attachment: parmi(
        selection.authenticator_attachment,
        ['platform', 'cross-platform', 'any'] as const,
        d.authenticator_selection.authenticator_attachment
      ),
      resident_key: parmi(
        selection.resident_key,
        ['discouraged', 'preferred', 'required'] as const,
        d.authenticator_selection.resident_key
      ),
      user_verification: parmi(
        selection.user_verification,
        ['discouraged', 'preferred', 'required'] as const,
        d.authenticator_selection.user_verification
      ),
    },
    timeout: Number.isFinite(delai) ? Math.min(Math.max(delai, 15_000), 300_000) : d.timeout,
    allow_as_primary: booleen(valeurs.allow_as_primary, d.allow_as_primary),
    allow_as_2fa: booleen(valeurs.allow_as_2fa, d.allow_as_2fa),
  };
}

/**
 * La configuration est lue à chaque étape d'une connexion. Un cache court évite
 * une requête par appel sans rendre une modification invisible longtemps — même
 * arbitrage que la politique de mot de passe, et même invalidation explicite
 * quand l'administrateur enregistre.
 */
const DUREE_CACHE_MS = 30_000;
let cache: { valeur: EtatPasskey; expire: number } | null = null;

/** Vide le cache. Appelé quand l'administrateur enregistre la configuration. */
export function invaliderConfigPasskey(): void {
  cache = null;
}

/** Configuration en vigueur. Fournisseur inactif si rien n'est configuré. */
export async function lireConfigPasskey(): Promise<EtatPasskey> {
  if (cache && cache.expire > Date.now()) return cache.valeur;

  let valeur: EtatPasskey = { ...CONFIG_PASSKEY_PAR_DEFAUT, actif: false };
  try {
    const ligne = await db.queryOne(
      "SELECT is_active, config FROM auth_config WHERE provider = 'passkey'"
    );
    if (ligne) valeur = normaliserConfigPasskey(ligne.config, !!ligne.is_active);
  } catch {
    // Table absente au tout premier démarrage : le fournisseur reste inactif,
    // et la connexion par mot de passe continue de fonctionner.
  }

  cache = { valeur, expire: Date.now() + DUREE_CACHE_MS };
  return valeur;
}

// ==================== IDENTITÉ DU SITE ====================

/** Ce sous quoi le navigateur enregistre puis retrouve une clé. */
export interface IdentiteSite {
  /** Domaine de la partie de confiance (`rpID`). */
  rpId: string;
  /** Origines acceptées à la vérification. */
  origines: string[];
  /** L'identité vient de la configuration, et non d'une déduction. */
  configuree: boolean;
}

/** Origine de la requête courante : l'en-tête `Origin`, sinon l'hôte appelé. */
export function origineDeLaRequete(req: Request): string | null {
  const annoncee = req.get('origin');
  if (annoncee && /^https?:\/\/[^/]+$/i.test(annoncee)) return annoncee;

  const hote = req.get('host');
  if (!hote) return null;
  // `req.protocol` tient compte de `trust proxy`, donc du `X-Forwarded-Proto`
  // posé par nginx : derrière le reverse proxy, l'origine reste en https.
  return `${req.protocol}://${hote}`;
}

/** Domaine d'une origine, sans protocole ni port. `null` si elle est illisible. */
export function domaineDeLOrigine(origine: string): string | null {
  try {
    return new URL(origine).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Identité du site, prise de la configuration si elle est remplie, déduite sinon.
 *
 * Le RP ID et l'origine sont les deux valeurs qu'une passkey scelle : une clé
 * enregistrée sous `mairie.fr` ne se présentera jamais à `autre.fr`, le
 * navigateur s'y refuse. Mal renseignées, elles ne produisent pas une faille
 * mais une panne — le navigateur rejette l'appel avant même d'interroger le
 * serveur, avec un message que personne ne relie à un champ d'administration.
 *
 * D'où la déduction : sur une installation qui n'a rempli ni l'un ni l'autre —
 * le cas courant, ces champs étant restés décoratifs jusqu'ici — les passkeys
 * fonctionnent quand même, sous le domaine réellement servi. Une commune qui
 * héberge plusieurs domaines, ou qui veut que les clés survivent à un
 * changement de sous-domaine, renseigne les champs et ce sont alors eux qui
 * font foi.
 */
export function identiteDuSite(config: ConfigPasskey, req: Request): IdentiteSite | null {
  const originesConfigurees = config.origin
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const rpIdConfigure = config.rp_id.trim();

  if (originesConfigurees.length > 0 || rpIdConfigure) {
    const origines = [...originesConfigurees];
    const rpId = rpIdConfigure || domaineDeLOrigine(origines[0] ?? '');
    if (!rpId) return null;

    // Un RP ID configuré sans origine reste exploitable : l'origine acceptée
    // est alors celle de la requête, que le navigateur a déjà vérifiée comme
    // relevant de ce domaine avant de signer.
    if (origines.length === 0) {
      const deduite = origineDeLaRequete(req);
      if (!deduite) return null;
      origines.push(deduite);
    }

    return { rpId, origines, configuree: true };
  }

  const origine = origineDeLaRequete(req);
  if (!origine) return null;
  const rpId = domaineDeLOrigine(origine);
  if (!rpId) return null;

  return { rpId, origines: [origine], configuree: false };
}

// ==================== DÉFIS ====================

/**
 * Ce à quoi sert un défi. Un défi obtenu sur l'écran « ajouter une passkey » —
 * donc par quelqu'un de déjà connecté — ne doit pas pouvoir être présenté à la
 * route qui délivre une session.
 */
export type UsageDefi = 'enregistrement' | 'connexion' | 'second-facteur';

/** Le défi vit le temps de l'invite biométrique, plus une marge. */
const MARGE_DEFI_MS = 60_000;

/**
 * Ouvre un défi et le conserve jusqu'à sa vérification.
 *
 * Les défis périmés sont balayés au passage : sans ce ménage, la table
 * grossirait d'une ligne par écran de connexion ouvert puis abandonné.
 */
export async function ouvrirDefi(
  defi: string,
  usage: UsageDefi,
  userId: number | null,
  dureeMs: number
): Promise<void> {
  const maintenant = Date.now();
  await db.execute('DELETE FROM passkey_challenges WHERE expires_at < ?', [
    new Date(maintenant).toISOString(),
  ]);
  await db.execute(
    `INSERT INTO passkey_challenges (challenge, user_id, purpose, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      defi,
      userId,
      usage,
      new Date(maintenant + dureeMs + MARGE_DEFI_MS).toISOString(),
      new Date(maintenant).toISOString(),
    ]
  );
}

/**
 * Consomme un défi : il est retrouvé, puis effacé, qu'il serve ou non.
 *
 * Un défi rejouable n'en est pas un — c'est toute sa raison d'être que de ne
 * valoir qu'une fois. La suppression a donc lieu avant la vérification de
 * signature, et non après.
 */
export async function consommerDefi(
  defi: string,
  usage: UsageDefi
): Promise<{ userId: number | null } | null> {
  if (!defi) return null;

  const ligne = await db.queryOne(
    'SELECT id, user_id, purpose, expires_at FROM passkey_challenges WHERE challenge = ?',
    [defi]
  );
  if (!ligne) return null;

  await db.execute('DELETE FROM passkey_challenges WHERE id = ?', [ligne.id]);

  if (ligne.purpose !== usage) return null;
  if (new Date(ligne.expires_at).getTime() < Date.now()) return null;

  return { userId: ligne.user_id ?? null };
}

// ==================== CLÉS ENREGISTRÉES ====================

export interface PasskeyEnregistree {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  aaguid: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** Transports stockés en JSON, ramenés à une liste sûre. */
export function lireTransports(brut: unknown): string[] {
  try {
    const valeurs = typeof brut === 'string' ? JSON.parse(brut) : brut;
    return Array.isArray(valeurs) ? valeurs.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Passkeys d'un compte, la plus récemment utilisée en tête. */
export async function passkeysDuCompte(userId: number): Promise<PasskeyEnregistree[]> {
  return db.query(
    `SELECT * FROM user_passkeys WHERE user_id = ?
      ORDER BY COALESCE(last_used_at, created_at) DESC, id DESC`,
    [userId]
  );
}

/** Nombre de passkeys d'un compte, sans charger les clés. */
export async function compterPasskeys(userId: number): Promise<number> {
  try {
    const ligne = await db.queryOne('SELECT COUNT(*) AS n FROM user_passkeys WHERE user_id = ?', [
      userId,
    ]);
    return Number(ligne?.n ?? 0);
  } catch {
    // Table absente : aucune passkey, donc aucun second facteur à exiger.
    return 0;
  }
}

export async function passkeyParCredentialId(
  credentialId: string
): Promise<PasskeyEnregistree | null> {
  return db.queryOne('SELECT * FROM user_passkeys WHERE credential_id = ?', [credentialId]);
}

/**
 * Un libellé lisible par défaut, pour que la liste ne soit pas une colonne de
 * dates. L'agent le renomme ensuite ; c'est le seul moyen de savoir laquelle
 * révoquer quand un appareil est perdu.
 */
export function libelleParDefaut(transports: string[], multiAppareils: boolean): string {
  if (transports.includes('usb') || transports.includes('nfc')) return 'Clé de sécurité';
  if (multiAppareils) return 'Passkey synchronisée';
  if (transports.includes('internal')) return 'Cet appareil';
  return 'Passkey';
}

export async function enregistrerPasskey(entree: {
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  aaguid: string | null;
  name: string;
}): Promise<number> {
  const resultat = await db.execute(
    `INSERT INTO user_passkeys
       (user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entree.userId,
      entree.credentialId,
      entree.publicKey,
      entree.counter,
      JSON.stringify(entree.transports),
      entree.deviceType,
      entree.backedUp ? 1 : 0,
      entree.aaguid,
      entree.name.slice(0, 120),
      new Date().toISOString(),
    ]
  );
  return Number(resultat.lastInsertRowid);
}

/**
 * Note l'usage d'une clé.
 *
 * Le compteur remonté par l'authentificateur est conservé pour la vérification
 * suivante, et la date sert à l'agent : « laquelle est-ce que je n'utilise
 * plus ? » est la question qu'on se pose avant d'en supprimer une.
 */
export async function noterUsage(id: number, compteur: number): Promise<void> {
  await db.execute('UPDATE user_passkeys SET counter = ?, last_used_at = ? WHERE id = ?', [
    compteur,
    new Date().toISOString(),
    id,
  ]);
}

/**
 * Un nom vide n'est pas enregistré : la liste redeviendrait une colonne de
 * dates. Les sauts de ligne sont aplatis, qui casseraient la mise en page sans
 * rien apporter.
 */
export function nettoyerNom(brut: unknown, defaut: string): string {
  const nom = typeof brut === 'string' ? brut.replace(/\s+/g, ' ').trim() : '';
  return (nom || defaut).slice(0, 120);
}

/**
 * Copie d'un `Buffer` en `Uint8Array` adossé à un `ArrayBuffer`.
 *
 * `new Uint8Array(buffer)` produit une vue sur la mémoire partagée de Node, que
 * la bibliothèque refuse : elle veut un tableau qui possède ses octets. Le
 * détour tient en trois lignes et évite de le réécrire à chaque appel.
 */
export function enOctets(source: Buffer) {
  const copie = new Uint8Array(source.length);
  copie.set(source);
  return copie;
}

/** Identifiant opaque d'un compte, stable d'un enregistrement à l'autre. */
export function identifiantWebAuthn(userId: number) {
  // WebAuthn demande un identifiant en octets, et déconseille explicitement d'y
  // mettre une donnée personnelle : il est conservé en clair dans
  // l'authentificateur, et une passkey synchronisée l'emporte avec elle. Le
  // numéro de compte suffit à retrouver la personne, et ne dit rien d'elle.
  return enOctets(Buffer.from(`compte-${userId}`, 'utf8'));
}
