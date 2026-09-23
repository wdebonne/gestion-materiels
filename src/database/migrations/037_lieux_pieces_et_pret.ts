import type { ContexteMigration, Migration } from './types';

/**
 * Les pièces d'un bâtiment, et ce qui se prête.
 *
 * Le référentiel des lieux tenait deux niveaux : un bâtiment (`cle_sites`) et
 * ses ouvrants (`cle_ouvrants`). La migration 024 le justifiait ainsi — « une
 * commune a des bâtiments et des portes, pas une arborescence » — et l'argument
 * valait tant que le référentiel ne servait qu'aux clés.
 *
 * Il ne tient plus. Deux usages sont arrivés depuis, et tous deux butent sur le
 * niveau manquant.
 *
 * **La clé.** Entre le passe qui ouvre toute la mairie et la clé d'une porte
 * unique, il existe le passe partiel : celui du service état civil, qui ouvre
 * la salle des mariages et ses deux accès, et rien d'autre. Faute d'un niveau
 * intermédiaire, il fallait le décrire en listant ses portes une à une, et la
 * liste se périmait à la première porte ajoutée.
 *
 * **La manifestation.** On ne prête pas une porte, on prête une salle. « La
 * salle des mariages est-elle libre le 28 ? » n'avait aucun objet à désigner :
 * ni `cle_sites`, qui répond « la mairie », ni `cle_ouvrants`, qui répond « la
 * porte principale ». La question restait donc en texte libre, et sans réponse.
 *
 * D'où un troisième niveau, **nommé** et non libre : bâtiment → pièce →
 * ouvrant. La profondeur reste fixe, ce que la migration 024 défendait
 * réellement ; c'est le nombre d'étages qui change, pas le principe. Un ouvrant
 * peut rester accroché au bâtiment sans passer par une pièce — la barrière
 * principale et le portail du stade n'appartiennent à aucune salle, et les
 * forcer dans une pièce fictive « Extérieur » ferait inventer à chaque commune
 * sa propre convention.
 *
 * ## Pourquoi `site_pieces` et non `cle_pieces`
 *
 * Les migrations 024 et 032 expliquent longuement que `cle_sites` garde son nom
 * parce qu'`ALTER TABLE … RENAME` n'est pas rejouable, donc interdit ici. C'est
 * un accident historique assumé, pas un modèle à suivre : la table est née dans
 * le module Clés et n'en dépend plus depuis que les tickets la lisent. Une table
 * neuve n'a aucune raison d'hériter du préfixe d'un module auquel elle
 * n'appartient pas — elle servira aux clés, aux tickets et aux manifestations
 * dès sa première semaine.
 *
 * ## `pretable` a trois états, et son défaut est « non »
 *
 * C'est la mécanique de `disponibiliteParc.service.ts`, reprise telle quelle :
 * `NULL` veut dire « suivre le bâtiment », et non « non ». Sans ce troisième
 * état, ouvrir un bâtiment au prêt obligerait à recocher chacune de ses pièces.
 *
 * Le repli, en revanche, est **inverse** de celui du parc. Un matériel sans
 * réglage est réputé prêtable, parce que le réglage est arrivé après les
 * matériels et ne devait rien changer à l'existant. Aucun lieu n'a jamais été
 * prêtable : replier sur « oui » mettrait d'un coup le centre technique, le
 * local électrique et le cimetière dans la liste des salles à louer. Le repli
 * est donc `0`, et c'est à l'administrateur d'ouvrir ce qui se prête.
 *
 * ## Les clés étrangères sont posées à la main, moteur par moteur
 *
 * `ALTER TABLE … ADD COLUMN … REFERENCES` est honoré par SQLite et **ignoré
 * silencieusement** par InnoDB, qui parse la clause et la jette. Une colonne
 * écrite d'un seul geste aurait donc protégé le développement et laissé la
 * production accumuler des `piece_id` pendants. Le `ON DELETE` n'est pas ici
 * une simple validation : c'est le comportement attendu quand une pièce
 * disparaît, et il doit valoir sur les deux moteurs.
 */
const lieuxPiecesEtPret: Migration = {
  id: '037_lieux_pieces_et_pret',
  description: 'Pièces des bâtiments, portée des clés sur une pièce, et drapeau de prêt des lieux',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    /*
     * Le référentiel vient de la migration 024. S'il n'est pas là, la base est
     * à un état antérieur que le lanceur rattrapera avant d'arriver ici ; on ne
     * force rien.
     */
    const colonnesSites = await colonnesDe(ctx, 'cle_sites');
    if (colonnesSites.size === 0) return;

    // ------------------------------------------------------------- les pièces

    /*
     * `type_lieu` est libre et non une liste fermée : salle, hall, cour,
     * terrain, préau, bureau, local. Figer l'énumération obligerait à une
     * migration le jour où une commune veut « chapiteau », pour un champ dont
     * le seul usage est de filtrer une liste.
     *
     * Le nom évite `type` tout court, qui se lit mal dans une requête et que
     * plusieurs outils de migration traitent à part.
     *
     * `capacite` sert à écarter d'emblée les salles trop petites quand une
     * demande annonce son nombre de participants — `manifestations` porte déjà
     * `expected_people`.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS site_pieces (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        description ${texteLong},
        type_lieu VARCHAR(50),
        capacite INTEGER,
        pretable ${booleen},
        sort_order INTEGER DEFAULT 0,
        is_active ${booleen} NOT NULL DEFAULT 1,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_site_pieces_site', 'site_pieces', 'site_id');

    // ------------------------------------------------- l'ouvrant dans sa pièce

    /*
     * `SET NULL` et non `CASCADE` : supprimer la salle des mariages doit rendre
     * ses portes au bâtiment, pas les effacer. Une porte effacée emporterait
     * avec elle ce que des clés ouvrent — exactement ce que la migration 024
     * refuse pour les sites.
     */
    await ajouterColonne(ctx, 'cle_ouvrants', 'piece_id', 'INTEGER', {
      nom: 'fk_cle_ouvrants_piece',
      table: 'site_pieces',
      surSuppression: 'SET NULL',
    });
    await ctx.creerIndex('idx_cle_ouvrants_piece', 'cle_ouvrants', 'piece_id');

    // ------------------------------------------- ce qu'une clé ouvre, 3 portées

    /*
     * Rattachée au site, la clé est un passe général ; à une pièce, un passe
     * partiel ; à un ouvrant, elle n'ouvre que cette porte-là.
     *
     * « Exactement un des trois est renseigné » reste tenu par le service et non
     * par un `CHECK`, pour la raison que donne la migration 024 : MySQL 5.7
     * analyse les `CHECK` et les ignore, si bien qu'une contrainte écrite ici
     * protégerait le développement sur SQLite et pas la production.
     *
     * `CASCADE` cette fois : une ligne de `cle_ouvre` ne dit rien d'autre que le
     * lien lui-même. La pièce disparue, le lien n'a plus d'objet.
     */
    await ajouterColonne(ctx, 'cle_ouvre', 'piece_id', 'INTEGER', {
      nom: 'fk_cle_ouvre_piece',
      table: 'site_pieces',
      surSuppression: 'CASCADE',
    });
    await ctx.creerIndex('idx_cle_ouvre_piece', 'cle_ouvre', 'piece_id');

    // ---------------------------------------------------- le bâtiment prêtable

    await ajouterColonne(ctx, 'cle_sites', 'pretable', booleen);

    // ------------------------------------------------- la pièce d'une demande

    /*
     * Une fuite se signale dans une salle, pas dans un bâtiment de douze pièces.
     *
     * `SET NULL`, comme `tickets.site_id` que pose la migration 032 : un ticket
     * cite son lieu pour toujours, et perdre la pièce ne doit pas perdre la
     * demande.
     */
    await ajouterColonne(ctx, 'tickets', 'piece_id', 'INTEGER', {
      nom: 'fk_tickets_piece',
      table: 'site_pieces',
      surSuppression: 'SET NULL',
    });
    await ctx.creerIndex('idx_tickets_piece', 'tickets', 'piece_id');
  },
};

/** Ce qu'une colonne pointe, et ce qu'il advient d'elle quand la cible disparaît. */
interface CleEtrangere {
  nom: string;
  table: string;
  surSuppression: 'SET NULL' | 'CASCADE';
}

/**
 * Ajoute une colonne si elle manque, avec sa clé étrangère sur les deux moteurs.
 *
 * SQLite n'accepte une clé étrangère qu'**avec** la colonne, dans le même
 * `ADD COLUMN` ; MySQL parse cette forme et la jette, et ne veut la contrainte
 * qu'en `ADD CONSTRAINT` séparé. Il n'existe pas de phrase commune aux deux, et
 * c'est la raison d'être de cette fonction : le désaccord tient ici, une fois,
 * plutôt que dans chacun des quatre appels.
 *
 * La table absente est un cas normal — une base partiellement migrée, ou
 * `tickets` sur une installation qui n'a pas encore vu la migration 032 — et
 * n'est donc pas une erreur.
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
      fk && ctx.dialecte === 'sqlite'
        ? ` REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}`
        : '';
    await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}${reference}`);
  }

  if (!fk || ctx.dialecte === 'sqlite') return;

  /*
   * MySQL refuse une contrainte du même nom, et une migration doit pouvoir
   * repasser sans effet. On regarde donc avant, et on se protège quand même :
   * une base reprise d'ailleurs peut porter la contrainte sous un autre nom, et
   * un serveur qui ne démarre plus coûte plus cher qu'une clé étrangère
   * manquante — c'est l'arbitrage déjà rendu par la migration 036.
   */
  if (await contrainteExiste(ctx, table, fk.nom)) return;

  try {
    await ctx.executer(
      `ALTER TABLE ${table}
         ADD CONSTRAINT ${fk.nom} FOREIGN KEY (${colonne})
         REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}`
    );
  } catch (erreur: any) {
    console.warn(
      `Clé étrangère ${fk.nom} non posée sur ${table}.${colonne} : ${erreur?.message ?? erreur}`
    );
  }
}

/** Cette contrainte est-elle déjà posée ? Question vide de sens sur SQLite. */
async function contrainteExiste(
  ctx: ContexteMigration,
  table: string,
  nom: string
): Promise<boolean> {
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
 *
 * Recopié des migrations 029, 032 et 036 plutôt que partagé : une migration
 * décrit l'état du code au jour où elle a été écrite, et factoriser un helper
 * entre migrations ferait qu'une retouche d'aujourd'hui change ce qu'une
 * migration de l'an dernier applique.
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

export default lieuxPiecesEtPret;
