import Database from 'better-sqlite3';
import { appliquerMigrations, migrationsEnAttente, type BaseMigration } from '../src/database/migrationRunner';
import { MIGRATIONS } from '../src/database/migrations';
import type { Migration } from '../src/database/migrations/types';

/**
 * Migrations versionnées.
 *
 * `npm run db:migrate` pointait vers un fichier absent : toute évolution de
 * schéma passait par un tableau tenu à la main, rejoué à chaque démarrage, sans
 * version ni trace de ce qui avait déjà été appliqué.
 *
 * Ces tests tournent sur une vraie base SQLite en mémoire — le journal et
 * l'ordre d'application sont précisément ce qu'un test avec une fausse base ne
 * vérifierait pas.
 */

function baseEnMemoire(): BaseMigration & { fermer(): void; sql: Database.Database } {
  const sqlite = new Database(':memory:');
  return {
    sql: sqlite,
    getType: () => 'sqlite',
    async execute(requete: string, params: any[] = []) {
      const r = sqlite.prepare(requete).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
    },
    async query<T = any>(requete: string, params: any[] = []) {
      return sqlite.prepare(requete).all(...params) as T[];
    },
    fermer: () => sqlite.close(),
  };
}

/**
 * Tables du module Manifestations, telles que `createTables()` les pose.
 *
 * Les migrations ne tournent jamais sur une base vide : `init()` appelle
 * `createTables()` d'abord. Une migration qui ajoute une colonne à
 * `manifestations` a donc le droit de supposer que la table existe — encore
 * faut-il que le fixture le reproduise, sinon le test échoue sur une situation
 * qui ne se présente jamais en exécution réelle.
 */
async function schemaManifestations(cible: BaseMigration): Promise<void> {
  await cible.execute(`
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title VARCHAR(255) NOT NULL,
      date_start DATE NOT NULL,
      date_end DATE,
      delivery_date DATE,
      status VARCHAR(20) DEFAULT 'draft'
    )
  `);
  await cible.execute(`
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      quantity_total INTEGER NOT NULL DEFAULT 0
    )
  `);
  await cible.execute(`
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifestation_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity_requested INTEGER NOT NULL DEFAULT 0,
      quantity_delivered INTEGER NOT NULL DEFAULT 0,
      quantity_recovered INTEGER NOT NULL DEFAULT 0
    )
  `);
}

const migrationTest = (id: string, up: Migration['up']): Migration => ({
  id,
  description: `migration ${id}`,
  up,
});

let base: ReturnType<typeof baseEnMemoire>;
beforeEach(() => {
  base = baseEnMemoire();
});
afterEach(() => base.fermer());

describe('Application des migrations', () => {
  it('applique une migration et l’inscrit au journal', async () => {
    const migrations = [
      migrationTest('001_test', async (ctx) => {
        await ctx.executer(`CREATE TABLE IF NOT EXISTS essai (id INTEGER PRIMARY KEY ${ctx.autoIncrement})`);
      }),
    ];

    const resultat = await appliquerMigrations(base, { migrations });

    expect(resultat.appliquees).toEqual(['001_test']);
    expect(await base.query("SELECT name FROM sqlite_master WHERE name = 'essai'")).toHaveLength(1);
    expect(await base.query('SELECT id FROM schema_migrations')).toEqual([{ id: '001_test' }]);
  });

  it('ne rejoue pas une migration déjà appliquée', async () => {
    let executions = 0;
    const migrations = [migrationTest('001_test', async () => { executions++; })];

    await appliquerMigrations(base, { migrations });
    const seconde = await appliquerMigrations(base, { migrations });

    expect(executions).toBe(1);
    expect(seconde.appliquees).toEqual([]);
    expect(seconde.dejaAppliquees).toBe(1);
  });

  it('applique dans l’ordre de la liste, pas dans celui du disque', async () => {
    const ordre: string[] = [];
    const migrations = [
      migrationTest('001_a', async () => { ordre.push('a'); }),
      migrationTest('002_b', async () => { ordre.push('b'); }),
      migrationTest('003_c', async () => { ordre.push('c'); }),
    ];

    await appliquerMigrations(base, { migrations });
    expect(ordre).toEqual(['a', 'b', 'c']);
  });

  it('n’applique que ce qui manque quand une migration est ajoutée', async () => {
    const premiere = [migrationTest('001_a', async () => {})];
    await appliquerMigrations(base, { migrations: premiere });

    const suivante = [...premiere, migrationTest('002_b', async () => {})];
    const resultat = await appliquerMigrations(base, { migrations: suivante });

    expect(resultat.appliquees).toEqual(['002_b']);
  });
});

describe('Échec en cours de route', () => {
  it('conserve ce qui a réussi et laisse le reste en attente', async () => {
    // MySQL valide implicitement chaque DDL : il n'existe pas de transaction
    // englobante à annuler. Ce qui compte est donc que la relance reprenne
    // exactement là où l'échec s'est produit.
    const migrations = [
      migrationTest('001_ok', async (ctx) => {
        await ctx.executer('CREATE TABLE IF NOT EXISTS ok (id INTEGER)');
      }),
      migrationTest('002_casse', async () => {
        throw new Error('colonne inconnue');
      }),
      migrationTest('003_jamais', async (ctx) => {
        await ctx.executer('CREATE TABLE IF NOT EXISTS jamais (id INTEGER)');
      }),
    ];

    await expect(appliquerMigrations(base, { migrations })).rejects.toThrow('002_casse');

    expect((await base.query('SELECT id FROM schema_migrations')).map((l: any) => l.id)).toEqual(['001_ok']);
    expect(await base.query("SELECT name FROM sqlite_master WHERE name = 'jamais'")).toHaveLength(0);
    expect(await migrationsEnAttente(base, migrations)).toEqual(['002_casse', '003_jamais']);
  });
});

describe('Inspection sans modification', () => {
  it('liste tout comme en attente sur une base neuve, sans créer le journal', async () => {
    const migrations = [migrationTest('001_a', async () => {})];

    expect(await migrationsEnAttente(base, migrations)).toEqual(['001_a']);
    // C'est ce qui rend `db:migrate --dry-run` honnête.
    expect(await base.query("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'")).toHaveLength(0);
  });
});

describe('Migrations livrées', () => {
  it('n’a que des identifiants uniques', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('porte des identifiants numérotés, pour que l’ordre soit lisible', () => {
    for (const m of MIGRATIONS) expect(m.id).toMatch(/^\d{3}_[a-z0-9_]+$/);
  });

  it('s’applique sur le schéma que crée l’application', async () => {
    // `init()` appelle `createTables()` puis les migrations : celles-ci ne
    // tournent jamais sur une base réellement vide, et peuvent donc modifier
    // les tables du schéma de base. Ce test reproduit cet ordre.
    await base.execute(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user'
      )
    `);
    await schemaManifestations(base);

    const resultat = await appliquerMigrations(base);
    expect(resultat.appliquees).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('est rejouable sur une base déjà migrée', async () => {
    // Une base peut déjà porter les colonnes, ajoutées à la main ou par une
    // exécution précédente dont le journal a été perdu. Rejouer ne doit pas
    // échouer sur « duplicate column ».
    await base.execute(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        password_changed_at DATETIME
      )
    `);
    await schemaManifestations(base);

    const resultat = await appliquerMigrations(base);
    expect(resultat.appliquees).toEqual(MIGRATIONS.map((m) => m.id));
  });
});
