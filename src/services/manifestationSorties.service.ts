import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';
import { filtreManifestations } from '../middleware/manifestationScope';
import { servicesParCategorie, type ServiceBref } from './manifestationServices.service';
import { jointuresDisponibilite } from './materielPretable.service';
import { expressionPrestation } from './prestationParc.service';

/**
 * Ce qui sort, et ce qui est sorti.
 *
 * Le catalogue répond à « qu'ai-je », même daté. Il ne répond pas à « où est-ce ». Or c'est la
 * question du lundi matin : quelles chaises sont encore chez le comité des fêtes, quelle nacelle
 * part jeudi, que faut-il aller rechercher. La disponibilité la contient — un article dehors est
 * un article en moins — mais sous forme de solde, et un solde ne dit pas chez qui.
 *
 * Une ligne par article **et par manifestation**, donc, et non par article : cinquante chaises
 * dehors en trois endroits sont trois déplacements, pas un.
 *
 * Les deux tables du prêt sont réunies ici comme dans le catalogue — `manifestation_materials`
 * pour les quantités anonymes, `manifestation_items` pour le parc — parce que celui qui charge le
 * camion ne sait pas laquelle des deux porte ce qu'il charge, et n'a pas à le savoir.
 */

/**
 * Statuts qui font sortir du matériel.
 *
 * `delivered` est ce qui est physiquement dehors ; `validated` est ce qui est confirmé et partira.
 * Un brouillon ou une demande à confirmer n'y figurent pas : ils pèsent sur la disponibilité —
 * c'est le rôle du prévisionnel — mais personne ne charge un camion pour une demande que la
 * collectivité n'a pas encore acceptée, et les faire apparaître ici ferait préparer des sorties
 * qui n'auront peut-être jamais lieu.
 */
export const STATUTS_SORTIE = ['validated', 'delivered'] as const;

/** Fenêtre d'immobilisation, la même que partout ailleurs dans le module. */
const DEBUT_PERIODE = 'COALESCE(m.delivery_date, m.date_start)';
const FIN_PERIODE = 'COALESCE(m.recovery_date, m.date_end, m.date_start)';

const marqueurs = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(', ');

/**
 * Où en est une ligne de sortie.
 *
 * - `dehors` : livré, pas encore revenu — c'est ce qu'on va chercher ;
 * - `rendu` : sorti puis rentré, sur une manifestation encore ouverte ;
 * - `prevue` : confirmé, pas encore parti.
 */
export type EtatSortie = 'dehors' | 'rendu' | 'prevue';

export interface LigneSortie {
  /** Même référence que le catalogue : `stock:7`, `parc:12`. */
  ref: string;
  source: 'stock' | 'parc';
  id: number;
  name: string;
  category: string;
  category_id: number | null;
  is_prestation: boolean;
  services: ServiceBref[];
  manifestation_id: number;
  manifestation: string;
  status: string;
  /** Période d'immobilisation de la manifestation, livraison et récupération comprises. */
  debut: string;
  fin: string;
  quantite_demandee: number;
  quantite_sortie: number;
  quantite_rendue: number;
  /** Ce qui reste dehors : sorti moins rendu, jamais négatif. */
  quantite_dehors: number;
  etat: EtatSortie;
}

export interface FiltresSorties {
  /** Identifiant, slug ou nom du service dont on veut les sorties. */
  service?: unknown;
  /** `materiel` ou `prestation` ; tout le reste veut dire « les deux ». */
  kind?: unknown;
  /** Recherche sur le nom de l'article ou le titre de la manifestation. */
  search?: unknown;
}

function nombreOuZero(valeur: unknown): number {
  const nombre = Number(valeur ?? 0);
  return Number.isFinite(nombre) ? nombre : 0;
}

function identifiantOuNull(valeur: unknown): number | null {
  const nombre = Number(valeur);
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null;
}

/** Une prestation ne sort pas d'un magasin : elle se réalise, et n'a donc rien à rendre. */
function etatDe(statut: string, dehors: number, sortie: number, prestation: boolean): EtatSortie {
  if (statut !== 'delivered') return 'prevue';
  if (prestation) return 'dehors';
  if (dehors > 0) return 'dehors';
  return sortie > 0 ? 'rendu' : 'prevue';
}

/**
 * Lignes de sortie sur une période, filtres appliqués.
 *
 * Sans période, l'appelant passe le jour même de part et d'autre : c'est « ce qui est dehors
 * maintenant ». Avec deux dates, c'est « ce qui sort entre le 12 et le 15 » — la question que
 * pose un planning de livraisons.
 *
 * `null` quand le compte ne peut voir aucune manifestation : la route doit alors refuser, plutôt
 * que rendre une liste vide qui se lirait comme « rien n'est sorti ».
 */
export async function sorties(
  req: AuthRequest,
  debut: string,
  fin: string,
  filtres: FiltresSorties = {}
): Promise<LigneSortie[] | null> {
  // La portée des sorties est celle des manifestations : ce qui est dehors appartient à une
  // manifestation, et un compte qui n'a pas le droit de la lire n'a pas à savoir ce qu'elle a
  // emporté.
  const portee = await filtreManifestations(req, 'm');
  if (portee === null) return null;

  const conditionPeriode = `m.status IN (${marqueurs(STATUTS_SORTIE)})
      AND ${DEBUT_PERIODE} <= ? AND ${FIN_PERIODE} >= ?${portee.sql}`;
  const parametres = [...STATUTS_SORTIE, fin, debut, ...portee.params];

  const [annuaire, duStock, duParc] = await Promise.all([
    servicesParCategorie(),
    db.query(
      `SELECT mm.stock_id as id, ms.name as name,
              COALESCE(c.name, ms.category, '') as category,
              COALESCE(ms.category_id, sub.category_id) as category_id,
              COALESCE(ms.is_prestation, 0) as is_prestation,
              m.id as manifestation_id, m.title as manifestation, m.status as status,
              ${DEBUT_PERIODE} as debut, ${FIN_PERIODE} as fin,
              COALESCE(mm.quantity_requested, 0) as quantite_demandee,
              COALESCE(mm.quantity_delivered, 0) as quantite_sortie,
              COALESCE(mm.quantity_recovered, 0) as quantite_rendue
       FROM manifestation_materials mm
       JOIN manifestations m ON m.id = mm.manifestation_id
       JOIN manifestation_stock ms ON ms.id = mm.stock_id
       LEFT JOIN subcategories sub ON sub.id = ms.subcategory_id
       LEFT JOIN categories c ON c.id = COALESCE(ms.category_id, sub.category_id)
       WHERE ${conditionPeriode}`,
      parametres
    ),
    db.query(
      `SELECT mi.object_id as id, o.name as name,
              COALESCE(pc.name, '') as category,
              COALESCE(o.category_id, psc.category_id) as category_id,
              ${expressionPrestation()} as is_prestation,
              m.id as manifestation_id, m.title as manifestation, m.status as status,
              ${DEBUT_PERIODE} as debut, ${FIN_PERIODE} as fin,
              COALESCE(mi.quantity, 1) as quantite_demandee,
              COALESCE(mi.quantity_delivered, 0) as quantite_sortie,
              COALESCE(mi.quantity_returned, 0) as quantite_rendue
       FROM manifestation_items mi
       JOIN manifestations m ON m.id = mi.manifestation_id
       JOIN objects o ON o.id = mi.object_id
       ${jointuresDisponibilite()}
       WHERE ${conditionPeriode}`,
      parametres
    ),
  ]);

  const lignes: LigneSortie[] = [
    ...duStock.map((ligne: any) => construire(ligne, 'stock', annuaire)),
    ...duParc.map((ligne: any) => construire(ligne, 'parc', annuaire)),
  ];

  return trier(appliquerFiltres(lignes, filtres));
}

function construire(
  ligne: any,
  source: 'stock' | 'parc',
  annuaire: Map<number, ServiceBref[]>
): LigneSortie {
  const prestation = Boolean(Number(ligne.is_prestation ?? 0));
  const categorie = identifiantOuNull(ligne.category_id);
  const demandee = nombreOuZero(ligne.quantite_demandee);
  const sortie = nombreOuZero(ligne.quantite_sortie);
  const rendue = nombreOuZero(ligne.quantite_rendue);
  const dehors = Math.max(0, sortie - rendue);

  return {
    ref: `${source}:${ligne.id}`,
    source,
    id: Number(ligne.id),
    name: String(ligne.name ?? ''),
    category: String(ligne.category ?? ''),
    category_id: categorie,
    is_prestation: prestation,
    services: categorie === null ? [] : annuaire.get(categorie) ?? [],
    manifestation_id: Number(ligne.manifestation_id),
    manifestation: String(ligne.manifestation ?? ''),
    status: String(ligne.status ?? ''),
    debut: String(ligne.debut ?? ''),
    fin: String(ligne.fin ?? ''),
    quantite_demandee: demandee,
    quantite_sortie: sortie,
    quantite_rendue: rendue,
    quantite_dehors: dehors,
    etat: etatDe(String(ligne.status ?? ''), dehors, sortie, prestation),
  };
}

/**
 * Filtres appliqués en mémoire plutôt qu'en SQL.
 *
 * Le service d'une ligne se déduit de son annuaire de catégories, déjà chargé pour l'affichage :
 * le refaire en SQL sur les deux tables reviendrait à écrire deux fois la même règle, avec le
 * risque qu'une des deux copies finisse par mentir. Une période de sorties se compte en dizaines
 * de lignes, jamais en milliers.
 */
function appliquerFiltres(lignes: LigneSortie[], filtres: FiltresSorties): LigneSortie[] {
  const service = String(filtres.service ?? '').trim();
  const nature = filtres.kind === 'prestation' || filtres.kind === 'materiel' ? filtres.kind : null;
  const recherche = String(filtres.search ?? '')
    .trim()
    .toLowerCase();

  return lignes.filter((ligne) => {
    if (nature === 'prestation' && !ligne.is_prestation) return false;
    if (nature === 'materiel' && ligne.is_prestation) return false;

    if (service) {
      // Un service se désigne par son identifiant, son slug ou son nom, comme partout ailleurs :
      // un identifiant numérique ne survit pas au passage d'une instance à une autre.
      const correspond = ligne.services.some(
        (s) => String(s.id) === service || s.slug === service || s.name === service
      );
      if (!correspond) return false;
    }

    if (recherche) {
      const cible = `${ligne.name} ${ligne.manifestation}`.toLowerCase();
      if (!cible.includes(recherche)) return false;
    }

    return true;
  });
}

/** Ce qui est dehors d'abord, puis par date de sortie : l'ordre dans lequel on agit. */
function trier(lignes: LigneSortie[]): LigneSortie[] {
  const rang: Record<EtatSortie, number> = { dehors: 0, prevue: 1, rendu: 2 };

  return lignes.sort(
    (a, b) =>
      rang[a.etat] - rang[b.etat] ||
      a.debut.localeCompare(b.debut) ||
      a.manifestation.localeCompare(b.manifestation, 'fr') ||
      a.name.localeCompare(b.name, 'fr')
  );
}
