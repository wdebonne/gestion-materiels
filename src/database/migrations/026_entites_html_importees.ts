import type { Migration } from './types';
import { decoderEntites, porteDesEntites } from '../../utils/decoderEntites';

/**
 * Rend leur apostrophe aux noms repris de Snipe-IT.
 *
 * L'API de Snipe-IT renvoie ses champs déjà échappés pour un affichage web :
 * une barrière nommée « Rad'o » en ressort en « Rad&#039;o ». La première
 * version de l'import recopiait ces textes tels quels, si bien que l'entité
 * restait visible partout — sur la fiche du matériel, dans le référentiel des
 * lieux, et jusque sur l'étiquette collée sur le trousseau.
 *
 * Le défaut est corrigé à la source, mais les bases où une reprise a déjà tourné
 * portent ces textes. Un second import les réparerait pour les matériels, qu'il
 * met à jour — mais pas pour les sites ni les ouvrants, qui sont rapprochés par
 * leur nom : « barrière arrière Rad&#039;o » et « barrière arrière Rad'o » ne se
 * normalisent pas pareil, et le second import créerait un doublon à côté du
 * premier plutôt que de le corriger.
 *
 * Cette migration décode donc sur place, et fusionne ce que le décodage rend
 * identique — deux sites qui ne différaient que par leur échappement n'en font
 * plus qu'un, ouvrants et rattachements de clés reportés.
 *
 * Ne touche que les lignes qui portent effectivement une entité : un nom écrit
 * à la main contenant « & » n'a rien à voir ici et doit rester intact.
 */
const entitesHtmlImportees: Migration = {
  id: '026_entites_html_importees',
  description: 'Décode les entités HTML des noms repris de Snipe-IT',

  async up(ctx) {
    let corriges = 0;

    // --- matériels
    //
    // Les colonnes sont vérifiées avant d'être lues : le banc d'essai applique
    // les migrations sur des schémas partiels, où `objects` peut n'avoir que
    // son nom. Une migration de réparation ne doit pas interrompre le démarrage
    // d'une base à laquelle elle n'a rien à réparer.
    if (await tableExiste(ctx, 'objects')) {
      const colonnes = await colonnesDe(ctx, 'objects');
      const avecReference = colonnes.has('reference');

      if (colonnes.has('name')) {
        const champs = avecReference ? 'id, name, reference' : 'id, name';
        const filtre = avecReference
          ? "name LIKE '%&%' OR reference LIKE '%&%'"
          : "name LIKE '%&%'";

        const lignes = await ctx.interroger<{ id: number; name: string; reference?: string | null }>(
          `SELECT ${champs} FROM objects WHERE ${filtre}`
        );

        for (const ligne of lignes) {
          const nom = porteDesEntites(ligne.name) ? decoderEntites(ligne.name) : ligne.name;
          const reference =
            avecReference && porteDesEntites(ligne.reference)
              ? decoderEntites(ligne.reference as string)
              : ligne.reference;

          if (nom !== ligne.name) {
            await ctx.executer('UPDATE objects SET name = ? WHERE id = ?', [nom, ligne.id]);
            corriges += 1;
          }
          if (avecReference && reference !== ligne.reference) {
            await ctx.executer('UPDATE objects SET reference = ? WHERE id = ?', [
              reference,
              ligne.id,
            ]);
            corriges += 1;
          }
        }
      }
    }

    // --- ouvrants, avant les sites : leur fusion s'appuie sur `site_id`
    if (await tableExiste(ctx, 'cle_ouvrants')) {
      const lignes = await ctx.interroger<{ id: number; name: string }>(
        "SELECT id, name FROM cle_ouvrants WHERE name LIKE '%&%'"
      );

      for (const ligne of lignes) {
        if (!porteDesEntites(ligne.name)) continue;
        await ctx.executer('UPDATE cle_ouvrants SET name = ? WHERE id = ?', [
          decoderEntites(ligne.name),
          ligne.id,
        ]);
        corriges += 1;
      }
    }

    // --- sites, avec fusion des doublons que le décodage révèle
    if (await tableExiste(ctx, 'cle_sites')) {
      const sites = await ctx.interroger<{ id: number; name: string }>(
        'SELECT id, name FROM cle_sites ORDER BY id'
      );

      // Le premier identifiant rencontré pour un nom décodé fait référence :
      // c'est le plus ancien, donc celui auquel le plus de choses se rattachent.
      const parNom = new Map<string, number>();

      for (const site of sites) {
        const decode = porteDesEntites(site.name) ? decoderEntites(site.name) : site.name;
        const cle = normaliser(decode);

        const garde = parNom.get(cle);
        if (garde === undefined) {
          parNom.set(cle, site.id);
          if (decode !== site.name) {
            await ctx.executer('UPDATE cle_sites SET name = ? WHERE id = ?', [decode, site.id]);
            corriges += 1;
          }
          continue;
        }

        // Doublon révélé par le décodage : on reporte ce qui s'y rattache.
        await ctx.executer('UPDATE cle_ouvrants SET site_id = ? WHERE site_id = ?', [
          garde,
          site.id,
        ]);
        if (await tableExiste(ctx, 'cle_ouvre')) {
          await ctx.executer('UPDATE cle_ouvre SET site_id = ? WHERE site_id = ?', [garde, site.id]);
        }
        if (await tableExiste(ctx, 'cle_import_snipeit')) {
          await ctx.executer('UPDATE cle_import_snipeit SET site_id = ? WHERE site_id = ?', [
            garde,
            site.id,
          ]);
        }
        await ctx.executer('DELETE FROM cle_sites WHERE id = ?', [site.id]);
        corriges += 1;
      }
    }

    if (corriges > 0) {
      console.log(`🧹 ${corriges} libellé(s) repris de Snipe-IT décodé(s)`);
    }
  },
};

/** Même normalisation que `cleDeSite`, recopiée pour ne pas figer un service ici. */
function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

/** Vrai si la table est présente, dans les deux dialectes supportés. */
async function tableExiste(
  ctx: Parameters<Migration['up']>[0],
  table: string
): Promise<boolean> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [table]
    );
    return lignes.length > 0;
  }

  const lignes = await ctx.interroger(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return lignes.length > 0;
}

export default entitesHtmlImportees;
