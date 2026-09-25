import { db } from '../database';
import { sendEmail } from './email.service';
import {
  destinatairesBatiment,
  jourFrancais,
  lireDocument,
  type EtatSuivi,
} from './batiments.service';
import type { Contrat } from './contratsBatiments.service';

/**
 * Les courriels du module Bâtiments.
 *
 * À part du service, comme `ticketNotify.service.ts` : le service se teste sans
 * serveur de courrier, et un envoi qui échoue ne doit jamais faire échouer ce
 * qui l'a déclenché. Un dépôt reste enregistré même si personne n'a pu en être
 * averti — il attend dans la file « À valider », qui ne dépend pas du courrier.
 *
 * Les liens sont relatifs à `site_url`, que `sendEmail` fournit à chaque modèle.
 */

/** Un document attend d'être relu : on prévient qui gère le bâtiment. */
export async function notifierDepot(documentId: number): Promise<void> {
  try {
    const document = await lireDocument(documentId);
    if (!document) return;
    const destinataires = await destinatairesBatiment(document.siteId);
    if (destinataires.length === 0) return;

    await sendEmail('batiment_document_depose', destinataires.join(', '), {
      site_nom: document.siteNom,
      titre: document.titre,
      rubrique: document.rubriqueLibelle ?? 'Non classé',
      depose_par: document.entreprise?.nom ?? document.deposePar?.nom ?? 'Un déposant',
      date_document: jourFrancais(document.dateDocument),
      commentaire: document.commentaireDepot ?? '',
      chemin: 'batiments/a-valider',
    });
  } catch (erreur) {
    console.error('Avis de dépôt non envoyé :', (erreur as Error).message);
  }
}

/** Un document est refusé : on le dit à qui l'a déposé, avec le motif. */
export async function notifierRefus(documentId: number): Promise<void> {
  try {
    const document = await lireDocument(documentId);
    if (!document) return;

    // Une entreprise : son adresse et celles de ses contacts qui reçoivent l'accès.
    if (document.entreprise) {
      const destinataires = await adressesEntreprise(document.entreprise.id);
      if (destinataires.length === 0) return;
      await sendEmail('batiment_document_refuse', destinataires.join(', '), {
        first_name: document.entreprise.nom,
        site_nom: document.siteNom,
        titre: document.titre,
        motif: document.motifRefus ?? '',
      });
      return;
    }

    if (!document.deposePar) return;
    const auteur = await db.queryOne(
      'SELECT email, first_name FROM users WHERE id = ? AND is_active = 1 AND email IS NOT NULL',
      [document.deposePar.id]
    );
    if (!auteur) return;

    await sendEmail('batiment_document_refuse', auteur.email, {
      first_name: auteur.first_name ?? '',
      site_nom: document.siteNom,
      titre: document.titre,
      motif: document.motifRefus ?? '',
    });
  } catch (erreur) {
    console.error('Avis de refus non envoyé :', (erreur as Error).message);
  }
}

/**
 * L'adresse d'une entreprise, et celles de ses contacts qui reçoivent l'accès.
 * Dédoublonnées sans casse : le gérant est souvent aussi le contact principal.
 */
export async function adressesEntreprise(entrepriseId: number): Promise<string[]> {
  const entreprise = await db.queryOne('SELECT email FROM entreprises WHERE id = ?', [entrepriseId]);
  if (!entreprise) return [];
  const contacts = await db.query(
    "SELECT email FROM entreprise_contacts WHERE entreprise_id = ? AND recoit_acces = 1 AND email IS NOT NULL AND email <> ''",
    [entrepriseId]
  );
  const vues = new Map<string, string>();
  for (const adresse of [entreprise.email, ...contacts.map((c: any) => c.email)]) {
    const propre = String(adresse ?? '').trim();
    if (propre && !vues.has(propre.toLowerCase())) vues.set(propre.toLowerCase(), propre);
  }
  return [...vues.values()];
}

/**
 * Un contrat approche de sa date de préavis, ou de sa fin. Tous les bâtiments
 * qu'il couvre sont prévenus, sans doublon : le gestionnaire de trois écoles
 * reçoit un seul courriel.
 */
export async function notifierContrat(contrat: Contrat): Promise<void> {
  try {
    const vues = new Map<string, string>();
    for (const site of contrat.sites) {
      for (const adresse of await destinatairesBatiment(site.id)) {
        if (!vues.has(adresse.toLowerCase())) vues.set(adresse.toLowerCase(), adresse);
      }
    }
    if (vues.size === 0) return;

    await sendEmail('batiment_contrat', [...vues.values()].join(', '), {
      objet: contrat.objet,
      reference: contrat.reference ?? '',
      entreprise: contrat.entreprise?.nom ?? '',
      sites: contrat.sites.map((s) => s.nom).join(', '),
      tacite: contrat.reconductionTacite,
      fin: jourFrancais(contrat.etat.finEnCours),
      date_cle: jourFrancais(contrat.etat.dateCle),
      chemin: `batiments/${contrat.sites[0]?.id ?? ''}?onglet=contrats&contrat=${contrat.id}`,
    });
  } catch (erreur) {
    console.error('Avis de contrat non envoyé :', (erreur as Error).message);
  }
}

/** Une échéance entre dans son délai de rappel, ou vient de passer. */
export async function notifierEcheance(etat: EtatSuivi): Promise<void> {
  try {
    const destinataires = await destinatairesBatiment(etat.siteId);
    if (destinataires.length === 0) return;

    await sendEmail('batiment_echeance', destinataires.join(', '), {
      site_nom: etat.siteNom,
      rubrique: etat.rubriqueLibelle,
      libelle: etat.libelle ?? '',
      echeance: jourFrancais(etat.echeance),
      en_retard: etat.enRetard,
      derniere_realisation: jourFrancais(etat.dernierDocument?.date ?? null),
      chemin: `batiments/${etat.siteId}?onglet=controles`,
    });
  } catch (erreur) {
    console.error("Avis d'échéance non envoyé :", (erreur as Error).message);
  }
}
