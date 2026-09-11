import type BetterSqlite3 from 'better-sqlite3';

/**
 * Quel matériel du parc peut être implanté dans un espace vert.
 *
 * Le catalogue d'implantation proposait tout le parc : un jardinier venu poser
 * trente rosiers y trouvait les barrières Vauban des manifestations et les
 * radars pédagogiques de la police municipale.
 *
 * La règle est la même que pour le prêt — trois niveaux, le plus précis
 * l'emporte — mais sur une **autre colonne**, et c'est précisément ce que ces
 * tests protègent : ouvrir la catégorie Espaces verts ne doit rien changer au
 * prêt en manifestation, et réciproquement. Les deux réglages se sont retrouvés
 * derrière un service commun ; rien ne doit les avoir confondus.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseImplantable = sqlite;

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
  arbreImplantable,
  estImplantable,
  objetsDeLaCategorie,
  rechercherObjetsImplantables,
} from '../src/services/materielEspaceVert.service';
import { estPretable } from '../src/services/materielPretable.service';
import type { AuthRequest } from '../src/middleware/auth.middleware';

const base: BetterSqlite3.Database = (global as any).__baseImplantable;

const requete = (userId: number, role: string): AuthRequest =>
  ({ user: { userId, email: `u${userId}@ville.fr`, role } } as AuthRequest);

// Espaces verts (1) : le gazon se pose, la tondeuse non — une tondeuse est un
// outil, pas un revêtement. Manifestations (2) : catégorie fermée à
// l'implantation, mais grande ouverte au prêt : c'est le cas qui motive tout.
beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name VARCHAR(255),
      available_for_manifestations INTEGER DEFAULT 1,
      available_for_green_spaces INTEGER DEFAULT 1
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255),
      available_for_manifestations INTEGER,
      available_for_green_spaces INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      serial_number VARCHAR(100), category_id INTEGER, subcategory_id INTEGER,
      available_for_manifestations INTEGER,
      available_for_green_spaces INTEGER
    );
    CREATE TABLE group_permissions (role VARCHAR(50), category_id INTEGER, can_view INTEGER);
    CREATE TABLE user_permissions (user_id INTEGER, category_id INTEGER, can_view INTEGER);
  `);

  base.exec(`
    INSERT INTO categories (id, name, available_for_manifestations, available_for_green_spaces) VALUES
      (1, 'Espaces verts', 0, 1),
      (2, 'Manifestations', 1, 0),
      (3, 'Voirie', 1, 1);

    INSERT INTO subcategories (id, category_id, name, available_for_manifestations, available_for_green_spaces) VALUES
      (10, 3, 'Revêtements', NULL, NULL),
      (11, 3, 'Signalisation', NULL, 0);

    INSERT INTO objects (id, name, reference, category_id, subcategory_id, available_for_manifestations, available_for_green_spaces) VALUES
      (1, 'Gazon de placage', 'EV-01', 1, NULL, NULL, NULL),
      (2, 'Tondeuse autoportée', 'EV-02', 1, NULL, NULL, 0),
      (3, 'Barrière Vauban', 'MA-01', 2, NULL, NULL, NULL),
      (4, 'Jardinière de rue', 'MA-02', 2, NULL, NULL, 1),
      (5, 'Enrobé à froid', 'VO-01', NULL, 10, NULL, NULL),
      (6, 'Panneau stop', 'VO-02', NULL, 11, NULL, NULL),
      (7, 'Potelet fleuri', 'VO-03', NULL, 11, NULL, 1),
      (8, 'Matériel non classé', 'XX-01', NULL, NULL, NULL, NULL);

    INSERT INTO group_permissions (role, category_id, can_view) VALUES ('agent', 1, 1);
  `);
});

describe("Résolution — le plus précis l'emporte", () => {
  it('implante ce que sa catégorie autorise', async () => {
    expect(await estImplantable(1)).toBe(true);
  });

  it('exclut un matériel malgré sa catégorie ouverte', async () => {
    // Une tondeuse voisine le gazon au parc, mais elle ne se plante pas.
    expect(await estImplantable(2)).toBe(false);
  });

  it('exclut ce que sa catégorie ferme', async () => {
    expect(await estImplantable(3)).toBe(false);
  });

  it('implante une exception dans une catégorie fermée', async () => {
    // La jardinière de rue vient du stock des manifestations et se plante.
    expect(await estImplantable(4)).toBe(true);
  });

  it('suit la catégorie à travers une sous-catégorie qui hérite', async () => {
    expect(await estImplantable(5)).toBe(true);
  });

  it('respecte une sous-catégorie qui ferme, dans une catégorie ouverte', async () => {
    expect(await estImplantable(6)).toBe(false);
  });

  it('laisse un matériel faire exception à sa sous-catégorie', async () => {
    expect(await estImplantable(7)).toBe(true);
  });

  it('implante par défaut un matériel sans aucune catégorie', async () => {
    // Ne rien dire vaut « ouvert » : c'est le comportement d'avant le réglage.
    expect(await estImplantable(8)).toBe(true);
  });

  it('refuse un matériel introuvable', async () => {
    expect(await estImplantable(9999)).toBe(false);
  });
});

describe('Les deux réglages ne se confondent pas', () => {
  it("ouvre à l'implantation ce que le prêt ferme", async () => {
    // Espaces verts : implantable, jamais prêté pour une brocante.
    expect(await estImplantable(1)).toBe(true);
    expect(await estPretable(1)).toBe(false);
  });

  it("ferme à l'implantation ce que le prêt ouvre", async () => {
    // Barrière Vauban : elle circule, elle ne se plante pas.
    expect(await estImplantable(3)).toBe(false);
    expect(await estPretable(3)).toBe(true);
  });
});

describe('Arbre de réglage', () => {
  it('rend chaque catégorie avec son réglage propre au module', async () => {
    const arbre = await arbreImplantable();
    const parNom = new Map(arbre.map((c: any) => [c.name, c]));
    expect(parNom.get('Espaces verts').available_for_green_spaces).toBe(1);
    expect(parNom.get('Manifestations').available_for_green_spaces).toBe(0);
  });

  it('ne rend jamais une catégorie qui hérite', async () => {
    // C'est elle la valeur de référence : `null` laisserait la résolution sans
    // point de départ.
    const arbre = await arbreImplantable();
    for (const categorie of arbre) {
      expect([0, 1]).toContain(categorie.available_for_green_spaces);
    }
  });

  it('range les sous-catégories sous leur catégorie', async () => {
    const arbre = await arbreImplantable();
    const voirie = arbre.find((c: any) => c.name === 'Voirie');
    expect(voirie.subcategories.map((sc: any) => sc.name)).toEqual([
      'Revêtements',
      'Signalisation',
    ]);
  });
});

describe('Matériels d’une catégorie', () => {
  it('rend le choix propre et le résultat effectif', async () => {
    const objets = await objetsDeLaCategorie(requete(1, 'admin'), 1);
    expect(objets!.map((o: any) => [o.name, o.available_for_green_spaces, o.implantable])).toEqual([
      ['Gazon de placage', null, 1],
      ['Tondeuse autoportée', 0, 0],
    ]);
  });

  it('respecte la portée par catégorie du compte', async () => {
    // L'agent ne voit que la catégorie 1 : régler l'implantation reste une
    // lecture du parc, et ne doit pas lui révéler le reste.
    expect(await objetsDeLaCategorie(requete(5, 'agent'), 2)).toEqual([]);
    expect((await objetsDeLaCategorie(requete(5, 'agent'), 1))!.length).toBe(2);
  });

  it('refuse un compte sans aucune catégorie accessible', async () => {
    expect(await objetsDeLaCategorie(requete(42, 'user'), 1)).toBeNull();
  });
});

describe('Recherche dans tout le parc', () => {
  it('trouve par nom et rend le rattachement', async () => {
    const [enrobe] = (await rechercherObjetsImplantables(requete(1, 'admin'), 'Enrobé'))!;
    expect(enrobe.category_name).toBe('Voirie');
    expect(enrobe.subcategory_name).toBe('Revêtements');
    expect(enrobe.implantable).toBe(1);
  });

  it('rend un matériel sans catégorie, implantable par défaut', async () => {
    const [orphelin] = (await rechercherObjetsImplantables(requete(1, 'admin'), 'non classé'))!;
    expect(orphelin.category_id).toBeNull();
    expect(orphelin.implantable).toBe(1);
  });

  it('ne cherche rien sur un terme vide', async () => {
    expect(await rechercherObjetsImplantables(requete(1, 'admin'), '   ')).toEqual([]);
  });
});
