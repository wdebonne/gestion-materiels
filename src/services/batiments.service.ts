import fs from 'fs';
import path from 'path';
import { db } from '../database';
import { dossierPrive } from '../middleware/televersement';
import { decalerMois, estJourValide, jourCourant, nombreDeJours, versJour } from '../utils/periodes';
import { peutGererLieux, sitesConsultesPar } from './gestionOrganisation.service';
import { versDateTime } from './tickets.service';

/**
 * Les contrôles obligatoires des bâtiments, et les documents qui les prouvent.
 *
 * ## Une seule source pour l'échéance
 *
 * L'échéance d'un suivi n'est **pas saisie** : elle se lit sur le dernier
 * document validé de ce suivi — sa `prochaine_echeance` si le rapport en donne
 * une, sinon sa date augmentée de la périodicité. `etatDesSuivis()` est le seul
 * endroit qui fait ce calcul ; l'écran, les alertes et le portail des
 * entreprises le lisent tous là. Deux calculs finiraient par diverger d'un jour,
 * et l'alerte dirait « en retard » ce que l'écran dit « à jour ».
 *
 * Un document refusé ou en attente ne compte pas : seul ce qu'un gestionnaire a
 * relu fait foi. Et comme pour les contrôles techniques des véhicules
 * (`CONTROLE_PLUS_RECENT` dans `cron.service.ts`), le plus récent remplace les
 * précédents — l'extincteur vérifié en 2025 n'est pas « en retard » au titre de
 * sa vérification de 2023.
 *
 * ## Le circuit d'un document
 *
 *   déposé par un responsable ou une entreprise  →  `a_valider`
 *   relu et reclassé par un gestionnaire          →  `valide` (fait foi)
 *                                                 ou `refuse` (avec motif)
 *
 * Un gestionnaire qui dépose lui-même valide du même geste : lui demander de
 * relire son propre dépôt ne protégerait de rien.
 */

export const SOUS_DOSSIER = 'batiments';

/** `plugin_reference` des alertes d'échéance ; `plugin_reference_id` est le suivi. */
export const REFERENCE_ALERTE = 'batiment-suivi';

/** Celle des contrats de maintenance ; `plugin_reference_id` est le contrat. */
export const REFERENCE_ALERTE_CONTRAT = 'batiment-contrat';

export const NATURES = ['controle', 'rapport', 'facture', 'contrat', 'autre'] as const;
export type Nature = (typeof NATURES)[number];

export const RESULTATS = ['conforme', 'reserves', 'non_conforme'] as const;
export type Resultat = (typeof RESULTATS)[number];

export const STATUTS_DOCUMENT = ['a_valider', 'valide', 'refuse'] as const;
export type StatutDocument = (typeof STATUTS_DOCUMENT)[number];

/** Du plus urgent au plus calme — l'ordre sert au tri des écrans. */
export type StatutSuivi = 'en_retard' | 'non_conforme' | 'bientot' | 'a_jour' | 'jamais';

/** Une erreur qui porte son code HTTP : la route la rend telle quelle. */
export class ErreurBatiment extends Error {
  constructor(
    public statut: number,
    message: string
  ) {
    super(message);
  }
}

// =============================================================== le catalogue

interface EntreeCatalogue {
  code: string;
  libelle: string;
  nature: Nature;
  periodicite_mois: number | null;
  rappel_jours: number;
  reference_reglementaire: string | null;
}

/**
 * Les obligations les plus courantes d'une commune, livrées au premier
 * démarrage.
 *
 * Un point de départ, pas une liste fermée : les périodicités varient avec le
 * type et la catégorie de l'établissement (une école n'est pas une salle des
 * fêtes), et c'est la commune qui les connaît. Chaque valeur se règle dans
 * Paramètres › Bâtiments, et l'amorçage ne réécrit jamais une rubrique déjà là.
 *
 * Les références ne sont données que lorsqu'elles sont sûres ; mieux vaut un
 * champ vide qu'un article faux recopié dans un courrier à la préfecture.
 */
export const CATALOGUE_RUBRIQUES: EntreeCatalogue[] = [
  { code: 'verification-electrique', libelle: 'Vérification des installations électriques', nature: 'controle', periodicite_mois: 12, rappel_jours: 60, reference_reglementaire: 'Code du travail R4226-16 ; ERP art. EL 19' },
  { code: 'extincteurs', libelle: 'Vérification des extincteurs', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Code du travail R4227-39' },
  { code: 'ssi-alarme', libelle: 'Système de sécurité incendie et alarme', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'ERP art. MS 73' },
  { code: 'desenfumage', libelle: 'Désenfumage', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'ERP art. DF 10' },
  { code: 'eclairage-securite', libelle: 'Éclairage de sécurité', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'ERP art. EC 15' },
  { code: 'ria', libelle: "Robinets d'incendie armés (RIA)", nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: null },
  { code: 'installations-gaz', libelle: 'Installations de gaz', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'ERP art. GZ 30' },
  { code: 'chaudiere', libelle: 'Entretien de la chaudière', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Décret 2009-649' },
  { code: 'ramonage', libelle: 'Ramonage', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Règlement sanitaire départemental' },
  { code: 'portes-automatiques', libelle: 'Portes et portails automatiques', nature: 'controle', periodicite_mois: 6, rappel_jours: 30, reference_reglementaire: 'Arrêté du 21 décembre 1993' },
  { code: 'ascenseur-controle', libelle: "Contrôle technique de l'ascenseur", nature: 'controle', periodicite_mois: 60, rappel_jours: 90, reference_reglementaire: 'CCH R134-11' },
  { code: 'amiante-dta', libelle: 'Amiante : évaluation périodique (DTA)', nature: 'controle', periodicite_mois: 36, rappel_jours: 90, reference_reglementaire: 'Code de la santé publique R1334-20 et suivants' },
  { code: 'legionellose', libelle: 'Légionellose : analyses', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Arrêté du 1er février 2010' },
  { code: 'radon', libelle: 'Radon : mesurage', nature: 'controle', periodicite_mois: 120, rappel_jours: 90, reference_reglementaire: null },
  { code: 'aires-de-jeux', libelle: 'Aires collectives de jeux', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Décret 96-1136' },
  { code: 'equipements-sportifs', libelle: 'Équipements sportifs (buts, paniers)', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Décret 96-495' },
  { code: 'commission-securite', libelle: 'Visite de la commission de sécurité', nature: 'controle', periodicite_mois: 36, rappel_jours: 90, reference_reglementaire: null },
  { code: 'exercice-evacuation', libelle: "Exercice d'évacuation", nature: 'rapport', periodicite_mois: 6, rappel_jours: 15, reference_reglementaire: 'Code du travail R4227-39' },
  { code: 'ppms', libelle: 'Plan particulier de mise en sûreté (PPMS)', nature: 'rapport', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: null },
  { code: 'hottes-cuisine', libelle: 'Nettoyage des hottes de cuisine', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'ERP art. GC 21' },
  { code: 'paratonnerre', libelle: 'Vérification du paratonnerre', nature: 'controle', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: null },
  { code: 'dpe', libelle: 'Diagnostic de performance énergétique (DPE)', nature: 'rapport', periodicite_mois: 120, rappel_jours: 90, reference_reglementaire: null },
  { code: 'operat', libelle: 'Déclaration OPERAT (décret tertiaire)', nature: 'autre', periodicite_mois: 12, rappel_jours: 30, reference_reglementaire: 'Décret 2019-771' },
  { code: 'facture-energie', libelle: "Facture d'énergie", nature: 'facture', periodicite_mois: null, rappel_jours: 30, reference_reglementaire: null },
  { code: 'contrat-maintenance', libelle: 'Contrat de maintenance', nature: 'contrat', periodicite_mois: null, rappel_jours: 30, reference_reglementaire: null },
  { code: 'diagnostic-plomb', libelle: 'Diagnostic plomb (CREP)', nature: 'rapport', periodicite_mois: null, rappel_jours: 30, reference_reglementaire: null },
  { code: 'rapport-divers', libelle: 'Rapport divers', nature: 'rapport', periodicite_mois: null, rappel_jours: 30, reference_reglementaire: null },
];

/**
 * Insère les rubriques du catalogue dont le code manque. Rend le nombre inséré.
 *
 * Code par code, et non « si la table est vide » : une rubrique ajoutée au
 * catalogue dans une version future doit arriver sur les installations
 * existantes, sans reposer celles que la commune a renommées ou désactivées.
 */
export async function semerRubriques(): Promise<number> {
  const existants = new Set<string>(
    (await db.query('SELECT code FROM batiment_rubriques')).map((l: any) => String(l.code))
  );
  const maintenant = versDateTime();
  let inserees = 0;

  for (const [rang, entree] of CATALOGUE_RUBRIQUES.entries()) {
    if (existants.has(entree.code)) continue;
    await db.execute(
      `INSERT INTO batiment_rubriques
         (code, libelle, nature, periodicite_mois, rappel_jours, reference_reglementaire,
          is_active, is_system, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [
        entree.code,
        entree.libelle,
        entree.nature,
        entree.periodicite_mois,
        entree.rappel_jours,
        entree.reference_reglementaire,
        (rang + 1) * 10,
        maintenant,
        maintenant,
      ]
    );
    inserees++;
  }
  return inserees;
}

// ============================================================ lectures de saisie

const MAX_PERIODICITE = 240;
const MAX_RAPPEL = 730;

/** Un entier strictement positif borné, `null` si vide, `undefined` si absent. */
function entierBorne(valeur: unknown, max: number, champ: string): number | null | undefined {
  if (valeur === undefined) return undefined;
  if (valeur === null || valeur === '') return null;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ErreurBatiment(400, `${champ} : un nombre entier entre 1 et ${max} est attendu`);
  }
  return n;
}

export function identifiant(valeur: unknown): number | null {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function texte(valeur: unknown, max = 255): string | null {
  if (valeur === undefined || valeur === null) return null;
  const t = String(valeur).trim();
  return t ? t.slice(0, max) : null;
}

export function jourOuNull(valeur: unknown, champ: string): string | null {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (!estJourValide(valeur)) throw new ErreurBatiment(400, `${champ} : date invalide (AAAA-MM-JJ attendu)`);
  return valeur;
}

function resultatOuNull(valeur: unknown): Resultat | null {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (!RESULTATS.includes(valeur as Resultat)) throw new ErreurBatiment(400, 'Résultat inconnu');
  return valeur as Resultat;
}

const vrai = (valeur: unknown): boolean => Boolean(Number(valeur ?? 0));

/** « 01/10/2026 » : ce qu'on écrit dans une alerte ou un courriel. */
export function jourFrancais(jour: string | null | undefined): string {
  if (!jour) return '';
  const [a, m, j] = versJour(jour).split('-');
  return `${j}/${m}/${a}`;
}

// ============================================================== les rubriques

export interface Rubrique {
  id: number;
  code: string;
  libelle: string;
  nature: Nature;
  periodiciteMois: number | null;
  rappelJours: number;
  referenceReglementaire: string | null;
  description: string | null;
  actif: boolean;
  systeme: boolean;
  ordre: number;
  suivis: number;
  documents: number;
}

function enRubrique(l: any): Rubrique {
  return {
    id: Number(l.id),
    code: l.code,
    libelle: l.libelle,
    nature: l.nature,
    periodiciteMois: l.periodicite_mois === null || l.periodicite_mois === undefined ? null : Number(l.periodicite_mois),
    rappelJours: Number(l.rappel_jours),
    referenceReglementaire: l.reference_reglementaire ?? null,
    description: l.description ?? null,
    actif: vrai(l.is_active),
    systeme: vrai(l.is_system),
    ordre: Number(l.sort_order ?? 0),
    suivis: Number(l.nb_suivis ?? 0),
    documents: Number(l.nb_documents ?? 0),
  };
}

export async function listerRubriques(options: { toutes?: boolean } = {}): Promise<Rubrique[]> {
  const lignes = await db.query(
    `SELECT r.*,
            (SELECT COUNT(*) FROM batiment_suivis s WHERE s.rubrique_id = r.id) AS nb_suivis,
            (SELECT COUNT(*) FROM batiment_documents d WHERE d.rubrique_id = r.id) AS nb_documents
       FROM batiment_rubriques r
      ${options.toutes ? '' : 'WHERE r.is_active = 1'}
      ORDER BY r.sort_order, r.libelle`
  );
  return lignes.map(enRubrique);
}

export async function lireRubrique(id: number | string): Promise<Rubrique | null> {
  const ligne = await db.queryOne('SELECT * FROM batiment_rubriques WHERE id = ?', [id]);
  return ligne ? enRubrique(ligne) : null;
}

/** Un code lisible et unique, tiré du libellé : « Contrôle des stores » → `controle-des-stores`. */
async function codeLibre(libelle: string): Promise<string> {
  const base =
    libelle
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'rubrique';
  let code = base;
  for (let n = 2; await db.queryOne('SELECT id FROM batiment_rubriques WHERE code = ?', [code]); n++) {
    code = `${base}-${n}`;
  }
  return code;
}

export interface RubriqueSaisie {
  libelle?: unknown;
  nature?: unknown;
  periodiciteMois?: unknown;
  rappelJours?: unknown;
  referenceReglementaire?: unknown;
  description?: unknown;
  actif?: unknown;
  ordre?: unknown;
}

function lireNature(valeur: unknown): Nature {
  if (!NATURES.includes(valeur as Nature)) throw new ErreurBatiment(400, 'Nature inconnue');
  return valeur as Nature;
}

export async function creerRubrique(saisie: RubriqueSaisie): Promise<number> {
  const libelle = texte(saisie.libelle);
  if (!libelle) throw new ErreurBatiment(400, 'Le libellé est obligatoire');
  const nature = saisie.nature === undefined ? 'controle' : lireNature(saisie.nature);
  const periodicite = entierBorne(saisie.periodiciteMois, MAX_PERIODICITE, 'Périodicité') ?? null;
  const rappel = entierBorne(saisie.rappelJours, MAX_RAPPEL, 'Délai de rappel') ?? 30;
  const maintenant = versDateTime();

  const ordre = await db.queryOne('SELECT MAX(sort_order) AS m FROM batiment_rubriques');
  const resultat = await db.execute(
    `INSERT INTO batiment_rubriques
       (code, libelle, nature, periodicite_mois, rappel_jours, reference_reglementaire, description,
        is_active, is_system, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    [
      await codeLibre(libelle),
      libelle,
      nature,
      periodicite,
      rappel,
      texte(saisie.referenceReglementaire),
      texte(saisie.description, 5000),
      Number(ordre?.m ?? 0) + 10,
      maintenant,
      maintenant,
    ]
  );
  return Number(resultat.lastInsertRowid);
}

/**
 * Modifie une rubrique — système ou non : c'est la commune qui connaît ses
 * périodicités. Les alertes de ses suivis sont retirées, pour être reposées au
 * passage suivant avec le nouveau délai.
 */
export async function modifierRubrique(id: number | string, saisie: RubriqueSaisie): Promise<void> {
  const actuelle = await lireRubrique(id);
  if (!actuelle) throw new ErreurBatiment(404, 'Rubrique introuvable');

  const champs: string[] = [];
  const valeurs: unknown[] = [];
  const poser = (colonne: string, valeur: unknown) => {
    champs.push(`${colonne} = ?`);
    valeurs.push(valeur);
  };

  if (saisie.libelle !== undefined) {
    const libelle = texte(saisie.libelle);
    if (!libelle) throw new ErreurBatiment(400, 'Le libellé est obligatoire');
    poser('libelle', libelle);
  }
  if (saisie.nature !== undefined) poser('nature', lireNature(saisie.nature));
  const periodicite = entierBorne(saisie.periodiciteMois, MAX_PERIODICITE, 'Périodicité');
  if (periodicite !== undefined) poser('periodicite_mois', periodicite);
  const rappel = entierBorne(saisie.rappelJours, MAX_RAPPEL, 'Délai de rappel');
  if (rappel === null) throw new ErreurBatiment(400, 'Le délai de rappel est obligatoire');
  if (rappel !== undefined) poser('rappel_jours', rappel);
  if (saisie.referenceReglementaire !== undefined) poser('reference_reglementaire', texte(saisie.referenceReglementaire));
  if (saisie.description !== undefined) poser('description', texte(saisie.description, 5000));
  if (saisie.actif !== undefined) poser('is_active', saisie.actif ? 1 : 0);
  if (saisie.ordre !== undefined && Number.isInteger(Number(saisie.ordre))) poser('sort_order', Number(saisie.ordre));
  if (champs.length === 0) return;

  poser('updated_at', versDateTime());
  await db.execute(`UPDATE batiment_rubriques SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
  await retirerAlertesRubrique(Number(id));
}

/**
 * Supprime une rubrique inutilisée.
 *
 * Une rubrique du catalogue se désactive seulement : l'amorçage la reposerait
 * au démarrage suivant. Une rubrique employée non plus — la cascade emporterait
 * ses suivis, et ses documents perdraient leur classement.
 */
export async function supprimerRubrique(id: number | string): Promise<void> {
  const rubrique = await lireRubrique(id);
  if (!rubrique) throw new ErreurBatiment(404, 'Rubrique introuvable');
  if (rubrique.systeme) {
    throw new ErreurBatiment(409, 'Cette rubrique fait partie du catalogue : désactivez-la plutôt');
  }
  const [compte] = await db.query(
    `SELECT (SELECT COUNT(*) FROM batiment_suivis WHERE rubrique_id = ?) AS suivis,
            (SELECT COUNT(*) FROM batiment_documents WHERE rubrique_id = ?) AS documents`,
    [id, id]
  );
  const suivis = Number(compte?.suivis ?? 0);
  const documents = Number(compte?.documents ?? 0);
  if (suivis + documents > 0) {
    throw new ErreurBatiment(
      409,
      `Cette rubrique est employée (${suivis} suivi(s), ${documents} document(s)) : désactivez-la plutôt`
    );
  }
  await db.execute('DELETE FROM batiment_rubriques WHERE id = ?', [id]);
}

/**
 * Applique une rubrique à plusieurs bâtiments d'un geste : « les extincteurs,
 * partout ». Seuls les bâtiments qui ne la suivent pas encore reçoivent un suivi.
 */
export async function appliquerRubrique(
  rubriqueId: number,
  siteIds: number[],
  userId: number
): Promise<number> {
  const rubrique = await lireRubrique(rubriqueId);
  if (!rubrique) throw new ErreurBatiment(404, 'Rubrique introuvable');

  let crees = 0;
  for (const siteId of [...new Set(siteIds.filter((s) => Number.isInteger(s) && s > 0))]) {
    const site = await db.queryOne('SELECT id FROM cle_sites WHERE id = ?', [siteId]);
    if (!site) continue;
    const deja = await db.queryOne('SELECT id FROM batiment_suivis WHERE site_id = ? AND rubrique_id = ?', [
      siteId,
      rubriqueId,
    ]);
    if (deja) continue;
    await creerSuivi(siteId, { rubriqueId }, userId);
    crees++;
  }
  return crees;
}

// ================================================================= les suivis

export interface SuiviSaisie {
  rubriqueId?: unknown;
  pieceId?: unknown;
  libelle?: unknown;
  periodiciteMois?: unknown;
  rappelJours?: unknown;
  echeanceInitiale?: unknown;
  actif?: unknown;
  notes?: unknown;
}

/** La pièce appartient-elle au bâtiment ? Une pièce absente est acceptée. */
async function pieceDuSite(pieceId: number | null, siteId: number): Promise<boolean> {
  if (!pieceId) return true;
  const piece = await db.queryOne('SELECT site_id FROM site_pieces WHERE id = ?', [pieceId]);
  return Boolean(piece) && Number(piece.site_id) === Number(siteId);
}

export async function creerSuivi(siteId: number, saisie: SuiviSaisie, userId: number | null): Promise<number> {
  const rubriqueId = identifiant(saisie.rubriqueId);
  if (!rubriqueId || !(await lireRubrique(rubriqueId))) throw new ErreurBatiment(400, 'Rubrique inconnue');
  const pieceId = identifiant(saisie.pieceId);
  if (!(await pieceDuSite(pieceId, siteId))) throw new ErreurBatiment(400, "Cette pièce n'est pas dans ce bâtiment");

  const maintenant = versDateTime();
  const resultat = await db.execute(
    `INSERT INTO batiment_suivis
       (site_id, rubrique_id, piece_id, libelle, periodicite_mois, rappel_jours, echeance_initiale,
        actif, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId,
      rubriqueId,
      pieceId,
      texte(saisie.libelle),
      entierBorne(saisie.periodiciteMois, MAX_PERIODICITE, 'Périodicité') ?? null,
      entierBorne(saisie.rappelJours, MAX_RAPPEL, 'Délai de rappel') ?? null,
      jourOuNull(saisie.echeanceInitiale, 'Échéance'),
      saisie.actif === undefined || saisie.actif ? 1 : 0,
      texte(saisie.notes, 5000),
      userId,
      maintenant,
      maintenant,
    ]
  );
  return Number(resultat.lastInsertRowid);
}

export async function modifierSuivi(id: number, saisie: SuiviSaisie): Promise<void> {
  const suivi = await db.queryOne('SELECT * FROM batiment_suivis WHERE id = ?', [id]);
  if (!suivi) throw new ErreurBatiment(404, 'Suivi introuvable');

  const champs: string[] = [];
  const valeurs: unknown[] = [];
  const poser = (colonne: string, valeur: unknown) => {
    champs.push(`${colonne} = ?`);
    valeurs.push(valeur);
  };

  if (saisie.pieceId !== undefined) {
    const pieceId = identifiant(saisie.pieceId);
    if (!(await pieceDuSite(pieceId, Number(suivi.site_id)))) {
      throw new ErreurBatiment(400, "Cette pièce n'est pas dans ce bâtiment");
    }
    poser('piece_id', pieceId);
  }
  if (saisie.libelle !== undefined) poser('libelle', texte(saisie.libelle));
  const periodicite = entierBorne(saisie.periodiciteMois, MAX_PERIODICITE, 'Périodicité');
  if (periodicite !== undefined) poser('periodicite_mois', periodicite);
  const rappel = entierBorne(saisie.rappelJours, MAX_RAPPEL, 'Délai de rappel');
  if (rappel !== undefined) poser('rappel_jours', rappel);
  if (saisie.echeanceInitiale !== undefined) poser('echeance_initiale', jourOuNull(saisie.echeanceInitiale, 'Échéance'));
  if (saisie.actif !== undefined) poser('actif', saisie.actif ? 1 : 0);
  if (saisie.notes !== undefined) poser('notes', texte(saisie.notes, 5000));
  if (champs.length === 0) return;

  poser('updated_at', versDateTime());
  await db.execute(`UPDATE batiment_suivis SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
  await retirerAlerteSuivi(id);
}

/** Supprime le suivi ; ses documents restent, sans suivi (`SET NULL`). */
export async function supprimerSuivi(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_suivis WHERE id = ?', [id]);
  await retirerAlerteSuivi(id);
}

// ================================================================== l'état

export interface EtatSuivi {
  suiviId: number;
  siteId: number;
  siteNom: string;
  rubriqueId: number;
  rubriqueLibelle: string;
  nature: Nature;
  libelle: string | null;
  pieceId: number | null;
  pieceNom: string | null;
  periodiciteMois: number | null;
  rappelJours: number;
  /** Les valeurs propres au suivi, `null` quand il suit la rubrique. */
  surcharge: { periodiciteMois: number | null; rappelJours: number | null };
  echeanceInitiale: string | null;
  actif: boolean;
  notes: string | null;
  dernierDocument: {
    id: number;
    titre: string;
    date: string | null;
    resultat: Resultat | null;
  } | null;
  echeance: string | null;
  /** Négatif une fois l'échéance passée. */
  joursRestants: number | null;
  enRetard: boolean;
  /** Dans le délai de rappel, ou déjà en retard : ce qui lève une alerte. */
  dansFenetre: boolean;
  statut: StatutSuivi;
}

/**
 * Le dernier document validé d'un suivi : aucun autre, validé lui aussi, n'est
 * plus récent. Même tournure que `CONTROLE_PLUS_RECENT`, et pour la même
 * raison — `NOT EXISTS` se lit sur les deux moteurs, là où une fonction de
 * fenêtre n'existe pas en MySQL 5.7.
 */
const DOCUMENT_PLUS_RECENT = `SELECT 1 FROM batiment_documents plus
   WHERE plus.suivi_id = d.suivi_id AND plus.statut = 'valide'
     AND (COALESCE(plus.date_document, '') > COALESCE(d.date_document, '')
          OR (COALESCE(plus.date_document, '') = COALESCE(d.date_document, '') AND plus.id > d.id))`;

export interface FiltreEtat {
  /** `null` ou absent : tous les bâtiments. */
  siteIds?: number[] | null;
  suiviId?: number;
  /** Suivis actifs, de rubriques actives, sur des bâtiments actifs : ce que les alertes regardent. */
  actifsSeulement?: boolean;
}

/**
 * L'état de chaque suivi : dernière réalisation, échéance, statut.
 *
 * `aujourdhui` est un paramètre pour que les tests fixent le calendrier ; en
 * service, c'est le jour local du serveur, comme pour les plannings.
 */
export async function etatDesSuivis(filtre: FiltreEtat = {}, aujourdhui = jourCourant()): Promise<EtatSuivi[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filtre.siteIds) {
    if (filtre.siteIds.length === 0) return [];
    conditions.push(`s.site_id IN (${filtre.siteIds.map(() => '?').join(', ')})`);
    params.push(...filtre.siteIds);
  }
  if (filtre.suiviId) {
    conditions.push('s.id = ?');
    params.push(filtre.suiviId);
  }
  if (filtre.actifsSeulement) {
    conditions.push('s.actif = 1 AND r.is_active = 1 AND COALESCE(cs.is_active, 1) = 1');
  }

  const lignes = await db.query(
    `SELECT s.id, s.site_id, cs.name AS site_nom, s.rubrique_id, r.libelle AS rubrique_libelle,
            r.nature, s.libelle, s.piece_id, p.name AS piece_nom,
            s.periodicite_mois AS s_periodicite, r.periodicite_mois AS r_periodicite,
            s.rappel_jours AS s_rappel, r.rappel_jours AS r_rappel,
            s.echeance_initiale, s.actif, s.notes,
            d.id AS document_id, d.titre AS document_titre, d.date_document,
            d.prochaine_echeance, d.resultat
       FROM batiment_suivis s
       JOIN batiment_rubriques r ON r.id = s.rubrique_id
       JOIN cle_sites cs ON cs.id = s.site_id
       LEFT JOIN site_pieces p ON p.id = s.piece_id
       LEFT JOIN batiment_documents d
              ON d.suivi_id = s.id AND d.statut = 'valide' AND NOT EXISTS (${DOCUMENT_PLUS_RECENT})
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY cs.sort_order, cs.name, r.sort_order, r.libelle, s.id`,
    params
  );

  return lignes.map((l: any) => enEtat(l, aujourdhui));
}

const nombreOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function enEtat(l: any, aujourdhui: string): EtatSuivi {
  const periodicite = nombreOuNull(l.s_periodicite) ?? nombreOuNull(l.r_periodicite);
  const rappel = nombreOuNull(l.s_rappel) ?? nombreOuNull(l.r_rappel) ?? 30;
  const dateDocument = l.date_document ? versJour(l.date_document) : null;
  const aUnDocument = l.document_id !== null && l.document_id !== undefined;

  let echeance: string | null = l.prochaine_echeance ? versJour(l.prochaine_echeance) : null;
  if (!echeance && dateDocument && periodicite) echeance = decalerMois(dateDocument, periodicite);
  // L'échéance initiale ne vaut que tant que rien n'a été fait : un document
  // validé sans date ni périodicité ne doit pas ressusciter une vieille consigne.
  if (!echeance && !aUnDocument && l.echeance_initiale) echeance = versJour(l.echeance_initiale);

  const joursRestants = echeance ? nombreDeJours({ debut: aujourdhui, fin: echeance }) - 1 : null;
  const enRetard = joursRestants !== null && joursRestants < 0;
  const dansFenetre = joursRestants !== null && joursRestants <= rappel;
  const resultat: Resultat | null = aUnDocument ? (l.resultat ?? null) : null;

  let statut: StatutSuivi;
  if (enRetard) statut = 'en_retard';
  else if (resultat === 'non_conforme' || resultat === 'reserves') statut = 'non_conforme';
  else if (dansFenetre) statut = 'bientot';
  else if (echeance || aUnDocument) statut = 'a_jour';
  else statut = 'jamais';

  return {
    suiviId: Number(l.id),
    siteId: Number(l.site_id),
    siteNom: l.site_nom,
    rubriqueId: Number(l.rubrique_id),
    rubriqueLibelle: l.rubrique_libelle,
    nature: l.nature,
    libelle: l.libelle ?? null,
    pieceId: nombreOuNull(l.piece_id),
    pieceNom: l.piece_nom ?? null,
    periodiciteMois: periodicite,
    rappelJours: rappel,
    surcharge: { periodiciteMois: nombreOuNull(l.s_periodicite), rappelJours: nombreOuNull(l.s_rappel) },
    echeanceInitiale: l.echeance_initiale ? versJour(l.echeance_initiale) : null,
    actif: vrai(l.actif),
    notes: l.notes ?? null,
    dernierDocument: aUnDocument
      ? { id: Number(l.document_id), titre: l.document_titre, date: dateDocument, resultat }
      : null,
    echeance,
    joursRestants,
    enRetard,
    dansFenetre,
    statut,
  };
}

// ============================================================== les documents

export interface DocumentBatiment {
  id: number;
  siteId: number;
  siteNom: string;
  pieceId: number | null;
  pieceNom: string | null;
  rubriqueId: number | null;
  rubriqueLibelle: string | null;
  nature: Nature | null;
  suiviId: number | null;
  suiviLibelle: string | null;
  titre: string;
  description: string | null;
  commentaireDepot: string | null;
  nomOrigine: string;
  mime: string | null;
  taille: number | null;
  dateDocument: string | null;
  prochaineEcheance: string | null;
  resultat: Resultat | null;
  statut: StatutDocument;
  motifRefus: string | null;
  source: 'interne' | 'entreprise';
  deposePar: { id: number; nom: string } | null;
  /** L'entreprise extérieure qui l'a déposé par son portail. */
  entreprise: { id: number; nom: string } | null;
  validePar: { id: number; nom: string } | null;
  valideLe: string | null;
  creeLe: string | null;
}

const nomComplet = (prenom: unknown, nom: unknown): string =>
  [prenom, nom].filter(Boolean).join(' ').trim() || 'Compte supprimé';

function enDocument(l: any): DocumentBatiment {
  return {
    id: Number(l.id),
    siteId: Number(l.site_id),
    siteNom: l.site_nom,
    pieceId: nombreOuNull(l.piece_id),
    pieceNom: l.piece_nom ?? null,
    rubriqueId: nombreOuNull(l.rubrique_id),
    rubriqueLibelle: l.rubrique_libelle ?? null,
    nature: l.nature ?? null,
    suiviId: nombreOuNull(l.suivi_id),
    suiviLibelle: l.suivi_libelle ?? null,
    titre: l.titre,
    description: l.description ?? null,
    commentaireDepot: l.commentaire_depot ?? null,
    nomOrigine: l.nom_origine,
    mime: l.mime ?? null,
    taille: nombreOuNull(l.taille),
    dateDocument: l.date_document ? versJour(l.date_document) : null,
    prochaineEcheance: l.prochaine_echeance ? versJour(l.prochaine_echeance) : null,
    resultat: l.resultat ?? null,
    statut: l.statut,
    motifRefus: l.motif_refus ?? null,
    source: l.source,
    deposePar: l.depose_par ? { id: Number(l.depose_par), nom: nomComplet(l.depose_prenom, l.depose_nom) } : null,
    entreprise: l.entreprise_id ? { id: Number(l.entreprise_id), nom: l.entreprise_nom ?? 'Entreprise supprimée' } : null,
    validePar: l.valide_par ? { id: Number(l.valide_par), nom: nomComplet(l.valide_prenom, l.valide_nom) } : null,
    valideLe: l.valide_le ? String(l.valide_le) : null,
    creeLe: l.created_at ? String(l.created_at) : null,
  };
}

const SELECT_DOCUMENT = `SELECT d.*, cs.name AS site_nom, p.name AS piece_nom,
       r.libelle AS rubrique_libelle, r.nature, s.libelle AS suivi_libelle,
       ud.first_name AS depose_prenom, ud.last_name AS depose_nom,
       uv.first_name AS valide_prenom, uv.last_name AS valide_nom
  FROM batiment_documents d
  JOIN cle_sites cs ON cs.id = d.site_id
  LEFT JOIN site_pieces p ON p.id = d.piece_id
  LEFT JOIN batiment_rubriques r ON r.id = d.rubrique_id
  LEFT JOIN batiment_suivis s ON s.id = d.suivi_id
  LEFT JOIN users ud ON ud.id = d.depose_par
  LEFT JOIN users uv ON uv.id = d.valide_par`;

export interface FiltreDocuments {
  siteIds?: number[] | null;
  statut?: StatutDocument;
  rubriqueId?: number;
  suiviId?: number;
  recherche?: string;
  limite?: number;
}

export async function listerDocuments(filtre: FiltreDocuments = {}): Promise<DocumentBatiment[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filtre.siteIds) {
    if (filtre.siteIds.length === 0) return [];
    conditions.push(`d.site_id IN (${filtre.siteIds.map(() => '?').join(', ')})`);
    params.push(...filtre.siteIds);
  }
  if (filtre.statut) {
    conditions.push('d.statut = ?');
    params.push(filtre.statut);
  }
  if (filtre.rubriqueId) {
    conditions.push('d.rubrique_id = ?');
    params.push(filtre.rubriqueId);
  }
  if (filtre.suiviId) {
    conditions.push('d.suivi_id = ?');
    params.push(filtre.suiviId);
  }
  if (filtre.recherche) {
    conditions.push('(d.titre LIKE ? OR d.nom_origine LIKE ?)');
    params.push(`%${filtre.recherche}%`, `%${filtre.recherche}%`);
  }

  const limite = filtre.limite && filtre.limite > 0 ? Math.min(filtre.limite, 1000) : 500;
  const lignes = await db.query(
    `${SELECT_DOCUMENT}
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY COALESCE(d.date_document, '') DESC, d.id DESC
      LIMIT ${limite}`,
    params
  );
  return (await avecEntreprises(lignes)).map(enDocument);
}

export async function lireDocument(id: number | string): Promise<DocumentBatiment | null> {
  const ligne = await db.queryOne(`${SELECT_DOCUMENT} WHERE d.id = ?`, [id]);
  return ligne ? enDocument((await avecEntreprises([ligne]))[0]) : null;
}

/**
 * Le nom de l'entreprise des documents déposés par le portail.
 *
 * Lu à part plutôt que joint dans `SELECT_DOCUMENT` : la colonne et la table
 * arrivent avec la migration 042, et une jointure ferait échouer toutes les
 * lectures de documents sur une base qui ne l'a pas encore vue. Ici, on ne va
 * chercher que si une ligne porte une entreprise — donc jamais avant la 042.
 */
async function avecEntreprises(lignes: any[]): Promise<any[]> {
  const ids = [...new Set(lignes.map((l) => l.entreprise_id).filter(Boolean).map(Number))];
  if (ids.length === 0) return lignes;
  const noms = new Map<number, string>(
    (await db.query(`SELECT id, nom FROM entreprises WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)).map(
      (e: any) => [Number(e.id), e.nom]
    )
  );
  return lignes.map((l) => (l.entreprise_id ? { ...l, entreprise_nom: noms.get(Number(l.entreprise_id)) } : l));
}

/** Le chemin sur le disque, lu pour servir ou supprimer le fichier. */
export async function cheminDuDocument(id: number | string): Promise<string | null> {
  const ligne = await db.queryOne('SELECT chemin FROM batiment_documents WHERE id = ?', [id]);
  return ligne ? String(ligne.chemin) : null;
}

/**
 * Le chemin complet d'un fichier du dossier privé, ou `null`.
 *
 * `chemin` est relatif au dossier des bâtiments ; tout ce qui en sortirait —
 * `../`, un chemin absolu — est refusé. Un chemin fabriqué ne doit pouvoir ni
 * faire envoyer ni faire supprimer un fichier de l'application.
 */
export function cheminPrive(chemin: string | null | undefined): string | null {
  if (!chemin) return null;
  try {
    const racine = path.resolve(dossierPrive(SOUS_DOSSIER));
    const complet = path.resolve(racine, chemin);
    if (!complet.startsWith(racine + path.sep)) return null;
    return fs.existsSync(complet) ? complet : null;
  } catch {
    return null;
  }
}

/** Retire un fichier du dossier privé. L'échec n'est jamais fatal. */
export function supprimerFichierPrive(chemin: string | null | undefined): boolean {
  const complet = cheminPrive(chemin);
  if (!complet) return false;
  try {
    fs.unlinkSync(complet);
    return true;
  } catch (erreur: any) {
    console.error('Fichier de bâtiment non supprimé :', erreur?.message ?? erreur);
    return false;
  }
}

export interface ClassementSaisie {
  siteId?: unknown;
  pieceId?: unknown;
  rubriqueId?: unknown;
  suiviId?: unknown;
  titre?: unknown;
  description?: unknown;
  dateDocument?: unknown;
  prochaineEcheance?: unknown;
  resultat?: unknown;
  /** À la validation : créer le suivi quand le bâtiment n'en a pas pour cette rubrique. */
  creerSuivi?: unknown;
}

export interface DepotSaisie extends ClassementSaisie {
  siteId: number;
  commentaireDepot?: unknown;
  source: 'interne' | 'entreprise';
  deposePar: number | null;
  /** Le dépôt vient du portail de cette entreprise. */
  entrepriseId?: number;
  fichier: { chemin: string; nomOrigine: string; mime: string | null; taille: number | null };
  /** Présent quand le déposant gère le bâtiment : le dépôt vaut validation. */
  validePar?: number;
}

/**
 * Le suivi auquel rattacher un document validé.
 *
 * Donné explicitement, il doit correspondre au bâtiment et à la rubrique. Sinon
 * on le déduit : le seul suivi actif de la rubrique dans ce bâtiment, ou celui
 * de la pièce quand il y en a plusieurs. Faute de suivi, on en crée un — si la
 * rubrique a une périodicité, sans quoi il n'y aurait rien à suivre.
 */
async function resoudreSuivi(
  siteId: number,
  rubriqueId: number | null,
  suiviDemande: number | null,
  pieceId: number | null,
  creer: boolean,
  userId: number | null
): Promise<{ suiviId: number | null; cree: boolean }> {
  if (!rubriqueId) {
    if (suiviDemande) throw new ErreurBatiment(400, 'Choisissez un objet avant de rattacher un suivi');
    return { suiviId: null, cree: false };
  }

  if (suiviDemande) {
    const suivi = await db.queryOne('SELECT id, site_id, rubrique_id FROM batiment_suivis WHERE id = ?', [
      suiviDemande,
    ]);
    if (!suivi || Number(suivi.site_id) !== siteId || Number(suivi.rubrique_id) !== rubriqueId) {
      throw new ErreurBatiment(400, "Ce suivi ne correspond pas au bâtiment et à l'objet choisis");
    }
    return { suiviId: Number(suivi.id), cree: false };
  }

  const suivis = await db.query(
    'SELECT id, piece_id, actif FROM batiment_suivis WHERE site_id = ? AND rubrique_id = ? ORDER BY actif DESC, id',
    [siteId, rubriqueId]
  );
  const actifs = suivis.filter((s: any) => vrai(s.actif));
  const candidats = actifs.length > 0 ? actifs : suivis;

  if (candidats.length === 1) return { suiviId: Number(candidats[0].id), cree: false };
  if (candidats.length > 1) {
    const dePiece = pieceId ? candidats.filter((s: any) => Number(s.piece_id) === pieceId) : [];
    if (dePiece.length === 1) return { suiviId: Number(dePiece[0].id), cree: false };
    throw new ErreurBatiment(400, 'Ce bâtiment a plusieurs suivis pour cet objet : précisez lequel');
  }

  const rubrique = await lireRubrique(rubriqueId);
  if (!creer || !rubrique?.periodiciteMois) return { suiviId: null, cree: false };
  return { suiviId: await creerSuivi(siteId, { rubriqueId }, userId), cree: true };
}

/** La périodicité qui vaut pour ce suivi, ou à défaut pour la rubrique. */
async function periodiciteDe(suiviId: number | null, rubriqueId: number | null): Promise<number | null> {
  if (suiviId) {
    const ligne = await db.queryOne(
      `SELECT COALESCE(s.periodicite_mois, r.periodicite_mois) AS p
         FROM batiment_suivis s JOIN batiment_rubriques r ON r.id = s.rubrique_id WHERE s.id = ?`,
      [suiviId]
    );
    return nombreOuNull(ligne?.p);
  }
  if (rubriqueId) return (await lireRubrique(rubriqueId))?.periodiciteMois ?? null;
  return null;
}

interface Classement {
  siteId: number;
  pieceId: number | null;
  rubriqueId: number | null;
  suiviId: number | null;
  titre: string;
  description: string | null;
  dateDocument: string | null;
  prochaineEcheance: string | null;
  resultat: Resultat | null;
  suiviCree: boolean;
}

/**
 * Lit et vérifie une classification, en complétant par l'existant.
 *
 * `valider` décide si l'on rattache un suivi et calcule l'échéance : un
 * document en attente garde ce que le déposant a dit, sans rien engager.
 *
 * L'échéance suit une règle en trois temps : une date donnée l'emporte ; une
 * valeur vide demande le calcul ; l'absence du champ garde l'échéance connue,
 * sauf si la date, l'objet ou le suivi ont changé — elle serait alors fausse.
 */
async function classer(
  existant: Partial<Classement> & { siteId: number; titre: string },
  saisie: ClassementSaisie,
  valider: boolean,
  userId: number | null
): Promise<Classement> {
  const siteId = saisie.siteId !== undefined ? identifiant(saisie.siteId) : existant.siteId;
  if (!siteId || !(await db.queryOne('SELECT id FROM cle_sites WHERE id = ?', [siteId]))) {
    throw new ErreurBatiment(400, 'Bâtiment inconnu');
  }

  // Changer de bâtiment fait perdre la pièce et le suivi de l'ancien.
  const memeSite = siteId === existant.siteId;
  const pieceId =
    saisie.pieceId !== undefined ? identifiant(saisie.pieceId) : memeSite ? (existant.pieceId ?? null) : null;
  if (!(await pieceDuSite(pieceId, siteId))) throw new ErreurBatiment(400, "Cette pièce n'est pas dans ce bâtiment");

  const rubriqueId = saisie.rubriqueId !== undefined ? identifiant(saisie.rubriqueId) : (existant.rubriqueId ?? null);
  if (rubriqueId && !(await lireRubrique(rubriqueId))) throw new ErreurBatiment(400, 'Objet inconnu');

  const titre = saisie.titre !== undefined ? texte(saisie.titre) : existant.titre;
  if (!titre) throw new ErreurBatiment(400, 'Le titre est obligatoire');

  const description =
    saisie.description !== undefined ? texte(saisie.description, 5000) : (existant.description ?? null);
  const dateDocument =
    saisie.dateDocument !== undefined ? jourOuNull(saisie.dateDocument, 'Date du document') : (existant.dateDocument ?? null);
  const resultat = saisie.resultat !== undefined ? resultatOuNull(saisie.resultat) : (existant.resultat ?? null);

  let suiviId: number | null = null;
  let suiviCree = false;
  if (valider) {
    const suiviDemande =
      saisie.suiviId !== undefined
        ? identifiant(saisie.suiviId)
        : memeSite && rubriqueId === existant.rubriqueId
          ? (existant.suiviId ?? null)
          : null;
    const creer = saisie.creerSuivi === undefined ? true : saisie.creerSuivi !== false && saisie.creerSuivi !== 'false';
    ({ suiviId, cree: suiviCree } = await resoudreSuivi(siteId, rubriqueId, suiviDemande, pieceId, creer, userId));
  }

  let prochaineEcheance: string | null;
  const echeanceDonnee = saisie.prochaineEcheance;
  if (echeanceDonnee !== undefined && echeanceDonnee !== null && echeanceDonnee !== '') {
    prochaineEcheance = jourOuNull(echeanceDonnee, 'Prochaine échéance');
  } else {
    const inchange =
      echeanceDonnee === undefined &&
      dateDocument === (existant.dateDocument ?? null) &&
      rubriqueId === (existant.rubriqueId ?? null) &&
      (!valider || suiviId === (existant.suiviId ?? null));
    if (inchange && existant.prochaineEcheance) {
      prochaineEcheance = existant.prochaineEcheance;
    } else if (valider && dateDocument) {
      const periodicite = await periodiciteDe(suiviId, rubriqueId);
      prochaineEcheance = periodicite ? decalerMois(dateDocument, periodicite) : null;
    } else {
      prochaineEcheance = null;
    }
  }

  return { siteId, pieceId, rubriqueId, suiviId, titre, description, dateDocument, prochaineEcheance, resultat, suiviCree };
}

/** Enregistre un document déposé. Rend son identifiant, son statut, et le suivi créé s'il y en a un. */
export async function joindre(
  depot: DepotSaisie
): Promise<{ id: number; statut: StatutDocument; suiviId: number | null; suiviCree: boolean }> {
  const titreParDefaut = path.parse(depot.fichier.nomOrigine).name || depot.fichier.nomOrigine;
  const valider = depot.validePar !== undefined;
  const classement = await classer(
    { siteId: depot.siteId, titre: titreParDefaut },
    { ...depot, siteId: depot.siteId, titre: texte(depot.titre) ?? titreParDefaut },
    valider,
    depot.deposePar
  );

  const maintenant = versDateTime();
  const statut: StatutDocument = valider ? 'valide' : 'a_valider';
  // `entreprise_id` n'existe qu'à partir de la migration 042 : on ne le nomme
  // que pour un dépôt qui vient du portail, donc forcément après elle.
  const parEntreprise = depot.entrepriseId !== undefined;
  const resultat = await db.execute(
    `INSERT INTO batiment_documents
       (site_id, piece_id, rubrique_id, suivi_id, titre, description, commentaire_depot,
        chemin, nom_origine, mime, taille, date_document, prochaine_echeance, resultat,
        statut, source, depose_par, valide_par, valide_le, created_at, updated_at${parEntreprise ? ', entreprise_id' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${parEntreprise ? ', ?' : ''})`,
    [
      classement.siteId,
      classement.pieceId,
      classement.rubriqueId,
      classement.suiviId,
      classement.titre,
      classement.description,
      texte(depot.commentaireDepot, 5000),
      depot.fichier.chemin,
      depot.fichier.nomOrigine.slice(0, 255),
      depot.fichier.mime,
      depot.fichier.taille,
      classement.dateDocument,
      classement.prochaineEcheance,
      classement.resultat,
      statut,
      depot.source,
      depot.deposePar,
      valider ? depot.validePar : null,
      valider ? maintenant : null,
      maintenant,
      maintenant,
      ...(parEntreprise ? [depot.entrepriseId] : []),
    ]
  );

  if (valider) await retirerAlerteSuivi(classement.suiviId);
  return {
    id: Number(resultat.lastInsertRowid),
    statut,
    suiviId: classement.suiviId,
    suiviCree: classement.suiviCree,
  };
}

async function existantPourClassement(id: number): Promise<any> {
  const ligne = await db.queryOne('SELECT * FROM batiment_documents WHERE id = ?', [id]);
  if (!ligne) throw new ErreurBatiment(404, 'Document introuvable');
  return ligne;
}

const enClassement = (l: any): Partial<Classement> & { siteId: number; titre: string } => ({
  siteId: Number(l.site_id),
  pieceId: nombreOuNull(l.piece_id),
  rubriqueId: nombreOuNull(l.rubrique_id),
  suiviId: nombreOuNull(l.suivi_id),
  titre: l.titre,
  description: l.description ?? null,
  dateDocument: l.date_document ? versJour(l.date_document) : null,
  prochaineEcheance: l.prochaine_echeance ? versJour(l.prochaine_echeance) : null,
  resultat: l.resultat ?? null,
});

async function ecrireClassement(id: number, c: Classement, extra: Record<string, unknown> = {}): Promise<void> {
  const colonnes: Record<string, unknown> = {
    site_id: c.siteId,
    piece_id: c.pieceId,
    rubrique_id: c.rubriqueId,
    suivi_id: c.suiviId,
    titre: c.titre,
    description: c.description,
    date_document: c.dateDocument,
    prochaine_echeance: c.prochaineEcheance,
    resultat: c.resultat,
    ...extra,
    updated_at: versDateTime(),
  };
  const noms = Object.keys(colonnes);
  await db.execute(`UPDATE batiment_documents SET ${noms.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, [
    ...noms.map((n) => colonnes[n]),
    id,
  ]);
}

/**
 * Reclasse un document sans changer son statut.
 *
 * Un document validé est reclassé comme à la validation — suivi et échéance
 * recalculés. Un document en attente garde seulement ce qu'on en dit.
 */
export async function modifierDocument(
  id: number,
  saisie: ClassementSaisie,
  userId: number
): Promise<{ suiviId: number | null; suiviCree: boolean }> {
  const ligne = await existantPourClassement(id);
  const valide = ligne.statut === 'valide';
  const classement = await classer(enClassement(ligne), saisie, valide, userId);
  await ecrireClassement(id, valide ? classement : { ...classement, suiviId: nombreOuNull(ligne.suivi_id) });
  if (valide) {
    await retirerAlerteSuivi(nombreOuNull(ligne.suivi_id));
    await retirerAlerteSuivi(classement.suiviId);
  }
  return { suiviId: classement.suiviId, suiviCree: classement.suiviCree };
}

/** Valide un document, en le reclassant au passage. */
export async function validerDocument(
  id: number,
  saisie: ClassementSaisie,
  userId: number
): Promise<{ suiviId: number | null; suiviCree: boolean; prochaineEcheance: string | null }> {
  const ligne = await existantPourClassement(id);
  const classement = await classer(enClassement(ligne), saisie, true, userId);
  await ecrireClassement(id, classement, {
    statut: 'valide',
    motif_refus: null,
    valide_par: userId,
    valide_le: versDateTime(),
  });
  await retirerAlerteSuivi(nombreOuNull(ligne.suivi_id));
  await retirerAlerteSuivi(classement.suiviId);
  return {
    suiviId: classement.suiviId,
    suiviCree: classement.suiviCree,
    prochaineEcheance: classement.prochaineEcheance,
  };
}

/** Refuse un document. Le motif est obligatoire : c'est lui qu'on renvoie au déposant. */
export async function refuserDocument(id: number, motif: unknown, userId: number): Promise<void> {
  const ligne = await existantPourClassement(id);
  const raison = texte(motif, 2000);
  if (!raison) throw new ErreurBatiment(400, 'Le motif du refus est obligatoire');
  await db.execute(
    `UPDATE batiment_documents
        SET statut = 'refuse', motif_refus = ?, valide_par = ?, valide_le = ?, updated_at = ?
      WHERE id = ?`,
    [raison, userId, versDateTime(), versDateTime(), id]
  );
  // Un document validé qu'on refuse ne fait plus foi : l'échéance recule.
  if (ligne.statut === 'valide') await retirerAlerteSuivi(nombreOuNull(ligne.suivi_id));
}

/** Supprime la ligne et le fichier. */
export async function detacherDocument(id: number): Promise<void> {
  const ligne = await existantPourClassement(id);
  await db.execute('DELETE FROM batiment_documents WHERE id = ?', [id]);
  supprimerFichierPrive(ligne.chemin);
  if (ligne.statut === 'valide') await retirerAlerteSuivi(nombreOuNull(ligne.suivi_id));
}

// ============================================================== le périmètre

interface Appelant {
  userId: number;
  role: string;
}

/**
 * Les bâtiments que ce compte voit dans le module : `null` pour tous.
 *
 * Tous pour qui gère les lieux — administrateur, superviseur, gestionnaire
 * global ; sinon ceux qu'il gère ou dont il est responsable.
 */
export async function perimetreBatiments(appelant: Appelant): Promise<number[] | null> {
  if (await peutGererLieux(appelant)) return null;
  return sitesConsultesPar(appelant.userId);
}

/**
 * Le filtre à ajouter à une requête sur `alerts a` pour que les alertes
 * d'échéance ne se montrent qu'à qui suit le bâtiment.
 *
 * Sans lui, l'échéance des extincteurs de l'école s'afficherait dans la
 * pastille de chaque agent de la commune, qui n'y peut rien.
 */
export async function filtreAlertesBatiments(appelant: Appelant): Promise<{ sql: string; params: unknown[] }> {
  const sites = await perimetreBatiments(appelant);
  if (sites === null) return { sql: '', params: [] };
  if (sites.length === 0) {
    return {
      sql: ' AND (a.plugin_reference IS NULL OR a.plugin_reference NOT IN (?, ?))',
      params: [REFERENCE_ALERTE, REFERENCE_ALERTE_CONTRAT],
    };
  }
  // Un contrat se montre à qui suit au moins un des bâtiments qu'il couvre.
  const liste = sites.map(() => '?').join(', ');
  return {
    sql: ` AND (a.plugin_reference IS NULL OR a.plugin_reference NOT IN (?, ?)
                OR (a.plugin_reference = ? AND a.plugin_reference_id IN (
                  SELECT id FROM batiment_suivis WHERE site_id IN (${liste})
                ))
                OR (a.plugin_reference = ? AND a.plugin_reference_id IN (
                  SELECT contrat_id FROM batiment_contrat_sites WHERE site_id IN (${liste})
                )))`,
    params: [REFERENCE_ALERTE, REFERENCE_ALERTE_CONTRAT, REFERENCE_ALERTE, ...sites, REFERENCE_ALERTE_CONTRAT, ...sites],
  };
}

/** Les bâtiments, avec de quoi dire d'un coup d'œil où en sont leurs contrôles. */
export async function resumeDesBatiments(siteIds: number[] | null): Promise<
  Array<{
    id: number;
    nom: string;
    code: string | null;
    adresse: string | null;
    compteurs: Record<StatutSuivi | 'suivis' | 'aValider' | 'documents', number>;
  }>
> {
  if (siteIds && siteIds.length === 0) return [];
  const filtre = siteIds ? `AND id IN (${siteIds.map(() => '?').join(', ')})` : '';
  const sites = await db.query(
    `SELECT id, name, code, address FROM cle_sites
      WHERE COALESCE(is_active, 1) = 1 ${filtre}
      ORDER BY sort_order, name`,
    siteIds ?? []
  );

  const etats = await etatDesSuivis({ siteIds, actifsSeulement: true });
  const documents = await db.query(
    `SELECT site_id, statut, COUNT(*) AS n FROM batiment_documents
      ${siteIds ? `WHERE site_id IN (${siteIds.map(() => '?').join(', ')})` : ''}
      GROUP BY site_id, statut`,
    siteIds ?? []
  );

  return sites.map((s: any) => {
    const id = Number(s.id);
    const compteurs = { suivis: 0, en_retard: 0, non_conforme: 0, bientot: 0, a_jour: 0, jamais: 0, aValider: 0, documents: 0 };
    for (const e of etats) {
      if (e.siteId !== id) continue;
      compteurs.suivis++;
      compteurs[e.statut]++;
    }
    for (const d of documents) {
      if (Number(d.site_id) !== id) continue;
      compteurs.documents += Number(d.n);
      if (d.statut === 'a_valider') compteurs.aValider += Number(d.n);
    }
    return { id, nom: s.name, code: s.code ?? null, adresse: s.address ?? null, compteurs };
  });
}

// ================================================================== les alertes

/**
 * Retire l'alerte d'un suivi dont l'échéance vient de bouger.
 *
 * Le passage suivant de la vérification la repose si elle a encore lieu d'être,
 * avec la bonne date : garder l'ancienne ferait tenir un rejet posé sur une
 * échéance qui n'existe plus, ou afficher « en retard » un contrôle qu'on vient
 * de valider.
 */
export async function retirerAlerteSuivi(suiviId: number | null | undefined): Promise<void> {
  if (!suiviId) return;
  await db.execute('DELETE FROM alerts WHERE plugin_reference = ? AND plugin_reference_id = ?', [
    REFERENCE_ALERTE,
    suiviId,
  ]);
}

async function retirerAlertesRubrique(rubriqueId: number): Promise<void> {
  await db.execute(
    `DELETE FROM alerts WHERE plugin_reference = ?
        AND plugin_reference_id IN (SELECT id FROM batiment_suivis WHERE rubrique_id = ?)`,
    [REFERENCE_ALERTE, rubriqueId]
  );
}

/**
 * À qui écrire au sujet d'un bâtiment.
 *
 * Ses gestionnaires d'abord ; faute de gestionnaire local, ceux de toute
 * l'organisation ; faute de ceux-là, les administrateurs et superviseurs. On ne
 * prévient pas tout le monde à la fois : le gestionnaire global de quarante
 * bâtiments recevrait quarante courriels pour des contrôles qu'un autre suit
 * déjà.
 */
export async function destinatairesBatiment(siteId: number): Promise<string[]> {
  const actifs = 'u.is_active = 1 AND u.can_login = 1 AND u.email IS NOT NULL';

  const locaux = await db.query(
    `SELECT DISTINCT u.email FROM users u JOIN user_sites us ON us.user_id = u.id
      WHERE us.site_id = ? AND us.gere_lieu = 1 AND ${actifs}`,
    [siteId]
  );
  if (locaux.length > 0) return locaux.map((u: any) => u.email);

  const globaux = await db.query(`SELECT u.email FROM users u WHERE u.gere_organisation = 1 AND ${actifs}`);
  if (globaux.length > 0) return globaux.map((u: any) => u.email);

  const responsables = await db.query(
    `SELECT u.email FROM users u WHERE u.role IN ('admin', 'supervisor') AND ${actifs}`
  );
  return responsables.map((u: any) => u.email);
}
