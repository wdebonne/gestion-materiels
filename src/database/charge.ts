import 'dotenv/config';
import path from 'path';
import { db } from './index';
import { seedDatabase } from './seed';
import { compter } from './charge/outils';
import { MOT_DE_PASSE_TEST, chargerDonneesTest, dejaCharge, purger } from './charge/index';

/**
 * Jeu de données de charge : remplit la base configurée avec un gros volume
 * de données cohérentes dans tous les modules, pour éprouver la stabilité et
 * les temps de réponse de l'application.
 *
 *   npm run db:charge -- [--echelle=1] [--graine=42] [--purger] [--forcer]
 *
 * Toutes les lignes créées sont marquées (voir `charge/outils.ts`) : relancer
 * le chargement remplace le précédent, et `--purger` le retire seul.
 */

const TABLES_SUIVIES = [
  'users', 'services', 'service_members', 'categories', 'subcategories', 'objects',
  'cle_sites', 'site_pieces', 'cle_ouvrants', 'cle_ouvre', 'cle_lots', 'trousseau_composants', 'cle_attributions',
  'fuel_entries', 'technical_controls', 'maintenances', 'reservations', 'calendar_events', 'alerts', 'alert_reads',
  'manifestations', 'manifestation_materials', 'manifestation_items', 'manifestation_history', 'manifestation_messages',
  'manifestation_approvals', 'lieu_occupations', 'tickets', 'ticket_messages', 'ticket_history', 'ticket_watchers',
  'planning_taches', 'planning_participants', 'green_spaces', 'green_space_elements', 'green_space_maintenances',
  'street_furniture', 'street_furniture_interventions', 'activity_logs',
];

interface Options {
  echelle: number;
  graine: number;
  purgerSeulement: boolean;
  forcer: boolean;
}

function lireOptions(argv: string[]): Options {
  const valeur = (nom: string) => argv.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1];
  const echelle = Number(valeur('echelle') ?? 1);
  const graine = Number(valeur('graine') ?? 42);
  if (!Number.isFinite(echelle) || echelle <= 0 || echelle > 50) {
    throw new Error('--echelle doit être un nombre entre 0 (exclu) et 50');
  }
  if (!Number.isInteger(graine)) throw new Error('--graine doit être un entier');
  return { echelle, graine, purgerSeulement: argv.includes('--purger'), forcer: argv.includes('--forcer') };
}

/**
 * Refuse de charger une base qui pourrait être réelle : le chargement active
 * tous les plugins, et même purgé il laisse sa trace dans les compteurs
 * d'auto-incrément.
 */
function verifierCible(options: Options): string {
  const type = db.getType();
  const nom =
    type === 'mysql'
      ? process.env.MYSQL_DATABASE || 'gestion_materiels'
      : path.resolve(db.getSQLitePath() ?? '');
  const hote = type === 'mysql' ? `${process.env.MYSQL_HOST || 'localhost'}:${process.env.MYSQL_PORT || '3306'}` : 'fichier local';

  console.log(`🎯 Base visée : ${type} — ${nom} (${hote})`);

  if (process.env.NODE_ENV === 'production') {
    throw new Error('NODE_ENV=production : chargement refusé, même avec --forcer.');
  }
  const reconnue = /test|charge/i.test(type === 'mysql' ? nom : path.basename(nom));
  if (!reconnue && !options.forcer) {
    throw new Error(
      `Le nom de la base ne contient ni « test » ni « charge » : elle pourrait être réelle.\n` +
        `   Utilisez par exemple MYSQL_DATABASE=gestion_materiels_charge (ou DB_PATH=./data/charge.sqlite),\n` +
        `   ou ajoutez --forcer si vous êtes certain de la cible.`
    );
  }
  return nom;
}

async function charger(options: Options): Promise<void> {
  console.log(`\n📦 Chargement (échelle ${options.echelle}, graine ${options.graine})`);
  const debut = Date.now();
  await chargerDonneesTest(options, (etape, _rang, duree) => {
    if (etape === null) return;
    if (duree === undefined) process.stdout.write(`   ⏳ ${etape}…`);
    else process.stdout.write(`\r   ✅ ${etape.padEnd(28)} ${(duree / 1000).toFixed(1).padStart(6)} s\n`);
  });
  console.log(`\n⏱️  Total : ${((Date.now() - debut) / 1000).toFixed(1)} s`);

  console.log('\n📊 Lignes par table (base entière) :');
  for (const table of TABLES_SUIVIES) {
    console.log(`   ${table.padEnd(32)} ${String(await compter(table)).padStart(8)}`);
  }
  console.log(`\n🔑 Comptes générés : <prenom>.<nom>.<n>@charge.test — mot de passe ${MOT_DE_PASSE_TEST}`);
  console.log('   Les plugins ont tous été activés sur cette base.');
}

async function principal(): Promise<void> {
  const options = lireOptions(process.argv.slice(2));
  verifierCible(options);

  await db.init();
  await seedDatabase();

  if (options.purgerSeulement) {
    if (!(await dejaCharge())) console.log('\nAucune donnée de test en base.');
    const bilan = await purger();
    for (const [table, n] of Object.entries(bilan)) console.log(`   🗑️  ${table.padEnd(24)} ${String(n).padStart(7)} ligne(s)`);
  } else {
    await charger(options);
  }

  await db.close();
}

if (require.main === module) {
  principal()
    .then(() => process.exit(0))
    .catch((erreur) => {
      console.error(`\n❌ ${erreur instanceof Error ? erreur.message : erreur}`);
      if (process.env.DEBUG) console.error(erreur);
      process.exit(1);
    });
}
