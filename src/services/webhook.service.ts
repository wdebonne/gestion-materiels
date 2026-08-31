import crypto from 'crypto';
import { db } from '../database';
import { logService } from './log.service';

/**
 * Envoi des webhooks.
 *
 * Le CRUD, le bouton de test et la journalisation existaient depuis toujours,
 * mais `POST /webhooks/trigger` n'était appelé par aucune route ni tâche
 * planifiée : un administrateur configurait une URL, la testait avec succès, et
 * plus jamais rien ne partait. L'écran des webhooks proposait pourtant douze
 * événements.
 *
 * La livraison était écrite dans le corps de la route, donc inaccessible depuis
 * le reste du code. Elle vit ici pour que n'importe quelle route ou tâche puisse
 * l'appeler.
 */

/** Événements que l'écran des webhooks propose de suivre. */
export const EVENEMENTS_WEBHOOK = [
  'object.created',
  'object.updated',
  'object.deleted',
  'category.created',
  'category.updated',
  'category.deleted',
  'alert.created',
  'maintenance.created',
  'fuel.created',
  'backup.created',
  'user.created',
  'user.login',
  'manifestation.received',
  'manifestation.created',
  'manifestation.updated',
  'manifestation.status_changed',
  'manifestation.materials_updated',
  'manifestation.approval_requested',
  'manifestation.approval_decided',
  'manifestation.dates_changed',
] as const;

export type EvenementWebhook = (typeof EVENEMENTS_WEBHOOK)[number];

/**
 * Une URL qui ne répond jamais ne doit pas retenir l'appelant. `fetch` n'a pas
 * d'option `timeout` — celle qui figurait dans le code était simplement ignorée,
 * et un webhook pointant vers un trou noir aurait bloqué indéfiniment.
 */
const DELAI_MAX_MS = 10_000;

export interface ResultatEnvoi {
  webhookId: number;
  nom: string;
  success: boolean;
  status: number;
}

/** Webhooks actifs qui écoutent cet événement. Une liste vide vaut « tous ». */
async function webhooksConcernes(evenement: string): Promise<any[]> {
  const actifs = await db.query('SELECT * FROM webhooks WHERE is_active = 1');

  return actifs.filter((w: any) => {
    let evenements: string[] = [];
    try {
      evenements = w.events ? JSON.parse(w.events) : [];
    } catch {
      evenements = [];
    }
    return evenements.length === 0 || evenements.includes('*') || evenements.includes(evenement);
  });
}

function entetes(webhook: any, corps: string): Record<string, string> {
  let personnalises: Record<string, string> = {};
  try {
    personnalises = webhook.headers ? JSON.parse(webhook.headers) : {};
  } catch {
    personnalises = {};
  }

  const resultat: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'GestionMateriels-Webhook/1.0',
    ...personnalises,
  };

  // Signature HMAC : le destinataire peut vérifier que l'appel vient bien d'ici.
  if (webhook.secret) {
    const signature = crypto.createHmac('sha256', webhook.secret).update(corps).digest('hex');
    resultat['X-Webhook-Signature'] = `sha256=${signature}`;
  }

  return resultat;
}

async function noterResultat(id: number, status: number, reponse: string): Promise<void> {
  const maintenant = new Date().toISOString();
  await db.execute(
    `UPDATE webhooks SET last_triggered_at = ?, last_status = ?, last_response = ?, updated_at = ?
     WHERE id = ?`,
    [maintenant, status, reponse.substring(0, 1000), maintenant, id]
  );
}

/**
 * Envoie un événement à tous les webhooks qui l'écoutent.
 *
 * Rend la liste des résultats. Les erreurs sont capturées webhook par webhook :
 * un destinataire injoignable ne doit pas empêcher les autres de recevoir
 * l'événement.
 */
export async function envoyerWebhooks(evenement: string, data: unknown): Promise<ResultatEnvoi[]> {
  const cibles = await webhooksConcernes(evenement);
  if (cibles.length === 0) return [];

  const corps = JSON.stringify({
    event: evenement,
    timestamp: new Date().toISOString(),
    data,
  });

  const resultats: ResultatEnvoi[] = [];

  for (const webhook of cibles) {
    try {
      const reponse = await fetch(webhook.url, {
        method: 'POST',
        headers: entetes(webhook, corps),
        body: corps,
        signal: AbortSignal.timeout(DELAI_MAX_MS),
      });

      const texte = await reponse.text();
      await noterResultat(webhook.id, reponse.status, texte);
      resultats.push({ webhookId: webhook.id, nom: webhook.name, success: reponse.ok, status: reponse.status });

      if (!reponse.ok) {
        await logService.warning('api', `Webhook "${webhook.name}" a répondu ${reponse.status}`, {
          evenement,
          url: webhook.url,
        });
      }
    } catch (erreur: any) {
      const message = erreur?.name === 'TimeoutError'
        ? `Pas de réponse après ${DELAI_MAX_MS / 1000} secondes`
        : erreur?.message ?? 'Erreur inconnue';

      await noterResultat(webhook.id, 0, message);
      resultats.push({ webhookId: webhook.id, nom: webhook.name, success: false, status: 0 });

      await logService.warning('api', `Webhook "${webhook.name}" injoignable`, {
        evenement,
        url: webhook.url,
        erreur: message,
      });
    }
  }

  return resultats;
}

/**
 * Notifie sans faire attendre l'appelant ni risquer de le faire échouer.
 *
 * C'est la forme à utiliser depuis une route : un agent qui enregistre un plein
 * n'a pas à patienter pendant qu'un service externe répond, et un webhook mal
 * configuré ne doit surtout pas faire échouer sa saisie.
 */
export function notifierWebhooks(evenement: EvenementWebhook | string, data: unknown): void {
  void envoyerWebhooks(evenement, data).catch((erreur) => {
    console.error(`Envoi des webhooks "${evenement}" interrompu:`, erreur?.message ?? erreur);
  });
}
