import type BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import express from 'express';

/**
 * Qui demande, qui intervient, qui supervise — et ce que chacun a le droit de
 * faire d'une demande.
 *
 * Deux choses sont figées ici :
 *
 *   **Le rattrapage de la migration 045 ne retire rien.** Qui voyait les
 *   demandes d'une catégorie par son service devient intervenant de cette
 *   catégorie ; son responsable, superviseur. Une ligne existante n'est que
 *   montée, et garde son exception de matériel.
 *
 *   **Les routes ne font plus confiance au corps de la requête.** Un demandeur
 *   ne choisit ni une catégorie qu'on ne lui propose pas, ni son technicien, ni
 *   le statut de sa demande ; on ne confie pas une demande de bâtiment à
 *   l'informaticien.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseDroits = sqlite;

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
      async transaction<T>(travail: () => Promise<T>): Promise<T> {
        return travail();
      },
    },
  };
});

jest.mock('../src/services/ticketNotify.service', () => ({
  notifierAffectation: jest.fn(),
  notifierMessage: jest.fn(),
  notifierOuverture: jest.fn(),
  notifierStatut: jest.fn(),
}));

/** L'identité seule est simulée ; les gardes de portée sont les vraies. */
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupervisor: (_req: any, _res: any, next: any) => next(),
}));

import migration032 from '../src/database/migrations/032_tickets';
import migration035 from '../src/database/migrations/035_tickets_rattachements';
import migration045 from '../src/database/migrations/045_tickets_niveaux';
import migration046 from '../src/database/migrations/046_tickets_cloture';
import migration047 from '../src/database/migrations/047_formulaire_par_personne';
import type { ContexteMigration } from '../src/database/migrations/types';
import ticketRoutes from '../src/routes/ticket.routes';

const base: BetterSqlite3.Database = (global as any).__baseDroits;

const ADMIN = 1;
const CHEF_INFO = 2;
const AGENT_TECH = 3;
const CHEF_TECH = 4;
const DEMANDEUR = 5;

const SERVICE_INFO = 1;
const SERVICE_TECH = 2;
const MAIRIE = 1;

let CAT_INFO = 0;
let CAT_BATIMENT = 0;
let CAT_EV = 0;
let SOUS_TONTE = 0;
let EN_COURS = 0;

const ctx: ContexteMigration = {
  executer: async (sql, params) => {
    const r = base.prepare(sql).run(...(params ?? []));
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
  },
  interroger: async (sql, params) => base.prepare(sql).all(...(params ?? [])) as any[],
  creerIndex: async (nom, table, colonnes) => {
    base.exec(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`);
  },
  dialecte: 'sqlite',
  autoIncrement: 'AUTOINCREMENT',
  texteLong: 'TEXT',
  booleen: 'INTEGER',
  horodatageParDefaut: "DEFAULT (datetime('now'))",
};

const app = express();
app.use(express.json());
app.use('/api/tickets', ticketRoutes);

function commeSi(userId: number, role: string) {
  (global as any).__connecte = { userId, role, email: `${userId}@ville.fr` };
}

const niveauDe = (userId: number, categorieId: number) =>
  (
    base
      .prepare('SELECT niveau, materiel_autorise FROM user_ticket_categories WHERE user_id = ? AND ticket_categorie_id = ?')
      .get(userId, categorieId) as any
  ) ?? null;

beforeAll(async () => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100));
    CREATE TABLE service_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0
    );
    CREATE TABLE planning_superviseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id INTEGER, superviseur_id INTEGER, intitule VARCHAR(160)
    );
    CREATE TABLE module_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, module_name VARCHAR(100), role VARCHAR(50), can_view INTEGER DEFAULT 0
    );
    CREATE TABLE user_module_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, module_name VARCHAR(100), can_view INTEGER DEFAULT 0
    );
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      location VARCHAR(255), category_id INTEGER, subcategory_id INTEGER);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), code VARCHAR(50),
      address VARCHAR(500), sort_order INTEGER DEFAULT 0);
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY, site_id INTEGER, name VARCHAR(255));
  `);

  await migration032.up(ctx);
  await migration035.up(ctx);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${CHEF_INFO}, 'info@ville.fr', 'Ines', 'Info', 'supervisor'),
      (${AGENT_TECH}, 'agent@ville.fr', 'Ali', 'Agent', 'agent'),
      (${CHEF_TECH}, 'tech@ville.fr', 'Tom', 'Tech', 'supervisor'),
      (${DEMANDEUR}, 'secr@ville.fr', 'Sam', 'Secret', 'user');

    INSERT INTO services (id, name, slug) VALUES
      (${SERVICE_INFO}, 'Informatique', 'informatique'),
      (${SERVICE_TECH}, 'Technique', 'technique');
    INSERT INTO service_members (service_id, user_id, is_manager) VALUES
      (${SERVICE_INFO}, ${CHEF_INFO}, 1),
      (${SERVICE_TECH}, ${CHEF_TECH}, 1),
      (${SERVICE_TECH}, ${AGENT_TECH}, 0);

    INSERT INTO cle_sites (id, name) VALUES (${MAIRIE}, 'Mairie');

    INSERT INTO ticket_statuts (nom, slug, couleur, ordre, is_ouvert, is_defaut, is_final, is_systeme)
    VALUES
      ('À traiter', 'a-traiter', 'red', 1, 1, 1, 0, 1),
      ('En cours', 'en-cours', 'blue', 2, 1, 0, 0, 0),
      ('Résolu', 'resolu', 'green', 5, 0, 0, 1, 1);

    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, ordre, service_id, visibilite, materiel_mode, site_mode)
    VALUES
      ('Informatique', 'informatique', 0, 1, ${SERVICE_INFO}, 'privee', 'aucun', 'auto'),
      ('Bâtiment', 'batiment', 0, 2, ${SERVICE_TECH}, 'site', 'aucun', 'auto'),
      -- Espaces verts n'a pas de service : seule sa sous-catégorie en route un.
      ('Espaces verts', 'espaces-verts', 0, 3, NULL, 'site', 'aucun', 'auto');
  `);

  const categorie = (slug: string) =>
    Number((base.prepare('SELECT id FROM ticket_categories WHERE name_normalise = ?').get(slug) as any).id);
  CAT_INFO = categorie('informatique');
  CAT_BATIMENT = categorie('batiment');
  CAT_EV = categorie('espaces-verts');
  base
    .prepare(
      `INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle, ordre, service_id)
       VALUES ('Tonte', 'tonte', ?, ?, 1, ?)`
    )
    .run(CAT_EV, CAT_EV, SERVICE_TECH);
  SOUS_TONTE = categorie('tonte');

  const statut = (slug: string) =>
    Number((base.prepare('SELECT id FROM ticket_statuts WHERE slug = ?').get(slug) as any).id);
  EN_COURS = statut('en-cours');

  // Avant la migration : le demandeur a le droit de demander du bâtiment, et
  // l'agent technique a une exception de matériel qu'il faudra garder.
  base.exec(`
    INSERT INTO user_ticket_categories (user_id, ticket_categorie_id, materiel_autorise) VALUES
      (${DEMANDEUR}, ${CAT_BATIMENT}, NULL),
      (${AGENT_TECH}, ${CAT_BATIMENT}, 0);
  `);

  await migration045.up(ctx);
  await migration046.up(ctx);
  await migration047.up(ctx);
});

describe('Le rattrapage de la migration 045', () => {
  it('fait du responsable du service un superviseur, et de ses membres des intervenants', () => {
    expect(niveauDe(CHEF_TECH, CAT_BATIMENT)?.niveau).toBe('superviseur');
    expect(niveauDe(CHEF_INFO, CAT_INFO)?.niveau).toBe('superviseur');
    expect(niveauDe(AGENT_TECH, CAT_BATIMENT)?.niveau).toBe('intervenant_categorie');
  });

  it('monte une ligne existante sans perdre son exception de matériel', () => {
    expect(niveauDe(AGENT_TECH, CAT_BATIMENT)?.materiel_autorise).toBe(0);
  });

  it('ramène à sa racine le service qu’une sous-catégorie route', () => {
    expect(niveauDe(CHEF_TECH, CAT_EV)?.niveau).toBe('superviseur');
    expect(niveauDe(CHEF_TECH, SOUS_TONTE)).toBeNull();
  });

  it('laisse le demandeur demandeur, et n’ouvre rien hors de son service', () => {
    expect(niveauDe(DEMANDEUR, CAT_BATIMENT)?.niveau).toBe('demandeur');
    expect(niveauDe(CHEF_INFO, CAT_BATIMENT)).toBeNull();
  });

  it('ne change rien quand on la rejoue', async () => {
    const avant = base.prepare('SELECT user_id, ticket_categorie_id, niveau FROM user_ticket_categories ORDER BY id').all();
    await migration045.up(ctx);
    expect(base.prepare('SELECT user_id, ticket_categorie_id, niveau FROM user_ticket_categories ORDER BY id').all()).toEqual(avant);
  });
});

describe('Les gardes des routes', () => {
  let ticketId = 0;

  beforeAll(() => {
    // L'agent ne traite plus les espaces verts : il y redevient demandeur.
    base
      .prepare(`UPDATE user_ticket_categories SET niveau = 'demandeur' WHERE user_id = ? AND ticket_categorie_id = ?`)
      .run(AGENT_TECH, CAT_EV);
  });

  it('refuse une catégorie qu’on ne propose pas au demandeur', async () => {
    commeSi(DEMANDEUR, 'user');
    const res = await request(app).post('/api/tickets').send({ titre: 'Écran noir', categorieId: CAT_INFO });
    expect(res.status).toBe(403);
  });

  it('ignore le technicien et le service qu’un demandeur se choisirait', async () => {
    commeSi(DEMANDEUR, 'user');
    const res = await request(app).post('/api/tickets').send({
      titre: 'Fenêtre bloquée',
      categorieId: CAT_BATIMENT,
      siteId: MAIRIE,
      technicienId: CHEF_INFO,
      serviceId: SERVICE_INFO,
    });
    expect(res.status).toBe(201);
    ticketId = res.body.id;

    const ligne = base.prepare('SELECT service_id, technicien_id FROM tickets WHERE id = ?').get(ticketId) as any;
    expect(ligne.service_id).toBe(SERVICE_TECH);
    expect(ligne.technicien_id).toBeNull();
  });

  it('ne laisse pas le demandeur changer le statut de sa demande', async () => {
    commeSi(DEMANDEUR, 'user');
    const res = await request(app).put(`/api/tickets/${ticketId}/statut`).send({ statutId: EN_COURS });
    expect(res.status).toBe(403);
  });

  it('le laisse corriger son titre, mais pas la priorité', async () => {
    commeSi(DEMANDEUR, 'user');
    expect((await request(app).put(`/api/tickets/${ticketId}`).send({ titre: 'Fenêtre bloquée au 1er' })).status).toBe(200);
    expect((await request(app).put(`/api/tickets/${ticketId}`).send({ priorite: 'urgente' })).status).toBe(403);
  });

  it('laisse l’intervenant de la catégorie changer le statut', async () => {
    commeSi(AGENT_TECH, 'agent');
    const res = await request(app).put(`/api/tickets/${ticketId}/statut`).send({ statutId: EN_COURS });
    expect(res.status).toBe(200);
  });

  it('refuse de confier une demande de bâtiment à l’informatique', async () => {
    commeSi(AGENT_TECH, 'agent');
    const refus = await request(app).put(`/api/tickets/${ticketId}`).send({ technicienId: CHEF_INFO });
    expect(refus.status).toBe(400);

    const accord = await request(app).put(`/api/tickets/${ticketId}`).send({ technicienId: CHEF_TECH });
    expect(accord.status).toBe(200);
  });

  it('ne propose que les intervenants de la catégorie', async () => {
    commeSi(AGENT_TECH, 'agent');
    const res = await request(app).get(`/api/tickets/intervenants?categorieId=${CAT_BATIMENT}`);
    expect(res.status).toBe(200);
    const ids = res.body.intervenants.map((i: any) => i.id);
    expect(ids).toEqual(expect.arrayContaining([CHEF_TECH, AGENT_TECH]));
    expect(ids).not.toContain(CHEF_INFO);
    expect(ids).not.toContain(DEMANDEUR);
  });

  it('refuse la liste des intervenants à un simple demandeur', async () => {
    commeSi(DEMANDEUR, 'user');
    expect((await request(app).get(`/api/tickets/intervenants?categorieId=${CAT_BATIMENT}`)).status).toBe(403);
  });

  it('la donne, pour sa demande, à qui on l’a confiée — comme la réaffectation', async () => {
    const avant = (base.prepare('SELECT technicien_id FROM tickets WHERE id = ?').get(ticketId) as any).technicien_id;
    base.prepare('UPDATE tickets SET technicien_id = ? WHERE id = ?').run(DEMANDEUR, ticketId);
    try {
      commeSi(DEMANDEUR, 'user');
      // La catégorie demandée est ignorée : c'est celle de la demande qui compte.
      const res = await request(app).get(`/api/tickets/intervenants?categorieId=${CAT_INFO}&ticketId=${ticketId}`);
      expect(res.status).toBe(200);
      const ids = res.body.intervenants.map((i: any) => i.id);
      expect(ids).toEqual(expect.arrayContaining([CHEF_TECH, AGENT_TECH]));
      expect(ids).not.toContain(CHEF_INFO);

      // Sans la demande, la règle générale tient toujours.
      expect((await request(app).get(`/api/tickets/intervenants?categorieId=${CAT_BATIMENT}`)).status).toBe(403);
    } finally {
      base.prepare('UPDATE tickets SET technicien_id = ? WHERE id = ?').run(avant, ticketId);
    }

    // Plus confiée : plus de liste, même en nommant la demande.
    commeSi(DEMANDEUR, 'user');
    const refus = await request(app).get(`/api/tickets/intervenants?categorieId=${CAT_BATIMENT}&ticketId=${ticketId}`);
    expect([403, 404]).toContain(refus.status);
  });

  it('rend les niveaux dans les permissions', async () => {
    commeSi(CHEF_TECH, 'supervisor');
    const res = await request(app).get('/api/tickets/permissions');
    expect(res.body.estSuperviseur).toBe(true);
    expect(res.body.niveaux).toEqual(
      expect.arrayContaining([expect.objectContaining({ categorieId: CAT_BATIMENT, niveau: 'superviseur' })])
    );
  });
});

describe('Les champs du formulaire, tenus par le serveur', () => {
  afterEach(() => {
    base.prepare('DELETE FROM user_ticket_reglages').run();
  });

  it('refuse une demande sans le bâtiment qu’on exige de cette personne', async () => {
    base.prepare("INSERT INTO user_ticket_reglages (user_id, site_mode) VALUES (?, 'requis')").run(DEMANDEUR);
    commeSi(DEMANDEUR, 'user');
    const res = await request(app).post('/api/tickets').send({ titre: 'Volet cassé', categorieId: CAT_BATIMENT });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bâtiment/);
  });

  it('ignore le bâtiment qu’on a masqué pour elle', async () => {
    base.prepare("INSERT INTO user_ticket_reglages (user_id, site_mode) VALUES (?, 'masque')").run(DEMANDEUR);
    commeSi(DEMANDEUR, 'user');
    const res = await request(app)
      .post('/api/tickets')
      .send({ titre: 'Radiateur', categorieId: CAT_BATIMENT, siteId: MAIRIE });
    expect(res.status).toBe(201);
    expect((base.prepare('SELECT site_id FROM tickets WHERE id = ?').get(res.body.id) as any).site_id).toBeNull();
  });
});
