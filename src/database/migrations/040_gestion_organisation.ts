import type { ContexteMigration, Migration } from './types';

/**
 * Qui gère les bâtiments, les salles et les services.
 *
 * Jusqu'ici, la réponse tenait au rôle : l'administrateur pour les services, le
 * superviseur pour les bâtiments. Confier le référentiel des lieux au régisseur
 * des salles obligeait donc à le faire superviseur — ce qui lui donnait au
 * passage la suppression du matériel et les seuils d'alerte, dont il n'a que
 * faire.
 *
 * Deux niveaux, indépendants du rôle :
 *
 *   `users.gere_organisation`  le gestionnaire **global** — tous les bâtiments,
 *                              toutes les salles, tous les services
 *   `user_sites.gere_lieu`     le gestionnaire **d'un bâtiment** — ce bâtiment,
 *                              ses salles et ses portes, et rien d'autre
 *
 * Côté services, rien à ajouter : `service_members.is_manager` existe depuis la
 * migration 004 et dit déjà qui encadre un service. On lui donne la gestion des
 * membres, au lieu d'inventer une seconde colonne qui dirait presque la même
 * chose.
 *
 * ## « Salle », écrit d'une seule façon
 *
 * `site_pieces.type_lieu` est libre, et c'est voulu. Mais le formulaire externe
 * liste désormais les salles par ce type : une « salle » saisie en minuscules,
 * ou suivie d'une espace, ne sortirait pas. On réécrit donc les variantes
 * existantes une fois ; le service compare ensuite sans casse.
 */
const gestionOrganisation: Migration = {
  id: '040_gestion_organisation',
  description: 'Gestionnaires des bâtiments et des services, et type « Salle » normalisé',

  async up(ctx) {
    const { booleen } = ctx;

    const colonnesUsers = await colonnesDe(ctx, 'users');
    if (colonnesUsers.size > 0 && !colonnesUsers.has('gere_organisation')) {
      await ctx.executer(
        `ALTER TABLE users ADD COLUMN gere_organisation ${booleen} NOT NULL DEFAULT 0`
      );
    }

    const colonnesRattachements = await colonnesDe(ctx, 'user_sites');
    if (colonnesRattachements.size > 0 && !colonnesRattachements.has('gere_lieu')) {
      await ctx.executer(`ALTER TABLE user_sites ADD COLUMN gere_lieu ${booleen} NOT NULL DEFAULT 0`);
    }

    const colonnesPieces = await colonnesDe(ctx, 'site_pieces');
    if (colonnesPieces.has('type_lieu')) {
      await ctx.executer(
        `UPDATE site_pieces SET type_lieu = 'Salle'
          WHERE LOWER(TRIM(type_lieu)) = 'salle' AND type_lieu <> 'Salle'`
      );
    }
  },
};

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 *
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

export default gestionOrganisation;
