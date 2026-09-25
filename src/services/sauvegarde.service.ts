import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { Readable } from 'stream';
import archiver from 'archiver';
import extract from 'extract-zip';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../database';
import { colonnesDeTable, identifiant, insererPaquet, lignesParPaquet, tablesDeLaBase } from '../database/lots';

/**
 * Sauvegarde et restauration de la base, quel que soit le moteur.
 *
 * Ce que ce module remplace, côté MySQL, ne sauvegardait pas grand-chose :
 *
 * - **17 tables sur plus de 80**, une liste écrite avant les manifestations,
 *   les clés, les lieux, les tickets et les plannings, et jamais tenue à jour ;
 * - la restauration **renumérotait chaque ligne** (la colonne `id` était
 *   écartée à la réinsertion), si bien que tous les liens — le plein vers son
 *   véhicule, le droit vers son utilisateur — pointaient ensuite ailleurs ;
 * - vider `users` ou `categories` **effaçait en cascade** des tables déjà
 *   restaurées ;
 * - les dates sortaient de mysql2 en objets `Date`, sérialisées en UTC, et
 *   revenaient **décalées** du fuseau ;
 * - tout tenait dans **une seule chaîne JSON** en mémoire, qui casse au-delà de
 *   quelques centaines de mégaoctets.
 *
 * Désormais toutes les tables sont copiées, identifiants compris, table par
 * table et ligne par ligne (`tables/<nom>.jsonl`), sans jamais tenir une table
 * entière en mémoire. SQLite garde sa copie de fichier, faite par l'API de
 * sauvegarde en ligne plutôt que par copie du fichier ouvert.
 */

export const DOSSIER_SAUVEGARDES = './backups';

/** Version du format d'archive : 2 = une table par fichier `tables/<nom>.jsonl`. */
const FORMAT = 2;

/**
 * Tables jamais copiées d'une base à l'autre.
 *
 * `backups` décrit les fichiers présents *sur ce serveur* : restaurer l'ancienne
 * liste ferait oublier les sauvegardes plus récentes, dont celle de sécurité
 * prise juste avant. `schema_migrations` décrit le schéma *de la cible*, qui est
 * déjà à jour. `jwt_secrets` porte les clés qui signent les sessions : les
 * glisser dans chaque archive ferait voyager des secrets, et les restaurer
 * déconnecterait tout le monde, à commencer par l'administrateur qui restaure.
 * Les autres sont des jetons éphémères — dont les sessions du portail des
 * entreprises, qu'une restauration rouvrirait.
 */
const TABLES_EXCLUES = new Set([
  'schema_migrations',
  'backups',
  'backup_download_tokens',
  'passkey_challenges',
  'jwt_secrets',
  'entreprise_sessions',
]);

/** Lignes lues à la fois en MySQL : assez pour aller vite, assez peu pour la mémoire. */
const LECTURE_PAR_PAGE = 5_000;

export type TypeSauvegarde = 'manual' | 'auto' | 'securite';

export interface SauvegardeCreee {
  id: number;
  filename: string;
  filePath: string;
  fileSize: number;
}

export interface RapportRestauration {
  moteurSource: string;
  methode: 'fichier' | 'tables';
  tables: number;
  lignes: number;
  /** Tables de la sauvegarde que la base actuelle ne connaît pas. */
  tablesIgnorees: string[];
  /** Colonnes de la sauvegarde disparues du schéma actuel, en `table.colonne`. */
  colonnesIgnorees: string[];
  /** Lignes qui pointent vers une ligne absente, après restauration. */
  liensOrphelins: number;
  sauvegardeDeSecurite: string | null;
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

/**
 * Crée une archive complète : base, fichiers téléversés, plugins.
 * Utilisée par l'écran de sauvegarde, la sauvegarde automatique, et avant toute
 * opération destructrice (restauration, purge, réinitialisation).
 */
export async function creerSauvegarde(options: { type: TypeSauvegarde; notes?: string | null }): Promise<SauvegardeCreee> {
  fs.mkdirSync(DOSSIER_SAUVEGARDES, { recursive: true });

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const prefixe = options.type === 'manual' ? 'backup' : `backup-${options.type}`;
  const filename = `${prefixe}-${horodatage}-${uuidv4().substring(0, 8)}.zip`;
  const filePath = path.join(DOSSIER_SAUVEGARDES, filename);

  const sortie = fs.createWriteStream(filePath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const fermee = new Promise<void>((resoudre, rejeter) => {
    sortie.on('close', resoudre);
    sortie.on('error', rejeter);
    archive.on('error', rejeter);
  });
  archive.pipe(sortie);

  const dbType = db.getType();
  const comptes: Record<string, number> = {};
  let aNettoyer: (() => Promise<void>) | null = null;

  try {
    if (dbType === 'sqlite') {
      // `backup()` rend une copie cohérente même si quelqu'un écrit pendant ce
      // temps ; copier le fichier ouvert pouvait saisir une page à moitié écrite.
      const copie = path.join(os.tmpdir(), `sauvegarde-${uuidv4()}.sqlite`);
      await db.getSQLiteDb().backup(copie);
      archive.file(copie, { name: 'database.sqlite' });
      aNettoyer = async () => fs.rmSync(copie, { force: true });
    } else {
      const connexion = await db.getMySQLPool().getConnection();
      // Un instantané cohérent : sans lui, une sauvegarde longue mêlerait des
      // tables lues avant et après une écriture concurrente.
      await connexion.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connexion.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      aNettoyer = async () => {
        await connexion.query('COMMIT').catch(() => undefined);
        connexion.release();
      };

      for (const table of await tablesDeLaBase()) {
        if (TABLES_EXCLUES.has(table)) continue;
        comptes[table] = 0;
        const flux = Readable.from(lireTableMySQL(connexion, table, comptes));
        // Une lecture qui échoue doit faire échouer l'archive, pas la suspendre.
        flux.on('error', (erreur) => archive.emit('error', erreur));
        archive.append(flux, { name: `tables/${table}.jsonl` });
      }
    }

    for (const [dossier, nom] of [
      [process.env.UPLOAD_DIR || './uploads', 'uploads'],
      ['./plugins', 'plugins'],
    ] as const) {
      if (fs.existsSync(dossier)) archive.directory(dossier, nom);
    }

    // Écrite en dernier, et produite à la lecture : les comptes des tables ne
    // sont connus qu'une fois celles-ci parcourues.
    archive.append(
      Readable.from(
        (function* () {
          yield JSON.stringify(
            {
              version: process.env.SITE_VERSION || '1.0.0',
              format: FORMAT,
              createdAt: new Date().toISOString(),
              dbType,
              type: options.type,
              notes: options.notes ?? null,
              tables: dbType === 'mysql' ? comptes : undefined,
            },
            null,
            2
          );
        })()
      ),
      { name: 'backup-info.json' }
    );

    await Promise.all([archive.finalize(), fermee]);
  } catch (erreur) {
    archive.abort();
    fs.rmSync(filePath, { force: true });
    throw erreur;
  } finally {
    if (aNettoyer) await aNettoyer();
  }

  const fileSize = fs.statSync(filePath).size;
  const resultat = await db.execute(
    'INSERT INTO backups (filename, file_path, file_size, backup_type, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [filename, filePath, fileSize, options.type, 'completed', options.notes ?? null]
  );

  return { id: Number(resultat.lastInsertRowid), filename, filePath, fileSize };
}

/**
 * Les lignes d'une table MySQL, une par ligne de texte.
 *
 * Les dates sont lues telles que MySQL les range, sans passer par un objet
 * `Date` (voir `datesEnTexte`) : c'est ce qui évite le décalage de fuseau à
 * l'aller-retour.
 * La lecture avance par identifiant plutôt que par `OFFSET`, qui relit toute la
 * table à chaque page.
 */
export async function* lireTableMySQL(connexion: PoolConnection, table: string, comptes: Record<string, number>) {
  const colonnes = await colonnesDeTableMySQL(connexion, table);
  const parId = colonnes.includes('id');
  let dernier: unknown = null;

  for (;;) {
    const sql = parId
      ? `SELECT * FROM \`${table}\` ${dernier === null ? '' : 'WHERE id > ?'} ORDER BY id LIMIT ${LECTURE_PAR_PAGE}`
      : `SELECT * FROM \`${table}\``;
    const [lignes] = await connexion.query({ sql, values: dernier === null ? [] : [dernier], typeCast: datesEnTexte });
    const liste = lignes as Array<Record<string, unknown>>;

    for (const ligne of liste) {
      comptes[table]++;
      yield JSON.stringify(ligne, remplacerBinaire) + '\n';
    }
    if (!parId || liste.length < LECTURE_PAR_PAGE) return;
    dernier = liste[liste.length - 1].id;
  }
}

/**
 * `typeCast` de mysql2 : les colonnes de date restent du texte.
 *
 * Le pool de l'application n'a pas `dateStrings` (voir le décalage d'un jour
 * des colonnes DATE), et l'option ne se règle pas requête par requête.
 */
function datesEnTexte(champ: { type: string; string(): string | null }, suite: () => unknown): unknown {
  if (champ.type === 'DATE' || champ.type === 'DATETIME' || champ.type === 'TIMESTAMP' || champ.type === 'NEWDATE') {
    return champ.string();
  }
  return suite();
}

async function colonnesDeTableMySQL(connexion: PoolConnection, table: string): Promise<string[]> {
  const [lignes] = await connexion.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return (lignes as Array<{ name: string }>).map((l) => l.name);
}

/** Aucune colonne binaire aujourd'hui ; si l'une apparaît, elle voyage en base64. */
function remplacerBinaire(_cle: string, valeur: unknown): unknown {
  if (valeur && typeof valeur === 'object' && (valeur as { type?: string }).type === 'Buffer') {
    return { $base64: Buffer.from((valeur as { data: number[] }).data).toString('base64') };
  }
  return valeur;
}

function reviverBinaire(_cle: string, valeur: unknown): unknown {
  if (valeur && typeof valeur === 'object' && typeof (valeur as { $base64?: string }).$base64 === 'string') {
    return Buffer.from((valeur as { $base64: string }).$base64, 'base64');
  }
  return valeur;
}

// ---------------------------------------------------------------------------
// Restauration
// ---------------------------------------------------------------------------

/** D'où viennent les tables à restaurer. */
export interface SourceDeTables {
  moteur: string;
  /** La source contient-elle toute la base ? Si oui, les tables qu'elle n'a pas sont vidées. */
  complete: boolean;
  tables(): Promise<string[]>;
  lignes(table: string): AsyncIterable<Record<string, unknown>>;
  fermer?(): void;
}

/** Archive au format 2 : `tables/<nom>.jsonl`. */
function sourceJsonl(dossier: string, moteur: string): SourceDeTables {
  const racine = path.join(dossier, 'tables');
  return {
    moteur,
    complete: true,
    async tables() {
      return fs
        .readdirSync(racine)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.slice(0, -'.jsonl'.length));
    },
    async *lignes(table) {
      const lecteur = readline.createInterface({
        input: fs.createReadStream(path.join(racine, `${table}.jsonl`), 'utf8'),
        crlfDelay: Infinity,
      });
      for await (const ligne of lecteur) {
        if (ligne.trim()) yield JSON.parse(ligne, reviverBinaire);
      }
    },
  };
}

/**
 * Ancien format MySQL : un seul `database.json`, 17 tables.
 *
 * Il n'est pas complet : on ne touche qu'aux tables qu'il contient, pour ne pas
 * vider les tickets ou les manifestations qu'il n'a jamais sauvegardés.
 */
function sourceJsonHistorique(fichier: string, moteur: string): SourceDeTables {
  const donnees = JSON.parse(fs.readFileSync(fichier, 'utf8')) as Record<string, Array<Record<string, unknown>>>;
  return {
    moteur,
    complete: false,
    async tables() {
      return Object.keys(donnees);
    },
    async *lignes(table) {
      for (const ligne of donnees[table] ?? []) yield versChainesDeDate(ligne);
    },
  };
}

/**
 * Un fichier SQLite, lu sans le modifier. Sert à restaurer une sauvegarde
 * SQLite sur MySQL — c'est-à-dire à migrer — et à la migration intégrée.
 */
export function sourceSqlite(fichier: string | Database.Database): SourceDeTables {
  const base = typeof fichier === 'string' ? new Database(fichier, { readonly: true, fileMustExist: true }) : fichier;
  return {
    moteur: 'sqlite',
    complete: true,
    async tables() {
      return (
        base.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
      ).map((t) => t.name);
    },
    async *lignes(table) {
      yield* base.prepare(`SELECT * FROM "${table}"`).iterate() as IterableIterator<Record<string, unknown>>;
    },
    fermer: typeof fichier === 'string' ? () => base.close() : undefined,
  };
}

/**
 * Les anciennes archives MySQL ont sérialisé les dates en ISO avec `Z` :
 * `2026-03-17T23:00:00.000Z` pour le 18 mars à minuit, heure de Paris. On les
 * ramène à l'heure locale du serveur, qui est celle de leur création.
 */
function versChainesDeDate(ligne: Record<string, unknown>): Record<string, unknown> {
  const copie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(valeur)) {
      const d = new Date(valeur);
      const deux = (n: number) => String(n).padStart(2, '0');
      const jour = `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
      const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
      copie[cle] = heure === '00:00:00' ? jour : `${jour} ${heure}`;
    } else {
      copie[cle] = valeur;
    }
  }
  return copie;
}

/**
 * Remplace le contenu de la base par celui de la source, **identifiants
 * compris**, en une seule transaction.
 *
 * Les clés étrangères sont suspendues le temps de la copie : l'ordre des tables
 * n'a alors plus d'importance, et vider une table ne déclenche aucune cascade
 * sur une autre déjà restaurée. Les liens sont vérifiés une fois la copie faite.
 */
export async function copierTables(source: SourceDeTables): Promise<Omit<RapportRestauration, 'methode' | 'sauvegardeDeSecurite'>> {
  const cibles = new Set((await tablesDeLaBase()).filter((t) => !TABLES_EXCLUES.has(t)));
  const aCopier = (await source.tables()).filter((t) => cibles.has(t));
  const tablesIgnorees = (await source.tables()).filter((t) => !cibles.has(t) && !TABLES_EXCLUES.has(t));
  const aVider = source.complete ? [...cibles].filter((t) => !aCopier.includes(t)) : [];
  const colonnesIgnorees: string[] = [];
  let lignes = 0;

  const travail = async () => {
    for (const table of [...aVider, ...aCopier]) {
      await db.execute(`DELETE FROM ${identifiant(table)}`);
    }

    for (const table of aCopier) {
      const colonnesCible = new Set(await colonnesDeTable(table));
      let colonnes: string[] | null = null;
      let paquet: unknown[][] = [];
      let taille = 1;

      const vider = async () => {
        if (colonnes && paquet.length > 0) await insererPaquet(table, colonnes, paquet);
        paquet = [];
      };

      try {
        for await (const ligne of source.lignes(table)) {
          if (!colonnes) {
            const presentes = Object.keys(ligne);
            colonnes = presentes.filter((c) => colonnesCible.has(c));
            for (const c of presentes) if (!colonnesCible.has(c)) colonnesIgnorees.push(`${table}.${c}`);
            taille = lignesParPaquet(colonnes.length);
          }
          paquet.push(colonnes.map((c) => ligne[c] ?? null));
          lignes++;
          if (paquet.length >= taille) await vider();
        }
        await vider();
      } catch (erreur) {
        throw new Error(`Table ${table} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
      }
    }
  };

  let liensOrphelins = 0;
  if (db.getType() === 'mysql') {
    await db.transaction(async () => {
      await db.execute('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await travail();
      } finally {
        // La connexion retourne au pool : elle ne doit pas y retourner désarmée.
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  } else {
    // SQLite n'accepte ce réglage qu'en dehors d'une transaction.
    const base = db.getSQLiteDb();
    base.pragma('foreign_keys = OFF');
    try {
      await db.transaction(travail);
      liensOrphelins = (base.pragma('foreign_key_check') as unknown[]).length;
    } finally {
      base.pragma('foreign_keys = ON');
    }
  }

  return {
    moteurSource: source.moteur,
    tables: aCopier.length,
    lignes,
    tablesIgnorees,
    colonnesIgnorees: [...new Set(colonnesIgnorees)],
    liensOrphelins,
  };
}

/**
 * Restaure une archive de sauvegarde, après en avoir pris une de sécurité.
 *
 * Échoue franchement si l'archive ne contient rien de restaurable : l'ancienne
 * route répondait « Restauration effectuée avec succès » en restaurant une
 * sauvegarde SQLite sur MySQL… sans rien restaurer.
 */
export async function restaurerArchive(fichierZip: string): Promise<RapportRestauration> {
  const dossier = path.join(DOSSIER_SAUVEGARDES, `extract-${Date.now()}-${uuidv4().substring(0, 8)}`);
  await extract(fichierZip, { dir: path.resolve(dossier) });

  try {
    const cheminInfo = path.join(dossier, 'backup-info.json');
    if (!fs.existsSync(cheminInfo)) {
      throw new ArchiveInvalide("Fichier backup-info.json manquant : ce n'est pas une sauvegarde valide.");
    }
    const info = JSON.parse(fs.readFileSync(cheminInfo, 'utf8'));
    const moteurSource: string = info.dbType ?? 'inconnu';

    const fichierSqlite = path.join(dossier, 'database.sqlite');
    const dossierTables = path.join(dossier, 'tables');
    const fichierJson = path.join(dossier, 'database.json');
    const restaurable = fs.existsSync(fichierSqlite) || fs.existsSync(dossierTables) || fs.existsSync(fichierJson);
    if (!restaurable) {
      throw new ArchiveInvalide("L'archive ne contient aucune base de données (ni database.sqlite, ni tables/, ni database.json).");
    }

    const securite = await creerSauvegarde({
      type: 'securite',
      notes: `Prise automatiquement avant la restauration de ${path.basename(fichierZip)}`,
    });

    let rapport: RapportRestauration;
    if (fs.existsSync(fichierSqlite) && db.getType() === 'sqlite') {
      rapport = {
        ...(await remplacerFichierSqlite(fichierSqlite)),
        sauvegardeDeSecurite: securite.filename,
      };
    } else {
      const source = fs.existsSync(dossierTables)
        ? sourceJsonl(dossier, moteurSource)
        : fs.existsSync(fichierSqlite)
          ? sourceSqlite(fichierSqlite)
          : sourceJsonHistorique(fichierJson, moteurSource);
      try {
        rapport = { ...(await copierTables(source)), methode: 'tables', sauvegardeDeSecurite: securite.filename };
      } finally {
        source.fermer?.();
      }
    }

    for (const [nom, cible] of [
      ['uploads', process.env.UPLOAD_DIR || './uploads'],
      ['plugins', './plugins'],
    ] as const) {
      const origine = path.join(dossier, nom);
      if (fs.existsSync(origine)) fs.cpSync(origine, cible, { recursive: true });
    }

    return rapport;
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/**
 * SQLite vers SQLite : on remplace le fichier. Les sauvegardes, elles, restent
 * celles de ce serveur (voir `TABLES_EXCLUES`), recopiées dans la base rendue.
 */
async function remplacerFichierSqlite(fichier: string): Promise<Omit<RapportRestauration, 'sauvegardeDeSecurite'>> {
  const cible = db.getSQLitePath() ?? './data/database.sqlite';
  const sauvegardes = await db.query<Record<string, unknown>>('SELECT * FROM backups');

  db.getSQLiteDb().close();
  for (const suffixe of ['-wal', '-shm']) fs.rmSync(cible + suffixe, { force: true });
  fs.copyFileSync(fichier, cible);
  await db.init();

  await db.transaction(async () => {
    await db.execute('DELETE FROM backups');
    if (sauvegardes.length > 0) {
      const colonnes = Object.keys(sauvegardes[0]);
      for (let i = 0; i < sauvegardes.length; i += 200) {
        await insererPaquet('backups', colonnes, sauvegardes.slice(i, i + 200).map((s) => colonnes.map((c) => s[c])));
      }
    }
  });

  const tables = (await tablesDeLaBase()).filter((t) => !TABLES_EXCLUES.has(t));
  return {
    moteurSource: 'sqlite',
    methode: 'fichier',
    tables: tables.length,
    lignes: 0,
    tablesIgnorees: [],
    colonnesIgnorees: [],
    liensOrphelins: (db.getSQLiteDb().pragma('foreign_key_check') as unknown[]).length,
  };
}

/** Une archive qu'on ne peut pas restaurer : erreur de l'utilisateur, pas du serveur. */
export class ArchiveInvalide extends Error {}

/** Garde les `garder` dernières sauvegardes d'un type, supprime les autres. */
export async function elaguerSauvegardes(type: TypeSauvegarde, garder: number): Promise<number> {
  // `LIMIT -1 OFFSET n` est du SQLite : MySQL le refuse. On trie en SQL, on coupe ici.
  const toutes = await db.query<{ id: number; file_path: string }>(
    'SELECT id, file_path FROM backups WHERE backup_type = ? ORDER BY created_at DESC, id DESC',
    [type]
  );
  const anciennes = toutes.slice(garder);
  for (const s of anciennes) {
    fs.rmSync(s.file_path, { force: true });
    await db.execute('DELETE FROM backups WHERE id = ?', [s.id]);
  }
  return anciennes.length;
}
