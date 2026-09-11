import type { Migration } from './types';

/**
 * Une jardinière sur un parking n'est pas un espace vert.
 *
 * Les espaces verts savent déjà composer : un massif, une haie, une jardinière
 * regroupent des variétés dans `green_space_groups`, et l'on y plante trente
 * rosiers dans un bac. Mais tout cela suppose un **espace vert** — une fiche,
 * un plan, une superficie, un type de lieu.
 *
 * Or la moitié du fleurissement d'une commune n'est dans aucun parc : des bacs
 * suspendus aux lampadaires de la grand-rue, une jardinière sur un îlot de
 * parking, deux vasques devant la mairie. Créer un « espace vert » pour chaque
 * bac serait absurde — un espace vert de 0,4 m² avec un plan et un contour —,
 * et laisser ces fleurs hors de l'application les laisse hors de l'entretien.
 *
 * D'où deux colonnes, et deux seulement.
 *
 * `parent_id` fait d'un exemplaire le **contenant** d'un autre. La jardinière
 * est un exemplaire du modèle « Jardinière béton » ; les géraniums qu'elle
 * porte sont des exemplaires du modèle « Géranium lierre » dont le parent est
 * cette jardinière-là. Exactement ce que fait un groupe de composition dans un
 * espace vert, sans exiger l'espace vert autour.
 *
 * Un contenu n'a pas de position propre : il est là où est son contenant, et
 * la position se recopie à la pose comme au déplacement. La rendre nulle aurait
 * sorti les fleurs de « autour de moi » et de l'emprise de la carte, alors
 * qu'elles sont bel et bien à cet endroit.
 *
 * `ON DELETE CASCADE` : vider une jardinière qu'on enlève est le comportement
 * attendu. Les fleurs ne survivent pas au bac dont on ne sait plus où il était.
 *
 * `quantity` parce qu'on ne plante pas un géranium. Un banc reste à 1 — il est
 * identifié, c'est tout son intérêt —, mais douze géraniums dans un bac sont
 * une ligne et non douze, comme `green_space_elements.quantity` le fait déjà
 * pour les lots du parc.
 */
const migration: Migration = {
  id: '019_jardinieres_hors_parc',
  description:
    'Contenants sur la voie publique : une jardinière hors espace vert porte ses plantations',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'street_furniture');
    if (colonnes.size === 0) return;

    await ajouterColonne(ctx, colonnes, 'street_furniture', 'parent_id', 'INTEGER');
    await ajouterColonne(ctx, colonnes, 'street_furniture', 'quantity', 'INTEGER DEFAULT 1');
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
