import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import express from 'express';
import BetterSqlite3 from 'better-sqlite3';
import migration050 from '../src/database/migrations/050_comptabilite';
import type { ContexteMigration } from '../src/database/migrations/types';

/**
 * La passerelle comptable avec Ciril Finance.
 *
 * Ce qu'on fige :
 *
 *   **L'import est rejouable** : rapproché par numéro, il met à jour sans
 *   doublon et ne touche jamais au rangement. Les fichiers d'un logiciel de
 *   gestion — points-virgules, Windows-1252, « 1 234,56 », « 18/03/2026 » — se
 *   lisent tels quels.
 *
 *   **Un objet immobilisé ne disparaît pas** : il sort, avec une date et un
 *   motif, reste en base, et sa suppression est refusée.
 *
 *   **Un lot par jour** : dix sorties font un fichier et un mail ; une file vide
 *   n'envoie rien ; un échec total garde les sorties pour le lot suivant.
 *
 *   **Chaque geste a sa case** : un comptable voit ce qui attend d'être rangé
 *   sans pouvoir le ranger, sauf si on le lui a coché.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseCompta = sqlite;
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
jest.mock('../src/services/webdav.service', () => ({
  lireConfiguration: jest.fn(async () => ({ url: 'https://cloud.ville.fr', username: 'u', password: 'p' })),
  deposerFichier: jest.fn(async () => ({ success: true, url: 'https://cloud.ville.fr/x' })),
}));
jest.mock('../src/services/email.service', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = (global as any).__connecte;
    next();
  },
  requireAdmin: (req: any, res: any, next: any) =>
    req.user?.role === 'admin' ? next() : res.status(403).json({ success: false, message: 'Admin requis' }),
}));
jest.mock('../src/middleware/rateLimiter.middleware', () => ({
  exportLimiter: (_req: any, _res: any, next: any) => next(),
}));

import comptabiliteRoutes from '../src/routes/comptabilite.routes';
import { deposerFichier } from '../src/services/webdav.service';
import { sendEmail } from '../src/services/email.service';
import {
  analyserFichier,
  annulerSortie,
  confirmerIntegration,
  definirDroitsCompta,
  droitsComptaDe,
  enregistrerReglages,
  envoyerLot,
  envoyerLotSiEcheance,
  importerFichier,
  lierObjet,
  lireSuivi,
  prochainEnvoi,
  rangerImmobilisations,
  REGLAGES_PAR_DEFAUT,
  sortirObjet,
  annulerExport,
} from '../src/services/comptabilite.service';
import { analyserCsv, decoderTexte, encoderWindows1252, versJourISO, versMontant } from '../src/utils/tableurComptable';

const base: BetterSqlite3.Database = (global as any).__baseCompta;
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'compta-'));
process.env.DOSSIER_EXPORTS_COMPTABLES = path.join(dossier, 'exports');

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

/** Un fichier CSV tel que l'enverrait Ciril : points-virgules, Windows-1252. */
function fichierCiril(nom: string, lignes: string[][]): string {
  const chemin = path.join(dossier, nom);
  fs.writeFileSync(chemin, encoderWindows1252(lignes.map((l) => l.join(';')).join('\r\n')));
  return chemin;
}

const ENTETES = ['N° inventaire', 'Désignation', 'Date de mise en service', 'Valeur brute', 'Fournisseur', 'N° facture'];

const app = express();
app.use(express.json());
app.use('/api/comptabilite', comptabiliteRoutes);
const en = (userId: number, role = 'user') => {
  (global as any).__connecte = { userId, role, email: `u${userId}@ville.fr` };
};

function viderCompta() {
  base.exec(`
    DELETE FROM sorties_inventaire; DELETE FROM exports_comptables; DELETE FROM immobilisations;
    DELETE FROM imports_comptables; DELETE FROM objects; DELETE FROM activity_logs; DELETE FROM settings;
  `);
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT);
    CREATE TABLE objects (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, subcategory_id INTEGER, name TEXT NOT NULL,
      description TEXT, image TEXT, reference TEXT, inventaire_interne TEXT, serial_number TEXT, purchase_date DATE,
      purchase_price DECIMAL(10,2), status TEXT DEFAULT 'active', location TEXT, notes TEXT, material_type TEXT DEFAULT 'unique',
      quantity_total INTEGER DEFAULT 0, unit_cost REAL DEFAULT 0, created_at DATETIME, updated_at DATETIME);
    CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key TEXT UNIQUE, setting_value TEXT, setting_type TEXT, description TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity_type TEXT,
      entity_id INTEGER, details TEXT, created_at DATETIME);
    CREATE TABLE plugins (id INTEGER PRIMARY KEY, slug TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE plugin_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id INTEGER, role TEXT, can_access INTEGER);
    CREATE TABLE user_plugin_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plugin_id INTEGER, can_access INTEGER);
    CREATE TABLE smtp_config (id INTEGER PRIMARY KEY, is_active INTEGER);
  `);
  await migration050.up(contexteSqlite(base));
  // Rejouée : la migration est idempotente.
  await migration050.up(contexteSqlite(base));

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (1, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (2, 'compta@ville.fr', 'Claire', 'Compta', 'user'),
      (3, 'inventaire@ville.fr', 'Ivan', 'Inventaire', 'supervisor'),
      (4, 'autre@ville.fr', 'Oscar', 'Autre', 'user');
    INSERT INTO categories (id, name) VALUES (1, 'Mobilier'), (2, 'Informatique');
    INSERT INTO subcategories (id, category_id, name) VALUES (10, 1, 'Armoires');
    -- Le module est fermé aux rôles non administrateurs, ouvert à Claire et Ivan.
    INSERT INTO plugins (id, slug, is_active) VALUES (1, 'comptabilite', 1);
    INSERT INTO plugin_permissions (plugin_id, role, can_access) VALUES (1, 'user', 0), (1, 'supervisor', 0);
    INSERT INTO user_plugin_permissions (user_id, plugin_id, can_access) VALUES (2, 1, 1), (3, 1, 1);
  `);
  // Profil Comptable : pas « Ranger ». Profil Inventaire : ranger, sortir, envoyer.
  await definirDroitsCompta(2, { importer: true, envoyer: true, integrer: true, recoitMail: true });
  await definirDroitsCompta(3, { ranger: true, sortir: true, envoyer: true });
});

afterAll(() => {
  fs.rmSync(dossier, { recursive: true, force: true });
});

beforeEach(() => {
  viderCompta();
  (deposerFichier as jest.Mock).mockClear();
  (sendEmail as jest.Mock).mockClear();
});

// ====================================================================== fichiers

describe('lecture des fichiers de la compta', () => {
  it('lit montants et dates au format français', () => {
    expect(versMontant('1 234,56 €')).toBe(1234.56);
    expect(versMontant('1.234,56')).toBe(1234.56);
    expect(versMontant('1,234.56')).toBe(1234.56);
    expect(versMontant('abc')).toBeNull();
    expect(versJourISO('18/03/2026')).toBe('2026-03-18');
    expect(versJourISO('18-03-26')).toBe('2026-03-18');
    expect(versJourISO('2026-03-18T00:00:00')).toBe('2026-03-18');
    expect(versJourISO('46099')).toBe('2026-03-18');
    expect(versJourISO('31/02/2026')).toBeNull();
  });

  it('décode un fichier Windows-1252 et respecte les guillemets', () => {
    const texte = decoderTexte(encoderWindows1252('Désignation;Prix\r\n"Armoire; métal";1 200,00\r\n'));
    expect(analyserCsv(texte, ';')).toEqual([
      ['Désignation', 'Prix'],
      ['Armoire; métal', '1 200,00'],
    ]);
  });

  it('garde un guillemet au milieu d’un champ, comme le signe des pouces', () => {
    // Trouvé en préparant les captures : la ligne suivante disparaissait dans
    // la désignation.
    expect(analyserCsv('N°;Désignation;Prix\r\n1;Ordinateur portable 14";1049\r\n2;Écran 27";199\r\n', ';')).toEqual([
      ['N°', 'Désignation', 'Prix'],
      ['1', 'Ordinateur portable 14"', '1049'],
      ['2', 'Écran 27"', '199'],
    ]);
  });

  it('reconnaît les colonnes courantes d’un export d’immobilisations', async () => {
    const chemin = fichierCiril('analyse.csv', [ENTETES, ['IMM-001', 'Armoire métallique', '18/03/2026', '1 200,00', 'Bureau Pro', 'F-12']]);
    const analyse = await analyserFichier(chemin, 'analyse.csv');
    expect(analyse.manquants).toEqual([]);
    expect(analyse.nouvelles).toBe(1);
    expect(analyse.apercu[0]).toMatchObject({
      numero: 'IMM-001',
      libelle: 'Armoire métallique',
      date_acquisition: '2026-03-18',
      valeur_acquisition: 1200,
      fournisseur: 'Bureau Pro',
      numero_facture: 'F-12',
    });
  });
});

// ====================================================================== import

describe('import des immobilisations', () => {
  it('est rejouable : pas de doublon, mise à jour sans toucher au rangement', async () => {
    const lignes = [ENTETES, ['IMM-001', 'Armoire', '18/03/2026', '1 200,00', 'Bureau Pro', 'F-12'], ['IMM-002', 'Bureau', '', '300', '', '']];
    const premier = await importerFichier(fichierCiril('a.csv', lignes), 'a.csv', null, 2);
    expect(premier).toMatchObject({ creees: 2, misesAJour: 0, erreurs: [] });

    const immo = base.prepare("SELECT id FROM immobilisations WHERE numero = 'IMM-001'").get() as any;
    await rangerImmobilisations({ ids: [immo.id], subcategoryId: 10 }, 3);

    lignes[1][3] = '1 250,00';
    const second = await importerFichier(fichierCiril('b.csv', lignes), 'b.csv', null, 2);
    expect(second).toMatchObject({ creees: 0, misesAJour: 1, inchangees: 1 });
    const apres = base.prepare("SELECT etat, valeur_acquisition FROM immobilisations WHERE numero = 'IMM-001'").get() as any;
    expect(apres).toEqual({ etat: 'rangee', valeur_acquisition: 1250 });
    expect((base.prepare('SELECT COUNT(*) AS n FROM immobilisations').get() as any).n).toBe(2);
  });

  it('signale les lignes sans numéro ou en double, et retient les colonnes par leur intitulé', async () => {
    const r = await importerFichier(
      fichierCiril('c.csv', [ENTETES, ['', 'Sans numéro', '', '', '', ''], ['IMM-3', 'Chaise', '', '', '', ''], ['IMM-3', 'Chaise', '', '', '', '']]),
      'c.csv',
      null,
      2
    );
    expect(r.creees).toBe(1);
    expect(r.erreurs.map((e) => e.ligne)).toEqual([2, 4]);

    // Les colonnes changent d'ordre au fichier suivant : elles sont retrouvées.
    const r2 = await importerFichier(fichierCiril('d.csv', [['Désignation', 'N° inventaire'], ['Table', 'IMM-4']]), 'd.csv', null, 2);
    expect(r2.creees).toBe(1);
    expect(base.prepare("SELECT libelle FROM immobilisations WHERE numero = 'IMM-4'").get()).toEqual({ libelle: 'Table' });
  });
});

// ====================================================================== rangement et sortie

async function uneImmobilisation(numero: string, libelle = 'Armoire', valeur = 1200): Promise<number> {
  const r = base
    .prepare("INSERT INTO immobilisations (numero, libelle, valeur_acquisition, etat) VALUES (?, ?, ?, 'a_ranger')")
    .run(numero, libelle, valeur);
  return Number(r.lastInsertRowid);
}

describe('rangement', () => {
  it('crée N exemplaires liés au même numéro, chacun avec sa part de la valeur', async () => {
    const id = await uneImmobilisation('IMM-10', 'Armoire', 1000);
    const { objets } = await rangerImmobilisations({ ids: [id], subcategoryId: 10, exemplaires: 2 }, 3);
    expect(objets).toHaveLength(2);
    const lignes = base.prepare('SELECT category_id, subcategory_id, purchase_price, immobilisation_id FROM objects').all();
    expect(lignes).toEqual([
      { category_id: null, subcategory_id: 10, purchase_price: 500, immobilisation_id: id },
      { category_id: null, subcategory_id: 10, purchase_price: 500, immobilisation_id: id },
    ]);
    expect(base.prepare('SELECT etat, rangee_par FROM immobilisations WHERE id = ?').get(id)).toEqual({ etat: 'rangee', rangee_par: 3 });
  });

  it('rattache un objet existant, et délier le remet à ranger', async () => {
    const id = await uneImmobilisation('IMM-11');
    const objet = Number(base.prepare("INSERT INTO objects (name, category_id) VALUES ('Armoire saisie à la main', 1)").run().lastInsertRowid);
    await lierObjet(objet, id, 3);
    expect(base.prepare('SELECT etat FROM immobilisations WHERE id = ?').get(id)).toEqual({ etat: 'rangee' });
    await lierObjet(objet, null, 3);
    expect(base.prepare('SELECT etat FROM immobilisations WHERE id = ?').get(id)).toEqual({ etat: 'a_ranger' });
  });
});

describe('sortie d’inventaire', () => {
  it('sort un objet sans le supprimer, puis l’annulation lui rend son statut', async () => {
    const objet = Number(base.prepare("INSERT INTO objects (name, status) VALUES ('Armoire', 'maintenance')").run().lastInsertRowid);
    await sortirObjet(objet, { motif: 'casse', date: '2026-09-01', commentaire: 'Porte arrachée' }, 3);
    expect(base.prepare('SELECT status FROM objects WHERE id = ?').get(objet)).toEqual({ status: 'sorti' });
    await expect(sortirObjet(objet, { motif: 'perdu' }, 3)).rejects.toThrow('déjà sorti');

    await annulerSortie(objet, 3);
    expect(base.prepare('SELECT status FROM objects WHERE id = ?').get(objet)).toEqual({ status: 'maintenance' });
  });

  it('refuse un motif inconnu ou une date future', async () => {
    const objet = Number(base.prepare("INSERT INTO objects (name) VALUES ('Chaise')").run().lastInsertRowid);
    await expect(sortirObjet(objet, { motif: 'envole' }, 3)).rejects.toThrow('motif');
    await expect(sortirObjet(objet, { motif: 'perdu', date: '2999-01-01' }, 3)).rejects.toThrow('futur');
  });
});

// ====================================================================== envoi

async function sortirDesObjets(n: number, avecNumero = true): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const immo = avecNumero ? await uneImmobilisation(`IMM-S${i}-${Math.random()}`, `Bien ${i}`) : null;
    const objet = Number(
      base.prepare('INSERT INTO objects (name, immobilisation_id) VALUES (?, ?)').run(`Bien ${i}`, immo).lastInsertRowid
    );
    await sortirObjet(objet, { motif: 'reforme', date: '2026-09-01' }, 3);
    ids.push(objet);
  }
  return ids;
}

async function activerEnvoi(nextcloud = true, mail = true) {
  await enregistrerReglages({
    envoi: { frequence: 'quotidien', heure: 18, nextcloud: { actif: nextcloud, dossier: 'Compta/A traiter' }, mail: { actif: mail, adresses: 'service.compta@ville.fr' } },
  });
}

describe('envoi groupé à la compta', () => {
  it('dix sorties font un seul fichier et un seul mail', async () => {
    await activerEnvoi();
    await sortirDesObjets(10);
    const r = await envoyerLot('envoi', 'manuel', 3);

    expect(r).toMatchObject({ lignes: 10, nextcloud: 'ok', mail: 'ok', envoye: true });
    expect(deposerFichier).toHaveBeenCalledTimes(1);
    expect((deposerFichier as jest.Mock).mock.calls[0][0]).toMatch(/^Compta\/A traiter\/sorties_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // Le service comptable et Claire, qui a coché « reçoit le mail ».
    expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe('service.compta@ville.fr, compta@ville.fr');
    expect((sendEmail as jest.Mock).mock.calls[0][2].sorties).toHaveLength(10);

    // Plus rien dans la file : un second envoi ne produit rien.
    const encore = await envoyerLot('envoi', 'manuel', 3);
    expect(encore).toMatchObject({ lignes: 0, exportId: null });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('écrit un fichier lisible par un logiciel réglé en français', async () => {
    await activerEnvoi(false, true);
    await sortirDesObjets(1);
    const r = await envoyerLot('envoi', 'manuel', 3);
    const exp = base.prepare('SELECT chemin_local FROM exports_comptables WHERE id = ?').get(r.exportId) as any;
    const texte = decoderTexte(fs.readFileSync(exp.chemin_local));
    const [entete, ligne] = analyserCsv(texte, ';');
    expect(entete[0]).toBe('N° immobilisation');
    expect(ligne[2]).toBe('01/09/2026');
    expect(ligne[3]).toBe('REFORME');
    expect(ligne[4]).toBe('1200,00');
  });

  it('n’envoie pas les sorties sans numéro comptable', async () => {
    await activerEnvoi();
    await sortirDesObjets(2, false);
    expect(await envoyerLot('envoi', 'manuel', 3)).toMatchObject({ lignes: 0 });
    expect((await lireSuivi()).horsCompta).toBe(2);
  });

  it('un échec total garde les sorties pour le lot suivant ; un échec partiel est signalé', async () => {
    await activerEnvoi();
    await sortirDesObjets(2);
    (deposerFichier as jest.Mock).mockResolvedValueOnce({ success: false, error: 'Nextcloud injoignable' });
    (sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP en panne'));

    const echec = await envoyerLot('envoi', 'manuel', 3);
    expect(echec.envoye).toBe(false);
    expect((base.prepare('SELECT COUNT(*) AS n FROM sorties_inventaire WHERE export_id IS NULL').get() as any).n).toBe(2);
    const suivi = await lireSuivi();
    expect(suivi.aEnvoyer.echec?.erreur).toContain('Nextcloud injoignable');
    expect(suivi.aEnvoyer.couleur).toBe('rouge');

    (deposerFichier as jest.Mock).mockResolvedValueOnce({ success: false, error: 'Nextcloud injoignable' });
    const partiel = await envoyerLot('envoi', 'manuel', 3);
    expect(partiel).toMatchObject({ envoye: true, nextcloud: 'echec', mail: 'ok' });
    expect((base.prepare('SELECT COUNT(*) AS n FROM sorties_inventaire WHERE export_id IS NULL').get() as any).n).toBe(0);
    expect((await lireSuivi()).aEnvoyer.echec).toBeNull();
  });

  it('une sortie envoyée ne s’annule plus ; annuler l’envoi la remet dans la file', async () => {
    await activerEnvoi();
    const [objet] = await sortirDesObjets(1);
    const r = await envoyerLot('envoi', 'manuel', 3);
    await expect(annulerSortie(objet, 3)).rejects.toThrow('déjà été envoyée');
    await annulerExport(r.exportId!, 1);
    expect((base.prepare('SELECT export_id FROM sorties_inventaire WHERE object_id = ?').get(objet) as any).export_id).toBeNull();
  });
});

describe('envoi automatique', () => {
  const a = (jour: string, heure: number) => new Date(`${jour}T${String(heure).padStart(2, '0')}:10:00`);

  it('attend l’heure, n’envoie qu’une fois par jour, rattrape un retard', async () => {
    await activerEnvoi();
    await sortirDesObjets(3);

    expect(await envoyerLotSiEcheance(a('2026-09-28', 17))).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();

    // Serveur arrêté à 18 h : rattrapé à 21 h.
    expect(await envoyerLotSiEcheance(a('2026-09-28', 21))).toMatchObject({ lignes: 3, envoye: true });
    await sortirDesObjets(1);
    expect(await envoyerLotSiEcheance(a('2026-09-28', 22))).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // Le lendemain, la sortie du soir part avec le lot du jour.
    expect(await envoyerLotSiEcheance(a('2026-09-29', 18))).toMatchObject({ lignes: 1 });
  });

  it('ne part jamais en mode manuel, et le prochain envoi se calcule', async () => {
    await enregistrerReglages({ envoi: { frequence: 'manuel', nextcloud: { actif: true }, mail: { actif: false } } });
    await sortirDesObjets(1);
    expect(await envoyerLotSiEcheance(a('2026-09-28', 20))).toBeNull();

    const reglages = { ...REGLAGES_PAR_DEFAUT, envoi: { ...REGLAGES_PAR_DEFAUT.envoi, nextcloud: { actif: true, dossier: 'x' } } };
    expect(prochainEnvoi(reglages, null, new Date('2026-09-28T09:00:00'))).toBe('2026-09-28 18:10:00');
    expect(prochainEnvoi(reglages, '2026-09-28', new Date('2026-09-28T19:00:00'))).toBe('2026-09-29 18:10:00');
    const hebdo = { ...reglages, envoi: { ...reglages.envoi, frequence: 'hebdomadaire' as const, jour: 5 } };
    // Le lundi 28/09/2026 → le vendredi 2/10.
    expect(prochainEnvoi(hebdo, null, new Date('2026-09-28T09:00:00'))).toBe('2026-10-02 18:10:00');
  });
});

// ====================================================================== suivi et intégration

describe('tableau de suivi', () => {
  it('dit qui attend qui, et l’intégration fait redescendre la carte de la compta', async () => {
    await activerEnvoi();
    await uneImmobilisation('IMM-R1');
    base.prepare("UPDATE immobilisations SET created_at = '2026-01-01 08:00:00'").run();
    await sortirDesObjets(2);
    const r = await envoyerLot('envoi', 'manuel', 3);

    let suivi = await lireSuivi(new Date('2026-09-28T10:00:00'));
    // IMM-R1 attend depuis janvier, avec les deux immobilisations que l'aide de
    // test lie directement à leur objet sans passer par le rangement.
    expect(suivi.aRanger).toMatchObject({ nombre: 3, couleur: 'rouge' });
    expect(suivi.aIntegrer).toMatchObject({ envois: 1, biens: 2, couleur: 'orange' });

    await confirmerIntegration(r.exportId!, 2);
    suivi = await lireSuivi();
    expect(suivi.aIntegrer).toMatchObject({ envois: 0, couleur: 'vert' });
    expect(suivi.mouvements[0].details).toContain('Intégration dans Ciril confirmée');
    expect(suivi.mouvements[0].par).toBe('Claire Compta');
  });
});

// ====================================================================== droits

describe('chaque geste a sa case', () => {
  it('l’administrateur a tous les gestes ; sans ligne, on consulte seulement', async () => {
    expect(await droitsComptaDe(1, 'admin')).toMatchObject({ importer: true, ranger: true, regler: true, recoitMail: false });
    expect(await droitsComptaDe(4, 'user')).toMatchObject({ importer: false, ranger: false });
  });

  it('le comptable consulte ce qui attend d’être rangé, sans pouvoir le ranger', async () => {
    const id = await uneImmobilisation('IMM-D1');
    en(2);
    const liste = await request(app).get('/api/comptabilite/immobilisations?etat=a_ranger');
    expect(liste.status).toBe(200);
    expect(liste.body.immobilisations.map((i: any) => i.numero)).toEqual(['IMM-D1']);

    const refus = await request(app).post('/api/comptabilite/immobilisations/ranger').send({ ids: [id], categoryId: 1 });
    expect(refus.status).toBe(403);
    expect(refus.body.message).toContain('Ranger dans les catégories');

    en(3, 'supervisor');
    const ok = await request(app).post('/api/comptabilite/immobilisations/ranger').send({ ids: [id], categoryId: 1 });
    expect(ok.status).toBe(200);
  });

  it('sans le module, tout est refusé ; seul un administrateur annule un envoi', async () => {
    en(4);
    expect((await request(app).get('/api/comptabilite/suivi')).status).toBe(403);
    en(4, 'service');
    expect((await request(app).get('/api/comptabilite/suivi')).status).toBe(403);

    en(3, 'supervisor');
    expect((await request(app).delete('/api/comptabilite/exports/1')).status).toBe(403);
    en(2);
    expect((await request(app).put('/api/comptabilite/reglages').send({})).status).toBe(403);
    expect((await request(app).get('/api/comptabilite/suivi')).status).toBe(200);
  });

  it('confirmer l’intégration demande sa case', async () => {
    await activerEnvoi();
    await sortirDesObjets(1);
    const r = await envoyerLot('envoi', 'manuel', 3);
    en(3, 'supervisor');
    expect((await request(app).post(`/api/comptabilite/exports/${r.exportId}/integration`)).status).toBe(403);
    en(2);
    expect((await request(app).post(`/api/comptabilite/exports/${r.exportId}/integration`)).status).toBe(200);
  });
});
