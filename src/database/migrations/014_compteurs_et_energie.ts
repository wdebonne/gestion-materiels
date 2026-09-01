import type { Migration } from './types';

/**
 * Compteurs relevables, et une énergie qui n'est pas toujours du carburant.
 *
 * Deux manques partaient de la même cause : le parc était décrit comme s'il
 * n'était fait que de véhicules thermiques.
 *
 * **Le kilométrage était un nom de champ écrit en dur.** La saisie d'un plein,
 * d'un entretien ou d'un contrôle affichait « Kilométrage » quel que soit le
 * matériel — sur une tondeuse, sur une table — et la valeur était recopiée dans
 * `custom_fields.kilometrage`, une clé fixe. Un champ personnalisé nommé
 * autrement, « kilométrages » par exemple, n'était donc jamais alimenté : la
 * fiche affichait un compteur vide pendant que l'historique des pleins en
 * portait un. Un compteur devient ici une **propriété déclarée du champ**
 * (`is_counter`, `counter_unit`) : une catégorie compte en kilomètres, une autre
 * en heures moteur, une troisième ne compte rien et ne voit plus aucun champ de
 * relevé. Les relevés saisis sont conservés sur l'écriture elle-même
 * (`readings`), pas seulement reportés sur la fiche, pour qu'un relevé effacé
 * par erreur puisse être retrouvé.
 *
 * **L'électrique n'existait pas.** Le plugin Carburant demandait des litres et
 * un prix au litre, y compris pour une 208 électrique déjà au parc. Saisir une
 * recharge obligeait à écrire des kWh dans une colonne libellée « L », ce que
 * personne ne fait deux fois : les recharges n'étaient tout simplement pas
 * saisies, et le coût d'usage du véhicule électrique restait à zéro. Une
 * écriture porte désormais sa nature (`energy_kind`), et les points de
 * ravitaillement la portent aussi (`kind`) — une borne de recharge n'a rien à
 * faire dans la liste des stations-service.
 *
 * Le repli est partout le thermique : tout ce qui existe a été saisi en litres,
 * et rien ne permet de deviner autre chose après coup.
 */
const migration: Migration = {
  id: '014_compteurs_et_energie',
  description: 'Compteurs relevables par catégorie, et écritures d\'énergie électrique',

  async up(ctx) {
    const champs = await colonnesDe(ctx, 'custom_fields_config');

    // Une table absente n'est pas une erreur : `createTables()` la crée avant
    // que les migrations ne tournent, et un déploiement partiel ne doit pas
    // empêcher le démarrage pour une colonne qu'il n'utilisera jamais. Un
    // ensemble de colonnes vide signale l'absence dans les deux dialectes.
    if (champs.size === 0) return;

    // Un champ Nombre déclaré compteur : sa valeur ne recule pas, et il est
    // proposé en relevé à chaque saisie de terrain.
    if (!champs.has('is_counter')) {
      await ctx.executer(
        `ALTER TABLE custom_fields_config ADD COLUMN is_counter ${ctx.booleen} DEFAULT 0`
      );
    }

    // L'unité s'affiche partout où le relevé se lit — « 84 320 km »,
    // « 412 h ». Sans elle, un nombre nu ne dit pas ce qu'il compte.
    if (!champs.has('counter_unit')) {
      await ctx.executer(
        `ALTER TABLE custom_fields_config ADD COLUMN counter_unit VARCHAR(20)`
      );
    }

    // Nature de l'écriture : 'fuel' (litres, €/L, station) ou 'electric'
    // (kWh, €/kWh, borne). Portée par l'écriture et non déduite du matériel :
    // un véhicule reconverti garde l'historique juste de ce qu'il a consommé.
    const pleins = await colonnesDe(ctx, 'fuel_entries');
    if (pleins.size > 0 && !pleins.has('energy_kind')) {
      await ctx.executer(
        `ALTER TABLE fuel_entries ADD COLUMN energy_kind VARCHAR(20) DEFAULT 'fuel'`
      );
      await ctx.executer(`UPDATE fuel_entries SET energy_kind = 'fuel' WHERE energy_kind IS NULL`);
    }

    // Relevés de compteurs saisis avec l'écriture, sous la forme
    // { "kilometrage": 84320 }. La colonne `mileage` existante reste alimentée
    // avec le compteur principal : le module Suivi, les exports et les modèles
    // d'e-mail la lisent, et les réécrire tous ici serait un autre chantier.
    for (const table of ['fuel_entries', 'maintenances', 'technical_controls']) {
      const colonnes = await colonnesDe(ctx, table);
      if (colonnes.size > 0 && !colonnes.has('readings')) {
        await ctx.executer(`ALTER TABLE ${table} ADD COLUMN readings ${ctx.texteLong}`);
      }
    }

    // Stations-service et bornes de recharge partagent la table mais pas la
    // liste : on ne propose pas « Total » pour brancher une voiture.
    const stations = await colonnesDe(ctx, 'fuel_stations');
    if (stations.size > 0 && !stations.has('kind')) {
      await ctx.executer(
        `ALTER TABLE fuel_stations ADD COLUMN kind VARCHAR(20) DEFAULT 'fuel'`
      );
      await ctx.executer(`UPDATE fuel_stations SET kind = 'fuel' WHERE kind IS NULL`);
    }

    // Reprise des champs de kilométrage déjà créés à la main. Sans elle, les
    // catégories qui suivaient déjà leur kilométrage perdraient le report
    // automatique le jour de la mise à jour, sans que personne ne le remarque
    // avant de lire une fiche restée à la valeur de la veille.
    const candidats = await ctx.interroger<{ id: number; field_name: string; field_label: string }>(
      `SELECT id, field_name, field_label FROM custom_fields_config
       WHERE field_type = 'number' AND (is_counter = 0 OR is_counter IS NULL)`
    );

    for (const champ of candidats) {
      if (!ressembleAUnKilometrage(champ.field_name, champ.field_label)) continue;
      await ctx.executer(
        `UPDATE custom_fields_config SET is_counter = 1, counter_unit = 'km' WHERE id = ?`,
        [champ.id]
      );
    }
  },
};

/**
 * Un champ nombre qui compte visiblement des kilomètres.
 *
 * Volontairement large — « kilometrage », « Kilométrages », « km parcourus » —
 * parce que le coût d'un faux positif est faible : le champ devient un compteur
 * et se met à jour tout seul, ce qui est de toute façon ce qu'on veut d'un
 * champ nommé ainsi. Le superviseur peut décocher la case.
 */
function ressembleAUnKilometrage(nom: string, libelle: string): boolean {
  const normaliser = (v: string) =>
    (v ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  const texte = `${normaliser(nom)} ${normaliser(libelle)}`;
  return /kilometr|\bkm\b/.test(texte);
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
