import type { ContexteMigration, Migration } from './types';

/**
 * Ce que coûte un bâtiment : son énergie, ses contrats, ses interventions.
 *
 * Les factures d'électricité, de gaz et d'eau arrivaient chez le comptable et
 * n'en ressortaient pas ; le contrat de l'ascenseur se reconduisait sans que
 * personne ne se souvienne de la date de préavis ; le dépannage de la
 * chaudière n'était écrit nulle part. Trois tables pour les garder, et une
 * quatrième pour les compteurs qui disent ce qu'on consomme.
 *
 * ## Les factures ne se perdent pas avec leur bâtiment
 *
 * `batiment_factures.site_id` et `batiment_interventions.site_id` sont en
 * `RESTRICT`, comme les documents : ce sont des dépenses, qu'on peut devoir
 * justifier des années plus tard. Supprimer le bâtiment est refusé tant qu'il
 * en porte ; on le désactive.
 *
 * ## Une facture couvre une période
 *
 * `periode_debut` et `periode_fin` disent ce que la facture couvre — deux mois
 * de gaz à cheval sur l'hiver. Les statistiques répartissent le montant au jour
 * sur cette période : sans elle, une facture de janvier-février tomberait tout
 * entière en février, et la comparaison de janvier d'une année à l'autre ne
 * voudrait rien dire. Les montants négatifs sont acceptés : un avoir, une
 * régularisation. `estimee` marque une facture sur relevé estimé, qu'une
 * suivante corrigera.
 *
 * ## Un contrat, plusieurs bâtiments
 *
 * La maintenance des ascenseurs de la commune est un seul marché pour trois
 * bâtiments : `batiment_contrat_sites` les relie. `preavis_jours` et
 * `reconduction_tacite` donnent la date limite de résiliation, que le cron
 * rappelle — c'est la date qu'on oublie, et qui engage pour un an de plus.
 *
 * ## `surface_m2` sur le bâtiment
 *
 * Pour comparer des bâtiments de tailles différentes : des kWh par m², des
 * euros par m². Saisie une fois, sur la fiche.
 *
 * Les montants sont en `DECIMAL`, que le pool mysql2 rend en nombres
 * (`decimalNumbers`) ; les jours en `VARCHAR(10)`, règle de la migration 031.
 */
const energieContratsInterventions: Migration = {
  id: '044_energie_contrats_interventions',
  description: 'Compteurs, relevés et factures d’énergie ; contrats de maintenance ; interventions dans les bâtiments',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    if ((await colonnesDe(ctx, 'cle_sites')).size === 0) return;
    if ((await colonnesDe(ctx, 'entreprises')).size === 0) return;
    if ((await colonnesDe(ctx, 'batiment_documents')).size === 0) return;

    await ajouterColonne(ctx, 'cle_sites', 'surface_m2', 'DECIMAL(12,2)');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_compteurs (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        energie VARCHAR(20) NOT NULL,
        libelle VARCHAR(255),
        numero VARCHAR(100),
        unite VARCHAR(20) NOT NULL,
        fournisseur_id INTEGER,
        actif ${booleen} NOT NULL DEFAULT 1,
        notes ${texteLong},
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (fournisseur_id) REFERENCES entreprises(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_compteurs_site', 'batiment_compteurs', 'site_id');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_releves (
        id INTEGER PRIMARY KEY ${autoIncrement},
        compteur_id INTEGER NOT NULL,
        date_releve VARCHAR(10) NOT NULL,
        index_valeur DECIMAL(16,3) NOT NULL,
        notes VARCHAR(500),
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (compteur_id) REFERENCES batiment_compteurs(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_releves_compteur', 'batiment_releves', 'compteur_id, date_releve');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_factures (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        compteur_id INTEGER,
        energie VARCHAR(20) NOT NULL,
        fournisseur_id INTEGER,
        numero VARCHAR(100),
        date_facture VARCHAR(10) NOT NULL,
        periode_debut VARCHAR(10),
        periode_fin VARCHAR(10),
        consommation DECIMAL(16,3),
        unite VARCHAR(20),
        montant_ht DECIMAL(12,2),
        montant_ttc DECIMAL(12,2) NOT NULL,
        estimee ${booleen} NOT NULL DEFAULT 0,
        document_id INTEGER,
        notes ${texteLong},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE RESTRICT,
        FOREIGN KEY (compteur_id) REFERENCES batiment_compteurs(id) ON DELETE SET NULL,
        FOREIGN KEY (fournisseur_id) REFERENCES entreprises(id) ON DELETE SET NULL,
        FOREIGN KEY (document_id) REFERENCES batiment_documents(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_factures_site', 'batiment_factures', 'site_id, date_facture');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_contrats (
        id INTEGER PRIMARY KEY ${autoIncrement},
        objet VARCHAR(255) NOT NULL,
        entreprise_id INTEGER,
        reference VARCHAR(100),
        date_debut VARCHAR(10) NOT NULL,
        date_fin VARCHAR(10),
        reconduction_tacite ${booleen} NOT NULL DEFAULT 0,
        preavis_jours INTEGER NOT NULL DEFAULT 90,
        montant_annuel_ht DECIMAL(12,2),
        montant_annuel_ttc DECIMAL(12,2),
        document_id INTEGER,
        notes ${texteLong},
        actif ${booleen} NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE SET NULL,
        FOREIGN KEY (document_id) REFERENCES batiment_documents(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_contrat_sites (
        id INTEGER PRIMARY KEY ${autoIncrement},
        contrat_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        UNIQUE (contrat_id, site_id),
        FOREIGN KEY (contrat_id) REFERENCES batiment_contrats(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS batiment_interventions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        piece_id INTEGER,
        date_intervention VARCHAR(10) NOT NULL,
        nature VARCHAR(20) NOT NULL,
        titre VARCHAR(255) NOT NULL,
        description ${texteLong},
        entreprise_id INTEGER,
        contrat_id INTEGER,
        ticket_id INTEGER,
        document_id INTEGER,
        montant_ht DECIMAL(12,2),
        montant_ttc DECIMAL(12,2),
        duree_minutes INTEGER,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE RESTRICT,
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE SET NULL,
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE SET NULL,
        FOREIGN KEY (contrat_id) REFERENCES batiment_contrats(id) ON DELETE SET NULL,
        FOREIGN KEY (document_id) REFERENCES batiment_documents(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_batiment_interventions_site', 'batiment_interventions', 'site_id, date_intervention');

    /*
     * Le ticket d'où vient une intervention, s'il y en a un. Posé à part, et
     * seulement si le module Tickets est là : sa table n'existe pas sur toutes
     * les installations.
     */
    if ((await colonnesDe(ctx, 'tickets')).size > 0 && ctx.dialecte === 'mysql') {
      if (!(await contrainteExiste(ctx, 'batiment_interventions', 'fk_batiment_interventions_ticket'))) {
        try {
          await ctx.executer(
            `ALTER TABLE batiment_interventions
               ADD CONSTRAINT fk_batiment_interventions_ticket FOREIGN KEY (ticket_id)
               REFERENCES tickets(id) ON DELETE SET NULL`
          );
        } catch (erreur: any) {
          console.warn(`Clé étrangère du ticket d'intervention non posée : ${erreur?.message ?? erreur}`);
        }
      }
    }
  },
};

/** Ajoute une colonne si elle manque. Recopié de la migration 037. */
async function ajouterColonne(ctx: ContexteMigration, table: string, colonne: string, type: string): Promise<void> {
  const colonnes = await colonnesDe(ctx, table);
  if (colonnes.size === 0 || colonnes.has(colonne)) return;
  await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
}

async function contrainteExiste(ctx: ContexteMigration, table: string, nom: string): Promise<boolean> {
  if (ctx.dialecte === 'sqlite') return true;
  const lignes = await ctx.interroger(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, nom]
  );
  return lignes.length > 0;
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

export default energieContratsInterventions;
