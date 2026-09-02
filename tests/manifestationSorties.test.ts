import type BetterSqlite3 from 'better-sqlite3';
import type { AuthRequest } from '../src/middleware/auth.middleware';

/**
 * Sorties : ce qui est dehors, et ce qui part.
 *
 * La disponibilité dit combien il reste ; elle ne dit pas chez qui est le reste. Ces tests
 * vérifient l'autre moitié de la question — une ligne par article **et par manifestation**, les
 * deux tables du prêt réunies, et un état qui distingue ce qui est parti de ce qui partira.
 *
 * Sur une vraie base SQLite, parce que la fenêtre d'immobilisation est écrite en SQL.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseSorties = sqlite;

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

import { sorties, type LigneSortie } from '../src/services/manifestationSorties.service';

const base: BetterSqlite3.Database = (global as any).__baseSorties;

/** Un administrateur : aucune restriction de portée, ce qui isole ce que ce module décide. */
const admin = { user: { userId: 1, email: 'admin@test', role: 'admin' } } as unknown as AuthRequest;

const lire = async (
  debut: string,
  fin: string,
  filtres = {}
): Promise<LigneSortie[]> => {
  const lignes = await sorties(admin, debut, fin, filtres);
  expect(lignes).not.toBeNull();
  return lignes!;
};

const ligne = (lignes: LigneSortie[], nom: string, manifestation: string) =>
  lignes.find((l) => l.name === nom && l.manifestation === manifestation);

beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      is_prestation INTEGER,
      available_for_manifestations INTEGER
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_prestation INTEGER,
      available_for_manifestations INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      category_id INTEGER,
      subcategory_id INTEGER,
      status VARCHAR(50) DEFAULT 'active',
      available_for_manifestations INTEGER,
      is_prestation INTEGER,
      material_type VARCHAR(20) DEFAULT 'unique',
      quantity_total INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT '',
      category_id INTEGER,
      subcategory_id INTEGER,
      quantity_total INTEGER NOT NULL DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'unité',
      is_prestation INTEGER DEFAULT 0
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title VARCHAR(255) NOT NULL,
      date_start DATE NOT NULL,
      date_end DATE,
      delivery_date DATE,
      recovery_date DATE,
      status VARCHAR(20) NOT NULL
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifestation_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity_requested INTEGER DEFAULT 0,
      quantity_delivered INTEGER DEFAULT 0,
      quantity_recovered INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifestation_id INTEGER NOT NULL,
      object_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0
    );
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

    INSERT INTO categories (id, name) VALUES (1, 'Technique'), (2, 'Mobilier'), (3, 'Véhicules');
    INSERT INTO subcategories (id, category_id, name, is_prestation) VALUES (10, 1, 'Prestations', 1);

    INSERT INTO services (id, name, slug, is_active) VALUES
      (1, 'Service Technique', 'technique', 1),
      (2, 'Service Véhicules', 'vehicules', 1);
    INSERT INTO service_categories (service_id, category_id) VALUES (1, 1), (2, 3);

    INSERT INTO objects (id, name, category_id, subcategory_id, material_type, quantity_total) VALUES
      (1, 'Raccordement électrique', NULL, 10,   'unique', 0),
      (2, 'Nacelle',                 1,    NULL, 'unique', 1);

    INSERT INTO manifestation_stock (id, name, category, category_id, quantity_total, is_prestation) VALUES
      (1, 'Chaise pliante', 'Mobilier', 2, 200, 0);

    -- Livrée et pas encore récupérée : c'est ce qu'on ira chercher.
    INSERT INTO manifestations (id, title, date_start, date_end, delivery_date, recovery_date, status) VALUES
      (1, 'Brocante du centre', '2026-06-20', '2026-06-21', '2026-06-19', '2026-06-22', 'delivered'),
      -- Confirmée, plus tard : elle partira, elle n'est pas partie.
      (2, 'Fête de la musique', '2026-06-25', '2026-06-25', NULL, NULL, 'validated'),
      -- Une demande non confirmée : elle pèse sur la disponibilité, pas sur le camion.
      (3, 'Vide-grenier',       '2026-06-20', '2026-06-20', NULL, NULL, 'pending'),
      -- Archivée : elle est derrière nous.
      (4, 'Carnaval',           '2026-06-20', '2026-06-20', NULL, NULL, 'archived');

    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested, quantity_delivered, quantity_recovered) VALUES
      (1, 1, 120, 120, 20),
      (2, 1, 50,  0,   0),
      (3, 1, 30,  0,   0),
      (4, 1, 10,  10,  10);

    INSERT INTO manifestation_items (manifestation_id, object_id, quantity, quantity_delivered, quantity_returned) VALUES
      (1, 2, 1, 1, 1),
      (1, 1, 1, 0, 0),
      (2, 2, 1, 0, 0);
  `);
});

describe('sorties', () => {
  it('rend une ligne par article et par manifestation, les deux sources réunies', async () => {
    const lignes = await lire('2026-06-20', '2026-06-20');
    expect(lignes.map((l) => `${l.ref} ${l.manifestation}`)).toEqual([
      'stock:1 Brocante du centre',
      'parc:1 Brocante du centre',
      'parc:2 Brocante du centre',
    ]);
  });

  it('compte ce qui reste dehors, sorti moins rendu', async () => {
    const lignes = await lire('2026-06-20', '2026-06-20');
    const chaises = ligne(lignes, 'Chaise pliante', 'Brocante du centre')!;
    expect(chaises).toMatchObject({
      quantite_demandee: 120,
      quantite_sortie: 120,
      quantite_rendue: 20,
      quantite_dehors: 100,
      etat: 'dehors',
    });
  });

  it('distingue ce qui est revenu de ce qui n’est jamais parti', async () => {
    const lignes = await lire('2026-06-20', '2026-06-20');
    // Sortie puis rentrée sur une manifestation encore ouverte : plus rien à aller chercher.
    expect(ligne(lignes, 'Nacelle', 'Brocante du centre')!.etat).toBe('rendu');
    // Une prestation ne se rend pas : elle est réalisée.
    expect(ligne(lignes, 'Raccordement électrique', 'Brocante du centre')).toMatchObject({
      is_prestation: true,
      etat: 'dehors',
    });
  });

  it('annonce ce qui partira sur une période à venir', async () => {
    const lignes = await lire('2026-06-25', '2026-06-25');
    expect(lignes.map((l) => `${l.name} ${l.etat}`)).toEqual([
      'Chaise pliante prevue',
      'Nacelle prevue',
    ]);
  });

  it('ignore ce qui n’est ni confirmé ni livré', async () => {
    const lignes = await lire('2026-06-20', '2026-06-20');
    expect(lignes.map((l) => l.manifestation)).not.toContain('Vide-grenier');
    expect(lignes.map((l) => l.manifestation)).not.toContain('Carnaval');
  });

  it('suit la fenêtre d’immobilisation, livraison et récupération comprises', async () => {
    // La brocante commence le 20 mais son matériel part le 19 et revient le 22.
    expect((await lire('2026-06-19', '2026-06-19')).length).toBe(3);
    expect((await lire('2026-06-22', '2026-06-22')).length).toBe(3);
    expect(await lire('2026-06-23', '2026-06-24')).toEqual([]);
  });

  it('rattache chaque ligne au service qui la porte', async () => {
    const lignes = await lire('2026-06-20', '2026-06-20');
    expect(ligne(lignes, 'Nacelle', 'Brocante du centre')!.services).toEqual([
      { id: 1, name: 'Service Technique', slug: 'technique' },
    ]);
    // Le mobilier n'est le périmètre d'aucun service : personne ne l'a pris en charge.
    expect(ligne(lignes, 'Chaise pliante', 'Brocante du centre')!.services).toEqual([]);
  });

  it('filtre par service, par nature et par recherche libre', async () => {
    const technique = await lire('2026-06-20', '2026-06-20', { service: 'technique' });
    expect(technique.map((l) => l.name)).toEqual(['Raccordement électrique', 'Nacelle']);

    // Le service Véhicules ne prête rien sur la période : la liste est vide, pas partielle.
    expect(await lire('2026-06-20', '2026-06-20', { service: 'vehicules' })).toEqual([]);

    const prestations = await lire('2026-06-20', '2026-06-20', { kind: 'prestation' });
    expect(prestations.map((l) => l.name)).toEqual(['Raccordement électrique']);

    // La recherche porte aussi sur la manifestation : « où est le matériel de la brocante ? ».
    expect((await lire('2026-06-20', '2026-06-20', { search: 'brocante' })).length).toBe(3);
    expect((await lire('2026-06-20', '2026-06-20', { search: 'chaise' })).map((l) => l.name)).toEqual([
      'Chaise pliante',
    ]);
  });

  it('met en tête ce qui est dehors, puis ce qui part', async () => {
    const lignes = await lire('2026-06-19', '2026-06-30');
    expect(lignes.map((l) => l.etat)).toEqual([
      'dehors',
      'dehors',
      'prevue',
      'prevue',
      'rendu',
    ]);
  });
});
