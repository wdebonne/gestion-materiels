import fs from 'fs';
import path from 'path';
import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import migration043 from '../src/database/migrations/043_etages_et_plans';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Les étages, leurs plans, et ce que contiennent les pièces.
 *
 * Ce qu'on fige :
 *
 *   **La surface suit l'étalonnage.** Même formule que le plan des espaces
 *   verts ; étalonner l'étage recalcule ses pièces, sans quoi une surface
 *   d'avant l'étalonnage mentirait.
 *
 *   **Un matériel unique n'est que dans une pièce.** Le reposer ailleurs le
 *   déplace — et seulement si on le demande ; sinon le refus dit où il est. Un
 *   lot ne se répartit pas au-delà de sa quantité.
 *
 *   **Les clés d'une pièce, sur les trois portées** : passe du bâtiment, passe
 *   de la pièce, clé d'une de ses portes.
 *
 *   **Le plan est privé** : il ne sort que pour qui consulte le bâtiment, et
 *   n'accepte qu'une image.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__basePlans = sqlite;
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
/**
 * La portée des catégories est éprouvée ailleurs : ici, le matériel 99 est hors
 * de vue de tous, et le compte 5 — responsable de l'école — ne voit ni les
 * chaises (11) ni le passe général (12), dont les catégories lui sont fermées.
 */
jest.mock('../src/middleware/objectScope', () => ({
  peutVoirObjet: async (_req: any, id: number) => Number(id) !== 99,
  filtreObjets: async (req: any, alias: string) =>
    req.user?.userId === 5 ? { sql: ` AND ${alias}.id NOT IN (11, 12)`, params: [] } : { sql: '', params: [] },
  REFUS_PORTEE: 'Ce matériel ne fait pas partie des catégories qui vous sont accessibles',
}));

import batimentRoutes from '../src/routes/batiment.routes';
import { dossierPrive } from '../src/middleware/televersement';
import { usagesSite } from '../src/services/sites.service';
import {
  clesDeLaPiece,
  definirZone,
  lireEtage,
  modifierEtage,
  placerMateriel,
  supprimerEtage,
  surfaceEnM2,
} from '../src/services/plans.service';

const base: BetterSqlite3.Database = (global as any).__basePlans;

const SCHEMA_AVANT = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, role TEXT,
    is_active INTEGER DEFAULT 1, can_login INTEGER DEFAULT 1, gere_organisation INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, address TEXT,
    sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE site_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES cle_sites(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT,
    description TEXT, type_lieu TEXT, capacite INTEGER, pretable INTEGER, sort_order INTEGER DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, piece_id INTEGER,
    name TEXT NOT NULL, code TEXT, sort_order INTEGER DEFAULT 0);
  CREATE TABLE cle_ouvre (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL, site_id INTEGER,
    piece_id INTEGER, ouvrant_id INTEGER);
  CREATE TABLE cle_attributions (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, quantity INTEGER,
    remise_on TEXT, restitution_on TEXT, holder_type TEXT, holder_user_id INTEGER, holder_service_id INTEGER,
    holder_ouvrant_id INTEGER, holder_label TEXT);
  CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, reference TEXT, image TEXT,
    material_type TEXT DEFAULT 'unique', quantity_total INTEGER DEFAULT 0);
  CREATE TABLE user_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, site_id INTEGER,
    est_responsable INTEGER NOT NULL DEFAULT 0, gere_lieu INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_reference TEXT, plugin_reference_id INTEGER);
`;

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

// ------------------------------------------------------------- la migration

describe('Migration 043 — étages et plans', () => {
  it('pose ses tables et colonnes, se rejoue, et rend les pièces au bâtiment quand l’étage part', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(SCHEMA_AVANT);
    await migration043.up(contexteSqlite(sqlite));
    await migration043.up(contexteSqlite(sqlite));

    const colonnes = (sqlite.prepare('PRAGMA table_info(site_pieces)').all() as any[]).map((c) => c.name);
    expect(colonnes).toEqual(expect.arrayContaining(['etage_id', 'zone_points', 'surface_m2']));

    sqlite.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'École');
      INSERT INTO site_etages (id, site_id, nom) VALUES (1, 1, 'RDC');
      INSERT INTO site_pieces (id, site_id, name, etage_id) VALUES (1, 1, 'Classe', 1);
      INSERT INTO objects (id, name) VALUES (1, 'Tableau');
      INSERT INTO piece_materiels (piece_id, object_id) VALUES (1, 1);
      DELETE FROM site_etages WHERE id = 1;
    `);
    expect(sqlite.prepare('SELECT etage_id FROM site_pieces WHERE id = 1').get()).toEqual({ etage_id: null });
    sqlite.exec('DELETE FROM site_pieces WHERE id = 1');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM piece_materiels').get()).toEqual({ n: 0 });
  });

  it('pose en MySQL la clé étrangère de l’étage en `ADD CONSTRAINT`, jamais dans le `ADD COLUMN`', async () => {
    const sql: string[] = [];
    await migration043.up({
      dialecte: 'mysql',
      autoIncrement: 'AUTO_INCREMENT',
      texteLong: 'LONGTEXT',
      booleen: 'TINYINT(1)',
      horodatageParDefaut: 'DEFAULT CURRENT_TIMESTAMP',
      async executer(requete: string) {
        sql.push(requete);
        return { lastInsertRowid: 0, changes: 0 };
      },
      async interroger<T = any>(requete: string, params: any[] = []) {
        sql.push(requete);
        if (/TABLE_CONSTRAINTS/i.test(requete)) return [] as T[];
        const connues: Record<string, string[]> = {
          cle_sites: ['id', 'name'],
          site_pieces: ['id', 'site_id', 'name'],
          objects: ['id', 'name'],
        };
        return (connues[String(params[0] ?? '')] ?? []).map((name) => ({ COLUMN_NAME: name })) as T[];
      },
      async creerIndex() {
        /* vérifié par le banc partagé */
      },
    });

    const ajout = sql.find((r) => /ADD COLUMN etage_id/i.test(r))!;
    expect(ajout).not.toMatch(/REFERENCES/i);
    expect(sql.some((r) => /ADD CONSTRAINT fk_site_pieces_etage\b[\s\S]*ON DELETE SET NULL/i.test(r))).toBe(true);
    for (const requete of sql) {
      expect(requete).not.toMatch(/AUTOINCREMENT|\bPRAGMA\b|LONGTEXT\s+(NOT NULL\s+)?DEFAULT/i);
    }
  });
});

// ----------------------------------------------------------- la base partagée

let dossierPlans: string;
let avant: Set<string>;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  base.exec(SCHEMA_AVANT);
  await migration041.up(contexteSqlite(base));
  await migration043.up(contexteSqlite(base));

  base.exec(`
    INSERT INTO users (id, email, first_name, role) VALUES (1, 'admin@ville.fr', 'Ada', 'admin'),
      (4, 'ecole@ville.fr', 'Éric', 'agent'), (5, 'directrice@ville.fr', 'Dora', 'user'), (6, 'agent@ville.fr', 'Ugo', 'user');
    INSERT INTO cle_sites (id, name) VALUES (1, 'École'), (2, 'Mairie');
    INSERT INTO user_sites (user_id, site_id, gere_lieu, est_responsable) VALUES (4, 1, 1, 0), (5, 1, 0, 1);
    INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Classe A'), (2, 1, 'Classe B'), (3, 2, 'Salle du conseil');
    INSERT INTO objects (id, name, material_type, quantity_total) VALUES
      (10, 'Vidéoprojecteur', 'unique', 1),
      (11, 'Chaise', 'lot', 50),
      (12, 'Passe général', 'lot', 3),
      (13, 'Clé classe A', 'lot', 2),
      (14, 'Clé porte cour', 'lot', 1),
      (15, 'Clé classe B', 'lot', 1),
      (99, 'Matériel caché', 'unique', 1);
  `);
  dossierPlans = dossierPrive('plans');
  avant = new Set(fs.readdirSync(dossierPlans));
});

afterAll(() => {
  for (const { plan_chemin } of base.prepare('SELECT plan_chemin FROM site_etages WHERE plan_chemin IS NOT NULL').all() as any[]) {
    const complet = path.join(dossierPlans, plan_chemin);
    if (/^[\w.-]+$/.test(plan_chemin) && !avant.has(plan_chemin) && fs.existsSync(complet)) fs.unlinkSync(complet);
  }
});

// ----------------------------------------------------------- les surfaces

describe('La surface d’une pièce', () => {
  it('suit la formule du plan des espaces verts', () => {
    // Un carré de 10 % × 10 % sur un plan deux fois plus haut que large, où un
    // pourcent de largeur vaut 0,5 m : 100 %² × 0,25 m² × 2 = 50 m².
    const carre = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(surfaceEnM2(carre, { echelle: { metresParPourcent: 0.5, points: null }, plan: { mime: null, largeur: 100, hauteur: 200, ratio: 2 } })).toBe(50);
    expect(surfaceEnM2(carre, { echelle: null, plan: { mime: null, largeur: 100, hauteur: 200, ratio: 2 } })).toBeNull();
  });

  it('se recalcule quand on étalonne l’étage, et se perd quand on le supprime', async () => {
    base.prepare("INSERT INTO site_etages (id, site_id, nom, plan_chemin, plan_ratio) VALUES (50, 1, 'R+1', 'x.png', 1)").run();
    const carre = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect((await definirZone(2, { etageId: 50, points: carre })).surfaceM2).toBeNull();

    await modifierEtage(50, { echelle: { metresParPourcent: 0.2 } });
    expect(base.prepare('SELECT surface_m2 FROM site_pieces WHERE id = 2').get()).toEqual({ surface_m2: 4 });

    expect(await supprimerEtage(50)).toBe('x.png');
    expect(base.prepare('SELECT etage_id, zone_points, surface_m2 FROM site_pieces WHERE id = 2').get()).toEqual({
      etage_id: null,
      zone_points: null,
      surface_m2: null,
    });
  });

  it("refuse l'étage d'un autre bâtiment et un contour de deux points", async () => {
    base.prepare("INSERT INTO site_etages (id, site_id, nom) VALUES (60, 2, 'Mairie RDC')").run();
    await expect(definirZone(1, { etageId: 60, points: [] })).rejects.toThrow(/pas dans le bâtiment/);
    base.prepare("INSERT INTO site_etages (id, site_id, nom) VALUES (61, 1, 'École RDC')").run();
    await expect(definirZone(1, { etageId: 61, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).rejects.toThrow(/entre 3 et 500/);
    expect((await lireEtage(61))?.plan).toBeNull();
  });
});

// ----------------------------------------------------------- le matériel posé

describe('Le matériel posé dans une pièce', () => {
  it('ne double pas un matériel unique : il dit où il est, ou le déplace si on le demande', async () => {
    await placerMateriel(1, { objectId: 10 }, 1);
    await expect(placerMateriel(2, { objectId: 10 }, 1)).rejects.toThrow(/déjà dans Classe A — École/);

    const r = await placerMateriel(2, { objectId: 10, deplacer: true }, 1);
    expect(r.deplaceDe).toBe('Classe A — École');
    expect(base.prepare('SELECT piece_id FROM piece_materiels WHERE object_id = 10').all()).toEqual([{ piece_id: 2 }]);
  });

  it('répartit un lot sans dépasser sa quantité, et cumule dans la même pièce', async () => {
    await placerMateriel(1, { objectId: 11, quantite: 30 }, 1);
    await placerMateriel(1, { objectId: 11, quantite: 5 }, 1);
    await expect(placerMateriel(2, { objectId: 11, quantite: 20 }, 1)).rejects.toThrow(/il en reste 15/);
    await placerMateriel(2, { objectId: 11, quantite: 15 }, 1);
    expect(base.prepare('SELECT piece_id, quantite FROM piece_materiels WHERE object_id = 11 ORDER BY piece_id').all()).toEqual([
      { piece_id: 1, quantite: 35 },
      { piece_id: 2, quantite: 15 },
    ]);
  });

  it('compte parmi ce qui empêche de supprimer le bâtiment', async () => {
    const usages = await usagesSite(1);
    expect(usages.materiels).toBeGreaterThan(0);
    expect(usages.etages).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------- les clés

describe("Les clés qui ouvrent une pièce", () => {
  it('répondent sur les trois portées, avec leurs détenteurs', async () => {
    base.exec(`
      INSERT INTO cle_ouvrants (id, site_id, piece_id, name) VALUES (1, 1, 1, 'Porte de la cour'), (2, 1, 2, 'Porte classe B');
      INSERT INTO cle_ouvre (object_id, site_id) VALUES (12, 1);
      INSERT INTO cle_ouvre (object_id, piece_id) VALUES (13, 1);
      INSERT INTO cle_ouvre (object_id, ouvrant_id) VALUES (14, 1);
      INSERT INTO cle_ouvre (object_id, ouvrant_id) VALUES (15, 2);
      INSERT INTO cle_attributions (object_id, quantity, remise_on, holder_type, holder_label)
        VALUES (13, 1, '2026-09-01', 'autre', 'Mme Martin, institutrice');
    `);

    const cles = await clesDeLaPiece(1);
    expect(cles.map((c) => [c.nom, c.portee, c.porte])).toEqual([
      ['Clé classe A', 'piece', null],
      ['Clé porte cour', 'porte', 'Porte de la cour'],
      ['Passe général', 'batiment', null],
    ]);
    expect(cles.find((c) => c.nom === 'Clé classe A')!.detenteurs).toEqual(['Mme Martin, institutrice']);
  });
});

// ----------------------------------------------------------- les routes

describe('Les routes du plan', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/batiments', batimentRoutes);
  const ROLES: Record<number, string> = { 1: 'admin', 4: 'agent', 5: 'user', 6: 'user' };
  const en = (userId: number) => {
    (global as any).__connecte = { userId, role: ROLES[userId], email: `u${userId}@ville.fr` };
  };

  // Une image PNG valide d'un pixel.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  let etageId: number;

  it("laisse le gestionnaire créer un étage, et pas celui qui ne gère pas le bâtiment", async () => {
    en(6);
    expect((await request(app).post('/api/batiments/1/etages').send({ nom: 'R+2', niveau: 2 })).status).toBe(403);
    en(4);
    const r = await request(app).post('/api/batiments/1/etages').send({ nom: 'R+2', niveau: 2 });
    expect(r.status).toBe(201);
    etageId = r.body.id;
    expect((await request(app).post('/api/batiments/1/etages').send({ nom: '', niveau: 0 })).status).toBe(400);
  });

  it("n'accepte qu'une image comme plan, et en lit les dimensions", async () => {
    en(4);
    const pdf = await request(app)
      .post(`/api/batiments/etages/${etageId}/plan`)
      .attach('plan', Buffer.from('%PDF-1.4'), { filename: 'plan.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);

    const r = await request(app)
      .post(`/api/batiments/etages/${etageId}/plan`)
      .field('largeur', '800')
      .field('hauteur', '600')
      .attach('plan', PNG, { filename: 'plan.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    // sharp lit l'image elle-même : un pixel, pas les dimensions annoncées.
    expect(r.body.etage.plan).toMatchObject({ mime: 'image/png', largeur: 1, hauteur: 1, ratio: 1 });
  });

  it('sert le plan à qui consulte le bâtiment, sans cache, et à personne d’autre', async () => {
    en(4);
    const r = await request(app).get(`/api/batiments/etages/${etageId}/plan`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    en(6);
    expect((await request(app).get(`/api/batiments/etages/${etageId}/plan`)).status).toBe(403);
  });

  it('ne sert rien hors du dossier privé, même si la base le demande', async () => {
    const chemin = (base.prepare('SELECT plan_chemin FROM site_etages WHERE id = ?').get(etageId) as any).plan_chemin;
    base.prepare("UPDATE site_etages SET plan_chemin = '../../../package.json' WHERE id = ?").run(etageId);
    en(4);
    expect((await request(app).get(`/api/batiments/etages/${etageId}/plan`)).status).toBe(404);
    base.prepare('UPDATE site_etages SET plan_chemin = ? WHERE id = ?').run(chemin, etageId);
  });

  it('crée une pièce depuis un contour tracé, et la montre avec son étage', async () => {
    en(4);
    const r = await request(app)
      .post(`/api/batiments/etages/${etageId}/pieces`)
      .send({ nom: 'Salle informatique', typeLieu: 'Salle', points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }] });
    expect(r.status).toBe(201);
    const lecture = await request(app).get('/api/batiments/1/etages');
    const piece = lecture.body.pieces.find((p: any) => p.id === r.body.id);
    expect(piece).toMatchObject({ nom: 'Salle informatique', etageId, typeLieu: 'Salle' });
    expect(piece.zone).toHaveLength(3);
  });

  it("refuse de poser un matériel qu'on ne voit pas", async () => {
    en(4);
    expect((await request(app).post('/api/batiments/pieces/1/materiels').send({ objectId: 99 })).status).toBe(403);
  });

  it('dit, sur la fiche d’une pièce, son matériel et ses clés', async () => {
    en(4);
    const r = await request(app).get('/api/batiments/pieces/1');
    expect(r.status).toBe(200);
    expect(r.body.materiels.map((m: any) => [m.nom, m.quantite])).toEqual([['Chaise', 35]]);
    expect(r.body.cles.length).toBe(3);
    expect(r.body.portes).toEqual([{ id: 1, nom: 'Porte de la cour', code: null }]);
  });

  it("ne montre à la responsable que le matériel et les clés des catégories qui lui sont ouvertes", async () => {
    en(5);
    const r = await request(app).get('/api/batiments/pieces/1');
    expect(r.status).toBe(200);
    expect(r.body.materiels).toEqual([]);
    expect(r.body.cles.map((c: any) => c.nom)).toEqual(['Clé classe A', 'Clé porte cour']);
    const tout = await request(app).get('/api/batiments/1/materiels');
    expect(tout.body.materiels.map((m: any) => m.nom)).toEqual(['Vidéoprojecteur']);
  });
});
