/**
 * Applique les migrations en attente.
 *
 * `npm run db:migrate` pointait vers ce fichier, qui n'existait pas : la
 * commande échouait depuis toujours.
 *
 * Les migrations s'appliquent aussi au démarrage du serveur. Cette commande
 * sert à les jouer sans démarrer le serveur — avant une bascule, ou pour voir
 * ce qui reste à appliquer avec `--dry-run`.
 */
import dotenv from 'dotenv';
import { db } from './index';
import { appliquerMigrations, migrationsEnAttente } from './migrationRunner';

dotenv.config();

async function principal(): Promise<void> {
  const simulation = process.argv.includes('--dry-run');

  // Sans cette option, `init()` appliquerait les migrations avant même que
  // `--dry-run` ait pu dire ce qui restait à faire.
  await db.init({ migrationsAuto: false });
  console.log(`Base : ${db.getType()}${db.getSQLitePath() ? ` (${db.getSQLitePath()})` : ''}`);

  if (simulation) {
    const enAttente = await migrationsEnAttente(db);
    console.log(
      enAttente.length === 0
        ? 'Aucune migration en attente.'
        : `${enAttente.length} migration(s) en attente :\n  ${enAttente.join('\n  ')}`
    );
    return;
  }

  const resultat = await appliquerMigrations(db, {
    cheminSqlite: db.getSQLitePath() ?? undefined,
    journaliser: (message) => console.log(message),
  });

  console.log(
    resultat.appliquees.length === 0
      ? `Rien à faire — ${resultat.dejaAppliquees} migration(s) déjà appliquée(s).`
      : `${resultat.appliquees.length} migration(s) appliquée(s).`
  );
}

principal()
  .then(() => process.exit(0))
  .catch((erreur) => {
    console.error(erreur.message);
    process.exit(1);
  });
