import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../database';

/**
 * Fin de vie d'un compte : désactivation, anonymisation, suppression.
 *
 * `DELETE /users/:id` effaçait la ligne, et chaque clé étrangère en
 * `ON DELETE SET NULL` vidait au passage l'auteur des décisions, des messages et
 * de l'historique. Une manifestation perdait donc la trace de qui l'avait
 * validée le jour où la personne quittait la collectivité — alors que c'est
 * exactement ce qu'un litige exige de retrouver, des mois plus tard.
 *
 * Trois gestes, du plus doux au plus définitif :
 *
 * - **désactiver** : le compte ne se connecte plus, tout le reste est intact.
 *   C'est ce que fait désormais la suppression d'un compte qui a laissé des
 *   traces ;
 * - **anonymiser** : l'identité est remplacée, les liens sont conservés. « Qui a
 *   validé ? » garde une réponse — un compte, distinct des autres — sans que
 *   cette réponse nomme quelqu'un. C'est ce que demande le RGPD sans détruire la
 *   traçabilité ;
 * - **supprimer** : réservé aux comptes qui n'ont rien laissé, où il n'y a rien
 *   à préserver.
 */

export interface TracesCompte {
  manifestations_creees: number;
  historique: number;
  decisions: number;
  messages: number;
  services: number;
  total: number;
}

/**
 * Ce qu'un compte laisserait derrière lui.
 *
 * Sert à choisir entre supprimer et désactiver, et à le dire à
 * l'administrateur plutôt que de décider dans son dos.
 */
export async function tracesDe(userId: number | string): Promise<TracesCompte> {
  /** `marqueurs` dit combien de fois l'identifiant apparaît dans la requête. */
  const compter = async (sql: string, marqueurs = 1): Promise<number> => {
    try {
      const ligne = await db.queryOne(sql, Array(marqueurs).fill(userId));
      return ligne?.cnt ?? 0;
    } catch {
      // Table absente sur une base pas encore migrée : rien à compter.
      return 0;
    }
  };

  const traces = {
    manifestations_creees: await compter('SELECT COUNT(*) as cnt FROM manifestations WHERE created_by = ?'),
    historique: await compter('SELECT COUNT(*) as cnt FROM manifestation_history WHERE user_id = ?'),
    // Décidé par lui, ou sollicité nommément : les deux le rattachent à la
    // manifestation.
    decisions: await compter(
      'SELECT COUNT(*) as cnt FROM manifestation_approvals WHERE decided_by = ? OR user_id = ?',
      2
    ),
    messages: await compter('SELECT COUNT(*) as cnt FROM manifestation_messages WHERE user_id = ?'),
    services: await compter('SELECT COUNT(*) as cnt FROM service_members WHERE user_id = ?'),
    total: 0,
  };

  traces.total =
    traces.manifestations_creees + traces.historique + traces.decisions + traces.messages + traces.services;

  return traces;
}

/**
 * Ce compte est-il le dernier administrateur actif ?
 *
 * Le retirer fermerait la porte de la configuration à tout le monde, sans
 * personne pour la rouvrir.
 */
export async function estDernierAdmin(userId: number | string): Promise<boolean> {
  const compte = await db.queryOne('SELECT role FROM users WHERE id = ?', [userId]);
  if (compte?.role !== 'admin') return false;

  const autres = await db.queryOne(
    "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
    [userId]
  );
  return (autres?.cnt ?? 0) === 0;
}

/** Désactive un compte : il ne se connecte plus, rien d'autre ne bouge. */
export async function desactiver(userId: number | string): Promise<void> {
  await db.execute('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', [
    new Date().toISOString(),
    userId,
  ]);
}

/**
 * Retire un compte de tout ce qui suppose une personne présente.
 *
 * Appartenances aux services, délégations reçues, droits et préférences : rien
 * de tout cela n'a de sens pour quelqu'un qui est parti, et une délégation
 * laissée derrière soi donnerait un pouvoir de décision à un compte fermé.
 * L'historique, lui, n'est jamais touché.
 */
async function retirerDesRolesVivants(userId: number | string): Promise<void> {
  const nettoyages = [
    'DELETE FROM service_members WHERE user_id = ?',
    'DELETE FROM service_delegations WHERE delegate_user_id = ?',
    'DELETE FROM user_permissions WHERE user_id = ?',
    'DELETE FROM user_module_permissions WHERE user_id = ?',
    'DELETE FROM notification_preferences WHERE user_id = ?',
    'DELETE FROM manifestation_watchers WHERE user_id = ?',
  ];

  for (const requete of nettoyages) {
    try {
      await db.execute(requete, [userId]);
    } catch (erreur: any) {
      // Une table absente ne doit pas interrompre le retrait des autres.
      console.error(`Nettoyage « ${requete} » ignoré :`, erreur?.message ?? erreur);
    }
  }
}

export interface ResultatAnonymisation {
  ok: boolean;
  message: string;
  traces?: TracesCompte;
}

/**
 * Remplace l'identité d'un compte, en conservant tous ses liens.
 *
 * L'identifiant reste : c'est lui qui porte « qui a validé cette manifestation »
 * dans l'historique, les décisions et les messages. Seuls le nom, l'adresse et
 * l'avatar disparaissent, remplacés par une désignation stable et distincte —
 * deux personnes anonymisées ne se confondent pas, ce qu'un simple « inconnu »
 * ne permettrait pas.
 *
 * Le mot de passe est remplacé par une valeur aléatoire jamais communiquée :
 * laisser l'ancien permettrait de se reconnecter sous une identité effacée.
 *
 * Irréversible.
 */
export async function anonymiser(
  userId: number | string,
  parQui?: number
): Promise<ResultatAnonymisation> {
  const compte = await db.queryOne('SELECT id, role, anonymized_at FROM users WHERE id = ?', [userId]);
  if (!compte) return { ok: false, message: 'Compte introuvable' };

  if (compte.anonymized_at) {
    return { ok: false, message: 'Ce compte est déjà anonymisé' };
  }
  if (Number(userId) === parQui) {
    return { ok: false, message: 'Vous ne pouvez pas vous anonymiser vous-même' };
  }
  if (await estDernierAdmin(userId)) {
    return {
      ok: false,
      message: "C'est le dernier administrateur actif : plus personne ne pourrait configurer l'application",
    };
  }

  const maintenant = new Date().toISOString();
  const motDePasse = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  await db.execute(
    `UPDATE users
     SET first_name = ?, last_name = ?, email = ?, password = ?, avatar = NULL,
         is_active = 0, anonymized_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      'Compte',
      `anonymisé #${compte.id}`,
      `anonyme-${compte.id}@anonymise.local`,
      motDePasse,
      maintenant,
      maintenant,
      userId,
    ]
  );

  await retirerDesRolesVivants(userId);

  return {
    ok: true,
    message: `Le compte est anonymisé. Il apparaît désormais comme « Compte anonymisé #${compte.id} » partout où il figurait, sans que rien de son historique soit perdu.`,
  };
}
