import type BetterSqlite3 from 'better-sqlite3';
import ExcelJS from 'exceljs';

/**
 * Export des manifestations vers une feuille de calcul.
 *
 * Le suivi se partage par fichier : une feuille déposée sur un Nextcloud que
 * plusieurs services consultent. Elle était tenue à la main, donc périmée dès
 * qu'un statut changeait — et c'est ce fichier périmé que tout le monde
 * continuait de lire.
 *
 * Les colonnes sont une **donnée**, pas du code : chaque collectivité range son
 * tableau à sa façon. Ces tests protègent surtout ce qui se casse en silence —
 * un profil qui référence un champ disparu, une cellule vide au lieu d'un total.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseExport = sqlite;

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
    },
  };
});

import {
  CHAMPS_EXPORT,
  genererClasseur,
  resoudreColonnes,
  valeurDe,
} from '../src/services/manifestationExport.service';
import { construireUrl } from '../src/services/webdav.service';

const base: BetterSqlite3.Database = (global as any).__baseExport;

beforeAll(() => {
  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, first_name VARCHAR(255), last_name VARCHAR(255));
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE manifestation_stock (id INTEGER PRIMARY KEY, name VARCHAR(255), unit VARCHAR(50));
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20),
      date_start DATE, date_end DATE, start_time VARCHAR(10), end_time VARCHAR(10),
      delivery_date DATE, recovery_date DATE, delivery_address TEXT,
      contact_name VARCHAR(255), contact_phone VARCHAR(50), contact_email VARCHAR(255),
      expected_people INTEGER, notes_interior TEXT, notes_exterior TEXT,
      created_by INTEGER, updated_at DATETIME
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY, manifestation_id INTEGER, stock_id INTEGER,
      quantity_requested INTEGER DEFAULT 0, quantity_delivered INTEGER DEFAULT 0,
      quantity_recovered INTEGER DEFAULT 0, quantity_lost INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_approvals (
      id INTEGER PRIMARY KEY, manifestation_id INTEGER, service_id INTEGER,
      kind VARCHAR(20) DEFAULT 'approbation', status VARCHAR(20) DEFAULT 'pending'
    );
  `);

  base.exec(`
    INSERT INTO users (id, first_name, last_name) VALUES (1, 'Martin', 'Dubois');
    INSERT INTO services (id, name) VALUES (1, 'Service festif'), (2, 'Service informatique');
    INSERT INTO manifestation_stock (id, name, unit) VALUES (1, 'Chaise', 'unité'), (2, 'Table', 'unité');

    INSERT INTO manifestations
      (id, title, status, date_start, delivery_date, recovery_date, delivery_address,
       contact_name, expected_people, notes_interior, created_by, updated_at)
    VALUES
      (10, 'Brocante', 'delivered', '2026-07-14', '2026-07-13', '2026-07-15', 'Place du marché',
       'Martin Dubois', 250, 'Prévoir une rallonge', 1, '2026-07-01T10:00:00.000Z'),
      (20, 'Conseil', 'archived', '2026-06-01', NULL, NULL, 'Mairie', 'Ines F', 30, NULL, 1, NULL);

    INSERT INTO manifestation_materials
      (manifestation_id, stock_id, quantity_requested, quantity_delivered, quantity_recovered, quantity_lost)
    VALUES
      (10, 1, 50, 52, 50, 2),
      (10, 2, 10, 10, 10, 0);

    INSERT INTO manifestation_approvals (id, manifestation_id, service_id, kind, status) VALUES
      (1, 10, 1, 'approbation', 'approved'),
      (2, 10, 2, 'approbation', 'pending');
  `);
});

/** Manifestation telle que l'export la lit, matériel et approbations compris. */
const brocante = () => ({
  ...(base.prepare('SELECT * FROM manifestations WHERE id = 10').get() as any),
  created_by_name: 'Martin Dubois',
  materials: base
    .prepare(
      `SELECT mm.*, ms.name as stock_name FROM manifestation_materials mm
       JOIN manifestation_stock ms ON ms.id = mm.stock_id WHERE mm.manifestation_id = 10`
    )
    .all(),
  approvals: base
    .prepare(
      `SELECT a.*, s.name as service_name FROM manifestation_approvals a
       LEFT JOIN services s ON s.id = a.service_id WHERE a.manifestation_id = 10`
    )
    .all(),
})

describe('Choix des colonnes', () => {
  it('sort tout, dans l’ordre de référence, quand aucun profil ne dit rien', () => {
    expect(resoudreColonnes(null)).toEqual(CHAMPS_EXPORT);
    expect(resoudreColonnes([])).toEqual(CHAMPS_EXPORT);
  });

  it('respecte l’ordre du profil', () => {
    const colonnes = resoudreColonnes([{ champ: 'status' }, { champ: 'title' }])
    expect(colonnes.map((c) => c.champ)).toEqual(['status', 'title']);
  });

  it('laisse renommer un intitulé', () => {
    // Chaque collectivité nomme ses colonnes à sa façon.
    const [colonne] = resoudreColonnes([{ champ: 'title', entete: 'Nom de la fête' }]);
    expect(colonne.libelle).toBe('Nom de la fête');
  });

  it('retombe sur l’intitulé par défaut si l’entête est vide', () => {
    const [colonne] = resoudreColonnes([{ champ: 'title', entete: '   ' }]);
    expect(colonne.libelle).toBe('Manifestation');
  });

  it('ignore un champ inconnu au lieu de tout faire échouer', () => {
    // Un profil enregistré avant une évolution du code ne doit pas rendre
    // l'export impossible : il perd une colonne, c'est tout.
    const colonnes = resoudreColonnes([
      { champ: 'title' },
      { champ: 'champ_disparu' as any },
      { champ: 'status' },
    ]);
    expect(colonnes.map((c) => c.champ)).toEqual(['title', 'status']);
  });
});

describe('Valeur de chaque colonne', () => {
  it('traduit le statut plutôt que de sortir le code interne', () => {
    expect(valeurDe(brocante(), 'status')).toBe('Livrée');
  });

  it('totalise les quantités, pertes comprises', () => {
    const m = brocante();
    expect(valeurDe(m, 'materials_requested')).toBe(60);
    expect(valeurDe(m, 'materials_delivered')).toBe(62);
    expect(valeurDe(m, 'materials_recovered')).toBe(60);
    expect(valeurDe(m, 'materials_lost')).toBe(2);
  });

  it('détaille le matériel de façon lisible', () => {
    expect(valeurDe(brocante(), 'materials_detail')).toBe('50 × Chaise\n10 × Table');
  });

  it('rend l’état de chaque approbation, et ce qui reste attendu', () => {
    const m = brocante();
    expect(valeurDe(m, 'approvals')).toBe(
      'Service festif : approuvé\nService informatique : en attente'
    );
    expect(valeurDe(m, 'approvals_pending')).toBe('Service informatique');
  });

  it('ne garde que le jour d’une date horodatée', () => {
    // Une colonne de suivi se filtre par jour ; l'heure ISO la rendrait
    // illisible et incomparable.
    expect(valeurDe({ ...brocante(), date_start: '2026-07-14T00:00:00.000Z' }, 'date_start'))
      .toBe('2026-07-14');
  });

  it('rend une chaîne vide plutôt que « null »', () => {
    // Sans cela, la cellule afficherait littéralement « null ».
    expect(valeurDe({ materials: [], approvals: [] }, 'contact_phone')).toBe('');
    expect(valeurDe({ materials: [], approvals: [] }, 'notes')).toBe('');
  });

  it('supporte une manifestation sans matériel ni approbation', () => {
    const vide = { materials: [], approvals: [] };
    expect(valeurDe(vide, 'materials_requested')).toBe(0);
    expect(valeurDe(vide, 'approvals')).toBe('');
    expect(valeurDe(vide, 'materials_detail')).toBe('');
  });
});

describe('Classeur produit', () => {
  /** Relit le classeur généré, pour vérifier ce qui y est réellement écrit. */
  async function relire(colonnes?: any, filtres?: any) {
    const { contenu, lignes } = await genererClasseur(colonnes, filtres);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(contenu as any);
    return { feuille: classeur.getWorksheet('Manifestations')!, lignes };
  }

  it('écrit une ligne par manifestation, sous les bons intitulés', async () => {
    const { feuille } = await relire([{ champ: 'title' }, { champ: 'status' }]);

    expect(feuille.getRow(1).values).toEqual([undefined, 'Manifestation', 'Statut']);
    expect(feuille.getRow(2).getCell(1).value).toBe('Brocante');
    expect(feuille.getRow(2).getCell(2).value).toBe('Livrée');
  });

  it('exclut les archivées par défaut, et les inclut sur demande', async () => {
    // Une feuille de suivi sert au courant ; l'archive se demande explicitement.
    expect((await relire([{ champ: 'title' }])).lignes).toBe(1);
    expect((await relire([{ champ: 'title' }], { archived: true })).lignes).toBe(2);
  });

  it('filtre par statut et par période', async () => {
    expect((await relire([{ champ: 'title' }], { status: 'archived' })).lignes).toBe(1);
    expect((await relire([{ champ: 'title' }], { date_from: '2026-07-01' })).lignes).toBe(1);
    expect((await relire([{ champ: 'title' }], { date_from: '2027-01-01' })).lignes).toBe(0);
  });

  it('fige la ligne d’entête et pose un filtre', async () => {
    // Un tableau de suivi se lit en faisant défiler : sans le gel, on perd les
    // intitulés dès la vingtième ligne.
    const { feuille } = await relire([{ champ: 'title' }, { champ: 'status' }]);

    expect(feuille.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    // ExcelJS rend le filtre sous sa forme normalisée à la relecture.
    expect(feuille.autoFilter).toBe('A1:B1');
  });

  it('produit un classeur même sans aucune manifestation', async () => {
    const { feuille, lignes } = await relire([{ champ: 'title' }], { date_from: '2099-01-01' });
    expect(lignes).toBe(0);
    expect(feuille.getRow(1).getCell(1).value).toBe('Manifestation');
  });
});

describe('Construction des URL WebDAV', () => {
  it('assemble sans double barre', () => {
    expect(construireUrl('https://cloud.fr/dav/', 'Manifestations', 'suivi.xlsx'))
      .toBe('https://cloud.fr/dav/Manifestations/suivi.xlsx');
    expect(construireUrl('https://cloud.fr/dav', '/Manifestations/', 'suivi.xlsx'))
      .toBe('https://cloud.fr/dav/Manifestations/suivi.xlsx');
  });

  it('encode chaque segment sans casser le chemin', () => {
    // Un dossier « Fêtes 2026 » doit arriver encodé, mais la barre qui sépare
    // les segments ne doit pas l'être — sinon le fichier atterrit à la racine
    // sous un nom absurde.
    expect(construireUrl('https://cloud.fr/dav', 'Fêtes 2026/Suivi', 'a b.xlsx'))
      .toBe('https://cloud.fr/dav/F%C3%AAtes%202026/Suivi/a%20b.xlsx');
  });

  it('ignore les segments vides', () => {
    expect(construireUrl('https://cloud.fr/dav', '', 'suivi.xlsx'))
      .toBe('https://cloud.fr/dav/suivi.xlsx');
  });
});
