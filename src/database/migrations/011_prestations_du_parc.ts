import type { Migration } from './types';

/**
 * Prestations déclarées dans le parc, par branche de l'arbre.
 *
 * Une prestation ne se créait que depuis Manifestations › Stock matériel, un
 * catalogue séparé. Or l'arbre des catégories est **déjà partagé** : le parc et
 * le stock des manifestations pointent tous deux vers `categories` et
 * `subcategories`. Rien n'empêchait donc de tenir ses prestations là où le
 * service tient déjà son matériel — sauf de pouvoir dire « cette branche, ce
 * sont des prestations ».
 *
 * L'organisation visée est celle d'une collectivité : la **catégorie est le
 * service**, et ses sous-catégories mêlent matériel et prestations.
 *
 *     Technique      → Prestation (raccordement électrique) · Mobilier (chaises)
 *     Urbanisme      → Prestation (débit de boissons) · Armoires · Bureau
 *     Restauration   → Prestation (personnel de service) · Verrerie (verres)
 *
 * C'est aussi ce qui fait tomber le routage d'approbation tout seul : le
 * périmètre d'un service est un ensemble de catégories, et une prestation
 * classée sous « Urbanisme » sollicite l'urbanisme sans une ligne de plus.
 *
 * Trois niveaux, **le plus précis l'emporte**, exactement comme la disponibilité
 * pour les manifestations : la catégorie donne le ton, la sous-catégorie
 * l'affine, le matériel fait exception. `NULL` veut dire « suivre le niveau
 * au-dessus » — trois états et non deux, sans quoi marquer une sous-catégorie
 * obligerait à recocher chacun de ses articles.
 *
 * Le repli est « ce n'est pas une prestation » : tout le parc existant reste du
 * matériel, et on désigne ce qui n'en est pas.
 */
const migration: Migration = {
  id: '011_prestations_du_parc',
  description: 'Prestations par catégorie, sous-catégorie et matériel du parc',

  async up(ctx) {
    const { booleen } = ctx;

    // La catégorie porte la valeur de référence : jamais nulle. Un parc entier
    // de prestations est possible — un service qui ne prête rien — mais c'est
    // l'exception, d'où le repli à 0.
    const colonnesCategories = await colonnesDe(ctx, 'categories');
    if (!colonnesCategories.has('is_prestation')) {
      await ctx.executer(`ALTER TABLE categories ADD COLUMN is_prestation ${booleen} DEFAULT 0`);
    }

    // Sous-catégorie et matériel héritent tant qu'on ne tranche pas : pas de
    // valeur par défaut, `NULL` veut dire quelque chose ici.
    const colonnesSousCategories = await colonnesDe(ctx, 'subcategories');
    if (!colonnesSousCategories.has('is_prestation')) {
      await ctx.executer(`ALTER TABLE subcategories ADD COLUMN is_prestation ${booleen}`);
    }

    const colonnesObjets = await colonnesDe(ctx, 'objects');
    if (!colonnesObjets.has('is_prestation')) {
      await ctx.executer(`ALTER TABLE objects ADD COLUMN is_prestation ${booleen}`);
    }

    // Une prestation se demande en nombre — « 3 agents pour la cérémonie » —
    // là où un matériel unique vaut toujours 1. La colonne existe déjà sur
    // `manifestation_items`, mais elle était écrite en dur à 1 : rien à ajouter
    // ici, seulement à cesser de l'ignorer.
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
