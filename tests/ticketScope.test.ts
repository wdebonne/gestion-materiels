import type BetterSqlite3 from 'better-sqlite3';

/**
 * Qui voit quel ticket.
 *
 * Un fragment de portée est du SQL : tant qu'on ne l'a pas exécuté contre une
 * vraie base, on ne sait pas s'il filtre ou s'il laisse tout passer. Ces tests
 * montent donc un jeu complet — deux services, deux bâtiments, six personnes,
 * huit tickets — et interrogent la table.
 *
 * Deux exigences y sont figées, et ce sont celles qui coûteraient le plus cher
 * si elles se relâchaient un jour :
 *
 *   « le service technique n'a pas à voir les tickets informatiques, et
 *     inversement » — le cloisonnement par équipe ;
 *
 *   « pour le bâtiment c'est bien de savoir que M. Dupont a déjà fait un ticket
 *     pour le rideau cassé » — le voisinage, mais **seulement** sur les
 *     catégories qu'on a déclarées partageables, et **en lecture partielle**.
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
  accesTicket,
  contexteTickets,
  fragmentPortee,
  materielsVisibles,
  porteeTickets,
} from '../src/middleware/ticketScope';

const base: BetterSqlite3.Database = (global as any).__basePortee;

/** Identifiants, nommés pour que les attentes se lisent. */
const ADMIN = 1;
const CHEF_INFO = 2; // responsable du service informatique
const AGENT_INFO = 3; // encadré par CHEF_INFO
const CHEF_TECH = 4; // responsable du service technique
const SECRETAIRE = 5; // à la mairie, autorisée à voir les demandes du bâtiment
const GARDIEN = 6; // à la salle des fêtes, sans droit de voisinage

const SERVICE_INFO = 1;
const SERVICE_TECH = 2;

const MAIRIE = 1;
const SALLE = 2;

/** Une requête factice, telle que `authenticateToken` la laisse. */
const commeSi = (userId: number, role: string) => ({ user: { userId, role } }) as any;

beforeAll(() => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
      role VARCHAR(50), is_active INTEGER DEFAULT 1, can_login INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100));
    CREATE TABLE service_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0
    );
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), is_active INTEGER DEFAULT 1);
    CREATE TABLE user_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, site_id INTEGER,
      peut_voir_tickets INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE planning_superviseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id INTEGER, superviseur_id INTEGER, intitule VARCHAR(160)
    );
    CREATE TABLE module_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, module_name VARCHAR(100), role VARCHAR(50), can_view INTEGER DEFAULT 0
    );
    CREATE TABLE user_module_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, module_name VARCHAR(100), can_view INTEGER DEFAULT 0
    );
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255), category_id INTEGER, subcategory_id INTEGER
    );
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, category_id INTEGER,
      subcategory_id INTEGER, can_view INTEGER DEFAULT 0, can_edit INTEGER DEFAULT 0, can_delete INTEGER DEFAULT 0
    );
    CREATE TABLE group_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role VARCHAR(50), category_id INTEGER,
      can_view INTEGER DEFAULT 0, can_edit INTEGER DEFAULT 0, can_delete INTEGER DEFAULT 0
    );
    CREATE TABLE ticket_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, user_id INTEGER, service_id INTEGER
    );
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY, titre VARCHAR(255),
      demandeur_id INTEGER, created_by INTEGER, technicien_id INTEGER, service_id INTEGER,
      site_id INTEGER, visibilite_site INTEGER NOT NULL DEFAULT 0, object_id INTEGER,
      statut_id INTEGER DEFAULT 1
    );
  `);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${CHEF_INFO}, 'info@ville.fr', 'Ines', 'Info', 'supervisor'),
      (${AGENT_INFO}, 'agent@ville.fr', 'Ali', 'Agent', 'agent'),
      (${CHEF_TECH}, 'tech@ville.fr', 'Tom', 'Tech', 'supervisor'),
      (${SECRETAIRE}, 'secr@ville.fr', 'Sam', 'Secret', 'user'),
      (${GARDIEN}, 'gard@ville.fr', 'Gil', 'Gardien', 'user');

    INSERT INTO services (id, name, slug) VALUES
      (${SERVICE_INFO}, 'Informatique', 'informatique'),
      (${SERVICE_TECH}, 'Technique', 'technique');

    INSERT INTO service_members (service_id, user_id, is_manager) VALUES
      (${SERVICE_INFO}, ${CHEF_INFO}, 1),
      (${SERVICE_INFO}, ${AGENT_INFO}, 0),
      (${SERVICE_TECH}, ${CHEF_TECH}, 1);

    INSERT INTO cle_sites (id, name) VALUES (${MAIRIE}, 'Mairie'), (${SALLE}, 'Salle des fêtes');

    -- La secrétaire lit les demandes de la mairie ; le gardien est rattaché à la
    -- salle des fêtes sans ce droit : être affecté ne donne pas de droit.
    INSERT INTO user_sites (user_id, site_id, peut_voir_tickets) VALUES
      (${SECRETAIRE}, ${MAIRIE}, 1),
      (${GARDIEN}, ${SALLE}, 0);

    INSERT INTO planning_superviseurs (agent_id, superviseur_id, intitule) VALUES
      (${AGENT_INFO}, ${CHEF_INFO}, 'Responsable du service');

    INSERT INTO categories (id, name) VALUES (1, 'Informatique'), (2, 'Outillage');
    INSERT INTO objects (id, name, category_id) VALUES
      (10, 'Nemo', 2), (11, 'Portable de la secrétaire', 1);

    -- Huit tickets. La colonne visibilite_site est recopiée de la catégorie à
    -- la création : 1 pour « Bâtiment », 0 pour « Informatique ».
    INSERT INTO tickets (id, titre, demandeur_id, created_by, technicien_id, service_id, site_id, visibilite_site, object_id) VALUES
      (1, 'Rideau cassé',            ${GARDIEN},    ${GARDIEN},    ${CHEF_TECH}, ${SERVICE_TECH}, ${MAIRIE}, 1, NULL),
      (2, 'Mot de passe oublié',     ${SECRETAIRE}, ${SECRETAIRE}, ${AGENT_INFO},${SERVICE_INFO}, ${MAIRIE}, 0, 11),
      (3, 'Fuite au sous-sol',       ${SECRETAIRE}, ${SECRETAIRE}, ${CHEF_TECH}, ${SERVICE_TECH}, ${MAIRIE}, 1, NULL),
      (4, 'Bruit sur le Nemo',       ${AGENT_INFO}, ${AGENT_INFO}, NULL,         ${SERVICE_TECH}, ${SALLE},  1, 10),
      (5, 'Écran noir',              ${GARDIEN},    ${GARDIEN},    ${AGENT_INFO},${SERVICE_INFO}, ${SALLE},  0, NULL),
      (6, 'Imprimante en panne',     ${CHEF_TECH},  ${CHEF_TECH},  ${CHEF_INFO}, ${SERVICE_INFO}, ${MAIRIE}, 0, NULL),
      (7, 'Porte qui grince',        ${ADMIN},      ${ADMIN},      NULL,         NULL,            ${SALLE},  1, NULL),
      (8, 'Demande confidentielle',  ${CHEF_INFO},  ${CHEF_INFO},  NULL,         NULL,            NULL,      0, NULL);

    -- Le gardien est mis en copie de la fuite, qu'il ne verrait pas autrement.
    INSERT INTO ticket_watchers (ticket_id, user_id) VALUES (3, ${GARDIEN});
  `);
});

/** Les identifiants des tickets visibles par cette personne, triés. */
async function visiblesPour(userId: number, role: string): Promise<number[]> {
  const filtre = await porteeTickets(commeSi(userId, role), 't');
  const lignes = base
    .prepare(`SELECT t.id FROM tickets t WHERE 1 = 1${filtre.sql} ORDER BY t.id`)
    .all(...filtre.params) as Array<{ id: number }>;
  return lignes.map((l) => l.id);
}

describe('Le fragment de portée', () => {
  it('ne restreint rien pour un administrateur', async () => {
    const filtre = await porteeTickets(commeSi(ADMIN, 'admin'), 't');
    expect(filtre.sql).toBe('');
    expect(await visiblesPour(ADMIN, 'admin')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ne produit jamais un IN vide, même sans service ni bâtiment', async () => {
    // Le gardien n'est dans aucun service : les prédicats correspondants
    // doivent être omis, pas rendus avec une liste vide — `IN ()` est une
    // erreur de syntaxe sur les deux moteurs.
    const ctx = await contexteTickets(commeSi(GARDIEN, 'user'));
    const portee = fragmentPortee(ctx, 't');
    expect(portee.type).toBe('limitee');
    if (portee.type !== 'limitee') throw new Error('portée inattendue');
    expect(portee.sql).not.toMatch(/IN \(\s*\)/);
    expect(() => base.prepare(`SELECT id FROM tickets t WHERE ${portee.sql}`)).not.toThrow();
  });
});

describe('Le cloisonnement par équipe', () => {
  it('montre au service technique ses demandes, et pas celles de l’informatique', async () => {
    const vus = await visiblesPour(CHEF_TECH, 'supervisor');

    // Les siennes (6), celles de son service (1, 3, 4).
    expect(vus).toEqual(expect.arrayContaining([1, 3, 4, 6]));
    // Jamais celles confiées à l'informatique et qui ne le concernent pas.
    expect(vus).not.toContain(2);
    expect(vus).not.toContain(5);
    expect(vus).not.toContain(8);
  });

  it('montre au service informatique ses demandes, et pas celles de la technique', async () => {
    const vus = await visiblesPour(CHEF_INFO, 'supervisor');

    expect(vus).toEqual(expect.arrayContaining([2, 5, 6, 8]));
    // « Rideau cassé » et « Fuite au sous-sol » sont au service technique.
    expect(vus).not.toContain(1);
    expect(vus).not.toContain(3);
  });

  it('n’accorde aucun privilège au rôle superviseur par lui-même', async () => {
    // Le responsable technique est `supervisor` : s'il voyait tout, le
    // cloisonnement demandé n'existerait pas.
    const vus = await visiblesPour(CHEF_TECH, 'supervisor');
    expect(vus).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('remonte au superviseur les demandes des agents qu’il encadre', async () => {
    // « Bruit sur le Nemo » (4) est d'Ali, encadré par Inès, et confié au
    // service technique : Inès le voit par le lien d'encadrement, pas par son
    // service.
    expect(await visiblesPour(CHEF_INFO, 'supervisor')).toContain(4);
    // Alors qu'Ali ne voit pas les demandes de sa responsable.
    expect(await visiblesPour(AGENT_INFO, 'agent')).not.toContain(8);
  });
});

describe('Le voisinage par bâtiment', () => {
  it('montre les demandes partagées de mon bâtiment', async () => {
    const vus = await visiblesPour(SECRETAIRE, 'user');
    // « Rideau cassé » est d'un collègue, à la mairie, en catégorie partagée :
    // c'est exactement le doublon qu'on veut éviter.
    expect(vus).toContain(1);
  });

  it('ne montre pas les demandes non partagées du même bâtiment', async () => {
    const vus = await visiblesPour(SECRETAIRE, 'user');
    // « Imprimante en panne » est à la mairie mais en catégorie non partagée.
    expect(vus).not.toContain(6);
  });

  it('ne montre rien du bâtiment à qui n’a pas le droit', async () => {
    const vus = await visiblesPour(GARDIEN, 'user');
    // Le gardien est à la salle des fêtes, `peut_voir_tickets = 0`.
    // « Bruit sur le Nemo » (4) et « Porte qui grince » (7) y sont partagées.
    expect(vus).not.toContain(4);
    expect(vus).not.toContain(7);
    // Il garde les siennes, et celle qu'il observe.
    expect(vus).toEqual(expect.arrayContaining([1, 5, 3]));
  });

  it('se lit en voisinage, pas en accès complet', async () => {
    // La secrétaire voit « Rideau cassé » par son bâtiment seulement.
    expect(await accesTicket(commeSi(SECRETAIRE, 'user'), 1)).toBe('voisinage');
    // Mais « Fuite au sous-sol » est la sienne : lecture complète.
    expect(await accesTicket(commeSi(SECRETAIRE, 'user'), 3)).toBe('complet');
    // Et « Demande confidentielle » lui reste fermée.
    expect(await accesTicket(commeSi(SECRETAIRE, 'user'), 8)).toBe('aucun');
  });

  it('donne l’accès complet à celui qui est mis en copie', async () => {
    // Le gardien observe « Fuite au sous-sol » : être en copie donne à lire.
    expect(await accesTicket(commeSi(GARDIEN, 'user'), 3)).toBe('complet');
  });
});

describe('Le droit de tout voir', () => {
  it('s’accorde par le rôle, explicitement', async () => {
    base.prepare(`INSERT INTO module_permissions (module_name, role, can_view) VALUES ('tickets', 'supervisor', 1)`).run();
    expect(await visiblesPour(CHEF_TECH, 'supervisor')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    base.prepare(`DELETE FROM module_permissions WHERE module_name = 'tickets'`).run();
  });

  it('s’accorde à une personne, et l’emporte sur son rôle', async () => {
    base.prepare(`INSERT INTO user_module_permissions (user_id, module_name, can_view) VALUES (${SECRETAIRE}, 'tickets', 1)`).run();
    expect(await visiblesPour(SECRETAIRE, 'user')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    base.prepare(`DELETE FROM user_module_permissions WHERE module_name = 'tickets'`).run();
  });

  it('se refuse par défaut, faute de réglage', async () => {
    const ctx = await contexteTickets(commeSi(SECRETAIRE, 'user'));
    expect(ctx.voitTout).toBe(false);
  });
});

describe('Le matériel nommé dans un ticket', () => {
  it('ne rend que les matériels que le compte peut consulter', async () => {
    // Seule la catégorie 2 (Outillage) est ouverte au gardien.
    base.prepare(`INSERT INTO user_permissions (user_id, category_id, can_view) VALUES (${GARDIEN}, 2, 1)`).run();

    const visibles = await materielsVisibles(commeSi(GARDIEN, 'user'), [10, 11]);
    expect(visibles.has(10)).toBe(true); // le Nemo, en Outillage
    expect(visibles.has(11)).toBe(false); // le portable, en Informatique

    base.prepare(`DELETE FROM user_permissions WHERE user_id = ${GARDIEN}`).run();
  });

  it('ne fait pas disparaître le ticket dont le matériel est hors périmètre', async () => {
    // C'est le piège de `filtreObjetsLies` : filtrer la ligne ferait sortir de
    // sa propre liste le ticket que l'utilisateur vient d'ouvrir.
    const vus = await visiblesPour(SECRETAIRE, 'user');
    expect(vus).toContain(2); // « Mot de passe oublié », sur le portable
  });

  it('ne demande rien à la base quand aucun matériel n’est cité', async () => {
    const visibles = await materielsVisibles(commeSi(GARDIEN, 'user'), [null, undefined]);
    expect(visibles.size).toBe(0);
  });
});
