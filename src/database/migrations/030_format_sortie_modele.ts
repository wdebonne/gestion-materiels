import type { ContexteMigration, Migration } from './types';

/**
 * Le format sous lequel un modèle de service rend son document.
 *
 * Un arrêté ou une convention partait en `.docx`, seul format que
 * `easy-template-x` sache produire. Chez le destinataire, la mise en page
 * dépend alors de son traitement de texte, et le texte se laisse modifier sans
 * qu'il en reste trace — deux défauts qui n'ont pas leur place sur un acte
 * signé. Le Nextcloud de la commune porte un serveur bureautique capable de
 * convertir : il ne manquait que de savoir quand le faire.
 *
 * Le réglage est porté par le modèle, et non par une préférence générale : le
 * service qui retouche son document avant de l'envoyer a besoin du `.docx`,
 * celui qui le fait signer a besoin du PDF, et les deux ont raison. La valeur
 * par défaut reste `docx`, pour que les modèles déjà réglés continuent de
 * rendre exactement ce qu'ils rendaient.
 */
const formatSortieModele: Migration = {
  id: '030_format_sortie_modele',
  description: 'Format rendu par un modèle de service : .docx, PDF, ou les deux',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'service_templates');
    if (colonnes.size === 0) return;

    if (!colonnes.has('output_format')) {
      await ctx.executer(
        "ALTER TABLE service_templates ADD COLUMN output_format VARCHAR(10) DEFAULT 'docx'"
      );
    }
  },
};

/** Colonnes existantes d'une table, dans les deux dialectes supportés. */
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

export default formatSortieModele;
