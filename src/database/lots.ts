import { db } from './index';

/**
 * Lecture du schéma et écriture en masse, communes aux deux moteurs.
 *
 * Sauvegarde, restauration, migration vers MySQL et jeu de données de test
 * écrivent tous des milliers de lignes dans des tables qu'ils ne connaissent
 * que par leur nom. Ils le faisaient chacun à sa façon — une ligne par
 * requête, une liste de tables écrite en dur et vieille de trente migrations.
 */

/** Tables de la base, dans l'ordre alphabétique. */
export async function tablesDeLaBase(): Promise<string[]> {
  const lignes =
    db.getType() === 'sqlite'
      ? await db.query<{ nom: string }>(
          "SELECT name AS nom FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
      : await db.query<{ nom: string }>(
          `SELECT TABLE_NAME AS nom FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
        );
  return lignes.map((l) => l.nom);
}

/** Colonnes d'une table, dans leur ordre de déclaration ; vide si la table n'existe pas. */
export async function colonnesDeTable(table: string): Promise<string[]> {
  const lignes =
    db.getType() === 'sqlite'
      ? await db.query<{ name: string }>(`PRAGMA table_info(${identifiant(table)})`)
      : await db.query<{ name: string }>(
          `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
          [table]
        );
  return lignes.map((l) => l.name);
}

/**
 * Un nom de table ou de colonne, entre les délimiteurs du moteur.
 *
 * Indispensable pour des colonnes nommées `sequence`, `year`, `type` ou
 * `columns` : MySQL en réserve certaines selon la version, et une restauration
 * ne doit pas dépendre de la version du serveur.
 */
export function identifiant(nom: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(nom)) throw new Error(`Nom de table ou de colonne invalide : ${nom}`);
  return db.getType() === 'mysql' ? `\`${nom}\`` : `"${nom}"`;
}

/** MySQL plafonne une requête préparée à 65 535 paramètres ; on reste en dessous. */
export function lignesParPaquet(nombreDeColonnes: number): number {
  return Math.max(1, Math.min(500, Math.floor(60_000 / Math.max(1, nombreDeColonnes))));
}

/**
 * Insère un paquet de lignes en une seule requête `INSERT … VALUES (…), (…)`.
 *
 * Rend l'identifiant de la **première** ligne insérée : MySQL le donne
 * directement, SQLite donne celui de la dernière. Un `INSERT` multiligne reçoit
 * des identifiants consécutifs tant que personne d'autre n'écrit dans la table.
 */
export async function insererPaquet(table: string, colonnes: string[], valeurs: unknown[][]): Promise<number> {
  if (valeurs.length === 0) return 0;
  const joker = `(${colonnes.map(() => '?').join(', ')})`;
  const resultat = await db.execute(
    `INSERT INTO ${identifiant(table)} (${colonnes.map(identifiant).join(', ')}) VALUES ${valeurs.map(() => joker).join(', ')}`,
    valeurs.flat()
  );
  return db.getType() === 'mysql'
    ? Number(resultat.lastInsertRowid)
    : Number(resultat.lastInsertRowid) - valeurs.length + 1;
}
