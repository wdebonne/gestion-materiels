import { db } from '../database';
import type { AuthRequest } from '../middleware/auth.middleware';
import { filtreManifestations } from '../middleware/manifestationScope';
import { jointuresDisponibilite } from './disponibiliteParc.service';
import { expressionNature } from './lotParc.service';

/**
 * Ce qui part et ce qui rentre aujourd'hui.
 *
 * L'écran des manifestations répond à « où en est ce dossier ». L'agent qui
 * charge le camion, lui, pose une autre question : *qu'est-ce que je fais ce
 * matin, et dans quel ordre*. Il devait jusqu'ici ouvrir la liste, deviner à
 * quel statut correspondait une livraison, ouvrir chaque manifestation, lire
 * deux tableaux différents — le stock d'un côté, le parc de l'autre — et n'avait
 * aucun moyen de voir ce qui traînait dehors depuis trois jours.
 *
 * Une tournée est donc une liste d'**arrêts** : un lieu, une heure, un contact,
 * et ce qu'on y dépose ou ce qu'on y reprend. Les deux gisements de matériel y
 * sont réunis — `manifestation_materials` pour les quantités,
 * `manifestation_items` pour le parc — parce que celui qui charge ne sait pas
 * laquelle des deux tables porte ses chaises, et n'a pas à le savoir.
 *
 * Le retard ne disparaît jamais de la liste : une manifestation dont la date de
 * récupération est passée reste en tête, signalée, jusqu'à ce que quelqu'un dise
 * ce que le matériel est devenu. C'est ce silence-là qui fait les stocks faux.
 */

/** Ce qu'on vient faire : déposer, ou reprendre. */
export type PhaseTournee = 'livraison' | 'recuperation';

/**
 * Où en est un arrêt.
 *
 * `fait` ne veut pas dire « clos » : un arrêt entièrement saisi attend encore
 * qu'un superviseur prononce le changement de statut. Le montrer fait, plutôt
 * que le retirer de la liste, évite à l'agent de douter de sa propre saisie et
 * de la refaire.
 */
export type EtatArret = 'a_faire' | 'commence' | 'fait';

/**
 * Trois natures qui ne se saisissent pas de la même façon : un nombre, un oui ou
 * non, un acte réalisé. Les confondre ferait demander « combien de camions sont
 * revenus ».
 */
export type NatureLigne = 'quantite' | 'exemplaire' | 'prestation';

export interface LigneTournee {
  /** Référence de la **ligne**, pas de l'article : `stock:41`, `parc:12`. */
  ref: string;
  source: 'stock' | 'parc';
  /** Identifiant de ligne, celui qu'attendent les routes de saisie. */
  ligne_id: number;
  nom: string;
  /** Repère physique d'un exemplaire : numéro d'inventaire ou de série. */
  repere: string;
  unite: string;
  nature: NatureLigne;
  demande: number;
  livre: number;
  rendu: number;
  perdu: number;
  /** Constat fait au retour sur un matériel du parc. */
  etat_retour: string | null;
  /** Ce qu'il reste à faire sur cette ligne, pour la phase en cours. */
  reste: number;
}

export interface ArretTournee {
  manifestation_id: number;
  titre: string;
  statut: string;
  phase: PhaseTournee;
  /** Jour où l'acte est attendu, au format `AAAA-MM-JJ`. */
  jour: string;
  /** Jours de retard sur ce jour-là ; 0 quand l'arrêt est à l'heure ou à venir. */
  retard: number;
  lieu: string;
  contact_nom: string;
  contact_tel: string;
  heure_debut: string;
  heure_fin: string;
  /** Consignes saisies sur la manifestation : accès, étage, personne à demander. */
  consignes: string;
  lignes: LigneTournee[];
  /** Totaux d'unités, pour annoncer l'ampleur d'un arrêt sans le déplier. */
  reste: number;
  fait: number;
  etat: EtatArret;
}

export interface Tournee {
  /** Jour de référence du calcul, celui d'où se comptent les retards. */
  jour: string;
  /** Dernier jour retenu : `jour` par défaut, demain quand on prépare la veille. */
  jusqu_au: string;
  livraisons: ArretTournee[];
  recuperations: ArretTournee[];
}

/**
 * Statuts qui font qu'un matériel part ou est déjà parti.
 *
 * Les mêmes que les sorties, et pour la même raison : personne ne charge un
 * camion pour une demande que la collectivité n'a pas encore acceptée.
 */
const STATUTS_TOURNEE = ['validated', 'delivered'] as const;

/** Une date de base peut porter une heure : la tournée ne raisonne qu'en jours. */
export const enJour = (valeur: unknown): string =>
  typeof valeur === 'string' && valeur.length >= 10 ? valeur.slice(0, 10) : '';

/** La première date renseignée de la liste, ou une chaîne vide. */
const premiereDate = (...valeurs: unknown[]): string => {
  for (const valeur of valeurs) {
    const jour = enJour(valeur);
    if (jour) return jour;
  }
  return '';
};

/**
 * Le jour où le matériel doit partir.
 *
 * `delivery_date` quand elle est saisie — c'est la veille, pour une fête qui
 * commence le lendemain matin — et à défaut le premier jour de la manifestation.
 * La même règle que la fenêtre d'immobilisation, pour qu'un article ne soit pas
 * réputé disponible un jour où la tournée le fait déjà partir.
 */
export const jourDeLivraison = (m: { delivery_date?: unknown; date_start?: unknown }): string =>
  premiereDate(m.delivery_date, m.date_start);

/** Le jour où l'on va le rechercher : le lendemain de la fête, le plus souvent. */
export const jourDeRecuperation = (m: {
  recovery_date?: unknown;
  date_end?: unknown;
  date_start?: unknown;
}): string => premiereDate(m.recovery_date, m.date_end, m.date_start);

/**
 * Jours de retard d'un acte attendu le `jour` dit.
 *
 * Comparé en UTC sur des jours entiers : un décalage horaire ferait compter un
 * jour de retard à 2 h du matin sur une livraison prévue le jour même.
 */
export function joursDeRetard(jour: string, aujourdhui: string): number {
  if (!jour || !aujourdhui) return 0;
  const ecart = Date.parse(`${aujourdhui}T00:00:00Z`) - Date.parse(`${jour}T00:00:00Z`);
  if (!Number.isFinite(ecart)) return 0;
  return Math.max(0, Math.round(ecart / 86400000));
}

const nombre = (valeur: unknown): number => {
  const n = Number(valeur ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Ce qu'il reste à faire sur une ligne.
 *
 * À la livraison, c'est ce qui n'est pas encore parti. À la récupération, ce qui
 * est sorti et n'est ni revenu ni déclaré perdu — l'écart qui trahit une saisie
 * incomplète, et non une perte.
 *
 * Une **prestation** ne revient pas : elle est réalisée, un point c'est tout.
 * Lui demander un retour ferait attendre celui d'un raccordement électrique. Un
 * **exemplaire déclaré perdu** est réglé lui aussi : il ne rentrera pas, et le
 * laisser en « à faire » rouvrirait chaque matin un dossier clos.
 */
export function resteDeLaLigne(phase: PhaseTournee, ligne: LigneTournee): number {
  if (phase === 'livraison') return Math.max(0, ligne.demande - ligne.livre);
  if (ligne.nature === 'prestation') return 0;
  if (ligne.etat_retour === 'perdu') return 0;
  return Math.max(0, ligne.livre - ligne.rendu - ligne.perdu);
}

/**
 * Où en est l'arrêt, d'après ses lignes.
 *
 * Un arrêt sans rien à faire est `fait` ; un arrêt dont rien n'a bougé est
 * `a_faire`. Entre les deux, `commence` : c'est l'état qui doit sauter aux yeux,
 * parce qu'un chargement à moitié saisi est la première cause de stock faux.
 */
export function etatDeLArret(lignes: LigneTournee[], phase: PhaseTournee): EtatArret {
  const reste = lignes.reduce((total, l) => total + resteDeLaLigne(phase, l), 0);
  if (reste === 0) return 'fait';
  const fait = lignes.reduce(
    (total, l) => total + (phase === 'livraison' ? l.livre : l.rendu + l.perdu),
    0
  );
  return fait > 0 ? 'commence' : 'a_faire';
}

/**
 * Une prestation n'a pas de retour à constater : elle n'a rien à faire dans la
 * liste de ce qu'on va rechercher. L'y laisser ferait cocher « revenu » sur
 * trois agents de sécurité.
 */
const concerneLaPhase = (ligne: LigneTournee, phase: PhaseTournee): boolean =>
  phase === 'livraison' || ligne.nature !== 'prestation';

/** Le plus en retard d'abord : c'est l'ordre dans lequel on monte dans le camion. */
const parUrgence = (a: ArretTournee, b: ArretTournee): number =>
  a.jour === b.jour ? a.titre.localeCompare(b.titre, 'fr') : a.jour.localeCompare(b.jour);

/**
 * Assemble la tournée à partir des lignes déjà lues.
 *
 * Fonction pure, et c'est délibéré : la règle « quel jour, quel reste, quel
 * état » se vérifie sans base de données, alors que c'est elle qui décide de ce
 * qu'un agent voit en arrivant le matin.
 */
export function assemblerTournee(
  manifestations: any[],
  lignesParManifestation: Map<number, LigneTournee[]>,
  aujourdhui: string,
  jusquAu: string
): Tournee {
  const arrets = (phase: PhaseTournee): ArretTournee[] =>
    manifestations
      .filter((m) => (phase === 'livraison' ? m.status === 'validated' : m.status === 'delivered'))
      .map((m) => {
        const jour = phase === 'livraison' ? jourDeLivraison(m) : jourDeRecuperation(m);
        const retenues = (lignesParManifestation.get(Number(m.id)) ?? []).filter((l) =>
          concerneLaPhase(l, phase)
        );
        const avecReste = retenues.map((l) => ({ ...l, reste: resteDeLaLigne(phase, l) }));

        return {
          manifestation_id: Number(m.id),
          titre: String(m.title ?? ''),
          statut: String(m.status ?? ''),
          phase,
          jour,
          retard: joursDeRetard(jour, aujourdhui),
          lieu: String(m.delivery_address ?? ''),
          contact_nom: String(m.contact_name ?? ''),
          contact_tel: String(m.contact_phone ?? ''),
          heure_debut: String(m.start_time ?? ''),
          heure_fin: String(m.end_time ?? ''),
          consignes: String(m.notes_exterior || m.notes_interior || ''),
          lignes: avecReste,
          reste: avecReste.reduce((total, l) => total + l.reste, 0),
          fait: avecReste.reduce(
            (total, l) => total + (phase === 'livraison' ? l.livre : l.rendu + l.perdu),
            0
          ),
          etat: etatDeLArret(retenues, phase),
        };
      })
      // Sans date exploitable, un arrêt ne peut pas être situé dans le temps : le
      // montrer tous les jours sous prétexte qu'on ne sait pas quand le ferait
      // ignorer. Il reste dans la liste des manifestations, à compléter.
      .filter((arret) => arret.jour !== '' && arret.jour <= jusquAu)
      // Un arrêt sans aucune ligne n'est pas un déplacement : rien à charger,
      // rien à rapporter. C'est un dossier à compléter.
      .filter((arret) => arret.lignes.length > 0)
      .sort(parUrgence);

  return {
    jour: aujourdhui,
    jusqu_au: jusquAu,
    livraisons: arrets('livraison'),
    recuperations: arrets('recuperation'),
  };
}

/** Le jour courant, au format des colonnes de date. */
export const aujourdhui = (): string => new Date().toISOString().slice(0, 10);

const marqueurs = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(', ');

/**
 * Une date lointaine, pour dire « sans borne ».
 *
 * Demander la tournée d'une manifestation précise, c'est vouloir la saisir —
 * qu'elle soit due ce matin ou dans trois semaines. La fenêtre de dates n'a alors
 * plus de sens, et l'écarter par une borne haute évite un second chemin de
 * calcul à côté de celui qui est éprouvé.
 */
const SANS_BORNE = '9999-12-31';

export interface FiltresTournee {
  /** Dernier jour retenu ; le jour même par défaut. */
  jusqu_au?: unknown;
  /** Une seule manifestation, hors fenêtre de dates : la saisie d'un dossier. */
  manifestation?: unknown;
}

/**
 * La tournée d'un compte, sa portée appliquée.
 *
 * `null` quand le compte ne peut voir aucune manifestation : la route doit alors
 * refuser, plutôt que rendre une tournée vide qui se lirait « rien à faire
 * aujourd'hui ».
 */
export async function tourneeDe(
  req: AuthRequest,
  filtres: FiltresTournee = {}
): Promise<Tournee | null> {
  const portee = await filtreManifestations(req, 'm');
  if (portee === null) return null;

  const jour = aujourdhui();
  const seule = Number(filtres.manifestation);
  const ciblee = Number.isFinite(seule) && seule > 0;
  const borne = ciblee ? SANS_BORNE : enJour(filtres.jusqu_au) || jour;

  const manifestations = await db.query(
    `SELECT m.* FROM manifestations m
     WHERE m.status IN (${marqueurs(STATUTS_TOURNEE)})${ciblee ? ' AND m.id = ?' : ''}${portee.sql}`,
    [...STATUTS_TOURNEE, ...(ciblee ? [seule] : []), ...portee.params]
  );

  const identifiants = manifestations.map((m: any) => Number(m.id));
  const lignes = identifiants.length === 0 ? [] : await lignesDe(identifiants);

  const parManifestation = new Map<number, LigneTournee[]>();
  for (const { manifestation_id, ligne } of lignes) {
    const liste = parManifestation.get(manifestation_id);
    if (liste) liste.push(ligne);
    else parManifestation.set(manifestation_id, [ligne]);
  }

  return assemblerTournee(manifestations, parManifestation, jour, borne);
}

/** Les deux gisements de matériel, lus ensemble et rendus sous la même forme. */
async function lignesDe(
  identifiants: number[]
): Promise<Array<{ manifestation_id: number; ligne: LigneTournee }>> {
  const places = marqueurs(identifiants);

  const [duStock, duParc] = await Promise.all([
    db.query(
      `SELECT mm.id as ligne_id, mm.manifestation_id,
              ms.name as nom, COALESCE(ms.unit, '') as unite,
              COALESCE(ms.is_prestation, 0) as prestation,
              COALESCE(mm.quantity_requested, 0) as demande,
              COALESCE(mm.quantity_delivered, 0) as livre,
              COALESCE(mm.quantity_recovered, 0) as rendu,
              COALESCE(mm.quantity_lost, 0) as perdu
       FROM manifestation_materials mm
       JOIN manifestation_stock ms ON ms.id = mm.stock_id
       WHERE mm.manifestation_id IN (${places})
       ORDER BY ms.name`,
      identifiants
    ),
    db.query(
      `SELECT mi.id as ligne_id, mi.manifestation_id,
              o.name as nom, COALESCE(o.reference, o.serial_number, '') as repere,
              ${expressionNature()} as nature,
              COALESCE(mi.quantity, 1) as demande,
              COALESCE(mi.quantity_delivered, 0) as livre,
              COALESCE(mi.quantity_returned, 0) as rendu,
              mi.return_state as etat_retour
       FROM manifestation_items mi
       JOIN objects o ON o.id = mi.object_id
       ${jointuresDisponibilite()}
       WHERE mi.manifestation_id IN (${places})
       ORDER BY o.name`,
      identifiants
    ),
  ]);

  return [
    ...duStock.map((l: any) => ({
      manifestation_id: Number(l.manifestation_id),
      ligne: ligneStock(l),
    })),
    ...duParc.map((l: any) => ({
      manifestation_id: Number(l.manifestation_id),
      ligne: ligneParc(l),
    })),
  ];
}

function ligneStock(l: any): LigneTournee {
  return {
    ref: `stock:${l.ligne_id}`,
    source: 'stock',
    ligne_id: Number(l.ligne_id),
    nom: String(l.nom ?? ''),
    repere: '',
    unite: String(l.unite ?? ''),
    nature: Number(l.prestation) === 1 ? 'prestation' : 'quantite',
    demande: nombre(l.demande),
    livre: nombre(l.livre),
    rendu: nombre(l.rendu),
    perdu: nombre(l.perdu),
    etat_retour: null,
    reste: 0,
  };
}

/**
 * Le parc nomme ses natures autrement — `unique`, `lot`, `prestation`. Un lot se
 * compte comme une quantité de stock ; un exemplaire se coche.
 */
function ligneParc(l: any): LigneTournee {
  const nature: NatureLigne =
    l.nature === 'prestation' ? 'prestation' : l.nature === 'lot' ? 'quantite' : 'exemplaire';

  return {
    ref: `parc:${l.ligne_id}`,
    source: 'parc',
    ligne_id: Number(l.ligne_id),
    nom: String(l.nom ?? ''),
    repere: String(l.repere ?? ''),
    unite: '',
    nature,
    demande: Math.max(1, nombre(l.demande)),
    livre: nombre(l.livre),
    rendu: nombre(l.rendu),
    // Le parc ne tient pas de colonne de casse : ce qui ne revient pas se dit
    // par l'état au retour, constat par constat.
    perdu: 0,
    etat_retour: l.etat_retour ? String(l.etat_retour) : null,
    reste: 0,
  };
}
