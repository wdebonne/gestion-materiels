import { db } from '../database';
import { expressionNature } from './lotParc.service';
import { jointuresPrestation } from './prestationParc.service';

/**
 * Ce qu'une manifestation coûte réellement.
 *
 * Deux choses, qu'il ne faut jamais additionner sans les distinguer :
 *
 * - **ce qu'on déploie** : trois agents pour une cérémonie, un raccordement
 *   électrique. C'est connu dès la demande, et c'est une dépense décidée ;
 * - **ce qui ne revient pas** : dix chaises prêtées, neuf rendues. La dixième
 *   est cassée ou volée, et elle coûte son prix — c'est une perte subie.
 *
 * Les mêler donnerait un total juste et une lecture fausse : on ne négocie pas
 * une casse comme on budgète une vacation.
 *
 * **Quand une chaise manquante devient-elle une perte ?** Tant que la
 * manifestation n'est pas récupérée, ce qui n'est pas revenu est simplement…
 * pas encore revenu. Compter la différence dès la livraison afficherait
 * 1 500 € de casse le jour où l'on sort trente chaises. Le manque n'est donc
 * chiffré qu'une fois la manifestation **récupérée ou archivée** — le moment où
 * l'application elle-même déclare que le retour a eu lieu.
 *
 * Une exception : sur le catalogue des manifestations, `quantity_lost` est
 * saisie **à la main** par le gestionnaire. C'est déjà un constat, pas une
 * déduction : elle compte tout de suite.
 */

/** Statuts où ce qui n'est pas revenu ne reviendra plus. */
const STATUTS_RETOUR_FAIT = ['recovered', 'archived'] as const;

/** Une manifestation annulée n'a rien déployé ni rien perdu. */
const STATUTS_SANS_COUT = ['cancelled'] as const;

export interface LigneCout {
  libelle: string;
  nature: 'prestation' | 'lot' | 'unique' | 'stock';
  quantite: number;
  cout_unitaire: number;
  total: number;
  /** Ce qui fonde la ligne, en clair, pour qu'un montant ne soit jamais opaque. */
  motif: string;
}

export interface CoutManifestation {
  prestations: LigneCout[];
  pertes: LigneCout[];
  total_prestations: number;
  total_pertes: number;
  total: number;
  /**
   * `false` tant que la manifestation n'est pas récupérée : les manques ne sont
   * pas encore des pertes, et le total ne les compte pas.
   */
  definitif: boolean;
  /** Ce qui est sorti et pas encore revenu, sans être compté comme perdu. */
  en_attente_de_retour: LigneCout[];
}

const arrondi = (valeur: number): number => Math.round(valeur * 100) / 100;

/**
 * Coût d'une manifestation, détaillé ligne à ligne.
 *
 * Rend toujours une structure complète, même vide : l'écran affiche « aucun
 * coût » plutôt que de disparaître, ce qui se lit comme une panne.
 */
export async function coutDe(manifestationId: number | string): Promise<CoutManifestation> {
  const vide: CoutManifestation = {
    prestations: [],
    pertes: [],
    total_prestations: 0,
    total_pertes: 0,
    total: 0,
    definitif: false,
    en_attente_de_retour: [],
  };

  const manifestation = await db.queryOne('SELECT id, status FROM manifestations WHERE id = ?', [
    manifestationId,
  ]);
  if (!manifestation) return vide;
  if ((STATUTS_SANS_COUT as readonly string[]).includes(manifestation.status)) return vide;

  const retourFait = (STATUTS_RETOUR_FAIT as readonly string[]).includes(manifestation.status);

  const prestations: LigneCout[] = [];
  const pertes: LigneCout[] = [];
  const enAttente: LigneCout[] = [];

  // ---- matériel du parc : prestations, lots, exemplaires -----------------
  const duParc = await db.query(
    `SELECT mi.quantity, mi.quantity_delivered, mi.quantity_returned, mi.return_state,
            o.name, COALESCE(o.unit_cost, 0) as unit_cost,
            ${expressionNature()} as nature
     FROM manifestation_items mi
     JOIN objects o ON o.id = mi.object_id
     ${jointuresPrestation()}
     WHERE mi.manifestation_id = ?
     ORDER BY o.name`,
    [manifestationId]
  );

  for (const ligne of duParc) {
    const cout = Number(ligne.unit_cost) || 0;

    if (ligne.nature === 'prestation') {
      // Une prestation coûte ce qu'elle déploie, dès qu'elle est demandée.
      const quantite = Math.max(1, Number(ligne.quantity) || 1);
      if (cout > 0) {
        prestations.push({
          libelle: ligne.name,
          nature: 'prestation',
          quantite,
          cout_unitaire: cout,
          total: arrondi(quantite * cout),
          motif: quantite > 1 ? `${quantite} × ${cout} €` : `${cout} €`,
        });
      }
      continue;
    }

    if (ligne.nature === 'lot') {
      const sorti = Number(ligne.quantity_delivered) || 0;
      const revenu = Number(ligne.quantity_returned) || 0;
      const manquant = Math.max(0, sorti - revenu);
      if (manquant === 0 || cout <= 0) continue;

      const cible = retourFait ? pertes : enAttente;
      cible.push({
        libelle: ligne.name,
        nature: 'lot',
        quantite: manquant,
        cout_unitaire: cout,
        total: arrondi(manquant * cout),
        motif: `${manquant} non revenue(s) sur ${sorti} livrée(s), à ${cout} €`,
      });
      continue;
    }

    // Un exemplaire : seul « perdu » se chiffre. « Abîmé » demanderait un coût
    // de réparation que personne n'a saisi, et l'inventer serait pire que de se
    // taire — le constat reste visible sur la fiche.
    if (ligne.return_state === 'perdu' && cout > 0) {
      pertes.push({
        libelle: ligne.name,
        nature: 'unique',
        quantite: 1,
        cout_unitaire: cout,
        total: arrondi(cout),
        motif: `perdu, valeur ${cout} €`,
      });
    }
  }

  // ---- catalogue des manifestations : pertes saisies à la main -----------
  //
  // `quantity_lost` est un constat du gestionnaire, pas une déduction : elle
  // compte immédiatement, sans attendre la récupération. `unit_value` est le
  // prix retenu sur cette manifestation-là, `price` celui du catalogue — un
  // prix négocié pour un événement ne doit pas réécrire le tarif de référence.
  const duStock = await db.query(
    `SELECT mm.quantity_lost, mm.loss_reason,
            COALESCE(NULLIF(mm.unit_value, 0), ms.price, 0) as unit_cost,
            ms.name
     FROM manifestation_materials mm
     JOIN manifestation_stock ms ON ms.id = mm.stock_id
     WHERE mm.manifestation_id = ? AND mm.quantity_lost > 0
     ORDER BY ms.name`,
    [manifestationId]
  );

  for (const ligne of duStock) {
    const cout = Number(ligne.unit_cost) || 0;
    const perdu = Number(ligne.quantity_lost) || 0;
    if (cout <= 0 || perdu <= 0) continue;

    pertes.push({
      libelle: ligne.name,
      nature: 'stock',
      quantite: perdu,
      cout_unitaire: cout,
      total: arrondi(perdu * cout),
      motif: ligne.loss_reason
        ? `${perdu} perdue(s) — ${ligne.loss_reason}, à ${cout} €`
        : `${perdu} perdue(s), à ${cout} €`,
    });
  }

  const totalPrestations = arrondi(prestations.reduce((t, l) => t + l.total, 0));
  const totalPertes = arrondi(pertes.reduce((t, l) => t + l.total, 0));

  return {
    prestations,
    pertes,
    total_prestations: totalPrestations,
    total_pertes: totalPertes,
    total: arrondi(totalPrestations + totalPertes),
    definitif: retourFait,
    en_attente_de_retour: enAttente,
  };
}
