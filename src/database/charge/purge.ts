import { db } from '../index';
import { definirSuspension, etatSuspension } from '../../services/email.service';
import { supprimerFichierPrive } from '../../services/batiments.service';
import { ARTICLES_STOCK } from './manifestations';
import { DOMAINE_COURRIEL, PREFIXE, PREFIXE_SLUG, tableExiste } from './outils';
import { CENTRES, PRESTATAIRES, STATIONS } from './vehicules';

const UTILISATEURS_GENERES = `SELECT id FROM users WHERE email LIKE '%@${DOMAINE_COURRIEL}'`;

/**
 * Retire tout ce que le chargement a créé, et rien d'autre.
 *
 * L'ordre compte : les tables dont la clé étrangère n'a pas de `ON DELETE`
 * (le demandeur d'un ticket, l'agent d'une tâche de planning) doivent être
 * vidées avant les utilisateurs. Tout le reste part en cascade avec son
 * parent — matériel, site, catégorie, manifestation.
 */
export async function purger(): Promise<Record<string, number>> {
  const etapes: Array<[table: string, where: string, params?: unknown[]]> = [
    ['tickets', `reference_externe LIKE 'charge:%'`],
    ['planning_taches', `user_id IN (${UTILISATEURS_GENERES})`],
    ['manifestations', `contact_email LIKE '%@${DOMAINE_COURRIEL}'`],
    ['manifestation_stock', `name IN (${ARTICLES_STOCK.map(() => '?').join(', ')})`, ARTICLES_STOCK.map(([nom]) => nom)],
    ['lieu_occupations', `created_by IN (${UTILISATEURS_GENERES})`],
    ['calendar_events', `created_by IN (${UTILISATEURS_GENERES})`],
    ['green_spaces', `created_by IN (${UTILISATEURS_GENERES})`],
    ['activity_logs', `user_id IN (${UTILISATEURS_GENERES})`],
    ['ticket_categories', `parent_id IS NOT NULL AND created_by IN (${UTILISATEURS_GENERES})`],
    ['objects', `reference LIKE '${PREFIXE}%'`],
    // Avant les sites : un document tient son bâtiment (`RESTRICT`), et la
    // suppression des sites échouerait tant qu'il en reste.
    // Les factures et les interventions aussi (migration 044).
    ['batiment_factures', `site_id IN (SELECT id FROM cle_sites WHERE code LIKE '${PREFIXE}%')`],
    ['batiment_interventions', `site_id IN (SELECT id FROM cle_sites WHERE code LIKE '${PREFIXE}%')`],
    ['batiment_documents', `site_id IN (SELECT id FROM cle_sites WHERE code LIKE '${PREFIXE}%')`],
    ['cle_sites', `code LIKE '${PREFIXE}%'`],
    ['subcategories', `slug LIKE '${PREFIXE_SLUG}%'`],
    ['categories', `slug LIKE '${PREFIXE_SLUG}%'`],
    ['services', `slug LIKE '${PREFIXE_SLUG}%'`],
    ['users', `email LIKE '%@${DOMAINE_COURRIEL}'`],
    ['fuel_stations', `name IN (${STATIONS.map(() => '?').join(', ')})`, STATIONS],
    ['maintenance_providers', `name IN (${PRESTATAIRES.map(() => '?').join(', ')})`, PRESTATAIRES],
    ['control_centers', `name IN (${CENTRES.map(() => '?').join(', ')})`, CENTRES],
  ];

  // Les fichiers des documents de bâtiment purgés : relevés avant, effacés
  // après la transaction — un fichier effacé ne revient pas si elle échoue.
  const fichiers: string[] = (await tableExiste('batiment_documents'))
    ? (
        await db.query(
          `SELECT chemin FROM batiment_documents
            WHERE site_id IN (SELECT id FROM cle_sites WHERE code LIKE '${PREFIXE}%')`
        )
      ).map((l: any) => String(l.chemin))
    : [];

  const bilan: Record<string, number> = {};
  await db.transaction(async () => {
    for (const [table, where, params] of etapes) {
      if (!(await tableExiste(table))) continue;
      const { changes } = await db.execute(`DELETE FROM ${table} WHERE ${where}`, params ?? []);
      if (changes > 0) bilan[table] = changes;
    }
  });
  for (const chemin of fichiers) supprimerFichierPrive(chemin);

  // Les envois suspendus par le chargement reprennent avec le départ du jeu ;
  // une suspension décidée par un administrateur, elle, reste.
  if ((await etatSuspension()) === 'donnees_test') await definirSuspension(null);
  return bilan;
}

/** Vrai si un chargement précédent a laissé des données. */
export async function dejaCharge(): Promise<boolean> {
  const ligne = await db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@${DOMAINE_COURRIEL}'`);
  return Number(ligne?.n ?? 0) > 0;
}
