import type { Migration } from './types';

/**
 * Profils d'export des manifestations.
 *
 * Le suivi des manifestations se partage aujourd'hui par fichier : une feuille
 * de calcul déposée sur un Nextcloud, que plusieurs services consultent et
 * annotent. Elle était tenue à la main, donc périmée dès qu'un statut changeait.
 *
 * Un profil dit **quelles colonnes**, **dans quel ordre**, **sous quel intitulé**
 * et **vers où**. C'est une donnée, pas du code : chaque collectivité range son
 * tableau à sa façon, et le redemander à un développeur à chaque changement de
 * colonne serait absurde.
 *
 * `last_status` et `last_error` portent le résultat du dernier envoi. Sans eux,
 * un dépôt qui échoue est invisible — et c'est le fichier périmé que tout le
 * monde continue de lire.
 */
const migration: Migration = {
  id: '005_export_manifestations',
  description: 'Profils de colonnes et destination des exports de manifestations',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_export_profiles (
      id INTEGER PRIMARY KEY ${autoIncrement},
      name VARCHAR(255) NOT NULL,
      columns ${texteLong},
      filters ${texteLong},
      destination VARCHAR(20) NOT NULL DEFAULT 'download',
      remote_path VARCHAR(500),
      is_active ${booleen} DEFAULT 1,
      auto_export ${booleen} DEFAULT 0,
      last_export_at DATETIME,
      last_status VARCHAR(20),
      last_error ${texteLong},
      created_at DATETIME ${horodatageParDefaut},
      updated_at DATETIME ${horodatageParDefaut}
    )`);
  },
};

export default migration;
