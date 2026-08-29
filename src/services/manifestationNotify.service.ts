import { db } from '../database';
import { sendEmail } from './email.service';
import { logService } from './log.service';
import { notifierWebhooks } from './webhook.service';
import { destinatairesDuService, destinatairesManifestation } from './manifestationServices.service';

/**
 * Notifications du module Manifestations.
 *
 * Deux règles gouvernent tout ce fichier.
 *
 * **On n'écrit qu'aux concernés.** Le service informatique ne reçoit rien d'une
 * brocante sans matériel informatique, le service restauration rien d'une
 * réunion sans repas. Un service qui reçoit des messages qui ne le regardent pas
 * cesse de les lire, et rate celui qui comptait.
 *
 * **Un envoi ne fait jamais échouer l'action qu'il annonce.** Comme
 * `notifierWebhooks`, ces fonctions sont en « tire-et-oublie » : un serveur SMTP
 * injoignable ne doit pas empêcher d'approuver une manifestation.
 */

/** Adresse publique de l'application, pour les liens dans les courriels. */
async function urlDuSite(): Promise<string> {
  const reglage = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
  return reglage?.setting_value || process.env.SITE_URL || 'http://localhost:3001';
}

/**
 * Envoie un gabarit à une liste d'adresses, sans jamais lever.
 *
 * Un SMTP non configuré est signalé **une seule fois** plutôt qu'une fois par
 * destinataire : répété, le message se noie dans le journal et l'absence
 * d'e-mail finit par passer inaperçue — c'est la leçon déjà tirée sur les
 * alertes.
 */
async function envoyer(
  gabarit: string,
  adresses: string[],
  donnees: Record<string, any>
): Promise<void> {
  if (adresses.length === 0) return;

  let envoyes = 0;
  for (const adresse of adresses) {
    try {
      await sendEmail(gabarit, adresse, donnees);
      envoyes++;
    } catch (erreur: any) {
      if (/SMTP/i.test(erreur?.message ?? '')) {
        console.warn(
          `Manifestation : aucun e-mail envoyé — le serveur SMTP n'est pas configuré ` +
            `(Paramètres › SMTP). ${adresses.length} destinataire(s) concerné(s).`
        );
        return;
      }
      console.error(`Erreur envoi « ${gabarit} » à ${adresse} :`, erreur?.message ?? erreur);
    }
  }

  if (envoyes > 0) {
    await logService.info('email', `Manifestation : ${envoyes} message(s) « ${gabarit} » envoyé(s)`);
  }
}

/** Lance un envoi sans faire attendre l'appelant ni risquer de le faire échouer. */
function sansAttendre(action: () => Promise<void>, quoi: string): void {
  void action().catch((erreur) => {
    console.error(`Notification « ${quoi} » interrompue :`, erreur?.message ?? erreur);
  });
}

/**
 * Prévient les services qu'une manifestation attend leur approbation.
 *
 * `approbations` vient de `creerApprobationsManquantes` : seuls les services
 * **nouvellement** sollicités sont prévenus. Sans cela, corriger une faute de
 * frappe dans un titre relancerait tout le monde.
 */
export function notifierServicesConcernes(
  manifestationId: number | string,
  titre: string,
  approbations: Array<{ id: number; service: any }>
): void {
  if (approbations.length === 0) return;

  sansAttendre(async () => {
    const lien = `${await urlDuSite()}/manifestations?id=${manifestationId}`;

    for (const { service } of approbations) {
      // Le service qui a coupé les demandes ne doit pas en recevoir.
      if (!service.notify_new_request) continue;

      await envoyer('manifestation_approval_request', await destinatairesDuService(service.id), {
        manifestation_title: titre,
        service_name: service.name,
        manifestation_url: lien,
      });
    }

    notifierWebhooks('manifestation.approval_requested', {
      id: Number(manifestationId),
      title: titre,
      services: approbations.map((a) => a.service.name),
    });
  }, 'approbations demandées');
}

/** Prévient le destinataire d'une sollicitation créée à la main. */
export function notifierSollicitation(
  manifestationId: number | string,
  approbationId: number,
  titre: string
): void {
  sansAttendre(async () => {
    const sollicitation = await db.queryOne(
      `SELECT a.*, s.name as service_name, s.notify_new_request, u.email as user_email
       FROM manifestation_approvals a
       LEFT JOIN services s ON s.id = a.service_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`,
      [approbationId]
    );
    if (!sollicitation) return;

    const adresses = sollicitation.service_id
      ? sollicitation.notify_new_request
        ? await destinatairesDuService(sollicitation.service_id)
        : []
      : sollicitation.user_email
        ? [sollicitation.user_email]
        : [];

    const gabarit =
      sollicitation.kind === 'information'
        ? 'manifestation_information_request'
        : 'manifestation_approval_request';

    await envoyer(gabarit, adresses, {
      manifestation_title: titre,
      service_name: sollicitation.service_name || 'vous',
      comment: sollicitation.comment || '',
      manifestation_url: `${await urlDuSite()}/manifestations?id=${manifestationId}`,
    });
  }, 'sollicitation');
}

const LIBELLES_DECISION: Record<string, string> = {
  approved: 'a approuvé',
  rejected: 'a refusé',
  not_concerned: 'ne se déclare pas concerné par',
};

/** Annonce une décision à tous ceux qui suivent la manifestation. */
export function notifierDecision(
  manifestationId: number | string,
  titre: string,
  statut: string,
  serviceNom: string | null,
  commentaire: string | null
): void {
  sansAttendre(async () => {
    const adresses = await destinatairesManifestation(manifestationId, 'status_change');

    await envoyer('manifestation_decision', adresses, {
      manifestation_title: titre,
      service_name: serviceNom || 'Un service',
      decision: LIBELLES_DECISION[statut] ?? 'a répondu sur',
      comment: commentaire || '',
      manifestation_url: `${await urlDuSite()}/manifestations?id=${manifestationId}`,
    });

    notifierWebhooks('manifestation.approval_decided', {
      id: Number(manifestationId),
      title: titre,
      service: serviceNom,
      status: statut,
    });
  }, 'décision');
}

/** Relaie un message du fil à ceux qui suivent la manifestation. */
export function notifierMessage(
  manifestationId: number | string,
  titre: string,
  corps: string
): void {
  sansAttendre(async () => {
    const adresses = await destinatairesManifestation(manifestationId, 'message');

    await envoyer('manifestation_message', adresses, {
      manifestation_title: titre,
      message: corps,
      manifestation_url: `${await urlDuSite()}/manifestations?id=${manifestationId}`,
    });
  }, 'message');
}

/**
 * Signale un changement de date, qui est la modification qui coûte le plus cher.
 *
 * Un service qui a bloqué une équipe sur un créneau doit l'apprendre autrement
 * qu'en se déplaçant le mauvais jour.
 */
export function notifierChangementDates(
  manifestationId: number | string,
  titre: string,
  avant: { debut?: string | null; livraison?: string | null; recuperation?: string | null },
  apres: { debut?: string | null; livraison?: string | null; recuperation?: string | null }
): void {
  const changements: string[] = [];
  if (avant.debut !== apres.debut) changements.push(`date : ${avant.debut || '—'} → ${apres.debut || '—'}`);
  if (avant.livraison !== apres.livraison) {
    changements.push(`livraison : ${avant.livraison || '—'} → ${apres.livraison || '—'}`);
  }
  if (avant.recuperation !== apres.recuperation) {
    changements.push(`récupération : ${avant.recuperation || '—'} → ${apres.recuperation || '—'}`);
  }

  if (changements.length === 0) return;

  sansAttendre(async () => {
    const adresses = await destinatairesManifestation(manifestationId, 'status_change');

    await envoyer('manifestation_date_changed', adresses, {
      manifestation_title: titre,
      changes: changements.join(' ; '),
      manifestation_url: `${await urlDuSite()}/manifestations?id=${manifestationId}`,
    });

    notifierWebhooks('manifestation.dates_changed', {
      id: Number(manifestationId),
      title: titre,
      changes: changements,
    });
  }, 'changement de dates');
}

/** Signale un ajout ou un retrait de matériel aux services concernés. */
export function notifierChangementMateriel(
  manifestationId: number | string,
  titre: string,
  resume: string
): void {
  sansAttendre(async () => {
    const adresses = await destinatairesManifestation(manifestationId, 'material_change');

    await envoyer('manifestation_material_changed', adresses, {
      manifestation_title: titre,
      changes: resume,
      manifestation_url: `${await urlDuSite()}/manifestations?id=${manifestationId}`,
    });
  }, 'changement de matériel');
}

/**
 * Régénère et redépose le suivi partagé, sans faire attendre l'appelant.
 *
 * Appelée après un changement de statut ou de quantités. Le fichier déposé sur
 * Nextcloud n'a d'intérêt que s'il est à jour : tenu à la main, il était périmé
 * dès la première validation, et c'est le fichier périmé que tout le monde
 * continuait de lire.
 *
 * Les dépôts sont **regroupés** : dix changements en une minute — ce qui arrive
 * en saisissant les quantités livrées article par article — ne doivent produire
 * qu'un seul envoi, pas dix.
 */
let depotEnAttente: NodeJS.Timeout | null = null;
const DELAI_REGROUPEMENT_MS = 60_000;

export function redeposerSuivi(): void {
  if (depotEnAttente) return;

  depotEnAttente = setTimeout(() => {
    depotEnAttente = null;
    void (async () => {
      try {
        // Import différé : `cron.service` importe déjà ce module, et une
        // dépendance croisée au chargement laisserait l'un des deux vide.
        const { deposerExportsAutomatiques } = await import('./cron.service');
        await deposerExportsAutomatiques();
      } catch (erreur: any) {
        console.error('Redépôt du suivi interrompu :', erreur?.message ?? erreur);
      }
    })();
  }, DELAI_REGROUPEMENT_MS);

  // Le minuteur ne doit pas retenir le processus au moment de l'arrêt.
  depotEnAttente.unref?.();
}
