import type BetterSqlite3 from 'better-sqlite3';

/**
 * Les droits d'une personne, lus et écrits d'un bloc ; et ce que son
 * formulaire de demande lui montre.
 *
 * Ce qui est figé ici :
 *
 *   **Un seul enregistrement, tout ou rien.** Une catégorie inconnue refuse le
 *   tout : ses modules ne changent pas plus que ses catégories.
 *
 *   **« Selon le rôle » est l'absence de ligne.** Retirer une surcharge rend la
 *   main au réglage du rôle, au lieu d'en figer la valeur du jour.
 *
 *   **La préséance du formulaire est écrite une fois.** Catégorie, exception
 *   de matériel, réglage de la personne : `modesFormulairePour()` tranche, et
 *   une catégorie qui exige un bâtiment l'emporte sur une personne pour qui on
 *   l'a masqué.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseDroitsUtilisateur = sqlite;

  return {
    db: {
      getType: () => 'sqlite',
      async query(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).all(...params);
      },
      async queryOne(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).get(...params) ?? null;
      },
      async execute(requete: string, params: any[] = []) {
        const r = sqlite.prepare(requete).run(...params);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
      },
      async transaction<T>(travail: () => Promise<T>): Promise<T> {
        if ((global as any).__dansTransaction) return travail();
        (global as any).__dansTransaction = true;
        sqlite.exec('BEGIN');
        try {
          const resultat = await travail();
          sqlite.exec('COMMIT');
          return resultat;
        } catch (erreur) {
          sqlite.exec('ROLLBACK');
          throw erreur;
        } finally {
          (global as any).__dansTransaction = false;
        }
      },
    },
  };
});

import migration032 from '../src/database/migrations/032_tickets';
import migration035 from '../src/database/migrations/035_tickets_rattachements';
import migration045 from '../src/database/migrations/045_tickets_niveaux';
import migration046 from '../src/database/migrations/046_tickets_cloture';
import migration047 from '../src/database/migrations/047_formulaire_par_personne';
import migration049 from '../src/database/migrations/049_batiment_par_defaut';
import type { ContexteMigration } from '../src/database/migrations/types';
import { definirDroits, lireDroits } from '../src/services/droitsUtilisateur.service';
import { modesFormulairePour } from '../src/services/ticketsReferentiel.service';
import { SaisieInvalide } from '../src/services/tickets.service';
import { definirSitesDe, siteParDefautDe } from '../src/services/sites.service';

const base: BetterSqlite3.Database = (global as any).__baseDroitsUtilisateur;

const ADMIN = 1;
const AGENT = 2;
const DEMANDEUSE = 3;
const SEULE_PAR_MAIL = 4; // un matériel exigé, aucun attribué

const MAIRIE = 1;
const ECOLE = 2;

let INFORMATIQUE = 0;
let BATIMENT = 0;
let VOIRIE = 0;
let TICKETS = 0;
let MANIFESTATIONS = 0;
let CLES = 0;

const ctx: ContexteMigration = {
  executer: async (sql, params) => {
    const r = base.prepare(sql).run(...(params ?? []));
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
  },
  interroger: async (sql, params) => base.prepare(sql).all(...(params ?? [])) as any[],
  creerIndex: async (nom, table, colonnes) => {
    base.exec(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`);
  },
  dialecte: 'sqlite',
  autoIncrement: 'AUTOINCREMENT',
  texteLong: 'TEXT',
  booleen: 'INTEGER',
  horodatageParDefaut: "DEFAULT (datetime('now'))",
};

beforeAll(async () => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100));
    CREATE TABLE service_members (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      location VARCHAR(255), category_id INTEGER, subcategory_id INTEGER);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), code VARCHAR(50),
      address VARCHAR(500), sort_order INTEGER DEFAULT 0);
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY, site_id INTEGER, name VARCHAR(255));
    CREATE TABLE plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255), slug VARCHAR(100),
      plugin_type VARCHAR(20) DEFAULT 'menu', is_active INTEGER DEFAULT 1
    );
    CREATE TABLE plugin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id INTEGER, role VARCHAR(50), can_access INTEGER DEFAULT 1,
      UNIQUE(plugin_id, role)
    );
    CREATE TABLE user_plugin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plugin_id INTEGER, can_access INTEGER DEFAULT 1,
      created_at DATETIME, updated_at DATETIME, UNIQUE(user_id, plugin_id)
    );
  `);

  await migration032.up(ctx);
  await migration035.up(ctx);
  // `gere_lieu` vient de la migration 040, que ce banc n'applique pas.
  base.exec('ALTER TABLE user_sites ADD COLUMN gere_lieu INTEGER NOT NULL DEFAULT 0');
  await migration045.up(ctx);
  await migration046.up(ctx);
  await migration047.up(ctx);
  await migration049.up(ctx);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${AGENT}, 'agent@ville.fr', 'Ali', 'Agent', 'agent'),
      (${DEMANDEUSE}, 'dem@ville.fr', 'Dana', 'Demande', 'user'),
      (${SEULE_PAR_MAIL}, 'seule@ville.fr', 'Sol', 'Seule', 'user');
    INSERT INTO cle_sites (id, name) VALUES (${MAIRIE}, 'Mairie'), (${ECOLE}, 'École');
    INSERT INTO categories (id, name) VALUES (1, 'Informatique');
    INSERT INTO objects (id, name, category_id) VALUES (10, 'Portable de Dana', 1);
    INSERT INTO user_materiels (user_id, object_id) VALUES (${DEMANDEUSE}, 10);

    INSERT INTO plugins (name, slug) VALUES ('Tickets', 'tickets'), ('Manifestations', 'manifestations'), ('Clés', 'cles');
    -- Le rôle « user » ne voit pas les clés ; le reste est ouvert par défaut.
    INSERT INTO plugin_permissions (plugin_id, role, can_access) VALUES (3, 'user', 0);

    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, ordre, materiel_mode, site_mode) VALUES
      ('Informatique', 'informatique', 0, 1, 'optionnel', 'masque'),
      ('Bâtiment', 'batiment', 0, 2, 'aucun', 'requis'),
      ('Voirie', 'voirie', 0, 3, 'requis', 'auto');
  `);

  const id = (table: string, colonne: string, valeur: string) =>
    Number((base.prepare(`SELECT id FROM ${table} WHERE ${colonne} = ?`).get(valeur) as any).id);
  INFORMATIQUE = id('ticket_categories', 'nom', 'Informatique');
  BATIMENT = id('ticket_categories', 'nom', 'Bâtiment');
  VOIRIE = id('ticket_categories', 'nom', 'Voirie');
  TICKETS = id('plugins', 'slug', 'tickets');
  MANIFESTATIONS = id('plugins', 'slug', 'manifestations');
  CLES = id('plugins', 'slug', 'cles');
});

describe('Les droits d’une personne', () => {
  it('se règlent d’un bloc : un demandeur qui ne voit que les tickets', async () => {
    await definirDroits(
      DEMANDEUSE,
      {
        modules: [
          { pluginId: TICKETS, acces: true },
          { pluginId: MANIFESTATIONS, acces: false },
          { pluginId: CLES, acces: null },
        ],
        categories: [
          { categorieId: INFORMATIQUE, niveau: 'demandeur' },
          { categorieId: BATIMENT, niveau: 'demandeur' },
        ],
        sites: [{ siteId: MAIRIE, estResponsable: true, peutVoirTickets: false, notifie: false }],
        formulaire: { siteMode: 'requis', materielMode: null },
      },
      ADMIN
    );

    const droits = (await lireDroits(DEMANDEUSE))!;
    const effectif = Object.fromEntries(droits.modules.map((m) => [m.slug, m.effectif]));
    expect(effectif).toEqual({ tickets: true, manifestations: false, cles: false });
    // Les clés sont fermées par le rôle, pas par une ligne individuelle.
    expect(droits.modules.find((m) => m.slug === 'cles')).toMatchObject({ parRole: false, individuel: null });

    expect(droits.tickets.categories.filter((c) => c.niveau).map((c) => c.nom)).toEqual(['Informatique', 'Bâtiment']);
    expect(droits.tickets.sites).toEqual([
      expect.objectContaining({ siteId: MAIRIE, estResponsable: true, peutVoirTickets: false }),
    ]);
    expect(droits.tickets.formulaire).toEqual({ siteMode: 'requis', materielMode: null });
  });

  it('rend la main au rôle quand on retire une surcharge', async () => {
    await definirDroits(DEMANDEUSE, { modules: [{ pluginId: MANIFESTATIONS, acces: null }] }, ADMIN);
    const manifestations = (await lireDroits(DEMANDEUSE))!.modules.find((m) => m.slug === 'manifestations')!;
    expect(manifestations).toMatchObject({ individuel: null, effectif: true });
    expect(
      base.prepare('SELECT COUNT(*) AS n FROM user_plugin_permissions WHERE user_id = ? AND plugin_id = ?').get(DEMANDEUSE, MANIFESTATIONS)
    ).toEqual({ n: 0 });
  });

  it('ne touche à rien de ce qu’on ne transmet pas', async () => {
    await definirDroits(DEMANDEUSE, { formulaire: { siteMode: null, materielMode: null } }, ADMIN);
    const droits = (await lireDroits(DEMANDEUSE))!;
    expect(droits.tickets.categories.filter((c) => c.niveau)).toHaveLength(2);
    expect(droits.tickets.sites).toHaveLength(1);
  });

  it('refuse tout l’enregistrement pour une catégorie inconnue', async () => {
    await expect(
      definirDroits(
        AGENT,
        {
          modules: [{ pluginId: TICKETS, acces: false }],
          categories: [{ categorieId: 9999, niveau: 'intervenant' }],
        },
        ADMIN
      )
    ).rejects.toBeInstanceOf(SaisieInvalide);
    // Le module n'a pas été masqué pour autant.
    expect(base.prepare('SELECT COUNT(*) AS n FROM user_plugin_permissions WHERE user_id = ?').get(AGENT)).toEqual({ n: 0 });
  });

  it('prévient quand une clôture à valider n’aurait personne pour la valider', async () => {
    await definirDroits(
      AGENT,
      { categories: [{ categorieId: BATIMENT, niveau: 'intervenant_categorie', peutCloturer: false }] },
      ADMIN
    );
    const droits = (await lireDroits(AGENT))!;
    expect(droits.avertissements.join(' ')).toMatch(/Bâtiment.*aucun superviseur/);

    await definirDroits(ADMIN, { categories: [{ categorieId: BATIMENT, niveau: 'superviseur' }] }, ADMIN);
    expect((await lireDroits(AGENT))!.avertissements).toEqual([]);
  });
});

describe('Le formulaire de demande', () => {
  it('suit la catégorie quand la personne n’a pas de réglage', async () => {
    expect(await modesFormulairePour(DEMANDEUSE, INFORMATIQUE, null)).toEqual({
      siteMode: 'masque',
      materielMode: 'optionnel',
    });
  });

  it('prend le réglage de la personne, sauf un bâtiment que la catégorie exige', async () => {
    await definirDroits(DEMANDEUSE, { formulaire: { siteMode: 'masque', materielMode: 'requis' } }, ADMIN);
    // Informatique : bâtiment masqué des deux côtés, matériel exigé pour elle.
    expect(await modesFormulairePour(DEMANDEUSE, INFORMATIQUE, null)).toEqual({
      siteMode: 'masque',
      materielMode: 'requis',
    });
    // Bâtiment : la catégorie exige un lieu, et n'a pas de matériel à proposer.
    expect(await modesFormulairePour(DEMANDEUSE, BATIMENT, null)).toEqual({
      siteMode: 'requis',
      materielMode: 'aucun',
    });
  });

  it('retire le matériel quand l’exception de la catégorie le refuse', async () => {
    base
      .prepare('UPDATE user_ticket_categories SET materiel_autorise = 0 WHERE user_id = ? AND ticket_categorie_id = ?')
      .run(DEMANDEUSE, INFORMATIQUE);
    expect((await modesFormulairePour(DEMANDEUSE, INFORMATIQUE, null)).materielMode).toBe('aucun');
  });

  it('n’exige pas un matériel quand aucun n’est attribué', async () => {
    // Voirie exige un matériel ; la personne n'en a aucun : elle doit pouvoir envoyer.
    expect((await modesFormulairePour(SEULE_PAR_MAIL, VOIRIE, null)).materielMode).toBe('aucun');
  });
});

describe('Son bureau, parmi ses bâtiments', () => {
  it('est forcément son bâtiment quand il n’en a qu’un', async () => {
    await definirDroits(AGENT, { sites: [{ siteId: MAIRIE }] }, ADMIN);
    expect(await siteParDefautDe(AGENT)).toBe(MAIRIE);
  });

  it('se désigne parmi plusieurs, un seul à la fois', async () => {
    await definirDroits(
      AGENT,
      { sites: [{ siteId: MAIRIE, parDefaut: true }, { siteId: ECOLE, parDefaut: true }] },
      ADMIN
    );
    expect(await siteParDefautDe(AGENT)).toBe(MAIRIE);
    const lignes = base.prepare('SELECT site_id, par_defaut FROM user_sites WHERE user_id = ? ORDER BY site_id').all(AGENT);
    expect(lignes).toEqual([
      { site_id: MAIRIE, par_defaut: 1 },
      { site_id: ECOLE, par_defaut: 0 },
    ]);
  });

  it('survit à un écran qui ne connaît pas le drapeau', async () => {
    await definirDroits(AGENT, { sites: [{ siteId: MAIRIE }, { siteId: ECOLE, parDefaut: true }] }, ADMIN);
    // Les rattachements des tickets renvoient les lignes sans le drapeau.
    await definirSitesDe(AGENT, [{ siteId: MAIRIE }, { siteId: ECOLE }], ADMIN);
    expect(await siteParDefautDe(AGENT)).toBe(ECOLE);
  });

  it('manque, et on le dit, quand il a plusieurs bâtiments sans bureau désigné', async () => {
    await definirDroits(
      AGENT,
      {
        sites: [{ siteId: MAIRIE, parDefaut: false }, { siteId: ECOLE, parDefaut: false }],
        categories: [{ categorieId: INFORMATIQUE, niveau: 'demandeur' }],
      },
      ADMIN
    );
    expect(await siteParDefautDe(AGENT)).toBeNull();
    expect((await lireDroits(AGENT))!.avertissements.join(' ')).toMatch(/aucun désigné comme son bureau/);
  });
});
