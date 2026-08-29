import type BetterSqlite3 from 'better-sqlite3';

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur proposait **tout le parc**. Or une catégorie ne se prête pas d'un
 * bloc : un réfrigérateur de la catégorie Électroménager part volontiers pour
 * une brocante, le grill de la même catégorie non.
 *
 * Ces tests protègent la règle de résolution — le plus précis l'emporte — et
 * surtout les trois états. Confondre « non » et « hérite » obligerait à recocher
 * chaque matériel d'une catégorie qu'on vient d'ouvrir, et personne ne le ferait.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__basePretable = sqlite;

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
  arbreDisponibilite,
  estPretable,
  lireDisponibilite,
  objetsDeLaCategorie,
  versColonne,
} from '../src/services/materielPretable.service';
import type { AuthRequest } from '../src/middleware/auth.middleware';

const base: BetterSqlite3.Database = (global as any).__basePretable;

const requete = (userId: number, role: string): AuthRequest =>
  ({ user: { userId, email: `u${userId}@ville.fr`, role } } as AuthRequest);

// Électroménager (1) : le réfrigérateur part, le grill non — le cas qui motive
// tout. Véhicules (2) : catégorie fermée, avec une exception.
beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name VARCHAR(255), available_for_manifestations INTEGER DEFAULT 1
    );
    CREATE TABLE subcategories (
      id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255),
      available_for_manifestations INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      serial_number VARCHAR(100), category_id INTEGER, subcategory_id INTEGER,
      available_for_manifestations INTEGER
    );
    CREATE TABLE group_permissions (role VARCHAR(50), category_id INTEGER, can_view INTEGER);
    CREATE TABLE user_permissions (user_id INTEGER, category_id INTEGER, can_view INTEGER);
  `);

  base.exec(`
    INSERT INTO categories (id, name, available_for_manifestations) VALUES
      (1, 'Électroménager', 1),
      (2, 'Véhicules', 0),
      (3, 'Mobilier', 1);

    INSERT INTO subcategories (id, category_id, name, available_for_manifestations) VALUES
      (10, 3, 'Tables', NULL),
      (11, 3, 'Mobilier de bureau', 0);

    INSERT INTO objects (id, name, reference, category_id, subcategory_id, available_for_manifestations) VALUES
      (1, 'Réfrigérateur', 'EM-01', 1, NULL, NULL),
      (2, 'Grill', 'EM-02', 1, NULL, 0),
      (3, 'Camion benne', 'VH-01', 2, NULL, NULL),
      (4, 'Remorque plateau', 'VH-02', 2, NULL, 1),
      (5, 'Table pliante', 'MO-01', NULL, 10, NULL),
      (6, 'Bureau', 'MO-02', NULL, 11, NULL),
      (7, 'Fauteuil de direction', 'MO-03', NULL, 11, 1),
      (8, 'Objet non classé', 'XX-01', NULL, NULL, NULL);

    INSERT INTO group_permissions (role, category_id, can_view) VALUES ('agent', 1, 1);
  `);
});

describe('Lecture des trois états', () => {
  it('distingue « non » de « hérite »', () => {
    // Les confondre obligerait à recocher chaque matériel d'une catégorie qu'on
    // vient d'ouvrir.
    expect(lireDisponibilite(null)).toBeNull();
    expect(lireDisponibilite(undefined)).toBeNull();
    expect(lireDisponibilite('')).toBeNull();
    expect(lireDisponibilite(false)).toBe(false);
    expect(lireDisponibilite(0)).toBe(false);
    expect(lireDisponibilite(true)).toBe(true);
    expect(lireDisponibilite(1)).toBe(true);
    expect(lireDisponibilite('true')).toBe(true);
  });

  it('écrit null en base sans le confondre avec zéro', () => {
    expect(versColonne(null)).toBeNull();
    expect(versColonne(false)).toBe(0);
    expect(versColonne(true)).toBe(1);
  });
});

describe('Résolution — le plus précis l’emporte', () => {
  it('prête ce que sa catégorie autorise', async () => {
    expect(await estPretable(1)).toBe(true);
  });

  it('exclut un matériel malgré sa catégorie ouverte', async () => {
    // C'est le cas qui motive tout : le grill reste à la cuisine centrale.
    expect(await estPretable(2)).toBe(false);
  });

  it('exclut ce que sa catégorie ferme', async () => {
    expect(await estPretable(3)).toBe(false);
  });

  it('prête une exception dans une catégorie fermée', async () => {
    // La remorque circule, pas le reste du garage.
    expect(await estPretable(4)).toBe(true);
  });

  it('suit la catégorie à travers une sous-catégorie qui hérite', async () => {
    expect(await estPretable(5)).toBe(true);
  });

  it('respecte une sous-catégorie qui ferme, dans une catégorie ouverte', async () => {
    expect(await estPretable(6)).toBe(false);
  });

  it('laisse un matériel faire exception à sa sous-catégorie', async () => {
    expect(await estPretable(7)).toBe(true);
  });

  it('prête par défaut un matériel sans aucune catégorie', async () => {
    // C'est le comportement d'avant ce réglage : ne rien dire vaut « prêtable ».
    expect(await estPretable(8)).toBe(true);
  });

  it('refuse un matériel introuvable', async () => {
    // Mieux vaut refuser que réserver un fantôme.
    expect(await estPretable(9999)).toBe(false);
  });
});

describe('Arbre de réglage', () => {
  it('rend les catégories avec leurs sous-catégories', async () => {
    const arbre = await arbreDisponibilite();
    const mobilier = arbre.find((c: any) => c.name === 'Mobilier');

    expect(arbre.map((c: any) => c.name)).toEqual(['Électroménager', 'Mobilier', 'Véhicules']);
    expect(mobilier.subcategories.map((sc: any) => sc.name)).toEqual([
      'Mobilier de bureau',
      'Tables',
    ]);
  });

  it('ne laisse jamais une catégorie sans valeur', async () => {
    // C'est elle la valeur de référence : `null` laisserait la résolution sans
    // point de départ.
    const arbre = await arbreDisponibilite();
    for (const categorie of arbre) {
      expect([0, 1]).toContain(categorie.available_for_manifestations);
    }
  });

  it('compte les matériels, pour qu’on sache ce qu’on ouvre', async () => {
    const arbre = await arbreDisponibilite();
    const electromenager = arbre.find((c: any) => c.name === 'Électroménager');
    expect(electromenager.objets_directs).toBe(2);
  });
});

describe('Matériels d’une catégorie', () => {
  it('rend le réglage propre et le résultat effectif', async () => {
    // Sans les deux, on ne saurait pas pourquoi un matériel est exclu alors
    // qu'on n'a rien coché dessus.
    const objets = await objetsDeLaCategorie(requete(1, 'admin'), 1);

    expect(objets!.map((o: any) => [o.name, o.available_for_manifestations, o.pretable])).toEqual([
      ['Grill', 0, 0],
      ['Réfrigérateur', null, 1],
    ]);
  });

  it('trouve les matériels rattachés par leur sous-catégorie', async () => {
    const objets = await objetsDeLaCategorie(requete(1, 'admin'), 3);
    expect(objets!.map((o: any) => o.name).sort()).toEqual([
      'Bureau',
      'Fauteuil de direction',
      'Table pliante',
    ]);
  });

  it('applique la portée par catégorie', async () => {
    // Régler la disponibilité reste une lecture du parc : un compte ne doit pas
    // découvrir ici les matériels des catégories qui lui sont fermées.
    expect(await objetsDeLaCategorie(requete(5, 'agent'), 2)).toEqual([]);
    expect((await objetsDeLaCategorie(requete(5, 'agent'), 1))!.length).toBe(2);
  });

  it('refuse un compte sans aucune catégorie accessible', async () => {
    expect(await objetsDeLaCategorie(requete(42, 'user'), 1)).toBeNull();
  });

  it('accepte un identifiant venu d’une chaîne de requête', async () => {
    // `COALESCE(...)` est une expression, donc sans affinité de colonne :
    // SQLite ne convertit pas `'1'` en 1 et la liste revenait vide, sans erreur.
    const parTexte = await objetsDeLaCategorie(requete(1, 'admin'), '1');
    expect(parTexte!.map((o: any) => o.name)).toEqual(['Grill', 'Réfrigérateur']);
  });

  it('rend une liste vide pour un identifiant absurde', async () => {
    expect(await objetsDeLaCategorie(requete(1, 'admin'), 'abc')).toEqual([]);
  });
});
