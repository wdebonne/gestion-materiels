import type BetterSqlite3 from 'better-sqlite3';

/**
 * Portée des lectures du module Manifestations.
 *
 * `objectScope.ts` a fermé cette fuite sur la table `objects`, mais sa règle ne
 * dit rien de `manifestation_stock`, qui porte pourtant ses propres catégories.
 * `GET /manifestations`, `GET /manifestations/:id`, `/stock` et
 * `/stock/availability` étaient donc lisibles par **tout compte authentifié** :
 * seules les écritures étaient gardées. Le test de non-régression
 * `objectScope.test.ts` ne pouvait pas le voir — il ne cherche que la chaîne
 * `objects`.
 *
 * Ces tests exécutent les fragments SQL produits contre une vraie base : une
 * clause qui ne filtre pas se voit ici, pas dans une assertion sur du texte.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__basePortee = sqlite;

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
  filtreManifestations,
  filtreStock,
  peutVoirManifestation,
} from '../src/middleware/manifestationScope';
import type { AuthRequest } from '../src/middleware/auth.middleware';

const base: BetterSqlite3.Database = (global as any).__basePortee;

/** Requête minimale, réduite à ce que la portée consulte : l'utilisateur. */
const requete = (userId: number, role: string): AuthRequest =>
  ({ user: { userId, email: `u${userId}@ville.fr`, role } } as AuthRequest);

beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE group_permissions (role VARCHAR(50), category_id INTEGER, can_view INTEGER);
    CREATE TABLE user_permissions (user_id INTEGER, category_id INTEGER, can_view INTEGER);
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255),
      category_id INTEGER,
      subcategory_id INTEGER
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY,
      title VARCHAR(255),
      status VARCHAR(20)
    );
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY,
      manifestation_id INTEGER,
      stock_id INTEGER
    );
  `);

  // Deux catégories : « Festif » (1) et « Informatique » (2).
  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Festif'), (2, 'Informatique');
    INSERT INTO subcategories (id, category_id, name) VALUES (10, 2, 'Vidéo');

    INSERT INTO manifestation_stock (id, name, category_id, subcategory_id) VALUES
      (1, 'Chaise', 1, NULL),
      (2, 'PC portable', 2, NULL),
      (3, 'Vidéoprojecteur', NULL, 10),
      (4, 'Barrière', NULL, NULL);

    INSERT INTO manifestations (id, title, status) VALUES
      (100, 'Brocante', 'validated'),
      (200, 'Conseil municipal', 'validated'),
      (300, 'Réunion sans matériel', 'pending');

    INSERT INTO manifestation_materials (id, manifestation_id, stock_id) VALUES
      (1, 100, 1),
      (2, 200, 2);

    -- Le rôle « agent » ne voit que le festif ; l'utilisateur 9 a en plus
    -- l'informatique par une permission individuelle.
    INSERT INTO group_permissions (role, category_id, can_view) VALUES ('agent', 1, 1);
    INSERT INTO user_permissions (user_id, category_id, can_view) VALUES (9, 2, 1);
  `);
});

/** Applique le fragment produit à une vraie requête et rend les identifiants. */
async function stockVisible(req: AuthRequest): Promise<number[]> {
  const portee = await filtreStock(req, 'ms');
  if (portee === null) return [];

  const lignes = base
    .prepare(`SELECT ms.id FROM manifestation_stock ms WHERE 1=1${portee.sql} ORDER BY ms.id`)
    .all(...portee.params) as Array<{ id: number }>;
  return lignes.map((l) => l.id);
}

async function manifestationsVisibles(req: AuthRequest): Promise<number[]> {
  const portee = await filtreManifestations(req, 'm');
  if (portee === null) return [];

  const lignes = base
    .prepare(`SELECT m.id FROM manifestations m WHERE 1=1${portee.sql} ORDER BY m.id`)
    .all(...portee.params) as Array<{ id: number }>;
  return lignes.map((l) => l.id);
}

describe('Stock des manifestations', () => {
  it('l’administrateur voit tout, sans clause ajoutée', async () => {
    const portee = await filtreStock(requete(1, 'admin'), 'ms');
    expect(portee).toEqual({ sql: '', params: [] });
    expect(await stockVisible(requete(1, 'admin'))).toEqual([1, 2, 3, 4]);
  });

  it('un agent ne voit que les articles de ses catégories', async () => {
    // Le PC portable et le vidéoprojecteur appartiennent à l'informatique.
    expect(await stockVisible(requete(5, 'agent'))).toEqual([1, 4]);
  });

  it('suit la catégorie portée par la sous-catégorie', async () => {
    // Le vidéoprojecteur n'a pas de `category_id` : sa catégorie passe par sa
    // sous-catégorie. C'est exactement le cas que la première écriture de la
    // règle oubliait.
    expect(await stockVisible(requete(9, 'agent'))).toEqual([1, 2, 3, 4]);
  });

  it('laisse visible un article sans catégorie', async () => {
    // Le stock a été saisi avant que les catégories existent : masquer les
    // articles sans catégorie viderait l'écran pour tout le monde.
    expect(await stockVisible(requete(5, 'agent'))).toContain(4);
  });

  it('refuse un compte sans aucune catégorie accessible', async () => {
    expect(await filtreStock(requete(42, 'user'), 'ms')).toBeNull();
  });
});

describe('Manifestations', () => {
  it('l’administrateur les voit toutes', async () => {
    expect(await manifestationsVisibles(requete(1, 'admin'))).toEqual([100, 200, 300]);
  });

  it('un agent ne voit pas une manifestation dont le matériel lui échappe', async () => {
    // « Conseil municipal » ne demande que du matériel informatique.
    expect(await manifestationsVisibles(requete(5, 'agent'))).toEqual([100, 300]);
  });

  it('laisse visible une manifestation sans matériel', async () => {
    // Ce sont justement celles qu'on vient de recevoir et qu'il faut traiter.
    expect(await manifestationsVisibles(requete(42, 'user'))).toEqual([300]);
  });

  it('la voit dès qu’une seule de ses lignes est accessible', async () => {
    expect(await manifestationsVisibles(requete(9, 'agent'))).toEqual([100, 200, 300]);
  });
});

describe('Accès à une manifestation précise', () => {
  it('accorde ce que la liste montre, refuse ce qu’elle cache', async () => {
    // La liste filtrait, le détail non : la même fuite que sur les matériels.
    expect(await peutVoirManifestation(requete(5, 'agent'), 100)).toBe(true);
    expect(await peutVoirManifestation(requete(5, 'agent'), 200)).toBe(false);
    expect(await peutVoirManifestation(requete(1, 'admin'), 200)).toBe(true);
  });

  it('refuse un identifiant inexistant', async () => {
    expect(await peutVoirManifestation(requete(1, 'admin'), 9999)).toBe(false);
  });
});
