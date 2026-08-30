import type BetterSqlite3 from 'better-sqlite3';

/**
 * Ce qu'une manifestation coûte réellement.
 *
 * Deux natures de coût, qu'il ne faut jamais additionner sans les distinguer :
 * ce qu'on **déploie** — trois agents, un raccordement — et ce qui ne **revient
 * pas** — dix chaises prêtées, neuf rendues. On ne négocie pas une casse comme
 * on budgète une vacation.
 *
 * Le piège que ces essais gardent : **une chaise sortie n'est pas une chaise
 * perdue**. Compter la différence entre livré et rendu dès la livraison
 * afficherait 1 500 € de casse le jour où l'on sort trente chaises. Le manque ne
 * devient une perte qu'une fois la manifestation récupérée.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCout = sqlite;

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

import { coutDe } from '../src/services/coutManifestation.service';

const base: BetterSqlite3.Database = (global as any).__baseCout;

/** Identifiants de matériel, pour que les essais se lisent. */
const CHAISE = 1; // lot, 50 € l'unité
const AGENT = 2; // prestation, 120 € la vacation
const CAMION = 3; // exemplaire, 30 000 €
const TABLE = 4; // lot sans prix saisi

beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255), is_prestation INTEGER DEFAULT 0);
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255), is_prestation INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), category_id INTEGER, subcategory_id INTEGER,
      is_prestation INTEGER, material_type VARCHAR(20) DEFAULT 'unique',
      quantity_total INTEGER DEFAULT 0, unit_cost REAL DEFAULT 0
    );
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20));
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, object_id INTEGER,
      quantity INTEGER DEFAULT 1, quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0, return_state VARCHAR(20), notes TEXT
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY, name VARCHAR(255), price REAL DEFAULT 0
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, stock_id INTEGER,
      quantity_requested INTEGER DEFAULT 0, quantity_lost INTEGER DEFAULT 0,
      loss_reason TEXT, unit_value REAL DEFAULT 0
    );
  `);

  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Mobilier'), (2, 'Personnel');
    INSERT INTO subcategories (id, category_id, name, is_prestation) VALUES (20, 2, 'Prestation', 1);

    INSERT INTO objects (id, name, category_id, subcategory_id, material_type, quantity_total, unit_cost) VALUES
      (${CHAISE}, 'Chaise pliante', 1, NULL, 'lot', 50, 50),
      (${AGENT}, 'Agent de service', NULL, 20, 'unique', 0, 120),
      (${CAMION}, 'Camion benne', 1, NULL, 'unique', 0, 30000),
      (${TABLE}, 'Table sans prix', 1, NULL, 'lot', 20, 0);

    INSERT INTO manifestation_stock (id, name, price) VALUES (1, 'Barnum', 800);

    INSERT INTO manifestations (id, title, status) VALUES
      (100, 'En cours de livraison', 'delivered'),
      (200, 'Récupérée', 'recovered'),
      (300, 'Annulée', 'cancelled'),
      (400, 'Archivée', 'archived'),
      (500, 'À confirmer', 'pending');
  `);
});

afterEach(() => {
  base.exec('DELETE FROM manifestation_items; DELETE FROM manifestation_materials;');
});

const demander = (
  manifestationId: number,
  objectId: number,
  champs: Partial<{ quantity: number; delivered: number; returned: number; etat: string }> = {}
) =>
  base
    .prepare(
      `INSERT INTO manifestation_items
         (manifestation_id, object_id, quantity, quantity_delivered, quantity_returned, return_state)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      manifestationId,
      objectId,
      champs.quantity ?? 1,
      champs.delivered ?? 0,
      champs.returned ?? 0,
      champs.etat ?? null
    );

describe('Ce qu’on déploie', () => {
  it('chiffre une prestation dès qu’elle est demandée', async () => {
    demander(500, AGENT, { quantity: 3 });

    const cout = await coutDe(500);
    expect(cout.total_prestations).toBe(360);
    expect(cout.prestations[0]).toMatchObject({
      libelle: 'Agent de service',
      quantite: 3,
      cout_unitaire: 120,
      total: 360,
    });
  });

  it('dit sur quoi le montant repose', async () => {
    demander(500, AGENT, { quantity: 3 });
    expect((await coutDe(500)).prestations[0].motif).toBe('3 × 120 €');
  });

  it('ignore une prestation sans prix saisi', async () => {
    // Mieux vaut ne rien afficher qu'un zéro qui passerait pour un tarif.
    base.prepare('UPDATE objects SET unit_cost = 0 WHERE id = ?').run(AGENT);
    demander(500, AGENT, { quantity: 3 });

    expect((await coutDe(500)).prestations).toEqual([]);

    base.prepare('UPDATE objects SET unit_cost = 120 WHERE id = ?').run(AGENT);
  });
});

describe('Ce qui ne revient pas', () => {
  it('ne compte rien tant que la manifestation n’est pas récupérée', async () => {
    // C'est le piège : trente chaises sorties ne sont pas trente chaises
    // perdues, et afficher 1 500 € le jour de la livraison serait absurde.
    demander(100, CHAISE, { quantity: 30, delivered: 30, returned: 0 });

    const cout = await coutDe(100);
    expect(cout.total_pertes).toBe(0);
    expect(cout.definitif).toBe(false);
    expect(cout.en_attente_de_retour).toHaveLength(1);
    expect(cout.en_attente_de_retour[0].quantite).toBe(30);
  });

  it('chiffre le manque une fois la manifestation récupérée', async () => {
    // Le cas décrit : dix chaises prêtées, neuf revenues, une cassée à 50 €.
    demander(200, CHAISE, { quantity: 10, delivered: 10, returned: 9 });

    const cout = await coutDe(200);
    expect(cout.total_pertes).toBe(50);
    expect(cout.definitif).toBe(true);
    expect(cout.pertes[0].motif).toBe('1 non revenue(s) sur 10 livrée(s), à 50 €');
  });

  it('compte aussi sur une manifestation archivée', async () => {
    demander(400, CHAISE, { quantity: 10, delivered: 10, returned: 8 });
    expect((await coutDe(400)).total_pertes).toBe(100);
  });

  it('ne compte rien quand tout est revenu', async () => {
    demander(200, CHAISE, { quantity: 10, delivered: 10, returned: 10 });
    expect((await coutDe(200)).pertes).toEqual([]);
  });

  it('reste muet sur un lot dont le prix n’a pas été saisi', async () => {
    demander(200, TABLE, { quantity: 10, delivered: 10, returned: 8 });
    expect((await coutDe(200)).pertes).toEqual([]);
  });

  it('chiffre un exemplaire perdu', async () => {
    demander(200, CAMION, { delivered: 1, returned: 1, etat: 'perdu' });

    const cout = await coutDe(200);
    expect(cout.total_pertes).toBe(30000);
    expect(cout.pertes[0].motif).toBe('perdu, valeur 30000 €');
  });

  it('ne chiffre pas un exemplaire seulement abîmé', async () => {
    // Le coût de réparation n'a été saisi nulle part : l'inventer serait pire
    // que de se taire, et le constat reste visible sur la fiche.
    demander(200, CAMION, { delivered: 1, returned: 1, etat: 'abime' });
    expect((await coutDe(200)).pertes).toEqual([]);
  });
});

describe('Pertes saisies sur le catalogue des manifestations', () => {
  const perdreDuStock = (manifestationId: number, perdu: number, valeur = 0, motif?: string) =>
    base
      .prepare(
        `INSERT INTO manifestation_materials
           (manifestation_id, stock_id, quantity_requested, quantity_lost, loss_reason, unit_value)
         VALUES (?, 1, 5, ?, ?, ?)`
      )
      .run(manifestationId, perdu, motif ?? null, valeur);

  it('compte immédiatement, sans attendre la récupération', async () => {
    // `quantity_lost` est un constat du gestionnaire, pas une déduction.
    perdreDuStock(100, 2);

    const cout = await coutDe(100);
    expect(cout.total_pertes).toBe(1600);
    expect(cout.definitif).toBe(false);
  });

  it('préfère le prix retenu sur la manifestation au tarif du catalogue', async () => {
    // Un prix négocié pour un événement ne doit pas réécrire le tarif de
    // référence, ni être ignoré au moment de chiffrer.
    perdreDuStock(100, 2, 500);
    expect((await coutDe(100)).total_pertes).toBe(1000);
  });

  it('reprend le motif de la perte', async () => {
    perdreDuStock(100, 1, 0, 'toile déchirée');
    expect((await coutDe(100)).pertes[0].motif).toBe('1 perdue(s) — toile déchirée, à 800 €');
  });
});

describe('Total', () => {
  it('additionne le déployé et le perdu, sans les confondre', async () => {
    demander(200, AGENT, { quantity: 2 });
    demander(200, CHAISE, { quantity: 10, delivered: 10, returned: 9 });

    const cout = await coutDe(200);
    expect(cout.total_prestations).toBe(240);
    expect(cout.total_pertes).toBe(50);
    expect(cout.total).toBe(290);
  });

  it('ne chiffre rien sur une manifestation annulée', async () => {
    demander(300, AGENT, { quantity: 5 });
    demander(300, CHAISE, { quantity: 10, delivered: 10, returned: 0 });

    const cout = await coutDe(300);
    expect(cout.total).toBe(0);
    expect(cout.prestations).toEqual([]);
  });

  it('rend une structure complète pour une manifestation sans coût', async () => {
    // L'écran doit pouvoir afficher « aucun coût » plutôt que disparaître.
    const cout = await coutDe(500);
    expect(cout).toMatchObject({ total: 0, total_pertes: 0, total_prestations: 0 });
    expect(Array.isArray(cout.pertes)).toBe(true);
  });

  it('rend une structure complète pour une manifestation inexistante', async () => {
    expect((await coutDe(9999)).total).toBe(0);
  });
});
