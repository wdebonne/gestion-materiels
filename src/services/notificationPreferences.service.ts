import { db } from '../database';
import { ROLES, type Role } from '../config/roles';

/**
 * Qui reçoit quoi, et qui peut en décider.
 *
 * Les réglages n'existaient qu'au niveau du service : un agent noyé sous les
 * messages ne pouvait rien y faire sans couper aussi ses collègues. Trois
 * niveaux se superposent désormais, du plus général au plus précis :
 *
 * 1. **le défaut administrateur** — pour chaque événement, quels rôles sont
 *    concernés, et si les services rattachés à la manifestation le reçoivent ;
 * 2. **le réglage du service** (`services.notify_*`), déjà en place ;
 * 3. **la préférence du compte**, qui l'emporte sur tout.
 *
 * Avec une exception, et une seule : ce qui **engage** son destinataire part
 * toujours. Une approbation qu'on attend de vous bloque la manifestation tant
 * que vous n'avez pas répondu ; vous laisser la couper, c'est vous laisser
 * bloquer une manifestation sans jamais le savoir.
 */

/**
 * Le module auquel un événement appartient.
 *
 * Deux modules écrivent à des gens — les manifestations et les demandes — et
 * chacun a ses événements, ses destinataires par défaut et son écran de
 * réglage. Le catalogue est **commun** plutôt que dupliqué : `engageant`,
 * `filtrerSelonPreferences` et `destinatairesParRole` sont la même mécanique,
 * et deux copies auraient divergé au premier ajout.
 *
 * Les événements de tickets sont **préfixés**. `notification_preferences` est
 * indexée par `(user_id, event)` : réemployer la clé `message` ferait que
 * couper les messages de manifestation couperait aussi ceux des demandes. Aucun
 * événement existant n'est renommé — les lignes déjà enregistrées restent
 * valides, et aucune migration n'est nécessaire.
 */
export type DomaineNotification = 'manifestation' | 'ticket';

export type EvenementNotification =
  | 'new_request'
  | 'approval_requested'
  | 'approval_decided'
  | 'message'
  | 'dates_changed'
  | 'material_changed'
  | 'delivery_reminder'
  | 'recovery_overdue'
  | 'ticket_nouveau'
  | 'ticket_assigne'
  | 'ticket_message'
  | 'ticket_statut'
  | 'ticket_resolu'
  | 'ticket_a_valider'
  | 'ticket_echeance';

export interface DefinitionEvenement {
  domaine: DomaineNotification;
  evenement: EvenementNotification;
  libelle: string;
  description: string;
  /**
   * Engage son destinataire : ne peut pas être coupé individuellement.
   *
   * Le réglage du service, lui, reste maître — un service peut décider de ne pas
   * être sollicité du tout, c'est une décision collective assumée.
   */
  engageant: boolean;
  /** Rôles destinataires par défaut, en plus des services concernés. */
  rolesParDefaut: Role[];
  /** Les services rattachés à la manifestation reçoivent-ils par défaut ? */
  servicesParDefaut: boolean;
  /**
   * Pourquoi cet avis ne peut pas être coupé, dit au destinataire.
   *
   * Le message était écrit en dur et parlait de manifestation ; il aurait
   * expliqué à un technicien qu'il bloque une manifestation en refusant les
   * demandes qu'on lui confie. Chaque événement engageant porte donc sa raison.
   */
  raisonEngageant?: string;
}

/**
 * Catalogue des événements notifiables du module Manifestations.
 *
 * Écrit une seule fois : l'écran d'administration, l'écran de préférences et le
 * code d'envoi le lisent tous les trois. Une liste recopiée à trois endroits
 * finirait par diverger, et un événement à moitié déclaré serait proposé sans
 * jamais partir.
 */
export const EVENEMENTS_NOTIFICATION: DefinitionEvenement[] = [
  {
    domaine: 'manifestation',
    evenement: 'new_request',
    libelle: 'Demande reçue',
    description: "Une demande arrive d'un formulaire et attend d'être confirmée.",
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'approval_requested',
    libelle: 'Approbation attendue',
    description: 'Un service est sollicité pour approuver sa part de la demande.',
    engageant: true,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'approval_decided',
    libelle: 'Décision rendue',
    description: 'Un service a approuvé, refusé, ou s’est déclaré non concerné.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'message',
    libelle: 'Message dans le fil',
    description: 'Quelqu’un écrit dans les échanges d’une manifestation suivie.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'dates_changed',
    libelle: 'Dates modifiées',
    description: 'La date, la livraison ou la récupération a changé.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'material_changed',
    libelle: 'Matériel modifié',
    description: 'Du matériel a été ajouté ou retiré d’une manifestation suivie.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'delivery_reminder',
    libelle: 'Livraison à préparer',
    description: 'Rappel envoyé quelques jours avant la livraison.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    domaine: 'manifestation',
    evenement: 'recovery_overdue',
    libelle: 'Récupération en retard',
    description: 'Le matériel devait revenir et la récupération n’est pas saisie.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },

  // ------------------------------------------------------------- les demandes
  //
  // `rolesParDefaut` est volontairement vide presque partout : une demande a
  // déjà son demandeur, son technicien et son service, qui sont notifiés à ce
  // titre. Prévenir en plus tous les superviseurs de chaque ouverture ferait
  // exactement ce que l'existant a appris à éviter — on cesse de lire, et on
  // rate celle qui comptait. Ce qui dépasse ce socle se règle par les règles
  // de diffusion, qui visent une catégorie, un bâtiment ou un service.
  {
    domaine: 'ticket',
    evenement: 'ticket_nouveau',
    libelle: 'Demande ouverte',
    description: 'Quelqu’un signale un problème ou formule une demande.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_assigne',
    libelle: 'Demande confiée',
    description: 'Une demande vous est confiée, ou est confiée à votre équipe.',
    engageant: true,
    raisonEngageant:
      'sans cet avis, une demande qu’on vous a confiée attendrait sans que vous le sachiez',
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_message',
    libelle: 'Message dans le fil',
    description: 'Quelqu’un écrit dans une demande qui vous concerne.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_statut',
    libelle: 'État modifié',
    description: 'Une demande change d’état : prise en charge, mise en attente, commandée.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_resolu',
    libelle: 'Demande close',
    description: 'Une demande est résolue ou refusée.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_a_valider',
    libelle: 'Clôture à valider',
    description: 'Un agent a terminé une demande de votre catégorie : elle attend votre validation.',
    engageant: true,
    raisonEngageant: 'sans cet avis, la demande attendrait une validation que personne ne sait devoir donner',
    rolesParDefaut: [],
    servicesParDefaut: false,
  },
  {
    domaine: 'ticket',
    evenement: 'ticket_echeance',
    libelle: 'Délai dépassé',
    description: 'Le délai de prise en charge ou de résolution est passé.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
];

/** Les événements d'un module, pour son écran de réglage. */
export function evenementsDu(domaine: DomaineNotification): DefinitionEvenement[] {
  return EVENEMENTS_NOTIFICATION.filter((d) => d.domaine === domaine);
}

/**
 * À quel module appartient cet événement.
 *
 * Déduit du catalogue, et non transmis par l'appelant : c'est ce qui permet à
 * `destinatairesParRole()` et `servicesNotifies()` de garder leur signature
 * d'origine, donc à `manifestationNotify.service.ts` de ne pas bouger.
 */
export function domaineDe(evenement: string): DomaineNotification {
  return definitionDe(evenement)?.domaine ?? 'manifestation';
}

const PAR_EVENEMENT = new Map(EVENEMENTS_NOTIFICATION.map((d) => [d.evenement, d]));

export function definitionDe(evenement: string): DefinitionEvenement | undefined {
  return PAR_EVENEMENT.get(evenement as EvenementNotification);
}

/** Réglage administrateur d'un événement. */
export interface ReglageEvenement {
  roles: Role[];
  services: boolean;
}

export type DefautsAdmin = Partial<Record<EvenementNotification, ReglageEvenement>>;

/**
 * Une clé de réglages par module.
 *
 * Deux clés plutôt qu'une : la clé existante n'est pas touchée, donc les
 * réglages déjà en place continuent d'être relus tels quels.
 */
const CLES_REGLAGE: Record<DomaineNotification, string> = {
  manifestation: 'manifestation_notification_defaults',
  ticket: 'ticket_notification_defaults',
};

/**
 * Défauts administrateur, complétés par le catalogue.
 *
 * Un événement absent du réglage enregistré prend ses valeurs du catalogue :
 * ajouter un événement au code ne doit pas obliger à rouvrir l'écran pour qu'il
 * parte, ni le laisser muet sans que personne le remarque.
 */
export async function lireDefauts(
  domaine: DomaineNotification = 'manifestation'
): Promise<Record<EvenementNotification, ReglageEvenement>> {
  const complets = {} as Record<EvenementNotification, ReglageEvenement>;
  for (const definition of evenementsDu(domaine)) {
    complets[definition.evenement] = {
      roles: [...definition.rolesParDefaut],
      services: definition.servicesParDefaut,
    };
  }

  try {
    const reglage = await db.queryOne(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [CLES_REGLAGE[domaine]]
    );
    if (!reglage?.setting_value) return complets;

    const enregistres = JSON.parse(reglage.setting_value) as DefautsAdmin;
    for (const [evenement, valeur] of Object.entries(enregistres)) {
      if (!PAR_EVENEMENT.has(evenement as EvenementNotification) || !valeur) continue;
      // Un réglage rangé sous la mauvaise clé ne doit pas franchir la
      // frontière des modules : il changerait un module sans qu'aucun écran
      // ne le montre.
      if (domaineDe(evenement) !== domaine) continue;

      complets[evenement as EvenementNotification] = {
        // Un rôle inconnu — supprimé du modèle depuis l'enregistrement — est
        // écarté plutôt que d'être comparé sans jamais correspondre.
        roles: (valeur.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
        services: valeur.services !== false,
      };
    }
  } catch (erreur: any) {
    console.error('Réglages de notification illisibles :', erreur?.message ?? erreur);
  }

  return complets;
}

/** Enregistre les défauts, en n'acceptant que des événements et des rôles connus. */
export async function enregistrerDefauts(
  brut: DefautsAdmin,
  domaine: DomaineNotification = 'manifestation'
): Promise<void> {
  const propre: DefautsAdmin = {};
  for (const [evenement, valeur] of Object.entries(brut ?? {})) {
    if (!PAR_EVENEMENT.has(evenement as EvenementNotification) || !valeur) continue;
    if (domaineDe(evenement) !== domaine) continue;

    propre[evenement as EvenementNotification] = {
      roles: (valeur.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
      services: valeur.services !== false,
    };
  }

  const maintenant = new Date().toISOString();
  const cle = CLES_REGLAGE[domaine];
  const existant = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [cle]);

  if (existant) {
    await db.execute('UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?', [
      JSON.stringify(propre),
      maintenant,
      cle,
    ]);
  } else {
    await db.execute(
      `INSERT INTO settings (setting_key, setting_value, setting_type, description, created_at, updated_at)
       VALUES (?, ?, 'json', ?, ?, ?)`,
      [
        cle,
        JSON.stringify(propre),
        domaine === 'ticket'
          ? 'Destinataires par défaut des notifications de demande'
          : 'Destinataires par défaut des notifications de manifestation',
        maintenant,
        maintenant,
      ]
    );
  }
}

/** Choix explicites d'un compte : événement → reçoit ou non. */
export async function preferencesDe(userId: number): Promise<Map<string, boolean>> {
  const lignes = await db.query(
    'SELECT event, enabled FROM notification_preferences WHERE user_id = ?',
    [userId]
  );
  return new Map(lignes.map((l: any) => [l.event, Boolean(l.enabled)]));
}

/**
 * Enregistre le choix d'un compte pour un événement.
 *
 * Un événement engageant ne peut pas être coupé : la demande est refusée plutôt
 * qu'ignorée en silence, pour que l'écran puisse le dire.
 */
export async function enregistrerPreference(
  userId: number,
  evenement: string,
  actif: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const definition = definitionDe(evenement);
  if (!definition) return { ok: false, message: 'Événement inconnu' };

  if (definition.engageant && !actif) {
    const raison =
      definition.raisonEngageant ??
      'sans cet avis, vous bloqueriez une manifestation sans le savoir';
    return {
      ok: false,
      message: `« ${definition.libelle} » ne peut pas être coupé : ${raison}`,
    };
  }

  const maintenant = new Date().toISOString();
  const existant = await db.queryOne(
    'SELECT id FROM notification_preferences WHERE user_id = ? AND event = ?',
    [userId, evenement]
  );

  if (existant) {
    await db.execute(
      'UPDATE notification_preferences SET enabled = ?, updated_at = ? WHERE id = ?',
      [actif ? 1 : 0, maintenant, existant.id]
    );
  } else {
    await db.execute(
      `INSERT INTO notification_preferences (user_id, event, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, evenement, actif ? 1 : 0, maintenant, maintenant]
    );
  }

  return { ok: true };
}

export interface Destinataire {
  email: string;
  /** Absent pour une boîte partagée de service, qui n'appartient à personne. */
  userId?: number;
  role?: string;
}

/**
 * Écarte les comptes qui ont coupé cet événement.
 *
 * Une boîte partagée de service n'a pas de compte, donc pas de préférence : elle
 * reste, gouvernée par le réglage du service. Un événement engageant n'est jamais
 * filtré.
 */
export async function filtrerSelonPreferences(
  destinataires: Destinataire[],
  evenement: string
): Promise<string[]> {
  const definition = definitionDe(evenement);
  if (definition?.engageant) {
    return [...new Set(destinataires.map((d) => d.email))];
  }

  const retenus: string[] = [];
  const cache = new Map<number, Map<string, boolean>>();

  for (const destinataire of destinataires) {
    if (destinataire.userId === undefined) {
      retenus.push(destinataire.email);
      continue;
    }

    let preferences = cache.get(destinataire.userId);
    if (!preferences) {
      preferences = await preferencesDe(destinataire.userId);
      cache.set(destinataire.userId, preferences);
    }

    // Pas de ligne : le compte n'a rien choisi, il suit le réglage général.
    if (preferences.get(evenement) === false) continue;
    retenus.push(destinataire.email);
  }

  return [...new Set(retenus)];
}

/**
 * Comptes destinataires d'un événement au titre de leur rôle.
 *
 * C'est ce que règle la grille de l'administrateur : « tout superviseur reçoit
 * les demandes reçues », indépendamment des services.
 */
export async function destinatairesParRole(evenement: string): Promise<Destinataire[]> {
  const defauts = await lireDefauts(domaineDe(evenement));
  const roles = defauts[evenement as EvenementNotification]?.roles ?? [];
  if (roles.length === 0) return [];

  // `can_login = 1` : une fiche d'annuaire porte un rôle par défaut, qui ne
  // décrit aucun pouvoir. La notifier reviendrait à écrire à quelqu'un dont
  // tous les liens du message mènent à un écran de connexion qu'il ne passera pas.
  const comptes = await db.query(
    `SELECT id, email, role FROM users
     WHERE is_active = 1 AND can_login = 1 AND email IS NOT NULL
       AND role IN (${roles.map(() => '?').join(',')})`,
    roles
  );

  return comptes.map((c: any) => ({ email: c.email, userId: c.id, role: c.role }));
}

/** Les services rattachés reçoivent-ils cet événement, selon la grille ? */
export async function servicesNotifies(evenement: string): Promise<boolean> {
  const defauts = await lireDefauts(domaineDe(evenement));
  return defauts[evenement as EvenementNotification]?.services !== false;
}
