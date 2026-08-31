import type BetterSqlite3 from 'better-sqlite3';

/**
 * Ce qu'un document de service dit — et surtout ce qu'il tait.
 *
 * C'est la promesse de ce lot : **chaque service ne reçoit que sa part**. Le
 * service qui instruit un débit de boissons n'a que faire du raccordement
 * électrique, du personnel demandé, ou du nombre de chaises. Lui envoyer tout
 * l'oblige à trier, et c'est ainsi qu'on finit par ne plus rien lire.
 *
 * Le service **coordinateur** fait exception : c'est lui qui pilote la
 * manifestation et rend l'approbation finale, il lui faut l'ensemble.
 *
 * Deux pièges tenaces sont couverts ici :
 *
 * - un article classé **par sa seule sous-catégorie** ne doit pas échapper au
 *   rattachement — c'est la fuite déjà corrigée sur la portée des matériels ;
 * - un champ sans correspondance doit ressortir **vide**, jamais en accolades :
 *   un arrêté municipal portant « {montant} » en toutes lettres serait signé
 *   tel quel par quelqu'un qui ne l'a pas relu.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseModele = sqlite;

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
  appliquerCorrespondance,
  donneesExemple,
  donneesPourModele,
  VALEURS_MODELE,
} from '../src/services/donneesModele.service';

const base: BetterSqlite3.Database = (global as any).__baseModele;

/** Identifiants de service, pour que les essais se lisent. */
const URBANISME = 1;
const TECHNIQUE = 2;
const COORDINATEUR = 3;
/** Un service dont aucune catégorie ne figure dans la demande. */
const RESTAURATION = 4;

beforeAll(() => {
  base.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, first_name VARCHAR(255), last_name VARCHAR(255));
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name VARCHAR(255), is_prestation INTEGER DEFAULT 0
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY, name VARCHAR(255), category_id INTEGER, is_prestation INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255),
      category_id INTEGER, subcategory_id INTEGER, is_prestation INTEGER
    );
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, object_id INTEGER,
      quantity INTEGER DEFAULT 1, quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0, notes TEXT
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY, name VARCHAR(255), is_coordinator INTEGER DEFAULT 0
    );
    CREATE TABLE service_categories (service_id INTEGER, category_id INTEGER);
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY, title VARCHAR(255), date_start DATE, date_end DATE,
      start_time VARCHAR(10), end_time VARCHAR(10), delivery_date DATE, recovery_date DATE,
      delivery_address VARCHAR(500), contact_name VARCHAR(255), contact_phone VARCHAR(50),
      contact_email VARCHAR(255), expected_people INTEGER, notes_interior TEXT,
      notes_exterior TEXT, status VARCHAR(50), created_by INTEGER
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY, name VARCHAR(255), unit VARCHAR(50),
      category_id INTEGER, subcategory_id INTEGER, is_prestation INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, stock_id INTEGER,
      quantity_requested INTEGER DEFAULT 0, quantity_delivered INTEGER DEFAULT 0,
      quantity_recovered INTEGER DEFAULT 0, notes TEXT
    );
  `);

  base.exec(`
    INSERT INTO users (id, first_name, last_name) VALUES (1, 'Martin', 'Dubois');

    INSERT INTO categories (id, name) VALUES
      (10, 'Urbanisme'), (20, 'Technique'), (30, 'Mobilier'), (40, 'Restauration');
    -- Une sous-catégorie sans catégorie propre sur l'article : le piège.
    INSERT INTO subcategories (id, name, category_id) VALUES (21, 'Réseaux', 20);

    INSERT INTO services (id, name, is_coordinator) VALUES
      (${URBANISME}, 'Service urbanisme', 0),
      (${TECHNIQUE}, 'Service technique', 0),
      (${COORDINATEUR}, 'Culture et Communication', 1),
      (${RESTAURATION}, 'Service restauration', 0);

    INSERT INTO service_categories (service_id, category_id) VALUES
      (${URBANISME}, 10), (${TECHNIQUE}, 20), (${COORDINATEUR}, 30), (${RESTAURATION}, 40);

    INSERT INTO manifestation_stock (id, name, unit, category_id, subcategory_id, is_prestation) VALUES
      (1, 'Débit de boissons', NULL, 10, NULL, 1),
      -- Classé par sa seule sous-catégorie : « Réseaux » relève de « Technique ».
      (2, 'Raccordement électrique', NULL, NULL, 21, 1),
      (3, 'Table brasserie', 'unité', 30, NULL, 0),
      (4, 'Chaise pliante', 'unité', 30, NULL, 0);

    INSERT INTO manifestations
      (id, title, date_start, date_end, start_time, end_time, delivery_date, recovery_date,
       delivery_address, contact_name, contact_phone, contact_email, expected_people,
       notes_interior, notes_exterior, status, created_by)
    VALUES
      (100, 'Fête de la musique', '2026-06-21', '2026-06-21', '18:00', '23:59',
       '2026-06-20', '2026-06-22', 'Place du marché', 'Martin Dubois', '0102030405',
       'martin@ville.fr', 800, 'Prévoir une rallonge', 'Accès pompiers', 'pending', 1);

    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested, quantity_delivered) VALUES
      (100, 1, 1, 0), (100, 2, 1, 0), (100, 3, 10, 8), (100, 4, 50, 48);

    -- Le parc, où un service range ses prestations à côté de son matériel :
    -- « Urbanisme > Prestation » porte l'arrêté, « Mobilier » porte l'armoire.
    INSERT INTO subcategories (id, name, category_id, is_prestation) VALUES
      (11, 'Prestation', 10, 1);
    INSERT INTO objects (id, name, category_id, subcategory_id) VALUES
      (1, 'Arrêté de circulation', 10, 11),
      (2, 'Armoire forte', 10, NULL);
    INSERT INTO manifestation_items (manifestation_id, object_id, quantity) VALUES
      (100, 1, 2), (100, 2, 1);
  `);
});

describe('Chaque service ne reçoit que sa part', () => {
  it("ne montre au service d'urbanisme que ses prestations", async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);

    // Les deux catalogues se rejoignent : le débit de boissons vient du stock
    // des manifestations, l'arrêté de circulation du parc du service.
    expect(donnees.prestations.map((p: any) => p.nom)).toEqual([
      'Débit de boissons',
      'Arrêté de circulation',
    ]);
    // Ni le raccordement électrique, ni les tables, ni les chaises.
    expect(donnees.materiels).toEqual([]);
    expect(donnees.materiel_resume).toBe('');
  });

  it('rattache un article classé par sa seule sous-catégorie', async () => {
    // Le raccordement n'a pas de `category_id` : il relève de « Technique » par
    // sa sous-catégorie « Réseaux ». C'est la fuite déjà corrigée ailleurs.
    const donnees: any = await donneesPourModele(100, TECHNIQUE);
    expect(donnees.prestations.map((p: any) => p.nom)).toEqual(['Raccordement électrique']);
  });

  it('donne tout au service coordinateur', async () => {
    const donnees: any = await donneesPourModele(100, COORDINATEUR);

    expect(donnees.materiels.map((m: any) => m.nom)).toEqual(['Chaise pliante', 'Table brasserie']);
    expect(donnees.prestations.map((p: any) => p.nom)).toEqual([
      'Débit de boissons',
      'Raccordement électrique',
      'Arrêté de circulation',
    ]);
  });

  it('ne donne rien à un service qu’aucune demande ne concerne', async () => {
    const donnees: any = await donneesPourModele(100, RESTAURATION);
    expect(donnees.materiels).toEqual([]);
    expect(donnees.prestations).toEqual([]);
  });

  it('sépare le matériel des prestations', async () => {
    const donnees: any = await donneesPourModele(100, COORDINATEUR);
    expect(donnees.materiels.every((m: any) => m.unite === 'unité')).toBe(true);
    expect(donnees.materiel_resume).toBe('50 × Chaise pliante, 10 × Table brasserie');
  });
});

describe('Le reste de la demande', () => {
  it('met les dates au format français', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    expect(donnees.date_debut).toBe('21/06/2026');
    expect(donnees.date_livraison).toBe('20/06/2026');
  });

  it('nomme le service destinataire et traduit le statut', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    expect(donnees.service).toBe('Service urbanisme');
    expect(donnees.statut).toBe('À confirmer');
  });

  it('reprend le contact, le lieu et les notes', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    expect(donnees.lieu).toBe('Place du marché');
    expect(donnees.contact_nom).toBe('Martin Dubois');
    expect(donnees.notes).toBe('Prévoir une rallonge\nAccès pompiers');
  });

  it('refuse une manifestation qui n’existe pas', async () => {
    await expect(donneesPourModele(999, URBANISME)).rejects.toThrow('Manifestation non trouvée');
  });
});

describe('Correspondance des champs', () => {
  const donnees = { manifestation: 'Brocante', lieu: 'Place du marché', date_debut: '01/09/2026' };

  it('suit la correspondance réglée', () => {
    expect(
      appliquerCorrespondance(donnees, ['NOM_FETE'], { NOM_FETE: 'manifestation' })
    ).toEqual({ NOM_FETE: 'Brocante' });
  });

  it('remplit un champ qui porte déjà le nom d’une valeur connue', () => {
    // Un modèle écrit avec les noms proposés fonctionne sans aucun réglage.
    expect(appliquerCorrespondance(donnees, ['lieu'], null)).toEqual({ lieu: 'Place du marché' });
  });

  it('rend une valeur vide plutôt qu’une accolade imprimée', () => {
    expect(appliquerCorrespondance(donnees, ['montant'], {})).toEqual({ montant: '' });
  });

  it('rend vide un champ dont la correspondance pointe une valeur inconnue', () => {
    expect(appliquerCorrespondance(donnees, ['prix'], { prix: 'tarif_horaire' })).toEqual({
      prix: '',
    });
  });

  it('ne rend que les champs du modèle, jamais les autres valeurs', () => {
    // Un modèle ne doit pas emporter des données qu'il n'affiche pas.
    expect(Object.keys(appliquerCorrespondance(donnees, ['lieu'], null))).toEqual(['lieu']);
  });
});

describe('Jeu d’exemple', () => {
  it('propose une valeur pour chaque entrée du catalogue', () => {
    const exemple = donneesExemple({ name: 'Service urbanisme' });
    for (const valeur of VALEURS_MODELE) {
      expect(exemple[valeur.cle]).toBeDefined();
    }
  });

  it('donne de vraies listes, pour que les répétitions se voient', () => {
    const exemple: any = donneesExemple(null);
    expect(Array.isArray(exemple.materiels)).toBe(true);
    expect(exemple.materiels.length).toBeGreaterThan(1);
    expect(Array.isArray(exemple.prestations)).toBe(true);
  });

  it('nomme le service auquel l’aperçu est destiné', () => {
    expect(donneesExemple({ name: 'Service technique' }).service).toBe('Service technique');
  });
});

/**
 * Prestations tenues dans le parc.
 *
 * Un service peut ranger ses prestations sous sa propre catégorie, à côté de son
 * matériel : Urbanisme porte une sous-catégorie Prestation et une armoire forte.
 * Le document qu'on lui envoie doit alors mentionner ces prestations — lui
 * demander d'approuver un arrêté de circulation que la pièce jointe passe sous
 * silence serait pire que de ne rien envoyer.
 *
 * Le matériel du parc, lui, n'y entre pas : une armoire forte n'est pas un acte
 * qu'on demande à un service d'autoriser, et le document est fait pour ça.
 */
describe('Prestations venues du parc', () => {
  it('fait figurer la prestation du parc dans le document du service', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    expect(donnees.prestations.map((p: any) => p.nom)).toContain('Arrêté de circulation');
  });

  it('reprend la quantité demandée', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    const arrete = donnees.prestations.find((p: any) => p.nom === 'Arrêté de circulation');
    expect(arrete.quantite).toBe(2);
  });

  it('n’y fait pas entrer le matériel du parc', async () => {
    // L'armoire forte est bien dans la catégorie Urbanisme, mais ce n'est pas
    // une prestation : elle relève du suivi de matériel unique.
    const donnees: any = await donneesPourModele(100, URBANISME);
    const noms = [...donnees.prestations, ...donnees.materiels].map((l: any) => l.nom);
    expect(noms).not.toContain('Armoire forte');
  });

  it('ne montre pas la prestation d’un service à un autre', async () => {
    const donnees: any = await donneesPourModele(100, TECHNIQUE);
    expect(donnees.prestations.map((p: any) => p.nom)).not.toContain('Arrêté de circulation');
  });

  it('la donne au coordinateur, qui reçoit tout le dossier', async () => {
    const donnees: any = await donneesPourModele(100, COORDINATEUR);
    expect(donnees.prestations.map((p: any) => p.nom)).toContain('Arrêté de circulation');
  });

  it('la fait entrer dans le résumé en une ligne', async () => {
    const donnees: any = await donneesPourModele(100, URBANISME);
    expect(donnees.prestations_resume).toBe('Débit de boissons, Arrêté de circulation');
  });
});
