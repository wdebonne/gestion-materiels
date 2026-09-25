/**
 * Les alertes d'échéance des contrôles de bâtiment.
 *
 * Ce qu'on fige : une alerte naît quand l'échéance entre dans le délai de
 * rappel, devient critique quand elle passe, et **disparaît** dès que la
 * situation ne la justifie plus — rapport validé, suivi supprimé ou désactivé.
 * C'est ce qui manquait aux contrôles techniques des véhicules : une alerte
 * posée ne redescendait jamais, et le tableau de bord s'encombrait d'échéances
 * de 2020.
 *
 * Et un rejet tient tant que l'échéance n'a pas bougé — y compris quand la base
 * rend la date avec une heure, comme le fait un `DATETIME`.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseAlertesBatiments = sqlite;
  return {
    db: {
      getType: () => 'sqlite',
      dateDecalee: (jours: number) => `date('now', '+${Math.trunc(jours)} days')`,
      async query(sql: string, params: any[] = []) {
        return sqlite.prepare(sql).all(...params);
      },
      async queryOne(sql: string, params: any[] = []) {
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      async execute(sql: string, params: any[] = []) {
        const r = sqlite.prepare(sql).run(...params);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
      },
    },
  };
});

jest.mock('../src/services/websocket.service', () => ({ emitAlert: () => undefined }));
jest.mock('../src/services/email.service', () => ({
  sendEmail: jest.fn(async () => true),
  sendEmailRaw: jest.fn(async () => true),
  sendAlertEmail: jest.fn(async () => undefined),
}));

import type BetterSqlite3 from 'better-sqlite3';
import migration041 from '../src/database/migrations/041_batiments_controles';
import migration042 from '../src/database/migrations/042_entreprises_portail';
import migration044 from '../src/database/migrations/044_energie_contrats_interventions';
import { verifierEcheancesBatiments } from '../src/services/cron.service';
import {
  destinatairesBatiment,
  filtreAlertesBatiments,
  semerRubriques,
  supprimerSuivi,
  validerDocument,
} from '../src/services/batiments.service';
import { jourCourant, decalerJours } from '../src/utils/periodes';
import { sendEmail } from '../src/services/email.service';

const base: BetterSqlite3.Database = (global as any).__baseAlertesBatiments;
const envoi = sendEmail as jest.Mock;

/** Un jour relatif à aujourd'hui, au format de la base. */
const jour = (decalage: number) => decalerJours(jourCourant(), decalage);

const alerte = (suiviId: number) =>
  base
    .prepare("SELECT severity, message, due_date, is_dismissed FROM alerts WHERE plugin_reference = 'batiment-suivi' AND plugin_reference_id = ?")
    .get(suiviId) as any;

const nombreAlertes = () =>
  (base.prepare("SELECT COUNT(*) AS n FROM alerts WHERE plugin_reference = 'batiment-suivi'").get() as any).n;

let bientot: number;
let enRetard: number;
let lointain: number;
let inactif: number;
let mairie: number;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, can_login INTEGER DEFAULT 1, gere_organisation INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
    CREATE TABLE site_pieces (id INTEGER PRIMARY KEY, site_id INTEGER, name TEXT);
    CREATE TABLE user_sites (id INTEGER PRIMARY KEY, user_id INTEGER, site_id INTEGER,
      est_responsable INTEGER NOT NULL DEFAULT 0, gere_lieu INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, alert_type TEXT, severity TEXT,
      object_id INTEGER, plugin_reference TEXT, plugin_reference_id INTEGER, is_read INTEGER DEFAULT 0,
      is_dismissed INTEGER DEFAULT 0, due_date TEXT, created_at TEXT DEFAULT (datetime('now')));

    INSERT INTO users (id, email, role, gere_organisation) VALUES
      (1, 'admin@ville.fr', 'admin', 0),
      (2, 'global@ville.fr', 'agent', 1),
      (3, 'ecole@ville.fr', 'agent', 0),
      (4, 'agent@ville.fr', 'user', 0);
    -- 1 : l'école, qui a son gestionnaire ; 2 : la mairie, qui n'en a pas ;
    -- 3 : le gymnase, fermé.
    INSERT INTO cle_sites (id, name, is_active) VALUES (1, 'École', 1), (2, 'Mairie', 1), (3, 'Gymnase', 0);
    INSERT INTO user_sites (user_id, site_id, gere_lieu) VALUES (3, 1, 1);
  `);

  const contexte = {
    dialecte: 'sqlite' as const,
    autoIncrement: 'AUTOINCREMENT',
    texteLong: 'TEXT',
    booleen: 'INTEGER',
    horodatageParDefaut: 'DEFAULT CURRENT_TIMESTAMP',
    async executer(sql: string, params: any[] = []) {
      const r = base.prepare(sql).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
    },
    async interroger(sql: string, params: any[] = []) {
      return base.prepare(sql).all(...params) as any[];
    },
    async creerIndex(nom: string, table: string, colonnes: string) {
      base.prepare(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`).run();
    },
  };
  // Les trois se suivent toujours : le filtre des alertes lit aussi les contrats.
  await migration041.up(contexte);
  await migration042.up(contexte);
  await migration044.up(contexte);
  await semerRubriques();

  const rubrique = (code: string) => (base.prepare('SELECT id FROM batiment_rubriques WHERE code = ?').get(code) as any).id;
  const suivi = (siteId: number, code: string, echeance: string, actif = 1) =>
    Number(
      base
        .prepare('INSERT INTO batiment_suivis (site_id, rubrique_id, echeance_initiale, actif) VALUES (?, ?, ?, ?)')
        .run(siteId, rubrique(code), echeance, actif).lastInsertRowid
    );

  // Extincteurs : rappel à 30 jours.
  bientot = suivi(1, 'extincteurs', jour(10));
  enRetard = suivi(1, 'desenfumage', jour(-5));
  lointain = suivi(1, 'ssi-alarme', jour(100));
  inactif = suivi(1, 'installations-gaz', jour(-5), 0);
  mairie = suivi(2, 'eclairage-securite', jour(3));
  // Le gymnase est fermé : ses échéances ne sonnent pas.
  suivi(3, 'extincteurs', jour(-30));
});

describe('La fenêtre de rappel', () => {
  beforeAll(async () => {
    envoi.mockClear();
    await verifierEcheancesBatiments();
  });

  it("lève une alerte dans le délai de rappel, et pas avant", () => {
    expect(alerte(bientot)).toMatchObject({ severity: 'warning', is_dismissed: 0, due_date: jour(10) });
    expect(alerte(lointain)).toBeUndefined();
  });

  it("passe en critique une fois l'échéance dépassée", () => {
    expect(alerte(enRetard).severity).toBe('critical');
    expect(alerte(enRetard).message).toMatch(/dépassée/);
  });

  it("se tait pour un suivi désactivé et pour un bâtiment fermé", () => {
    expect(alerte(inactif)).toBeUndefined();
    expect(nombreAlertes()).toBe(3);
  });

  it("écrit au gestionnaire du bâtiment, et à défaut au gestionnaire de toute l'organisation", () => {
    const pour = (destinataire: string) => envoi.mock.calls.filter((c) => c[0] === 'batiment_echeance' && c[1] === destinataire);
    expect(pour('ecole@ville.fr')).toHaveLength(2);
    expect(pour('global@ville.fr')).toHaveLength(1);
    expect(pour('admin@ville.fr')).toHaveLength(0);
  });

  it('ne repose rien ni ne réécrit au passage suivant', async () => {
    envoi.mockClear();
    await verifierEcheancesBatiments();
    expect(nombreAlertes()).toBe(3);
    expect(envoi).not.toHaveBeenCalled();
  });
});

describe('Ce qui fait disparaître une alerte', () => {
  it('un rapport validé qui repousse l’échéance', async () => {
    const doc = base
      .prepare(
        `INSERT INTO batiment_documents (site_id, rubrique_id, titre, chemin, nom_origine, date_document, statut)
         SELECT site_id, rubrique_id, 'Rapport', 'r.pdf', 'r.pdf', ?, 'a_valider' FROM batiment_suivis WHERE id = ?`
      )
      .run(jour(-1), enRetard).lastInsertRowid;

    await validerDocument(Number(doc), {}, 1);
    // Retirée tout de suite, sans attendre le passage du cron…
    expect(alerte(enRetard)).toBeUndefined();
    // … et pas reposée : le désenfumage est désormais dû dans un an.
    await verifierEcheancesBatiments();
    expect(alerte(enRetard)).toBeUndefined();
  });

  it('un suivi désactivé ou supprimé', async () => {
    base.prepare('UPDATE batiment_suivis SET actif = 0 WHERE id = ?').run(mairie);
    await verifierEcheancesBatiments();
    expect(alerte(mairie)).toBeUndefined();

    base.prepare('UPDATE batiment_suivis SET actif = 1 WHERE id = ?').run(mairie);
    await verifierEcheancesBatiments();
    expect(alerte(mairie)).toBeDefined();

    await supprimerSuivi(mairie);
    expect(alerte(mairie)).toBeUndefined();
  });
});

describe('Un rejet', () => {
  it("tient tant que l'échéance n'a pas bougé, même relue avec une heure", async () => {
    // Un `DATETIME` rend « AAAA-MM-JJ 00:00:00 » : le rejet doit y reconnaître
    // l'échéance « AAAA-MM-JJ » qu'il a écartée.
    base
      .prepare("UPDATE alerts SET is_dismissed = 1, due_date = ? WHERE plugin_reference = 'batiment-suivi' AND plugin_reference_id = ?")
      .run(`${jour(10)} 00:00:00`, bientot);

    await verifierEcheancesBatiments();
    expect(alerte(bientot).is_dismissed).toBe(1);
  });

  it("cède quand l'échéance change", async () => {
    base.prepare('UPDATE batiment_suivis SET echeance_initiale = ? WHERE id = ?').run(jour(12), bientot);
    await verifierEcheancesBatiments();
    expect(alerte(bientot)).toMatchObject({ is_dismissed: 0, due_date: jour(12) });
  });
});

describe('Qui voit ces alertes', () => {
  const visibles = async (userId: number, role: string) => {
    const { sql, params } = await filtreAlertesBatiments({ userId, role });
    return (base.prepare(`SELECT COUNT(*) AS n FROM alerts a WHERE 1 = 1${sql}`).get(...params) as any).n;
  };

  beforeAll(async () => {
    // Une échéance à la mairie, que le gestionnaire de l'école n'a pas à voir.
    const ria = (base.prepare("SELECT id FROM batiment_rubriques WHERE code = 'ria'").get() as any).id;
    base.prepare('INSERT INTO batiment_suivis (site_id, rubrique_id, echeance_initiale) VALUES (2, ?, ?)').run(ria, jour(2));
    await verifierEcheancesBatiments();
  });

  it('qui gère les lieux les voit toutes ; un gestionnaire, celles de son bâtiment ; les autres, aucune', async () => {
    const total = nombreAlertes();
    expect(total).toBe(2);
    expect(await visibles(1, 'admin')).toBe(total);
    expect(await visibles(2, 'agent')).toBe(total);
    expect(await visibles(3, 'agent')).toBe(1);
    expect(await visibles(4, 'user')).toBe(0);
  });

  it("ne cache pas pour autant les alertes des autres modules", async () => {
    base.prepare("INSERT INTO alerts (title, alert_type, plugin_reference) VALUES ('Vidange', 'maintenance', 'maintenance')").run();
    base.prepare("INSERT INTO alerts (title, alert_type) VALUES ('Manuelle', 'custom')").run();
    expect(await visibles(4, 'user')).toBe(2);
  });
});

describe('Les destinataires', () => {
  it("retombent sur les administrateurs quand personne d'autre ne gère", async () => {
    base.prepare('UPDATE users SET gere_organisation = 0').run();
    expect(await destinatairesBatiment(2)).toEqual(['admin@ville.fr']);
    expect(await destinatairesBatiment(1)).toEqual(['ecole@ville.fr']);
  });
});
