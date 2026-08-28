import type { Migration } from './types';

/**
 * Point de départ.
 *
 * Le schéma existant est produit par `createTables()` et par la liste
 * « ajouter la colonne si elle manque » de `runMigrations()`, tenues à la main
 * et rejouées à chaque démarrage. Cette migration ne fait rien : elle marque cet
 * état comme le point zéro, pour que les bases déjà déployées et une base
 * neuve partent de la même ligne.
 *
 * Les évolutions suivantes s'écrivent ici, en `CREATE TABLE IF NOT EXISTS` ou
 * en ajout de colonne. Jamais de `DROP` ni de renommage : une migration
 * destructrice appliquée sur une base de production ne se rejoue pas à l'envers.
 */
const migration: Migration = {
  id: '001_baseline',
  description: 'Marque le schéma existant comme point de départ',
  async up() {
    // Volontairement vide.
  },
};

export default migration;
