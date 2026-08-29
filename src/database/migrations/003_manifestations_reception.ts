import type { Migration } from './types';

/**
 * Réception des demandes de manifestation, et stock réellement suivi.
 *
 * Trois manques la motivent :
 *
 * 1. Les demandes arrivent d'une application de formulaires et sont ressaisies
 *    à la main. Il faut un endroit où poser les sources autorisées, leur secret
 *    et la correspondance entre leur JSON et les champs d'une manifestation, et
 *    un journal de ce qui a été reçu — sans journal, une demande perdue est
 *    invisible.
 *
 * 2. `manifestations` n'avait pas de date de récupération. La fenêtre pendant
 *    laquelle le matériel est indisponible n'avait donc pas de fin exploitable,
 *    et le prévisionnel ne pouvait pas se calculer à une date donnée.
 *
 * 3. Une chaise cassée ou volée ne diminuait rien : `quantity_total` ne bougeait
 *    jamais et le stock affiché s'éloignait du stock réel à chaque manifestation.
 *    Les pertes sont désormais comptées sur la ligne de matériel et tracées dans
 *    un journal de mouvements, pour qu'un total puisse toujours s'expliquer.
 */
const migration: Migration = {
  id: '003_manifestations_reception',
  description: "Sources de réception, alias d'articles, date de récupération, pertes et mouvements de stock",

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_intake_sources (
      id INTEGER PRIMARY KEY ${autoIncrement},
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      secret VARCHAR(255) NOT NULL,
      is_active ${booleen} DEFAULT 1,
      field_mapping ${texteLong},
      material_mapping ${texteLong},
      last_payload ${texteLong},
      last_received_at DATETIME,
      last_status VARCHAR(20),
      created_at DATETIME ${horodatageParDefaut},
      updated_at DATETIME ${horodatageParDefaut}
    )`);

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_intake_requests (
      id INTEGER PRIMARY KEY ${autoIncrement},
      source_id INTEGER,
      external_id VARCHAR(255),
      payload ${texteLong},
      signature_ok ${booleen} DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      manifestation_id INTEGER,
      error ${texteLong},
      received_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (source_id) REFERENCES manifestation_intake_sources(id) ON DELETE SET NULL,
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE SET NULL
    )`);

    // Le formulaire dit « tables », le stock dit « Table 180 cm ». Sans table
    // d'alias, chaque demande obligerait à rattacher le matériel à la main.
    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_stock_aliases (
      id INTEGER PRIMARY KEY ${autoIncrement},
      stock_id INTEGER NOT NULL,
      alias VARCHAR(255) NOT NULL,
      created_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE CASCADE
    )`);

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_stock_movements (
      id INTEGER PRIMARY KEY ${autoIncrement},
      stock_id INTEGER NOT NULL,
      manifestation_id INTEGER,
      type VARCHAR(20) NOT NULL,
      quantity INTEGER NOT NULL,
      reason ${texteLong},
      user_id INTEGER,
      created_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE CASCADE,
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

    const colonnesManifestations = await colonnesDe(ctx, 'manifestations');
    if (!colonnesManifestations.has('recovery_date')) {
      await ctx.executer('ALTER TABLE manifestations ADD COLUMN recovery_date DATE');
    }
    if (!colonnesManifestations.has('intake_request_id')) {
      await ctx.executer('ALTER TABLE manifestations ADD COLUMN intake_request_id INTEGER');
    }
    // Les lignes que la réception n'a pas su rattacher au stock. Les jeter
    // reviendrait à recevoir une demande amputée sans que personne le sache.
    if (!colonnesManifestations.has('intake_unmatched')) {
      await ctx.executer(`ALTER TABLE manifestations ADD COLUMN intake_unmatched ${texteLong}`);
    }

    const colonnesMateriels = await colonnesDe(ctx, 'manifestation_materials');
    if (!colonnesMateriels.has('quantity_lost')) {
      await ctx.executer(
        'ALTER TABLE manifestation_materials ADD COLUMN quantity_lost INTEGER NOT NULL DEFAULT 0'
      );
    }
    if (!colonnesMateriels.has('loss_reason')) {
      await ctx.executer(`ALTER TABLE manifestation_materials ADD COLUMN loss_reason ${texteLong}`);
    }

    // Les index correspondants sont déclarés dans `createIndexes()`, qui tolère
    // une table absente et se rejoue à chaque démarrage.
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
