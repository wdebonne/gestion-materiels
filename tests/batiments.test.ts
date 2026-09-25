import fs from 'fs';
import path from 'path';
import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * Les contrôles obligatoires des bâtiments.
 *
 * Ce qui est figé ici ne se verrait pas à l'écran avant qu'il soit trop tard :
 *
 *   **L'échéance vient du dernier document validé.** Un rapport en attente ou
 *   refusé ne repousse rien ; un rapport plus ancien ne ressuscite pas une
 *   échéance dépassée. Se tromper ici, c'est un contrôle d'extincteurs oublié.
 *
 *   **Deux cercles.** Le responsable d'un bâtiment dépose, le gestionnaire
 *   valide ; personne ne verse de documents dans un bâtiment qu'il ne gère pas,
 *   pas même en le reclassant.
 *
 *   **Rien ne sort du dossier privé**, ni un SVG n'y entre.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseBatiments = sqlite;

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

/** L'identité seule est simulée ; les gardes de gestion sont les vraies. */
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
}));

import { sendEmail } from '../src/services/email.service';
import batimentRoutes from '../src/routes/batiment.routes';
import { dossierPrive, fermerDossierPrive } from '../src/middleware/televersement';
import { usagesSite } from '../src/services/sites.service';
import {
  CATALOGUE_RUBRIQUES,
  etatDesSuivis,
  semerRubriques,
} from '../src/services/batiments.service';

const base: BetterSqlite3.Database = (global as any).__baseBatiments;
const envoi = sendEmail as jest.Mock;

// --------------------------------------------------------------- outillage

/** Le schéma que la migration 041 trouve devant elle. */
const SCHEMA_AVANT = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user', is_active INTEGER DEFAULT 1, can_login INTEGER NOT NULL DEFAULT 1,
    gere_organisation INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cle_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, code VARCHAR(50),
    address VARCHAR(500), sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
    pretable INTEGER, created_at DATETIME, updated_at DATETIME
  );
  CREATE TABLE site_pieces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES cle_sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, sort_order INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE user_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, site_id INTEGER NOT NULL,
    peut_voir_tickets INTEGER NOT NULL DEFAULT 0, est_responsable INTEGER NOT NULL DEFAULT 0,
    notifie INTEGER NOT NULL DEFAULT 0, gere_lieu INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, site_id)
  );
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, alert_type TEXT, severity TEXT,
    object_id INTEGER, plugin_reference TEXT, plugin_reference_id INTEGER, is_read INTEGER DEFAULT 0,
    is_dismissed INTEGER DEFAULT 0, due_date TEXT, created_at TEXT DEFAULT (datetime('now'))
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

// ------------------------------------------------------ la migration, SQLite

describe('Migration 041 — contrôles des bâtiments', () => {
  let sqlite: BetterSqlite3.Database;

  beforeAll(async () => {
    sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(SCHEMA_AVANT);
    await migration041.up(contexteSqlite(sqlite));
    sqlite.exec(`
      INSERT INTO cle_sites (id, name) VALUES (1, 'École'), (2, 'Mairie');
      INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Classe A');
      INSERT INTO batiment_rubriques (id, code, libelle) VALUES (1, 'extincteurs', 'Extincteurs');
      INSERT INTO batiment_suivis (id, site_id, rubrique_id, piece_id) VALUES (1, 1, 1, 1);
      INSERT INTO batiment_documents (id, site_id, piece_id, rubrique_id, suivi_id, titre, chemin, nom_origine, statut)
        VALUES (1, 1, 1, 1, 1, 'Rapport', 'a.pdf', 'a.pdf', 'valide');
    `);
  });

  it('se rejoue sans effet', async () => {
    await expect(migration041.up(contexteSqlite(sqlite))).resolves.toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM batiment_documents').get()).toEqual({ n: 1 });
  });

  it("n'est rien sans le référentiel des bâtiments, et n'échoue pas", async () => {
    const vide = new BetterSqlite3(':memory:');
    await migration041.up(contexteSqlite(vide));
    expect(vide.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'batiment_%'").all()).toEqual([]);
  });

  it("range les jours métier en texte, jamais en DATE", () => {
    const colonnes = sqlite.prepare('PRAGMA table_info(batiment_documents)').all() as any[];
    const type = (nom: string) => colonnes.find((c) => c.name === nom)?.type;
    expect(type('date_document')).toBe('VARCHAR(10)');
    expect(type('prochaine_echeance')).toBe('VARCHAR(10)');
  });

  it("refuse de supprimer un bâtiment qui a des documents", () => {
    expect(() => sqlite.prepare('DELETE FROM cle_sites WHERE id = 1').run()).toThrow(/FOREIGN KEY/);
  });

  it('garde le document quand sa pièce ou son suivi disparaît', () => {
    sqlite.exec('DELETE FROM site_pieces WHERE id = 1; DELETE FROM batiment_suivis WHERE id = 1;');
    expect(sqlite.prepare('SELECT piece_id, suivi_id FROM batiment_documents WHERE id = 1').get()).toEqual({
      piece_id: null,
      suivi_id: null,
    });
  });

  it("laisse partir un bâtiment sans document, et ses suivis avec lui", () => {
    sqlite.exec('INSERT INTO batiment_suivis (id, site_id, rubrique_id) VALUES (2, 2, 1); DELETE FROM cle_sites WHERE id = 2;');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM batiment_suivis WHERE id = 2').get()).toEqual({ n: 0 });
  });
});

// ------------------------------------------------------ la migration, MySQL

describe('Migration 041 — ce qu’elle écrit vraiment en dialecte MySQL', () => {
  /**
   * Un contexte qui se dit MySQL et **répond** aux lectures de colonnes : sans
   * cela, la garde de tête sortirait tout de suite et le banc partagé la
   * déclarerait conforme sans avoir rien vu.
   */
  let sql: string[];

  beforeAll(async () => {
    sql = [];
    const ctx: ContexteMigration = {
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
        const connues: Record<string, string[]> = {
          cle_sites: ['id', 'name', 'code', 'is_active'],
          site_pieces: ['id', 'site_id', 'name'],
        };
        return (connues[String(params[0] ?? '')] ?? []).map((name) => ({ COLUMN_NAME: name })) as T[];
      },
      async creerIndex() {
        /* le banc partagé vérifie déjà que les index passent par le contexte */
      },
    };
    await migration041.up(ctx);
  });

  const creation = (table: string) => sql.find((r) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(r))!;

  it('a bien emprunté son chemin long', () => {
    for (const table of ['batiment_rubriques', 'batiment_suivis', 'batiment_documents']) {
      expect(creation(table)).toBeDefined();
    }
  });

  it('n’emploie aucune tournure que MySQL refuse', () => {
    for (const requete of sql) {
      expect(requete).not.toMatch(/AUTOINCREMENT/i);
      expect(requete).not.toMatch(/\bPRAGMA\b/i);
      expect(requete).not.toMatch(/CREATE\s+INDEX/i);
      // MySQL refuse une valeur par défaut sur une colonne LONGTEXT.
      expect(requete).not.toMatch(/LONGTEXT\s+(NOT NULL\s+)?DEFAULT/i);
    }
  });

  /**
   * Des clés étrangères **de table**, dans le `CREATE TABLE` : InnoDB les
   * honore, là où il jette en silence un `REFERENCES` posé sur une colonne.
   */
  it('pose ses clés étrangères au niveau de la table, avec le comportement voulu', () => {
    const documents = creation('batiment_documents');
    expect(documents).toMatch(/FOREIGN KEY \(site_id\) REFERENCES cle_sites\(id\) ON DELETE RESTRICT/);
    expect(documents).toMatch(/FOREIGN KEY \(suivi_id\) REFERENCES batiment_suivis\(id\) ON DELETE SET NULL/);
    expect(creation('batiment_suivis')).toMatch(/FOREIGN KEY \(site_id\) REFERENCES cle_sites\(id\) ON DELETE CASCADE/);
    for (const requete of sql) expect(requete).not.toMatch(/INTEGER REFERENCES/i);
  });

  it('écrit les jours en VARCHAR(10), jamais en DATE', () => {
    expect(creation('batiment_documents')).toMatch(/date_document VARCHAR\(10\)/);
    expect(creation('batiment_suivis')).toMatch(/echeance_initiale VARCHAR\(10\)/);
    for (const requete of sql) expect(requete).not.toMatch(/\s(date_document|prochaine_echeance|echeance_initiale) DATE\b/);
  });
});

// ------------------------------------------------------------- la base partagée

let dossier: string;
let avant: Set<string>;

beforeAll(async () => {
  base.exec(SCHEMA_AVANT);
  await migration041.up(contexteSqlite(base));

  /*
   * 1 administrateur, 2 superviseur, 3 gestionnaire de toute l'organisation,
   * 4 gestionnaire de l'école, 5 directrice de l'école (responsable),
   * 6 simple utilisateur, 7 gestionnaire de la mairie.
   */
  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role, gere_organisation) VALUES
      (1, 'admin@ville.fr', 'Ada', 'Admin', 'admin', 0),
      (2, 'sup@ville.fr', 'Sam', 'Sup', 'supervisor', 0),
      (3, 'global@ville.fr', 'Gil', 'Global', 'agent', 1),
      (4, 'ecole@ville.fr', 'Éric', 'École', 'agent', 0),
      (5, 'directrice@ville.fr', 'Dora', 'Directrice', 'user', 0),
      (6, 'agent@ville.fr', 'Ugo', 'User', 'user', 0),
      (7, 'mairie@ville.fr', 'Maud', 'Mairie', 'agent', 0);
    INSERT INTO cle_sites (id, name, sort_order) VALUES (1, 'École Jules-Ferry', 1), (2, 'Mairie', 2);
    INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Classe A'), (2, 2, 'Salle du conseil');
    INSERT INTO user_sites (user_id, site_id, gere_lieu, est_responsable) VALUES
      (4, 1, 1, 0), (5, 1, 0, 1), (7, 2, 1, 0);
  `);

  dossier = dossierPrive('batiments');
  avant = new Set(fs.readdirSync(dossier));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  // Ce que les dépôts de ces tests ont écrit sur le disque, et rien d'autre —
  // pas les fichiers qu'une autre suite, en parallèle, est en train d'utiliser.
  // Un nom nu seulement : un test fabrique un chemin `../../../package.json`,
  // et s'il échouait avant de le rétablir, ce ménage ne doit pas le suivre.
  for (const { chemin } of base.prepare('SELECT chemin FROM batiment_documents').all() as any[]) {
    const complet = path.join(dossier, chemin);
    if (/^[\w.-]+$/.test(chemin) && !avant.has(chemin) && fs.existsSync(complet)) fs.unlinkSync(complet);
  }
});

/**
 * Les fichiers du dossier privé qui portent ce marqueur.
 *
 * Le dossier est partagé avec les autres suites, qui y écrivent en parallèle :
 * compter les fichiers y serait une course. Chercher le contenu qu'on vient
 * d'envoyer ne l'est pas.
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

/** Les avis partent sans être attendus par la route : on leur laisse le temps. */
const laisserPartirLesCourriels = () => new Promise((fin) => setTimeout(fin, 30));

// ------------------------------------------------ le dossier privé, fermé

describe('Le dossier privé, fermé au service statique', () => {
  const racine = fs.mkdtempSync(path.join(require('os').tmpdir(), 'uploads-'));
  const app = express();
  app.use('/uploads', fermerDossierPrive, express.static(racine));

  beforeAll(() => {
    fs.mkdirSync(path.join(racine, 'prive', 'batiments'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'prive', 'batiments', 'ppms.pdf'), 'secret');
    fs.writeFileSync(path.join(racine, 'banc.jpg'), 'public');
  });

  afterAll(() => fs.rmSync(racine, { recursive: true, force: true }));

  it('sert toujours le reste de /uploads', async () => {
    expect((await request(app).get('/uploads/banc.jpg')).status).toBe(200);
  });

  it.each([
    '/uploads/prive/batiments/ppms.pdf',
    '/uploads/%70rive/batiments/ppms.pdf',
    '/uploads/PRIVE/batiments/ppms.pdf',
    '/uploads//prive/batiments/ppms.pdf',
    '/uploads/x/../prive/batiments/ppms.pdf',
    '/uploads/prive%2Fbatiments%2Fppms.pdf',
  ])('refuse %s', async (chemin) => {
    const r = await request(app).get(chemin);
    expect(r.status).not.toBe(200);
    expect(r.text ?? '').not.toContain('secret');
  });
});

// -------------------------------------------------------------- le catalogue

describe('Le catalogue des contrôles', () => {
  it('est semé une fois, code par code', async () => {
    expect(await semerRubriques()).toBe(CATALOGUE_RUBRIQUES.length);
    expect(await semerRubriques()).toBe(0);
  });

  it('ne réécrit jamais une rubrique que la commune a réglée', async () => {
    base.prepare("UPDATE batiment_rubriques SET periodicite_mois = 24, is_active = 0 WHERE code = 'paratonnerre'").run();
    await semerRubriques();
    expect(base.prepare("SELECT periodicite_mois, is_active FROM batiment_rubriques WHERE code = 'paratonnerre'").get()).toEqual({
      periodicite_mois: 24,
      is_active: 0,
    });
  });

  it('revient sur une installation où il manque une rubrique', async () => {
    base.prepare("DELETE FROM batiment_rubriques WHERE code = 'radon'").run();
    expect(await semerRubriques()).toBe(1);
  });
});

const rubrique = (code: string): number =>
  (base.prepare('SELECT id FROM batiment_rubriques WHERE code = ?').get(code) as any).id;

// ------------------------------------------------------------------ l'échéance

describe("L'échéance d'un suivi", () => {
  const AUJOURDHUI = '2026-09-24';

  const suivi = (valeurs: Record<string, unknown>): number => {
    const colonnes = Object.keys(valeurs);
    const r = base
      .prepare(`INSERT INTO batiment_suivis (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
      .run(...Object.values(valeurs));
    return Number(r.lastInsertRowid);
  };

  const documentDe = (suiviId: number, valeurs: Record<string, unknown>) => {
    const s = base.prepare('SELECT site_id, rubrique_id FROM batiment_suivis WHERE id = ?').get(suiviId) as any;
    const complet = { site_id: s.site_id, rubrique_id: s.rubrique_id, suivi_id: suiviId, titre: 'Rapport', chemin: 'x.pdf', nom_origine: 'x.pdf', ...valeurs };
    const colonnes = Object.keys(complet);
    base
      .prepare(`INSERT INTO batiment_documents (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
      .run(...Object.values(complet));
  };

  let extincteurs: number;
  let electricite: number;
  let alarme: number;
  let desenfumage: number;
  let amiante: number;
  let gaz: number;

  beforeAll(() => {
    extincteurs = suivi({ site_id: 1, rubrique_id: rubrique('extincteurs') });
    documentDe(extincteurs, { statut: 'valide', date_document: '2024-10-01' });
    documentDe(extincteurs, { statut: 'valide', date_document: '2025-10-01' });
    // Plus récents, mais sans valeur : l'un attend, l'autre a été refusé.
    documentDe(extincteurs, { statut: 'a_valider', date_document: '2026-09-01' });
    documentDe(extincteurs, { statut: 'refuse', date_document: '2026-09-10' });

    // Surcharge : l'électricité de cette école se vérifie tous les deux ans.
    electricite = suivi({ site_id: 1, rubrique_id: rubrique('verification-electrique'), periodicite_mois: 24 });
    documentDe(electricite, { statut: 'valide', date_document: '2025-01-15' });

    alarme = suivi({ site_id: 2, rubrique_id: rubrique('ssi-alarme'), echeance_initiale: '2026-09-01' });
    desenfumage = suivi({ site_id: 2, rubrique_id: rubrique('desenfumage') });

    amiante = suivi({ site_id: 1, rubrique_id: rubrique('amiante-dta') });
    documentDe(amiante, { statut: 'valide', date_document: '2025-06-01', resultat: 'reserves' });

    // Le rapport donne lui-même la date de la prochaine visite : elle l'emporte.
    gaz = suivi({ site_id: 2, rubrique_id: rubrique('installations-gaz') });
    documentDe(gaz, { statut: 'valide', date_document: '2026-01-10', prochaine_echeance: '2026-10-20' });
  });

  afterAll(() => {
    base.exec('DELETE FROM batiment_documents; DELETE FROM batiment_suivis;');
  });

  const etat = async (suiviId: number) => (await etatDesSuivis({ suiviId }, AUJOURDHUI))[0];

  it('se lit sur le dernier document validé, et sur lui seul', async () => {
    const e = await etat(extincteurs);
    expect(e.dernierDocument?.date).toBe('2025-10-01');
    expect(e.echeance).toBe('2026-10-01');
    expect(e.joursRestants).toBe(7);
    expect(e.statut).toBe('bientot');
  });

  it('suit la périodicité propre au suivi plutôt que celle de la rubrique', async () => {
    const e = await etat(electricite);
    expect(e.periodiciteMois).toBe(24);
    expect(e.surcharge.periodiciteMois).toBe(24);
    expect(e.echeance).toBe('2027-01-15');
    expect(e.statut).toBe('a_jour');
  });

  it("retient l'échéance initiale tant que rien n'a été fait", async () => {
    const e = await etat(alarme);
    expect(e.echeance).toBe('2026-09-01');
    expect(e.enRetard).toBe(true);
    expect(e.statut).toBe('en_retard');
  });

  it("dit « jamais » d'un suivi sans document ni échéance", async () => {
    expect((await etat(desenfumage)).statut).toBe('jamais');
  });

  it('signale un contrôle à réserves, même loin de son échéance', async () => {
    const e = await etat(amiante);
    expect(e.echeance).toBe('2028-06-01');
    expect(e.statut).toBe('non_conforme');
  });

  it('préfère la prochaine échéance écrite sur le rapport au calcul', async () => {
    expect((await etat(gaz)).echeance).toBe('2026-10-20');
  });

  it('se filtre par bâtiment', async () => {
    const mairie = await etatDesSuivis({ siteIds: [2] }, AUJOURDHUI);
    expect(mairie.map((e) => e.suiviId).sort()).toEqual([alarme, desenfumage, gaz].sort());
    expect(await etatDesSuivis({ siteIds: [] }, AUJOURDHUI)).toEqual([]);
  });
});

// --------------------------------------------------------------------- les routes

describe('Les routes du module', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/batiments', batimentRoutes);

  const ROLES: Record<number, string> = { 1: 'admin', 2: 'supervisor', 3: 'agent', 4: 'agent', 5: 'user', 6: 'user', 7: 'agent' };
  const en = (userId: number) => {
    (global as any).__connecte = { userId, role: ROLES[userId], email: `u${userId}@ville.fr` };
  };

  const PDF = Buffer.from('%PDF-1.4\n% contenu de test\n');
  const deposer = (
    siteId: number,
    champs: Record<string, string> = {},
    fichier = { nom: 'Rapport électrique.pdf', type: 'application/pdf' },
    contenu: Buffer = PDF
  ) => {
    let requete = request(app).post(`/api/batiments/${siteId}/documents`);
    for (const [cle, valeur] of Object.entries(champs)) requete = requete.field(cle, valeur);
    return requete.attach('fichier', contenu, { filename: fichier.nom, contentType: fichier.type });
  };

  beforeEach(() => envoi.mockClear());

  describe('Ce que chacun voit', () => {
    it('montre tout à qui gère les lieux, ses bâtiments aux autres, rien au reste', async () => {
      const noms = async (userId: number) => {
        en(userId);
        const r = await request(app).get('/api/batiments');
        return { gereTout: r.body.gereTout, sites: r.body.batiments.map((b: any) => [b.id, b.gere]) };
      };
      expect(await noms(1)).toEqual({ gereTout: true, sites: [[1, true], [2, true]] });
      expect(await noms(3)).toEqual({ gereTout: true, sites: [[1, true], [2, true]] });
      expect(await noms(4)).toEqual({ gereTout: false, sites: [[1, true]] });
      expect(await noms(5)).toEqual({ gereTout: false, sites: [[1, false]] });
      expect(await noms(6)).toEqual({ gereTout: false, sites: [] });
    });

    it("ferme la fiche d'un bâtiment à qui ne le suit pas", async () => {
      en(6);
      expect((await request(app).get('/api/batiments/1')).status).toBe(403);
      en(7);
      expect((await request(app).get('/api/batiments/1')).status).toBe(403);
      en(5);
      const r = await request(app).get('/api/batiments/1');
      expect(r.status).toBe(200);
      expect(r.body.gere).toBe(false);
    });
  });

  describe('Déposer', () => {
    it("met en attente le dépôt d'un responsable et prévient le gestionnaire", async () => {
      en(5);
      const r = await deposer(1, { rubriqueId: String(rubrique('ppms')), titre: 'PPMS 2026', dateDocument: '2026-09-15' });
      expect(r.status).toBe(201);
      expect(r.body.statut).toBe('a_valider');
      expect(r.body.suiviId).toBeNull();

      const ligne = base.prepare('SELECT * FROM batiment_documents WHERE id = ?').get(r.body.id) as any;
      // busboy décode le nom en latin-1 : il doit ressortir avec ses accents.
      expect(ligne.nom_origine).toBe('Rapport électrique.pdf');
      expect(ligne.chemin).not.toMatch(/[\\/]/);
      expect(fs.existsSync(path.join(dossier, ligne.chemin))).toBe(true);

      await laisserPartirLesCourriels();
      expect(envoi).toHaveBeenCalledWith('batiment_document_depose', 'ecole@ville.fr', expect.objectContaining({ titre: 'PPMS 2026' }));
    });

    it("valide d'emblée le dépôt d'un gestionnaire, crée le suivi et calcule l'échéance", async () => {
      en(4);
      const r = await deposer(1, { rubriqueId: String(rubrique('extincteurs')), dateDocument: '2026-03-10' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ statut: 'valide', suiviCree: true });

      const ligne = base.prepare('SELECT titre, prochaine_echeance, valide_par FROM batiment_documents WHERE id = ?').get(r.body.id);
      // Sans titre, le nom du fichier en tient lieu.
      expect(ligne).toEqual({ titre: 'Rapport électrique', prochaine_echeance: '2027-03-10', valide_par: 4 });
      expect(envoi).not.toHaveBeenCalled();
    });

    it("refuse un SVG, même annoncé comme PDF, et n'en garde rien", async () => {
      en(4);
      const m = marqueur();
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>${m}</script></svg>`);
      expect((await deposer(1, {}, { nom: 'plan.svg', type: 'image/svg+xml' }, svg)).status).toBe(400);
      expect((await deposer(1, {}, { nom: 'plan.svg', type: 'application/pdf' }, svg)).status).toBe(400);
      expect(fichiersMarques(m)).toEqual([]);
    });

    it("n'écrit rien sur le disque pour qui ne suit pas le bâtiment", async () => {
      en(6);
      const m = marqueur();
      expect((await deposer(1, {}, undefined, Buffer.from(`%PDF-1.4 ${m}`))).status).toBe(403);
      expect(fichiersMarques(m)).toEqual([]);
    });

    it("retire le fichier reçu quand l'enregistrement échoue", async () => {
      en(4);
      const m = marqueur();
      // La salle du conseil est à la mairie, pas à l'école.
      const r = await deposer(1, { pieceId: '2' }, undefined, Buffer.from(`%PDF-1.4 ${m}`));
      expect(r.status).toBe(400);
      expect(fichiersMarques(m)).toEqual([]);
    });
  });

  describe('Valider, reclasser, refuser', () => {
    let enAttente: number;

    beforeEach(async () => {
      en(5);
      enAttente = (await deposer(1, { rubriqueId: String(rubrique('exercice-evacuation')), dateDocument: '2026-09-20' })).body.id;
    });

    it('laisse la validation au seul gestionnaire du bâtiment', async () => {
      en(5);
      expect((await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({})).status).toBe(403);
      en(7);
      expect((await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({})).status).toBe(403);

      en(4);
      const r = await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({});
      expect(r.status).toBe(200);
      // Exercice d'évacuation : tous les six mois.
      expect(r.body.prochaineEcheance).toBe('2027-03-20');
    });

    it("ne laisse pas verser un document dans un bâtiment qu'on ne gère pas", async () => {
      en(4);
      const r = await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({ siteId: 2 });
      expect(r.status).toBe(403);
      expect((base.prepare('SELECT site_id, statut FROM batiment_documents WHERE id = ?').get(enAttente) as any)).toEqual({
        site_id: 1,
        statut: 'a_valider',
      });

      en(3);
      expect((await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({ siteId: 2 })).status).toBe(200);
    });

    it('demande lequel quand le bâtiment suit plusieurs fois le même objet', async () => {
      en(4);
      const rid = rubrique('exercice-evacuation');
      await request(app).post('/api/batiments/1/suivis').send({ rubriqueId: rid, libelle: 'Maternelle' });
      await request(app).post('/api/batiments/1/suivis').send({ rubriqueId: rid, libelle: 'Élémentaire' });

      const r = await request(app).post(`/api/batiments/documents/${enAttente}/valider`).send({});
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/plusieurs suivis/);

      base.prepare('DELETE FROM batiment_suivis WHERE rubrique_id = ?').run(rid);
    });

    it('exige un motif pour refuser, et le renvoie à qui a déposé', async () => {
      en(4);
      expect((await request(app).post(`/api/batiments/documents/${enAttente}/refuser`).send({})).status).toBe(400);
      expect((await request(app).post(`/api/batiments/documents/${enAttente}/refuser`).send({ motif: 'Mauvaise école' })).status).toBe(200);

      await laisserPartirLesCourriels();
      expect(envoi).toHaveBeenCalledWith('batiment_document_refuse', 'directrice@ville.fr', expect.objectContaining({ motif: 'Mauvaise école' }));
    });
  });

  describe('Le fichier', () => {
    let id: number;

    beforeAll(async () => {
      en(4);
      id = (await deposer(1, { titre: 'Plan de prévention' })).body.id;
    });

    it('sort pour qui consulte le bâtiment, jamais en cache', async () => {
      en(5);
      const r = await request(app)
        .get(`/api/batiments/documents/${id}/fichier`)
        .buffer(true)
        .parse((reponse, fin) => {
          const morceaux: Buffer[] = [];
          reponse.on('data', (morceau: Buffer) => morceaux.push(morceau));
          reponse.on('end', () => fin(null, Buffer.concat(morceaux)));
        });
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['content-type']).toMatch(/application\/pdf/);
      expect(Buffer.from(r.body).toString()).toContain('%PDF-1.4');
    });

    it('reste fermé aux autres', async () => {
      en(6);
      expect((await request(app).get(`/api/batiments/documents/${id}/fichier`)).status).toBe(403);
      en(7);
      expect((await request(app).get(`/api/batiments/documents/${id}/fichier`)).status).toBe(403);
    });

    it('ne sert rien hors du dossier privé, même si la base le demande', async () => {
      const chemin = (base.prepare('SELECT chemin FROM batiment_documents WHERE id = ?').get(id) as any).chemin;
      base.prepare("UPDATE batiment_documents SET chemin = '../../../package.json' WHERE id = ?").run(id);
      en(4);
      expect((await request(app).get(`/api/batiments/documents/${id}/fichier`)).status).toBe(404);
      base.prepare('UPDATE batiment_documents SET chemin = ? WHERE id = ?').run(chemin, id);
    });
  });

  describe('Supprimer', () => {
    it('laisse le déposant retirer son dépôt tant que personne ne l’a relu', async () => {
      en(5);
      const id = (await deposer(1)).body.id;
      const chemin = (base.prepare('SELECT chemin FROM batiment_documents WHERE id = ?').get(id) as any).chemin;
      expect((await request(app).delete(`/api/batiments/documents/${id}`)).status).toBe(200);
      expect(fs.existsSync(path.join(dossier, chemin))).toBe(false);
    });

    it('lui refuse un document validé', async () => {
      en(4);
      const id = (await deposer(1)).body.id;
      en(5);
      expect((await request(app).delete(`/api/batiments/documents/${id}`)).status).toBe(403);
    });

    it('compte les documents parmi ce qui empêche de supprimer un bâtiment', async () => {
      expect((await usagesSite(1)).documents).toBeGreaterThan(0);
    });
  });

  describe('Les rubriques', () => {
    it('ne se modifient que par qui gère tous les lieux', async () => {
      en(4);
      expect((await request(app).post('/api/batiments/rubriques').send({ libelle: 'Stores' })).status).toBe(403);
      en(3);
      const r = await request(app).post('/api/batiments/rubriques').send({ libelle: 'Contrôle des stores', periodiciteMois: 12 });
      expect(r.status).toBe(201);
      expect(base.prepare('SELECT code FROM batiment_rubriques WHERE id = ?').get(r.body.id)).toEqual({ code: 'controle-des-stores' });
      expect((await request(app).delete(`/api/batiments/rubriques/${r.body.id}`)).status).toBe(200);
    });

    it('protègent le catalogue : une rubrique livrée se désactive, elle ne se supprime pas', async () => {
      en(1);
      const r = await request(app).delete(`/api/batiments/rubriques/${rubrique('ria')}`);
      expect(r.status).toBe(409);
    });

    it('refusent un délai de rappel absurde', async () => {
      en(1);
      const r = await request(app).put(`/api/batiments/rubriques/${rubrique('ria')}`).send({ rappelJours: 0 });
      expect(r.status).toBe(400);
    });

    it("s'appliquent d'un geste à tous les bâtiments", async () => {
      en(1);
      const rid = rubrique('ria');
      const r = await request(app).post(`/api/batiments/rubriques/${rid}/appliquer`).send({ tous: true });
      expect(r.body.crees).toBe(2);
      const encore = await request(app).post(`/api/batiments/rubriques/${rid}/appliquer`).send({ tous: true });
      expect(encore.body.crees).toBe(0);
    });
  });
});
