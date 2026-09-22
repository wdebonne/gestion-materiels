import type { ContexteMigration, Migration } from './types';

/**
 * Le temps passé sur une demande, et la reprise de GestSup.
 *
 * ## Une colonne, pas une seconde comptabilité d'heures
 *
 * `planning_taches` porte déjà `manifestation_id` : rattacher une tâche à une
 * entité métier est un précédent **exact**, et le moteur de rapport sait déjà
 * répartir par entité. Ajouter `ticket_id` donne « le temps passé sur cette
 * demande », « par catégorie » et « par agent » sans écrire une ligne de
 * reporting.
 *
 * Une table dédiée aurait été le mauvais choix, et pas seulement par paresse :
 * deux comptabilités d'heures divergent. Un agent qui déclare deux heures sur
 * une fuite les aurait saisies **deux fois** — une fois pour son planning, une
 * fois pour la demande — ou une seule, et le total de sa semaine aurait été
 * faux. Les renforts, les deux mesures (temps mobilisé / temps d'une personne)
 * et l'export existant suivent gratuitement.
 *
 * La colonne est ajoutée **sans contrainte de clé étrangère**. `ALTER TABLE …
 * ADD CONSTRAINT` n'est pas portable entre SQLite et MySQL — SQLite ne sait
 * pas ajouter une clé étrangère à une table existante — et reconstruire la
 * table pour l'obtenir serait destructif sur des heures déjà déclarées. Le
 * service vérifie l'existence du ticket avant d'écrire, et un `ticket_id`
 * orphelin ne fait qu'exclure la tâche d'un rapport par demande, jamais
 * disparaître la tâche elle-même.
 *
 * ## La reprise de GestSup
 *
 * `tickets.reference_externe` existe depuis la migration 032 et porte
 * l'identifiant d'origine (`gestsup:4711`) : c'est lui qui rend l'import
 * **rejouable**. Relancer une reprise interrompue ne crée pas de doublons, et
 * corriger un fichier puis le reverser met à jour au lieu d'empiler.
 *
 * Ce qu'il manquait est la **table de correspondance** : un export GestSup
 * nomme ses demandeurs, ses services et ses statuts avec ses propres libellés,
 * qui ne sont pas ceux d'ici. Rapprocher « Informatique » de la catégorie
 * « Informatique » se devine ; rapprocher « SVC_TECH » du service Technique ne
 * se devine pas, et redemander la correspondance à chaque passage rendrait
 * l'import inutilisable. Une fois établie, elle est retenue.
 */
const ticketsTempsEtReprise: Migration = {
  id: '034_tickets_temps_et_reprise',
  description: 'Temps passé rattaché à une demande, et correspondances pour la reprise GestSup',

  async up(ctx) {
    const { autoIncrement, texteLong, horodatageParDefaut } = ctx;

    // ------------------------------------------------------- le temps passé

    const colonnes = await colonnesDe(ctx, 'planning_taches');
    if (colonnes.size > 0 && !colonnes.has('ticket_id')) {
      await ctx.executer('ALTER TABLE planning_taches ADD COLUMN ticket_id INTEGER');
    }
    if (colonnes.size > 0) {
      await ctx.creerIndex('idx_planning_taches_ticket', 'planning_taches', 'ticket_id');
    }

    // --------------------------------------------------- les correspondances

    /*
     * `domaine` dit ce qu'on rapproche : une personne, un service, un statut,
     * une catégorie, un bâtiment. `valeur_source` est ce que l'export contient,
     * `cible_id` ce qu'il désigne ici.
     *
     * `cible_id` est **nullable**, et c'est délibéré : une correspondance à
     * `NULL` veut dire « on a vu cette valeur et on a décidé de ne la
     * rapprocher de rien ». Sans cette distinction, l'import redemanderait à
     * chaque passage ce qu'on a déjà écarté, et le rapport de reprise
     * signalerait indéfiniment les mêmes lignes.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_import_correspondances (
        id INTEGER PRIMARY KEY ${autoIncrement},
        domaine VARCHAR(40) NOT NULL,
        valeur_source VARCHAR(190) NOT NULL,
        cible_id INTEGER,
        note ${texteLong},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        UNIQUE(domaine, valeur_source),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex(
      'idx_ticket_import_domaine',
      'ticket_import_correspondances',
      'domaine, valeur_source'
    );

    /*
     * `valeur_source` est en `VARCHAR(190)` et non 255 : un index unique sur
     * 255 caractères `utf8mb4` dépasse les 767 octets du format `COMPACT` de
     * MySQL, et la création de la table échouerait en production sans échouer
     * en développement. 190 × 4 = 760.
     */
  },
};

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 *
 * Recopié plutôt que partagé : une migration décrit l'état du code au jour où
 * elle a été écrite, et factoriser un helper entre migrations ferait qu'une
 * retouche d'aujourd'hui change ce qu'une migration de l'an dernier applique.
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

export default ticketsTempsEtReprise;
