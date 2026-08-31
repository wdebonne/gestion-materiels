import type { Migration } from './types';
import baseline from './001_baseline';
import politiqueConnexion from './002_politique_connexion';
import manifestationsReception from './003_manifestations_reception';
import servicesApprobations from './004_services_approbations';
import exportManifestations from './005_export_manifestations';
import materielUniqueEtNotifications from './006_materiel_unique_et_notifications';
import responsablesDelegationsCoordination from './007_responsables_delegations_coordination';
import materielPretable from './008_materiel_pretable';
import prestationsEtDocuments from './009_prestations_et_documents';
import modelesDocumentsService from './010_modeles_documents_service';
import prestationsDuParc from './011_prestations_du_parc';
import materielEnLot from './012_materiel_en_lot';
import coutManifestation from './013_cout_manifestation';

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
  servicesApprobations,
  exportManifestations,
  materielUniqueEtNotifications,
  responsablesDelegationsCoordination,
  materielPretable,
  prestationsEtDocuments,
  modelesDocumentsService,
  prestationsDuParc,
  materielEnLot,
  coutManifestation,
];

export type { Migration, ContexteMigration, Dialecte } from './types';
