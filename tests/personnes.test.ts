import Database from 'better-sqlite3';
import request from 'supertest';
import express from 'express';
import { appliquerMigrations, type BaseMigration } from '../src/database/migrationRunner';
import personnesSansCompte from '../src/database/migrations/028_personnes_sans_compte';

/**
 * Des personnes à l'annuaire, même sans compte.
 *
 * `users` n'acceptait que des gens qui se connectent : adresse et mot de passe
 * obligatoires. Inscrire le gardien à qui on remet un trousseau — et qui
 * n'ouvrira jamais l'application — obligeait donc à lui inventer les deux, ou à
 * le laisser tomber dans « un externe », c'est-à-dire dans du texte libre où
 * « A. Marie », « Marie André » et « André MARIE » deviennent trois personnes
 * qu'aucune requête ne rapproche.
 *
 * Ces tests protègent les deux moitiés de la réponse : la reconstruction de la
 * table, qui ne doit perdre ni une ligne ni une clé étrangère, et la règle qui
 * en découle — `can_login` décide seul de l'accès, et le passage d'une forme à
 * l'autre ne recopie personne.
 */

// ===================== 1. La table =====================

function baseEnMemoire(): BaseMigration & { sql: Database.Database; fermer(): void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return {
    sql: sqlite,
    getType: () => 'sqlite',
    async execute(requete: string, params: any[] = []) {
      const r = sqlite.prepare(requete).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
    },
    async query<T = any>(requete: string, params: any[] = []) {
      const stmt = sqlite.prepare(requete);
      if (stmt.reader) return stmt.all(...params) as T[];
      stmt.run(...params);
      return [] as T[];
    },
    fermer: () => sqlite.close(),
  };
}

/** `users` telle que la posait `createTables()` avant cette migration. */
const USERS_AVANT = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now')),
    token_version INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cle_attributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL,
    holder_user_id INTEGER,
    FOREIGN KEY (holder_user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`;

describe('Migration 028 — reconstruire users sans rien perdre', () => {
  let base: ReturnType<typeof baseEnMemoire>;

  beforeEach(async () => {
    base = baseEnMemoire();
    base.sql.exec(USERS_AVANT);
    base.sql
      .prepare('INSERT INTO users (id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)')
      .run(1, 'admin@ville.fr', 'empreinte', 'Ada', 'Martin', 'admin');
    base.sql
      .prepare('INSERT INTO users (id, email, password, first_name, last_name, role) VALUES (?,?,?,?,?,?)')
      .run(7, 'agent@ville.fr', 'empreinte', 'Luc', 'Jardin', 'agent');
    base.sql.prepare('INSERT INTO cle_attributions (object_id, holder_user_id) VALUES (?, ?)').run(42, 7);

    await appliquerMigrations(base, { migrations: [personnesSansCompte], journaliser: () => {} });
  });

  afterEach(() => base.fermer());

  it('garde tous les comptes, leurs identifiants et leurs colonnes', () => {
    const comptes = base.sql.prepare('SELECT id, email, role, token_version FROM users ORDER BY id').all();
    expect(comptes).toEqual([
      { id: 1, email: 'admin@ville.fr', role: 'admin', token_version: 0 },
      { id: 7, email: 'agent@ville.fr', role: 'agent', token_version: 0 },
    ]);
  });

  it('ouvre la connexion à tout le monde : personne n’est mis dehors par la mise à jour', () => {
    const fermes = base.sql.prepare('SELECT COUNT(*) AS cnt FROM users WHERE can_login = 0').get() as any;
    expect(fermes.cnt).toBe(0);
  });

  it('accepte plusieurs personnes sans adresse ni mot de passe', () => {
    const inserer = base.sql.prepare(
      'INSERT INTO users (first_name, last_name, role, can_login) VALUES (?, ?, ?, 0)'
    );
    inserer.run('Marie', 'André', 'user');
    inserer.run('Paul', 'Durand', 'user');

    const fiches = base.sql
      .prepare('SELECT first_name, email, password FROM users WHERE can_login = 0 ORDER BY first_name')
      .all();
    expect(fiches).toEqual([
      { first_name: 'Marie', email: null, password: null },
      { first_name: 'Paul', email: null, password: null },
    ]);
  });

  it('refuse toujours deux fois la même adresse', () => {
    expect(() =>
      base.sql
        .prepare('INSERT INTO users (email, password) VALUES (?, ?)')
        .run('admin@ville.fr', 'x')
    ).toThrow(/UNIQUE/i);
  });

  it('laisse les clés étrangères vers users en place', () => {
    // La détention posée avant la reconstruction vise toujours le bon compte…
    const detention = base.sql.prepare('SELECT holder_user_id FROM cle_attributions').get() as any;
    expect(detention.holder_user_id).toBe(7);

    // …et une détention vers un compte inexistant reste refusée.
    expect(() =>
      base.sql.prepare('INSERT INTO cle_attributions (object_id, holder_user_id) VALUES (?, ?)').run(1, 999)
    ).toThrow(/FOREIGN KEY/i);
  });

  it('rebranche les clés étrangères après coup', () => {
    expect(base.sql.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('garde le compteur d’auto-incrément : un identifiant supprimé n’est pas réattribué', () => {
    // Le plus grand identifiant recopié est 7 ; le suivant doit être 8, et non
    // une reprise d'un numéro libéré par une suppression passée.
    const { lastInsertRowid } = base.sql
      .prepare("INSERT INTO users (first_name, can_login) VALUES ('Nouvelle', 0)")
      .run();
    expect(Number(lastInsertRowid)).toBe(8);
  });

  it('reprend une reconstruction interrompue entre le DROP et le RENAME', async () => {
    // La panne se simule en remettant la base dans l'état exact de cette
    // fenêtre de deux instructions : `users` a disparu, la table de travail
    // porte les comptes. Sans reprise, la migration relancée conclurait qu'il
    // n'y a rien à faire — et s'inscrirait comme appliquée sur une base amputée.
    base.sql.exec('ALTER TABLE users RENAME TO users_028');
    base.sql.prepare('DELETE FROM schema_migrations').run();

    await appliquerMigrations(base, { migrations: [personnesSansCompte], journaliser: () => {} });

    const comptes = base.sql.prepare('SELECT id FROM users ORDER BY id').all();
    expect(comptes).toEqual([{ id: 1 }, { id: 7 }]);
    const restes = base.sql
      .prepare("SELECT name FROM sqlite_master WHERE name = 'users_028'")
      .all();
    expect(restes).toEqual([]);
  });

  it('ne reconstruit pas deux fois : rejouée, elle laisse la table telle quelle', async () => {
    const avant = base.sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get() as any;

    // Journal perdu : la migration est proposée de nouveau.
    base.sql.prepare('DELETE FROM schema_migrations').run();
    await appliquerMigrations(base, { migrations: [personnesSansCompte], journaliser: () => {} });

    const apres = base.sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get() as any;
    expect(apres.sql).toBe(avant.sql);
    expect((base.sql.prepare('SELECT COUNT(*) AS cnt FROM users').get() as any).cnt).toBe(2);
  });
});

// ===================== 2. La règle =====================

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__basePersonnes = sqlite;

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

jest.mock('../src/services/webhook.service', () => ({ notifierWebhooks: jest.fn() }));
jest.mock('../src/services/log.service', () => ({
  logService: { info: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

/**
 * Qui est au clavier — l'identité seule est simulée, les gardes de rôle sont
 * les vrais : `requireAdmin` et `requireSupervisor` refusent ici comme ils
 * refuseraient en production, ce qui fait de la frontière entre le
 * superviseur et l'administrateur une chose réellement éprouvée.
 */
jest.mock('../src/middleware/auth.middleware', () => {
  const courant = () => (global as any).__connecte;
  const exige =
    (...roles: string[]) =>
    (_req: any, res: any, next: any) =>
      roles.includes(courant().role)
        ? next()
        : res.status(403).json({ success: false, message: 'Accès refusé' });

  return {
    authenticateToken: (req: any, _res: any, next: any) => {
      req.user = courant();
      next();
    },
    requireAdmin: exige('admin'),
    requireSupervisor: exige('admin', 'supervisor'),
    requireFieldWrite: exige('admin', 'supervisor', 'agent'),
  };
});

const ADMIN = { userId: 1, email: 'admin@ville.fr', role: 'admin' };
const SUPERVISEUR = { userId: 8, email: 'chef@ville.fr', role: 'supervisor' };

/** Change qui est au clavier pour les requêtes qui suivent. */
function connecte(qui: typeof ADMIN): void {
  (global as any).__connecte = qui;
}

describe('Annuaire — créer, désigner, promouvoir', () => {
  let app: express.Express;
  let baseRoutes: Database.Database;

  // Le router est monté une fois : c'est son `require` qui déclenche la fausse
  // base, et donc qui la rend lisible ici.
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', require('../src/routes/user.routes').default);
    baseRoutes = (global as any).__basePersonnes;
  });

  beforeEach(() => {
    connecte(ADMIN);
    baseRoutes.exec(`
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS user_permissions;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(50) DEFAULT 'user',
        avatar VARCHAR(500),
        is_active INTEGER DEFAULT 1,
        can_login INTEGER NOT NULL DEFAULT 1,
        anonymized_at DATETIME,
        password_changed_at DATETIME,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        token_version INTEGER NOT NULL DEFAULT 0,
        last_login DATETIME,
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME
      );
      CREATE TABLE user_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
        category_id INTEGER, subcategory_id INTEGER,
        can_view INTEGER, can_edit INTEGER, can_delete INTEGER
      );
    `);
    baseRoutes
      .prepare(
        `INSERT INTO users (id, email, password, first_name, last_name, role, can_login)
         VALUES (1, 'admin@ville.fr', 'empreinte', 'Ada', 'Martin', 'admin', 1)`
      )
      .run();
  });

  const fiche = (nom: string) => ({ firstName: nom, lastName: 'André', canLogin: false });

  it('inscrit une personne sans adresse ni mot de passe', async () => {
    const reponse = await request(app).post('/api/users').send(fiche('Marie'));
    expect(reponse.status).toBe(201);

    const inscrite = baseRoutes
      .prepare('SELECT email, password, can_login, role FROM users WHERE first_name = ?')
      .get('Marie') as any;
    expect(inscrite).toMatchObject({ email: null, password: null, can_login: 0 });
  });

  it('refuse une personne sans nom : rien ne la désignerait dans les listes', async () => {
    const reponse = await request(app)
      .post('/api/users')
      .send({ firstName: ' ', lastName: '', canLogin: false });
    expect(reponse.status).toBe(400);
    expect(reponse.body.message).toMatch(/nom/i);
  });

  it('ramène le rôle d’une fiche à `user` : pas de promotion en attente', async () => {
    await request(app).post('/api/users').send({ ...fiche('Paul'), role: 'admin' });

    const inscrite = baseRoutes.prepare('SELECT role FROM users WHERE first_name = ?').get('Paul') as any;
    expect(inscrite.role).toBe('user');
  });

  it('exige toujours une adresse et un mot de passe pour un compte', async () => {
    const sansAdresse = await request(app)
      .post('/api/users')
      .send({ firstName: 'Luc', lastName: 'Jardin', password: 'Motdepasse1', role: 'agent' });
    expect(sansAdresse.status).toBe(400);

    const sansMotDePasse = await request(app)
      .post('/api/users')
      .send({ firstName: 'Luc', lastName: 'Jardin', email: 'luc@ville.fr', role: 'agent' });
    expect(sansMotDePasse.status).toBe(400);
  });

  it('propose les personnes sans compte dans l’annuaire, au même titre que les autres', async () => {
    await request(app).post('/api/users').send(fiche('Marie'));

    const reponse = await request(app).get('/api/users/annuaire');
    expect(reponse.status).toBe(200);
    expect(reponse.body.users.map((u: any) => u.firstName).sort()).toEqual(['Ada', 'Marie']);
  });

  it('sépare comptes et fiches quand on le demande, et seulement alors', async () => {
    await request(app).post('/api/users').send(fiche('Marie'));

    const tous = await request(app).get('/api/users');
    const comptes = await request(app).get('/api/users?canLogin=1');
    const fiches = await request(app).get('/api/users?canLogin=0');

    expect(tous.body.users).toHaveLength(2);
    expect(comptes.body.users.map((u: any) => u.firstName)).toEqual(['Ada']);
    expect(fiches.body.users.map((u: any) => u.firstName)).toEqual(['Marie']);
  });

  /**
   * Le superviseur tient l'annuaire des personnes ; l'administrateur garde les
   * accès. La frontière n'est pas « quels champs », mais « est-ce que cela ouvre
   * une porte » — c'est cela que ces tests éprouvent.
   */
  describe('Ce que le superviseur peut, et ce qu’il ne peut pas', () => {
    beforeEach(() => connecte(SUPERVISEUR));

    it('inscrit une personne sans compte', async () => {
      const reponse = await request(app).post('/api/users').send(fiche('Marie'));
      expect(reponse.status).toBe(201);
    });

    it('ne crée pas de compte, et l’écran le lui dit', async () => {
      const reponse = await request(app).post('/api/users').send({
        firstName: 'Luc',
        lastName: 'Jardin',
        email: 'luc@ville.fr',
        password: 'Motdepasse1',
        role: 'agent',
      });
      expect(reponse.status).toBe(403);
      expect(reponse.body.message).toMatch(/administrateur/i);
      expect(baseRoutes.prepare('SELECT COUNT(*) AS cnt FROM users').get()).toEqual({ cnt: 1 });
    });

    it('ne voit que les personnes sans compte, jamais les comptes', async () => {
      connecte(ADMIN);
      await request(app).post('/api/users').send(fiche('Marie'));

      connecte(SUPERVISEUR);
      const reponse = await request(app).get('/api/users');
      expect(reponse.status).toBe(200);
      expect(reponse.body.users.map((u: any) => u.firstName)).toEqual(['Marie']);
    });

    it('ne peut pas se donner un compte en demandant les seuls comptes', async () => {
      // Le filtre est une commodité d'écran, pas une ouverture : le serveur
      // ajoute sa propre condition, et les deux se cumulent.
      const reponse = await request(app).get('/api/users?canLogin=1');
      expect(reponse.status).toBe(200);
      expect(reponse.body.users).toEqual([]);
    });

    it('ne touche pas à un compte, même pour un simple nom', async () => {
      const reponse = await request(app).put('/api/users/1').send({ firstName: 'Autre' });
      expect(reponse.status).toBe(403);

      const admin = baseRoutes.prepare('SELECT first_name FROM users WHERE id = 1').get() as any;
      expect(admin.first_name).toBe('Ada');
    });

    it('ne distribue ni rôle ni mot de passe : les champs recopiés sont ignorés', async () => {
      await request(app).post('/api/users').send(fiche('Marie'));
      const id = (baseRoutes.prepare("SELECT id FROM users WHERE first_name = 'Marie'").get() as any).id;

      const reponse = await request(app)
        .put(`/api/users/${id}`)
        .send({ firstName: 'Marie', role: 'admin', password: 'Motdepasse1', canLogin: false });
      expect(reponse.status).toBe(200);

      const fichee = baseRoutes
        .prepare('SELECT role, password, can_login FROM users WHERE id = ?')
        .get(id) as any;
      expect(fichee).toEqual({ role: 'user', password: null, can_login: 0 });
    });

    it('ne supprime personne', async () => {
      await request(app).post('/api/users').send(fiche('Marie'));
      const id = (baseRoutes.prepare("SELECT id FROM users WHERE first_name = 'Marie'").get() as any).id;

      const reponse = await request(app).delete(`/api/users/${id}`);
      expect(reponse.status).toBe(403);
      expect(baseRoutes.prepare('SELECT COUNT(*) AS cnt FROM users').get()).toEqual({ cnt: 2 });
    });
  });

  describe('Passer d’une forme à l’autre', () => {
    let idMarie: number;

    beforeEach(async () => {
      await request(app).post('/api/users').send(fiche('Marie'));
      idMarie = (baseRoutes.prepare("SELECT id FROM users WHERE first_name = 'Marie'").get() as any).id;
    });

    it('refuse d’ouvrir la connexion sans adresse', async () => {
      const reponse = await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ canLogin: true, password: 'Motdepasse1' });
      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/adresse/i);
    });

    it('refuse d’ouvrir la connexion sans mot de passe', async () => {
      const reponse = await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ canLogin: true, email: 'marie@ville.fr' });
      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/mot de passe/i);
    });

    it('promeut sans changer d’identifiant : ce qu’elle détient la suit', async () => {
      const reponse = await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ canLogin: true, email: 'marie@ville.fr', password: 'Motdepasse1', role: 'agent' });
      expect(reponse.status).toBe(200);

      const promue = baseRoutes
        .prepare('SELECT id, email, can_login, role, password FROM users WHERE first_name = ?')
        .get('Marie') as any;
      expect(promue.id).toBe(idMarie);
      expect(promue).toMatchObject({ email: 'marie@ville.fr', can_login: 1, role: 'agent' });
      expect(promue.password).toEqual(expect.stringMatching(/^\$2[aby]\$/));
    });

    it('retire la connexion en périmant les jetons en cours', async () => {
      await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ canLogin: true, email: 'marie@ville.fr', password: 'Motdepasse1' });
      const avant = baseRoutes
        .prepare('SELECT token_version FROM users WHERE id = ?')
        .get(idMarie) as any;

      const reponse = await request(app).put(`/api/users/${idMarie}`).send({ canLogin: false });
      expect(reponse.status).toBe(200);

      const apres = baseRoutes
        .prepare('SELECT can_login, token_version, password FROM users WHERE id = ?')
        .get(idMarie) as any;
      expect(apres.can_login).toBe(0);
      expect(apres.token_version).toBe(avant.token_version + 1);
      // Le mot de passe reste : un retrait corrigé dans la minute n'oblige pas
      // à en redistribuer un.
      expect(apres.password).not.toBeNull();
    });

    it('refuse à l’administrateur de retirer son propre accès', async () => {
      // Le compte connecté est le n° 1 : c'est lui qu'on essaie de fermer.
      const reponse = await request(app).put('/api/users/1').send({ canLogin: false });
      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/votre propre accès/i);

      const admin = baseRoutes.prepare('SELECT can_login FROM users WHERE id = 1').get() as any;
      expect(admin.can_login).toBe(1);
    });

    it('laisse le superviseur corriger un nom, sans lui ouvrir la connexion', async () => {
      connecte(SUPERVISEUR);

      const correction = await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ firstName: 'Marie', lastName: 'André-Dupont', role: 'user', canLogin: false });
      expect(correction.status).toBe(200);

      const promotion = await request(app)
        .put(`/api/users/${idMarie}`)
        .send({ canLogin: true, email: 'marie@ville.fr', password: 'Motdepasse1' });
      expect(promotion.status).toBe(403);

      const fiche = baseRoutes
        .prepare('SELECT last_name, can_login, email FROM users WHERE id = ?')
        .get(idMarie) as any;
      expect(fiche).toMatchObject({ last_name: 'André-Dupont', can_login: 0, email: null });
    });

    it('refuse de fermer la porte au dernier administrateur', async () => {
      // Le compte connecté est mis de côté pour que le second soit le dernier
      // administrateur actif : c'est lui que la garde doit protéger.
      baseRoutes.prepare('UPDATE users SET is_active = 0 WHERE id = 1').run();
      baseRoutes
        .prepare(
          `INSERT INTO users (id, email, password, first_name, role, can_login)
           VALUES (50, 'seul@ville.fr', 'empreinte', 'Seul', 'admin', 1)`
        )
        .run();

      const reponse = await request(app).put('/api/users/50').send({ canLogin: false });
      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/dernier administrateur/i);

      const admin = baseRoutes.prepare('SELECT can_login FROM users WHERE id = 50').get() as any;
      expect(admin.can_login).toBe(1);
    });
  });
});
