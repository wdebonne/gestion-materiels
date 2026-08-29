import type { Migration } from './types';
import baseline from './001_baseline';
import politiqueConnexion from './002_politique_connexion';
import manifestationsReception from './003_manifestations_reception';

/**
 * Migrations connues, dans leur ordre d'application.
 *
 * La liste est explicite plutôt que balayée depuis le disque : en
 * développement les migrations sont des `.ts` lus par ts-node, en production des
 * `.js` dans `dist/`. Un balayage de dossier devrait connaître les deux, et
 * échouerait silencieusement — en n'appliquant rien — s'il se trompait. Une
 * migration s'ajoute donc ici, en même temps que son fichier.
 */
export const MIGRATIONS: readonly Migration[] = [
  baseline,
  politiqueConnexion,
  manifestationsReception,
];

export type { Migration, ContexteMigration, Dialecte } from './types';
