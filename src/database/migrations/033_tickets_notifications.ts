import type { Migration } from './types';

/**
 * Qui d'autre doit être prévenu, et à quelle condition.
 *
 * Le socle des demandes prévient déjà les évidents : le demandeur, le technicien
 * à qui c'est confié, le service destinataire, et ceux qu'on a mis en copie. Et
 * la grille par rôle, héritée des manifestations, ajoute « tout superviseur
 * reçoit tel événement ».
 *
 * Ni l'un ni l'autre ne sait dire ce qui a été demandé : *« une fuite à la
 * mairie doit prévenir le responsable de la maintenance et l'élu chargé des
 * travaux, en plus du demandeur et du technicien »*. Ce n'est ni un rôle — l'élu
 * n'en a pas — ni le service destinataire, et cela ne vaut que pour **ce
 * bâtiment** et **cette catégorie**.
 *
 * ## Une colonne de portée vide vaut « peu importe »
 *
 * Une règle se lit comme une phrase, et c'est ainsi que l'écran l'affiche :
 *
 *   Quand **[événement]**, pour une demande de **[catégorie]** / **[sous-catégorie]**,
 *   sur **[bâtiment]**, traitée par **[service]** → prévenir **[qui]**.
 *
 * Chaque partie laissée vide élargit la règle au lieu de la restreindre. Une
 * règle sans autre portée que `site_id = Mairie` vaut pour toutes les demandes
 * de la mairie ; c'est le motif habituel, et il évite d'avoir à écrire une règle
 * par combinaison.
 *
 * ## Les règles **ajoutent**, elles ne remplacent jamais
 *
 * La tentation serait de faire gagner la règle la plus précise. Ce serait un
 * piège : ajouter le responsable de la maintenance parce qu'on est à la mairie
 * **retirerait** alors le technicien attitré de la catégorie, et personne ne
 * comprendrait pourquoi. Les destinataires s'additionnent, puis les préférences
 * de chacun s'appliquent. Mieux vaut un message de trop qu'un silence — c'est
 * la doctrine déjà tenue par les manifestations.
 *
 * ## Le destinataire peut être quelqu'un sans compte
 *
 * L'élu chargé des travaux figure à l'annuaire avec `can_login = 0` depuis la
 * migration 028. `destinatairesParRole()` écarte volontairement ces fiches — les
 * liens d'un message mèneraient à un écran de connexion qu'elles ne passeront
 * pas — mais une personne **nommée par une règle** n'est pas filtrée : on lui
 * écrit qu'il y a une fuite à la mairie, elle n'a pas besoin d'un lien.
 *
 * ## `CASCADE` sur la portée, et c'est important
 *
 * C'est le seul endroit du schéma où `SET NULL` serait dangereux : une colonne
 * de portée à `NULL` voulant dire « peu importe », effacer la catégorie d'une
 * règle ciblée la transformerait **silencieusement en règle universelle**. Le
 * responsable de la maintenance recevrait alors toutes les demandes de la
 * commune, sans que personne ait rien décidé.
 */
const ticketsNotifications: Migration = {
  id: '033_tickets_notifications',
  description: 'Règles de diffusion des demandes : qui prévenir, et à quelle condition',

  async up(ctx) {
    const { autoIncrement, booleen, horodatageParDefaut } = ctx;

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_notification_regles (
        id INTEGER PRIMARY KEY ${autoIncrement},
        evenement VARCHAR(60),
        categorie_id INTEGER,
        sous_categorie_id INTEGER,
        site_id INTEGER,
        service_id INTEGER,
        destinataire_type VARCHAR(20) NOT NULL,
        destinataire_user_id INTEGER,
        destinataire_service_id INTEGER,
        destinataire_role VARCHAR(50),
        libelle VARCHAR(255),
        is_active ${booleen} NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (categorie_id) REFERENCES ticket_categories(id) ON DELETE CASCADE,
        FOREIGN KEY (sous_categorie_id) REFERENCES ticket_categories(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (destinataire_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (destinataire_service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );

    // La recherche part toujours de l'événement, puis restreint sur la portée.
    await ctx.creerIndex('idx_ticket_regles_evt', 'ticket_notification_regles', 'evenement, is_active');
    await ctx.creerIndex(
      'idx_ticket_regles_cat',
      'ticket_notification_regles',
      'categorie_id, sous_categorie_id'
    );
    await ctx.creerIndex('idx_ticket_regles_site', 'ticket_notification_regles', 'site_id');

    /*
     * `evenement` est nullable : la règle vaut alors pour **tous** les
     * événements de la demande. C'est ce qu'on veut d'un élu qui suit un
     * bâtiment — il n'a pas à cocher six cases pour être tenu au courant.
     *
     * `destinataire_type` vaut 'user', 'service' ou 'role', et exactement une
     * des trois colonnes correspondantes est renseignée. Règle tenue par le
     * service : MySQL 5.7 analyse les contraintes `CHECK` puis les ignore, si
     * bien qu'elles protégeraient le développement et pas la production. C'est
     * le choix déjà fait pour `cle_attributions` et `planning_participants`.
     */
  },
};

export default ticketsNotifications;
