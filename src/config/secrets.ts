/**
 * Accès centralisé aux secrets de l'application.
 *
 * Avant, chaque appel faisait `process.env.JWT_SECRET || 'secret'` : une
 * instance déployée sans variable d'environnement signait donc ses jetons
 * avec la chaîne « secret », connue de quiconque lit le dépôt, et ce
 * silencieusement. On refuse désormais de démarrer en production dans ce cas.
 */

import crypto from 'crypto';

const MIN_SECRET_LENGTH = 32;

/**
 * Motifs de secrets d'exemple. Une comparaison exacte serait trop fragile :
 * `.env.example` et `docker-compose.yml` portent déjà deux variantes
 * différentes de la même valeur d'exemple.
 */
const PLACEHOLDER_PATTERNS = [
  /^secret$/i,
  /votre[_-]?(secret|refresh)/i,
  /changeme|change[_-]?me|a[_-]changer|to[_-]?change/i,
  /^(test|demo|example|placeholder|x{3,})/i,
  /your[_-]?(secret|jwt|key)/i,
];

const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isPlaceholder(secret: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(secret));
}

function isWeak(secret: string | undefined): secret is undefined {
  if (!secret) return true;
  if (secret.length < MIN_SECRET_LENGTH) return true;
  return isPlaceholder(secret);
}

/**
 * Secret dérivé, pour un jeton qui n'est pas un jeton de session.
 *
 * Le ticket remis entre le mot de passe et la passkey porte un `userId` et une
 * version de compte — exactement ce que `authenticateToken` attend. Signé avec
 * le secret des sessions, il aurait fait un jeton d'accès parfaitement valable
 * pendant cinq minutes : présenter son seul mot de passe aurait suffi à sauter
 * le second facteur. La dérivation rend les deux familles de jetons
 * mutuellement illisibles, sans second secret à configurer.
 */
export function getDerivedSecret(usage: string): string {
  return crypto.createHmac('sha256', getJwtSecret()).update(usage).digest('hex');
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (isWeak(secret)) {
    if (isProduction()) {
      throw new Error(
        `JWT_SECRET absent, trop court (${MIN_SECRET_LENGTH} caractères minimum) ou laissé à sa valeur d'exemple.`
      );
    }
    return process.env.JWT_SECRET || DEV_FALLBACK_SECRET;
  }

  return secret;
}

/**
 * À appeler au démarrage : mieux vaut un serveur qui refuse de démarrer avec
 * un message clair qu'un serveur qui tourne avec une sécurité factice.
 */
export function assertSecretsConfigured(): void {
  const secret = process.env.JWT_SECRET;

  if (!isWeak(secret)) return;

  let reason: string;
  if (!secret) {
    reason = "JWT_SECRET n'est pas défini";
  } else if (isPlaceholder(secret)) {
    reason = "JWT_SECRET a gardé une valeur d'exemple";
  } else {
    reason = `JWT_SECRET fait moins de ${MIN_SECRET_LENGTH} caractères`;
  }

  const howTo =
    '   Générez un secret avec :  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';

  if (isProduction()) {
    console.error(`\n❌ Démarrage refusé : ${reason}.`);
    console.error(howTo);
    console.error('   puis renseignez JWT_SECRET dans votre fichier .env.\n');
    process.exit(1);
  }

  console.warn(`⚠️  ${reason} — secret de développement utilisé. Interdit en production.`);
  console.warn(howTo);
}
