import { MIGRATIONS } from '../src/database/migrations';
import { appliquerMigrations, type BaseMigration } from '../src/database/migrationRunner';

/**
 * Les migrations livrées, passées au crible du dialecte MySQL.
 *
 * `migrations.test.ts` les applique sur une vraie base SQLite — ce qui vérifie
 * le journal, l'ordre et l'effet réel, mais laisse un angle mort entier : sa
 * fausse base répond `getType: () => 'sqlite'`, si bien qu'aucune migration
 * n'avait jamais emprunté sa branche MySQL.
 *
 * La migration 021 y est tombée. Elle écrivait
 * `CREATE INDEX IF NOT EXISTS`, que SQLite accepte et que MySQL refuse : le
 * serveur de production, où la base est MySQL, s'arrêtait au démarrage en
 * boucle. Rien dans la suite ne pouvait le dire, et le défaut n'est apparu
 * qu'au déploiement.
 *
 * Ces tests ne peuvent pas exécuter du SQL MySQL sans serveur MySQL. Ils font
 * autre chose, et qui suffit : ils font tourner chaque migration contre un
 * contexte qui se déclare MySQL, recueillent le SQL qu'elle produit vraiment —
 * branches comprises — et refusent ce que MySQL ne comprend pas.
 */

/** Une base qui se dit MySQL et note tout ce qu'on lui demande. */
function baseQuiEnregistre(): BaseMigration & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    getType: () => 'mysql',
    async execute(requete: string) {
      sql.push(requete);
      return { lastInsertRowid: 0, changes: 0 };
    },
    async query<T = any>(requete: string) {
      sql.push(requete);
      // Rien en base : une migration doit alors tout créer, donc emprunter le
      // chemin le plus long — celui qu'on veut inspecter.
      return [] as T[];
    },
  };
}

/**
 * Ce que SQLite accepte et MySQL refuse.
 *
 * Chacune de ces formes a sa contrepartie portable : `ctx.creerIndex` pour
 * l'index, `ctx.autoIncrement` pour la clé, une lecture préalable pour
 * l'insertion conditionnelle, `ctx.interroger` sur `information_schema` pour
 * l'inspection du schéma.
 */
const FORMES_SQLITE_SEULEMENT: Array<{ motif: RegExp; libelle: string; alternative: string }> = [
  {
    motif: /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i,
    libelle: 'CREATE INDEX IF NOT EXISTS',
    alternative: 'ctx.creerIndex(nom, table, colonnes)',
  },
  {
    motif: /INSERT\s+OR\s+(IGNORE|REPLACE)/i,
    libelle: 'INSERT OR IGNORE / OR REPLACE',
    alternative: 'une lecture préalable, ou INSERT ... SELECT ... WHERE NOT EXISTS',
  },
  {
    motif: /\bAUTOINCREMENT\b/i,
    libelle: 'AUTOINCREMENT',
    alternative: 'ctx.autoIncrement',
  },
  {
    motif: /\bPRAGMA\b/i,
    libelle: 'PRAGMA',
    alternative: "ctx.interroger sur information_schema, sous condition de dialecte",
  },
  {
    motif: /\bsqlite_master\b/i,
    libelle: 'sqlite_master',
    alternative: "information_schema.TABLES, sous condition de dialecte",
  },
  {
    motif: /\bdatetime\s*\(\s*'now'\s*\)/i,
    libelle: "datetime('now')",
    alternative: 'ctx.horodatageParDefaut',
  },
];

describe('Migrations livrées — dialecte MySQL', () => {
  let sqlProduit: string[];

  beforeAll(async () => {
    const base = baseQuiEnregistre();
    await appliquerMigrations(base, { migrations: MIGRATIONS, journaliser: () => {} });
    sqlProduit = base.sql;
  });

  it('produit bien du SQL — le banc d’essai n’est pas à vide', () => {
    expect(sqlProduit.length).toBeGreaterThan(20);
    expect(sqlProduit.join(' ')).toMatch(/CREATE TABLE/i);
  });

  it.each(FORMES_SQLITE_SEULEMENT)(
    'n’emploie jamais $libelle',
    ({ motif, libelle, alternative }) => {
      const fautives = sqlProduit.filter((requete) => motif.test(requete));
      const detail = fautives.map((r) => `  → ${r.trim().slice(0, 120)}`).join('\n');
      expect(
        fautives.length === 0 ||
          `${libelle} n'existe pas en MySQL. Employer plutôt ${alternative}.\n${detail}`
      ).toBe(true);
    }
  );

  it('crée ses index par le contexte, jamais en clair', () => {
    // La contrepartie MySQL de `creerIndex` regarde `information_schema` avant
    // de créer : sa présence dit que le chemin portable a bien été emprunté.
    const index = sqlProduit.filter((r) => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(r));
    if (index.length > 0) {
      expect(sqlProduit.join(' ')).toMatch(/information_schema\.STATISTICS/i);
    }
    for (const requete of index) {
      expect(requete).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});

/**
 * Le même filet, mais posé sur le texte des migrations : il attrape une forme
 * écrite dans une branche que le banc d'essai n'aurait pas empruntée.
 */
describe('Migrations livrées — le texte ne porte pas de SQL propre à SQLite', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dossier = path.join(__dirname, '..', 'src', 'database', 'migrations');

  const fichiers = fs
    .readdirSync(dossier)
    .filter((f) => /^\d{3}_.*\.ts$/.test(f))
    .map((f) => [f, fs.readFileSync(path.join(dossier, f), 'utf8')] as const);

  it('trouve bien les migrations sur le disque', () => {
    expect(fichiers.length).toBeGreaterThan(5);
  });

  it.each([
    ['CREATE INDEX IF NOT EXISTS', /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i],
    ['INSERT OR IGNORE', /INSERT\s+OR\s+(IGNORE|REPLACE)/i],
  ])('aucune migration n’écrit %s en clair', (_libelle, motif) => {
    const fautives = fichiers
      .filter(([, contenu]) => {
        const lignes = contenu
          .split(/\r?\n/)
          // Un commentaire qui nomme la forme pour dire de ne pas l’employer
          // n'est pas une faute — c'est le contraire.
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .filter((l) => motif.test(l));

        // La forme reste tolérée dans une branche explicitement SQLite.
        return lignes.length > 0 && !/dialecte === 'sqlite'/.test(contenu);
      })
      .map(([nom]) => nom);

    expect(fautives).toEqual([]);
  });
});
