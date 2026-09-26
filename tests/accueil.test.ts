import type BetterSqlite3 from 'better-sqlite3';

/**
 * L'accueil de chacun : disposition, actions rapides, favoris.
 *
 * Ce qui est figé ici :
 *
 *   **Le catalogue filtre, il ne refuse pas.** Un bloc inconnu est écarté ;
 *   seule une forme fausse, ou trop d'actions, est une erreur.
 *
 *   **Un raccourci reste dans l'application.** `//hote`, `https://…`,
 *   `javascript:` sont refusés.
 *
 *   **Un favori ne survit pas à la portée.** Hors périmètre, il revient
 *   « indisponible », sans nom ni chemin.
 *
 *   **L'import des favoris locaux n'a lieu qu'une fois**, et chacun ne touche
 *   qu'aux siens.
 */

// Ce que chaque compte voit, réglé par test : les portées sont celles des
// modules, remplacées ici par des listes d'identifiants.
const visibles: Record<string, Record<number, number[] | null>> = {
  objets: {},
  batiments: {},
  tickets: {},
  manifestations: {},
};

function clause(colonne: string, ids: number[] | null | undefined) {
  if (ids === null) return { sql: '', params: [] };
  const liste = ids ?? [];
  if (liste.length === 0) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${colonne} IN (${liste.map(() => '?').join(',')})`, params: liste };
}

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  (global as any).__baseAccueil = sqlite;

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
      async transaction<T>(travail: () => Promise<T>): Promise<T> {
        return travail();
      },
    },
  };
});

jest.mock('../src/middleware/objectScope', () => ({
  filtreObjets: async (req: any) => {
    const ids = visibles.objets[req.user.userId];
    return ids !== undefined && ids !== null && ids.length === 0 ? null : clause('o.id', ids);
  },
}));
jest.mock('../src/middleware/ticketScope', () => ({
  porteeTickets: async (req: any) => clause('t.id', visibles.tickets[req.user.userId]),
}));
jest.mock('../src/middleware/manifestationScope', () => ({
  filtreManifestations: async (req: any) => clause('m.id', visibles.manifestations[req.user.userId]),
}));
jest.mock('../src/services/batiments.service', () => ({
  perimetreBatiments: async (appelant: any) => visibles.batiments[appelant.userId] ?? [],
}));

import migration048 from '../src/database/migrations/048_accueil_personnel';
import type { ContexteMigration } from '../src/database/migrations/types';
import {
  ErreurAccueil,
  ajouterFavori,
  enregistrerAccueil,
  importerFavorisLocaux,
  lireAccueil,
  listerFavoris,
  normaliserUrl,
  renommerFavori,
  reordonnerFavoris,
  retirerCible,
  retirerFavori,
} from '../src/services/accueil.service';
import { anonymiser } from '../src/services/comptes.service';

const base: BetterSqlite3.Database = (global as any).__baseAccueil;

const ADMIN = 1;
const AGENT = 2;
const AUTRE = 3;

const req = (userId: number, role = 'agent') => ({ user: { userId, role } }) as any;

const ctx: ContexteMigration = {
  executer: async (sql, params) => {
    const r = base.prepare(sql).run(...(params ?? []));
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
  },
  interroger: async (sql, params) => base.prepare(sql).all(...(params ?? [])) as any[],
  creerIndex: async (nom, table, colonnes) => {
    base.exec(`CREATE INDEX IF NOT EXISTS ${nom} ON ${table} (${colonnes})`);
  },
  dialecte: 'sqlite',
  autoIncrement: 'AUTOINCREMENT',
  texteLong: 'TEXT',
  booleen: 'INTEGER',
  horodatageParDefaut: "DEFAULT (datetime('now'))",
};

beforeAll(async () => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), password VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), avatar TEXT, is_active INTEGER DEFAULT 1,
      anonymized_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100));
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), address VARCHAR(500));
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, titre VARCHAR(255), reference VARCHAR(50));
    CREATE TABLE manifestations (id INTEGER PRIMARY KEY, title VARCHAR(255), date_start DATE);

    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${AGENT}, 'agent@ville.fr', 'Ali', 'Agent', 'agent'),
      (${AUTRE}, 'autre@ville.fr', 'Oda', 'Autre', 'agent');
    INSERT INTO objects (id, name, reference) VALUES (10, 'Tondeuse', 'T-1'), (11, 'Camion', 'C-1'), (12, 'Clé école', 'K-1');
    INSERT INTO cle_sites (id, name, address) VALUES (1, 'Mairie', '1 place'), (2, 'École', '2 rue');
    INSERT INTO tickets (id, titre, reference) VALUES (100, 'Fuite toiture', 'T-100');
    INSERT INTO manifestations (id, title, date_start) VALUES (200, 'Kermesse', '2027-06-01');
  `);
  await migration048.up(ctx);
  // Rejouable : une seconde application ne doit rien casser.
  await migration048.up(ctx);
});

beforeEach(() => {
  base.exec('DELETE FROM user_favoris; DELETE FROM user_accueil;');
  visibles.objets = { [AGENT]: [10, 11, 12], [AUTRE]: [10] };
  visibles.batiments = { [AGENT]: [1, 2], [AUTRE]: [] };
  visibles.tickets = { [AGENT]: [100], [AUTRE]: [] };
  visibles.manifestations = { [AGENT]: [200], [AUTRE]: [] };
});

describe('disposition', () => {
  it("revient à l'origine tant que rien n'est enregistré", async () => {
    expect(await lireAccueil(AGENT)).toEqual({ blocs: null, actions: null, favorisImportes: false });
  });

  it('écarte les blocs inconnus et les doublons, garde la visibilité', async () => {
    const accueil = await enregistrerAccueil(AGENT, {
      blocs: [{ id: 'alertes', visible: false }, 'tickets', { id: 'inconnu' }, { id: 'tickets', visible: false }],
    });
    expect(accueil.blocs).toEqual([
      { id: 'alertes', visible: false },
      { id: 'tickets', visible: true },
    ]);
  });

  it('refuse plus de quatre actions, et une forme fausse', async () => {
    await expect(
      enregistrerAccueil(AGENT, { actions: ['scanner', 'plein', 'chercher', 'favoris', 'reserver'] })
    ).rejects.toBeInstanceOf(ErreurAccueil);
    await expect(enregistrerAccueil(AGENT, { blocs: 'tickets' })).rejects.toBeInstanceOf(ErreurAccueil);
  });

  it('ne touche que le champ envoyé, et `null` rend la disposition d’origine', async () => {
    await enregistrerAccueil(AGENT, { blocs: ['parc'], actions: ['scanner', 'inconnue'] });
    const apres = await enregistrerAccueil(AGENT, { actions: ['mes-tickets'] });
    expect(apres.blocs).toEqual([{ id: 'parc', visible: true }]);
    expect(apres.actions).toEqual(['mes-tickets']);
    expect((await enregistrerAccueil(AGENT, { blocs: null })).blocs).toBeNull();
  });
});

describe('raccourcis', () => {
  it.each(['//exemple.fr', '/\\exemple.fr', 'https://exemple.fr', 'javascript:alert(1)', '', 'tickets'])(
    'refuse « %s »',
    (url) => {
      expect(() => normaliserUrl(url)).toThrow(ErreurAccueil)
    }
  );

  it('enregistre un chemin interne, filtres compris, sans doublon', async () => {
    const premier = await ajouterFavori(req(AGENT), { type: 'lien', url: '/tickets?moi=1', libelle: 'Mes tickets' });
    const second = await ajouterFavori(req(AGENT), { type: 'lien', url: '/tickets?moi=1', libelle: 'Encore' });
    expect(second).toEqual({ id: premier.id, cree: false });
    const [favori] = await listerFavoris(req(AGENT));
    expect(favori).toMatchObject({ type: 'lien', url: '/tickets?moi=1', libelle: 'Mes tickets', disponible: true });
  });

  it('exige un nom', async () => {
    await expect(ajouterFavori(req(AGENT), { type: 'lien', url: '/alerts' })).rejects.toBeInstanceOf(ErreurAccueil);
  });
});

describe('favoris', () => {
  it('nomme chaque cible et donne son chemin', async () => {
    await ajouterFavori(req(AGENT), { type: 'materiel', cibleId: 10 });
    await ajouterFavori(req(AGENT), { type: 'batiment', cibleId: 2 });
    await ajouterFavori(req(AGENT), { type: 'ticket', cibleId: 100 });
    await ajouterFavori(req(AGENT), { type: 'manifestation', cibleId: 200 });
    await ajouterFavori(req(AGENT), { type: 'cle', cibleId: 12 });

    const favoris = await listerFavoris(req(AGENT));
    expect(favoris.map((f) => [f.type, f.libelle, f.url])).toEqual([
      ['materiel', 'Tondeuse', '/objects/10'],
      ['batiment', 'École', '/batiments/2'],
      ['ticket', 'Fuite toiture', '/tickets/100'],
      ['manifestation', 'Kermesse', '/manifestations?fiche=200'],
      ['cle', 'Clé école', '/cles/12'],
    ]);
  });

  it("refuse d'épingler ce qu'on ne voit pas", async () => {
    await expect(ajouterFavori(req(AUTRE), { type: 'batiment', cibleId: 1 })).rejects.toMatchObject({ statut: 404 });
    await expect(ajouterFavori(req(AUTRE), { type: 'materiel', cibleId: 11 })).rejects.toMatchObject({ statut: 404 });
  });

  it('un favori devenu hors périmètre revient indisponible, sans nom ni chemin', async () => {
    await ajouterFavori(req(AGENT), { type: 'batiment', cibleId: 1 });
    await ajouterFavori(req(AGENT), { type: 'ticket', cibleId: 100 });
    const [bat] = await listerFavoris(req(AGENT));
    await renommerFavori(AGENT, bat.id, 'Mairie — chaufferie');

    visibles.batiments[AGENT] = [2];
    visibles.tickets[AGENT] = [];

    const favoris = await listerFavoris(req(AGENT));
    expect(favoris).toHaveLength(2);
    for (const f of favoris) {
      expect(f).toMatchObject({ disponible: false, libelle: null, libellePerso: null, url: null, detail: null });
    }
  });

  it('un nom personnel remplace celui de la cible ; vide, il le rend', async () => {
    const { id } = await ajouterFavori(req(AGENT), { type: 'materiel', cibleId: 11 });
    await renommerFavori(AGENT, id, 'Le camion de la voirie');
    expect((await listerFavoris(req(AGENT)))[0]).toMatchObject({ libelle: 'Le camion de la voirie', libellePerso: 'Le camion de la voirie' });
    await renommerFavori(AGENT, id, '  ');
    expect((await listerFavoris(req(AGENT)))[0]).toMatchObject({ libelle: 'Camion', libellePerso: null });
  });

  it("réordonne, et ignore les favoris d'autrui", async () => {
    const a = await ajouterFavori(req(AGENT), { type: 'materiel', cibleId: 10 });
    const b = await ajouterFavori(req(AGENT), { type: 'materiel', cibleId: 11 });
    const autre = await ajouterFavori(req(AUTRE), { type: 'materiel', cibleId: 10 });

    await reordonnerFavoris(AGENT, [b.id, a.id, autre.id]);
    expect((await listerFavoris(req(AGENT))).map((f) => f.id)).toEqual([b.id, a.id]);
    expect((await listerFavoris(req(AUTRE))).map((f) => f.id)).toEqual([autre.id]);
  });

  it("personne ne retire le favori d'un autre", async () => {
    const autre = await ajouterFavori(req(AUTRE), { type: 'materiel', cibleId: 10 });
    expect(await retirerFavori(AGENT, autre.id)).toBe(false);
    expect(await retirerCible(AUTRE, 'materiel', 10)).toBe(true);
    expect(await listerFavoris(req(AUTRE))).toEqual([]);
  });
});

describe('import des favoris du navigateur', () => {
  it("ne reprend que les matériels visibles, et une seule fois", async () => {
    visibles.objets[AGENT] = [10, 12];
    expect(await importerFavorisLocaux(req(AGENT), [10, 11, 12, 'x', 10])).toEqual({ importes: 2 });

    await retirerCible(AGENT, 'materiel', 10);
    // Un second appareil qui garde d'anciens favoris ne les fait pas revenir.
    expect(await importerFavorisLocaux(req(AGENT), [10])).toEqual({ importes: 0 });
    expect((await listerFavoris(req(AGENT))).map((f) => f.cibleId)).toEqual([12]);
    expect((await lireAccueil(AGENT)).favorisImportes).toBe(true);
  });
});

describe('anonymisation', () => {
  it('efface la disposition et les favoris', async () => {
    await enregistrerAccueil(AUTRE, { blocs: ['parc'] });
    await ajouterFavori(req(AUTRE), { type: 'materiel', cibleId: 10 });

    // Les autres tables nettoyées n'existent pas dans ce banc : leur absence est journalisée.
    const journal = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resultat = await anonymiser(AUTRE, ADMIN);
    journal.mockRestore();
    expect(resultat.ok).toBe(true);
    expect(base.prepare('SELECT COUNT(*) AS n FROM user_favoris WHERE user_id = ?').get(AUTRE)).toEqual({ n: 0 });
    expect(base.prepare('SELECT COUNT(*) AS n FROM user_accueil WHERE user_id = ?').get(AUTRE)).toEqual({ n: 0 });
  });
});
