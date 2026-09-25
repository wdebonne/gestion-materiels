import request from 'supertest';
import express from 'express';
import type BetterSqlite3 from 'better-sqlite3';
import migration040 from '../src/database/migrations/040_gestion_organisation';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Qui gère les bâtiments, les salles et les services.
 *
 * Trois choses sont figées ici, parce qu'aucune ne se verrait à l'écran :
 *
 *   **Le gestionnaire local ne s'étend pas lui-même.** Celui d'un bâtiment ne
 *   fait pas d'autres gestionnaires, n'écrit pas dans un bâtiment voisin et
 *   n'y accroche pas ses portes ; le responsable d'un service ne désigne pas
 *   d'autre responsable. Le jour où l'une de ces portes s'ouvre, rien ne
 *   casse : quelqu'un a simplement plus de droits qu'on ne lui en a donné.
 *
 *   **Le superviseur garde les lieux.** Il les gérait avant la délégation ;
 *   la lui retirer serait une régression déguisée en réglage.
 *
 *   **Le formulaire ne voit que des salles prêtables.** `/salles` est public :
 *   une salle non ouverte au prêt, ou un bâtiment entier, n'a rien à y faire.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseOrganisation = sqlite;

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

/** L'identité seule est simulée ; les gardes de gestion sont les vraies. */
jest.mock('../src/middleware/auth.middleware', () => {
  const courant = () => (global as any).__connecte;
  const exige =
    (...roles: string[]) =>
    (_req: any, res: any, next: any) =>
      roles.includes(courant().role)
        ? next()
        : res.status(403).json({ success: false, message: 'Accès refusé' });

  return {
    authenticateToken: (req: any, _res: any, next: any) => {
      req.user = courant();
      next();
    },
    requireAdmin: exige('admin'),
    requireSupervisor: exige('admin', 'supervisor'),
    requireFieldWrite: exige('admin', 'supervisor', 'agent'),
  };
});

import {
  peutGererLieux,
  peutGererService,
  peutGererServices,
  peutGererSite,
} from '../src/services/gestionOrganisation.service';
import { lieuxPretables, listerSalles, normaliserTypeLieu } from '../src/services/lieux.service';

// --------------------------------------------------------------- outillage

/** Le schéma que la migration 040 trouve devant elle. */
const SCHEMA_AVANT = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user', is_active INTEGER DEFAULT 1, can_login INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE cle_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, code VARCHAR(50),
    address VARCHAR(500), sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
    pretable INTEGER, created_at DATETIME, updated_at DATETIME
  );
  CREATE TABLE site_pieces (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
    code VARCHAR(50), description TEXT, type_lieu VARCHAR(50), capacite INTEGER, pretable INTEGER,
    sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE cle_ouvrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, piece_id INTEGER,
    name VARCHAR(255) NOT NULL, code VARCHAR(50), description TEXT, sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE cle_ouvre (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, site_id INTEGER, ouvrant_id INTEGER);
  CREATE TABLE user_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, site_id INTEGER NOT NULL,
    peut_voir_tickets INTEGER NOT NULL DEFAULT 0, est_responsable INTEGER NOT NULL DEFAULT 0,
    notifie INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at DATETIME,
    UNIQUE(user_id, site_id)
  );
  CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255), is_active INTEGER DEFAULT 1);
  CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
  CREATE TABLE service_categories (service_id INTEGER, category_id INTEGER);
  CREATE TABLE service_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0,
    created_at DATETIME, UNIQUE(service_id, user_id)
  );
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

const colonnes = (sqlite: BetterSqlite3.Database, table: string): string[] =>
  (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);

const ADMIN = { userId: 1, email: 'admin@ville.fr', role: 'admin' };
const SUPERVISEUR = { userId: 2, email: 'chef@ville.fr', role: 'supervisor' };
/** Agent, gestionnaire de toute l'organisation. */
const REGISSEUR = { userId: 3, email: 'regie@ville.fr', role: 'agent' };
/** Agent, gestionnaire de la seule école (site 2). */
const DIRECTRICE = { userId: 4, email: 'ecole@ville.fr', role: 'agent' };
/** Agent sans aucune gestion. */
const AGENT = { userId: 5, email: 'agent@ville.fr', role: 'agent' };
/** Responsable du service des sports (service 1). */
const CHEF_SPORTS = { userId: 6, email: 'sports@ville.fr', role: 'user' };

function connecte(qui: { userId: number; email: string; role: string }): void {
  (global as any).__connecte = qui;
}

let sqlite: BetterSqlite3.Database;

beforeAll(async () => {
  // La fausse base naît à l'import du service, plus haut.
  sqlite = (global as any).__baseOrganisation;
  sqlite.exec(SCHEMA_AVANT);
  sqlite.exec(`
    INSERT INTO users (id, email, role) VALUES
      (1, 'admin@ville.fr', 'admin'), (2, 'chef@ville.fr', 'supervisor'),
      (3, 'regie@ville.fr', 'agent'), (4, 'ecole@ville.fr', 'agent'),
      (5, 'agent@ville.fr', 'agent'), (6, 'sports@ville.fr', 'user');
    INSERT INTO cle_sites (id, name, pretable) VALUES (1, 'Mairie', NULL), (2, 'École', NULL), (3, 'Salle des fêtes', 1);
    INSERT INTO site_pieces (id, site_id, name, type_lieu, capacite, pretable) VALUES
      (10, 1, 'Salle du conseil', 'salle ', 40, 1),
      (11, 1, 'Salle des mariages', 'Salle', 60, 1),
      (12, 1, 'Salle du CCAS', 'SALLE', 12, NULL),
      (13, 1, 'Local électrique', 'Local', NULL, NULL),
      (20, 2, 'Préau', 'Préau', NULL, 1),
      (30, 3, 'Grande salle', 'Salle', 300, NULL);
    INSERT INTO cle_ouvrants (id, site_id, piece_id, name) VALUES (100, 2, 20, 'Porte du préau');
    INSERT INTO user_sites (user_id, site_id) VALUES (4, 2);
    INSERT INTO services (id, name) VALUES (1, 'Sports'), (2, 'Informatique');
    INSERT INTO service_members (service_id, user_id, is_manager) VALUES (1, 6, 1);
  `);
  await migration040.up(contexteSqlite(sqlite));
  sqlite.exec(`
    UPDATE users SET gere_organisation = 1 WHERE id = 3;
    UPDATE user_sites SET gere_lieu = 1 WHERE user_id = 4 AND site_id = 2;
  `);
});

// ------------------------------------------------------------- la migration

describe('Migration 040', () => {
  it('ajoute les deux niveaux de gestion', () => {
    expect(colonnes(sqlite, 'users')).toContain('gere_organisation');
    expect(colonnes(sqlite, 'user_sites')).toContain('gere_lieu');
  });

  it('ramène « salle », « SALLE » et « salle  » à « Salle », sans toucher aux autres types', () => {
    const types = sqlite.prepare('SELECT id, type_lieu FROM site_pieces ORDER BY id').all();
    expect(types).toEqual([
      { id: 10, type_lieu: 'Salle' },
      { id: 11, type_lieu: 'Salle' },
      { id: 12, type_lieu: 'Salle' },
      { id: 13, type_lieu: 'Local' },
      { id: 20, type_lieu: 'Préau' },
      { id: 30, type_lieu: 'Salle' },
    ]);
  });

  it('se rejoue sans rien casser ni défaire', async () => {
    await expect(migration040.up(contexteSqlite(sqlite))).resolves.not.toThrow();
    const regie = sqlite.prepare('SELECT gere_organisation FROM users WHERE id = 3').get() as any;
    expect(regie.gere_organisation).toBe(1);
  });

  /**
   * Le banc MySQL partagé répond `[]` à toute lecture de colonnes : la garde
   * fait sortir la migration avant tout SQL. On la rejoue donc contre un
   * contexte qui répond, pour lire ce qu'elle écrit vraiment.
   */
  it('écrit sur MySQL des booléens TINYINT(1) non nuls', async () => {
    const sql: string[] = [];
    const connues: Record<string, string[]> = {
      users: ['id', 'email'],
      user_sites: ['id', 'user_id', 'site_id'],
      site_pieces: ['id', 'type_lieu'],
    };
    await migration040.up({
      dialecte: 'mysql',
      autoIncrement: 'AUTO_INCREMENT',
      texteLong: 'LONGTEXT',
      booleen: 'TINYINT(1)',
      horodatageParDefaut: 'DEFAULT CURRENT_TIMESTAMP',
      async executer(requete: string) {
        sql.push(requete);
        return { lastInsertRowid: 0, changes: 0 };
      },
      async interroger<T = any>(_requete: string, params: any[] = []) {
        return (connues[String(params[0])] ?? []).map((n) => ({ COLUMN_NAME: n })) as T[];
      },
      async creerIndex() {},
    });
    expect(sql).toEqual(
      expect.arrayContaining([
        'ALTER TABLE users ADD COLUMN gere_organisation TINYINT(1) NOT NULL DEFAULT 0',
        'ALTER TABLE user_sites ADD COLUMN gere_lieu TINYINT(1) NOT NULL DEFAULT 0',
        expect.stringMatching(/UPDATE site_pieces SET type_lieu = 'Salle'/),
      ])
    );
  });
});

// ----------------------------------------------------------------- les règles

describe('Qui gère quoi', () => {
  it('laisse les lieux à l’administrateur, au superviseur et au gestionnaire global', async () => {
    expect(await peutGererLieux(ADMIN)).toBe(true);
    expect(await peutGererLieux(SUPERVISEUR)).toBe(true);
    expect(await peutGererLieux(REGISSEUR)).toBe(true);
    expect(await peutGererLieux(DIRECTRICE)).toBe(false);
    expect(await peutGererLieux(AGENT)).toBe(false);
  });

  it('n’ouvre pas les services au superviseur, qui ne les gérait pas', async () => {
    expect(await peutGererServices(ADMIN)).toBe(true);
    expect(await peutGererServices(REGISSEUR)).toBe(true);
    expect(await peutGererServices(SUPERVISEUR)).toBe(false);
  });

  it('borne le gestionnaire local à son bâtiment', async () => {
    expect(await peutGererSite(DIRECTRICE, 2)).toBe(true);
    expect(await peutGererSite(DIRECTRICE, 1)).toBe(false);
    expect(await peutGererSite(AGENT, 2)).toBe(false);
  });

  it('borne le responsable à son service', async () => {
    expect(await peutGererService(CHEF_SPORTS, 1)).toBe(true);
    expect(await peutGererService(CHEF_SPORTS, 2)).toBe(false);
  });
});

// ------------------------------------------------------------------ les routes

describe('Les routes, telles que les gardes les tiennent', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/organisation', require('../src/routes/organisation.routes').default);
    app.use('/api/lieux/public', require('../src/routes/lieuPublic.routes').default);
    app.use('/api/sites', require('../src/routes/site.routes').default);
    app.use('/api/cles', require('../src/routes/cle.routes').default);
    app.use('/api/services', require('../src/routes/service.routes').default);
  });

  it('laisse le responsable des sports ajouter un membre, pas désigner un autre responsable', async () => {
    connecte(CHEF_SPORTS);
    expect((await request(app).post('/api/services/1/members').send({ user_id: 5 })).status).toBe(201);
    expect((await request(app).post('/api/services/1/members').send({ user_id: 2, is_manager: true })).status).toBe(403);
    expect((await request(app).put('/api/services/1/members/5').send({ is_manager: true })).status).toBe(403);
    expect((await request(app).delete('/api/services/1/members/5')).status).toBe(200);
  });

  it('ne laisse pas le responsable se retirer, ni toucher à un autre service', async () => {
    connecte(CHEF_SPORTS);
    expect((await request(app).delete('/api/services/1/members/6')).status).toBe(403);
    expect((await request(app).post('/api/services/2/members').send({ user_id: 5 })).status).toBe(403);
    expect((await request(app).post('/api/services').send({ name: 'Culture' })).status).toBe(403);
  });

  it('laisse la directrice renommer une salle de son école, pas une salle de la mairie', async () => {
    connecte(DIRECTRICE);
    expect((await request(app).put('/api/sites/pieces/20').send({ nom: 'Préau couvert' })).status).toBe(200);
    expect((await request(app).put('/api/sites/pieces/10').send({ nom: 'Piratée' })).status).toBe(403);
  });

  it('ne lui laisse pas créer de bâtiment, ni une salle ailleurs que chez elle', async () => {
    connecte(DIRECTRICE);
    expect((await request(app).post('/api/sites').send({ nom: 'Annexe' })).status).toBe(403);
    expect((await request(app).post('/api/sites/pieces').send({ siteId: 1, nom: 'Bureau' })).status).toBe(403);
    expect((await request(app).post('/api/sites/pieces').send({ siteId: 2, nom: 'Salle de classe', typeLieu: 'salle' })).status).toBe(201);
  });

  it('refuse d’accrocher une porte de l’école à une salle de la mairie', async () => {
    connecte(DIRECTRICE);
    const reponse = await request(app).put('/api/cles/ouvrants/100').send({ name: 'Porte', pieceId: 10 });
    expect(reponse.status).toBe(400);
  });

  it('lui laisse rattacher un collègue, mais pas en faire un gestionnaire', async () => {
    connecte(DIRECTRICE);
    expect((await request(app).put('/api/sites/2/membres/5').send({ notifie: true })).status).toBe(200);
    expect((await request(app).put('/api/sites/2/membres/5').send({ gereLieu: true })).status).toBe(403);

    const membres = await request(app).get('/api/sites/2/membres');
    expect(membres.body.peutAccorderGestion).toBe(false);
    expect(membres.body.membres.find((m: any) => m.userId === 5)).toMatchObject({ notifie: true, gereLieu: false });
  });

  it('ne lui laisse pas retirer un autre gestionnaire — ni elle-même', async () => {
    connecte(DIRECTRICE);
    expect((await request(app).delete('/api/sites/2/membres/4')).status).toBe(403);
  });

  it('laisse le gestionnaire global faire un gestionnaire de bâtiment', async () => {
    connecte(REGISSEUR);
    expect((await request(app).put('/api/sites/1/membres/5').send({ gereLieu: true })).status).toBe(200);
    connecte(AGENT);
    expect((await request(app).put('/api/sites/pieces/13').send({ capacite: 2 })).status).toBe(200);
  });

  it('réserve la désignation des gestionnaires globaux à l’administrateur', async () => {
    connecte(REGISSEUR);
    expect((await request(app).put('/api/organisation/gestionnaires/5').send({ gereOrganisation: true })).status).toBe(403);
    connecte(ADMIN);
    expect((await request(app).put('/api/organisation/gestionnaires/5').send({ gereOrganisation: true })).status).toBe(200);
    expect((await request(app).put('/api/organisation/gestionnaires/5').send({ gereOrganisation: false })).status).toBe(200);
  });

  it('ouvre la liste des personnes à qui gère quelque chose, et à lui seul', async () => {
    connecte(DIRECTRICE);
    const reponse = await request(app).get('/api/organisation/personnes');
    expect(reponse.status).toBe(200);
    expect(reponse.body.personnes.length).toBeGreaterThan(0);
    connecte({ userId: 99, email: 'x@ville.fr', role: 'user' });
    expect((await request(app).get('/api/organisation/personnes')).status).toBe(403);
  });

  it('dit à chacun ce qu’il gère', async () => {
    connecte(DIRECTRICE);
    const moi = await request(app).get('/api/organisation/moi');
    expect(moi.body).toMatchObject({ gereOrganisation: false, gereLieux: false, sitesGeres: [2] });
  });

  it('liste les salles et dit lesquelles l’appelant peut modifier', async () => {
    connecte(DIRECTRICE);
    const reponse = await request(app).get('/api/organisation/salles');
    const salles = reponse.body.salles;
    expect(salles.map((s: any) => s.libelle)).toEqual(
      expect.arrayContaining(['Salle du conseil — Mairie', 'Grande salle — Salle des fêtes', 'Salle de classe — École'])
    );
    expect(salles.every((s: any) => s.modifiable === (s.siteId === 2))).toBe(true);
  });

  it('ne publie au formulaire que les salles ouvertes au prêt, jamais un bâtiment entier', async () => {
    const reponse = await request(app).get('/api/lieux/public/salles');
    expect(reponse.status).toBe(200);
    const libelles = reponse.body.lieux.map((l: any) => l.libelle);
    // La grande salle hérite du prêt de la salle des fêtes ; celle du CCAS
    // n'en hérite de rien, la mairie n'étant pas ouverte au prêt.
    expect(libelles).toEqual([
      'Salle des mariages — Mairie',
      'Salle du conseil — Mairie',
      'Grande salle — Salle des fêtes',
    ]);
    expect(reponse.body.lieux.every((l: any) => l.pieceId !== null && l.typeLieu === 'Salle')).toBe(true);
  });

  it('filtre /disponibilite par type sans tenir compte de la casse', async () => {
    const reponse = await request(app).get('/api/lieux/public/disponibilite?type=préau');
    expect(reponse.body.lieux.map((l: any) => l.nom)).toEqual(['Préau couvert']);
  });
});

// ------------------------------------------------ « Qui a droit à quoi »

describe('Enregistrer les rattachements d’un compte', () => {
  /*
   * L'écran « Qui a droit à quoi » remplace tous les rattachements d'un compte
   * d'un coup, et ne connaît pas « Gère ». Sans reprise, enregistrer la fiche
   * de la directrice lui retirait en silence la gestion de son école.
   */
  it('garde la gestion d’un bâtiment qu’on ne mentionne pas', async () => {
    const { definirSitesDe } = require('../src/services/sites.service');
    await definirSitesDe(4, [{ siteId: 2, notifie: true }], 1);
    const ligne = sqlite.prepare('SELECT gere_lieu, notifie FROM user_sites WHERE user_id = 4 AND site_id = 2').get();
    expect(ligne).toEqual({ gere_lieu: 1, notifie: 1 });
  });
});

// ------------------------------------------------------------- les salles

describe('Les salles', () => {
  it('normalise le seul type « Salle »', () => {
    expect(normaliserTypeLieu(' salle ')).toBe('Salle');
    expect(normaliserTypeLieu('Hall')).toBe('Hall');
    expect(normaliserTypeLieu('')).toBeNull();
  });

  it('calcule le prêt effectif d’une salle qui suit son bâtiment', async () => {
    const salles = await listerSalles();
    expect(salles.find((s) => s.id === 30)?.pretableEffectif).toBe(true);
    expect(salles.find((s) => s.id === 12)?.pretableEffectif).toBe(false);
  });

  it('garde les bâtiments entiers quand on ne filtre pas', async () => {
    const lieux = await lieuxPretables();
    expect(lieux.some((l) => l.pieceId === null && l.nom === 'Salle des fêtes')).toBe(true);
  });
});
