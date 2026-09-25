import type { ContexteMigration, Migration } from './types';

/**
 * Les contrôles obligatoires des bâtiments, et les documents qui les prouvent.
 *
 * Une commune doit faire vérifier chaque année l'électricité de ses écoles,
 * ses extincteurs, son alarme incendie ; tous les trois ans l'amiante ; tous
 * les cinq ans ses ascenseurs. Rien dans l'application ne le savait : le
 * rapport arrivait par courriel, se rangeait dans un dossier partagé, et
 * l'échéance suivante vivait dans la mémoire de la personne qui l'avait lu.
 *
 * Trois tables, et une idée : **l'échéance se déduit du dernier document
 * validé**, elle ne se saisit pas à part. Un rapport de vérification déposé et
 * validé dit quand le contrôle a eu lieu ; la périodicité dit quand revenir.
 * Saisir l'échéance séparément ferait deux vérités, et la seconde finirait par
 * mentir.
 *
 *   `batiment_rubriques`  ce qu'on range — l'« objet » de l'écran : vérification
 *                         électrique, rapport PPMS, facture d'énergie. Porte la
 *                         périodicité et le délai de rappel par défaut.
 *   `batiment_suivis`     une obligation qui s'applique à un bâtiment : « les
 *                         extincteurs de l'école Jules-Ferry ». Peut surcharger
 *                         la périodicité et le rappel.
 *   `batiment_documents`  le fichier, sa classification et son circuit de
 *                         validation.
 *
 * ## « Rubrique » en base, « objet » à l'écran
 *
 * Les agents disent « l'objet du document ». Mais `objects` et `object_id`
 * désignent déjà le matériel dans tout le schéma — jusque dans `alerts`, que ce
 * module alimente. Une colonne `objet_id` à côté d'`object_id` serait une erreur
 * de jointure en attente. La table s'appelle donc `batiment_rubriques`, et
 * l'interface garde le mot des agents.
 *
 * ## Plusieurs suivis pour une même rubrique
 *
 * Pas d'unicité sur (bâtiment, rubrique) : une mairie à deux ascenseurs a deux
 * contrôles quinquennaux, qui ne tombent pas la même année. `piece_id` et
 * `libelle` disent lequel est lequel (« Ascenseur du hall »).
 *
 * ## Les jours sont des chaînes
 *
 * `date_document`, `prochaine_echeance` et `echeance_initiale` sont des
 * `VARCHAR(10)` au format `AAAA-MM-JJ` : c'est la règle posée par la
 * migration 031 pour les jours métier. Le pool mysql2 n'a pas `dateStrings`,
 * et une colonne `DATE` y reviendrait en objet `Date` décalé d'un jour selon le
 * fuseau — ce qu'aucun test SQLite ne montrerait.
 *
 * ## On ne supprime pas un bâtiment qui a des documents
 *
 * `batiment_documents.site_id` est en `RESTRICT`. Un rapport de contrôle est
 * une pièce qu'on peut devoir produire des années plus tard ; la cascade
 * l'effacerait sans un mot, avec son fichier resté orphelin sur le disque. Les
 * écrans de suppression comptent déjà les usages d'un bâtiment et proposent de
 * le désactiver : les documents s'y ajoutent.
 */
const batimentsControles: Migration = {
  id: '041_batiments_controles',
  description: 'Contrôles obligatoires des bâtiments : rubriques, suivis et documents',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    /*
     * Le référentiel des bâtiments vient de la migration 024, ses pièces de la
     * 037. Sans eux, la base est à un état antérieur que le lanceur rattrapera
     * avant d'arriver ici — et MySQL refuserait une clé étrangère vers une
     * table absente, là où SQLite l'accepterait sans rien dire.
     */
    if ((await colonnesDe(ctx, 'cle_sites')).size === 0) return;
    if ((await colonnesDe(ctx, 'site_pieces')).size === 0) return;

    // ------------------------------------------------------------ les rubriques

    /*
     * `code` est la clé de l'amorçage : le catalogue livré ne réinsère que les
     * codes absents, si bien qu'une rubrique renommée ou désactivée par la
     * commune le reste. `is_system` interdit la suppression, pas la
     * modification — c'est la commune qui connaît ses périodicités.
     *
     * `rappel_jours` est `NOT NULL` : une rubrique sans délai de rappel ne
     * pourrait lever aucune alerte, et « pas de rappel » se dit en désactivant
     * le suivi.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_rubriques (
        id INTEGER PRIMARY KEY ${autoIncrement},
        code VARCHAR(60) NOT NULL UNIQUE,
        libelle VARCHAR(255) NOT NULL,
        nature VARCHAR(20) NOT NULL DEFAULT 'controle',
        periodicite_mois INTEGER,
        rappel_jours INTEGER NOT NULL DEFAULT 30,
        reference_reglementaire VARCHAR(255),
        description ${texteLong},
        is_active ${booleen} NOT NULL DEFAULT 1,
        is_system ${booleen} NOT NULL DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut}
      )`
    );

    // --------------------------------------------------------------- les suivis

    /*
     * `CASCADE` vers le bâtiment et la rubrique : un suivi ne dit rien d'autre
     * que le lien entre les deux. Les documents, eux, survivent à leur suivi
     * (`SET NULL` plus bas) — et la suppression d'une rubrique employée est
     * refusée par le service, qui propose de la désactiver.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_suivis (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        rubrique_id INTEGER NOT NULL,
        piece_id INTEGER,
        libelle VARCHAR(255),
        periodicite_mois INTEGER,
        rappel_jours INTEGER,
        echeance_initiale VARCHAR(10),
        actif ${booleen} NOT NULL DEFAULT 1,
        notes ${texteLong},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (rubrique_id) REFERENCES batiment_rubriques(id) ON DELETE CASCADE,
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_suivis_site', 'batiment_suivis', 'site_id');
    await ctx.creerIndex('idx_batiment_suivis_rubrique', 'batiment_suivis', 'rubrique_id');

    // ------------------------------------------------------------ les documents

    /*
     * `chemin` est **relatif** au dossier privé des bâtiments, jamais une URL
     * `/uploads/…` : ces fichiers — un PPMS décrit comment une école se
     * barricade — ne passent pas par le dossier servi en statique, et le
     * service refuse tout chemin qui en sortirait.
     *
     * `statut` porte le circuit : `a_valider` pour ce qui arrive d'une
     * entreprise ou d'un responsable, `valide` une fois reclassé par un
     * gestionnaire, `refuse` avec son motif. Seul un document validé fait
     * foi pour l'échéance.
     *
     * `source` distingue le dépôt interne de celui d'une entreprise ; la
     * colonne `entreprise_id` arrivera avec le portail des entreprises.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_documents (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        piece_id INTEGER,
        rubrique_id INTEGER,
        suivi_id INTEGER,
        titre VARCHAR(255) NOT NULL,
        description ${texteLong},
        commentaire_depot ${texteLong},
        chemin VARCHAR(500) NOT NULL,
        nom_origine VARCHAR(255) NOT NULL,
        mime VARCHAR(150),
        taille INTEGER,
        date_document VARCHAR(10),
        prochaine_echeance VARCHAR(10),
        resultat VARCHAR(20),
        statut VARCHAR(20) NOT NULL DEFAULT 'a_valider',
        motif_refus ${texteLong},
        source VARCHAR(20) NOT NULL DEFAULT 'interne',
        depose_par INTEGER,
        valide_par INTEGER,
        valide_le DATETIME,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE RESTRICT,
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE SET NULL,
        FOREIGN KEY (rubrique_id) REFERENCES batiment_rubriques(id) ON DELETE SET NULL,
        FOREIGN KEY (suivi_id) REFERENCES batiment_suivis(id) ON DELETE SET NULL,
        FOREIGN KEY (depose_par) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (valide_par) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_documents_site_statut', 'batiment_documents', 'site_id, statut');
    await ctx.creerIndex('idx_batiment_documents_suivi', 'batiment_documents', 'suivi_id');
    await ctx.creerIndex('idx_batiment_documents_rubrique', 'batiment_documents', 'rubrique_id');
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

export default batimentsControles;
