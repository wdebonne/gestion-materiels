import type BetterSqlite3 from 'better-sqlite3';

/**
 * Fin de vie d'un compte.
 *
 * `DELETE /users/:id` effaçait la ligne, et chaque clé étrangère en
 * `ON DELETE SET NULL` vidait au passage l'auteur des décisions, des messages et
 * de l'historique. Une manifestation perdait la trace de qui l'avait validée le
 * jour où la personne quittait la collectivité — précisément ce qu'un litige
 * exige de retrouver, des mois plus tard.
 *
 * Ces tests protègent la propriété qui compte : **anonymiser ne rompt aucun
 * lien**. « Qui a validé ? » garde une réponse — un compte, distinct des autres
 * — sans que cette réponse nomme quelqu'un.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseComptes = sqlite;

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

import { anonymiser, desactiver, estDernierAdmin, tracesDe } from '../src/services/comptes.service';

const base: BetterSqlite3.Database = (global as any).__baseComptes;

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email VARCHAR(255) UNIQUE, password VARCHAR(255),
    first_name VARCHAR(255), last_name VARCHAR(255), role VARCHAR(50),
    avatar VARCHAR(500), is_active INTEGER DEFAULT 1, anonymized_at DATETIME,
    updated_at DATETIME
  );
  CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255));
  CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255), created_by INTEGER);
  CREATE TABLE manifestation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, user_id INTEGER,
    action VARCHAR(100), created_at DATETIME
  );
  CREATE TABLE manifestation_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, service_id INTEGER,
    user_id INTEGER, decided_by INTEGER, status VARCHAR(20)
  );
  CREATE TABLE manifestation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, user_id INTEGER, body TEXT
  );
  CREATE TABLE manifestation_watchers (id INTEGER PRIMARY KEY AUTOINCREMENT, manifestation_id INTEGER, user_id INTEGER);
  CREATE TABLE service_members (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER);
  CREATE TABLE service_delegations (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, delegate_user_id INTEGER);
  CREATE TABLE user_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, category_id INTEGER);
  CREATE TABLE user_module_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, module_name VARCHAR(100));
  CREATE TABLE notification_preferences (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event VARCHAR(50));
`;

const JEU = `
  INSERT INTO users (id, email, password, first_name, last_name, role, avatar) VALUES
    (1, 'admin@ville.fr', 'x', 'Alice', 'Admin', 'admin', NULL),
    (2, 'admin2@ville.fr', 'x', 'Bob', 'Admin', 'admin', NULL),
    (3, 'martin@ville.fr', 'motdepasse', 'Martin', 'Dubois', 'supervisor', '/avatars/martin.jpg'),
    (4, 'neuf@ville.fr', 'x', 'Neuf', 'Venu', 'agent', NULL);

  INSERT INTO services (id, name) VALUES (1, 'Service festif');
  INSERT INTO manifestations (id, title, created_by) VALUES (100, 'Brocante', 3);
  INSERT INTO manifestation_history (manifestation_id, user_id, action) VALUES (100, 3, 'Validation');
  INSERT INTO manifestation_approvals (manifestation_id, service_id, decided_by, status) VALUES (100, 1, 3, 'approved');
  INSERT INTO manifestation_messages (manifestation_id, user_id, body) VALUES (100, 3, 'Livraison a 8h');
  INSERT INTO service_members (service_id, user_id, is_manager) VALUES (1, 3, 1);
  INSERT INTO service_delegations (service_id, delegate_user_id) VALUES (1, 3);
  INSERT INTO user_permissions (user_id, category_id) VALUES (3, 1);
  INSERT INTO notification_preferences (user_id, event) VALUES (3, 'message');
  INSERT INTO manifestation_watchers (manifestation_id, user_id) VALUES (100, 3);
`;

/** Tables du jeu d'essai, à vider entre deux cas. */
const TABLES = [
  'users', 'services', 'manifestations', 'manifestation_history', 'manifestation_approvals',
  'manifestation_messages', 'manifestation_watchers', 'service_members', 'service_delegations',
  'user_permissions', 'user_module_permissions', 'notification_preferences',
];

beforeAll(() => base.exec(SCHEMA));

beforeEach(() => {
  // L'anonymisation modifie les comptes en place : chaque cas repart du même
  // jeu, sinon le second lirait ce que le premier a effacé.
  for (const table of TABLES) base.exec(`DELETE FROM ${table}`);
  base.exec(JEU);
});

describe('Ce qu’un compte laisse derrière lui', () => {
  it('recense tout ce qui le rattache aux manifestations', async () => {
    const traces = await tracesDe(3);

    expect(traces).toMatchObject({
      manifestations_creees: 1,
      historique: 1,
      decisions: 1,
      messages: 1,
      services: 1,
    });
    expect(traces.total).toBe(5);
  });

  it('ne trouve rien pour un compte qui n’a rien fait', async () => {
    // C'est le seul cas où supprimer ne détruit aucune trace.
    expect((await tracesDe(4)).total).toBe(0);
  });

  it('compte aussi une sollicitation nominative', async () => {
    base.prepare('INSERT INTO manifestation_approvals (manifestation_id, user_id) VALUES (100, 4)').run();
    expect((await tracesDe(4)).decisions).toBe(1);
  });
});

describe('Dernier administrateur', () => {
  it('reconnaît qu’il en reste un autre', async () => {
    expect(await estDernierAdmin(1)).toBe(false);
  });

  it('reconnaît le dernier, une fois l’autre désactivé', async () => {
    // Le retirer fermerait la porte de la configuration à tout le monde.
    await desactiver(2);
    expect(await estDernierAdmin(1)).toBe(true);
  });

  it('ne s’applique pas à un compte non administrateur', async () => {
    expect(await estDernierAdmin(3)).toBe(false);
  });
});

describe('Désactivation', () => {
  it('ferme la connexion sans rien toucher d’autre', async () => {
    await desactiver(3);

    const compte = base.prepare('SELECT * FROM users WHERE id = 3').get() as any;
    expect(compte.is_active).toBe(0);
    expect(compte.first_name).toBe('Martin');
    expect(compte.anonymized_at).toBeNull();
    expect((await tracesDe(3)).total).toBe(5);
  });
});

describe('Anonymisation', () => {
  it('remplace l’identité et garde tous les liens', async () => {
    const resultat = await anonymiser(3, 1);
    expect(resultat.ok).toBe(true);

    const compte = base.prepare('SELECT * FROM users WHERE id = 3').get() as any;
    expect(compte.first_name).toBe('Compte');
    expect(compte.last_name).toBe('anonymisé #3');
    expect(compte.email).toBe('anonyme-3@anonymise.local');
    expect(compte.avatar).toBeNull();
    expect(compte.is_active).toBe(0);
    expect(compte.anonymized_at).not.toBeNull();

    // C'est tout l'enjeu : la manifestation garde qui l'a validée.
    const decision = base.prepare('SELECT decided_by FROM manifestation_approvals WHERE manifestation_id = 100').get();
    expect(decision).toEqual({ decided_by: 3 });
    expect(base.prepare('SELECT user_id FROM manifestation_history WHERE manifestation_id = 100').get())
      .toEqual({ user_id: 3 });
    expect(base.prepare('SELECT user_id FROM manifestation_messages WHERE manifestation_id = 100').get())
      .toEqual({ user_id: 3 });
    expect(base.prepare('SELECT created_by FROM manifestations WHERE id = 100').get())
      .toEqual({ created_by: 3 });
  });

  it('rend le compte inutilisable pour se reconnecter', async () => {
    // Laisser l'ancien mot de passe permettrait d'entrer sous une identité
    // effacée.
    const avant = (base.prepare('SELECT password FROM users WHERE id = 3').get() as any).password;
    await anonymiser(3, 1);
    const apres = (base.prepare('SELECT password FROM users WHERE id = 3').get() as any).password;

    expect(apres).not.toBe(avant);
    expect(apres).not.toBe('motdepasse');
  });

  it('retire ce qui suppose une personne présente', async () => {
    // Une délégation laissée derrière soi donnerait un pouvoir de décision à un
    // compte fermé.
    await anonymiser(3, 1);

    for (const table of [
      'service_members',
      'user_permissions',
      'notification_preferences',
      'manifestation_watchers',
    ]) {
      expect(base.prepare(`SELECT COUNT(*) c FROM ${table} WHERE user_id = 3`).get()).toEqual({ c: 0 });
    }
    expect(base.prepare('SELECT COUNT(*) c FROM service_delegations WHERE delegate_user_id = 3').get())
      .toEqual({ c: 0 });
  });

  it('distingue deux comptes anonymisés', async () => {
    // Un simple « inconnu » les confondrait, et on ne saurait plus si c'est la
    // même personne qui a validé et livré.
    await anonymiser(3, 1);
    await anonymiser(4, 1);

    const noms = base.prepare('SELECT last_name FROM users WHERE id IN (3, 4) ORDER BY id').all();
    expect(noms).toEqual([{ last_name: 'anonymisé #3' }, { last_name: 'anonymisé #4' }]);
  });

  it('refuse de recommencer sur un compte déjà anonymisé', async () => {
    await anonymiser(3, 1);
    expect(await anonymiser(3, 1)).toEqual({ ok: false, message: 'Ce compte est déjà anonymisé' });
  });

  it('refuse qu’on s’anonymise soi-même', async () => {
    const resultat = await anonymiser(1, 1);
    expect(resultat.ok).toBe(false);
    expect(resultat.message).toMatch(/vous-même/);
  });

  it('refuse le dernier administrateur actif', async () => {
    await desactiver(2);
    const resultat = await anonymiser(1, 3);

    expect(resultat.ok).toBe(false);
    expect(resultat.message).toMatch(/dernier administrateur/);
  });

  it('refuse un compte introuvable', async () => {
    expect(await anonymiser(999, 1)).toEqual({ ok: false, message: 'Compte introuvable' });
  });
});
