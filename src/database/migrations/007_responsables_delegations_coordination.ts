import type { Migration } from './types';

/**
 * Responsables de service, délégations, service coordinateur, et comptes
 * anonymisables.
 *
 * Trois manques, tous constatés à l'usage.
 *
 * **Qui décide.** `service_members.is_manager` était enregistré et relu, mais ne
 * décidait rien : n'importe quel membre pouvait approuver au nom de son service.
 * Approuver engage la collectivité — c'est au responsable de le faire, et à lui
 * seul de déléguer quand il s'absente.
 *
 * **Le service qui pilote.** Une collectivité a un service qui suit *toutes* les
 * manifestations et prononce la validation finale — Culture et Communication
 * ici, un autre ailleurs. Rien ne permettait de le désigner : il n'y avait que
 * des services concernés par leur périmètre, et des observateurs sans pouvoir.
 *
 * **Les comptes qui partent.** `DELETE /users/:id` effaçait la ligne, et chaque
 * clé étrangère en `ON DELETE SET NULL` vidait l'auteur des décisions, des
 * messages et de l'historique. Une manifestation perdait ainsi la trace de qui
 * l'avait validée le jour où la personne quittait la collectivité — alors que
 * c'est précisément ce qu'un litige exige de retrouver. L'anonymisation garde le
 * lien et retire l'identité, ce que la suppression ne sait pas faire.
 */
const migration: Migration = {
  id: '007_responsables_delegations_coordination',
  description:
    'Délégations d\'approbation, service coordinateur des manifestations, et anonymisation des comptes',

  async up(ctx) {
    const { autoIncrement, booleen, horodatageParDefaut } = ctx;

    /**
     * Délégation d'approbation, accordée par un responsable.
     *
     * Les dates sont facultatives : sans elles, la délégation vaut jusqu'à
     * révocation. C'est le cas d'un adjoint permanent, aussi courant qu'un
     * remplacement de congés.
     */
    await ctx.executer(`CREATE TABLE IF NOT EXISTS service_delegations (
      id INTEGER PRIMARY KEY ${autoIncrement},
      service_id INTEGER NOT NULL,
      delegate_user_id INTEGER NOT NULL,
      granted_by INTEGER,
      start_date DATE,
      end_date DATE,
      created_at DATETIME ${horodatageParDefaut},
      UNIQUE(service_id, delegate_user_id),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
    )`);

    const colonnesServices = await colonnesDe(ctx, 'services');
    if (!colonnesServices.has('is_coordinator')) {
      await ctx.executer(`ALTER TABLE services ADD COLUMN is_coordinator ${booleen} DEFAULT 0`);
    }

    const colonnesUsers = await colonnesDe(ctx, 'users');
    // Date d'anonymisation : elle distingue un compte dépersonnalisé d'un compte
    // simplement désactivé, et interdit de recommencer sur un compte déjà traité.
    if (!colonnesUsers.has('anonymized_at')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN anonymized_at DATETIME');
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
