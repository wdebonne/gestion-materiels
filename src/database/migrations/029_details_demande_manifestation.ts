import type { ContexteMigration, Migration } from './types';

/**
 * Ce que la demande disait, et que la manifestation ne gardait pas.
 *
 * La réception ne retenait d'un formulaire que les quatorze champs pour
 * lesquels `manifestations` a une colonne : un titre, deux dates, deux heures,
 * un contact, des notes. Tout le reste de la demande — la qualité du demandeur
 * et son association, le pôle et le service concernés, les bâtiments et les
 * salles réservés, les rues fermées à la circulation, les agents techniques
 * souhaités, le vin d'honneur, les affiches, le débit de boissons — était lu,
 * puis jeté.
 *
 * Les services le payaient deux fois : le document qu'on leur envoie ne pouvait
 * rien dire de ce qui les concerne — un arrêté de circulation sans le nom de la
 * rue n'est pas un arrêté — et l'agent qui recevait la demande devait rouvrir
 * le formulaire d'origine pour retrouver la réponse.
 *
 * Une colonne par question aurait figé dans le schéma un formulaire qui change
 * chaque année, et il aurait fallu une migration pour ajouter « Besoin de
 * goodies ? ». Les réponses sont donc conservées telles qu'elles sont arrivées,
 * avec leur intitulé et leur section, dans une seule colonne. C'est le même
 * choix que `intake_unmatched`, pour la même raison : ce qui vient du dehors
 * n'a pas à dicter la forme de la table.
 */
const detailsDemandeManifestation: Migration = {
  id: '029_details_demande_manifestation',
  description: 'Réponses du formulaire qu’aucune colonne ne portait, conservées avec la manifestation',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'manifestations');
    if (colonnes.size === 0) return;

    if (!colonnes.has('intake_details')) {
      await ctx.executer(`ALTER TABLE manifestations ADD COLUMN intake_details ${ctx.texteLong}`);
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

export default detailsDemandeManifestation;
