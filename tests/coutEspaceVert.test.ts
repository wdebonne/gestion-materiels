import type BetterSqlite3 from 'better-sqlite3';

/**
 * Ce que le fleurissement a coûté, et ce qui ne doit jamais le faire bouger.
 *
 * Le piège que ces essais gardent : **le prix du parc monte, le passé ne bouge
 * pas**. Dix rosiers plantés à 2,50 € ont coûté 25 €, et le jour où le rosier
 * passe à 4 € au catalogue, ils coûtent toujours 25 €. Réévaluer les massifs
 * déjà plantés parce qu'un tarif a été mis à jour rendrait tout bilan faux, et
 * c'est précisément ce que le prix figé à la pose empêche.
 *
 * Le second piège : **une ligne sans prix ne vaut pas zéro**. La compter comme
 * gratuite donnerait un total qui se lit comme complet alors qu'il ne l'est pas.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCoutEspaceVert = sqlite;

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
  coutEspace,
  syntheseCouts,
  implantationsParObjet,
  prixUnitaireDuParc,
} from '../src/services/coutEspaceVert.service';

const base: BetterSqlite3.Database = (global as any).__baseCoutEspaceVert;

/** Identifiants, pour que les essais se lisent. */
const MAIRIE = 1; // parc
const ROND_POINT = 2; // rond-point
const ROSIER = 10; // lot, 2,50 € l'unité au parc
const BANC = 11; // exemplaire, 320 €
const TULIPE = 12; // lot sans prix au parc
const JARDINIERE = 100; // groupe de composition

beforeAll(() => {
  base.exec(`
    CREATE TABLE green_spaces (
      id INTEGER PRIMARY KEY, name VARCHAR(255), space_type VARCHAR(100), status VARCHAR(50)
    );
    CREATE TABLE green_space_groups (
      id INTEGER PRIMARY KEY, green_space_id INTEGER, name VARCHAR(255)
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), material_type VARCHAR(20),
      unit_cost REAL DEFAULT 0, purchase_price REAL
    );
    CREATE TABLE green_space_elements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, green_space_id INTEGER, object_id INTEGER,
      label VARCHAR(255), element_type VARCHAR(100), group_id INTEGER,
      quantity INTEGER DEFAULT 1, purchase_price DECIMAL(10,2),
      cost_source VARCHAR(20) DEFAULT 'saisi', planting_date DATE,
      created_at DATETIME DEFAULT '2026-01-15 09:00:00'
    );
  `);

  base.exec(`
    INSERT INTO green_spaces (id, name, space_type, status) VALUES
      (${MAIRIE}, 'Parc de la Mairie', 'parc', 'actif'),
      (${ROND_POINT}, 'Rond-point des Tilleuls', 'rond_point', 'actif');

    INSERT INTO green_space_groups (id, green_space_id, name) VALUES
      (${JARDINIERE}, ${MAIRIE}, 'Jardinière du perron');

    INSERT INTO objects (id, name, material_type, unit_cost, purchase_price) VALUES
      (${ROSIER}, 'Rosier Pierre de Ronsard', 'lot', 2.5, 250),
      (${BANC}, 'Banc fonte et bois', 'unique', 0, 320),
      (${TULIPE}, 'Tulipe Darwin', 'lot', 0, 0);
  `);

  const poser = base.prepare(`
    INSERT INTO green_space_elements
      (green_space_id, object_id, label, element_type, group_id, quantity, purchase_price, cost_source, planting_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // La jardinière du perron mêle deux variétés à deux prix : c'est le cas qui
  // justifie le groupe, et celui qu'aucun total par espace ne sait rendre.
  poser.run(MAIRIE, ROSIER, 'Rosiers du perron', 'fleur', JARDINIERE, 10, 2.5, 'parc', '2025-04-10');
  poser.run(MAIRIE, TULIPE, 'Tulipes du perron', 'fleur', JARDINIERE, 40, 0.6, 'saisi', '2025-10-02');

  // Hors groupe, la même variété reposée l'année suivante — plus chère.
  poser.run(MAIRIE, ROSIER, 'Rosiers de l’allée', 'fleur', null, 6, 4, 'parc', '2026-03-20');

  // Du mobilier, à l'exemplaire.
  poser.run(MAIRIE, BANC, 'Banc n°3', 'banc', null, 1, 320, 'parc', '2026-03-20');

  // Une ligne sans prix : elle existe, elle ne coûte rien de connu.
  poser.run(MAIRIE, null, 'Chêne centenaire', 'arbre', null, 1, null, 'saisi', null);

  // Un autre espace, pour que la synthèse ait de quoi distinguer.
  poser.run(ROND_POINT, ROSIER, 'Rosiers du rond-point', 'fleur', null, 20, 2.5, 'parc', '2025-04-10');
});

describe('coût d’un espace vert', () => {
  it('multiplie la quantité posée par le prix figé', async () => {
    const cout = await coutEspace(MAIRIE);

    // 10 × 2,50 + 40 × 0,60 + 6 × 4 + 320 = 25 + 24 + 24 + 320
    expect(cout.total).toBe(393);
    expect(cout.quantite).toBe(58);
    expect(cout.lignes).toBe(5);
  });

  it('compte à part ce qui n’a pas de prix, sans le chiffrer à zéro', async () => {
    const cout = await coutEspace(MAIRIE);
    expect(cout.sans_prix).toBe(1);

    const arbres = cout.par_type.find((l) => l.cle === 'arbre');
    expect(arbres).toMatchObject({ lignes: 1, cout: 0, sans_prix: 1 });
  });

  it('chiffre une jardinière qui mêle plusieurs variétés', async () => {
    const cout = await coutEspace(MAIRIE);

    const jardiniere = cout.par_groupe.find((l) => l.cle === JARDINIERE);
    expect(jardiniere).toMatchObject({ libelle: 'Jardinière du perron', cout: 49, quantite: 50 });

    // Ce qui n'est dans aucun groupe reste visible : sans quoi le détail ne
    // totaliserait plus l'espace, et l'écart serait inexplicable.
    const horsGroupe = cout.par_groupe.find((l) => l.cle === null);
    expect(horsGroupe?.libelle).toBe('Hors groupe');
    expect((jardiniere?.cout ?? 0) + (horsGroupe?.cout ?? 0)).toBe(cout.total);
  });

  it('additionne deux poses d’une même variété sans les réévaluer', async () => {
    const cout = await coutEspace(MAIRIE);

    // 10 rosiers à 2,50 € en 2025, 6 à 4 € en 2026 : 25 + 24, et surtout pas
    // 16 × 4 = 64, qui serait le prix d'aujourd'hui appliqué au passé.
    const rosiers = cout.par_variete.find((l) => l.cle === ROSIER);
    expect(rosiers).toMatchObject({ libelle: 'Rosier Pierre de Ronsard', quantite: 16, cout: 49 });
  });

  it('range les poses par année, de la date de plantation', async () => {
    const cout = await coutEspace(MAIRIE);

    expect(cout.par_annee.find((l) => l.cle === '2025')?.cout).toBe(49);
    expect(cout.par_annee.find((l) => l.cle === '2026')?.cout).toBe(344);
    // Sans date de plantation, la ligne se range sur l'année de sa saisie.
    expect(cout.par_annee.find((l) => l.cle === '2026')?.lignes).toBe(3);
  });

  it('ne bouge pas quand le tarif du parc change', async () => {
    const avant = await coutEspace(MAIRIE);

    base.prepare('UPDATE objects SET unit_cost = ?, purchase_price = ? WHERE id = ?').run(9, 900, ROSIER);
    const apres = await coutEspace(MAIRIE);

    expect(apres.total).toBe(avant.total);
    expect(apres.par_variete.find((l) => l.cle === ROSIER)?.cout).toBe(49);

    base.prepare('UPDATE objects SET unit_cost = ?, purchase_price = ? WHERE id = ?').run(2.5, 250, ROSIER);
  });

  it('rend une structure complète pour un espace vide', async () => {
    const cout = await coutEspace(999);
    expect(cout).toMatchObject({ total: 0, lignes: 0, sans_prix: 0, par_groupe: [], par_variete: [] });
  });
});

describe('synthèse de tous les espaces', () => {
  it('totalise chaque espace et chaque nature de lieu', async () => {
    const synthese = await syntheseCouts();

    expect(synthese.total).toBe(443); // 393 au parc + 50 au rond-point
    expect(synthese.par_espace.find((l) => l.cle === MAIRIE)?.cout).toBe(393);
    expect(synthese.par_type_espace.find((l) => l.cle === 'rond_point')?.cout).toBe(50);
    expect(synthese.sans_prix).toBe(1);
  });

  it('classe le plus cher en tête', async () => {
    const synthese = await syntheseCouts();
    expect(synthese.par_espace[0].cle).toBe(MAIRIE);
  });

  it('se restreint aux espaces demandés', async () => {
    const synthese = await syntheseCouts({ espaceIds: [ROND_POINT] });
    expect(synthese.total).toBe(50);
    expect(synthese.par_espace).toHaveLength(1);
  });

  it('rend rien, et non tout, pour une liste vide', async () => {
    // Un filtre d'écran qui ne retient aucun espace ne doit pas se retourner en
    // total général : ce serait rendre visibles les chiffres qu'on excluait.
    const synthese = await syntheseCouts({ espaceIds: [] });
    expect(synthese.total).toBe(0);
    expect(synthese.par_espace).toEqual([]);
  });
});

describe('ce qui est déjà implanté', () => {
  it('compte les unités posées et les espaces concernés', async () => {
    const implantations = await implantationsParObjet([ROSIER, BANC, TULIPE]);

    expect(implantations.get(ROSIER)).toEqual({ quantite: 36, espaces: 2 });
    expect(implantations.get(BANC)).toEqual({ quantite: 1, espaces: 1 });
  });

  it('rend zéro pour un matériel jamais posé', async () => {
    const implantations = await implantationsParObjet([777]);
    expect(implantations.get(777)).toEqual({ quantite: 0, espaces: 0 });
  });
});

describe('prix unitaire repris du parc', () => {
  it('préfère le prix d’une unité au prix d’achat de la fiche', () => {
    // 250 € est la facture des cent rosiers ; 2,50 € est ce que vaut un rosier.
    expect(prixUnitaireDuParc({ unit_cost: 2.5, purchase_price: 250 })).toBe(2.5);
  });

  it('retombe sur le prix d’achat pour un exemplaire', () => {
    expect(prixUnitaireDuParc({ unit_cost: 0, purchase_price: 320 })).toBe(320);
  });

  it('ne figer aucun prix vaut mieux qu’en inventer un', () => {
    expect(prixUnitaireDuParc({ unit_cost: 0, purchase_price: 0 })).toBeNull();
    expect(prixUnitaireDuParc({})).toBeNull();
  });
});
