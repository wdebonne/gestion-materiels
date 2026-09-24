/**
 * Une échéance remplacée ne lève plus d'alerte.
 *
 * Chaque contrôle technique expiré levait sa propre alerte critique, fût-il
 * remplacé depuis longtemps : un véhicule contrôlé tous les deux ans depuis
 * 2020 portait trois alertes « expiré », et le tableau de bord affichait en tête
 * des échéances de 2020. Même chose pour un entretien refait depuis.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseAlertes = sqlite;
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

import type BetterSqlite3 from 'better-sqlite3';
import { checkAlerts } from '../src/services/cron.service';

const base: BetterSqlite3.Database = (global as any).__baseAlertes;

const jour = (decalage: number) => {
  const d = new Date(Date.now() + decalage * 86_400_000);
  return d.toISOString().slice(0, 10);
};

beforeAll(() => {
  // La base ne porte que les tables des contrôles et des entretiens : les
  // sections suivantes du cron (espaces verts, agenda) échouent, attendu ici.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);

  base.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, setting_key TEXT UNIQUE, setting_value TEXT, setting_type TEXT, description TEXT);
    INSERT INTO settings (setting_key, setting_value, setting_type) VALUES ('emails_suspendus', 'manuel', 'string');
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER, subcategory_id INTEGER);
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, alert_type TEXT, severity TEXT,
      object_id INTEGER, plugin_reference TEXT, plugin_reference_id INTEGER, is_read INTEGER DEFAULT 0,
      is_dismissed INTEGER DEFAULT 0, due_date TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE technical_controls (id INTEGER PRIMARY KEY, object_id INTEGER, control_date TEXT, expiry_date TEXT,
      reminder_sent INTEGER DEFAULT 0);
    CREATE TABLE maintenances (id INTEGER PRIMARY KEY, object_id INTEGER, maintenance_type TEXT, maintenance_date TEXT,
      next_date TEXT, reminder_sent INTEGER DEFAULT 0);
    INSERT INTO objects (id, name) VALUES (1, 'Kangoo'), (2, 'Clio');
  `);

  // Le Kangoo : contrôlé il y a six, quatre et deux ans — le dernier expire aujourd'hui dans 5 jours.
  base.prepare('INSERT INTO technical_controls (id, object_id, control_date, expiry_date) VALUES (?, 1, ?, ?)').run(1, jour(-2190), jour(-1460));
  base.prepare('INSERT INTO technical_controls (id, object_id, control_date, expiry_date) VALUES (?, 1, ?, ?)').run(2, jour(-1460), jour(-730));
  base.prepare('INSERT INTO technical_controls (id, object_id, control_date, expiry_date) VALUES (?, 1, ?, ?)').run(3, jour(-725), jour(5));
  // La Clio : un seul contrôle, réellement expiré.
  base.prepare('INSERT INTO technical_controls (id, object_id, control_date, expiry_date) VALUES (?, 2, ?, ?)').run(4, jour(-800), jour(-70));

  // Vidange du Kangoo refaite depuis ; celle de la Clio jamais refaite.
  base.prepare('INSERT INTO maintenances VALUES (10, 1, ?, ?, ?, 0)').run('Vidange', jour(-500), jour(-135));
  base.prepare('INSERT INTO maintenances VALUES (11, 1, ?, ?, ?, 0)').run('Vidange', jour(-130), jour(235));
  base.prepare('INSERT INTO maintenances VALUES (12, 2, ?, ?, ?, 0)').run('Vidange', jour(-500), jour(-135));

  // Une alerte déjà posée par l'ancien comportement, sur un contrôle remplacé.
  base.prepare(`INSERT INTO alerts (title, alert_type, severity, object_id, plugin_reference, plugin_reference_id, due_date)
    VALUES ('Contrôle technique: Kangoo', 'technical_control', 'critical', 1, 'technical-control', 1, ?)`).run(jour(-1460));
});

const alertes = (reference: string) =>
  (base.prepare('SELECT plugin_reference_id AS id FROM alerts WHERE plugin_reference = ? ORDER BY id').all(reference) as any[]).map(
    (a) => a.id
  );

it('ne lève une alerte que sur le dernier contrôle de chaque véhicule', async () => {
  await checkAlerts();
  expect(alertes('technical-control')).toEqual([3, 4]);
});

it("retire l'alerte déjà posée sur un contrôle remplacé", async () => {
  await checkAlerts();
  expect(alertes('technical-control')).not.toContain(1);
});

it("ignore un entretien refait depuis, garde celui qui ne l'a pas été", async () => {
  await checkAlerts();
  expect(alertes('maintenance')).toEqual([12]);
});

it('ne repose rien au passage suivant', async () => {
  await checkAlerts();
  const avant = (base.prepare('SELECT COUNT(*) AS n FROM alerts').get() as any).n;
  await checkAlerts();
  expect((base.prepare('SELECT COUNT(*) AS n FROM alerts').get() as any).n).toBe(avant);
});
