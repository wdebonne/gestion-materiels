import type BetterSqlite3 from 'better-sqlite3';

/**
 * Périmètre d'un service, vu depuis le catalogue.
 *
 * Un formulaire de demande veut proposer « les prestations de l'urbanisme », pas tout le stock.
 * Le rattachement suit la même règle que la sollicitation des services : la catégorie de
 * l'article, ou la catégorie de sa sous-catégorie. Les deux colonnes coexistent et l'une peut être
 * nulle — c'est précisément là que la règle se trompe si on l'écrit deux fois.
 *
 * Le test tourne sur une vraie base SQLite : la condition rendue est du SQL, et seule son
 * exécution dit si elle filtre ce qu'elle prétend filtrer.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__basePerimetre = sqlite;

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

import { conditionPerimetreService } from '../src/services/manifestationServices.service';

const base: BetterSqlite3.Database = (global as any).__basePerimetre;

beforeAll(() => {
  base.exec(`
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE service_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      category_id INTEGER,
      subcategory_id INTEGER,
      is_prestation INTEGER DEFAULT 0
    );

    INSERT INTO categories (id, name) VALUES (1, 'Urbanisme'), (2, 'Technique'), (3, 'Mobilier');
    INSERT INTO subcategories (id, category_id, name) VALUES (10, 1, 'Signalisation'), (20, 2, 'Levage');

    INSERT INTO services (id, name, slug, is_active) VALUES
      (1, 'Urbanisme', 'urbanisme', 1),
      (2, 'Services techniques', 'technique', 1),
      (3, 'Ancien service', 'ancien', 0);
    INSERT INTO service_categories (service_id, category_id) VALUES (1, 1), (2, 2), (3, 3);

    INSERT INTO manifestation_stock (id, name, category_id, subcategory_id, is_prestation) VALUES
      (1, 'Arrêté de voirie',      1,    NULL, 1),
      (2, 'Panneau de déviation',  NULL, 10,   0),
      (3, 'Montage de podium',     2,    NULL, 1),
      (4, 'Nacelle',               NULL, 20,   0),
      (5, 'Table brasserie',       3,    NULL, 0),
      (6, 'Article orphelin',      NULL, NULL, 0);
  `);
});

/** Ce que le catalogue rendrait pour ce service — l'ordre est celui de la route. */
function articlesDuService(service: string | number, kind?: 'prestation' | 'materiel'): string[] {
  const perimetre = conditionPerimetreService(service, 'ms');
  let sql = `SELECT ms.name FROM manifestation_stock ms WHERE 1=1${perimetre.sql}`;
  if (kind === 'prestation') sql += ' AND ms.is_prestation = 1';
  else if (kind === 'materiel') sql += ' AND (ms.is_prestation IS NULL OR ms.is_prestation = 0)';
  sql += ' ORDER BY ms.name';
  return base
    .prepare(sql)
    .all(...perimetre.params)
    .map((ligne: any) => ligne.name);
}

describe('périmètre de service', () => {
  it('retient les articles rattachés directement à une catégorie du service', () => {
    expect(articlesDuService('urbanisme')).toContain('Arrêté de voirie');
  });

  it('retient aussi ceux rattachés par leur sous-catégorie', () => {
    // « Panneau de déviation » n'a pas de category_id : seule sa sous-catégorie le rattache à
    // l'urbanisme. C'est la moitié de la règle qu'on oublie en la réécrivant.
    expect(articlesDuService('urbanisme')).toEqual(['Arrêté de voirie', 'Panneau de déviation']);
  });

  it('écarte ce qui relève d\u2019un autre service', () => {
    expect(articlesDuService('technique')).toEqual(['Montage de podium', 'Nacelle']);
  });

  it('écarte l\u2019article rattaché à rien', () => {
    const tous = [...articlesDuService('urbanisme'), ...articlesDuService('technique'), ...articlesDuService('ancien')];
    expect(tous).not.toContain('Article orphelin');
  });

  it('ignore un service désactivé plutôt que de rendre son matériel', () => {
    expect(articlesDuService('ancien')).toEqual([]);
  });

  it('accepte un identifiant, un slug ou un nom', () => {
    expect(articlesDuService(1)).toEqual(articlesDuService('urbanisme'));
    expect(articlesDuService('Urbanisme')).toEqual(articlesDuService('urbanisme'));
  });

  it('ne filtre rien si aucun service n\u2019est demandé', () => {
    expect(conditionPerimetreService('')).toEqual({ sql: '', params: [] });
    expect(articlesDuService('')).toHaveLength(6);
  });

  it('se combine avec la nature de l\u2019article', () => {
    expect(articlesDuService('technique', 'prestation')).toEqual(['Montage de podium']);
    expect(articlesDuService('technique', 'materiel')).toEqual(['Nacelle']);
  });

  it('ne rend rien pour un service inconnu, plutôt que tout le stock', () => {
    expect(articlesDuService('service-qui-nexiste-pas')).toEqual([]);
  });
});
