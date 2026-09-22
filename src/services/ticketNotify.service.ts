import { db } from '../database';
import { sendEmail } from './email.service';
import { logService } from './log.service';
import { notifierWebhooks } from './webhook.service';
import { destinatairesDuService } from './manifestationServices.service';
import {
  destinatairesParRole,
  filtrerSelonPreferences,
  servicesNotifies,
  type Destinataire,
} from './notificationPreferences.service';

/**
 * Notifications du module Tickets.
 *
 * Les deux règles du module Manifestations valent ici mot pour mot, et ce
 * fichier en est la reprise.
 *
 * **On n'écrit qu'aux concernés.** Le service technique ne reçoit rien d'une
 * demande de mot de passe. Un service qui reçoit des messages qui ne le
 * regardent pas cesse de les lire, et rate celui qui comptait.
 *
 * **Un envoi ne fait jamais échouer l'action qu'il annonce.** Un serveur SMTP
 * injoignable ne doit pas empêcher de résoudre une demande : tout part en
 * « tire-et-oublie ».
 *
 * ## Trois sources de destinataires, qui s'additionnent
 *
 *   1. **le socle** — le demandeur, le technicien, le service destinataire, les
 *      personnes désignées sur le bâtiment, et les observateurs. Ceux-là sont
 *      concernés par construction ;
 *   2. **la grille par rôle** — « tout superviseur reçoit les dépassements de
 *      délai », réglée dans l'écran des notifications ;
 *   3. **les règles de diffusion** — « une fuite à la mairie prévient aussi le
 *      responsable de la maintenance et l'élu chargé des travaux ».
 *
 * Elles s'ajoutent, elles ne se remplacent pas. Faire gagner la plus précise
 * retirerait le technicien attitré dès qu'une règle de bâtiment s'applique, et
 * personne ne comprendrait pourquoi. Les préférences de chacun s'appliquent
 * ensuite, sauf sur ce qui engage son destinataire.
 */

/** Adresse publique de l'application, pour les liens dans les courriels. */
async function urlDuSite(): Promise<string> {
  const reglage = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
  return reglage?.setting_value || process.env.SITE_URL || 'http://localhost:3001';
}

/** Lance un envoi sans faire attendre l'appelant ni risquer de le faire échouer. */
function sansAttendre(action: () => Promise<void>, quoi: string): void {
  void action().catch((erreur) => {
    console.error(`Notification « ${quoi} » interrompue :`, erreur?.message ?? erreur);
  });
}

/**
 * Envoie un gabarit à une liste d'adresses, sans jamais lever.
 *
 * Un SMTP non configuré est signalé **une seule fois** plutôt qu'une fois par
 * destinataire : répété, le message se noie dans le journal et l'absence
 * d'e-mail finit par passer inaperçue.
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
          `Demandes : aucun e-mail envoyé — le serveur SMTP n'est pas configuré ` +
            `(Paramètres › SMTP). ${adresses.length} destinataire(s) concerné(s).`
        );
        return;
      }
      console.error(`Erreur envoi « ${gabarit} » à ${adresse} :`, erreur?.message ?? erreur);
    }
  }

  if (envoyes > 0) {
    await logService.info('email', `Demandes : ${envoyes} message(s) « ${gabarit} » envoyé(s)`);
  }
}

// ------------------------------------------------------------- les concernés

/** Pourquoi cette personne reçoit — rendu tel quel par l'écran de simulation. */
export interface DestinataireMotive extends Destinataire {
  raison: string;
}

/**
 * Le socle : ceux qui sont concernés par construction.
 *
 * L'auteur de l'action en est **écarté**. Se faire notifier de son propre
 * message est le défaut le plus sûr pour qu'on cesse de lire ses courriels.
 */
async function socleDuTicket(
  ticket: any,
  auteurId: number | null,
  avecService: boolean
): Promise<DestinataireMotive[]> {
  const destinataires: DestinataireMotive[] = [];

  const ajouterCompte = async (userId: number | null, raison: string) => {
    if (!userId) return;
    const compte = await db.queryOne(
      'SELECT id, email, role FROM users WHERE id = ? AND is_active = 1 AND email IS NOT NULL',
      [userId]
    );
    // `can_login` n'est pas exigé : un demandeur peut être une fiche d'annuaire
    // à qui un agent a ouvert la demande. S'il a une adresse, il doit savoir où
    // en est ce qu'on a signalé pour lui.
    if (compte) destinataires.push({ email: compte.email, userId: compte.id, role: compte.role, raison });
  };

  await ajouterCompte(ticket.demandeur_id, 'demandeur');
  await ajouterCompte(ticket.technicien_id, 'technicien affecté');

  // Le service destinataire ne reçoit que si la grille le prévoit pour cet
  // événement : c'est le réglage « services concernés » de l'écran, et une
  // collectivité peut légitimement décider qu'un changement d'état ne vaut pas
  // un courriel à toute l'équipe.
  if (avecService && ticket.service_id) {
    for (const d of await destinatairesDuService(Number(ticket.service_id))) {
      destinataires.push({ ...d, raison: `service ${ticket.service_nom ?? 'destinataire'}` });
    }
  }

  /*
   * Ceux qu'on a désignés sur le bâtiment.
   *
   * Sur une école, la directrice et le responsable des écoles veulent être
   * prévenus ; l'élu, qui suit sans gérer, veut pouvoir regarder sans recevoir
   * un message à chaque ampoule grillée. `notifie` est donc **indépendant** de
   * `peut_voir_tickets` : les lier obligerait l'élu à choisir entre ne rien
   * voir et tout recevoir.
   *
   * Cela s'ajoute au technicien et au service de la catégorie, cela ne les
   * remplace pas.
   */
  if (ticket.site_id) {
    const { notifiesDuSite } = await import('./sites.service');
    for (const compte of await notifiesDuSite(Number(ticket.site_id))) {
      destinataires.push({
        email: compte.email,
        userId: Number(compte.id),
        role: compte.role,
        raison: `rattaché à ${ticket.site_nom ?? 'ce bâtiment'}`,
      });
    }
  }

  const observateurs = await db.query(
    `SELECT w.user_id, w.service_id FROM ticket_watchers w WHERE w.ticket_id = ?`,
    [ticket.id]
  );
  for (const observateur of observateurs) {
    if (observateur.user_id) await ajouterCompte(Number(observateur.user_id), 'en copie');
    if (observateur.service_id) {
      for (const d of await destinatairesDuService(Number(observateur.service_id))) {
        destinataires.push({ ...d, raison: 'service en copie' });
      }
    }
  }

  return destinataires.filter((d) => d.userId === undefined || d.userId !== auteurId);
}

/**
 * Les destinataires ajoutés par les règles de diffusion.
 *
 * Une seule requête. Chaque colonne de portée à `NULL` vaut « peu importe » :
 * c'est le motif standard, et il évite d'écrire une règle par combinaison.
 */
export async function destinatairesParRegles(
  ticket: any,
  evenement: string
): Promise<DestinataireMotive[]> {
  const regles = await db.query(
    `SELECT * FROM ticket_notification_regles
      WHERE is_active = 1
        AND (evenement IS NULL OR evenement = ?)
        AND (categorie_id IS NULL OR categorie_id = ?)
        AND (sous_categorie_id IS NULL OR sous_categorie_id = ?)
        AND (site_id IS NULL OR site_id = ?)
        AND (service_id IS NULL OR service_id = ?)`,
    [
      evenement,
      ticket.categorie_id ?? null,
      ticket.sous_categorie_id ?? null,
      ticket.site_id ?? null,
      ticket.service_id ?? null,
    ]
  );

  const destinataires: DestinataireMotive[] = [];

  for (const regle of regles) {
    const raison = regle.libelle || `règle n° ${regle.id}`;

    if (regle.destinataire_user_id) {
      // `can_login` n'est **pas** exigé : l'élu chargé des travaux figure à
      // l'annuaire sans compte depuis la migration 028, et c'est précisément
      // lui qu'on veut prévenir. Nommé par une règle, il n'a pas besoin d'un
      // lien pour comprendre qu'il y a une fuite à la mairie.
      const compte = await db.queryOne(
        'SELECT id, email, role FROM users WHERE id = ? AND is_active = 1 AND email IS NOT NULL',
        [regle.destinataire_user_id]
      );
      if (compte) destinataires.push({ email: compte.email, userId: compte.id, role: compte.role, raison });
      continue;
    }

    if (regle.destinataire_service_id) {
      for (const d of await destinatairesDuService(Number(regle.destinataire_service_id))) {
        destinataires.push({ ...d, raison });
      }
      continue;
    }

    if (regle.destinataire_role) {
      const comptes = await db.query(
        `SELECT id, email, role FROM users
          WHERE is_active = 1 AND can_login = 1 AND email IS NOT NULL AND role = ?`,
        [regle.destinataire_role]
      );
      for (const c of comptes) {
        destinataires.push({ email: c.email, userId: c.id, role: c.role, raison });
      }
    }
  }

  return destinataires;
}

/**
 * Tous les destinataires d'un événement, avec la raison de chacun.
 *
 * La raison n'est pas décorative : c'est elle qui rend l'écran de réglage
 * utilisable. Un administrateur compose « une fuite à la mairie », appuie sur
 * *Tester*, et lit qui recevrait et pourquoi — au lieu de découvrir l'effet de
 * ses règles sur une vraie demande, un mois plus tard.
 */
export async function destinatairesMotives(
  ticket: any,
  evenement: string,
  auteurId: number | null = null
): Promise<DestinataireMotive[]> {
  const avecService = await servicesNotifies(evenement);
  const tous: DestinataireMotive[] = [...(await socleDuTicket(ticket, auteurId, avecService))];

  for (const d of await destinatairesParRole(evenement)) {
    tous.push({ ...d, raison: `rôle ${d.role}` });
  }

  tous.push(...(await destinatairesParRegles(ticket, evenement)));

  // Première raison gagnante : « demandeur » est plus parlant que « règle n° 4 »
  // pour quelqu'un qui est les deux.
  const parAdresse = new Map<string, DestinataireMotive>();
  for (const d of tous) if (!parAdresse.has(d.email)) parAdresse.set(d.email, d);
  return [...parAdresse.values()];
}

// ------------------------------------------------------------------ l'envoi

/** Ce qu'un gabarit reçoit, quel que soit l'événement. */
async function donneesDuTicket(ticket: any): Promise<Record<string, any>> {
  const site = await urlDuSite();
  return {
    reference: ticket.reference ?? `#${ticket.id}`,
    titre: ticket.titre,
    description: ticket.description ?? '',
    statut: ticket.statut_nom ?? '',
    categorie: ticket.categorie_nom ?? '',
    sous_categorie: ticket.sous_categorie_nom ?? '',
    batiment: ticket.site_nom ?? '',
    service: ticket.service_nom ?? '',
    demandeur: [ticket.demandeur_prenom, ticket.demandeur_nom].filter(Boolean).join(' ').trim(),
    technicien: [ticket.technicien_prenom, ticket.technicien_nom].filter(Boolean).join(' ').trim(),
    materiel: ticket.objet_nom ?? '',
    lien: `${site}/tickets/${ticket.id}`,
  };
}

/**
 * Prévient les concernés d'un événement sur une demande.
 *
 * `donneesEnPlus` porte ce qui dépend de l'événement — le corps d'un message,
 * l'ancien statut. Le reste vient de la demande, une fois.
 */
async function notifier(
  ticketId: number,
  evenement: string,
  gabarit: string,
  auteurId: number | null,
  donneesEnPlus: Record<string, any> = {}
): Promise<void> {
  const ticket = await db.queryOne(
    `SELECT t.*, st.nom AS statut_nom, c.nom AS categorie_nom, sc.nom AS sous_categorie_nom,
            s.name AS site_nom, srv.name AS service_nom,
            d.first_name AS demandeur_prenom, d.last_name AS demandeur_nom,
            tech.first_name AS technicien_prenom, tech.last_name AS technicien_nom,
            o.name AS objet_nom
       FROM tickets t
       LEFT JOIN ticket_statuts st ON st.id = t.statut_id
       LEFT JOIN ticket_categories c ON c.id = t.categorie_id
       LEFT JOIN ticket_categories sc ON sc.id = t.sous_categorie_id
       LEFT JOIN cle_sites s ON s.id = t.site_id
       LEFT JOIN services srv ON srv.id = t.service_id
       LEFT JOIN users d ON d.id = t.demandeur_id
       LEFT JOIN users tech ON tech.id = t.technicien_id
       LEFT JOIN objects o ON o.id = t.object_id
      WHERE t.id = ?`,
    [ticketId]
  );
  if (!ticket) return;

  const motives = await destinatairesMotives(ticket, evenement, auteurId);
  const adresses = await filtrerSelonPreferences(motives, evenement);

  await envoyer(gabarit, adresses, { ...(await donneesDuTicket(ticket)), ...donneesEnPlus });

  // Miroir webhook, comme le fait le module Manifestations : un système tiers
  // doit pouvoir suivre sans qu'on lui écrive un connecteur.
  await notifierWebhooks(`ticket.${evenement.replace(/^ticket_/, '')}`, {
    id: ticket.id,
    reference: ticket.reference,
    titre: ticket.titre,
    statut: ticket.statut_nom,
    categorie: ticket.categorie_nom,
    batiment: ticket.site_nom,
  });
}

// ------------------------------------------------------- l'API du module

export function notifierOuverture(ticketId: number, auteurId: number | null): void {
  sansAttendre(() => notifier(ticketId, 'ticket_nouveau', 'ticket_nouveau', auteurId), 'demande ouverte');
}

export function notifierAffectation(ticketId: number, auteurId: number | null): void {
  sansAttendre(
    () => notifier(ticketId, 'ticket_assigne', 'ticket_assigne', auteurId),
    'demande confiée'
  );
}

export function notifierMessage(
  ticketId: number,
  auteurId: number | null,
  corps: string,
  interne: boolean
): void {
  // Une note interne ne part **pas** : son objet est justement de rester entre
  // intervenants, et un courriel la mettrait sous les yeux du demandeur.
  if (interne) return;
  sansAttendre(
    () => notifier(ticketId, 'ticket_message', 'ticket_message', auteurId, { message: corps }),
    'message de demande'
  );
}

export function notifierStatut(
  ticketId: number,
  auteurId: number | null,
  ancien: string | null,
  nouveau: string,
  final: boolean
): void {
  const evenement = final ? 'ticket_resolu' : 'ticket_statut';
  sansAttendre(
    () => notifier(ticketId, evenement, evenement, auteurId, { ancien_statut: ancien ?? '' }),
    'changement d’état'
  );
}

export function notifierEcheance(ticketId: number, quoi: 'prise_en_charge' | 'resolution'): void {
  sansAttendre(
    () =>
      notifier(ticketId, 'ticket_echeance', 'ticket_echeance', null, {
        echeance: quoi === 'resolution' ? 'de résolution' : 'de prise en charge',
      }),
    'délai dépassé'
  );
}

/**
 * Ce que produiraient les règles, sans rien envoyer.
 *
 * Alimente le bouton *Tester* de l'écran de réglage. Le calcul est celui de
 * l'envoi réel — on lui demande seulement de rendre la provenance au lieu de
 * l'effacer.
 */
export async function simulerDestinataires(
  portee: {
    evenement: string;
    categorieId?: number | null;
    sousCategorieId?: number | null;
    siteId?: number | null;
    serviceId?: number | null;
  }
): Promise<DestinataireMotive[]> {
  const fictif = {
    id: 0,
    categorie_id: portee.categorieId ?? null,
    sous_categorie_id: portee.sousCategorieId ?? null,
    site_id: portee.siteId ?? null,
    service_id: portee.serviceId ?? null,
    demandeur_id: null,
    technicien_id: null,
  };

  const motives = await destinatairesMotives(fictif, portee.evenement, null);
  const retenus = new Set(await filtrerSelonPreferences(motives, portee.evenement));
  return motives.filter((d) => retenus.has(d.email));
}
