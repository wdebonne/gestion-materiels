import type BetterSqlite3 from 'better-sqlite3';

/**
 * Les agendas de lieu, publiés à qui on en donne l'adresse.
 *
 * Quatre choses se cassent sans bruit, et ce sont elles qu'on fige.
 *
 *   **Un `UID` instable duplique tout.** Un client d'agenda identifie un
 *   événement par son `UID` : s'il change à chaque rafraîchissement, la salle
 *   se retrouve occupée dix fois par le même mariage, et personne ne comprend
 *   d'où viennent les doublons. C'est le piège que `uidDe` documente déjà pour
 *   les événements du parc.
 *
 *   **L'agenda d'une pièce doit dire quand elle est réellement prise.** Si la
 *   mairie entière est réservée pour les élections, la salle des mariages l'est
 *   aussi. Un flux qui ne lit que `piece_id = ?` l'afficherait libre ce jour-là,
 *   et quelqu'un la promettrait.
 *
 *   **Un créneau annulé doit disparaître.** L'y laisser en le marquant
 *   « annulé » ferait qu'on continue de croire la salle prise.
 *
 *   **Un jeton révoqué vaut un jeton inconnu.** Répondre autre chose qu'un 404
 *   confirmerait à qui a gardé l'URL que la salle existe et qu'il avait bien
 *   l'adresse.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseAgenda = sqlite;

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
  creerJetonAgenda,
  fluxDuLieu,
  jetonsDuSite,
  lieuDuJeton,
  revoquerJetonAgenda,
  uidOccupation,
} from '../src/services/agendaLieu.service';

const base: BetterSqlite3.Database = (global as any).__baseAgenda;

const MAIRIE = 1;
const SALLE_DES_MARIAGES = 1;

/** Un jour du mois prochain : le flux ne publie qu'une fenêtre autour d'aujourd'hui. */
function bientot(heureDebut: number, heureFin: number): { debut: string; fin: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 15);
  const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
  return {
    debut: `${jour} ${String(heureDebut).padStart(2, '0')}:00:00`,
    fin: `${jour} ${String(heureFin).padStart(2, '0')}:00:00`,
  };
}

beforeAll(() => {
  base.exec(`
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
    CREATE TABLE site_pieces (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, name VARCHAR(255)
    );
    CREATE TABLE lieu_occupations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL, piece_id INTEGER, manifestation_id INTEGER,
      titre VARCHAR(255) NOT NULL, debut DATETIME NOT NULL, fin DATETIME NOT NULL,
      statut VARCHAR(20) NOT NULL DEFAULT 'confirme',
      demandeur VARCHAR(255), notes TEXT, created_by INTEGER,
      created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE lieu_jetons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL, piece_id INTEGER,
      token VARCHAR(32) NOT NULL UNIQUE, label VARCHAR(255),
      revoked_at DATETIME, created_by INTEGER, created_at DATETIME
    );

    INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie');
    INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages'), (2, 1, 'Hall');
  `);
});

afterEach(() => base.exec('DELETE FROM lieu_occupations; DELETE FROM lieu_jetons;'));

const occuper = (pieceId: number | null, titre: string, statut = 'confirme') => {
  const { debut, fin } = bientot(16, 18);
  base
    .prepare(
      `INSERT INTO lieu_occupations (site_id, piece_id, titre, debut, fin, statut)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(MAIRIE, pieceId, titre, debut, fin, statut);
};

describe('Ouvrir et retirer un abonnement', () => {
  it('tire un jeton long, puisqu’il n’est pas imprimé sur une étiquette', async () => {
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, label: 'Régisseur' });

    // Vingt-deux caractères, là où l'étiquette d'un trousseau en tient huit :
    // cette adresse ouvre un flux de données, pas une page presque muette.
    expect(jeton.token).toHaveLength(22);
    expect(jeton.token).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });

  it('donne un jeton par destinataire, pour pouvoir n’en retirer qu’un', async () => {
    const regisseur = await creerJetonAgenda({ siteId: MAIRIE, label: 'Régisseur' });
    const asso = await creerJetonAgenda({ siteId: MAIRIE, label: 'Amicale du préau' });
    expect(regisseur.token).not.toBe(asso.token);

    await revoquerJetonAgenda(asso.id);

    // L'abonnement du régisseur n'a pas bougé : c'est toute la raison d'avoir
    // plusieurs jetons plutôt qu'un seul à régénérer.
    expect(await lieuDuJeton(regisseur.token)).not.toBeNull();
    expect(await lieuDuJeton(asso.token)).toBeNull();
  });

  it('garde la trace d’un abonnement révoqué', async () => {
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, label: 'Ancien prestataire' });
    await revoquerJetonAgenda(jeton.id);

    // « Qui avait accès en septembre » se pose après coup : une ligne effacée
    // n'y répondrait pas.
    const liste = await jetonsDuSite(MAIRIE);
    expect(liste).toHaveLength(1);
    expect(liste[0].label).toBe('Ancien prestataire');
    expect(liste[0].revoked_at).not.toBeNull();
  });

  it('ne connaît pas un jeton inventé', async () => {
    expect(await lieuDuJeton('JETONQUINEXISTEPASXX')).toBeNull();
    expect(await lieuDuJeton('')).toBeNull();
  });
});

describe('Le flux publié', () => {
  it('est un VCALENDAR nommé, avec un VEVENT par créneau', async () => {
    occuper(SALLE_DES_MARIAGES, 'Mariage Dupont');
    occuper(SALLE_DES_MARIAGES, 'Conseil municipal');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);

    expect(flux).toMatch(/^BEGIN:VCALENDAR/);
    expect(flux.trimEnd()).toMatch(/END:VCALENDAR$/);
    expect(flux.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // Sans `X-WR-CALNAME`, trois salles s'affichent sous trois lignes
    // indiscernables dans la liste des agendas de l'abonné.
    expect(flux).toContain('X-WR-CALNAME:Salle des Mariages — Mairie');
    expect(flux).toContain('SUMMARY:Mariage Dupont');
    // Les lignes iCalendar se terminent par CRLF, la norme est stricte là-dessus.
    expect(flux).toContain('\r\n');
  });

  it('garde le même UID d’un rafraîchissement à l’autre', async () => {
    occuper(SALLE_DES_MARIAGES, 'Mariage Dupont');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });
    const lieu = (await lieuDuJeton(jeton.token))!;

    const premier = (await fluxDuLieu(lieu)).match(/UID:(.+)/)?.[1];
    const second = (await fluxDuLieu(lieu)).match(/UID:(.+)/)?.[1];

    expect(premier).toBe(second);
    const id = base.prepare('SELECT id FROM lieu_occupations').get() as any;
    expect(premier).toBe(uidOccupation(id.id));
  });

  it('n’emploie pas le même espace de noms que les événements du parc', () => {
    // Un abonné aux deux flux verrait sinon les uns écraser les autres.
    expect(uidOccupation(1)).toBe('lieu-occupation-1@gestion-materiels');
    expect(uidOccupation(1)).not.toBe('gestmat-1@gestion-materiels');
  });

  /** La règle hiérarchique, vue depuis l'agenda. */
  it('montre le bâtiment entier occupé dans l’agenda de chacune de ses pièces', async () => {
    occuper(null, 'Élections municipales');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);

    // La salle est bel et bien prise ce jour-là : l'afficher libre ferait
    // promettre une salle occupée.
    expect(flux).toContain('SUMMARY:Élections municipales');
  });

  it('ne fait pas apparaître une autre pièce dans l’agenda d’une pièce', async () => {
    occuper(2, 'Exposition dans le hall');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    expect(flux).not.toContain('Exposition dans le hall');
    expect(flux).not.toContain('BEGIN:VEVENT');
  });

  it('publie tout le bâtiment quand le jeton porte sur le bâtiment', async () => {
    occuper(SALLE_DES_MARIAGES, 'Mariage Dupont');
    occuper(2, 'Exposition dans le hall');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: null });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    // C'est ce que veut le gardien d'une école : tout ce qui s'y passe.
    expect(flux.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('retire un créneau annulé, au lieu de le marquer', async () => {
    occuper(SALLE_DES_MARIAGES, 'Mariage annulé', 'annule');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    expect(flux).not.toContain('Mariage annulé');
    expect(flux).not.toContain('BEGIN:VEVENT');
  });

  it('signale ce qui n’est pas encore arbitré, sans le cacher', async () => {
    occuper(SALLE_DES_MARIAGES, 'Loto des écoles', 'demande');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    // Le créneau occupe l'agenda — il faut le voir — mais son intitulé dit
    // qu'il n'est pas acquis.
    expect(flux).toContain('SUMMARY:[À confirmer] Loto des écoles');
  });

  /**
   * Le piège du fuseau, figé.
   *
   * `versICalDateHeure` — celui de l'export CalDAV — passe par
   * `new Date(…).toISOString()`, et interprète donc l'heure stockée selon le
   * fuseau du **serveur**. Sur un poste réglé sur Paris le résultat est juste ;
   * dans un conteneur, où Node tourne en UTC faute de `TZ`, « 16:00 » partirait
   * en `160000Z` et s'afficherait 18:00 chez l'abonné. Le décalage ne se verrait
   * qu'en production, et sur chaque créneau.
   *
   * Le flux publie donc l'heure murale, sans `Z`. Le test tient quel que soit le
   * fuseau de la machine qui l'exécute — c'est tout l'intérêt.
   */
  it('publie l’heure murale, sans jamais passer par UTC', async () => {
    const { debut } = bientot(16, 18);
    occuper(SALLE_DES_MARIAGES, 'Mariage Dupont');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    const attendu = `${debut.slice(0, 10).replace(/-/g, '')}T160000`;

    expect(flux).toContain(`DTSTART:${attendu}`);
    // Pas de `Z` : une salle est prise de 16h à 18h, et cela ne dépend d'aucun
    // fuseau.
    expect(flux).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(flux).not.toMatch(/DTEND:\d{8}T\d{6}Z/);
  });

  it('dit où ça se passe, pour l’abonné qui suit plusieurs salles', async () => {
    occuper(SALLE_DES_MARIAGES, 'Mariage Dupont');
    const jeton = await creerJetonAgenda({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES });

    const flux = await fluxDuLieu((await lieuDuJeton(jeton.token))!);
    expect(flux).toContain('LOCATION:Salle des Mariages\\, Mairie');
  });
});
