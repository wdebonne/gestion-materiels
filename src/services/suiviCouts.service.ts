import { db } from '../database';
import { getAccessibleCategoryIds, type AuthRequest } from '../middleware/auth.middleware';
import { filtreManifestations } from '../middleware/manifestationScope';
import {
  bornesPeriode,
  cleDePeriode,
  estJourValide,
  jourCourant,
  nombreDeJours,
  partDansFenetre,
  periodesEntre,
  versJour,
  type Bornes,
  type Granularite,
} from '../utils/periodes';
import { perimetreBatiments } from './batiments.service';
import { coutDe } from './coutManifestation.service';
import { mouvementsBatiments, type CategorieStat } from './statistiquesBatiments.service';

/**
 * Le Suivi des coûts : tout ce que la collectivité dépense, au même endroit.
 *
 * Le module ne connaissait que le parc — carburant, entretiens, contrôles
 * techniques. Les bâtiments ont apporté leurs factures d'énergie, leurs
 * contrats et leurs interventions ; les manifestations, leurs prestations et
 * leurs pertes ; les espaces verts, leurs entretiens. Chaque module avait son
 * écran, aucun ne donnait le total.
 *
 * ## Tout devient une dépense étalée sur une période
 *
 * Même règle que les statistiques des bâtiments, dont on reprend les
 * mouvements tels quels : une facture de gaz de décembre-janvier s'étale sur
 * ses deux mois, un contrat annuel sur ses jours, un plein ou une intervention
 * tient en un jour. Chaque période du graphique prend la part qui tombe dans
 * ses bornes.
 *
 * ## Les périodes se calculent ici, pas en SQL
 *
 * L'ancien regroupement passait par `strftime('%Y-W%W')` sur SQLite et
 * `DATE_FORMAT('%Y-W%u')` sur MySQL, qui ne numérotent pas les semaines de la
 * même façon — et une colonne `DATE` sort décalée d'un jour de mysql2. Les
 * dates sont donc ramenées au jour par `versJour`, et rangées avec les outils
 * de `utils/periodes` : semaines ISO, périodes vides comprises.
 *
 * ## Chacun ne voit que ce qu'il pourrait voir ailleurs
 *
 *   **parc**           les catégories ouvertes au lecteur ;
 *   **bâtiments**      ceux qu'il suit, si le module lui est ouvert ;
 *   **manifestations** sa portée habituelle, si le module lui est ouvert ;
 *   **espaces verts**  si le module lui est ouvert.
 *
 * Un module fermé ne rend pas une erreur : la source disparaît des choix.
 */

export const SOURCES = ['fuel', 'maintenance', 'technical_control', 'green_space', 'buildings', 'events'] as const;
export type Source = (typeof SOURCES)[number];

/** Les sources du parc : les seules que filtrent catégories, sous-catégories et objets. */
export const SOURCES_PARC: readonly Source[] = ['fuel', 'maintenance', 'technical_control'];

/**
 * Les noms que chaque source porte dans les réponses. Hérités de l'API d'avant
 * (`totalFuelCost`, `fuelCost`, `fuel`) : l'écran et l'export PDF les lisent.
 */
export const CLES: Record<Source, { total: string; serie: string; annuel: string; nombre: string }> = {
  fuel: { total: 'totalFuelCost', serie: 'fuelCost', annuel: 'fuel', nombre: 'fuelEntryCount' },
  maintenance: { total: 'totalMaintenanceCost', serie: 'maintenanceCost', annuel: 'maintenance', nombre: 'maintenanceCount' },
  technical_control: { total: 'totalControlCost', serie: 'controlCost', annuel: 'control', nombre: 'controlCount' },
  green_space: { total: 'totalGreenSpaceCost', serie: 'greenSpaceCost', annuel: 'greenSpace', nombre: 'greenSpaceCount' },
  buildings: { total: 'totalBuildingCost', serie: 'buildingCost', annuel: 'buildings', nombre: 'buildingCount' },
  events: { total: 'totalEventCost', serie: 'eventCost', annuel: 'events', nombre: 'eventCount' },
};

/**
 * Ce qui compte d'un bâtiment. Les achats de matériel posé restent aux
 * statistiques des bâtiments : c'est un investissement, pas une dépense de
 * fonctionnement, et le parc n'y compte pas non plus ses achats.
 */
export const CATEGORIES_BATIMENT: readonly CategorieStat[] = ['energie', 'contrats', 'interventions', 'controles'];

/**
 * Une manifestation au brouillon, annulée ou refusée n'engage rien. Une
 * demande en attente, si : ce qu'elle demande est ce qu'on s'apprête à
 * déployer.
 */
const STATUTS_MANIFESTATION_EXCLUS = ['draft', 'cancelled', 'rejected'];

export type GranulariteSuivi = Extract<Granularite, 'semaine' | 'mois' | 'annee'>;

export interface FiltreSuivi {
  sources: Source[];
  categoryIds: number[];
  subcategoryIds: number[];
  objectIds: number[];
  fuelTypes: string[];
  maintenanceTypes: string[];
  /** Vide : tous les bâtiments du périmètre. */
  siteIds: number[];
}

/** Un montant étalé sur une période, rattaché à ce qui l'a coûté. */
export interface Depense {
  source: Source;
  /** Type de carburant, type d'entretien, catégorie de dépense du bâtiment… */
  sous: string;
  periode: Bornes;
  montant: number;
  /** Litres, pour le carburant. */
  quantite?: number;
  /** Ce qui se compte : un plein, une manifestation, un bâtiment. */
  ref: string;
  objet?: { id: number; nom: string; reference: string | null; image: string | null; categorieId: number | null; categorieNom: string | null };
  siteId?: number;
}

/** Ce que le lecteur a le droit de chiffrer. */
export interface Perimetre {
  /** `null` : toutes les catégories du parc. */
  categories: number[] | null;
  /** `null` : le module Bâtiments ne lui est pas ouvert. */
  sites: number[] | null;
  manifestations: { sql: string; params: any[] } | null;
  espacesVerts: boolean;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
const marques = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// ================================================================ les droits

/**
 * Le module est-il actif, et ouvert à ce compte ? Même règle que le menu :
 * droit individuel, sinon droit du rôle, sinon ouvert.
 */
export async function moduleOuvert(appelant: { userId: number; role: string }, slug: string): Promise<boolean> {
  const plugin = await db.queryOne('SELECT id, is_active FROM plugins WHERE slug = ?', [slug]).catch(() => null);
  if (!plugin || !Number(plugin.is_active)) return false;
  if (appelant.role === 'admin') return true;
  const individuel = await db.queryOne(
    'SELECT can_access FROM user_plugin_permissions WHERE user_id = ? AND plugin_id = ?',
    [appelant.userId, plugin.id]
  );
  if (individuel) return Boolean(Number(individuel.can_access));
  const duRole = await db.queryOne('SELECT can_access FROM plugin_permissions WHERE role = ? AND plugin_id = ?', [
    appelant.role,
    plugin.id,
  ]);
  if (duRole) return Boolean(Number(duRole.can_access));
  return true;
}

export async function lirePerimetre(req: AuthRequest): Promise<Perimetre> {
  const appelant = req.user!;
  const categories = await getAccessibleCategoryIds(appelant.userId, appelant.role);

  let sites: number[] | null = null;
  if (await moduleOuvert(appelant, 'batiments')) {
    const suivis = await perimetreBatiments(appelant);
    // Tous les bâtiments, désactivés compris : on désactive un bâtiment
    // justement pour garder ses factures, et ce qu'il a coûté reste dépensé.
    // Un bâtiment sans dépense sur la fenêtre ne s'affiche de toute façon pas.
    sites =
      suivis === null
        ? (await db.query('SELECT id FROM cle_sites')).map((s: any) => Number(s.id))
        : suivis;
  }

  const manifestations = (await moduleOuvert(appelant, 'manifestations')) ? await filtreManifestations(req, 'm') : null;
  const espacesVerts = await moduleOuvert(appelant, 'espaces-verts');

  return { categories, sites, manifestations, espacesVerts };
}

/** Les sources que ce lecteur peut regarder. Le parc l'est toujours : l'écran existait pour lui. */
export function sourcesOuvertes(perimetre: Perimetre): Source[] {
  return SOURCES.filter((s) => {
    if (s === 'buildings') return perimetre.sites !== null && perimetre.sites.length > 0;
    if (s === 'events') return perimetre.manifestations !== null;
    if (s === 'green_space') return perimetre.espacesVerts;
    return true;
  });
}

// ============================================================ la lecture

const DUREE_MAX_JOURS = 366 * 10 + 3;

export class ErreurSuivi extends Error {
  constructor(public statut: number, message: string) {
    super(message);
  }
}

/** La fenêtre regardée. Sans dates : du 1er janvier à aujourd'hui. */
export function lireFenetre(debut: unknown, fin: unknown, aujourdhui = jourCourant()): Bornes {
  const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const d = texte(debut) || `${aujourdhui.slice(0, 4)}-01-01`;
  const f = texte(fin) || aujourdhui;
  if (!estJourValide(d) || !estJourValide(f)) throw new ErreurSuivi(400, 'Période invalide');
  if (f < d) throw new ErreurSuivi(400, 'La période se termine avant de commencer');
  if (nombreDeJours({ debut: d, fin: f }) > DUREE_MAX_JOURS) throw new ErreurSuivi(400, 'Dix ans au plus');
  return { debut: d, fin: f };
}

export function lireGranularite(valeur: unknown): GranulariteSuivi {
  if (valeur === 'week' || valeur === 'semaine') return 'semaine';
  if (valeur === 'year' || valeur === 'annee') return 'annee';
  return 'mois';
}

export function lireFiltre(query: Record<string, unknown>): FiltreSuivi {
  const liste = (v: unknown) =>
    (typeof v === 'string' ? v : '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const nombres = (v: unknown) => liste(v).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const demandees = liste(query.dataTypes).filter((s): s is Source => SOURCES.includes(s as Source));
  return {
    sources: demandees.length ? [...new Set(demandees)] : [...SOURCES],
    categoryIds: nombres(query.categoryIds),
    subcategoryIds: nombres(query.subcategoryIds),
    objectIds: nombres(query.objectIds),
    fuelTypes: liste(query.fuelTypes),
    maintenanceTypes: liste(query.maintenanceTypes),
    siteIds: nombres(query.siteIds),
  };
}

/**
 * Le filtre du parc, à ajouter à une requête sur `objects o`. `null` : le
 * lecteur ne voit aucune catégorie, il n'y a rien à lire.
 */
export function conditionObjets(filtre: FiltreSuivi, perimetre: Perimetre): { sql: string; params: any[] } | null {
  let sql = '';
  const params: any[] = [];
  if (filtre.objectIds.length) {
    sql = ` AND o.id IN (${marques(filtre.objectIds.length)})`;
    params.push(...filtre.objectIds);
  } else if (filtre.subcategoryIds.length) {
    sql = ` AND o.subcategory_id IN (${marques(filtre.subcategoryIds.length)})`;
    params.push(...filtre.subcategoryIds);
  } else if (filtre.categoryIds.length) {
    sql = ` AND o.category_id IN (${marques(filtre.categoryIds.length)})`;
    params.push(...filtre.categoryIds);
  }
  if (perimetre.categories !== null) {
    if (perimetre.categories.length === 0) return null;
    sql += ` AND o.category_id IN (${marques(perimetre.categories.length)})`;
    params.push(...perimetre.categories);
  }
  return { sql, params };
}

/**
 * Les bâtiments regardés : ceux demandés s'ils sont dans le périmètre, sinon
 * tout le périmètre. Un bâtiment qu'on ne suit pas est refusé plutôt
 * qu'ignoré — un total silencieusement amputé tromperait.
 */
export function sitesRegardes(filtre: FiltreSuivi, perimetre: Perimetre): number[] {
  if (perimetre.sites === null) return [];
  if (filtre.siteIds.length === 0) return perimetre.sites;
  if (filtre.siteIds.some((id) => !perimetre.sites!.includes(id))) {
    throw new ErreurSuivi(403, "Vous ne suivez pas l'un des bâtiments demandés");
  }
  return filtre.siteIds;
}

// ============================================================ les dépenses

const objetDe = (l: any): Depense['objet'] => ({
  id: Number(l.object_id),
  nom: l.object_name,
  reference: l.reference ?? null,
  image: l.object_image ?? null,
  categorieId: l.category_id === null || l.category_id === undefined ? null : Number(l.category_id),
  categorieNom: l.category_name ?? null,
});

const COLONNES_OBJET = `o.id AS object_id, o.name AS object_name, o.reference, o.image AS object_image,
                        c.id AS category_id, c.name AS category_name`;

async function depensesParc(filtre: FiltreSuivi, perimetre: Perimetre, etendue: Bornes): Promise<Depense[]> {
  const condition = conditionObjets(filtre, perimetre);
  if (!condition) return [];
  const veut = (s: Source) => filtre.sources.includes(s);
  const depenses: Depense[] = [];
  const jour = (v: unknown) => versJour(v);

  if (veut('fuel')) {
    let sql = `SELECT f.id, f.entry_date AS jour, f.total_price AS montant, f.quantity, f.fuel_type AS sous, ${COLONNES_OBJET}
                 FROM fuel_entries f JOIN objects o ON o.id = f.object_id LEFT JOIN categories c ON c.id = o.category_id
                WHERE f.entry_date >= ? AND f.entry_date <= ?`;
    const params: any[] = [etendue.debut, etendue.fin];
    if (filtre.fuelTypes.length) {
      sql += ` AND f.fuel_type IN (${marques(filtre.fuelTypes.length)})`;
      params.push(...filtre.fuelTypes);
    }
    for (const l of await db.query(sql + condition.sql, [...params, ...condition.params])) {
      const j = jour(l.jour);
      depenses.push({
        source: 'fuel',
        sous: l.sous || 'Autre',
        periode: { debut: j, fin: j },
        montant: Number(l.montant) || 0,
        quantite: Number(l.quantity) || 0,
        ref: `fuel:${l.id}`,
        objet: objetDe(l),
      });
    }
  }

  if (veut('maintenance')) {
    let sql = `SELECT m.id, m.maintenance_date AS jour, m.cost AS montant, m.maintenance_type AS sous, ${COLONNES_OBJET}
                 FROM maintenances m JOIN objects o ON o.id = m.object_id LEFT JOIN categories c ON c.id = o.category_id
                WHERE m.maintenance_date >= ? AND m.maintenance_date <= ?`;
    const params: any[] = [etendue.debut, etendue.fin];
    if (filtre.maintenanceTypes.length) {
      sql += ` AND m.maintenance_type IN (${marques(filtre.maintenanceTypes.length)})`;
      params.push(...filtre.maintenanceTypes);
    }
    for (const l of await db.query(sql + condition.sql, [...params, ...condition.params])) {
      const j = jour(l.jour);
      depenses.push({
        source: 'maintenance',
        sous: l.sous || 'Autre',
        periode: { debut: j, fin: j },
        montant: Number(l.montant) || 0,
        ref: `maintenance:${l.id}`,
        objet: objetDe(l),
      });
    }
  }

  if (veut('technical_control')) {
    const sql = `SELECT tc.id, tc.control_date AS jour, tc.cost AS montant, tc.result AS sous, ${COLONNES_OBJET}
                   FROM technical_controls tc JOIN objects o ON o.id = tc.object_id LEFT JOIN categories c ON c.id = o.category_id
                  WHERE tc.control_date >= ? AND tc.control_date <= ?`;
    for (const l of await db.query(sql + condition.sql, [etendue.debut, etendue.fin, ...condition.params])) {
      const j = jour(l.jour);
      depenses.push({
        source: 'technical_control',
        sous: l.sous || 'Sans résultat',
        periode: { debut: j, fin: j },
        montant: Number(l.montant) || 0,
        ref: `control:${l.id}`,
        objet: objetDe(l),
      });
    }
  }

  return depenses;
}

async function depensesEspacesVerts(etendue: Bornes): Promise<Depense[]> {
  const lignes = await db.query(
    `SELECT id, performed_date AS jour, cost AS montant, maintenance_type AS sous
       FROM green_space_maintenances
      WHERE performed_date >= ? AND performed_date <= ?`,
    [etendue.debut, etendue.fin]
  );
  return lignes.map((l: any) => {
    const j = versJour(l.jour);
    return {
      source: 'green_space' as const,
      sous: l.sous || 'Autre',
      periode: { debut: j, fin: j },
      montant: Number(l.montant) || 0,
      ref: `green_space:${l.id}`,
    };
  });
}

async function depensesBatiments(siteIds: number[], etendue: Bornes, lecteur: AuthRequest): Promise<Depense[]> {
  const { mouvements } = await mouvementsBatiments(siteIds, etendue, CATEGORIES_BATIMENT, [], lecteur);
  return mouvements.map((m) => ({
    source: 'buildings' as const,
    sous: m.categorie,
    periode: m.periode,
    montant: m.montant,
    ref: `site:${m.siteId}`,
    siteId: m.siteId,
  }));
}

export interface CoutEvenement {
  id: number;
  title: string;
  date: string;
  dateEnd: string | null;
  status: string;
  prestations: number;
  pertes: number;
  total: number;
  /** `false` tant que le matériel n'est pas revenu : les manques n'y sont pas encore. */
  definitif: boolean;
}

/** Les manifestations qui commencent dans l'étendue, avec leur coût. */
export async function coutsEvenements(portee: { sql: string; params: any[] }, etendue: Bornes): Promise<CoutEvenement[]> {
  const lignes = await db.query(
    `SELECT m.id, m.title, m.date_start, m.date_end, m.status
       FROM manifestations m
      WHERE m.date_start >= ? AND m.date_start <= ?
        AND COALESCE(m.status, 'draft') NOT IN (${marques(STATUTS_MANIFESTATION_EXCLUS.length)})${portee.sql}
      ORDER BY m.date_start DESC`,
    [etendue.debut, etendue.fin, ...STATUTS_MANIFESTATION_EXCLUS, ...portee.params]
  );
  const resultat: CoutEvenement[] = [];
  for (const l of lignes) {
    const cout = await coutDe(l.id);
    resultat.push({
      id: Number(l.id),
      title: l.title,
      date: versJour(l.date_start),
      dateEnd: l.date_end ? versJour(l.date_end) : null,
      status: l.status,
      prestations: cout.total_prestations,
      pertes: cout.total_pertes,
      total: cout.total,
      definitif: cout.definitif,
    });
  }
  return resultat;
}

function depensesEvenements(evenements: CoutEvenement[]): Depense[] {
  const depenses: Depense[] = [];
  for (const e of evenements) {
    const periode = { debut: e.date, fin: e.date };
    const ref = `event:${e.id}`;
    depenses.push({ source: 'events', sous: 'prestations', periode, montant: e.prestations, ref });
    if (e.pertes) depenses.push({ source: 'events', sous: 'pertes', periode, montant: e.pertes, ref });
  }
  return depenses;
}

export interface Collecte {
  depenses: Depense[];
  evenements: CoutEvenement[];
  sites: number[];
}

/** Toutes les dépenses des sources demandées qui touchent l'étendue. */
export async function collecter(
  filtre: FiltreSuivi,
  perimetre: Perimetre,
  etendue: Bornes,
  lecteur: AuthRequest
): Promise<Collecte> {
  const ouvertes = sourcesOuvertes(perimetre);
  const veut = (s: Source) => filtre.sources.includes(s) && ouvertes.includes(s);
  const depenses: Depense[] = [];
  let evenements: CoutEvenement[] = [];
  let sites: number[] = [];

  depenses.push(...(await depensesParc({ ...filtre, sources: filtre.sources.filter(veut) }, perimetre, etendue)));
  if (veut('green_space')) depenses.push(...(await depensesEspacesVerts(etendue)));
  if (veut('buildings')) {
    sites = sitesRegardes(filtre, perimetre);
    depenses.push(...(await depensesBatiments(sites, etendue, lecteur)));
  }
  if (veut('events') && perimetre.manifestations) {
    evenements = await coutsEvenements(perimetre.manifestations, etendue);
    depenses.push(...depensesEvenements(evenements));
  }
  return { depenses, evenements, sites };
}

// ============================================================ l'agrégation

/** Le montant d'une dépense qui tombe dans la fenêtre. */
export const dansFenetre = (d: Depense, fenetre: Bornes) => d.montant * partDansFenetre(d.periode, fenetre);
const touche = (d: Depense, f: Bornes) => d.periode.fin >= f.debut && d.periode.debut <= f.fin;

export type ParSource = Record<Source, number>;
const vide = (): ParSource => ({ fuel: 0, maintenance: 0, technical_control: 0, green_space: 0, buildings: 0, events: 0 });

export interface Resume {
  parSource: ParSource;
  nombres: ParSource;
  total: number;
  litres: number;
  /** Le détail des bâtiments et des manifestations, par nature de dépense. */
  batiments: Record<string, number>;
  evenements: Record<string, number>;
}

export function resumer(depenses: Depense[], fenetre: Bornes): Resume {
  const parSource = vide();
  const refs: Record<Source, Set<string>> = {
    fuel: new Set(), maintenance: new Set(), technical_control: new Set(), green_space: new Set(), buildings: new Set(), events: new Set(),
  };
  const batiments: Record<string, number> = Object.fromEntries(CATEGORIES_BATIMENT.map((c) => [c, 0]));
  const evenements: Record<string, number> = { prestations: 0, pertes: 0 };
  let litres = 0;
  for (const d of depenses) {
    if (!touche(d, fenetre)) continue;
    const part = partDansFenetre(d.periode, fenetre);
    if (part === 0) continue;
    parSource[d.source] += d.montant * part;
    // Un bâtiment qui n'a rien coûté dans la fenêtre ne compte pas.
    if (d.montant !== 0 || d.source !== 'buildings') refs[d.source].add(d.ref);
    if (d.quantite) litres += d.quantite * part;
    if (d.source === 'buildings') batiments[d.sous] = (batiments[d.sous] ?? 0) + d.montant * part;
    if (d.source === 'events') evenements[d.sous] = (evenements[d.sous] ?? 0) + d.montant * part;
  }
  const arrondis = (p: Record<string, number>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, arrondi(v)]));
  const total = SOURCES.reduce((s, k) => s + parSource[k], 0);
  return {
    parSource: arrondis(parSource) as ParSource,
    nombres: Object.fromEntries(SOURCES.map((s) => [s, refs[s].size])) as ParSource,
    total: arrondi(total),
    litres: arrondi(litres),
    batiments: arrondis(batiments),
    evenements: arrondis(evenements),
  };
}

/** Le résumé sous les noms de l'API : `totalFuelCost`, `fuelEntryCount`… */
export function resumeApi(r: Resume): Record<string, any> {
  const sortie: Record<string, any> = { totalCost: r.total, totalFuelQuantity: r.litres };
  for (const s of SOURCES) {
    sortie[CLES[s].total] = r.parSource[s];
    sortie[CLES[s].nombre] = r.nombres[s];
  }
  sortie.buildings = r.batiments;
  sortie.events = r.evenements;
  return sortie;
}

export interface PointSerie {
  period: string;
  label: string;
  labelLong: string;
  debut: string;
  fin: string;
  totalCost: number;
  [cle: string]: string | number;
}

/**
 * Les montants période par période, toutes les périodes de la fenêtre
 * comprises : un mois sans dépense vaut zéro au lieu de disparaître.
 */
export function serie(depenses: Depense[], fenetre: Bornes, granularite: GranulariteSuivi): PointSerie[] {
  const periodes = periodesEntre(fenetre.debut, fenetre.fin, granularite).map((p) => ({
    ...p,
    debut: p.debut < fenetre.debut ? fenetre.debut : p.debut,
    fin: p.fin > fenetre.fin ? fenetre.fin : p.fin,
  }));
  const index = new Map(periodes.map((p, i) => [p.cle, i]));
  const montants = periodes.map(() => vide());
  for (const d of depenses) {
    if (!touche(d, fenetre)) continue;
    // Une dépense d'un jour tombe dans une seule période : pas besoin de les parcourir.
    if (d.periode.debut === d.periode.fin) {
      const i = index.get(cleDePeriode(d.periode.debut, granularite));
      if (i !== undefined) montants[i][d.source] += d.montant;
      continue;
    }
    periodes.forEach((p, i) => {
      if (p.fin < d.periode.debut || p.debut > d.periode.fin) return;
      montants[i][d.source] += d.montant * partDansFenetre(d.periode, p);
    });
  }
  return periodes.map((p, i) => {
    const point: PointSerie = {
      period: p.cle,
      // « janv. 2026 », « S12 2026 » : un mois seul ne dit pas son année.
      label: granularite === 'annee' ? p.libelle : `${p.libelle} ${p.debut.slice(0, 4)}`,
      labelLong: p.libelleLong,
      debut: p.debut,
      fin: p.fin,
      totalCost: arrondi(SOURCES.reduce((s, k) => s + montants[i][k], 0)),
    };
    for (const s of SOURCES) point[CLES[s].serie] = arrondi(montants[i][s]);
    return point;
  });
}

/** Les dix objets du parc qui coûtent le plus sur la fenêtre. */
export function parObjet(depenses: Depense[], fenetre: Bornes, limite = 10) {
  const objets = new Map<number, { objet: NonNullable<Depense['objet']>; montants: ParSource }>();
  for (const d of depenses) {
    if (!d.objet || !touche(d, fenetre)) continue;
    const entree = objets.get(d.objet.id) ?? { objet: d.objet, montants: vide() };
    entree.montants[d.source] += dansFenetre(d, fenetre);
    objets.set(d.objet.id, entree);
  }
  return [...objets.values()]
    .map(({ objet, montants }) => ({
      id: objet.id,
      name: objet.nom,
      reference: objet.reference,
      image: objet.image,
      categoryName: objet.categorieNom,
      fuelCost: arrondi(montants.fuel),
      maintenanceCost: arrondi(montants.maintenance),
      controlCost: arrondi(montants.technical_control),
      totalCost: arrondi(montants.fuel + montants.maintenance + montants.technical_control),
    }))
    .filter((o) => o.totalCost !== 0)
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, limite);
}

/** Le parc par catégorie. */
export function parCategorie(depenses: Depense[], fenetre: Bornes) {
  const categories = new Map<string, { id: number | null; name: string; montants: ParSource }>();
  for (const d of depenses) {
    if (!d.objet || !touche(d, fenetre)) continue;
    const cle = String(d.objet.categorieId ?? 'aucune');
    const entree = categories.get(cle) ?? { id: d.objet.categorieId, name: d.objet.categorieNom ?? 'Sans catégorie', montants: vide() };
    entree.montants[d.source] += dansFenetre(d, fenetre);
    categories.set(cle, entree);
  }
  return [...categories.values()]
    .map((c) => ({
      id: c.id,
      name: c.name,
      fuelCost: arrondi(c.montants.fuel),
      maintenanceCost: arrondi(c.montants.maintenance),
      controlCost: arrondi(c.montants.technical_control),
      totalCost: arrondi(c.montants.fuel + c.montants.maintenance + c.montants.technical_control),
    }))
    .filter((c) => c.totalCost !== 0)
    .sort((a, b) => b.totalCost - a.totalCost);
}

/** Une source ventilée par sa sous-catégorie : type de carburant, nature de dépense… */
export function parSous(depenses: Depense[], fenetre: Bornes, source: Source) {
  const sous = new Map<string, { cost: number; quantity: number; refs: Set<string> }>();
  for (const d of depenses) {
    if (d.source !== source || !touche(d, fenetre)) continue;
    const entree = sous.get(d.sous) ?? { cost: 0, quantity: 0, refs: new Set<string>() };
    const part = partDansFenetre(d.periode, fenetre);
    entree.cost += d.montant * part;
    entree.quantity += (d.quantite ?? 0) * part;
    entree.refs.add(d.ref);
    sous.set(d.sous, entree);
  }
  return [...sous.entries()]
    .map(([type, e]) => ({ type, cost: arrondi(e.cost), quantity: arrondi(e.quantity), count: e.refs.size }))
    .filter((e) => e.cost !== 0)
    .sort((a, b) => b.cost - a.cost);
}

/** Les bâtiments, un par un, avec le détail par nature et le coût au m². */
export async function parBatiment(depenses: Depense[], fenetre: Bornes, siteIds: number[], comparee: Bornes | null = null) {
  if (siteIds.length === 0) return [];
  const sites = await db.query(
    `SELECT id, name, surface_m2 FROM cle_sites WHERE id IN (${marques(siteIds.length)}) ORDER BY sort_order, name`,
    siteIds
  );
  return sites
    .map((s: any) => {
      const id = Number(s.id);
      const siennes = depenses.filter((d) => d.source === 'buildings' && d.siteId === id);
      const categories: Record<string, number> = Object.fromEntries(CATEGORIES_BATIMENT.map((c) => [c, 0]));
      let total = 0;
      for (const d of siennes) {
        const montant = dansFenetre(d, fenetre);
        categories[d.sous] = (categories[d.sous] ?? 0) + montant;
        total += montant;
      }
      const surface = s.surface_m2 === null || s.surface_m2 === undefined ? null : Number(s.surface_m2);
      return {
        siteId: id,
        name: s.name,
        surfaceM2: surface,
        energie: arrondi(categories.energie),
        contrats: arrondi(categories.contrats),
        interventions: arrondi(categories.interventions),
        controles: arrondi(categories.controles),
        totalCost: arrondi(total),
        costPerM2: surface ? arrondi(total / surface) : null,
        compareCost: comparee ? arrondi(siennes.reduce((t, d) => t + dansFenetre(d, comparee), 0)) : null,
      };
    })
    .filter((b: any) => b.totalCost !== 0 || (b.compareCost ?? 0) !== 0)
    .sort((a: any, b: any) => b.totalCost - a.totalCost);
}

/** Ce qui sépare deux résumés, en euros et en pourcentage, sous les noms de l'API. */
export function ecart(actuel: Resume, reference: Resume) {
  const pourcentage = (a: number, r: number) => (r ? Math.round(((a - r) / r) * 1000) / 10 : null);
  const difference: Record<string, number> = { totalCost: arrondi(actuel.total - reference.total) };
  const percentageChange: Record<string, number | null> = { totalCost: pourcentage(actuel.total, reference.total) };
  for (const s of SOURCES) {
    difference[CLES[s].total] = arrondi(actuel.parSource[s] - reference.parSource[s]);
    percentageChange[CLES[s].total] = pourcentage(actuel.parSource[s], reference.parSource[s]);
  }
  difference.totalFuelQuantity = arrondi(actuel.litres - reference.litres);
  return { difference, percentageChange };
}

/** L'étendue qui couvre toutes ces fenêtres. */
export function etendueDe(...fenetres: Array<Bornes | null>): Bornes {
  const presentes = fenetres.filter((f): f is Bornes => f !== null);
  return {
    debut: presentes.reduce((m, f) => (f.debut < m ? f.debut : m), presentes[0].debut),
    fin: presentes.reduce((m, f) => (f.fin > m ? f.fin : m), presentes[0].fin),
  };
}

/** Un mois entier, ou une année entière. */
export function fenetreMois(annee: number, mois: number): Bornes {
  return bornesPeriode('mois', `${annee}-${String(mois).padStart(2, '0')}-01`);
}

export function fenetreAnnee(annee: number): Bornes {
  return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
}
