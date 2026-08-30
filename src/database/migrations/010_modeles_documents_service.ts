import type { Migration } from './types';

/**
 * Modèles de document par service, et documents produits pour un service.
 *
 * Une demande reçue par formulaire concerne plusieurs services, mais chacun n'a
 * besoin que de sa part : le service qui instruit un débit de boissons n'a que
 * faire du raccordement électrique, du personnel demandé, ou du nombre de
 * chaises. Seul le service qui pilote les manifestations a besoin de tout.
 *
 * Un modèle `.docx` est rattaché au service, ses champs sont détectés à
 * l'import, et chacun est relié à une valeur de la demande. Le document produit
 * est joint à la manifestation et part avec la demande d'approbation.
 *
 * `source` distingue un modèle téléversé d'un modèle lu dans Nextcloud : ce
 * second cas permet de corriger le modèle à un seul endroit, sans repasser par
 * l'application.
 */
const migration: Migration = {
  id: '010_modeles_documents_service',
  description: 'Modèles .docx par service, champs détectés et correspondance des valeurs',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    await ctx.executer(`CREATE TABLE IF NOT EXISTS service_templates (
      id INTEGER PRIMARY KEY ${autoIncrement},
      service_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'upload',
      file_path VARCHAR(500),
      remote_path VARCHAR(500),
      /** Champs relevés dans le modèle, tels qu'ils y sont écrits. */
      detected_fields ${texteLong},
      /** Champ du modèle → valeur de la demande. */
      field_mapping ${texteLong},
      is_active ${booleen} DEFAULT 1,
      last_error ${texteLong},
      created_at DATETIME ${horodatageParDefaut},
      updated_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    )`);

    // Le document produit appartient à un service : c'est ce qui permet de ne
    // montrer à chacun que le sien, comme pour les approbations.
    const colonnesDocuments = await colonnesDe(ctx, 'manifestation_documents');
    if (!colonnesDocuments.has('service_id')) {
      await ctx.executer('ALTER TABLE manifestation_documents ADD COLUMN service_id INTEGER');
    }
    // Distingue une pièce produite par l'application d'une pièce déposée à la
    // main : seule la première se regénère, et l'écraser ne perd rien.
    if (!colonnesDocuments.has('generated_from_template')) {
      await ctx.executer(
        `ALTER TABLE manifestation_documents ADD COLUMN generated_from_template ${booleen} DEFAULT 0`
      );
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
