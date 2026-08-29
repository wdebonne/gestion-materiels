import type { Migration } from './types';

/**
 * Colonnes nécessaires à l'application de la politique de connexion.
 *
 * L'écran Paramètres > Authentification proposait « blocage après N tentatives »
 * et « expiration du mot de passe » sans que rien ne les applique, faute d'un
 * endroit où compter les échecs et dater le dernier changement.
 *
 * `failed_login_attempts` et `locked_until` portent le blocage,
 * `password_changed_at` porte l'expiration. Les trois sont ajoutées seulement
 * si elles manquent : la méthode est rejouable, et une base déjà migrée par la
 * liste manuelle de `runMigrations()` n'est pas touchée deux fois.
 */
const migration: Migration = {
  id: '002_politique_connexion',
  description: 'Compteur de tentatives, blocage temporaire et date du dernier mot de passe',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'users');

    if (!colonnes.has('failed_login_attempts')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0');
    }
    if (!colonnes.has('locked_until')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN locked_until DATETIME');
    }
    if (!colonnes.has('password_changed_at')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN password_changed_at DATETIME');
    }
  },
};

/** Colonnes existantes d'une table, dans les deux dialectes supportés. */
async function colonnesDe(
  ctx: Parameters<Migration['up']>[0],
  table: string
): Promise<Set<string>> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(lignes.map((l) => l.name));
  }

  const lignes = await ctx.interroger<{ COLUMN_NAME?: string; column_name?: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name) as string));
}

export default migration;
