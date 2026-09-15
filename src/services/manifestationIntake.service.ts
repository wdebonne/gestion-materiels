import crypto from 'crypto';
import { db } from '../database';
import { normaliserLibelle } from '../utils/normaliserLibelle';
import { expressionDisponibilite, jointuresDisponibilite } from './materielPretable.service';
import { expressionPrestation } from './prestationParc.service';

/**
 * Réception d'une demande de manifestation envoyée par une application tierce.
 *
 * Les demandes arrivaient par un formulaire externe et étaient ressaisies à la
 * main. Le contrat d'entrée n'est pas figé : chaque formulaire nomme ses champs
 * à sa façon, et il changera sans prévenir. La correspondance entre le JSON reçu
 * et les champs d'une manifestation est donc une **donnée**, configurable par un
 * administrateur, et non du code — exactement le choix déjà fait pour les
 * colonnes d'un tableur dans `importMapping.service.ts`, dont ce module reprend
 * la forme et la règle de normalisation.
 */

/**
 * Champs qu'une demande peut porter.
 *
 * Les quatorze premiers portent le nom de la **colonne** de `manifestations`
 * qui les reçoit. Les suivants n'ont pas de colonne : ils portent le nom sous
 * lequel un **modèle de document** les affiche, parce que c'est là qu'ils
 * servent. Les distinguer d'un coup d'œil évite d'aller chercher en base une
 * valeur qui n'y est pas, et inversement.
 */
export type ChampIntake =
  // Portés par une colonne de `manifestations`.
  | 'title'
  | 'date_start'
  | 'date_end'
  | 'start_time'
  | 'end_time'
  | 'delivery_date'
  | 'recovery_date'
  | 'delivery_address'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  | 'expected_people'
  | 'notes_interior'
  | 'notes_exterior'
  // Détails de la demande, conservés tels quels dans `intake_details`.
  | 'external_id'
  | 'plusieurs_jours'
  | 'horaires_definis'
  | 'lieu_manifestation'
  | 'type_demandeur'
  | 'pole'
  | 'service_demandeur'
  | 'ecole'
  | 'association'
  | 'president'
  | 'organisme'
  | 'lieux_interieurs'
  | 'lieux_exterieurs'
  | 'fermeture_circulation'
  | 'type_fermeture'
  | 'precisions_circulation'
  | 'materiel_technique'
  | 'materiel_informatique'
  | 'autre_besoin_informatique'
  | 'autre_demande_informatique'
  | 'contact_livraison_est_demandeur'
  | 'livraison_contact_nom'
  | 'livraison_contact_telephone'
  | 'besoins_reseaux'
  | 'personnel_technique'
  | 'personnel_technique_nombre'
  | 'personnel_technique_horaires'
  | 'besoin_restauration'
  | 'catering'
  | 'catering_detail'
  | 'vin_honneur'
  | 'formule_vin_honneur'
  | 'besoin_verres'
  | 'type_verres'
  | 'personnel_service'
  | 'personnel_service_horaires'
  | 'besoin_invitations'
  | 'besoin_affiches'
  | 'besoin_goodies'
  | 'autre_demande_communication'
  | 'debit_boissons';

/**
 * Nature de la valeur attendue.
 *
 * `composee` désigne une réponse en plusieurs morceaux — un répéteur (« un
 * bâtiment, puis un autre »), un groupe (« Nom » et « Prénom »), une plage
 * horaire (`{ start, end }`). Elle est ramenée à une ligne lisible : un modèle
 * de document imprime du texte, pas une structure.
 */
export type TypeChamp = 'texte' | 'date' | 'heure' | 'entier' | 'composee';

/**
 * Regroupement d'affichage, dans l'ordre où un formulaire pose ses questions.
 *
 * Une quarantaine de champs alignés sans séparation ne se règle pas : l'écran
 * de correspondance les présente par section, et le modèle de document les
 * propose dans le même ordre.
 */
export type SectionIntake =
  | 'Manifestation'
  | 'Demandeur'
  | 'Lieux'
  | 'Matériel'
  | 'Livraison'
  | 'Besoins techniques'
  | 'Restauration'
  | 'Communication'
  | 'Suivi';

export interface DefinitionChampIntake {
  champ: ChampIntake;
  libelle: string;
  section: SectionIntake;
  obligatoire: boolean;
  type: TypeChamp;
  /**
   * Colonne de `manifestations` qui reçoit la valeur. Absente : la valeur est
   * un détail de la demande, conservé dans `intake_details`.
   */
  colonne?: string;
  /** Nom sous lequel un modèle de document affiche la valeur. */
  cleModele: string;
  /** Valeur d'exemple, pour vérifier un modèle avant la première demande. */
  exemple: string;
  /** Noms de clés acceptés, déjà normalisés. */
  alias: string[];
}

/**
 * Champs qu'une demande peut renseigner.
 *
 * Seuls le titre et la date de début sont obligatoires : ce sont les deux que la
 * table `manifestations` exige. Tout le reste peut manquer et être complété à la
 * main — une demande incomplète vaut mieux qu'une demande perdue.
 *
 * Le catalogue couvre ce qu'un formulaire de demande pose réellement : qui
 * demande, au nom de quel pôle ou de quelle association, dans quels bâtiments
 * et sur quelles voies, avec quel matériel, combien d'agents, et ce que les
 * pôles Communication et Restauration ont à instruire. Ces réponses étaient
 * perdues à la réception : la manifestation créée n'en gardait rien, et le
 * service destinataire recevait un document muet sur la moitié de la demande.
 */
export const CHAMPS_INTAKE: DefinitionChampIntake[] = [
  // ==================== MANIFESTATION ====================
  {
    champ: 'title',
    libelle: 'Nom de la manifestation',
    section: 'Manifestation',
    obligatoire: true,
    type: 'texte',
    colonne: 'title',
    cleModele: 'manifestation',
    exemple: 'Fête de la musique',
    alias: [
      'titre', 'title', 'nom', 'name', 'nom de la manifestation', 'manifestation',
      'evenement', 'event', 'intitule', 'objet',
    ],
  },
  {
    champ: 'date_start',
    libelle: 'Date de la manifestation',
    section: 'Manifestation',
    obligatoire: true,
    type: 'date',
    colonne: 'date_start',
    cleModele: 'date_debut',
    exemple: '14/07/2026',
    alias: [
      'date de debut', 'date debut', 'date start', 'start date', 'date',
      'date de la manifestation', 'date manifestation', 'date de l evenement',
      'date debut manifestation',
    ],
  },
  {
    champ: 'plusieurs_jours',
    libelle: 'Manifestation sur plusieurs jours',
    section: 'Manifestation',
    obligatoire: false,
    type: 'texte',
    cleModele: 'plusieurs_jours',
    exemple: 'Oui',
    alias: [
      'la manifestation dure plus d une journee', 'plusieurs jours',
      'manifestation sur plusieurs jours',
    ],
  },
  {
    champ: 'date_end',
    libelle: 'Date de fin',
    section: 'Manifestation',
    obligatoire: false,
    type: 'date',
    colonne: 'date_end',
    cleModele: 'date_fin',
    exemple: '15/07/2026',
    alias: [
      'date de fin', 'date fin', 'end date', 'date end',
      'date de fin de la manifestation', 'date fin manifestation',
    ],
  },
  {
    champ: 'horaires_definis',
    libelle: 'Horaires définis',
    section: 'Manifestation',
    obligatoire: false,
    type: 'texte',
    cleModele: 'horaires_definis',
    exemple: 'Oui',
    alias: ['a t elle des horaires definis', 'horaires definis'],
  },
  {
    champ: 'start_time',
    libelle: 'Heure de début',
    section: 'Manifestation',
    obligatoire: false,
    type: 'heure',
    colonne: 'start_time',
    cleModele: 'heure_debut',
    exemple: '09:00',
    alias: ['heure de debut', 'heure debut', 'start time', 'debut'],
  },
  {
    champ: 'end_time',
    libelle: 'Heure de fin',
    section: 'Manifestation',
    obligatoire: false,
    type: 'heure',
    colonne: 'end_time',
    cleModele: 'heure_fin',
    exemple: '23:00',
    alias: ['heure de fin', 'heure fin', 'end time', 'fin'],
  },
  {
    champ: 'expected_people',
    libelle: 'Personnes attendues',
    section: 'Manifestation',
    obligatoire: false,
    type: 'entier',
    colonne: 'expected_people',
    cleModele: 'personnes_attendues',
    exemple: '250',
    alias: [
      'personnes attendues', 'nombre de personnes', 'nombre de personnes attendues',
      'nb personnes', 'effectif', 'participants', 'expected people', 'public attendu',
    ],
  },
  {
    champ: 'lieu_manifestation',
    libelle: 'Lieu de la manifestation',
    section: 'Manifestation',
    obligatoire: false,
    type: 'texte',
    cleModele: 'lieu_manifestation',
    exemple: 'Place du marché',
    alias: ['indiquer le lieu', 'lieu de la manifestation', 'lieu de l evenement'],
  },

  // ==================== DEMANDEUR ====================
  {
    champ: 'type_demandeur',
    libelle: 'Qualité du demandeur',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'type_demandeur',
    exemple: 'Association',
    alias: ['vous etes', 'type de demandeur', 'qualite du demandeur'],
  },
  {
    champ: 'pole',
    libelle: 'Pôle',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'pole',
    exemple: 'Culture - Communication',
    alias: ['quel pole', 'pole', 'pole demandeur'],
  },
  {
    champ: 'service_demandeur',
    libelle: 'Service demandeur',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'service_demandeur',
    exemple: 'Animation',
    alias: [
      'quel service', 'service demandeur', 'service du pole',
      'quel service du pole temps de l enfant et de la famille',
      'quel service du pole administration generale',
      'quel service du pole service a la population',
    ],
  },
  {
    champ: 'ecole',
    libelle: 'École concernée',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'ecole',
    exemple: 'André Marie',
    alias: ['quelle ecole', 'ecole', 'ecole concernee'],
  },
  {
    champ: 'association',
    libelle: 'Association',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'association',
    exemple: 'Comité des fêtes',
    alias: ['nom de l association', 'association'],
  },
  {
    champ: 'president',
    libelle: 'Président de l’association',
    section: 'Demandeur',
    obligatoire: false,
    type: 'composee',
    cleModele: 'president',
    exemple: 'Dubois Martin',
    alias: ['nom et prenom du president', 'president', 'nom du president'],
  },
  {
    champ: 'organisme',
    libelle: 'Organisme',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    cleModele: 'organisme',
    exemple: 'Centre de loisirs',
    alias: ['nom de l organisme', 'organisme', 'raison sociale'],
  },
  {
    champ: 'contact_name',
    libelle: 'Nom du demandeur',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    colonne: 'contact_name',
    cleModele: 'contact_nom',
    exemple: 'Martin Dubois',
    alias: [
      'contact', 'nom du contact', 'contact name', 'demandeur', 'nom du demandeur',
      'nom du demandeur organisateur de la manifestation',
      'responsable', 'organisateur', 'contact de livraison',
    ],
  },
  {
    champ: 'contact_phone',
    libelle: 'Téléphone du demandeur',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    colonne: 'contact_phone',
    cleModele: 'contact_telephone',
    exemple: '01 02 03 04 05',
    alias: [
      'telephone', 'tel', 'phone', 'contact phone', 'telephone du contact',
      'portable', 'mobile', 'numero de telephone',
    ],
  },
  {
    champ: 'contact_email',
    libelle: 'Courriel du demandeur',
    section: 'Demandeur',
    obligatoire: false,
    type: 'texte',
    colonne: 'contact_email',
    cleModele: 'contact_email',
    exemple: 'martin@ville.fr',
    alias: ['email', 'e mail', 'mail', 'courriel', 'contact email', 'adresse email'],
  },

  // ==================== LIEUX ====================
  {
    champ: 'lieux_interieurs',
    libelle: 'Bâtiments et salles demandés',
    section: 'Lieux',
    obligatoire: false,
    type: 'composee',
    cleModele: 'lieux_interieurs',
    exemple: 'Mairie : Salle des mariages ; Maison Pour Tous : Le hall',
    alias: [
      'la manifestation se deroule t elle en interieur', 'quel batiment', 'batiment',
      'batiments', 'interieur', 'lieux interieurs', 'salles',
    ],
  },
  {
    champ: 'lieux_exterieurs',
    libelle: 'Voies et espaces publics demandés',
    section: 'Lieux',
    obligatoire: false,
    type: 'composee',
    cleModele: 'lieux_exterieurs',
    exemple: 'Rue Adolphe Lasne ; Place du marché',
    alias: [
      'la manifestation se deroule t elle en exterieur', 'quelle avenue rue place',
      'exterieur', 'lieux exterieurs', 'voie publique', 'voies publiques', 'rues',
    ],
  },
  {
    champ: 'fermeture_circulation',
    libelle: 'Fermeture de la circulation',
    section: 'Lieux',
    obligatoire: false,
    type: 'texte',
    cleModele: 'fermeture_circulation',
    exemple: 'Oui',
    alias: ['fermeture de la circulation', 'fermeture circulation', 'circulation'],
  },
  {
    champ: 'type_fermeture',
    libelle: 'Nature de la fermeture',
    section: 'Lieux',
    obligatoire: false,
    type: 'texte',
    cleModele: 'type_fermeture',
    exemple: 'Partielle',
    alias: ['fermeture', 'type de fermeture', 'nature de la fermeture'],
  },
  {
    champ: 'precisions_circulation',
    libelle: 'Précisions sur la fermeture',
    section: 'Lieux',
    obligatoire: false,
    type: 'texte',
    cleModele: 'precisions_circulation',
    exemple: 'De la place du marché au parvis de la mairie',
    alias: ['precisez', 'precisions', 'precisions sur la fermeture'],
  },

  // ==================== MATÉRIEL ====================
  {
    champ: 'materiel_technique',
    libelle: 'Matériel technique demandé, tel que reçu',
    section: 'Matériel',
    obligatoire: false,
    type: 'composee',
    cleModele: 'materiel_technique',
    exemple: 'Tables Kermesse : 10 ; Chaises Coques : 50',
    alias: [
      'besoin de materiel technique', 'quel materiel technique', 'materiel technique',
      'combien avez vous besoin de materiel technique',
    ],
  },
  {
    champ: 'materiel_informatique',
    libelle: 'Matériel informatique demandé',
    section: 'Matériel',
    obligatoire: false,
    type: 'composee',
    cleModele: 'materiel_informatique',
    exemple: 'Vidéo projecteur : 1 ; Ecran : 1',
    alias: [
      'materiel informatique', 'de quoi avez vous besoin comme materiel informatique',
      'indiquez les quantites souhaitees pour le materiel informatique',
    ],
  },
  {
    champ: 'autre_besoin_informatique',
    libelle: 'Autre besoin informatique',
    section: 'Matériel',
    obligatoire: false,
    type: 'texte',
    cleModele: 'autre_besoin_informatique',
    exemple: 'Oui',
    alias: ['autre besoin en informatique', 'autre besoin informatique'],
  },
  {
    champ: 'autre_demande_informatique',
    libelle: 'Détail de la demande informatique',
    section: 'Matériel',
    obligatoire: false,
    type: 'texte',
    cleModele: 'autre_demande_informatique',
    exemple: 'Un câble RJ45 de 20 m',
    alias: [
      'quelle est votre autre demande pour le materielle informatique',
      'autre demande informatique', 'detail de la demande informatique',
    ],
  },

  // ==================== LIVRAISON ====================
  {
    champ: 'contact_livraison_est_demandeur',
    libelle: 'Contact de livraison identique au demandeur',
    section: 'Livraison',
    obligatoire: false,
    type: 'texte',
    cleModele: 'contact_livraison_est_demandeur',
    exemple: 'Non',
    alias: [
      'le contact pour la livraison est t il le demandeur',
      'contact de livraison identique au demandeur',
    ],
  },
  {
    champ: 'livraison_contact_nom',
    libelle: 'Nom du contact de livraison',
    section: 'Livraison',
    obligatoire: false,
    type: 'texte',
    cleModele: 'livraison_contact_nom',
    exemple: 'Claire Petit',
    alias: ['nom du contact', 'contact de livraison', 'nom du contact de livraison'],
  },
  {
    champ: 'livraison_contact_telephone',
    libelle: 'Téléphone du contact de livraison',
    section: 'Livraison',
    obligatoire: false,
    type: 'texte',
    cleModele: 'livraison_contact_telephone',
    exemple: '06 12 34 56 78',
    alias: [
      'numero de telephone du contact', 'telephone du contact de livraison',
      'telephone du contact',
    ],
  },
  {
    champ: 'delivery_address',
    libelle: 'Lieu de livraison',
    section: 'Livraison',
    obligatoire: false,
    type: 'texte',
    colonne: 'delivery_address',
    cleModele: 'lieu',
    exemple: 'Place du marché',
    alias: [
      'lieu de livraison', 'adresse de livraison', 'adresse livraison', 'lieu',
      'veuillez indiquez le lieu de livraison', 'adresse', 'delivery address',
      'location', 'emplacement', 'site',
    ],
  },
  {
    champ: 'delivery_date',
    libelle: 'Date de livraison',
    section: 'Livraison',
    obligatoire: false,
    type: 'date',
    colonne: 'delivery_date',
    cleModele: 'date_livraison',
    exemple: '13/07/2026',
    alias: [
      'date de livraison', 'date livraison', 'delivery date', 'livraison',
      'veuillez indiquez la date de livraison',
    ],
  },
  {
    champ: 'recovery_date',
    libelle: 'Date de récupération',
    section: 'Livraison',
    obligatoire: false,
    type: 'date',
    colonne: 'recovery_date',
    cleModele: 'date_recuperation',
    exemple: '15/07/2026',
    alias: [
      'date de recuperation', 'date recuperation', 'recovery date', 'recuperation',
      'date de reprise', 'date reprise', 'date de retour', 'retour',
    ],
  },

  // ==================== BESOINS TECHNIQUES ====================
  {
    champ: 'besoins_reseaux',
    libelle: 'Eau, électricité',
    section: 'Besoins techniques',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoins_reseaux',
    exemple: 'Eau, Electricité',
    alias: ['besoin', 'besoin d eau ou electricite', 'eau ou electricite', 'eau electricite'],
  },
  {
    champ: 'personnel_technique',
    libelle: 'Besoin de personnel technique',
    section: 'Besoins techniques',
    obligatoire: false,
    type: 'texte',
    cleModele: 'personnel_technique',
    exemple: 'Oui',
    alias: ['besoin de personnel technique', 'personnel technique'],
  },
  {
    champ: 'personnel_technique_nombre',
    libelle: 'Nombre d’agents techniques',
    section: 'Besoins techniques',
    obligatoire: false,
    type: 'entier',
    cleModele: 'personnel_technique_nombre',
    exemple: '3',
    alias: ['nombre d agents souhaite', 'nombre d agents', 'nombre d agents techniques'],
  },
  {
    champ: 'personnel_technique_horaires',
    libelle: 'Horaires du personnel technique',
    section: 'Besoins techniques',
    obligatoire: false,
    type: 'composee',
    cleModele: 'personnel_technique_horaires',
    exemple: '08:00 12:00',
    alias: [
      'selectionnez la plage horaire', 'plage horaire',
      'horaires du personnel technique',
    ],
  },

  // ==================== RESTAURATION ====================
  {
    champ: 'besoin_restauration',
    libelle: 'Besoin de restauration',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoin_restauration',
    exemple: 'Oui',
    alias: ['besoin de restauration', 'restauration'],
  },
  {
    champ: 'catering',
    libelle: 'Catering',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'catering',
    exemple: 'Oui',
    alias: ['catering'],
  },
  {
    champ: 'catering_detail',
    libelle: 'Détail du catering',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'catering_detail',
    exemple: 'Café, jus de fruits et viennoiseries pour 30 personnes',
    alias: ['que voulez vous', 'detail du catering'],
  },
  {
    champ: 'vin_honneur',
    libelle: 'Vin d’honneur',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'vin_honneur',
    exemple: 'Oui',
    alias: ['vin d honneur'],
  },
  {
    champ: 'formule_vin_honneur',
    libelle: 'Formule du vin d’honneur',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'formule_vin_honneur',
    exemple: '2',
    alias: ['quelle formule', 'formule', 'formule du vin d honneur'],
  },
  {
    champ: 'besoin_verres',
    libelle: 'Besoin de verres',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoin_verres',
    exemple: 'Oui',
    alias: ['besoin de verre', 'besoin de verres'],
  },
  {
    champ: 'type_verres',
    libelle: 'Type de verres',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'type_verres',
    exemple: 'Ecocup',
    alias: ['quelle type de verre', 'type de verre', 'type de verres'],
  },
  {
    champ: 'personnel_service',
    libelle: 'Besoin de personnel de service',
    section: 'Restauration',
    obligatoire: false,
    type: 'texte',
    cleModele: 'personnel_service',
    exemple: 'Oui',
    alias: ['besoin de personnel de service', 'personnel de service'],
  },
  {
    champ: 'personnel_service_horaires',
    libelle: 'Horaires du personnel de service',
    section: 'Restauration',
    obligatoire: false,
    type: 'composee',
    cleModele: 'personnel_service_horaires',
    exemple: '18:00 22:00',
    alias: ['horaire du personnel de service', 'horaires du personnel de service'],
  },

  // ==================== COMMUNICATION ====================
  {
    champ: 'besoin_invitations',
    libelle: 'Besoin d’invitations',
    section: 'Communication',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoin_invitations',
    exemple: 'Oui',
    alias: ['besoin d invitation', 'besoin d invitations', 'invitations'],
  },
  {
    champ: 'besoin_affiches',
    libelle: 'Besoin d’affiches',
    section: 'Communication',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoin_affiches',
    exemple: 'Oui',
    alias: ['besoin d affiches', 'affiches'],
  },
  {
    champ: 'besoin_goodies',
    libelle: 'Besoin de goodies',
    section: 'Communication',
    obligatoire: false,
    type: 'texte',
    cleModele: 'besoin_goodies',
    exemple: 'Non',
    alias: ['besoin de goodies', 'goodies'],
  },
  {
    champ: 'autre_demande_communication',
    libelle: 'Autre demande au pôle Communication',
    section: 'Communication',
    obligatoire: false,
    type: 'texte',
    cleModele: 'autre_demande_communication',
    exemple: 'Une publication sur la page Facebook de la ville',
    alias: [
      'autre demande au pole communication',
      'veuillez indiquer votre autre demande au pole communication',
    ],
  },
  {
    champ: 'debit_boissons',
    libelle: 'Demande de débit de boissons',
    section: 'Communication',
    obligatoire: false,
    type: 'texte',
    cleModele: 'debit_boissons',
    exemple: 'Oui',
    alias: [
      'souhaitez vous formuler une demande de debit de boisson',
      'debit de boisson', 'debit de boissons',
    ],
  },

  // ==================== SUIVI ====================
  {
    champ: 'notes_interior',
    libelle: 'Commentaire de la demande',
    section: 'Suivi',
    obligatoire: false,
    type: 'texte',
    colonne: 'notes_interior',
    cleModele: 'notes_interieur',
    exemple: 'Prévoir une rallonge',
    alias: ['notes', 'note', 'commentaire', 'commentaires', 'remarques', 'message'],
  },
  {
    champ: 'notes_exterior',
    libelle: 'Notes extérieures',
    section: 'Suivi',
    obligatoire: false,
    type: 'texte',
    colonne: 'notes_exterior',
    cleModele: 'notes_exterieur',
    exemple: 'Accès livraison par la rue de derrière',
    alias: ['notes exterieures', 'note exterieure', 'observations'],
  },
  {
    champ: 'external_id',
    libelle: 'Identifiant d’origine',
    section: 'Suivi',
    obligatoire: false,
    type: 'texte',
    cleModele: 'reference',
    exemple: 'DEM-2026-014',
    alias: [
      'id', 'identifiant', 'reference', 'ref', 'external id', 'form id',
      'submission id', 'numero de demande', 'numero',
      // Nom que porte l'identifiant de réponse quand le formulaire envoie tout
      // ce qu'il a, sans correspondance réglée de son côté.
      'responseid', 'response id',
    ],
  },
];

/** Champs conservés en détail, dans l'ordre où le formulaire les pose. */
export const CHAMPS_DETAILS = CHAMPS_INTAKE.filter((d) => !d.colonne);

/**
 * Correspondance champ → chemin pointé dans la charge utile reçue.
 *
 * Plusieurs chemins sont acceptés pour un même champ, et le premier qui porte
 * une valeur l'emporte. Un formulaire pose ses questions par branches : « quel
 * service du pôle Temps de l'Enfant », « quel service du pôle Administration
 * Générale »… Une seule est remplie, les autres arrivent vides. N'en retenir
 * qu'une revenait à ne lire la réponse que d'un demandeur sur trois.
 */
export type CorrespondanceIntake = Partial<Record<ChampIntake, string | string[]>>;

/** Les chemins d'un champ, qu'il en porte un ou plusieurs. */
export function cheminsDuChamp(valeur: string | string[] | undefined): string[] {
  if (!valeur) return [];
  return (Array.isArray(valeur) ? valeur : [valeur]).filter(Boolean);
}

/**
 * Comment lire les lignes de matériel dans la charge utile.
 *
 * `liste` : `chemin` désigne un tableau, chaque entrée portant un libellé et une
 * quantité. `objet` : `chemin` désigne un objet dont les clés sont les libellés
 * et les valeurs les quantités. Les deux formes se rencontrent selon que le
 * formulaire pose une question répétable ou une case par article.
 */
export interface CorrespondanceMateriel {
  mode?: 'liste' | 'objet';
  chemin?: string;
  champ_libelle?: string;
  champ_quantite?: string;
}

// ======================== LECTURE DE LA CHARGE UTILE ========================

/**
 * Valeur à un chemin pointé, `undefined` si le chemin ne mène nulle part.
 *
 * Les index de tableau s'écrivent comme des segments : `reponses.0.valeur`.
 */
export function valeurAuChemin(source: unknown, chemin: string): unknown {
  if (!chemin || source === null || source === undefined || typeof source !== 'object') {
    return undefined;
  }

  // Un intitulé de question contient parfois un point — « Nom de la
  // manifestation. », « Veuillez indiquez la date de livraison. ». La clé
  // entière est donc essayée avant de redécouper : sans cela, ces champs-là,
  // dont le titre obligatoire, restaient désespérément vides.
  const direct = (source as Record<string, unknown>)[chemin];
  if (direct !== undefined) return direct;

  const separateur = chemin.indexOf('.');
  if (separateur === -1) return undefined;

  return valeurAuChemin(
    (source as Record<string, unknown>)[chemin.slice(0, separateur)],
    chemin.slice(separateur + 1)
  );
}

const PROFONDEUR_MAX = 6;

/** Un chemin proposable, et s'il désigne une réponse composée. */
interface CheminTrouve {
  chemin: string;
  /**
   * Clé sous laquelle la valeur se trouve, telle quelle.
   *
   * Elle est portée plutôt que redécoupée du chemin : un intitulé de question
   * contient parfois un point — « Nom de la manifestation. » — et le dernier
   * segment d'un tel chemin est vide. Le champ obligatoire du formulaire n'était
   * alors reconnu par aucun alias.
   */
  cle: string;
  /** Vrai pour un groupe ou un répéteur : plusieurs valeurs sous une question. */
  conteneur: boolean;
}

/** Un segment de tableau : `reponses.0.valeur` a le sien en deuxième position. */
const estIndice = (segment: string): boolean => /^\d+$/.test(segment);

/**
 * Chemin ramené au conteneur qui le porte : `interieur.0.Quel bâtiment` devient
 * `interieur`.
 *
 * Une question répétable ne se lit pas répétition par répétition — un document
 * qui n'annoncerait que le premier bâtiment réservé serait pire qu'un document
 * muet. On vise donc le tableau entier, et la mise à plat rend les autres.
 */
function jusquAuConteneur(chemin: string): string {
  const segments = chemin.split('.');
  const premierIndice = segments.findIndex(estIndice);
  return premierIndice <= 0 ? chemin : segments.slice(0, premierIndice).join('.');
}

/**
 * Tous les chemins qu'une charge utile propose.
 *
 * Deux sortes : les **valeurs simples**, et les **conteneurs** — un groupe
 * (« Nom », « Prénom » sous « Nom et Prénom du Président ») ou un répéteur
 * (« un bâtiment, puis un autre »). Les conteneurs sont proposés parce qu'ils
 * sont une réponse à part entière : ne proposer que leurs feuilles obligerait
 * à régler un champ par morceau, et à en oublier au premier formulaire modifié.
 *
 * Les entrées d'un tableau n'en sont pas : viser `interieur.0` plutôt que
 * `interieur` ne retiendrait que la première répétition.
 *
 * La profondeur est bornée : une charge utile cyclique ou absurdement imbriquée
 * ne doit pas faire tourner le serveur en rond.
 */
function parcourir(source: unknown, prefixe = '', profondeur = 0, cle = ''): CheminTrouve[] {
  if (profondeur >= PROFONDEUR_MAX || source === null || source === undefined) return [];

  if (Array.isArray(source)) {
    const entrees = source.flatMap((valeur, i) =>
      parcourir(valeur, prefixe ? `${prefixe}.${i}` : String(i), profondeur + 1, String(i))
    );
    return prefixe && entrees.length > 0
      ? [{ chemin: prefixe, cle, conteneur: true }, ...entrees]
      : entrees;
  }

  if (typeof source === 'object') {
    const entrees = Object.entries(source as Record<string, unknown>).flatMap(
      ([cleInterne, valeur]) =>
        parcourir(
          valeur,
          prefixe ? `${prefixe}.${cleInterne}` : cleInterne,
          profondeur + 1,
          cleInterne
        )
    );

    // Un objet ne se propose que s'il porte lui-même des valeurs, et qu'il n'est
    // pas l'entrée d'un tableau.
    const porteDesValeurs = Object.values(source as Record<string, unknown>).some(
      (valeur) => valeur !== null && valeur !== undefined && typeof valeur !== 'object'
    );
    return prefixe && porteDesValeurs && !estIndice(cle)
      ? [{ chemin: prefixe, cle, conteneur: true }, ...entrees]
      : entrees;
  }

  return prefixe ? [{ chemin: prefixe, cle, conteneur: false }] : [];
}

/** Chemins proposables à l'écran de correspondance, conteneurs compris. */
export function cheminsDe(source: unknown, prefixe = '', profondeur = 0): string[] {
  const vus = new Set<string>();
  return parcourir(source, prefixe, profondeur)
    .map((trouve) => trouve.chemin)
    .filter((chemin) => !vus.has(chemin) && vus.add(chemin));
}

/**
 * Reconnaît les champs d'après le nom de la dernière clé du chemin.
 *
 * Le chemin complet importe peu : `data.reponses.contact_email` et
 * `contact_email` désignent la même chose.
 *
 * Tous les chemins qui conviennent sont retenus, dans l'ordre reçu, et non le
 * premier seulement : un formulaire à branches pose la même question sous trois
 * intitulés — un par pôle, un par qualité de demandeur — et n'en remplit qu'une.
 * À la lecture, le premier chemin qui porte une valeur l'emporte.
 *
 * Un conteneur n'est retenu que pour un champ **composé**. Sans cette garde, le
 * groupe « Demandeur » répondrait à lui seul au nom du demandeur, et le document
 * afficherait son nom, son téléphone et son courriel collés sur une ligne.
 */
export function detecterChamps(payload: unknown): CorrespondanceIntake {
  const trouves = new Map<ChampIntake, string[]>();

  for (const { chemin, cle, conteneur } of parcourir(payload)) {
    const normalise = normaliserLibelle(cle);
    if (!normalise) continue;

    for (const definition of CHAMPS_INTAKE) {
      if (!definition.alias.includes(normalise)) continue;
      if (conteneur && definition.type !== 'composee') continue;

      const cible = definition.type === 'composee' ? jusquAuConteneur(chemin) : chemin;
      const deja = trouves.get(definition.champ) ?? [];
      if (!deja.includes(cible)) trouves.set(definition.champ, [...deja, cible]);
    }
  }

  // Un seul chemin reste une chaîne : c'est la forme que l'écran de
  // correspondance enregistre, et celle que les réglages déjà en base portent.
  const correspondance: CorrespondanceIntake = {};
  for (const [champ, chemins] of trouves) {
    correspondance[champ] = chemins.length === 1 ? chemins[0] : chemins;
  }
  return correspondance;
}

/**
 * Correspondance à appliquer : celle configurée sur la source, sinon celle
 * déduite des noms de clés.
 */
export function resoudreCorrespondance(
  payload: unknown,
  imposee?: CorrespondanceIntake | null
): { correspondance: CorrespondanceIntake; origine: 'imposee' | 'detectee' } {
  if (imposee && Object.keys(imposee).length > 0) {
    return { correspondance: imposee, origine: 'imposee' };
  }
  return { correspondance: detecterChamps(payload), origine: 'detectee' };
}

// ======================== CONVERSION DES VALEURS ========================

/**
 * Date ramenée au format `AAAA-MM-JJ`.
 *
 * Les formulaires rendent aussi bien `14/07/2026` que `2026-07-14T09:00:00Z`.
 * Une date non reconnue est rendue `null` plutôt que devinée : une manifestation
 * placée au mauvais jour bloquerait le mauvais matériel.
 */
export function normaliserDate(brut: unknown): string | null {
  if (brut === null || brut === undefined) return null;

  const texte = String(brut).trim();
  if (!texte) return null;

  const iso = texte.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const francais = texte.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (francais) {
    const jour = francais[1].padStart(2, '0');
    const mois = francais[2].padStart(2, '0');
    return `${francais[3]}-${mois}-${jour}`;
  }

  return null;
}

/** Heure ramenée à `HH:MM`, `null` si elle n'est pas reconnue. */
export function normaliserHeure(brut: unknown): string | null {
  if (brut === null || brut === undefined) return null;

  const trouve = String(brut).trim().match(/(\d{1,2})[h:](\d{2})?/i);
  if (!trouve) return null;

  const heures = trouve[1].padStart(2, '0');
  return `${heures}:${trouve[2] ?? '00'}`;
}

/** Entier, `null` si la valeur n'en contient pas. */
export function normaliserEntier(brut: unknown): number | null {
  if (brut === null || brut === undefined) return null;

  const trouve = String(brut).replace(/\s/g, '').match(/-?\d+/);
  if (!trouve) return null;

  const valeur = Number.parseInt(trouve[0], 10);
  return Number.isNaN(valeur) ? null : valeur;
}

/**
 * Réponse composée ramenée à une ligne lisible.
 *
 * Un répéteur arrive en tableau d'objets, un groupe en objet, une plage horaire
 * en `{ start, end }`, une question à quantités en `{ « Tables » : 10 }`. Un
 * modèle de document imprime du texte : rendu tel quel, un `JSON.stringify`
 * mettrait des accolades dans un arrêté municipal.
 *
 * Les répétitions se séparent au point-virgule, et ce qui va ensemble à
 * l'intérieur d'une répétition au deux-points — « Mairie : Salle des mariages ;
 * Complexe Sportif : Club House » se lit, là où une énumération à plat ne dirait
 * plus quelle salle appartient à quel bâtiment.
 */
export function texteLisible(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';

  if (Array.isArray(valeur)) {
    const rendus = valeur
      .map((entree) =>
        entree !== null && typeof entree === 'object' && !Array.isArray(entree)
          ? // Dans une répétition, la première réponse nomme les suivantes :
            // « Mairie : Salle des mariages » dit quelle salle de quel bâtiment.
            objetLisible(entree as Record<string, unknown>, ' : ')
          : texteLisible(entree)
      )
      .filter(Boolean);

    // Des cases cochées s'énumèrent ; des répétitions se séparent plus nettement.
    const repetitions = valeur.some((entree) => entree !== null && typeof entree === 'object');
    return rendus.join(repetitions ? ' ; ' : ', ');
  }

  // Un groupe ou une plage se lit d'un trait : « Dubois Martin », « 18:00 23:30 ».
  if (typeof valeur === 'object') return objetLisible(valeur as Record<string, unknown>, ' ');

  return String(valeur).trim();
}

/**
 * Objet rendu lisible, selon ce qu'il est.
 *
 * Une **question à quantités** — `{ « Tables » : 10 }` — garde ses libellés,
 * seuls ils disent ce qui est compté. Un **groupe** ou une **répétition** n'a
 * que ses valeurs à donner : ses clés sont les intitulés des questions, déjà
 * connus de qui lit le document.
 */
function objetLisible(objet: Record<string, unknown>, separateur: string): string {
  const entrees = Object.entries(objet);
  if (entrees.length === 0) return '';

  if (entrees.every(([, valeur]) => estQuantite(valeur))) {
    return entrees.map(([cle, valeur]) => `${cle} : ${String(valeur).trim()}`).join(' ; ');
  }

  // Ce que cette répétition nomme déjà : une quantité qui répète l'un de ces
  // libellés n'a que son nombre à ajouter, sans quoi la ligne dirait deux fois
  // « Tables Kermesse ».
  const dejaNommes = new Set(
    entrees
      .filter(([, valeur]) => valeur !== null && valeur !== undefined && typeof valeur !== 'object')
      .map(([, valeur]) => String(valeur).trim())
  );

  return entrees
    .map(([, valeur]) => quantiteDejaNommee(valeur, dejaNommes) ?? texteLisible(valeur))
    .filter(Boolean)
    .join(separateur);
}

/** Le nombre seul, quand ce qu'il compte est déjà écrit à côté. */
function quantiteDejaNommee(valeur: unknown, dejaNommes: Set<string>): string | null {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null;

  const entrees = Object.entries(valeur as Record<string, unknown>);
  if (entrees.length === 0) return null;
  if (!entrees.every(([cle, nombre]) => estQuantite(nombre) && dejaNommes.has(cle.trim()))) {
    return null;
  }

  return entrees.map(([, nombre]) => String(nombre).trim()).join(', ');
}

/** Une valeur qui ne dit rien sans le nom de ce qu'elle compte. */
const estQuantite = (valeur: unknown): boolean =>
  typeof valeur === 'number' || /^\d+$/.test(String(valeur ?? '').trim());

function convertir(valeur: unknown, type: TypeChamp): string | number | null {
  switch (type) {
    case 'date':
      return normaliserDate(valeur);
    case 'heure':
      return normaliserHeure(valeur);
    case 'entier':
      return normaliserEntier(valeur);
    default: {
      const texte = texteLisible(valeur);
      return texte === '' ? null : texte;
    }
  }
}

export interface ManifestationRecue {
  champs: Partial<Record<ChampIntake, string | number>>;
  /** Champs obligatoires qu'aucun chemin ne renseigne. */
  manquants: DefinitionChampIntake[];
}

/** Applique la correspondance à une charge utile et convertit chaque valeur. */
export function extraireManifestation(
  payload: unknown,
  correspondance: CorrespondanceIntake
): ManifestationRecue {
  const champs: Partial<Record<ChampIntake, string | number>> = {};

  for (const definition of CHAMPS_INTAKE) {
    // Le premier chemin qui porte une valeur l'emporte : les branches non
    // suivies du formulaire arrivent vides, elles ne doivent pas faire écran.
    for (const chemin of cheminsDuChamp(correspondance[definition.champ])) {
      const valeur = convertir(valeurAuChemin(payload, chemin), definition.type);
      if (valeur !== null && valeur !== '') {
        champs[definition.champ] = valeur;
        break;
      }
    }
  }

  const manquants = CHAMPS_INTAKE.filter(
    (d) => d.obligatoire && champs[d.champ] === undefined
  );

  return { champs, manquants };
}

/** Une réponse conservée telle qu'elle est arrivée, avec de quoi la relire. */
export interface DetailDemande {
  /** Nom sous lequel un modèle de document l'affiche. */
  cle: string;
  libelle: string;
  section: SectionIntake;
  valeur: string;
}

/**
 * Réponses qu'aucune colonne de `manifestations` ne porte.
 *
 * Elles sont conservées avec leur intitulé et leur section, et non comme un
 * simple dictionnaire : l'écran qui les affiche n'a alors rien à connaître du
 * catalogue, et une demande reçue l'an dernier se relit telle qu'elle a été
 * posée, même si le formulaire a changé de questions depuis.
 */
export function detailsDeLaDemande(
  champs: Partial<Record<ChampIntake, string | number>>
): DetailDemande[] {
  return CHAMPS_DETAILS.filter((d) => champs[d.champ] !== undefined).map((d) => ({
    cle: d.cleModele,
    libelle: d.libelle,
    section: d.section,
    valeur: String(champs[d.champ]),
  }));
}

// ======================== MATÉRIEL DEMANDÉ ========================

export interface LigneMaterielRecue {
  libelle: string;
  quantite: number;
}

/** Chemins où chercher le matériel quand la source n'en désigne aucun. */
const CHEMINS_MATERIEL_PROBABLES = [
  'materiels', 'materiel', 'materials', 'items', 'articles',
  'data.materiels', 'data.materiel', 'data.materials', 'data.items',
];

/**
 * Lignes de matériel demandées.
 *
 * Un libellé nu sans quantité vaut 1 : un formulaire à cases à cocher ne dit pas
 * « 1 sono », il dit « sono ». Une entrée textuelle « 10 tables » est découpée,
 * parce que c'est ainsi qu'un agent la saisit dans un champ libre.
 */
export function extraireMateriels(
  payload: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue[] {
  const chemins = correspondance?.chemin
    ? [correspondance.chemin]
    : CHEMINS_MATERIEL_PROBABLES;

  for (const chemin of chemins) {
    const source = valeurAuChemin(payload, chemin);
    if (source === undefined || source === null) continue;

    const lignes = lireLignes(source, correspondance);
    if (lignes.length > 0) return lignes;
  }

  return correspondance?.chemin ? [] : questionsAQuantites(payload);
}

/**
 * Répéteurs qui demandent un article **et** son nombre.
 *
 * Un formulaire ne range pas ses demandes sous une clé `materiels` : il pose
 * « Besoin de matériel technique ? », puis « Matériel informatique ? », chacune
 * répétable. Sans cette lecture, une demande de dix tables et deux
 * vidéoprojecteurs arrivait vide, et tout était à ressaisir.
 *
 * La condition est stricte — une question à quantité — et c'est ce qui la rend
 * sûre : « Quel bâtiment ? » et « Quelle rue ? » sont des répéteurs eux aussi,
 * mais ils ne comptent rien. Les prendre pour du matériel ferait chercher au
 * stock un article nommé « Mairie », puis laisserait la ligne à rattacher à la
 * main sur chaque demande.
 */
function questionsAQuantites(payload: unknown): LigneMaterielRecue[] {
  if (!payload || typeof payload !== 'object') return [];

  const lignes: LigneMaterielRecue[] = [];
  for (const valeur of Object.values(payload as Record<string, unknown>)) {
    if (!Array.isArray(valeur)) continue;

    const entrees = valeur.filter((e) => e && typeof e === 'object' && !Array.isArray(e));
    if (entrees.length === 0) continue;

    const compte = entrees.every((entree) => {
      const objet = entree as Record<string, unknown>;
      return (
        trouverCle(objet, ALIAS_LIBELLE, MOTIF_LIBELLE) !== undefined &&
        trouverCle(objet, ALIAS_QUANTITE, MOTIF_QUANTITE) !== undefined
      );
    });
    if (compte) lignes.push(...entrees.map((entree) => lireEntree(entree)).filter(estUtile));
  }

  return lignes;
}

function lireLignes(
  source: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue[] {
  if (Array.isArray(source)) {
    return source.map((entree) => lireEntree(entree, correspondance)).filter(estUtile);
  }

  if (typeof source === 'object' && source !== null) {
    // Forme « objet » : une clé par article, la valeur porte la quantité.
    return Object.entries(source as Record<string, unknown>)
      .map(([libelle, quantite]) => ({
        libelle: String(libelle).trim(),
        quantite: normaliserEntier(quantite) ?? (quantite ? 1 : 0),
      }))
      .filter(estUtile);
  }

  if (typeof source === 'string') {
    return source
      .split(/[\n;,]+/)
      .map((morceau) => decouperLibelle(morceau))
      .filter(estUtile);
  }

  return [];
}

function lireEntree(
  entree: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue {
  if (typeof entree === 'string') return decouperLibelle(entree);

  if (typeof entree === 'object' && entree !== null) {
    const objet = entree as Record<string, unknown>;

    const cleLibelle =
      correspondance?.champ_libelle ?? trouverCle(objet, ALIAS_LIBELLE, MOTIF_LIBELLE);
    const cleQuantite =
      correspondance?.champ_quantite ?? trouverCle(objet, ALIAS_QUANTITE, MOTIF_QUANTITE);

    const libelle = cleLibelle ? texteLisible(objet[cleLibelle]) : '';
    const quantite = cleQuantite ? quantiteDe(objet[cleQuantite], libelle) : null;

    return { libelle, quantite: quantite ?? 1 };
  }

  return { libelle: '', quantite: 0 };
}

const ALIAS_LIBELLE = ['libelle', 'nom', 'name', 'materiel', 'article', 'designation', 'label', 'intitule'];
const ALIAS_QUANTITE = ['quantite', 'quantity', 'qte', 'qty', 'nombre', 'nb'];

/**
 * Un formulaire n'intitule pas ses questions comme une base de données : il
 * demande « Quel matériel technique ? » et « Combien en avez-vous besoin ? ».
 * Ces deux tournures sont donc reconnues au même titre qu'un champ `libelle`.
 */
const MOTIF_LIBELLE = /^(quel|quelle|quels|quelles)\b/;
const MOTIF_QUANTITE = /\b(combien|quantite|quantites|nombre)\b/;

function trouverCle(
  objet: Record<string, unknown>,
  alias: string[],
  motif?: RegExp
): string | undefined {
  const normalisees = Object.keys(objet).map((cle) => ({ cle, normalise: normaliserLibelle(cle) }));
  const exact = normalisees.find(({ normalise }) => alias.includes(normalise));
  if (exact) return exact.cle;

  return motif ? normalisees.find(({ normalise }) => motif.test(normalise))?.cle : undefined;
}

/**
 * Quantité demandée, quelle que soit la forme du bloc qui la porte.
 *
 * Une question à quantités rend `{ « Vidéo projecteur » : 2 }` : c'est le
 * nombre qui compte, pas la clé, que la ligne nomme déjà. Réglée sur « valeur »,
 * la même question rend « 2 » tout court.
 */
function quantiteDe(valeur: unknown, libelle: string): number | null {
  if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) {
    const entrees = Object.entries(valeur as Record<string, unknown>);
    const pourCeLibelle = entrees.find(([cle]) => normaliserLibelle(cle) === normaliserLibelle(libelle));
    return normaliserEntier((pourCeLibelle ?? entrees[0])?.[1]);
  }

  return normaliserEntier(valeur);
}

/** « 10 tables » → 10 × « tables ». Sans nombre en tête, la quantité vaut 1. */
function decouperLibelle(brut: string): LigneMaterielRecue {
  const texte = brut.trim();
  if (!texte) return { libelle: '', quantite: 0 };

  const avecNombre = texte.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  if (avecNombre) {
    return { libelle: avecNombre[2].trim(), quantite: Number.parseInt(avecNombre[1], 10) };
  }

  return { libelle: texte, quantite: 1 };
}

const estUtile = (ligne: LigneMaterielRecue): boolean =>
  ligne.libelle.length > 0 && ligne.quantite > 0;

/** Un libellé reçu, rapproché de ce qu'il désigne — et de la table qui le porte. */
export interface ArticleApparie {
  source: 'stock' | 'parc';
  id: number;
  name: string;
  unit: string;
  is_prestation: boolean;
}

/**
 * Rapproche un libellé reçu d'un article proposable.
 *
 * D'abord le stock des manifestations : sur le nom normalisé, puis sur les alias
 * enregistrés — « tables » doit trouver « Table 180 cm » sans qu'on rebaptise le
 * stock. Puis le parc prêtable, où vivent les exemplaires, les lots et les
 * prestations déclarées par branche. Le catalogue propose les deux sources ; ne
 * relire que la première laissait « Raccordement électrique » en ligne à
 * rattacher, alors qu'il figurait au formulaire que la collectivité a publié.
 *
 * Le parc n'est consulté que sur ce qu'il accepte de prêter et ce qui est actif :
 * la réception ne doit pas engager un matériel que le catalogue n'aurait jamais
 * proposé.
 *
 * Aucune correspondance approximative : mieux vaut laisser une ligne à rattacher
 * à la main que de réserver le mauvais matériel.
 */
export async function apparierMateriel(libelle: string): Promise<ArticleApparie | null> {
  const recherche = normaliserLibelle(libelle);
  if (!recherche) return null;

  const duStock = (article: any): ArticleApparie => ({
    source: 'stock',
    id: Number(article.id),
    name: String(article.name ?? ''),
    unit: String(article.unit ?? ''),
    is_prestation: Boolean(article.is_prestation),
  });

  const articles = await db.query('SELECT id, name, unit, is_prestation FROM manifestation_stock');
  const parNom = articles.find((a: any) => normaliserLibelle(a.name) === recherche);
  if (parNom) return duStock(parNom);

  const alias = await db.query('SELECT stock_id, alias FROM manifestation_stock_aliases');
  const correspondant = alias.find((a: any) => normaliserLibelle(a.alias) === recherche);
  if (correspondant) {
    const article = articles.find((a: any) => a.id === correspondant.stock_id);
    if (article) return duStock(article);
  }

  const objets = await db.query(
    `SELECT o.id, o.name, ${expressionPrestation()} as is_prestation
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE ${expressionDisponibilite()} = 1 AND o.status = 'active'`
  );
  const objet = objets.find((o: any) => normaliserLibelle(o.name) === recherche);
  if (!objet) return null;

  return {
    source: 'parc',
    id: Number(objet.id),
    name: String(objet.name ?? ''),
    unit: '',
    is_prestation: Boolean(Number(objet.is_prestation)),
  };
}

// ======================== SIGNATURE ========================

/**
 * Vérifie la signature HMAC d'une charge utile reçue.
 *
 * Même convention que l'émission (`webhook.service.ts`) : `sha256=<hexa>` sur les
 * octets exacts du corps. La comparaison passe par `timingSafeEqual` — comparer
 * deux chaînes avec `===` laisse fuir, par le temps de réponse, le nombre de
 * caractères devinés.
 */
export function signatureValide(
  corpsBrut: Buffer | string | undefined,
  entete: string | undefined,
  secret: string
): boolean {
  if (!corpsBrut || !entete || !secret) return false;

  const attendue = crypto.createHmac('sha256', secret).update(corpsBrut).digest('hex');
  const recue = entete.startsWith('sha256=') ? entete.slice('sha256='.length) : entete;

  const a = Buffer.from(attendue, 'utf8');
  const b = Buffer.from(recue, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/** Secret d'une source, assez long pour ne pas se deviner. */
export function genererSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}
