import type { Migration } from './types';

/**
 * L'accueil de chacun : ses blocs, ses actions rapides, ses favoris.
 *
 * Les favoris vivaient dans le navigateur (`materiels-memorises`) : perdus d'un
 * appareil à l'autre, et réservés aux matériels. Ils rejoignent le compte, avec
 * les bâtiments, tickets, manifestations et clés — et les raccourcis vers une
 * page, rangés comme des favoris de type `lien` pour n'avoir qu'une liste et un
 * ordre.
 *
 * `user_accueil` n'a de ligne que pour qui a personnalisé : l'absence veut dire
 * « la disposition d'origine », qui évolue alors avec l'application.
 *
 * Aucune garde `colonnesDe` en tête : une migration qui sort avant d'émettre du
 * SQL échappe au banc MySQL. `IF NOT EXISTS` suffit à la rendre rejouable.
 */
const accueilPersonnel: Migration = {
  id: '048_accueil_personnel',
  description: 'Tableau de bord personnel : blocs, actions rapides, favoris et raccourcis sur le compte',

  async up(ctx) {
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_accueil (
        user_id INTEGER PRIMARY KEY,
        blocs ${ctx.texteLong},
        actions ${ctx.texteLong},
        favoris_importes ${ctx.booleen} NOT NULL DEFAULT 0,
        updated_at DATETIME ${ctx.horodatageParDefaut},
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_favoris (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER NOT NULL,
        type VARCHAR(20) NOT NULL,
        cible_id INTEGER,
        libelle VARCHAR(120),
        url VARCHAR(500),
        position INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME ${ctx.horodatageParDefaut},
        UNIQUE (user_id, type, cible_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_user_favoris_user', 'user_favoris', 'user_id, position');
  },
};

export default accueilPersonnel;
