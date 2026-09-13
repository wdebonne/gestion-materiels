import type { Migration } from './types';

/**
 * De quoi couper une session en cours.
 *
 * Un jeton JWT vaut par lui-même : le serveur n'en tient aucune liste, et
 * jusqu'ici rien ne permettait d'en invalider un avant son expiration — sept
 * jours par défaut. Un ordinateur portable oublié dans un véhicule de service,
 * un mot de passe recopié, une session restée ouverte sur un poste partagé :
 * le seul recours était de désactiver le compte, donc d'empêcher la personne
 * de travailler, puis de le réactiver — ce qui rouvrait la même faille,
 * l'ancien jeton redevenant valable.
 *
 * `token_version` règle cela sans table de révocation ni cache : le numéro est
 * inscrit dans le jeton à l'émission et comparé à celui de la base à chaque
 * requête. L'incrémenter périme d'un coup tous les jetons du compte, et
 * seulement les siens. Un octet en base plutôt qu'une liste à balayer et à
 * purger.
 *
 * Les jetons déjà en circulation ne portent pas le numéro : ils sont lus comme
 * portant la version 0, celle que cette migration installe. Personne n'est
 * déconnecté par la mise à jour.
 */
const revocationSessions: Migration = {
  id: '022_revocation_sessions',
  description: 'Un numéro de version par compte, pour périmer ses jetons en cours',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'users');
    if (colonnes.size === 0) return;

    if (!colonnes.has('token_version')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
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
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name)!).filter(Boolean));
}

export default revocationSessions;
