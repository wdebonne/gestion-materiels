import type { Migration } from './types';

/**
 * Services concernés, approbations, conversation et observateurs.
 *
 * Une manifestation municipale engage plusieurs services : le service festif
 * prête les tables, l'informatique le vidéoprojecteur, la restauration les
 * boissons. Aucun modèle ne permettait de dire « ce service est concerné » :
 * `group_permissions.role` désigne un rôle, pas un groupe de personnes, et il
 * n'existait ni entité de service, ni destinataire collectif, ni approbation.
 *
 * Conséquence pratique : tout le monde recevait tout, ou personne ne recevait
 * rien. Le service informatique était alerté d'une brocante sans matériel
 * informatique, et le service restauration d'une réunion sans repas — c'est
 * exactement ce qui fait qu'on cesse de lire les alertes.
 *
 * Un service est ici un groupe de personnes **et** un périmètre de catégories de
 * matériel. C'est ce périmètre qui décide qui est concerné : sans matériel de
 * ses catégories dans la demande, un service n'est ni sollicité ni destinataire.
 */
const migration: Migration = {
  id: '004_services_approbations',
  description: 'Services, approbations par service concerné, conversation et observateurs',

  async up(ctx) {
    const { autoIncrement, texteLong, booleen, horodatageParDefaut } = ctx;

    await ctx.executer(`CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY ${autoIncrement},
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      email VARCHAR(255),
      description ${texteLong},
      is_observer ${booleen} DEFAULT 0,
      is_active ${booleen} DEFAULT 1,
      notify_new_request ${booleen} DEFAULT 1,
      notify_status_change ${booleen} DEFAULT 1,
      notify_material_change ${booleen} DEFAULT 1,
      notify_message ${booleen} DEFAULT 1,
      created_at DATETIME ${horodatageParDefaut},
      updated_at DATETIME ${horodatageParDefaut}
    )`);

    // Le périmètre du service : c'est lui qui décide qui est concerné.
    await ctx.executer(`CREATE TABLE IF NOT EXISTS service_categories (
      id INTEGER PRIMARY KEY ${autoIncrement},
      service_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      UNIQUE(service_id, category_id),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`);

    await ctx.executer(`CREATE TABLE IF NOT EXISTS service_members (
      id INTEGER PRIMARY KEY ${autoIncrement},
      service_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_manager ${booleen} DEFAULT 0,
      created_at DATETIME ${horodatageParDefaut},
      UNIQUE(service_id, user_id),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // `kind` distingue une approbation, qui bloque la validation, d'une simple
    // demande d'information, qui ne bloque rien. `user_id` porte les sollicitations
    // adressées à une personne plutôt qu'à un service.
    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_approvals (
      id INTEGER PRIMARY KEY ${autoIncrement},
      manifestation_id INTEGER NOT NULL,
      service_id INTEGER,
      user_id INTEGER,
      kind VARCHAR(20) NOT NULL DEFAULT 'approbation',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      requested_by INTEGER,
      requested_at DATETIME ${horodatageParDefaut},
      decided_by INTEGER,
      decided_at DATETIME,
      comment ${texteLong},
      delivery_date DATE,
      recovery_date DATE,
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
    )`);

    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_messages (
      id INTEGER PRIMARY KEY ${autoIncrement},
      manifestation_id INTEGER NOT NULL,
      user_id INTEGER,
      service_id INTEGER,
      body ${texteLong} NOT NULL,
      created_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
    )`);

    // Le DGS, le maire, un élu : ils suivent sans rien approuver.
    await ctx.executer(`CREATE TABLE IF NOT EXISTS manifestation_watchers (
      id INTEGER PRIMARY KEY ${autoIncrement},
      manifestation_id INTEGER NOT NULL,
      user_id INTEGER,
      service_id INTEGER,
      added_by INTEGER,
      created_at DATETIME ${horodatageParDefaut},
      FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
    )`);

    // Les index correspondants sont déclarés dans `createIndexes()`, qui tolère
    // une table absente et se rejoue à chaque démarrage.
  },
};

export default migration;
