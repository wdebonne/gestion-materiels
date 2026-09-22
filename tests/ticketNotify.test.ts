import type BetterSqlite3 from 'better-sqlite3';

/**
 * Qui est prévenu d'une demande, et pourquoi.
 *
 * Deux propriétés valent d'être figées, et elles tirent chacune la leçon d'un
 * défaut constaté ailleurs.
 *
 * **Les règles ajoutent, elles ne remplacent pas.** Faire gagner la règle la
 * plus précise retirerait le technicien attitré dès qu'une règle de bâtiment
 * s'applique — « une fuite à la mairie » préviendrait le responsable de la
 * maintenance *à la place* de celui qui doit intervenir.
 *
 * **Une personne sans compte reste joignable.** L'élu chargé des travaux figure
 * à l'annuaire avec `can_login = 0`. La grille par rôle l'écarte à dessein — les
 * liens du message mèneraient à un écran de connexion — mais une règle qui le
 * nomme doit l'atteindre : on lui écrit qu'il y a une fuite, pas qu'il doit se
 * connecter.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseNotifTickets = sqlite;

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

// Les envois ne partent pas : ces tests regardent la liste des destinataires,
// pas le contenu des courriels.
jest.mock('../src/services/email.service', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/log.service', () => ({ logService: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../src/services/webhook.service', () => ({ notifierWebhooks: jest.fn().mockResolvedValue(undefined) }));

import { destinatairesMotives, destinatairesParRegles, simulerDestinataires } from '../src/services/ticketNotify.service';
import { enregistrerDefauts, enregistrerPreference } from '../src/services/notificationPreferences.service';

const base: BetterSqlite3.Database = (global as any).__baseNotifTickets;

const DEMANDEUR = 1;
const TECHNICIEN = 2;
const CHEF_MAINTENANCE = 3;
const ELU = 4; // sans compte : can_login = 0
const SUPERVISEUR = 5;

const SERVICE_TECH = 1;
const MAIRIE = 1;
const SALLE = 2;
const CAT_BATIMENT = 1;

/** Une demande telle que `notifier()` la lit, sans passer par la base. */
const demande = (surcharge: Record<string, any> = {}) => ({
  id: 1,
  categorie_id: CAT_BATIMENT,
  sous_categorie_id: null,
  site_id: MAIRIE,
  service_id: SERVICE_TECH,
  service_nom: 'Technique',
  demandeur_id: DEMANDEUR,
  technicien_id: TECHNICIEN,
  ...surcharge,
});

beforeAll(() => {
  base.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
      role VARCHAR(50), is_active INTEGER DEFAULT 1, can_login INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(255), email VARCHAR(255));
    CREATE TABLE service_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, user_id INTEGER, is_manager INTEGER DEFAULT 0
    );
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key VARCHAR(100) UNIQUE, setting_value TEXT,
      setting_type VARCHAR(20), description VARCHAR(500), created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event VARCHAR(60),
      enabled INTEGER, created_at DATETIME, updated_at DATETIME, UNIQUE(user_id, event)
    );
    CREATE TABLE ticket_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, user_id INTEGER, service_id INTEGER
    );
    CREATE TABLE ticket_notification_regles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evenement VARCHAR(60), categorie_id INTEGER, sous_categorie_id INTEGER,
      site_id INTEGER, service_id INTEGER,
      destinataire_type VARCHAR(20) NOT NULL,
      destinataire_user_id INTEGER, destinataire_service_id INTEGER, destinataire_role VARCHAR(50),
      libelle VARCHAR(255), is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER, created_at DATETIME, updated_at DATETIME
    );
  `);

  base.exec(`
    INSERT INTO users (id, email, first_name, last_name, role, can_login) VALUES
      (${DEMANDEUR}, 'gardien@ville.fr', 'Gil', 'Gardien', 'user', 1),
      (${TECHNICIEN}, 'tech@ville.fr', 'Tom', 'Tech', 'agent', 1),
      (${CHEF_MAINTENANCE}, 'maint@ville.fr', 'Max', 'Maintenance', 'supervisor', 1),
      (${ELU}, 'elu@ville.fr', 'Eve', 'Elue', 'user', 0),
      (${SUPERVISEUR}, 'super@ville.fr', 'Sup', 'Erviseur', 'supervisor', 1);

    INSERT INTO services (id, name, email) VALUES (${SERVICE_TECH}, 'Technique', 'technique@ville.fr');
    INSERT INTO service_members (service_id, user_id) VALUES (${SERVICE_TECH}, ${TECHNICIEN});
  `);
});

afterEach(() => {
  base.exec('DELETE FROM ticket_notification_regles; DELETE FROM notification_preferences; DELETE FROM settings; DELETE FROM ticket_watchers;');
});

describe('Le socle des concernés', () => {
  it('prévient le demandeur, le technicien et le service', async () => {
    const adresses = (await destinatairesMotives(demande(), 'ticket_nouveau', null)).map((d) => d.email);
    expect(adresses).toEqual(
      expect.arrayContaining(['gardien@ville.fr', 'tech@ville.fr', 'technique@ville.fr'])
    );
  });

  it('n’écrit pas à l’auteur de l’action', async () => {
    // Se faire notifier de son propre message est le défaut le plus sûr pour
    // qu'on cesse de lire ses courriels.
    const adresses = (await destinatairesMotives(demande(), 'ticket_message', TECHNICIEN)).map((d) => d.email);
    expect(adresses).not.toContain('tech@ville.fr');
    expect(adresses).toContain('gardien@ville.fr');
  });

  it('prévient qui est en copie', async () => {
    base.prepare('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES (1, ?)').run(CHEF_MAINTENANCE);
    const motives = await destinatairesMotives(demande(), 'ticket_nouveau', null);
    expect(motives.find((d) => d.email === 'maint@ville.fr')?.raison).toBe('en copie');
  });

  it('dit pourquoi chacun reçoit', async () => {
    const motives = await destinatairesMotives(demande(), 'ticket_nouveau', null);
    expect(motives.find((d) => d.email === 'gardien@ville.fr')?.raison).toBe('demandeur');
    expect(motives.find((d) => d.email === 'tech@ville.fr')?.raison).toBe('technicien affecté');
  });
});

describe('Les règles de diffusion', () => {
  /** Une règle « fuite à la mairie prévient le responsable maintenance ». */
  function reglerMairie(colonnes: Record<string, any> = {}) {
    const valeurs = {
      evenement: null,
      categorie_id: CAT_BATIMENT,
      site_id: MAIRIE,
      destinataire_type: 'user',
      destinataire_user_id: CHEF_MAINTENANCE,
      libelle: 'Responsable maintenance',
      ...colonnes,
    };
    base
      .prepare(
        `INSERT INTO ticket_notification_regles
           (evenement, categorie_id, sous_categorie_id, site_id, service_id,
            destinataire_type, destinataire_user_id, destinataire_service_id, destinataire_role,
            libelle, is_active)
         VALUES (@evenement, @categorie_id, NULL, @site_id, NULL, @destinataire_type,
                 @destinataire_user_id, NULL, NULL, @libelle, 1)`
      )
      .run(valeurs);
  }

  it('ajoute un destinataire sans retirer le technicien attitré', async () => {
    reglerMairie();
    const adresses = (await destinatairesMotives(demande(), 'ticket_nouveau', null)).map((d) => d.email);

    // C'est la propriété centrale : ajouter n'est pas remplacer.
    expect(adresses).toContain('maint@ville.fr');
    expect(adresses).toContain('tech@ville.fr');
    expect(adresses).toContain('gardien@ville.fr');
  });

  it('ne s’applique pas hors de sa portée', async () => {
    reglerMairie();
    const ailleurs = await destinatairesParRegles(demande({ site_id: SALLE }), 'ticket_nouveau');
    expect(ailleurs).toHaveLength(0);
  });

  it('vaut pour tous les événements quand l’événement est vide', async () => {
    reglerMairie({ evenement: null });
    for (const evenement of ['ticket_nouveau', 'ticket_message', 'ticket_resolu']) {
      const trouves = await destinatairesParRegles(demande(), evenement);
      expect(trouves.map((d) => d.email)).toContain('maint@ville.fr');
    }
  });

  it('se limite à un seul événement quand il est précisé', async () => {
    reglerMairie({ evenement: 'ticket_resolu' });
    expect(await destinatairesParRegles(demande(), 'ticket_nouveau')).toHaveLength(0);
    expect((await destinatairesParRegles(demande(), 'ticket_resolu')).map((d) => d.email)).toContain(
      'maint@ville.fr'
    );
  });

  it('vaut pour tout un bâtiment quand la catégorie est vide', async () => {
    reglerMairie({ categorie_id: null });
    const autreCategorie = await destinatairesParRegles(demande({ categorie_id: 99 }), 'ticket_nouveau');
    expect(autreCategorie.map((d) => d.email)).toContain('maint@ville.fr');
  });

  it('atteint une personne sans compte, que la grille par rôle écarte', async () => {
    reglerMairie({ destinataire_user_id: ELU, libelle: 'Élu aux travaux' });
    const motives = await destinatairesParRegles(demande(), 'ticket_nouveau');

    // `can_login = 0` : `destinatairesParRole` l'écarterait, une règle qui le
    // nomme ne doit pas.
    expect(motives.map((d) => d.email)).toContain('elu@ville.fr');
    expect(motives.find((d) => d.email === 'elu@ville.fr')?.raison).toBe('Élu aux travaux');
  });

  it('ne s’applique pas si elle est désactivée', async () => {
    reglerMairie();
    base.prepare('UPDATE ticket_notification_regles SET is_active = 0').run();
    expect(await destinatairesParRegles(demande(), 'ticket_nouveau')).toHaveLength(0);
  });

  it('nomme sa raison par son libellé, ou par son numéro à défaut', async () => {
    reglerMairie({ libelle: null });
    const motives = await destinatairesParRegles(demande(), 'ticket_nouveau');
    expect(motives[0].raison).toMatch(/^règle n° \d+$/);
  });

  it('prévient tout un rôle quand la règle le vise', async () => {
    base
      .prepare(
        `INSERT INTO ticket_notification_regles (evenement, site_id, destinataire_type, destinataire_role, is_active)
         VALUES (NULL, ?, 'role', 'supervisor', 1)`
      )
      .run(MAIRIE);
    const adresses = (await destinatairesParRegles(demande(), 'ticket_nouveau')).map((d) => d.email);
    expect(adresses).toEqual(expect.arrayContaining(['maint@ville.fr', 'super@ville.fr']));
    // L'élu est `user`, et sans compte : il n'entre pas par cette porte.
    expect(adresses).not.toContain('elu@ville.fr');
  });
});

describe('Les préférences de chacun', () => {
  it('laissent couper un avis ordinaire', async () => {
    await enregistrerPreference(TECHNICIEN, 'ticket_message', false);

    const motives = await destinatairesMotives(demande(), 'ticket_message', null);
    const { filtrerSelonPreferences } = await import('../src/services/notificationPreferences.service');
    const adresses = await filtrerSelonPreferences(motives, 'ticket_message');

    expect(adresses).not.toContain('tech@ville.fr');
    expect(adresses).toContain('gardien@ville.fr');
  });

  it('refusent de couper une demande qu’on vous confie', async () => {
    // Sans cet avis, une demande confiée attendrait sans que son destinataire
    // le sache, et son demandeur n'aurait aucun moyen de s'en apercevoir.
    const resultat = await enregistrerPreference(TECHNICIEN, 'ticket_assigne', false);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.message).toContain('attendrait');
  });
});

describe('La simulation', () => {
  it('rend qui recevrait, et pourquoi, sans rien envoyer', async () => {
    base
      .prepare(
        `INSERT INTO ticket_notification_regles (evenement, site_id, destinataire_type, destinataire_user_id, libelle, is_active)
         VALUES (NULL, ?, 'user', ?, 'Élu aux travaux', 1)`
      )
      .run(MAIRIE, ELU);

    const resultat = await simulerDestinataires({ evenement: 'ticket_nouveau', siteId: MAIRIE });
    const elu = resultat.find((d) => d.email === 'elu@ville.fr');

    expect(elu).toBeDefined();
    expect(elu!.raison).toBe('Élu aux travaux');
  });

  it('tient compte de la grille par rôle', async () => {
    await enregistrerDefauts(
      { ticket_echeance: { roles: ['supervisor'], services: true } } as any,
      'ticket'
    );
    const resultat = await simulerDestinataires({ evenement: 'ticket_echeance' });
    expect(resultat.map((d) => d.email)).toEqual(
      expect.arrayContaining(['maint@ville.fr', 'super@ville.fr'])
    );
  });

  it('ne range pas les réglages de demande sous la clé des manifestations', async () => {
    await enregistrerDefauts({ ticket_echeance: { roles: [], services: false } } as any, 'ticket');
    const cles = base.prepare('SELECT setting_key FROM settings').all() as Array<{ setting_key: string }>;
    expect(cles.map((c) => c.setting_key)).toContain('ticket_notification_defaults');
    expect(cles.map((c) => c.setting_key)).not.toContain('manifestation_notification_defaults');
  });
});
