import type { Migration } from './types';

/**
 * Un agenda externe, ce n'est pas « l'agenda » : c'en est un parmi plusieurs.
 *
 * La synchronisation existante tenait en deux lignes de réglages — une pour
 * Outlook, une pour CalDAV — et supposait que tout l'agenda de l'application
 * intéressait le même carnet. Une commune ne fonctionne pas ainsi. Brancher le
 * CalDAV du service technique, c'est y déverser du même coup les entretiens de
 * véhicules, les contrôles techniques, les échéances du matériel de
 * manifestation et les tontes des espaces verts. Le carnet devient illisible,
 * et la première réaction est de couper la synchronisation.
 *
 * D'où trois changements, et pas un de plus.
 *
 * **Plusieurs destinations.** Le service technique a son carnet, les espaces
 * verts le leur, le régisseur des salles le sien. Chacune porte ses propres
 * identifiants : ce ne sont pas les mêmes comptes.
 *
 * **Un aiguillage sur deux axes**, ceux selon lesquels une commune découpe
 * réellement son travail : la **nature** de l'événement (entretien, contrôle,
 * espace vert, voirie, manifestation, rendez-vous saisi à la main) et la
 * **catégorie** du matériel concerné. Les deux listes sont stockées en JSON
 * plutôt qu'en table de règles : ce sont deux ensembles lus d'un bloc au moment
 * de la synchronisation, jamais interrogés de biais, et une table de liaison
 * n'apporterait que des jointures.
 *
 * Une liste vide veut dire « tout » — c'est le réglage de départ, celui qui ne
 * change rien pour qui n'a qu'un carnet.
 *
 * **Un sens.** Jusqu'ici la synchronisation ne faisait qu'**importer** : elle
 * ramenait les événements du serveur distant dans l'application. Ce que
 * demande le terrain est l'inverse — que les échéances saisies ici
 * **partent** dans le carnet du service concerné. `direction` porte les deux, et
 * l'aiguillage ne concerne que l'export : à l'import on prend ce qu'il y a.
 *
 * `calendar_exports` retient ce qui a été poussé, et où. Sans cette mémoire, on
 * ne saurait ni mettre à jour un rendez-vous déplacé, ni retirer du carnet
 * distant un événement qui a cessé de correspondre aux règles — il y resterait
 * pour toujours, et personne ne comprendrait pourquoi.
 *
 * Enfin `calendar_events.external_calendar_id` : l'import effaçait ses
 * événements par `DELETE ... WHERE source = 'caldav'`, ce qui, avec deux
 * carnets CalDAV, faisait disparaître ceux de l'autre à chaque passage.
 */
const migration: Migration = {
  id: '020_agendas_externes',
  description:
    'Agendas externes multiples, avec aiguillage par nature et par catégorie, et export vers CalDAV',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    await ctx.executer(`
      CREATE TABLE IF NOT EXISTS calendar_destinations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        name VARCHAR(255) NOT NULL,
        kind VARCHAR(20) NOT NULL DEFAULT 'caldav',
        server_url VARCHAR(500) DEFAULT '',
        username VARCHAR(255) DEFAULT '',
        password VARCHAR(500) DEFAULT '',
        calendar_path VARCHAR(500) DEFAULT '',
        client_id VARCHAR(255) DEFAULT '',
        client_secret VARCHAR(500) DEFAULT '',
        tenant_id VARCHAR(255) DEFAULT '',
        direction VARCHAR(20) NOT NULL DEFAULT 'export',
        natures ${texteLong},
        category_ids ${texteLong},
        include_uncategorized ${booleen} DEFAULT 1,
        color VARCHAR(20) DEFAULT '#10b981',
        enabled ${booleen} DEFAULT 1,
        last_sync DATETIME,
        last_error ${texteLong},
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut}
      )
    `);

    // Ce qui est parti, et où. `external_uid` est l'identifiant que le serveur
    // distant connaît : c'est par lui qu'on remplace ou qu'on retire.
    await ctx.executer(`
      CREATE TABLE IF NOT EXISTS calendar_exports (
        id INTEGER PRIMARY KEY ${autoIncrement},
        destination_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        external_uid VARCHAR(255) NOT NULL,
        pushed_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (destination_id) REFERENCES calendar_destinations(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
      )
    `);

    // De quel carnet vient un événement importé : deux carnets CalDAV ne
    // doivent plus s'effacer l'un l'autre.
    const colonnes = await colonnesDe(ctx, 'calendar_events');
    await ajouterColonne(ctx, colonnes, 'calendar_events', 'external_calendar_id', 'INTEGER');

    // ---- Reprise de la configuration existante ----
    //
    // Une commune qui synchronisait déjà ne doit pas retrouver son écran vide.
    // L'ancienne configuration devient une destination, en **import** : c'est
    // tout ce qu'elle savait faire, et lui inventer un export enverrait au
    // carnet, dès la mise à jour, des centaines d'événements que personne n'a
    // demandés.
    await reprendreAncienneConfiguration(ctx);
  },
};

/** Transforme les deux réglages historiques en destinations. */
async function reprendreAncienneConfiguration(
  ctx: Parameters<Migration['up']>[0]
): Promise<void> {
  /*
    Lecture tolérante.

    `settings` n'existe pas forcément : une base créée de zéro voit passer les
    migrations avant d'avoir toutes ses tables, et un déploiement partiel peut
    en manquer. Il n'y a alors simplement rien à reprendre — ce n'est pas une
    raison d'interrompre la migration et de laisser le schéma à mi-chemin.
  */
  const lire = async (cle: string): Promise<any | null> => {
    try {
      const lignes = await ctx.interroger<{ setting_value: string }>(
        'SELECT setting_value FROM settings WHERE setting_key = ?',
        [cle]
      );
      if (lignes.length === 0) return null;
      return JSON.parse(lignes[0].setting_value || '{}');
    } catch {
      return null;
    }
  };

  const caldav = await lire('calendar_caldav_config');
  if (caldav?.serverUrl) {
    await ctx.executer(
      `INSERT INTO calendar_destinations
         (name, kind, server_url, username, password, calendar_path, direction,
          natures, category_ids, enabled, last_sync)
       VALUES (?, 'caldav', ?, ?, ?, ?, 'import', '[]', '[]', ?, ?)`,
      [
        'Agenda CalDAV',
        caldav.serverUrl,
        caldav.username ?? '',
        caldav.password ?? '',
        caldav.calendarPath ?? '',
        caldav.enabled ? 1 : 0,
        caldav.lastSync ?? null,
      ]
    );
  }

  const outlook = await lire('calendar_outlook_config');
  if (outlook?.clientId) {
    await ctx.executer(
      `INSERT INTO calendar_destinations
         (name, kind, client_id, client_secret, tenant_id, direction,
          natures, category_ids, enabled, last_sync)
       VALUES (?, 'outlook', ?, ?, ?, 'import', '[]', '[]', ?, ?)`,
      [
        'Agenda Outlook',
        outlook.clientId,
        outlook.clientSecret ?? '',
        outlook.tenantId ?? '',
        outlook.enabled ? 1 : 0,
        outlook.lastSync ?? null,
      ]
    );
  }
}

/** Ajoute la colonne si elle manque — une migration doit rester rejouable. */
async function ajouterColonne(
  ctx: Parameters<Migration['up']>[0],
  colonnes: Set<string>,
  table: string,
  colonne: string,
  type: string
): Promise<void> {
  if (colonnes.size === 0) return;
  if (colonnes.has(colonne)) return;
  await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
}

/** Colonnes existantes d'une table, dans les deux dialectes supportés. */
async function colonnesDe(
  ctx: Parameters<Migration['up']>[0],
  table: string
): Promise<Set<string>> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(lignes.map((l) => l.name));
  }

  const lignes = await ctx.interroger<{ COLUMN_NAME?: string; column_name?: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name) as string));
}

export default migration;
