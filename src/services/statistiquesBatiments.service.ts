import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';
import { filtreObjets } from '../middleware/objectScope';
import {
  decalerJours,
  decalerMois,
  estJourValide,
  jourCourant,
  nombreDeJours,
  partDansFenetre,
  periodesEntre,
  versJour,
  type Bornes,
  type Granularite,
} from '../utils/periodes';
import { ErreurBatiment } from './batiments.service';
import { ENERGIES, periodeDeFacture, type Energie } from './energieBatiments.service';
import { etatContrat } from './contratsBatiments.service';

/**
 * Ce que coûtent les bâtiments, période par période, bâtiment par bâtiment.
 *
 * ## Tout se répartit au jour
 *
 * Chaque dépense devient un **mouvement** : un montant étalé sur une période.
 * Une facture de gaz de décembre-janvier s'étale sur ses deux mois ; un
 * contrat d'entretien, sur ses jours d'exécution, au prorata de son montant
 * annuel ; une intervention ou un achat tient en un jour. Chaque période du
 * graphique prend la part du mouvement qui tombe dans ses bornes
 * (`partDansFenetre`). C'est ce qui rend comparables janvier et février, ou un
 * trimestre et le même trimestre de l'an passé.
 *
 * ## Un contrat se partage entre ses bâtiments
 *
 * Le marché des ascenseurs de trois bâtiments compte pour un tiers dans
 * chacun : la somme des bâtiments redonne le contrat, jamais trois fois.
 *
 * ## Les catégories
 *
 *   **énergie**        les factures, par fluide
 *   **contrats**       les contrats de maintenance
 *   **interventions**  dépannages, entretiens, travaux, nettoyage
 *   **contrôles**      les interventions de nature « contrôle » — le passage du
 *                      vérificateur, souvent saisi à la validation du rapport
 *   **achats**         le matériel posé dans les pièces, à sa date d'achat
 *
 * Le carburant des véhicules n'est pas un coût de bâtiment : il n'y est pas.
 *
 * ## Ce que les chiffres ne disent pas seuls
 *
 * Une comparaison sur dix mois de factures contre douze fait croire à une
 * baisse. La **couverture** — les jours de la fenêtre couverts par au moins
 * une facture, par bâtiment et par énergie — accompagne donc toujours les
 * montants d'énergie.
 */

export const CATEGORIES_STAT = ['energie', 'contrats', 'interventions', 'controles', 'achats'] as const;
export type CategorieStat = (typeof CATEGORIES_STAT)[number];

export type GranulariteStat = Extract<Granularite, 'semaine' | 'mois' | 'annee'>;
export type Comparaison = 'aucune' | 'precedente' | 'n-1';

export interface FiltreStatistiques {
  debut: string;
  fin: string;
  granularite: GranulariteStat;
  /** Déjà ramenés au périmètre de l'appelant. */
  siteIds: number[];
  categories: CategorieStat[];
  /** Vide : toutes. */
  energies: Energie[];
  comparaison: Comparaison;
}

/** Un montant étalé sur une période, rangé dans une catégorie. */
export interface Mouvement {
  siteId: number;
  categorie: CategorieStat;
  /** L'énergie, la nature d'intervention, ou le contrat. */
  sous: string;
  periode: Bornes;
  montant: number;
  consommation?: number;
  unite?: string | null;
}

type ParCategorie = Record<CategorieStat, number>;
const vide = (): ParCategorie => ({ energie: 0, contrats: 0, interventions: 0, controles: 0, achats: 0 });
const arrondi = (n: number) => Math.round(n * 100) / 100;
const arrondiParCategorie = (p: ParCategorie): ParCategorie =>
  Object.fromEntries(Object.entries(p).map(([c, v]) => [c, arrondi(v)])) as ParCategorie;

// ======================================================== la lecture du filtre

const DUREE_MAX_JOURS = 366 * 10 + 3;

/**
 * Lit les paramètres de la requête. Sans dates : les douze derniers mois
 * pleins, jusqu'à la fin du mois courant.
 */
export function lireFiltre(
  query: Record<string, unknown>,
  aujourdhui = jourCourant()
): Omit<FiltreStatistiques, 'siteIds'> & { sitesDemandes: number[] | null } {
  const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let debut = texte(query.debut);
  let fin = texte(query.fin);
  if (!debut && !fin) {
    fin = decalerJours(decalerMois(`${aujourdhui.slice(0, 7)}-01`, 1), -1);
    debut = decalerMois(`${aujourdhui.slice(0, 7)}-01`, -11);
  }
  if (!estJourValide(debut) || !estJourValide(fin)) throw new ErreurBatiment(400, 'Période invalide');
  if (fin < debut) throw new ErreurBatiment(400, 'La période se termine avant de commencer');
  if (nombreDeJours({ debut, fin }) > DUREE_MAX_JOURS) throw new ErreurBatiment(400, 'Dix ans au plus');

  const granularite = (['semaine', 'mois', 'annee'] as const).includes(query.granularite as GranulariteStat)
    ? (query.granularite as GranulariteStat)
    : nombreDeJours({ debut, fin }) <= 92
      ? 'semaine'
      : nombreDeJours({ debut, fin }) <= 1100
        ? 'mois'
        : 'annee';

  const liste = (v: unknown) => texte(v).split(',').map((s) => s.trim()).filter(Boolean);
  const categories = liste(query.categories).filter((c): c is CategorieStat => CATEGORIES_STAT.includes(c as CategorieStat));
  const energies = liste(query.energies).filter((e): e is Energie => ENERGIES.includes(e as Energie));
  const sites = liste(query.sites).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const comparaison = (['aucune', 'precedente', 'n-1'] as const).includes(query.comparaison as Comparaison)
    ? (query.comparaison as Comparaison)
    : 'aucune';

  return {
    debut,
    fin,
    granularite,
    categories: categories.length ? categories : [...CATEGORIES_STAT],
    energies,
    comparaison,
    sitesDemandes: sites.length ? [...new Set(sites)] : null,
  };
}

/** La fenêtre de comparaison : juste avant, de même durée, ou un an plus tôt. */
export function fenetreDeComparaison(fenetre: Bornes, comparaison: Comparaison): Bornes | null {
  if (comparaison === 'aucune') return null;
  if (comparaison === 'n-1') return { debut: decalerMois(fenetre.debut, -12), fin: decalerMois(fenetre.fin, -12) };
  const jours = nombreDeJours(fenetre);
  return { debut: decalerJours(fenetre.debut, -jours), fin: decalerJours(fenetre.debut, -1) };
}

// ============================================================ les mouvements

const liste = (ids: number[]) => ids.map(() => '?').join(', ');

async function mouvementsEnergie(siteIds: number[], etendue: Bornes, energies: Energie[]): Promise<Mouvement[]> {
  const lignes = await db.query(
    `SELECT site_id, energie, date_facture, periode_debut, periode_fin, consommation, unite, montant_ttc
       FROM batiment_factures
      WHERE site_id IN (${liste(siteIds)})
        AND COALESCE(periode_fin, date_facture) >= ? AND COALESCE(periode_debut, date_facture) <= ?`,
    [...siteIds, etendue.debut, etendue.fin]
  );
  return lignes
    .filter((l: any) => energies.length === 0 || energies.includes(l.energie))
    .map((l: any) => ({
      siteId: Number(l.site_id),
      categorie: 'energie' as const,
      sous: l.energie,
      periode: periodeDeFacture({
        dateFacture: versJour(l.date_facture),
        periodeDebut: l.periode_debut ? versJour(l.periode_debut) : null,
        periodeFin: l.periode_fin ? versJour(l.periode_fin) : null,
      }),
      montant: Number(l.montant_ttc),
      consommation: l.consommation === null || l.consommation === undefined ? undefined : Number(l.consommation),
      unite: l.unite ?? null,
    }));
}

/**
 * Un contrat court de sa date de début à sa fin effective : sa date de fin
 * s'il n'est pas tacite ; sans fin tant qu'un contrat tacite est actif ; la
 * fin de sa période en cours s'il a été désactivé.
 */
export function finEffectiveDuContrat(
  c: { dateFin: string | null; reconductionTacite: boolean; preavisJours: number; actif: boolean },
  aujourdhui = jourCourant()
): string | null {
  if (!c.reconductionTacite) return c.dateFin;
  if (c.actif) return null;
  return c.dateFin ? etatContrat({ ...c, actif: true }, aujourdhui).finEnCours : null;
}

async function mouvementsContrats(siteIds: number[], etendue: Bornes): Promise<Mouvement[]> {
  const contrats = await db.query(
    `SELECT c.id, c.objet, c.date_debut, c.date_fin, c.reconduction_tacite, c.preavis_jours, c.actif,
            c.montant_annuel_ttc, c.montant_annuel_ht,
            (SELECT COUNT(*) FROM batiment_contrat_sites x WHERE x.contrat_id = c.id) AS nb_sites
       FROM batiment_contrats c
      WHERE c.id IN (SELECT contrat_id FROM batiment_contrat_sites WHERE site_id IN (${liste(siteIds)}))`,
    siteIds
  );
  if (contrats.length === 0) return [];
  const liens = await db.query(
    `SELECT contrat_id, site_id FROM batiment_contrat_sites WHERE site_id IN (${liste(siteIds)})`,
    siteIds
  );

  const mouvements: Mouvement[] = [];
  for (const c of contrats) {
    const annuel = c.montant_annuel_ttc ?? c.montant_annuel_ht;
    if (annuel === null || annuel === undefined) continue;
    const fin = finEffectiveDuContrat({
      dateFin: c.date_fin ? versJour(c.date_fin) : null,
      reconductionTacite: Boolean(Number(c.reconduction_tacite)),
      preavisJours: Number(c.preavis_jours ?? 0),
      actif: Boolean(Number(c.actif)),
    });
    // Ramené à l'étendue regardée : un contrat sans fin s'arrête à son bord.
    const periode = {
      debut: versJour(c.date_debut) > etendue.debut ? versJour(c.date_debut) : etendue.debut,
      fin: fin && fin < etendue.fin ? fin : etendue.fin,
    };
    if (periode.fin < periode.debut) continue;
    const parJour = Number(annuel) / 365;
    const partSite = 1 / Math.max(1, Number(c.nb_sites));
    for (const lien of liens.filter((l: any) => Number(l.contrat_id) === Number(c.id))) {
      mouvements.push({
        siteId: Number(lien.site_id),
        categorie: 'contrats',
        sous: c.objet,
        periode,
        montant: parJour * nombreDeJours(periode) * partSite,
      });
    }
  }
  return mouvements;
}

async function mouvementsInterventions(siteIds: number[], etendue: Bornes): Promise<Mouvement[]> {
  const lignes = await db.query(
    `SELECT site_id, nature, date_intervention, COALESCE(montant_ttc, montant_ht) AS montant
       FROM batiment_interventions
      WHERE site_id IN (${liste(siteIds)}) AND date_intervention >= ? AND date_intervention <= ?
        AND COALESCE(montant_ttc, montant_ht) IS NOT NULL`,
    [...siteIds, etendue.debut, etendue.fin]
  );
  return lignes.map((l: any) => {
    const jour = versJour(l.date_intervention);
    return {
      siteId: Number(l.site_id),
      categorie: l.nature === 'controle' ? ('controles' as const) : ('interventions' as const),
      sous: l.nature,
      periode: { debut: jour, fin: jour },
      montant: Number(l.montant),
    };
  });
}

/**
 * Le matériel posé dans les pièces, à sa date d'achat. Un lot compte pour la
 * quantité posée ici, au prix unitaire. La portée des catégories du lecteur
 * s'applique : on ne chiffre pas ce qu'on ne pourrait pas voir.
 */
async function mouvementsAchats(
  siteIds: number[],
  etendue: Bornes,
  lecteur: AuthRequest | null
): Promise<{ mouvements: Mouvement[]; sansPrix: number }> {
  const portee = lecteur ? await filtreObjets(lecteur, 'o') : { sql: '', params: [] };
  if (!portee) return { mouvements: [], sansPrix: 0 };
  const lignes = await db.query(
    `SELECT p.site_id, o.material_type, o.purchase_date, o.purchase_price, o.unit_cost, pm.quantite
       FROM piece_materiels pm
       JOIN site_pieces p ON p.id = pm.piece_id
       JOIN objects o ON o.id = pm.object_id
      WHERE p.site_id IN (${liste(siteIds)})${portee.sql}`,
    [...siteIds, ...portee.params]
  );
  const mouvements: Mouvement[] = [];
  let sansPrix = 0;
  for (const l of lignes) {
    const lot = l.material_type === 'lot';
    const unitaire = lot ? (l.unit_cost ?? l.purchase_price) : l.purchase_price;
    if (unitaire === null || unitaire === undefined || !l.purchase_date) {
      sansPrix += 1;
      continue;
    }
    const jour = versJour(l.purchase_date);
    if (jour < etendue.debut || jour > etendue.fin) continue;
    mouvements.push({
      siteId: Number(l.site_id),
      categorie: 'achats',
      sous: 'materiel',
      periode: { debut: jour, fin: jour },
      montant: Number(unitaire) * (lot ? Number(l.quantite ?? 1) : 1),
    });
  }
  return { mouvements, sansPrix };
}

/**
 * Toutes les dépenses de ces bâtiments qui touchent l'étendue, rangées par
 * catégorie. Le Suivi des coûts s'en sert aussi, pour mettre les bâtiments à
 * côté du parc sans refaire le prorata des factures et des contrats.
 */
export async function mouvementsBatiments(
  siteIds: number[],
  etendue: Bornes,
  categories: readonly CategorieStat[],
  energies: Energie[] = [],
  lecteur: AuthRequest | null = null
): Promise<{ mouvements: Mouvement[]; achatsSansPrix: number }> {
  const veut = (c: CategorieStat) => categories.includes(c);
  const mouvements: Mouvement[] = [];
  let achatsSansPrix = 0;
  if (siteIds.length === 0) return { mouvements, achatsSansPrix };
  if (veut('energie')) mouvements.push(...(await mouvementsEnergie(siteIds, etendue, energies)));
  if (veut('contrats')) mouvements.push(...(await mouvementsContrats(siteIds, etendue)));
  if (veut('interventions') || veut('controles')) {
    mouvements.push(...(await mouvementsInterventions(siteIds, etendue)).filter((m) => veut(m.categorie)));
  }
  if (veut('achats')) {
    const achats = await mouvementsAchats(siteIds, etendue, lecteur);
    mouvements.push(...achats.mouvements);
    achatsSansPrix = achats.sansPrix;
  }
  return { mouvements, achatsSansPrix };
}

// ============================================================== l'agrégation

export interface SerieStat {
  cle: string;
  libelle: string;
  libelleLong: string;
  debut: string;
  fin: string;
  parCategorie: ParCategorie;
  total: number;
  /** Par énergie : ce qui a été consommé dans la période. */
  consommations: Partial<Record<Energie, number>>;
}

function serie(mouvements: Mouvement[], fenetre: Bornes, granularite: GranulariteStat): SerieStat[] {
  const periodes = periodesEntre(fenetre.debut, fenetre.fin, granularite).map((p) => ({
    ...p,
    // La première et la dernière période sont rognées à la fenêtre.
    debut: p.debut < fenetre.debut ? fenetre.debut : p.debut,
    fin: p.fin > fenetre.fin ? fenetre.fin : p.fin,
  }));
  const lignes = periodes.map((p) => ({ ...p, parCategorie: vide(), total: 0, consommations: {} as Partial<Record<Energie, number>> }));
  for (const m of mouvements) {
    for (const ligne of lignes) {
      if (ligne.fin < m.periode.debut || ligne.debut > m.periode.fin) continue;
      const part = partDansFenetre(m.periode, ligne);
      if (part === 0) continue;
      ligne.parCategorie[m.categorie] += m.montant * part;
      ligne.total += m.montant * part;
      if (m.categorie === 'energie' && m.consommation !== undefined) {
        const e = m.sous as Energie;
        ligne.consommations[e] = (ligne.consommations[e] ?? 0) + m.consommation * part;
      }
    }
  }
  return lignes.map((l) => ({
    ...l,
    parCategorie: arrondiParCategorie(l.parCategorie),
    total: arrondi(l.total),
    consommations: Object.fromEntries(Object.entries(l.consommations).map(([e, v]) => [e, arrondi(v as number)])),
  }));
}

/** Le montant d'un mouvement qui tombe dans la fenêtre. */
const dansFenetre = (m: Mouvement, fenetre: Bornes) => m.montant * partDansFenetre(m.periode, fenetre);

/** Les jours de la fenêtre couverts par au moins une facture de cette énergie, dans ce bâtiment. */
function joursCouverts(mouvements: Mouvement[], fenetre: Bornes): Map<string, number> {
  const jours = new Map<string, Set<string>>();
  for (const m of mouvements) {
    if (m.categorie !== 'energie') continue;
    const debut = m.periode.debut > fenetre.debut ? m.periode.debut : fenetre.debut;
    const fin = m.periode.fin < fenetre.fin ? m.periode.fin : fenetre.fin;
    if (fin < debut) continue;
    const cle = `${m.siteId}|${m.sous}`;
    const ensemble = jours.get(cle) ?? new Set<string>();
    for (let j = debut; j <= fin; j = decalerJours(j, 1)) ensemble.add(j);
    jours.set(cle, ensemble);
  }
  return new Map([...jours.entries()].map(([cle, ensemble]) => [cle, ensemble.size]));
}

export interface StatistiquesBatiments {
  filtre: FiltreStatistiques;
  fenetre: Bornes;
  fenetreComparaison: Bornes | null;
  totaux: { montant: number; comparaison: number | null; parCategorie: ParCategorie; parCategorieComparaison: ParCategorie | null };
  series: SerieStat[];
  seriesComparaison: SerieStat[] | null;
  /** Le détail de chaque catégorie : par énergie, par nature, par contrat. */
  details: Array<{ categorie: CategorieStat; sous: string; montant: number; comparaison: number | null }>;
  parEnergie: Array<{ energie: Energie; montant: number; consommation: number; unite: string | null; comparaison: number | null; consommationComparaison: number | null }>;
  parBatiment: Array<{
    siteId: number;
    nom: string;
    surfaceM2: number | null;
    parCategorie: ParCategorie;
    total: number;
    comparaison: number | null;
    consommations: Partial<Record<Energie, number>>;
    /** Par énergie facturée : la part des jours de la fenêtre couverts, de 0 à 1. */
    couverture: Partial<Record<Energie, number>>;
  }>;
  /** Matériel posé dont le prix ou la date d'achat manque : il n'est pas chiffré. */
  achatsSansPrix: number;
}

/** Les statistiques d'un ensemble de bâtiments sur une fenêtre, avec sa comparaison. */
export async function statistiquesBatiments(
  filtre: FiltreStatistiques,
  lecteur: AuthRequest | null = null
): Promise<StatistiquesBatiments> {
  const fenetre = { debut: filtre.debut, fin: filtre.fin };
  const comparee = fenetreDeComparaison(fenetre, filtre.comparaison);
  const etendue = comparee ? { debut: comparee.debut < fenetre.debut ? comparee.debut : fenetre.debut, fin: fenetre.fin } : fenetre;

  const sites = filtre.siteIds.length
    ? await db.query(`SELECT * FROM cle_sites WHERE id IN (${liste(filtre.siteIds)}) ORDER BY sort_order, name`, filtre.siteIds)
    : [];
  const ids = sites.map((s: any) => Number(s.id));

  const { mouvements, achatsSansPrix } = await mouvementsBatiments(ids, etendue, filtre.categories, filtre.energies, lecteur);

  const somme = (liste: Mouvement[], f: Bornes) => liste.reduce((s, m) => s + dansFenetre(m, f), 0);
  const sommeParCategorie = (liste: Mouvement[], f: Bornes) => {
    const p = vide();
    for (const m of liste) p[m.categorie] += dansFenetre(m, f);
    return arrondiParCategorie(p);
  };

  // Le détail : chaque (catégorie, sous-catégorie).
  const cles = new Map<string, { categorie: CategorieStat; sous: string }>();
  for (const m of mouvements) cles.set(`${m.categorie}|${m.sous}`, { categorie: m.categorie, sous: m.sous });
  const details = [...cles.values()]
    .map(({ categorie, sous }) => {
      const concernes = mouvements.filter((m) => m.categorie === categorie && m.sous === sous);
      return {
        categorie,
        sous,
        montant: arrondi(somme(concernes, fenetre)),
        comparaison: comparee ? arrondi(somme(concernes, comparee)) : null,
      };
    })
    .filter((d) => d.montant !== 0 || (d.comparaison ?? 0) !== 0)
    .sort((a, b) => b.montant - a.montant);

  const consommation = (liste: Mouvement[], f: Bornes) =>
    liste.reduce((s, m) => s + (m.consommation ?? 0) * partDansFenetre(m.periode, f), 0);
  const energiesVues = [...new Set(mouvements.filter((m) => m.categorie === 'energie').map((m) => m.sous as Energie))];
  const parEnergie = energiesVues
    .map((energie) => {
      const concernes = mouvements.filter((m) => m.categorie === 'energie' && m.sous === energie);
      return {
        energie,
        montant: arrondi(somme(concernes, fenetre)),
        consommation: arrondi(consommation(concernes, fenetre)),
        unite: concernes.find((m) => m.unite)?.unite ?? null,
        comparaison: comparee ? arrondi(somme(concernes, comparee)) : null,
        consommationComparaison: comparee ? arrondi(consommation(concernes, comparee)) : null,
      };
    })
    .sort((a, b) => b.montant - a.montant);

  const couverts = joursCouverts(mouvements, fenetre);
  const joursFenetre = nombreDeJours(fenetre);
  const parBatiment = sites.map((s: any) => {
    const id = Number(s.id);
    const siens = mouvements.filter((m) => m.siteId === id);
    const consommations: Partial<Record<Energie, number>> = {};
    const couverture: Partial<Record<Energie, number>> = {};
    for (const e of energiesVues) {
      const factures = siens.filter((m) => m.categorie === 'energie' && m.sous === e);
      if (factures.length === 0) continue;
      consommations[e] = arrondi(consommation(factures, fenetre));
      couverture[e] = Math.round(((couverts.get(`${id}|${e}`) ?? 0) / joursFenetre) * 1000) / 1000;
    }
    return {
      siteId: id,
      nom: s.name,
      surfaceM2: s.surface_m2 === null || s.surface_m2 === undefined ? null : Number(s.surface_m2),
      parCategorie: sommeParCategorie(siens, fenetre),
      total: arrondi(somme(siens, fenetre)),
      comparaison: comparee ? arrondi(somme(siens, comparee)) : null,
      consommations,
      couverture,
    };
  });

  return {
    filtre: { ...filtre, siteIds: ids },
    fenetre,
    fenetreComparaison: comparee,
    totaux: {
      montant: arrondi(somme(mouvements, fenetre)),
      comparaison: comparee ? arrondi(somme(mouvements, comparee)) : null,
      parCategorie: sommeParCategorie(mouvements, fenetre),
      parCategorieComparaison: comparee ? sommeParCategorie(mouvements, comparee) : null,
    },
    series: serie(mouvements, fenetre, filtre.granularite),
    seriesComparaison: comparee ? serie(mouvements, comparee, filtre.granularite) : null,
    details,
    parEnergie,
    parBatiment,
    achatsSansPrix,
  };
}
