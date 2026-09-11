import type { Migration } from './types';

/**
 * Le mobilier de la voie publique cesse d'être vingt-trois fois le même banc.
 *
 * Un candélabre, un banc, une corbeille sont **un modèle** acheté en série et
 * **des exemplaires** posés à des endroits différents. Le parc ne savait dire
 * que la première moitié : une ligne « Banc Ville de X » dans une catégorie, et
 * rien pour les cent bancs réellement scellés dans la commune. Deux issues
 * s'offraient, toutes deux mauvaises.
 *
 * **Créer cent matériels.** Cent fiches identiques — même référence, même prix,
 * même fournisseur — qu'il faudrait toutes modifier le jour où le fournisseur
 * change, et dans lesquelles « le banc du square » ne se retrouve qu'en lisant
 * les cent notes. Le parc n'est plus un catalogue, c'est un inventaire recopié.
 *
 * **N'en créer qu'un, et compter.** Un champ « quantité : 100 » dit combien on
 * en a, jamais où ils sont ni lequel a été repeint. Or ces cent bancs ne sont
 * ni posés, ni repeints, ni remplacés le même jour : c'est précisément
 * l'exemplaire qui porte l'entretien.
 *
 * Les espaces verts ont tranché la même question avec `green_space_elements` —
 * un matériel du parc, une position sur un plan, un état propre. La voie
 * publique pose exactement le même problème, à deux différences près : il n'y a
 * **pas de plan** à capturer (la commune entière est le plan, et les
 * coordonnées sont des vraies, pas des pourcentages d'image), et le relevé se
 * fait **sur le terrain**, au GPS de l'appareil, autant que devant un écran.
 *
 * D'où `street_furniture` : l'exemplaire, qui garde son rattachement au modèle.
 * Supprimer le modèle supprime ses exemplaires (`ON DELETE CASCADE`) — un
 * candélabre orphelin de tout modèle ne saurait plus dire ce qu'il est, et
 * traînerait sur la carte sans rien vouloir dire.
 *
 * Et `street_furniture_interventions` : ce qui est arrivé à **cet**
 * exemplaire-là. « Le banc 23 a été repeint » est une phrase sur une ligne, pas
 * sur un modèle ; l'écrire sur le modèle la dirait de tous les autres.
 *
 * Enfin `available_for_public_space`, aux trois niveaux, comme le prêt et
 * l'implantation. Le catalogue de pose proposerait sinon les barrières Vauban
 * des manifestations et les prestations de la police municipale à qui vient
 * poser un candélabre. Trois états, `NULL` valant « suivre le niveau au-dessus »,
 * et les catégories partent ouvertes : fermer d'un bloc un module que personne
 * n'a encore réglé le ferait paraître cassé plutôt que rangé.
 */
const migration: Migration = {
  id: '018_mobilier_urbain',
  description:
    'Mobilier de voie publique : exemplaires posés sur la carte, leurs interventions, et le réglage du catalogue',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    // ---- L'exemplaire posé ----
    //
    // `numero` est le rang de cet exemplaire dans son modèle : c'est lui qui
    // fait le « 23 » de « Banc 23 ». Un entier et non le seul libellé, sans
    // quoi « Banc 10 » se rangerait entre « Banc 1 » et « Banc 2 ».
    //
    // `code` est le numéro d'inventaire de la commune, quand elle en a un :
    // gravé sur le mât, collé sous l'assise. Distinct de `numero`, qui est le
    // nôtre et que personne n'est allé peindre sur le mobilier.
    //
    // `position_source` dit d'où vient le point : posé sur la carte, relevé au
    // GPS, ou tapé. Un point relevé à quinze mètres près ne se corrige pas
    // comme un point cliqué sur une photo aérienne, et rien ne le dirait après
    // coup.
    //
    // `street` et `sector` sont du texte et non des tables : une commune
    // entretient par rue et par quartier, mais la liste des rues est déjà
    // écrite sur le terrain. Une table de plus obligerait à la saisir avant de
    // pouvoir poser le premier banc.
    //
    // `last_intervention_date` et `next_intervention_date` sont recopiées
    // depuis les interventions, pour que la carte puisse teinter les retards
    // sans lire l'historique de chacun de ses mille points.
    await ctx.executer(`
      CREATE TABLE IF NOT EXISTS street_furniture (
        id INTEGER PRIMARY KEY ${autoIncrement},
        object_id INTEGER NOT NULL,
        numero INTEGER NOT NULL DEFAULT 1,
        label VARCHAR(255) NOT NULL DEFAULT '',
        code VARCHAR(100) DEFAULT '',
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        position_source VARCHAR(20) DEFAULT 'carte',
        position_accuracy DECIMAL(8,2),
        address VARCHAR(500) DEFAULT '',
        street VARCHAR(255) DEFAULT '',
        sector VARCHAR(255) DEFAULT '',
        status VARCHAR(50) DEFAULT 'en_service',
        condition_state VARCHAR(50) DEFAULT 'bon',
        installed_on DATE,
        last_intervention_date DATE,
        next_intervention_date DATE,
        notes ${texteLong},
        image VARCHAR(500) DEFAULT '',
        custom_fields ${texteLong},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // ---- Ce qui est arrivé à cet exemplaire ----
    //
    // `next_date` se pose au moment où l'on referme l'intervention : c'est là
    // qu'on sait quand repasser, pas six mois après. `performed_by` est du
    // texte — l'entreprise qui est passée n'a pas de compte ici.
    await ctx.executer(`
      CREATE TABLE IF NOT EXISTS street_furniture_interventions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        item_id INTEGER NOT NULL,
        intervention_type VARCHAR(50) DEFAULT 'entretien',
        performed_on DATE,
        next_date DATE,
        description ${texteLong},
        cost DECIMAL(10,2),
        performed_by VARCHAR(255) DEFAULT '',
        user_id INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (item_id) REFERENCES street_furniture(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // ---- Catalogue de pose, aux trois niveaux ----
    // La catégorie porte la valeur de référence : jamais nulle.
    const colonnesCategories = await colonnesDe(ctx, 'categories');
    await ajouterColonne(
      ctx,
      colonnesCategories,
      'categories',
      'available_for_public_space',
      `${booleen} DEFAULT 1`
    );

    // Sous-catégorie et matériel héritent tant qu'on ne tranche pas : pas de
    // valeur par défaut, `NULL` veut dire quelque chose ici.
    const colonnesSousCategories = await colonnesDe(ctx, 'subcategories');
    await ajouterColonne(
      ctx,
      colonnesSousCategories,
      'subcategories',
      'available_for_public_space',
      booleen
    );

    const colonnesObjets = await colonnesDe(ctx, 'objects');
    await ajouterColonne(ctx, colonnesObjets, 'objects', 'available_for_public_space', booleen);
  },
};

/** Ajoute la colonne si elle manque — une migration doit rester rejouable. */
async function ajouterColonne(
  ctx: Parameters<Migration['up']>[0],
  colonnes: Set<string>,
  table: string,
  colonne: string,
  type: string
): Promise<void> {
  // Une table absente n'est pas une erreur : `createTables()` la crée avant que
  // les migrations ne tournent, et un déploiement partiel ne doit pas bloquer le
  // démarrage pour une colonne qu'il n'utilisera pas.
  if (colonnes.size === 0) return;
  if (colonnes.has(colonne)) return;
  await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
}

/** Colonnes existantes d'une table, dans les deux dialectes supportés. */
async function colonnesDe(
  ctx: Parameters<Migration['up']>[0],
  table: string
): Promise<Set<string>> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(lignes.map((l) => l.name));
  }

  const lignes = await ctx.interroger<{ COLUMN_NAME?: string; column_name?: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name) as string));
}

export default migration;
