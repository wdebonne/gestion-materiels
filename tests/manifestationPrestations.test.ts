import type BetterSqlite3 from 'better-sqlite3';

/**
 * Prestations demandées : raccordement au réseau, débit de boissons, personnel.
 *
 * Une demande de manifestation ne porte pas que du matériel. Ces prestations
 * n'existaient nulle part et finissaient dans une note libre que rien ne route
 * ni ne totalise.
 *
 * Une prestation est un article du stock coché comme tel : elle réutilise ainsi
 * tout le routage d'approbation, qui part déjà de la catégorie de l'article.
 * Mais elle **n'a pas de stock** — et c'est ce que ces tests protègent : lui
 * calculer une disponibilité la ferait paraître en rupture en permanence, son
 * total valant zéro, et chaque manifestation afficherait un manque imaginaire.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__basePresta = sqlite;

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
  detecterConflits,
  enrichirStock,
  estPrestation,
} from '../src/services/manifestationStock.service';
import { servicesConcernes } from '../src/services/manifestationServices.service';

const base: BetterSqlite3.Database = (global as any).__basePresta;

// Catégories : 1 = Festif, 2 = Technique, 3 = Urbanisme.
// Articles   : 1 = Chaise (matériel), 2 = Raccordement électrique (prestation),
//              3 = Débit de boissons (prestation).
beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE services (
      id INTEGER PRIMARY KEY, name VARCHAR(255), is_active INTEGER DEFAULT 1,
      is_observer INTEGER DEFAULT 0, is_coordinator INTEGER DEFAULT 0
    );
    CREATE TABLE service_categories (id INTEGER PRIMARY KEY, service_id INTEGER, category_id INTEGER);
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY, name VARCHAR(255), quantity_total INTEGER DEFAULT 0,
      category_id INTEGER, subcategory_id INTEGER, is_prestation INTEGER DEFAULT 0,
      updated_at DATETIME
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20),
      date_start DATE, date_end DATE, delivery_date DATE, recovery_date DATE
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, stock_id INTEGER,
      quantity_requested INTEGER DEFAULT 0, quantity_delivered INTEGER DEFAULT 0,
      quantity_recovered INTEGER DEFAULT 0
    );
  `);

  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Festif'), (2, 'Technique'), (3, 'Urbanisme');

    INSERT INTO services (id, name) VALUES
      (1, 'Service festif'), (2, 'Service technique'), (3, 'Service urbanisme');
    INSERT INTO service_categories (service_id, category_id) VALUES (1, 1), (2, 2), (3, 3);

    INSERT INTO manifestation_stock (id, name, quantity_total, category_id, is_prestation) VALUES
      (1, 'Chaise', 100, 1, 0),
      (2, 'Raccordement électrique', 0, 2, 1),
      (3, 'Débit de boissons', 0, 3, 1);

    INSERT INTO manifestations (id, title, status, date_start) VALUES
      (100, 'Brocante', 'validated', '2026-07-14');
  `);
});

beforeEach(() => base.exec('DELETE FROM manifestation_materials'));

const demander = (stockId: number, quantite: number) =>
  base
    .prepare(
      'INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (100, ?, ?)'
    )
    .run(stockId, quantite);

describe('Reconnaissance', () => {
  it('lit le drapeau sous ses différentes formes', () => {
    expect(estPrestation({ is_prestation: 1 })).toBe(true);
    expect(estPrestation({ is_prestation: true })).toBe(true);
    expect(estPrestation({ is_prestation: 0 })).toBe(false);
    expect(estPrestation({ is_prestation: null })).toBe(false);
    expect(estPrestation({})).toBe(false);
  });
});

describe('Une prestation n’a pas de stock', () => {
  it('ne se voit calculer aucune disponibilité', async () => {
    // Son total vaut zéro : lui calculer un « disponible » la ferait paraître
    // en rupture en permanence.
    const articles = base.prepare('SELECT * FROM manifestation_stock').all();
    const enrichis = await enrichirStock(articles);

    const chaise = enrichis.find((a: any) => a.id === 1);
    const raccordement = enrichis.find((a: any) => a.id === 2);

    expect(chaise.quantity_available).toBe(100);
    expect(raccordement.quantity_available).toBeNull();
    expect(raccordement.quantity_lent).toBeNull();
    expect(raccordement.quantity_reserved_future).toBeNull();
  });

  it('ne se voit pas calculer de prévisionnel sur une période', async () => {
    const articles = base.prepare('SELECT * FROM manifestation_stock WHERE id = 2').all();
    const [raccordement] = await enrichirStock(articles, { debut: '2026-07-14', fin: '2026-07-14' });

    expect(raccordement.disponible_previsionnel).toBeUndefined();
    expect(raccordement.engage_reel).toBeUndefined();
  });

  it('ne manque jamais, quelle que soit la quantité demandée', async () => {
    // Sans cette garde, chaque manifestation demandant un raccordement
    // afficherait un manque imaginaire.
    const conflits = await detecterConflits(
      [{ stock_id: 2, quantity_requested: 1 }, { stock_id: 3, quantity_requested: 5 }],
      '2026-07-14',
      '2026-07-14'
    );
    expect(conflits).toEqual([]);
  });

  it('laisse le matériel signaler son manque normalement', async () => {
    demander(1, 90);

    const conflits = await detecterConflits(
      [{ stock_id: 1, quantity_requested: 30 }],
      '2026-07-14',
      '2026-07-14'
    );
    expect(conflits).toHaveLength(1);
    expect(conflits[0]).toMatchObject({ stock_name: 'Chaise', manquant: 20 });
  });

  it('n’empêche pas le matériel de la même demande d’être vérifié', async () => {
    demander(1, 90);

    const conflits = await detecterConflits(
      [
        { stock_id: 2, quantity_requested: 1 },
        { stock_id: 1, quantity_requested: 30 },
      ],
      '2026-07-14',
      '2026-07-14'
    );
    expect(conflits.map((c) => c.stock_name)).toEqual(['Chaise']);
  });
});

describe('Une prestation sollicite le service de sa catégorie', () => {
  it('route un raccordement vers le service technique', async () => {
    // C'est tout l'intérêt d'en faire un article : le routage existant s'applique
    // sans une ligne de code de plus.
    demander(2, 1);
    expect((await servicesConcernes(100)).map((s: any) => s.name)).toEqual(['Service technique']);
  });

  it('route un débit de boissons vers l’urbanisme', async () => {
    demander(3, 1);
    expect((await servicesConcernes(100)).map((s: any) => s.name)).toEqual(['Service urbanisme']);
  });

  it('cumule les services quand la demande mêle matériel et prestations', async () => {
    demander(1, 50);
    demander(2, 1);
    demander(3, 1);

    expect((await servicesConcernes(100)).map((s: any) => s.name).sort()).toEqual([
      'Service festif',
      'Service technique',
      'Service urbanisme',
    ]);
  });

  it('ne sollicite personne pour une prestation à quantité nulle', async () => {
    // Une ligne laissée à zéro n'est pas une demande.
    demander(2, 0);
    expect(await servicesConcernes(100)).toEqual([]);
  });
});
