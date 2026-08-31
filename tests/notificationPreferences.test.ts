import type BetterSqlite3 from 'better-sqlite3';

/**
 * Qui reçoit quoi, et qui peut en décider.
 *
 * Les réglages n'existaient qu'au niveau du service : un agent noyé sous les
 * messages ne pouvait rien y faire sans couper aussi ses collègues. Trois
 * niveaux se superposent désormais — défaut de la collectivité, réglage du
 * service, choix du compte — et ces tests protègent la seule exception qui
 * compte : ce qui **engage** son destinataire part toujours.
 *
 * Laisser quelqu'un couper une approbation qu'on attend de lui, c'est le laisser
 * bloquer une manifestation sans jamais le savoir.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseNotif = sqlite;

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
  EVENEMENTS_NOTIFICATION,
  destinatairesParRole,
  enregistrerDefauts,
  enregistrerPreference,
  filtrerSelonPreferences,
  lireDefauts,
  preferencesDe,
  servicesNotifies,
} from '../src/services/notificationPreferences.service';

const base: BetterSqlite3.Database = (global as any).__baseNotif;

beforeAll(() => {
  base.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key VARCHAR(100) UNIQUE,
      setting_value TEXT, setting_type VARCHAR(20), description VARCHAR(500),
      created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email VARCHAR(255), role VARCHAR(50), is_active INTEGER DEFAULT 1
    );
    CREATE TABLE notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event VARCHAR(50),
      enabled INTEGER DEFAULT 1, created_at DATETIME, updated_at DATETIME,
      UNIQUE(user_id, event)
    );
  `);

  base.exec(`
    INSERT INTO users (id, email, role) VALUES
      (1, 'admin@ville.fr', 'admin'),
      (2, 'super@ville.fr', 'supervisor'),
      (3, 'agent@ville.fr', 'agent'),
      (4, 'inactif@ville.fr', 'supervisor');
    UPDATE users SET is_active = 0 WHERE id = 4;
  `);
});

afterEach(() => {
  base.exec('DELETE FROM notification_preferences; DELETE FROM settings;');
});

describe('Catalogue des événements', () => {
  it('n’a que des identifiants uniques', () => {
    const ids = EVENEMENTS_NOTIFICATION.map((e) => e.evenement);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne déclare engageant que ce qui bloque réellement une manifestation', () => {
    // Élargir cette liste retirerait à chacun le droit de se taire ; la
    // restreindre laisserait quelqu'un bloquer sans le savoir.
    const engageants = EVENEMENTS_NOTIFICATION.filter((e) => e.engageant).map((e) => e.evenement);
    expect(engageants).toEqual(['approval_requested']);
  });

  it('décrit chaque événement, pour que l’écran n’ait rien à inventer', () => {
    for (const evenement of EVENEMENTS_NOTIFICATION) {
      expect(evenement.libelle.length).toBeGreaterThan(0);
      expect(evenement.description.length).toBeGreaterThan(0);
    }
  });
});

describe('Défauts de la collectivité', () => {
  it('part du catalogue quand rien n’est enregistré', async () => {
    const defauts = await lireDefauts();
    expect(defauts.new_request).toEqual({ roles: ['admin', 'supervisor'], services: true });
    expect(defauts.message).toEqual({ roles: [], services: true });
  });

  it('enregistre et relit un réglage', async () => {
    await enregistrerDefauts({ message: { roles: ['supervisor'], services: false } });

    const defauts = await lireDefauts();
    expect(defauts.message).toEqual({ roles: ['supervisor'], services: false });
  });

  it('complète par le catalogue un événement absent du réglage', async () => {
    // Ajouter un événement au code ne doit pas obliger à rouvrir l'écran pour
    // qu'il parte, ni le laisser muet sans que personne le remarque.
    await enregistrerDefauts({ message: { roles: [], services: false } });

    const defauts = await lireDefauts();
    expect(defauts.dates_changed).toEqual({ roles: ['admin', 'supervisor'], services: true });
  });

  it('écarte un rôle ou un événement inconnu', async () => {
    await enregistrerDefauts({
      message: { roles: ['supervisor', 'root' as any], services: true },
      evenement_disparu: { roles: ['admin'], services: true },
    } as any);

    const defauts = await lireDefauts();
    expect(defauts.message.roles).toEqual(['supervisor']);
    expect((defauts as any).evenement_disparu).toBeUndefined();
  });

  it('survit à un réglage corrompu', async () => {
    // Un JSON illisible ne doit pas rendre toutes les notifications muettes.
    base
      .prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('manifestation_notification_defaults', '{cassé')")
      .run();

    const defauts = await lireDefauts();
    expect(defauts.new_request.services).toBe(true);
  });

  it('dit si les services concernés reçoivent un événement', async () => {
    expect(await servicesNotifies('message')).toBe(true);

    await enregistrerDefauts({ message: { roles: [], services: false } });
    expect(await servicesNotifies('message')).toBe(false);
  });
});

describe('Destinataires au titre du rôle', () => {
  it('rend les comptes actifs des rôles réglés', async () => {
    const destinataires = await destinatairesParRole('new_request');
    expect(destinataires.map((d) => d.email).sort()).toEqual(['admin@ville.fr', 'super@ville.fr']);
  });

  it('écarte un compte désactivé', async () => {
    expect((await destinatairesParRole('new_request')).map((d) => d.email)).not.toContain('inactif@ville.fr');
  });

  it('ne rend personne quand aucun rôle n’est réglé', async () => {
    expect(await destinatairesParRole('message')).toEqual([]);
  });
});

describe('Choix de chacun', () => {
  it('enregistre un refus et le relit', async () => {
    expect(await enregistrerPreference(3, 'message', false)).toEqual({ ok: true });
    expect((await preferencesDe(3)).get('message')).toBe(false);
  });

  it('remplace un choix précédent plutôt que d’en empiler un second', async () => {
    await enregistrerPreference(3, 'message', false);
    await enregistrerPreference(3, 'message', true);

    expect(base.prepare('SELECT COUNT(*) c FROM notification_preferences WHERE user_id = 3').get())
      .toEqual({ c: 1 });
    expect((await preferencesDe(3)).get('message')).toBe(true);
  });

  it('refuse de couper ce qui engage, en disant pourquoi', async () => {
    const resultat = await enregistrerPreference(3, 'approval_requested', false);

    expect(resultat.ok).toBe(false);
    expect((resultat as any).message).toMatch(/bloqueriez une manifestation/);
    expect(await preferencesDe(3)).toEqual(new Map());
  });

  it('accepte de réactiver un événement engageant', async () => {
    // Le réactiver n'a rien de dangereux : c'est le couper qui l'est.
    expect(await enregistrerPreference(3, 'approval_requested', true)).toEqual({ ok: true });
  });

  it('refuse un événement inconnu', async () => {
    const resultat = await enregistrerPreference(3, 'evenement_invente', false);
    expect(resultat).toEqual({ ok: false, message: 'Événement inconnu' });
  });
});

describe('Filtrage des destinataires', () => {
  const destinataires = [
    { email: 'boite@service.fr' },
    { email: 'agent@ville.fr', userId: 3 },
    { email: 'super@ville.fr', userId: 2 },
  ];

  it('écarte celui qui a coupé cet événement', async () => {
    await enregistrerPreference(3, 'message', false);

    expect(await filtrerSelonPreferences(destinataires, 'message')).toEqual([
      'boite@service.fr',
      'super@ville.fr',
    ]);
  });

  it('garde celui qui n’a rien choisi', async () => {
    expect(await filtrerSelonPreferences(destinataires, 'message')).toHaveLength(3);
  });

  it('garde la boîte partagée, qui n’appartient à personne', async () => {
    // Elle est gouvernée par le réglage du service, pas par une préférence
    // individuelle qu'elle ne peut pas avoir.
    await enregistrerPreference(3, 'message', false);
    await enregistrerPreference(2, 'message', false);

    expect(await filtrerSelonPreferences(destinataires, 'message')).toEqual(['boite@service.fr']);
  });

  it('n’applique aucun filtre à un événement engageant', async () => {
    // Même en ayant tout coupé, une approbation attendue arrive.
    await enregistrerPreference(3, 'message', false);

    expect(await filtrerSelonPreferences(destinataires, 'approval_requested')).toHaveLength(3);
  });

  it('déduplique les adresses', async () => {
    const doublons = [
      { email: 'agent@ville.fr', userId: 3 },
      { email: 'agent@ville.fr', userId: 3 },
    ];
    expect(await filtrerSelonPreferences(doublons, 'message')).toEqual(['agent@ville.fr']);
  });

  it('ne lit les préférences d’un compte qu’une fois', async () => {
    // Le cache évite une requête par destinataire sur une liste longue.
    const nombreux = Array.from({ length: 20 }, () => ({ email: 'agent@ville.fr', userId: 3 }));
    expect(await filtrerSelonPreferences(nombreux, 'message')).toEqual(['agent@ville.fr']);
  });
});
