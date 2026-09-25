import { db } from '../database';
import { versJour } from '../utils/periodes';
import { ErreurBatiment, identifiant, jourOuNull, texte } from './batiments.service';
import { versDateTime } from './tickets.service';

/**
 * Ce qui a été fait dans un bâtiment, par qui, et ce que ça a coûté.
 *
 * Un dépannage de chaudière, des travaux de peinture, le nettoyage des
 * vitres, le passage du contrôleur : chacun est une ligne, datée, rattachée au
 * bâtiment — et, si on le sait, à la pièce, à l'entreprise, au contrat qui la
 * couvre, au ticket d'où elle vient, au document qui la prouve. C'est ce qui
 * donne, pièce par pièce, l'historique des entretiens, et aux statistiques ce
 * que coûte un bâtiment hors énergie.
 */

export const NATURES_INTERVENTION = ['entretien', 'depannage', 'travaux', 'controle', 'nettoyage', 'autre'] as const;
export type NatureIntervention = (typeof NATURES_INTERVENTION)[number];

export interface Intervention {
  id: number;
  siteId: number;
  siteNom: string;
  pieceId: number | null;
  pieceNom: string | null;
  date: string;
  nature: NatureIntervention;
  titre: string;
  description: string | null;
  entreprise: { id: number; nom: string } | null;
  contrat: { id: number; objet: string } | null;
  ticketId: number | null;
  document: { id: number; titre: string } | null;
  montantHt: number | null;
  montantTtc: number | null;
  dureeMinutes: number | null;
}

const nombreOuNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

const SELECT_INTERVENTION = `SELECT i.*, s.name AS site_nom, p.name AS piece_nom, e.nom AS entreprise_nom,
       c.objet AS contrat_objet, d.titre AS document_titre
  FROM batiment_interventions i
  JOIN cle_sites s ON s.id = i.site_id
  LEFT JOIN site_pieces p ON p.id = i.piece_id
  LEFT JOIN entreprises e ON e.id = i.entreprise_id
  LEFT JOIN batiment_contrats c ON c.id = i.contrat_id
  LEFT JOIN batiment_documents d ON d.id = i.document_id`;

function enIntervention(l: any): Intervention {
  return {
    id: Number(l.id),
    siteId: Number(l.site_id),
    siteNom: l.site_nom,
    pieceId: nombreOuNull(l.piece_id),
    pieceNom: l.piece_nom ?? null,
    date: versJour(l.date_intervention),
    nature: l.nature,
    titre: l.titre,
    description: l.description ?? null,
    entreprise: l.entreprise_id ? { id: Number(l.entreprise_id), nom: l.entreprise_nom ?? '' } : null,
    contrat: l.contrat_id ? { id: Number(l.contrat_id), objet: l.contrat_objet ?? '' } : null,
    ticketId: nombreOuNull(l.ticket_id),
    document: l.document_id ? { id: Number(l.document_id), titre: l.document_titre ?? 'Document' } : null,
    montantHt: nombreOuNull(l.montant_ht),
    montantTtc: nombreOuNull(l.montant_ttc),
    dureeMinutes: nombreOuNull(l.duree_minutes),
  };
}

export async function listerInterventions(filtre: {
  siteIds: number[];
  pieceId?: number;
  annee?: number;
  nature?: NatureIntervention;
}): Promise<Intervention[]> {
  if (filtre.siteIds.length === 0) return [];
  const conditions = [`i.site_id IN (${filtre.siteIds.map(() => '?').join(', ')})`];
  const params: unknown[] = [...filtre.siteIds];
  if (filtre.pieceId) {
    conditions.push('i.piece_id = ?');
    params.push(filtre.pieceId);
  }
  if (filtre.annee) {
    conditions.push('i.date_intervention >= ? AND i.date_intervention <= ?');
    params.push(`${filtre.annee}-01-01`, `${filtre.annee}-12-31`);
  }
  if (filtre.nature) {
    conditions.push('i.nature = ?');
    params.push(filtre.nature);
  }
  const lignes = await db.query(
    `${SELECT_INTERVENTION} WHERE ${conditions.join(' AND ')} ORDER BY i.date_intervention DESC, i.id DESC LIMIT 1000`,
    params
  );
  return lignes.map(enIntervention);
}

export interface InterventionSaisie {
  pieceId?: unknown;
  date?: unknown;
  nature?: unknown;
  titre?: unknown;
  description?: unknown;
  entrepriseId?: unknown;
  contratId?: unknown;
  ticketId?: unknown;
  documentId?: unknown;
  montantHt?: unknown;
  montantTtc?: unknown;
  dureeMinutes?: unknown;
}

function lireMontant(valeur: unknown, champ: string): number | null {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const n = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new ErreurBatiment(400, `${champ} : montant invalide`);
  return Math.round(n * 100) / 100;
}

async function lireChamps(siteId: number, saisie: InterventionSaisie, existant?: any) {
  const v = <K extends keyof InterventionSaisie>(cle: K, colonne: string) => (saisie[cle] !== undefined ? saisie[cle] : existant?.[colonne]);

  const nature = v('nature', 'nature');
  if (!NATURES_INTERVENTION.includes(nature as NatureIntervention)) throw new ErreurBatiment(400, "Nature d'intervention inconnue");
  const titre = texte(v('titre', 'titre'));
  if (!titre) throw new ErreurBatiment(400, "Le titre de l'intervention est obligatoire");
  const date = jourOuNull(v('date', 'date_intervention'), "Date de l'intervention");
  if (!date) throw new ErreurBatiment(400, "La date de l'intervention est obligatoire");

  const pieceId = identifiant(v('pieceId', 'piece_id'));
  if (pieceId) {
    const piece = await db.queryOne('SELECT site_id FROM site_pieces WHERE id = ?', [pieceId]);
    if (!piece || Number(piece.site_id) !== siteId) throw new ErreurBatiment(400, "Cette pièce n'est pas dans ce bâtiment");
  }
  const entrepriseId = identifiant(v('entrepriseId', 'entreprise_id'));
  if (entrepriseId && !(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [entrepriseId]))) {
    throw new ErreurBatiment(400, 'Entreprise inconnue');
  }
  const contratId = identifiant(v('contratId', 'contrat_id'));
  if (contratId) {
    const lien = await db.queryOne('SELECT 1 AS ok FROM batiment_contrat_sites WHERE contrat_id = ? AND site_id = ?', [contratId, siteId]);
    if (!lien) throw new ErreurBatiment(400, 'Ce contrat ne couvre pas ce bâtiment');
  }
  const documentId = identifiant(v('documentId', 'document_id'));
  if (documentId) {
    const doc = await db.queryOne('SELECT site_id FROM batiment_documents WHERE id = ?', [documentId]);
    if (!doc || Number(doc.site_id) !== siteId) throw new ErreurBatiment(400, "Ce document n'est pas dans ce bâtiment");
  }
  const duree = v('dureeMinutes', 'duree_minutes');
  const dureeMinutes = duree === undefined || duree === null || duree === '' ? null : Number(duree);
  if (dureeMinutes !== null && (!Number.isInteger(dureeMinutes) || dureeMinutes < 0 || dureeMinutes > 100000)) {
    throw new ErreurBatiment(400, 'Durée : un nombre de minutes');
  }

  return {
    pieceId,
    date,
    nature,
    titre,
    description: texte(v('description', 'description'), 5000),
    entrepriseId,
    contratId,
    ticketId: identifiant(v('ticketId', 'ticket_id')),
    documentId,
    montantHt: lireMontant(v('montantHt', 'montant_ht'), 'Montant HT'),
    montantTtc: lireMontant(v('montantTtc', 'montant_ttc'), 'Montant TTC'),
    dureeMinutes,
  };
}

export async function creerIntervention(siteId: number, saisie: InterventionSaisie, userId: number): Promise<number> {
  const i = await lireChamps(siteId, saisie);
  const maintenant = versDateTime();
  const r = await db.execute(
    `INSERT INTO batiment_interventions
       (site_id, piece_id, date_intervention, nature, titre, description, entreprise_id, contrat_id, ticket_id,
        document_id, montant_ht, montant_ttc, duree_minutes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [siteId, i.pieceId, i.date, i.nature, i.titre, i.description, i.entrepriseId, i.contratId, i.ticketId,
     i.documentId, i.montantHt, i.montantTtc, i.dureeMinutes, userId, maintenant, maintenant]
  );
  return Number(r.lastInsertRowid);
}

export async function modifierIntervention(id: number, saisie: InterventionSaisie): Promise<void> {
  const existant = await db.queryOne('SELECT * FROM batiment_interventions WHERE id = ?', [id]);
  if (!existant) throw new ErreurBatiment(404, 'Intervention introuvable');
  const i = await lireChamps(Number(existant.site_id), saisie, existant);
  await db.execute(
    `UPDATE batiment_interventions
        SET piece_id = ?, date_intervention = ?, nature = ?, titre = ?, description = ?, entreprise_id = ?,
            contrat_id = ?, ticket_id = ?, document_id = ?, montant_ht = ?, montant_ttc = ?, duree_minutes = ?,
            updated_at = ?
      WHERE id = ?`,
    [i.pieceId, i.date, i.nature, i.titre, i.description, i.entrepriseId, i.contratId, i.ticketId, i.documentId,
     i.montantHt, i.montantTtc, i.dureeMinutes, versDateTime(), id]
  );
}

export async function supprimerIntervention(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_interventions WHERE id = ?', [id]);
}

/** Le coût saisi à la validation d'un contrôle ; vide = rien à enregistrer. */
export function lireCoutDuControle(valeur: unknown): number | null {
  const montant = lireMontant(valeur, 'Coût du contrôle');
  if (montant !== null && montant < 0) throw new ErreurBatiment(400, 'Coût du contrôle : montant invalide');
  return montant;
}

/**
 * Valider un rapport de contrôle en saisissant son coût crée l'intervention
 * qui le porte : le passage du vérificateur, daté du rapport, avec
 * l'entreprise qui l'a déposé. Une seconde validation du même document met
 * l'intervention à jour au lieu d'en créer une autre.
 */
export async function enregistrerCoutDuControle(documentId: number, montantTtc: number, userId: number): Promise<number> {
  const doc = await db.queryOne(
    `SELECT d.site_id, d.piece_id, d.titre, d.date_document, d.entreprise_id
       FROM batiment_documents d WHERE d.id = ?`,
    [documentId]
  );
  if (!doc) throw new ErreurBatiment(404, 'Document introuvable');
  const date = doc.date_document ? versJour(doc.date_document) : versJour(new Date());
  const maintenant = versDateTime();

  const existante = await db.queryOne(
    "SELECT id FROM batiment_interventions WHERE document_id = ? AND nature = 'controle' ORDER BY id LIMIT 1",
    [documentId]
  );
  if (existante) {
    await db.execute(
      'UPDATE batiment_interventions SET site_id = ?, piece_id = ?, date_intervention = ?, montant_ttc = ?, updated_at = ? WHERE id = ?',
      [doc.site_id, doc.piece_id ?? null, date, montantTtc, maintenant, existante.id]
    );
    return Number(existante.id);
  }
  const r = await db.execute(
    `INSERT INTO batiment_interventions
       (site_id, piece_id, date_intervention, nature, titre, entreprise_id, document_id, montant_ttc, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'controle', ?, ?, ?, ?, ?, ?, ?)`,
    [doc.site_id, doc.piece_id ?? null, date, doc.titre, doc.entreprise_id ?? null, documentId, montantTtc, userId, maintenant, maintenant]
  );
  return Number(r.lastInsertRowid);
}
