import { db } from '../database';
import { decalerJours, decalerMois, jourCourant, nombreDeJours, versJour } from '../utils/periodes';
import { ErreurBatiment, identifiant, jourOuNull, REFERENCE_ALERTE_CONTRAT, texte } from './batiments.service';
import { versDateTime } from './tickets.service';

export { REFERENCE_ALERTE_CONTRAT };

/**
 * Les contrats de maintenance : ascenseurs, chaudières, portes automatiques.
 *
 * ## La date qu'on oublie
 *
 * Un contrat à **reconduction tacite** se renouvelle seul, pour un an, si
 * personne ne le dénonce avant son préavis. La date qui compte n'est donc pas
 * sa fin, mais la veille de son préavis : c'est elle que `etatContrat` calcule
 * et que le cron rappelle un mois avant. Passée, le contrat court une année de
 * plus, et l'échéance suivante prend le relais.
 *
 * Un contrat **sans reconduction** se termine à sa date : on rappelle sa fin,
 * pour relancer une consultation à temps.
 *
 * ## Plusieurs bâtiments
 *
 * Un marché d'entretien des ascenseurs couvre les trois bâtiments qui en ont.
 * On le gère si l'on gère **tous** ses bâtiments ; on le voit si l'on en suit
 * **un**.
 */

/** Combien de jours avant la date clé le rappel se lève. */
export const RAPPEL_CONTRAT_JOURS = 30;

export type StatutContrat = 'actif' | 'a_resilier' | 'se_termine' | 'echu' | 'sans_fin' | 'inactif';

export interface EtatContrat {
  /** La fin de la période en cours — reconduite d'année en année si tacite. */
  finEnCours: string | null;
  /** Dernier jour pour dénoncer un contrat tacite ; sa fin pour un contrat ferme. */
  dateCle: string | null;
  joursAvantDateCle: number | null;
  statut: StatutContrat;
}

export interface Contrat {
  id: number;
  objet: string;
  entreprise: { id: number; nom: string } | null;
  reference: string | null;
  dateDebut: string;
  dateFin: string | null;
  reconductionTacite: boolean;
  preavisJours: number;
  montantAnnuelHt: number | null;
  montantAnnuelTtc: number | null;
  document: { id: number; titre: string } | null;
  notes: string | null;
  actif: boolean;
  sites: { id: number; nom: string }[];
  etat: EtatContrat;
}

const nombreOuNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const vrai = (v: unknown): boolean => v === true || v === 'true' || Number(v ?? 0) === 1;

/**
 * Où en est un contrat aujourd'hui.
 *
 * `aujourdhui` est un paramètre pour que les tests fixent le calendrier.
 */
export function etatContrat(
  c: { dateFin: string | null; reconductionTacite: boolean; preavisJours: number; actif: boolean },
  aujourdhui = jourCourant()
): EtatContrat {
  if (!c.actif) return { finEnCours: c.dateFin, dateCle: null, joursAvantDateCle: null, statut: 'inactif' };
  if (!c.dateFin) return { finEnCours: null, dateCle: null, joursAvantDateCle: null, statut: 'sans_fin' };

  let fin = c.dateFin;
  if (c.reconductionTacite) {
    // Reconduit d'année en année : la période en cours est la première qui
    // n'est pas encore finie. Borné, pour qu'une date aberrante ne boucle pas.
    for (let i = 0; i < 200 && fin < aujourdhui; i++) fin = decalerMois(fin, 12);
  }

  const dateCle = c.reconductionTacite ? decalerJours(fin, -c.preavisJours) : fin;
  const jours = nombreDeJours({ debut: aujourdhui, fin: dateCle }) - 1;

  let statut: StatutContrat;
  if (!c.reconductionTacite && fin < aujourdhui) statut = 'echu';
  else if (jours <= RAPPEL_CONTRAT_JOURS && jours >= 0) statut = c.reconductionTacite ? 'a_resilier' : 'se_termine';
  else statut = 'actif';

  return { finEnCours: fin, dateCle, joursAvantDateCle: jours, statut };
}

const SELECT_CONTRAT = `SELECT c.*, e.nom AS entreprise_nom, d.titre AS document_titre
  FROM batiment_contrats c
  LEFT JOIN entreprises e ON e.id = c.entreprise_id
  LEFT JOIN batiment_documents d ON d.id = c.document_id`;

async function enContrats(lignes: any[], aujourdhui = jourCourant()): Promise<Contrat[]> {
  if (lignes.length === 0) return [];
  const ids = lignes.map((l) => Number(l.id));
  const liens = await db.query(
    `SELECT cs.contrat_id, s.id, s.name FROM batiment_contrat_sites cs JOIN cle_sites s ON s.id = cs.site_id
      WHERE cs.contrat_id IN (${ids.map(() => '?').join(', ')}) ORDER BY s.name`,
    ids
  );
  return lignes.map((l) => {
    const base = {
      dateFin: l.date_fin ? versJour(l.date_fin) : null,
      reconductionTacite: vrai(l.reconduction_tacite),
      preavisJours: Number(l.preavis_jours ?? 0),
      actif: vrai(l.actif),
    };
    return {
      id: Number(l.id),
      objet: l.objet,
      entreprise: l.entreprise_id ? { id: Number(l.entreprise_id), nom: l.entreprise_nom ?? '' } : null,
      reference: l.reference ?? null,
      dateDebut: versJour(l.date_debut),
      ...base,
      montantAnnuelHt: nombreOuNull(l.montant_annuel_ht),
      montantAnnuelTtc: nombreOuNull(l.montant_annuel_ttc),
      document: l.document_id ? { id: Number(l.document_id), titre: l.document_titre ?? 'Document' } : null,
      notes: l.notes ?? null,
      sites: liens
        .filter((x: any) => Number(x.contrat_id) === Number(l.id))
        .map((x: any) => ({ id: Number(x.id), nom: x.name })),
      etat: etatContrat(base, aujourdhui),
    };
  });
}

/** Les contrats qui touchent au moins un de ces bâtiments ; `null` : tous. */
export async function listerContrats(siteIds: number[] | null, aujourdhui = jourCourant()): Promise<Contrat[]> {
  if (siteIds && siteIds.length === 0) return [];
  const lignes = await db.query(
    `${SELECT_CONTRAT}
      ${siteIds ? `WHERE c.id IN (SELECT contrat_id FROM batiment_contrat_sites WHERE site_id IN (${siteIds.map(() => '?').join(', ')}))` : ''}
      ORDER BY c.actif DESC, c.objet`,
    siteIds ?? []
  );
  return enContrats(lignes, aujourdhui);
}

export async function lireContrat(id: number | string): Promise<Contrat | null> {
  const ligne = await db.queryOne(`${SELECT_CONTRAT} WHERE c.id = ?`, [id]);
  return ligne ? (await enContrats([ligne]))[0] : null;
}

export async function sitesDuContrat(id: number | string): Promise<number[]> {
  return (await db.query('SELECT site_id FROM batiment_contrat_sites WHERE contrat_id = ?', [id])).map((l: any) => Number(l.site_id));
}

export interface ContratSaisie {
  objet?: unknown;
  entrepriseId?: unknown;
  reference?: unknown;
  dateDebut?: unknown;
  dateFin?: unknown;
  reconductionTacite?: unknown;
  preavisJours?: unknown;
  montantAnnuelHt?: unknown;
  montantAnnuelTtc?: unknown;
  documentId?: unknown;
  notes?: unknown;
  actif?: unknown;
  siteIds?: unknown;
}

function lireMontant(valeur: unknown, champ: string): number | null {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const n = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new ErreurBatiment(400, `${champ} : montant invalide`);
  return Math.round(n * 100) / 100;
}

/** Les bâtiments du contrat, vérifiés : au moins un, tous existants. */
export async function lireSitesDuContrat(valeur: unknown): Promise<number[]> {
  const ids = [...new Set((Array.isArray(valeur) ? valeur : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw new ErreurBatiment(400, 'Un contrat couvre au moins un bâtiment');
  const connus = await db.query(`SELECT id FROM cle_sites WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  if (connus.length !== ids.length) throw new ErreurBatiment(400, 'Bâtiment inconnu');
  return ids;
}

async function lireChamps(saisie: ContratSaisie, siteIds: number[], existant?: any) {
  const v = <K extends keyof ContratSaisie>(cle: K, colonne: string) => (saisie[cle] !== undefined ? saisie[cle] : existant?.[colonne]);
  const objet = texte(v('objet', 'objet'));
  if (!objet) throw new ErreurBatiment(400, "L'objet du contrat est obligatoire");
  const dateDebut = jourOuNull(v('dateDebut', 'date_debut'), 'Début du contrat');
  if (!dateDebut) throw new ErreurBatiment(400, 'La date de début est obligatoire');
  const dateFin = jourOuNull(v('dateFin', 'date_fin'), 'Fin du contrat');
  if (dateFin && dateFin < dateDebut) throw new ErreurBatiment(400, 'Le contrat se termine avant de commencer');
  const preavis = Number(v('preavisJours', 'preavis_jours') ?? 90);
  if (!Number.isInteger(preavis) || preavis < 0 || preavis > 730) throw new ErreurBatiment(400, 'Préavis : un nombre de jours entre 0 et 730');

  const entrepriseId = identifiant(v('entrepriseId', 'entreprise_id'));
  if (entrepriseId && !(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [entrepriseId]))) {
    throw new ErreurBatiment(400, 'Entreprise inconnue');
  }
  const documentId = identifiant(v('documentId', 'document_id'));
  if (documentId) {
    // Le document doit venir d'un des bâtiments du contrat : sinon, on lirait
    // par le contrat le dossier d'un bâtiment qu'on ne suit pas.
    const doc = await db.queryOne('SELECT site_id FROM batiment_documents WHERE id = ?', [documentId]);
    if (!doc || !siteIds.includes(Number(doc.site_id))) throw new ErreurBatiment(400, "Ce document n'est pas dans un des bâtiments du contrat");
  }

  return {
    objet,
    entrepriseId,
    reference: texte(v('reference', 'reference'), 100),
    dateDebut,
    dateFin,
    reconductionTacite: vrai(v('reconductionTacite', 'reconduction_tacite')) ? 1 : 0,
    preavis,
    montantHt: lireMontant(v('montantAnnuelHt', 'montant_annuel_ht'), 'Montant annuel HT'),
    montantTtc: lireMontant(v('montantAnnuelTtc', 'montant_annuel_ttc'), 'Montant annuel TTC'),
    documentId,
    notes: texte(v('notes', 'notes'), 5000),
    actif: saisie.actif === undefined ? (existant ? (vrai(existant.actif) ? 1 : 0) : 1) : vrai(saisie.actif) ? 1 : 0,
  };
}

async function relierSites(contratId: number, siteIds: number[]): Promise<void> {
  await db.execute('DELETE FROM batiment_contrat_sites WHERE contrat_id = ?', [contratId]);
  for (const siteId of siteIds) {
    await db.execute('INSERT INTO batiment_contrat_sites (contrat_id, site_id) VALUES (?, ?)', [contratId, siteId]);
  }
}

export async function creerContrat(saisie: ContratSaisie, userId: number): Promise<number> {
  const siteIds = await lireSitesDuContrat(saisie.siteIds);
  const c = await lireChamps(saisie, siteIds);
  const maintenant = versDateTime();
  let id = 0;
  await db.transaction(async () => {
    const r = await db.execute(
      `INSERT INTO batiment_contrats
         (objet, entreprise_id, reference, date_debut, date_fin, reconduction_tacite, preavis_jours,
          montant_annuel_ht, montant_annuel_ttc, document_id, notes, actif, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.objet, c.entrepriseId, c.reference, c.dateDebut, c.dateFin, c.reconductionTacite, c.preavis,
       c.montantHt, c.montantTtc, c.documentId, c.notes, c.actif, userId, maintenant, maintenant]
    );
    id = Number(r.lastInsertRowid);
    await relierSites(id, siteIds);
  });
  return id;
}

export async function modifierContrat(id: number, saisie: ContratSaisie): Promise<void> {
  const existant = await db.queryOne('SELECT * FROM batiment_contrats WHERE id = ?', [id]);
  if (!existant) throw new ErreurBatiment(404, 'Contrat introuvable');
  const siteIds = saisie.siteIds !== undefined ? await lireSitesDuContrat(saisie.siteIds) : null;
  const c = await lireChamps(saisie, siteIds ?? (await sitesDuContrat(id)), existant);
  await db.transaction(async () => {
    await db.execute(
      `UPDATE batiment_contrats
          SET objet = ?, entreprise_id = ?, reference = ?, date_debut = ?, date_fin = ?, reconduction_tacite = ?,
              preavis_jours = ?, montant_annuel_ht = ?, montant_annuel_ttc = ?, document_id = ?, notes = ?,
              actif = ?, updated_at = ?
        WHERE id = ?`,
      [c.objet, c.entrepriseId, c.reference, c.dateDebut, c.dateFin, c.reconductionTacite, c.preavis,
       c.montantHt, c.montantTtc, c.documentId, c.notes, c.actif, versDateTime(), id]
    );
    if (siteIds) await relierSites(id, siteIds);
  });
  // L'échéance a pu changer : l'alerte sera reposée, juste, au passage suivant.
  await db.execute('DELETE FROM alerts WHERE plugin_reference = ? AND plugin_reference_id = ?', [REFERENCE_ALERTE_CONTRAT, id]);
}

export async function supprimerContrat(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_contrats WHERE id = ?', [id]);
  await db.execute('DELETE FROM alerts WHERE plugin_reference = ? AND plugin_reference_id = ?', [REFERENCE_ALERTE_CONTRAT, id]);
}
