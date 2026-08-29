import type { Migration } from './types';

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur de matériel unique proposait **tout le parc**. Or une catégorie
 * ne se prête pas d'un bloc : un réfrigérateur de la catégorie Électroménager
 * part volontiers pour une brocante, le grill de la même catégorie non. Une
 * tondeuse autoportée non plus, alors qu'elle voisine avec du matériel qui, lui,
 * circule.
 *
 * Le drapeau existe donc aux trois niveaux, et **le plus précis l'emporte** :
 * une catégorie donne le ton, une sous-catégorie l'affine, un matériel fait
 * exception. `NULL` signifie « suivre le niveau au-dessus » — trois états, pas
 * deux, sans quoi il faudrait recocher chaque matériel d'une catégorie qu'on
 * vient d'ouvrir.
 *
 * Les catégories partent à « prêtable » : c'est le comportement actuel, et
 * fermer le parc d'un coup ferait disparaître sans prévenir du matériel que
 * quelqu'un était en train de demander. On retire ce qu'on ne prête pas.
 */
const migration: Migration = {
  id: '008_materiel_pretable',
  description: 'Disponibilité pour les manifestations, par catégorie, sous-catégorie et matériel',

  async up(ctx) {
    const { booleen } = ctx;

    // La catégorie porte la valeur de référence : jamais nulle.
    const colonnesCategories = await colonnesDe(ctx, 'categories');
    if (!colonnesCategories.has('available_for_manifestations')) {
      await ctx.executer(
        `ALTER TABLE categories ADD COLUMN available_for_manifestations ${booleen} DEFAULT 1`
      );
    }

    // Sous-catégorie et matériel héritent tant qu'on ne tranche pas : pas de
    // valeur par défaut, `NULL` veut dire quelque chose ici.
    const colonnesSousCategories = await colonnesDe(ctx, 'subcategories');
    if (!colonnesSousCategories.has('available_for_manifestations')) {
      await ctx.executer(
        `ALTER TABLE subcategories ADD COLUMN available_for_manifestations ${booleen}`
      );
    }

    const colonnesObjets = await colonnesDe(ctx, 'objects');
    if (!colonnesObjets.has('available_for_manifestations')) {
      await ctx.executer(`ALTER TABLE objects ADD COLUMN available_for_manifestations ${booleen}`);
    }
  },
};

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
