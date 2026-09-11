import type { Migration } from './types';

/**
 * Le plan annoté devient un outil de terrain, et non un formulaire déguisé.
 *
 * Trois manques se répondaient.
 *
 * **Une surface qu'on ne pouvait que croire.** Le champ « Surface (m²) » d'un
 * élément était rempli de mémoire, et le polygone dessiné juste à côté ne disait
 * rien : deux affirmations sur la même chose, sans moyen de les confronter. Un
 * plan **calibré** — un segment tracé sur une longueur connue, et sa longueur
 * réelle saisie — donne enfin la surface depuis le dessin. `plan_scale_metres`
 * est ce que vaut un pourcent de **largeur** ; `plan_ratio`, la hauteur divisée
 * par la largeur de l'image, redresse la hauteur, car l'overlay du plan étire
 * l'image (`preserveAspectRatio="none"`) et un pourcent vertical ne mesure pas
 * comme un pourcent horizontal. `plan_scale_points` garde le segment tracé :
 * corriger un calibrage douteux vaut mieux que le refaire de zéro.
 *
 * Le calibrage reste facultatif. Une surface se saisit toujours à la main pour
 * un rendu rapide, et `area_source` retient laquelle des deux voies a parlé :
 * une valeur corrigée à la main ne doit **jamais** être écrasée par un sommet
 * qu'on déplace ensuite.
 *
 * **Un coût qu'on ne pouvait pas refuser.** Tracer la pelouse qui était là
 * avant nous obligeait à lui inventer un prix, ou à la laisser sans surface.
 * `exclude_from_costs` permet de la dessiner sans la chiffrer — et la ligne
 * reste comptée à part, jamais fondue dans un total qui se lirait comme complet.
 *
 * **Un catalogue qui montrait tout.** Poser du gazon ou de l'enrobé se fait
 * depuis le parc, mais le parc contient aussi les prestations de la police
 * municipale et le matériel des manifestations, que personne ne plante. Le
 * drapeau existe donc aux trois niveaux et **le plus précis l'emporte** :
 * la catégorie donne le ton, la sous-catégorie l'affine, un matériel fait
 * exception. `NULL` veut dire « suivre le niveau au-dessus » — trois états et
 * non deux, sans quoi ouvrir une catégorie obligerait à recocher chacun de ses
 * matériels, et personne ne le ferait.
 *
 * Les catégories partent à « implantable », comme le fait déjà le prêt pour les
 * manifestations : fermer le parc d'un coup ferait disparaître sans prévenir du
 * matériel que quelqu'un était en train de poser. On retire ce qu'on ne plante
 * pas.
 */
const migration: Migration = {
  id: '016_plan_annote',
  description:
    'Calibrage du plan, surfaces calculées, zones hors coûts et matériel implantable en espaces verts',

  async up(ctx) {
    const { booleen, texteLong } = ctx;

    // ---- Calibrage du plan, sur l'espace vert ----
    const colonnesEspaces = await colonnesDe(ctx, 'green_spaces');
    if (colonnesEspaces.size > 0) {
      // Précision large à dessein : sur un plan de ville, un pourcent de largeur
      // peut valoir plusieurs mètres ; sur le plan d'une jardinière, quelques
      // centimètres. Arrondir ici fausserait toutes les surfaces au carré.
      await ajouterColonne(ctx, colonnesEspaces, 'green_spaces', 'plan_scale_metres', 'DECIMAL(16,8)');
      await ajouterColonne(ctx, colonnesEspaces, 'green_spaces', 'plan_ratio', 'DECIMAL(12,8)');
      await ajouterColonne(ctx, colonnesEspaces, 'green_spaces', 'plan_scale_points', texteLong);
    }

    // ---- Surfaces et coûts, sur les éléments ----
    const colonnesElements = await colonnesDe(ctx, 'green_space_elements');
    if (colonnesElements.size > 0) {
      // 'saisi' : la surface a été tapée, elle est intouchable.
      // 'calcule' : elle vient du polygone, et suit ses sommets.
      // Le repli est 'saisi' : tout ce qui existe a été tapé à la main, et le
      // présenter comme calculé autoriserait à l'écraser au premier déplacement.
      await ajouterColonne(
        ctx,
        colonnesElements,
        'green_space_elements',
        'area_source',
        `VARCHAR(20) DEFAULT 'saisi'`
      );
      await ajouterColonne(
        ctx,
        colonnesElements,
        'green_space_elements',
        'exclude_from_costs',
        `${booleen} DEFAULT 0`
      );
    }

    // ---- Matériel implantable, aux trois niveaux ----
    // La catégorie porte la valeur de référence : jamais nulle.
    const colonnesCategories = await colonnesDe(ctx, 'categories');
    await ajouterColonne(
      ctx,
      colonnesCategories,
      'categories',
      'available_for_green_spaces',
      `${booleen} DEFAULT 1`
    );

    // Sous-catégorie et matériel héritent tant qu'on ne tranche pas : pas de
    // valeur par défaut, `NULL` veut dire quelque chose ici.
    const colonnesSousCategories = await colonnesDe(ctx, 'subcategories');
    await ajouterColonne(
      ctx,
      colonnesSousCategories,
      'subcategories',
      'available_for_green_spaces',
      booleen
    );

    const colonnesObjets = await colonnesDe(ctx, 'objects');
    await ajouterColonne(ctx, colonnesObjets, 'objects', 'available_for_green_spaces', booleen);
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
