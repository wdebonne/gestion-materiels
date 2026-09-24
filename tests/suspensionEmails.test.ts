/**
 * Les envois automatiques, et ce qui les retient.
 *
 * Le chargement d'un jeu de test a produit des milliers de tickets dont
 * l'échéance était déjà passée : au premier passage de la vérification, un
 * avis est parti pour chacun — vers les comptes `@charge.test`, en autant
 * d'erreurs dans les journaux, et vers les vrais administrateurs désignés par
 * les règles de diffusion. Deux garde-fous le couvrent, figés ici.
 */

const envoyes: Array<{ to: string; subject: string }> = [];

jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: async (message: { to: string; subject: string }) => {
      envoyes.push({ to: message.to, subject: message.subject });
    },
  }),
}));

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key TEXT UNIQUE, setting_value TEXT,
      setting_type TEXT, description TEXT);
    CREATE TABLE smtp_config (id INTEGER PRIMARY KEY, host TEXT, port INTEGER, secure INTEGER, username TEXT,
      password TEXT, from_email TEXT, from_name TEXT, is_active INTEGER);
    INSERT INTO smtp_config VALUES (1, 'smtp.exemple.fr', 587, 0, 'u', 'p', 'parc@mairie.fr', 'Parc', 1);
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY, name TEXT, subject TEXT, body TEXT, is_active INTEGER);
    INSERT INTO email_templates (name, subject, body, is_active) VALUES
      ('password_reset', 'Mot de passe', 'Lien', 1), ('ticket_echeance', 'Échéance', 'Ticket', 1);
  `);
  return {
    db: {
      getType: () => 'sqlite',
      async query(sql: string, params: any[] = []) {
        return sqlite.prepare(sql).all(...params);
      },
      async queryOne(sql: string, params: any[] = []) {
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      async execute(sql: string, params: any[] = []) {
        const r = sqlite.prepare(sql).run(...params);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
      },
    },
  };
});

import {
  adresseReservee,
  definirSuspension,
  etatSuspension,
  sendEmail,
  sendEmailRaw,
} from '../src/services/email.service';

beforeEach(async () => {
  envoyes.length = 0;
  await definirSuspension(null);
});

describe('domaines réservés aux essais', () => {
  it.each([
    ['loic.lemaitre.328@charge.test', true],
    ['contact@example.com', true],
    ['x@sous.example.org', true],
    ['x@serveur.invalid', true],
    ['agent@ville-pavilly.fr', false],
    ['x@test.fr', false],
    ['x@contest.com', false],
  ])('%s → %s', (adresse, attendu) => {
    expect(adresseReservee(adresse)).toBe(attendu);
  });

  it("n'écrit jamais à une adresse réservée, et garde les autres destinataires", async () => {
    await sendEmailRaw({ to: 'a.b.1@charge.test', subject: 's', html: 'h' });
    expect(envoyes).toEqual([]);

    await sendEmailRaw({ to: 'a.b.1@charge.test, agent@mairie.fr', subject: 's', html: 'h' });
    expect(envoyes).toEqual([{ to: 'agent@mairie.fr', subject: 's' }]);
  });
});

describe('suspension des envois automatiques', () => {
  it('retient les notifications tant que la suspension est posée', async () => {
    await definirSuspension('donnees_test');
    await sendEmail('ticket_echeance', 'admin@mairie.fr', {});
    expect(envoyes).toEqual([]);

    await definirSuspension(null);
    await sendEmail('ticket_echeance', 'admin@mairie.fr', {});
    expect(envoyes).toHaveLength(1);
  });

  it('laisse partir le mot de passe oublié : la personne vient de le demander', async () => {
    await definirSuspension('manuel');
    await sendEmail('password_reset', 'agent@mairie.fr', {});
    expect(envoyes).toEqual([{ to: 'agent@mairie.fr', subject: 'Mot de passe' }]);
  });

  it("relit l'état écrit par l'écran des réglages", async () => {
    await definirSuspension('manuel');
    expect(await etatSuspension()).toBe('manuel');
    await definirSuspension(null);
    expect(await etatSuspension()).toBeNull();
  });
});
