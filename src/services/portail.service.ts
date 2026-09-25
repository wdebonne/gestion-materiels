import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../database';
import { decalerJours, jourCourant } from '../utils/periodes';
import {
  ErreurBatiment,
  etatDesSuivis,
  joindre,
  type Nature,
  type Resultat,
  type StatutDocument,
} from './batiments.service';
import { etatAcces, normaliserCode } from './entreprises.service';
import { versDateTime } from './tickets.service';

/**
 * Le portail des entreprises : ce qu'une entreprise voit et dépose.
 *
 * ## Une seule réponse pour « lien inconnu » et « code faux »
 *
 * Dire « ce lien n'existe pas » apprendrait à qui essaie des liens au hasard
 * lesquels existent. Les deux cas rendent donc la même chose, dans le même
 * temps : le lien inconnu paie une comparaison bcrypt factice, comme s'il y
 * avait eu un code à vérifier. « Accès suspendu » ou « expiré » ne se dit
 * qu'une fois le bon code saisi — c'est alors une information utile à
 * l'entreprise, et plus un indice pour un tiers.
 *
 * ## Un verrou souple
 *
 * Un verrou dur après cinq essais permettrait à quiconque connaît le lien —
 * il circule par courriel — de bloquer l'entreprise à volonté. Le frein est
 * donc d'abord le limiteur de débit, par adresse et par lien ; le verrou ne
 * tombe qu'après vingt échecs d'affilée, pour trente minutes, et un
 * gestionnaire peut le lever.
 *
 * ## Ce qu'elle voit
 *
 * Les documents **validés** des bâtiments qui lui sont ouverts, pour les objets
 * ouverts en lecture ; ses propres dépôts, quel que soit leur sort, avec le
 * motif d'un refus ; et les échéances à venir de ces objets, pour qu'elle
 * planifie sa tournée.
 */

export const DUREE_SESSION_HEURES = 8;
const ECHECS_AVANT_VERROU = 20;
const DUREE_VERROU_MINUTES = 30;

/**
 * Une empreinte bcrypt quelconque, pour payer le même temps qu'une vraie
 * comparaison — donc au **même coût** que les vrais codes, sans quoi un lien
 * inconnu répondrait plus vite qu'un code faux. Calculée une fois, à la
 * première demande, et non au démarrage.
 */
let empreinteFactice: Promise<string> | null = null;
const factice = () =>
  (empreinteFactice ??= bcrypt.hash('code-factice', parseInt(process.env.BCRYPT_ROUNDS || '12', 10)));

export type RefusConnexion = 'invalide' | 'bloque' | 'suspendu' | 'expire';

export interface SessionPortail {
  entrepriseId: number;
  nom: string;
}

const empreinte = (jeton: string) => crypto.createHash('sha256').update(jeton).digest('hex');

export async function ouvrirSession(
  lien: string,
  code: unknown,
  origine: { ip?: string; userAgent?: string } = {}
): Promise<{ jeton: string; expireLe: string; entreprise: { nom: string } } | { refus: RefusConnexion }> {
  const saisi = normaliserCode(code);
  const entreprise = /^[A-Z0-9]{10,32}$/.test(lien)
    ? await db.queryOne('SELECT * FROM entreprises WHERE lien_jeton = ?', [lien])
    : null;

  if (!entreprise || !entreprise.code_hash) {
    await bcrypt.compare(saisi, await factice());
    return { refus: 'invalide' };
  }

  const maintenant = new Date();
  if (entreprise.bloque_jusqu_a && String(entreprise.bloque_jusqu_a) > versDateTime(maintenant)) {
    return { refus: 'bloque' };
  }

  if (!(await bcrypt.compare(saisi, entreprise.code_hash))) {
    const echecs = Number(entreprise.tentatives_echouees ?? 0) + 1;
    if (echecs >= ECHECS_AVANT_VERROU) {
      const fin = new Date(maintenant.getTime() + DUREE_VERROU_MINUTES * 60_000);
      await db.execute('UPDATE entreprises SET tentatives_echouees = 0, bloque_jusqu_a = ? WHERE id = ?', [
        versDateTime(fin),
        entreprise.id,
      ]);
    } else {
      await db.execute('UPDATE entreprises SET tentatives_echouees = ? WHERE id = ?', [echecs, entreprise.id]);
    }
    return { refus: 'invalide' };
  }

  // Le bon code : l'état de l'accès peut maintenant se dire.
  const etat = etatAcces({ ...entreprise, bloque_jusqu_a: null }, maintenant);
  if (etat === 'suspendu' || etat === 'inactive') return { refus: 'suspendu' };
  if (etat === 'expire') return { refus: 'expire' };

  const jeton = crypto.randomBytes(32).toString('base64url');
  const expire = new Date(maintenant.getTime() + DUREE_SESSION_HEURES * 3_600_000);
  await db.execute(
    `INSERT INTO entreprise_sessions (entreprise_id, token_hash, expires_at, derniere_activite, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entreprise.id,
      empreinte(jeton),
      versDateTime(expire),
      versDateTime(maintenant),
      origine.ip?.slice(0, 45) ?? null,
      origine.userAgent?.slice(0, 255) ?? null,
      versDateTime(maintenant),
    ]
  );
  await db.execute(
    'UPDATE entreprises SET tentatives_echouees = 0, bloque_jusqu_a = NULL, derniere_connexion = ? WHERE id = ?',
    [versDateTime(maintenant), entreprise.id]
  );

  return { jeton, expireLe: expire.toISOString(), entreprise: { nom: entreprise.nom } };
}

/**
 * La session d'un jeton, ou `null`.
 *
 * L'état de l'accès est relu à chaque requête : une entreprise suspendue ou
 * arrivée à sa date de fin perd la main tout de suite, sans attendre
 * l'expiration de sa session.
 */
export async function lireSession(jeton: string | undefined): Promise<SessionPortail | null> {
  if (!jeton || jeton.length > 100) return null;
  const ligne = await db.queryOne(
    `SELECT e.*, s.id AS session_id FROM entreprise_sessions s
       JOIN entreprises e ON e.id = s.entreprise_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
    [empreinte(jeton), versDateTime()]
  );
  if (!ligne) return null;
  const etat = etatAcces({ ...ligne, bloque_jusqu_a: null });
  if (etat !== 'actif') return null;
  return { entrepriseId: Number(ligne.id), nom: ligne.nom };
}

export async function fermerSession(jeton: string | undefined): Promise<void> {
  if (!jeton) return;
  await db.execute('DELETE FROM entreprise_sessions WHERE token_hash = ?', [empreinte(jeton)]);
}

/** Les sessions expirées, effacées chaque nuit. */
export async function purgerSessionsExpirees(): Promise<number> {
  return (await db.execute('DELETE FROM entreprise_sessions WHERE expires_at <= ?', [versDateTime()])).changes;
}

// =============================================================== les droits

export interface DroitsPortail {
  sites: { id: number; nom: string }[];
  rubriques: { id: number; libelle: string; nature: Nature; lecture: boolean; depot: boolean }[];
}

export async function droitsDe(entrepriseId: number): Promise<DroitsPortail> {
  const [sites, rubriques] = await Promise.all([
    db.query(
      `SELECT cs.id, cs.name FROM entreprise_sites es JOIN cle_sites cs ON cs.id = es.site_id
        WHERE es.entreprise_id = ? AND COALESCE(cs.is_active, 1) = 1
        ORDER BY cs.sort_order, cs.name`,
      [entrepriseId]
    ),
    db.query(
      `SELECT r.id, r.libelle, r.nature, er.lecture, er.depot
         FROM entreprise_rubriques er JOIN batiment_rubriques r ON r.id = er.rubrique_id
        WHERE er.entreprise_id = ? AND r.is_active = 1
        ORDER BY r.sort_order, r.libelle`,
      [entrepriseId]
    ),
  ]);
  return {
    sites: sites.map((s: any) => ({ id: Number(s.id), nom: s.name })),
    rubriques: rubriques.map((r: any) => ({
      id: Number(r.id),
      libelle: r.libelle,
      nature: r.nature,
      lecture: Boolean(Number(r.lecture)),
      depot: Boolean(Number(r.depot)),
    })),
  };
}

export interface DocumentPortail {
  id: number;
  siteId: number;
  siteNom: string;
  rubriqueId: number | null;
  rubriqueLibelle: string | null;
  titre: string;
  nomOrigine: string;
  mime: string | null;
  taille: number | null;
  dateDocument: string | null;
  prochaineEcheance: string | null;
  resultat: Resultat | null;
  /** Ses propres dépôts seulement : les autres sont toujours validés. */
  statut: StatutDocument;
  motifRefus: string | null;
  sien: boolean;
  deposeLe: string | null;
}

/**
 * Le filtre de visibilité, écrit une fois pour la liste et pour le fichier :
 * validé, dans un bâtiment ouvert, pour un objet ouvert en lecture — ou déposé
 * par l'entreprise elle-même.
 */
function visibilite(entrepriseId: number): { sql: string; params: unknown[] } {
  return {
    sql: `(d.entreprise_id = ?
           OR (d.statut = 'valide'
               AND d.site_id IN (SELECT site_id FROM entreprise_sites WHERE entreprise_id = ?)
               AND d.rubrique_id IN (SELECT rubrique_id FROM entreprise_rubriques WHERE entreprise_id = ? AND lecture = 1)))`,
    params: [entrepriseId, entrepriseId, entrepriseId],
  };
}

export async function documentsVisibles(entrepriseId: number): Promise<DocumentPortail[]> {
  const { sql, params } = visibilite(entrepriseId);
  const lignes = await db.query(
    `SELECT d.id, d.site_id, cs.name AS site_nom, d.rubrique_id, r.libelle AS rubrique_libelle, d.titre,
            d.nom_origine, d.mime, d.taille, d.date_document, d.prochaine_echeance, d.resultat, d.statut,
            d.motif_refus, d.entreprise_id, d.created_at
       FROM batiment_documents d
       JOIN cle_sites cs ON cs.id = d.site_id
       LEFT JOIN batiment_rubriques r ON r.id = d.rubrique_id
      WHERE ${sql}
      ORDER BY cs.name, COALESCE(d.date_document, '') DESC, d.id DESC
      LIMIT 1000`,
    params
  );
  return lignes.map((l: any) => {
    const sien = Number(l.entreprise_id) === entrepriseId;
    return {
      id: Number(l.id),
      siteId: Number(l.site_id),
      siteNom: l.site_nom,
      rubriqueId: l.rubrique_id === null ? null : Number(l.rubrique_id),
      rubriqueLibelle: l.rubrique_libelle ?? null,
      titre: l.titre,
      nomOrigine: l.nom_origine,
      mime: l.mime ?? null,
      taille: l.taille === null ? null : Number(l.taille),
      dateDocument: l.date_document ?? null,
      prochaineEcheance: l.prochaine_echeance ?? null,
      resultat: l.resultat ?? null,
      statut: l.statut,
      motifRefus: sien ? (l.motif_refus ?? null) : null,
      sien,
      deposeLe: l.created_at ? String(l.created_at) : null,
    };
  });
}

/** Le document, s'il est visible de cette entreprise ; sinon `null` — jamais un refus qui dirait qu'il existe. */
export async function documentVisible(
  entrepriseId: number,
  documentId: number
): Promise<{ chemin: string; nomOrigine: string; mime: string | null } | null> {
  const { sql, params } = visibilite(entrepriseId);
  const ligne = await db.queryOne(
    `SELECT d.chemin, d.nom_origine, d.mime FROM batiment_documents d WHERE d.id = ? AND ${sql}`,
    [documentId, ...params]
  );
  return ligne ? { chemin: ligne.chemin, nomOrigine: ligne.nom_origine, mime: ligne.mime ?? null } : null;
}

/**
 * Les échéances à venir — six mois — des objets qu'elle lit, dans ses bâtiments.
 * Les dépassées aussi : ce sont celles qu'on attend d'elle en premier.
 */
export async function echeancesVisibles(entrepriseId: number, droits?: DroitsPortail) {
  const d = droits ?? (await droitsDe(entrepriseId));
  const lues = new Set(d.rubriques.filter((r) => r.lecture).map((r) => r.id));
  if (d.sites.length === 0 || lues.size === 0) return [];
  const horizon = decalerJours(jourCourant(), 183);
  return (await etatDesSuivis({ siteIds: d.sites.map((s) => s.id), actifsSeulement: true }))
    .filter((e) => lues.has(e.rubriqueId) && e.echeance && e.echeance <= horizon)
    .sort((a, b) => String(a.echeance).localeCompare(String(b.echeance)))
    .map((e) => ({
      siteId: e.siteId,
      siteNom: e.siteNom,
      rubriqueLibelle: e.rubriqueLibelle,
      libelle: e.libelle,
      echeance: e.echeance,
      joursRestants: e.joursRestants,
      statut: e.statut,
    }));
}

/**
 * Dépose un document pour l'entreprise.
 *
 * Le bâtiment et l'objet doivent lui être ouverts en dépôt ; quand un seul
 * l'est, il est pris d'office — le formulaire ne l'a pas demandé. Le dépôt
 * attend toujours la validation d'un gestionnaire.
 */
export async function deposer(
  entrepriseId: number,
  saisie: { siteId?: unknown; rubriqueId?: unknown; titre?: unknown; dateDocument?: unknown; resultat?: unknown; commentaire?: unknown },
  fichier: { chemin: string; nomOrigine: string; mime: string | null; taille: number | null }
): Promise<{ id: number }> {
  const droits = await droitsDe(entrepriseId);
  const deposables = droits.rubriques.filter((r) => r.depot);
  if (droits.sites.length === 0 || deposables.length === 0) {
    throw new ErreurBatiment(403, "Aucun dépôt ne vous est ouvert : contactez la collectivité");
  }

  const choisir = <T extends { id: number }>(liste: T[], valeur: unknown, quoi: string): T => {
    if (liste.length === 1 && (valeur === undefined || valeur === null || valeur === '')) return liste[0];
    const trouve = liste.find((e) => e.id === Number(valeur));
    if (!trouve) throw new ErreurBatiment(400, `Choisissez ${quoi} parmi ceux qui vous sont ouverts`);
    return trouve;
  };
  const site = choisir(droits.sites, saisie.siteId, 'le bâtiment');
  const rubrique = choisir(deposables, saisie.rubriqueId, "l'objet");

  const { id } = await joindre({
    siteId: site.id,
    rubriqueId: rubrique.id,
    titre: saisie.titre,
    dateDocument: saisie.dateDocument,
    resultat: saisie.resultat,
    commentaireDepot: saisie.commentaire,
    source: 'entreprise',
    deposePar: null,
    entrepriseId,
    fichier,
  });
  return { id };
}

/** Retire l'un de ses dépôts, tant que personne ne l'a relu. Rend le chemin du fichier à effacer. */
export async function retirerDepot(entrepriseId: number, documentId: number): Promise<string | null> {
  const ligne = await db.queryOne(
    "SELECT chemin FROM batiment_documents WHERE id = ? AND entreprise_id = ? AND statut = 'a_valider'",
    [documentId, entrepriseId]
  );
  if (!ligne) return null;
  await db.execute('DELETE FROM batiment_documents WHERE id = ?', [documentId]);
  return String(ligne.chemin);
}
