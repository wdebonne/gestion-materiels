import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import migration037 from '../src/database/migrations/037_lieux_pieces_et_pret';
import type { ContexteMigration } from '../src/database/migrations/types';

/*
 * Le service lit `../src/database` ; les tests de migration, eux, montent leurs
 * propres bases et ne passent pas par là. Les deux cohabitent donc dans ce
 * fichier sans se gêner.
 */
jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseLieux = sqlite;

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
    },
  };
});

import {
  arbreDesLieux,
  creerPiece,
  lieuxPretables,
  modifierPiece,
  pretableEffectif,
  usagesPiece,
} from '../src/services/lieux.service';

/**
 * Le troisième niveau du référentiel des lieux, et ce qui se prête.
 *
 * Trois choses se cassent silencieusement ici, et ce sont elles qu'on fige.
 *
 *   **Le repli de `pretable` est « non ».** Il est l'inverse de celui du parc,
 *   dans un fichier voisin qui lui ressemble trait pour trait. Quelqu'un
 *   « corrigera » l'écart un jour, et le seul symptôme sera que la chaufferie
 *   et le cimetière apparaîtront dans la liste des salles à louer.
 *
 *   **Supprimer une pièce rend ses portes au bâtiment.** Un `CASCADE` posé à la
 *   place effacerait des ouvrants que des clés ouvrent, et la clé deviendrait un
 *   bout de métal sans usage connu. Rien ne le signalerait : l'écran
 *   continuerait de s'afficher, avec une porte de moins.
 *
 *   **Les clés étrangères de la migration existent aussi sur MySQL.**
 *   `ALTER TABLE … ADD COLUMN … REFERENCES` est honoré par SQLite et jeté
 *   silencieusement par InnoDB. Le banc d'essai partagé
 *   (`migrationsMySQL.test.ts`) ne peut pas le voir : sa fausse base rend `[]` à
 *   toute lecture, si bien que la garde `colonnesDe` fait sortir la migration
 *   avant qu'elle n'ait produit une seule ligne de SQL. On la rejoue donc ici
 *   contre un contexte MySQL qui répond, pour inspecter ce qu'elle écrit
 *   vraiment.
 */

// --------------------------------------------------------------- outillage

/** Le schéma que la migration 037 trouve devant elle, tel que 024 et 032 le laissent. */
const SCHEMA_AVANT = `
  CREATE TABLE cle_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    address VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE cle_ouvrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    description TEXT,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE cle_ouvre (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL,
    site_id INTEGER,
    ouvrant_id INTEGER
  );
  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre VARCHAR(255) NOT NULL,
    site_id INTEGER,
    ouvrant_id INTEGER
  );
`;

/** Un contexte de migration branché sur une vraie base SQLite. */
function contexteSqlite(sqlite: BetterSqlite3.Database): ContexteMigration {
  return {
    dialecte: 'sqlite',
    autoIncrement: 'AUTOINCREMENT',
    texteLong: 'TEXT',
    booleen: 'INTEGER',
    horodatageParDefaut: "DEFAULT CURRENT_TIMESTAMP",
    async executer(sql: string, params: any[] = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
    },
    async interroger<T = any>(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async creerIndex(nom: string, table: string, colonnes: string) {
      sqlite.prepare(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`).run();
    },
  };
}

function baseMigree(): BetterSqlite3.Database {
  const sqlite = new Database(':memory:');
  // Sans cela, better-sqlite3 n'applique aucun `ON DELETE` : le test passerait
  // en ne vérifiant rien, ce qui est pire que pas de test du tout.
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_AVANT);
  return sqlite;
}

const colonnes = (sqlite: BetterSqlite3.Database, table: string): string[] =>
  (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);

// ------------------------------------------------- la migration, sur SQLite

describe('Migration 037 — le référentiel gagne son troisième niveau', () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(async () => {
    sqlite = baseMigree();
    await migration037.up(contexteSqlite(sqlite));
  });

  afterEach(() => sqlite.close());

  it('crée `site_pieces` avec de quoi décrire et filtrer une salle', () => {
    expect(colonnes(sqlite, 'site_pieces')).toEqual(
      expect.arrayContaining([
        'id',
        'site_id',
        'name',
        'code',
        'description',
        'type_lieu',
        'capacite',
        'pretable',
        'sort_order',
        'is_active',
      ])
    );
  });

  it('ouvre les trois portées d’une clé : bâtiment, pièce, ouvrant', () => {
    expect(colonnes(sqlite, 'cle_ouvre')).toEqual(
      expect.arrayContaining(['site_id', 'piece_id', 'ouvrant_id'])
    );
  });

  it('pose le drapeau de prêt sur le bâtiment et laisse la demande citer sa pièce', () => {
    expect(colonnes(sqlite, 'cle_sites')).toContain('pretable');
    expect(colonnes(sqlite, 'tickets')).toContain('piece_id');
  });

  it('se rejoue sans rien casser', async () => {
    await expect(migration037.up(contexteSqlite(sqlite))).resolves.not.toThrow();
    expect(colonnes(sqlite, 'site_pieces')).toContain('type_lieu');
  });

  /**
   * Le comportement, et pas seulement le schéma.
   *
   * C'est la leçon du dernier test de `migrations.test.ts` : une garde bien
   * placée fait passer un test sans que la migration ait rien fait. On supprime
   * donc pour de bon, et on regarde ce qui reste.
   */
  it('rend les portes au bâtiment quand la pièce disparaît, sans les effacer', () => {
    sqlite.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie');
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages');
      INSERT INTO cle_ouvrants (id, site_id, piece_id, name) VALUES (1, 1, 1, 'Porte principale');
      DELETE FROM site_pieces WHERE id = 1;
    `);

    const porte = sqlite.prepare('SELECT * FROM cle_ouvrants WHERE id = 1').get() as any;
    expect(porte).toBeDefined();
    expect(porte.piece_id).toBeNull();
    expect(porte.site_id).toBe(1);
  });

  it('retire en revanche le lien d’une clé vers une pièce disparue', () => {
    sqlite.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie');
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages');
      INSERT INTO cle_ouvre (id, object_id, piece_id) VALUES (1, 10, 1);
      DELETE FROM site_pieces WHERE id = 1;
    `);

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM cle_ouvre').get()).toEqual({ n: 0 });
  });
});

// -------------------------------------------------- la migration, en MySQL

describe('Migration 037 — ce qu’elle écrit vraiment en dialecte MySQL', () => {
  /**
   * Un contexte qui se dit MySQL et **répond** aux lectures.
   *
   * C'est toute la différence avec le banc partagé : en rendant les colonnes
   * existantes, la garde passe et la migration emprunte son chemin long — celui
   * qu'on veut inspecter. `TABLE_CONSTRAINTS` rend vide, donc les clés
   * étrangères sont réputées absentes et doivent être posées.
   */
  function contexteMysql(): ContexteMigration & { sql: string[] } {
    const sql: string[] = [];
    return {
      sql,
      dialecte: 'mysql',
      autoIncrement: 'AUTO_INCREMENT',
      texteLong: 'LONGTEXT',
      booleen: 'TINYINT(1)',
      horodatageParDefaut: 'DEFAULT CURRENT_TIMESTAMP',
      async executer(requete: string) {
        sql.push(requete);
        return { lastInsertRowid: 0, changes: 0 };
      },
      async interroger<T = any>(requete: string, params: any[] = []) {
        sql.push(requete);
        if (/TABLE_CONSTRAINTS/i.test(requete)) return [] as T[];
        // Les colonnes d'avant la migration : assez pour que la garde passe et
        // que chaque colonne neuve soit vue comme manquante.
        const table = String(params[0] ?? '');
        const connues: Record<string, string[]> = {
          cle_sites: ['id', 'name', 'code', 'address', 'sort_order', 'is_active'],
          cle_ouvrants: ['id', 'site_id', 'name', 'code', 'description', 'sort_order'],
          cle_ouvre: ['id', 'object_id', 'site_id', 'ouvrant_id'],
          tickets: ['id', 'titre', 'site_id', 'ouvrant_id'],
        };
        return (connues[table] ?? []).map((name) => ({ COLUMN_NAME: name })) as T[];
      },
      async creerIndex() {
        /* le banc partagé vérifie déjà que les index passent par le contexte */
      },
    };
  }

  let sql: string[];

  beforeAll(async () => {
    const ctx = contexteMysql();
    await migration037.up(ctx);
    sql = ctx.sql;
  });

  it('a bien emprunté son chemin long — le banc n’est pas à vide', () => {
    expect(sql.some((r) => /CREATE TABLE IF NOT EXISTS site_pieces/i.test(r))).toBe(true);
    expect(sql.filter((r) => /ALTER TABLE/i.test(r)).length).toBeGreaterThanOrEqual(4);
  });

  /**
   * InnoDB parse `REFERENCES` dans un `ADD COLUMN` et le jette sans rien dire.
   * Une colonne posée de cette façon aurait donc sa clé étrangère en
   * développement et pas en production — précisément l'angle mort qui a coûté
   * la migration 021.
   */
  it('pose ses clés étrangères en `ADD CONSTRAINT`, jamais dans le `ADD COLUMN`', () => {
    const ajouts = sql.filter((r) => /ADD COLUMN/i.test(r));
    for (const requete of ajouts) {
      expect(requete).not.toMatch(/REFERENCES/i);
    }

    for (const contrainte of ['fk_cle_ouvrants_piece', 'fk_cle_ouvre_piece', 'fk_tickets_piece']) {
      expect(sql.some((r) => new RegExp(`ADD CONSTRAINT ${contrainte}\\b`, 'i').test(r))).toBe(true);
    }
  });

  it('confie chaque suppression au comportement voulu', () => {
    const trouver = (nom: string) => sql.find((r) => new RegExp(`ADD CONSTRAINT ${nom}\\b`, 'i').test(r))!;

    // La porte retombe sur le bâtiment ; le lien de la clé, lui, n'a plus d'objet.
    expect(trouver('fk_cle_ouvrants_piece')).toMatch(/ON DELETE SET NULL/i);
    expect(trouver('fk_tickets_piece')).toMatch(/ON DELETE SET NULL/i);
    expect(trouver('fk_cle_ouvre_piece')).toMatch(/ON DELETE CASCADE/i);
  });

  it('n’emploie aucune tournure que MySQL refuse', () => {
    for (const requete of sql) {
      expect(requete).not.toMatch(/AUTOINCREMENT/i);
      expect(requete).not.toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
      expect(requete).not.toMatch(/\bPRAGMA\b/i);
    }
  });
});

// ------------------------------------------------------------- le service

describe('Ce qui se prête : trois états, et un repli à « non »', () => {
  /**
   * La règle en TypeScript et la règle en SQL doivent dire la même chose.
   * `pretableEffectif` et `expressionPretable` sont deux écritures du même
   * COALESCE, et c'est exactement le genre de paire qui diverge en silence.
   */
  it.each([
    ['rien de réglé nulle part', null, null, false],
    ['le bâtiment ouvert, la pièce muette', null, true, true],
    ['le bâtiment fermé, la pièce muette', null, false, false],
    ['la pièce exclue d’un bâtiment ouvert', false, true, false],
    ['la pièce ouverte dans un bâtiment fermé', true, false, true],
  ])('%s', (_cas, piece, site, attendu) => {
    expect(pretableEffectif(piece as any, site as any)).toBe(attendu);
  });

  it('ne prête rien tant que personne n’a rien ouvert', () => {
    // Le repli du parc est « oui ». Celui des lieux est « non », et cette
    // ligne est là pour que l'écart survive à la prochaine relecture.
    expect(pretableEffectif(null, null)).toBe(false);
  });
});

describe('Le référentiel vu du service', () => {
  const base: BetterSqlite3.Database = (global as any).__baseLieux;

  beforeAll(() => {
    base.exec(`
      CREATE TABLE cle_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        address VARCHAR(500),
        pretable INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE site_pieces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        description TEXT,
        type_lieu VARCHAR(50),
        capacite INTEGER,
        pretable INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE cle_ouvrants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        piece_id INTEGER,
        name VARCHAR(255) NOT NULL,
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE cle_ouvre (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER NOT NULL,
        site_id INTEGER, piece_id INTEGER, ouvrant_id INTEGER
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titre VARCHAR(255), site_id INTEGER, piece_id INTEGER
      );
    `);
  });

  afterEach(() => {
    base.exec('DELETE FROM site_pieces; DELETE FROM cle_sites; DELETE FROM cle_ouvrants; DELETE FROM cle_ouvre; DELETE FROM tickets;');
  });

  it('range les ouvrants sous leur pièce, et les autres sous le bâtiment', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie');
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages');
      INSERT INTO cle_ouvrants (id, site_id, piece_id, name) VALUES (1, 1, 1, 'Porte de la salle');
      INSERT INTO cle_ouvrants (id, site_id, piece_id, name) VALUES (2, 1, NULL, 'Barrière principale');
    `);

    const [mairie] = await arbreDesLieux();
    expect(mairie.pieces).toHaveLength(1);
    expect(mairie.pieces[0].ouvrants.map((o: any) => o.name)).toEqual(['Porte de la salle']);
    // La barrière n'est dans aucune salle, et n'a pas à l'être.
    expect(mairie.ouvrants.map((o: any) => o.name)).toEqual(['Barrière principale']);
  });

  it('ne propose au prêt que ce qu’on a ouvert', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name, pretable) VALUES (1, 'Mairie', NULL);
      INSERT INTO cle_sites (id, name, pretable) VALUES (2, 'Centre technique', NULL);
      INSERT INTO site_pieces (id, site_id, name, pretable) VALUES (1, 1, 'Salle des Mariages', 1);
      INSERT INTO site_pieces (id, site_id, name, pretable) VALUES (2, 2, 'Atelier', NULL);
    `);

    const lieux = await lieuxPretables();
    expect(lieux.map((l) => l.nom)).toEqual(['Salle des Mariages']);
  });

  it('propose le bâtiment entier en plus de ses pièces quand il est ouvert', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name, pretable) VALUES (1, 'Salle des fêtes', 1);
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Cuisine');
    `);

    const lieux = await lieuxPretables();
    // On prête la salle entière pour un loto, et la seule cuisine pour un repas.
    expect(lieux.map((l) => [l.nom, l.pieceId])).toEqual([
      ['Salle des fêtes', null],
      ['Cuisine', 1],
    ]);
  });

  it('garde une salle dont personne n’a saisi la jauge', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name, pretable) VALUES (1, 'Mairie', 1);
      INSERT INTO site_pieces (id, site_id, name, capacite) VALUES (1, 1, 'Grande salle', 200);
      INSERT INTO site_pieces (id, site_id, name, capacite) VALUES (2, 1, 'Petite salle', 20);
      INSERT INTO site_pieces (id, site_id, name, capacite) VALUES (3, 1, 'Salle sans jauge', NULL);
    `);

    const lieux = await lieuxPretables({ capaciteMinimale: 100 });
    // L'absence d'information n'est pas une information : masquer la salle
    // sans jauge ferait abandonner le filtre.
    expect(lieux.map((l) => l.nom).sort()).toEqual(
      ['Grande salle', 'Mairie', 'Salle sans jauge'].sort()
    );
  });

  it('distingue « hérite » de « non » quand le formulaire rend une chaîne vide', async () => {
    base.exec(`INSERT INTO cle_sites (id, name, pretable) VALUES (1, 'Mairie', 1);`);
    const id = await creerPiece({ siteId: 1, nom: 'Hall', pretable: '' });

    const ligne = base.prepare('SELECT pretable FROM site_pieces WHERE id = ?').get(id) as any;
    expect(ligne.pretable).toBeNull();

    // Et la pièce suit donc son bâtiment, au lieu d'être exclue.
    expect((await lieuxPretables()).map((l) => l.nom)).toContain('Hall');

    await modifierPiece(id, { pretable: false });
    expect((await lieuxPretables()).map((l) => l.nom)).not.toContain('Hall');
  });

  it('compte ce qui empêche une suppression, et ignore une table pas encore migrée', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie');
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages');
      INSERT INTO cle_ouvre (object_id, piece_id) VALUES (10, 1), (11, 1);
      INSERT INTO tickets (titre, piece_id) VALUES ('Fuite', 1);
      INSERT INTO cle_ouvrants (site_id, piece_id, name) VALUES (1, 1, 'Porte');
    `);

    // `lieu_occupations` n'existe pas encore : une base à mi-chemin ne doit pas
    // faire échouer la lecture, elle n'a simplement rien à compter.
    expect(await usagesPiece(1)).toEqual({ cles: 2, tickets: 1, ouvrants: 1, occupations: 0 });
  });
});
