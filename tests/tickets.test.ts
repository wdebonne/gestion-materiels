import type BetterSqlite3 from 'better-sqlite3';

/**
 * Ouvrir une demande, la router, la suivre, la clore.
 *
 * Ces tests montent le schéma en appliquant **la vraie migration 032** plutôt
 * qu'un schéma recopié à la main. Une copie diverge : elle passe au vert le jour
 * où la migration se trompe, ce qui est exactement le jour où l'on aurait voulu
 * qu'elle échoue.
 *
 * Ce qui y est figé :
 *
 *   — une demande part **toute seule** au bon service, sans qu'on le lui dise ;
 *   — une sous-catégorie sans réglage hérite de sa parente, et non du vide ;
 *   — le délai de prise en charge ne rajeunit jamais ;
 *   — le fil rend événements et messages **dans un seul ordre** ;
 *   — une note interne n'est pas rendue au demandeur.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseTickets = sqlite;

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
      // Les tests n'ont pas besoin d'isolation : la fonction est exécutée telle
      // quelle, comme le fait `transaction()` quand elle en trouve déjà une.
      async transaction<T>(travail: () => Promise<T>): Promise<T> {
        return travail();
      },
    },
  };
});

import migration032 from '../src/database/migrations/032_tickets';
import migration035 from '../src/database/migrations/035_tickets_rattachements';
import type { ContexteMigration } from '../src/database/migrations/types';
import {
  ajouterMessage,
  changerStatut,
  compteursParStatut,
  creerTicket,
  filUnifie,
  listerTickets,
  modifierTicket,
  referenceDe,
  SaisieInvalide,
} from '../src/services/tickets.service';
import {
  categoriesProposeesA,
  materielsDe,
  resoudreRoutage,
} from '../src/services/ticketsReferentiel.service';
import { sitesDe, sitesProposesA } from '../src/services/sites.service';

const base: BetterSqlite3.Database = (global as any).__baseTickets;

const SERVICE_INFO = 1;
const SERVICE_TECH = 2;
const CHEF_INFO = 2;
const CHEF_TECH = 4;
const SECRETAIRE = 5;
const MAIRIE = 1;

/** Statuts, remplis après le semis. */
let A_TRAITER = 0;
let EN_COURS = 0;
let RESOLU = 0;
let REFUSE = 0;

/** Catégories de demande. */
let CAT_INFO = 0;
let CAT_BATIMENT = 0;
let SOUS_PLOMBERIE = 0;

/** Le contexte d'une migration, en dialecte SQLite. Repris de `migrationRunner`. */
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
  // Les tables que la migration 032 référence, au minimum de ce qu'elle en lit.
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100),
      last_name VARCHAR(100), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100));
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name VARCHAR(255), reference VARCHAR(100),
      location VARCHAR(255), category_id INTEGER, subcategory_id INTEGER);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY, name VARCHAR(255), code VARCHAR(50),
      address VARCHAR(500), sort_order INTEGER DEFAULT 0);
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY, site_id INTEGER, name VARCHAR(255));
  `);

  await migration032.up(ctx);
  await migration035.up(ctx);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role) VALUES
      (1, 'admin@ville.fr', 'Ada', 'Admin', 'admin'),
      (${CHEF_INFO}, 'info@ville.fr', 'Ines', 'Info', 'supervisor'),
      (3, 'agent@ville.fr', 'Ali', 'Agent', 'agent'),
      (${CHEF_TECH}, 'tech@ville.fr', 'Tom', 'Tech', 'supervisor'),
      (${SECRETAIRE}, 'secr@ville.fr', 'Sam', 'Secret', 'user');

    INSERT INTO services (id, name, slug) VALUES
      (${SERVICE_INFO}, 'Informatique', 'informatique'),
      (${SERVICE_TECH}, 'Technique', 'technique');

    INSERT INTO cle_sites (id, name) VALUES (${MAIRIE}, 'Mairie');
    INSERT INTO categories (id, name) VALUES (1, 'Informatique'), (2, 'Outillage');
    INSERT INTO objects (id, name, reference, category_id) VALUES (10, 'Nemo', 'NEM-1', 2);

    INSERT INTO ticket_statuts (nom, slug, couleur, ordre, is_ouvert, is_defaut, is_final, is_systeme)
    VALUES
      ('À traiter', 'a-traiter', 'red', 1, 1, 1, 0, 1),
      ('En cours', 'en-cours', 'blue', 2, 1, 0, 0, 0),
      ('En attente de retour', 'attente-retour', 'amber', 3, 1, 0, 0, 0),
      ('En commande', 'en-commande', 'purple', 4, 1, 0, 0, 0),
      ('Résolu', 'resolu', 'green', 5, 0, 0, 1, 1),
      ('Refusé', 'refuse', 'gray', 6, 0, 0, 1, 0);
  `);

  const statut = (slug: string) =>
    Number((base.prepare('SELECT id FROM ticket_statuts WHERE slug = ?').get(slug) as any).id);
  A_TRAITER = statut('a-traiter');
  EN_COURS = statut('en-cours');
  RESOLU = statut('resolu');
  REFUSE = statut('refuse');

  base.exec(`
    -- « Informatique » : privée, sans matériel, routée au service informatique.
    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, couleur, ordre, service_id,
                                   technicien_id, visibilite, materiel_mode, site_mode)
    VALUES ('Informatique', 'informatique', 0, 'sky', 1, ${SERVICE_INFO}, ${CHEF_INFO},
            'privee', 'aucun', 'auto');

    -- « Bâtiment » : partagée par site, matériel optionnel, service technique.
    INSERT INTO ticket_categories (nom, name_normalise, parent_cle, couleur, ordre, service_id,
                                   technicien_id, visibilite, materiel_mode, site_mode,
                                   sla_prise_en_charge_minutes, sla_resolution_minutes)
    VALUES ('Bâtiment', 'batiment', 0, 'amber', 2, ${SERVICE_TECH}, ${CHEF_TECH},
            'site', 'optionnel', 'requis', 120, 2880);
  `);

  const categorie = (slug: string) =>
    Number((base.prepare('SELECT id FROM ticket_categories WHERE name_normalise = ?').get(slug) as any).id);
  CAT_INFO = categorie('informatique');
  CAT_BATIMENT = categorie('batiment');

  // Une sous-catégorie **sans aucun réglage** : tout doit venir de la parente.
  base
    .prepare(
      `INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle, ordre) VALUES (?, ?, ?, ?, ?)`
    )
    .run('Plomberie', 'plomberie', CAT_BATIMENT, CAT_BATIMENT, 1);
  SOUS_PLOMBERIE = categorie('plomberie');
});

describe('Le référentiel', () => {
  it('empêche deux catégories racines du même nom', () => {
    // `UNIQUE(parent_id, …)` n'aurait rien contraint : les deux moteurs tiennent
    // deux NULL pour distincts. C'est `parent_cle` qui reprend prise.
    expect(() =>
      base
        .prepare(
          `INSERT INTO ticket_categories (nom, name_normalise, parent_cle, ordre) VALUES (?, ?, ?, ?)`
        )
        .run('informatique', 'informatique', 0, 9)
    ).toThrow(/UNIQUE/i);
  });

  it('accepte le même nom sous deux parentes différentes', () => {
    expect(() => {
      base
        .prepare(`INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle) VALUES (?, ?, ?, ?)`)
        .run('Écran', 'ecran', CAT_INFO, CAT_INFO);
      base
        .prepare(`INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle) VALUES (?, ?, ?, ?)`)
        .run('Écran', 'ecran', CAT_BATIMENT, CAT_BATIMENT);
    }).not.toThrow();
  });
});

describe('Le routage', () => {
  it('déduit le service et le technicien de la catégorie', async () => {
    const routage = await resoudreRoutage(CAT_INFO, null);
    expect(routage.serviceId).toBe(SERVICE_INFO);
    expect(routage.technicienId).toBe(CHEF_INFO);
    expect(routage.visibilite).toBe('privee');
  });

  it('fait hériter une sous-catégorie sans réglage de sa parente', async () => {
    const routage = await resoudreRoutage(CAT_BATIMENT, SOUS_PLOMBERIE);
    expect(routage.serviceId).toBe(SERVICE_TECH);
    expect(routage.technicienId).toBe(CHEF_TECH);
    expect(routage.visibilite).toBe('site');
    expect(routage.siteMode).toBe('requis');
    expect(routage.slaResolutionMinutes).toBe(2880);
  });

  it('se fie à la parente déclarée par la sous-catégorie, pas à celle transmise', async () => {
    // Un formulaire périmé peut envoyer une catégorie qui ne correspond plus.
    const routage = await resoudreRoutage(CAT_INFO, SOUS_PLOMBERIE);
    expect(routage.serviceId).toBe(SERVICE_TECH);
  });

  it('retombe sur des défauts sûrs quand rien n’est réglé', async () => {
    const routage = await resoudreRoutage(null, null);
    expect(routage.serviceId).toBeNull();
    expect(routage.visibilite).toBe('privee');
    expect(routage.materielMode).toBe('aucun');
  });
});

describe('Ouvrir une demande', () => {
  it('la route toute seule, sans qu’on le lui dise', async () => {
    const id = await creerTicket(
      { titre: 'Mot de passe oublié', categorieId: CAT_INFO, siteId: MAIRIE },
      SECRETAIRE
    );

    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.service_id).toBe(SERVICE_INFO);
    expect(t.technicien_id).toBe(CHEF_INFO);
    expect(t.statut_id).toBe(A_TRAITER);
    expect(t.demandeur_id).toBe(SECRETAIRE);
    // Catégorie privée : la demande n'est pas partagée avec le bâtiment.
    expect(t.visibilite_site).toBe(0);
  });

  it('recopie la visibilité de la catégorie sur la demande', async () => {
    const id = await creerTicket({ titre: 'Rideau cassé', categorieId: CAT_BATIMENT, siteId: MAIRIE }, SECRETAIRE);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.visibilite_site).toBe(1);
  });

  it('pose les échéances d’après les délais de la catégorie', async () => {
    const id = await creerTicket({ titre: 'Fuite', categorieId: CAT_BATIMENT, siteId: MAIRIE }, SECRETAIRE);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.echeance_prise_en_charge).toBeTruthy();
    expect(t.echeance_resolution).toBeTruthy();
    expect(new Date(t.echeance_resolution).getTime()).toBeGreaterThan(
      new Date(t.echeance_prise_en_charge).getTime()
    );
  });

  it('ne pose pas d’échéance quand la catégorie n’en règle aucune', async () => {
    const id = await creerTicket({ titre: 'Sans délai', categorieId: CAT_INFO }, SECRETAIRE);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.echeance_resolution).toBeNull();
  });

  it('donne un numéro dérivé de l’identifiant, donc jamais en double', async () => {
    const a = await creerTicket({ titre: 'Première' }, SECRETAIRE);
    const b = await creerTicket({ titre: 'Seconde' }, SECRETAIRE);
    const lire = (id: number) =>
      (base.prepare('SELECT reference FROM tickets WHERE id = ?').get(id) as any).reference;

    expect(lire(a)).toBe(referenceDe(a));
    expect(lire(b)).toBe(referenceDe(b));
    expect(lire(a)).not.toBe(lire(b));
  });

  it('inscrit l’ouverture au fil', async () => {
    const id = await creerTicket({ titre: 'Tracée' }, SECRETAIRE);
    const fil = await filUnifie(id, true);
    expect(fil).toHaveLength(1);
    expect(fil[0].type).toBe('evenement');
    expect(fil[0].action).toBe('ouverture');
  });

  it('refuse un titre vide', async () => {
    await expect(creerTicket({ titre: '   ' }, SECRETAIRE)).rejects.toBeInstanceOf(SaisieInvalide);
  });

  it('accepte qu’un agent saisisse pour quelqu’un d’autre', async () => {
    const id = await creerTicket({ titre: 'Pour le gardien', demandeurId: CHEF_TECH }, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.demandeur_id).toBe(CHEF_TECH);
    expect(t.created_by).toBe(CHEF_INFO);
  });
});

describe('Suivre une demande', () => {
  it('pose la prise en charge au premier statut qui n’est pas le défaut', async () => {
    const id = await creerTicket({ titre: 'À prendre' }, SECRETAIRE);
    expect((base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any).pris_en_charge_at).toBeNull();

    await changerStatut(id, EN_COURS, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.pris_en_charge_at).toBeTruthy();
    expect(t.pris_en_charge_by).toBe(CHEF_INFO);
  });

  it('ne rajeunit jamais le délai de prise en charge', async () => {
    const id = await creerTicket({ titre: 'Aller-retour' }, SECRETAIRE);
    await changerStatut(id, EN_COURS, CHEF_INFO);
    const premier = (base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any).pris_en_charge_at;

    await changerStatut(id, A_TRAITER, CHEF_INFO);
    await changerStatut(id, EN_COURS, CHEF_TECH);
    const apres = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;

    expect(apres.pris_en_charge_at).toBe(premier);
    expect(apres.pris_en_charge_by).toBe(CHEF_INFO);
  });

  it('pose la résolution et la clôture sur un statut final', async () => {
    const id = await creerTicket({ titre: 'À résoudre' }, SECRETAIRE);
    await changerStatut(id, RESOLU, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.resolu_at).toBeTruthy();
    expect(t.ferme_at).toBeTruthy();
  });

  it('efface la clôture quand on rouvre', async () => {
    const id = await creerTicket({ titre: 'Rouverte' }, SECRETAIRE);
    await changerStatut(id, RESOLU, CHEF_INFO);
    await changerStatut(id, EN_COURS, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    // Sans cela, un ticket rouvert resterait compté comme résolu.
    expect(t.resolu_at).toBeNull();
    expect(t.ferme_at).toBeNull();
  });

  it('traite « refusé » comme une clôture, pas comme une résolution manquée', async () => {
    const id = await creerTicket({ titre: 'Refusée' }, SECRETAIRE);
    await changerStatut(id, REFUSE, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.ferme_at).toBeTruthy();
  });

  it('ne trace rien quand le statut ne change pas', async () => {
    const id = await creerTicket({ titre: 'Immobile' }, SECRETAIRE);
    await changerStatut(id, A_TRAITER, CHEF_INFO);
    const traces = base
      .prepare(`SELECT COUNT(*) as cnt FROM ticket_history WHERE ticket_id = ? AND action = 'statut'`)
      .get(id) as any;
    expect(Number(traces.cnt)).toBe(0);
  });

  it('re-route la demande quand on la reclasse', async () => {
    const id = await creerTicket({ titre: 'Mal classée', categorieId: CAT_INFO }, SECRETAIRE);
    expect((base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any).service_id).toBe(SERVICE_INFO);

    await modifierTicket(id, { categorieId: CAT_BATIMENT }, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.service_id).toBe(SERVICE_TECH);
    expect(t.visibilite_site).toBe(1);
  });

  it('laisse la réaffectation explicite l’emporter sur la catégorie', async () => {
    const id = await creerTicket({ titre: 'Reprise en main', categorieId: CAT_INFO }, SECRETAIRE);
    await modifierTicket(id, { categorieId: CAT_BATIMENT, technicienId: CHEF_INFO }, CHEF_INFO);
    const t = base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    expect(t.technicien_id).toBe(CHEF_INFO);
  });

  it('trace chaque champ qui bouge', async () => {
    const id = await creerTicket({ titre: 'Avant' }, SECRETAIRE);
    await modifierTicket(id, { titre: 'Après', priorite: 'haute' }, CHEF_INFO);
    const traces = base
      .prepare(`SELECT champ FROM ticket_history WHERE ticket_id = ? AND action = 'modification'`)
      .all(id) as any[];
    expect(traces.map((t) => t.champ).sort()).toEqual(['priorité', 'titre']);
  });
});

describe('Le fil', () => {
  it('mêle événements et messages dans un seul ordre chronologique', async () => {
    const id = await creerTicket({ titre: 'Conversation' }, SECRETAIRE);
    await ajouterMessage(id, { body: 'Bonjour, rien ne marche' }, SECRETAIRE);
    await changerStatut(id, EN_COURS, CHEF_INFO);
    await ajouterMessage(id, { body: 'Je regarde' }, CHEF_INFO);

    const fil = await filUnifie(id, true);
    expect(fil.map((l) => l.type)).toEqual(['evenement', 'message', 'evenement', 'message']);
    expect(fil[0].action).toBe('ouverture');
    expect(fil[3].body).toBe('Je regarde');
  });

  it('cache les notes internes au demandeur', async () => {
    const id = await creerTicket({ titre: 'Avec note' }, SECRETAIRE);
    await ajouterMessage(id, { body: 'Visible de tous' }, CHEF_INFO);
    await ajouterMessage(id, { body: 'À commander chez X, 3 semaines', interne: true }, CHEF_INFO);

    const pourLeDemandeur = await filUnifie(id, false);
    const pourLIntervenant = await filUnifie(id, true);

    expect(pourLeDemandeur.filter((l) => l.type === 'message')).toHaveLength(1);
    expect(pourLIntervenant.filter((l) => l.type === 'message')).toHaveLength(2);
    expect(JSON.stringify(pourLeDemandeur)).not.toContain('3 semaines');
  });

  it('rend les pièces d’un message avec ce message, et non à part', async () => {
    const id = await creerTicket({ titre: 'Avec photo' }, SECRETAIRE);
    const messageId = await ajouterMessage(id, { body: 'Voici la photo' }, SECRETAIRE);
    base
      .prepare(
        `INSERT INTO ticket_documents (ticket_id, message_id, name, file_path, mime_type, size)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, messageId, 'fuite.jpg', '/uploads/fuite.jpg', 'image/jpeg', 12345);

    const fil = await filUnifie(id, true);
    const message = fil.find((l) => l.type === 'message')!;
    expect(message.pieces).toHaveLength(1);
    expect(message.pieces![0].nom).toBe('fuite.jpg');
  });

  it('nomme ce qu’une modification a changé, au lieu d’en montrer l’identifiant', async () => {
    const id = await creerTicket({ titre: 'Réaffectée', categorieId: CAT_INFO }, SECRETAIRE);
    await modifierTicket(id, { technicienId: CHEF_TECH, serviceId: SERVICE_TECH, siteId: MAIRIE }, CHEF_INFO);

    const fil = await filUnifie(id, true);
    const trace = (champ: string) => fil.find((l) => l.action === 'modification' && l.champ === champ)!;
    expect([trace('technicien').ancienne, trace('technicien').nouvelle]).toEqual(['Ines Info', 'Tom Tech']);
    expect([trace('service').ancienne, trace('service').nouvelle]).toEqual(['Informatique', 'Technique']);
    expect([trace('bâtiment').ancienne, trace('bâtiment').nouvelle]).toEqual([null, 'Mairie']);
  });

  it('garde le numéro d’une référence supprimée depuis, en le disant', async () => {
    const id = await creerTicket({ titre: 'Technicien parti' }, SECRETAIRE);
    base
      .prepare(
        `INSERT INTO ticket_history (ticket_id, user_id, action, sequence, champ, ancienne_valeur, nouvelle_valeur)
         VALUES (?, ?, 'modification', 99, 'technicien', '', '999')`
      )
      .run(id, CHEF_INFO);

    const fil = await filUnifie(id, true);
    expect(fil.find((l) => l.champ === 'technicien')!.nouvelle).toBe('n° 999 (supprimé)');
  });

  it('refuse un message vide', async () => {
    const id = await creerTicket({ titre: 'Rien à dire' }, SECRETAIRE);
    await expect(ajouterMessage(id, { body: '  ' }, SECRETAIRE)).rejects.toBeInstanceOf(SaisieInvalide);
  });
});

describe('La file', () => {
  const sansPortee = { sql: '', params: [] };

  it('compte les demandes de chaque statut, y compris à zéro', async () => {
    const compteurs = await compteursParStatut(sansPortee);
    // Une colonne dont les lignes apparaissent et disparaissent est illisible.
    expect(compteurs).toHaveLength(6);
    expect(compteurs.every((c) => typeof c.total === 'number')).toBe(true);
    expect(compteurs.find((c) => c.nom === 'À traiter')!.total).toBeGreaterThan(0);
  });

  it('cherche aussi sur le numéro affiché', async () => {
    const id = await creerTicket({ titre: 'Recherchable' }, SECRETAIRE);
    const trouves = await listerTickets(sansPortee, { recherche: referenceDe(id) });
    expect(trouves.map((t: any) => t.id)).toContain(id);
  });

  it('sépare les demandes ouvertes des demandes closes', async () => {
    const id = await creerTicket({ titre: 'À clore' }, SECRETAIRE);
    await changerStatut(id, RESOLU, CHEF_INFO);

    const ouvertes = await listerTickets(sansPortee, { ouverts: true, limite: 500 });
    const closes = await listerTickets(sansPortee, { ouverts: false, limite: 500 });

    expect(ouvertes.map((t: any) => t.id)).not.toContain(id);
    expect(closes.map((t: any) => t.id)).toContain(id);
  });

  it('joint les libellés dont la liste a besoin', async () => {
    const id = await creerTicket(
      { titre: 'Complète', categorieId: CAT_BATIMENT, siteId: MAIRIE, objectId: 10 },
      SECRETAIRE
    );
    const [ligne] = await listerTickets(sansPortee, { recherche: 'Complète' });
    expect(ligne.id).toBe(id);
    expect(ligne.statut_nom).toBe('À traiter');
    expect(ligne.categorie_nom).toBe('Bâtiment');
    expect(ligne.site_nom).toBe('Mairie');
    expect(ligne.objet_nom).toBe('Nemo');
  });
});
describe('Ce qu’on attribue à quelqu’un', () => {
  /*
   * La première version proposait **tout** à qui n'avait rien, pour que le
   * module serve avant d'être configuré. C'était un mauvais calcul : un agent
   * d'accueil n'a pas à choisir entre les douze bâtiments de la commune, et
   * présenter une liste où presque tout est faux garantit qu'on s'y trompe.
   *
   * Ces tests figent l'inverse — et la contrepartie est assumée : l'écran
   * d'attribution signale nommément les comptes qui n'ont rien.
   */
  const OCCUPANT = 3; // Ali, simple occupant
  const DIRECTRICE = 4; // Tom, responsable d'un bâtiment

  beforeAll(() => {
    base.exec(`
      INSERT INTO user_sites (user_id, site_id, est_responsable, peut_voir_tickets, notifie)
      VALUES (${OCCUPANT}, ${MAIRIE}, 0, 0, 0),
             (${DIRECTRICE}, ${MAIRIE}, 1, 1, 1);

      INSERT INTO user_ticket_categories (user_id, ticket_categorie_id)
      VALUES (${OCCUPANT}, ${CAT_INFO});

      INSERT INTO user_materiels (user_id, object_id) VALUES (${OCCUPANT}, 10);
    `);
  });

  it('ne propose aucun bâtiment à qui n’en a aucun', async () => {
    // SECRETAIRE n'est rattachée à rien.
    expect(await sitesProposesA(SECRETAIRE)).toEqual([]);
  });

  it('ne propose aucune catégorie à qui n’en a aucune', async () => {
    // Sans catégorie, cette personne ne peut ouvrir aucune demande : c'est
    // exactement ce que l'écran d'attribution doit signaler.
    expect(await categoriesProposeesA(SECRETAIRE)).toEqual([]);
  });

  it('ne propose que les bâtiments rattachés', async () => {
    const proposes = await sitesProposesA(OCCUPANT);
    expect(proposes).toHaveLength(1);
    expect(proposes[0].id).toBe(MAIRIE);
  });

  it('ne propose que les catégories attribuées, sous-catégories comprises', async () => {
    const proposees = await categoriesProposeesA(OCCUPANT);
    const noms = proposees.map((c) => c.nom);

    expect(noms).toContain('Informatique');
    // « Bâtiment » ne lui a pas été attribuée.
    expect(noms).not.toContain('Bâtiment');
    // Rattacher à « Informatique » sans donner ses sous-catégories serait un
    // piège à administrateur : elles suivent.
    expect(noms).toContain('Écran');
  });

  it('distingue le simple occupant du responsable', async () => {
    const occupant = await sitesDe(OCCUPANT);
    const directrice = await sitesDe(DIRECTRICE);

    // L'occupant est rattaché — c'est ce qui pré-remplit son bâtiment quand il
    // signale une panne sur son poste — sans pouvoir signaler pour le bâtiment
    // ni lire les demandes de ses collègues.
    expect(occupant[0].estResponsable).toBe(false);
    expect(occupant[0].peutVoirTickets).toBe(false);
    expect(occupant[0].notifie).toBe(false);

    expect(directrice[0].estResponsable).toBe(true);
    expect(directrice[0].peutVoirTickets).toBe(true);
    expect(directrice[0].notifie).toBe(true);
  });

  it('ne rend que le matériel attribué à la personne', async () => {
    expect((await materielsDe(OCCUPANT)).map((m) => m.id)).toEqual([10]);
    // La directrice n'a pas de matériel attribué : elle n'hérite pas de celui
    // des occupants de son bâtiment.
    expect(await materielsDe(DIRECTRICE)).toEqual([]);
  });

  it('restreint le matériel au parc que la catégorie propose', async () => {
    // Le Nemo est en catégorie de parc 2 (Outillage) ; une demande
    // « Informatique » qui ne propose que la catégorie 1 ne doit pas le rendre.
    const filtreInformatique = { sql: ' AND o.category_id = ?', params: [1] };
    expect(await materielsDe(OCCUPANT, filtreInformatique)).toEqual([]);

    const filtreOutillage = { sql: ' AND o.category_id = ?', params: [2] };
    expect((await materielsDe(OCCUPANT, filtreOutillage)).map((m) => m.id)).toEqual([10]);
  });
});
