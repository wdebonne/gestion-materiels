import type { Migration } from './types';

/**
 * Un espace vert se garnit **depuis le parc**, et ce qu'il a coûté ne bouge plus.
 *
 * Les éléments d'un espace vert se saisissaient à la main, dans une fenêtre qui
 * ne connaissait rien du parc : on retapait « Rosier Pierre de Ronsard », son
 * espèce, son image et son prix, alors que le rosier est déjà au parc avec sa
 * référence, sa catégorie et son prix unitaire. Deux saisies pour une chose, et
 * la seconde, faite à la va-vite un jour de plantation, ne ressemblait jamais
 * tout à fait à la première : impossible ensuite de totaliser ce que les massifs
 * ont coûté, puisque « rosier », « Rosier PdR » et « rosiers rouges » sont trois
 * lignes différentes.
 *
 * Le parc devient donc la **seule** source : on y tient des lots — dix rosiers,
 * trois sacs de bulbes — et du mobilier, à l'unité ou en lot, et l'espace vert
 * ne fait que **poser** ce matériel, en quantité, éventuellement dans une
 * jardinière qui mélange les variétés.
 *
 * Reste la question qui décide de tout : **à quel prix ?**
 *
 * Le prix du parc est celui d'aujourd'hui. Il montera l'an prochain, et il doit
 * monter — c'est le prix auquel on rachètera. Mais les dix rosiers plantés au
 * printemps dernier ont coûté ce qu'ils ont coûté, et rien ne doit les
 * réévaluer après coup : un massif dont le coût change tout seul parce qu'un
 * tarif a été mis à jour ne sert plus à rien, ni pour un bilan, ni pour un
 * budget.
 *
 * Le prix est donc **figé à la pose**, sur l'implantation elle-même
 * (`purchase_price`, unitaire), et `cost_source` dit d'où il vient — repris du
 * parc, ou saisi à la main parce que la facture du pépiniériste disait autre
 * chose. Mettre à jour le parc n'écrit rien dans le passé.
 *
 * Cette colonne était déjà là et déjà remplie ainsi. Ce qui manquait était plus
 * grave : la lecture la **remplaçait** par le prix courant du parc — `gse.*`
 * puis `o.purchase_price` sous le même nom, et c'est la seconde qui gagne. Le
 * prix figé existait en base et n'arrivait jamais à l'écran. La correction est
 * dans les requêtes ; la colonne ajoutée ici dit seulement d'où vient le nombre.
 */
const migration: Migration = {
  id: '015_implantation_depuis_le_parc',
  description: "Implantation du matériel du parc dans les espaces verts, à prix figé",

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'green_space_elements');

    // Une table absente n'est pas une erreur : `createTables()` la crée avant
    // que les migrations ne tournent, et un déploiement partiel ne doit pas
    // bloquer le démarrage pour une colonne qu'il n'utilisera pas.
    if (colonnes.size === 0) return;

    // 'parc' : prix repris du matériel au moment de la pose.
    // 'saisi' : prix tapé à la main, qui l'emporte sur celui du parc.
    // Le repli est 'saisi' : tout ce qui existe a été tapé dans l'ancienne
    // fenêtre, et le présenter comme venant du parc serait faux.
    if (!colonnes.has('cost_source')) {
      await ctx.executer(
        `ALTER TABLE green_space_elements ADD COLUMN cost_source VARCHAR(20) DEFAULT 'saisi'`
      );
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
