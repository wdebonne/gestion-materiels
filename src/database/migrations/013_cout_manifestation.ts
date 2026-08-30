import type { Migration } from './types';

/**
 * Coût unitaire d'un matériel du parc, pour chiffrer une manifestation.
 *
 * Une manifestation coûte deux choses, et il ne faut pas les confondre :
 *
 *   **ce qu'on déploie**  — trois agents pour une cérémonie, un raccordement
 *                           électrique. C'est connu dès la demande.
 *   **ce qui ne revient pas** — dix chaises prêtées, neuf rendues : la dixième
 *                           est cassée ou volée, et elle coûte son prix.
 *
 * Le second cas est celui qui manquait. Le parc savait qu'une chaise n'était pas
 * revenue — la différence entre livré et rendu — mais rien ne disait ce que
 * cette chaise valait, donc rien ne pouvait en faire un montant.
 *
 * `unit_cost` porte ce prix, et son sens suit la nature du matériel :
 *
 *   **lot**         le prix d'une unité — 50 € la chaise. Ce qui manque au
 *                   retour se chiffre en multipliant.
 *   **prestation**  le coût d'une unité déployée — l'heure ou la vacation d'un
 *                   agent, le forfait d'un raccordement.
 *   **unique**      la valeur de remplacement de l'exemplaire, retenue s'il
 *                   revient perdu.
 *
 * Le catalogue des manifestations avait déjà `price` et `unit_value` pour la
 * même idée : ils restent la source pour ses articles, et ne sont pas dupliqués
 * ici. Deux prix pour la même chaise finiraient par diverger.
 */
const migration: Migration = {
  id: '013_cout_manifestation',
  description: 'Coût unitaire du matériel du parc, pour le suivi des coûts de manifestation',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'objects');

    // Zéro par défaut : un parc dont personne n'a chiffré le matériel ne doit
    // pas se mettre à afficher des coûts inventés.
    if (!colonnes.has('unit_cost')) {
      await ctx.executer('ALTER TABLE objects ADD COLUMN unit_cost REAL DEFAULT 0');
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
