import type { ContexteMigration, Migration } from './types';

/**
 * Clore une demande en disant ce qu'elle a coûté, et la faire valider quand
 * l'équipe n'est pas autonome.
 *
 * « Le technicien valide le ticket, met le temps passé et s'il a été aidé,
 * comme sur le planning. » Le temps n'est pas copié sur la demande : clore crée
 * une vraie tâche de planning, liée par `planning_taches.ticket_id` (migration
 * 034), avec ses renforts dans `planning_participants`. Une seule vérité — le
 * planning, les rapports d'heures et le rapport des demandes lisent la même
 * ligne, et la corriger dans l'un la corrige partout.
 *
 * ## `tickets.tache_cloture_id`
 *
 * La tâche de la dernière clôture : celle que le superviseur relit et corrige
 * avant de valider. Colonne simple, sans clé étrangère, comme `ticket_id` en
 * 034 : ajouter une contrainte par `ALTER TABLE` est fragile sur SQLite, et le
 * service vérifie toujours que la tâche existe avant de s'en servir.
 *
 * ## `user_ticket_categories.peut_cloturer`
 *
 * « Donner la possibilité de clôturer ou pas à un agent, ou laisser la clôture
 * à un superviseur. » Posé par personne et par catégorie, à côté du niveau
 * (migration 045). `1` par défaut : aujourd'hui tout le monde clôt, et une
 * migration n'a pas à retirer un droit que personne n'a décidé de retirer.
 *
 * ## Le statut « À valider »
 *
 * Reconnu par un drapeau, `is_validation`, jamais par son nom : les statuts
 * sont ceux de la commune, qui peut les renommer. Ni ouvert — il sort de la
 * file des techniciens — ni final — la demande n'est pas close. Inséré juste
 * avant le premier statut final, en décalant l'ordre des suivants, pour se
 * ranger où on l'attend dans la colonne des états.
 *
 * Sur une base neuve, la table des statuts est vide quand les migrations
 * passent : c'est le semis (`seed.ts`) qui le crée, avec les autres.
 */
const ticketsCloture: Migration = {
  id: '046_tickets_cloture',
  description: 'Clôture avec temps passé : autonomie par catégorie, statut « À valider », tâche de clôture',

  async up(ctx) {
    const { booleen } = ctx;

    await ajouterColonne(ctx, 'user_ticket_categories', 'peut_cloturer', `${booleen} NOT NULL DEFAULT 1`);
    await ajouterColonne(ctx, 'ticket_statuts', 'is_validation', `${booleen} NOT NULL DEFAULT 0`);
    await ajouterColonne(ctx, 'tickets', 'tache_cloture_id', 'INTEGER');
    if ((await colonnesDe(ctx, 'tickets')).has('tache_cloture_id')) {
      await ctx.creerIndex('idx_tickets_tache_cloture', 'tickets', 'tache_cloture_id');
    }

    if (!(await colonnesDe(ctx, 'ticket_statuts')).has('is_validation')) return;

    const statuts = await ctx.interroger<{ id: number; slug: string; ordre: number; is_final: any; is_validation: any }>(
      'SELECT id, slug, ordre, is_final, is_validation FROM ticket_statuts'
    );
    if (statuts.length === 0) return;
    if (statuts.some((s) => Number(s.is_validation))) return;

    const existant = statuts.find((s) => s.slug === 'a-valider');
    if (existant) {
      await ctx.executer(
        `UPDATE ticket_statuts
            SET is_validation = 1, is_systeme = 1, is_ouvert = 0, is_final = 0, is_defaut = 0, is_active = 1
          WHERE id = ?`,
        [existant.id]
      );
      return;
    }

    const finals = statuts.filter((s) => Number(s.is_final)).map((s) => Number(s.ordre ?? 0));
    const ordre = finals.length > 0 ? Math.min(...finals) : Math.max(...statuts.map((s) => Number(s.ordre ?? 0))) + 1;

    await ctx.executer('UPDATE ticket_statuts SET ordre = ordre + 1 WHERE ordre >= ?', [ordre]);
    const maintenant = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await ctx.executer(
      `INSERT INTO ticket_statuts
         (nom, slug, couleur, ordre, is_ouvert, is_defaut, is_final, is_systeme, is_validation, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, 1, 1, 1, ?, ?)`,
      ['À valider', 'a-valider', 'teal', ordre, maintenant, maintenant]
    );
  },
};

/** Ajoute une colonne si elle manque. Recopié de la migration 044. */
async function ajouterColonne(ctx: ContexteMigration, table: string, colonne: string, type: string): Promise<void> {
  const colonnes = await colonnesDe(ctx, table);
  if (colonnes.size === 0 || colonnes.has(colonne)) return;
  await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
}

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

export default ticketsCloture;
