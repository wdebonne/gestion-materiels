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

export type EvenementNotification =
  | 'new_request'
  | 'approval_requested'
  | 'approval_decided'
  | 'message'
  | 'dates_changed'
  | 'material_changed'
  | 'delivery_reminder'
  | 'recovery_overdue';

export interface DefinitionEvenement {
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
    evenement: 'new_request',
    libelle: 'Demande reçue',
    description: "Une demande arrive d'un formulaire et attend d'être confirmée.",
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    evenement: 'approval_requested',
    libelle: 'Approbation attendue',
    description: 'Un service est sollicité pour approuver sa part de la demande.',
    engageant: true,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    evenement: 'approval_decided',
    libelle: 'Décision rendue',
    description: 'Un service a approuvé, refusé, ou s’est déclaré non concerné.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    evenement: 'message',
    libelle: 'Message dans le fil',
    description: 'Quelqu’un écrit dans les échanges d’une manifestation suivie.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    evenement: 'dates_changed',
    libelle: 'Dates modifiées',
    description: 'La date, la livraison ou la récupération a changé.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    evenement: 'material_changed',
    libelle: 'Matériel modifié',
    description: 'Du matériel a été ajouté ou retiré d’une manifestation suivie.',
    engageant: false,
    rolesParDefaut: [],
    servicesParDefaut: true,
  },
  {
    evenement: 'delivery_reminder',
    libelle: 'Livraison à préparer',
    description: 'Rappel envoyé quelques jours avant la livraison.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
  {
    evenement: 'recovery_overdue',
    libelle: 'Récupération en retard',
    description: 'Le matériel devait revenir et la récupération n’est pas saisie.',
    engageant: false,
    rolesParDefaut: ['admin', 'supervisor'],
    servicesParDefaut: true,
  },
];

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

const CLE_REGLAGE = 'manifestation_notification_defaults';

/**
 * Défauts administrateur, complétés par le catalogue.
 *
 * Un événement absent du réglage enregistré prend ses valeurs du catalogue :
 * ajouter un événement au code ne doit pas obliger à rouvrir l'écran pour qu'il
 * parte, ni le laisser muet sans que personne le remarque.
 */
export async function lireDefauts(): Promise<Record<EvenementNotification, ReglageEvenement>> {
  const complets = {} as Record<EvenementNotification, ReglageEvenement>;
  for (const definition of EVENEMENTS_NOTIFICATION) {
    complets[definition.evenement] = {
      roles: [...definition.rolesParDefaut],
      services: definition.servicesParDefaut,
    };
  }

  try {
    const reglage = await db.queryOne(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [CLE_REGLAGE]
    );
    if (!reglage?.setting_value) return complets;

    const enregistres = JSON.parse(reglage.setting_value) as DefautsAdmin;
    for (const [evenement, valeur] of Object.entries(enregistres)) {
      if (!PAR_EVENEMENT.has(evenement as EvenementNotification) || !valeur) continue;

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
export async function enregistrerDefauts(brut: DefautsAdmin): Promise<void> {
  const propre: DefautsAdmin = {};
  for (const [evenement, valeur] of Object.entries(brut ?? {})) {
    if (!PAR_EVENEMENT.has(evenement as EvenementNotification) || !valeur) continue;

    propre[evenement as EvenementNotification] = {
      roles: (valeur.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
      services: valeur.services !== false,
    };
  }

  const maintenant = new Date().toISOString();
  const existant = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [CLE_REGLAGE]);

  if (existant) {
    await db.execute('UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?', [
      JSON.stringify(propre),
      maintenant,
      CLE_REGLAGE,
    ]);
  } else {
    await db.execute(
      `INSERT INTO settings (setting_key, setting_value, setting_type, description, created_at, updated_at)
       VALUES (?, ?, 'json', ?, ?, ?)`,
      [
        CLE_REGLAGE,
        JSON.stringify(propre),
        'Destinataires par défaut des notifications de manifestation',
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
    return {
      ok: false,
      message:
        "« " + definition.libelle + " » ne peut pas être coupé : sans cet avis, vous bloqueriez une manifestation sans le savoir",
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
  const defauts = await lireDefauts();
  const roles = defauts[evenement as EvenementNotification]?.roles ?? [];
  if (roles.length === 0) return [];

  const comptes = await db.query(
    `SELECT id, email, role FROM users
     WHERE is_active = 1 AND email IS NOT NULL AND role IN (${roles.map(() => '?').join(',')})`,
    roles
  );

  return comptes.map((c: any) => ({ email: c.email, userId: c.id, role: c.role }));
}

/** Les services rattachés reçoivent-ils cet événement, selon la grille ? */
export async function servicesNotifies(evenement: string): Promise<boolean> {
  const defauts = await lireDefauts();
  return defauts[evenement as EvenementNotification]?.services !== false;
}
