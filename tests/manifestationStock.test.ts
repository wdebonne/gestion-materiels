import type BetterSqlite3 from 'better-sqlite3';

/**
 * Stock des manifestations : prévisionnel et réel.
 *
 * Le prévisionnel et le réel étaient mélangés et réécrits à la main dans chaque
 * route : `GET /stock` soustrayait ce qui était dehors mais pas ce qui était
 * promis, `/stock/availability` faisait l'inverse, et aucune des deux ne savait
 * répondre sur une période. Une chaise cassée, elle, ne diminuait rien du tout.
 *
 * Ces tests tournent sur une vraie base SQLite en mémoire : le double comptage
 * entre « demandé » et « livré » est exactement le genre de défaut qu'un test à
 * base simulée ne verrait pas.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseStock = sqlite;

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
  disponibiliteSur,
  enregistrerMouvement,
  enrichirStock,
  periodeDe,
  STATUTS_PREVISIONNELS,
  STATUTS_SORTIS,
} from '../src/services/manifestationStock.service';

const base: BetterSqlite3.Database = (global as any).__baseStock;

beforeAll(() => {
  base.exec(`
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      quantity_total INTEGER NOT NULL DEFAULT 0,
      is_prestation INTEGER DEFAULT 0,
      updated_at DATETIME
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
      quantity_requested INTEGER NOT NULL DEFAULT 0,
      quantity_delivered INTEGER NOT NULL DEFAULT 0,
      quantity_recovered INTEGER NOT NULL DEFAULT 0,
      quantity_lost INTEGER NOT NULL DEFAULT 0,
      loss_reason TEXT
    );
    CREATE TABLE manifestation_stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      manifestation_id INTEGER,
      type VARCHAR(20) NOT NULL,
      quantity INTEGER NOT NULL,
      reason TEXT,
      user_id INTEGER,
      created_at DATETIME
    );
  `);
});

beforeEach(() => {
  base.exec('DELETE FROM manifestation_materials; DELETE FROM manifestations; DELETE FROM manifestation_stock; DELETE FROM manifestation_stock_movements;');
  base.prepare('INSERT INTO manifestation_stock (id, name, quantity_total) VALUES (1, ?, 100)').run('Chaise');
  base.prepare('INSERT INTO manifestation_stock (id, name, quantity_total) VALUES (2, ?, 20)').run('Table 180 cm');
});

/** Crée une manifestation et sa ligne de matériel, et rend son identifiant. */
function manifestation(options: {
  statut: string;
  debut: string;
  fin?: string;
  livraison?: string;
  recuperation?: string;
  stockId?: number;
  demande?: number;
  livre?: number;
  recupere?: number;
}): number {
  const r = base
    .prepare(
      `INSERT INTO manifestations (title, date_start, date_end, delivery_date, recovery_date, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      'Essai',
      options.debut,
      options.fin ?? null,
      options.livraison ?? null,
      options.recuperation ?? null,
      options.statut
    );

  const id = Number(r.lastInsertRowid);
  base
    .prepare(
      `INSERT INTO manifestation_materials
         (manifestation_id, stock_id, quantity_requested, quantity_delivered, quantity_recovered)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, options.stockId ?? 1, options.demande ?? 0, options.livre ?? 0, options.recupere ?? 0);

  return id;
}

describe('Séparation du prévisionnel et du réel', () => {
  it('classe chaque statut dans un seul des deux comptes', () => {
    // C'est l'invariant qui empêche le double comptage : aucun statut ne peut
    // être à la fois « promis » et « sorti ».
    const croisement = STATUTS_PREVISIONNELS.filter((s) => (STATUTS_SORTIS as readonly string[]).includes(s));
    expect(croisement).toEqual([]);
  });

  it('une demande reçue engage le prévisionnel, pas le réel', () => {
    // C'est tout l'intérêt du statut « à confirmer » : il bloque le matériel
    // sans prétendre qu'il est sorti.
    manifestation({ statut: 'pending', debut: '2026-07-14', demande: 30 });

    return disponibiliteSur([1], '2026-07-14', '2026-07-14').then((e) => {
      expect(e.get(1)).toEqual({ engage_previsionnel: 30, engage_reel: 0 });
    });
  });

  it('une manifestation livrée engage le réel, pas le prévisionnel', async () => {
    // Sans cette bascule, ses 30 chaises seraient comptées deux fois : une fois
    // parce qu'elle les avait demandées, une fois parce qu'elle les a emportées.
    manifestation({ statut: 'delivered', debut: '2026-07-14', demande: 30, livre: 30 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(engagements.get(1)).toEqual({ engage_previsionnel: 0, engage_reel: 30 });
  });

  it('ne compte plus ce qui a été récupéré', async () => {
    manifestation({ statut: 'delivered', debut: '2026-07-14', livre: 30, recupere: 12 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(engagements.get(1)?.engage_reel).toBe(18);
  });

  it('ne compte jamais négativement une ligne sur-récupérée', async () => {
    // Une saisie erronée ne doit pas *ajouter* du stock disponible.
    manifestation({ statut: 'delivered', debut: '2026-07-14', livre: 10, recupere: 25 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(engagements.get(1)?.engage_reel).toBe(0);
  });

  it('ignore une manifestation annulée ou archivée', async () => {
    manifestation({ statut: 'cancelled', debut: '2026-07-14', demande: 40 });
    manifestation({ statut: 'archived', debut: '2026-07-14', demande: 40 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(engagements.get(1)).toEqual({ engage_previsionnel: 0, engage_reel: 0 });
  });
});

describe('Fenêtre d’immobilisation', () => {
  it('bloque de la livraison à la récupération, pas seulement le jour même', async () => {
    // Le matériel part la veille et revient le lendemain : il est indisponible
    // les trois jours, pas seulement pendant la manifestation.
    manifestation({
      statut: 'validated',
      debut: '2026-07-14',
      fin: '2026-07-14',
      livraison: '2026-07-13',
      recuperation: '2026-07-15',
      demande: 60,
    });

    for (const jour of ['2026-07-13', '2026-07-14', '2026-07-15']) {
      const e = await disponibiliteSur([1], jour, jour);
      expect(e.get(1)?.engage_previsionnel).toBe(60);
    }

    const veille = await disponibiliteSur([1], '2026-07-12', '2026-07-12');
    expect(veille.get(1)?.engage_previsionnel).toBe(0);
  });

  it('sans date de récupération, retombe sur la fin puis sur le début', () => {
    expect(periodeDe({ date_start: '2026-07-14' })).toEqual({
      debut: '2026-07-14',
      fin: '2026-07-14',
    });
    expect(
      periodeDe({ date_start: '2026-07-14', date_end: '2026-07-16', delivery_date: '2026-07-13' })
    ).toEqual({ debut: '2026-07-13', fin: '2026-07-16' });
  });

  it('n’additionne pas deux manifestations qui ne se chevauchent pas', async () => {
    manifestation({ statut: 'validated', debut: '2026-07-14', demande: 60 });
    manifestation({ statut: 'validated', debut: '2026-08-20', demande: 80 });

    const juillet = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(juillet.get(1)?.engage_previsionnel).toBe(60);
  });

  it('additionne bien deux manifestations qui se chevauchent', async () => {
    manifestation({ statut: 'validated', debut: '2026-07-14', demande: 60 });
    manifestation({ statut: 'pending', debut: '2026-07-14', demande: 50 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14');
    expect(engagements.get(1)?.engage_previsionnel).toBe(110);
  });

  it('exclut la manifestation qu’on est en train de modifier', async () => {
    // Sans cette exclusion, modifier une manifestation la ferait entrer en
    // conflit avec elle-même.
    const id = manifestation({ statut: 'validated', debut: '2026-07-14', demande: 60 });

    const engagements = await disponibiliteSur([1], '2026-07-14', '2026-07-14', id);
    expect(engagements.get(1)?.engage_previsionnel).toBe(0);
  });
});

describe('Conflits signalés', () => {
  it('signale ce qui manque sans rien refuser', async () => {
    manifestation({ statut: 'validated', debut: '2026-07-14', demande: 80 });

    const conflits = await detecterConflits(
      [{ stock_id: 1, quantity_requested: 40 }],
      '2026-07-14',
      '2026-07-14'
    );

    expect(conflits).toEqual([
      { stock_id: 1, stock_name: 'Chaise', demande: 40, disponible: 20, manquant: 20 },
    ]);
  });

  it('ne signale rien quand le stock suffit', async () => {
    manifestation({ statut: 'validated', debut: '2026-07-14', demande: 60 });

    const conflits = await detecterConflits(
      [{ stock_id: 1, quantity_requested: 40 }],
      '2026-07-14',
      '2026-07-14'
    );
    expect(conflits).toEqual([]);
  });

  it('ne descend pas le disponible sous zéro dans le message', async () => {
    manifestation({ statut: 'validated', debut: '2026-07-14', demande: 130 });

    const [conflit] = await detecterConflits(
      [{ stock_id: 1, quantity_requested: 10 }],
      '2026-07-14',
      '2026-07-14'
    );
    expect(conflit.disponible).toBe(0);
    expect(conflit.manquant).toBe(10);
  });
});

describe('Pertes et stock physique', () => {
  it('une casse diminue le total et laisse une trace', async () => {
    // Sans cette écriture, le total resterait celui de l'achat et s'éloignerait
    // un peu plus du réel à chaque manifestation.
    await enregistrerMouvement(1, null, 'perte', 1, 'Cassée pendant le transport', 7);

    const article = base.prepare('SELECT quantity_total FROM manifestation_stock WHERE id = 1').get() as any;
    expect(article.quantity_total).toBe(99);

    const mouvement = base.prepare('SELECT * FROM manifestation_stock_movements').get() as any;
    expect(mouvement).toMatchObject({
      stock_id: 1,
      type: 'perte',
      quantity: 1,
      reason: 'Cassée pendant le transport',
      user_id: 7,
    });
  });

  it('une correction remet la quantité au stock', async () => {
    await enregistrerMouvement(1, null, 'perte', 5, 'Volées', 7);
    await enregistrerMouvement(1, null, 'entree', 2, 'Retrouvées', 7);

    const article = base.prepare('SELECT quantity_total FROM manifestation_stock WHERE id = 1').get() as any;
    expect(article.quantity_total).toBe(97);
  });

  it('ne rend jamais le stock négatif', async () => {
    await enregistrerMouvement(1, null, 'perte', 500, 'Saisie erronée', 7);

    const article = base.prepare('SELECT quantity_total FROM manifestation_stock WHERE id = 1').get() as any;
    expect(article.quantity_total).toBe(0);
  });

  it('ne fait rien pour un écart nul', async () => {
    await enregistrerMouvement(1, null, 'perte', 0, null, 7);

    expect(base.prepare('SELECT COUNT(*) as n FROM manifestation_stock_movements').get()).toEqual({ n: 0 });
  });
});

describe('Enrichissement de la liste de stock', () => {
  it('conserve les champs que l’écran affiche déjà', async () => {
    manifestation({ statut: 'delivered', debut: '2026-07-14', livre: 30, recupere: 10 });

    const articles = base.prepare('SELECT * FROM manifestation_stock').all();
    const enrichis = await enrichirStock(articles);
    const chaise = enrichis.find((a: any) => a.id === 1);

    expect(chaise).toMatchObject({
      quantity_total: 100,
      quantity_lent: 0,
      quantity_available: 100,
    });
    // La manifestation est en juillet 2026 : rien n'est dehors aujourd'hui, mais
    // elle reste comptée dans ce qui est engagé plus tard.
    expect(chaise.quantity_reserved_future).toBeDefined();
  });

  it('ajoute le prévisionnel et le réel quand une période est demandée', async () => {
    manifestation({ statut: 'pending', debut: '2026-07-14', demande: 25 });
    manifestation({ statut: 'delivered', debut: '2026-07-14', livre: 15 });

    const articles = base.prepare('SELECT * FROM manifestation_stock WHERE id = 1').all();
    const [chaise] = await enrichirStock(articles, { debut: '2026-07-14', fin: '2026-07-14' });

    expect(chaise.engage_previsionnel).toBe(25);
    expect(chaise.engage_reel).toBe(15);
    // Le prévisionnel retire tout ce qui est promis ou sorti ; le réel ne
    // retire que ce qui est effectivement dehors.
    expect(chaise.disponible_previsionnel).toBe(60);
    expect(chaise.disponible_reel).toBe(85);
  });

  it('rend une liste vide sans interroger la base', async () => {
    expect(await enrichirStock([])).toEqual([]);
  });
});
