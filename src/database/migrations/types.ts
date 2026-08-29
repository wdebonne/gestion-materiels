export type Dialecte = 'sqlite' | 'mysql';

/**
 * Outils passés à une migration.
 *
 * Les fragments de type reprennent ceux de `createTables()` : une migration
 * écrite avec eux produit le même schéma sur SQLite et sur MySQL, qui sont les
 * deux moteurs supportés.
 */
export interface ContexteMigration {
  executer(sql: string, params?: any[]): Promise<{ lastInsertRowid: number; changes: number }>;
  interroger<T = any>(sql: string, params?: any[]): Promise<T[]>;
  dialecte: Dialecte;
  /** `AUTOINCREMENT` ou `AUTO_INCREMENT` selon le moteur. */
  autoIncrement: string;
  /** `TEXT` ou `LONGTEXT`, pour du JSON ou du texte long. */
  texteLong: string;
  /** `INTEGER` ou `TINYINT(1)`. */
  booleen: string;
  /** Valeur par défaut d'un horodatage de création. */
  horodatageParDefaut: string;
}

export interface Migration {
  /** Identifiant stable, préfixé par son numéro d'ordre : `002_referentiels`. */
  id: string;
  /** Ce que la migration change, en une ligne. */
  description: string;
  up(ctx: ContexteMigration): Promise<void>;
}
