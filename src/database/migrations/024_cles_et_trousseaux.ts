import type { Migration } from './types';

/**
 * Clés, badges et trousseaux : ce qu'ils ouvrent, ce qu'ils ont coûté, chez qui
 * ils sont passés.
 *
 * Une commune tient ses clés comme elle tient son parc, et pourtant rien ici ne
 * savait le dire. Combien d'exemplaires du passe de la mairie existent ? Qui
 * détient le trousseau des services techniques depuis que l'agent est parti ?
 * Combien a coûté la dernière refabrication ? Ces trois questions se posaient à
 * l'oral, et se répondaient de mémoire.
 *
 * Le choix structurant est de ne pas créer un silo parallèle. Une clé, un badge,
 * un trousseau sont du matériel : ce sont des `objects`, rangés dans des
 * catégories comme le reste. Ils héritent alors sans une ligne de code de la
 * recherche globale, des QR codes, des champs personnalisés, des droits par
 * catégorie et du cloisonnement par service. Cette migration n'ajoute donc que
 * ce que le parc ne sait pas déjà faire, et n'ajoute aucune colonne à
 * `objects` :
 *
 *   une clé      `material_type = 'lot'`, sa quantité dans `quantity_total`
 *   un trousseau `material_type = 'unique'`, son numéro d'inventaire dans
 *                `reference` — « TST001 » pour Trousseau Service Technique 001
 *   le modèle    un champ personnalisé de la catégorie, via
 *                `custom_fields_config`, et non une colonne de plus
 *
 * Sept tables, qui répondent chacune à une question :
 *
 *   `cle_sites` / `cle_ouvrants`  où ça ouvre. Deux niveaux, comme
 *                                 `categories` / `subcategories` : un site, et
 *                                 ses portes. Pas davantage — une commune a des
 *                                 bâtiments et des portes, pas une arborescence.
 *   `cle_ouvre`                   ce qu'une clé ouvre. Rattachée au site, c'est
 *                                 un passe général ; rattachée à un ouvrant,
 *                                 elle n'ouvre que cette porte-là.
 *   `cle_lots`                    ce que chaque refabrication a coûté.
 *   `trousseau_composants`        de quoi un trousseau est fait.
 *   `cle_attributions`            chez qui, et depuis quand.
 *   `cle_jetons`                  l'adresse publique de l'étiquette.
 *
 * Le prix est figé par lot. Refaire dix clés à 2,00 € puis dix autres à 2,50 €
 * ne doit pas réévaluer les premières : elles ont coûté ce qu'elles ont coûté.
 * C'est la règle déjà posée par la migration 015 pour les implantations
 * d'espaces verts, et elle vaut ici mot pour mot. `objects.quantity_total` et
 * `objects.unit_cost` restent tenus à jour par le service — somme des lots et
 * moyenne pondérée — pour que la disponibilité, les manifestations et
 * l'amortissement continuent de les lire sans rien savoir des lots. L'histoire
 * fait foi, `unit_cost` n'est qu'un raccourci d'affichage.
 *
 * La détention se lit sur une seule ligne. Une attribution ouverte est celle
 * dont `restitution_on` est nul ; l'historique est la même table sans ce filtre.
 * « Par qui cette clé est-elle passée » devient un `ORDER BY remise_on`, et non
 * un journal séparé qu'il faudrait tenir en plus — c'est la forme de
 * `manifestation_stock_movements`, dont la leçon était qu'un total doit toujours
 * pouvoir s'expliquer.
 *
 * Le jeton est court et opaque. Court parce qu'une étiquette Avery L6008 fait
 * dix millimètres de haut : au-delà d'une URL très brève, le QR code devient
 * trop dense pour être lu à cette taille. Opaque parce qu'un identifiant
 * incrémental laisserait énumérer l'inventaire en comptant — c'est exactement la
 * faille corrigée dans `qrcode.routes.ts`, et elle ne doit pas revenir par la
 * porte de l'étiquette.
 */
const clesEtTrousseaux: Migration = {
  id: '024_cles_et_trousseaux',
  description: 'Clés, badges et trousseaux : ouvrants, lots, composition, détention',

  async up(ctx) {
    // ----------------------------------------------------------------- lieux

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_sites (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        address VARCHAR(500),
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_ouvrants (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        site_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        description ${ctx.texteLong},
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_cle_ouvrants_site', 'cle_ouvrants', 'site_id');

    // -------------------------------------------------------- ce qu'on ouvre

    // Exactement un de `site_id` / `ouvrant_id` est renseigné. La règle est
    // tenue par le service plutôt que par une contrainte CHECK : MySQL 5.7 les
    // analyse et les ignore, si bien qu'une contrainte écrite ici protégerait
    // le développement sur SQLite et pas la production.
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_ouvre (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        object_id INTEGER NOT NULL,
        site_id INTEGER,
        ouvrant_id INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (ouvrant_id) REFERENCES cle_ouvrants(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_cle_ouvre_object', 'cle_ouvre', 'object_id');
    await ctx.creerIndex('idx_cle_ouvre_site', 'cle_ouvre', 'site_id');
    await ctx.creerIndex('idx_cle_ouvre_ouvrant', 'cle_ouvre', 'ouvrant_id');

    // -------------------------------------------------------------- les lots

    // `unit_price` est nullable : le premier lot d'une clé déjà en service est
    // un « stock initial » dont personne ne connaît le prix d'origine. Exiger un
    // chiffre obligerait à en inventer un, et un chiffre inventé vaut moins que
    // pas de chiffre du tout.
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_lots (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        object_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2),
        acquired_on DATE,
        supplier VARCHAR(255),
        reference VARCHAR(100),
        notes ${ctx.texteLong},
        created_by INTEGER,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_cle_lots_object', 'cle_lots', 'object_id');
    await ctx.creerIndex('idx_cle_lots_date', 'cle_lots', 'acquired_on');

    // ------------------------------------------------------- la composition

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS trousseau_composants (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        trousseau_id INTEGER NOT NULL,
        object_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        notes ${ctx.texteLong},
        added_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (trousseau_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        UNIQUE(trousseau_id, object_id)
      )`
    );
    await ctx.creerIndex('idx_trousseau_comp_trousseau', 'trousseau_composants', 'trousseau_id');
    await ctx.creerIndex('idx_trousseau_comp_object', 'trousseau_composants', 'object_id');

    // --------------------------------------------------------- la détention

    // `holder_label` couvre ce qui n'a pas de compte dans l'application : une
    // entreprise, un prestataire, un élu de passage. Sans lui, une clé remise à
    // l'extérieur devrait être notée « rendue » pour ne pas fausser le stock, et
    // sa trace serait perdue au moment précis où elle compte le plus.
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_attributions (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        object_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        holder_type VARCHAR(20) NOT NULL,
        holder_user_id INTEGER,
        holder_service_id INTEGER,
        holder_ouvrant_id INTEGER,
        holder_label VARCHAR(255),
        remise_on DATETIME,
        remise_by INTEGER,
        restitution_on DATETIME,
        restitution_by INTEGER,
        etat_retour VARCHAR(50),
        notes ${ctx.texteLong},
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (holder_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (holder_ouvrant_id) REFERENCES cle_ouvrants(id) ON DELETE SET NULL,
        FOREIGN KEY (remise_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (restitution_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_cle_attrib_object', 'cle_attributions', 'object_id');
    await ctx.creerIndex('idx_cle_attrib_user', 'cle_attributions', 'holder_user_id');
    // La détention courante est la ligne sans restitution : c'est la lecture la
    // plus fréquente de toute la table, elle mérite son index.
    await ctx.creerIndex('idx_cle_attrib_ouvertes', 'cle_attributions', 'restitution_on');

    // ------------------------------------------------------- le jeton public

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_jetons (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        object_id INTEGER NOT NULL UNIQUE,
        token VARCHAR(32) NOT NULL UNIQUE,
        created_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
      )`
    );
  },
};

export default clesEtTrousseaux;
