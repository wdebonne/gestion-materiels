import type { Migration } from './types';

/**
 * Matériel unique rattaché aux manifestations, et préférences de notification.
 *
 * **Matériel unique.** Une manifestation ne savait demander que des quantités :
 * « 50 tables ». Un véhicule, lui, n'est pas une quantité — c'est un exemplaire
 * identifié, avec son numéro de série, ses entretiens et ses pleins, et il ne
 * peut pas être à deux endroits le même jour. Il vit déjà dans `objects`.
 *
 * La table `manifestation_items` existait depuis l'origine pour faire ce lien et
 * n'a jamais été ni lue ni écrite. Elle est ici complétée de ce qui lui manquait
 * pour servir : l'état du matériel au retour, et une note.
 *
 * **Préférences de notification.** Les réglages n'existaient qu'au niveau du
 * service : un agent qui recevait trop ne pouvait rien y faire sans couper aussi
 * ses collègues. Chacun peut désormais choisir pour lui-même — sauf ce qui
 * l'engage : une approbation qu'on attend de lui continue de partir, sans quoi
 * il bloquerait une manifestation sans jamais le savoir.
 */
const migration: Migration = {
  id: '006_materiel_unique_et_notifications',
  description: 'Matériel du parc rattaché aux manifestations, et préférences de notification par compte',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    const colonnesItems = await colonnesDe(ctx, 'manifestation_items');

    // État constaté au retour : un véhicule ne se « perd » pas en quantité, il
    // revient intact, abîmé, ou pas du tout.
    if (!colonnesItems.has('return_state')) {
      await ctx.executer('ALTER TABLE manifestation_items ADD COLUMN return_state VARCHAR(20)');
    }
    if (!colonnesItems.has('notes')) {
      await ctx.executer(`ALTER TABLE manifestation_items ADD COLUMN notes ${texteLong}`);
    }
    if (!colonnesItems.has('updated_at')) {
      await ctx.executer('ALTER TABLE manifestation_items ADD COLUMN updated_at DATETIME');
    }

    /**
     * Une ligne par compte et par événement. L'absence de ligne vaut « suivre le
     * réglage par défaut » : n'enregistrer que les choix explicites évite d'avoir
     * à créer des lignes pour tout le monde à chaque nouvel événement, et de se
     * demander ensuite si un `0` est un choix ou un oubli.
     */
    await ctx.executer(`CREATE TABLE IF NOT EXISTS notification_preferences (
      id INTEGER PRIMARY KEY ${autoIncrement},
      user_id INTEGER NOT NULL,
      event VARCHAR(50) NOT NULL,
      enabled ${booleen} NOT NULL DEFAULT 1,
      created_at DATETIME ${horodatageParDefaut},
      updated_at DATETIME ${horodatageParDefaut},
      UNIQUE(user_id, event),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
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
