import type BetterSqlite3 from 'better-sqlite3';
import type { AuthRequest } from '../src/middleware/auth.middleware';

/**
 * Catalogue : ce qui peut être proposé pour une manifestation, stock et parc réunis.
 *
 * Une collectivité tient ses prestations et son matériel prêtable dans le parc — « Service
 * Technique › Prestations › Raccordement électrique » — pendant que `manifestation_stock` ne
 * porte que les quantités anonymes. Interroger la seule seconde table rendait un catalogue vide
 * alors que tout était saisi.
 *
 * Les deux sources ne comptent pas pareil, et c'est tout l'objet de ces tests : une prestation
 * n'a pas de limite, un exemplaire est pris ou libre, un lot se compte. Sur une vraie base
 * SQLite, parce que ces règles sont écrites en SQL.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCatalogue = sqlite;

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

import { catalogue, type ArticleCatalogue } from '../src/services/catalogue.service';
import { apparierMateriel } from '../src/services/manifestationIntake.service';

const base: BetterSqlite3.Database = (global as any).__baseCatalogue;

/** Un administrateur : aucune restriction de portée, ce qui isole ce que ce module décide. */
const admin = { user: { userId: 1, email: 'admin@test', role: 'admin' } } as unknown as AuthRequest;

const PERIODE = { debut: '2026-06-20', fin: '2026-06-22' };

const lire = async (filtres = {}): Promise<ArticleCatalogue[]> => {
  const articles = await catalogue(admin, PERIODE.debut, PERIODE.fin, filtres);
  expect(articles).not.toBeNull();
  return articles!;
};

const parNom = (articles: ArticleCatalogue[], nom: string) =>
  articles.find((article) => article.name === nom);

beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      is_prestation INTEGER,
      available_for_manifestations INTEGER
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_prestation INTEGER,
      available_for_manifestations INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      category_id INTEGER,
      subcategory_id INTEGER,
      status VARCHAR(50) DEFAULT 'active',
      available_for_manifestations INTEGER,
      is_prestation INTEGER,
      material_type VARCHAR(20) DEFAULT 'unique',
      quantity_total INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT '',
      category_id INTEGER,
      subcategory_id INTEGER,
      quantity_total INTEGER NOT NULL DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'unité',
      is_prestation INTEGER DEFAULT 0
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title VARCHAR(255) NOT NULL,
      date_start DATE NOT NULL,
      date_end DATE,
      delivery_date DATE,
      recovery_date DATE,
      status VARCHAR(20) NOT NULL
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifestation_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity_requested INTEGER DEFAULT 0,
      quantity_delivered INTEGER DEFAULT 0,
      quantity_recovered INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifestation_id INTEGER NOT NULL,
      object_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL,
      reason VARCHAR(255)
    );
    CREATE TABLE manifestation_stock_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      alias VARCHAR(255) NOT NULL
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE service_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL
    );

    -- Le référentiel : le service technique prête, la cuisine non.
    INSERT INTO categories (id, name, is_prestation, available_for_manifestations) VALUES
      (1, 'Service Technique', NULL, 1),
      (2, 'Cuisine',           NULL, 0),
      (3, 'Mobilier',          NULL, 1);
    INSERT INTO subcategories (id, category_id, name, is_prestation, available_for_manifestations) VALUES
      (10, 1, 'Prestations', 1,    NULL),
      (11, 1, 'Levage',      NULL, NULL);

    INSERT INTO services (id, name, slug, is_active) VALUES (1, 'Service Technique', 'technique', 1);
    INSERT INTO service_categories (service_id, category_id) VALUES (1, 1);

    INSERT INTO objects (id, name, category_id, subcategory_id, status, available_for_manifestations, is_prestation, material_type, quantity_total) VALUES
      -- Prestation héritée de la sous-catégorie : ni stock, ni exemplaire.
      (1, 'Raccordement électrique', NULL, 10, 'active', NULL, NULL, 'unique', 0),
      -- Exemplaire unique, retenu ailleurs sur la période.
      (2, 'Nacelle',                 NULL, 11, 'active', NULL, NULL, 'unique', 1),
      -- Exemplaire unique, libre.
      (3, 'Remorque',                NULL, 11, 'active', NULL, NULL, 'unique', 1),
      -- Lot de cinquante chaises, dont dix déjà promises sur la période.
      (4, 'Chaise pliante',          3,    NULL, 'active', NULL, NULL, 'lot',    50),
      -- Prêtable, mais en maintenance : hors catalogue.
      (5, 'Nacelle 18 m',            NULL, 11, 'maintenance', NULL, NULL, 'unique', 1),
      -- Catégorie non prêtable : le grill reste à la cuisine.
      (6, 'Grill',                   2,    NULL, 'active', NULL, NULL, 'unique', 1),
      -- Exception à la main sur un matériel d'une catégorie prêtable.
      (7, 'Camion nacelle',          NULL, 11, 'active', 0,    NULL, 'unique', 1);

    INSERT INTO manifestation_stock (id, name, category, category_id, quantity_total, unit, is_prestation) VALUES
      (1, 'Table brasserie',   'Mobilier', 3, 40, 'unité', 0),
      (2, 'Débit de boissons', '',         1, 0,  'unité', 1);

    -- Une manifestation confirmée qui chevauche la période : elle retient la nacelle,
    -- dix chaises du lot, et douze tables du stock.
    INSERT INTO manifestation_stock_aliases (stock_id, alias) VALUES (1, 'tables');

    INSERT INTO manifestations (id, title, date_start, date_end, status) VALUES
      (1, 'Brocante du centre', '2026-06-21', '2026-06-21', 'validated');
    INSERT INTO manifestation_items (manifestation_id, object_id, quantity) VALUES (1, 2, 1), (1, 4, 10);
    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (1, 1, 12);
  `);
});

describe('catalogue', () => {
  it('propose le parc prêtable et le stock dans une seule liste', async () => {
    const articles = await lire();
    expect(articles.map((article) => article.name)).toEqual([
      'Chaise pliante',
      'Débit de boissons',
      'Nacelle',
      'Raccordement électrique',
      'Remorque',
      'Table brasserie',
    ]);
  });

  it('dit d’où vient chaque ligne, sans collision d’identifiants', async () => {
    const articles = await lire();
    expect(parNom(articles, 'Raccordement électrique')!.ref).toBe('parc:1');
    expect(parNom(articles, 'Table brasserie')!.ref).toBe('stock:1');
    // Les deux tables ont un article d'identifiant 1 : seule la référence les distingue.
    expect(parNom(articles, 'Raccordement électrique')!.id).toBe(parNom(articles, 'Table brasserie')!.id);
  });

  it('ne met aucune limite à une prestation, d’où qu’elle vienne', async () => {
    const articles = await lire();
    const duParc = parNom(articles, 'Raccordement électrique')!;
    const duStock = parNom(articles, 'Débit de boissons')!;

    expect(duParc.is_prestation).toBe(true);
    expect(duParc.quantity_available).toBeNull();
    expect(duParc.quantity_total).toBeNull();
    // Le stock aussi : sans cette exception, son total de zéro la ferait paraître épuisée.
    expect(duStock.is_prestation).toBe(true);
    expect(duStock.quantity_available).toBeNull();
  });

  it('compte un exemplaire comme pris ou libre', async () => {
    const articles = await lire();
    expect(parNom(articles, 'Nacelle')!.quantity_available).toBe(0);
    expect(parNom(articles, 'Remorque')!.quantity_available).toBe(1);
  });

  it('compte un lot en quantité restante sur la période', async () => {
    const articles = await lire();
    const lot = parNom(articles, 'Chaise pliante')!;
    expect(lot.quantity_total).toBe(50);
    expect(lot.quantity_available).toBe(40);
  });

  it('déduit du stock ce qui est déjà engagé', async () => {
    const articles = await lire();
    expect(parNom(articles, 'Table brasserie')!.quantity_available).toBe(28);
  });

  it('écarte ce que le parc ne prête pas, et ce qui n’est pas actif', async () => {
    const noms = (await lire()).map((article) => article.name);
    expect(noms).not.toContain('Grill'); // catégorie exclue
    expect(noms).not.toContain('Camion nacelle'); // exception posée sur le matériel
    expect(noms).not.toContain('Nacelle 18 m'); // en maintenance
  });

  it('restreint au périmètre d’un service, sur les deux sources', async () => {
    const noms = (await lire({ service: 'technique' })).map((article) => article.name);
    // Le service technique a la catégorie 1 : ses matériels du parc et sa prestation du stock.
    expect(noms).toEqual(['Débit de boissons', 'Nacelle', 'Raccordement électrique', 'Remorque']);
  });

  it('ne retient que les prestations quand on les demande seules', async () => {
    const noms = (await lire({ kind: 'prestation' })).map((article) => article.name);
    expect(noms).toEqual(['Débit de boissons', 'Raccordement électrique']);
  });

  it('ne retient que le matériel quand on demande l’inverse', async () => {
    const noms = (await lire({ kind: 'materiel' })).map((article) => article.name);
    expect(noms).toEqual(['Chaise pliante', 'Nacelle', 'Remorque', 'Table brasserie']);
  });

  it('filtre par catégorie, sous-catégorie comprise', async () => {
    const noms = (await lire({ categoryId: 1 })).map((article) => article.name);
    // Rangés sous une sous-catégorie de la catégorie 1, ils doivent rester trouvables par elle.
    expect(noms).toEqual(['Débit de boissons', 'Nacelle', 'Raccordement électrique', 'Remorque']);
  });

  it('ne rend rien pour un service inconnu, plutôt que tout', async () => {
    expect(await lire({ service: 'nexiste-pas' })).toEqual([]);
  });

  /**
   * Dire sur chaque ligne quel service la porte, c'est ce qui permet à l'écran de n'offrir au
   * filtre que les services qui prêtent réellement quelque chose : un service Véhicules qui ne
   * prête aucun véhicule n'a rien à faire dans la liste, alors que le service Technique doit y
   * figurer pour sa seule prestation de raccordement électrique.
   */
  it('rattache chaque ligne au service qui la porte', async () => {
    const articles = await lire();
    const technique = [{ id: 1, name: 'Service Technique', slug: 'technique' }];

    // Rattaché par sa sous-catégorie, et non par une catégorie directe.
    expect(parNom(articles, 'Raccordement électrique')!.services).toEqual(technique);
    expect(parNom(articles, 'Nacelle')!.services).toEqual(technique);
    // Le stock aussi : la règle ne dépend pas de la table d'origine.
    expect(parNom(articles, 'Débit de boissons')!.services).toEqual(technique);
    // Le mobilier n'est le périmètre d'aucun service : personne ne le prête, et on ne l'invente pas.
    expect(parNom(articles, 'Chaise pliante')!.services).toEqual([]);
    expect(parNom(articles, 'Table brasserie')!.services).toEqual([]);
  });

  it('rend la catégorie effective, sous-catégorie comprise', async () => {
    const articles = await lire();
    expect(parNom(articles, 'Raccordement électrique')!.category_id).toBe(1);
    expect(parNom(articles, 'Chaise pliante')!.category_id).toBe(3);
    expect(parNom(articles, 'Débit de boissons')!.category_id).toBe(1);
  });

  it('dit comment chaque ligne se compte', async () => {
    const articles = await lire();
    expect(parNom(articles, 'Raccordement électrique')!.nature).toBe('prestation');
    expect(parNom(articles, 'Nacelle')!.nature).toBe('unique');
    expect(parNom(articles, 'Chaise pliante')!.nature).toBe('lot');
    // Le stock ne connaît que des quantités anonymes : il se compte comme un lot.
    expect(parNom(articles, 'Table brasserie')!.nature).toBe('lot');
  });

  /**
   * Le solde ne suffit pas : « il reste 40 chaises » ne dit pas si les dix autres sont dehors ou
   * seulement promises. Un agent qui prépare une livraison a besoin de la différence.
   */
  it('sépare ce qui est promis de ce qui est déjà dehors', async () => {
    const articles = await lire();
    // La brocante est confirmée, pas livrée : tout est promis, rien n'est sorti.
    expect(parNom(articles, 'Chaise pliante')!).toMatchObject({
      quantity_engaged: 10,
      quantity_out: 0,
    });
    expect(parNom(articles, 'Table brasserie')!).toMatchObject({
      quantity_engaged: 12,
      quantity_out: 0,
    });
    // Une prestation n'engage rien : elle n'a ni stock ni exemplaire à immobiliser.
    expect(parNom(articles, 'Raccordement électrique')!).toMatchObject({
      quantity_engaged: 0,
      quantity_out: 0,
    });
  });
});

/**
 * L'aller et le retour, sur le même jeu de données.
 *
 * Ce que le catalogue propose, la réception doit savoir le relire : un formulaire qui affiche
 * « Raccordement électrique » et une demande qui revient en « ligne à rattacher » forment le
 * pire des deux mondes — le demandeur croit avoir demandé, et personne n'a rien reçu.
 */
describe('appariement à la réception', () => {
  it('retrouve une prestation du parc, avec sa table d’origine', async () => {
    expect(await apparierMateriel('Raccordement électrique')).toMatchObject({
      source: 'parc',
      id: 1,
      is_prestation: true,
    });
  });

  it('retrouve un article du stock', async () => {
    expect(await apparierMateriel('Table brasserie')).toMatchObject({ source: 'stock', id: 1 });
  });

  it('ignore la casse et les accents', async () => {
    expect(await apparierMateriel('RACCORDEMENT ELECTRIQUE')).toMatchObject({ source: 'parc', id: 1 });
  });

  it('passe par les alias du stock avant de regarder le parc', async () => {
    expect(await apparierMateriel('tables')).toMatchObject({ source: 'stock', id: 1 });
  });

  it('n’engage pas ce que le catalogue ne propose pas', async () => {
    // Ni le matériel qu'on ne prête pas, ni celui qui est en maintenance : les accepter à la
    // réception réserverait ce qu'aucun formulaire n'a pu proposer.
    expect(await apparierMateriel('Grill')).toBeNull();
    expect(await apparierMateriel('Nacelle 18 m')).toBeNull();
  });

  it('laisse à rattacher ce qu’il ne reconnaît pas', async () => {
    expect(await apparierMateriel('Château gonflable')).toBeNull();
    expect(await apparierMateriel('   ')).toBeNull();
  });
});
