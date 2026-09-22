import type { ContexteMigration, Migration } from './types';

/**
 * Les demandes internes : qui signale quoi, où, et qui s'en occupe.
 *
 * Les demandes de la commune passent aujourd'hui par GestSup, une application
 * séparée. Deuxième outil, deuxième annuaire, deuxième mot de passe — et
 * surtout aucun lien avec le parc : un ticket « souci de bruit sur le Nemo »
 * n'apparaît nulle part dans la fiche du Nemo, et « le rideau est cassé à la
 * salle des fêtes » se ressaisit trois fois parce que personne ne voit ce que
 * les autres ont déjà signalé.
 *
 * L'application possédait déjà presque toutes les briques : l'annuaire complet
 * (`users`, personnes sans compte comprises depuis la migration 028), les
 * équipes (`services` + `service_members`), le référentiel des lieux
 * (`cle_sites`), le parc (`objects`), un fil d'échange, des pièces jointes et un
 * moteur de notification. Ce qui manquait, c'est le ticket lui-même, et deux
 * liaisons : utilisateur↔bâtiment, et catégorie de demande↔équipe qui traite.
 *
 * Quatre décisions méritent d'être écrites ici.
 *
 * ## Le bâtiment, c'est `cle_sites` — et la table ne change pas de nom
 *
 * `cle_sites` porte déjà la mairie, la salle des fêtes et le centre de loisirs,
 * avec leur code et leur adresse, alimentés jusque par l'import Snipe-IT. C'est
 * le référentiel de bâtiments de la commune ; il est simplement né dans le
 * module Clés, et son nom le raconte.
 *
 * Le renommer serait plus joli et plus risqué. `ALTER TABLE … RENAME` n'est pas
 * rejouable — une migration qui doit pouvoir repasser sans effet ne peut pas
 * s'appuyer dessus — et la table est lue par `cle.routes.ts`,
 * `snipeIt.service.ts` et la migration 026. On garde donc le nom physique, on
 * l'expose sous `/api/sites` par un service partagé, et l'interface l'appelle
 * « Sites et bâtiments ». Le prix de ce choix est ce commentaire ; le prix de
 * l'autre aurait été une migration destructive.
 *
 * ## Une catégorie de demande n'est pas une catégorie de matériel
 *
 * `categories` décrit **ce que la commune possède** — véhicules, tondeuses.
 * Une catégorie de demande décrit **ce qui ne va pas** — informatique,
 * plomberie, voirie. Les confondre obligerait à inventer une catégorie de parc
 * « Plomberie » sans un seul matériel dedans, qui apparaîtrait ensuite dans
 * l'inventaire, dans les droits et dans tous les écrans du parc.
 *
 * D'où `ticket_categories`, avec son propre `parent_id` sur deux niveaux. La
 * profondeur est tenue par le service et non par un `CHECK` : MySQL 5.7 analyse
 * les contraintes `CHECK` puis les ignore, si bien qu'elles protégeraient le
 * développement et pas la production. La migration 024 a tranché pareil pour
 * `cle_attributions`, la 031 pour `planning_participants`.
 *
 * ## Ce qui se partage par bâtiment est décidé par la nature de la demande
 *
 * « M. Dupont a déjà signalé le rideau cassé » n'a de valeur que si les
 * collègues du bâtiment voient le ticket. Mais une demande informatique est
 * souvent personnelle, et l'ouvrir au bâtiment serait une indiscrétion.
 *
 * Le partage est donc porté par `ticket_categories.visibilite`, pas par le
 * compte : « Bâtiment » passe en `'site'`, « Informatique » reste en
 * `'privee'`. C'est la seule formulation qu'on puisse expliquer à un agent
 * sans lui faire ouvrir un tableau de droits — et elle se règle une fois, pas
 * par personne.
 *
 * ## Les traces ne s'effacent pas avec les comptes
 *
 * Aucune clé étrangère vers `users` n'est en `ON DELETE CASCADE`. Supprimer un
 * compte effacerait des tickets qui prouvent qu'une demande a été faite et
 * traitée. La suppression reste de toute façon conditionnée par `tracesDe()`
 * (`comptes.service.ts`), à qui ces tables sont enseignées en même temps que
 * cette migration : quelqu'un qui a ouvert un ticket est désactivé, pas effacé.
 *
 *   `ticket_statuts`              les états, que la commune renomme à sa guise
 *   `ticket_categories`           la nature de la demande, et vers qui elle va
 *   `ticket_categorie_materiels`  quel parc une catégorie propose au demandeur
 *   `user_sites`                  à quels bâtiments une personne est rattachée
 *   `user_ticket_categories`      ce qu'une personne a le droit de demander
 *   `tickets`                     la demande elle-même
 *   `ticket_messages`             ce qu'une personne écrit
 *   `ticket_history`              ce que le système constate
 *   `ticket_documents`            les pièces, du ticket ou d'un message
 *   `ticket_watchers`             ceux qui suivent sans rien traiter
 */
const tickets: Migration = {
  id: '032_tickets',
  description: 'Tickets : demandes internes, catégories routées, fil d’échange et pièces jointes',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    // ------------------------------------------------------------ les statuts

    /*
     * Les six états demandés sont semés par `seed.ts`, pas ici : une migration
     * pose la forme, le semis pose le contenu, et le semis sait ne rien
     * reposer sur un référentiel déjà rempli. Reposer les statuts à chaque
     * démarrage ferait réapparaître ceux qu'une commune a volontairement
     * retirés.
     *
     * Trois drapeaux, et non un seul champ « type », parce qu'ils ne sont pas
     * exclusifs : « en attente de retour » est ouvert sans être le défaut,
     * « refusé » est final sans être une résolution.
     *
     *   `is_ouvert`  le ticket compte encore comme à traiter
     *   `is_defaut`  l'état d'un ticket qui vient d'être ouvert
     *   `is_final`   le ticket est clos, la date de clôture est posée
     *
     * `is_systeme` protège les deux états sans lesquels le code n'a plus de
     * point de départ ni d'arrivée. La route refuse de les supprimer.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_statuts (
        id INTEGER PRIMARY KEY ${autoIncrement},
        nom VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        couleur VARCHAR(20),
        icone VARCHAR(50),
        ordre INTEGER DEFAULT 0,
        is_ouvert ${booleen} NOT NULL DEFAULT 1,
        is_defaut ${booleen} NOT NULL DEFAULT 0,
        is_final ${booleen} NOT NULL DEFAULT 0,
        is_systeme ${booleen} NOT NULL DEFAULT 0,
        is_active ${booleen} NOT NULL DEFAULT 1,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut}
      )`
    );
    await ctx.creerIndex('idx_ticket_statuts_ordre', 'ticket_statuts', 'ordre');

    // --------------------------------------------------------- les catégories

    /*
     * `name_normalise` existe pour la même raison que dans `planning_categories`
     * (migration 031) : `UNIQUE(nom)` ne veut pas dire la même chose selon le
     * moteur. MySQL, en `utf8mb4_unicode_ci`, ignore la casse et les accents ;
     * SQLite, en `BINARY`, ne les ignore pas. Sans colonne normalisée, SQLite
     * accepterait « Plomberie » et « plomberie » côte à côte, et les demandes
     * se répartiraient entre deux catégories que rien ne distingue à l'œil.
     *
     * L'unicité porte sur le couple parent + nom normalisé plutôt que sur le
     * nom seul : « Écran » sous « Informatique » et « Écran » sous
     * « Signalétique » sont deux sous-catégories légitimes.
     *
     * Mais elle porte sur `parent_cle`, et non sur `parent_id`. Les deux
     * moteurs tiennent deux `NULL` pour distincts dans un index unique — c'est
     * la règle SQL, et la migration 031 s'en sert même à dessein pour ses
     * renforts non nommés. `UNIQUE(parent_id, name_normalise)` ne contraindrait
     * donc **rien du tout sur les catégories racines**, dont le `parent_id` est
     * `NULL` : « Informatique » pourrait être créée deux fois, et les demandes
     * se répartiraient entre les deux. `parent_cle` porte le même
     * renseignement avec `0` à la place de `NULL`, et l'index reprend prise.
     * Le service l'écrit à chaque enregistrement.
     *
     * Toutes les colonnes de comportement — `service_id`, `technicien_id`,
     * `visibilite`, `materiel_mode`, `site_mode` et les deux délais — sont
     * **nullables sur une sous-catégorie, où `NULL` veut dire « hérite de la
     * parente »**. C'est la convention déjà tenue par `subcategories` pour ses
     * drapeaux `available_for_*`, et elle évite d'avoir à recopier le routage
     * sur chaque sous-catégorie, donc de le voir diverger.
     *
     * `visibilite` vaut `'privee'` ou `'site'` ; `materiel_mode` vaut `'aucun'`,
     * `'optionnel'` ou `'requis'` ; `site_mode` vaut `'auto'`, `'requis'` ou
     * `'masque'`. Valeurs vérifiées par le service, pas par un `CHECK`.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_categories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        nom VARCHAR(160) NOT NULL,
        name_normalise VARCHAR(160) NOT NULL,
        parent_id INTEGER,
        parent_cle INTEGER NOT NULL DEFAULT 0,
        description ${texteLong},
        couleur VARCHAR(20),
        icone VARCHAR(50),
        ordre INTEGER DEFAULT 0,
        is_active ${booleen} NOT NULL DEFAULT 1,
        service_id INTEGER,
        technicien_id INTEGER,
        visibilite VARCHAR(20),
        materiel_mode VARCHAR(20),
        site_mode VARCHAR(20),
        sla_prise_en_charge_minutes INTEGER,
        sla_resolution_minutes INTEGER,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        UNIQUE(parent_cle, name_normalise),
        FOREIGN KEY (parent_id) REFERENCES ticket_categories(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
        FOREIGN KEY (technicien_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_ticket_cat_parent', 'ticket_categories', 'parent_id');
    await ctx.creerIndex('idx_ticket_cat_actives', 'ticket_categories', 'is_active');
    await ctx.creerIndex('idx_ticket_cat_service', 'ticket_categories', 'service_id');

    /*
     * Ce que le formulaire propose comme matériel, pour cette catégorie.
     *
     * Sans cette table, « souci de bruit sur le Nemo » obligerait à dérouler
     * tout le parc de la commune dans une liste — donc à ne jamais s'en servir.
     * Une catégorie « Informatique » pointe les catégories de parc qui la
     * concernent, et le sélecteur ne montre que celles-là.
     *
     * `category_id` ou `subcategory_id`, jamais les deux : une catégorie de
     * parc entière, ou une sous-catégorie précise. Règle tenue par le service.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_categorie_materiels (
        id INTEGER PRIMARY KEY ${autoIncrement},
        ticket_categorie_id INTEGER NOT NULL,
        category_id INTEGER,
        subcategory_id INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (ticket_categorie_id) REFERENCES ticket_categories(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex(
      'idx_ticket_cat_mat_categorie',
      'ticket_categorie_materiels',
      'ticket_categorie_id'
    );

    // ------------------------------------------- les rattachements de personnes

    /*
     * À quels bâtiments une personne est rattachée.
     *
     * C'est la liaison qui manquait à l'application : `cle_sites` existait,
     * `users` existait, rien ne les reliait. Elle sert deux fois — au
     * formulaire, qui masque le champ « bâtiment » quand il n'y a qu'une
     * réponse possible, et à la visibilité, qui montre les demandes du
     * bâtiment.
     *
     * **Aucune ligne pour un compte vaut « aucune restriction »** : la personne
     * choisit librement parmi tous les sites. Sans cette convention, il
     * faudrait rattacher trois cents agents avant que le module ne serve à
     * quoi que ce soit, et le module ne servirait jamais.
     *
     * `peut_voir_tickets` est à 0 par défaut, et c'est délibéré : être affecté
     * à la mairie ne donne pas le droit de lire les demandes des collègues. Le
     * droit s'accorde, il ne se déduit pas du rattachement.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_sites (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        peut_voir_tickets ${booleen} NOT NULL DEFAULT 0,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        UNIQUE(user_id, site_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_user_sites_user', 'user_sites', 'user_id');
    await ctx.creerIndex('idx_user_sites_site', 'user_sites', 'site_id');

    /*
     * Ce qu'une personne a le droit de demander.
     *
     * Même convention : aucune ligne = toutes les catégories actives lui sont
     * proposées. La table ne sert qu'à restreindre volontairement — un agent
     * d'accueil à qui on ne veut proposer que « Informatique » et
     * « Fournitures ».
     *
     * `materiel_autorise` est nullable, et `NULL` veut dire « ce que la
     * catégorie a décidé ». C'est ce qui répond à « si l'option est activée
     * pour l'utilisateur » sans dupliquer le réglage : la catégorie pose la
     * règle générale, la ligne d'exception la corrige pour une personne.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_ticket_categories (
        id INTEGER PRIMARY KEY ${autoIncrement},
        user_id INTEGER NOT NULL,
        ticket_categorie_id INTEGER NOT NULL,
        materiel_autorise ${booleen},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        UNIQUE(user_id, ticket_categorie_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (ticket_categorie_id) REFERENCES ticket_categories(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_user_tcat_user', 'user_ticket_categories', 'user_id');

    // -------------------------------------------------------------- le ticket

    /*
     * `reference` est dérivée de l'identifiant après insertion — `T-2026-123` —
     * et non d'un compteur « le plus grand numéro plus un ». Deux saisies
     * simultanées tireraient le même numéro d'un tel compteur, et l'unicité les
     * ferait échouer au hasard, sur un geste que l'utilisateur ne peut pas
     * comprendre. L'identifiant est déjà unique et déjà attribué par le moteur ;
     * le formater suffit, et une transaction suffit à le poser.
     *
     * Elle est nullable le temps de cette écriture, et le restera pour les
     * tickets repris de GestSup, qui portent leur ancien numéro.
     *
     * `site_id` et `object_id` sont en `SET NULL` : perdre le bâtiment d'un
     * ticket est regrettable, perdre le ticket le serait davantage.
     *
     * Les échéances sont des instants — un `DATETIME` convient. La règle du
     * `VARCHAR(10)` posée par la migration 031 vise les **jours métier**, qu'on
     * compare et qu'on trie ; ici, l'heure fait partie du délai.
     *
     * `visibilite_site` est **recopiée** de la catégorie au moment de la
     * création, au lieu d'être relue par une jointure. Deux raisons, et la
     * seconde est la vraie. La portée est interrogée à chaque affichage de la
     * file : une colonne indexée à côté de `site_id` s'y lit d'un trait, là où
     * la jointure devrait en plus résoudre l'héritage sous-catégorie → parente.
     * Surtout, basculer « Bâtiment » en partagé ne doit pas **exposer
     * rétroactivement** les demandes écrites quand elles étaient privées :
     * leurs auteurs ne l'ont jamais accepté. Le réglage vaut pour la suite, et
     * l'écran d'administration propose explicitement de l'appliquer à
     * l'existant — un geste, pas un effet de bord.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY ${autoIncrement},
        reference VARCHAR(30) UNIQUE,
        titre VARCHAR(255) NOT NULL,
        description ${texteLong},
        demandeur_id INTEGER NOT NULL,
        site_id INTEGER,
        ouvrant_id INTEGER,
        categorie_id INTEGER,
        sous_categorie_id INTEGER,
        object_id INTEGER,
        statut_id INTEGER NOT NULL,
        priorite VARCHAR(20) NOT NULL DEFAULT 'normale',
        visibilite_site ${booleen} NOT NULL DEFAULT 0,
        service_id INTEGER,
        technicien_id INTEGER,
        echeance_prise_en_charge DATETIME,
        echeance_resolution DATETIME,
        pris_en_charge_at DATETIME,
        pris_en_charge_by INTEGER,
        resolu_at DATETIME,
        resolu_by INTEGER,
        ferme_at DATETIME,
        origine VARCHAR(20) NOT NULL DEFAULT 'application',
        reference_externe VARCHAR(50),
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (demandeur_id) REFERENCES users(id),
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE SET NULL,
        FOREIGN KEY (ouvrant_id) REFERENCES cle_ouvrants(id) ON DELETE SET NULL,
        FOREIGN KEY (categorie_id) REFERENCES ticket_categories(id) ON DELETE SET NULL,
        FOREIGN KEY (sous_categorie_id) REFERENCES ticket_categories(id) ON DELETE SET NULL,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
        FOREIGN KEY (statut_id) REFERENCES ticket_statuts(id),
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
        FOREIGN KEY (technicien_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (pris_en_charge_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (resolu_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    // Les cinq règles de visibilité interrogent chacune une de ces colonnes, et
    // la file les combine avec le statut. Ce sont les lectures de tous les
    // écrans du module.
    await ctx.creerIndex('idx_tickets_statut', 'tickets', 'statut_id');
    await ctx.creerIndex('idx_tickets_demandeur', 'tickets', 'demandeur_id');
    await ctx.creerIndex('idx_tickets_technicien', 'tickets', 'technicien_id');
    await ctx.creerIndex('idx_tickets_service', 'tickets', 'service_id');
    await ctx.creerIndex('idx_tickets_site', 'tickets', 'site_id, visibilite_site');
    await ctx.creerIndex('idx_tickets_categorie', 'tickets', 'categorie_id');
    await ctx.creerIndex('idx_tickets_objet', 'tickets', 'object_id');
    await ctx.creerIndex('idx_tickets_creation', 'tickets', 'created_at');

    // ----------------------------------------------------------------- le fil

    /*
     * Deux tables, une seule lecture.
     *
     * GestSup affiche une colonne unique où se mêlent « Ouverture du ticket »,
     * « Envoi Mail », « Résolu » et les messages écrits par des gens. C'est la
     * bonne lecture, et on la garde — mais pas au prix d'une seule table, qui
     * porterait des colonnes vides sur chaque ligne et laisserait un
     * utilisateur modifier une trace d'audit.
     *
     * La fusion se fait donc côté serveur, en JavaScript : deux `SELECT`, une
     * concaténation, un tri par date. Un `UNION` de deux formes différentes est
     * dialectal, et le paginer serait pénible pour un gain nul — un ticket
     * porte quelques dizaines de lignes, pas des milliers.
     *
     * `is_interne` est la note de service, que le demandeur ne voit pas. C'est
     * ce qui manque à GestSup quand un technicien veut écrire « à commander
     * chez X, délai trois semaines » sans l'adresser à celui qui attend.
     *
     * `sequence` numérote les lignes **dans le ticket**, toutes tables
     * confondues, et c'est elle qui ordonne le fil. `created_at` ne suffit pas :
     * un `DATETIME` ne porte pas les fractions de seconde, et une action en
     * produit plusieurs d'un coup — la capture GestSup montre une ouverture et
     * trois envois de courriel à la même minute. Trier sur l'horodatage seul
     * laisserait leur ordre au hasard de la base, et « Résolu » pourrait
     * s'afficher avant « Ouverture ». Deux tables, mais un seul compteur.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY ${autoIncrement},
        ticket_id INTEGER NOT NULL,
        user_id INTEGER,
        service_id INTEGER,
        body ${texteLong} NOT NULL,
        is_interne ${booleen} NOT NULL DEFAULT 0,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_ticket_messages_ticket', 'ticket_messages', 'ticket_id, sequence');

    /*
     * Ce que le système constate : un changement de statut, une réaffectation,
     * une échéance posée. Plus général que `manifestation_history`, qui ne sait
     * décrire qu'un passage d'un statut à un autre — un ticket change aussi de
     * technicien, de catégorie et de matériel, et chacun de ces gestes doit se
     * relire un an après.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_history (
        id INTEGER PRIMARY KEY ${autoIncrement},
        ticket_id INTEGER NOT NULL,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        champ VARCHAR(100),
        ancienne_valeur ${texteLong},
        nouvelle_valeur ${texteLong},
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_ticket_history_ticket', 'ticket_history', 'ticket_id, sequence');

    // -------------------------------------------------------- les pièces jointes

    /*
     * `message_id` **nullable**, et c'est tout le mécanisme.
     *
     * La demande était « joindre des photos ou document simplement dans le
     * corps du message ou de joindre facilement en dessous ». Renseigné, la
     * pièce appartient à un message et s'affiche en vignette dans sa bulle ;
     * laissé vide, elle appartient au ticket et se range dans la liste du bas.
     *
     * Visuellement, on obtient l'image dans le message. Techniquement, on n'a
     * jamais stocké de HTML — ce qui compte dans un module dont le principe est
     * que des gens s'écrivent, et dans un dépôt qui n'a aucun sanitiseur.
     *
     * `ON DELETE CASCADE` sur le message : effacer un message emporte ses
     * vignettes, sans quoi elles resteraient orphelines dans la liste du bas.
     * Le fichier sur disque est retiré par le service, comme le fait déjà
     * `manifestationDocuments.service.ts`.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_documents (
        id INTEGER PRIMARY KEY ${autoIncrement},
        ticket_id INTEGER NOT NULL,
        message_id INTEGER,
        name VARCHAR(255) NOT NULL,
        description ${texteLong},
        file_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100),
        size INTEGER,
        uploaded_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES ticket_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_ticket_docs_ticket', 'ticket_documents', 'ticket_id');
    await ctx.creerIndex('idx_ticket_docs_message', 'ticket_documents', 'message_id');

    // ------------------------------------------------------- les observateurs

    /*
     * Le responsable de la maintenance, l'élu chargé des travaux : ils suivent
     * une fuite à la mairie sans la traiter. Une personne **ou** un service,
     * comme `manifestation_watchers`, dont c'est la reprise directe.
     *
     * Être observateur donne le droit de voir le ticket : c'est la cinquième
     * règle de `porteeTickets()`.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS ticket_watchers (
        id INTEGER PRIMARY KEY ${autoIncrement},
        ticket_id INTEGER NOT NULL,
        user_id INTEGER,
        service_id INTEGER,
        added_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_ticket_watchers_ticket', 'ticket_watchers', 'ticket_id');
    await ctx.creerIndex('idx_ticket_watchers_user', 'ticket_watchers', 'user_id');

    // --------------------------------------------- `cle_sites` devient partagée

    /*
     * Un bâtiment qu'on ne veut plus proposer.
     *
     * Le référentiel des lieux ne servait qu'aux clés, où un site se supprime
     * quand la commune s'en sépare. Il sert désormais aussi aux tickets, et un
     * ticket cite son bâtiment pour toujours : supprimer l'école fermée
     * effacerait le lieu des demandes qui la concernaient, donc l'historique
     * qu'on veut justement pouvoir relire.
     *
     * `is_active` sépare les deux gestes. Un site retiré n'est plus proposé au
     * formulaire, et reste lisible partout où il a été cité.
     */
    const colonnes = await colonnesDe(ctx, 'cle_sites');
    if (colonnes.size > 0 && !colonnes.has('is_active')) {
      await ctx.executer(
        `ALTER TABLE cle_sites ADD COLUMN is_active ${booleen} NOT NULL DEFAULT 1`
      );
    }
  },
};

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 *
 * Recopié de la migration 029 plutôt que partagé : une migration décrit l'état
 * du code au jour où elle a été écrite, et factoriser un helper entre
 * migrations ferait qu'une retouche d'aujourd'hui change ce qu'une migration
 * de l'an dernier applique.
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

export default tickets;
