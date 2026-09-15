import type { ContexteMigration, Migration } from './types';

/**
 * Des personnes dans l'annuaire, même sans compte.
 *
 * L'application ne connaissait qu'une sorte de gens : ceux qui s'y connectent.
 * `users` exigeait une adresse et un mot de passe, si bien qu'inscrire le
 * gardien de la salle des fêtes — à qui on remet un trousseau, et qui n'ouvrira
 * jamais l'application — obligeait à lui inventer une adresse et un mot de
 * passe. Deux mensonges en base, et un compte qui peut se connecter sans que
 * personne l'ait voulu.
 *
 * La conséquence se lisait à l'écran : « Remettre le matériel » ne proposait
 * comme personnes que les quelques comptes de l'application. Tout le reste —
 * l'agent d'astreinte, l'élu, l'employé du CLSH — tombait dans « un externe »,
 * c'est-à-dire dans du texte libre. « A. Marie », « Marie André » et « André
 * MARIE » devenaient alors trois détenteurs distincts, qu'aucune requête ne
 * peut rapprocher et qu'aucun écran ne peut lister. La question « quelles clés
 * détient cette personne ? » n'avait pas de réponse.
 *
 * Plutôt qu'une table `personnes` à côté de `users`, cette migration ouvre
 * `users`. Le choix est celui de la migration 024 pour les clés : ne pas créer
 * un silo parallèle. Une seconde table imposerait d'écrire partout « soit un
 * compte, soit une personne » — dans les attributions, les réservations, les
 * responsables, les recherches — et un agent qui obtient enfin un accès devrait
 * être *recopié* d'une table à l'autre, en laissant derrière lui son historique.
 * Ici, il change de case à cocher.
 *
 *   `email`, `password`  deviennent facultatifs. Une personne sans compte n'a
 *                        ni l'un ni l'autre, et un sentinelle du genre
 *                        « personne-42@local » serait un faux affiché partout.
 *   `can_login`          dit qui peut se connecter. Par défaut oui : tous les
 *                        comptes existants gardent leur accès au mot près.
 *
 * `can_login` n'est pas déduit de l'absence de mot de passe. L'application
 * connaît aussi les passkeys, qui se passent de mot de passe : la déduction
 * ouvrirait l'accès au moment où l'on croit le fermer. C'est une décision
 * d'administrateur, elle est écrite comme telle, et `auth.routes.ts`,
 * `passkey.routes.ts` et `auth.middleware.ts` la relisent chacun.
 *
 * Retirer `NOT NULL` se fait d'un `ALTER TABLE ... MODIFY` sur MySQL. SQLite
 * ne sait pas modifier une colonne : il faut reconstruire la table, ce que
 * cette migration fait par la procédure officielle — copier, remplacer, rendre
 * son nom. Les clés étrangères des vingt-cinq tables qui visent `users` sont
 * suspendues le temps de l'échange, puis vérifiées.
 */
const personnesSansCompte: Migration = {
  id: '028_personnes_sans_compte',
  description: "Une personne peut figurer à l'annuaire sans pouvoir se connecter",

  async up(ctx) {
    if (ctx.dialecte === 'sqlite') {
      await acheverUneReconstructionInterrompue(ctx);

      const colonnes = await colonnesDe(ctx, 'users');
      if (colonnes.size === 0) return;

      await reconstruireSqlite(ctx, colonnes);
      return;
    }

    const colonnes = await colonnesDe(ctx, 'users');
    if (colonnes.size === 0) return;

    if (!colonnes.has('can_login')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN can_login TINYINT(1) NOT NULL DEFAULT 1');
    }

    // `MODIFY` réécrit la définition entière : le type doit être répété, sinon
    // il serait remplacé par celui écrit ici. Les deux colonnes gardent le
    // leur, elles ne perdent que l'obligation d'être renseignées.
    for (const colonne of COLONNES_ASSOUPLIES) {
      if (colonnes.has(colonne)) {
        await ctx.executer(`ALTER TABLE users MODIFY ${colonne} VARCHAR(255) NULL`);
      }
    }
  },
};

/** Ce qu'une personne sans compte n'a pas, et qui cesse donc d'être obligatoire. */
const COLONNES_ASSOUPLIES = ['email', 'password'] as const;

/** Nom de la table de travail, le temps de l'échange. */
const TABLE_NEUVE = 'users_028';

/**
 * Remet `users` en place si une exécution précédente s'est arrêtée entre le
 * `DROP` et le `RENAME`.
 *
 * La fenêtre ne fait que deux instructions, mais ce qu'on y perdrait est la
 * table des comptes : sans cette reprise, la migration relancée ne trouverait
 * plus de `users`, conclurait qu'il n'y a rien à faire, et s'inscrirait comme
 * appliquée sur une base amputée. Le coût de la précaution est une lecture de
 * `sqlite_master` par démarrage.
 */
async function acheverUneReconstructionInterrompue(ctx: ContexteMigration): Promise<void> {
  const tables = await ctx.interroger<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', '${TABLE_NEUVE}')`
  );
  const noms = new Set(tables.map((t) => t.name));

  if (!noms.has('users') && noms.has(TABLE_NEUVE)) {
    await ctx.executer(`ALTER TABLE ${TABLE_NEUVE} RENAME TO users`);
  }
}

/**
 * Reconstruit `users` sur SQLite, qui ne sait pas alléger une colonne.
 *
 * La table neuve est décrite à partir de `PRAGMA table_info`, et non d'un
 * `CREATE TABLE` recopié ici : une installation ancienne peut porter des
 * colonnes qu'une installation neuve n'a pas, et un modèle figé les perdrait
 * en silence. Les valeurs par défaut sont entourées de parenthèses, forme que
 * SQLite exige pour une expression comme `datetime('now')` et accepte pour un
 * littéral.
 *
 * `sqlite_sequence` est recopié : `DROP TABLE` emporte le compteur
 * d'auto-incrément, et la table neuve repartirait du plus grand identifiant
 * présent. Un compte supprimé verrait son numéro réattribué à quelqu'un
 * d'autre — précisément ce que `AUTOINCREMENT` existe pour empêcher.
 */
async function reconstruireSqlite(ctx: ContexteMigration, colonnes: Set<string>): Promise<void> {
  // Rejouer la migration sur une base déjà reconstruite ne doit pas la
  // reconstruire une seconde fois : le journal peut avoir été perdu, et
  // l'opération n'est pas anodine. Reste alors, au plus, la colonne à ajouter.
  if ((await obligatoires(ctx)).size === 0) {
    if (!colonnes.has('can_login')) {
      await ctx.executer('ALTER TABLE users ADD COLUMN can_login INTEGER NOT NULL DEFAULT 1');
    }
    return;
  }

  const infos = await ctx.interroger<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>('PRAGMA table_info(users)');

  const definitions = infos.map((colonne) => {
    if (colonne.pk) return `${colonne.name} ${colonne.type} PRIMARY KEY AUTOINCREMENT`;

    const morceaux = [colonne.name, colonne.type];
    if (colonne.name === 'email') morceaux.push('UNIQUE');
    if (colonne.notnull && !COLONNES_ASSOUPLIES.includes(colonne.name as any)) {
      morceaux.push('NOT NULL');
    }
    if (colonne.dflt_value !== null) morceaux.push(`DEFAULT (${colonne.dflt_value})`);
    return morceaux.join(' ');
  });

  if (!colonnes.has('can_login')) {
    definitions.push('can_login INTEGER NOT NULL DEFAULT 1');
  }

  const noms = infos.map((colonne) => colonne.name).join(', ');
  const avant = await compter(ctx);

  // Les index explicites disparaissent avec la table : leur texte est relevé
  // pour être rejoué. Les index implicites — ceux d'une contrainte UNIQUE —
  // n'ont pas de texte, et renaissent avec la contrainte.
  const index = await ctx.interroger<{ sql: string }>(
    `SELECT sql FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL`
  );

  await ctx.executer('PRAGMA foreign_keys = OFF');
  try {
    // Une tentative précédente peut avoir laissé la table de travail derrière
    // elle, en s'arrêtant avant l'échange. La reprendre vaut mieux que de
    // buter sur « table already exists » à chaque démarrage.
    await ctx.executer(`DROP TABLE IF EXISTS ${TABLE_NEUVE}`);
    await ctx.executer(`CREATE TABLE ${TABLE_NEUVE} (\n  ${definitions.join(',\n  ')}\n)`);
    await ctx.executer(`INSERT INTO ${TABLE_NEUVE} (${noms}) SELECT ${noms} FROM users`);

    const apres = await compter(ctx, TABLE_NEUVE);
    if (apres !== avant) {
      throw new Error(`Copie incomplète : ${avant} compte(s) avant, ${apres} après`);
    }

    const sequence = await ctx.interroger<{ seq: number }>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'users'"
    );

    await ctx.executer('DROP TABLE users');
    await ctx.executer(`ALTER TABLE ${TABLE_NEUVE} RENAME TO users`);
    for (const { sql } of index) await ctx.executer(sql);

    if (sequence[0]?.seq !== undefined) {
      await ctx.executer("UPDATE sqlite_sequence SET seq = ? WHERE name = 'users'", [
        sequence[0].seq,
      ]);
    }
  } finally {
    // Même si l'échange a échoué : laisser les clés étrangères débranchées
    // pour le reste de la vie du serveur coûterait plus cher que la migration
    // ratée elle-même.
    await ctx.executer('PRAGMA foreign_keys = ON');
  }

  const violations = await ctx.interroger('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(
      `${violations.length} référence(s) orpheline(s) après reconstruction de users`
    );
  }
}

/** Colonnes existantes d'une table, dans les deux dialectes supportés. */
async function colonnesDe(ctx: ContexteMigration, table: string): Promise<Set<string>> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(lignes.map((l) => l.name));
  }

  const lignes = await ctx.interroger<{ COLUMN_NAME?: string; column_name?: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name)!).filter(Boolean));
}

/** Celles de `email` / `password` encore obligatoires, sur SQLite. */
async function obligatoires(ctx: ContexteMigration): Promise<Set<string>> {
  const infos = await ctx.interroger<{ name: string; notnull: number }>(
    'PRAGMA table_info(users)'
  );
  return new Set(
    infos
      .filter((c) => c.notnull && COLONNES_ASSOUPLIES.includes(c.name as any))
      .map((c) => c.name)
  );
}

async function compter(ctx: ContexteMigration, table = 'users'): Promise<number> {
  const lignes = await ctx.interroger<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return lignes[0]?.cnt ?? 0;
}

export default personnesSansCompte;
