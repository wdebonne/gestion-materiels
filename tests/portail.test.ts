import fs from 'fs';
import path from 'path';
import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import migration042 from '../src/database/migrations/042_entreprises_portail';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Le portail des entreprises extérieures.
 *
 * Ce qui est figé ici tient à la sécurité d'un accès **sans compte** :
 *
 *   **Rien ne distingue un lien inconnu d'un code faux.** Même statut, même
 *   message. L'état de l'accès (suspendu, expiré) ne se dit qu'au bon code.
 *
 *   **Un code régénéré tue l'ancien et ses sessions** ; une suspension aussi.
 *
 *   **Une entreprise ne voit que ce qu'on lui ouvre** : documents validés, de
 *   ses bâtiments, de ses objets en lecture — plus ses propres dépôts. Elle ne
 *   dépose que là où le dépôt lui est ouvert, et sans session rien n'est écrit.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__basePortail = sqlite;
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

jest.mock('../src/services/email.service', () => ({
  sendEmail: jest.fn(async () => true),
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
}));

import { sendEmail } from '../src/services/email.service';
import entrepriseRoutes from '../src/routes/entreprise.routes';
import portailRoutes from '../src/routes/portail.routes';
import { dossierPrive } from '../src/middleware/televersement';
import { lireDocument, semerRubriques } from '../src/services/batiments.service';
import { notifierRefus } from '../src/services/batimentsNotify.service';

const base: BetterSqlite3.Database = (global as any).__basePortail;
const envoi = sendEmail as jest.Mock;

const SCHEMA_AVANT = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user', is_active INTEGER DEFAULT 1, can_login INTEGER NOT NULL DEFAULT 1,
    gere_organisation INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE settings (id INTEGER PRIMARY KEY, setting_key TEXT UNIQUE, setting_value TEXT);
  CREATE TABLE cle_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, code VARCHAR(50),
    address VARCHAR(500), sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE site_pieces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES cle_sites(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL
  );
  CREATE TABLE user_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, site_id INTEGER NOT NULL,
    est_responsable INTEGER NOT NULL DEFAULT 0, gere_lieu INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, site_id)
  );
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, alert_type TEXT, severity TEXT,
    object_id INTEGER, plugin_reference TEXT, plugin_reference_id INTEGER, is_dismissed INTEGER DEFAULT 0,
    due_date TEXT, created_at TEXT
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

// ------------------------------------------------------------- la migration

describe('Migration 042 — entreprises et portail', () => {
  it('pose ses tables, se rejoue, et garde les documents d’une entreprise supprimée', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(SCHEMA_AVANT);
    await migration041.up(contexteSqlite(sqlite));
    await migration042.up(contexteSqlite(sqlite));
    await migration042.up(contexteSqlite(sqlite));

    sqlite.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'École');
      INSERT INTO entreprises (id, nom, email, lien_jeton) VALUES (1, 'Élec', 'e@x.fr', 'LIEN1');
      INSERT INTO batiment_documents (id, site_id, titre, chemin, nom_origine, entreprise_id) VALUES (1, 1, 'R', 'r.pdf', 'r.pdf', 1);
      DELETE FROM entreprises WHERE id = 1;
    `);
    expect(sqlite.prepare('SELECT entreprise_id FROM batiment_documents WHERE id = 1').get()).toEqual({ entreprise_id: null });
  });

  it('attend le module Bâtiments, sans échouer', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(SCHEMA_AVANT);
    await migration042.up(contexteSqlite(sqlite));
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'entreprises'").all()).toEqual([]);
  });

  describe('en dialecte MySQL', () => {
    let sql: string[];

    beforeAll(async () => {
      sql = [];
      await migration042.up({
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
          const connues: Record<string, string[]> = { batiment_documents: ['id', 'site_id', 'statut'] };
          return (connues[String(params[0] ?? '')] ?? []).map((name) => ({ COLUMN_NAME: name })) as T[];
        },
        async creerIndex() {
          /* vérifié par le banc partagé */
        },
      });
    });

    it('pose la clé étrangère du document en `ADD CONSTRAINT`, jamais dans le `ADD COLUMN`', () => {
      const ajout = sql.find((r) => /ADD COLUMN entreprise_id/i.test(r))!;
      expect(ajout).toBeDefined();
      expect(ajout).not.toMatch(/REFERENCES/i);
      expect(sql.some((r) => /ADD CONSTRAINT fk_batiment_documents_entreprise\b[\s\S]*ON DELETE SET NULL/i.test(r))).toBe(true);
    });

    it('n’emploie aucune tournure que MySQL refuse', () => {
      for (const requete of sql) {
        expect(requete).not.toMatch(/AUTOINCREMENT/i);
        expect(requete).not.toMatch(/\bPRAGMA\b/i);
        expect(requete).not.toMatch(/LONGTEXT\s+(NOT NULL\s+)?DEFAULT/i);
      }
      expect(sql.find((r) => /CREATE TABLE IF NOT EXISTS entreprise_sessions/.test(r))).toMatch(/token_hash CHAR\(64\) NOT NULL UNIQUE/);
    });
  });
});

// ------------------------------------------------------------ la base partagée

let dossier: string;
let avant: Set<string>;
const rubrique = (code: string): number =>
  (base.prepare('SELECT id FROM batiment_rubriques WHERE code = ?').get(code) as any).id;

beforeAll(async () => {
  process.env.BCRYPT_ROUNDS = '4';
  process.env.CLIENT_URL = 'https://ville.test';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  base.exec(SCHEMA_AVANT);
  await migration041.up(contexteSqlite(base));
  await migration042.up(contexteSqlite(base));
  await semerRubriques();

  base.exec(`
    INSERT INTO users (id, email, first_name, role, gere_organisation) VALUES
      (1, 'admin@ville.fr', 'Ada', 'admin', 0),
      (4, 'ecole@ville.fr', 'Éric', 'agent', 0);
    INSERT INTO cle_sites (id, name) VALUES (1, 'École Jules-Ferry'), (2, 'Mairie'), (3, 'Gymnase');
    INSERT INTO user_sites (user_id, site_id, gere_lieu) VALUES (4, 1, 1);
  `);

  dossier = dossierPrive('batiments');
  avant = new Set(fs.readdirSync(dossier));
});

afterAll(() => {
  // Les fichiers de cette suite seulement : une autre, en parallèle, écrit au même endroit.
  for (const { chemin } of base.prepare('SELECT chemin FROM batiment_documents').all() as any[]) {
    const complet = path.join(dossier, chemin);
    if (/^[\w.-]+$/.test(chemin) && !avant.has(chemin) && fs.existsSync(complet)) fs.unlinkSync(complet);
  }
});

/**
 * Les fichiers du dossier privé qui portent ce marqueur : le dossier est
 * partagé avec les suites qui tournent en parallèle, et compter ses fichiers y
 * serait une course.
 */
let rangMarqueur = 0;
const marqueur = () => `marqueur-${process.pid}-${++rangMarqueur}-${Date.now()}`;
const fichiersMarques = (m: string) =>
  fs.readdirSync(dossier).filter((nom) => {
    try {
      return fs.readFileSync(path.join(dossier, nom), 'latin1').includes(m);
    } catch {
      return false;
    }
  });

const app = express();
app.use(express.json());
app.use('/api/entreprises', entrepriseRoutes);
app.use('/api/portail', portailRoutes);

const en = (userId: number, role: string) => {
  (global as any).__connecte = { userId, role, email: `u${userId}@ville.fr` };
};

// ------------------------------------------------------------ l'administration

describe("L'administration des entreprises", () => {
  it('est réservée à qui gère tous les lieux', async () => {
    en(4, 'agent');
    expect((await request(app).get('/api/entreprises')).status).toBe(403);
  });

  it("exige une adresse électronique, et tire un lien qu'aucune autre ne porte", async () => {
    en(1, 'admin');
    expect((await request(app).post('/api/entreprises').send({ nom: 'Sans courriel' })).status).toBe(400);
    const r = await request(app).post('/api/entreprises').send({ nom: 'Électricité Martin', email: 'contact@martin.fr' });
    expect(r.status).toBe(201);
    const lien = (base.prepare('SELECT lien_jeton FROM entreprises WHERE id = ?').get(r.body.id) as any).lien_jeton;
    expect(lien).toMatch(/^[A-Z2-9]{22}$/);
  });

  it('ne montre jamais l’empreinte du code', async () => {
    en(1, 'admin');
    const id = (await request(app).post('/api/entreprises').send({ nom: 'Extincteurs Nord', email: 'nord@feu.fr' })).body.id;
    await request(app).post(`/api/entreprises/${id}/acces`).send({ envoyer: false });
    const lecture = await request(app).get(`/api/entreprises/${id}`);
    const liste = await request(app).get('/api/entreprises');
    for (const reponse of [lecture, liste]) {
      expect(JSON.stringify(reponse.body)).not.toMatch(/code_hash|\$2[aby]\$/);
    }
    expect(lecture.body.entreprise.acces.etat).toBe('actif');
  });
});

// -------------------------------------------------- l'accès, et sa délivrance

/** Une entreprise ouverte sur l'école, pour les extincteurs (lecture + dépôt) et l'électricité (lecture). */
async function entrepriseOuverte(nom: string, email = `${nom.toLowerCase().replace(/\W+/g, '')}@presta.fr`) {
  en(1, 'admin');
  const id = (await request(app).post('/api/entreprises').send({ nom, email })).body.id;
  await request(app)
    .put(`/api/entreprises/${id}/droits`)
    .send({
      sites: [1],
      rubriques: [
        { rubriqueId: rubrique('extincteurs'), lecture: true, depot: true },
        { rubriqueId: rubrique('verification-electrique'), lecture: true, depot: false },
      ],
    });
  const acces = await request(app).post(`/api/entreprises/${id}/acces`).send({ envoyer: false });
  const lien = (base.prepare('SELECT lien_jeton FROM entreprises WHERE id = ?').get(id) as any).lien_jeton;
  return { id, lien, code: acces.body.code as string };
}

const connexion = (lien: string, code: string) => request(app).post(`/api/portail/${lien}/connexion`).send({ code });

describe("La délivrance de l'accès", () => {
  beforeEach(() => envoi.mockClear());

  it("rend le code une fois, et l'envoie à l'entreprise et aux contacts qui reçoivent l'accès", async () => {
    en(1, 'admin');
    const id = (await request(app).post('/api/entreprises').send({ nom: 'Ascenseurs Sud', email: 'accueil@asc.fr' })).body.id;
    await request(app)
      .put(`/api/entreprises/${id}/contacts`)
      .send({
        contacts: [
          { nom: 'Paul Technicien', email: 'paul@asc.fr', recoitAcces: true },
          { nom: 'Compta', email: 'compta@asc.fr', recoitAcces: false },
          { nom: 'Le gérant', email: 'ACCUEIL@asc.fr', recoitAcces: true },
        ],
      });

    const r = await request(app).post(`/api/entreprises/${id}/acces`).send({});
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.body.lien).toMatch(/^https:\/\/ville\.test\/prestataires\/[A-Z2-9]{22}$/);
    expect(r.body.envoi.resultat).toBe('envoye');

    const [gabarit, destinataires, donnees] = envoi.mock.calls[0];
    expect(gabarit).toBe('entreprise_acces');
    // Dédoublonné sans casse ; la comptabilité ne reçoit pas l'accès.
    expect(destinataires).toBe('accueil@asc.fr, paul@asc.fr');
    expect(donnees).toMatchObject({ entreprise: 'Ascenseurs Sud', code: r.body.code, avec_code: true });
  });

  it("peut taire le code dans le courriel, pour le donner de vive voix", async () => {
    en(1, 'admin');
    const id = (await request(app).post('/api/entreprises').send({ nom: 'Bureau Véritas', email: 'bv@bv.fr' })).body.id;
    const r = await request(app).post(`/api/entreprises/${id}/acces`).send({ inclureCode: false });
    expect(envoi.mock.calls[0][2]).toMatchObject({ code: '', avec_code: false });
    expect(r.body.code).toMatch(/-/);
  });

  it("rend le code même quand le courriel échoue, pour qu'on le transmette autrement", async () => {
    en(1, 'admin');
    envoi.mockRejectedValueOnce(new Error('Aucun serveur SMTP'));
    const id = (await request(app).post('/api/entreprises').send({ nom: 'Plomberie', email: 'p@p.fr' })).body.id;
    const r = await request(app).post(`/api/entreprises/${id}/acces`).send({});
    expect(r.status).toBe(200);
    expect(r.body.envoi).toMatchObject({ resultat: 'echec' });
    expect(r.body.code).toMatch(/-/);
  });
});

// ------------------------------------------------------------- la connexion

describe('La connexion au portail', () => {
  it('répond pareil à un lien inconnu et à un code faux', async () => {
    const { lien } = await entrepriseOuverte('Connexion A');
    const inconnu = await connexion('ZZZZZZZZZZZZZZZZZZZZZZ', 'ABCD-EFGH');
    const faux = await connexion(lien, 'ABCD-EFGH');
    expect(inconnu.status).toBe(401);
    expect(faux.status).toBe(401);
    expect(faux.body).toEqual(inconnu.body);
  });

  it('accepte le code sans tiret, en minuscules, avec des espaces', async () => {
    const { lien, code } = await entrepriseOuverte('Connexion B');
    const r = await connexion(lien, ` ${code.replace('-', ' ').toLowerCase()} `);
    expect(r.status).toBe(200);
    expect(r.body.jeton).toEqual(expect.any(String));
    expect(r.body.entreprise).toEqual({ nom: 'Connexion B' });
  });

  it("tue l'ancien code et ses sessions quand on en régénère un", async () => {
    const { id, lien, code } = await entrepriseOuverte('Régénération');
    const { jeton } = (await connexion(lien, code)).body;
    expect((await request(app).get('/api/portail/moi').set('X-Session-Portail', jeton)).status).toBe(200);

    en(1, 'admin');
    const nouveau = (await request(app).post(`/api/entreprises/${id}/acces`).send({ envoyer: false })).body.code;
    expect((await request(app).get('/api/portail/moi').set('X-Session-Portail', jeton)).status).toBe(401);
    expect((await connexion(lien, code)).status).toBe(401);
    expect((await connexion(lien, nouveau)).status).toBe(200);
  });

  it("ne dit « suspendu » ou « expiré » qu'au bon code, et coupe la session en cours", async () => {
    const { id, lien, code } = await entrepriseOuverte('Suspension');
    const { jeton } = (await connexion(lien, code)).body;

    en(1, 'admin');
    await request(app).put(`/api/entreprises/${id}/acces`).send({ suspendu: true });
    expect((await request(app).get('/api/portail/moi').set('X-Session-Portail', jeton)).status).toBe(401);
    expect((await connexion(lien, 'ABCD-EFGH')).body.message).toBe('Lien ou code incorrect');
    expect((await connexion(lien, code)).body.message).toMatch(/suspendu/);

    await request(app).put(`/api/entreprises/${id}/acces`).send({ suspendu: false, fin: '2020-01-31' });
    expect((await connexion(lien, code)).body.message).toMatch(/expiré/);
  });

  it("se verrouille après vingt échecs d'affilée, jusqu'à ce qu'un gestionnaire lève le verrou", async () => {
    const { id, lien, code } = await entrepriseOuverte('Verrou');
    base.prepare('UPDATE entreprises SET tentatives_echouees = 19 WHERE id = ?').run(id);
    await connexion(lien, 'ABCD-EFGH');
    expect((await connexion(lien, code)).status).toBe(423);

    en(1, 'admin');
    await request(app).post(`/api/entreprises/${id}/deverrouiller`);
    expect((await connexion(lien, code)).status).toBe(200);
  });

  it('freine les essais depuis une même adresse sur un même lien', async () => {
    const { lien, code } = await entrepriseOuverte('Débit');
    for (let i = 0; i < 10; i++) await connexion(lien, 'ABCD-EFGH');
    expect((await connexion(lien, code)).status).toBe(429);
  });

  it("ferme la session à l'heure dite", async () => {
    const { lien, code } = await entrepriseOuverte('Expiration');
    const { jeton } = (await connexion(lien, code)).body;
    base.prepare("UPDATE entreprise_sessions SET expires_at = '2000-01-01 00:00:00'").run();
    expect((await request(app).get('/api/portail/moi').set('X-Session-Portail', jeton)).status).toBe(401);
  });
});

// ----------------------------------------------------- ce qu'elle voit, dépose

describe('Ce que voit et dépose une entreprise', () => {
  let session: string;
  let entrepriseId: number;
  const document = (valeurs: Record<string, unknown>): number => {
    const complet = { titre: 'Rapport', chemin: 'absent.pdf', nom_origine: 'rapport.pdf', statut: 'valide', ...valeurs };
    const colonnes = Object.keys(complet);
    return Number(
      base
        .prepare(`INSERT INTO batiment_documents (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
        .run(...Object.values(complet)).lastInsertRowid
    );
  };
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    const e = await entrepriseOuverte('Visibilité');
    entrepriseId = e.id;
    session = (await connexion(e.lien, e.code)).body.jeton;

    ids.ouvert = document({ site_id: 1, rubrique_id: rubrique('extincteurs'), titre: 'Extincteurs 2025' });
    ids.lectureSeule = document({ site_id: 1, rubrique_id: rubrique('verification-electrique'), titre: 'Électricité 2025' });
    ids.objetFerme = document({ site_id: 1, rubrique_id: rubrique('ppms'), titre: 'PPMS' });
    ids.batimentFerme = document({ site_id: 2, rubrique_id: rubrique('extincteurs'), titre: 'Extincteurs mairie' });
    ids.enAttente = document({ site_id: 1, rubrique_id: rubrique('extincteurs'), statut: 'a_valider', titre: 'Dépôt d’un autre' });
    ids.refuseSien = document({
      site_id: 1,
      rubrique_id: rubrique('extincteurs'),
      statut: 'refuse',
      motif_refus: 'Illisible',
      entreprise_id: entrepriseId,
      source: 'entreprise',
      titre: 'Mon rapport refusé',
    });
  });

  it("ne montre que l'ouvert en lecture, validé — plus ses propres dépôts, motif compris", async () => {
    const r = await request(app).get('/api/portail/documents').set('X-Session-Portail', session);
    const titres = r.body.documents.map((d: any) => d.titre).sort();
    expect(titres).toEqual(['Extincteurs 2025', 'Mon rapport refusé', 'Électricité 2025'].sort());
    expect(r.body.documents.find((d: any) => d.sien)).toMatchObject({ statut: 'refuse', motifRefus: 'Illisible' });
  });

  it('répond « introuvable » pour un fichier qui ne lui est pas ouvert', async () => {
    for (const id of [ids.objetFerme, ids.batimentFerme, ids.enAttente]) {
      const r = await request(app).get(`/api/portail/documents/${id}/fichier`).set('X-Session-Portail', session);
      expect(r.status).toBe(404);
    }
  });

  it('dit ce qui lui est ouvert, et les échéances de ses objets', async () => {
    base
      .prepare('INSERT INTO batiment_suivis (site_id, rubrique_id, echeance_initiale) VALUES (1, ?, ?)')
      .run(rubrique('verification-electrique'), '2020-01-01');
    base
      .prepare('INSERT INTO batiment_suivis (site_id, rubrique_id, echeance_initiale) VALUES (1, ?, ?)')
      .run(rubrique('ppms'), '2020-01-01');

    const r = await request(app).get('/api/portail/moi').set('X-Session-Portail', session);
    expect(r.body.batiments).toEqual([{ id: 1, nom: 'École Jules-Ferry' }]);
    expect(r.body.objets.map((o: any) => [o.libelle, o.lecture, o.depot])).toEqual(
      expect.arrayContaining([
        ['Vérification des extincteurs', true, true],
        ['Vérification des installations électriques', true, false],
      ])
    );
    // Le PPMS ne lui est pas ouvert : son échéance ne la regarde pas.
    expect(r.body.echeances.map((e: any) => e.rubriqueLibelle)).toEqual(['Vérification des installations électriques']);
  });

  it("n'écrit rien sur le disque sans session", async () => {
    const m = marqueur();
    const r = await request(app)
      .post('/api/portail/documents')
      .attach('fichier', Buffer.from(`%PDF-1.4 ${m}`), { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(401);
    expect(fichiersMarques(m)).toEqual([]);
  });

  it("refuse un objet ouvert en lecture seule, et efface le fichier reçu", async () => {
    const m = marqueur();
    const r = await request(app)
      .post('/api/portail/documents')
      .set('X-Session-Portail', session)
      .field('rubriqueId', String(rubrique('verification-electrique')))
      .field('titre', 'Tentative')
      .attach('fichier', Buffer.from(`%PDF-1.4 ${m}`), { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(400);
    expect(fichiersMarques(m)).toEqual([]);
  });

  it('prend d’office le seul bâtiment et le seul objet ouverts au dépôt, et met le document en attente', async () => {
    envoi.mockClear();
    const r = await request(app)
      .post('/api/portail/documents')
      .set('X-Session-Portail', session)
      .field('titre', 'Vérification annuelle')
      .field('dateDocument', '2026-09-10')
      .attach('fichier', Buffer.from('%PDF-1.4'), { filename: 'Vérif école.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);

    const doc = await lireDocument(r.body.id);
    expect(doc).toMatchObject({
      siteId: 1,
      rubriqueLibelle: 'Vérification des extincteurs',
      statut: 'a_valider',
      source: 'entreprise',
      nomOrigine: 'Vérif école.pdf',
      entreprise: { id: entrepriseId, nom: 'Visibilité' },
    });

    await new Promise((fin) => setTimeout(fin, 30));
    expect(envoi).toHaveBeenCalledWith(
      'batiment_document_depose',
      'ecole@ville.fr',
      expect.objectContaining({ depose_par: 'Visibilité' })
    );

    // Retirable tant que personne ne l'a relu…
    expect((await request(app).delete(`/api/portail/documents/${r.body.id}`).set('X-Session-Portail', session)).status).toBe(200);
  });

  it('… mais pas un document validé, ni celui d’un autre', async () => {
    for (const id of [ids.ouvert, ids.enAttente]) {
      const r = await request(app).delete(`/api/portail/documents/${id}`).set('X-Session-Portail', session);
      expect(r.status).toBe(404);
    }
  });

  it('renvoie un refus à l’entreprise et à ses contacts', async () => {
    envoi.mockClear();
    await notifierRefus(ids.refuseSien);
    expect(envoi).toHaveBeenCalledWith(
      'batiment_document_refuse',
      'visibilit@presta.fr',
      expect.objectContaining({ motif: 'Illisible', first_name: 'Visibilité' })
    );
  });

  it("refuse de supprimer une entreprise qui a déposé des documents", async () => {
    en(1, 'admin');
    expect((await request(app).delete(`/api/entreprises/${entrepriseId}`)).status).toBe(409);
  });
});
