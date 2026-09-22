import type { ContexteMigration, Migration } from './types';

/**
 * Le numéro d'inventaire interne de la commune.
 *
 * Le parc portait déjà `reference` — une référence libre, employée à tout :
 * le code du fournisseur, le modèle, et le numéro d'inventaire quand
 * l'importation Snipe-IT en apportait un. Employer un seul champ pour ces
 * trois usages convient tant qu'on ne cherche rien ; cela ne convient plus le
 * jour où il faut **rapprocher le parc de la comptabilité**.
 *
 * Car ce sont deux numérotations distinctes, et elles ne se recouvrent pas.
 * Le service comptable numérote ce qu'il a **amorti** — une acquisition, une
 * ligne de budget, parfois un lot entier sous un seul numéro. Les services
 * numérotent ce qu'ils **manipulent** — un exemplaire, une étiquette collée
 * dessus, un QR code. Un même camion porte donc deux numéros qui n'ont ni la
 * même forme ni le même émetteur, et c'est précisément ce qui rend le
 * rapprochement possible : on tient les deux, et le rapprochement devient une
 * jointure au lieu d'un après-midi de recopie.
 *
 * `inventaire_interne` est donc **à côté** de `reference`, pas à sa place.
 * Réutiliser `reference` aurait écrasé ce que les communes y ont déjà mis, et
 * il n'y a pas de migration pour deviner lequel des trois usages une valeur
 * servait.
 *
 * ## Unique, mais seulement quand il est renseigné
 *
 * Un numéro d'inventaire qui désigne deux matériels ne désigne rien. L'index
 * est donc unique — et les deux moteurs tolèrent les `NULL` répétés dans un
 * index unique, si bien que les matériels non numérotés ne se gênent pas. Le
 * service veille à écrire `NULL` plutôt qu'une chaîne vide, qui serait une
 * valeur comme une autre et n'accepterait qu'un seul matériel sans numéro.
 */
const inventaireInterne: Migration = {
  id: '036_inventaire_interne',
  description: 'Numéro d’inventaire interne du parc, distinct de la référence et du numéro comptable',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'objects');
    if (colonnes.size === 0) return;

    if (!colonnes.has('inventaire_interne')) {
      await ctx.executer('ALTER TABLE objects ADD COLUMN inventaire_interne VARCHAR(50)');
    }

    /*
     * `CREATE UNIQUE INDEX` n'est pas ce que rend `ctx.creerIndex`, qui pose un
     * index ordinaire. On le crée donc à la main, avec la même précaution que
     * lui : MySQL ne connaît pas `IF NOT EXISTS` sur un index, et rejouer la
     * migration ne doit pas arrêter le serveur.
     */
    const dejaLa = await indexExiste(ctx, 'objects', 'idx_objects_inventaire_interne');
    if (!dejaLa) {
      try {
        await ctx.executer(
          'CREATE UNIQUE INDEX idx_objects_inventaire_interne ON objects (inventaire_interne)'
        );
      } catch (erreur: any) {
        /*
         * Une base qui porterait déjà des doublons — reprise d'un autre
         * système, colonne remplie à la main avant cette migration — refuserait
         * l'index unique. Mieux vaut un parc sans garde-fou qu'un serveur qui
         * ne démarre plus : on pose alors un index ordinaire, et l'écran
         * signalera le doublon au premier enregistrement.
         */
        console.warn(
          `Index unique sur inventaire_interne non posé (doublons existants ?) : ${erreur?.message ?? erreur}`
        );
        await ctx.creerIndex('idx_objects_inventaire_interne', 'objects', 'inventaire_interne');
      }
    }
  },
};

/** Cet index existe-t-il déjà ? */
async function indexExiste(ctx: ContexteMigration, table: string, nom: string): Promise<boolean> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
      [nom]
    );
    return lignes.length > 0;
  }

  const lignes = await ctx.interroger(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, nom]
  );
  return lignes.length > 0;
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

export default inventaireInterne;
