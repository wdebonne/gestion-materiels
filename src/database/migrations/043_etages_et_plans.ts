import type { ContexteMigration, Migration } from './types';

/**
 * Les étages, leurs plans, les pièces dessinées dessus, et ce qu'elles contiennent.
 *
 * « Où est rangé le vidéoprojecteur ? », « quelle clé ouvre la salle 12 ? »,
 * « combien de chaises dans la salle polyvalente ? » : la réponse existait —
 * les pièces (migration 037), les clés et ce qu'elles ouvrent (024, 037) —
 * mais rien ne la montrait. On la pose sur le plan de l'étage : cliquer une
 * pièce dit ce qu'elle contient et qui peut y entrer.
 *
 * ## Un étage, un plan
 *
 * `site_etages` porte le plan : une **image** rangée dans le dossier privé —
 * un plan d'école dit où sont les issues, il ne se sert pas en statique. Un plan
 * reçu en PDF est converti en image par le navigateur avant l'envoi : le
 * serveur n'a pas de moteur de rendu PDF, et n'en aura pas pour ça. Un DWG
 * s'exporte en PDF depuis le logiciel qui l'a produit.
 *
 * `plan_ratio` (hauteur ÷ largeur) et `echelle_metres` (longueur réelle d'un
 * pourcent de largeur) sont ceux du plan annoté des espaces verts (migration
 * 016) : les zones sont en **pourcentages** du plan, et c'est ce qui permet de
 * remplacer un plan par un autre de même cadrage sans rien redessiner.
 *
 * ## La pièce reçoit un étage et une zone
 *
 * `etage_id` en `SET NULL` : supprimer un étage rend ses pièces au bâtiment,
 * sans les effacer — elles portent des clés, des tickets, des occupations.
 * `zone_points` est le polygone JSON, validé par `geometriePlan.service` comme
 * celui des espaces verts ; `surface_m2` se calcule quand le plan est étalonné.
 *
 * ## Le matériel dans la pièce
 *
 * `piece_materiels` dit qu'un matériel du parc est dans une pièce, et combien :
 * cinquante chaises d'un même lot se répartissent entre trois salles. Une ligne
 * par pièce et par matériel (`UNIQUE`) ; un matériel unique n'est que dans une
 * pièce à la fois, ce que le service tient — il déplace plutôt qu'il ne double.
 */
const etagesEtPlans: Migration = {
  id: '043_etages_et_plans',
  description: 'Étages et plans des bâtiments, zones des pièces, matériel posé dans les pièces',

  async up(ctx) {
    const { autoIncrement, texteLong, horodatageParDefaut } = ctx;

    if ((await colonnesDe(ctx, 'cle_sites')).size === 0) return;
    if ((await colonnesDe(ctx, 'site_pieces')).size === 0) return;
    if ((await colonnesDe(ctx, 'objects')).size === 0) return;

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS site_etages (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        nom VARCHAR(100) NOT NULL,
        niveau INTEGER NOT NULL DEFAULT 0,
        plan_chemin VARCHAR(500),
        plan_mime VARCHAR(100),
        plan_largeur INTEGER,
        plan_hauteur INTEGER,
        plan_ratio DECIMAL(12,8),
        echelle_metres DECIMAL(16,8),
        echelle_points ${texteLong},
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_site_etages_site', 'site_etages', 'site_id');

    await ajouterColonne(ctx, 'site_pieces', 'etage_id', 'INTEGER', {
      nom: 'fk_site_pieces_etage',
      table: 'site_etages',
      surSuppression: 'SET NULL',
    });
    await ctx.creerIndex('idx_site_pieces_etage', 'site_pieces', 'etage_id');
    await ajouterColonne(ctx, 'site_pieces', 'zone_points', texteLong);
    await ajouterColonne(ctx, 'site_pieces', 'surface_m2', 'DECIMAL(12,2)');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS piece_materiels (
        id INTEGER PRIMARY KEY ${autoIncrement},
        piece_id INTEGER NOT NULL,
        object_id INTEGER NOT NULL,
        quantite INTEGER NOT NULL DEFAULT 1,
        notes VARCHAR(500),
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        UNIQUE (piece_id, object_id),
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );
    await ctx.creerIndex('idx_piece_materiels_object', 'piece_materiels', 'object_id');
  },
};

interface CleEtrangere {
  nom: string;
  table: string;
  surSuppression: 'SET NULL' | 'CASCADE';
}

/**
 * Ajoute une colonne si elle manque, avec sa clé étrangère sur les deux moteurs.
 * Recopié de la migration 037, qui explique pourquoi elle existe.
 */
async function ajouterColonne(
  ctx: ContexteMigration,
  table: string,
  colonne: string,
  type: string,
  fk?: CleEtrangere
): Promise<void> {
  const colonnes = await colonnesDe(ctx, table);
  if (colonnes.size === 0) return;

  if (!colonnes.has(colonne)) {
    const reference =
      fk && ctx.dialecte === 'sqlite' ? ` REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}` : '';
    await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}${reference}`);
  }

  if (!fk || ctx.dialecte === 'sqlite') return;
  if (await contrainteExiste(ctx, table, fk.nom)) return;

  try {
    await ctx.executer(
      `ALTER TABLE ${table}
         ADD CONSTRAINT ${fk.nom} FOREIGN KEY (${colonne})
         REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}`
    );
  } catch (erreur: any) {
    console.warn(`Clé étrangère ${fk.nom} non posée sur ${table}.${colonne} : ${erreur?.message ?? erreur}`);
  }
}

async function contrainteExiste(ctx: ContexteMigration, table: string, nom: string): Promise<boolean> {
  if (ctx.dialecte === 'sqlite') return true;
  const lignes = await ctx.interroger(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, nom]
  );
  return lignes.length > 0;
}

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 * Recopié plutôt que partagé : une migration décrit l'état du code au jour où
 * elle a été écrite.
 */
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

export default etagesEtPlans;
