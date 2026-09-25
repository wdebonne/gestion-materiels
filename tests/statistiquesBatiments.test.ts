import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import migration042 from '../src/database/migrations/042_entreprises_portail';
import migration043 from '../src/database/migrations/043_etages_et_plans';
import migration044 from '../src/database/migrations/044_energie_contrats_interventions';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Les statistiques des bâtiments.
 *
 * Ce qu'on fige :
 *
 *   **Tout se répartit au jour.** Une facture de décembre-janvier compte pour
 *   moitié dans chaque mois ; un contrat annuel, au prorata des jours regardés.
 *
 *   **Un contrat se partage entre ses bâtiments** : la somme des bâtiments
 *   redonne le contrat, jamais deux fois.
 *
 *   **Le périmètre tient** : sans bâtiment demandé, on ne voit que les siens ;
 *   un bâtiment qu'on ne suit pas est refusé, pas ignoré en silence. Les achats
 *   ne chiffrent que le matériel des catégories ouvertes au lecteur.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseStats = sqlite;
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
      async transaction(travail: () => Promise<unknown>) {
        return travail();
      },
    },
  };
});
jest.mock('../src/services/log.service', () => ({
  logService: { info: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/services/email.service', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
}));
/** Le compte 5 ne voit pas la catégorie du vidéoprojecteur (objet 21). */
jest.mock('../src/middleware/objectScope', () => ({
  peutVoirObjet: async () => true,
  filtreObjets: async (req: any, alias: string) =>
    req.user?.userId === 5 ? { sql: ` AND ${alias}.id <> 21`, params: [] } : { sql: '', params: [] },
  REFUS_PORTEE: 'hors portée',
}));

import exploitationRoutes from '../src/routes/exploitation.routes';
import {
  fenetreDeComparaison,
  finEffectiveDuContrat,
  lireFiltre,
  statistiquesBatiments,
  type FiltreStatistiques,
} from '../src/services/statistiquesBatiments.service';

const base: BetterSqlite3.Database = (global as any).__baseStats;

function contexteSqlite(sqlite: BetterSqlite3.Database): ContexteMigration {
  return {
    dialecte: 'sqlite',
    autoIncrement: 'AUTOINCREMENT',
    texteLong: 'TEXT',
    booleen: 'INTEGER',
    horodatageParDefaut: 'DEFAULT CURRENT_TIMESTAMP',
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

const app = express();
app.use(express.json());
app.use('/api/batiments', exploitationRoutes);
const en = (userId: number, role = 'user') => {
  (global as any).__connecte = { userId, role, email: `u${userId}@ville.fr` };
};

const filtre = (f: Partial<FiltreStatistiques>): FiltreStatistiques => ({
  debut: '2026-01-01',
  fin: '2026-01-31',
  granularite: 'mois',
  siteIds: [1, 2],
  categories: ['energie', 'contrats', 'interventions', 'controles', 'achats'],
  energies: [],
  comparaison: 'aucune',
  ...f,
});

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, can_login INTEGER DEFAULT 1, gere_organisation INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, address TEXT,
      sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE site_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES cle_sites(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE user_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, site_id INTEGER,
      est_responsable INTEGER NOT NULL DEFAULT 0, gere_lieu INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, reference TEXT, image TEXT,
      material_type TEXT DEFAULT 'unique', quantity_total INTEGER DEFAULT 0, purchase_date DATE,
      purchase_price DECIMAL(10,2), unit_cost REAL);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_reference TEXT, plugin_reference_id INTEGER);
  `);
  for (const m of [migration041, migration042, migration043, migration044]) await m.up(contexteSqlite(base));

  base.exec(`
    INSERT INTO users (id, email, role) VALUES (1, 'admin@ville.fr', 'admin'), (5, 'directrice@ville.fr', 'user'),
      (7, 'agent@ville.fr', 'user');
    INSERT INTO cle_sites (id, name, surface_m2) VALUES (1, 'École', 800), (2, 'Mairie', 1200), (3, 'Gymnase', NULL);
    UPDATE cle_sites SET is_active = 0 WHERE id = 3;
    INSERT INTO user_sites (user_id, site_id, est_responsable) VALUES (5, 1, 1);
    INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Classe'), (2, 2, 'Salle du conseil');

    -- Électricité de l'école : décembre-janvier, 620 € et 6 200 kWh.
    INSERT INTO batiment_factures (site_id, energie, date_facture, periode_debut, periode_fin, consommation, unite, montant_ttc)
      VALUES (1, 'electricite', '2026-02-05', '2025-12-01', '2026-01-31', 6200, 'kWh', 620),
    -- Gaz de la mairie : une facture sans période, comptée à sa date.
             (2, 'gaz', '2026-01-20', NULL, NULL, 3000, 'kWh', 300),
    -- Gaz de la mairie l'an dernier, pour la comparaison.
             (2, 'gaz', '2025-01-20', NULL, NULL, 2000, 'kWh', 200);

    -- Un contrat de 3 650 € par an sur les deux bâtiments : 10 € par jour, 5 € chacun.
    INSERT INTO batiment_contrats (id, objet, date_debut, date_fin, reconduction_tacite, montant_annuel_ttc)
      VALUES (1, 'Ascenseurs', '2025-01-01', '2025-12-31', 1, 3650);
    INSERT INTO batiment_contrat_sites (contrat_id, site_id) VALUES (1, 1), (1, 2);

    INSERT INTO batiment_interventions (site_id, date_intervention, nature, titre, montant_ttc)
      VALUES (1, '2026-01-10', 'controle', 'Vérification électrique', 250),
             (1, '2026-01-12', 'depannage', 'Fuite', 180),
             (2, '2026-01-15', 'travaux', 'Peinture', NULL);

    -- Achats : un vidéoprojecteur (caché au compte 5), dix chaises d'un lot, un meuble sans prix.
    INSERT INTO objects (id, name, material_type, purchase_date, purchase_price, unit_cost) VALUES
      (21, 'Vidéoprojecteur', 'unique', '2026-01-15', 1000, NULL),
      (22, 'Chaise', 'lot', '2026-01-05', 900, 20),
      (23, 'Meuble', 'unique', NULL, NULL, NULL);
    INSERT INTO piece_materiels (piece_id, object_id, quantite) VALUES (1, 21, 1), (1, 22, 10), (2, 23, 1);
  `);
});

// ------------------------------------------------------------------ le filtre

describe('Le filtre', () => {
  it('prend par défaut les douze derniers mois pleins, et choisit la granularité', () => {
    const f = lireFiltre({}, '2026-09-25');
    expect(f).toMatchObject({ debut: '2025-10-01', fin: '2026-09-30', granularite: 'mois', comparaison: 'aucune', sitesDemandes: null });
    expect(f.categories).toHaveLength(5);
    expect(lireFiltre({ debut: '2026-01-01', fin: '2026-02-15' }).granularite).toBe('semaine');
    expect(lireFiltre({ debut: '2020-01-01', fin: '2025-12-31' }).granularite).toBe('annee');
    expect(lireFiltre({ sites: '2,1,2', categories: 'energie,bidon', energies: 'gaz' })).toMatchObject({
      sitesDemandes: [2, 1],
      categories: ['energie'],
      energies: ['gaz'],
    });
  });

  it('refuse une période inversée, invalide ou de plus de dix ans', () => {
    expect(() => lireFiltre({ debut: '2026-02-01', fin: '2026-01-01' })).toThrow(/avant de commencer/);
    expect(() => lireFiltre({ debut: '2026-02-30', fin: '2026-03-01' })).toThrow(/invalide/);
    expect(() => lireFiltre({ debut: '2010-01-01', fin: '2026-01-01' })).toThrow(/Dix ans/);
  });

  it('compare à la période juste avant, ou un an plus tôt', () => {
    expect(fenetreDeComparaison({ debut: '2026-01-01', fin: '2026-03-31' }, 'precedente')).toEqual({ debut: '2025-10-03', fin: '2025-12-31' });
    expect(fenetreDeComparaison({ debut: '2024-02-01', fin: '2024-02-29' }, 'n-1')).toEqual({ debut: '2023-02-01', fin: '2023-02-28' });
    expect(fenetreDeComparaison({ debut: '2026-01-01', fin: '2026-01-31' }, 'aucune')).toBeNull();
  });

  it('fait courir un contrat tacite actif sans fin, et arrête un contrat désactivé à sa période en cours', () => {
    const tacite = { dateFin: '2025-12-31', reconductionTacite: true, preavisJours: 90, actif: true };
    expect(finEffectiveDuContrat(tacite, '2026-09-25')).toBeNull();
    expect(finEffectiveDuContrat({ ...tacite, actif: false }, '2026-09-25')).toBe('2026-12-31');
    expect(finEffectiveDuContrat({ ...tacite, reconductionTacite: false }, '2026-09-25')).toBe('2025-12-31');
  });
});

// -------------------------------------------------------------- les montants

describe('La répartition', () => {
  it('range la moitié de la facture de décembre-janvier dans chaque mois', async () => {
    const s = await statistiquesBatiments(filtre({ debut: '2025-12-01', fin: '2026-01-31', siteIds: [1], categories: ['energie'] }));
    expect(s.series.map((p) => [p.cle, p.parCategorie.energie, p.consommations.electricite])).toEqual([
      ['2025-12', 310, 3100],
      ['2026-01', 310, 3100],
    ]);
    expect(s.parBatiment[0].couverture).toEqual({ electricite: 1 });
  });

  it('partage un contrat entre ses bâtiments, au jour', async () => {
    const deux = await statistiquesBatiments(filtre({ categories: ['contrats'] }));
    expect(deux.totaux.montant).toBe(310);
    expect([...deux.parBatiment].sort((a, b) => a.siteId - b.siteId).map((b) => [b.nom, b.total])).toEqual([
      ['École', 155],
      ['Mairie', 155],
    ]);
    const un = await statistiquesBatiments(filtre({ categories: ['contrats'], siteIds: [1] }));
    expect(un.totaux.montant).toBe(155);
  });

  it('range chaque dépense dans sa catégorie, et la somme des bâtiments redonne le total', async () => {
    const s = await statistiquesBatiments(filtre({}));
    expect(s.totaux.parCategorie).toEqual({ energie: 610, contrats: 310, interventions: 180, controles: 250, achats: 1200 });
    expect(s.totaux.montant).toBe(2550);
    expect(s.parBatiment.reduce((somme, b) => somme + b.total, 0)).toBeCloseTo(s.totaux.montant, 2);
    // Le meuble n'a ni prix ni date : il est dit, pas compté à zéro.
    expect(s.achatsSansPrix).toBe(1);
    expect(s.details.find((d) => d.categorie === 'interventions')).toEqual({ categorie: 'interventions', sous: 'depannage', montant: 180, comparaison: null });
  });

  it('compare à l’an passé, et restreint aux énergies demandées', async () => {
    const s = await statistiquesBatiments(filtre({ categories: ['energie'], energies: ['gaz'], comparaison: 'n-1' }));
    expect(s.fenetreComparaison).toEqual({ debut: '2025-01-01', fin: '2025-01-31' });
    expect(s.totaux).toMatchObject({ montant: 300, comparaison: 200 });
    expect(s.parEnergie).toEqual([
      { energie: 'gaz', montant: 300, consommation: 3000, unite: 'kWh', comparaison: 200, consommationComparaison: 2000 },
    ]);
    expect(s.seriesComparaison?.map((p) => p.cle)).toEqual(['2025-01']);
  });

  it('ne chiffre que le matériel que le lecteur peut voir', async () => {
    en(5);
    const s = await statistiquesBatiments(filtre({ categories: ['achats'], siteIds: [1] }), { user: (global as any).__connecte } as any);
    expect(s.totaux.montant).toBe(200);
  });
});

// ---------------------------------------------------------------- le périmètre

describe('La route', () => {
  it('ne montre que ses bâtiments, et refuse ceux qu’on ne suit pas', async () => {
    en(5);
    const siens = await request(app).get('/api/batiments/statistiques?debut=2026-01-01&fin=2026-01-31');
    expect(siens.status).toBe(200);
    expect(siens.body.statistiques.filtre.siteIds).toEqual([1]);
    expect((await request(app).get('/api/batiments/statistiques?sites=1,2')).status).toBe(403);

    en(7);
    const aucun = await request(app).get('/api/batiments/statistiques');
    expect(aucun.body.statistiques.totaux.montant).toBe(0);

    en(1, 'admin');
    const tous = await request(app).get('/api/batiments/statistiques?debut=2026-01-01&fin=2026-01-31');
    // Le gymnase est fermé : il n'entre pas dans « tous les bâtiments ».
    expect([...tous.body.statistiques.filtre.siteIds].sort()).toEqual([1, 2]);
    expect((await request(app).get('/api/batiments/statistiques?debut=2026-02-01&fin=2026-01-01')).status).toBe(400);
  });
});
