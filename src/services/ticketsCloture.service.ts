import { db } from '../database';
import {
  creerTache,
  listerTaches,
  modifierTache,
  resoudreCategorie,
  SaisieInvalide as SaisiePlanningInvalide,
  verifierSaisie,
  type ParticipantSaisi,
  type Tache,
  type TacheSaisie,
} from './plannings.service';
import { ajouterMessage, changerStatut, SaisieInvalide, tracer } from './tickets.service';
import type { DroitsTicket } from '../middleware/ticketScope';
import {
  lireStatut,
  statutReprise,
  statutResolution,
  statutValidation,
  type Statut,
} from './ticketsReferentiel.service';

/**
 * Clore une demande en disant ce qu'elle a coûté.
 *
 * « Le technicien valide le ticket, met le temps passé et s'il a été aidé,
 * comme sur le planning, et ainsi le synchronise avec le planning. » Le temps
 * n'est donc pas un champ de la demande : clore crée une **tâche de planning**
 * liée, avec ses renforts, par les fonctions mêmes du module Plannings. Les
 * règles d'une saisie d'heures — un renfort est une personne ou un libellé, le
 * titulaire n'est pas son propre renfort, une durée tient dans une journée —
 * s'appliquent sans avoir été recopiées.
 *
 * ## Autonome, ou « À valider »
 *
 * Un agent autonome sur la catégorie clôt pour de bon. Sinon la demande passe
 * « À valider » : son superviseur relit la tâche, corrige au besoin la durée et
 * les personnes qui ont travaillé, puis valide — ou renvoie la demande à l'agent
 * avec un motif. Le renvoi laisse la tâche au planning : ce temps a été passé ;
 * la clôture suivante en créera une autre, et le total de la demande les
 * additionne.
 *
 * ## Tout ou rien
 *
 * La tâche, l'affectation, le message et le changement d'état s'écrivent dans
 * une seule transaction. Tout ce qui peut refuser — la saisie, les statuts —
 * est vérifié **avant** de l'ouvrir : sur SQLite, une transaction ouverte
 * sérialise l'écriture, et elle doit rester courte.
 */

/**
 * Pourquoi ce changement d'état est refusé à ce lecteur ; `null` s'il est permis.
 *
 * Le sélecteur d'état reste l'outil du quotidien — « en cours », « en attente
 * de retour » — mais ne permet plus de contourner la clôture :
 *
 *   - « À valider » ne se choisit pas : on y arrive par *Terminer*, qui porte
 *     le temps passé ;
 *   - une demande « À valider » n'appartient plus qu'à son superviseur ;
 *   - résoudre sans dire le temps passé — un doublon, une demande sans objet —
 *     est un geste de superviseur ;
 *   - refuser, ou tout autre état final, demande d'être autonome.
 */
export function refusChangementStatut(
  droits: Pick<DroitsTicket, 'peutChangerStatut' | 'superviseur' | 'autonome' | 'peutValider'>,
  actuel: Statut | null,
  cible: Statut
): string | null {
  if (!droits.peutChangerStatut) return 'Seuls les intervenants changent le statut d’une demande';
  if (cible.validation) {
    return 'Pour soumettre une demande à validation, passez par « Terminer » : le temps passé l’accompagne';
  }
  if (actuel?.validation && !droits.peutValider) return 'Cette clôture attend la validation de son superviseur';
  if (cible.final && cible.systeme && !droits.superviseur) {
    return 'Clôturez par « Terminer », en indiquant le temps passé';
  }
  if (cible.final && !droits.superviseur && !droits.autonome) {
    return 'Votre clôture passe par la validation de votre superviseur : utilisez « Terminer »';
  }
  return null;
}

/** Ce que l'agent dit de son intervention. */
export interface SaisieCloture {
  jour: string;
  heureDebut?: string | null;
  heureFin?: string | null;
  minutes?: number | null;
  participants?: ParticipantSaisi[];
  /** Catégorie du planning ; à défaut, celle qui porte le nom de la catégorie de la demande. */
  categorieId?: number | null;
  /** Au nom de qui le temps est saisi — un superviseur pour son agent ; l'auteur sinon. */
  titulaireId?: number | null;
  commentaire?: string | null;
}

export interface Auteur {
  id: number;
  /** Peut saisir au nom d'un autre, et valider. */
  superviseur: boolean;
  /** Sa clôture est définitive. */
  autonome: boolean;
}

/** Les erreurs du planning, rendues avec la classe que les routes des demandes savent traduire. */
function verifierTache(saisie: TacheSaisie): void {
  try {
    verifierSaisie(saisie);
  } catch (erreur: any) {
    if (erreur instanceof SaisiePlanningInvalide) throw new SaisieInvalide(erreur.message);
    throw erreur;
  }
}

async function lireLigne(ticketId: number): Promise<any> {
  const ticket = await db.queryOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket) throw new SaisieInvalide('Demande introuvable');
  return ticket;
}

/**
 * La catégorie de planning d'une demande : celle qui porte le nom de sa
 * catégorie racine, créée au besoin.
 *
 * C'est ce qui fait apparaître « Bâtiment », « Voirie », « Espaces verts » dans
 * les rapports d'heures sans que personne ait à les créer deux fois.
 */
async function categoriePlanningDe(ticket: any, auteurId: number): Promise<number | null> {
  const id = ticket.categorie_id ?? ticket.sous_categorie_id;
  if (!id) return null;
  const categorie = await db.queryOne(
    `SELECT COALESCE(p.nom, c.nom) AS nom
       FROM ticket_categories c
       LEFT JOIN ticket_categories p ON p.id = c.parent_id
      WHERE c.id = ?`,
    [id]
  );
  if (!categorie?.nom) return null;
  return (await resoudreCategorie(categorie.nom, auteurId)).id;
}

function descriptionDe(ticket: any): string {
  return [ticket.reference, ticket.titre].filter(Boolean).join(' — ');
}

/**
 * L'agent a fini : la tâche part au planning, la demande est résolue — ou
 * attend son superviseur.
 */
export async function terminerTicket(
  ticketId: number,
  saisie: SaisieCloture,
  auteur: Auteur
): Promise<{ statut: Statut; tacheId: number }> {
  const ticket = await lireLigne(ticketId);
  const actuel = await lireStatut(ticket.statut_id);
  if (actuel?.final) throw new SaisieInvalide('Cette demande est déjà close');
  if (actuel?.validation) throw new SaisieInvalide('Cette demande attend déjà sa validation');

  const cible = auteur.autonome ? await statutResolution() : await statutValidation();
  if (!cible) {
    throw new SaisieInvalide(
      auteur.autonome
        ? 'Aucun statut de résolution n’est configuré : voir Paramètres › Tickets'
        : 'Le statut « À valider » est introuvable : voir Paramètres › Tickets'
    );
  }

  // Saisir au nom d'un autre est un geste d'encadrant, comme au planning.
  const titulaireId =
    auteur.superviseur && saisie.titulaireId ? Number(saisie.titulaireId) : auteur.id;

  const tache: TacheSaisie = {
    userId: titulaireId,
    jour: saisie.jour,
    heureDebut: saisie.heureDebut ?? null,
    heureFin: saisie.heureFin ?? null,
    minutes: saisie.minutes ?? null,
    participants: saisie.participants ?? [],
    ticketId,
    categorieId: saisie.categorieId ?? (await categoriePlanningDe(ticket, auteur.id)),
    description: descriptionDe(ticket),
  };
  verifierTache(tache);

  const commentaire = String(saisie.commentaire ?? '').trim();

  const tacheId = await db.transaction(async () => {
    const id = await creerTache(tache, auteur.id);

    await db.execute(
      'UPDATE tickets SET tache_cloture_id = ?, technicien_id = COALESCE(technicien_id, ?) WHERE id = ?',
      [id, titulaireId, ticketId]
    );
    if (!ticket.technicien_id) {
      await tracer(ticketId, auteur.id, 'modification', 'technicien', null, String(titulaireId));
    }

    if (commentaire) await ajouterMessage(ticketId, { body: commentaire }, auteur.id);
    await changerStatut(ticketId, cible.id, auteur.id);
    return id;
  });

  return { statut: cible, tacheId };
}

/** Ce que le superviseur corrige avant de valider. */
export interface CorrectionsCloture {
  jour: string;
  heureDebut?: string | null;
  heureFin?: string | null;
  minutes?: number | null;
  participants?: ParticipantSaisi[];
  titulaireId?: number | null;
}

/**
 * Le superviseur valide — après avoir corrigé, s'il le faut, le temps et les
 * personnes qui ont travaillé.
 *
 * La correction modifie la tâche de la clôture **en place** : c'est la même
 * intervention, et la dupliquer compterait deux fois les heures. Si la tâche a
 * disparu du planning entre-temps, on la recrée plutôt que de refuser : la
 * validation dit précisément ce temps-là.
 *
 * L'autorité est celle de la catégorie : le superviseur n'a pas à encadrer
 * l'agent au planning pour corriger la tâche d'une demande qu'il supervise.
 */
export async function validerTicket(
  ticketId: number,
  corrections: CorrectionsCloture | null,
  commentaire: string | null,
  auteurId: number
): Promise<Statut> {
  const ticket = await lireLigne(ticketId);
  const actuel = await lireStatut(ticket.statut_id);
  if (!actuel?.validation) throw new SaisieInvalide('Cette demande n’attend pas de validation');

  const cible = await statutResolution();
  if (!cible) throw new SaisieInvalide('Aucun statut de résolution n’est configuré : voir Paramètres › Tickets');

  const existante = ticket.tache_cloture_id
    ? await db.queryOne('SELECT * FROM planning_taches WHERE id = ?', [ticket.tache_cloture_id])
    : null;

  let tache: TacheSaisie | null = null;
  if (corrections) {
    const titulaireId = Number(
      corrections.titulaireId ?? existante?.user_id ?? ticket.technicien_id ?? auteurId
    );
    tache = {
      userId: titulaireId,
      jour: corrections.jour,
      heureDebut: corrections.heureDebut ?? null,
      heureFin: corrections.heureFin ?? null,
      minutes: corrections.minutes ?? null,
      participants: corrections.participants ?? [],
      ticketId,
      categorieId: existante?.categorie_id ?? (await categoriePlanningDe(ticket, auteurId)),
      manifestationId: existante?.manifestation_id ?? null,
      description: existante?.description ?? descriptionDe(ticket),
    };
    verifierTache(tache);
  }

  const texte = String(commentaire ?? '').trim();

  await db.transaction(async () => {
    if (tache) {
      if (existante) {
        await modifierTache(Number(existante.id), tache);
      } else {
        const id = await creerTache(tache, auteurId);
        await db.execute('UPDATE tickets SET tache_cloture_id = ? WHERE id = ?', [id, ticketId]);
      }
      await tracer(ticketId, auteurId, 'modification', 'temps passé', null, 'corrigé à la validation');
    }
    if (texte) await ajouterMessage(ticketId, { body: texte }, auteurId);
    await changerStatut(ticketId, cible.id, auteurId);
  });

  return cible;
}

/** Le superviseur renvoie la demande à l'agent, en disant pourquoi. */
export async function renvoyerTicket(ticketId: number, motif: string, auteurId: number): Promise<Statut> {
  const texte = String(motif ?? '').trim();
  if (!texte) throw new SaisieInvalide('Dites à l’agent ce qui reste à faire');

  const ticket = await lireLigne(ticketId);
  const actuel = await lireStatut(ticket.statut_id);
  if (!actuel?.validation) throw new SaisieInvalide('Cette demande n’attend pas de validation');

  const cible = await statutReprise();
  if (!cible) throw new SaisieInvalide('Aucun statut ouvert n’est configuré : voir Paramètres › Tickets');

  await db.transaction(async () => {
    await ajouterMessage(ticketId, { body: texte }, auteurId);
    await changerStatut(ticketId, cible.id, auteurId);
  });
  return cible;
}

/**
 * Le temps passé sur une demande : la tâche de la dernière clôture, et toutes
 * celles qui la citent — les passages précédents, les saisies faites depuis le
 * planning.
 */
export async function lireCloture(ticketId: number): Promise<{
  tacheCloture: Tache | null;
  taches: Tache[];
  minutes: number;
}> {
  const ticket = await lireLigne(ticketId);
  const taches = await listerTaches(
    { debut: '0000-01-01', fin: '9999-12-31', ticketId },
    { tout: true, personnes: [] }
  );
  const tacheCloture = taches.find((t) => t.id === Number(ticket.tache_cloture_id)) ?? null;
  return {
    tacheCloture,
    taches,
    minutes: taches.reduce((total, t) => total + Number(t.minutesMobilisees ?? t.minutes ?? 0), 0),
  };
}
