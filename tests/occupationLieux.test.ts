import type BetterSqlite3 from 'better-sqlite3';

/**
 * Les créneaux d'occupation des lieux, et ce qui se heurte.
 *
 * Trois règles portent tout le module, et chacune se casse en silence.
 *
 *   **Les bornes sont exclusives.** Une salle libérée à 18h est reprise à 18h.
 *   La règle voisine, celle du parc (`reservation.routes.ts`), est inclusive
 *   pour une raison tout aussi bonne — un matériel n'est pas rendu et repris
 *   dans la même seconde. Les deux fichiers se ressemblent assez pour que
 *   quelqu'un aligne un jour l'un sur l'autre, et le seul symptôme sera qu'on ne
 *   pourra plus enchaîner deux manifestations dans la même journée.
 *
 *   **Le conflit est hiérarchique.** Réserver la mairie entière doit heurter la
 *   salle des mariages, et réciproquement. Deux pièces différentes, non. Une
 *   erreur ici ne produit pas de plantage : elle produit un double prêt, qui se
 *   découvre le jour même.
 *
 *   **Une colonne DATE de MySQL n'est pas une chaîne.** Le pool n'a pas
 *   `dateStrings` : `date_start` revient en `Date` à minuit local, et le réflexe
 *   `toISOString()` rend la veille. Le décalage n'apparaît qu'en production, sur
 *   une seule journée.
 */

jest.mock('../src/database', () => {
  const Sqlite = require('better-sqlite3');
  const sqlite = new Sqlite(':memory:');
  (global as any).__baseOccupations = sqlite;

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
  bornesDeLaManifestation,
  avertissements,
  bloquants,
  conflitsDeLaManifestation,
  conflitsPour,
  creerOccupation,
  ecrireOccupationsDeLaManifestation,
  heureDe,
  jourDe,
  listerOccupations,
  manifestationsEnConflit,
} from '../src/services/occupationLieux.service';

const base: BetterSqlite3.Database = (global as any).__baseOccupations;

/** La mairie, deux de ses pièces, et une salle des fêtes à côté. */
const MAIRIE = 1;
const SALLE_DES_MARIAGES = 1;
const HALL = 2;

beforeAll(() => {
  base.exec(`
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
    CREATE TABLE site_pieces (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, name VARCHAR(255)
    );
    CREATE TABLE lieu_occupations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      piece_id INTEGER,
      manifestation_id INTEGER,
      titre VARCHAR(255) NOT NULL,
      debut DATETIME NOT NULL,
      fin DATETIME NOT NULL,
      statut VARCHAR(20) NOT NULL DEFAULT 'confirme',
      demandeur VARCHAR(255),
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME,
      updated_at DATETIME
    );

    INSERT INTO cle_sites (id, name) VALUES (1, 'Mairie'), (2, 'Salle des fêtes');
    INSERT INTO site_pieces (id, site_id, name) VALUES (1, 1, 'Salle des Mariages'), (2, 1, 'Hall');
  `);
});

afterEach(() => base.exec('DELETE FROM lieu_occupations;'));

/** Occupe un lieu le 28 septembre, de `h1` à `h2`. */
const occuper = (
  lieu: { siteId: number; pieceId?: number | null },
  h1: string,
  h2: string,
  extra: { statut?: any; titre?: string; manifestationId?: number } = {}
) =>
  creerOccupation({
    siteId: lieu.siteId,
    pieceId: lieu.pieceId ?? null,
    manifestationId: extra.manifestationId ?? null,
    titre: extra.titre ?? 'Mariage Dupont',
    debut: `2026-09-28 ${h1}:00`,
    fin: `2026-09-28 ${h2}:00`,
    statut: extra.statut ?? 'confirme',
  });

const heurte = async (
  lieu: { siteId: number; pieceId?: number | null },
  h1: string,
  h2: string
): Promise<number> =>
  (
    await conflitsPour({
      siteId: lieu.siteId,
      pieceId: lieu.pieceId ?? null,
      debut: `2026-09-28 ${h1}:00`,
      fin: `2026-09-28 ${h2}:00`,
    })
  ).length;

// ---------------------------------------------------------- bornes du créneau

describe('Les bornes d’un créneau sont exclusives', () => {
  beforeEach(async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');
  });

  /** Le cas qui justifie tout le fichier. */
  it('laisse enchaîner 18h–20h après un 16h–18h', async () => {
    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '18:00', '20:00')).toBe(0);
  });

  it('laisse aussi finir à 16h juste avant', async () => {
    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '14:00', '16:00')).toBe(0);
  });

  it('refuse en revanche un créneau qui mord', async () => {
    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00')).toBe(1);
  });

  it('refuse un créneau entièrement contenu', async () => {
    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:30', '17:30')).toBe(1);
  });

  it('refuse un créneau qui l’englobe', async () => {
    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '08:00', '23:00')).toBe(1);
  });
});

// ------------------------------------------------------- conflit hiérarchique

describe('Le conflit suit la hiérarchie des lieux', () => {
  it('le bâtiment entier occupé heurte chacune de ses pièces', async () => {
    await occuper({ siteId: MAIRIE, pieceId: null }, '16:00', '18:00', { titre: 'Élections' });

    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00')).toBe(1);
    expect(await heurte({ siteId: MAIRIE, pieceId: HALL }, '17:00', '19:00')).toBe(1);
  });

  it('une pièce occupée empêche de prêter le bâtiment entier', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');

    // On ne prête pas la mairie entière le jour d'un mariage.
    expect(await heurte({ siteId: MAIRIE, pieceId: null }, '17:00', '19:00')).toBe(1);
  });

  it('laisse deux pièces différentes vivre leur vie', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');

    expect(await heurte({ siteId: MAIRIE, pieceId: HALL }, '16:00', '18:00')).toBe(0);
  });

  it('ne fait pas déborder un bâtiment sur un autre', async () => {
    await occuper({ siteId: MAIRIE, pieceId: null }, '16:00', '18:00');

    expect(await heurte({ siteId: 2, pieceId: null }, '16:00', '18:00')).toBe(0);
  });
});

// ------------------------------------------------------------------- statuts

describe('Tous les créneaux ne bloquent pas de la même façon', () => {
  it('ignore une occupation annulée', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00', {
      statut: 'annule',
    });

    expect(await heurte({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00')).toBe(0);
  });

  it('signale une demande sans en faire un refus', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00', {
      statut: 'demande',
    });

    const conflits = await conflitsPour({
      siteId: MAIRIE,
      pieceId: SALLE_DES_MARIAGES,
      debut: '2026-09-28 16:00:00',
      fin: '2026-09-28 18:00:00',
    });

    // Elle se voit — mais c'est au superviseur de trancher entre deux
    // associations, pas au serveur.
    expect(conflits).toHaveLength(1);
    expect(bloquants(conflits)).toHaveLength(0);
    expect(avertissements(conflits)).toHaveLength(1);
  });

  it('nomme le lieu et le créneau du conflit, pour que l’écran puisse le dire', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');

    const [conflit] = await conflitsPour({
      siteId: MAIRIE,
      pieceId: SALLE_DES_MARIAGES,
      debut: '2026-09-28 17:00:00',
      fin: '2026-09-28 19:00:00',
    });

    expect(conflit.site_name).toBe('Mairie');
    expect(conflit.piece_name).toBe('Salle des Mariages');
    expect(conflit.titre).toBe('Mariage Dupont');
    expect(conflit.debut).toBe('2026-09-28 16:00:00');
  });

  it('ne fait pas se heurter un créneau avec lui-même quand on le déplace', async () => {
    const id = await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');

    const conflits = await conflitsPour({
      siteId: MAIRIE,
      pieceId: SALLE_DES_MARIAGES,
      debut: '2026-09-28 17:00:00',
      fin: '2026-09-28 19:00:00',
      ignorerId: id,
    });
    expect(conflits).toHaveLength(0);
  });
});

// --------------------------------------------------------- dates et horaires

describe('Composer un créneau depuis une manifestation', () => {
  /**
   * Le piège du `DATE` MySQL, figé.
   *
   * On construit un `Date` à minuit **local** — ce que rend mysql2 — et on
   * vérifie qu'on relit le même jour. `toISOString()` rendrait la veille partout
   * à l'est de Greenwich, et le test le dirait quel que soit le fuseau de la
   * machine qui l'exécute.
   */
  it('relit le bon jour d’un objet Date, sans passer par UTC', () => {
    const minuitLocal = new Date(2026, 8, 28, 0, 0, 0);
    expect(jourDe(minuitLocal)).toBe('2026-09-28');
  });

  it('lit aussi une chaîne, que rend SQLite', () => {
    expect(jourDe('2026-09-28')).toBe('2026-09-28');
    expect(jourDe('2026-09-28 16:00:00')).toBe('2026-09-28');
    expect(jourDe(null)).toBeNull();
    expect(jourDe('pas une date')).toBeNull();
  });

  it('accepte les heures telles que les formulaires les rendent', () => {
    expect(heureDe('16:00', '00:00:00')).toBe('16:00:00');
    expect(heureDe('16h00', '00:00:00')).toBe('16:00:00');
    expect(heureDe('9:05', '00:00:00')).toBe('09:05:00');
    expect(heureDe('', '23:59:59')).toBe('23:59:59');
    expect(heureDe('n’importe quoi', '00:00:00')).toBe('00:00:00');
    // Une heure impossible retombe sur le défaut plutôt que d'écrire 99:99.
    expect(heureDe('25:00', '00:00:00')).toBe('00:00:00');
  });

  it('occupe la journée entière quand aucune heure n’est saisie', () => {
    expect(bornesDeLaManifestation({ date_start: '2026-09-28' })).toEqual({
      debut: '2026-09-28 00:00:00',
      fin: '2026-09-28 23:59:59',
    });
  });

  it('couvre plusieurs jours quand la manifestation en dure plusieurs', () => {
    expect(
      bornesDeLaManifestation({
        date_start: '2026-09-28',
        date_end: '2026-09-30',
        start_time: '16:00',
        end_time: '18:00',
      })
    ).toEqual({ debut: '2026-09-28 16:00:00', fin: '2026-09-30 18:00:00' });
  });

  it('ne dit rien d’une manifestation sans date de début', () => {
    expect(bornesDeLaManifestation({ date_end: '2026-09-30' })).toBeNull();
  });
});

// ------------------------------------------------------- lien manifestation

describe('Les créneaux d’une manifestation', () => {
  const MANIF = 42;
  const manifestation = {
    title: 'Fête de la musique',
    date_start: '2026-09-28',
    start_time: '16:00',
    end_time: '18:00',
  };

  it('écrit un créneau par lieu retenu', async () => {
    const ecrits = await ecrireOccupationsDeLaManifestation(MANIF, manifestation, [
      { siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES },
      { siteId: MAIRIE, pieceId: HALL },
    ]);

    expect(ecrits).toBe(2);
    const siennes = await listerOccupations({ manifestationId: MANIF });
    expect(siennes.map((o) => o.piece_id).sort()).toEqual([SALLE_DES_MARIAGES, HALL].sort());
    expect(siennes[0].statut).toBe('demande');
  });

  it('remplace ses propres créneaux, et respecte ceux des autres', async () => {
    // Un mariage saisi à la main sur la même salle : il n'a rien à voir avec la
    // manifestation, et doit survivre à sa mise à jour.
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '08:00', '10:00');

    await ecrireOccupationsDeLaManifestation(MANIF, manifestation, [
      { siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES },
      { siteId: MAIRIE, pieceId: HALL },
    ]);
    // On retire le hall de la demande.
    await ecrireOccupationsDeLaManifestation(MANIF, manifestation, [
      { siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES },
    ]);

    expect(await listerOccupations({ manifestationId: MANIF })).toHaveLength(1);
    // Le mariage est toujours là.
    expect(await listerOccupations({ siteId: MAIRIE })).toHaveLength(2);
  });

  it('remonte les conflits de la manifestation sans se compter elle-même', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00', {
      titre: 'Mariage Dupont',
    });
    await ecrireOccupationsDeLaManifestation(MANIF, manifestation, [
      { siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES },
    ]);

    const conflits = await conflitsDeLaManifestation(MANIF);
    expect(conflits).toHaveLength(1);
    expect(conflits[0].conflits).toHaveLength(1);
    expect(conflits[0].conflits[0].titre).toBe('Mariage Dupont');
  });

  it('ne signale rien quand la manifestation est seule sur son créneau', async () => {
    await ecrireOccupationsDeLaManifestation(MANIF, manifestation, [
      { siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES },
    ]);

    expect(await conflitsDeLaManifestation(MANIF)).toHaveLength(0);
  });
});

// ------------------------------------------- la liste des manifestations

describe('Repérer d’un coup les manifestations en conflit', () => {
  /**
   * La liste des manifestations en affiche une pastille. La règle est la même
   * que celle de `conflitsPour`, mais écrite en jointure de la table sur
   * elle-même : si les deux divergeaient, la liste signalerait un conflit que
   * la fiche ne montrerait pas, ou l'inverse — et plus personne ne croirait
   * la pastille.
   */
  it('nomme les deux manifestations qui se disputent une salle', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00', {
      manifestationId: 1,
      titre: 'Loto',
    });
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00', {
      manifestationId: 2,
      titre: 'Concert',
    });

    expect((await manifestationsEnConflit()).sort()).toEqual([1, 2]);
  });

  it('applique la hiérarchie, comme la vérification d’un créneau', async () => {
    await occuper({ siteId: MAIRIE, pieceId: null }, '16:00', '18:00', { manifestationId: 1 });
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00', {
      manifestationId: 2,
    });

    expect((await manifestationsEnConflit()).sort()).toEqual([1, 2]);
  });

  it('signale aussi celle que heurte un créneau saisi à la main', async () => {
    // Le mariage n'a pas de manifestation derrière : il n'apparaît donc pas
    // dans la liste, mais il met bien la manifestation en conflit.
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00');
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00', {
      manifestationId: 7,
    });

    expect(await manifestationsEnConflit()).toEqual([7]);
  });

  it('ne signale pas une manifestation qui occupe deux salles distinctes', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00', {
      manifestationId: 3,
    });
    await occuper({ siteId: MAIRIE, pieceId: HALL }, '16:00', '18:00', { manifestationId: 3 });

    // Ses deux créneaux ne se heurtent pas : ce sont deux pièces différentes,
    // et de toute façon ils sont à elle.
    expect(await manifestationsEnConflit()).toEqual([]);
  });

  it('ne signale rien quand chacune est seule sur son créneau', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '08:00', '10:00', {
      manifestationId: 4,
    });
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '14:00', '16:00', {
      manifestationId: 5,
    });

    expect(await manifestationsEnConflit()).toEqual([]);
  });

  it('ignore les créneaux annulés', async () => {
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '16:00', '18:00', {
      manifestationId: 1,
      statut: 'annule',
    });
    await occuper({ siteId: MAIRIE, pieceId: SALLE_DES_MARIAGES }, '17:00', '19:00', {
      manifestationId: 2,
    });

    expect(await manifestationsEnConflit()).toEqual([]);
  });
});
