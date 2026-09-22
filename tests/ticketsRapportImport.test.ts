import type BetterSqlite3 from 'better-sqlite3';

/**
 * Les chiffres d'un rapport, et la reprise de GestSup.
 *
 * Deux propriétés méritent d'être figées, et chacune répond à un chiffre qui
 * mentirait autrement.
 *
 * **La médiane à côté de la moyenne.** Une demande qui traîne six mois — le
 * rideau qu'on ne commande qu'au budget suivant — tire la moyenne d'un service
 * qui répond par ailleurs en deux heures. Présenté seul, ce chiffre fait
 * conclure l'inverse de la réalité.
 *
 * **La reprise est rejouable.** Relancer un import interrompu ne doit pas
 * doubler l'historique : sans cette garantie, la première erreur oblige à vider
 * la table à la main, ce que personne n'ose faire en production.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseRapport = sqlite;

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

import migration032 from '../src/database/migrations/032_tickets';
import migration034 from '../src/database/migrations/034_tickets_temps_et_reprise';
import type { ContexteMigration } from '../src/database/migrations/types';
import { construireRapport, mediane, moyenne } from '../src/services/ticketsRapport.service';
import { importerGestsup, normaliserDate } from '../src/services/importGestsup.service';

const base: BetterSqlite3.Database = (global as any).__baseRapport;
const SANS_PORTEE = { sql: '', params: [] };
const ADMIN = 1;

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
      id INTEGER PRIMARY KEY AUTOINCREMENT, email VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), is_active INTEGER DEFAULT 1,
      can_login INTEGER NOT NULL DEFAULT 1, created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      category_id INTEGER, subcategory_id INTEGER);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), code VARCHAR(50),
      address VARCHAR(500), sort_order INTEGER DEFAULT 0);
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY, site_id INTEGER, name VARCHAR(255));
    CREATE TABLE planning_taches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, minutes INTEGER,
      date_jour VARCHAR(10), created_at DATETIME
    );
    CREATE TABLE planning_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tache_id INTEGER, user_id INTEGER, minutes INTEGER
    );
  `);

  await migration032.up(ctx);
  await migration034.up(ctx);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (${ADMIN}, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (2, 'tech@ville.fr', 'Tom', 'Tech', 'agent'),
      (3, 'gardien@ville.fr', 'Gil', 'Gardien', 'user');

    INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie'), (2, 'Salle des fêtes');
    INSERT INTO objects (id, name) VALUES (10, 'Nemo');

    INSERT INTO ticket_statuts (nom, slug, ordre, is_ouvert, is_defaut, is_final, is_systeme)
    VALUES ('À traiter', 'a-traiter', 1, 1, 1, 0, 1),
           ('En cours', 'en-cours', 2, 1, 0, 0, 0),
           ('Résolu', 'resolu', 3, 0, 0, 1, 1);

    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, ordre)
    VALUES ('Bâtiment', 'batiment', 0, 1), ('Informatique', 'informatique', 0, 2);
  `);
});

describe('La médiane, à côté de la moyenne', () => {
  it('rend null sur une série vide plutôt que zéro', () => {
    // Zéro se lirait « résolu instantanément », ce qui est faux.
    expect(mediane([])).toBeNull();
    expect(moyenne([])).toBeNull();
  });

  it('prend la valeur du milieu sur une série impaire', () => {
    expect(mediane([10, 20, 300])).toBe(20);
  });

  it('prend la moyenne des deux du milieu sur une série paire', () => {
    expect(mediane([10, 20, 30, 40])).toBe(25);
  });

  it('résiste au dossier bloqué qui affole la moyenne', () => {
    // Quatre demandes traitées en deux heures, une qui traîne six mois.
    const minutes = [120, 120, 120, 120, 260000];
    expect(mediane(minutes)).toBe(120);
    expect(moyenne(minutes)).toBeGreaterThan(50000);
    // C'est l'écart entre les deux qui renseigne : présenter la moyenne seule
    // ferait conclure que le service met six mois à changer une ampoule.
  });
});

describe('Le rapport', () => {
  beforeAll(() => {
    const t = (id: number, colonnes: Record<string, any>) => {
      const valeurs = {
        id,
        titre: `Demande ${id}`,
        demandeur_id: 3,
        statut_id: 1,
        site_id: 1,
        categorie_id: 1,
        technicien_id: null,
        created_at: '2026-09-01 08:00:00',
        pris_en_charge_at: null,
        resolu_at: null,
        ferme_at: null,
        echeance_resolution: null,
        visibilite_site: 0,
        priorite: 'normale',
        origine: 'application',
        ...colonnes,
      };
      base
        .prepare(
          `INSERT INTO tickets (id, titre, demandeur_id, statut_id, site_id, categorie_id, technicien_id,
                                created_at, pris_en_charge_at, resolu_at, ferme_at, echeance_resolution,
                                visibilite_site, priorite, origine)
           VALUES (@id, @titre, @demandeur_id, @statut_id, @site_id, @categorie_id, @technicien_id,
                   @created_at, @pris_en_charge_at, @resolu_at, @ferme_at, @echeance_resolution,
                   @visibilite_site, @priorite, @origine)`
        )
        .run(valeurs);
    };

    // Deux closes dans les délais, une close hors délai, une encore ouverte.
    t(1, {
      statut_id: 3,
      pris_en_charge_at: '2026-09-01 09:00:00',
      resolu_at: '2026-09-01 10:00:00',
      ferme_at: '2026-09-01 10:00:00',
      echeance_resolution: '2026-09-02 08:00:00',
      technicien_id: 2,
    });
    t(2, {
      statut_id: 3,
      pris_en_charge_at: '2026-09-01 09:00:00',
      resolu_at: '2026-09-01 11:00:00',
      ferme_at: '2026-09-01 11:00:00',
      echeance_resolution: '2026-09-02 08:00:00',
      technicien_id: 2,
    });
    t(3, {
      statut_id: 3,
      pris_en_charge_at: '2026-09-01 09:00:00',
      resolu_at: '2026-09-10 08:00:00',
      ferme_at: '2026-09-10 08:00:00',
      echeance_resolution: '2026-09-02 08:00:00',
      categorie_id: 2,
      site_id: 2,
    });
    t(4, { statut_id: 2, site_id: 2 });

    // Du temps passé sur la demande 1 : deux heures, plus trente minutes de renfort.
    base
      .prepare(
        `INSERT INTO planning_taches (id, user_id, minutes, date_jour, ticket_id) VALUES (1, 2, 120, '2026-09-01', 1)`
      )
      .run();
    base.prepare(`INSERT INTO planning_participants (tache_id, user_id, minutes) VALUES (1, 3, 30)`).run();
  });

  it('compte les demandes ouvertes, closes et en cours', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    expect(r.ouvertes).toBe(4);
    expect(r.closes).toBe(3);
    expect(r.enCours).toBe(1);
  });

  it('ne mesure le délai de résolution que sur ce qui est clos', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    // Inclure l'ouverte avec son âge courant ferait baisser la moyenne à mesure
    // qu'on ouvre des demandes, ce qui est absurde.
    expect(r.resolution.mesurees).toBe(3);
  });

  it('distingue ce qui a tenu son échéance de ce qui l’a dépassée', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    expect(r.resolution.dansLesDelais).toBe(2);
    expect(r.resolution.horsDelais).toBe(1);
  });

  it('rend médiane et moyenne, et l’écart entre les deux se voit', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    // Deux demandes en 2 h et 3 h, une en neuf jours.
    expect(r.resolution.medianeMinutes).toBe(180);
    expect(r.resolution.moyenneMinutes).toBeGreaterThan(r.resolution.medianeMinutes!);
  });

  it('répartit par catégorie, bâtiment et technicien', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    expect(r.parCategorie.find((c) => c.libelle === 'Bâtiment')?.total).toBe(3);
    expect(r.parBatiment.find((b) => b.libelle === 'Salle des fêtes')?.total).toBe(2);
    // Les demandes sans technicien sont comptées, pas escamotées.
    expect(r.parTechnicien.find((t) => t.libelle === 'Non affectée')?.total).toBe(2);
  });

  it('somme le temps mobilisé, renforts compris', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-09-01', fin: '2026-09-30' });
    // 120 min de titulaire + 30 min de renfort : c'est ce que la demande a
    // coûté à la collectivité, et non ce que la journée de quelqu'un a contenu.
    expect(r.tempsPasseMinutes).toBe(150);
    expect(r.tempsParCategorie[0].libelle).toBe('Bâtiment');
  });

  it('respecte la portée du lecteur', async () => {
    const portee = { sql: ' AND t.site_id = ?', params: [1] };
    const r = await construireRapport(portee, { debut: '2026-09-01', fin: '2026-09-30' });
    // Un rapport ne compte jamais ce que son lecteur n'a pas le droit de voir.
    expect(r.ouvertes).toBe(2);
  });

  it('ne compte rien hors de la période', async () => {
    const r = await construireRapport(SANS_PORTEE, { debut: '2026-10-01', fin: '2026-10-31' });
    expect(r.ouvertes).toBe(0);
    expect(r.resolution.medianeMinutes).toBeNull();
  });
});

describe('Les dates d’un export', () => {
  it('garde une date déjà au bon format', () => {
    expect(normaliserDate('2026-09-15 17:36:00')).toBe('2026-09-15 17:36:00');
  });

  it('accepte le format français', () => {
    expect(normaliserDate('15/09/2026 17:36')).toBe('2026-09-15 17:36:00');
  });

  it('rend null sur ce qu’elle ne comprend pas, plutôt qu’une date inventée', () => {
    expect(normaliserDate('bientôt')).toBeNull();
    expect(normaliserDate('')).toBeNull();
  });
});

describe('La reprise de GestSup', () => {
  const ligne = (surcharge: Record<string, any> = {}) => ({
    id: 2646,
    titre: 'ADRESSE MAIL',
    description: 'Créer des adresses en @villepavilly.fr',
    demandeur_nom: 'Gil Gardien',
    categorie: 'Informatique',
    statut: 'Résolu',
    batiment: 'Mairie',
    cree_le: '2026-09-15 17:36:00',
    resolu_le: '2026-09-17 17:04:00',
    ...surcharge,
  });

  afterEach(() => {
    base.exec("DELETE FROM tickets WHERE origine = 'import'; DELETE FROM ticket_import_correspondances;");
  });

  it('n’écrit rien en essai à blanc', async () => {
    const avant = (base.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n;
    const rapport = await importerGestsup([ligne()], { auteurId: ADMIN });

    expect(rapport.essaiABlanc).toBe(true);
    expect(rapport.crees).toBe(1);
    expect((base.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n).toBe(avant);
  });

  it('crée la demande quand on applique, avec son numéro d’origine', async () => {
    await importerGestsup([ligne()], { auteurId: ADMIN, essaiABlanc: false });
    const repris = base
      .prepare("SELECT * FROM tickets WHERE reference_externe = 'gestsup:2646'")
      .get() as any;

    expect(repris).toBeDefined();
    // Le numéro que les agents connaissent, et citent encore dans leurs courriels.
    expect(repris.reference).toBe('G-2646');
    expect(repris.origine).toBe('import');
    expect(repris.ferme_at).toBe('2026-09-17 17:04:00');
  });

  it('est rejouable : deux passages ne font pas deux demandes', async () => {
    await importerGestsup([ligne()], { auteurId: ADMIN, essaiABlanc: false });
    const second = await importerGestsup([ligne({ titre: 'ADRESSE MAIL (corrigé)' })], {
      auteurId: ADMIN,
      essaiABlanc: false,
    });

    expect(second.crees).toBe(0);
    expect(second.misAJour).toBe(1);

    const toutes = base
      .prepare("SELECT titre FROM tickets WHERE reference_externe = 'gestsup:2646'")
      .all() as any[];
    expect(toutes).toHaveLength(1);
    expect(toutes[0].titre).toBe('ADRESSE MAIL (corrigé)');
  });

  it('rapproche la catégorie, le bâtiment et l’état par leur nom', async () => {
    await importerGestsup([ligne()], { auteurId: ADMIN, essaiABlanc: false });
    const repris = base
      .prepare("SELECT * FROM tickets WHERE reference_externe = 'gestsup:2646'")
      .get() as any;

    const informatique = base
      .prepare("SELECT id FROM ticket_categories WHERE name_normalise = 'informatique'")
      .get() as any;
    expect(repris.categorie_id).toBe(informatique.id);
    expect(repris.site_id).toBe(1);
  });

  it('signale ce qu’il n’a pas su rapprocher, au lieu de le deviner', async () => {
    const rapport = await importerGestsup([ligne({ categorie: 'Plomberie exotique' })], {
      auteurId: ADMIN,
    });
    // Ranger dans la première catégorie venue produirait un historique faux,
    // qu'on croirait vrai.
    expect(rapport.nonRapproches).toEqual(
      expect.arrayContaining([{ ligne: 2646, quoi: 'catégorie', valeur: 'Plomberie exotique' }])
    );
  });

  it('retient une correspondance, pour ne pas la redemander', async () => {
    await importerGestsup([ligne()], { auteurId: ADMIN, essaiABlanc: false });
    const retenues = base
      .prepare("SELECT * FROM ticket_import_correspondances WHERE domaine = 'categorie'")
      .all() as any[];
    expect(retenues).toHaveLength(1);
    expect(retenues[0].valeur_source).toBe('Informatique');
  });

  it('inscrit un demandeur inconnu à l’annuaire, sans lui ouvrir d’accès', async () => {
    await importerGestsup([ligne({ demandeur_nom: 'Hugo Moulin' })], {
      auteurId: ADMIN,
      essaiABlanc: false,
    });
    const cree = base
      .prepare("SELECT * FROM users WHERE last_name = 'Moulin'")
      .get() as any;

    expect(cree).toBeDefined();
    // La migration 028 a prévu exactement ce cas : une fiche d'annuaire, pas
    // un compte.
    expect(cree.can_login).toBe(0);
  });

  it('reprend le fil quand l’export le porte', async () => {
    await importerGestsup(
      [
        ligne({
          suivi: [
            { auteur: 'Ada Admin', corps: 'Mail créé, identifiant envoyé', date: '2026-09-17 17:04' },
          ],
        }),
      ],
      { auteurId: ADMIN, essaiABlanc: false }
    );

    const repris = base
      .prepare("SELECT id FROM tickets WHERE reference_externe = 'gestsup:2646'")
      .get() as any;
    const messages = base
      .prepare('SELECT * FROM ticket_messages WHERE ticket_id = ?')
      .all(repris.id) as any[];

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('Mail créé');
  });

  it('écarte une ligne sans identifiant plutôt que de tout interrompre', async () => {
    const rapport = await importerGestsup(
      [{ id: '', titre: 'Sans numéro' } as any, ligne()],
      { auteurId: ADMIN }
    );
    expect(rapport.ignorees).toBe(1);
    expect(rapport.crees).toBe(1);
    expect(rapport.erreurs).toHaveLength(1);
  });
});
