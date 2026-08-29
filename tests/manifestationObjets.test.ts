import type BetterSqlite3 from 'better-sqlite3';

/**
 * Matériel unique rattaché à une manifestation.
 *
 * Une manifestation ne savait demander que des quantités : « 50 tables ». Un
 * véhicule n'est pas une quantité — il ne peut pas être à deux endroits le même
 * jour, et son histoire (entretiens, pleins, contrôles) est déjà tenue dans le
 * parc. La table `manifestation_items` existait depuis l'origine pour faire ce
 * lien et n'a jamais été ni lue ni écrite.
 *
 * La différence protégée ici : deux manifestations peuvent se partager cent
 * chaises sur cinquante chacune ; elles ne peuvent pas se partager le camion.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseObjets = sqlite;

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
  ETATS_RETOUR,
  indisponibilites,
  objetsDe,
  parcAvecDisponibilite,
  remplacerObjets,
  STATUTS_IMMOBILISANTS,
} from '../src/services/manifestationObjets.service';
import type { AuthRequest } from '../src/middleware/auth.middleware';

const base: BetterSqlite3.Database = (global as any).__baseObjets;

const requete = (userId: number, role: string): AuthRequest =>
  ({ user: { userId, email: `u${userId}@ville.fr`, role } } as AuthRequest);

beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE group_permissions (role VARCHAR(50), category_id INTEGER, can_view INTEGER);
    CREATE TABLE user_permissions (user_id INTEGER, category_id INTEGER, can_view INTEGER);
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      serial_number VARCHAR(100), status VARCHAR(50),
      category_id INTEGER, subcategory_id INTEGER
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20),
      date_start DATE, date_end DATE, delivery_date DATE, recovery_date DATE
    );
    CREATE TABLE manifestation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, object_id INTEGER,
      quantity INTEGER DEFAULT 1, quantity_delivered INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0, return_state VARCHAR(20), notes TEXT,
      created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, object_id INTEGER, status VARCHAR(20),
      start_date DATETIME, end_date DATETIME, reason TEXT
    );
  `);

  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Véhicules'), (2, 'Informatique');
    INSERT INTO objects (id, name, reference, category_id) VALUES
      (1, 'Camion benne', 'VH-01', 1),
      (2, 'Vidéoprojecteur', 'IT-07', 2),
      (3, 'Remorque', 'VH-02', 1);

    INSERT INTO manifestations (id, title, status, date_start, date_end, delivery_date, recovery_date) VALUES
      (100, 'Brocante', 'validated', '2026-07-14', '2026-07-14', '2026-07-13', '2026-07-15'),
      (200, 'Fête de la musique', 'draft', '2026-07-14', '2026-07-14', NULL, NULL),
      (300, 'Marché de Noël', 'validated', '2026-12-10', '2026-12-10', NULL, NULL),
      (400, 'Annulée', 'cancelled', '2026-07-14', '2026-07-14', NULL, NULL);

    -- Le rôle « agent » ne voit que les véhicules.
    INSERT INTO group_permissions (role, category_id, can_view) VALUES ('agent', 1, 1);
  `);
});

afterEach(() => {
  base.exec('DELETE FROM manifestation_items; DELETE FROM reservations;');
});

describe('Cohérence du modèle', () => {
  it('un statut annulé ou archivé n’immobilise rien', () => {
    expect(STATUTS_IMMOBILISANTS).not.toContain('cancelled');
    expect(STATUTS_IMMOBILISANTS).not.toContain('archived');
    expect(STATUTS_IMMOBILISANTS).not.toContain('recovered');
  });

  it('les trois états de retour couvrent ce qu’on constate vraiment', () => {
    expect(ETATS_RETOUR).toEqual(['intact', 'abime', 'perdu']);
  });
});

describe('Conflits sur le matériel unique', () => {
  it('signale un matériel déjà retenu par une autre manifestation', async () => {
    // C'est toute la différence avec le stock : on ne partage pas un camion.
    await remplacerObjets(100, [{ object_id: 1 }]);

    const conflits = await indisponibilites([1], '2026-07-14', '2026-07-14');
    expect(conflits).toHaveLength(1);
    expect(conflits[0]).toMatchObject({
      object_id: 1,
      object_name: 'Camion benne',
      origine: 'manifestation',
      detail: 'Brocante',
    });
  });

  it('couvre toute la fenêtre, de la livraison à la récupération', async () => {
    // Le camion part la veille et revient le lendemain : il est pris les trois
    // jours, pas seulement celui de la manifestation.
    await remplacerObjets(100, [{ object_id: 1 }]);

    for (const jour of ['2026-07-13', '2026-07-14', '2026-07-15']) {
      expect(await indisponibilites([1], jour, jour)).toHaveLength(1);
    }
    expect(await indisponibilites([1], '2026-07-12', '2026-07-12')).toEqual([]);
  });

  it('ignore une manifestation annulée', async () => {
    await remplacerObjets(400, [{ object_id: 1 }]);
    expect(await indisponibilites([1], '2026-07-14', '2026-07-14')).toEqual([]);
  });

  it('n’oppose pas une manifestation à elle-même', async () => {
    // Sans l'exclusion, modifier une manifestation la mettrait en conflit avec
    // sa propre demande.
    await remplacerObjets(100, [{ object_id: 1 }]);
    expect(await indisponibilites([1], '2026-07-14', '2026-07-14', 100)).toEqual([]);
  });

  it('voit aussi les réservations, qui engagent le même parc', async () => {
    // Les deux circuits ne se connaissent pas : sans cette lecture, ils
    // promettraient le même camion chacun de son côté.
    base
      .prepare(
        "INSERT INTO reservations (object_id, status, start_date, end_date, reason) VALUES (1, 'reserved', '2026-07-14', '2026-07-16', 'Déménagement école')"
      )
      .run();

    const conflits = await indisponibilites([1], '2026-07-15', '2026-07-15');
    expect(conflits).toHaveLength(1);
    expect(conflits[0]).toMatchObject({ origine: 'reservation', detail: 'Déménagement école' });
  });

  it('ignore une réservation seulement demandée', async () => {
    // `pending` ne bloque pas : c'est une demande que personne n'a acceptée.
    base
      .prepare(
        "INSERT INTO reservations (object_id, status, start_date, end_date) VALUES (1, 'pending', '2026-07-14', '2026-07-16')"
      )
      .run();
    expect(await indisponibilites([1], '2026-07-15', '2026-07-15')).toEqual([]);
  });

  it('ne signale rien sur une période libre', async () => {
    await remplacerObjets(300, [{ object_id: 1 }]);
    expect(await indisponibilites([1], '2026-07-14', '2026-07-14')).toEqual([]);
  });
});

describe('Composition de la liste', () => {
  it('enregistre un matériel une seule fois', async () => {
    // Un matériel unique demandé deux fois n'a pas de sens, et se compterait
    // deux fois dans les conflits.
    await remplacerObjets(100, [{ object_id: 1 }, { object_id: 1 }, { object_id: 2 }]);

    const lignes = await objetsDe(100);
    expect(lignes.map((l: any) => l.object_id).sort()).toEqual([1, 2]);
  });

  it('conserve le constat de retour d’un matériel qui reste demandé', async () => {
    // L'effacer parce que le formulaire ne le renvoie pas perdrait le constat
    // fait au retour, qui est précisément ce qu'on veut garder.
    await remplacerObjets(100, [{ object_id: 1 }]);
    base
      .prepare(
        "UPDATE manifestation_items SET quantity_delivered = 1, quantity_returned = 1, return_state = 'abime' WHERE object_id = 1"
      )
      .run();

    await remplacerObjets(100, [{ object_id: 1 }, { object_id: 2 }]);

    const [camion] = (await objetsDe(100)).filter((l: any) => l.object_id === 1);
    expect(camion).toMatchObject({ quantity_delivered: 1, quantity_returned: 1, return_state: 'abime' });
  });

  it('vide la liste quand plus rien n’est demandé', async () => {
    await remplacerObjets(100, [{ object_id: 1 }]);
    await remplacerObjets(100, []);
    expect(await objetsDe(100)).toEqual([]);
  });

  it('écarte une ligne sans identifiant', async () => {
    await remplacerObjets(100, [{ object_id: 0 as any }, { object_id: 1 }]);
    expect((await objetsDe(100)).map((l: any) => l.object_id)).toEqual([1]);
  });
});

describe('Parc proposé au choix', () => {
  it('montre les matériels pris, en disant ce qui les retient', async () => {
    // Masquer le camion priverait l'agent de l'information utile : savoir qui
    // l'a, et pouvoir demander un décalage.
    await remplacerObjets(100, [{ object_id: 1 }]);

    const parc = await parcAvecDisponibilite(requete(1, 'admin'), undefined, '2026-07-14', '2026-07-14');
    const camion = parc!.find((o: any) => o.id === 1);

    expect(camion.disponible).toBe(false);
    expect(camion.indisponibilites[0].detail).toBe('Brocante');
    expect(parc!.find((o: any) => o.id === 3).disponible).toBe(true);
  });

  it('applique la portée par catégorie, sans la laisser à l’appelant', async () => {
    // Une recherche libre sur tout le parc est exactement la fuite fermée sur
    // `GET /green-spaces/search/objects`.
    const parc = await parcAvecDisponibilite(requete(5, 'agent'), undefined, '2026-07-14', '2026-07-14');

    expect(parc!.map((o: any) => o.id).sort()).toEqual([1, 3]);
    expect(parc!.map((o: any) => o.name)).not.toContain('Vidéoprojecteur');
  });

  it('refuse un compte sans aucune catégorie accessible', async () => {
    expect(await parcAvecDisponibilite(requete(42, 'user'), undefined, '2026-07-14', '2026-07-14')).toBeNull();
  });

  it('cherche sur le nom, la référence et le numéro de série', async () => {
    const parRef = await parcAvecDisponibilite(requete(1, 'admin'), 'VH-01', '2026-07-14', '2026-07-14');
    expect(parRef!.map((o: any) => o.name)).toEqual(['Camion benne']);

    const parNom = await parcAvecDisponibilite(requete(1, 'admin'), 'projecteur', '2026-07-14', '2026-07-14');
    expect(parNom!.map((o: any) => o.name)).toEqual(['Vidéoprojecteur']);
  });
});
