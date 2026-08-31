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
  approbationsEnAttenteHorsCoordinateur,
  delegationActive,
  peutDeleguerPour,
  toutEstApprouve,
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
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255), is_prestation INTEGER);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(255),
      last_name VARCHAR(255), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100), email VARCHAR(255),
      is_observer INTEGER DEFAULT 0, is_coordinator INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      notify_new_request INTEGER DEFAULT 1, notify_status_change INTEGER DEFAULT 1,
      notify_material_change INTEGER DEFAULT 1, notify_message INTEGER DEFAULT 1
    );
    CREATE TABLE service_categories (id INTEGER PRIMARY KEY, service_id INTEGER, category_id INTEGER);
    CREATE TABLE service_members (id INTEGER PRIMARY KEY, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0);
    CREATE TABLE service_delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, delegate_user_id INTEGER,
      granted_by INTEGER, start_date DATE, end_date DATE, created_at DATETIME
    );
    CREATE TABLE manifestation_stock (
      id INTEGER PRIMARY KEY, name VARCHAR(255), category_id INTEGER, subcategory_id INTEGER
    );
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255),
      category_id INTEGER, subcategory_id INTEGER, is_prestation INTEGER
    );
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, object_id INTEGER,
      quantity INTEGER DEFAULT 1, quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0, return_state VARCHAR(20), notes TEXT
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
    INSERT INTO users (id, email, first_name, last_name, role) VALUES (6, 'simple@ville.fr', 'Sim', 'Ple', 'service');
    -- Le festif a un responsable (3) et un simple membre (6) ; l'informatique un
    -- responsable (2) ; la direction un membre observateur (4).
    INSERT INTO service_members (service_id, user_id, is_manager) VALUES
      (1, 3, 1), (1, 6, 0), (2, 2, 1), (4, 4, 0);

    -- Le parc, où un service peut tenir ses prestations à côté de son matériel :
    -- « Restauration › Prestation » porte le personnel de service.
    INSERT INTO subcategories (id, category_id, name, is_prestation) VALUES (30, 3, 'Prestation', 1);
    INSERT INTO objects (id, name, category_id, subcategory_id) VALUES
      (1, 'Personnel de service', NULL, 30),
      (2, 'Camion benne', 1, NULL);

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
  base.exec('DELETE FROM manifestation_approvals; DELETE FROM manifestation_watchers; DELETE FROM service_delegations;');
  base.exec('UPDATE services SET is_active = 1, is_coordinator = 0, notify_new_request = 1, notify_status_change = 1');
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
  it('le responsable décide pour son service', async () => {
    expect(await peutDeciderPour(2, 'service', 2)).toBe(true);
  });

  it('un simple membre ne décide pas', async () => {
    // `is_manager` était enregistré et relu sans entrer dans aucune décision :
    // tout membre approuvait au nom de son service. Approuver engage la
    // collectivité, c'est au responsable de le faire.
    expect(await peutDeciderPour(6, 'service', 1)).toBe(false);
  });

  it('un responsable ne décide pas pour un autre service', async () => {
    expect(await peutDeciderPour(3, 'service', 2)).toBe(false);
  });

  it('un administrateur peut toujours décider', async () => {
    // C'est lui qui débloque une manifestation quand un service ne répond pas.
    expect(await peutDeciderPour(1, 'admin', 2)).toBe(true);
  });
});

describe('Délégations', () => {
  const deleguer = (serviceId: number, userId: number, debut?: string, fin?: string) =>
    base
      .prepare(
        'INSERT INTO service_delegations (service_id, delegate_user_id, granted_by, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
      )
      .run(serviceId, userId, 3, debut ?? null, fin ?? null);

  const jourDecale = (jours: number) => {
    const date = new Date();
    date.setDate(date.getDate() + jours);
    return date.toISOString().split('T')[0];
  };

  it('un délégataire décide comme le responsable', async () => {
    deleguer(1, 6);
    expect(await peutDeciderPour(6, 'service', 1)).toBe(true);
  });

  it('sans bornes, la délégation vaut jusqu’à révocation', async () => {
    // Le cas de l'adjoint permanent, aussi courant qu'un remplacement de congés.
    deleguer(1, 6);
    expect(await delegationActive(6, 1)).toBe(true);
  });

  it('une délégation à venir ne donne encore rien', async () => {
    deleguer(1, 6, jourDecale(3), jourDecale(10));
    expect(await peutDeciderPour(6, 'service', 1)).toBe(false);
  });

  it('une délégation expirée ne donne plus rien', async () => {
    // Sans cette borne, un remplacement de congés durerait toujours.
    deleguer(1, 6, jourDecale(-10), jourDecale(-1));
    expect(await peutDeciderPour(6, 'service', 1)).toBe(false);
  });

  it('une délégation en cours donne le droit de décider', async () => {
    deleguer(1, 6, jourDecale(-1), jourDecale(1));
    expect(await peutDeciderPour(6, 'service', 1)).toBe(true);
  });

  it('ne vaut que pour le service qui l’a accordée', async () => {
    deleguer(1, 6);
    expect(await peutDeciderPour(6, 'service', 2)).toBe(false);
  });

  it('seul le responsable délègue, jamais un délégataire', async () => {
    // Une délégation qui se redéléguerait rendrait la chaîne de responsabilité
    // inconnaissable.
    deleguer(1, 6);
    expect(await peutDeleguerPour(3, 'service', 1)).toBe(true);
    expect(await peutDeleguerPour(6, 'service', 1)).toBe(false);
    expect(await peutDeleguerPour(1, 'admin', 1)).toBe(true);
  });
});

describe('Service coordinateur', () => {
  const designerCoordinateur = (serviceId: number) =>
    base.prepare('UPDATE services SET is_coordinator = 1 WHERE id = ?').run(serviceId);

  it('est sollicité même sur une manifestation qui ne le concerne pas', async () => {
    // C'est lui qui prononce la validation finale : il ne peut jamais être
    // absent du tableau des approbations.
    designerCoordinateur(3);
    const creees = await creerApprobationsManquantes(100, 1);

    expect(noms(creees.map((c) => c.service))).toEqual(['Service festif', 'Service restauration']);
  });

  it('est sollicité même quand aucun matériel n’est demandé', async () => {
    designerCoordinateur(3);
    const creees = await creerApprobationsManquantes(400, 1);

    expect(noms(creees.map((c) => c.service))).toEqual(['Service restauration']);
  });

  it('n’est pas compté parmi les approbations qu’il attend', async () => {
    // Lui demander son avis avant que les services aient répondu le ferait
    // valider à l'aveugle.
    designerCoordinateur(3);
    await creerApprobationsManquantes(300, 1);

    const toutes = await approbationsEnAttente(300);
    const horsLui = await approbationsEnAttenteHorsCoordinateur(300);

    expect(toutes).toHaveLength(3);
    expect(horsLui.map((a: any) => a.service_name).sort()).toEqual([
      'Service festif',
      'Service informatique',
    ]);
  });

  it('ne considère tout approuvé que lorsque les autres ont répondu', async () => {
    designerCoordinateur(3);
    await creerApprobationsManquantes(300, 1);

    expect(await toutEstApprouve(300)).toBe(false);

    base.exec("UPDATE manifestation_approvals SET status = 'approved' WHERE service_id = 1");
    expect(await toutEstApprouve(300)).toBe(false);

    base.exec("UPDATE manifestation_approvals SET status = 'not_concerned' WHERE service_id = 2");
    // « Non concerné » vaut accord : le service a répondu, il ne bloque rien.
    expect(await toutEstApprouve(300)).toBe(true);
  });

  it('un refus empêche de considérer tout approuvé', async () => {
    designerCoordinateur(3);
    await creerApprobationsManquantes(300, 1);
    base.exec("UPDATE manifestation_approvals SET status = 'approved' WHERE service_id = 1");
    base.exec("UPDATE manifestation_approvals SET status = 'rejected' WHERE service_id = 2");

    expect(await toutEstApprouve(300)).toBe(false);
  });

  it('voit toutes les manifestations, comme un observateur', async () => {
    designerCoordinateur(3);
    base.prepare('INSERT INTO service_members (service_id, user_id, is_manager) VALUES (3, 6, 1)').run();

    expect(await manifestationsVisiblesParService(6)).toEqual([100, 200, 300, 400]);
    base.prepare('DELETE FROM service_members WHERE service_id = 3').run();
  });

  it('est destinataire de tout, sans être concerné par le matériel', async () => {
    designerCoordinateur(3);
    await creerApprobationsManquantes(100, 1);

    expect(adresses(await destinatairesManifestation(100, 'message'))).toContain('resto@ville.fr');
  });
});

/** Adresses seules, pour comparer sans se soucier du compte porteur. */
const adresses = (destinataires: Array<{ email: string }>) => destinataires.map((d) => d.email);

describe('Destinataires', () => {
  it('préfère la boîte partagée et y ajoute tous les membres', async () => {
    // Une boîte partagée survit aux départs, contrairement à l'adresse d'un
    // agent. Tous les membres reçoivent — décider est une autre affaire, et
    // c'est celle du seul responsable.
    expect(adresses(await destinatairesDuService(1)).sort()).toEqual([
      'festif@ville.fr',
      'fetes@ville.fr',
      'simple@ville.fr',
    ]);
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

/**
 * Le matériel du parc sollicite aussi son service.
 *
 * `manifestation_items` était ignorée par le routage : une manifestation qui ne
 * demandait que du matériel du parc — ou les prestations qu'un service y tient —
 * ne sollicitait **personne**, et sa validation passait sans que quiconque ait
 * eu son mot à dire. Le défaut ne se voyait pas : le tableau des approbations
 * était simplement vide, ce qui ressemble à « rien à approuver ».
 */
describe('Services concernés par le matériel du parc', () => {
  const demanderDuParc = (manifestationId: number, objectIds: number[]) => {
    for (const objectId of objectIds) {
      base
        .prepare('INSERT INTO manifestation_items (manifestation_id, object_id, quantity) VALUES (?, ?, 1)')
        .run(manifestationId, objectId);
    }
  };

  afterEach(() => {
    base.exec('DELETE FROM manifestation_items');
  });

  it('sollicite le service d’une prestation tenue dans le parc', async () => {
    // Le personnel de service relève de « Restauration › Prestation ».
    demanderDuParc(400, [1]);

    const services = await servicesConcernes(400);
    expect(services.map((s: any) => s.name)).toEqual(['Service restauration']);
  });

  it('sollicite aussi le service d’un exemplaire du parc', async () => {
    demanderDuParc(400, [2]);

    const services = await servicesConcernes(400);
    expect(services.map((s: any) => s.name)).toEqual(['Service festif']);
  });

  it('cumule le stock et le parc', async () => {
    // La manifestation 100 demande déjà une chaise (festif) par le stock.
    demanderDuParc(100, [1]);

    const services = await servicesConcernes(100);
    expect(services.map((s: any) => s.name)).toEqual([
      'Service festif',
      'Service restauration',
    ]);
  });

  it('ne sollicite pas deux fois le même service', async () => {
    // Le camion benne est en « Festif », comme la chaise du stock : sans
    // dédoublonnage, le service recevrait deux approbations pour une demande.
    demanderDuParc(100, [2]);

    const services = await servicesConcernes(100);
    expect(services.map((s: any) => s.name)).toEqual(['Service festif']);
  });

  it('crée bien l’approbation qui manquait', async () => {
    demanderDuParc(400, [1]);

    const creees = await creerApprobationsManquantes(400, 1);
    expect(creees.map((a: any) => a.service.name)).toEqual(['Service restauration']);
  });
});
