import type { Migration } from './types';

/**
 * Le plan capturé se souvient d'où il regarde.
 *
 * La capture depuis la carte produisait une image et une échelle, puis oubliait
 * tout le reste. Le cadrage — centre, zoom, dimensions, fond — n'était nulle
 * part, et trois choses en découlaient, toutes pénibles.
 *
 * **On ne pouvait pas changer de fond.** Passer de la photo aérienne au plan
 * IGN obligeait à retrouver le même endroit sur la carte, au même zoom, à la
 * main. Le cadre obtenu ne retombait jamais exactement au même endroit, et
 * chaque repère, chaque zone posée dessus se retrouvait décalé — les
 * coordonnées sont des pourcentages du plan, elles ne suivent pas.
 *
 * **On ne pouvait pas recadrer.** Une capture prend le format de la carte
 * affichée, c'est-à-dire très allongé sur un écran large. Un massif de six
 * cents mètres carrés se retrouvait perdu au milieu de six cents mètres de
 * ville, et il fallait zoomer à 300 % à chaque ouverture pour voir quelque
 * chose. Recapturer plus serré était possible, mais détruisait tout ce qui
 * était posé.
 *
 * **Rien ne pouvait suivre.** Connaissant l'ancien cadrage et le nouveau, une
 * position en pourcentages se retraduit exactement : les deux désignent le même
 * point du globe. Sans l'ancien, la conversion est impossible et la seule
 * option honnête était d'avertir que tout serait décalé.
 *
 * D'où cette colonne. Elle porte du JSON — `{ lat, lng, zoom, largeur, hauteur,
 * fond }` — et reste `NULL` pour un plan chargé à la main, qui ne regarde nulle
 * part et pour lequel ces questions n'ont pas de sens.
 */
const migration: Migration = {
  id: '017_cadrage_du_plan',
  description:
    'Cadrage de la capture mémorisé sur l’espace vert : changement de fond et recadrage sans rien déplacer',

  async up(ctx) {
    const { texteLong } = ctx;

    const colonnes = await colonnesDe(ctx, 'green_spaces');
    if (colonnes.size === 0) return;

    await ajouterColonne(ctx, colonnes, 'green_spaces', 'plan_capture', texteLong);
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
