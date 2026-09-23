import fs from 'fs';
import os from 'os';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Sauvegarde et restauration, sur le chemin qu'emprunte MySQL.
 *
 * La restauration MySQL d'avant réinsérait chaque ligne **sans son `id`** : les
 * lignes étaient renumérotées et tous les liens pointaient ensuite ailleurs.
 * Elle vidait aussi `categories` avec les clés étrangères actives, ce qui
 * effaçait en cascade les matériels déjà restaurés. Ces deux propriétés sont
 * figées ici, avec les trois formats d'archive qu'on peut avoir à relire.
 *
 * La base cible est un SQLite en mémoire : le moteur de copie est le même pour
 * les deux moteurs, seule la suspension des clés étrangères diffère.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  (global as any).__baseSauvegarde = sqlite;

  return {
    db: {
      getType: () => 'sqlite',
      getSQLiteDb: () => sqlite,
      getSQLitePath: () => null,
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
        sqlite.exec('BEGIN');
        try {
          const resultat = await travail();
          sqlite.exec('COMMIT');
          return resultat;
        } catch (erreur) {
          sqlite.exec('ROLLBACK');
          throw erreur;
        }
      },
    },
  };
});

import Database from 'better-sqlite3';
import archiver from 'archiver';
import {
  ArchiveInvalide,
  copierTables,
  elaguerSauvegardes,
  lireTableMySQL,
  restaurerArchive,
  sourceSqlite,
} from '../src/services/sauvegarde.service';

const base: BetterSqlite3.Database = (global as any).__baseSauvegarde;

const SCHEMA = `
  CREATE TABLE schema_migrations (id VARCHAR(100) PRIMARY KEY, applied_at DATETIME);
  CREATE TABLE backups (id INTEGER PRIMARY KEY AUTOINCREMENT, filename VARCHAR(255), file_path VARCHAR(500),
    file_size INTEGER, backup_type VARCHAR(50), status VARCHAR(50), notes TEXT,
    created_at DATETIME DEFAULT (datetime('now')));
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email VARCHAR(255), role VARCHAR(50), created_at DATETIME);
  CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
  CREATE TABLE objects (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255), purchase_date DATE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE);
  CREATE TABLE fuel_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL,
    entry_date DATE NOT NULL, FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE);
  CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, titre VARCHAR(255));
`;

let dossier: string;
const cwdInitial = process.cwd();

beforeAll(() => {
  // Les sauvegardes s'écrivent dans ./backups : on travaille dans un dossier jetable.
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sauvegarde-test-'));
  process.chdir(dossier);
  process.env.UPLOAD_DIR = path.join(dossier, 'uploads-absent');
});

afterAll(() => {
  process.chdir(cwdInitial);
  fs.rmSync(dossier, { recursive: true, force: true });
});

beforeEach(() => {
  base.pragma('foreign_keys = OFF');
  for (const { name } of base.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]) {
    base.exec(`DROP TABLE "${name}"`);
  }
  base.pragma('foreign_keys = ON');
  base.exec(SCHEMA);

  // L'état « actuel », que la restauration doit remplacer.
  base.exec(`
    INSERT INTO users (id, email, role) VALUES (1, 'actuel@exemple.fr', 'admin');
    INSERT INTO categories (id, name) VALUES (1, 'Catégorie actuelle');
    INSERT INTO objects (id, name, category_id) VALUES (1, 'Objet actuel', 1);
    INSERT INTO tickets (id, titre) VALUES (1, 'Ticket actuel');
    INSERT INTO backups (id, filename, file_path, backup_type) VALUES (7, 'garde-moi.zip', './backups/garde-moi.zip', 'manual');
    INSERT INTO schema_migrations (id) VALUES ('039_cible');
  `);
});

/** Une base source, avec des identifiants volontairement non contigus. */
function baseSource(): BetterSqlite3.Database {
  const source = new Database(':memory:');
  source.exec(SCHEMA);
  source.exec(`ALTER TABLE objects ADD COLUMN colonne_disparue TEXT`);
  source.exec(`
    INSERT INTO users (id, email, role, created_at) VALUES (3, 'a@exemple.fr', 'admin', '2026-03-18 09:30:00'), (12, 'b@exemple.fr', 'user', NULL);
    INSERT INTO categories (id, name) VALUES (4, 'Véhicules'), (9, 'Informatique');
    INSERT INTO objects (id, name, purchase_date, category_id, colonne_disparue) VALUES
      (5, 'Kangoo', '2026-03-18', 4, 'x'), (42, 'Portable', NULL, 9, NULL);
    INSERT INTO fuel_entries (id, object_id, entry_date) VALUES (100, 5, '2026-01-02'), (101, 5, '2026-02-03'), (250, 42, '2026-03-04');
    INSERT INTO schema_migrations (id) VALUES ('001_source');
    INSERT INTO backups (id, filename, file_path) VALUES (1, 'source.zip', 'x');
  `);
  return source;
}

/** Fabrique une archive : `fichiers` associe un chemin dans l'archive à son contenu. */
async function archive(nom: string, fichiers: Record<string, string>): Promise<string> {
  const chemin = path.join(dossier, nom);
  const sortie = fs.createWriteStream(chemin);
  const zip = archiver('zip');
  zip.pipe(sortie);
  for (const [cle, contenu] of Object.entries(fichiers)) zip.append(contenu, { name: cle });
  await zip.finalize();
  await new Promise<void>((r) => sortie.on('close', () => r()));
  return chemin;
}

const jsonl = (lignes: object[]) => lignes.map((l) => JSON.stringify(l)).join('\n') + '\n';

describe('copierTables — le moteur commun', () => {
  it('garde les identifiants, et donc les liens entre tables', async () => {
    const rapport = await copierTables(sourceSqlite(baseSource()));

    expect(base.prepare('SELECT id, name, category_id FROM objects ORDER BY id').all()).toEqual([
      { id: 5, name: 'Kangoo', category_id: 4 },
      { id: 42, name: 'Portable', category_id: 9 },
    ]);
    // Le plein n°250 est toujours celui du portable, et non d'une autre ligne.
    const plein = base.prepare('SELECT o.name FROM fuel_entries f JOIN objects o ON o.id = f.object_id WHERE f.id = 250').get() as any;
    expect(plein.name).toBe('Portable');
    expect(rapport.liensOrphelins).toBe(0);
    expect(rapport.lignes).toBe(9);
  });

  it("ne vide pas en cascade une table déjà restaurée", async () => {
    // Vider `categories` avec les clés étrangères actives emporterait en
    // cascade les matériels — c'est ce que faisait l'ancienne restauration.
    await copierTables(sourceSqlite(baseSource()));
    expect((base.prepare('SELECT COUNT(*) AS n FROM objects').get() as any).n).toBe(2);
    expect((base.prepare('SELECT COUNT(*) AS n FROM fuel_entries').get() as any).n).toBe(3);
    expect(base.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it("vide les tables qu'une sauvegarde complète ne contient pas, sans toucher aux sauvegardes ni au journal des migrations", async () => {
    const source = baseSource();
    source.exec('DROP TABLE tickets');
    await copierTables(sourceSqlite(source));

    expect((base.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n).toBe(0);
    expect(base.prepare('SELECT filename FROM backups').all()).toEqual([{ filename: 'garde-moi.zip' }]);
    expect(base.prepare('SELECT id FROM schema_migrations').all()).toEqual([{ id: '039_cible' }]);
  });

  it('signale les colonnes que le schéma actuel ne connaît plus', async () => {
    const rapport = await copierTables(sourceSqlite(baseSource()));
    expect(rapport.colonnesIgnorees).toEqual(['objects.colonne_disparue']);
  });

  it('compte les liens orphelins au lieu de refuser la restauration', async () => {
    const source = baseSource();
    source.pragma('foreign_keys = OFF');
    source.exec("INSERT INTO fuel_entries (id, object_id, entry_date) VALUES (300, 999, '2026-01-01')");
    const rapport = await copierTables(sourceSqlite(source));
    expect(rapport.liensOrphelins).toBe(1);
  });

  it("annule tout si une ligne est refusée : la base reste celle d'avant", async () => {
    const source = baseSource();
    // Une date manquante viole NOT NULL dans la cible.
    source.exec('DROP TABLE fuel_entries');
    source.exec('CREATE TABLE fuel_entries (id INTEGER PRIMARY KEY, object_id INTEGER, entry_date DATE)');
    source.exec("INSERT INTO fuel_entries (id, object_id, entry_date) VALUES (1, 5, NULL)");

    await expect(copierTables(sourceSqlite(source))).rejects.toThrow(/fuel_entries/);
    expect(base.prepare('SELECT name FROM objects').all()).toEqual([{ name: 'Objet actuel' }]);
    expect(base.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('restaurerArchive — les trois formats', () => {
  it('relit une archive MySQL au format 2 (tables/*.jsonl), dates comprises', async () => {
    const zip = await archive('mysql.zip', {
      'backup-info.json': JSON.stringify({ dbType: 'mysql', format: 2 }),
      'tables/users.jsonl': jsonl([{ id: 8, email: 'm@exemple.fr', role: 'admin', created_at: '2026-03-18 00:00:00' }]),
      'tables/categories.jsonl': jsonl([{ id: 2, name: 'Voirie' }]),
      'tables/objects.jsonl': jsonl([{ id: 77, name: 'Balayeuse', purchase_date: '2026-03-18', category_id: 2 }]),
      'tables/fuel_entries.jsonl': '',
      'tables/tickets.jsonl': jsonl([{ id: 3, titre: 'Fuite' }]),
    });

    const rapport = await restaurerArchive(zip);

    expect(rapport.methode).toBe('tables');
    expect(base.prepare('SELECT id, purchase_date FROM objects').all()).toEqual([{ id: 77, purchase_date: '2026-03-18' }]);
    expect(base.prepare('SELECT created_at FROM users').get()).toEqual({ created_at: '2026-03-18 00:00:00' });
    expect(base.prepare('SELECT titre FROM tickets').all()).toEqual([{ titre: 'Fuite' }]);
  });

  it('prend une sauvegarde de sécurité avant de toucher à la base', async () => {
    const zip = await archive('mysql2.zip', {
      'backup-info.json': JSON.stringify({ dbType: 'mysql', format: 2 }),
      'tables/users.jsonl': '',
    });
    const rapport = await restaurerArchive(zip);

    const securite = base.prepare("SELECT filename, file_path FROM backups WHERE backup_type = 'securite'").get() as any;
    expect(securite.filename).toBe(rapport.sauvegardeDeSecurite);
    expect(fs.existsSync(securite.file_path)).toBe(true);
  });

  it("relit l'ancien database.json sans toucher aux tables qu'il ne contenait pas", async () => {
    const zip = await archive('ancien.zip', {
      'backup-info.json': JSON.stringify({ dbType: 'mysql' }),
      'database.json': JSON.stringify({
        categories: [{ id: 6, name: 'Engins' }],
        objects: [{ id: 9, name: 'Tondeuse', purchase_date: '2026-03-17T23:00:00.000Z', category_id: 6 }],
      }),
    });

    await restaurerArchive(zip);

    expect(base.prepare('SELECT id, name FROM objects').all()).toEqual([{ id: 9, name: 'Tondeuse' }]);
    // L'ancien format n'avait pas les tickets : ils restent.
    expect(base.prepare('SELECT titre FROM tickets').all()).toEqual([{ titre: 'Ticket actuel' }]);
    // La date UTC est ramenée à l'heure locale du serveur, et un minuit à un jour.
    const d = new Date('2026-03-17T23:00:00.000Z');
    const attendu = d.getHours() === 0 ? '2026-03-18' : undefined;
    if (attendu) expect((base.prepare('SELECT purchase_date FROM objects').get() as any).purchase_date).toBe(attendu);
  });

  it('refuse une archive sans base, et ne modifie rien', async () => {
    const zip = await archive('vide.zip', { 'backup-info.json': JSON.stringify({ dbType: 'sqlite' }) });

    await expect(restaurerArchive(zip)).rejects.toBeInstanceOf(ArchiveInvalide);
    expect(base.prepare('SELECT name FROM objects').all()).toEqual([{ name: 'Objet actuel' }]);
    expect((base.prepare("SELECT COUNT(*) AS n FROM backups WHERE backup_type = 'securite'").get() as any).n).toBe(0);
  });
});

describe('elaguerSauvegardes', () => {
  it('garde les plus récentes du type demandé, et seulement celui-là', async () => {
    base.exec(`
      INSERT INTO backups (filename, file_path, backup_type, created_at) VALUES
        ('a1', 'absent-a1', 'auto', '2026-01-01'), ('a2', 'absent-a2', 'auto', '2026-01-02'),
        ('a3', 'absent-a3', 'auto', '2026-01-03'), ('m1', 'absent-m1', 'manual', '2025-01-01');
    `);
    expect(await elaguerSauvegardes('auto', 2)).toBe(1);
    expect(base.prepare('SELECT filename FROM backups ORDER BY filename').all().map((l: any) => l.filename)).toEqual([
      'a2', 'a3', 'garde-moi.zip', 'm1',
    ]);
  });
});

describe('lireTableMySQL — la lecture par pages', () => {
  it('avance par identifiant et rend chaque ligne une fois', async () => {
    const lignes = Array.from({ length: 12_345 }, (_, i) => ({ id: i + 1, nom: `n${i + 1}` }));
    const requetes: string[] = [];
    const connexion = {
      async query(options: any, valeurs?: any[]) {
        if (typeof options === 'string') {
          // Lecture des colonnes dans information_schema.
          return [[{ name: 'id' }, { name: 'nom' }]];
        }
        requetes.push(options.sql);
        const apres = options.values[0] ?? 0;
        return [lignes.filter((l) => l.id > apres).slice(0, 5_000)];
        void valeurs;
      },
    };

    const comptes: Record<string, number> = { t: 0 };
    let texte = '';
    for await (const morceau of lireTableMySQL(connexion as any, 't', comptes)) texte += morceau;

    expect(comptes.t).toBe(12_345);
    expect(texte.trim().split('\n')).toHaveLength(12_345);
    expect(requetes).toHaveLength(3);
    expect(requetes[1]).toMatch(/WHERE id > \?/);
  });
});
