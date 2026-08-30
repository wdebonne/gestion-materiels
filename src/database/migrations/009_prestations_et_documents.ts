import type { Migration } from './types';

/**
 * Prestations demandées, et pièces jointes d'une manifestation.
 *
 * **Prestations.** Une demande ne porte pas que du matériel : elle demande aussi
 * un raccordement au réseau électrique, un débit de boissons, du personnel pour
 * une cérémonie. Rien ne les représentait, et elles finissaient dans une note
 * libre que personne ne route ni ne totalise. Une prestation est un article du
 * stock coché comme tel : elle réutilise ainsi tout le routage d'approbation,
 * qui part déjà de la catégorie de l'article.
 *
 * Le mot « prestation » est retenu et non « service » : dans cette application
 * un *service* est une équipe — service technique, service communication. Les
 * confondre rendrait chaque écran ambigu.
 *
 * **Documents.** Un arrêté de circulation, un plan d'implantation, la photo
 * d'une chaise revenue cassée ou d'un trottoir abîmé : ce sont ces pièces qui
 * font la différence en cas de litige, des mois plus tard, et rien ne permettait
 * de les conserver.
 *
 * Le lien facultatif vers le matériel concerné porte sur `stock_id` — l'article
 * — et non sur la ligne de `manifestation_materials` : celle-ci est supprimée
 * puis réinsérée à chaque modification de la manifestation, si bien qu'un lien
 * par identifiant de ligne serait rompu au premier changement de quantité.
 */
const migration: Migration = {
  id: '009_prestations_et_documents',
  description: 'Prestations demandées, documents joints et leur référentiel de types',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    const colonnesStock = await colonnesDe(ctx, 'manifestation_stock');
    if (!colonnesStock.has('is_prestation')) {
      await ctx.executer(
        `ALTER TABLE manifestation_stock ADD COLUMN is_prestation ${booleen} DEFAULT 0`
      );
    }

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_documents (
      id INTEGER PRIMARY KEY ${autoIncrement},
      manifestation_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      doc_type VARCHAR(100) DEFAULT 'autre',
      description ${texteLong},
      file_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(100),
      size INTEGER,
      stock_id INTEGER,
      object_id INTEGER,
      uploaded_by INTEGER,
      created_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
      FOREIGN KEY (stock_id) REFERENCES manifestation_stock(id) ON DELETE SET NULL,
      FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    )`);

    // Référentiel éditable, sur le modèle de `green_space_doc_types` : chaque
    // collectivité nomme ses pièces à sa façon, et une liste figée dans le code
    // obligerait à un développeur pour ajouter « autorisation de buvette ».
    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_doc_types (
      id INTEGER PRIMARY KEY ${autoIncrement},
      value VARCHAR(100) NOT NULL UNIQUE,
      label VARCHAR(255) NOT NULL,
      is_default ${booleen} DEFAULT 0,
      disabled ${booleen} DEFAULT 0,
      created_at DATETIME ${horodatageParDefaut}
    )`);

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
