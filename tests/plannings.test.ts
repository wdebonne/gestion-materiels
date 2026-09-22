/**
 * Les heures déclarées : ce qu'elles valent, et qui peut les lire.
 *
 * Deux agents une heure sur la même tâche, c'est deux heures de travail
 * mobilisé mais une heure pour chacun ; un renfort de trente minutes sur une
 * tâche de deux heures porte le total à deux heures trente. Ces égalités sont
 * la raison d'être du module, et elles ne se cassent jamais bruyamment : une
 * erreur ici ne lève pas d'exception, elle change un chiffre présenté en
 * réunion.
 *
 * Les deux pièges que ces tests surveillent en particulier :
 *
 *   - un filtre par personne posé au mauvais endroit rend les deux mesures
 *     identiques dès qu'on filtre, et « mobilisé » devient un synonyme de
 *     « personne » sans que rien ne le signale ;
 *   - un renfort non nominatif porte `user_id IS NULL` et ne satisfait aucun
 *     `IN (…)` : un périmètre écrit naïvement le fait disparaître de tous les
 *     rapports sauf ceux de l'administrateur.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  (global as any).__basePlannings = sqlite;

  return {
    db: {
      getType: () => 'sqlite',
      async query(requete: string, params: any[] = []) {
        const stmt = sqlite.prepare(requete);
        return stmt.reader ? stmt.all(...params) : (stmt.run(...params), []);
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

import { appliquerMigrations, type BaseMigration } from '../src/database/migrationRunner';
import planningsEtHeures from '../src/database/migrations/031_plannings_et_heures';
import ticketsTempsEtReprise from '../src/database/migrations/034_tickets_temps_et_reprise';
import {
  Perimetre,
  SaisieInvalide,
  calculerMinutes,
  creerTache,
  listerTaches,
  modifierTache,
  normaliserCategorie,
  perimetreDe,
  peutEcrirePour,
  resoudreCategorie,
  usagesCategorie,
  verifierSaisie,
} from '../src/services/plannings.service';
import { comparer, compterTaches, construireRapport } from '../src/services/planningsRapport.service';

const base = () => (global as any).__basePlannings as import('better-sqlite3').Database;

const DUPONT = 1;
const MARTIN = 2;
const JEAN = 3;
const ETRANGER = 4;

const TOUT: Perimetre = { tout: true, personnes: [] };

beforeAll(async () => {
  const sqlite = base();

  // Le strict minimum des tables auxquelles la migration se rattache.
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email VARCHAR(255),
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      role VARCHAR(50) DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      can_login INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE manifestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title VARCHAR(255) NOT NULL,
      date_start DATE NOT NULL
    );
    -- Une tâche peut se rattacher à une demande depuis la migration 034, au
    -- même titre qu'à une manifestation. La lecture en fait la jointure.
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference VARCHAR(30),
      titre VARCHAR(255) NOT NULL
    );
  `);

  sqlite.prepare("INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)")
    .run(DUPONT, 'Paul', 'Dupont', 'agent');
  sqlite.prepare("INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)")
    .run(MARTIN, 'Claire', 'Martin', 'supervisor');
  sqlite.prepare("INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)")
    .run(JEAN, 'Alex', 'Jean', 'supervisor');
  sqlite.prepare("INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)")
    .run(ETRANGER, 'Sam', 'Etranger', 'agent');
  sqlite.prepare("INSERT INTO manifestations (id, title, date_start) VALUES (1, 'Brocante', '2026-03-18')").run();
  sqlite.prepare("INSERT INTO tickets (id, reference, titre) VALUES (1, 'T-2026-1', 'Rideau cassé')").run();

  const adaptateur: BaseMigration = {
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
  };

  await appliquerMigrations(adaptateur, { migrations: [planningsEtHeures, ticketsTempsEtReprise] });
});

afterEach(() => {
  const sqlite = base();
  sqlite.exec('DELETE FROM planning_participants; DELETE FROM planning_taches; DELETE FROM planning_superviseurs;');
});

// ==================== La durée d'une tâche ====================

describe('calculerMinutes', () => {
  it('déduit la durée des horaires', () => {
    expect(calculerMinutes({ heureDebut: '14:00', heureFin: '16:00' })).toBe(120);
  });

  it('accepte une durée seule quand aucun horaire n’est donné', () => {
    expect(calculerMinutes({ minutes: 90 })).toBe(90);
  });

  it('ignore une durée envoyée en même temps que les horaires', () => {
    // Deux vérités finiraient par diverger, et le total ne serait plus
    // explicable depuis sa propre ligne.
    expect(calculerMinutes({ heureDebut: '08:00', heureFin: '10:00', minutes: 999 })).toBe(120);
  });

  it('compte une tâche de nuit', () => {
    expect(calculerMinutes({ heureDebut: '22:00', heureFin: '02:00' })).toBe(240);
  });

  it('refuse un seul horaire', () => {
    expect(() => calculerMinutes({ heureDebut: '14:00' })).toThrow(SaisieInvalide);
  });

  it('refuse deux horaires identiques plutôt que de deviner', () => {
    expect(() => calculerMinutes({ heureDebut: '08:00', heureFin: '08:00' })).toThrow(SaisieInvalide);
  });

  it('refuse une durée aberrante', () => {
    expect(() => calculerMinutes({ minutes: 0 })).toThrow(SaisieInvalide);
    expect(() => calculerMinutes({ minutes: 1441 })).toThrow(SaisieInvalide);
  });
});

describe('verifierSaisie', () => {
  const socle = { userId: DUPONT, jour: '2026-03-18', heureDebut: '14:00', heureFin: '16:00' };

  it('donne au renfort la durée de la tâche par défaut', () => {
    const { participants } = verifierSaisie({ ...socle, participants: [{ userId: MARTIN }] });
    expect(participants[0].minutes).toBe(120);
  });

  it('accepte un soutien partiel', () => {
    const { participants } = verifierSaisie({ ...socle, participants: [{ userId: MARTIN, minutes: 30 }] });
    expect(participants[0].minutes).toBe(30);
  });

  it('accepte un renfort resté plus longtemps que le titulaire', () => {
    // Un agent qui termine après le départ de son collègue est un cas réel :
    // la participation n'est pas plafonnée par la durée de la tâche.
    const { participants } = verifierSaisie({ ...socle, participants: [{ userId: MARTIN, minutes: 180 }] });
    expect(participants[0].minutes).toBe(180);
  });

  it('refuse le titulaire parmi ses propres renforts', () => {
    expect(() => verifierSaisie({ ...socle, participants: [{ userId: DUPONT }] })).toThrow(SaisieInvalide);
  });

  it('refuse deux fois la même personne sur une tâche', () => {
    expect(() => verifierSaisie({ ...socle, participants: [{ userId: MARTIN }, { userId: MARTIN }] }))
      .toThrow(SaisieInvalide);
  });

  it('accepte plusieurs renforts non nommés', () => {
    const { participants } = verifierSaisie({
      ...socle,
      participants: [{ libelle: 'Un agent des espaces verts' }, { libelle: 'Un agent des espaces verts' }],
    });
    expect(participants).toHaveLength(2);
  });

  it('refuse un renfort à la fois nommé et décrit', () => {
    expect(() => verifierSaisie({ ...socle, participants: [{ userId: MARTIN, libelle: 'Un agent' }] }))
      .toThrow(SaisieInvalide);
  });

  it('refuse un renfort ni nommé ni décrit', () => {
    expect(() => verifierSaisie({ ...socle, participants: [{}] })).toThrow(SaisieInvalide);
  });

  it('refuse une date qui n’existe pas', () => {
    expect(() => verifierSaisie({ ...socle, jour: '2026-02-30' })).toThrow(SaisieInvalide);
  });
});

// ==================== Le référentiel des catégories ====================

describe('normaliserCategorie', () => {
  it('neutralise la casse, les accents et les espaces en trop', () => {
    expect(normaliserCategorie('  Livraison   Manifestation ')).toBe('livraison manifestation');
    expect(normaliserCategorie('Entretien Été')).toBe('entretien ete');
  });

  it('ne fusionne pas ce que les parenthèses distinguent', () => {
    // `normaliserLibelle`, plus agressive, confondrait ces deux-là.
    expect(normaliserCategorie('Entretien (été)')).not.toBe(normaliserCategorie('Entretien (hiver)'));
  });
});

describe('resoudreCategorie', () => {
  afterEach(() => base().exec('DELETE FROM planning_categories'));

  it('crée la catégorie absente et la retrouve ensuite', async () => {
    const creee = await resoudreCategorie('Livraison Manifestation', DUPONT);
    const relue = await resoudreCategorie('Livraison Manifestation', DUPONT);
    expect(relue.id).toBe(creee.id);
  });

  it('ne fabrique pas de doublon sur la casse ni les accents', async () => {
    const a = await resoudreCategorie('Tonte', DUPONT);
    const b = await resoudreCategorie('  TONTE  ', MARTIN);
    expect(b.id).toBe(a.id);
    expect(b.nom).toBe('Tonte');
  });

  it('donne une couleur distincte aux premières catégories', async () => {
    const noms = ['Tonte', 'Voirie', 'Livraison', 'Entretien', 'Réunion'];
    const couleurs = [];
    for (const nom of noms) couleurs.push((await resoudreCategorie(nom, DUPONT)).couleur);
    expect(new Set(couleurs).size).toBe(noms.length);
  });

  it('refuse un nom vide', async () => {
    await expect(resoudreCategorie('   ', DUPONT)).rejects.toThrow();
  });

  it('compte les usages avant toute suppression', async () => {
    const categorie = await resoudreCategorie('Tonte', DUPONT);
    expect(await usagesCategorie(categorie.id)).toBe(0);
    await creerTache(
      { userId: DUPONT, jour: '2026-03-18', heureDebut: '08:00', heureFin: '10:00', categorieId: categorie.id },
      DUPONT
    );
    expect(await usagesCategorie(categorie.id)).toBe(1);
  });
});

// ==================== Les deux mesures ====================

describe('les deux mesures du temps', () => {
  /** Une tâche de 2 h chez Dupont, avec Martin en renfort 30 min. */
  async function tacheAvecRenfortPartiel() {
    return creerTache(
      {
        userId: DUPONT,
        jour: '2026-03-18',
        heureDebut: '08:00',
        heureFin: '10:00',
        participants: [{ userId: MARTIN, minutes: 30 }],
      },
      DUPONT
    );
  }

  const mars = { debut: '2026-03-16', fin: '2026-03-22' };

  it('compte 2 h 30 de temps mobilisé pour 2 h de titulaire et 30 min de renfort', async () => {
    await tacheAvecRenfortPartiel();
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, TOUT);
    expect(rapport.total.minutes).toBe(150);
  });

  it('compte 2 h pour deux agents une heure chacun', async () => {
    await creerTache(
      {
        userId: DUPONT,
        jour: '2026-03-18',
        heureDebut: '14:00',
        heureFin: '15:00',
        participants: [{ userId: MARTIN }],
      },
      DUPONT
    );
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, TOUT);
    expect(rapport.total.minutes).toBe(120);
    expect(rapport.parPersonne.map((p) => p.minutes)).toEqual([60, 60]);
  });

  it('rend 2 h à Dupont et 30 min à Martin sur la mesure « personne »', async () => {
    await tacheAvecRenfortPartiel();
    const duDupont = await construireRapport(mars, { mesure: 'personne', personneId: DUPONT }, TOUT);
    const duMartin = await construireRapport(mars, { mesure: 'personne', personneId: MARTIN }, TOUT);
    expect(duDupont.total.minutes).toBe(120);
    expect(duMartin.total.minutes).toBe(30);
  });

  it('ne confond pas les deux mesures quand on filtre par personne', async () => {
    await tacheAvecRenfortPartiel();
    // C'est le piège : filtrer sur la ligne dans les deux cas rendrait 120 ici.
    const mobilise = await construireRapport(mars, { mesure: 'mobilise', personneId: DUPONT }, TOUT);
    const personne = await construireRapport(mars, { mesure: 'personne', personneId: DUPONT }, TOUT);
    expect(mobilise.total.minutes).toBe(150);
    expect(personne.total.minutes).toBe(120);
  });

  it('retrouve le temps d’un agent qui n’a fait qu’aider', async () => {
    await tacheAvecRenfortPartiel();
    const mobilise = await construireRapport(mars, { mesure: 'mobilise', personneId: MARTIN }, TOUT);
    expect(mobilise.total.minutes).toBe(150);
  });

  it('compte les tâches et non les contributions', async () => {
    await tacheAvecRenfortPartiel();
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, TOUT);
    expect(rapport.total.taches).toBe(1);
    expect(rapport.total.personnes).toBe(2);
  });

  it('compte un renfort non nominatif dans le temps mobilisé', async () => {
    await creerTache(
      {
        userId: DUPONT,
        jour: '2026-03-18',
        heureDebut: '08:00',
        heureFin: '10:00',
        participants: [{ libelle: 'Un agent des espaces verts', minutes: 60 }],
      },
      DUPONT
    );
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, TOUT);
    expect(rapport.total.minutes).toBe(180);
    expect(rapport.parPersonne.find((p) => p.id === null)?.minutes).toBe(60);
  });
});

// ==================== Le périmètre ====================

describe('le périmètre', () => {
  const mars = { debut: '2026-03-16', fin: '2026-03-22' };

  function rattacher(agentId: number, superviseurId: number, intitule: string) {
    base()
      .prepare('INSERT INTO planning_superviseurs (agent_id, superviseur_id, intitule) VALUES (?, ?, ?)')
      .run(agentId, superviseurId, intitule);
  }

  it('donne à un agent lui seul', async () => {
    expect(await perimetreDe(DUPONT, 'agent')).toEqual({ tout: false, personnes: [DUPONT] });
  });

  it('donne à un administrateur aucune restriction', async () => {
    expect(await perimetreDe(MARTIN, 'admin')).toEqual({ tout: true, personnes: [] });
  });

  it('ajoute à un encadrant les agents qui lui sont rattachés', async () => {
    rattacher(DUPONT, MARTIN, 'Responsable du service');
    const perimetre = await perimetreDe(MARTIN, 'supervisor');
    expect(perimetre.personnes.sort()).toEqual([MARTIN, DUPONT].sort());
  });

  it('accepte plusieurs encadrants pour un même agent', async () => {
    rattacher(DUPONT, MARTIN, 'Responsable du service');
    rattacher(DUPONT, JEAN, "Référent de l'équipe");
    expect((await perimetreDe(MARTIN, 'supervisor')).personnes).toContain(DUPONT);
    expect((await perimetreDe(JEAN, 'supervisor')).personnes).toContain(DUPONT);
  });

  it('ne rend pas l’encadrement transitif', async () => {
    // Martin encadre Dupont, Jean encadre Martin : Jean ne voit pas Dupont.
    rattacher(DUPONT, MARTIN, 'Responsable');
    rattacher(MARTIN, JEAN, 'Responsable');
    expect((await perimetreDe(JEAN, 'supervisor')).personnes).not.toContain(DUPONT);
  });

  it('cache à un encadrant les agents qui ne lui sont pas rattachés', async () => {
    rattacher(DUPONT, MARTIN, 'Responsable');
    await creerTache({ userId: ETRANGER, jour: '2026-03-18', heureDebut: '08:00', heureFin: '10:00' }, ETRANGER);
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, await perimetreDe(MARTIN, 'supervisor'));
    expect(rapport.total.minutes).toBe(0);
  });

  it('montre à un agent la tâche d’un autre où il a prêté main-forte', async () => {
    await creerTache(
      {
        userId: ETRANGER,
        jour: '2026-03-18',
        heureDebut: '08:00',
        heureFin: '10:00',
        participants: [{ userId: DUPONT, minutes: 45 }],
      },
      ETRANGER
    );
    const perimetre = await perimetreDe(DUPONT, 'agent');
    const taches = await listerTaches(mars, perimetre);
    expect(taches).toHaveLength(1);

    const sien = await construireRapport(mars, { mesure: 'personne', personneId: DUPONT }, perimetre);
    expect(sien.total.minutes).toBe(45);
  });

  it('n’escamote pas les renforts non nominatifs hors administrateur', async () => {
    // Leur ligne porte `user_id IS NULL` : un `IN (…)` naïf les ferait
    // disparaître du rapport de tout le monde sauf de l'administrateur.
    await creerTache(
      {
        userId: DUPONT,
        jour: '2026-03-18',
        heureDebut: '08:00',
        heureFin: '10:00',
        participants: [{ libelle: 'Renfort ponctuel', minutes: 60 }],
      },
      DUPONT
    );
    const perimetre = await perimetreDe(DUPONT, 'agent');
    const rapport = await construireRapport(mars, { mesure: 'mobilise' }, perimetre);
    expect(rapport.total.minutes).toBe(180);
  });

  it('rend un résultat vide plutôt qu’un IN () sur un périmètre vide', async () => {
    const vide: Perimetre = { tout: false, personnes: [] };
    await expect(construireRapport(mars, { mesure: 'mobilise' }, vide)).resolves.toMatchObject({
      total: { minutes: 0, taches: 0 },
    });
    await expect(listerTaches(mars, vide)).resolves.toEqual([]);
    await expect(compterTaches({ ...mars, mesure: 'mobilise' }, vide)).resolves.toBe(0);
  });
});

describe('peutEcrirePour', () => {
  it('laisse chacun saisir pour lui-même', async () => {
    expect(await peutEcrirePour(DUPONT, 'agent', DUPONT)).toBe(true);
  });

  it('refuse à un agent de saisir pour un autre', async () => {
    expect(await peutEcrirePour(DUPONT, 'agent', ETRANGER)).toBe(false);
  });

  it('laisse un encadrant saisir pour son agent, et pas pour un autre', async () => {
    base().prepare('INSERT INTO planning_superviseurs (agent_id, superviseur_id) VALUES (?, ?)')
      .run(DUPONT, MARTIN);
    expect(await peutEcrirePour(MARTIN, 'supervisor', DUPONT)).toBe(true);
    expect(await peutEcrirePour(MARTIN, 'supervisor', ETRANGER)).toBe(false);
  });

  it('laisse l’administrateur saisir pour n’importe qui', async () => {
    expect(await peutEcrirePour(MARTIN, 'admin', ETRANGER)).toBe(true);
  });
});

// ==================== Modification et séries ====================

describe('modifierTache', () => {
  it('remplace les renforts au lieu de les empiler', async () => {
    const id = await creerTache(
      {
        userId: DUPONT,
        jour: '2026-03-18',
        heureDebut: '08:00',
        heureFin: '10:00',
        participants: [{ userId: MARTIN, minutes: 30 }],
      },
      DUPONT
    );
    await modifierTache(id, {
      userId: DUPONT,
      jour: '2026-03-18',
      heureDebut: '08:00',
      heureFin: '11:00',
      participants: [{ userId: JEAN, minutes: 15 }],
    });

    const taches = await listerTaches({ debut: '2026-03-16', fin: '2026-03-22' }, TOUT);
    expect(taches[0].minutes).toBe(180);
    expect(taches[0].participants).toHaveLength(1);
    expect(taches[0].minutesMobilisees).toBe(195);
  });

  it('ne laisse pas de tâche derrière elle si un renfort est refusé', async () => {
    await expect(
      creerTache(
        { userId: DUPONT, jour: '2026-03-18', heureDebut: '08:00', heureFin: '10:00', participants: [{}] },
        DUPONT
      )
    ).rejects.toThrow(SaisieInvalide);
    expect(await listerTaches({ debut: '2026-03-16', fin: '2026-03-22' }, TOUT)).toEqual([]);
  });
});

describe('la série des périodes', () => {
  it('rend les jours sans saisie à zéro plutôt que de les omettre', async () => {
    await creerTache({ userId: DUPONT, jour: '2026-03-18', heureDebut: '08:00', heureFin: '10:00' }, DUPONT);
    const rapport = await construireRapport(
      { debut: '2026-03-16', fin: '2026-03-22' },
      { mesure: 'mobilise', granularite: 'jour' },
      TOUT
    );
    expect(rapport.parPeriode).toHaveLength(7);
    expect(rapport.parPeriode.find((p) => p.cle === '2026-03-18')?.minutes).toBe(120);
    expect(rapport.parPeriode.find((p) => p.cle === '2026-03-17')?.minutes).toBe(0);
  });

  it('range une tâche sans catégorie sous une part à elle', async () => {
    await creerTache({ userId: DUPONT, jour: '2026-03-18', minutes: 60 }, DUPONT);
    const rapport = await construireRapport({ debut: '2026-03-16', fin: '2026-03-22' }, { mesure: 'mobilise' }, TOUT);
    expect(rapport.parCategorie).toHaveLength(1);
    expect(rapport.parCategorie[0].libelle).toBe('Sans catégorie');
    // La somme des parts doit valoir le total, sinon le camembert ment.
    expect(rapport.parCategorie.reduce((s, p) => s + p.minutes, 0)).toBe(rapport.total.minutes);
  });
});

/**
 * Le nom d'une période, et ce à quoi on la compare.
 *
 * Une semaine se découpe en jours pour son graphique d'évolution. Confondre ce
 * découpage avec la nature de la période intitulait le rapport
 * « 21 septembre 2026 » au lieu de « Semaine 39 » — et, bien plus grave, le
 * faisait comparer à la **veille** au lieu de la semaine précédente. L'écart
 * affiché était donc faux sans que rien ne le signale.
 */
describe('la nature d\u2019une p\u00e9riode', () => {
  const semaine = { debut: '2026-09-21', fin: '2026-09-27' };

  it('nomme une semaine par son num\u00e9ro, m\u00eame si elle se d\u00e9coupe en jours', async () => {
    const rapport = await construireRapport(
      semaine,
      { mesure: 'mobilise', typePeriode: 'semaine', granularite: 'jour' },
      TOUT
    );
    expect(rapport.periode.libelle).toMatch(/^Semaine 39/);
    expect(rapport.periode.granularite).toBe('jour');
    expect(rapport.periode.typePeriode).toBe('semaine');
    expect(rapport.parPeriode).toHaveLength(7);
  });

  it('nomme un mois par son mois', async () => {
    const rapport = await construireRapport(
      { debut: '2026-09-01', fin: '2026-09-30' },
      { mesure: 'mobilise', typePeriode: 'mois', granularite: 'jour' },
      TOUT
    );
    expect(rapport.periode.libelle).toBe('Septembre 2026');
  });
});

describe('comparer', () => {
  const semaine = { debut: '2026-03-16', fin: '2026-03-22' };
  const precedente = { debut: '2026-03-09', fin: '2026-03-15' };

  it('chiffre l’écart entre deux semaines', async () => {
    await creerTache({ userId: DUPONT, jour: '2026-03-11', minutes: 120 }, DUPONT);
    await creerTache({ userId: DUPONT, jour: '2026-03-18', minutes: 180 }, DUPONT);

    const courant = await construireRapport(semaine, { mesure: 'mobilise' }, TOUT);
    const reference = await construireRapport(precedente, { mesure: 'mobilise' }, TOUT);
    const ecart = comparer(courant, reference);

    expect(ecart.ecart.minutes).toBe(60);
    expect(ecart.ecart.pourcentage).toBe(50);
  });

  it('ne dit pas « +∞ % » quand la référence est nulle', async () => {
    await creerTache({ userId: DUPONT, jour: '2026-03-18', minutes: 180 }, DUPONT);
    const courant = await construireRapport(semaine, { mesure: 'mobilise' }, TOUT);
    const reference = await construireRapport(precedente, { mesure: 'mobilise' }, TOUT);
    expect(comparer(courant, reference).ecart.pourcentage).toBeNull();
  });
});
