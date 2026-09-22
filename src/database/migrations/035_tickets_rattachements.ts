import type { ContexteMigration, Migration } from './types';

/**
 * Qui est rattaché à quoi, et ce que ce rattachement lui donne.
 *
 * La première version confondait deux choses : *être rattaché à un bâtiment* et
 * *en être responsable*. Faute de les distinguer, elle proposait tous les sites
 * à qui n'en avait aucun — ce qui est l'inverse de ce qu'on veut : un agent
 * d'accueil n'a pas à choisir entre les douze bâtiments de la commune, et n'a
 * rien à voir des demandes des autres.
 *
 * ## Une école a plusieurs responsables, et ils n'ont pas les mêmes droits
 *
 * C'est le cas qui a tout décidé. Sur une école, il y a **la directrice**, qui
 * la gère au quotidien ; **l'élu**, qui suit toutes les écoles sans en gérer
 * aucune ; et **le responsable des écoles**, qui suit les écoles *et* le
 * bâtiment où se trouve son bureau. Trois personnes, trois périmètres qui se
 * chevauchent, et trois besoins différents : la directrice et le responsable
 * veulent être prévenus par courriel, l'élu veut pouvoir regarder sans recevoir
 * un message à chaque ampoule grillée.
 *
 * Aucun rôle applicatif ne décrit cela, et aucun ne le décrira : ce ne sont pas
 * des pouvoirs, ce sont des **responsabilités locales**. Elles se posent donc
 * sur le lien personne↔bâtiment, une par une, et se relisent d'un écran.
 *
 *   `est_responsable`     peut signaler *pour le bâtiment*, et pas seulement
 *                         pour le matériel qui lui est attribué — le bureau
 *                         abîmé, la fuite, le rideau cassé
 *   `peut_voir_tickets`   lit les demandes du bâtiment. C'est ce qui donne à un
 *                         collègue qui arrive une vue de ce qui est fait et de
 *                         ce qui est en cours
 *   `notifie`             reçoit un courriel à chaque demande du bâtiment, en
 *                         plus du technicien et du service de la catégorie
 *
 * Les trois sont **indépendants**. Faire découler la notification de la lecture
 * obligerait l'élu à choisir entre ne rien voir et tout recevoir, ce qui est
 * exactement le réglage qu'on cherche à éviter.
 *
 * Un simple occupant, lui, est rattaché à son bâtiment **sans aucune des
 * trois** : c'est ce qui pré-remplit son champ quand il signale une panne sur
 * son ordinateur, sans lui ouvrir les demandes de ses collègues.
 *
 * ## « Mon matériel »
 *
 * Un agent doit pouvoir signaler une panne sur *son* téléphone ou *son*
 * ordinateur. Rien ne disait jusqu'ici qu'un matériel était le sien :
 * `objects.location` est du texte libre, et `cle_attributions` décrit une
 * remise de clé, avec sa restitution et son état de retour — une sémantique de
 * prêt qui ne convient pas à un poste affecté pour cinq ans.
 *
 * `user_materiels` dit seulement « ce matériel est attribué à cette personne ».
 * Pas de date de retour, pas d'état : ce n'est pas un prêt, c'est une
 * affectation. Un matériel peut être attribué à plusieurs personnes — un
 * véhicule de service partagé — et une personne en a autant qu'il lui en faut.
 */
const ticketsRattachements: Migration = {
  id: '035_tickets_rattachements',
  description: 'Responsables de bâtiment, notification par bâtiment, et matériel attribué',

  async up(ctx) {
    const { autoIncrement, booleen, horodatageParDefaut } = ctx;

    // ------------------------------------ les trois droits d'un rattachement

    const colonnes = await colonnesDe(ctx, 'user_sites');
    if (colonnes.size > 0) {
      if (!colonnes.has('est_responsable')) {
        await ctx.executer(
          `ALTER TABLE user_sites ADD COLUMN est_responsable ${booleen} NOT NULL DEFAULT 0`
        );
      }
      if (!colonnes.has('notifie')) {
        await ctx.executer(`ALTER TABLE user_sites ADD COLUMN notifie ${booleen} NOT NULL DEFAULT 0`);
      }
      // « Qui reçoit les demandes de ce bâtiment » est la question que pose
      // l'envoi, à chaque demande : elle mérite son index.
      await ctx.creerIndex('idx_user_sites_notifie', 'user_sites', 'site_id, notifie');
    }

    // ------------------------------------------------------- mon matériel

    /*
     * Pas de `ON DELETE CASCADE` vers `objects` mais bien un : une affectation
     * ne survit pas au matériel, et la garder laisserait une ligne qui ne
     * désigne plus rien. En revanche le **ticket** déjà ouvert sur ce matériel
     * survit, lui — `tickets.object_id` est en `SET NULL` depuis la migration
     * 032, et l'historique reste lisible.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_materiels (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        object_id INTEGER NOT NULL,
        note VARCHAR(255),
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        UNIQUE(user_id, object_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_user_materiels_user', 'user_materiels', 'user_id');
    await ctx.creerIndex('idx_user_materiels_objet', 'user_materiels', 'object_id');
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

export default ticketsRattachements;
