import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import migration042 from '../src/database/migrations/042_entreprises_portail';
import migration043 from '../src/database/migrations/043_etages_et_plans';
import migration044 from '../src/database/migrations/044_energie_contrats_interventions';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Le Suivi des coûts, avec tout ce qui coûte.
 *
 * Ce qu'on fige :
 *
 *   **Toutes les sources se retrouvent dans le total** — parc, espaces verts,
 *   bâtiments, manifestations — et dans chaque vue : cartes, graphique par
 *   période, comparaison de périodes, comparaison annuelle. L'ancien écran
 *   oubliait les espaces verts partout sauf dans la carte du haut.
 *
 *   **Les bâtiments gardent leur répartition au jour** : une facture de
 *   décembre-janvier compte pour moitié dans chaque mois.
 *
 *   **Les semaines sont des semaines ISO**, périodes vides comprises, quel que
 *   soit le moteur.
 *
 *   **Le périmètre tient** : chacun ne chiffre que les catégories, les
 *   bâtiments et les modules qui lui sont ouverts.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseSuivi = sqlite;
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
/** Le compte 5 ne voit que la catégorie 1 ; le compte 7, aucune. */
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
  getAccessibleCategoryIds: async (userId: number, role: string) =>
    role === 'admin' ? null : userId === 5 ? [1] : [],
}));
jest.mock('../src/middleware/objectScope', () => ({
  peutVoirObjet: async () => true,
  filtreObjets: async () => ({ sql: '', params: [] }),
  REFUS_PORTEE: 'hors portée',
}));
/** Le compte 7 ne suit aucune manifestation. */
jest.mock('../src/middleware/manifestationScope', () => ({
  filtreManifestations: async (req: any) =>
    req.user?.userId === 7 ? { sql: ' AND 1 = 0', params: [] } : { sql: '', params: [] },
}));
/** Le coût d'une manifestation a ses propres tests : ici, il est donné. */
jest.mock('../src/services/coutManifestation.service', () => ({
  coutDe: async (id: number) => {
    const couts: Record<number, [number, number]> = { 1: [100, 50], 4: [40, 0] };
    const [prestations, pertes] = couts[Number(id)] ?? [0, 0];
    return {
      prestations: [],
      pertes: [],
      en_attente_de_retour: [],
      total_prestations: prestations,
      total_pertes: pertes,
      total: prestations + pertes,
      definitif: Number(id) === 1,
    };
  },
}));

import trackingRoutes from '../src/routes/tracking.routes';
import { lireFenetre, lireGranularite } from '../src/services/suiviCouts.service';

const base: BetterSqlite3.Database = (global as any).__baseSuivi;

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
app.use('/api/tracking', trackingRoutes);
const en = (userId: number, role = 'user') => {
  (global as any).__connecte = { userId, role, email: `u${userId}@ville.fr` };
};
const JANVIER = { startDate: '2026-01-01', endDate: '2026-01-31' };

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
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_reference TEXT, plugin_reference_id INTEGER);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, image TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT, slug TEXT, image TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, reference TEXT, image TEXT,
      category_id INTEGER, subcategory_id INTEGER, material_type TEXT DEFAULT 'unique', purchase_date DATE,
      purchase_price DECIMAL(10,2), unit_cost REAL);
    CREATE TABLE fuel_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, fuel_type TEXT, quantity DECIMAL,
      unit_price DECIMAL, total_price DECIMAL, mileage INTEGER, station TEXT, entry_date DATE, notes TEXT, attachments TEXT);
    CREATE TABLE maintenances (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, maintenance_type TEXT,
      maintenance_date DATE, next_date DATE, mileage INTEGER, next_mileage INTEGER, cost DECIMAL, provider TEXT,
      document TEXT, notes TEXT, attachments TEXT);
    CREATE TABLE technical_controls (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, control_date DATE,
      expiry_date DATE, mileage INTEGER, result TEXT, center_name TEXT, cost DECIMAL, document TEXT, notes TEXT, attachments TEXT);
    CREATE TABLE maintenance_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE green_spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, space_type TEXT);
    CREATE TABLE green_space_maintenances (id INTEGER PRIMARY KEY AUTOINCREMENT, green_space_id INTEGER,
      maintenance_type TEXT, title TEXT, performed_date DATE, next_maintenance_date DATE, performed_by TEXT,
      duration_minutes INTEGER, cost DECIMAL, notes TEXT);
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title TEXT, date_start DATE, date_end DATE, status TEXT);
    CREATE TABLE plugins (id INTEGER PRIMARY KEY, slug TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE plugin_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id INTEGER, role TEXT, can_access INTEGER);
    CREATE TABLE user_plugin_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plugin_id INTEGER, can_access INTEGER);
    CREATE TABLE module_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, module_name TEXT, role TEXT,
      can_view INTEGER DEFAULT 0, can_export INTEGER DEFAULT 0, can_compare INTEGER DEFAULT 0);
    CREATE TABLE user_module_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, module_name TEXT,
      can_view INTEGER DEFAULT 0, can_export INTEGER DEFAULT 0, can_compare INTEGER DEFAULT 0);
  `);
  for (const m of [migration041, migration042, migration043, migration044]) await m.up(contexteSqlite(base));

  base.exec(`
    INSERT INTO users (id, email, role) VALUES (1, 'admin@ville.fr', 'admin'), (5, 'directrice@ville.fr', 'user'),
      (7, 'agent@ville.fr', 'user');
    INSERT INTO module_permissions (module_name, role, can_view, can_export, can_compare) VALUES ('tracking', 'user', 1, 1, 1);
    INSERT INTO plugins (id, slug, is_active) VALUES (1, 'batiments', 1), (2, 'manifestations', 1), (3, 'espaces-verts', 1);
    -- Le compte 7 n'a pas le module Bâtiments.
    INSERT INTO user_plugin_permissions (user_id, plugin_id, can_access) VALUES (7, 1, 0);

    INSERT INTO categories (id, name, slug) VALUES (1, 'Véhicules', 'vehicules'), (2, 'Engins', 'engins');
    INSERT INTO objects (id, name, reference, category_id) VALUES (10, 'Kangoo', 'AB-123', 1), (11, 'Tondeuse', 'T-1', 2);
    INSERT INTO fuel_entries (object_id, fuel_type, quantity, total_price, entry_date)
      VALUES (10, 'Gazole', 50, 100, '2026-01-10'), (11, 'SP95', 10, 20, '2026-01-11'), (10, 'Gazole', 40, 90, '2025-01-10');
    INSERT INTO maintenances (object_id, maintenance_type, maintenance_date, cost) VALUES (10, 'Vidange', '2026-01-15', 200);
    INSERT INTO technical_controls (object_id, control_date, expiry_date, result, cost)
      VALUES (10, '2026-01-20', '2028-01-20', 'Favorable', 80);
    INSERT INTO green_spaces (id, name, space_type) VALUES (1, 'Parc de la mairie', 'parc');
    INSERT INTO green_space_maintenances (green_space_id, maintenance_type, performed_date, cost)
      VALUES (1, 'Tonte', '2026-01-05', 60);

    INSERT INTO cle_sites (id, name, surface_m2) VALUES (1, 'École', 800), (2, 'Mairie', 1200);
    INSERT INTO user_sites (user_id, site_id, est_responsable) VALUES (5, 1, 1);
    -- Électricité de l'école sur décembre-janvier : 310 € dans chaque mois.
    INSERT INTO batiment_factures (site_id, energie, date_facture, periode_debut, periode_fin, consommation, unite, montant_ttc)
      VALUES (1, 'electricite', '2026-02-05', '2025-12-01', '2026-01-31', 6200, 'kWh', 620),
             (2, 'gaz', '2025-01-20', NULL, NULL, 2000, 'kWh', 200);
    -- 3 650 € par an sur les deux bâtiments : 10 € par jour, 5 € chacun.
    INSERT INTO batiment_contrats (id, objet, date_debut, date_fin, reconduction_tacite, montant_annuel_ttc)
      VALUES (1, 'Ascenseurs', '2025-01-01', '2025-12-31', 1, 3650);
    INSERT INTO batiment_contrat_sites (contrat_id, site_id) VALUES (1, 1), (1, 2);
    INSERT INTO batiment_interventions (site_id, date_intervention, nature, titre, montant_ttc)
      VALUES (1, '2026-01-10', 'controle', 'Vérification électrique', 250),
             (2, '2026-01-12', 'depannage', 'Fuite', 180);

    INSERT INTO manifestations (id, title, date_start, status) VALUES
      (1, 'Fête du village', '2026-01-18', 'recovered'),
      (2, 'Brouillon', '2026-01-19', 'draft'),
      (3, 'Annulée', '2026-01-20', 'cancelled'),
      (4, 'Vœux du maire', '2025-01-15', 'archived');
  `);
});

// ------------------------------------------------------------------ la lecture

describe('La lecture des paramètres', () => {
  it('prend du 1er janvier à aujourd’hui sans dates, et refuse une période fausse', () => {
    expect(lireFenetre(undefined, undefined, '2026-09-26')).toEqual({ debut: '2026-01-01', fin: '2026-09-26' });
    expect(() => lireFenetre('2026-02-01', '2026-01-01')).toThrow(/avant de commencer/);
    expect(() => lireFenetre('2026-02-30', '2026-03-01')).toThrow(/invalide/);
    expect(() => lireFenetre('2010-01-01', '2026-01-01')).toThrow(/Dix ans/);
  });

  it('comprend les granularités de l’écran', () => {
    expect(lireGranularite('week')).toBe('semaine');
    expect(lireGranularite('year')).toBe('annee');
    expect(lireGranularite('month')).toBe('mois');
    expect(lireGranularite(undefined)).toBe('mois');
  });

  it('répond 400 à une période inversée, plutôt que 500', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/data').query({ startDate: '2026-02-01', endDate: '2026-01-01' });
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------- les totaux

describe('Le total de janvier', () => {
  it('additionne toutes les sources, bâtiments et manifestations compris', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/data').query(JANVIER);
    expect(r.status).toBe(200);
    expect(r.body.sources).toEqual(['fuel', 'maintenance', 'technical_control', 'green_space', 'buildings', 'events']);
    expect(r.body.summary).toMatchObject({
      totalFuelCost: 120,
      totalFuelQuantity: 60,
      totalMaintenanceCost: 200,
      totalControlCost: 80,
      totalGreenSpaceCost: 60,
      // 310 d'électricité + 310 de contrat + 250 + 180 d'interventions.
      totalBuildingCost: 1050,
      totalEventCost: 150,
      totalCost: 1660,
      fuelEntryCount: 2,
      buildingCount: 2,
      // Le brouillon et l'annulée ne comptent pas.
      eventCount: 1,
      buildings: { energie: 310, contrats: 310, interventions: 180, controles: 250 },
      events: { prestations: 100, pertes: 50 },
    });
  });

  it('détaille les bâtiments, au m², et les manifestations', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/data').query(JANVIER);
    expect(r.body.buildings.map((b: any) => [b.name, b.totalCost, b.costPerM2])).toEqual([
      ['École', 715, 0.89],
      ['Mairie', 335, 0.28],
    ]);
    expect(r.body.events).toEqual([
      expect.objectContaining({ id: 1, title: 'Fête du village', date: '2026-01-18', prestations: 100, pertes: 50, total: 150 }),
    ]);
    expect(r.body.fuel).toHaveLength(2);
    expect(r.body.greenSpace).toHaveLength(1);
  });

  it('ne rend que les sources demandées', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/data').query({ ...JANVIER, dataTypes: 'buildings' });
    expect(r.body.summary.totalCost).toBe(1050);
    expect(r.body.summary.totalFuelCost).toBe(0);
    expect(r.body.fuel).toEqual([]);
  });

  it('compare deux périodes sur toutes les sources, espaces verts compris', async () => {
    en(1, 'admin');
    const r = await request(app)
      .get('/api/tracking/data')
      .query({ ...JANVIER, compareStartDate: '2025-01-01', compareEndDate: '2025-01-31' });
    // Janvier 2025 : un plein de 90, 200 de gaz, 310 de contrat, 40 de manifestation.
    expect(r.body.comparison.summary).toMatchObject({
      totalFuelCost: 90,
      totalBuildingCost: 510,
      totalEventCost: 40,
      totalGreenSpaceCost: 0,
      totalCost: 640,
    });
    expect(r.body.comparison.difference).toMatchObject({ totalCost: 1020, totalGreenSpaceCost: 60, totalBuildingCost: 540 });
    expect(r.body.comparison.percentageChange.totalCost).toBe(159.4);
    expect(r.body.comparison.percentageChange.totalGreenSpaceCost).toBeNull();
  });
});

// ------------------------------------------------------------ les graphiques

describe('Les graphiques', () => {
  it('répartit la facture de décembre-janvier sur ses deux mois', async () => {
    en(1, 'admin');
    const r = await request(app)
      .get('/api/tracking/charts')
      .query({ startDate: '2025-12-01', endDate: '2026-01-31', groupBy: 'month', dataTypes: 'buildings' });
    expect(r.body.costByPeriod.map((p: any) => [p.period, p.label, p.buildingCost])).toEqual([
      ['2025-12', expect.stringContaining('2025'), 620],
      ['2026-01', expect.stringContaining('2026'), 1050],
    ]);
    expect(r.body.buildingByCategory.map((c: any) => c.type)).toEqual(['energie', 'contrats', 'controles', 'interventions']);
  });

  it('range par semaine ISO, semaines vides comprises', async () => {
    en(1, 'admin');
    const r = await request(app)
      .get('/api/tracking/charts')
      .query({ startDate: '2026-01-05', endDate: '2026-01-25', groupBy: 'week', dataTypes: 'fuel,green_space' });
    expect(r.body.costByPeriod.map((p: any) => [p.period, p.fuelCost, p.greenSpaceCost])).toEqual([
      ['2026-W02', 120, 60],
      ['2026-W03', 0, 0],
      ['2026-W04', 0, 0],
    ]);
  });

  it('classe les objets et les bâtiments qui coûtent le plus', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/charts').query(JANVIER);
    expect(r.body.costByObject.map((o: any) => [o.name, o.totalCost])).toEqual([
      ['Kangoo', 380],
      ['Tondeuse', 20],
    ]);
    expect(r.body.costByBuilding.map((b: any) => b.name)).toEqual(['École', 'Mairie']);
    expect(r.body.costByPeriod[0].totalCost).toBe(1660);
  });
});

// -------------------------------------------------- la comparaison annuelle

describe('La comparaison annuelle', () => {
  it('compte toutes les sources, mois par mois', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/yearly-comparison').query({ year1: 2025, year2: 2026 });
    expect(r.status).toBe(200);
    expect(r.body.monthly.year1).toHaveLength(12);
    expect(r.body.monthly.year2[0]).toMatchObject({ month: 1, fuel: 120, greenSpace: 60, buildings: 1050, events: 150, total: 1660 });
    // 2025 : le plein, le gaz, le contrat toute l'année, l'électricité de décembre, les vœux.
    expect(r.body.summary.year1).toMatchObject({ fuel: 90, buildings: 200 + 3650 + 310, events: 40 });
  });

  it('lit « 2026 vs 2025 » comme 2026 comparé à 2025, référence en second', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/yearly-comparison').query({ year1: 2026, year2: 2025 });
    const { year1, year2 } = r.body.summary;
    // L'écart part de la référence : un total 2026 supérieur donne un écart positif.
    expect(r.body.difference.total).toBeCloseTo(year1.total - year2.total, 2);
    expect(r.body.difference.greenSpace).toBe(60);
    expect(r.body.difference.percentage).toBeCloseTo(((year1.total - year2.total) / year2.total) * 100, 1);
  });

  it('ne donne pas de pourcentage quand la référence n’a rien coûté', async () => {
    en(1, 'admin');
    const r = await request(app).get('/api/tracking/yearly-comparison').query({ year1: 2026, year2: 2020 });
    expect(r.body.summary.year2.total).toBe(0);
    expect(r.body.difference.percentage).toBeNull();
  });

  it('compare deux mois', async () => {
    en(1, 'admin');
    const r = await request(app)
      .get('/api/tracking/yearly-comparison')
      .query({ year1: 2025, month1: 1, year2: 2026, month2: 1 });
    expect(r.body.mode).toBe('monthly');
    expect(r.body.summary.year1.total).toBe(640);
    expect(r.body.summary.year2.total).toBe(1660);
  });
});

// ---------------------------------------------------------------- le périmètre

describe('Le périmètre', () => {
  it('ne chiffre que les catégories et les bâtiments suivis', async () => {
    en(5);
    const r = await request(app).get('/api/tracking/data').query(JANVIER);
    expect(r.body.summary).toMatchObject({
      totalFuelCost: 100,
      // L'école seule : 310 + 155 de contrat + 250.
      totalBuildingCost: 715,
    });
    expect(r.body.fuel.map((f: any) => f.objectName)).toEqual(['Kangoo']);
    expect(r.body.buildings.map((b: any) => b.name)).toEqual(['École']);
  });

  it('compte encore ce qu’a coûté un bâtiment désactivé', async () => {
    base.exec(`
      INSERT INTO cle_sites (id, name, is_active) VALUES (9, 'Ancienne poste', 0);
      INSERT INTO batiment_interventions (site_id, date_intervention, nature, titre, montant_ttc)
        VALUES (9, '2024-06-10', 'travaux', 'Toiture', 5000);
    `);
    en(1, 'admin');
    const r = await request(app)
      .get('/api/tracking/data')
      .query({ startDate: '2024-06-01', endDate: '2024-06-30', dataTypes: 'buildings' });
    expect(r.body.buildings.map((b: any) => [b.name, b.totalCost])).toEqual([['Ancienne poste', 5000]]);
    base.exec(`DELETE FROM batiment_interventions WHERE site_id = 9; DELETE FROM cle_sites WHERE id = 9;`);
  });

  it('refuse un bâtiment qu’on ne suit pas', async () => {
    en(5);
    const r = await request(app).get('/api/tracking/data').query({ ...JANVIER, siteIds: '2' });
    expect(r.status).toBe(403);
  });

  it('retire les sources d’un module fermé, sans erreur', async () => {
    en(7);
    const filtres = await request(app).get('/api/tracking/filters');
    expect(filtres.body.sources).not.toContain('buildings');
    expect(filtres.body.sites).toEqual([]);
    const r = await request(app).get('/api/tracking/data').query(JANVIER);
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ totalFuelCost: 0, totalBuildingCost: 0, totalEventCost: 0, totalGreenSpaceCost: 60 });
  });

  it('propose au gestionnaire ses bâtiments, et seulement le matériel de ses catégories', async () => {
    en(5);
    const r = await request(app).get('/api/tracking/filters');
    expect(r.body.sites).toEqual([{ id: 1, name: 'École' }]);
    expect(r.body.sources).toContain('buildings');
    expect(r.body.categories.map((c: any) => c.name)).toEqual(['Véhicules']);
    expect(r.body.objects.map((o: any) => o.name)).toEqual(['Kangoo']);
  });

  it('ne rend aucun matériel à qui ne voit aucune catégorie, même en le demandant', async () => {
    en(7);
    const r = await request(app).get('/api/tracking/data').query({ ...JANVIER, objectIds: '10,11' });
    expect(r.body.fuel).toEqual([]);
    expect(r.body.summary.totalFuelCost).toBe(0);
    const g = await request(app).get('/api/tracking/charts').query(JANVIER);
    expect(g.body.costByObject).toEqual([]);
  });
});
