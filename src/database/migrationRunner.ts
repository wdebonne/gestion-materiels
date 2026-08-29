import fs from 'fs';
import path from 'path';
import { MIGRATIONS } from './migrations';
import type { ContexteMigration, Dialecte, Migration } from './migrations/types';

/**
 * Ce dont le lanceur a besoin, sans importer le gestionnaire de base : ce
 * fichier est appelé depuis `database/index.ts`, un import direct créerait un
 * cycle.
 */
export interface BaseMigration {
  execute(sql: string, params?: any[]): Promise<{ lastInsertRowid: number; changes: number }>;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  getType(): Dialecte;
}

export interface OptionsMigration {
  /** Chemin du fichier SQLite, pour la sauvegarde préalable. */
  cheminSqlite?: string;
  /** Migrations à appliquer. Surchargé par les tests. */
  migrations?: readonly Migration[];
  journaliser?: (message: string) => void;
}

export interface ResultatMigration {
  appliquees: string[];
  dejaAppliquees: number;
  sauvegarde: string | null;
}

function contexte(base: BaseMigration): ContexteMigration {
  const dialecte = base.getType();
  const sqlite = dialecte === 'sqlite';

  return {
    executer: (sql, params) => base.execute(sql, params ?? []),
    interroger: (sql, params) => base.query(sql, params ?? []),
    dialecte,
    autoIncrement: sqlite ? 'AUTOINCREMENT' : 'AUTO_INCREMENT',
    texteLong: sqlite ? 'TEXT' : 'LONGTEXT',
    booleen: sqlite ? 'INTEGER' : 'TINYINT(1)',
    horodatageParDefaut: sqlite ? "DEFAULT (datetime('now'))" : 'DEFAULT CURRENT_TIMESTAMP',
  };
}

/**
 * Copie la base SQLite avant d'y toucher.
 *
 * `VACUUM INTO` produit une copie cohérente en incluant le journal WAL, ce
 * qu'une simple copie de fichier ne garantit pas : le `.sqlite` seul peut être
 * en retard de plusieurs écritures.
 *
 * Sur MySQL, aucune sauvegarde n'est prise ici — elle relève de l'exploitation
 * du serveur. Le message le dit plutôt que de le laisser croire.
 */
async function sauvegarder(
  base: BaseMigration,
  cheminSqlite: string | undefined,
  journaliser: (m: string) => void
): Promise<string | null> {
  if (base.getType() !== 'sqlite') {
    journaliser('⚠️  MySQL : aucune sauvegarde automatique, pensez à la faire avant de migrer');
    return null;
  }
  if (!cheminSqlite) return null;

  const dossier = path.join(path.dirname(cheminSqlite), 'backups');
  fs.mkdirSync(dossier, { recursive: true });

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(dossier, `avant-migration-${horodatage}.sqlite`);

  await base.execute(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  journaliser(`💾 Sauvegarde : ${destination}`);
  return destination;
}

/**
 * Applique les migrations non encore jouées.
 *
 * `npm run db:migrate` pointait vers un fichier qui n'existait pas : toute
 * évolution de schéma se faisait en ajoutant une ligne au tableau tenu à la
 * main de `runMigrations()`, sans version ni ordre, et sans trace de ce qui
 * avait déjà été appliqué.
 *
 * Chaque migration est enregistrée dès qu'elle réussit. En cas d'échec, celles
 * qui ont abouti restent marquées et la suite est laissée en attente : la
 * relance reprend là où elle s'est arrêtée. Il n'y a pas de transaction
 * englobante, car MySQL valide implicitement chaque DDL — c'est pourquoi une
 * migration doit rester rejouable (`IF NOT EXISTS`) et ne jamais détruire.
 */
export async function appliquerMigrations(
  base: BaseMigration,
  options: OptionsMigration = {}
): Promise<ResultatMigration> {
  const journaliser = options.journaliser ?? (() => {});
  const migrations = options.migrations ?? MIGRATIONS;

  await base.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) PRIMARY KEY,
      applied_at DATETIME
    )
  `);

  const deja = new Set(
    (await base.query<{ id: string }>('SELECT id FROM schema_migrations')).map((l) => l.id)
  );
  const enAttente = migrations.filter((m) => !deja.has(m.id));

  if (enAttente.length === 0) {
    return { appliquees: [], dejaAppliquees: deja.size, sauvegarde: null };
  }

  journaliser(`${enAttente.length} migration(s) à appliquer`);
  const sauvegarde = await sauvegarder(base, options.cheminSqlite, journaliser);

  const ctx = contexte(base);
  const appliquees: string[] = [];

  for (const migration of enAttente) {
    try {
      await migration.up(ctx);
      await base.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        migration.id,
        new Date().toISOString(),
      ]);
      appliquees.push(migration.id);
      journaliser(`✅ ${migration.id} — ${migration.description}`);
    } catch (erreur: any) {
      journaliser(`❌ ${migration.id} — ${erreur.message}`);
      throw new Error(
        `Migration ${migration.id} interrompue : ${erreur.message}` +
          (sauvegarde ? `\nSauvegarde disponible : ${sauvegarde}` : '')
      );
    }
  }

  return { appliquees, dejaAppliquees: deja.size, sauvegarde };
}

/** Migrations restant à appliquer, sans rien modifier. */
export async function migrationsEnAttente(
  base: BaseMigration,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<string[]> {
  const tables = await base.query(
    base.getType() === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      : "SHOW TABLES LIKE 'schema_migrations'"
  );
  if (tables.length === 0) return migrations.map((m) => m.id);

  const deja = new Set(
    (await base.query<{ id: string }>('SELECT id FROM schema_migrations')).map((l) => l.id)
  );
  return migrations.filter((m) => !deja.has(m.id)).map((m) => m.id);
}
