import type { ContexteMigration, Migration } from './types';

/**
 * Le bâtiment par défaut d'une personne : celui où elle a son bureau.
 *
 * « Si l'utilisateur a plusieurs bâtiments, lui en mettre un par défaut — celui
 * où il a son bureau. Une demande informatique portera obligatoirement ce
 * bâtiment ; s'il n'en a qu'un, c'est forcément celui-là. »
 *
 * Un drapeau sur le rattachement (`user_sites.par_defaut`), pas une colonne sur
 * `users` : le bâtiment par défaut est l'un de ceux auxquels la personne est
 * rattachée, et le retirer de ses bâtiments doit le retirer aussi. Un seul par
 * personne, règle tenue par `definirSitesDe()` — ni `CHECK` exploitable sur
 * MySQL 5.7, ni index partiel portable.
 *
 * Aucun rattrapage : une personne rattachée à un seul bâtiment n'a pas besoin
 * du drapeau, `siteParDefautDe()` le déduit.
 */
const batimentParDefaut: Migration = {
  id: '049_batiment_par_defaut',
  description: 'Bâtiment par défaut d’une personne, parmi ceux auxquels elle est rattachée',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'user_sites');
    if (colonnes.size === 0 || colonnes.has('par_defaut')) return;
    await ctx.executer(`ALTER TABLE user_sites ADD COLUMN par_defaut ${ctx.booleen} NOT NULL DEFAULT 0`);
  },
};

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 * Recopié plutôt que partagé : une migration décrit l'état du code au jour où
 * elle a été écrite.
 */
async function colonnesDe(ctx: ContexteMigration, table: string): Promise<Set<string>> {
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

export default batimentParDefaut;
