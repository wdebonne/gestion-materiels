import type { Migration } from './types';

/**
 * Efface les alertes que l'ancien comportement avait mises en double.
 *
 * La recherche d'alerte existante filtrait sur `is_dismissed = 0` : une alerte
 * rejetée n'était jamais retrouvée, et le passage suivant du cron — toutes les
 * heures — en reposait une identique. Chaque rejet valait donc une ligne de
 * plus, indéfiniment. Le défaut est corrigé, mais les bases déjà en service
 * portent les doublons accumulés depuis : sur celle de développement, les
 * alertes 1-3 et 9-11 visaient les mêmes trois contrôles techniques.
 *
 * Une seule ligne est conservée par échéance : la plus récente, celle que le
 * code lit désormais (`alertePosee` ordonne par `id DESC`). Les précédentes
 * portent la même information, souvent avec une sévérité périmée.
 *
 * Ne touche que les alertes rattachées à un objet suivi — `plugin_reference`
 * et `plugin_reference_id` renseignés. Une alerte créée à la main par un
 * utilisateur n'a pas de rattachement, donc pas de doublon possible, et n'est
 * pas concernée.
 */
const alertesEnDouble: Migration = {
  id: '023_alertes_en_double',
  description: 'Ne garde qu\'une alerte par échéance, la plus récente',

  async up(ctx) {
    // Le banc d'essai des migrations les applique sur des schémas partiels :
    // une migration ne doit jamais supposer que sa table existe.
    if (!(await tableExiste(ctx, 'alerts'))) return;

    const doublons = await ctx.interroger<{
      plugin_reference: string;
      plugin_reference_id: number;
      garder: number;
    }>(
      `SELECT plugin_reference, plugin_reference_id, MAX(id) AS garder
         FROM alerts
        WHERE plugin_reference IS NOT NULL AND plugin_reference_id IS NOT NULL
        GROUP BY plugin_reference, plugin_reference_id
       HAVING COUNT(*) > 1`
    );

    let effacees = 0;
    for (const groupe of doublons) {
      const resultat = await ctx.executer(
        `DELETE FROM alerts
          WHERE plugin_reference = ? AND plugin_reference_id = ? AND id <> ?`,
        [groupe.plugin_reference, groupe.plugin_reference_id, groupe.garder]
      );
      effacees += resultat.changes ?? 0;
    }

    if (effacees > 0) {
      console.log(`🧹 ${effacees} alerte(s) en double supprimée(s)`);
    }
  },
};

/** Vrai si la table est présente, dans les deux dialectes supportés. */
async function tableExiste(
  ctx: Parameters<Migration['up']>[0],
  table: string
): Promise<boolean> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table]
    );
    return lignes.length > 0;
  }

  const lignes = await ctx.interroger(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return lignes.length > 0;
}

export default alertesEnDouble;
