import type { ContexteMigration, Migration } from './types';

/**
 * Les entreprises extérieures, et leur accès aux documents des bâtiments.
 *
 * L'électricien qui vérifie les écoles chaque année, la société qui entretient
 * l'ascenseur, le bureau de contrôle : ils produisent les rapports que le
 * module Bâtiments suit, et les envoyaient par courriel. Ils les déposent
 * désormais eux-mêmes, et consultent ceux qu'on leur ouvre — sans compte dans
 * l'application, par un lien et un code.
 *
 * ## Pourquoi pas un compte utilisateur
 *
 * La migration 028 pose la règle : étendre `users` plutôt que créer des silos.
 * Elle ne s'applique pas ici. Un compte porte un rôle, un mot de passe soumis à
 * la politique de l'établissement, une session JWT qui ouvre toute l'API — et
 * le cloisonnement devrait alors tout refuser, route par route, à une entreprise
 * qui n'a besoin que de trois. Une entreprise n'est pas une personne : elle a
 * un nom, des contacts qui changent, et un seul accès partagé. Son portail a
 * ses propres routes, sa propre session, et ne touche jamais l'API interne.
 *
 * ## Le lien et le code
 *
 * `lien_jeton` identifie l'entreprise dans l'adresse du portail ; il est tiré
 * au hasard (vingt-deux caractères) et stocké tel quel, comme `lieu_jetons`.
 * Le **code** est le secret : seul son empreinte bcrypt est gardée, si bien
 * qu'on ne peut que le régénérer, jamais le relire — un code régénéré rend
 * l'ancien caduc, et c'est voulu. Le code est permanent : l'entreprise qui
 * revient chaque année le garde, sauf date de fin (`acces_fin`, la fin du
 * marché) ou suspension.
 *
 * ## Les droits : des bâtiments, et des objets
 *
 * `entreprise_sites` dit quels bâtiments lui sont ouverts ; `entreprise_rubriques`
 * quels objets, chacun en lecture et/ou en dépôt. L'électricien lit et dépose
 * les « vérifications électriques » des écoles A et B. Pas de matrice bâtiment
 * × objet : le cas où elle servirait ne s'est pas présenté, et son écran de
 * réglage coûterait à chaque entreprise.
 *
 * ## Les sessions
 *
 * Une fois le code saisi, le portail reçoit un jeton opaque de session, dont on
 * garde l'empreinte SHA-256 — comme les jetons d'API. Huit heures, sur
 * l'appareil. Régénérer le code ou suspendre l'accès efface les sessions.
 */
const entreprisesPortail: Migration = {
  id: '042_entreprises_portail',
  description: 'Entreprises extérieures : contacts, droits sur les bâtiments et les objets, accès au portail',

  async up(ctx) {
    const { autoIncrement, booleen, texteLong, horodatageParDefaut } = ctx;

    // Le module Bâtiments vient de la migration 041 : sans lui, rien à ouvrir.
    if ((await colonnesDe(ctx, 'batiment_documents')).size === 0) return;

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS entreprises (
        id INTEGER PRIMARY KEY ${autoIncrement},
        nom VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        telephone VARCHAR(50),
        adresse VARCHAR(500),
        code_postal VARCHAR(10),
        ville VARCHAR(120),
        siret VARCHAR(20),
        notes ${texteLong},
        actif ${booleen} NOT NULL DEFAULT 1,
        lien_jeton VARCHAR(32) NOT NULL UNIQUE,
        code_hash VARCHAR(100),
        code_genere_le DATETIME,
        acces_fin VARCHAR(10),
        acces_suspendu ${booleen} NOT NULL DEFAULT 0,
        tentatives_echouees INTEGER NOT NULL DEFAULT 0,
        bloque_jusqu_a DATETIME,
        derniere_connexion DATETIME,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS entreprise_contacts (
        id INTEGER PRIMARY KEY ${autoIncrement},
        entreprise_id INTEGER NOT NULL,
        nom VARCHAR(255) NOT NULL,
        fonction VARCHAR(120),
        telephone VARCHAR(50),
        email VARCHAR(255),
        recoit_acces ${booleen} NOT NULL DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_entreprise_contacts_entreprise', 'entreprise_contacts', 'entreprise_id');

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS entreprise_sites (
        id INTEGER PRIMARY KEY ${autoIncrement},
        entreprise_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        UNIQUE (entreprise_id, site_id),
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS entreprise_rubriques (
        id INTEGER PRIMARY KEY ${autoIncrement},
        entreprise_id INTEGER NOT NULL,
        rubrique_id INTEGER NOT NULL,
        lecture ${booleen} NOT NULL DEFAULT 1,
        depot ${booleen} NOT NULL DEFAULT 0,
        UNIQUE (entreprise_id, rubrique_id),
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE CASCADE,
        FOREIGN KEY (rubrique_id) REFERENCES batiment_rubriques(id) ON DELETE CASCADE
      )`
    );

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS entreprise_sessions (
        id INTEGER PRIMARY KEY ${autoIncrement},
        entreprise_id INTEGER NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        derniere_activite DATETIME,
        ip VARCHAR(45),
        user_agent VARCHAR(255),
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE CASCADE
      )`
    );
    await ctx.creerIndex('idx_entreprise_sessions_entreprise', 'entreprise_sessions', 'entreprise_id');

    /*
     * Le document déposé par une entreprise se souvient d'elle. `SET NULL` : une
     * entreprise supprimée ne doit pas emporter les rapports qu'elle a remis —
     * le service refuse d'ailleurs cette suppression tant qu'il en reste, et
     * propose de la désactiver.
     */
    await ajouterColonne(ctx, 'batiment_documents', 'entreprise_id', 'INTEGER', {
      nom: 'fk_batiment_documents_entreprise',
      table: 'entreprises',
      surSuppression: 'SET NULL',
    });
    await ctx.creerIndex('idx_batiment_documents_entreprise', 'batiment_documents', 'entreprise_id');
  },
};

interface CleEtrangere {
  nom: string;
  table: string;
  surSuppression: 'SET NULL' | 'CASCADE';
}

/**
 * Ajoute une colonne si elle manque, avec sa clé étrangère sur les deux moteurs.
 *
 * Recopié de la migration 037, qui explique le désaccord : SQLite ne prend la
 * clé étrangère qu'avec la colonne, MySQL la jette silencieusement à cet endroit
 * et ne l'honore qu'en `ADD CONSTRAINT` séparé.
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
      fk && ctx.dialecte === 'sqlite' ? ` REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}` : '';
    await ctx.executer(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}${reference}`);
  }

  if (!fk || ctx.dialecte === 'sqlite') return;
  if (await contrainteExiste(ctx, table, fk.nom)) return;

  try {
    await ctx.executer(
      `ALTER TABLE ${table}
         ADD CONSTRAINT ${fk.nom} FOREIGN KEY (${colonne})
         REFERENCES ${fk.table}(id) ON DELETE ${fk.surSuppression}`
    );
  } catch (erreur: any) {
    console.warn(`Clé étrangère ${fk.nom} non posée sur ${table}.${colonne} : ${erreur?.message ?? erreur}`);
  }
}

async function contrainteExiste(ctx: ContexteMigration, table: string, nom: string): Promise<boolean> {
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
 * Recopié plutôt que partagé : une migration décrit l'état du code au jour où
 * elle a été écrite.
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

export default entreprisesPortail;
