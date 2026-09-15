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
import compteursEtEnergie from './014_compteurs_et_energie';
import implantationDepuisLeParc from './015_implantation_depuis_le_parc';
import planAnnote from './016_plan_annote';
import cadrageDuPlan from './017_cadrage_du_plan';
import mobilierUrbain from './018_mobilier_urbain';
import jardinieresHorsParc from './019_jardinieres_hors_parc';
import agendasExternes from './020_agendas_externes';
import liensSauvegarde from './021_liens_sauvegarde';
import revocationSessions from './022_revocation_sessions';
import alertesEnDouble from './023_alertes_en_double';
import clesEtTrousseaux from './024_cles_et_trousseaux';
import importSnipeIt from './025_import_snipeit';
import entitesHtmlImportees from './026_entites_html_importees';
import passkeys from './027_passkeys';
import personnesSansCompte from './028_personnes_sans_compte';
import detailsDemandeManifestation from './029_details_demande_manifestation';
import formatSortieModele from './030_format_sortie_modele';

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
  compteursEtEnergie,
  implantationDepuisLeParc,
  planAnnote,
  cadrageDuPlan,
  mobilierUrbain,
  jardinieresHorsParc,
  agendasExternes,
  liensSauvegarde,
  revocationSessions,
  alertesEnDouble,
  clesEtTrousseaux,
  importSnipeIt,
  entitesHtmlImportees,
  passkeys,
  personnesSansCompte,
  detailsDemandeManifestation,
  formatSortieModele,
];

export type { Migration, ContexteMigration, Dialecte } from './types';
