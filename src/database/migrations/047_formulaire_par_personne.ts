import type { ContexteMigration, Migration } from './types';

/**
 * Ce que le formulaire de demande montre à une personne : le bâtiment, le
 * matériel, les deux, ou aucun.
 *
 * « Certains demandeurs ont besoin de choisir le matériel et le bâtiment,
 * d'autres juste le matériel, d'autres juste le bâtiment. » La catégorie de
 * demande le règle déjà pour tout le monde (`site_mode`, `materiel_mode`) ;
 * cette table le corrige pour une personne. Une ligne par personne, et `NULL`
 * dans une colonne veut dire « ce que la catégorie a décidé » — le cas courant,
 * qui n'a donc pas besoin de ligne du tout.
 *
 * Une table plutôt que deux colonnes sur `users` : la table de base ne bouge
 * pas pour un réglage propre au module des demandes, et supprimer le compte
 * emporte la ligne par `ON DELETE CASCADE`.
 *
 * Les valeurs sont celles des catégories, vérifiées par le service :
 * `site_mode` dans `auto | requis | masque`, `materiel_mode` dans
 * `aucun | optionnel | requis`. La préséance entre les deux réglages est écrite
 * une seule fois, dans `modesFormulairePour()`.
 */
const formulaireParPersonne: Migration = {
  id: '047_formulaire_par_personne',
  description: 'Champs bâtiment et matériel du formulaire de demande, réglés par personne',

  async up(ctx) {
    if ((await colonnesDe(ctx, 'users')).size === 0) return;

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_ticket_reglages (
        user_id INTEGER PRIMARY KEY,
        site_mode VARCHAR(20),
        materiel_mode VARCHAR(20),
        updated_by INTEGER,
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
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

export default formulaireParPersonne;
