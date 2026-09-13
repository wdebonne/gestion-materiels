import type BetterSqlite3 from 'better-sqlite3';

/**
 * Clés, badges et trousseaux.
 *
 * Trois règles portent tout le module, et chacune se casse silencieusement :
 *
 *   **le prix d'un lot ne bouge jamais** — refaire des clés plus cher ne doit
 *   pas réévaluer celles d'avant. Une moyenne glissante donnerait un chiffre
 *   plausible, et faux, sans que rien ne le signale ;
 *
 *   **une détention est une ligne ouverte** — le stock disponible se déduit de
 *   ce qui est sorti, et une remise oubliée ou comptée deux fois se voit
 *   seulement à l'inventaire, six mois plus tard ;
 *
 *   **la page publique ne dit rien à un inconnu** — c'est une régression
 *   invisible par construction : la page continuerait de s'afficher.
 *
 * Les tests tournent sur une vraie base SQLite en mémoire : l'arithmétique du
 * stock est précisément ce qu'une base simulée ne vérifierait pas.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCles = sqlite;

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
  compositionDuTrousseau,
  definirOuvrants,
  detenteurActuel,
  historique,
  jetonPour,
  objetDuJeton,
  ouvrantsDeLaCle,
  prochainNumero,
  recalculerDepuisLots,
  stockDeLaCle,
  valeurDuStock,
} from '../src/services/cles.service';

const base: BetterSqlite3.Database = (global as any).__baseCles;

beforeAll(() => {
  base.exec(`
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      reference VARCHAR(100),
      image VARCHAR(500),
      category_id INTEGER,
      subcategory_id INTEGER,
      material_type VARCHAR(20) DEFAULT 'unique',
      quantity_total INTEGER DEFAULT 0,
      unit_cost REAL DEFAULT 0
    );
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name VARCHAR(100), last_name VARCHAR(100), email VARCHAR(255));
    CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255), code VARCHAR(50));
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, name VARCHAR(255), code VARCHAR(50));
    CREATE TABLE cle_ouvre (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL, site_id INTEGER, ouvrant_id INTEGER
    );
    CREATE TABLE cle_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
      unit_price DECIMAL(10,2), acquired_on DATE, supplier VARCHAR(255),
      reference VARCHAR(100), notes TEXT, created_by INTEGER
    );
    CREATE TABLE trousseau_composants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trousseau_id INTEGER NOT NULL, object_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1, notes TEXT, added_at DATETIME
    );
    CREATE TABLE cle_attributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL, quantity INTEGER DEFAULT 1,
      holder_type VARCHAR(20) NOT NULL,
      holder_user_id INTEGER, holder_service_id INTEGER, holder_ouvrant_id INTEGER,
      holder_label VARCHAR(255),
      remise_on DATETIME, remise_by INTEGER,
      restitution_on DATETIME, restitution_by INTEGER,
      etat_retour VARCHAR(50), notes TEXT
    );
    CREATE TABLE cle_jetons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL UNIQUE, token VARCHAR(32) NOT NULL UNIQUE
    );

    INSERT INTO users (id, first_name, last_name) VALUES (1, 'Camille', 'Durand'), (2, 'Alex', 'Leroy');
    INSERT INTO cle_sites (id, name, code) VALUES (1, 'Mairie', 'MAI');
    INSERT INTO cle_ouvrants (id, site_id, name) VALUES (1, 1, 'Porte principale'), (2, 1, 'Salle du conseil');

    -- Une clé tenue en quantité, et le trousseau qui la portera.
    INSERT INTO objects (id, name, reference, material_type) VALUES (10, 'Passe Mairie', 'PASS-MAI', 'lot');
    INSERT INTO objects (id, name, reference, material_type) VALUES (11, 'Badge Mairie', 'BDG-MAI', 'lot');
    INSERT INTO objects (id, name, reference, material_type) VALUES (20, 'Trousseau astreinte', 'TST001', 'unique');
  `);
});

afterEach(() => {
  base.exec('DELETE FROM cle_lots; DELETE FROM cle_attributions; DELETE FROM trousseau_composants; DELETE FROM cle_ouvre;');
});

describe('Stock et valeur : le prix d’un lot est figé', () => {
  it('additionne les lots pour la quantité, et chacun à son prix pour la valeur', async () => {
    base.exec(`
      INSERT INTO cle_lots (object_id, quantity, unit_price, acquired_on) VALUES (10, 10, 2.00, '2026-03-12');
      INSERT INTO cle_lots (object_id, quantity, unit_price, acquired_on) VALUES (10, 10, 2.50, '2026-09-20');
    `);

    expect((await stockDeLaCle(10)).total).toBe(20);

    const { valeur, coutMoyen, quantiteValorisee } = await valeurDuStock(10);
    // 10 × 2,00 + 10 × 2,50 — et surtout pas 20 × 2,50.
    expect(valeur).toBeCloseTo(45);
    expect(quantiteValorisee).toBe(20);
    expect(coutMoyen).toBeCloseTo(2.25);
  });

  it('un lot plus cher ne réévalue pas les précédents', async () => {
    base.exec(`INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 10, 2.00)`);
    const avant = await valeurDuStock(10);

    base.exec(`INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 5, 8.00)`);
    const apres = await valeurDuStock(10);

    // La part ancienne est intacte : la valeur n'a augmenté que du lot ajouté.
    expect(apres.valeur - avant.valeur).toBeCloseTo(40);
  });

  it('compte un lot sans prix dans la quantité, jamais dans la valeur', async () => {
    base.exec(`
      INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 30, NULL);
      INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 10, 3.00);
    `);

    expect((await stockDeLaCle(10)).total).toBe(40);

    const { valeur, quantiteValorisee, coutMoyen } = await valeurDuStock(10);
    expect(valeur).toBeCloseTo(30);
    // Le stock initial ne doit pas tirer le coût moyen vers zéro : il n'entre
    // pas dans le calcul du tout.
    expect(quantiteValorisee).toBe(10);
    expect(coutMoyen).toBeCloseTo(3);
  });

  it('réaligne le parc sur les lots, pour que le reste de l’application suive', async () => {
    base.exec(`INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 12, 2.00)`);
    await recalculerDepuisLots(10);

    const objet: any = base.prepare('SELECT quantity_total, unit_cost FROM objects WHERE id = 10').get();
    expect(objet.quantity_total).toBe(12);
    expect(objet.unit_cost).toBeCloseTo(2);
  });

  it('n’inscrit pas de quantité sur un exemplaire unique', async () => {
    // Cas d'une nature mal saisie : des lots posés sur un matériel resté
    // « unique ». Lui écrire une quantité donnerait un chiffre que rien ne lit
    // — `lotParc.service.ts` ne consulte la colonne que pour un lot — et que sa
    // nature contredit. La valeur, elle, garde son sens.
    base.exec(`INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (20, 7, 3.00)`);
    await recalculerDepuisLots(20);

    const objet: any = base.prepare('SELECT quantity_total, unit_cost FROM objects WHERE id = 20').get();
    expect(objet.quantity_total).toBe(0);
    expect(objet.unit_cost).toBeCloseTo(3);
  });
});

describe('Disponibilité : ce qui est sorti n’est plus au coffre', () => {
  beforeEach(() => {
    base.exec(`INSERT INTO cle_lots (object_id, quantity, unit_price) VALUES (10, 10, 2.00)`);
  });

  it('retire les exemplaires engagés en trousseau et prêtés seuls', async () => {
    base.exec(`
      INSERT INTO trousseau_composants (trousseau_id, object_id, quantity) VALUES (20, 10, 4);
      INSERT INTO cle_attributions (object_id, quantity, holder_type, holder_user_id, remise_on)
        VALUES (10, 1, 'user', 1, '2026-09-01');
    `);

    const stock = await stockDeLaCle(10);
    expect(stock).toMatchObject({
      total: 10,
      enTrousseaux: 4,
      attribueesSeules: 1,
      disponibles: 5,
    });
  });

  it('ne compte plus une remise une fois restituée', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, quantity, holder_type, holder_user_id, remise_on, restitution_on)
        VALUES (10, 3, 'user', 1, '2026-09-01', '2026-09-10');
    `);

    expect((await stockDeLaCle(10)).disponibles).toBe(10);
  });

  it('ne descend jamais sous zéro, même sur une saisie incohérente', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, quantity, holder_type, holder_label, remise_on)
        VALUES (10, 99, 'externe', 'Entreprise Dupont', '2026-09-01');
    `);

    // Un négatif se lirait comme une dette, là où le bon message est
    // « il n'en reste plus ».
    expect((await stockDeLaCle(10)).disponibles).toBe(0);
  });
});

describe('Détention : une seule ligne ouverte, et toute l’histoire', () => {
  it('rend la remise en cours, pas les remises closes', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, holder_type, holder_user_id, remise_on, restitution_on)
        VALUES (20, 'user', 1, '2026-01-05', '2026-03-01');
      INSERT INTO cle_attributions (object_id, holder_type, holder_user_id, remise_on)
        VALUES (20, 'user', 2, '2026-03-02');
    `);

    const detenteur = await detenteurActuel(20);
    expect(detenteur?.holder_first_name).toBe('Alex');
  });

  it('rend « personne » quand tout est restitué', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, holder_type, holder_user_id, remise_on, restitution_on)
        VALUES (20, 'user', 1, '2026-01-05', '2026-03-01');
    `);

    expect(await detenteurActuel(20)).toBeNull();
  });

  it('garde le passage complet, du plus récent au plus ancien', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, holder_type, holder_user_id, remise_on, restitution_on)
        VALUES (20, 'user', 1, '2026-01-05', '2026-03-01');
      INSERT INTO cle_attributions (object_id, holder_type, holder_user_id, remise_on)
        VALUES (20, 'user', 2, '2026-03-02');
    `);

    const passages = await historique(20);
    expect(passages).toHaveLength(2);
    expect(passages[0].holder_first_name).toBe('Alex');
    expect(passages[1].holder_first_name).toBe('Camille');
    expect(passages[1].restitution_on).toBeTruthy();
  });

  it('nomme un détenteur externe, qui n’a pas de compte', async () => {
    base.exec(`
      INSERT INTO cle_attributions (object_id, holder_type, holder_label, remise_on)
        VALUES (20, 'externe', 'Entreprise Dupont', '2026-09-01');
    `);

    const detenteur = await detenteurActuel(20);
    expect(detenteur?.holder_label).toBe('Entreprise Dupont');
    expect(detenteur?.holder_user_id).toBeNull();
  });
});

describe('Ce qu’une clé ouvre', () => {
  it('distingue un passe de site d’une porte précise', async () => {
    await definirOuvrants(10, [{ siteId: 1 }]);
    await definirOuvrants(11, [{ ouvrantId: 2 }]);

    const passe = await ouvrantsDeLaCle(10);
    expect(passe).toHaveLength(1);
    expect(passe[0].est_passe).toBe(1);
    expect(passe[0].site_name).toBe('Mairie');

    const porte = await ouvrantsDeLaCle(11);
    expect(porte[0].est_passe).toBe(0);
    expect(porte[0].ouvrant_name).toBe('Salle du conseil');
  });

  it('remplace la liste au lieu de la compléter', async () => {
    await definirOuvrants(10, [{ ouvrantId: 1 }, { ouvrantId: 2 }]);
    await definirOuvrants(10, [{ ouvrantId: 1 }]);

    // Décocher une porte doit la retirer : une fusion l'aurait conservée, et
    // l'utilisateur croirait avoir supprimé un accès qu'il garde.
    expect(await ouvrantsDeLaCle(10)).toHaveLength(1);
  });

  it('ignore une entrée qui ne désigne ni site ni porte, ou les deux', async () => {
    await definirOuvrants(10, [
      { siteId: 1, ouvrantId: 1 },
      {},
      { ouvrantId: 2 },
    ]);

    const ouvre = await ouvrantsDeLaCle(10);
    expect(ouvre).toHaveLength(1);
    expect(ouvre[0].ouvrant_id).toBe(2);
  });
});

describe('Composition d’un trousseau', () => {
  it('rend chaque clé avec ce qu’elle ouvre', async () => {
    await definirOuvrants(10, [{ siteId: 1 }]);
    base.exec(`
      INSERT INTO trousseau_composants (trousseau_id, object_id, quantity) VALUES (20, 10, 1);
      INSERT INTO trousseau_composants (trousseau_id, object_id, quantity) VALUES (20, 11, 1);
    `);

    const composition = await compositionDuTrousseau(20);
    expect(composition).toHaveLength(2);

    const passe = composition.find((c: any) => c.object_id === 10);
    expect(passe.ouvre).toHaveLength(1);
    expect(passe.ouvre[0].site_name).toBe('Mairie');

    // Une clé sans ouvrant déclaré doit rendre une liste vide, pas planter.
    const badge = composition.find((c: any) => c.object_id === 11);
    expect(badge.ouvre).toEqual([]);
  });
});

describe('Numérotation', () => {
  it('propose le numéro suivant du préfixe, en gardant la largeur', async () => {
    expect(await prochainNumero('TST')).toBe('TST002');
  });

  it('démarre à 001 sur un préfixe encore inutilisé', async () => {
    expect(await prochainNumero('TPM')).toBe('TPM001');
  });

  it('ne confond pas deux préfixes qui commencent pareil', async () => {
    // « TST001 » ne doit pas faire dériver la série « TS ».
    expect(await prochainNumero('TS')).toBe('TS001');
  });
});

describe('Jeton public', () => {
  it('est stable une fois posé', async () => {
    const premier = await jetonPour(20);
    expect(await jetonPour(20)).toBe(premier);
  });

  it('est court et sans caractère ambigu', async () => {
    const jeton = await jetonPour(20);
    expect(jeton).toHaveLength(8);
    // Ni O/0, ni I/1, ni L : le jeton finit recopié à la main d'une étiquette
    // rayée, et un « 0 » lu « O » ne mène nulle part.
    expect(jeton).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('n’est pas devinable depuis l’identifiant du matériel', async () => {
    const jeton = await jetonPour(20);
    expect(jeton).not.toContain('20');
  });

  it('retrouve le matériel, et rien pour un jeton inconnu', async () => {
    const jeton = await jetonPour(20);

    expect((await objetDuJeton(jeton))?.id).toBe(20);
    expect(await objetDuJeton('INCONNU9')).toBeNull();
    expect(await objetDuJeton('')).toBeNull();
  });
});
