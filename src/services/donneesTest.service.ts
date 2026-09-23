import { db } from '../database';
import { purger } from '../database/charge/index';
import { DOMAINE_COURRIEL, PREFIXE } from '../database/charge/outils';
import { identifiant, tablesDeLaBase } from '../database/lots';

/**
 * Données de test depuis l'administration : état, verrou, réinitialisation.
 *
 * Deux gestes distincts, qu'il ne faut pas confondre :
 *
 * - **purger le jeu de test** retire ce que le générateur a créé, reconnaissable
 *   à ses marques (`@charge.test`, `CHG-`…), et rien d'autre ;
 * - **réinitialiser pour la production** efface toutes les données métier,
 *   saisies à la main comprises, et ne garde que la configuration.
 *
 * Après une réinitialisation, la base est déclarée « en production » : le
 * chargement et la réinitialisation sont alors refusés, pour qu'un clic égaré
 * six mois plus tard ne vide pas le parc d'une commune.
 */

const CLE_VERROU = 'base_en_production';

/**
 * Tables effacées par la réinitialisation : les données saisies au quotidien.
 *
 * La liste est écrite en entier plutôt que déduite (« tout sauf la
 * configuration ») : une table ajoutée demain par une migration ne doit pas être
 * vidée sans que quelqu'un l'ait décidé.
 *
 * Sont conservés : paramètres, SMTP, modèles d'e-mail, plugins et leurs
 * rattachements, catégories et champs personnalisés du parc, droits par rôle,
 * services, statuts et catégories de demande, catégories de planning, types et
 * référentiels (stations, garages, centres de contrôle, types d'espaces verts),
 * webhooks, agendas externes, sources de réception, sauvegardes.
 */
export const TABLES_REINITIALISEES = [
  // Parc et véhicules
  'objects', 'fuel_entries', 'technical_controls', 'maintenances', 'reservations',
  'calendar_events', 'calendar_exports', 'alerts', 'alert_reads',
  // Lieux et clés
  'cle_sites', 'site_pieces', 'cle_ouvrants', 'cle_ouvre', 'cle_lots', 'trousseau_composants',
  'cle_attributions', 'cle_jetons', 'cle_import_snipeit', 'lieu_occupations', 'lieu_jetons', 'user_sites',
  // Manifestations
  'manifestations', 'manifestation_stock', 'manifestation_stock_aliases', 'manifestation_stock_movements',
  'manifestation_materials', 'manifestation_items', 'manifestation_history', 'manifestation_messages',
  'manifestation_approvals', 'manifestation_watchers', 'manifestation_documents', 'manifestation_intake_requests',
  // Demandes
  'tickets', 'ticket_messages', 'ticket_history', 'ticket_documents', 'ticket_watchers',
  'ticket_import_correspondances', 'user_materiels',
  // Plannings
  'planning_taches', 'planning_participants',
  // Espaces verts et mobilier urbain
  'green_spaces', 'green_space_elements', 'green_space_groups', 'green_space_annotations', 'green_space_documents',
  'green_space_document_elements', 'green_space_maintenances', 'green_space_maintenance_elements',
  'green_space_maintenance_documents', 'green_space_seasons', 'green_space_snapshots',
  'green_space_element_replacements', 'street_furniture', 'street_furniture_interventions',
  // Journaux
  'activity_logs', 'logs', 'passkey_challenges',
];

export interface EtatDonneesTest {
  moteur: string;
  /** Date de mise en production, ou `null` si la base est encore ouverte aux essais. */
  enProductionDepuis: string | null;
  /** Le verrou est levé par la variable d'environnement `AUTORISER_DONNEES_TEST=true`. */
  verrouLeve: boolean;
  jeuDeTest: { utilisateurs: number; materiels: number; tickets: number; manifestations: number };
  totaux: { utilisateurs: number; materiels: number; tickets: number; manifestations: number };
}

async function compter(sql: string): Promise<number> {
  const ligne = await db.queryOne<{ n: number }>(sql);
  return Number(ligne?.n ?? 0);
}

export async function etatDonneesTest(): Promise<EtatDonneesTest> {
  const verrou = await db.queryOne<{ setting_value: string }>('SELECT setting_value FROM settings WHERE setting_key = ?', [CLE_VERROU]);
  return {
    moteur: db.getType(),
    enProductionDepuis: verrou?.setting_value || null,
    verrouLeve: process.env.AUTORISER_DONNEES_TEST === 'true',
    jeuDeTest: {
      utilisateurs: await compter(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@${DOMAINE_COURRIEL}'`),
      materiels: await compter(`SELECT COUNT(*) AS n FROM objects WHERE reference LIKE '${PREFIXE}%'`),
      tickets: await compter("SELECT COUNT(*) AS n FROM tickets WHERE reference_externe LIKE 'charge:%'"),
      manifestations: await compter(`SELECT COUNT(*) AS n FROM manifestations WHERE contact_email LIKE '%@${DOMAINE_COURRIEL}'`),
    },
    totaux: {
      utilisateurs: await compter('SELECT COUNT(*) AS n FROM users'),
      materiels: await compter('SELECT COUNT(*) AS n FROM objects'),
      tickets: await compter('SELECT COUNT(*) AS n FROM tickets'),
      manifestations: await compter('SELECT COUNT(*) AS n FROM manifestations'),
    },
  };
}

/** Refus explicite d'une opération que le verrou de production interdit. */
export class BaseEnProduction extends Error {}

export async function verifierHorsProduction(): Promise<void> {
  const etat = await etatDonneesTest();
  if (etat.enProductionDepuis && !etat.verrouLeve) {
    throw new BaseEnProduction(
      `La base est en production depuis le ${new Date(etat.enProductionDepuis).toLocaleDateString('fr-FR')} : ` +
        "chargement et réinitialisation sont désactivés. Pour les rouvrir, démarrez le serveur avec AUTORISER_DONNEES_TEST=true."
    );
  }
}

/**
 * Efface toutes les données métier et ne garde que les administrateurs.
 *
 * Le jeu de test est retiré d'abord, par sa propre purge : ses catégories, ses
 * services et ses stations sont de la configuration aux yeux de la liste
 * ci-dessus, et resteraient sinon en place.
 *
 * Les clés étrangères restent actives : on veut que la suppression des comptes
 * non administrateurs emporte en cascade leurs droits, leurs préférences et
 * leurs appartenances aux services. Les deux tables qui l'interdiraient (le
 * demandeur d'un ticket, l'agent d'une tâche) sont vidées avant.
 */
export async function reinitialiserPourProduction(): Promise<{ tables: Record<string, number>; utilisateurs: number }> {
  await purger();

  const existantes = new Set(await tablesDeLaBase());
  const tables: Record<string, number> = {};
  let utilisateurs = 0;

  await db.transaction(async () => {
    for (const table of TABLES_REINITIALISEES) {
      if (!existantes.has(table)) continue;
      const { changes } = await db.execute(`DELETE FROM ${identifiant(table)}`);
      if (changes > 0) tables[table] = changes;
    }
    utilisateurs = (await db.execute("DELETE FROM users WHERE role <> 'admin'")).changes;

    const maintenant = new Date().toISOString();
    const deja = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [CLE_VERROU]);
    if (deja) {
      await db.execute('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [maintenant, CLE_VERROU]);
    } else {
      await db.execute(
        'INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, ?, ?)',
        [CLE_VERROU, maintenant, 'string', 'Date de la réinitialisation pour la production ; verrouille les données de test.']
      );
    }
  });

  // SQLite garde la place des lignes effacées : sans compactage, une base
  // « vierge » pèserait encore les 90 Mo du jeu de test. Hors transaction. En
  // mode WAL, le compactage part d'abord dans le journal : le point de contrôle
  // le reporte sur le fichier et vide le journal.
  if (db.getType() === 'sqlite') {
    const base = db.getSQLiteDb();
    base.exec('VACUUM');
    base.pragma('wal_checkpoint(TRUNCATE)');
  }

  return { tables, utilisateurs };
}
