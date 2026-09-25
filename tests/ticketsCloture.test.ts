import type BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import express from 'express';

/**
 * Terminer une demande en disant le temps passé et qui a aidé ; la faire
 * valider quand l'agent n'est pas autonome.
 *
 * Ce qui est figé ici :
 *
 *   **Une seule vérité pour le temps.** Terminer crée une tâche de planning
 *   liée à la demande, avec ses renforts ; la corriger à la validation la
 *   modifie en place, sans la dupliquer.
 *
 *   **L'autonomie décide de l'état.** Autonome : résolue. Sinon « À valider »,
 *   non close, et seul le superviseur de la catégorie en sort — en validant, ou
 *   en renvoyant avec un motif.
 *
 *   **Tout ou rien.** Une saisie refusée ne laisse ni tâche ni changement d'état.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCloture = sqlite;

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
      // Une vraie transaction : le test du « tout ou rien » en dépend.
      async transaction<T>(travail: () => Promise<T>): Promise<T> {
        if ((global as any).__dansTransaction) return travail();
        (global as any).__dansTransaction = true;
        sqlite.exec('BEGIN');
        try {
          const resultat = await travail();
          sqlite.exec('COMMIT');
          return resultat;
        } catch (erreur) {
          sqlite.exec('ROLLBACK');
          throw erreur;
        } finally {
          (global as any).__dansTransaction = false;
        }
      },
    },
  };
});

jest.mock('../src/services/ticketNotify.service', () => ({
  notifierAffectation: jest.fn(),
  notifierAValider: jest.fn(),
  notifierMessage: jest.fn(),
  notifierOuverture: jest.fn(),
  notifierStatut: jest.fn(),
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  // Le reste du module — la portée du parc, que la liste consulte — est le vrai.
  ...jest.requireActual('../src/middleware/auth.middleware'),
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupervisor: (_req: any, _res: any, next: any) => next(),
}));

import migration031 from '../src/database/migrations/031_plannings_et_heures';
import migration032 from '../src/database/migrations/032_tickets';
import migration034 from '../src/database/migrations/034_tickets_temps_et_reprise';
import migration035 from '../src/database/migrations/035_tickets_rattachements';
import migration045 from '../src/database/migrations/045_tickets_niveaux';
import migration046 from '../src/database/migrations/046_tickets_cloture';
import type { ContexteMigration } from '../src/database/migrations/types';
import ticketRoutes from '../src/routes/ticket.routes';
import { notifierAValider } from '../src/services/ticketNotify.service';
import { refusChangementStatut } from '../src/services/ticketsCloture.service';

const base: BetterSqlite3.Database = (global as any).__baseCloture;

const ADMIN = 1;
const CHEF = 2; // superviseur du bâtiment
const AUTONOME = 3; // intervient sur le bâtiment et clôt seul
const ENCADRE = 4; // intervient sur le bâtiment, sa clôture est validée
const DEMANDEUR = 5;
const RENFORT = 6; // agent venu aider

const SERVICE_TECH = 1;
const MAIRIE = 1;

let BATIMENT = 0;
const statuts: Record<string, number> = {};

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

function commeSi(userId: number, role = 'agent') {
  (global as any).__connecte = { userId, role, email: `${userId}@ville.fr` };
}

const ligne = (id: number) => base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
const tachesDe = (ticketId: number) =>
  base.prepare('SELECT * FROM planning_taches WHERE ticket_id = ? ORDER BY id').all(ticketId) as any[];
const renfortsDe = (tacheId: number) =>
  base.prepare('SELECT * FROM planning_participants WHERE tache_id = ? ORDER BY id').all(tacheId) as any[];

async function ouvrir(titre: string): Promise<number> {
  commeSi(DEMANDEUR, 'user');
  const res = await request(app).post('/api/tickets').send({ titre, categorieId: BATIMENT, siteId: MAIRIE });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255));
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100));
    CREATE TABLE service_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0
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
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, category_id INTEGER,
      subcategory_id INTEGER, can_view INTEGER DEFAULT 0, can_edit INTEGER DEFAULT 0, can_delete INTEGER DEFAULT 0
    );
    CREATE TABLE group_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role VARCHAR(50), category_id INTEGER,
      can_view INTEGER DEFAULT 0, can_edit INTEGER DEFAULT 0, can_delete INTEGER DEFAULT 0
    );
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), code VARCHAR(50),
      address VARCHAR(500), sort_order INTEGER DEFAULT 0);
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY, site_id INTEGER, name VARCHAR(255));
  `);

  await migration031.up(ctx);
  await migration032.up(ctx);
  await migration034.up(ctx);
  await migration035.up(ctx);
  await migration045.up(ctx);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${CHEF}, 'chef@ville.fr', 'Charles', 'Chef', 'supervisor'),
      (${AUTONOME}, 'auto@ville.fr', 'Anne', 'Autonome', 'agent'),
      (${ENCADRE}, 'enc@ville.fr', 'Eric', 'Encadré', 'agent'),
      (${DEMANDEUR}, 'dem@ville.fr', 'Dana', 'Demande', 'user'),
      (${RENFORT}, 'renf@ville.fr', 'René', 'Renfort', 'agent');
    INSERT INTO services (id, name, slug) VALUES (${SERVICE_TECH}, 'Technique', 'technique');
    INSERT INTO cle_sites (id, name) VALUES (${MAIRIE}, 'Mairie');

    INSERT INTO ticket_statuts (nom, slug, couleur, ordre, is_ouvert, is_defaut, is_final, is_systeme)
    VALUES
      ('À traiter', 'a-traiter', 'red', 1, 1, 1, 0, 1),
      ('En cours', 'en-cours', 'blue', 2, 1, 0, 0, 0),
      ('Résolu', 'resolu', 'green', 3, 0, 0, 1, 1),
      ('Refusé', 'refuse', 'gray', 4, 0, 0, 1, 0);

    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, ordre, service_id, visibilite, materiel_mode, site_mode)
    VALUES ('Bâtiment', 'batiment', 0, 1, ${SERVICE_TECH}, 'site', 'aucun', 'auto');
  `);
  BATIMENT = Number((base.prepare("SELECT id FROM ticket_categories WHERE nom = 'Bâtiment'").get() as any).id);

  // La migration insère « À valider » avant le premier statut final.
  await migration046.up(ctx);
  for (const s of base.prepare('SELECT id, slug FROM ticket_statuts').all() as any[]) statuts[s.slug] = Number(s.id);

  base.exec(`
    INSERT INTO user_ticket_categories (user_id, ticket_categorie_id, niveau, peut_cloturer) VALUES
      (${CHEF}, ${BATIMENT}, 'superviseur', 1),
      (${AUTONOME}, ${BATIMENT}, 'intervenant_categorie', 1),
      (${ENCADRE}, ${BATIMENT}, 'intervenant_categorie', 0),
      (${DEMANDEUR}, ${BATIMENT}, 'demandeur', 1);
  `);
});

describe('La migration 046', () => {
  it('range « À valider » juste avant le premier statut final', () => {
    const ordre = base
      .prepare('SELECT slug FROM ticket_statuts ORDER BY ordre')
      .all()
      .map((s: any) => s.slug);
    expect(ordre).toEqual(['a-traiter', 'en-cours', 'a-valider', 'resolu', 'refuse']);
    const statut = base.prepare("SELECT * FROM ticket_statuts WHERE slug = 'a-valider'").get() as any;
    expect(statut).toMatchObject({ is_validation: 1, is_ouvert: 0, is_final: 0, is_systeme: 1 });
  });

  it('ne l’insère pas deux fois', async () => {
    await migration046.up(ctx);
    expect((base.prepare("SELECT COUNT(*) AS n FROM ticket_statuts WHERE is_validation = 1").get() as any).n).toBe(1);
  });
});

describe('Terminer, pour un agent autonome', () => {
  let ticketId = 0;

  it('résout la demande et envoie le temps au planning, renforts compris', async () => {
    ticketId = await ouvrir('Radiateur froid');
    commeSi(AUTONOME);
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/terminer`)
      .send({
        jour: '2026-09-24',
        heureDebut: '08:00',
        heureFin: '09:30',
        participants: [{ userId: RENFORT, minutes: 45 }, { libelle: 'Stagiaire' }],
        commentaire: 'Purge faite, ça chauffe',
      });
    expect(res.status).toBe(200);
    expect(res.body.statut.slug).toBe('resolu');

    const t = ligne(ticketId);
    expect(t.ferme_at).not.toBeNull();
    expect(t.resolu_by).toBe(AUTONOME);
    expect(t.technicien_id).toBe(AUTONOME);

    const taches = tachesDe(ticketId);
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({ user_id: AUTONOME, minutes: 90, date_jour: '2026-09-24' });
    expect(t.tache_cloture_id).toBe(taches[0].id);

    // Le stagiaire, sans durée, a fait la tâche entière.
    expect(renfortsDe(taches[0].id).map((r) => [r.user_id, r.libelle, r.minutes])).toEqual([
      [RENFORT, null, 45],
      [null, 'Stagiaire', 90],
    ]);

    // La catégorie de planning porte le nom de la catégorie de la demande.
    const categorie = base.prepare('SELECT name FROM planning_categories WHERE id = ?').get(taches[0].categorie_id) as any;
    expect(categorie.name).toBe('Bâtiment');
  });

  it('refuse de terminer deux fois', async () => {
    commeSi(AUTONOME);
    const res = await request(app).post(`/api/tickets/${ticketId}/terminer`).send({ jour: '2026-09-24', minutes: 10 });
    expect(res.status).toBe(400);
  });
});

describe('Terminer, pour un agent qui n’est pas autonome', () => {
  let ticketId = 0;

  it('met la demande « À valider », résolue mais pas close', async () => {
    ticketId = await ouvrir('Serrure grippée');
    commeSi(ENCADRE);
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/terminer`)
      .send({ jour: '2026-09-24', heureDebut: '10:00', heureFin: '10:30', participants: [{ userId: RENFORT }] });
    expect(res.status).toBe(200);
    expect(res.body.statut.slug).toBe('a-valider');

    const t = ligne(ticketId);
    expect(t.ferme_at).toBeNull();
    expect(t.resolu_at).not.toBeNull();
    expect(notifierAValider).toHaveBeenCalledWith(ticketId, ENCADRE);
  });

  it('le dit au demandeur', async () => {
    commeSi(DEMANDEUR, 'user');
    const res = await request(app).get('/api/tickets');
    const ticket = res.body.tickets.find((t: any) => t.id === ticketId);
    expect(ticket.statut.validation).toBe(true);
  });

  it('ne laisse ni l’agent ni le demandeur en sortir', async () => {
    commeSi(ENCADRE);
    expect(
      (await request(app).put(`/api/tickets/${ticketId}/statut`).send({ statutId: statuts['resolu'] })).status
    ).toBe(403);
    expect((await request(app).post(`/api/tickets/${ticketId}/valider`).send({})).status).toBe(403);

    commeSi(DEMANDEUR, 'user');
    expect((await request(app).post(`/api/tickets/${ticketId}/valider`).send({})).status).toBe(403);
  });

  it('apparaît dans la file « À valider » du superviseur, et seulement la sienne', async () => {
    commeSi(CHEF, 'supervisor');
    const chef = await request(app).get('/api/tickets?aValider=true');
    expect(chef.body.tickets.map((t: any) => t.id)).toContain(ticketId);
    expect((await request(app).get('/api/tickets/permissions')).body.aValider).toBeGreaterThanOrEqual(1);

    commeSi(AUTONOME);
    const agent = await request(app).get('/api/tickets?aValider=true');
    expect(agent.body.tickets).toEqual([]);
  });

  it('se valide après correction du temps et du personnel, sans dupliquer la tâche', async () => {
    commeSi(CHEF, 'supervisor');
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/valider`)
      .send({
        corrections: {
          jour: '2026-09-24',
          heureDebut: '10:00',
          heureFin: '11:00',
          participants: [{ userId: RENFORT, minutes: 20 }],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.statut.slug).toBe('resolu');

    const taches = tachesDe(ticketId);
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({ user_id: ENCADRE, minutes: 60 });
    expect(renfortsDe(taches[0].id).map((r) => [r.user_id, r.minutes])).toEqual([[RENFORT, 20]]);
    expect(ligne(ticketId).ferme_at).not.toBeNull();
  });
});

describe('Renvoyer à l’agent', () => {
  let ticketId = 0;

  it('exige un motif, rouvre la demande et garde le temps déjà passé', async () => {
    ticketId = await ouvrir('Store bloqué');
    commeSi(ENCADRE);
    await request(app).post(`/api/tickets/${ticketId}/terminer`).send({ jour: '2026-09-24', minutes: 30 });

    commeSi(CHEF, 'supervisor');
    expect((await request(app).post(`/api/tickets/${ticketId}/renvoyer`).send({ motif: '  ' })).status).toBe(400);

    const res = await request(app).post(`/api/tickets/${ticketId}/renvoyer`).send({ motif: 'Le store gauche aussi' });
    expect(res.status).toBe(200);
    expect(res.body.statut.slug).toBe('en-cours');

    const t = ligne(ticketId);
    expect(t.tache_cloture_id).toBeNull();
    expect(t.resolu_at).toBeNull();
    expect(tachesDe(ticketId)).toHaveLength(1);
  });

  it('additionne les deux passages au temps de la demande', async () => {
    commeSi(ENCADRE);
    const res = await request(app).post(`/api/tickets/${ticketId}/terminer`).send({ jour: '2026-09-25', minutes: 45 });
    expect(res.body.statut.slug).toBe('a-valider');

    const cloture = await request(app).get(`/api/tickets/${ticketId}/cloture`);
    expect(cloture.status).toBe(200);
    expect(cloture.body.taches).toHaveLength(2);
    expect(cloture.body.minutes).toBe(75);
    expect(cloture.body.tacheCloture.minutes).toBe(45);
  });
});

describe('Tout ou rien', () => {
  it('ne laisse ni tâche ni changement d’état quand un renfort est refusé', async () => {
    const ticketId = await ouvrir('Néon qui clignote');
    commeSi(AUTONOME);
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/terminer`)
      .send({ jour: '2026-09-24', minutes: 20, participants: [{ userId: RENFORT }, { userId: RENFORT }] });
    expect(res.status).toBe(400);
    expect(tachesDe(ticketId)).toHaveLength(0);
    expect(ligne(ticketId).statut_id).toBe(statuts['a-traiter']);
  });

  it('refuse au demandeur de terminer sa propre demande', async () => {
    const ticketId = await ouvrir('Porte qui claque');
    commeSi(DEMANDEUR, 'user');
    expect((await request(app).post(`/api/tickets/${ticketId}/terminer`).send({ jour: '2026-09-24', minutes: 5 })).status).toBe(403);
  });
});

describe('Le sélecteur d’état', () => {
  const statut = (validation: boolean, final: boolean, systeme: boolean) =>
    ({ validation, final, systeme }) as any;
  const droits = (d: Partial<Record<'peutChangerStatut' | 'superviseur' | 'autonome' | 'peutValider', boolean>>) => ({
    peutChangerStatut: true,
    superviseur: false,
    autonome: true,
    peutValider: false,
    ...d,
  });

  it('ne choisit jamais « À valider » : on y arrive par Terminer', () => {
    expect(refusChangementStatut(droits({ superviseur: true, peutValider: true }), null, statut(true, false, true))).not.toBeNull();
  });

  it('réserve la résolution sans temps au superviseur', () => {
    expect(refusChangementStatut(droits({}), null, statut(false, true, true))).not.toBeNull();
    expect(refusChangementStatut(droits({ superviseur: true }), null, statut(false, true, true))).toBeNull();
  });

  it('laisse l’agent autonome refuser une demande, pas celui qui ne l’est pas', () => {
    expect(refusChangementStatut(droits({}), null, statut(false, true, false))).toBeNull();
    expect(refusChangementStatut(droits({ autonome: false }), null, statut(false, true, false))).not.toBeNull();
  });

  it('laisse tout intervenant passer « En cours »', () => {
    expect(refusChangementStatut(droits({ autonome: false }), null, statut(false, false, false))).toBeNull();
  });
});
