import fs from 'fs';
import os from 'os';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Pièces jointes d'une manifestation.
 *
 * Ce sont ces pièces qui font la différence en cas de litige, des mois plus
 * tard — la photo de la chaise revenue cassée, l'arrêté de circulation, le
 * constat du trottoir abîmé.
 *
 * Deux propriétés méritent d'être protégées, et ce sont celles qui se cassent
 * en silence :
 *
 * - **le lien vers le matériel survit à une modification** de la manifestation.
 *   `manifestation_materials` est supprimée puis réinsérée à chaque changement
 *   de quantité : un lien par identifiant de ligne serait rompu au premier
 *   passage, sans erreur ;
 * - **supprimer un document retire le fichier**. Partout ailleurs dans
 *   l'application il reste orphelin pour toujours.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseDocs = sqlite;

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
  detacher,
  documentsDe,
  joindre,
  supprimerFichier,
  typeValide,
  typesDocuments,
} from '../src/services/manifestationDocuments.service';

const base: BetterSqlite3.Database = (global as any).__baseDocs;

/** Fichier réel dans `uploads/`, pour vérifier qu'il disparaît vraiment. */
function creerFichier(nom: string): string {
  const dossier = path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nom), 'contenu');
  return `/uploads/${nom}`;
}

const existe = (nom: string) => fs.existsSync(path.resolve(process.cwd(), 'uploads', nom));

beforeAll(() => {
  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, first_name VARCHAR(255), last_name VARCHAR(255));
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255));
    CREATE TABLE manifestation_stock (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, stock_id INTEGER,
      quantity_requested INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_doc_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT, value VARCHAR(100) UNIQUE, label VARCHAR(255),
      is_default INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, created_at DATETIME
    );
    CREATE TABLE manifestation_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, name VARCHAR(255),
      doc_type VARCHAR(100) DEFAULT 'autre', description TEXT, file_path VARCHAR(500),
      mime_type VARCHAR(100), size INTEGER, stock_id INTEGER, object_id INTEGER,
      uploaded_by INTEGER, created_at DATETIME
    );
  `);

  base.exec(`
    INSERT INTO users (id, first_name, last_name) VALUES (1, 'Martin', 'Dubois');
    INSERT INTO objects (id, name) VALUES (1, 'Camion benne');
    INSERT INTO manifestations (id, title) VALUES (100, 'Brocante');
    INSERT INTO manifestation_stock (id, name) VALUES (1, 'Chaise'), (2, 'Table');
    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (100, 1, 12);
    INSERT INTO manifestation_doc_types (value, label, is_default) VALUES
      ('arrete_circulation', 'Arrêté de circulation', 1),
      ('constat_materiel', 'Constat matériel', 1),
      ('photo', 'Photo', 1),
      ('autre', 'Autre', 1),
      ('ancien_type', 'Type retiré du service', 0);
    UPDATE manifestation_doc_types SET disabled = 1 WHERE value = 'ancien_type';
  `);
});

beforeEach(() => base.exec('DELETE FROM manifestation_documents'));

describe('Types de documents', () => {
  it('ne propose pas un type désactivé', async () => {
    const proposes = (await typesDocuments()).map((t: any) => t.value);
    expect(proposes).not.toContain('ancien_type');
    expect(proposes).toContain('arrete_circulation');
  });

  it('rend tout, désactivés compris, pour l’écran de gestion', async () => {
    expect((await typesDocuments(true)).map((t: any) => t.value)).toContain('ancien_type');
  });

  it('trie en français, sans rejeter les accents en fin de liste', async () => {
    // `ORDER BY label` trie par octets en SQLite : « Arrêté » passerait après
    // « Photo », parce que le é encodé commence par 0xC3.
    const libelles = (await typesDocuments()).map((t: any) => t.label);
    expect(libelles[0]).toBe('Arrêté de circulation');
  });

  it('retombe sur « autre » pour un type inconnu ou désactivé', async () => {
    // Un type retiré du service ne doit pas rendre le document invisible dans
    // les filtres, en portant une valeur que plus rien ne nomme.
    expect(await typeValide('arrete_circulation')).toBe('arrete_circulation');
    expect(await typeValide('ancien_type')).toBe('autre');
    expect(await typeValide('inexistant')).toBe('autre');
    expect(await typeValide(null)).toBe('autre');
  });
});

describe('Joindre une pièce', () => {
  it('enregistre le libellé, le type et la description', async () => {
    await joindre(
      100,
      {
        name: 'Arrêté buvette 2026',
        doc_type: 'arrete_circulation',
        description: 'Autorisation de débit de boissons place du marché',
        file_path: '/uploads/abc.pdf',
        mime_type: 'application/pdf',
        size: 1024,
      },
      1
    );

    const [document] = await documentsDe(100);
    expect(document).toMatchObject({
      name: 'Arrêté buvette 2026',
      doc_type: 'arrete_circulation',
      doc_type_label: 'Arrêté de circulation',
      uploaded_by_name: 'Martin Dubois',
      size: 1024,
    });
  });

  it('nomme le matériel que la pièce désigne', async () => {
    await joindre(100, { name: 'Chaise cassée', file_path: '/uploads/p.jpg', stock_id: 1 }, 1);
    await joindre(100, { name: 'Camion rayé', file_path: '/uploads/c.jpg', object_id: 1 }, 1);

    const documents = await documentsDe(100);
    expect(documents.map((d: any) => d.stock_name ?? d.object_name).sort()).toEqual([
      'Camion benne',
      'Chaise',
    ]);
  });

  it('accepte une pièce sans description ni lien', async () => {
    await joindre(100, { name: 'Plan', file_path: '/uploads/plan.pdf' }, 1);

    const [document] = await documentsDe(100);
    expect(document.description).toBeNull();
    expect(document.stock_id).toBeNull();
    expect(document.doc_type).toBe('autre');
  });
});

describe('Le lien survit à une modification de la manifestation', () => {
  it('reste attaché après suppression et réinsertion des lignes', async () => {
    // `PUT /:id` supprime puis réinsère toutes les lignes de matériel : un lien
    // par identifiant de ligne serait rompu ici, sans erreur. Le lien porte sur
    // l'article, qui ne bouge pas.
    await joindre(100, { name: 'Chaise cassée', file_path: '/uploads/p.jpg', stock_id: 1 }, 1);

    base.exec('DELETE FROM manifestation_materials WHERE manifestation_id = 100');
    base.exec(
      'INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (100, 1, 8)'
    );

    const [document] = await documentsDe(100);
    expect(document.stock_id).toBe(1);
    expect(document.stock_name).toBe('Chaise');
  });
});

describe('Recherche dans une manifestation', () => {
  beforeEach(async () => {
    await joindre(100, {
      name: 'Arrêté buvette',
      description: 'Débit de boissons place du marché',
      file_path: '/uploads/a.pdf',
    }, 1);
    await joindre(100, { name: 'Plan implantation', file_path: '/uploads/b.pdf' }, 1);
  });

  it('trouve par le libellé', async () => {
    expect((await documentsDe(100, 'plan')).map((d: any) => d.name)).toEqual(['Plan implantation']);
  });

  it('trouve par la description', async () => {
    // C'est ce qu'on retient d'une pièce des mois après, rarement son nom de
    // fichier.
    expect((await documentsDe(100, 'boissons')).map((d: any) => d.name)).toEqual(['Arrêté buvette']);
  });

  it('rend tout sans filtre', async () => {
    expect(await documentsDe(100)).toHaveLength(2);
  });

  it('ne rend rien pour un mot absent', async () => {
    expect(await documentsDe(100, 'zzz')).toEqual([]);
  });
});

describe('Suppression', () => {
  it('retire la ligne et le fichier', async () => {
    // Partout ailleurs dans l'application, le fichier reste orphelin pour
    // toujours. Un dossier de manifestation contient des photos de sinistre.
    const chemin = creerFichier('essai-doc-a-supprimer.txt');
    const id = await joindre(100, { name: 'À retirer', file_path: chemin }, 1);

    expect(await detacher(id)).toBe(true);
    expect(await documentsDe(100)).toEqual([]);
    expect(existe('essai-doc-a-supprimer.txt')).toBe(false);
  });

  it('rend false pour un document inexistant', async () => {
    expect(await detacher(99999)).toBe(false);
  });

  it('n’échoue pas si le fichier a déjà disparu', async () => {
    const id = await joindre(100, { name: 'Fantôme', file_path: '/uploads/jamais-ecrit.pdf' }, 1);
    expect(await detacher(id)).toBe(true);
  });
});

describe('Le chemin du fichier ne peut pas sortir du dossier des téléversements', () => {
  it('refuse une remontée de dossier', async () => {
    // Un `file_path` fabriqué ne doit pas pouvoir faire supprimer un fichier de
    // l'application.
    const temoin = path.join(os.tmpdir(), `temoin-${Date.now()}.txt`);
    fs.writeFileSync(temoin, 'ne pas supprimer');

    expect(supprimerFichier('/uploads/../../../../../../../../' + temoin)).toBe(false);
    expect(fs.existsSync(temoin)).toBe(true);

    fs.unlinkSync(temoin);
  });

  it('refuse un chemin vide', () => {
    expect(supprimerFichier(null)).toBe(false);
    expect(supprimerFichier('')).toBe(false);
  });
});
