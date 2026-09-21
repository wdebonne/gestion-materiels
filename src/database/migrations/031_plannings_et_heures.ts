import type { Migration } from './types';

/**
 * Le temps passé : qui a fait quoi, quand, et pendant combien de temps.
 *
 * L'application sait ce que la commune possède, ce qu'elle prête et ce qu'elle
 * entretient. Elle ne sait rien de ce que ça coûte en heures. Un responsable
 * qui prépare une réunion n'a aucun chiffre : la répartition du travail entre
 * les livraisons de manifestations, la tonte et la voirie se raconte de
 * mémoire, et se discute donc sans preuve.
 *
 * Quatre tables, et deux décisions qui méritent d'être écrites.
 *
 * ## Le jour est une chaîne, pas une colonne `DATE`
 *
 * Le pool mysql2 est créé sans `dateStrings` ni `typeCast`
 * (`src/database/index.ts`). MySQL rend donc une colonne `DATE` sous forme
 * d'objet `Date` à minuit **locale**, que `res.json()` sérialise ensuite avec
 * `toISOString()` : en UTC+1, le 18 mars quitte l'API en
 * `"2026-03-17T23:00:00.000Z"`. SQLite, lui, rend la chaîne `'2026-03-18'`.
 * Même code, deux jours différents, et la différence n'apparaît qu'en
 * production — c'est-à-dire sur les seuls chiffres qui comptent.
 *
 * En ISO `YYYY-MM-DD`, la comparaison `>=` / `<=` et le tri lexicographique
 * sont exacts sur les deux moteurs, et la valeur traverse le JSON sans se faire
 * réinterpréter. Les horaires suivent la même logique : `'14:00'`, et une durée
 * en minutes calculée par le serveur. Additionner des entiers dispense de toute
 * arithmétique de dates en SQL, qui est dialectale, et met le module à l'abri
 * du changement d'heure.
 *
 * ## Une tâche porte plusieurs contributions
 *
 * Deux agents une heure sur la même tâche, c'est deux heures de travail
 * mobilisé mais une heure pour chacun ; un renfort de trente minutes sur une
 * tâche de deux heures porte le total à deux heures trente. Les deux lectures
 * sont légitimes et ne doivent jamais être additionnées. D'où une table de
 * contributions séparée : `planning_taches` porte le temps du titulaire,
 * `planning_participants` celui de chaque renfort, et un rapport somme l'une,
 * l'autre, ou les deux, selon ce qu'on lui demande.
 *
 * Un renfort est de préférence quelqu'un de l'annuaire — `users` contient
 * depuis la migration 028 les personnes sans compte, justement pour ça. Le
 * libellé libre reste possible pour un renfort qu'on ne nomme pas, mais c'est
 * un second choix : c'est lui qui fabrique « A. Marie », « Marie André » et
 * « André MARIE ».
 *
 *   `planning_categories`    la nomenclature, qu'un agent enrichit lui-même
 *   `planning_taches`        une tâche datée, et le temps de son titulaire
 *   `planning_participants`  le temps de chaque renfort, nommé ou non
 *   `planning_superviseurs`  qui encadre qui, et à quel titre
 */

const planningsEtHeures: Migration = {
  id: '031_plannings_et_heures',
  description: 'Plannings et heures : tâches datées, contributions multiples, encadrement',

  async up(ctx) {
    // ------------------------------------------------------ la nomenclature

    /*
     * `name_normalise` existe parce que `UNIQUE(name)` ne veut pas dire la même
     * chose selon le moteur : MySQL, en `utf8mb4_unicode_ci`, ignore la casse
     * et les accents ; SQLite, en `BINARY`, ne les ignore pas. Avec un champ
     * qui crée la catégorie manquante à la volée — ce que le formulaire fait,
     * et doit faire — SQLite accumulerait « Tonte », « tonte » et « Tonte  »
     * en trois lignes, et fragmenterait les statistiques entre elles.
     *
     * La colonne porte donc le nom réduit à sa forme comparable, et c'est elle
     * qui est unique. Le service la calcule avant chaque écriture.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS planning_categories (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        name VARCHAR(160) NOT NULL,
        name_normalise VARCHAR(160) NOT NULL UNIQUE,
        couleur VARCHAR(20),
        is_active ${ctx.booleen} NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_planning_cat_actives', 'planning_categories', 'is_active');

    // ------------------------------------------------------------ les tâches

    /*
     * `user_id` n'est pas en `ON DELETE CASCADE`, à dessein. Supprimer un
     * compte effacerait alors ses heures sans laisser de trace, y compris
     * celles déjà présentées en réunion. La suppression est de toute façon
     * conditionnée par `tracesDe()` (`comptes.service.ts`), à qui ces tables
     * sont enseignées en même temps que cette migration : une personne qui a
     * saisi des heures est désactivée, pas effacée.
     *
     * `categorie_id` en `SET NULL` : perdre la catégorie d'une tâche est
     * regrettable, perdre la tâche le serait davantage. Un rapport range ces
     * lignes sous « Sans catégorie » plutôt que de les escamoter. La route
     * refuse de toute façon de supprimer une catégorie encore employée.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS planning_taches (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER NOT NULL,
        categorie_id INTEGER,
        manifestation_id INTEGER,
        date_jour VARCHAR(10) NOT NULL,
        heure_debut VARCHAR(5),
        heure_fin VARCHAR(5),
        minutes INTEGER NOT NULL,
        description ${ctx.texteLong},
        created_by INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (categorie_id) REFERENCES planning_categories(id) ON DELETE SET NULL,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    // « Les heures d'un agent sur une période » est la lecture de tous les
    // écrans du module : la semaine d'un agent, son mois, le rapport de son
    // superviseur. L'index composite la sert entière.
    await ctx.creerIndex('idx_planning_taches_user_jour', 'planning_taches', 'user_id, date_jour');
    await ctx.creerIndex('idx_planning_taches_jour', 'planning_taches', 'date_jour');
    await ctx.creerIndex('idx_planning_taches_categorie', 'planning_taches', 'categorie_id');
    await ctx.creerIndex('idx_planning_taches_manif', 'planning_taches', 'manifestation_id');

    // ------------------------------------------------------ les renforts

    /*
     * `user_id` ou `libelle`, jamais les deux et jamais aucun — une règle que
     * le service applique, et non un `CHECK` : MySQL 5.7 analyse les
     * contraintes `CHECK` et les ignore, si bien qu'elles protégeraient le
     * développement et pas la production. La migration 024 a tranché pareil
     * pour `cle_attributions`.
     *
     * `UNIQUE(tache_id, user_id)` empêche de compter deux fois la même
     * personne sur une tâche. Les deux moteurs tolèrent les `NULL` répétés
     * dans un index unique : les renforts non nommés restent donc libres de se
     * répéter, ce qui est voulu — « 2 agents des espaces verts » peut
     * légitimement se saisir deux fois.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS planning_participants (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        tache_id INTEGER NOT NULL,
        user_id INTEGER,
        libelle VARCHAR(255),
        minutes INTEGER NOT NULL,
        created_at DATETIME ${ctx.horodatageParDefaut},
        UNIQUE(tache_id, user_id),
        FOREIGN KEY (tache_id) REFERENCES planning_taches(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_planning_part_tache', 'planning_participants', 'tache_id');
    await ctx.creerIndex('idx_planning_part_user', 'planning_participants', 'user_id');

    // -------------------------------------------------------- l'encadrement

    /*
     * Un agent peut avoir plusieurs superviseurs, chacun à son titre :
     * « Responsable du service », « Référent de l'équipe ». L'intitulé est
     * porté par le lien et non par la personne, parce que c'est bien la
     * relation qu'il qualifie — la même personne est responsable de service
     * pour les uns et référente d'équipe pour les autres.
     *
     * Aucune contrainte de rôle sur `superviseur_id` : les rôles changent, et
     * une contrainte SQL ne suivrait pas. Le périmètre se lit donc de la même
     * façon pour tout le monde — soi, plus les agents rattachés — ce qui rend
     * inoffensifs les cas tordus : un superviseur qui est lui-même rattaché à
     * quelqu'un, ou deux personnes rattachées l'une à l'autre. La règle est
     * volontairement **non transitive**, sur un seul cran : au-delà, il
     * faudrait un parcours de graphe applicatif, puisque MySQL 5.7 n'a pas de
     * requête récursive.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS planning_superviseurs (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        agent_id INTEGER NOT NULL,
        superviseur_id INTEGER NOT NULL,
        intitule VARCHAR(160),
        created_at DATETIME ${ctx.horodatageParDefaut},
        UNIQUE(agent_id, superviseur_id),
        FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (superviseur_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_planning_sup_agent', 'planning_superviseurs', 'agent_id');
    await ctx.creerIndex('idx_planning_sup_superviseur', 'planning_superviseurs', 'superviseur_id');
  },
};

export default planningsEtHeures;
