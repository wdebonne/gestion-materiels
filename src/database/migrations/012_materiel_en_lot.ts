import type { Migration } from './types';

/**
 * Matériel du parc tenu en lot, avec une quantité.
 *
 * Le parc ne savait compter que des **exemplaires** : ce camion-là, avec son
 * numéro de série, ses pleins et ses contrôles techniques. Cinquante chaises
 * identiques n'ont rien à faire dans ce moule — les saisir une par une donnerait
 * cinquante fiches, cinquante QR codes et cinquante historiques d'entretien pour
 * un même modèle.
 *
 * Les quantités existaient déjà, mais dans un catalogue séparé
 * (`manifestation_stock`), ce qui obligeait à tenir ses chaises à deux endroits
 * selon qu'on les regardait comme du parc ou comme du prêt. Un matériel du parc
 * peut désormais être déclaré « lot » et porter sa quantité, si bien que le
 * stock réel et prévisionnel se lit directement sur sa fiche.
 *
 * Trois natures, exclusives, et une seule règle pour les départager :
 *
 *   **unique**      un exemplaire identifié — un véhicule, un vidéoprojecteur.
 *                   Il ne peut pas être à deux endroits : un conflit est un
 *                   conflit.
 *   **lot**         une quantité — cinquante chaises, dix tables. Deux
 *                   manifestations s'en partagent, et ce qui manque est un
 *                   avertissement, pas un refus.
 *   **prestation**  un acte — raccordement électrique, débit de boissons,
 *                   personnel. Ni stock ni exemplaire. Déclarée par branche
 *                   (voir la migration 011), elle l'emporte sur `material_type` :
 *                   une prestation n'a pas de quantité en stock.
 *
 * Ce qu'un lot perd : le carburant et le contrôle technique, qui ne veulent rien
 * dire pour un modèle plutôt que pour un exemplaire — on ne fait pas le plein
 * « des chaises ». Ce qu'il garde : l'**entretien**, car un lot se répare et se
 * nettoie, et c'est précisément ce qu'on veut consigner.
 */
const migration: Migration = {
  id: '012_materiel_en_lot',
  description: 'Matériel du parc en lot, avec quantité et stock prévisionnel',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'objects');

    // Le repli est « unique » : tout le parc existant est fait d'exemplaires, et
    // les basculer en lot ferait apparaître des stocks à zéro sur des véhicules.
    if (!colonnes.has('material_type')) {
      await ctx.executer(
        `ALTER TABLE objects ADD COLUMN material_type VARCHAR(20) DEFAULT 'unique'`
      );
    }

    // Quantité détenue, pour un lot seulement. Zéro pour un exemplaire, dont la
    // quantité est toujours 1 et n'a pas à être saisie.
    if (!colonnes.has('quantity_total')) {
      await ctx.executer('ALTER TABLE objects ADD COLUMN quantity_total INTEGER DEFAULT 0');
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
