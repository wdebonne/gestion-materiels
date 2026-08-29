import type BetterSqlite3 from 'better-sqlite3';

/**
 * Qui est concerné par une manifestation — et donc qui est sollicité.
 *
 * C'est la règle centrale du module. Avant elle, le choix se réduisait à « tout
 * le monde reçoit tout » ou « personne ne reçoit rien » : `group_permissions.role`
 * désigne un rôle, pas un groupe de personnes, et il n'existait ni entité de
 * service, ni destinataire collectif, ni approbation.
 *
 * Le défaut que ces tests empêchent est précis : le service informatique alerté
 * d'une brocante sans matériel informatique, le service restauration d'une
 * réunion sans repas. Un service qui reçoit ce qui ne le regarde pas cesse de
 * lire, et rate le message qui comptait.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseServices = sqlite;

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
  approbationsEnAttente,
  creerApprobationsManquantes,
  destinatairesDuService,
  destinatairesManifestation,
  manifestationsVisiblesParService,
  peutDeciderPour,
  servicesConcernes,
  servicesDe,
} from '../src/services/manifestationServices.service';

const base: BetterSqlite3.Database = (global as any).__baseServices;

// Catégories : 1 = Festif, 2 = Informatique, 3 = Restauration.
// Services   : 1 = Festif, 2 = Informatique, 3 = Restauration, 4 = Direction (observateur).
beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(255),
      last_name VARCHAR(255), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100), email VARCHAR(255),
      is_observer INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      notify_new_request INTEGER DEFAULT 1, notify_status_change INTEGER DEFAULT 1,
      notify_material_change INTEGER DEFAULT 1, notify_message INTEGER DEFAULT 1
    );
    CREATE TABLE service_categories (id INTEGER PRIMARY KEY, service_id INTEGER, category_id INTEGER);
    CREATE TABLE service_members (id INTEGER PRIMARY KEY, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0);
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY, name VARCHAR(255), category_id INTEGER, subcategory_id INTEGER
    );
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20));
    CREATE TABLE manifestation_materials (
      id INTEGER PRIMARY KEY, manifestation_id INTEGER, stock_id INTEGER, quantity_requested INTEGER DEFAULT 0
    );
    CREATE TABLE manifestation_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, service_id INTEGER, user_id INTEGER,
      kind VARCHAR(20) DEFAULT 'approbation', status VARCHAR(20) DEFAULT 'pending',
      requested_by INTEGER, requested_at DATETIME, decided_by INTEGER, decided_at DATETIME,
      comment TEXT, delivery_date DATE, recovery_date DATE
    );
    CREATE TABLE manifestation_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, user_id INTEGER, service_id INTEGER
    );
  `);

  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Festif'), (2, 'Informatique'), (3, 'Restauration');
    INSERT INTO subcategories (id, category_id, name) VALUES (20, 2, 'Vidéo');

    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (1, 'admin@ville.fr', 'A', 'Dmin', 'admin'),
      (2, 'info@ville.fr', 'Ines', 'Formatique', 'service'),
      (3, 'fetes@ville.fr', 'Fred', 'Estif', 'service'),
      (4, 'dgs@ville.fr', 'Dee', 'Gess', 'service'),
      (5, 'orphelin@ville.fr', 'Or', 'Phelin', 'service');

    INSERT INTO services (id, name, slug, email, is_observer) VALUES
      (1, 'Service festif', 'festif', 'festif@ville.fr', 0),
      (2, 'Service informatique', 'informatique', NULL, 0),
      (3, 'Service restauration', 'restauration', 'resto@ville.fr', 0),
      (4, 'Direction générale', 'direction', 'dgs@ville.fr', 1);

    INSERT INTO service_categories (service_id, category_id) VALUES (1, 1), (2, 2), (3, 3);
    INSERT INTO service_members (service_id, user_id) VALUES (1, 3), (2, 2), (4, 4);

    INSERT INTO manifestation_stock (id, name, category_id, subcategory_id) VALUES
      (1, 'Chaise', 1, NULL),
      (2, 'PC portable', 2, NULL),
      (3, 'Vidéoprojecteur', NULL, 20),
      (4, 'Barrière', NULL, NULL);

    INSERT INTO manifestations (id, title, status) VALUES
      (100, 'Brocante', 'validated'),
      (200, 'Conseil municipal', 'validated'),
      (300, 'Fête de la musique', 'validated'),
      (400, 'Réunion sans matériel', 'pending');

    -- Brocante : uniquement du festif.
    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (100, 1, 50);
    -- Conseil municipal : uniquement de l'informatique, par sous-catégorie.
    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (200, 3, 1);
    -- Fête de la musique : festif + informatique.
    INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (300, 1, 200), (300, 2, 2);
  `);
});

afterEach(() => {
  base.exec('DELETE FROM manifestation_approvals; DELETE FROM manifestation_watchers;');
  base.exec('UPDATE services SET is_active = 1, notify_new_request = 1, notify_status_change = 1');
});

const noms = (services: any[]) => services.map((s) => s.name).sort();

describe('Services concernés', () => {
  it('ne retient que les services dont le périmètre est demandé', async () => {
    // Le cas qui motive tout : l'informatique n'a rien à faire dans une brocante.
    expect(noms(await servicesConcernes(100))).toEqual(['Service festif']);
  });

  it('suit la catégorie portée par la sous-catégorie', async () => {
    // Le vidéoprojecteur n'a pas de category_id : elle passe par sa sous-catégorie.
    expect(noms(await servicesConcernes(200))).toEqual(['Service informatique']);
  });

  it('retient tous les services concernés quand la demande est mixte', async () => {
    expect(noms(await servicesConcernes(300))).toEqual(['Service festif', 'Service informatique']);
  });

  it('ne concerne personne quand la manifestation ne demande rien', async () => {
    expect(await servicesConcernes(400)).toEqual([]);
  });

  it('ignore un service désactivé', async () => {
    base.exec('UPDATE services SET is_active = 0 WHERE id = 1');
    expect(await servicesConcernes(100)).toEqual([]);
  });

  it('ne rattache aucun service à un article sans catégorie', async () => {
    // Inventer un service pour un article non classé serait pire que se taire.
    base.exec('INSERT INTO manifestations (id, title, status) VALUES (500, %s, %s)'.replace(/%s/g, "'x'"));
    base.exec('INSERT INTO manifestation_materials (manifestation_id, stock_id, quantity_requested) VALUES (500, 4, 10)');
    expect(await servicesConcernes(500)).toEqual([]);
    base.exec('DELETE FROM manifestation_materials WHERE manifestation_id = 500; DELETE FROM manifestations WHERE id = 500');
  });
});

describe('Création des approbations', () => {
  it('ne sollicite que les services concernés', async () => {
    const creees = await creerApprobationsManquantes(100, 1);
    expect(noms(creees.map((c) => c.service))).toEqual(['Service festif']);

    const enBase = base.prepare('SELECT service_id FROM manifestation_approvals').all();
    expect(enBase).toEqual([{ service_id: 1 }]);
  });

  it('est rejouable sans redemander deux fois', async () => {
    // Corriger une faute de frappe dans un titre ne doit pas relancer tout le monde.
    await creerApprobationsManquantes(300, 1);
    const secondPassage = await creerApprobationsManquantes(300, 1);

    expect(secondPassage).toEqual([]);
    expect(base.prepare('SELECT COUNT(*) c FROM manifestation_approvals').get()).toEqual({ c: 2 });
  });

  it('n’efface jamais une décision déjà rendue', async () => {
    await creerApprobationsManquantes(300, 1);
    base.exec("UPDATE manifestation_approvals SET status = 'approved' WHERE service_id = 1");

    await creerApprobationsManquantes(300, 1);

    const festif = base
      .prepare('SELECT status FROM manifestation_approvals WHERE service_id = 1')
      .all();
    expect(festif).toEqual([{ status: 'approved' }]);
  });

  it('ne crée rien quand aucun service n’est concerné', async () => {
    expect(await creerApprobationsManquantes(400, 1)).toEqual([]);
  });
});

describe('Blocage de la validation', () => {
  it('ne compte que les approbations, pas les demandes d’information', async () => {
    // Une demande d'avis laissée sans réponse ne doit pas bloquer une
    // manifestation : c'est ce que `kind` distingue.
    base.exec(`
      INSERT INTO manifestation_approvals (manifestation_id, service_id, kind, status)
      VALUES (100, 1, 'information', 'pending')
    `);
    expect(await approbationsEnAttente(100)).toEqual([]);
  });

  it('signale une approbation encore attendue', async () => {
    await creerApprobationsManquantes(300, 1);
    const attendues = await approbationsEnAttente(300);
    expect(attendues).toHaveLength(2);
  });

  it('ne compte plus une approbation rendue', async () => {
    await creerApprobationsManquantes(300, 1);
    base.exec("UPDATE manifestation_approvals SET status = 'approved' WHERE service_id = 1");
    base.exec("UPDATE manifestation_approvals SET status = 'not_concerned' WHERE service_id = 2");

    expect(await approbationsEnAttente(300)).toEqual([]);
  });
});

describe('Qui peut décider', () => {
  it('un membre décide pour son service', async () => {
    expect(await peutDeciderPour(2, 'service', 2)).toBe(true);
  });

  it('un membre ne décide pas pour un autre service', async () => {
    // Sans cette garde, n'importe qui approuverait à la place de l'informatique.
    expect(await peutDeciderPour(3, 'service', 2)).toBe(false);
  });

  it('un administrateur peut toujours décider', async () => {
    // C'est lui qui débloque une manifestation quand un service ne répond pas.
    expect(await peutDeciderPour(1, 'admin', 2)).toBe(true);
  });
});

/** Adresses seules, pour comparer sans se soucier du compte porteur. */
const adresses = (destinataires: Array<{ email: string }>) => destinataires.map((d) => d.email);

describe('Destinataires', () => {
  it('préfère la boîte partagée et y ajoute les membres', async () => {
    // Une boîte partagée survit aux départs, contrairement à l'adresse d'un agent.
    expect(adresses(await destinatairesDuService(1)).sort()).toEqual(['festif@ville.fr', 'fetes@ville.fr']);
  });

  it('retombe sur les membres quand le service n’a pas de boîte', async () => {
    expect(adresses(await destinatairesDuService(2))).toEqual(['info@ville.fr']);
  });

  it('n’écrit pas à un service non sollicité', async () => {
    await creerApprobationsManquantes(100, 1);
    const destinataires = adresses(await destinatairesManifestation(100, 'approval_decided'));

    expect(destinataires).not.toContain('info@ville.fr');
    expect(destinataires).toContain('festif@ville.fr');
  });

  it('écrit toujours aux observateurs', async () => {
    await creerApprobationsManquantes(100, 1);
    expect(adresses(await destinatairesManifestation(100, 'approval_decided'))).toContain('dgs@ville.fr');
  });

  it('respecte un service qui a coupé ce type d’avis', async () => {
    await creerApprobationsManquantes(100, 1);
    base.exec('UPDATE services SET notify_status_change = 0 WHERE id = 1');

    expect(adresses(await destinatairesManifestation(100, 'approval_decided'))).not.toContain('festif@ville.fr');
  });

  it('inclut une personne mise en copie à titre individuel', async () => {
    base.exec('INSERT INTO manifestation_watchers (manifestation_id, user_id) VALUES (100, 5)');
    expect(adresses(await destinatairesManifestation(100, 'approval_decided'))).toContain('orphelin@ville.fr');
  });
});

describe('Ce qu’un compte « service » voit', () => {
  it('voit les manifestations où son service est sollicité', async () => {
    await creerApprobationsManquantes(100, 1);
    await creerApprobationsManquantes(300, 1);

    // L'informatique n'est concernée que par la fête de la musique.
    expect(await manifestationsVisiblesParService(2)).toEqual([300]);
  });

  it('ne voit rien quand il n’est rattaché à aucun service', async () => {
    expect(await manifestationsVisiblesParService(5)).toEqual([]);
  });

  it('un observateur voit tout', async () => {
    // Le DGS et les élus suivent l'intégralité des demandes.
    expect(await manifestationsVisiblesParService(4)).toEqual([100, 200, 300, 400]);
  });

  it('voit une manifestation où on l’a mis en copie sans le solliciter', async () => {
    base.exec('INSERT INTO manifestation_watchers (manifestation_id, service_id) VALUES (200, 1)');
    expect(await manifestationsVisiblesParService(3)).toEqual([200]);
  });

  it('rend les services d’un compte', async () => {
    expect(noms(await servicesDe(2))).toEqual(['Service informatique']);
    expect(await servicesDe(5)).toEqual([]);
  });
});
