import type { Migration } from './types';

/**
 * Reprise d'un inventaire tenu dans Snipe-IT.
 *
 * Une commune qui adopte ce parc en a déjà un ailleurs. Ressaisir deux cents
 * clés et quarante trousseaux à la main coûte une semaine et produit des fautes
 * de frappe qu'on découvre un an plus tard, devant une porte.
 *
 * Snipe-IT distingue les mêmes natures que nous, sous d'autres noms :
 *
 *   un **Component** est une pièce tenue en quantité — c'est notre clé ;
 *   un **Asset** est un exemplaire identifié par son `asset_tag` — c'est notre
 *                trousseau, et son `asset_tag` est le numéro d'inventaire ;
 *   **sortir un composant vers un actif** est exactement notre
 *                `trousseau_composants`.
 *
 * La composition et le détenteur courant se transfèrent donc sans saisie. Ce
 * que Snipe-IT ne sait pas dire, en revanche, c'est **ce qu'une clé ouvre** :
 * la notion n'existe pas chez lui, et ses composants n'acceptent même pas de
 * champ personnalisé. L'information se trouve en pratique dans le libellé
 * — « Clé Mairie – Porte principale » — et sera donc proposée par lecture du
 * nom, puis validée avant écriture. Deviner est acceptable, écrire en aveugle
 * ne l'est pas : un rattachement faux fait chercher la mauvaise porte.
 *
 * Deux tables, pour deux raisons distinctes.
 *
 * `snipeit_config` porte l'adresse et le jeton. Un jeton d'API est un secret :
 * il va donc dans sa propre table, lue par les seules routes administrateur,
 * et non dans `settings` — que `GET /api/settings` rend à **tout compte
 * connecté**. C'est la règle déjà suivie par `smtp_config` pour le mot de passe
 * du serveur de courrier.
 *
 * `cle_import_snipeit` retient ce que chaque enregistrement distant est devenu
 * ici. Sans elle, relancer l'import créerait un second exemplaire de chaque
 * clé : rapprocher sur le nom ne tient pas — deux communes appellent « Passe
 * Mairie » deux clés différentes, et un libellé corrigé dans Snipe-IT
 * deviendrait un doublon. L'import est ainsi rejouable, ce qui compte parce
 * qu'une reprise se fait rarement du premier coup.
 */
const importSnipeIt: Migration = {
  id: '025_import_snipeit',
  description: 'Reprise depuis Snipe-IT : configuration et correspondances',

  async up(ctx) {
    // Une seule ligne en pratique, mais la table en accepte plusieurs : une
    // collectivité qui fusionne deux services peut avoir deux instances à
    // reprendre, et rien ici n'oblige à choisir.
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS snipeit_config (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        label VARCHAR(255),
        base_url VARCHAR(500) NOT NULL,
        token ${ctx.texteLong} NOT NULL,
        is_active ${ctx.booleen} DEFAULT 1,
        last_import_at DATETIME,
        created_at DATETIME ${ctx.horodatageParDefaut},
        updated_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );

    // `source_type` dit de quelle collection distante vient l'identifiant :
    // les composants et les actifs de Snipe-IT ont des identifiants qui se
    // recouvrent, et les confondre rattacherait une clé à un trousseau.
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS cle_import_snipeit (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        source_type VARCHAR(20) NOT NULL,
        source_id INTEGER NOT NULL,
        object_id INTEGER,
        site_id INTEGER,
        imported_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        UNIQUE(source_type, source_id)
      )`
    );
    await ctx.creerIndex('idx_import_snipeit_object', 'cle_import_snipeit', 'object_id');
  },
};

export default importSnipeIt;
