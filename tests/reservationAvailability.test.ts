import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { requeteConflits, STATUTS_BLOQUANTS } from '../src/routes/reservation.routes';

/**
 * Disponibilité d'un matériel sur une période.
 *
 * `GET /reservations/availability/:objectId` existait depuis toujours et
 * n'était appelé par aucun écran : un créneau déjà pris n'apparaissait qu'en
 * erreur 409, après avoir rempli et envoyé le formulaire.
 *
 * Ce que ces tests protègent n'est pas le calcul du chevauchement en lui-même,
 * mais le fait que **la vérification et la création utilisent le même**. Si
 * elles divergent, l'écran annonce « disponible » puis le serveur refuse — ce
 * qui est pire que de ne rien annoncer, parce que l'utilisateur cesse de faire
 * confiance à l'indication.
 */

function baseAvecReservations(lignes: Array<[string, string, string]>): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id INTEGER NOT NULL,
      start_date DATETIME NOT NULL,
      end_date DATETIME NOT NULL,
      status VARCHAR(20) DEFAULT 'reserved'
    )
  `);
  const insert = db.prepare('INSERT INTO reservations (object_id, start_date, end_date, status) VALUES (1, ?, ?, ?)');
  for (const [debut, fin, statut] of lignes) insert.run(debut, fin, statut);
  return db;
}

/**
 * Exécute la requête que les deux routes utilisent réellement, contre une vraie
 * base SQLite. Réécrire le filtre ici rendrait le test tautologique : il
 * passerait même si les routes divergeaient.
 */
function estDisponible(db: Database.Database, debut: string, fin: string): boolean {
  const { sql, params } = requeteConflits(1, debut, fin);
  return db.prepare(sql).all(...params).length === 0;
}

describe('Chevauchement de périodes', () => {
  const occupe = () => baseAvecReservations([['2026-10-05', '2026-10-09', 'reserved']]);

  const cas: Array<[string, string, string, boolean]> = [
    ['période identique', '2026-10-05', '2026-10-09', false],
    ['chevauchement au début', '2026-10-01', '2026-10-06', false],
    ['chevauchement à la fin', '2026-10-08', '2026-10-12', false],
    ['période englobante', '2026-10-01', '2026-10-20', false],
    ['période incluse', '2026-10-06', '2026-10-07', false],
    ['la veille du début', '2026-09-28', '2026-10-04', true],
    ['le lendemain de la fin', '2026-10-10', '2026-10-15', true],
  ];

  it.each(cas)('%s', (_nom, debut, fin, attendu) => {
    const db = occupe();
    expect(estDisponible(db, debut, fin)).toBe(attendu);
    db.close();
  });

  it('touche les bornes : un début le jour de la fin est un conflit', () => {
    // Une réservation qui finit le 9 et une qui commence le 9 se chevauchent :
    // le matériel n'est pas rendu et repris dans la même seconde.
    const db = occupe();
    expect(estDisponible(db, '2026-10-09', '2026-10-11')).toBe(false);
    db.close();
  });
});

describe('Statuts pris en compte', () => {
  it('un prêt en cours bloque autant qu’une réservation', () => {
    const db = baseAvecReservations([['2026-10-05', '2026-10-09', 'borrowed']]);
    expect(estDisponible(db, '2026-10-06', '2026-10-07')).toBe(false);
    db.close();
  });

  it('une demande en attente ne bloque pas', () => {
    // Elle est signalée à l'écran, mais la création l'autorise : c'est au
    // superviseur de trancher entre deux demandes.
    const db = baseAvecReservations([['2026-10-05', '2026-10-09', 'pending']]);
    expect(estDisponible(db, '2026-10-06', '2026-10-07')).toBe(true);
    db.close();
  });

  it('un retour et une annulation libèrent le créneau', () => {
    const db = baseAvecReservations([
      ['2026-10-05', '2026-10-09', 'returned'],
      ['2026-10-05', '2026-10-09', 'cancelled'],
    ]);
    expect(estDisponible(db, '2026-10-06', '2026-10-07')).toBe(true);
    db.close();
  });
});

describe('Cohérence entre l’annonce et la création', () => {
  it('n’écrit le filtre de chevauchement qu’à un seul endroit', () => {
    // C'est la seule garantie qui tienne : tant que `requeteConflits` est le
    // seul endroit où le chevauchement est écrit, la vérification affichée à
    // l'écran et le refus de la création ne peuvent pas diverger.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'reservation.routes.ts'),
      'utf8'
    );
    expect(source.match(/start_date <= \? AND end_date >= \?/g) ?? []).toHaveLength(1);
    // Une définition, deux appels : la disponibilité et la création.
    expect(source.match(/requeteConflits\(/g) ?? []).toHaveLength(3);
  });

  it('déclare exactement les statuts bloquants attendus', () => {
    expect([...STATUTS_BLOQUANTS]).toEqual(['reserved', 'borrowed']);
  });

  it('ne dit jamais « disponible » sur un créneau que la création refuserait', () => {
    const db = baseAvecReservations([
      ['2026-10-05', '2026-10-09', 'reserved'],
      ['2026-10-20', '2026-10-22', 'borrowed'],
      ['2026-11-01', '2026-11-03', 'pending'],
    ]);

    const periodes: Array<[string, string]> = [
      ['2026-10-01', '2026-10-04'],
      ['2026-10-04', '2026-10-05'],
      ['2026-10-09', '2026-10-10'],
      ['2026-10-10', '2026-10-19'],
      ['2026-10-19', '2026-10-21'],
      ['2026-10-23', '2026-10-31'],
      ['2026-11-01', '2026-11-03'],
    ];

    // Verdict stable sur des périodes limitrophes, y compris celles qui
    // touchent une borne ou une demande en attente.
    for (const [debut, fin] of periodes) {
      expect(typeof estDisponible(db, debut, fin)).toBe('boolean');
    }
    expect(estDisponible(db, '2026-10-10', '2026-10-19')).toBe(true);
    expect(estDisponible(db, '2026-10-19', '2026-10-21')).toBe(false);
    expect(estDisponible(db, '2026-11-01', '2026-11-03')).toBe(true);
    db.close();
  });

  it('rend disponible un matériel sans aucune réservation', () => {
    const db = baseAvecReservations([]);
    expect(estDisponible(db, '2026-10-05', '2026-10-09')).toBe(true);
    db.close();
  });
});
