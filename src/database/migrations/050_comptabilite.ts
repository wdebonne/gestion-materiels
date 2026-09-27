import type { ContexteMigration, Migration } from './types';

/**
 * Passerelle comptable avec Ciril Finance.
 *
 * « Quand je crée une facture dans Ciril, cela me crée un matériel immobilisé
 * que je peux exporter. Je voudrais l'importer, le ranger dans mes catégories en
 * gardant le lien avec le numéro comptable, et quand je sors l'objet — perdu,
 * cassé — l'exporter pour l'importer dans ma compta, sans rien faire à la main
 * des deux côtés. »
 *
 * `immobilisations` est ce que Ciril connaît, tel qu'il l'a envoyé : une ligne
 * par numéro, que l'import rapproche sur ce numéro — il est donc rejouable. La
 * ligne brute est gardée en JSON : le format de Ciril n'est pas encore connu, et
 * ce qu'on n'a pas su lire aujourd'hui ne doit pas être perdu.
 *
 * `objects.immobilisation_id` est le lien. Un index ordinaire, pas unique : la
 * règle est un numéro par objet — deux armoires, deux codes, et l'une peut sortir
 * sans l'autre —, mais une facture qui n'aurait produit qu'un seul code pour
 * plusieurs objets reste représentable. Pas de clé étrangère : MySQL ne l'accepte
 * pas dans un `ADD COLUMN`, et la suppression d'une immobilisation délie ses
 * objets dans le service.
 *
 * `sorties_inventaire` porte la sortie « douce » : l'objet reste en base, et sa
 * sortie a trois étapes datées — déclarée, envoyée à la compta (`export_id`),
 * intégrée dans Ciril (sur l'envoi). Une table à part plutôt que six colonnes
 * de plus sur `objects`.
 *
 * `exports_comptables` est le lot envoyé : un fichier par envoi, jamais un par
 * sortie — dix objets retirés dans la journée font un seul mail.
 *
 * `comptabilite_droits` : voir le module ne suffit pas à tout y faire. Ranger
 * dans les catégories revient à l'inventaire, pas à la comptabilité ; chaque
 * geste est donc une case, personne par personne.
 *
 * Les jours sont des `VARCHAR(10)` ISO : une colonne `DATE` sort décalée d'un
 * jour de MySQL, dont le pool n'a pas `dateStrings`.
 */
const comptabilite: Migration = {
  id: '050_comptabilite',
  description: 'Passerelle comptable : immobilisations, sorties d’inventaire, envois et droits',

  async up(ctx) {
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS imports_comptables (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER,
        nom_fichier VARCHAR(255),
        nb_lignes INTEGER DEFAULT 0,
        nb_creees INTEGER DEFAULT 0,
        nb_mises_a_jour INTEGER DEFAULT 0,
        nb_erreurs INTEGER DEFAULT 0,
        created_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS immobilisations (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        numero VARCHAR(50) NOT NULL UNIQUE,
        libelle VARCHAR(500),
        date_acquisition VARCHAR(10),
        valeur_acquisition DECIMAL(12,2),
        compte VARCHAR(30),
        fournisseur VARCHAR(255),
        numero_facture VARCHAR(100),
        affectation VARCHAR(255),
        donnees_source ${ctx.texteLong},
        etat VARCHAR(20) NOT NULL DEFAULT 'a_ranger',
        import_id INTEGER,
        rangee_le VARCHAR(30),
        rangee_par INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );
    await ctx.creerIndex('idx_immobilisations_etat', 'immobilisations', 'etat');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS exports_comptables (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER,
        origine VARCHAR(20) NOT NULL DEFAULT 'manuel',
        nb_lignes INTEGER DEFAULT 0,
        format VARCHAR(10),
        nom_fichier VARCHAR(255),
        chemin_local VARCHAR(500),
        statut_nextcloud VARCHAR(20),
        statut_mail VARCHAR(20),
        erreur ${ctx.texteLong},
        envoye_le VARCHAR(30),
        integre_le VARCHAR(30),
        integre_par INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS sorties_inventaire (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        object_id INTEGER NOT NULL UNIQUE,
        date_sortie VARCHAR(10) NOT NULL,
        motif VARCHAR(30) NOT NULL,
        commentaire ${ctx.texteLong},
        valeur_cession DECIMAL(12,2),
        quantite_sortie INTEGER DEFAULT 1,
        statut_precedent VARCHAR(50),
        user_id INTEGER,
        export_id INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (export_id) REFERENCES exports_comptables(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_sorties_inventaire_export', 'sorties_inventaire', 'export_id');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS comptabilite_droits (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER NOT NULL UNIQUE,
        peut_importer ${ctx.booleen} NOT NULL DEFAULT 0,
        peut_ranger ${ctx.booleen} NOT NULL DEFAULT 0,
        peut_sortir ${ctx.booleen} NOT NULL DEFAULT 0,
        peut_envoyer ${ctx.booleen} NOT NULL DEFAULT 0,
        peut_integrer ${ctx.booleen} NOT NULL DEFAULT 0,
        peut_regler ${ctx.booleen} NOT NULL DEFAULT 0,
        recoit_mail ${ctx.booleen} NOT NULL DEFAULT 0,
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    );

    const colonnes = await colonnesDe(ctx, 'objects');
    if (!colonnes.has('immobilisation_id')) {
      await ctx.executer('ALTER TABLE objects ADD COLUMN immobilisation_id INTEGER');
    }
    await ctx.creerIndex('idx_objects_immobilisation', 'objects', 'immobilisation_id');
  },
};

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

export default comptabilite;
