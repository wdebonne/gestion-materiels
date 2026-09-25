import { db } from '../database';
import { estJourValide, partDansFenetre, versJour } from '../utils/periodes';
import { ErreurBatiment, identifiant, jourOuNull, texte } from './batiments.service';
import { versDateTime } from './tickets.service';

/**
 * L'énergie des bâtiments : compteurs, relevés, factures.
 *
 * Un nom à part — `compteurs.service.ts` désigne déjà les compteurs des
 * véhicules (kilomètres, heures moteur), qui n'ont rien à voir.
 *
 * ## Un compteur ne recule pas
 *
 * Un relevé inférieur au précédent est refusé : c'est presque toujours une
 * faute de frappe, et elle ferait apparaître une consommation négative dans
 * les statistiques. Le remplacement d'un compteur se note en créant un nouveau
 * compteur, et en désactivant l'ancien.
 *
 * ## Une facture se répartit au jour
 *
 * La synthèse annuelle et les statistiques rangent chaque facture au prorata
 * des jours de sa période dans la fenêtre regardée (`partDansFenetre`). Une
 * facture sans période compte tout entière à sa date.
 */

export const ENERGIES = ['electricite', 'gaz', 'eau', 'fioul', 'chaleur', 'autre'] as const;
export type Energie = (typeof ENERGIES)[number];

/** L'unité proposée d'emblée, modifiable : le gaz se facture en kWh, pas en m³. */
export const UNITE_PAR_DEFAUT: Record<Energie, string> = {
  electricite: 'kWh',
  gaz: 'kWh',
  eau: 'm3',
  fioul: 'L',
  chaleur: 'kWh',
  autre: '',
};

const nombreOuNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const vrai = (v: unknown): boolean => Boolean(Number(v ?? 0));

function lireEnergie(valeur: unknown): Energie {
  if (!ENERGIES.includes(valeur as Energie)) throw new ErreurBatiment(400, 'Énergie inconnue');
  return valeur as Energie;
}

/** Un montant : nombre fini, négatif accepté (avoir, régularisation), deux décimales. */
function lireMontant(valeur: unknown, champ: string, obligatoire = false): number | null {
  if (valeur === undefined || valeur === null || valeur === '') {
    if (obligatoire) throw new ErreurBatiment(400, `${champ} : montant obligatoire`);
    return null;
  }
  const n = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new ErreurBatiment(400, `${champ} : montant invalide`);
  return Math.round(n * 100) / 100;
}

function lireQuantite(valeur: unknown, champ: string): number | null {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const n = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ErreurBatiment(400, `${champ} : quantité invalide`);
  return n;
}

async function fournisseurValide(valeur: unknown): Promise<number | null> {
  const id = identifiant(valeur);
  if (!id) return null;
  if (!(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [id]))) throw new ErreurBatiment(400, 'Fournisseur inconnu');
  return id;
}

/** Les entreprises, nommées seulement : de quoi choisir un fournisseur sans voir leur fiche. */
export async function listerFournisseurs(): Promise<{ id: number; nom: string }[]> {
  return (await db.query('SELECT id, nom FROM entreprises WHERE actif = 1 ORDER BY nom')).map((e: any) => ({
    id: Number(e.id),
    nom: e.nom,
  }));
}

// ============================================================== les compteurs

export interface Compteur {
  id: number;
  siteId: number;
  energie: Energie;
  libelle: string | null;
  numero: string | null;
  unite: string;
  fournisseur: { id: number; nom: string } | null;
  actif: boolean;
  notes: string | null;
  dernierReleve: { date: string; index: number } | null;
}

export async function listerCompteurs(siteId: number): Promise<Compteur[]> {
  const lignes = await db.query(
    `SELECT c.*, e.nom AS fournisseur_nom,
            (SELECT r.date_releve FROM batiment_releves r WHERE r.compteur_id = c.id
              ORDER BY r.date_releve DESC, r.id DESC LIMIT 1) AS dernier_date,
            (SELECT r.index_valeur FROM batiment_releves r WHERE r.compteur_id = c.id
              ORDER BY r.date_releve DESC, r.id DESC LIMIT 1) AS dernier_index
       FROM batiment_compteurs c
       LEFT JOIN entreprises e ON e.id = c.fournisseur_id
      WHERE c.site_id = ?
      ORDER BY c.actif DESC, c.energie, c.libelle`,
    [siteId]
  );
  return lignes.map((l: any) => ({
    id: Number(l.id),
    siteId: Number(l.site_id),
    energie: l.energie,
    libelle: l.libelle ?? null,
    numero: l.numero ?? null,
    unite: l.unite,
    fournisseur: l.fournisseur_id ? { id: Number(l.fournisseur_id), nom: l.fournisseur_nom ?? '' } : null,
    actif: vrai(l.actif),
    notes: l.notes ?? null,
    dernierReleve: l.dernier_date ? { date: versJour(l.dernier_date), index: Number(l.dernier_index) } : null,
  }));
}

export interface CompteurSaisie {
  energie?: unknown;
  libelle?: unknown;
  numero?: unknown;
  unite?: unknown;
  fournisseurId?: unknown;
  actif?: unknown;
  notes?: unknown;
}

export async function creerCompteur(siteId: number, saisie: CompteurSaisie): Promise<number> {
  const energie = lireEnergie(saisie.energie);
  const unite = texte(saisie.unite, 20) ?? UNITE_PAR_DEFAUT[energie];
  if (!unite) throw new ErreurBatiment(400, "L'unité est obligatoire");
  const maintenant = versDateTime();
  const r = await db.execute(
    `INSERT INTO batiment_compteurs (site_id, energie, libelle, numero, unite, fournisseur_id, actif, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      siteId,
      energie,
      texte(saisie.libelle),
      texte(saisie.numero, 100),
      unite,
      await fournisseurValide(saisie.fournisseurId),
      texte(saisie.notes, 5000),
      maintenant,
      maintenant,
    ]
  );
  return Number(r.lastInsertRowid);
}

export async function modifierCompteur(id: number, saisie: CompteurSaisie): Promise<void> {
  if (!(await db.queryOne('SELECT id FROM batiment_compteurs WHERE id = ?', [id]))) {
    throw new ErreurBatiment(404, 'Compteur introuvable');
  }
  const champs: string[] = [];
  const valeurs: unknown[] = [];
  const poser = (c: string, v: unknown) => {
    champs.push(`${c} = ?`);
    valeurs.push(v);
  };
  if (saisie.energie !== undefined) poser('energie', lireEnergie(saisie.energie));
  if (saisie.libelle !== undefined) poser('libelle', texte(saisie.libelle));
  if (saisie.numero !== undefined) poser('numero', texte(saisie.numero, 100));
  if (saisie.unite !== undefined) {
    const unite = texte(saisie.unite, 20);
    if (!unite) throw new ErreurBatiment(400, "L'unité est obligatoire");
    poser('unite', unite);
  }
  if (saisie.fournisseurId !== undefined) poser('fournisseur_id', await fournisseurValide(saisie.fournisseurId));
  if (saisie.actif !== undefined) poser('actif', saisie.actif ? 1 : 0);
  if (saisie.notes !== undefined) poser('notes', texte(saisie.notes, 5000));
  if (champs.length === 0) return;
  poser('updated_at', versDateTime());
  await db.execute(`UPDATE batiment_compteurs SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
}

/** Supprime un compteur et ses relevés ; ses factures restent, sans compteur. */
export async function supprimerCompteur(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_compteurs WHERE id = ?', [id]);
}

// ================================================================ les relevés

export interface Releve {
  id: number;
  date: string;
  index: number;
  /** Depuis le relevé précédent ; `null` pour le premier. */
  consommation: number | null;
  notes: string | null;
}

export async function listerReleves(compteurId: number): Promise<Releve[]> {
  const lignes = await db.query(
    'SELECT * FROM batiment_releves WHERE compteur_id = ? ORDER BY date_releve, id',
    [compteurId]
  );
  let precedent: number | null = null;
  const releves = lignes.map((l: any) => {
    const index = Number(l.index_valeur);
    const r: Releve = {
      id: Number(l.id),
      date: versJour(l.date_releve),
      index,
      consommation: precedent === null ? null : Math.round((index - precedent) * 1000) / 1000,
      notes: l.notes ?? null,
    };
    precedent = index;
    return r;
  });
  return releves.reverse();
}

/**
 * Enregistre un relevé. Il doit tenir entre ses voisins de date : ni en dessous
 * du relevé précédent, ni au-dessus du suivant — un compteur ne recule pas.
 */
export async function ajouterReleve(
  compteurId: number,
  saisie: { date?: unknown; index?: unknown; notes?: unknown },
  userId: number
): Promise<number> {
  if (!(await db.queryOne('SELECT id FROM batiment_compteurs WHERE id = ?', [compteurId]))) {
    throw new ErreurBatiment(404, 'Compteur introuvable');
  }
  const date = jourOuNull(saisie.date, 'Date du relevé');
  if (!date) throw new ErreurBatiment(400, 'La date du relevé est obligatoire');
  const index = lireQuantite(saisie.index, 'Index');
  if (index === null) throw new ErreurBatiment(400, "L'index est obligatoire");

  const avant = await db.queryOne(
    'SELECT index_valeur FROM batiment_releves WHERE compteur_id = ? AND date_releve <= ? ORDER BY date_releve DESC, id DESC LIMIT 1',
    [compteurId, date]
  );
  if (avant && index < Number(avant.index_valeur)) {
    throw new ErreurBatiment(400, `Un compteur ne recule pas : le relevé précédent indique ${Number(avant.index_valeur)}`);
  }
  const apres = await db.queryOne(
    'SELECT index_valeur FROM batiment_releves WHERE compteur_id = ? AND date_releve > ? ORDER BY date_releve, id LIMIT 1',
    [compteurId, date]
  );
  if (apres && index > Number(apres.index_valeur)) {
    throw new ErreurBatiment(400, `Un relevé plus récent indique ${Number(apres.index_valeur)} : cet index ne peut pas le dépasser`);
  }

  const r = await db.execute(
    'INSERT INTO batiment_releves (compteur_id, date_releve, index_valeur, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [compteurId, date, index, texte(saisie.notes, 500), userId, versDateTime()]
  );
  return Number(r.lastInsertRowid);
}

export async function supprimerReleve(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_releves WHERE id = ?', [id]);
}

// ================================================================ les factures

export interface Facture {
  id: number;
  siteId: number;
  compteurId: number | null;
  compteurLibelle: string | null;
  energie: Energie;
  fournisseur: { id: number; nom: string } | null;
  numero: string | null;
  dateFacture: string;
  periodeDebut: string | null;
  periodeFin: string | null;
  consommation: number | null;
  unite: string | null;
  montantHt: number | null;
  montantTtc: number;
  estimee: boolean;
  document: { id: number; titre: string } | null;
  notes: string | null;
}

const SELECT_FACTURE = `SELECT f.*, e.nom AS fournisseur_nom, c.libelle AS compteur_libelle, c.numero AS compteur_numero,
       d.titre AS document_titre
  FROM batiment_factures f
  LEFT JOIN entreprises e ON e.id = f.fournisseur_id
  LEFT JOIN batiment_compteurs c ON c.id = f.compteur_id
  LEFT JOIN batiment_documents d ON d.id = f.document_id`;

function enFacture(l: any): Facture {
  return {
    id: Number(l.id),
    siteId: Number(l.site_id),
    compteurId: nombreOuNull(l.compteur_id),
    compteurLibelle: l.compteur_libelle ?? l.compteur_numero ?? null,
    energie: l.energie,
    fournisseur: l.fournisseur_id ? { id: Number(l.fournisseur_id), nom: l.fournisseur_nom ?? '' } : null,
    numero: l.numero ?? null,
    dateFacture: versJour(l.date_facture),
    periodeDebut: l.periode_debut ? versJour(l.periode_debut) : null,
    periodeFin: l.periode_fin ? versJour(l.periode_fin) : null,
    consommation: nombreOuNull(l.consommation),
    unite: l.unite ?? null,
    montantHt: nombreOuNull(l.montant_ht),
    montantTtc: Number(l.montant_ttc),
    estimee: vrai(l.estimee),
    document: l.document_id ? { id: Number(l.document_id), titre: l.document_titre ?? 'Document' } : null,
    notes: l.notes ?? null,
  };
}

/**
 * Les factures d'un ou plusieurs bâtiments. Avec une année : celles dont la
 * période — ou, à défaut, la date — touche cette année.
 */
export async function listerFactures(filtre: { siteIds: number[]; annee?: number; energie?: Energie }): Promise<Facture[]> {
  if (filtre.siteIds.length === 0) return [];
  const conditions = [`f.site_id IN (${filtre.siteIds.map(() => '?').join(', ')})`];
  const params: unknown[] = [...filtre.siteIds];
  if (filtre.annee) {
    conditions.push(`COALESCE(f.periode_fin, f.date_facture) >= ? AND COALESCE(f.periode_debut, f.date_facture) <= ?`);
    params.push(`${filtre.annee}-01-01`, `${filtre.annee}-12-31`);
  }
  if (filtre.energie) {
    conditions.push('f.energie = ?');
    params.push(filtre.energie);
  }
  const lignes = await db.query(
    `${SELECT_FACTURE} WHERE ${conditions.join(' AND ')} ORDER BY f.date_facture DESC, f.id DESC`,
    params
  );
  return lignes.map(enFacture);
}

export interface FactureSaisie {
  compteurId?: unknown;
  energie?: unknown;
  fournisseurId?: unknown;
  numero?: unknown;
  dateFacture?: unknown;
  periodeDebut?: unknown;
  periodeFin?: unknown;
  consommation?: unknown;
  unite?: unknown;
  montantHt?: unknown;
  montantTtc?: unknown;
  estimee?: unknown;
  documentId?: unknown;
  notes?: unknown;
}

/** Vérifie qu'un compteur ou un document appartient bien au bâtiment de la facture. */
async function duBatiment(table: 'batiment_compteurs' | 'batiment_documents', id: number | null, siteId: number, quoi: string) {
  if (!id) return null;
  const ligne = await db.queryOne(`SELECT site_id FROM ${table} WHERE id = ?`, [id]);
  if (!ligne || Number(ligne.site_id) !== siteId) throw new ErreurBatiment(400, `${quoi} n'est pas dans ce bâtiment`);
  return id;
}

async function lireFacture(siteId: number, saisie: FactureSaisie, existante?: any) {
  const valeur = <K extends keyof FactureSaisie>(cle: K, colonne: string) =>
    saisie[cle] !== undefined ? saisie[cle] : existante?.[colonne];

  const compteurId = await duBatiment('batiment_compteurs', identifiant(valeur('compteurId', 'compteur_id')), siteId, 'Ce compteur');
  const energieDuCompteur: Energie | null = compteurId
    ? (await db.queryOne('SELECT energie FROM batiment_compteurs WHERE id = ?', [compteurId])).energie
    : null;
  let energie: Energie;
  const brute = saisie.energie !== undefined ? saisie.energie : energieDuCompteur ?? existante?.energie;
  if (brute !== undefined && brute !== null && brute !== '') energie = lireEnergie(brute);
  else throw new ErreurBatiment(400, "Précisez l'énergie de la facture");
  if (energieDuCompteur && energie !== energieDuCompteur) {
    throw new ErreurBatiment(400, "L'énergie de la facture n'est pas celle de son compteur");
  }

  const dateFacture = jourOuNull(valeur('dateFacture', 'date_facture'), 'Date de facture');
  if (!dateFacture) throw new ErreurBatiment(400, 'La date de la facture est obligatoire');
  const periodeDebut = jourOuNull(valeur('periodeDebut', 'periode_debut'), 'Début de période');
  const periodeFin = jourOuNull(valeur('periodeFin', 'periode_fin'), 'Fin de période');
  if ((periodeDebut && !periodeFin) || (!periodeDebut && periodeFin)) {
    throw new ErreurBatiment(400, 'Une période a un début et une fin');
  }
  if (periodeDebut && periodeFin && periodeFin < periodeDebut) {
    throw new ErreurBatiment(400, 'La période se termine avant de commencer');
  }

  return {
    compteurId,
    energie,
    fournisseurId: await fournisseurValide(valeur('fournisseurId', 'fournisseur_id')),
    numero: texte(valeur('numero', 'numero'), 100),
    dateFacture,
    periodeDebut,
    periodeFin,
    consommation: lireQuantite(valeur('consommation', 'consommation'), 'Consommation'),
    unite: texte(valeur('unite', 'unite'), 20) ?? UNITE_PAR_DEFAUT[energie] ?? null,
    montantHt: lireMontant(valeur('montantHt', 'montant_ht'), 'Montant HT'),
    montantTtc: lireMontant(valeur('montantTtc', 'montant_ttc'), 'Montant TTC', true)!,
    estimee: vrai(valeur('estimee', 'estimee')),
    documentId: await duBatiment('batiment_documents', identifiant(valeur('documentId', 'document_id')), siteId, 'Ce document'),
    notes: texte(valeur('notes', 'notes'), 5000),
  };
}

export async function creerFacture(siteId: number, saisie: FactureSaisie, userId: number): Promise<number> {
  const f = await lireFacture(siteId, saisie);
  const maintenant = versDateTime();
  const r = await db.execute(
    `INSERT INTO batiment_factures
       (site_id, compteur_id, energie, fournisseur_id, numero, date_facture, periode_debut, periode_fin,
        consommation, unite, montant_ht, montant_ttc, estimee, document_id, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId, f.compteurId, f.energie, f.fournisseurId, f.numero, f.dateFacture, f.periodeDebut, f.periodeFin,
      f.consommation, f.unite, f.montantHt, f.montantTtc, f.estimee ? 1 : 0, f.documentId, f.notes, userId,
      maintenant, maintenant,
    ]
  );
  return Number(r.lastInsertRowid);
}

export async function modifierFacture(id: number, saisie: FactureSaisie): Promise<void> {
  const existante = await db.queryOne('SELECT * FROM batiment_factures WHERE id = ?', [id]);
  if (!existante) throw new ErreurBatiment(404, 'Facture introuvable');
  const f = await lireFacture(Number(existante.site_id), saisie, existante);
  await db.execute(
    `UPDATE batiment_factures
        SET compteur_id = ?, energie = ?, fournisseur_id = ?, numero = ?, date_facture = ?, periode_debut = ?,
            periode_fin = ?, consommation = ?, unite = ?, montant_ht = ?, montant_ttc = ?, estimee = ?,
            document_id = ?, notes = ?, updated_at = ?
      WHERE id = ?`,
    [
      f.compteurId, f.energie, f.fournisseurId, f.numero, f.dateFacture, f.periodeDebut, f.periodeFin,
      f.consommation, f.unite, f.montantHt, f.montantTtc, f.estimee ? 1 : 0, f.documentId, f.notes,
      versDateTime(), id,
    ]
  );
}

export async function supprimerFacture(id: number): Promise<void> {
  await db.execute('DELETE FROM batiment_factures WHERE id = ?', [id]);
}

// ================================================================ la synthèse

/** La surface du bâtiment, pour les ratios au m². Vide = inconnue. */
export async function definirSurface(siteId: number, valeur: unknown): Promise<number | null> {
  const surface = lireQuantite(valeur, 'Surface');
  if (surface !== null && (surface === 0 || surface > 1e7)) throw new ErreurBatiment(400, 'Surface : un nombre de m² positif');
  const arrondie = surface === null ? null : Math.round(surface * 100) / 100;
  await db.execute('UPDATE cle_sites SET surface_m2 = ? WHERE id = ?', [arrondie, siteId]);
  return arrondie;
}

/** La période d'une facture ; à défaut, le seul jour de sa date. */
export function periodeDeFacture(f: Pick<Facture, 'dateFacture' | 'periodeDebut' | 'periodeFin'>) {
  return f.periodeDebut && f.periodeFin
    ? { debut: f.periodeDebut, fin: f.periodeFin }
    : { debut: f.dateFacture, fin: f.dateFacture };
}

/**
 * Ce qu'a coûté et consommé un bâtiment, par énergie, sur une année — et sur
 * la précédente, pour comparer. Les factures sont réparties au jour.
 */
export async function syntheseEnergie(
  siteId: number,
  annee: number
): Promise<Array<{ energie: Energie; unite: string | null; montant: number; consommation: number; montantPrecedent: number; consommationPrecedente: number; joursCouverts: number }>> {
  if (!Number.isInteger(annee) || annee < 1990 || annee > 2200) throw new ErreurBatiment(400, 'Année invalide');
  const factures = await listerFactures({ siteIds: [siteId] });
  const fenetre = { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  const precedente = { debut: `${annee - 1}-01-01`, fin: `${annee - 1}-12-31` };

  const parEnergie = new Map<Energie, { unite: string | null; montant: number; consommation: number; montantPrecedent: number; consommationPrecedente: number; jours: Set<string> }>();
  for (const f of factures) {
    const periode = periodeDeFacture(f);
    const part = partDansFenetre(periode, fenetre);
    const partPrecedente = partDansFenetre(periode, precedente);
    if (part === 0 && partPrecedente === 0) continue;
    const ligne =
      parEnergie.get(f.energie) ??
      { unite: f.unite, montant: 0, consommation: 0, montantPrecedent: 0, consommationPrecedente: 0, jours: new Set<string>() };
    ligne.montant += f.montantTtc * part;
    ligne.consommation += (f.consommation ?? 0) * part;
    ligne.montantPrecedent += f.montantTtc * partPrecedente;
    ligne.consommationPrecedente += (f.consommation ?? 0) * partPrecedente;
    // Les jours de l'année couverts par au moins une facture : une comparaison
    // sur dix mois de factures contre douze ne dit rien, et l'écran le montre.
    if (part > 0 && estJourValide(periode.debut) && estJourValide(periode.fin)) {
      const debut = periode.debut > fenetre.debut ? periode.debut : fenetre.debut;
      const fin = periode.fin < fenetre.fin ? periode.fin : fenetre.fin;
      for (let d = new Date(`${debut}T00:00:00Z`); d.toISOString().slice(0, 10) <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
        ligne.jours.add(d.toISOString().slice(0, 10));
      }
    }
    parEnergie.set(f.energie, ligne);
  }

  const arrondi = (n: number) => Math.round(n * 100) / 100;
  return [...parEnergie.entries()].map(([energie, l]) => ({
    energie,
    unite: l.unite,
    montant: arrondi(l.montant),
    consommation: arrondi(l.consommation),
    montantPrecedent: arrondi(l.montantPrecedent),
    consommationPrecedente: arrondi(l.consommationPrecedente),
    joursCouverts: l.jours.size,
  }));
}
